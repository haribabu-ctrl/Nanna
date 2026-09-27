'use client'

import { useState, useRef, useEffect } from 'react'
import { AnimatedSkull, ScanLines, ParticleBackground, HackerSpinner, Waveform } from '@/components/ui/hacker-ui'
import { ENROLLMENT_PHRASES, extractAcousticSpectrum } from '@/lib/biometrics/voice'
import CameraFaceScanner, { CameraFaceScannerRef, ScanResult } from '@/components/camera/CameraFaceScanner'

type SetupStep = 'token' | 'credentials' | 'biometrics' | 'review' | 'done'

export default function SetupPage() {
  const [step, setStep] = useState<SetupStep>('token')
  const [form, setForm] = useState({
    setupToken: '',
    pin: '',
    secretName: '',
    code: '',
    recoveryKey: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [tokenVerified, setTokenVerified] = useState(false)
  const [verifyingToken, setVerifyingToken] = useState(false)
  const [tokenError, setTokenError] = useState('')

  // ── Face Enrollment State ─────────────────────────────────
  const [enrolledFaceDescriptor, setEnrolledFaceDescriptor] = useState<number[] | null>(null)
  const [faceEnrollError, setFaceEnrollError] = useState('')
  const faceScannerRef = useRef<CameraFaceScannerRef>(null)

  // ── Voice Enrollment State ────────────────────────────────
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'recording' | 'enrolled' | 'error'>('idle')
  const [voiceError, setVoiceError] = useState('')
  const [enrolledVoiceSpectrum, setEnrolledVoiceSpectrum] = useState<number[] | null>(null)
  const [enrollmentPhrase, setEnrollmentPhrase] = useState('')
  const voiceStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const voiceSnapshotsRef = useRef<number[][]>([])
  const voiceIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // ── Submission State ──────────────────────────────────────
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')

  useEffect(() => {
    setEnrollmentPhrase(ENROLLMENT_PHRASES[Math.floor(Math.random() * ENROLLMENT_PHRASES.length)])
    return () => {
      faceScannerRef.current?.stopCamera()
      cleanupVoice()
    }
  }, [])

  const [alreadyConfigured, setAlreadyConfigured] = useState(false)
  const [configuredOwnerName, setConfiguredOwnerName] = useState('Hari')

  // ── Token Verification ────────────────────────────────────
  async function verifySetupToken() {
    if (!form.setupToken.trim()) {
      setTokenError('Please enter your setup token')
      return
    }
    setVerifyingToken(true)
    setTokenError('')
    try {
      const res = await fetch('/api/setup/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupToken: form.setupToken.trim() }),
      })
      const data = await res.json()
      if (res.ok && data.valid) {
        setTokenVerified(true)
        if (data.alreadyConfigured) {
          setAlreadyConfigured(true)
          if (data.ownerUsername) setConfiguredOwnerName(data.ownerUsername)
        } else {
          setStep('credentials')
        }
      } else {
        setTokenVerified(false)
        setTokenError(data.error || 'Invalid setup token.')
      }
    } catch {
      setTokenError('Network error connecting to setup validation endpoint.')
    } finally {
      setVerifyingToken(false)
    }
  }


  // ── Face Enrollment via CameraFaceScanner ─────────────────
  function handleFaceScanComplete(result: ScanResult) {
    setEnrolledFaceDescriptor(result.descriptor)
    setFaceEnrollError('')
    faceScannerRef.current?.setAuthenticated('FACE ENROLLMENT SUCCESSFUL')
  }

  function handleFaceScanError(msg: string) {
    if (!msg) {
      setFaceEnrollError('')
      return
    }
    setFaceEnrollError(msg)
    setEnrolledFaceDescriptor(null)
  }


  // ── Voice Enrollment Handlers ─────────────────────────────
  function cleanupVoice() {
    if (voiceIntervalRef.current) {
      clearInterval(voiceIntervalRef.current)
      voiceIntervalRef.current = null
    }
    if (voiceStreamRef.current) {
      voiceStreamRef.current.getTracks().forEach(t => t.stop())
      voiceStreamRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
  }

  async function startVoiceRecording() {
    setVoiceError('')
    setVoiceStatus('recording')
    voiceSnapshotsRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      voiceStreamRef.current = stream

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const audioCtx = new AudioCtx()
      audioContextRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      analyserRef.current = analyser

      const freqData = new Uint8Array(analyser.frequencyBinCount)
      voiceIntervalRef.current = setInterval(() => {
        if (analyserRef.current) {
          analyserRef.current.getByteFrequencyData(freqData)
          const extracted = extractAcousticSpectrum(freqData)
          if (extracted.energy > 0.5) {
            voiceSnapshotsRef.current.push(extracted.spectrum)
          }
        }
      }, 100)

      const recorder = new MediaRecorder(stream)
      recorder.onstop = () => {
        cleanupVoice()
        finalizeVoiceEnrollment()
      }
      recorder.start()

      // 4-second enrollment window
      setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop()
      }, 4000)

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Microphone access denied'
      setVoiceError(msg)
      setVoiceStatus('error')
    }
  }

  function finalizeVoiceEnrollment() {
    const snaps = voiceSnapshotsRef.current
    if (snaps.length < 3) {
      setVoiceError('Inaudible speech detected. Please speak clearly into the microphone.')
      setVoiceStatus('error')
      return
    }

    const bandCount = snaps[0].length
    const avg = new Array(bandCount).fill(0)
    for (const s of snaps) {
      for (let i = 0; i < bandCount; i++) avg[i] += s[i]
    }
    for (let i = 0; i < bandCount; i++) avg[i] = Number((avg[i] / snaps.length).toFixed(6))

    setEnrolledVoiceSpectrum(avg)
    setVoiceStatus('enrolled')
  }

  // ── Step Navigation ───────────────────────────────────────
  function validateCredentials(): boolean {
    const errs: Record<string, string> = {}
    if (!/^\d{6}$/.test(form.pin)) errs.pin = 'PIN must be exactly 6 digits'
    if (form.secretName.trim().length < 4) errs.secretName = 'Passphrase must be at least 4 characters'
    if (!/^\d{4}$/.test(form.code)) errs.code = 'Code must be exactly 4 digits'
    if (form.recoveryKey.length < 16) errs.recoveryKey = 'Recovery key must be at least 16 characters'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function nextFromCredentials() {
    if (validateCredentials()) {
      setStep('biometrics')
    }
  }

  function nextFromBiometrics() {
    setStep('review')
  }

  async function submitSetup() {
    if (!validateCredentials()) return
    setSubmitting(true)
    setServerError('')
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          faceDescriptor: enrolledFaceDescriptor || undefined,
          voiceSpectrum: enrolledVoiceSpectrum || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setStep('done')
      } else {
        setServerError(data.error || 'Setup failed. Please check your credentials.')
      }
    } catch {
      setServerError('Network error submitting setup.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = "w-full bg-black/80 border font-mono text-sm text-green-400 px-3 py-2 outline-none focus:border-red-500 transition-colors rounded"
  const labelClass = "block text-xs font-mono text-red-600 mb-1 uppercase tracking-wider font-bold"

  return (
    <div className="relative min-h-screen bg-[#050505] overflow-y-auto scanline-overlay hacker-grid flex flex-col items-center justify-center p-4 py-10">
      <ParticleBackground color="red" />
      <ScanLines color="red" />

      <div className="relative z-10 w-full max-w-xl">
        <div
          className="border p-6 md:p-8 rounded-xl"
          style={{ borderColor: '#440000', background: 'rgba(5,0,0,0.96)', boxShadow: '0 0 50px rgba(204,0,0,0.15)' }}
        >
          {/* Header */}
          <div className="flex items-center gap-4 mb-6 border-b border-red-950 pb-4">
            <AnimatedSkull color="red" size={56} />
            <div>
              <h1 className="text-xl font-mono font-bold glow-red uppercase tracking-wider" style={{ color: '#cc0000' }}>
                PRIVATE LOVE VAULT — OWNER ENROLLMENT
              </h1>
              <p className="text-xs font-mono text-gray-500 mt-0.5">Strictly Private Single-User Security Setup</p>
            </div>
          </div>

          {/* Stepper indicator */}
          <div className="flex justify-between items-center mb-6 text-xs font-mono border-b border-gray-900 pb-3">
            {[
              { id: 'token', label: '1. Token' },
              { id: 'credentials', label: '2. Credentials' },
              { id: 'biometrics', label: '3. Biometrics' },
              { id: 'review', label: '4. Review' },
            ].map((s) => (
              <span
                key={s.id}
                className={step === s.id ? 'text-red-500 font-bold' : 'text-gray-600'}
              >
                {s.label}
              </span>
            ))}
          </div>

          {/* ── STEP 1: TOKEN ──────────────────────────────── */}
          {step === 'token' && (
            alreadyConfigured ? (
              <div className="space-y-4">
                <div className="border border-green-900/60 bg-green-950/20 p-4 rounded text-left space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-green-400 font-mono text-sm font-bold uppercase tracking-wider">
                      OWNER IDENTITY CONFIRMED: {configuredOwnerName}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-gray-300 leading-relaxed">
                    This vault is already configured with 6-layer security and active owner credentials. Public re-initialization is disabled to protect existing private files.
                  </p>
                  <p className="text-xs font-mono text-green-400/80">
                    ✓ Master setup token validated successfully.
                  </p>
                </div>

                <div className="space-y-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep('credentials')}
                    className="block w-full py-3 text-center font-mono text-xs border-2 border-yellow-600 text-yellow-400 hover:bg-yellow-950/30 rounded font-bold tracking-wider transition-all cursor-pointer"
                  >
                    [ RECONFIGURE VAULT CREDENTIALS & BIOMETRICS → ]
                  </button>
                  <a
                    href="/auth/re-enroll-face"
                    className="block w-full py-3 text-center font-mono text-xs border border-red-600 text-red-400 hover:bg-red-950/30 rounded font-bold tracking-wider transition-all"
                  >
                    [ GO TO SECURE BIOMETRIC RE-ENROLLMENT → ]
                  </a>
                  <a
                    href="/"
                    className="block w-full py-3 text-center font-mono text-xs border border-green-700 text-green-400 hover:bg-green-950/30 rounded font-bold tracking-wider transition-all"
                  >
                    [ PROCEED TO VAULT LOGIN (LOCK 01) → ]
                  </a>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-xs font-mono text-gray-400 border border-red-950 p-3 bg-red-950/10 rounded">
                  <span className="text-red-500 font-bold">SECURITY GATEWAY:</span> Enter the master setup token configured in your server environment variables (<code className="text-red-400">VAULT_SETUP_TOKEN</code>). This authorizes the one-time owner enrollment process.
                </div>

                <div>
                  <label className={labelClass}>Setup Token</label>
                  <input
                    type="password"
                    value={form.setupToken}
                    onChange={e => setForm(f => ({ ...f, setupToken: e.target.value }))}
                    className={inputClass}
                    style={{ borderColor: tokenError ? '#cc0000' : '#330000' }}
                    placeholder="Enter your master setup token"
                    autoComplete="off"
                  />
                  {tokenError && <p className="text-red-500 text-xs font-mono mt-1">⚠ {tokenError}</p>}
                </div>

                <button
                  onClick={verifySetupToken}
                  disabled={verifyingToken}
                  className="w-full py-3 font-mono text-sm border-2 border-red-800 text-red-400 hover:bg-red-900/20 transition-all font-bold tracking-wider cursor-pointer"
                >
                  {verifyingToken ? (
                    <span className="flex items-center justify-center gap-2">
                      <HackerSpinner color="red" /> VERIFYING MASTER TOKEN...
                    </span>
                  ) : '[ VERIFY & PROCEED → ]'}
                </button>
              </div>
            )
          )}

          {/* ── STEP 2: CREDENTIALS ────────────────────────── */}
          {step === 'credentials' && (
            <div className="space-y-4">
              <div className="text-xs font-mono text-gray-400 border border-gray-900 p-3 rounded">
                Configure your numerical and passphrase security credentials. These are hashed using slow salted bcrypt (cost factor 12) on the server.
              </div>

              {/* 6-Digit PIN */}
              <div>
                <label className={labelClass}>6-Digit PIN (Lock 02)</label>
                <input
                  type="password" inputMode="numeric" maxLength={6}
                  value={form.pin}
                  onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '') }))}
                  className={inputClass}
                  style={{ borderColor: errors.pin ? '#cc0000' : '#330000' }}
                  placeholder="••••••"
                  autoComplete="off"
                />
                {errors.pin && <p className="text-red-500 text-xs font-mono mt-1">⚠ {errors.pin}</p>}
              </div>

              {/* Secret Identity Phrase */}
              <div>
                <label className={labelClass}>Secret Identity Phrase (Lock 03)</label>
                <input
                  type="password"
                  value={form.secretName}
                  onChange={e => setForm(f => ({ ...f, secretName: e.target.value }))}
                  className={inputClass}
                  style={{ borderColor: errors.secretName ? '#cc0000' : '#330000' }}
                  placeholder="Enter a private memorable phrase (min 4 chars)"
                  autoComplete="off"
                />
                {errors.secretName && <p className="text-red-500 text-xs font-mono mt-1">⚠ {errors.secretName}</p>}
              </div>

              {/* 4-Digit Code */}
              <div>
                <label className={labelClass}>4-Digit Secret Code (Lock 04)</label>
                <input
                  type="password" inputMode="numeric" maxLength={4}
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.replace(/\D/g, '') }))}
                  className={inputClass}
                  style={{ borderColor: errors.code ? '#cc0000' : '#330000' }}
                  placeholder="••••"
                  autoComplete="off"
                />
                {errors.code && <p className="text-red-500 text-xs font-mono mt-1">⚠ {errors.code}</p>}
              </div>

              {/* Recovery Key */}
              <div>
                <label className={labelClass}>Account Recovery Key (min 16 characters)</label>
                <input
                  type="password"
                  value={form.recoveryKey}
                  onChange={e => setForm(f => ({ ...f, recoveryKey: e.target.value }))}
                  className={inputClass}
                  style={{ borderColor: errors.recoveryKey ? '#cc0000' : '#330000' }}
                  placeholder="Random 16+ character emergency recovery string"
                  autoComplete="off"
                />
                {errors.recoveryKey && <p className="text-red-500 text-xs font-mono mt-1">⚠ {errors.recoveryKey}</p>}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setStep('token')}
                  className="flex-1 py-2.5 font-mono text-sm border border-gray-800 text-gray-500 hover:border-gray-600 transition-all cursor-pointer"
                >
                  ← BACK
                </button>
                <button
                  onClick={nextFromCredentials}
                  className="flex-1 py-2.5 font-mono text-sm border-2 border-red-800 text-red-400 hover:bg-red-900/20 transition-all font-bold cursor-pointer"
                >
                  BIOMETRIC SETUP →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: BIOMETRIC ENROLLMENT ───────────────── */}
          {step === 'biometrics' && (
            <div className="space-y-6">
              <div className="text-xs font-mono text-gray-400 border border-gray-900 p-3 rounded">
                Register your biometric face and voiceprint templates. These are compared using mathematical vector similarity and anti-spoofing checks during subsequent logins.
              </div>

              {/* ── FACE ENROLLMENT ── */}
              <div className="border border-red-900/50 p-4 rounded-lg bg-black/60 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-mono font-bold text-red-500">LOCK 01 &amp; 06 — FACE BIOMETRICS</h3>
                    <p className="text-xs font-mono text-gray-500">128-Point spatial descriptor &amp; liveness capture</p>
                  </div>
                  {enrolledFaceDescriptor && (
                    <span className="text-xs font-mono text-green-400 border border-green-800 px-2 py-0.5 rounded bg-green-950/20">
                      ✓ ENROLLED
                    </span>
                  )}
                </div>

                <CameraFaceScanner
                  ref={faceScannerRef}
                  onScanComplete={handleFaceScanComplete}
                  onError={handleFaceScanError}
                  showScanLaser={true}
                  accentColor="#cc0000"
                  minFrames={3}
                  scanButtonLabel="[ START 128-PT FACE ENROLLMENT SCAN ]"
                />

                {faceEnrollError && (
                  <p className="text-xs font-mono text-red-400 border border-red-900 p-2 bg-red-950/20">
                    ⚠ {faceEnrollError}
                  </p>
                )}
              </div>

              {/* ── VOICE ENROLLMENT ── */}
              <div className="border border-red-900/50 p-4 rounded-lg bg-black/60 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-mono font-bold text-red-500">LOCK 05 — VOICEPRINT BIOMETRICS</h3>
                    <p className="text-xs font-mono text-gray-500">64-Band acoustic spectral formant analysis</p>
                  </div>
                  {enrolledVoiceSpectrum && (
                    <span className="text-xs font-mono text-green-400 border border-green-800 px-2 py-0.5 rounded bg-green-950/20">
                      ✓ ENROLLED
                    </span>
                  )}
                </div>

                {/* Phrase to read */}
                <div className="border border-red-950 p-3 bg-red-950/10 rounded font-mono text-xs text-red-300">
                  <span className="text-red-600 font-bold block mb-1">READ THIS ENROLLMENT PHRASE ALOUD:</span>
                  <span className="italic font-bold">"{enrollmentPhrase}"</span>
                </div>

                <div className="flex justify-center py-2">
                  <Waveform active={voiceStatus === 'recording'} color="red" />
                </div>

                {voiceError && (
                  <p className="text-xs font-mono text-red-400 border border-red-900 p-2 bg-red-950/20">
                    ⚠ {voiceError}
                  </p>
                )}

                {/* Voice Buttons */}
                <div>
                  {voiceStatus === 'recording' ? (
                    <div className="py-2.5 font-mono text-xs text-red-400 text-center animate-pulse">
                      ● RECORDING &amp; EXTRACTING VOICEPRINT SPECTRUM...
                    </div>
                  ) : (
                    <button
                      onClick={startVoiceRecording}
                      className="w-full py-2.5 font-mono text-xs border border-red-700 text-red-400 hover:bg-red-900/20 rounded cursor-pointer"
                    >
                      {enrolledVoiceSpectrum ? '[ RE-RECORD VOICEPRINT ]' : '[ START VOICE ENROLLMENT ]'}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setStep('credentials')}
                  className="flex-1 py-2.5 font-mono text-sm border border-gray-800 text-gray-500 hover:border-gray-600 transition-all cursor-pointer"
                >
                  ← BACK
                </button>
                <button
                  onClick={nextFromBiometrics}
                  className="flex-1 py-2.5 font-mono text-sm border-2 border-red-800 text-red-400 hover:bg-red-900/20 transition-all font-bold cursor-pointer"
                >
                  REVIEW SETUP →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: REVIEW ─────────────────────────────── */}
          {step === 'review' && (
            <div className="space-y-4">
              <div className="text-xs font-mono text-gray-400 border border-gray-900 p-3 rounded">
                Final configuration review. All six authentication layers will be activated permanently.
              </div>

              <div className="space-y-2 text-xs font-mono">
                {[
                  ['Lock 01', 'Face Scan', enrolledFaceDescriptor ? '128-pt Biometric Template Enrolled' : 'Camera Presence Check'],
                  ['Lock 02', '6-Digit PIN', form.pin.replace(/./g, '●')],
                  ['Lock 03', 'Secret Passphrase', '●'.repeat(form.secretName.length)],
                  ['Lock 04', '4-Digit Code', form.code.replace(/./g, '●')],
                  ['Lock 05', 'Voiceprint', enrolledVoiceSpectrum ? '64-Band Acoustic Profile Enrolled' : 'Microphone Presence Check'],
                  ['Lock 06', 'Final Face Scan', enrolledFaceDescriptor ? 'Linked to Enrolled Biometric Template' : 'Camera Presence Check'],
                ].map(([lock, name, val]) => (
                  <div key={lock} className="flex justify-between border-b border-gray-900 pb-1.5 items-center">
                    <span className="text-red-600 font-bold">{lock}</span>
                    <span className="text-gray-400">{name}</span>
                    <span className="text-green-400 font-mono">{val}</span>
                  </div>
                ))}
              </div>

              {serverError && (
                <div className="text-red-500 text-xs font-mono border border-red-900 p-3 bg-red-950/20 rounded">
                  ⚠ {serverError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setStep('biometrics')}
                  disabled={submitting}
                  className="flex-1 py-2.5 font-mono text-sm border border-gray-800 text-gray-500 hover:border-gray-600 transition-all cursor-pointer"
                >
                  ← BACK
                </button>
                <button
                  onClick={submitSetup}
                  disabled={submitting}
                  className="flex-1 py-2.5 font-mono text-sm border-2 border-red-600 text-red-400 hover:bg-red-900/30 transition-all font-bold cursor-pointer disabled:opacity-40"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <HackerSpinner color="red" /> ENROLLING OWNER...
                    </span>
                  ) : '[ INITIALIZE VAULT ]'}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 5: DONE ───────────────────────────────── */}
          {step === 'done' && (
            <div className="space-y-4 text-center py-4">
              <AnimatedSkull color="green" size={90} className="mx-auto" />
              <div className="text-green-400 font-mono text-xl glow-green font-bold">
                OWNER IDENTITY ENROLLED
              </div>
              <p className="text-xs font-mono text-gray-400">
                All 6 security locks have been successfully bound to your biometric and credential templates.
              </p>
              <div className="border border-green-900/40 bg-green-950/10 p-4 rounded text-left text-xs font-mono text-gray-300 space-y-1.5">
                <div className="text-green-400 font-bold">VAULT INITIALIZATION COMPLETE:</div>
                <div>✓ 6-digit PIN &amp; 4-digit code salted and hashed with bcrypt (cost factor 12)</div>
                <div>✓ Secret identity phrase stored securely</div>
                <div>✓ 128-pt facial biometric template registered for Locks 01 &amp; 06</div>
                <div>✓ 64-band acoustic voiceprint registered for Lock 05</div>
                <div>✓ Public registration permanently disabled</div>
              </div>
              <a
                href="/"
                className="block w-full py-3 font-mono text-sm border-2 border-green-600 text-green-400 hover:bg-green-900/20 transition-all font-bold tracking-wider rounded"
              >
                ENTER VAULT &amp; AUTHENTICATE →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
