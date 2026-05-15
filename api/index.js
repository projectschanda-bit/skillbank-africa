// index.js
// SkillBank Africa – Lenco payment gateway backend
// ─────────────────────────────────────────────────
// Local dev:  npm run dev   (nodemon)
// Production: exported as a Vercel serverless function via module.exports = app

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
// NOTE: We warn (not exit) so Vercel serverless cold-starts are not killed
//       before the function can handle a request and return a proper error.
const required = [
  "LENCO_SECRET_KEY",
  "LENCO_PUBLIC_KEY",
  "LENCO_WEBHOOK_URL",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`\n❌  Missing environment variables: ${missing.join(", ")}`);
  console.error("    Set them in Vercel Dashboard → Project Settings → Environment Variables.\n");
}

// ── Initialise Firebase ────────────────────────────────────────────────────────
try {
  initFirebase();
} catch (err) {
  console.error("❌  Firebase init failed:", err.message);
  // Do not exit — let Vercel surface the error via the request handler
}

// ── App setup ──────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 5000;

// Security header - Relaxed slightly for serverless routing
app.use(helmet({
  contentSecurityPolicy: false, // Prevents CSP from blocking same-origin API calls on some browsers
}));

// Request logging (concise in production, verbose in dev)
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// CORS – allow requests from same origin and local dev
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5500",
      /\.vercel\.app$/,
    ],
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

// ── Start (Local Dev only) ─────────────────────────────────────────────────────
// require.main === module is true when run directly: `node server.js` or nodemon.
// On Vercel, this file is imported as a module — app.listen() is never called.
if (require.main === module) {
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
}

// ── Vercel Serverless Export ───────────────────────────────────────────────────
// Vercel imports this module and uses the exported app as the request handler.
module.exports = app;
