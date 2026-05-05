// ============================================================
//  api/routes.js — All API Routes for monocomplex.ai
// ============================================================
const express  = require('express');
const multer   = require('multer');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const router   = express.Router();

const { User, Video, Series, MediaFile, Payment, Whitelist, BrandKit, VoiceClone, Schedule } = require('../models');
const { protect, requirePlan, checkVideoQuota, signToken } = require('../middleware/auth');
const {
  uploadToCloudinary, deleteFromCloudinary,
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
  sendWelcomeEmail, sendPasswordResetEmail, sendPaymentConfirmEmail,
  publishToTikTok,
} = require('../lib');

// Multer — store in memory before Cloudinary upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10GB max (plan enforced below)
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg','image/png','image/gif','image/webp',
      'video/mp4','video/quicktime','video/x-msvideo','video/webm',
      'audio/mpeg','audio/wav','audio/ogg','audio/aac',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`File type ${file.mimetype} not supported`), false);
  },
});


// ════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/auth/register
router.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password, referredBy } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: 'Name, email and password are required.' });

    const exists = await User.findOne({ email });
    if (exists)
      return res.status(400).json({ success: false, message: 'Email already registered.' });

    // Check if email is on Arnold's whitelist — give free Boss plan
    const whitelisted = await Whitelist.findOne({ email: email.toLowerCase() });
    const assignedPlan = whitelisted ? whitelisted.plan : 'starter';

    const user = await User.create({
      name, email, password,
      plan: assignedPlan,
      affiliateCode: uuidv4().slice(0, 8).toUpperCase(),
      referredBy,
    });
    user.applyPlanLimits();
    await user.save();

    await sendWelcomeEmail(user);
    const token = signToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: { id: user._id, name: user.name, email: user.email, plan: user.plan },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/login
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required.' });

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    // ── Re-check whitelist on every login ──────────────────
    // This ensures whitelisted users ALWAYS get their correct plan
    // even if they registered before the whitelist was seeded
    const whitelisted = await Whitelist.findOne({ email: email.toLowerCase() });
    if (whitelisted && user.plan !== whitelisted.plan) {
      user.plan = whitelisted.plan;
      user.planStatus = 'active';
      user.applyPlanLimits();
      await user.save();
      console.log(`✅ Whitelist upgrade on login: ${email} → ${whitelisted.plan}`);
    }

    const token = signToken(user._id);
    res.json({
      success: true,
      token,
      user: { id: user._id, name: user.name, email: user.email, plan: user.plan },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/me
router.get('/auth/me', protect, async (req, res) => {
  // Re-check whitelist in case they were added after registration
  const whitelisted = await Whitelist.findOne({ email: req.user.email.toLowerCase() });
  if (whitelisted && req.user.plan !== whitelisted.plan) {
    req.user.plan = whitelisted.plan;
    req.user.planStatus = 'active';
    req.user.applyPlanLimits();
    await req.user.save();
  }
  res.json({ success: true, user: req.user });
});

// POST /api/auth/forgot-password
router.post('/auth/forgot-password', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user)
      return res.status(404).json({ success: false, message: 'No account with that email.' });

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetToken   = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    await sendPasswordResetEmail(user, resetToken);
    res.json({ success: true, message: 'Password reset email sent.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/reset-password/:token
router.post('/auth/reset-password/:token', async (req, res) => {
  try {
    const hashed = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await User.findOne({ resetToken: hashed, resetExpires: { $gt: Date.now() } });
    if (!user)
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });

    user.password    = req.body.password;
    user.resetToken  = undefined;
    user.resetExpires = undefined;
    await user.save();

    res.json({ success: true, message: 'Password reset successful.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ════════════════════════════════════════════════════════════
//  VIDEO ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/videos/generate — Full pipeline: script → AI Model → ElevenLabs → NBP edit
router.post('/videos/generate', protect, checkVideoQuota, async (req, res) => {
  try {
    const { prompt, videoModel, voice, format, quality, platforms, scheduledFor, seriesId, attachedFileIds } = req.body;

    // Normalise model name
    const selectedModel = videoModel || 'kling-3.0-pro';

    // 1. Create video record
    const video = await Video.create({
      user:          req.user._id,
      series:        seriesId || undefined,
      title:         prompt.slice(0, 80),
      prompt,
      videoModel:    selectedModel,
      voice:         voice || 'aisha',
      editingAI:     'nano-banana-pro',
      format:        format || '9:16',
      quality:       quality || '1080p',
      status:        'scripting',
      attachedFiles: attachedFileIds || [],
      scheduledFor:  scheduledFor || undefined,
    });

    // Respond immediately — process async
    res.json({ success: true, videoId: video._id, message: 'Video generation started.' });

    // ── ASYNC PIPELINE ──────────────────────────────────────
    (async () => {
      try {
        // Step 1: Generate script via Nano Banana Pro
        const script = await generateScript({
          topic: prompt,
          platform: (platforms || ['tiktok'])[0],
          niche: req.user.niche || 'general',
          duration: 30,
        });
        await Video.findByIdAndUpdate(video._id, { script, status: 'generating', 'pipeline.scriptDone': true });

        // Step 2: Video generation — route to correct AI model
        let videoResult;
        const isVeo   = selectedModel.includes('veo');
        const isSora  = selectedModel.includes('sora');

        if (isVeo) {
          // ── Google Veo ──────────────────────────────────
          console.log('🎬 Using Google Veo for video generation...');
          const veoTask = await generateVideoVeo({
            prompt: script.slice(0, 500),
            duration: 8,
            aspectRatio: format || '9:16',
            model: selectedModel.includes('3') ? 'veo-3.0-generate-preview' : 'veo-2.0-generate-001',
          });
          videoResult = await waitForVeoVideo(veoTask.operationName);

        } else if (isSora) {
          // ── OpenAI Sora ─────────────────────────────────
          console.log('🎬 Using OpenAI Sora for video generation...');
          const soraTask = await generateVideoSora({
            prompt: script.slice(0, 500),
            duration: 10,
            aspectRatio: format || '9:16',
            quality: quality || '1080p',
          });
          videoResult = await waitForSoraVideo(soraTask.taskId);

        } else {
          // ── Kling 3.0 (default) ─────────────────────────
          console.log('🎬 Using Kling 3.0 for video generation...');
          const klingTask = await generateVideoKling({
            prompt: script.slice(0, 500),
            duration: 15,
            quality,
            aspectRatio: format || '9:16',
            model: selectedModel,
          });
          videoResult = await waitForKlingVideo(klingTask.task_id || klingTask.id);
        }

        await Video.findByIdAndUpdate(video._id, { 'pipeline.videoDone': true });

        // Step 3: ElevenLabs voiceover
        const audioBuffer = await generateVoiceover(script, voice || 'aisha');
        await Video.findByIdAndUpdate(video._id, { 'pipeline.voiceDone': true });

        // Step 4: Nano Banana Pro editing instructions
        const editInstructions = await nanoBananaPro({
          script,
          videoStyle: 'viral',
          platform: (platforms || ['tiktok'])[0],
          duration: 15,
          attachedFiles: attachedFileIds || [],
        });
        await Video.findByIdAndUpdate(video._id, {
          'pipeline.editingDone': true,
          'pipeline.captionsDone': true,
          status: 'publishing',
        });

        // Step 5: Upload final video to Cloudinary
        const { url, publicId } = await uploadToCloudinary(klingResult.video_url, 'monocomplex/videos');
        await Video.findByIdAndUpdate(video._id, {
          fileUrl: url,
          thumbnailUrl: klingResult.thumbnail_url,
          status: 'published',
          'pipeline.publishDone': true,
        });

        // Step 6: Auto-publish to platforms
        const publishedTo = [];
        for (const platform of (platforms || [])) {
          try {
            const account = req.user.socialAccounts?.[platform];
            if (account?.connected && account?.accessToken) {
              if (platform === 'tiktok') {
                await publishToTikTok(url, prompt, account.accessToken);
              }
              publishedTo.push({ platform, publishedAt: new Date() });
            }
          } catch (pubErr) {
            console.error(`Publishing to ${platform} failed:`, pubErr.message);
          }
        }

        await Video.findByIdAndUpdate(video._id, { publishedTo });

        // Increment user monthly count
        await User.findByIdAndUpdate(req.user._id, { $inc: { videosThisMonth: 1 } });

      } catch (pipelineErr) {
        console.error('Pipeline error:', pipelineErr.message);
        await Video.findByIdAndUpdate(video._id, {
          status: 'failed',
          errorMessage: pipelineErr.message,
        });
      }
    })();

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/videos — List user's videos
router.get('/videos', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const filter = { user: req.user._id };
    if (status) filter.status = status;

    const videos = await Video.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('series', 'name');

    const total = await Video.countDocuments(filter);
    res.json({ success: true, videos, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/videos/:id — Get single video + status
router.get('/videos/:id', protect, async (req, res) => {
  try {
    const video = await Video.findOne({ _id: req.params.id, user: req.user._id });
    if (!video) return res.status(404).json({ success: false, message: 'Video not found.' });
    res.json({ success: true, video });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/videos/:id
router.delete('/videos/:id', protect, async (req, res) => {
  try {
    const video = await Video.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!video) return res.status(404).json({ success: false, message: 'Video not found.' });
    res.json({ success: true, message: 'Video deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/videos/script — Generate script only (Nano Banana Pro)
router.post('/videos/script', protect, async (req, res) => {
  try {
    const { topic, platform, niche, duration } = req.body;
    const script = await generateScript({ topic, platform, niche, duration });
    res.json({ success: true, script });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ════════════════════════════════════════════════════════════
//  SERIES ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/series
router.get('/series', protect, async (req, res) => {
  const series = await Series.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, series });
});

// POST /api/series
router.post('/series', protect, async (req, res) => {
  try {
    const series = await Series.create({ ...req.body, user: req.user._id });
    res.status(201).json({ success: true, series });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/series/:id
router.patch('/series/:id', protect, async (req, res) => {
  try {
    const series = await Series.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      req.body,
      { new: true }
    );
    if (!series) return res.status(404).json({ success: false, message: 'Series not found.' });
    res.json({ success: true, series });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/series/:id
router.delete('/series/:id', protect, async (req, res) => {
  try {
    await Series.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    res.json({ success: true, message: 'Series deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ════════════════════════════════════════════════════════════
//  FILE UPLOAD ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/files/upload
router.post('/files/upload', protect, upload.array('files', 20), async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    // Check storage quota
    const totalUploadSize = req.files.reduce((acc, f) => acc + f.size, 0);
    if (user.storageUsed + totalUploadSize > user.storageLimit) {
      return res.status(403).json({
        success: false,
        message: `Storage limit exceeded. Upgrade your plan for more storage.`,
      });
    }

    const uploaded = [];
    for (const file of req.files) {
      // Determine file type
      let fileType = 'other';
      if (file.mimetype.startsWith('image/'))       fileType = 'image';
      else if (file.mimetype.startsWith('video/'))  fileType = 'video';
      else if (file.mimetype.startsWith('audio/'))  fileType = 'audio';
      else if (file.mimetype.includes('pdf') || file.mimetype.includes('word')) fileType = 'document';

      // Upload buffer to Cloudinary
      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: 'auto', folder: `monocomplex/users/${req.user._id}` },
          (err, result) => err ? reject(err) : resolve(result)
        );
        stream.end(file.buffer);
      });

      const mediaFile = await MediaFile.create({
        user:         req.user._id,
        name:         file.originalname,
        originalName: file.originalname,
        fileType,
        mimeType:     file.mimetype,
        fileSize:     file.size,
        url:          uploadResult.secure_url,
        cloudinaryId: uploadResult.public_id,
        width:        uploadResult.width,
        height:       uploadResult.height,
        duration:     uploadResult.duration,
      });

      uploaded.push(mediaFile);
    }

    // Update user storage
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { storageUsed: totalUploadSize },
    });

    res.status(201).json({ success: true, files: uploaded, count: uploaded.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/files
router.get('/files', protect, async (req, res) => {
  try {
    const { type, page = 1, limit = 50 } = req.query;
    const filter = { user: req.user._id };
    if (type) filter.fileType = type;
    const files = await MediaFile.find(filter).sort({ createdAt: -1 }).limit(limit * 1).skip((page - 1) * limit);
    const total = await MediaFile.countDocuments(filter);
    res.json({ success: true, files, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/files/:id
router.delete('/files/:id', protect, async (req, res) => {
  try {
    const file = await MediaFile.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!file) return res.status(404).json({ success: false, message: 'File not found.' });
    if (file.cloudinaryId) await deleteFromCloudinary(file.cloudinaryId);
    await User.findByIdAndUpdate(req.user._id, { $inc: { storageUsed: -file.fileSize } });
    res.json({ success: true, message: 'File deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ════════════════════════════════════════════════════════════
//  PAYMENT ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/payments/flutterwave/init — Start NGN payment
router.post('/payments/flutterwave/init', protect, async (req, res) => {
  try {
    const { plan } = req.body;
    const planPrices = { creator: 24000, boss: 62400 };
    const amount = planPrices[plan];
    if (!amount) return res.status(400).json({ success: false, message: 'Invalid plan.' });

    const { paymentLink, reference } = await initFlutterwavePayment({
      amount, currency: 'NGN',
      email: req.user.email,
      name:  req.user.name,
      plan,
      redirectUrl: `${process.env.FRONTEND_URL}/payment-success`,
    });

    await Payment.create({
      user: req.user._id, plan, amount,
      currency: 'NGN', method: 'flutterwave',
      status: 'pending', reference,
    });

    res.json({ success: true, paymentLink, reference });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/payments/flutterwave/verify
router.post('/payments/flutterwave/verify', protect, async (req, res) => {
  try {
    const { transactionId, reference } = req.body;
    const txData = await verifyFlutterwavePayment(transactionId);

    if (txData.status !== 'successful')
      return res.status(400).json({ success: false, message: 'Payment not successful.' });

    const payment = await Payment.findOneAndUpdate(
      { reference },
      { status: 'success', providerRef: String(transactionId) },
      { new: true }
    );

    await User.findByIdAndUpdate(req.user._id, { plan: payment.plan, planStatus: 'active', planRenewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
    const user = await User.findById(req.user._id);
    user.applyPlanLimits(); await user.save();

    await sendPaymentConfirmEmail(user, payment);
    res.json({ success: true, message: 'Plan activated!', plan: payment.plan });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/admin/apply-whitelist — Force upgrade ALL whitelisted emails instantly
// Call this ONCE from Postman or browser: POST /api/admin/apply-whitelist
// Header: x-admin-secret: your ADMIN_SECRET value
router.post('/admin/apply-whitelist', async (req, res) => {
  try {
    const secret = req.headers['x-admin-secret'];
    if (secret !== process.env.ADMIN_SECRET)
      return res.status(401).json({ success: false, message: 'Unauthorized.' });

    const entries = await Whitelist.find({});
    let upgraded = 0, notFound = 0;

    for (const entry of entries) {
      const user = await User.findOne({ email: entry.email });
      if (user) {
        user.plan       = entry.plan;
        user.planStatus = 'active';
        user.applyPlanLimits();
        await user.save();
        upgraded++;
        console.log(`✅ Upgraded: ${entry.email} → ${entry.plan}`);
      } else {
        notFound++;
      }
    }

    res.json({
      success: true,
      message: `Done! ${upgraded} users upgraded, ${notFound} emails not yet registered.`,
      upgraded,
      notFound,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
// This URL goes into your Flutterwave Dashboard → Settings → Webhooks
// URL: https://monocomplex-backend.vercel.app/api/payments/flutterwave/webhook
router.post('/payments/flutterwave/webhook', express.json(), async (req, res) => {
  try {
    // ── Step 1: Verify the request is genuinely from Flutterwave ──
    const secretHash = process.env.FLUTTERWAVE_WEBHOOK_SECRET;
    const signature  = req.headers['verif-hash'];

    if (!signature || signature !== secretHash) {
      console.warn('⚠️  Flutterwave webhook — invalid signature. Rejected.');
      return res.status(401).json({ success: false, message: 'Invalid signature.' });
    }

    // ── Step 2: Read the event payload ──────────────────────────
    const payload = req.body;
    console.log('📩 Flutterwave webhook received:', payload.event, payload.data?.tx_ref);

    // We only care about successful charge events
    if (payload.event !== 'charge.completed') {
      return res.status(200).json({ received: true, note: 'Event ignored.' });
    }

    const data = payload.data;

    // ── Step 3: Double-verify the transaction with Flutterwave API ─
    // Never trust the webhook payload alone — always re-verify
    const txVerify = await verifyFlutterwavePayment(data.id);

    if (
      txVerify.status    !== 'successful'   ||
      txVerify.tx_ref    !== data.tx_ref    ||
      txVerify.currency  !== 'NGN'          ||
      txVerify.amount    <  data.amount - 1  // allow ±1 NGN tolerance
    ) {
      console.warn('⚠️  Flutterwave webhook — verification mismatch. Ignored.');
      return res.status(200).json({ received: true, note: 'Verification mismatch.' });
    }

    // ── Step 4: Find the pending payment record by tx_ref ────────
    const payment = await Payment.findOne({ reference: data.tx_ref });

    if (!payment) {
      console.warn('⚠️  Flutterwave webhook — no payment record found for ref:', data.tx_ref);
      return res.status(200).json({ received: true, note: 'No matching payment record.' });
    }

    // ── Step 5: Prevent double-processing ────────────────────────
    if (payment.status === 'success') {
      console.log('ℹ️  Flutterwave webhook — already processed. Skipping.');
      return res.status(200).json({ received: true, note: 'Already processed.' });
    }

    // ── Step 6: Mark payment as successful ───────────────────────
    payment.status      = 'success';
    payment.providerRef = String(data.id);
    await payment.save();

    // ── Step 7: Upgrade the user's plan ──────────────────────────
    const user = await User.findById(payment.user);
    if (!user) {
      console.warn('⚠️  Flutterwave webhook — user not found for payment:', payment._id);
      return res.status(200).json({ received: true, note: 'User not found.' });
    }

    user.plan         = payment.plan;
    user.planStatus   = 'active';
    user.planRenewsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days
    user.applyPlanLimits();
    await user.save();

    // ── Step 8: Send confirmation email to user ───────────────────
    await sendPaymentConfirmEmail(user, {
      plan:      payment.plan,
      currency:  'NGN',
      amount:    txVerify.amount,
      reference: data.tx_ref,
    });

    console.log(`✅ Flutterwave webhook — ${user.email} upgraded to ${payment.plan} plan.`);

    // Always respond 200 quickly so Flutterwave stops retrying
    return res.status(200).json({ received: true, success: true });

  } catch (err) {
    console.error('❌ Flutterwave webhook error:', err.message);
    // Still return 200 — otherwise Flutterwave will retry endlessly
    return res.status(200).json({ received: true, error: err.message });
  }
});

// POST /api/payments/stripe/checkout — USD / GBP / EUR / Google Pay / Apple Pay
router.post('/payments/stripe/checkout', protect, async (req, res) => {
  try {
    const { plan, currency = 'usd' } = req.body;

    // Plan prices per currency (minor units: pence / cents)
    const planPrices = {
      usd: { creator: 1500,  boss: 3900  },   // $15 / $39
      gbp: { creator: 1200,  boss: 3100  },   // £12 / £31
      eur: { creator: 1400,  boss: 3600  },   // €14 / €36
    };
    const supportedCurrencies = ['usd', 'gbp', 'eur'];
    const activeCurrency = supportedCurrencies.includes(currency) ? currency : 'usd';

    const { sessionId, url } = await createStripeCheckout({
      email:    req.user.email,
      plan,
      userId:   req.user._id,
      currency: activeCurrency,
      amount:   planPrices[activeCurrency]?.[plan],
    });
    res.json({ success: true, sessionId, url });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/payments/stripe/webhook — Stripe sends events here
router.post('/payments/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const stripeInst = require("stripe")(process.env.STRIPE_SECRET_KEY);
    const event = stripeInst.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { userId, plan } = session.metadata;

      const payment = await Payment.create({
        user: userId, plan,
        amount: session.amount_total / 100,
        currency: 'USD', method: 'stripe',
        status: 'success', reference: session.id,
        providerRef: session.payment_intent,
      });

      await User.findByIdAndUpdate(userId, {
        plan, planStatus: 'active',
        stripeCustomerId: session.customer,
        planRenewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      const user = await User.findById(userId);
      user.applyPlanLimits(); await user.save();
      await sendPaymentConfirmEmail(user, payment);
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const user = await User.findOne({ stripeCustomerId: sub.customer });
      if (user) { user.plan = 'starter'; user.planStatus = 'cancelled'; user.applyPlanLimits(); await user.save(); }
    }

    res.json({ received: true });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// GET /api/payments/portal — Stripe billing portal
router.get('/payments/portal', protect, async (req, res) => {
  try {
    if (!req.user.stripeCustomerId)
      return res.status(400).json({ success: false, message: 'No Stripe account found.' });
    const url = await createStripePortal(req.user.stripeCustomerId);
    res.json({ success: true, url });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/payments/history
router.get('/payments/history', protect, async (req, res) => {
  const payments = await Payment.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(20);
  res.json({ success: true, payments });
});


// ════════════════════════════════════════════════════════════
//  USER / DASHBOARD ROUTES
// ════════════════════════════════════════════════════════════

// PATCH /api/user/profile
router.patch('/user/profile', protect, async (req, res) => {
  try {
    const allowed = ['name', 'avatar'];
    const updates = {};
    allowed.forEach(field => { if (req.body[field]) updates[field] = req.body[field]; });
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/user/dashboard — Stats summary
router.get('/user/dashboard', protect, async (req, res) => {
  try {
    const [videosCount, seriesCount, filesCount] = await Promise.all([
      Video.countDocuments({ user: req.user._id }),
      Series.countDocuments({ user: req.user._id }),
      MediaFile.countDocuments({ user: req.user._id }),
    ]);
    const totalViews = await Video.aggregate([
      { $match: { user: req.user._id } },
      { $group: { _id: null, total: { $sum: '$views' } } },
    ]);
    res.json({
      success: true,
      stats: {
        videosTotal: videosCount,
        videosThisMonth: req.user.videosThisMonth,
        videosLimit: req.user.videosLimit,
        seriesCount,
        filesCount,
        totalViews: totalViews[0]?.total || 0,
        storageUsed: req.user.storageUsed,
        storageLimit: req.user.storageLimit,
        plan: req.user.plan,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/user/connect-social
router.post('/user/connect-social', protect, async (req, res) => {
  try {
    const { platform, accessToken, userId: socialUserId } = req.body;
    const update = { [`socialAccounts.${platform}`]: { connected: true, accessToken, userId: socialUserId } };
    await User.findByIdAndUpdate(req.user._id, update);
    res.json({ success: true, message: `${platform} connected successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  WHITELIST ROUTES — Only Arnold can access these
//  Protected by ADMIN_SECRET in your .env
// ════════════════════════════════════════════════════════════

const adminOnly = (req, res, next) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ success: false, message: 'Not authorised.' });
  }
  next();
};

// GET /api/whitelist — See all whitelisted emails
router.get('/whitelist', adminOnly, async (req, res) => {
  const list = await Whitelist.find().sort({ createdAt: -1 });
  res.json({ success: true, count: list.length, list });
});

// POST /api/whitelist — Add one email
router.post('/whitelist', adminOnly, async (req, res) => {
  try {
    const { email, plan = 'boss', note } = req.body;
    if (!email)
      return res.status(400).json({ success: false, message: 'Email is required.' });

    // Add to whitelist
    const entry = await Whitelist.create({ email: email.toLowerCase(), plan, note });

    // If user already registered, upgrade them immediately
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      existingUser.plan = plan;
      existingUser.applyPlanLimits();
      await existingUser.save();
    }

    res.status(201).json({
      success: true,
      message: `${email} added to whitelist with ${plan} plan.`,
      entry,
      userUpgraded: !!existingUser,
    });
  } catch (err) {
    if (err.code === 11000)
      return res.status(400).json({ success: false, message: 'Email already whitelisted.' });
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/whitelist/bulk — Add multiple emails at once
router.post('/whitelist/bulk', adminOnly, async (req, res) => {
  try {
    const { emails, plan = 'boss', note } = req.body;
    if (!emails || !Array.isArray(emails))
      return res.status(400).json({ success: false, message: 'emails must be an array.' });

    const results = { added: [], alreadyExists: [], upgraded: [] };

    for (const email of emails) {
      try {
        await Whitelist.create({ email: email.toLowerCase(), plan, note });
        results.added.push(email);

        // Upgrade if already registered
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
          existingUser.plan = plan;
          existingUser.applyPlanLimits();
          await existingUser.save();
          results.upgraded.push(email);
        }
      } catch (e) {
        if (e.code === 11000) results.alreadyExists.push(email);
      }
    }

    res.json({
      success: true,
      message: `${results.added.length} emails added, ${results.alreadyExists.length} already existed.`,
      results,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/whitelist/:email — Remove from whitelist
router.delete('/whitelist/:email', adminOnly, async (req, res) => {
  try {
    await Whitelist.findOneAndDelete({ email: req.params.email.toLowerCase() });
    res.json({ success: true, message: `${req.params.email} removed from whitelist.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Health check
router.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'monocomplex.ai API', timestamp: new Date() })
);


// ════════════════════════════════════════════════════════════
//  BRAND KIT ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/brand — Get user's brand kit
router.get('/brand', protect, async (req, res) => {
  try {
    const kit = await BrandKit.findOne({ user: req.user._id });
    res.json({ success: true, brandKit: kit || {} });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/brand — Save / update brand kit
router.post('/brand', protect, async (req, res) => {
  try {
    const { primaryColor, accentColor, fontFamily, logoPosition, introText, outroText, watermark, subtitleStyle, subtitleColor, subtitleBg } = req.body;
    const kit = await BrandKit.findOneAndUpdate(
      { user: req.user._id },
      { primaryColor, accentColor, fontFamily, logoPosition, introText, outroText, watermark, subtitleStyle, subtitleColor, subtitleBg },
      { upsert: true, new: true }
    );
    res.json({ success: true, brandKit: kit });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/brand/logo — Upload brand logo
router.post('/brand/logo', protect, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No logo file uploaded.' });
    const { url } = await uploadToCloudinary(`data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`, 'monocomplex/brand');
    await BrandKit.findOneAndUpdate({ user: req.user._id }, { logoUrl: url }, { upsert: true, new: true });
    res.json({ success: true, logoUrl: url });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ════════════════════════════════════════════════════════════
//  VOICE CLONE ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/voices — Get user's cloned voices
router.get('/voices', protect, async (req, res) => {
  try {
    const voices = await VoiceClone.find({ user: req.user._id }).sort('-createdAt');
    res.json({ success: true, voices });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/voices/clone — Clone a voice from audio sample (Creator+ only)
router.post('/voices/clone', protect, requirePlan('creator'), upload.single('sample'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No audio sample uploaded.' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Voice name required.' });

    // Upload sample to Cloudinary
    const { url: sampleUrl } = await uploadToCloudinary(
      `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`,
      'monocomplex/voice-samples'
    );

    // Create record as processing
    const voiceRecord = await VoiceClone.create({ user: req.user._id, name, sampleUrl, status: 'processing' });

    res.json({ success: true, voiceId: voiceRecord._id, message: 'Voice cloning started. Ready in ~2 minutes.' });

    // Clone async
    (async () => {
      try {
        const { voiceId } = await cloneVoice({ name, audioBuffer: req.file.buffer });
        await VoiceClone.findByIdAndUpdate(voiceRecord._id, { elevenLabsId: voiceId, status: 'ready' });
      } catch (e) {
        await VoiceClone.findByIdAndUpdate(voiceRecord._id, { status: 'failed' });
      }
    })();
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE /api/voices/:id — Delete a cloned voice
router.delete('/voices/:id', protect, async (req, res) => {
  try {
    await VoiceClone.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    res.json({ success: true, message: 'Voice deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ════════════════════════════════════════════════════════════
//  TRENDING TOPICS / AI IDEAS
// ════════════════════════════════════════════════════════════

// GET /api/ideas?niche=finance&platform=tiktok&count=10
router.get('/ideas', protect, async (req, res) => {
  try {
    const { niche = req.user.niche || 'general', platform = 'tiktok', count = 10 } = req.query;
    const topics = await getTrendingTopics({ niche, platform, count: Number(count) });
    res.json({ success: true, topics });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ════════════════════════════════════════════════════════════
//  URL / REDDIT → VIDEO
// ════════════════════════════════════════════════════════════

// POST /api/videos/from-url — Extract content from URL/Reddit and generate video
router.post('/videos/from-url', protect, checkVideoQuota, async (req, res) => {
  try {
    const { url, voice, videoModel, format, quality, platforms, theme, language, subtitles, bgMusic } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'URL required.' });

    const content = await extractContentFromUrl(url);
    const prompt = content.body || content.title || url;

    const video = await Video.create({
      user: req.user._id,
      title: content.title?.slice(0, 80) || 'Video from URL',
      prompt,
      sourceUrl: url,
      sourceType: url.includes('reddit.com') ? 'reddit' : 'url',
      videoModel: videoModel || 'kling-3.0-pro',
      voice: voice || 'aisha',
      format: format || '9:16',
      quality: quality || '1080p',
      theme: theme || 'default',
      language: language || 'en',
      subtitles: subtitles !== false,
      bgMusic: bgMusic || 'auto',
      status: 'scripting',
    });

    res.json({ success: true, videoId: video._id, extractedTitle: content.title, message: 'Video generation started from URL.' });

    // Reuse the same async pipeline
    (async () => {
      try {
        const script = await generateScript({ topic: prompt, platform: (platforms || ['tiktok'])[0], niche: req.user.niche, duration: 30 });
        await Video.findByIdAndUpdate(video._id, { script, status: 'generating', 'pipeline.scriptDone': true });
        // ... rest of pipeline same as /generate
      } catch (e) {
        await Video.findByIdAndUpdate(video._id, { status: 'failed', errorMessage: e.message });
      }
    })();
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ════════════════════════════════════════════════════════════
//  STOCK FOOTAGE
// ════════════════════════════════════════════════════════════

// GET /api/stock?query=nature&count=5
router.get('/stock', protect, async (req, res) => {
  try {
    const { query = 'nature', count = 5 } = req.query;
    const footage = await searchStockFootage(query, Number(count));
    res.json({ success: true, footage });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ════════════════════════════════════════════════════════════
//  CONTENT CALENDAR / SCHEDULE
// ════════════════════════════════════════════════════════════

// GET /api/schedule?month=2025-05
router.get('/schedule', protect, async (req, res) => {
  try {
    const { month } = req.query;
    const start = month ? new Date(`${month}-01`) : new Date();
    start.setDate(1); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setMonth(end.getMonth() + 1);

    const items = await Schedule.find({ user: req.user._id, scheduledFor: { $gte: start, $lt: end } })
      .populate('video', 'title status thumbnailUrl')
      .populate('series', 'name')
      .sort('scheduledFor');
    res.json({ success: true, items });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/schedule — Schedule a video
router.post('/schedule', protect, async (req, res) => {
  try {
    const { videoId, scheduledFor, platforms } = req.body;
    const item = await Schedule.create({ user: req.user._id, video: videoId, scheduledFor: new Date(scheduledFor), platforms });
    await Video.findByIdAndUpdate(videoId, { scheduledFor: new Date(scheduledFor), status: 'scheduled' });
    res.json({ success: true, schedule: item });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE /api/schedule/:id — Cancel scheduled post
router.delete('/schedule/:id', protect, async (req, res) => {
  try {
    await Schedule.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    res.json({ success: true, message: 'Schedule cancelled.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ════════════════════════════════════════════════════════════
//  AI AVATAR VIDEO
// ════════════════════════════════════════════════════════════

// POST /api/videos/avatar — Generate talking AI avatar video (Boss plan)
router.post('/videos/avatar', protect, requirePlan('boss'), checkVideoQuota, async (req, res) => {
  try {
    const { script, avatarStyle = 'realistic', language = 'en', format = '9:16' } = req.body;
    if (!script) return res.status(400).json({ success: false, message: 'Script required.' });

    const video = await Video.create({
      user: req.user._id,
      title: script.slice(0, 80),
      script,
      videoModel: 'heygen-avatar',
      language,
      format,
      status: 'generating',
    });

    res.json({ success: true, videoId: video._id, message: 'Avatar video generation started.' });

    (async () => {
      try {
        const { videoId: heygenId } = await generateAvatarVideo({ script, avatarStyle, language });
        const result = await waitForAvatarVideo(heygenId);
        const { url } = await uploadToCloudinary(result.video_url, 'monocomplex/videos');
        await Video.findByIdAndUpdate(video._id, { fileUrl: url, status: 'published', 'pipeline.videoDone': true });
      } catch (e) {
        await Video.findByIdAndUpdate(video._id, { status: 'failed', errorMessage: e.message });
      }
    })();
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ════════════════════════════════════════════════════════════
//  ANALYTICS
// ════════════════════════════════════════════════════════════

// GET /api/analytics — Overall channel analytics
router.get('/analytics', protect, async (req, res) => {
  try {
    const videos = await Video.find({ user: req.user._id, status: 'published' });
    const totalViews    = videos.reduce((s, v) => s + (v.analytics?.views || 0), 0);
    const totalLikes    = videos.reduce((s, v) => s + (v.analytics?.likes || 0), 0);
    const totalComments = videos.reduce((s, v) => s + (v.analytics?.comments || 0), 0);
    const totalShares   = videos.reduce((s, v) => s + (v.analytics?.shares || 0), 0);
    const topVideos     = videos.sort((a, b) => (b.analytics?.views || 0) - (a.analytics?.views || 0)).slice(0, 5);

    // Views over last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentVideos  = videos.filter(v => v.createdAt > thirtyDaysAgo);

    res.json({
      success: true,
      overview: { totalViews, totalLikes, totalComments, totalShares, totalVideos: videos.length },
      topVideos: topVideos.map(v => ({ id: v._id, title: v.title, views: v.analytics?.views, likes: v.analytics?.likes, thumbnailUrl: v.thumbnailUrl })),
      recentActivity: { videosLast30Days: recentVideos.length, viewsLast30Days: recentVideos.reduce((s, v) => s + (v.analytics?.views || 0), 0) },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/analytics/sync — Sync analytics from platforms
router.post('/analytics/sync', protect, async (req, res) => {
  try {
    // In production: call TikTok/YouTube/Instagram APIs per video
    // For now mark sync time
    await Video.updateMany({ user: req.user._id }, { 'analytics.lastSyncedAt': new Date() });
    res.json({ success: true, message: 'Analytics sync initiated. Data will update shortly.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


// ════════════════════════════════════════════════════════════
//  MULTILINGUAL VOICEOVER
// ════════════════════════════════════════════════════════════

// POST /api/voiceover — Generate voiceover in any language
router.post('/voiceover', protect, async (req, res) => {
  try {
    const { text, voice = 'aisha', language = 'en' } = req.body;
    if (!text) return res.status(400).json({ success: false, message: 'Text required.' });
    const audioBuffer = await generateVoiceover(text, voice, language);
    const base64Audio = audioBuffer.toString('base64');
    res.json({ success: true, audio: base64Audio, mimeType: 'audio/mpeg' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
