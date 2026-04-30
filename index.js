// ============================================================
//  index.js — monocomplex.ai Main Server
//  Node.js + Express + MongoDB + All Integrations
// ============================================================
require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const { connectDB } = require('./lib');
const routes        = require('./api/routes');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── SECURITY MIDDLEWARE ──────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'https://monocomplex.ai',
    'http://localhost:3000',
    'http://localhost:5500',
  ],
  credentials: true,
}));

// Rate limiting — 100 requests per 15 min per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests. Please slow down.' },
});
app.use('/api', limiter);

// Stricter limit for auth routes
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Try again in 1 hour.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ── BODY PARSING ─────────────────────────────────────────────
// Note: Stripe webhook needs raw body — must be before express.json()
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── LOGGING ──────────────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ── ROUTES ───────────────────────────────────────────────────
app.use('/api', routes);

// Root
app.get('/', (req, res) =>
  res.json({ message: '🎬 monocomplex.ai API is running', version: '1.0.0', docs: '/api/health' })
);

// 404 handler
app.use((req, res) =>
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` })
);

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ── START SERVER ─────────────────────────────────────────────
async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║  🎬 monocomplex.ai API                  ║
║  Running on port ${PORT}                   ║
║  Environment: ${process.env.NODE_ENV || 'development'}              ║
╚══════════════════════════════════════════╝
    `);
  });
}

start();
module.exports = app;
