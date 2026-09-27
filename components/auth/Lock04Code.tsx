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

const KEYS = ['1','2','3','←','4','5','6','⏎','7','8','9','','','0','','']

export default function Lock04Code({ locksPassed, onPass, onFail, soundEnabled, onSoundToggle }: LockProps) {
  const [code, setCode] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [attemptsLeft, setAttemptsLeft] = useState(3)
  const [digitFlash, setDigitFlash] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [scanActive, setScanActive] = useState(true)

  useEffect(() => {
    getVoiceSystem().speak('lock_4_start')
  }, [])

  const handleKey = useCallback((key: string) => {
    if (submitting || !key) return
    if (key === '←') { setCode(p => p.slice(0, -1)); return }
    if (key === '⏎') { if (code.length === 4) submitCode(code.join('')); return }
    if (code.length < 4) {
      const newCode = [...code, key]
      setCode(newCode)
      setDigitFlash(newCode.length - 1)
      setTimeout(() => setDigitFlash(null), 200)
      if (newCode.length === 4) setTimeout(() => submitCode(newCode.join('')), 300)
    }
  }, [code, submitting])

  async function submitCode(value: string) {
    setSubmitting(true)
    setErrorMsg('')
    setScanActive(false)
    try {
      const res = await fetch('/api/auth/verify?lock=4', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        onPass()
      } else {
        setCode([])
        setScanActive(true)
        const left = data.attemptsLeft ?? (attemptsLeft - 1)
        setAttemptsLeft(left)
        setErrorMsg(`INCORRECT CODE — ${left} ATTEMPT${left !== 1 ? 'S' : ''} LEFT`)
        if (data.revoked) onFail('SESSION TERMINATED', true)
        else onFail(`INCORRECT CODE — ${left} ATTEMPTS LEFT`)
      }
    } catch {
      setCode([]); setScanActive(true); setErrorMsg('NETWORK ERROR — RETRY')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative fixed inset-0 bg-[#050505] overflow-hidden scanline-overlay hacker-grid flex flex-col items-center justify-center">
      <ParticleBackground color="red" />
      <ScanLines color="red" />
      <div className="absolute top-4 right-4 z-20"><SoundButton enabled={soundEnabled} onToggle={onSoundToggle} /></div>
      <div className="absolute top-4 left-4 z-20"><LockProgress currentLock={4} locksPassed={locksPassed} /></div>

      <div className="relative z-10 flex flex-col items-center gap-6 px-4 max-w-sm w-full text-center">
        {/* Rotating scan ring around skull */}
        <div className="relative">
          <div
            className="absolute inset-0 rounded-full border-2 border-transparent"
            style={{
              borderTopColor: '#cc0000',
              borderRightColor: '#660000',
              animation: scanActive ? 'rotate-slow 2s linear infinite' : 'none',
              width: 120, height: 120, margin: 'auto',
            }}
          />
          <AnimatedSkull color="red" size={100} />
        </div>

        <div>
          <div className="text-xs font-mono text-red-700 tracking-widest mb-1">SECONDARY AUTHENTICATION</div>
          <h2 className="text-2xl font-mono font-bold glow-red uppercase tracking-widest" style={{ color: '#cc0000' }}>
            FOUR-DIGIT SECRET CODE
          </h2>
          <div className="text-xs font-mono text-gray-600 mt-1">LOCK 04 — CODE VERIFICATION</div>
        </div>

        {/* 4-digit display */}
        <div className="flex gap-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="w-12 h-14 border-2 flex items-center justify-center font-mono text-2xl font-bold transition-all"
              style={{
                borderColor: i < code.length ? '#cc0000' : '#1a0000',
                background: digitFlash === i ? 'rgba(204,0,0,0.4)' : 'rgba(5,0,0,0.9)',
                boxShadow: i < code.length ? '0 0 12px #cc0000, inset 0 0 8px rgba(204,0,0,0.2)' : 'none',
                color: '#ff4444',
              }}
            >
              {i < code.length ? '◉' : '○'}
            </div>
          ))}
        </div>

        {/* 4x4 Keypad */}
        <div className="grid grid-cols-4 gap-2 w-full max-w-xs">
          {KEYS.map((key, idx) => (
            <button
              key={idx}
              onClick={() => handleKey(key)}
              disabled={submitting || !key}
              className={`keypad-btn h-12 rounded text-base font-mono ${!key ? 'invisible' : ''}`}
            >
              {key}
            </button>
          ))}
        </div>

        {errorMsg && (
          <div className="text-red-500 text-xs font-mono border border-red-900 px-3 py-1">
            ⚠ {errorMsg}
          </div>
        )}

        {submitting && (
          <div className="flex items-center gap-2 text-red-600 font-mono text-sm">
            <HackerSpinner color="red" /> VERIFYING CODE...
          </div>
        )}
      </div>
    </div>
  )
}
