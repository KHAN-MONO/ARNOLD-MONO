// ============================================================
//  lib/index.js — monocomplex.ai Core Library
// ============================================================
const axios    = require('axios');
const mongoose = require('mongoose');

// ── DATABASE ─────────────────────────────────────────────────
let isConnected = false;
async function connectDB() {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    isConnected = true;
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB error:', err.message);
  }
}

// ── CLOUDINARY ───────────────────────────────────────────────
async function uploadToCloudinary(filePath, folder = 'monocomplex') {
  try {
    const { v2: cloudinary } = require('cloudinary');
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    const result = await cloudinary.uploader.upload(filePath, { resource_type: 'auto', folder });
    return { url: result.secure_url, publicId: result.public_id };
  } catch (err) {
    console.warn('Cloudinary upload failed:', err.message);
    throw err;
  }
}

async function deleteFromCloudinary(publicId) {
  try {
    const { v2: cloudinary } = require('cloudinary');
    return cloudinary.uploader.destroy(publicId, { resource_type: 'auto' });
  } catch (err) {
    console.warn('Cloudinary delete failed:', err.message);
  }
}

// ── KLING / REPLICATE — VIDEO ────────────────────────────────
async function generateVideoKling({ prompt, duration = 10, aspectRatio = '9:16' }) {
  const res = await axios.post(
    'https://api.replicate.com/v1/models/kuaishou/kling-video/predictions',
    { input: { prompt, duration, aspect_ratio: aspectRatio } },
    { headers: { Authorization: `Token ${process.env.KLING_API_KEY}`, 'Content-Type': 'application/json' } }
  );
  return res.data;
}

async function waitForKlingVideo(predictionId, maxWaitMs = 300000) {
  const interval = 8000;
  let waited = 0;
  while (waited < maxWaitMs) {
    const res = await axios.get(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      { headers: { Authorization: `Token ${process.env.KLING_API_KEY}` } }
    );
    if (res.data.status === 'succeeded') return res.data;
    if (res.data.status === 'failed') throw new Error('Video generation failed');
    await new Promise(r => setTimeout(r, interval));
    waited += interval;
  }
  throw new Error('Video generation timed out');
}

// ── ELEVENLABS — VOICE ───────────────────────────────────────
const VOICES = {
  aisha: 'EXAVITQu4vr4xnSDxMaL', james: 'TxGEqnHWrfWFTfGW9XjX',
  zara: 'MF3mGyEYCl7XYWbV9V6O', marcus: 'VR6AewLTigWG4xSOukaG', luna: 'pNInz6obpgDQGcFmaJgB',
};
async function generateVoiceover(text, voiceName = 'aisha') {
  const res = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICES[voiceName] || VOICES.aisha}`,
    { text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.8 } },
    { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' }, responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

// ── NANO BANANA PRO — AI EDITING ─────────────────────────────
async function nanoBananaPro({ script, platform, duration }) {
  try {
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-sonnet-4-20250514', max_tokens: 1000,
        system: 'You are Nano Banana Pro, monocomplex.ai AI editing engine. Return ONLY valid JSON.',
        messages: [{ role: 'user', content: `Edit this ${platform} video script (${duration}s): "${script}"\nReturn JSON: {"colorGrade":"vibrant","musicMood":"upbeat","pacing":"fast","hook":"Start bold","cta":"Follow for more","audioBalance":{"voiceVol":0.85,"musicVol":0.25}}` }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );
    return JSON.parse(res.data.content[0].text);
  } catch {
    return { colorGrade: 'vibrant', musicMood: 'upbeat', pacing: 'fast', hook: 'Start bold', cta: 'Follow for more', audioBalance: { voiceVol: 0.85, musicVol: 0.25 } };
  }
}

async function generateScript({ topic, platform, niche, duration = 30 }) {
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    { model: 'claude-sonnet-4-20250514', max_tokens: 800,
      system: 'You are Nano Banana Pro script AI. Write viral short-form scripts. Return ONLY the script text.',
      messages: [{ role: 'user', content: `Write a ${duration}-second ${platform} script about: "${topic}". Niche: ${niche || 'general'}. Strong hook, fast-paced, clear CTA.` }] },
    { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
  );
  return res.data.content[0].text;
}

// ── FLUTTERWAVE — NGN ─────────────────────────────────────────
async function initFlutterwavePayment({ amount, currency = 'NGN', email, name, plan, redirectUrl }) {
  const ref = `MC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const res = await axios.post(
    'https://api.flutterwave.com/v3/payments',
    { tx_ref: ref, amount, currency, redirect_url: redirectUrl || `${process.env.FRONTEND_URL}/payment-success`, customer: { email, name }, payment_options: 'card,mobilemoney,ussd,banktransfer', meta: { plan }, customizations: { title: 'monocomplex.ai', description: `${plan} Plan` } },
    { headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` } }
  );
  return { paymentLink: res.data.data.link, reference: ref };
}

async function verifyFlutterwavePayment(transactionId) {
  const res = await axios.get(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, { headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` } });
  return res.data.data;
}

// ── STRIPE ───────────────────────────────────────────────────
async function createStripeCheckout({ email, plan, userId }) {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const PRICES = { creator_monthly: process.env.STRIPE_PRICE_CREATOR || 'price_creator', boss_monthly: process.env.STRIPE_PRICE_BOSS || 'price_boss' };
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription', payment_method_types: ['card'],
    customer_email: email,
    line_items: [{ price: PRICES[`${plan}_monthly`], quantity: 1 }],
    success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/pricing`,
    metadata: { userId, plan },
  });
  return { sessionId: session.id, url: session.url };
}

async function createStripePortal(customerId) {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${process.env.FRONTEND_URL}/dashboard` });
  return session.url;
}

// ── EMAIL (from separate module) ─────────────────────────────
const emailModule = require('./email');

// ── SOCIAL ───────────────────────────────────────────────────
async function publishToTikTok(videoUrl, caption, accessToken) {
  const res = await axios.post('https://open.tiktokapis.com/v2/post/publish/video/init/', { post_info: { title: caption, privacy_level: 'PUBLIC_TO_EVERYONE' }, source_info: { source: 'URL', video_url: videoUrl } }, { headers: { Authorization: `Bearer ${accessToken}` } });
  return res.data;
}

module.exports = {
  connectDB, uploadToCloudinary, deleteFromCloudinary,
  generateVideoKling, waitForKlingVideo, generateVoiceover,
  nanoBananaPro, generateScript,
  initFlutterwavePayment, verifyFlutterwavePayment,
  createStripeCheckout, createStripePortal,
  stripe: null,
  sendEmail: emailModule.sendEmail,
  sendWelcomeEmail: emailModule.sendWelcomeEmail,
  sendPasswordResetEmail: emailModule.sendPasswordResetEmail,
  sendPaymentConfirmEmail: emailModule.sendPaymentConfirmEmail,
  publishToTikTok,
};
