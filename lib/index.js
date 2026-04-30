// ============================================================
//  lib/index.js — All API Integrations for monocomplex.ai
//  Kling 3.0 · ElevenLabs · Nano Banana Pro · Cloudinary
//  Flutterwave · Stripe · Email · Social Publishing
// ============================================================
const axios    = require('axios');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const cloudinary = require('cloudinary').v2;

// ── DATABASE CONNECTION ──────────────────────────────────────
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
}

// ── CLOUDINARY SETUP (file storage) ─────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadToCloudinary(filePath, folder = 'monocomplex') {
  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: 'auto',
    folder,
    quality: 'auto',
  });
  return { url: result.secure_url, publicId: result.public_id };
}

async function deleteFromCloudinary(publicId) {
  return cloudinary.uploader.destroy(publicId, { resource_type: 'auto' });
}


// ── KLING 3.0 — VIDEO GENERATION ────────────────────────────
const klingClient = axios.create({
  baseURL: process.env.KLING_API_BASE || 'https://api.klingai.com/v1',
  headers: { Authorization: `Bearer ${process.env.KLING_API_KEY}` },
  timeout: 120000,
});

async function generateVideoKling({ prompt, duration = 10, quality = '1080p', aspectRatio = '9:16', model = 'kling-v3' }) {
  const res = await klingClient.post('/videos/text2video', {
    model,
    prompt,
    duration,
    aspect_ratio: aspectRatio,
    quality: quality === '4k' ? '4k' : 'high',
    cfg_scale: 0.5,
  });
  return res.data; // { task_id, status }
}

async function getKlingVideoStatus(taskId) {
  const res = await klingClient.get(`/videos/text2video/${taskId}`);
  return res.data; // { status, video_url, thumbnail_url }
}

// Poll until Kling finishes (max 5 min)
async function waitForKlingVideo(taskId, maxWaitMs = 300000) {
  const interval = 8000;
  let waited = 0;
  while (waited < maxWaitMs) {
    const data = await getKlingVideoStatus(taskId);
    if (data.status === 'succeed') return data;
    if (data.status === 'failed')  throw new Error('Kling video generation failed');
    await new Promise(r => setTimeout(r, interval));
    waited += interval;
  }
  throw new Error('Kling video generation timed out');
}


// ── ELEVENLABS — AI VOICEOVER ────────────────────────────────
const VOICES = {
  aisha:  'EXAVITQu4vr4xnSDxMaL',  // Nigerian Female
  james:  'TxGEqnHWrfWFTfGW9XjX',  // British Male
  zara:   'MF3mGyEYCl7XYWbV9V6O',  // American Female
  marcus: 'VR6AewLTigWG4xSOukaG',  // Deep Male
  luna:   'pNInz6obpgDQGcFmaJgB',  // Soft Female
};

async function generateVoiceover(text, voiceName = 'aisha') {
  const voiceId = VOICES[voiceName] || VOICES.aisha;
  const res = await axios.post(
    `${process.env.ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}`,
    {
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2 },
    },
    {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      responseType: 'arraybuffer',
    }
  );
  return Buffer.from(res.data); // MP3 buffer
}


// ── NANO BANANA PRO — AI EDITING ENGINE ─────────────────────
// Uses Claude (Anthropic) for intelligent editing decisions
async function nanoBananaPro({ script, videoStyle, platform, duration, attachedFiles = [] }) {
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You are Nano Banana Pro, monocomplex.ai's proprietary AI video editing engine. 
You specialise in short-form viral content for TikTok, YouTube Shorts and Instagram Reels.
Given a script and context, you output precise editing instructions as JSON.
Return ONLY valid JSON, no explanation.`,
      messages: [{
        role: 'user',
        content: `Analyse this video and produce editing instructions:

SCRIPT: ${script}
PLATFORM: ${platform}
STYLE: ${videoStyle}
DURATION: ${duration}s
ATTACHED FILES: ${attachedFiles.length} user files

Return JSON with this exact structure:
{
  "cuts": [{ "startMs": 0, "endMs": 3000, "transition": "cut|fade|zoom", "caption": "text here" }],
  "colorGrade": "vibrant|cinematic|warm|cool|dark|clean",
  "musicMood": "upbeat|dramatic|calm|energetic|inspirational",
  "captionStyle": { "font": "bold|minimal|neon", "position": "bottom|top|center", "animate": true },
  "pacing": "fast|medium|slow",
  "hook": "first 3 seconds hook instruction",
  "cta": "call to action for final 2 seconds",
  "audioBalance": { "voiceVol": 0.85, "musicVol": 0.25 },
  "aspectRatio": "9:16",
  "recommendations": ["tip 1", "tip 2"]
}`
      }],
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    }
  );

  try {
    const text = res.data.content[0].text;
    return JSON.parse(text);
  } catch {
    // Return sensible defaults if parse fails
    return {
      cuts: [{ startMs: 0, endMs: (duration || 15) * 1000, transition: 'cut', caption: '' }],
      colorGrade: 'vibrant', musicMood: 'upbeat',
      captionStyle: { font: 'bold', position: 'bottom', animate: true },
      pacing: 'fast', hook: 'Start with a bold statement',
      cta: 'Follow for more', audioBalance: { voiceVol: 0.85, musicVol: 0.25 },
      aspectRatio: '9:16', recommendations: [],
    };
  }
}

// Generate a script using Nano Banana Pro
async function generateScript({ topic, platform, niche, duration = 30 }) {
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: `You are Nano Banana Pro, monocomplex.ai's script AI. 
Write viral short-form video scripts. Be punchy, engaging, and platform-native.
Return ONLY the script text — no titles, no labels, no explanation.`,
      messages: [{
        role: 'user',
        content: `Write a ${duration}-second ${platform} script about: "${topic}"
Niche: ${niche || 'general'}
Requirements: Strong hook in first 3 seconds, fast-paced delivery, clear CTA at end.`,
      }],
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    }
  );
  return res.data.content[0].text;
}


// ── FLUTTERWAVE — NGN PAYMENTS ───────────────────────────────
async function initFlutterwavePayment({ amount, currency = 'NGN', email, name, plan, redirectUrl }) {
  const ref = `MC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const res = await axios.post(
    'https://api.flutterwave.com/v3/payments',
    {
      tx_ref: ref,
      amount,
      currency,
      redirect_url: redirectUrl || `${process.env.FRONTEND_URL}/payment-success`,
      customer: { email, name },
      payment_options: 'card,mobilemoney,ussd,banktransfer',
      meta: { plan },
      customizations: {
        title: 'monocomplex.ai',
        description: `${plan} Plan Subscription`,
        logo: `${process.env.FRONTEND_URL}/logo.png`,
      },
    },
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
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const STRIPE_PRICES = {
  creator_monthly: process.env.STRIPE_PRICE_CREATOR || 'price_creator_monthly',
  boss_monthly:    process.env.STRIPE_PRICE_BOSS    || 'price_boss_monthly',
};

async function createStripeCheckout({ email, plan, userId }) {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card', 'google_pay', 'apple_pay'],
    customer_email: email,
    line_items: [{ price: STRIPE_PRICES[`${plan}_monthly`], quantity: 1 }],
    success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${process.env.FRONTEND_URL}/pricing`,
    metadata: { userId, plan },
  });
  return { sessionId: session.id, url: session.url };
}

async function createStripePortal(customerId) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.FRONTEND_URL}/dashboard`,
  });
  return session.url;
}


// ── EMAIL ────────────────────────────────────────────────────
const transporter = nodemailer.createTransporter({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT),
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

async function sendEmail({ to, subject, html }) {
  return transporter.sendMail({
    from: `"monocomplex.ai" <${process.env.EMAIL_FROM}>`,
    to, subject, html,
  });
}

async function sendWelcomeEmail(user) {
  return sendEmail({
    to: user.email,
    subject: 'Welcome to monocomplex.ai 🎬',
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#080808;color:#f4f1eb;padding:2rem;border-radius:8px;">
        <h1 style="font-size:1.5rem;color:#00aaff;">Welcome to monocomplex.ai</h1>
        <p>Hey ${user.name}, you're in! 🚀</p>
        <p>Your <strong>${user.plan}</strong> plan is now active. Start creating viral faceless videos powered by Kling 3.0 and Nano Banana Pro.</p>
        <a href="${process.env.FRONTEND_URL}/dashboard" style="display:inline-block;background:#00aaff;color:#000;padding:.75rem 1.5rem;border-radius:4px;font-weight:700;text-decoration:none;margin-top:1rem;">Go to Dashboard →</a>
        <p style="margin-top:2rem;font-size:.8rem;color:#555;">Questions? Reply to this email or contact arnoldmono43@gmail.com</p>
      </div>`,
  });
}

async function sendPasswordResetEmail(user, resetToken) {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  return sendEmail({
    to: user.email,
    subject: 'Reset your monocomplex.ai password',
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#080808;color:#f4f1eb;padding:2rem;border-radius:8px;">
        <h1 style="font-size:1.3rem;color:#00aaff;">Password Reset</h1>
        <p>Hi ${user.name}, click below to reset your password. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#00aaff;color:#000;padding:.75rem 1.5rem;border-radius:4px;font-weight:700;text-decoration:none;margin-top:1rem;">Reset Password →</a>
        <p style="margin-top:1rem;font-size:.8rem;color:#555;">If you didn't request this, ignore this email.</p>
      </div>`,
  });
}

async function sendPaymentConfirmEmail(user, payment) {
  return sendEmail({
    to: user.email,
    subject: `Payment confirmed — ${payment.plan} plan ✓`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#080808;color:#f4f1eb;padding:2rem;border-radius:8px;">
        <h1 style="color:#00d084;">Payment Successful ✓</h1>
        <p>Hi ${user.name}, your payment has been confirmed.</p>
        <table style="width:100%;margin:1rem 0;font-size:.9rem;">
          <tr><td style="color:#888;padding:.4rem 0;">Plan</td><td><strong>${payment.plan}</strong></td></tr>
          <tr><td style="color:#888;padding:.4rem 0;">Amount</td><td><strong>${payment.currency} ${payment.amount}</strong></td></tr>
          <tr><td style="color:#888;padding:.4rem 0;">Reference</td><td>${payment.reference}</td></tr>
        </table>
        <a href="${process.env.FRONTEND_URL}/dashboard" style="display:inline-block;background:#00aaff;color:#000;padding:.75rem 1.5rem;border-radius:4px;font-weight:700;text-decoration:none;">Go to Dashboard →</a>
      </div>`,
  });
}


// ── SOCIAL PUBLISHING ────────────────────────────────────────
async function publishToTikTok(videoUrl, caption, accessToken) {
  // TikTok Content Posting API v2
  const res = await axios.post(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      post_info: { title: caption, privacy_level: 'PUBLIC_TO_EVERYONE', disable_duet: false },
      source_info: { source: 'URL', video_url: videoUrl },
    },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );
  return res.data;
}

async function publishToYouTube(videoPath, title, description, accessToken) {
  const { google } = require('googleapis');
  const youtube = google.youtube('v3');
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const res = await youtube.videos.insert({
    auth,
    part: 'snippet,status',
    requestBody: {
      snippet: { title, description, categoryId: '22' },
      status: { privacyStatus: 'public' },
    },
    media: { body: require('fs').createReadStream(videoPath) },
  });
  return res.data;
}


module.exports = {
  connectDB,
  uploadToCloudinary,
  deleteFromCloudinary,
  generateVideoKling,
  waitForKlingVideo,
  generateVoiceover,
  nanoBananaPro,
  generateScript,
  initFlutterwavePayment,
  verifyFlutterwavePayment,
  createStripeCheckout,
  createStripePortal,
  stripe,
  sendEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendPaymentConfirmEmail,
  publishToTikTok,
  publishToYouTube,
};
