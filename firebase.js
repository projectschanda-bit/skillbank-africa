// services/firebase.js
// Initialises Firebase Admin SDK (server-side) once and exports shared instances.

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

let db;
let storage;

function initFirebase() {
  if (admin.apps.length > 0) return; // already initialised

  const serviceAccountPath = path.resolve(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./firebase-service-account.json"
  );

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      `Firebase service account file not found at: ${serviceAccountPath}\n` +
        "Download it from Firebase Console → Project Settings → Service Accounts."
    );
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

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
    // Timestamps stored as actual Timestamps, not JS Date strings
    db.settings({ ignoreUndefinedProperties: true });
  }
  return db;
}

function getStorage() {
  if (!storage) {
    initFirebase();
    storage = admin.storage();
  }
  return storage;
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
  getStorage,
  createPurchaseRecord,
  updatePurchaseStatus,
  getPurchase,
};
