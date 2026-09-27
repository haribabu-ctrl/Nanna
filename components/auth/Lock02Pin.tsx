'use client'

import { useState, useEffect, useCallback } from 'react'
import { AnimatedSkull, ScanLines, ParticleBackground, LockProgress, SoundButton, HackerSpinner } from '@/components/ui/hacker-ui'
import { getVoiceSystem } from '@/lib/voice/voice-system'

interface LockProps {
  locksPassed: number
  onPass: () => void
  onFail: (message: string, revoked?: boolean) => void
  soundEnabled: boolean
  onSoundToggle: () => void
}

const KEYS = ['1','2','3','4','5','6','7','8','9','←','0','⏎']

export default function Lock02Pin({ locksPassed, onPass, onFail, soundEnabled, onSoundToggle }: LockProps) {
  const [pin, setPin] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [attemptsLeft, setAttemptsLeft] = useState(3)
  const [digitFlash, setDigitFlash] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    getVoiceSystem().speak('lock_2_start')
  }, [])

  const flashDigit = useCallback((idx: number) => {
    setDigitFlash(idx)
    setTimeout(() => setDigitFlash(null), 200)
  }, [])

  const handleKey = useCallback((key: string) => {
    if (submitting) return

    if (key === '←') {
      setPin(p => p.slice(0, -1))
      return
    }

    if (key === '⏎') {
      if (pin.length === 6) submitPin(pin.join(''))
      return
    }

    if (pin.length < 6) {
      const newPin = [...pin, key]
      setPin(newPin)
      flashDigit(newPin.length - 1)
      if (newPin.length === 6) {
        setTimeout(() => submitPin(newPin.join('')), 300)
      }
    }
  }, [pin, submitting, flashDigit])

  async function submitPin(value: string) {
    setSubmitting(true)
    setErrorMsg('')
    try {
      const res = await fetch('/api/auth/verify?lock=2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: value }),
      })
      const data = await res.json()

      if (res.ok && data.success) {
        onPass()
      } else {
        setPin([])
        const left = data.attemptsLeft ?? (attemptsLeft - 1)
        setAttemptsLeft(left)
        setErrorMsg(`INCORRECT PIN — ${left} ATTEMPT${left !== 1 ? 'S' : ''} LEFT`)
        if (data.revoked) {
          onFail('SESSION TERMINATED', true)
        } else {
          onFail(`INCORRECT PIN — ${left} ATTEMPTS LEFT`)
        }
      }
    } catch {
      setPin([])
      setErrorMsg('NETWORK ERROR — RETRY')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative fixed inset-0 bg-[#050505] overflow-hidden scanline-overlay hacker-grid flex flex-col items-center justify-center">
      <ParticleBackground color="red" />
      <ScanLines color="red" />

      <div className="absolute top-4 right-4 z-20">
        <SoundButton enabled={soundEnabled} onToggle={onSoundToggle} />
      </div>
      <div className="absolute top-4 left-4 z-20">
        <LockProgress currentLock={2} locksPassed={locksPassed} />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-6 px-4 max-w-sm w-full text-center">
        <AnimatedSkull color="red" size={100} />

        <div>
          <div className="text-xs font-mono text-red-700 tracking-widest mb-1">NUMERIC AUTHENTICATION</div>
          <h2 className="text-2xl font-mono font-bold glow-red uppercase tracking-widest" style={{ color: '#cc0000' }}>
            SIX-DIGIT SECRET PIN
          </h2>
          <div className="text-xs font-mono text-gray-600 mt-1">LOCK 02 — PIN VERIFICATION</div>
        </div>

        {/* PIN display */}
        <div className="flex gap-3">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="w-10 h-12 border-2 flex items-center justify-center font-mono text-xl font-bold transition-all"
              style={{
                borderColor: i < pin.length ? '#cc0000' : '#2a0000',
                background: digitFlash === i ? 'rgba(204,0,0,0.3)' : 'rgba(10,0,0,0.8)',
                boxShadow: i < pin.length ? '0 0 8px #cc0000' : 'none',
                color: '#cc0000',
              }}
            >
              {i < pin.length ? '●' : ''}
            </div>
          ))}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2 w-full max-w-xs">
          {KEYS.map(key => (
            <button
              key={key}
              onClick={() => handleKey(key)}
              disabled={submitting}
              className="keypad-btn h-14 rounded text-lg font-mono"
            >
              {key}
            </button>
          ))}
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="text-red-500 text-xs font-mono border border-red-900 px-3 py-1">
            ⚠ {errorMsg}
          </div>
        )}

        {submitting && (
          <div className="flex items-center gap-2 text-red-600 font-mono text-sm">
            <HackerSpinner color="red" />
            VERIFYING...
          </div>
        )}
      </div>
    </div>
  )
}
