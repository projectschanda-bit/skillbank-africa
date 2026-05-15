// payment-api.js
// Client-side API layer: initiates payments, polls status, and manages cancellable sessions.

// ── Backend Configuration ───────────────────────────────────────────────────
// On Vercel, the frontend and backend share the same domain.
const BACKEND_URL = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  ? "http://localhost:5000"
  : window.location.origin; 


// ─────────────────────────────────────────────────────────────────────────────
// PaymentSession
// Wraps an AbortController so every fetch and the poll loop can be killed
// instantly from script.js via cancelActiveSession().
// ─────────────────────────────────────────────────────────────────────────────
export class PaymentSession {
  constructor() {
    this._ctrl = new AbortController();
    this.signal = this._ctrl.signal;
    this.cancelled = false;
  }
  cancel() {
    this.cancelled = true;
    this._ctrl.abort();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// initiatePayment
// POST /api/payment/initiate — fires the STK push to the customer's phone.
// ─────────────────────────────────────────────────────────────────────────────
export async function initiatePayment(params, signal) {
  const res = await fetch(`${BACKEND_URL}/api/payment/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  const data = await res.json();
  if (!res.ok || !data.success)
    throw new Error(data.message || "Payment initiation failed.");
  return data; // { reference, collectionId, requiresOtp, ... }
}

/**
 * fetchPaymentStatus
 * GET /api/payment/status/:reference
 * Returns the current status of a transaction.
 */
export async function fetchPaymentStatus(reference, signal) {
  const res = await fetch(`${BACKEND_URL}/api/payment/status/${reference}`, { signal });
  const data = await res.json();
  if (!res.ok || !data.success)
    throw new Error(data.message || "Status check failed.");
  return data; // { status, reference, ... }
}

// ─────────────────────────────────────────────────────────────────────────────
// pollPaymentStatus
// Recursive setTimeout (NOT setInterval) — stops itself on any terminal status.
// Accepts the session's AbortSignal so Cancel / modal-close kills it instantly.
// ─────────────────────────────────────────────────────────────────────────────
export function pollPaymentStatus(reference, callbacks, signal) {
  const { onStatusChange, onSuccess, onError } = callbacks;
  const FIRST_DELAY = 2_000;  // Start checking almost immediately
  const POLL_INTERVAL = 2_000; // Check every 2 seconds for snappy updates
  const BACKOFF_429 = 5_000;  // Quicker recovery from rate limiting

  const TERMINAL = new Set([
    "successful", "failed", "cancelled",
    "rejected", "timeout", "expired",
    "declined", "insufficient_funds", "error"
  ]);


  const poll = async () => {
    if (signal?.aborted) return; // session was cancelled — stop silently

    try {
      const res = await fetch(
        `${BACKEND_URL}/api/payment/status/${reference}`,
        { signal }
      );

      if (signal?.aborted) return;

      // Rate-limited — back off and retry
      if (res.status === 429) {
        setTimeout(poll, BACKOFF_429);
        return;
      }

      const data = await res.json();
      if (!data.success) {
        onError?.(new Error(data.message || "Status check failed."));
        return;
      }

      const { status } = data;
      onStatusChange?.(status);

      if (status === "successful") {
        onSuccess?.({ reference });
        return; // ← poll loop ends here on success
      }

      if (TERMINAL.has(status)) {
        const msg =
          status === "failed" ? "Payment was declined. Please try again." :
            status === "cancelled" ? "Payment was cancelled." :
              status === "rejected" ? "Wrong PIN entered. Please try again." :
                "Payment session expired. Please try again.";
        onError?.(new Error(msg));
        return; // ← poll loop ends here on any terminal failure
      }

      // Still pending — keep polling
      setTimeout(poll, POLL_INTERVAL);

    } catch (err) {
      if (err.name === "AbortError") return; // clean cancel — do nothing
      onError?.(err);
    }
  };

  // First check is delayed so the phone PIN prompt appears before we query
  setTimeout(poll, FIRST_DELAY);
}

// ─────────────────────────────────────────────────────────────────────────────
// runPaymentFlow
// Convenience wrapper — manages the full lifecycle for script.js.
// Pass the active PaymentSession so the caller can abort at any time.
// ─────────────────────────────────────────────────────────────────────────────
export async function runPaymentFlow(courseData, phone, callbacks, session) {
  const {
    onStkSent,
    onStatusChange,
    onSuccess,
    onCancelled,
    onError,
  } = callbacks;

  try {
    const initResult = await initiatePayment(
      {
        courseId: courseData.id,
        courseName: courseData.name,
        amount: courseData.price,
        phone,
      },
      session.signal
    );

    if (session.cancelled) return;

    const { reference } = initResult;

    // Notify UI that STK push was sent — script.js calls startCountdown() here
    onStkSent?.("Please open your phone and enter your mobile money PIN.");

    // Start non-blocking poll — session.signal kills it if modal closes
    pollPaymentStatus(
      reference,
      { onStatusChange, onSuccess, onError },
      session.signal
    );

  } catch (err) {
    if (err.name === "AbortError" || session.cancelled) {
      onCancelled?.();
      return;
    }
    onError?.(err.message || "An unexpected error occurred.");
  }
}
