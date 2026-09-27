# 🔒 Private Love Vault — Ultra-Secure Personal Photo & Video Storage

A production-ready, strictly private single-user personal web application built exclusively for **Hari** to store and preserve intimate memories with his girlfriend. Built with a fictional cyberpunk command-center interface for the six security layers, and an elegant, romantic dark glassmorphic dashboard for the private memory vault.

---

## ⚡ Architecture & Technology Stack

* **Frontend Framework:** Next.js 16 (App Router, Turbopack, React 19, TypeScript)
* **Styling & Effects:** Tailwind CSS, custom CSS glow filters, CRT scanlines, glitch keyframes, glassmorphism, reduced-motion compliance
* **Icons & Animation:** Lucide React, Framer Motion, HTML5 Web Audio & Web Speech API
* **Backend:** Next.js Serverless Route Handlers (`app/api/*`) & Edge/Proxy Security Guard (`proxy.ts`)
* **Database:** Supabase PostgreSQL with strict Row-Level Security (RLS) policies
* **Private Storage:** Supabase Storage (Private bucket `vault-media` with short-lived signed upload and download URLs)
* **Authentication:** Six-layer sequential authentication gate with JWT HttpOnly cookies (`jose`), bcrypt password hashing (cost factor 12), and server-enforced lock bitmasks
* **Rate Limiting & Protection:** Server-side rate limiting on IP + session, 3-attempt lockout with automatic session revocation, security event audit logging

---

## 🛡️ Six-Layer Authentication Pipeline

Access requires completing all six verification layers strictly in order on the backend:

1. **Lock 01 — Identity Verification (Face Scan):**
   * Red skull visualizer, active camera feed, moving laser scan line, and biometric presence detection.
2. **Lock 02 — Six-Digit Secret PIN:**
   * Futuristic cyber keypad with glowing dot indicators. Validated against salted bcrypt hash.
3. **Lock 03 — Secret Identity Phrase:**
   * Encrypted cybersecurity terminal with animated cursor. Validated with server-side bcrypt compare.
4. **Lock 04 — Four-Digit Secret Code:**
   * Secondary 4-digit numeric keypad with rotating scanner rings and access-granted transitions.
5. **Lock 05 — Voiceprint Authentication:**
   * Dynamic sound frequency waveform visualizer, randomized challenge phrases, and audio capture.
6. **Lock 06 — Final Biometric Authorization:**
   * Secondary independent camera scan and liveness check. Upon backend confirmation of all 6 layers, triggers glowing green skull animation: `"IDENTITY CONFIRMED — VAULT ACCESS GRANTED"`.

---

## 🎙️ Robotic Cyber Voice System

Integrated browser speech synthesis engine with robotic cadence, deep pitch, and fallback controls:
* Welcome greeting: `"Welcome to our private world, Hari. Initializing six-layer authentication."`
* Failed attempt warnings:
  * `"Are you Hari, really?"`
  * `"Unauthorized identity detected."`
  * `"Verification failed. Access denied."`
  * `"Warning. Invalid credentials."`
* Operations: Uploading, deletion confirmation, download preparation, session termination.
* Safe & Local: Zero biometric or sensitive credential data is ever read aloud or transmitted to external speech APIs.

---

## 💖 Private Memory Vault Dashboard

Once authenticated, the UI transitions to a romantic, luxury aesthetic:
* **Visual Theme:** Deep midnight violet, dark glass panels, subtle pink and purple ambient lighting.
* **Sections:**
  1. *All Memories*
  2. *Photos* (JPG, PNG, WebP, HEIC)
  3. *Videos* (MP4, WebM, MOV with duration tags)
  4. *Favorites* (Quick heart toggling)
  5. *Recently Added* (Last 7 days)
  6. *Vault Settings* (Audit info & manual lock)
* **Features:**
  * Drag-and-drop file upload zone with pre-upload previews and progress indicators
  * Resumable direct-to-cloud signed upload URLs (bypassing Vercel payload limits)
  * Fullscreen high-definition media viewer with zoom, pan, seek controls, and metadata inspection
  * Authenticated short-lived download links (no public storage URLs)
  * Safe two-step permanent deletion modal (cleans storage object and database row)

---

## 🚀 Quick Setup & Deployment

See [`DEPLOYMENT.md`](file:///c:/Users/ASUS/Desktop/nanna/private-love-vault/DEPLOYMENT.md) for full step-by-step instructions.

### 1. Database Setup
Execute [`database/schema.sql`](file:///c:/Users/ASUS/Desktop/nanna/private-love-vault/database/schema.sql) in your Supabase SQL Editor.

### 2. Environment Variables
Copy `.env.example` to `.env.local` and provide your Supabase keys and generated secret tokens:
```bash
cp .env.example .env.local
```

### 3. Run Locally
```bash
npm install
npm run dev
```

### 4. Owner Enrollment
Visit `http://localhost:3000/setup` to configure your credentials with your `VAULT_SETUP_TOKEN`. Once completed, set `SETUP_COMPLETED=true` in `.env.local`.
