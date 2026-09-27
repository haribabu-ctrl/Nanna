'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { AnimatedSkull, ScanLines, ParticleBackground } from '@/components/ui/hacker-ui'
import CameraFaceScanner, { CameraFaceScannerRef, ScanResult } from '@/components/camera/CameraFaceScanner'

export default function ReEnrollFacePage() {
  const [authMethod, setAuthMethod] = useState<'token' | 'recovery'>('token')
  const [setupToken, setSetupToken] = useState('hari2026') // pre-fill dev setup token
  const [pin, setPin] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [devResetStatus, setDevResetStatus] = useState('')

  const isSubmittingRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const scannerRef = useRef<CameraFaceScannerRef>(null)

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort()
      scannerRef.current?.stopCamera()
    }
  }, [])

  const handleScanComplete = useCallback(async (result: ScanResult) => {
    // Validate credentials BEFORE sending
    if (authMethod === 'token' && !setupToken.trim()) {
      const msg = 'Owner Authorization Required: Enter your Master Setup Token above before scanning.'
      setErrorMsg(msg)
      scannerRef.current?.setFailed(msg)
      return
    }
    if (authMethod === 'recovery' && (!pin.trim() || !recoveryKey.trim())) {
      const msg = 'Owner Authorization Required: Enter both your 6-Digit PIN and Account Recovery Key above.'
      setErrorMsg(msg)
      scannerRef.current?.setFailed(msg)
      return
    }

    if (isSubmittingRef.current) return
    isSubmittingRef.current = true
    setLoading(true)
    setErrorMsg('')

    scannerRef.current?.setVerifying('Submitting face biometric template to vault backend...')

    const controller = new AbortController()
    abortControllerRef.current = controller
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const payload: Record<string, unknown> = {
        faceDescriptor: result.descriptor,
        livenessPassed: true,
      }

      if (authMethod === 'token') {
        payload.setupToken = setupToken.trim()
      } else {
        payload.pin = pin.trim()
        payload.recoveryKey = recoveryKey.trim()
      }

      const res = await fetch('/api/auth/re-enroll-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(payload),
      })

      clearTimeout(timeoutId)
      const data = await res.json().catch(() => ({}))

      if (res.ok && data.success) {
        scannerRef.current?.setAuthenticated('BIOMETRIC TEMPLATE PERSISTED')
        scannerRef.current?.stopCamera()
        setSuccess(true)
      } else {
        const isRateLimit = res.status === 429
        const retryAfter = data.retryAfter || (isRateLimit ? 60 : undefined)
        const msg = data.error || (isRateLimit ? 'Too many attempts. Please wait.' : 'Failed to update face biometric template.')

        setErrorMsg(msg)
        scannerRef.current?.setFailed(msg, retryAfter)
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      const isAbort = err instanceof DOMException && err.name === 'AbortError'
      const msg = isAbort
        ? 'Re-enrollment request timed out. Please retry.'
        : 'Network error connecting to biometric re-enrollment service.'

      setErrorMsg(msg)
      scannerRef.current?.setFailed(msg)
    } finally {
      clearTimeout(timeoutId)
      isSubmittingRef.current = false
      setLoading(false)
    }
  }, [authMethod, setupToken, pin, recoveryKey])

  function handleScanError(msg: string) {
    if (!msg) {
      setErrorMsg('')
      return
    }
    setErrorMsg(msg)
  }

  async function handleDevResetRateLimits() {
    try {
      setDevResetStatus('Resetting rate limits...')
      const res = await fetch('/api/auth/dev-reset-rate-limit', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setDevResetStatus('✓ Rate limits and session lockouts reset!')
        setErrorMsg('')
        scannerRef.current?.resetToReady()
        setTimeout(() => setDevResetStatus(''), 4000)
      } else {
        setDevResetStatus(`Error: ${data.error || 'Failed'}`)
      }
    } catch {
      setDevResetStatus('Network error resetting rate limits')
    }
  }

  const inputClass = "w-full bg-black/80 border font-mono text-sm text-green-400 px-3 py-2 outline-none focus:border-red-500 transition-colors rounded"
  const labelClass = "block text-xs font-mono text-red-600 mb-1 uppercase tracking-wider font-bold"

  return (
    <div className="relative min-h-screen bg-[#050505] overflow-y-auto scanline-overlay hacker-grid flex flex-col items-center justify-center p-4 py-8">
      <ParticleBackground color="red" />
      <ScanLines color="red" />

      <div className="relative z-10 w-full max-w-lg my-auto">
        <div
          className="border p-6 md:p-8 rounded-xl"
          style={{ borderColor: '#440000', background: 'rgba(5,0,0,0.96)', boxShadow: '0 0 50px rgba(204,0,0,0.15)' }}
        >
          {/* Header */}
          <div className="flex items-center gap-4 mb-5 border-b border-red-950 pb-4">
            <AnimatedSkull color="red" size={50} />
            <div>
              <h1 className="text-lg font-mono font-bold glow-red uppercase tracking-wider" style={{ color: '#cc0000' }}>
                SECURE BIOMETRIC RE-ENROLLMENT
              </h1>
              <p className="text-xs font-mono text-gray-500 mt-0.5">Register Real Face Template to Database</p>
            </div>
          </div>

          {!success ? (
            <div className="space-y-4">
              <div className="text-xs font-mono text-gray-400 border border-red-950 p-3 bg-red-950/10 rounded">
                <span className="text-red-500 font-bold">OWNER AUTHORIZATION REQUIRED:</span> Provide your Master Setup Token or your 6-Digit PIN and Account Recovery Key to authorize a new face scan.
              </div>

              {/* Auth method toggle */}
              <div className="flex gap-2 border-b border-gray-900 pb-2">
                <button
                  type="button"
                  onClick={() => setAuthMethod('token')}
                  className={`text-xs font-mono px-3 py-1.5 rounded transition-all cursor-pointer ${
                    authMethod === 'token' ? 'bg-red-950 text-red-400 border border-red-800' : 'text-gray-500'
                  }`}
                >
                  Master Setup Token
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMethod('recovery')}
                  className={`text-xs font-mono px-3 py-1.5 rounded transition-all cursor-pointer ${
                    authMethod === 'recovery' ? 'bg-red-950 text-red-400 border border-red-800' : 'text-gray-500'
                  }`}
                >
                  PIN + Recovery Key
                </button>
              </div>

              {authMethod === 'token' ? (
                <div>
                  <label className={labelClass}>Master Setup Token</label>
                  <input
                    type="password"
                    value={setupToken}
                    onChange={e => setSetupToken(e.target.value)}
                    className={inputClass}
                    style={{ borderColor: '#330000' }}
                    placeholder="Enter VAULT_SETUP_TOKEN (e.g. hari2026)"
                    autoComplete="off"
                  />
                  <span className="text-[10px] font-mono text-gray-500">Default dev token: hari2026</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className={labelClass}>6-Digit PIN</label>
                    <input
                      type="password" inputMode="numeric" maxLength={6}
                      value={pin}
                      onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                      className={inputClass}
                      style={{ borderColor: '#330000' }}
                      placeholder="••••••"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Account Recovery Key</label>
                    <input
                      type="password"
                      value={recoveryKey}
                      onChange={e => setRecoveryKey(e.target.value)}
                      className={inputClass}
                      style={{ borderColor: '#330000' }}
                      placeholder="Enter emergency recovery key"
                      autoComplete="off"
                    />
                  </div>
                </div>
              )}

              {/* Error */}
              {errorMsg && (
                <p className="text-xs font-mono text-red-400 border border-red-900 p-2.5 bg-red-950/20 rounded">
                  ⚠ {errorMsg}
                </p>
              )}

              {/* Camera Area */}
              <div className="border border-red-900/60 p-3.5 rounded-lg bg-black/60 space-y-2">
                <div className="text-xs font-mono text-red-500 font-bold uppercase tracking-wider">
                  REAL FACE BIOMETRIC CAPTURE
                </div>
                <CameraFaceScanner
                  ref={scannerRef}
                  onScanComplete={handleScanComplete}
                  onError={handleScanError}
                  showScanLaser={true}
                  accentColor="#cc0000"
                  minFrames={3}
                  scanButtonLabel="[ START RE-ENROLLMENT SCAN &amp; SAVE ]"
                  disabled={loading}
                  autoStart={true}
                />
              </div>

              {/* Dev Rate Limit Reset Controls */}
              <div className="flex justify-between items-center pt-2 text-xs font-mono">
                <a
                  href="/"
                  className="text-gray-500 hover:text-gray-300 underline"
                >
                  &larr; Return to Vault Login
                </a>

                <div className="flex items-center gap-2">
                  {devResetStatus && (
                    <span className="text-[11px] text-green-400 font-bold">{devResetStatus}</span>
                  )}
                  <button
                    type="button"
                    onClick={handleDevResetRateLimits}
                    className="text-[11px] text-yellow-500 hover:text-yellow-300 px-2 py-1 border border-yellow-800/60 bg-yellow-950/20 rounded cursor-pointer"
                    title="Dev: Reset all rate-limits for localhost"
                  >
                    ⚡ [ DEV: RESET RATE LIMITS ]
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-center py-4">
              <AnimatedSkull color="green" size={80} className="mx-auto" />
              <div className="text-green-400 font-mono text-lg glow-green font-bold">
                FACE BIOMETRIC TEMPLATE REGISTERED
              </div>
              <p className="text-xs font-mono text-gray-400">
                Your new real 128-point face descriptor and liveness parameters have been successfully written to the database.
              </p>
              <div className="border border-green-900/40 bg-green-950/10 p-3 rounded text-left text-xs font-mono text-gray-300 space-y-1">
                <div>✓ Synthetic template replaced with live calibrated 128-D vector</div>
                <div>✓ Rate limits and session lockouts reset</div>
                <div>✓ Calibrated matching threshold active for Locks 01 and 06</div>
              </div>
              <a
                href="/"
                className="block w-full py-3 font-mono text-sm border-2 border-green-600 text-green-400 hover:bg-green-900/20 transition-all font-bold tracking-wider rounded"
              >
                PROCEED TO VAULT LOGIN (LOCK 01) &rarr;
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
