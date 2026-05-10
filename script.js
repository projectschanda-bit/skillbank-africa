/* ── SkillBank Africa — script.js ─────────────────────────── */

/* ── State ── */
let currentProduct = null;
let selectedMethod = null;

/* ── DOM refs ── */
const overlay      = document.getElementById('modalOverlay');
const modalClose   = document.getElementById('modalClose');
const step1        = document.getElementById('step1');
const step2        = document.getElementById('step2');
const step3        = document.getElementById('step3');
const mobileFields = document.getElementById('mobileFields');
const cardFields   = document.getElementById('cardFields');
const downloadLink = document.getElementById('downloadLink');

/* ── Open payment modal ── */
function openPayment(btn) {
  const card = btn.closest('.course-card');
  currentProduct = {
    id:       card.dataset.id,
    price:    parseInt(card.dataset.price, 10),
    currency: card.dataset.currency,
    title:    card.dataset.title,
    file:     card.dataset.file
  };

  // Reset modal state
  selectedMethod = null;
  step1.style.display = '';
  step2.style.display = 'none';
  step3.style.display = 'none';
  mobileFields.style.display = 'none';
  cardFields.style.display   = 'none';
  clearMethodSelection();
  clearFields();

  // Populate info
  document.getElementById('modalProductTitle').textContent = currentProduct.title;
  document.getElementById('modalPriceTag').textContent     =
    '₦' + currentProduct.price.toLocaleString();

  // Open overlay
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

/* ── Close modal ── */
function closeModal() {
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  currentProduct   = null;
  selectedMethod   = null;
}

modalClose.addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

/* ── Select payment method ── */
function selectMethod(method) {
  selectedMethod = method;
  clearMethodSelection();

  const map = { mtn: 'btnMTN', airtel: 'btnAirtel', card: 'btnCard' };
  document.getElementById(map[method]).classList.add('selected');

  mobileFields.style.display = (method === 'mtn' || method === 'airtel') ? '' : 'none';
  cardFields.style.display   = (method === 'card') ? '' : 'none';

  // Update mobile pay button label
  if (method === 'mtn')    document.getElementById('mobilePayBtn').textContent = 'Pay Now via MTN MoMo';
  if (method === 'airtel') document.getElementById('mobilePayBtn').textContent = 'Pay Now via Airtel Money';
}

function clearMethodSelection() {
  ['btnMTN','btnAirtel','btnCard'].forEach(id => {
    document.getElementById(id).classList.remove('selected');
  });
}

function clearFields() {
  ['phoneInput','cardNum','cardExp','cardCvv','cardName'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

/* ── Input formatters ── */
document.getElementById('cardNum').addEventListener('input', function () {
  let v = this.value.replace(/\D/g,'').substring(0,16);
  this.value = v.replace(/(.{4})/g,'$1 ').trim();
});
document.getElementById('cardExp').addEventListener('input', function () {
  let v = this.value.replace(/\D/g,'').substring(0,4);
  if (v.length > 2) v = v.substring(0,2) + '/' + v.substring(2);
  this.value = v;
});
document.getElementById('cardCvv').addEventListener('input', function () {
  this.value = this.value.replace(/\D/g,'').substring(0,4);
});

/* ── Validate & initiate payment ── */
function initiatePayment() {
  if (!selectedMethod || !currentProduct) return;

  let valid = false;

  if (selectedMethod === 'mtn' || selectedMethod === 'airtel') {
    const phone = document.getElementById('phoneInput').value.trim();
    if (phone.length < 10) {
      shakeField('phoneInput');
      return;
    }
    valid = true;
  }

  if (selectedMethod === 'card') {
    const num  = document.getElementById('cardNum').value.replace(/\s/g,'');
    const exp  = document.getElementById('cardExp').value;
    const cvv  = document.getElementById('cardCvv').value;
    const name = document.getElementById('cardName').value.trim();
    if (num.length < 16 || exp.length < 5 || cvv.length < 3 || name.length < 2) {
      ['cardNum','cardExp','cardCvv','cardName'].forEach(shakeField);
      return;
    }
    valid = true;
  }

  if (!valid) return;

  /* Show processing screen */
  step1.style.display = 'none';
  step2.style.display = '';

  /*
   * In production, this is where you'd call the Lenco by Broadway
   * payment API endpoint. For now we simulate a 2.8-second processing
   * window, then show the download link.
   */

  setTimeout(() => {
    step2.style.display = 'none';
    showDownload();
  }, 2800);
}

/* ── Show download step ── */
function showDownload() {
  step3.style.display = '';

  /*
   * The download link points to the locally saved product file.
   * Place your PDF / ZIP files in the same directory as index.html on Hostinger.
   * The `download` attribute triggers a Save dialog in the browser.
   */
  downloadLink.href     = currentProduct.file;
  downloadLink.download = currentProduct.file;
  downloadLink.textContent = '⬇ Download ' + currentProduct.title;

  /* Log purchase (localStorage as a simple local record) */
  const purchases = JSON.parse(localStorage.getItem('sb_purchases') || '[]');
  purchases.push({
    id:        currentProduct.id,
    title:     currentProduct.title,
    price:     currentProduct.price,
    currency:  currentProduct.currency,
    method:    selectedMethod,
    date:      new Date().toISOString(),
    file:      currentProduct.file
  });
  localStorage.setItem('sb_purchases', JSON.stringify(purchases));
}

/* ── Shake animation for invalid fields ── */
function shakeField(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.transition = 'transform .07s, border-color .2s';
  el.style.borderColor = '#f72585';
  const moves = ['-6px','6px','-4px','4px','0px'];
  let i = 0;
  const t = setInterval(() => {
    el.style.transform = 'translateX(' + moves[i] + ')';
    i++;
    if (i >= moves.length) { clearInterval(t); el.style.transform = ''; }
  }, 65);
}

/* ── Card number → spaces every 4 digits (already handled above) ── */
/* ── Smooth scroll polyfill for older browsers ── */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

/* ── FAQ ACCORDION ── */
document.querySelectorAll('.faq-question').forEach(button => {
  button.addEventListener('click', () => {
    const faqItem = button.parentElement;
    const isOpen = faqItem.classList.contains('active');
    
    // Close all other FAQ items
    document.querySelectorAll('.faq-item').forEach(item => {
      item.classList.remove('active');
    });

    // Toggle current one
    if (!isOpen) {
      faqItem.classList.add('active');
    }
  });
});
