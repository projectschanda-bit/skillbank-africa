// script.js — SkillBank Africa
// Controls the payment modal, currency converter, countdown timer, and session lifecycle.

import { runPaymentFlow, PaymentSession } from "./payment-api.js";

// ─────────────────────────────────────────────────────────────────────────────
// DOM REFS
// ─────────────────────────────────────────────────────────────────────────────
const payModal = document.getElementById("payModal");
const modalBackdrop = document.getElementById("modalBackdrop");
const step1 = document.getElementById("step1");
const step2 = document.getElementById("step2");
const step3 = document.getElementById("step3");
const step4 = document.getElementById("step4");        // failure step

const closeBtn = document.getElementById("closeModal");
const payBtn = document.getElementById("payBtn");
const phoneInput = document.getElementById("phoneInput");
const methodBtns = document.querySelectorAll(".method-btn");

const downloadLink = document.getElementById("downloadLink");  // step 3 download anchor

// Countdown refs (inside step 2)
const countdownWrap = document.getElementById("countdownWrap");
const countdownNum = document.getElementById("countdownNum");
const countdownArc = document.getElementById("countdownArc");

// Failure step refs
const failMsg = document.getElementById("failMsg");
const retryBtn = document.getElementById("retryBtn");

// Currency converter refs
const regionSelect = document.getElementById("currencySelect");
const allCards = document.querySelectorAll(".course-card");

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
let activeSession = null;    // null = idle | PaymentSession = live payment
let activeCourse = null;    // { id, name, price, file }
let selectedMethod = "mtn";   // "mtn" | "airtel" | "card"
let countdownTimer = null;

// ─────────────────────────────────────────────────────────────────────────────
// CURRENCY CONVERTER
// Exchange rates vs USD — update these periodically or pull from an API
// ─────────────────────────────────────────────────────────────────────────────
const RATES = {
  //            symbol  rate  localSymbol  localRate (USD→local, for display only)
  zambia:   { symbol: "$", rate: 1, label: "🇿🇲 Zambia (USD)",            localSymbol: "ZMW", localRate: 26.5  },
  nigeria:  { symbol: "$", rate: 1, label: "🇳🇬 Nigeria (USD)",           localSymbol: "NGN", localRate: 1580  },
  uganda:   { symbol: "$", rate: 1, label: "🇺🇬 Uganda (USD)",            localSymbol: "UGX", localRate: 3750  },
  ghana:    { symbol: "$", rate: 1, label: "🇬🇭 Ghana (USD)",             localSymbol: "GHS", localRate: 15.5  },
  rwanda:   { symbol: "$", rate: 1, label: "🇷🇼 Rwanda (USD)",            localSymbol: "RWF", localRate: 1380  },
  drc:      { symbol: "$", rate: 1, label: "🇨🇩 DRC (USD)",               localSymbol: "CDF", localRate: 2780  },
  congo:    { symbol: "$", rate: 1, label: "🇨🇬 Congo Brazzaville (USD)", localSymbol: "XAF", localRate: 605   },
  gabon:    { symbol: "$", rate: 1, label: "🇬🇦 Gabon (USD)",             localSymbol: "XAF", localRate: 605   },
  tanzania: { symbol: "$", rate: 1, label: "🇹🇿 Tanzania (USD)",          localSymbol: "TZS", localRate: 2650  },
  benin:    { symbol: "$", rate: 1, label: "🇧🇯 Benin (USD)",             localSymbol: "XOF", localRate: 605   },
  malawi:   { symbol: "$", rate: 1, label: "🇲🇼 Malawi (USD)",            localSymbol: "MWK", localRate: 1730  },
  usd:      { symbol: "$", rate: 1, label: "🌍 Other (USD)",              localSymbol: null,  localRate: 1     },
};

let currentCurrency = localStorage.getItem('selectedCurrency') || "zambia";

function updatePrices() {
  const { localSymbol, localRate } = RATES[currentCurrency] || RATES.usd;
  allCards.forEach(card => {
    const usd = parseFloat(card.dataset.price);
    if (!isNaN(usd)) {
      const priceEl = card.querySelector(".card-price");
      if (priceEl) {
        if (!localSymbol) {
          // "Other / USD" — no approximation needed
          priceEl.innerHTML = `$${usd}`;
        } else {
          const localAmt = Math.round(usd * localRate).toLocaleString();
          priceEl.innerHTML =
            `$${usd}<br><small class="text-sm opacity-60 font-medium">≈ ${localSymbol} ${localAmt}</small>`;
        }
      }
    }
  });
  if (activeCourse) updatePayBtnLabel();
}

function updatePayBtnLabel() {
  if (!activeCourse || !payBtn) return;
  const { symbol, rate } = RATES[currentCurrency];
  const converted = Math.round(activeCourse.price * rate);
  const methodLabel =
    selectedMethod === "airtel" ? "Airtel Money" :
      selectedMethod === "card" ? "Card" :
        "MTN MoMo";
  payBtn.textContent = `Pay ${symbol}${converted.toLocaleString()} via ${methodLabel}`;
}

window.changeRegion = function(val) {
  currentCurrency = val.toLowerCase();
  localStorage.setItem('selectedCurrency', currentCurrency);
  updatePrices();
};

if (regionSelect) {
  // We don't need to populate dropdown as it's hardcoded in index.html
  // But we can add the listener
  regionSelect.addEventListener("change", () => {
    window.changeRegion(regionSelect.value);
  });
  
  // Initialize with current value
  const saved = localStorage.getItem('selectedCurrency');
  if (saved) {
    regionSelect.value = saved;
    currentCurrency = saved;
  } else {
    currentCurrency = regionSelect.value.toLowerCase() || 'zmw';
  }
}

// Run on load
updatePrices();

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT METHOD SELECTION
// ─────────────────────────────────────────────────────────────────────────────
methodBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    methodBtns.forEach(b => {
      b.classList.remove("border-primary", "border-2", "shadow-primary");
      b.classList.add("border-white/10");
    });
    btn.classList.add("border-primary", "border-2", "shadow-primary");
    btn.classList.remove("border-white/10");
    selectedMethod = btn.dataset.method;
    updatePayBtnLabel();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OPEN / CLOSE MODAL
// ─────────────────────────────────────────────────────────────────────────────
window.openPayment = function (courseOrBtn) {
  cancelActiveSession(); // cancel any orphaned session before navigating

  let course;
  if (courseOrBtn instanceof HTMLElement) {
    const el = courseOrBtn.closest(".course-card") || courseOrBtn;
    course = {
      id:    el.dataset.id    || "1",
      name:  el.dataset.title || "Course",
      price: parseFloat(el.dataset.price) || 0, // USD
      file:  el.dataset.file  || "",
    };
  } else {
    course = courseOrBtn;
  }

  // Persist for checkout.html to read as a fallback if URL params are stripped
  try {
    localStorage.setItem("courseId",       course.id);
    localStorage.setItem("courseTitle",    course.name);
    localStorage.setItem("coursePriceUsd", String(course.price));
    localStorage.setItem("courseFile",     course.file);
    localStorage.setItem("selectedCurrency", currentCurrency);
  } catch (e) {
    console.warn("[SkillBank] localStorage write failed:", e);
  }

  // Build the checkout URL and navigate
  const params = new URLSearchParams({
    id:       course.id,
    title:    course.name,
    priceUsd: String(course.price),
    currency: currentCurrency,
    file:     course.file,
  });
  window.location.href = "checkout.html?" + params.toString();
};


function closeModal() {
  cancelActiveSession();     // ← kill any live session when user closes
  stopCountdown();

  payModal.classList.add("hidden");
  payModal.classList.remove("flex");
  document.body.style.overflow = "";
  activeCourse = null;
}

// Wire up close triggers
if (closeBtn) closeBtn.addEventListener("click", closeModal);
if (modalBackdrop) modalBackdrop.addEventListener("click", closeModal);

// ─────────────────────────────────────────────────────────────────────────────
// STEP NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────
function showStep(n) {
  [step1, step2, step3, step4].forEach((el, i) => {
    if (!el) return;
    el.classList.toggle("hidden", i + 1 !== n);
  });
  // Update step indicator chips
  document.querySelectorAll("[data-step-indicator]").forEach(chip => {
    const num = parseInt(chip.dataset.stepIndicator);
    chip.classList.toggle("opacity-100", num === n);
    chip.classList.toggle("opacity-40", num !== n);
    chip.classList.toggle("text-secondary", num === n);
    chip.classList.toggle("border-secondary", num === n);
    chip.classList.toggle("text-on-surface-variant", num !== n);
    chip.classList.toggle("border-white/20", num !== n);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COUNTDOWN  (59 seconds — SVG ring + numeric display)
// ─────────────────────────────────────────────────────────────────────────────
const COUNTDOWN_TOTAL = 59;
const ARC_CIRCUMFERENCE = 175.93;  // 2π × r=28

function startCountdown(onExpire) {
  stopCountdown(); // clear any existing timer first

  let remaining = COUNTDOWN_TOTAL;

  function renderCountdown() {
    if (!countdownNum || !countdownArc || !countdownWrap) return;

    countdownWrap.classList.remove("hidden");
    countdownNum.textContent = remaining;

    const offset = ARC_CIRCUMFERENCE * (1 - remaining / COUNTDOWN_TOTAL);
    countdownArc.style.strokeDashoffset = offset;

    // Turn red for the last 15 seconds
    const urgent = remaining <= 15;
    countdownArc.classList.toggle("stroke-error", urgent);
    countdownArc.classList.toggle("stroke-primary-container", !urgent);
    countdownNum.classList.toggle("text-error", urgent);
    countdownNum.classList.toggle("text-white", !urgent);
  }

  renderCountdown();

  countdownTimer = setInterval(() => {
    remaining--;
    renderCountdown();

    if (remaining <= 0) {
      stopCountdown();
      onExpire?.();
    }
  }, 1000);
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (countdownWrap) countdownWrap.classList.add("hidden");
}

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL ACTIVE SESSION
// Called before starting a new payment, on modal close, and on retry.
// This is the single choke-point that prevents STK push storms.
// ─────────────────────────────────────────────────────────────────────────────
function cancelActiveSession() {
  if (activeSession) {
    activeSession.cancel();
    activeSession = null;
  }
  stopCountdown();
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIATE PAYMENT  (called by Pay button click)
// ─────────────────────────────────────────────────────────────────────────────
async function initiatePayment() {
  // Guard: if a session is already live, do nothing — no second STK push
  if (activeSession) return;

  const phone = phoneInput?.value?.trim();
  if (!phone) {
    alert("Please enter your mobile money number.");
    return;
  }
  if (!activeCourse) return;

  // Build the local-currency price for the backend
  // (backend expects ZMW; adjust if your backend normalises differently)
  const { rate } = RATES[currentCurrency];
  const localPrice = Math.round(activeCourse.price * rate);

  // Create a new session — this is the AbortController wrapper
  cancelActiveSession();             // ensure no orphan from a previous attempt
  activeSession = new PaymentSession();
  const session = activeSession;     // local ref for callbacks

  showStep(2);   // → Processing screen

  await runPaymentFlow(
    {
      id: activeCourse.id,
      name: activeCourse.name,
      price: localPrice,
      operator: selectedMethod === "airtel" ? "airtel" : "mtn",
    },
    phone,
    {
      // STK push sent — start the 59-second countdown
      onStkSent: () => {
        startCountdown(() => {
          // Countdown expired → abort and send user back to Step 1
          cancelActiveSession();
          const msgEl = document.getElementById("step2StatusText");
          if (msgEl) msgEl.textContent = "Session timed out. Please try again.";
          setTimeout(() => showStep(1), 2000);
        });
      },

      onStatusChange: (status) => {
        const msgEl = document.getElementById("step2StatusText");
        if (msgEl) {
          msgEl.textContent =
            status === "pending" ? "Waiting for your PIN…" :
              status === "pay-offline" ? "Complete payment on your phone…" :
                `Status: ${status}`;
        }
      },

      onSuccess: ({ reference }) => {
        stopCountdown();         // ← always stop countdown on terminal event
        activeSession = null;

        // Populate step 3
        const refEl = document.getElementById("successReference");
        if (refEl) refEl.textContent = reference || "—";

        const dateEl = document.getElementById("successDate");
        if (dateEl) dateEl.textContent = new Date().toLocaleDateString("en-GB", {
          day: "numeric", month: "long", year: "numeric"
        });

        if (downloadLink && activeCourse?.file) {
          downloadLink.href = activeCourse.file;
          downloadLink.setAttribute("download", "");
        }

        showStep(3);
      },

      onCancelled: () => {
        stopCountdown();         // ← always stop countdown on terminal event
        activeSession = null;
        showStep(1);
      },

      onError: (errMsg) => {
        stopCountdown();         // ← always stop countdown on terminal event
        activeSession = null;

        if (failMsg) failMsg.textContent = errMsg || "Payment was not completed. Please try again.";
        showStep(4);
      },
    },
    session   // pass session so runPaymentFlow can check session.signal
  );
}

if (payBtn) payBtn.addEventListener("click", initiatePayment);

// Retry from failure screen → back to Step 1
if (retryBtn) {
  retryBtn.addEventListener("click", () => {
    cancelActiveSession();
    showStep(1);
  });
}

