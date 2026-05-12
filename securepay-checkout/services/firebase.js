// services/firebase.js
// Initialises Firebase Admin SDK (server-side) once and exports shared instances.
//
// Credential resolution order:
//   1. FIREBASE_SERVICE_ACCOUNT env var (stringified JSON) — used on Vercel / production
//   2. Local firebase-service-account.json file            — used in local development

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

let db;

function initFirebase() {
  if (admin.apps.length > 0) return; // already initialised

  let serviceAccount;

  // ── Strategy 1: env var (Vercel / production) ───────────────────────────────
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      console.log("✅ Firebase: loaded credentials from FIREBASE_SERVICE_ACCOUNT env var");
    } catch (err) {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT env var is set but contains invalid JSON.\n" +
        "Generate it with: node -e \"console.log(JSON.stringify(require('./firebase-service-account.json')))\""
      );
    }
  }

  // ── Strategy 2: local JSON file (development fallback) ─────────────────────
  if (!serviceAccount) {
    const serviceAccountPath = path.resolve(
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./firebase-service-account.json"
    );

    if (!fs.existsSync(serviceAccountPath)) {
      throw new Error(
        `Firebase credentials not found.\n` +
        `  → In production: set the FIREBASE_SERVICE_ACCOUNT environment variable in Vercel.\n` +
        `  → In development: download firebase-service-account.json from Firebase Console\n` +
        `    (Project Settings → Service Accounts → Generate new private key)\n` +
        `    and place it at: ${serviceAccountPath}`
      );
    }

    serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
    console.log("✅ Firebase: loaded credentials from local service account file");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });

  console.log("✅ Firebase Admin SDK initialised");
}

function getDb() {
  if (!db) {
    initFirebase();
    db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });
  }
  return db;
}

/**
 * Persists a new purchase record to Firestore.
 * Collection: purchases/{reference}
 */
async function createPurchaseRecord(data) {
  const db = getDb();
  const ref = db.collection("purchases").doc(data.reference);
  await ref.set({
    ...data,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

/**
 * Updates a purchase record when the payment status changes.
 */
async function updatePurchaseStatus(reference, update) {
  const db = getDb();
  const ref = db.collection("purchases").doc(reference);
  await ref.update({
    ...update,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Reads a single purchase by reference.
 */
async function getPurchase(reference) {
  const db = getDb();
  const snap = await db.collection("purchases").doc(reference).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

module.exports = {
  initFirebase,
  getDb,
  createPurchaseRecord,
  updatePurchaseStatus,
  getPurchase,
};

