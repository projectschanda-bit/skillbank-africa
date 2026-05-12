// services/lenco.js
// Thin wrapper around the Lenco by BroadPay REST API.
// Docs: https://lenco-api.readme.io/v2.0/reference/introduction

const axios = require("axios");

const BASE_URL = process.env.LENCO_BASE_URL || "https://api.lenco.co/access/v2";
const SECRET_KEY = process.env.LENCO_SECRET_KEY;

// ── Shared Axios instance ──────────────────────────────────────────────────────
const lencoClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${SECRET_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  timeout: 30_000,
});

// Response interceptor – normalise errors
lencoClient.interceptors.response.use(
  (res) => res,
  (err) => {
    const message =
      err.response?.data?.message ||
      err.response?.data?.error ||
      err.message ||
      "Lenco API error";
    const status = err.response?.status || 500;
    const error = new Error(message);
    error.status = status;
    error.lencoData = err.response?.data || null;
    return Promise.reject(error);
  }
);

// ── Mobile Money (STK Push) ────────────────────────────────────────────────────

/**
 * Initiate a mobile money collection (STK push).
 *
 * @param {object} params
 * @param {string} params.amount          - Amount in ZMW (e.g. "50.00")
 * @param {string} params.phone           - Customer MSISDN, e.g. "260971234567"
 * @param {string} params.operator        - "mtn-zm" | "airtel-zm"
 * @param {string} params.reference       - Your unique transaction reference
 * @param {string} params.webhookUrl      - URL Lenco will POST status updates to
 * @param {string} [params.description]   - Human-readable reason shown on STK prompt
 *
 * Possible response statuses:
 *   pending        – request received, processing
 *   pay-offline    – STK prompt sent to customer's phone ✅
 *   otp-required   – Lenco needs an OTP first (some MTN accounts)
 *   successful     – payment confirmed
 *   failed         – payment failed
 */
async function initiateMobileMoneyCollection(params) {
  const payload = {
    amount: Number(params.amount),
    reference: params.reference,
    phone: params.phone,
    operator: params.operator, // e.g., "airtel", "mtn"
    country: (params.country || "zm").toLowerCase(),
    callbackUrl: params.webhookUrl || process.env.LENCO_WEBHOOK_URL,
    description: params.description || "SkillBank Africa – course purchase",
    bearer: "merchant", // merchant absorbs the fee; change to "customer" to pass fee on
  };

  const { data } = await lencoClient.post("/collections/mobile-money", payload);
  return data; // { status, message, data: { id, reference, status, … } }
}

/**
 * Submit an OTP when Lenco returns status "otp-required".
 *
 * @param {string} collectionId  - The collection `id` from the initiation response
 * @param {string} otp           - OTP entered by the customer ("000000" in sandbox)
 */
async function submitOtp(collectionId, otp) {
  const { data } = await lencoClient.post(`/collections/${collectionId}/otp`, { otp });
  return data;
}

/**
 * Poll the status of a collection by your own reference string.
 * Use this as a fallback if webhooks are not received.
 *
 * @param {string} reference  - The reference you supplied at initiation
 */
async function getCollectionStatus(reference) {
  const { data } = await lencoClient.get(`/collections/status/${reference}`);
  return data;
}

/**
 * Fetch a collection by its Lenco-assigned id.
 *
 * @param {string} id  - The Lenco collection id
 */
async function getCollectionById(id) {
  const { data } = await lencoClient.get(`/collections/${id}`);
  return data;
}

module.exports = {
  initiateMobileMoneyCollection,
  submitOtp,
  getCollectionStatus,
  getCollectionById,
};
