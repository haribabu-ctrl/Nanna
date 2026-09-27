'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatedSkull, ScanLines, ParticleBackground, LockProgress, SoundButton } from '@/components/ui/hacker-ui'
import { getVoiceSystem } from '@/lib/voice/voice-system'
import CameraFaceScanner, { CameraFaceScannerRef, ScanResult } from '@/components/camera/CameraFaceScanner'

interface LockProps {
  locksPassed: number
  onPass: () => void
  onFail: (message: string, revoked?: boolean) => void
  soundEnabled: boolean
  onSoundToggle: () => void
}

export default function Lock01Face({ locksPassed, onPass, onFail, soundEnabled, onSoundToggle }: LockProps) {
  const [attemptsLeft, setAttemptsLeft] = useState(3)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [apiDisabled, setApiDisabled] = useState(false)
  const isSubmittingRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const scannerRef = useRef<CameraFaceScannerRef>(null)

  useEffect(() => {
    const voice = getVoiceSystem()
    voice.speak('lock_1_start')
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      scannerRef.current?.stopCamera()
    }
  }, [])

  const handleScanComplete = useCallback(async (result: ScanResult) => {
    // Prevent duplicate parallel requests
    if (isSubmittingRef.current) return
    isSubmittingRef.current = true
    setApiDisabled(true)
    setVerifyError(null)

    scannerRef.current?.setVerifying('Matching biometric template with registered owner...')

    // 15-second request timeout to prevent permanent hangs
    const controller = new AbortController()
    abortControllerRef.current = controller
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, 15000)

    try {
      const res = await fetch('/api/auth/verify?lock=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          faceDescriptor: result.descriptor,
          livenessPassed: true,
          temporalVariance: result.liveness.variance,
        }),
      })

      clearTimeout(timeoutId)
      const data = await res.json().catch(() => ({}))

      if (res.ok && data.success) {
        scannerRef.current?.setAuthenticated('IDENTITY CONFIRMED — ACCESS GRANTED')
        setVerifyError(null)

        const voice = getVoiceSystem()
        voice.speak('lock_passed')

        // Clean pause so user sees green confirmation before advancing to Lock 02
        setTimeout(() => {
          scannerRef.current?.stopCamera()
          onPass()
        }, 900)
      } else {
        const left = data.attemptsLeft !== undefined ? data.attemptsLeft : (attemptsLeft - 1)
        setAttemptsLeft(Math.max(0, left))

        const isRateLimit = res.status === 429
        const retryAfter = data.retryAfter || (isRateLimit ? 60 : undefined)
        const msg = data.error || (isRateLimit ? 'Too many attempts. Please wait.' : `FACE IDENTITY MISMATCH — ${left} ATTEMPT${left !== 1 ? 'S' : ''} LEFT`)

        setVerifyError(msg)
        scannerRef.current?.setFailed(msg, retryAfter)

        if (data.revoked) {
          onFail('SECURITY LOCKOUT: SESSION TERMINATED', true)
        } else {
          onFail(msg)
        }
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      const isAbort = err instanceof DOMException && err.name === 'AbortError'
      const msg = isAbort
        ? 'VERIFICATION TIMED OUT — Please retry your scan.'
        : 'NETWORK ERROR — Could not reach verification service.'

      setVerifyError(msg)
      scannerRef.current?.setFailed(msg)
      onFail(msg)
    } finally {
      clearTimeout(timeoutId)
      isSubmittingRef.current = false
      setApiDisabled(false)
    }
  }, [attemptsLeft, onPass, onFail])

  function handleScanError(msg: string) {
    if (!msg) {
      setVerifyError(null)
      return
    }
    setVerifyError(msg)
  }

  return (
    <div className="relative fixed inset-0 bg-[#050505] overflow-y-auto scanline-overlay hacker-grid flex flex-col items-center justify-center p-4">
      <ParticleBackground color="red" />
      <ScanLines color="red" />

      <div className="absolute top-4 right-4 z-20">
        <SoundButton enabled={soundEnabled} onToggle={onSoundToggle} />
      </div>
      <div className="absolute top-4 left-4 z-20">
        <LockProgress currentLock={1} locksPassed={locksPassed} />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-4 px-4 max-w-md w-full text-center my-auto">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex justify-center mb-2">
            <AnimatedSkull color="red" size={60} />
          </div>
          <div className="text-xs font-mono text-red-700 tracking-widest">BIOMETRIC IDENTITY RECOGNITION</div>
          <h2 className="text-2xl md:text-3xl font-mono font-bold glow-red uppercase tracking-widest" style={{ color: '#cc0000' }}>
            IDENTITY VERIFICATION
          </h2>
          <div className="text-xs font-mono text-gray-400">LOCK 01 — 128-POINT FACIAL SCAN &amp; LIVENESS CHECK</div>
        </div>

        {/* Camera Face Scanner — remains mounted throughout verification */}
        <div className="w-full">
          <CameraFaceScanner
            ref={scannerRef}
            onScanComplete={handleScanComplete}
            onError={handleScanError}
            showScanLaser={true}
            accentColor="#cc0000"
            minFrames={3}
            scanButtonLabel="[ START 128-PT FACE SCAN ]"
            disabled={apiDisabled}
            autoStart={true}
          />
        </div>

        {/* Verify error banner */}
        {verifyError && (
          <div className="w-full text-red-400 text-xs font-mono border border-red-800 px-3 py-2 bg-red-950/40 rounded text-left">
            ⚠ {verifyError}
          </div>
        )}

        {/* Re-enrollment link */}
        <div className="pt-1">
          <a
            href="/auth/re-enroll-face"
            className="text-[11px] font-mono text-gray-500 hover:text-red-400 underline transition-colors"
          >
            Need to update or re-register your face? [ Secure Face Re-Enrollment ]
          </a>
        </div>
      </div>
    </div>
  )
}
