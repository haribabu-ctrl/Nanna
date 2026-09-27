'use client'

import { useState, useEffect, useCallback } from 'react'
import { AnimatedSkull, ScanLines, ParticleBackground, GlitchError, SoundButton, LockProgress, HackerSpinner } from '@/components/ui/hacker-ui'
import { getVoiceSystem } from '@/lib/voice/voice-system'
import Lock01Face from '@/components/auth/Lock01Face'
import Lock02Pin from '@/components/auth/Lock02Pin'
import Lock03SecretName from '@/components/auth/Lock03SecretName'
import Lock04Code from '@/components/auth/Lock04Code'
import Lock05Voice from '@/components/auth/Lock05Voice'
import Lock06FaceFinal from '@/components/auth/Lock06FaceFinal'
import VaultDashboard from '@/components/vault/VaultDashboard'

type AppState = 'welcome' | 'lock1' | 'lock2' | 'lock3' | 'lock4' | 'lock5' | 'lock6' | 'vault' | 'denied'

export default function HomePage() {
  const [appState, setAppState] = useState<AppState>('welcome')
  const [locksPassed, setLocksPassed] = useState(0)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [showGlitch, setShowGlitch] = useState(false)
  const [glitchMessage, setGlitchMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [audioBtnVisible, setAudioBtnVisible] = useState(false)

  // Check existing session on load
  useEffect(() => {
    async function checkSession() {
      try {
        const res = await fetch('/api/auth/session')
        const data = await res.json()
        if (data.authenticated) {
          setLocksPassed(data.locksPassed)
          setAppState('vault')
        }
      } catch { /* no session */ }
      setInitialized(true)
    }
    checkSession()
  }, [])

  // Welcome voice — deferred for browser autoplay policy
  useEffect(() => {
    if (!initialized || appState !== 'welcome') return
    const voice = getVoiceSystem()
    setSoundEnabled(voice.isEnabled())

    // Try autoplay, if blocked show button
    const timer = setTimeout(() => {
      voice.speak('welcome').catch(() => {
        setAudioBtnVisible(true)
      })
    }, 800)

    // If browser hasn't spoken in 2s, show the button
    const fallback = setTimeout(() => {
      setAudioBtnVisible(true)
    }, 2500)

    return () => {
      clearTimeout(timer)
      clearTimeout(fallback)
    }
  }, [initialized, appState])

  const handleSoundToggle = useCallback(() => {
    const voice = getVoiceSystem()
    const next = !soundEnabled
    voice.setEnabled(next)
    setSoundEnabled(next)
  }, [soundEnabled])

  const triggerGlitch = useCallback((msg: string) => {
    setGlitchMessage(msg)
    setShowGlitch(true)
    setTimeout(() => setShowGlitch(false), 1500)
  }, [])

  const initializeVault = useCallback(async () => {
    setLoading(true)
    setAudioBtnVisible(false)
    try {
      const voice = getVoiceSystem()
      voice.speak('welcome')

      const res = await fetch('/api/auth/init', { method: 'POST' })
      const data = await res.json()

      if (data.needsSetup) {
        window.location.href = '/setup'
        return
      }

      if (!res.ok) throw new Error(data.error || 'Failed to initialize')

      setAppState('lock1')
    } catch (err: unknown) {
      triggerGlitch('INITIALIZATION FAILED')
    } finally {
      setLoading(false)
    }
  }, [triggerGlitch])

  const handleLockPassed = useCallback((lockBit: number, nextState: AppState) => {
    const voice = getVoiceSystem()
    voice.speak('lock_passed')
    setLocksPassed(prev => prev | lockBit)
    setAppState(nextState)
  }, [])

  const handleFailed = useCallback((msg: string, revoked: boolean) => {
    const voice = getVoiceSystem()
    const msgs = ['access_denied_1', 'access_denied_2', 'access_denied_3', 'access_denied_4'] as const
    voice.speak(msgs[Math.floor(Math.random() * msgs.length)])
    triggerGlitch(msg)

    if (revoked) {
      setTimeout(() => {
        setAppState('denied')
        setTimeout(() => {
          setLocksPassed(0)
          setAppState('welcome')
        }, 3000)
      }, 1500)
    }
  }, [triggerGlitch])

  const handleVaultAccess = useCallback(() => {
    const voice = getVoiceSystem()
    voice.speak('vault_unlocked')
    setLocksPassed(63)
    setAppState('vault')
  }, [])

  if (!initialized) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#050505]">
        <HackerSpinner color="red" />
      </div>
    )
  }

  // ── Vault Dashboard ──────────────────────────────────────────
  if (appState === 'vault') {
    return <VaultDashboard soundEnabled={soundEnabled} onSoundToggle={handleSoundToggle} />
  }

  // ── Auth Locks ───────────────────────────────────────────────
  if (appState === 'lock1') {
    return (
      <Lock01Face
        locksPassed={locksPassed}
        onPass={() => handleLockPassed(1, 'lock2')}
        onFail={(msg, revoked) => handleFailed(msg, revoked || false)}
        soundEnabled={soundEnabled}
        onSoundToggle={handleSoundToggle}
      />
    )
  }

  if (appState === 'lock2') {
    return (
      <Lock02Pin
        locksPassed={locksPassed}
        onPass={() => handleLockPassed(2, 'lock3')}
        onFail={(msg, revoked) => handleFailed(msg, revoked || false)}
        soundEnabled={soundEnabled}
        onSoundToggle={handleSoundToggle}
      />
    )
  }

  if (appState === 'lock3') {
    return (
      <Lock03SecretName
        locksPassed={locksPassed}
        onPass={() => handleLockPassed(4, 'lock4')}
        onFail={(msg, revoked) => handleFailed(msg, revoked || false)}
        soundEnabled={soundEnabled}
        onSoundToggle={handleSoundToggle}
      />
    )
  }

  if (appState === 'lock4') {
    return (
      <Lock04Code
        locksPassed={locksPassed}
        onPass={() => handleLockPassed(8, 'lock5')}
        onFail={(msg, revoked) => handleFailed(msg, revoked || false)}
        soundEnabled={soundEnabled}
        onSoundToggle={handleSoundToggle}
      />
    )
  }

  if (appState === 'lock5') {
    return (
      <Lock05Voice
        locksPassed={locksPassed}
        onPass={() => handleLockPassed(16, 'lock6')}
        onFail={(msg, revoked) => handleFailed(msg, revoked || false)}
        soundEnabled={soundEnabled}
        onSoundToggle={handleSoundToggle}
      />
    )
  }

  if (appState === 'lock6') {
    return (
      <Lock06FaceFinal
        locksPassed={locksPassed}
        onPass={handleVaultAccess}
        onFail={(msg, revoked) => handleFailed(msg, revoked || false)}
        soundEnabled={soundEnabled}
        onSoundToggle={handleSoundToggle}
      />
    )
  }

  // ── Access Denied Screen ─────────────────────────────────────
  if (appState === 'denied') {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-600 text-6xl font-mono font-bold mb-4 glow-red" style={{ animation: 'glitch 0.3s steps(1) infinite' }}>
            ACCESS DENIED
          </div>
          <div className="text-red-400 font-mono">SESSION TERMINATED. RETURNING TO WELCOME SCREEN.</div>
        </div>
      </div>
    )
  }

  // ── Welcome Screen ───────────────────────────────────────────
  return (
    <div className="relative fixed inset-0 bg-[#050505] overflow-hidden scanline-overlay hacker-grid flex flex-col items-center justify-center">
      {/* Background effects */}
      <ParticleBackground color="red" />
      <ScanLines color="red" />

      {/* Glitch error overlay */}
      <GlitchError message={glitchMessage} visible={showGlitch} />

      {/* Sound controls */}
      <div className="absolute top-4 right-4 z-20">
        <SoundButton
          enabled={soundEnabled}
          onToggle={handleSoundToggle}
          onReplay={() => getVoiceSystem().speak('welcome')}
        />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center gap-8 px-4 text-center max-w-2xl">
        {/* Animated skull */}
        <div className="relative">
          <div className="absolute inset-0 rounded-full blur-3xl opacity-20" style={{ background: '#cc0000' }} />
          <AnimatedSkull color="red" size={160} />
        </div>

        {/* Title */}
        <div>
          <h1
            className="text-3xl md:text-5xl font-mono font-bold uppercase tracking-widest glow-red flicker-text"
            style={{ color: '#cc0000' }}
          >
            WELCOME TO OUR PRIVATE WORLD
          </h1>
          <div className="mt-3 h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, #cc0000, transparent)' }} />
        </div>

        {/* Subtitle */}
        <div className="space-y-2">
          <p className="font-mono text-sm md:text-base tracking-[0.3em] text-red-400 uppercase">
            ACCESS RESTRICTED — AUTHORIZED USER ONLY
          </p>
          <p className="font-mono text-xs text-gray-600 tracking-widest">
            SIX-LAYER BIOMETRIC AUTHENTICATION REQUIRED
          </p>
        </div>

        {/* Terminal-style info box */}
        <div className="w-full max-w-md border border-red-900 p-4 text-left font-mono text-xs text-gray-500 bg-black/50">
          <div className="text-red-600 mb-2">$ system_status --check</div>
          <div className="space-y-1">
            <div><span className="text-red-700">►</span> ENCRYPTION: ACTIVE</div>
            <div><span className="text-red-700">►</span> AUTHENTICATION LAYERS: 6</div>
            <div><span className="text-red-700">►</span> BIOMETRIC SCANNERS: STANDBY</div>
            <div><span className="text-red-700">►</span> INTRUSION DETECTION: ACTIVE</div>
            <div className="text-red-400 mt-2">AWAITING AUTHORIZED USER...</div>
          </div>
        </div>

        {/* Initialize button */}
        {audioBtnVisible && !loading && (
          <div className="text-xs text-gray-600 font-mono mb-2">
            ⚠ Browser blocked autoplay. Click below to initialize.
          </div>
        )}

        <button
          onClick={initializeVault}
          disabled={loading}
          className="group relative px-12 py-4 font-mono text-sm uppercase tracking-widest font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            border: '2px solid #cc0000',
            color: '#cc0000',
            background: 'transparent',
            boxShadow: '0 0 20px rgba(204,0,0,0.3)',
          }}
          onMouseEnter={e => {
            const el = e.currentTarget
            el.style.background = 'rgba(204,0,0,0.15)'
            el.style.boxShadow = '0 0 40px rgba(255,0,0,0.5), inset 0 0 20px rgba(204,0,0,0.1)'
          }}
          onMouseLeave={e => {
            const el = e.currentTarget
            el.style.background = 'transparent'
            el.style.boxShadow = '0 0 20px rgba(204,0,0,0.3)'
          }}
        >
          {loading ? (
            <span className="flex items-center gap-3">
              <HackerSpinner color="red" />
              INITIALIZING...
            </span>
          ) : (
            'INITIALIZE VAULT'
          )}
        </button>

        {/* Bottom status */}
        <div className="text-xs font-mono text-gray-700 tracking-widest">
          PRIVATE LOVE VAULT v2.0 • CLASSIFIED
        </div>
      </div>
    </div>
  )
}
