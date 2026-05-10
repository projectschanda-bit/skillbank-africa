// routes/payment.js
// Handles all client-facing payment API endpoints.

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();

const lenco = require("../services/lenco");
const firebase = require("../services/firebase");

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Generates a short, unique transaction reference for this merchant.
 * Format: SKB-<timestamp ms>-<4 random hex chars>
 */
function generateReference() {
  const rand = uuidv4().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `SKB-${Date.now()}-${rand}`;
}

/**
 * Normalise a Zambian phone number to international format (260XXXXXXXXX).
 * Accepts: 260971234567 | +260971234567 | 0971234567
 */
function normalisePhone(raw) {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("260") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return "260" + digits.slice(1);
  if (digits.length === 9) return "260" + digits;
  return digits; // return as-is; Lenco will validate
}

/**
 * Detect mobile money operator from the phone prefix.
 * MTN-ZM: 096, 076  |  Airtel-ZM: 097, 077
 */
function detectOperator(normalisedPhone) {
  const prefix = normalisedPhone.slice(3, 5); // e.g. "96", "97"
  const mtnPrefixes = ["96", "76"];
  return mtnPrefixes.includes(prefix) ? "mtn-zm" : "airtel-zm";
}

// ── POST /api/payment/initiate ─────────────────────────────────────────────────
/**
 * Body: { courseId, courseName, amount, phone, operator? }
 *
 * 1. Creates a Firestore purchase record (status: pending).
 * 2. Calls Lenco → mobile money STK push.
 * 3. Updates the record with the Lenco collection id.
 * 4. Returns { reference, collectionId, status, requiresOtp }.
 */
router.post("/initiate", async (req, res) => {
  try {
    const { courseId, courseName, amount, phone, operator } = req.body;

    // ── Validation ──────────────────────────────────────────────
    if (!courseId || !courseName) {
      return res.status(400).json({ success: false, message: "courseId and courseName are required." });
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "A valid amount is required." });
    }
    if (!phone) {
      return res.status(400).json({ success: false, message: "A phone number is required." });
    }

    const normPhone = normalisePhone(phone);
    const resolvedOperator = operator || detectOperator(normPhone);
    const reference = generateReference();

    // ── Persist initial purchase record ─────────────────────────
    await firebase.createPurchaseRecord({
      reference,
      courseId,
      courseName,
      amount: String(amount),
      currency: "ZMW",
      phone: normPhone,
      operator: resolvedOperator,
      status: "pending",
      lencoCollectionId: null,
    });

    // ── Call Lenco STK Push ─────────────────────────────────────
    const lencoResponse = await lenco.initiateMobileMoneyCollection({
      amount,
      phone: normPhone,
      operator: resolvedOperator,
      reference,
      description: `SkillBank Africa – ${courseName}`,
    });

    const collection = lencoResponse.data;
    const requiresOtp = collection.status === "otp-required";

    // ── Update Firestore with Lenco collection id ────────────────
    await firebase.updatePurchaseStatus(reference, {
      lencoCollectionId: collection.id,
      status: collection.status,
    });

    return res.json({
      success: true,
      message: requiresOtp
        ? "OTP sent to your phone. Please enter it to proceed."
        : "STK push sent. Please authorise the payment on your phone.",
      reference,
      collectionId: collection.id,
      status: collection.status,      // "pending" | "pay-offline" | "otp-required"
      requiresOtp,
    });
  } catch (err) {
    console.error("❌ /payment/initiate error:", err.message, err.lencoData || "");
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to initiate payment.",
      detail: err.lencoData || null,
    });
  }
});

// ── POST /api/payment/submit-otp ───────────────────────────────────────────────
/**
 * Body: { reference, collectionId, otp }
 *
 * Called only when the initiation returned requiresOtp: true.
 * After a successful OTP, Lenco triggers the STK push → customer authorises.
 */
router.post("/submit-otp", async (req, res) => {
  try {
    const { reference, collectionId, otp } = req.body;

    if (!reference || !collectionId || !otp) {
      return res.status(400).json({ success: false, message: "reference, collectionId, and otp are required." });
    }

    const lencoResponse = await lenco.submitOtp(collectionId, otp);
    const collection = lencoResponse.data;

    // Update Firestore status
    await firebase.updatePurchaseStatus(reference, { status: collection.status });

    return res.json({
      success: true,
      message: "OTP accepted. STK push sent. Please authorise the payment on your phone.",
      status: collection.status,
    });
  } catch (err) {
    console.error("❌ /payment/submit-otp error:", err.message);
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || "Failed to submit OTP.",
    });
  }
});

// ── GET /api/payment/status/:reference ────────────────────────────────────────
/**
 * The frontend polls this every few seconds after initiating payment.
 * Returns the latest status from Firestore (kept in sync by the webhook).
 */
router.get("/status/:reference", async (req, res) => {
  try {
    const { reference } = req.params;

    // Try Firestore first (fast, free)
    const purchase = await firebase.getPurchase(reference);
    if (!purchase) {
      return res.status(404).json({ success: false, message: "Transaction not found." });
    }

    // If still pending/pay-offline, also requery Lenco as a fallback
    // (handles the case where the webhook was missed)
    if (["pending", "pay-offline"].includes(purchase.status) && purchase.lencoCollectionId) {
      try {
        const lencoResponse = await lenco.getCollectionStatus(reference);
        const latestStatus = lencoResponse.data?.status;
        if (latestStatus && latestStatus !== purchase.status) {
          await firebase.updatePurchaseStatus(reference, { status: latestStatus });
          purchase.status = latestStatus;
        }
      } catch (_) {
        // Lenco requery failed – return Firestore value anyway
      }
    }

    return res.json({
      success: true,
      reference: purchase.reference,
      status: purchase.status,          // "pending" | "pay-offline" | "successful" | "failed"
      courseName: purchase.courseName,
      amount: purchase.amount,
      currency: purchase.currency,
    });
  } catch (err) {
    console.error("❌ /payment/status error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to retrieve status." });
  }
});

module.exports = router;
