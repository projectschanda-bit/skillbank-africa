// routes/webhook.js
// Receives real-time payment status updates from Lenco by BroadPay.
//
// IMPORTANT: Register this URL in the Lenco dashboard under
//            Settings → Webhooks: https://YOUR_PUBLIC_URL/api/webhooks/lenco
//
// For local dev use ngrok:
//   npx ngrok http 5000
//   → https://abc123.ngrok.io/api/webhooks/lenco

const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const firebase = require("../services/firebase");

// ── Signature verification ─────────────────────────────────────────────────────
/**
 * Lenco signs each webhook payload with HMAC-SHA256 using your webhook secret.
 * The signature is sent in the `x-lenco-signature` header.
 *
 * We MUST verify this before trusting the payload to prevent spoofed callbacks.
 */
function verifyLencoSignature(rawBody, signature) {
  const secret = process.env.LENCO_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("⚠️  LENCO_WEBHOOK_SECRET not set – skipping signature verification");
    return true; // unsafe for production!
  }
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signature.replace("sha256=", ""), "hex")
  );
}

// ── POST /api/webhooks/lenco ───────────────────────────────────────────────────
/**
 * Lenco fires this endpoint when a payment status changes.
 * We respond with HTTP 200 immediately, then process async.
 *
 * Expected payload shape (Lenco v2):
 * {
 *   event: "collection.successful" | "collection.failed" | "collection.pending",
 *   data: {
 *     id: string,
 *     reference: string,       ← your reference
 *     lencoReference: string,
 *     status: string,
 *     amount: string,
 *     currency: string,
 *     mobileMoneyDetails: { phone, operator, operatorTransactionId, … }
 *   }
 * }
 */
router.post(
  "/lenco",
  // Raw body buffer needed for signature verification
  express.raw({ type: "application/json" }),
  async (req, res) => {
    // ── 1. Respond immediately so Lenco doesn't time out ────────
    res.status(200).json({ received: true });

    // ── 2. Verify signature ─────────────────────────────────────
    const signature = req.headers["x-lenco-signature"] || "";
    const rawBody = req.body; // Buffer when using express.raw

    if (!verifyLencoSignature(rawBody, signature)) {
      console.error("❌ Webhook signature verification failed – ignoring payload");
      return;
    }

    // ── 3. Parse payload ────────────────────────────────────────
    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      console.error("❌ Failed to parse webhook payload");
      return;
    }

    const { event, data } = payload;
    console.log(`📩 Lenco webhook received: ${event}`, data?.reference);

    // ── 4. Update Firestore ─────────────────────────────────────
    try {
      const reference = data?.reference;
      if (!reference) {
        console.error("❌ Webhook payload missing reference");
        return;
      }

      const statusMap = {
        "collection.successful": "successful",
        "collection.failed": "failed",
        "collection.pending": "pending",
      };
      const newStatus = statusMap[event] || data?.status;

      const update = {
        status: newStatus,
        lencoReference: data?.lencoReference || null,
        operatorTransactionId: data?.mobileMoneyDetails?.operatorTransactionId || null,
        completedAt: data?.completedAt || null,
      };

      await firebase.updatePurchaseStatus(reference, update);
      console.log(`✅ Purchase ${reference} updated to "${newStatus}"`);

      // ── 5. (Optional) Send a success notification email/SMS here ───
      // e.g. sendDownloadEmail(reference);

    } catch (err) {
      console.error("❌ Error processing webhook:", err.message);
    }
  }
);

module.exports = router;
