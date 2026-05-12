// server.js
// SkillBank Africa – Lenco payment gateway backend
// ─────────────────────────────────────────────────
// Start:   npm run dev   (development, with nodemon)
//           npm start    (production)

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const paymentRoutes = require("./routes/payment");
const webhookRoutes = require("./routes/webhook");
const { initFirebase } = require("./services/firebase");

// ── Validate required env vars ─────────────────────────────────────────────────
const required = [
  "LENCO_SECRET_KEY",
  "LENCO_PUBLIC_KEY",
  "LENCO_WEBHOOK_URL",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`\n❌  Missing environment variables: ${missing.join(", ")}`);
  console.error("    Copy .env.example → .env and fill in the values.\n");
  process.exit(1);
}

// ── Initialise Firebase ────────────────────────────────────────────────────────
try {
  initFirebase();
} catch (err) {
  console.error("❌  Firebase init failed:", err.message);
  process.exit(1);
}

// ── App setup ──────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 5000;

// Security header
app.use(helmet());

// Request logging (concise in production, verbose in dev)
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// CORS – allow requests from local development ports
app.use(
  cors({
    origin: "*", // In production, this should be specific: e.g. "https://skillbankafrica.com"
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Rate limiting – prevent payment endpoint abuse
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,    // 1 minute
  max: 10,                 // 10 initiation requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please wait a moment." },
});

// Body parser for JSON (exclude /webhooks routes which need raw buffer)
app.use((req, res, next) => {
  if (req.path.startsWith("/api/webhooks")) return next();
  express.json()(req, res, next);
});

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use("/api/payment", paymentLimiter, paymentRoutes);
app.use("/api/webhooks", webhookRoutes);

// Health check
app.get("/health", (_, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

// 404
app.use((_, res) => res.status(404).json({ success: false, message: "Endpoint not found." }));

// Global error handler
app.use((err, req, res, _next) => {
  console.error("🔥 Unhandled error:", err);
  res.status(500).json({ success: false, message: "Internal server error." });
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║  SkillBank Africa – Checkout Backend           ║
║  Running on http://localhost:${PORT}             ║
║  Environment: ${(process.env.NODE_ENV || "development").padEnd(31)}║
║  Webhook URL: ${(process.env.LENCO_WEBHOOK_URL || "not set").slice(0, 32).padEnd(31)}║
╚════════════════════════════════════════════════╝
  `);
});

module.exports = app;
