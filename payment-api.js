// payment-api.js
// Drop this file into your skillbank-africa/ frontend folder.
// Import it in script.js and replace the old setTimeout mock.
//
// Usage:
//   import { initiatePayment, pollPaymentStatus } from './payment-api.js';

const BACKEND_URL = "http://localhost:5000"; // change to your live server URL in production

// ── Initiate STK Push ──────────────────────────────────────────────────────────
/**
 * @param {object} params
 * @param {string} params.courseId
 * @param {string} params.courseName
 * @param {number} params.amount        - in ZMW
 * @param {string} params.phone         - customer's mobile number
 * @param {string} [params.operator]    - "mtn-zm" | "airtel-zm" (auto-detected if omitted)
 *
 * @returns {{ reference, collectionId, status, requiresOtp, message }}
 */
export async function initiatePayment(params) {
  const res = await fetch(`${BACKEND_URL}/api/payment/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.message || "Payment initiation failed.");
  return data;
}

// ── Submit OTP (if required) ───────────────────────────────────────────────────
/**
 * @param {{ reference, collectionId, otp }} params
 */
export async function submitPaymentOtp(params) {
  const res = await fetch(`${BACKEND_URL}/api/payment/submit-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.message || "OTP submission failed.");
  return data;
}

// ── Poll payment status ────────────────────────────────────────────────────────
/**
 * Polls the backend every `interval` ms until the payment is resolved.
 * Calls onStatusChange(status) on every update.
 *
 * @param {string}   reference
 * @param {Function} onStatusChange  - called with (status: string)
 * @param {number}   [timeout=120000] - max wait time in ms (default: 2 min)
 * @param {number}   [interval=3000]  - polling interval in ms
 * @returns {Promise<string>} final status ("successful" | "failed")
 */
export async function pollPaymentStatus(reference, onStatusChange, timeout = 120_000, interval = 3_000) {
  const deadline = Date.now() + timeout;

  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/payment/status/${reference}`);
        const data = await res.json();

        if (!data.success) {
          reject(new Error(data.message || "Status check failed."));
          return;
        }

        const { status } = data;
        onStatusChange(status);

        if (status === "successful") {
          resolve(status);
          return;
        }
        if (status === "failed") {
          reject(new Error("Payment was not completed. Please try again."));
          return;
        }

        // Still pending or pay-offline → keep polling
        if (Date.now() > deadline) {
          reject(new Error("Payment timed out. Please check your phone and try again."));
          return;
        }

        setTimeout(tick, interval);
      } catch (err) {
        reject(err);
      }
    };

    setTimeout(tick, interval); // first check after one interval
  });
}

// ── Full payment flow (convenience wrapper) ────────────────────────────────────
/**
 * Manages the entire payment lifecycle.
 *
 * @param {object} courseData       - { id, name, price }
 * @param {string} phone            - customer phone
 * @param {object} uiCallbacks
 * @param {Function} uiCallbacks.onOtpRequired      - show OTP input to user
 * @param {Function} uiCallbacks.onStkSent          - show "check your phone" message
 * @param {Function} uiCallbacks.onStatusChange     - update progress indicator
 * @param {Function} uiCallbacks.onSuccess          - unlock download
 * @param {Function} uiCallbacks.onError            - show error message
 */
export async function runPaymentFlow(courseData, phone, { onOtpRequired, onStkSent, onStatusChange, onSuccess, onError }) {
  try {
    const initResult = await initiatePayment({
      courseId: courseData.id,
      courseName: courseData.name,
      amount: courseData.price,
      phone,
    });

    const { reference, collectionId, requiresOtp } = initResult;

    // ── OTP step (some MTN accounts) ────────────────────────────
    if (requiresOtp) {
      const otp = await onOtpRequired(); // should return a Promise that resolves with the OTP string
      await submitPaymentOtp({ reference, collectionId, otp });
    }

    // ── Wait for customer to tap "Pay" on their phone ────────────
    onStkSent?.("Please open your phone and enter your mobile money PIN to complete payment.");

    // ── Poll until resolved ─────────────────────────────────────
    await pollPaymentStatus(reference, (status) => {
      onStatusChange?.(status);
    });

    onSuccess?.({ reference, courseData });
  } catch (err) {
    onError?.(err.message || "An unexpected error occurred.");
  }
}
