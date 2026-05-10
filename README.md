# SkillBank Africa – SecurePay Checkout Backend

Node.js/Express backend for the Lenco by BroadPay mobile money STK push payment gateway, with Firebase Firestore as the purchase ledger.

---

## Architecture

```
Frontend (port 64012)          Backend (port 5000)              External
─────────────────────    ─────────────────────────────   ───────────────────
script.js / payment-api.js
  │                       POST /api/payment/initiate  ──►  Lenco API
  │  1. Initiate          GET  /api/payment/status/:ref    (STK push)
  │  2. Poll status
  │  3. Show result        POST /api/webhooks/lenco   ◄──  Lenco (async)
  │                              │
  │                         Firestore (purchases collection)
```

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/projectschanda-bit/securepay-checkout.git
cd securepay-checkout
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Open .env and fill in all values
```

Required values:
| Variable | Where to get it |
|---|---|
| `LENCO_SECRET_KEY` | Lenco dashboard → Settings → API Keys |
| `LENCO_PUBLIC_KEY` | Lenco dashboard → Settings → API Keys |
| `LENCO_WEBHOOK_URL` | Your public URL + `/api/webhooks/lenco` |
| `LENCO_WEBHOOK_SECRET` | Lenco dashboard → Settings → Webhooks |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Firebase Console → Project Settings → Service Accounts |

### 3. Firebase service account

1. Go to [Firebase Console](https://console.firebase.google.com) → **skillbank-africa** project.
2. Click **Project Settings** → **Service Accounts**.
3. Click **Generate new private key** → download the JSON file.
4. Save it as `firebase-service-account.json` in this project root.
5. ⚠️ It's already in `.gitignore` — never commit it.

### 4. Start the server

```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

---

## Webhook Setup (Local Dev with ngrok)

Lenco needs a **public URL** to send payment status updates.

```bash
# In a separate terminal
npx ngrok http 5000

# Copy the https URL, e.g. https://abc123.ngrok.io
# Set in .env:
LENCO_WEBHOOK_URL=https://abc123.ngrok.io/api/webhooks/lenco

# Register the same URL in the Lenco dashboard → Settings → Webhooks
```

---

## API Endpoints

### `POST /api/payment/initiate`
Start an STK push.

```json
// Request
{
  "courseId": "python-101",
  "courseName": "Python for Beginners",
  "amount": "150.00",
  "phone": "0971234567"
}

// Response (STK sent)
{
  "success": true,
  "message": "STK push sent. Please authorise the payment on your phone.",
  "reference": "SKB-1715000000000-A3F9B2",
  "collectionId": "col_xxxxxxxxxx",
  "status": "pay-offline",
  "requiresOtp": false
}
```

### `POST /api/payment/submit-otp`
Submit OTP when `requiresOtp: true`.

```json
{ "reference": "SKB-...", "collectionId": "col_...", "otp": "123456" }
```

### `GET /api/payment/status/:reference`
Poll for the latest payment status.

```json
{
  "success": true,
  "reference": "SKB-...",
  "status": "successful",
  "courseName": "Python for Beginners",
  "amount": "150.00",
  "currency": "ZMW"
}
```

### `POST /api/webhooks/lenco`
Lenco posts here automatically. Do not call this manually.

---

## Firestore Data Model

**Collection**: `purchases`  
**Document ID**: `{reference}`

```json
{
  "reference": "SKB-1715000000000-A3F9B2",
  "courseId": "python-101",
  "courseName": "Python for Beginners",
  "amount": "150.00",
  "currency": "ZMW",
  "phone": "260971234567",
  "operator": "airtel-zm",
  "status": "successful",
  "lencoCollectionId": "col_xxxxxxxxxx",
  "lencoReference": "LEN-xxxxxxxxxx",
  "operatorTransactionId": "AIR-xxxxxxxxx",
  "completedAt": "2026-05-11T10:30:00Z",
  "createdAt": "...",
  "updatedAt": "..."
}
```

---

## Sandbox Testing

Use the Lenco sandbox environment:
- Set `LENCO_BASE_URL=https://sandbox.lenco.co/access/v2` in `.env`.
- Use test credentials from [Test Cards & Accounts](https://lenco-api.readme.io/v2.0/reference/test-cards-and-accounts).
- OTP in sandbox: `000000`.

---

## Frontend Integration

Copy `payment-api.js` to your `skillbank-africa/` frontend folder and import it in `script.js`:

```js
import { runPaymentFlow } from './payment-api.js';

// Replace your existing initiatePayment() with:
await runPaymentFlow(
  { id: courseId, name: courseName, price: coursePrice },
  phoneNumber,
  {
    onOtpRequired: () => promptUserForOtp(),   // return Promise<string>
    onStkSent: (msg) => showStatusMessage(msg),
    onStatusChange: (status) => updateProgressUI(status),
    onSuccess: ({ reference }) => showDownload(reference),
    onError: (msg) => showError(msg),
  }
);
```
