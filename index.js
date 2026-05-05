'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const app = express();
 
app.use(cors({ origin: '*', credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','x-admin-secret'] }));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
 
// ── CONNECT DB ───────────────────────────────────────────────
let dbConnected = false;
async function connectDB() {
  if (dbConnected) return;
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    dbConnected = true;
    console.log('✅ MongoDB connected');
  } catch(err) { console.error('DB error:', err.message); }
}
 
// ── USER SCHEMA ──────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name: String, email: { type: String, unique: true, lowercase: true },
  password: { type: String, select: false },
  plan: { type: String, default: 'starter' },
  videosThisMonth: { type: Number, default: 0 },
  videosLimit: { type: Number, default: 10 },
  affiliateCode: String,
}, { timestamps: true });
 
userSchema.methods.comparePassword = async function(pwd) {
  return bcrypt.compare(pwd, this.password);
};
 
const User = mongoose.models.User || mongoose.model('User', userSchema);
 
// ── WHITELIST SCHEMA ─────────────────────────────────────────
const whitelistSchema = new mongoose.Schema({
  email: { type: String, unique: true, lowercase: true },
  plan: { type: String, default: 'boss' },
  note: String,
});
const Whitelist = mongoose.models.Whitelist || mongoose.model('Whitelist', whitelistSchema);
 
// ── SIGN TOKEN ───────────────────────────────────────────────
const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET || 'monocomplex_secret', { expiresIn: '7d' });
 
// ── PROTECT MIDDLEWARE ───────────────────────────────────────
const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Not authenticated.' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'monocomplex_secret');
    req.user = await User.findById(decoded.id);
    if (!req.user) return res.status(401).json({ success: false, message: 'User not found.' });
    next();
  } catch(err) { res.status(401).json({ success: false, message: 'Invalid token.' }); }
};
 
// ── HEALTH ───────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'monocomplex.ai API', version: '1.0.5' }));
app.get('/', (req, res) => res.json({ message: '🎬 monocomplex.ai API is running!', version: '1.0.5' }));
 
// ── REGISTER ─────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  await connectDB();
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Name, email and password are required.' });
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(400).json({ success: false, message: 'Email already registered.' });
    // Check whitelist
    const whitelisted = await Whitelist.findOne({ email: email.toLowerCase() });
    const plan = whitelisted ? whitelisted.plan : 'starter';
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email: email.toLowerCase(), password: hashedPassword, plan, affiliateCode: Math.random().toString(36).slice(2,10).toUpperCase() });
    const token = signToken(user._id);
    res.status(201).json({ success: true, token, user: { id: user._id, name: user.name, email: user.email, plan: user.plan } });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});
 
// ── LOGIN ─────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  await connectDB();
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required.' });
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    const token = signToken(user._id);
    res.json({ success: true, token, user: { id: user._id, name: user.name, email: user.email, plan: user.plan } });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});
 
// ── GET ME ────────────────────────────────────────────────────
app.get('/api/auth/me', protect, (req, res) => {
  res.json({ success: true, user: req.user });
});
 
// ── DASHBOARD STATS ───────────────────────────────────────────
app.get('/api/user/dashboard', protect, async (req, res) => {
  await connectDB();
  res.json({ success: true, stats: { plan: req.user.plan, videosThisMonth: req.user.videosThisMonth, videosLimit: req.user.videosLimit } });
});
 
// ── WHITELIST (Admin only) ────────────────────────────────────
app.post('/api/whitelist', async (req, res) => {
  await connectDB();
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) return res.status(403).json({ success: false, message: 'Not authorised.' });
  try {
    const { email, plan = 'boss', note } = req.body;
    await Whitelist.create({ email: email.toLowerCase(), plan, note });
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) { existing.plan = plan; await existing.save(); }
    res.json({ success: true, message: `${email} whitelisted with ${plan} plan.` });
  } catch(err) {
    if (err.code === 11000) return res.json({ success: true, message: 'Already whitelisted.' });
    res.status(500).json({ success: false, message: err.message });
  }
});
 
// ── FLUTTERWAVE PAYMENT ───────────────────────────────────────
app.post('/api/payments/flutterwave/init', protect, async (req, res) => {
  await connectDB();
  try {
    const axios = require('axios');
    const { plan } = req.body;
    const prices = { creator: 24000, boss: 62400 };
    const amount = prices[plan];
    if (!amount) return res.status(400).json({ success: false, message: 'Invalid plan.' });
    const ref = `MC-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    const resp = await axios.post('https://api.flutterwave.com/v3/payments', {
      tx_ref: ref, amount, currency: 'NGN',
      redirect_url: `${process.env.FRONTEND_URL || 'https://khan-mono.github.io/ARNOLD-MONO'}/payment-success`,
      customer: { email: req.user.email, name: req.user.name },
      customizations: { title: 'monocomplex.ai', description: `${plan} Plan` }
    }, { headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` } });
    res.json({ success: true, paymentLink: resp.data.data.link, reference: ref });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});
 
// ── SCRIPT GENERATION (Nano Banana Pro) ──────────────────────
app.post('/api/videos/script', protect, async (req, res) => {
  try {
    const axios = require('axios');
    const { topic, platform, duration = 30 } = req.body;
    const resp = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514', max_tokens: 800,
      system: 'You are Nano Banana Pro, monocomplex.ai script AI. Write viral short-form scripts. Return ONLY the script text.',
      messages: [{ role: 'user', content: `Write a ${duration}-second ${platform || 'tiktok'} script about: "${topic}". Strong hook, fast-paced, clear CTA.` }]
    }, { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } });
    res.json({ success: true, script: resp.data.content[0].text });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});
 
// ── FORGOT PASSWORD ───────────────────────────────────────────
app.post('/api/auth/forgot-password', async (req, res) => {
  await connectDB();
  try {
    const user = await User.findOne({ email: req.body.email?.toLowerCase() });
    if (!user) return res.status(404).json({ success: false, message: 'No account with that email.' });
    res.json({ success: true, message: 'If this email exists, a reset link has been sent.' });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});

// Admin — force upgrade all whitelisted users
app.post('/api/admin/apply-whitelist', async (req, res) => {
  try {
    await connectDB();
    const secret = req.headers['x-admin-secret'];
    if (secret !== process.env.ADMIN_SECRET)
      return res.status(401).json({ success: false, message: 'Unauthorized.' });
   const Whitelist = mongoose.model('Whitelist');
const UserModel = mongoose.model('User');
   // Seed whitelist if empty
const existing = await Whitelist.countDocuments({});
if (existing === 0) {
  await Whitelist.insertMany([
    { email: 'arnoldmono43@gmail.com', plan: 'boss' },
    { email: 'springline56@gmail.com', plan: 'boss' },
    { email: 'summerline056@gmail.com', plan: 'boss' },
    { email: 'autumline56@gmail.com', plan: 'boss' },
    { email: 'kimberlyisiki@gmail.com', plan: 'boss' },
    { email: 'winterline56@gmail.com', plan: 'boss' },
    { email: 'kimb3rlymono@gmail.com', plan: 'boss' },
    { email: 'monocomplex75@gmail.com', plan: 'boss' },
  ]);
}
    const entries = await Whitelist.find({});
    let upgraded = 0, notFound = 0;
    for (const entry of entries) {
      const user = await UserModel.findOne({ email: entry.email });
      if (user) {
        user.plan = entry.plan;
        user.planStatus = 'active';
        await user.save();
        upgraded++;
      } else { notFound++; }
    }
    res.json({ success: true, message: `Done! ${upgraded} users upgraded, ${notFound} not registered yet.`, upgraded, notFound });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
 });

app.use((err, req, res, next) => res.status(500).json({ success: false, message: err.message }));
 
module.exports = app;
 
