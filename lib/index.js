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

// ── GOOGLE VEO — VIDEO ───────────────────────────────────────
async function generateVideoVeo({ prompt, duration = 8, aspectRatio = '9:16', model = 'veo-2.0-generate-001' }) {
  // Google Veo via Vertex AI / Google AI Studio
  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateVideo`,
    {
      prompt: { text: prompt },
      videoGenerationConfig: {
        durationSeconds: duration,
        aspectRatio: aspectRatio === '9:16' ? 'ASPECT_RATIO_9_16' : aspectRatio === '16:9' ? 'ASPECT_RATIO_16_9' : 'ASPECT_RATIO_9_16',
        fps: 24,
      },
    },
    {
      headers: {
        'x-goog-api-key': process.env.GOOGLE_VEO_API_KEY,
        'Content-Type': 'application/json',
      },
    }
  );
  // Veo returns an operation name — poll for completion
  return { operationName: res.data.name, model: 'veo' };
}

async function waitForVeoVideo(operationName, maxWaitMs = 600000) {
  const interval = 10000;
  let waited = 0;
  while (waited < maxWaitMs) {
    const res = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/${operationName}`,
      { headers: { 'x-goog-api-key': process.env.GOOGLE_VEO_API_KEY } }
    );
    if (res.data.done) {
      if (res.data.error) throw new Error(`Veo error: ${res.data.error.message}`);
      const videoUri = res.data.response?.videos?.[0]?.uri || res.data.response?.video?.uri;
      if (!videoUri) throw new Error('Veo returned no video URI');
      return { video_url: videoUri, thumbnail_url: null, model: 'veo' };
    }
    await new Promise(r => setTimeout(r, interval));
    waited += interval;
  }
  throw new Error('Veo video generation timed out');
}

// ── OPENAI SORA — VIDEO ──────────────────────────────────────
async function generateVideoSora({ prompt, duration = 10, aspectRatio = '9:16', quality = '1080p' }) {
  const resolutionMap = {
    '9:16':  { width: 720,  height: 1280 },
    '16:9':  { width: 1280, height: 720  },
    '1:1':   { width: 720,  height: 720  },
  };
  const size = resolutionMap[aspectRatio] || resolutionMap['9:16'];

  const res = await axios.post(
    'https://api.openai.com/v1/video/generations',
    {
      model: 'sora-1.0-turbo',  // or 'sora-1.0-hd' for higher quality
      prompt,
      n: 1,
      duration,
      size: `${size.width}x${size.height}`,
      response_format: 'url',
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
  // Sora returns a task ID — poll for completion
  const taskId = res.data.id;
  return { taskId, model: 'sora' };
}

async function waitForSoraVideo(taskId, maxWaitMs = 600000) {
  const interval = 10000;
  let waited = 0;
  while (waited < maxWaitMs) {
    const res = await axios.get(
      `https://api.openai.com/v1/video/generations/${taskId}`,
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    const status = res.data.status;
    if (status === 'succeeded' || status === 'completed') {
      const videoUrl = res.data.data?.[0]?.url || res.data.url;
      if (!videoUrl) throw new Error('Sora returned no video URL');
      return { video_url: videoUrl, thumbnail_url: null, model: 'sora' };
    }
    if (status === 'failed') throw new Error(`Sora generation failed: ${res.data.error?.message || 'Unknown error'}`);
    await new Promise(r => setTimeout(r, interval));
    waited += interval;
  }
  throw new Error('Sora video generation timed out');
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
async function createStripeCheckout({ email, plan, userId, currency = 'usd', amount }) {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  // Currency-specific Stripe Price IDs (set these in your .env)
  // If a price ID isn't set for a currency, we fall back to price_data (inline pricing)
  const PRICE_IDS = {
    usd: { creator: process.env.STRIPE_PRICE_CREATOR_USD || process.env.STRIPE_PRICE_CREATOR || null, boss: process.env.STRIPE_PRICE_BOSS_USD || process.env.STRIPE_PRICE_BOSS || null },
    gbp: { creator: process.env.STRIPE_PRICE_CREATOR_GBP || null, boss: process.env.STRIPE_PRICE_BOSS_GBP || null },
    eur: { creator: process.env.STRIPE_PRICE_CREATOR_EUR || null, boss: process.env.STRIPE_PRICE_BOSS_EUR || null },
  };

  const priceId = PRICE_IDS[currency]?.[plan];

  // Build line_items — use price ID if available, otherwise use price_data (dynamic)
  const lineItem = priceId
    ? { price: priceId, quantity: 1 }
    : {
        price_data: {
          currency,
          unit_amount: amount, // in minor units (pence/cents)
          recurring: { interval: 'month' },
          product_data: {
            name: `monocomplex.ai — ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
            description: `Monthly subscription — billed in ${currency.toUpperCase()}`,
          },
        },
        quantity: 1,
      };

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [lineItem],
    success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/pricing`,
    metadata: { userId, plan, currency },
    // Enable wallets for GBP/EUR regions
    payment_method_options: {
      card: { request_three_d_secure: 'automatic' },
    },
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

// ── URL / REDDIT → SCRIPT ────────────────────────────────────
async function extractContentFromUrl(url) {
  try {
    // Detect Reddit URLs and use Reddit JSON API
    if (url.includes('reddit.com')) {
      const jsonUrl = url.replace(/\/$/, '') + '.json';
      const res = await axios.get(jsonUrl, { headers: { 'User-Agent': 'monocomplex.ai/1.0' } });
      const post = res.data[0]?.data?.children?.[0]?.data;
      if (!post) throw new Error('Could not extract Reddit post');
      return {
        title: post.title,
        body: post.selftext || post.title,
        source: 'reddit',
        subreddit: post.subreddit,
      };
    }
    // Generic article URL — extract via Anthropic
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514', max_tokens: 1000,
        system: 'Extract the main article content from this URL. Return JSON: {"title":"","body":"","summary":""}',
        messages: [{ role: 'user', content: `Extract content from this URL for a video script: ${url}` }],
      },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );
    return JSON.parse(res.data.content[0].text);
  } catch (err) {
    console.warn('URL extraction failed:', err.message);
    return { title: url, body: '', source: 'url' };
  }
}

// ── TRENDING TOPIC SUGGESTIONS ───────────────────────────────
async function getTrendingTopics({ niche = 'general', platform = 'tiktok', count = 10 }) {
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514', max_tokens: 800,
      system: 'You are a viral content strategist. Return ONLY valid JSON — an array of topic objects.',
      messages: [{
        role: 'user',
        content: `Generate ${count} trending video topic ideas for ${platform} in the "${niche}" niche.
Return JSON array: [{"title":"","hook":"","estimatedViews":"1M+","difficulty":"easy|medium|hard","type":"educational|story|list|trending"}]`,
      }],
    },
    { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
  );
  try { return JSON.parse(res.data.content[0].text); }
  catch { return []; }
}

// ── STOCK FOOTAGE SEARCH ─────────────────────────────────────
async function searchStockFootage(query, count = 5) {
  try {
    if (process.env.PEXELS_API_KEY) {
      const res = await axios.get('https://api.pexels.com/videos/search', {
        params: { query, per_page: count, orientation: 'portrait' },
        headers: { Authorization: process.env.PEXELS_API_KEY },
      });
      return (res.data.videos || []).map(v => ({
        id: v.id,
        url: v.video_files?.[0]?.link,
        thumbnail: v.image,
        duration: v.duration,
        source: 'pexels',
      }));
    }
    if (process.env.PIXABAY_API_KEY) {
      const res = await axios.get('https://pixabay.com/api/videos/', {
        params: { key: process.env.PIXABAY_API_KEY, q: query, per_page: count, video_type: 'film' },
      });
      return (res.data.hits || []).map(v => ({
        id: v.id,
        url: v.videos?.medium?.url,
        thumbnail: v.previewURL,
        source: 'pixabay',
      }));
    }
    return [];
  } catch (err) {
    console.warn('Stock footage search failed:', err.message);
    return [];
  }
}

// ── VOICE CLONING (ElevenLabs) ───────────────────────────────
async function cloneVoice({ name, audioBuffer }) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('name', name);
  form.append('files', audioBuffer, { filename: 'sample.mp3', contentType: 'audio/mpeg' });
  const res = await axios.post(
    'https://api.elevenlabs.io/v1/voices/add',
    form,
    { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, ...form.getHeaders() } }
  );
  return { voiceId: res.data.voice_id };
}

// ── BACKGROUND MUSIC LIBRARY ─────────────────────────────────
const MUSIC_LIBRARY = {
  upbeat:    'https://res.cloudinary.com/monocomplex/video/upload/music/upbeat_01.mp3',
  calm:      'https://res.cloudinary.com/monocomplex/video/upload/music/calm_01.mp3',
  dramatic:  'https://res.cloudinary.com/monocomplex/video/upload/music/dramatic_01.mp3',
  horror:    'https://res.cloudinary.com/monocomplex/video/upload/music/horror_01.mp3',
  corporate: 'https://res.cloudinary.com/monocomplex/video/upload/music/corporate_01.mp3',
  lofi:      'https://res.cloudinary.com/monocomplex/video/upload/music/lofi_01.mp3',
  epic:      'https://res.cloudinary.com/monocomplex/video/upload/music/epic_01.mp3',
};
function getMusicForMood(mood = 'auto', theme = 'default') {
  if (mood !== 'auto') return MUSIC_LIBRARY[mood] || MUSIC_LIBRARY.upbeat;
  const themeMap = { horror: 'horror', neon: 'upbeat', anime: 'upbeat', cinematic: 'dramatic', minimal: 'calm', corporate: 'corporate' };
  return MUSIC_LIBRARY[themeMap[theme] || 'upbeat'];
}

// ── AI AVATAR GENERATION ─────────────────────────────────────
async function generateAvatarVideo({ script, avatarStyle = 'realistic', language = 'en' }) {
  // Uses HeyGen API for talking avatar videos
  if (!process.env.HEYGEN_API_KEY) throw new Error('HeyGen API key not configured');
  const res = await axios.post(
    'https://api.heygen.com/v2/video/generate',
    {
      video_inputs: [{
        character: { type: 'avatar', avatar_id: avatarStyle === 'realistic' ? 'Daisy-inblackskirt-20220818' : 'Tyler-incasualsuit-20220721', scale: 1.0 },
        voice: { type: 'text', input_text: script, voice_id: 'en-US-AriaNeural', speed: 1.1 },
        background: { type: 'color', value: '#080808' },
      }],
      dimension: { width: 720, height: 1280 },
      aspect_ratio: '9:16',
    },
    { headers: { 'X-Api-Key': process.env.HEYGEN_API_KEY, 'Content-Type': 'application/json' } }
  );
  return { videoId: res.data.data?.video_id };
}

async function waitForAvatarVideo(videoId, maxWaitMs = 300000) {
  const interval = 8000; let waited = 0;
  while (waited < maxWaitMs) {
    const res = await axios.get(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, { headers: { 'X-Api-Key': process.env.HEYGEN_API_KEY } });
    if (res.data.data?.status === 'completed') return { video_url: res.data.data.video_url };
    if (res.data.data?.status === 'failed') throw new Error('Avatar video generation failed');
    await new Promise(r => setTimeout(r, interval));
    waited += interval;
  }
  throw new Error('Avatar video timed out');
}

module.exports = {
  connectDB, uploadToCloudinary, deleteFromCloudinary,
  generateVideoKling, waitForKlingVideo,
  generateVideoVeo, waitForVeoVideo,
  generateVideoSora, waitForSoraVideo,
  generateAvatarVideo, waitForAvatarVideo,
  generateVoiceover, cloneVoice,
  nanoBananaPro, generateScript,
  extractContentFromUrl, getTrendingTopics,
  searchStockFootage, getMusicForMood,
  initFlutterwavePayment, verifyFlutterwavePayment,
  createStripeCheckout, createStripePortal,
  stripe: null,
  sendEmail: emailModule.sendEmail,
  sendWelcomeEmail: emailModule.sendWelcomeEmail,
  sendPasswordResetEmail: emailModule.sendPasswordResetEmail,
  sendPaymentConfirmEmail: emailModule.sendPaymentConfirmEmail,
  publishToTikTok,
};
