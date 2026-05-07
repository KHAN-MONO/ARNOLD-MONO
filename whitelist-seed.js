// ============================================================
//  whitelist-seed.js — Arnold's Pre-approved Free Users
//  Run this ONCE after deploying: node whitelist-seed.js
// ============================================================
require('dotenv').config();
const mongoose = require('mongoose');
const { Whitelist, User } = require('./models');

const WHITELISTED_EMAILS = [
  { email: 'arnoldmono43@gmail.com',  plan: 'boss', note: 'Founder - Arnold Mono' },
  { email: 'springline56@gmail.com',  plan: 'boss', note: 'Free user added by Arnold' },
  { email: 'summerline056@gmail.com', plan: 'boss', note: 'Free user added by Arnold' },
  { email: 'autumnline56@gmail.com',   plan: 'boss', note: 'Free user added by Arnold' },
  { email: 'kimberlyisiki@gmail.com', plan: 'boss', note: 'Free user added by Arnold' },
  { email: 'winterline56@gmail.com',  plan: 'boss', note: 'Free user added by Arnold' },
  { email: 'kimb3rlymono@gmail.com', plan: 'boss', note: 'Free user added by Arnold' },
  { email: 'monocomplex75@gmail.com', plan: 'boss', note: 'Free user added by Arnold' },
  { email: 'dc24718@gmail.com', plan: 'boss', note: 'Free user added by Arnold' }
];

async function seedWhitelist() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    let added = 0, skipped = 0, upgraded = 0;

    for (const entry of WHITELISTED_EMAILS) {
      try {
        await Whitelist.create(entry);
        console.log(`✅ Added: ${entry.email} → ${entry.plan} plan`);
        added++;

        // If user already exists, upgrade them immediately
        const existingUser = await User.findOne({ email: entry.email });
        if (existingUser) {
          existingUser.plan = entry.plan;
          existingUser.applyPlanLimits();
          await existingUser.save();
          console.log(`   ↑ Existing user upgraded to ${entry.plan}`);
          upgraded++;
        }
      } catch (e) {
        if (e.code === 11000) {
          console.log(`⏭️  Already exists: ${entry.email}`);
          skipped++;
        } else {
          console.error(`❌ Error adding ${entry.email}:`, e.message);
        }
      }
    }

    console.log(`
╔══════════════════════════════════════════╗
║  Whitelist Seed Complete                 ║
║  Added:    ${String(added).padEnd(30)}║
║  Skipped:  ${String(skipped).padEnd(30)}║
║  Upgraded: ${String(upgraded).padEnd(30)}║
╚══════════════════════════════════════════╝
    `);

    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  }
}

seedWhitelist();
