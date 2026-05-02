// ============================================================
//  lib/index.js — All API Integrations for monocomplex.ai
//  Vercel-safe version — all requires wrapped safely
// ============================================================
const axios    = require('axios');
const mongoose = require('mongoose');

// ── SAFE REQUIRE HELPER ──────────────────────────────────────
function safeRequire(pkg) {
  try { return require(pkg); } catch(e) { console.warn(`Module ${pkg} not available:`, e.message); return null; }
}

const nodemailer = safeRequire('nodemailer');
const cloudinaryPkg = safeRequire('cloudinary');
const cloudinary = cloudinaryPkg ? cloudinaryPkg.v2 : null;
const stripePkg = safeRequire('stripe');

// ── DATABASE CONNECTION ──────────────────────────────────────
let isConnected = false;
async function connectDB() {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    isConnected = true;
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
  }
}

// ── CLOUDINARY SETUP ────────────────────────────────────────
if (cloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

async function uploadToCloudinary(filePath, folder = 'monocomplex') {
  if (!cloudinary) throw new Error('Cloudinary not available');
  const result = await cloudinary.uploader.upload(filePath, { resource_type: 'auto', folder });
  return { url: result.secure_url, publicId: result.public_id };
}

async function deleteFromCloudinary(publicId) {
  if (!cloudinary) return;
  return cloudinary.uploader.destroy(publicId, { resource_type: 'auto' });
}

// ── KLING 3.0 / REPLICATE — VIDEO GENERATION ────────────────
async function generateVideoKling({ prompt, duration = 10, quality = '1080p', aspectRatio = '9:16' }) {
  const res = await axios.post(
    'https://api.replicate.com/v1/models/kuaishou/kling-video/predictions',
    { input: { prompt, duration, aspect_ratio: aspectRatio } },
    { headers: { Authorization: `Token ${process.env.KLING_API_KEY}`, 'Content-Type': 'application/json' } }
  );
  return res.data;
}

async function getKlingVideoStatus(predictionId) {
  const res = await axios.get(
    `https://api.replicate.com/v1/predictions/${predictionId}`,
    { headers: { Authorization: `Token ${process.env.KLING_API_KEY}` } }
  );
  return res.data;
}

async function waitForKlingVideo(predictionId, maxWaitMs = 300000) {
  const interval = 8000;
  let waited = 0;
  while (waited < maxWaitMs) {
    const data = await getKlingVideoStatus(predictionId);
    if (data.status === 'succeeded') return data;
    if (data.status === 'failed') throw new Error('Video generation failed');
    await new Promise(r => setTimeout(r, interval));
    waited += interval;
  }
  throw new Error('Video generation timed out');
}

// ── ELEVENLABS — AI VOICEOVER ────────────────────────────────
const VOICES = {
  aisha:  'EXAVITQu4vr4xnSDxMaL',
  james:  'TxGEqnHWrfWFTfGW9XjX',
  zara:   'MF3mGyEYCl7XYWbV9V6O',
  marcus: 'VR6AewLTigWG4xSOukaG',
  luna:   'pNInz6obpgDQGcFmaJgB',
};

async function generateVoiceover(text, voiceName = 'aisha') {
  const voiceId = VOICES[voiceName] || VOICES.aisha;
  const res = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    { text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.8 } },
    { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' }, responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

// ── NANO BANANA PRO — AI EDITING ENGINE ─────────────────────
async function nanoBananaPro({ script, videoStyle, platform, duration, attachedFiles = [] }) {
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You are Nano Banana Pro, monocomplex.ai's AI video editing engine. Return ONLY valid JSON, no explanation.`,
      messages: [{ role: 'user', content: `Analyse this video and produce editing instructions:\nSCRIPT: ${script}\nPLATFORM: ${platform}\nDURATION: ${duration}s\n\nReturn JSON: {"cuts":[{"startMs":0,"endMs":3000,"transition":"cut","caption":""}],"colorGrade":"vibrant","musicMood":"upbeat","captionStyle":{"font":"bold","position":"bottom","animate":true},"pacing":"fast","hook":"hook instruction","cta":"call to action","audioBalance":{"voiceVol":0.85,"musicVol":0.25},"recommendations":[]}` }],
    },
    { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
  );
  try { return JSON.parse(res.data.content[0].text); }
  catch { return { colorGrade: 'vibrant', musicMood: 'upbeat', pacing: 'fast', hook: 'Start bold', cta: 'Follow for more', audioBalance: { voiceVol: 0.85, musicVol: 0.25 }, recommendations: [] }; }
}

async function generateScript({ topic, platform, niche, duration = 30 }) {
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: `You are Nano Banana Pro, monocomplex.ai's script AI. Write viral short-form video scripts. Return ONLY the script text.`,
      messages: [{ role: 'user', content: `Write a ${duration}-second ${platform} script about: "${topic}"\nNiche: ${niche || 'general'}\nStrong hook in first 3 seconds, fast-paced, clear CTA at end.` }],
    },
    { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
  );
  return res.data.content[0].text;
}

// ── FLUTTERWAVE — NGN PAYMENTS ───────────────────────────────
async function initFlutterwavePayment({ amount, currency = 'NGN', email, name, plan, redirectUrl }) {
  const ref = `MC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const res = await axios.post(
    'https://api.flutterwave.com/v3/payments',
    { tx_ref: ref, amount, currency, redirect_url: redirectUrl || `${process.env.FRONTEND_URL}/payment-success`, customer: { email, name }, payment_options: 'card,mobilemoney,ussd,banktransfer', meta: { plan }, customizations: { title: 'monocomplex.ai', description: `${plan} Plan Subscription` } },
    { headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` } }
  );
  return { paymentLink: res.data.data.link, reference: ref };
}

async function verifyFlutterwavePayment(transactionId) {
  const res = await axios.get(
    `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
    { headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` } }
  );
  return res.data.data;
}

// ── STRIPE — USD / GOOGLE PAY / APPLE PAY ───────────────────
let stripeClient = null;
if (stripePkg && process.env.STRIPE_SECRET_KEY) {
  try { stripeClient = stripePkg(process.env.STRIPE_SECRET_KEY); } catch(e) { console.warn('Stripe init failed:', e.message); }
}

async function createStripeCheckout({ email, plan, userId }) {
  if (!stripeClient) throw new Error('Stripe not configured');
  const PRICES = { creator_monthly: process.env.STRIPE_PRICE_CREATOR || 'price_creator', boss_monthly: process.env.STRIPE_PRICE_BOSS || 'price_boss' };
  const session = await stripeClient.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [{ price: PRICES[`${plan}_monthly`], quantity: 1 }],
    success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/pricing`,
    metadata: { userId, plan },
  });
  return { sessionId: session.id, url: session.url };
}

async function createStripePortal(customerId) {
  if (!stripeClient) throw new Error('Stripe not configured');
  const session = await stripeClient.billingPortal.sessions.create({ customer: customerId, return_url: `${process.env.FRONTEND_URL}/dashboard` });
  return session.url;
}

// ── EMAIL ────────────────────────────────────────────────────
function getTransporter() {
  if (!nodemailer) return null;
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
}

async function sendEmail({ to, subject, html }) {
  const transporter = getTransporter();
  if (!transporter) { console.warn('Email not available'); return; }
  return transporter.sendMail({ from: `"monocomplex.ai" <${process.env.EMAIL_FROM}>`, to, subject, html });
}

async function sendWelcomeEmail(user) {
  return sendEmail({ to: user.email, subject: 'Welcome to monocomplex.ai 🎬', html: `<div style="font-family:sans-serif;background:#080808;color:#f4f1eb;padding:2rem;border-radius:8px;"><h1 style="color:#00aaff;">Welcome to monocomplex.ai</h1><p>Hey ${user.name}, you're in! 🚀</p><p>Your <strong>${user.plan}</strong> plan is now active.</p><a href="${process.env.FRONTEND_URL}/dashboard" style="display:inline-block;background:#00aaff;color:#000;padding:.75rem 1.5rem;border-radius:4px;font-weight:700;text-decoration:none;margin-top:1rem;">Go to Dashboard →</a></div>` });
}

async function sendPasswordResetEmail(user, resetToken) {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  return sendEmail({ to: user.email, subject: 'Reset your monocomplex.ai password', html: `<div style="font-family:sans-serif;background:#080808;color:#f4f1eb;padding:2rem;border-radius:8px;"><h1 style="color:#00aaff;">Password Reset</h1><p>Hi ${user.name}, click below to reset your password.</p><a href="${resetUrl}" style="display:inline-block;background:#00aaff;color:#000;padding:.75rem 1.5rem;border-radius:4px;font-weight:700;text-decoration:none;margin-top:1rem;">Reset Password →</a></div>` });
}

async function sendPaymentConfirmEmail(user, payment) {
  return sendEmail({ to: user.email, subject: `Payment confirmed — ${payment.plan} plan ✓`, html: `<div style="font-family:sans-serif;background:#080808;color:#f4f1eb;padding:2rem;border-radius:8px;"><h1 style="color:#00d084;">Payment Successful ✓</h1><p>Hi ${user.name}, your ${payment.plan} plan is now active.</p><p>Amount: ${payment.currency} ${payment.amount}</p><a href="${process.env.FRONTEND_URL}/dashboard" style="display:inline-block;background:#00aaff;color:#000;padding:.75rem 1.5rem;border-radius:4px;font-weight:700;text-decoration:none;margin-top:1rem;">Go to Dashboard →</a></div>` });
}

// ── SOCIAL PUBLISHING ────────────────────────────────────────
async function publishToTikTok(videoUrl, caption, accessToken) {
  const res = await axios.post('https://open.tiktokapis.com/v2/post/publish/video/init/', { post_info: { title: caption, privacy_level: 'PUBLIC_TO_EVERYONE' }, source_info: { source: 'URL', video_url: videoUrl } }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
  return res.data;
}

module.exports = {
  connectDB, uploadToCloudinary, deleteFromCloudinary,
  generateVideoKling, waitForKlingVideo, generateVoiceover,
  nanoBananaPro, generateScript,
  initFlutterwavePayment, verifyFlutterwavePayment,
  createStripeCheckout, createStripePortal,
  stripe: stripeClient,
  sendEmail, sendWelcomeEmail, sendPasswordResetEmail, sendPaymentConfirmEmail,
  publishToTikTok,
};
