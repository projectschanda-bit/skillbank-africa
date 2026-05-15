// routes/payment.js
// Handles all client-facing payment API endpoints.

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();

const lenco = require("../services/lenco");
const firebase = require("../services/firebase");

// ── Helpers ────────────────────────────────────────────────────────────────────

const COUNTRY_MAP = {
  ZAMBIA: "ZM",
  NIGERIA: "NG",
  UGANDA: "UG",
  GHANA: "GH",
  RWANDA: "RW",
  DRC: "CD",
  CONGO: "CG",
  GABON: "GA",
  TANZANIA: "TZ",
  BENIN: "BJ",
  MALAWI: "MW"
};

const PREFIX_MAP = {
  ZM: "260",
  NG: "234",
  UG: "256",
  GH: "233",
  RW: "250",
  CD: "243",
  CG: "242",
  GA: "241",
  TZ: "255",
  BJ: "229",
  MW: "265"
};

/**
 * Generates a short, unique transaction reference for this merchant.
 * Format: SKB-<timestamp ms>-<4 random hex chars>
 */
function generateReference() {
  const rand = uuidv4().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `SKB-${Date.now()}-${rand}`;
}

/**
 * Normalise a phone number to international format.
 * Lenco expects full international number without +
 * @param {string} raw - Raw input from frontend
 * @param {string} country - Country code (ZM, NG, etc.)
 */
function normalisePhone(raw, country = "ZM") {
  if (!raw) return "";

  // 1. Remove all non-digit characters
  let digits = String(raw).replace(/\D/g, "");
  const prefix = PREFIX_MAP[country] || "260";

  // Strip prefix if already present
  if (digits.startsWith(prefix)) {
    digits = digits.slice(prefix.length);
  }
  // Strip leading zero (local format)
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // Prepend prefix
  return prefix + digits;
}

/**
 * Returns the operator string expected by Lenco.
 */
function getFinalOperator(inputOperator, normPhone, country = "ZM") {
  const op = (inputOperator || "").toLowerCase();

  // Standard operators
  if (op.includes("mtn")) return "mtn";
  if (op.includes("airtel")) return "airtel";
  
  // Region specific operators
  if (country === "ZM") {
    if (op.includes("zamtel")) return "zamtel";
    // Strip the ZM country prefix (260) to inspect local number prefixes for Zamtel detection
    const localPart = normPhone.slice(3);
    if (localPart.startsWith("95") || localPart.startsWith("75")) return "zamtel";
  }

  if (country === "NG") {
    if (op.includes("glo")) return "glo";
    if (op.includes("9mobile")) return "9mobile";
    return "mtn"; // Default for NG
  }

  return op || "mtn";
}

// ── POST /api/payment/initiate ─────────────────────────────────────────────────
/**
 * Body: { courseId, courseName, amount, phone, operator?, method?, currency? }
 */
router.post("/initiate", async (req, res) => {
  try {
    const { courseId, courseName, amount, phone, operator, method, currency: reqCurrency } = req.body;
    
    // Resolve ISO country code and billing currency from the region name sent by the frontend
    const countryName = (reqCurrency || "ZAMBIA").toUpperCase();
    const country = COUNTRY_MAP[countryName] || "ZM";
    const finalCurrency = country === "NG" ? "NGN" : (country === "ZM" ? "ZMW" : "USD");

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
/**
 * GET /api/payment/status/:reference
 * Returns current payment status from Firestore.
 * Performs a live check against Lenco if the status is still pending to ensure instant UI updates.
 */
router.get("/status/:reference", async (req, res) => {
  try {
    const { reference } = req.params;
    const purchase = await firebase.getPurchase(reference);

    if (!purchase) {
      return res.status(404).json({ success: false, message: "Reference not found." });
    }

    // Proactive Check: If still pending/started, query Lenco directly to bypass webhook delay
    if (purchase.status === "pending" || purchase.status === "started" || purchase.status === "pay-offline") {
      try {
        const lencoData = await lenco.getCollectionStatus(reference);
        
        // Lenco API structure: { status: true, data: { status: "successful", ... } }
        const liveStatus = lencoData?.data?.status || lencoData?.status;
        
        if (liveStatus && liveStatus !== purchase.status) {
          console.log(`📡 Live Status Sync: Updating ${reference} from ${purchase.status} to ${liveStatus}`);
          await firebase.updatePurchaseStatus(reference, { status: liveStatus });
          return res.json({ success: true, status: liveStatus, reference });
        }
      } catch (lencoErr) {
        console.error("⚠️ Lenco Live Check failed (falling back to database status):", lencoErr.message);
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
