'use client'

import { useState, useEffect, useRef } from 'react'
import { AnimatedSkull, ScanLines, ParticleBackground, LockProgress, SoundButton, HackerSpinner } from '@/components/ui/hacker-ui'
import { getVoiceSystem } from '@/lib/voice/voice-system'

interface LockProps {
  locksPassed: number
  onPass: () => void
  onFail: (message: string, revoked?: boolean) => void
  soundEnabled: boolean
  onSoundToggle: () => void
}

export default function Lock03SecretName({ locksPassed, onPass, onFail, soundEnabled, onSoundToggle }: LockProps) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [attemptsLeft, setAttemptsLeft] = useState(3)
  const [errorMsg, setErrorMsg] = useState('')
  const [cursorVisible, setCursorVisible] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getVoiceSystem().speak('lock_3_start')
    inputRef.current?.focus()
    const interval = setInterval(() => setCursorVisible(v => !v), 500)
    return () => clearInterval(interval)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!value.trim() || submitting) return

    setSubmitting(true)
    setErrorMsg('')

    try {
      const res = await fetch('/api/auth/verify?lock=3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secretName: value }),
      })
      const data = await res.json()

      if (res.ok && data.success) {
        onPass()
      } else {
        setValue('')
        const left = data.attemptsLeft ?? (attemptsLeft - 1)
        setAttemptsLeft(left)
        setErrorMsg(`INCORRECT PHRASE — ${left} ATTEMPT${left !== 1 ? 'S' : ''} LEFT`)
        if (data.revoked) {
          onFail('SESSION TERMINATED', true)
        } else {
          onFail(`INCORRECT SECRET PHRASE — ${left} ATTEMPTS LEFT`)
        }
        inputRef.current?.focus()
      }
    } catch {
      setValue('')
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
        <LockProgress currentLock={3} locksPassed={locksPassed} />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-6 px-4 max-w-lg w-full text-center">
        <AnimatedSkull color="red" size={100} />

        <div>
          <div className="text-xs font-mono text-red-700 tracking-widest mb-1">IDENTITY PASSPHRASE</div>
          <h2 className="text-2xl font-mono font-bold glow-red uppercase tracking-widest" style={{ color: '#cc0000' }}>
            ENTER YOUR SECRET IDENTITY PHRASE
          </h2>
          <div className="text-xs font-mono text-gray-600 mt-1">LOCK 03 — PASSPHRASE VERIFICATION</div>
        </div>

        {/* Terminal-style input */}
        <form onSubmit={handleSubmit} className="w-full max-w-md">
          <div
            className="border border-red-900 bg-black/80 p-4 text-left font-mono relative"
            style={{ boxShadow: '0 0 16px rgba(204,0,0,0.15)' }}
          >
            <div className="text-red-700 text-xs mb-3">$ identity_verify --passphrase</div>
            <div className="flex items-center gap-2">
              <span className="text-red-600">›</span>
              <input
                ref={inputRef}
                type="password"
                value={value}
                onChange={e => setValue(e.target.value)}
                disabled={submitting}
                className="flex-1 bg-transparent outline-none font-mono text-green-400 text-sm tracking-widest"
                style={{ caretColor: '#00ff41' }}
                autoComplete="off"
                spellCheck={false}
                maxLength={128}
                placeholder="type your secret phrase..."
              />
              <span
                className="text-green-400 text-sm"
                style={{ opacity: cursorVisible ? 1 : 0, transition: 'opacity 0.1s' }}
              >█</span>
            </div>
            <div className="mt-3 h-px" style={{ background: 'linear-gradient(90deg, #cc0000, transparent)' }} />
          </div>

          {errorMsg && (
            <div className="mt-2 text-red-500 text-xs font-mono border border-red-900 px-3 py-1">
              ⚠ {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !value.trim()}
            className="mt-4 w-full py-3 font-mono text-sm uppercase tracking-widest border-2 transition-all disabled:opacity-40"
            style={{
              borderColor: '#cc0000',
              color: '#cc0000',
              background: 'rgba(204,0,0,0.05)',
            }}
            onMouseEnter={e => { if (!submitting) e.currentTarget.style.background = 'rgba(204,0,0,0.15)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(204,0,0,0.05)' }}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <HackerSpinner color="red" /> VERIFYING IDENTITY...
              </span>
            ) : '[ CONFIRM PASSPHRASE ]'}
          </button>
        </form>
      </div>
    </div>
  )
}
