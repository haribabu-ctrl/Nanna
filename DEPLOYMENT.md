# Private Love Vault — Complete Deployment Guide

## Architecture Overview

```
Browser → Vercel (Next.js 16 SSR) → Supabase (PostgreSQL + Private Storage)
```

- **Frontend + Backend:** Vercel (Next.js App Router + Serverless API Routes)
- **Database:** Supabase PostgreSQL (with Row-Level Security)
- **Private File Storage:** Supabase Storage (private bucket, signed URLs only)
- **Sessions:** HttpOnly JWT cookie (jose, HS256)
- **Auth Credentials:** bcrypt cost-12 hashes stored in DB

---

## Step 1 — Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com) and create a free account
2. Click **New Project**, name it `private-love-vault`
3. Choose a region close to you and set a strong DB password
4. Wait for the project to provision (~2 min)

### Run the Database Schema

1. In your Supabase dashboard, go to **SQL Editor**
2. Open the file `database/schema.sql` from this project
3. Copy the entire contents and paste into the SQL Editor
4. Click **Run** — all tables, indexes, triggers, and RLS policies will be created

### Copy Your Supabase Keys

Go to **Project Settings → API** and copy:
- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon / public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**keep this secret!**)

---

## Step 2 — Generate Secrets

Run these commands to generate strong secrets:

```powershell
# Session secret (64 hex chars = 32 bytes)
[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))

# Setup token (you'll use this once to enroll)
[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

---

## Step 3 — Create Your .env.local

Copy `.env.example` to `.env.local` and fill in all values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

VAULT_SESSION_SECRET=your_64_char_random_secret
VAULT_SESSION_COOKIE=plv_session
SESSION_MAX_AGE=86400

VAULT_SETUP_TOKEN=your_setup_token_here

SETUP_COMPLETED=false
STORAGE_BUCKET=vault-media
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Step 4 — Run Locally

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Step 5 — First-Time Setup (Owner Enrollment)

> Do this ONCE before using the vault.

1. Navigate to `http://localhost:3000/setup`
2. **Step 1 — Setup Token:** Enter the value you set for `VAULT_SETUP_TOKEN`
3. **Step 2 — Credentials:** Configure:
   - 6-digit PIN (e.g., `123456` — use something only you know!)
   - Secret identity phrase (any phrase, min 4 chars)
   - 4-digit secret code (e.g., `7890`)
   - Recovery key (long random string — **save this somewhere safe!**)
4. **Step 3 — Review:** Confirm and click `INITIALIZE VAULT`
5. After success, **update your environment** — set `SETUP_COMPLETED=true`

---

## Step 6 — Deploy to Vercel

### Push to GitHub first

```powershell
git init  # already initialized by create-next-app
git add .
git commit -m "Initial Private Love Vault"
# Create a repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/private-love-vault.git
git push -u origin main
```

> ⚠️ **NEVER** commit `.env.local`. It's in `.gitignore` already.

### Deploy on Vercel

1. Go to [https://vercel.com](https://vercel.com) → **New Project**
2. Import your GitHub repo
3. Go to **Environment Variables** and add ALL variables from your `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `VAULT_SESSION_SECRET`
   - `VAULT_SESSION_COOKIE`
   - `SESSION_MAX_AGE`
   - `VAULT_SETUP_TOKEN`
   - `SETUP_COMPLETED=false` *(change to `true` after setup)*
   - `STORAGE_BUCKET=vault-media`
   - `NEXT_PUBLIC_APP_URL=https://your-vercel-domain.vercel.app`
4. Click **Deploy**

---

## Step 6B — Deploy to Render (Recommended Web Service)

### Method A: Using Render Blueprints (`render.yaml` - Automatic)
1. Go to [https://dashboard.render.com](https://dashboard.render.com)
2. Click **New +** → **Blueprint**
3. Connect your GitHub repository: `https://github.com/haribabu-ctrl/Nanna.git`
4. Render will automatically detect `render.yaml` at the root!
5. Fill in the requested sync variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VAULT_SETUP_TOKEN`, `NEXT_PUBLIC_APP_URL`)
6. Click **Apply**

### Method B: Manual Web Service Creation
1. Go to **New +** → **Web Service**
2. Connect your GitHub repo (`haribabu-ctrl/Nanna`)
3. Configure the exact settings:
   - **Name:** `private-love-vault`
   - **Region:** `Oregon (US West)` or closest to you
   - **Branch:** `main`
   - **Root Directory:** *(leave blank / default root)*
   - **Runtime:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/api/setup`
4. Under **Environment Variables**, add:
   - `NODE_ENV` = `production`
   - `PORT` = `10000` *(Render sets this automatically)*
   - `NEXT_PUBLIC_APP_URL` = `https://your-service-name.onrender.com`
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://your-project.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `your_anon_key`
   - `SUPABASE_SERVICE_ROLE_KEY` = `your_service_role_key`
   - `VAULT_SESSION_SECRET` = *(Generate with `[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))`)*
   - `VAULT_SESSION_COOKIE` = `plv_session`
   - `SESSION_MAX_AGE` = `86400`
   - `VAULT_SETUP_TOKEN` = `your_secure_master_setup_token`
   - `SETUP_COMPLETED` = `false` *(set to `true` after setup)*
   - `STORAGE_BUCKET` = `vault-media`
5. Click **Create Web Service**

---

## Step 7 — Test the Complete Flow

### Authentication Flow Test

| Step | What to test |
|------|-------------|
| Welcome | Visit `/` — skull animation, voice plays, INITIALIZE VAULT button |
| Lock 1 | Camera permission request, scanning animation, bypass token passes |
| Lock 2 | Enter your 6-digit PIN — correct passes, wrong fails |
| Lock 3 | Enter your secret phrase — correct passes, wrong fails |
| Lock 4 | Enter your 4-digit code — correct passes, wrong fails |
| Lock 5 | Microphone permission, voice recording, bypass token passes |
| Lock 6 | Final camera scan, green access-granted screen on success |
| Vault | Dashboard loads with purple/pink theme |

### Three-Failure Test

1. Go through auth, enter a wrong PIN 3 times
2. Session should be revoked, redirect to welcome screen
3. Verify the DB session is marked `is_revoked = true` in Supabase

### Upload/View/Delete Test

1. Upload a photo (drag and drop)
2. Verify it appears in the grid
3. Click it — full-screen viewer opens
4. Click download — short-lived URL downloads the original
5. Delete it — confirm it disappears and is gone from Supabase Storage

### Session Persistence Test

1. Log in through all 6 locks
2. Close the browser
3. Reopen — you should still be in the vault (session cookie persists)
4. After 24 hours, session expires and you must authenticate again

---

## Biometric Integration Guide

### Face Verification (Locks 01 & 06)

The current build uses **camera presence verification** (fallback mode).
To enable real face biometrics, integrate one of these providers:

#### Option A: Face++ (Recommended for simplicity)
1. Sign up at [https://www.faceplusplus.com](https://www.faceplusplus.com)
2. Create a FaceSet, enroll your face
3. In your browser code, call the Face++ Detect API
4. On success, call Face++ Search API against your FaceSet
5. Pass the `face_token` to `/api/auth/verify?lock=1`
6. In the server, call Face++ Server API to verify the token

#### Option B: Azure Face API
1. Create an Azure resource for Face API
2. Use the Face SDK to detect and verify
3. Pass the verification result token to your backend

**To switch from bypass to real verification:**
In `Lock01Face.tsx` and `Lock06FaceFinal.tsx`, replace:
```js
body: JSON.stringify({ faceToken: 'FACE_BYPASS_DEV' })
```
with the actual provider token.

In `app/api/auth/verify/route.ts`, replace the bypass check:
```js
const faceVerified = parsed.data.faceToken === 'FACE_VERIFIED_BY_PROVIDER'
```
with a real call to your biometric provider's server API.

### Voice Verification (Lock 05)

Currently uses **microphone presence verification** (fallback mode).

#### Azure Speaker Recognition
1. Create Azure Speech resource
2. Enroll voice profile: `POST /text-independent/profiles/{profileId}/enrollments`
3. During verification: `POST /text-independent/profiles/{profileId}/verify`
4. Pass the verification token to `/api/auth/verify?lock=5`

---

## Security Notes

- All six credentials are stored as **bcrypt cost-12 hashes** — never plaintext
- Signed media URLs expire in **2 minutes** (view) / **5 minutes** (download)
- Sessions expire after **24 hours**; revoked immediately on logout
- Three failed attempts per auth session permanently revokes the session
- All DB operations use the **service role key** server-side only
- The anon key is safe to expose — RLS denies all access to anon/authenticated roles
- HTTPS is enforced by Vercel in production
- Cookies are `HttpOnly`, `SameSite=Strict`, `Secure` in production

---

## Limitations & Honest Disclosure

- Face biometrics in current build = camera presence check (not identity verification)
- Voice biometrics in current build = microphone presence check (not voiceprint matching)
- **Screenshots and screen recording cannot be prevented** by any web application
- External cameras (photographing the screen) cannot be detected
- The application does not claim to be "impossible to hack" — no system is
- Security depends on keeping your Supabase service role key secret and never committing `.env.local`
