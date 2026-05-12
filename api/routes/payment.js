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
 * Normalise a phone number to international format (260...) for Zambia.
 * Lenco expects 260976551763 when country is ZM.
 * @param {string} raw - Raw input from frontend
 * @param {string} country - "ZM" or "NG"
 */
function normalisePhone(raw, country = "ZM") {
  if (!raw) return "";

  // 1. Remove all non-digit characters
  let digits = String(raw).replace(/\D/g, "");

  if (country === "ZM") {
    // Strip 00260, 260, or +260
    if (digits.startsWith("00260")) {
      digits = digits.slice(5);
    } else if (digits.startsWith("260")) {
      digits = digits.slice(3);
    }

    // Now we should have the 9-digit local number (e.g. 96... or 97...)
    // If user provided a leading zero (e.g. 096...), strip it
    if (digits.length === 10 && digits.startsWith("0")) {
      digits = digits.slice(1);
    }

    // Final check for ZM: should be 9 digits now. Prepend 260.
    if (digits.length === 9) {
      return "260" + digits;
    }
  } else if (country === "NG") {
    // Nigeria logic (international 234...)
    if (digits.startsWith("0") && digits.length === 11) {
      digits = "234" + digits.slice(1);
    } else if (!digits.startsWith("234") && digits.length === 10) {
      digits = "234" + digits;
    }
    return digits;
  }

  return digits;
}

/**
 * Returns the operator string expected by Lenco (mtn, airtel, zamtel).
 */
function getFinalOperator(inputOperator, normPhone, country = "ZM") {
  const op = (inputOperator || "").toLowerCase();

  if (country === "ZM") {
    if (op.includes("mtn")) return "mtn";
    if (op.includes("airtel")) return "airtel";
    if (op.includes("zamtel")) return "zamtel";

    // Auto-detect from normalized phone (096..., 097..., 095...)
    const localPart = normPhone.startsWith("0") ? normPhone.slice(1) : normPhone;
    if (localPart.startsWith("96") || localPart.startsWith("76")) return "mtn";
    if (localPart.startsWith("97") || localPart.startsWith("77")) return "airtel";
    if (localPart.startsWith("95") || localPart.startsWith("75")) return "zamtel";

    return "airtel"; // Default fallback
  }

  if (country === "NG") {
    if (op.includes("mtn")) return "mtn";
    if (op.includes("airtel")) return "airtel";
    if (op.includes("glo")) return "glo";
    if (op.includes("9mobile")) return "9mobile";
    return "mtn";
  }

  return op;
}

// ── POST /api/payment/initiate ─────────────────────────────────────────────────
/**
 * Body: { courseId, courseName, amount, phone, operator?, method?, currency? }
 */
router.post("/initiate", async (req, res) => {
  try {
    const { courseId, courseName, amount, phone, operator, method, currency: reqCurrency } = req.body;
    const finalCurrency = (reqCurrency || "ZMW").toUpperCase();
    const country = finalCurrency === "NGN" ? "NG" : "ZM";

    // 1. Validation
    if (!courseId || !courseName) {
      return res.status(400).json({ success: false, message: "courseId and courseName are required." });
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "A valid amount is required." });
    }

    // Normalize phone to international format (e.g. 26097...)
    const normPhone = normalisePhone(phone, country);
    if (!normPhone && (method !== 'card' && operator !== 'card')) {
      return res.status(400).json({ success: false, message: "A valid phone number is required for mobile money." });
    }

    // Determine correct operator string for Lenco (no suffixes like -zm)
    const finalOperator = getFinalOperator(operator || method, normPhone, country);
    const reference = generateReference();

    // MANDATORY LOGGING FOR VERIFICATION
    console.log(`[PAYMENT] Initiating ${finalCurrency} payment. Phone: ${normPhone}, Operator: ${finalOperator}`);

    // 2. Persist initial purchase record
    await firebase.createPurchaseRecord({
      reference,
      courseId,
      courseName,
      amount: String(amount),
      currency: finalCurrency,
      phone: normPhone,
      operator: finalOperator,
      status: "pending",
      lencoCollectionId: null,
      createdAt: new Date().toISOString(),
    });

    // 3. Call Lenco STK Push
    const lencoResponse = await lenco.initiateMobileMoneyCollection({
      amount,
      currency: finalCurrency,
      country: country,
      phone: normPhone,
      operator: finalOperator,
      reference,
      description: `SkillBank Africa – ${courseName}`,
    });

    if (!lencoResponse || !lencoResponse.success) {
      throw new Error(lencoResponse?.message || "Lenco initiation failed");
    }

    const collection = lencoResponse.data;
    const requiresOtp = collection.status === "otp-required";

    // 4. Update Firestore with Lenco collection id
    await firebase.updatePurchaseStatus(reference, {
      lencoCollectionId: collection.id,
      status: collection.status,
    });

    // 5. Respond to frontend
    return res.json({
      success: true,
      message: requiresOtp
        ? "OTP sent to your phone. Please enter it to proceed."
        : "STK push sent. Please authorise the payment on your phone.",
      reference,
      collectionId: collection.id,
      status: collection.status,
      requiresOtp,
    });

  } catch (err) {
    console.error("❌ /payment/initiate error:", err.message, err.lencoData || "");

    const errorDetail = err.lencoData || {};
    let friendlyMessage = err.message || "Failed to initiate payment.";

    if (errorDetail.message === "Invalid phone") {
      friendlyMessage = "The phone number format is invalid. Please check and try again.";
    }

    return res.status(err.status || 500).json({
      success: false,
      message: friendlyMessage,
      detail: errorDetail,
    });
  }
});

// ── POST /api/payment/submit-otp ───────────────────────────────────────────────
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
router.get("/status/:reference", async (req, res) => {
  try {
    const { reference } = req.params;

    const purchase = await firebase.getPurchase(reference);
    if (!purchase) {
      return res.status(404).json({ success: false, message: "Transaction not found." });
    }

    if (["pending", "pay-offline", "otp-required"].includes(purchase.status) && purchase.lencoCollectionId) {
      try {
        const lencoResponse = await lenco.getCollectionStatus(reference);
        const latestStatus = lencoResponse.data?.status;
        if (latestStatus && latestStatus !== purchase.status) {
          await firebase.updatePurchaseStatus(reference, { status: latestStatus });
          purchase.status = latestStatus;
        }
      } catch (_) {
        // Fallback
      }
    }

    return res.json({
      success: true,
      reference: purchase.reference,
      status: purchase.status,
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
