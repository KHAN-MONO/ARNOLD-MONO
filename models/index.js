// ============================================================
//  models/index.js — All MongoDB Schemas for monocomplex.ai
// ============================================================
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ── WHITELIST MODEL ──────────────────────────────────────────
// Any email added here gets free Boss plan access automatically
const whitelistSchema = new mongoose.Schema({
  email:     { type: String, required: true, unique: true, lowercase: true },
  addedBy:   { type: String, default: 'Arnold Mono' },
  plan:      { type: String, enum: ['starter', 'creator', 'boss'], default: 'boss' },
  note:      { type: String }, // e.g. "friend", "team member", "beta tester"
}, { timestamps: true });


const userSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  email:         { type: String, required: true, unique: true, lowercase: true },
  password:      { type: String, required: true, minlength: 6, select: false },
  avatar:        { type: String, default: '' },

  // Plan: starter | creator | boss
  plan:          { type: String, enum: ['starter', 'creator', 'boss'], default: 'starter' },
  planStatus:    { type: String, enum: ['active', 'cancelled', 'past_due'], default: 'active' },
  planRenewsAt:  { type: Date },
  stripeCustomerId:     { type: String },
  flutterwaveCustomerId:{ type: String },

  // Usage tracking
  videosThisMonth: { type: Number, default: 0 },
  videosLimit:     { type: Number, default: 10 },   // 10 starter / 60 creator / unlimited boss
  storageUsed:     { type: Number, default: 0 },    // bytes
  storageLimit:    { type: Number, default: 52428800 }, // 50MB starter default

  // Connected social accounts
  socialAccounts: {
    tiktok:    { connected: Boolean, accessToken: String, userId: String },
    youtube:   { connected: Boolean, accessToken: String, channelId: String },
    instagram: { connected: Boolean, accessToken: String, userId: String },
  },

  // Affiliate
  affiliateCode:     { type: String, unique: true, sparse: true },
  affiliateEarnings: { type: Number, default: 0 },
  referredBy:        { type: String },

  isVerified:    { type: Boolean, default: false },
  verifyToken:   { type: String },
  resetToken:    { type: String },
  resetExpires:  { type: Date },

}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Set limits based on plan
userSchema.methods.applyPlanLimits = function() {
  const limits = {
    starter: { videos: 10,         storage: 52428800    }, // 50MB
    creator: { videos: 60,         storage: 524288000   }, // 500MB
    boss:    { videos: 999999,     storage: 10737418240 }, // 10GB
  };
  const l = limits[this.plan] || limits.starter;
  this.videosLimit  = l.videos;
  this.storageLimit = l.storage;
};


// ── VIDEO MODEL ──────────────────────────────────────────────
const videoSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  series:     { type: mongoose.Schema.Types.ObjectId, ref: 'Series' },

  title:      { type: String, required: true },
  prompt:     { type: String },
  script:     { type: String },

  // AI Models used
  videoModel: { type: String, default: 'kling-3.0-pro' },
  voice:      { type: String, default: 'aisha' },
  editingAI:  { type: String, default: 'nano-banana-pro' }, // NBP editing engine

  // Output
  format:     { type: String, enum: ['9:16', '16:9', '1:1'], default: '9:16' },
  quality:    { type: String, enum: ['720p', '1080p', '4k'], default: '1080p' },
  duration:   { type: Number },  // seconds
  fileUrl:    { type: String },  // Cloudinary URL
  thumbnailUrl: { type: String },
  fileSize:   { type: Number },

  // Status
  status: {
    type: String,
    enum: ['queued', 'scripting', 'generating', 'editing', 'publishing', 'published', 'failed'],
    default: 'queued'
  },
  errorMessage: { type: String },

  // Generation pipeline tracking
  pipeline: {
    scriptDone:    { type: Boolean, default: false },
    videoDone:     { type: Boolean, default: false },
    voiceDone:     { type: Boolean, default: false },
    editingDone:   { type: Boolean, default: false },
    captionsDone:  { type: Boolean, default: false },
    publishDone:   { type: Boolean, default: false },
  },

  // Publishing
  publishedTo: [{
    platform:  { type: String, enum: ['tiktok', 'youtube', 'instagram', 'facebook'] },
    postId:    { type: String },
    postUrl:   { type: String },
    publishedAt: { type: Date },
  }],
  scheduledFor: { type: Date },

  // Analytics
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },

  // Attached user uploads
  attachedFiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MediaFile' }],

}, { timestamps: true });


// ── SERIES MODEL ─────────────────────────────────────────────
const seriesSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:       { type: String, required: true },
  niche:      { type: String },
  description:{ type: String },

  voice:      { type: String, default: 'aisha' },
  videoModel: { type: String, default: 'kling-3.0-pro' },
  editingAI:  { type: String, default: 'nano-banana-pro' },
  format:     { type: String, default: '9:16' },
  quality:    { type: String, default: '1080p' },

  frequency:  { type: String, enum: ['daily', 'twice-daily', '3x-week', 'weekly'], default: 'daily' },
  platforms:  [{ type: String, enum: ['tiktok', 'youtube', 'instagram', 'facebook'] }],

  status:     { type: String, enum: ['active', 'paused', 'draft'], default: 'draft' },
  nextPostAt: { type: Date },

  videosPublished: { type: Number, default: 0 },
  totalViews:      { type: Number, default: 0 },

}, { timestamps: true });


// ── MEDIA FILE MODEL ─────────────────────────────────────────
const mediaFileSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:        { type: String, required: true },
  originalName:{ type: String },
  fileType:    { type: String, enum: ['image', 'video', 'audio', 'document', 'other'] },
  mimeType:    { type: String },
  fileSize:    { type: Number },   // bytes
  url:         { type: String, required: true },  // Cloudinary URL
  cloudinaryId:{ type: String },
  thumbnailUrl:{ type: String },
  duration:    { type: Number },   // for video/audio
  width:       { type: Number },   // for images/video
  height:      { type: Number },

}, { timestamps: true });


// ── PAYMENT MODEL ────────────────────────────────────────────
const paymentSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan:        { type: String, enum: ['starter', 'creator', 'boss'] },
  amount:      { type: Number, required: true },
  currency:    { type: String, enum: ['USD', 'NGN'], default: 'USD' },
  method:      { type: String, enum: ['stripe', 'flutterwave', 'bank_transfer', 'google_pay', 'apple_pay'] },
  status:      { type: String, enum: ['pending', 'success', 'failed', 'refunded'], default: 'pending' },
  reference:   { type: String, unique: true },
  providerRef: { type: String },
  metadata:    { type: Object },
}, { timestamps: true });


module.exports = {
  User:      mongoose.model('User', userSchema),
  Video:     mongoose.model('Video', videoSchema),
  Series:    mongoose.model('Series', seriesSchema),
  MediaFile: mongoose.model('MediaFile', mediaFileSchema),
  Payment:   mongoose.model('Payment', paymentSchema),
  Whitelist: mongoose.model('Whitelist', whitelistSchema),
};
