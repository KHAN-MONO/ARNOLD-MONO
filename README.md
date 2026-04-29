[README.md](https://github.com/user-attachments/files/27216625/README.md)
# 🎬 monocomplex.ai — Backend Setup Guide

## Stack
- **Server**: Node.js + Express
- **Database**: MongoDB Atlas (free)
- **File Storage**: Cloudinary (free tier)
- **Video AI**: Kling 3.0
- **Voice AI**: ElevenLabs
- **Editing AI**: Nano Banana Pro (powered by Claude API)
- **Payments NGN**: Flutterwave
- **Payments USD**: Stripe (Google Pay + Apple Pay)
- **Hosting**: Vercel (free)

---

## STEP 1 — Get Your API Keys (do this first)

### MongoDB Atlas (Database) — FREE
1. Go to https://cloud.mongodb.com
2. Sign up → Create free cluster (M0)
3. Click **Connect** → **Drivers** → copy the connection string
4. Replace `<password>` with your DB password
5. Paste into `MONGODB_URI` in your `.env`

### Cloudinary (File Storage) — FREE
1. Go to https://cloudinary.com → Sign up free
2. Dashboard → copy **Cloud name**, **API Key**, **API Secret**
3. Paste into `CLOUDINARY_*` in your `.env`

### Flutterwave (NGN Payments) — FREE to set up
1. Go to https://dashboard.flutterwave.com
2. Sign up with your Nigerian details
3. Settings → API Keys → copy Public + Secret keys
4. Paste into `FLUTTERWAVE_*` in your `.env`

### Stripe (USD + Google Pay + Apple Pay) — FREE to set up
1. Go to https://dashboard.stripe.com → Sign up
2. Developers → API Keys → copy keys
3. Paste into `STRIPE_*` in your `.env`
4. Enable Google Pay + Apple Pay in Stripe Dashboard → Settings → Payment Methods

### Kling 3.0 (Video Generation)
1. Go to https://platform.klingai.com
2. Sign up → API Access → copy your API key
3. Paste into `KLING_API_KEY` in your `.env`

### ElevenLabs (Voiceovers) — has free tier
1. Go to https://elevenlabs.io → Sign up
2. Profile → API Key → copy it
3. Paste into `ELEVENLABS_API_KEY` in your `.env`

### Anthropic Claude (Nano Banana Pro AI Editing)
1. Go to https://console.anthropic.com
2. API Keys → Create new key
3. Paste into `ANTHROPIC_API_KEY` in your `.env`

### Gmail App Password (Email)
1. Go to https://myaccount.google.com/apppasswords
2. Generate an app password for arnoldmono43@gmail.com
3. Paste into `EMAIL_PASS` in your `.env`

---

## STEP 2 — Local Development

```bash
# 1. Clone/download this project folder

# 2. Install dependencies
npm install

# 3. Create your .env file
cp .env.example .env
# Then fill in all your API keys in .env

# 4. Start the dev server
npm run dev

# Server runs at: http://localhost:5000
# Test it: http://localhost:5000/api/health
```

---

## STEP 3 — Deploy to Vercel (FREE hosting)

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Login to Vercel
vercel login

# 3. Deploy
vercel

# 4. Add environment variables on Vercel:
#    Go to vercel.com → Your project → Settings → Environment Variables
#    Add every key from your .env file

# 5. Your API will be live at:
#    https://monocomplex-api.vercel.app
```

---

## STEP 4 — Connect Frontend to Backend

In your `monocomplex_full.html`, update the API base URL:

```javascript
const API = 'https://monocomplex-api.vercel.app/api';

// Example: Login
const res = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
const data = await res.json();
// data.token — save this to localStorage
```

---

## API Endpoints Reference

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Get current user |
| POST | `/api/auth/forgot-password` | Send reset email |
| POST | `/api/auth/reset-password/:token` | Reset password |

### Videos
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/videos/generate` | Generate video (Kling 3.0 + NBP) |
| GET | `/api/videos` | List user videos |
| GET | `/api/videos/:id` | Get video + status |
| DELETE | `/api/videos/:id` | Delete video |
| POST | `/api/videos/script` | Generate script only |

### Series
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/series` | List all series |
| POST | `/api/series` | Create series |
| PATCH | `/api/series/:id` | Update series |
| DELETE | `/api/series/:id` | Delete series |

### Files
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/files/upload` | Upload files (images/video/audio/docs) |
| GET | `/api/files` | List user files |
| DELETE | `/api/files/:id` | Delete file |

### Payments
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/payments/flutterwave/init` | Start NGN payment |
| POST | `/api/payments/flutterwave/verify` | Verify NGN payment |
| POST | `/api/payments/stripe/checkout` | Start USD payment |
| POST | `/api/payments/stripe/webhook` | Stripe webhook |
| GET | `/api/payments/portal` | Stripe billing portal |
| GET | `/api/payments/history` | Payment history |

### User
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/user/dashboard` | Dashboard stats |
| PATCH | `/api/user/profile` | Update profile |
| POST | `/api/user/connect-social` | Connect TikTok/YouTube/Instagram |

---

## Estimated Monthly Costs (at scale)

| Service | Free Tier | Paid (when you grow) |
|---------|-----------|---------------------|
| Vercel | Free | $20/mo |
| MongoDB Atlas | Free (512MB) | $9/mo |
| Cloudinary | Free (25GB) | $89/mo |
| Kling 3.0 | Pay per video | ~$0.10–$0.50/video |
| ElevenLabs | 10K chars/mo | $5/mo |
| Anthropic (NBP) | Pay per call | ~$0.003/script |
| Flutterwave | Free | 1.4% per transaction |
| Stripe | Free | 2.9% + $0.30 per transaction |

---

## Support
Email: arnoldmono43@gmail.com
