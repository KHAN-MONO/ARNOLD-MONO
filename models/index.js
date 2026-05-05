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

  // Niche & preferences
  niche:         { type: String, default: 'general' },
  timezone:      { type: String, default: 'UTC' },
  language:      { type: String, default: 'en' },
  defaultVoice:  { type: String, default: 'aisha' },
  defaultModel:  { type: String, default: 'kling-3.0-pro' },
  defaultTheme:  { type: String, default: 'default' },

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
  sourceUrl:  { type: String },   // Reddit URL / article URL → video
  sourceType: { type: String, enum: ['prompt', 'url', 'reddit', 'script'], default: 'prompt' },

  // Theme / Style
  theme:      { type: String, default: 'default' }, // anime, neon, horror, cinematic, minimal, etc.
  language:   { type: String, default: 'en' },      // multilingual
  subtitles:  { type: Boolean, default: true },
  subtitleStyle: { type: String, default: 'animated' }, // animated | static | none
  bgMusic:    { type: String, default: 'auto' },    // auto | upbeat | calm | dramatic | none

  // Stock footage
  stockSource:  { type: String, default: 'auto' },  // auto | pexels | pixabay | custom

  // AI Models used
  videoModel: { type: String, default: 'kling-3.0-pro' },
  voice:      { type: String, default: 'aisha' },
  voiceCloned: { type: Boolean, default: false },   // was voice-cloned?
  editingAI:  { type: String, default: 'nano-banana-pro' },

  // Output
  format:     { type: String, enum: ['9:16', '16:9', '1:1'], default: '9:16' },
  quality:    { type: String, enum: ['720p', '1080p', '4k'], default: '1080p' },
  duration:   { type: Number },
  fileUrl:    { type: String },
  thumbnailUrl: { type: String },
  fileSize:   { type: Number },

  // Status
  status: {
    type: String,
    enum: ['queued', 'scripting', 'generating', 'editing', 'publishing', 'published', 'scheduled', 'failed'],
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

  // Analytics (synced from platforms)
  analytics: {
    views:       { type: Number, default: 0 },
    likes:       { type: Number, default: 0 },
    comments:    { type: Number, default: 0 },
    shares:      { type: Number, default: 0 },
    reach:       { type: Number, default: 0 },
    watchTime:   { type: Number, default: 0 }, // seconds
    lastSyncedAt:{ type: Date },
  },

  // Attached user uploads
  attachedFiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MediaFile' }],

}, { timestamps: true });


// ── SERIES MODEL ─────────────────────────────────────────────
const seriesSchema = new mongoose.Schema({
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:       { type: String, required: true },
  niche:      { type: String },
  description:{ type: String },
  theme:      { type: String, default: 'default' }, // video style theme

  voice:      { type: String, default: 'aisha' },
  voiceCloned: { type: Boolean, default: false },
  language:   { type: String, default: 'en' },
  videoModel: { type: String, default: 'kling-3.0-pro' },
  editingAI:  { type: String, default: 'nano-banana-pro' },
  format:     { type: String, default: '9:16' },
  quality:    { type: String, default: '1080p' },
  bgMusic:    { type: String, default: 'auto' },
  subtitles:  { type: Boolean, default: true },

  frequency:  { type: String, enum: ['twice-daily', 'daily', '3x-week', 'weekly'], default: 'daily' },
  postTimes:  [{ type: String }], // e.g. ['09:00', '18:00']
  timezone:   { type: String, default: 'UTC' },
  platforms:  [{ type: String, enum: ['tiktok', 'youtube', 'instagram', 'facebook'] }],

  sourceType: { type: String, enum: ['prompt', 'url', 'reddit', 'trending'], default: 'prompt' },
  sourceUrls: [{ type: String }], // Reddit subreddits or article URLs

  status:     { type: String, enum: ['active', 'paused', 'draft'], default: 'draft' },
  nextPostAt: { type: Date },

  videosPublished: { type: Number, default: 0 },
  totalViews:      { type: Number, default: 0 },

}, { timestamps: true });


// ── BRAND KIT MODEL ──────────────────────────────────────────
const brandKitSchema = new mongoose.Schema({
  user:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  logoUrl:      { type: String },       // Cloudinary URL
  logoPosition: { type: String, enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], default: 'bottom-right' },
  primaryColor: { type: String, default: '#00aaff' },
  accentColor:  { type: String, default: '#ffffff' },
  fontFamily:   { type: String, default: 'Syne' },
  introText:    { type: String },       // custom intro title card text
  outroText:    { type: String },       // custom outro / CTA
  watermark:    { type: Boolean, default: true },
  subtitleStyle:{ type: String, default: 'animated' },
  subtitleColor:{ type: String, default: '#ffffff' },
  subtitleBg:   { type: String, default: '#000000' },
}, { timestamps: true });


// ── VOICE CLONE MODEL ────────────────────────────────────────
const voiceCloneSchema = new mongoose.Schema({
  user:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:         { type: String, required: true },          // e.g. "My Voice"
  elevenLabsId: { type: String },                          // ElevenLabs voice ID after cloning
  sampleUrl:    { type: String },                          // Cloudinary URL of original sample
  status:       { type: String, enum: ['processing', 'ready', 'failed'], default: 'processing' },
  isDefault:    { type: Boolean, default: false },
}, { timestamps: true });


// ── CONTENT SCHEDULE MODEL ───────────────────────────────────
const scheduleSchema = new mongoose.Schema({
  user:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  video:        { type: mongoose.Schema.Types.ObjectId, ref: 'Video' },
  series:       { type: mongoose.Schema.Types.ObjectId, ref: 'Series' },
  scheduledFor: { type: Date, required: true },
  platforms:    [{ type: String }],
  status:       { type: String, enum: ['pending', 'published', 'failed', 'cancelled'], default: 'pending' },
  publishedAt:  { type: Date },
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
  User:       mongoose.model('User', userSchema),
  Video:      mongoose.model('Video', videoSchema),
  Series:     mongoose.model('Series', seriesSchema),
  MediaFile:  mongoose.model('MediaFile', mediaFileSchema),
  Payment:    mongoose.model('Payment', paymentSchema),
  Whitelist:  mongoose.model('Whitelist', whitelistSchema),
  BrandKit:   mongoose.model('BrandKit', brandKitSchema),
  VoiceClone: mongoose.model('VoiceClone', voiceCloneSchema),
  Schedule:   mongoose.model('Schedule', scheduleSchema),
};
