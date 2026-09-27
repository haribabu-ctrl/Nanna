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

export default function Lock06FaceFinal({ locksPassed, onPass, onFail, soundEnabled, onSoundToggle }: LockProps) {
  const [phase, setPhase] = useState<'scanning' | 'granted' | 'failed'>('scanning')
  const [attemptsLeft, setAttemptsLeft] = useState(3)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [apiDisabled, setApiDisabled] = useState(false)
  const isSubmittingRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const scannerRef = useRef<CameraFaceScannerRef>(null)

  useEffect(() => {
    getVoiceSystem().speak('lock_6_start')
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort()
      scannerRef.current?.stopCamera()
    }
  }, [])

  const handleScanComplete = useCallback(async (result: ScanResult) => {
    if (isSubmittingRef.current) return
    isSubmittingRef.current = true
    setApiDisabled(true)
    setVerifyError(null)

    scannerRef.current?.setVerifying('Executing final biometric authorization check...')

    const controller = new AbortController()
    abortControllerRef.current = controller
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    try {
      const res = await fetch('/api/auth/verify?lock=6', {
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
        scannerRef.current?.setAuthenticated('TERMINAL IDENTITY CONFIRMED — ACCESS GRANTED')
        setPhase('granted')

        const voice = getVoiceSystem()
        voice.speak('vault_unlocked')

        setTimeout(() => {
          scannerRef.current?.stopCamera()
          onPass()
        }, 2200)
      } else {
        const left = data.attemptsLeft ?? (attemptsLeft - 1)
        setAttemptsLeft(Math.max(0, left))
        setPhase('failed')

        const isRateLimit = res.status === 429
        const retryAfter = data.retryAfter || (isRateLimit ? 60 : undefined)
        const msg = data.error || (isRateLimit ? 'Too many attempts. Please wait.' : `FINAL FACE VERIFICATION FAILED — ${left} ATTEMPTS LEFT`)

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
        ? 'VERIFICATION TIMED OUT — Please retry.'
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

  // Access Granted Fullscreen Animation
  if (phase === 'granted') {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-8 z-50">
        <ParticleBackground color="green" />
        <div className="relative">
          <div className="absolute inset-0 rounded-full blur-3xl opacity-40" style={{ background: '#00ff41' }} />
          <AnimatedSkull color="green" size={200} />
        </div>
        <div className="text-center space-y-4">
          <div className="text-4xl md:text-6xl font-mono font-bold glow-green uppercase tracking-widest" style={{ color: '#00ff41' }}>
            ACCESS GRANTED
          </div>
          <div className="text-green-400 font-mono text-lg tracking-widest">
            IDENTITY CONFIRMED — VAULT ACCESS GRANTED
          </div>
          <div className="text-green-700 font-mono text-sm tracking-widest animate-pulse">
            INITIALIZING PRIVATE LOVE VAULT...
          </div>
        </div>
        <ScanLines color="green" />
      </div>
    )
  }

  return (
    <div className="relative fixed inset-0 bg-[#050505] overflow-y-auto scanline-overlay hacker-grid flex flex-col items-center justify-center p-4">
      <ParticleBackground color="red" />
      <ScanLines color="red" />
      <div className="absolute top-4 right-4 z-20"><SoundButton enabled={soundEnabled} onToggle={onSoundToggle} /></div>
      <div className="absolute top-4 left-4 z-20"><LockProgress currentLock={6} locksPassed={locksPassed} /></div>

      <div className="relative z-10 flex flex-col items-center gap-4 px-4 max-w-md w-full text-center my-auto">
        <div className="space-y-1">
          <div className="flex justify-center mb-1">
            <AnimatedSkull color="red" size={60} />
          </div>
          <div className="text-xs font-mono text-red-700 tracking-widest">FINAL SECURITY LAYER</div>
          <h2 className="text-2xl md:text-3xl font-mono font-bold glow-red uppercase tracking-widest" style={{ color: '#cc0000' }}>
            FINAL BIOMETRIC AUTHORIZATION
          </h2>
          <div className="text-xs font-mono text-gray-400">LOCK 06 — TERMINAL BIOMETRIC COMPARISON</div>
        </div>

        {/* Camera Scanner */}
        <div className="w-full">
          <CameraFaceScanner
            ref={scannerRef}
            onScanComplete={handleScanComplete}
            onError={handleScanError}
            showScanLaser={true}
            accentColor="#cc0000"
            minFrames={3}
            scanButtonLabel="[ EXECUTE FINAL FACE SCAN ]"
            disabled={apiDisabled}
            autoStart={true}
          />
        </div>

        {/* Verify error */}
        {verifyError && (
          <div className="w-full text-red-400 text-xs font-mono border border-red-800 px-3 py-2 bg-red-950/40 rounded text-left">
            ⚠ {verifyError}
          </div>
        )}
      </div>
    </div>
  )
}
