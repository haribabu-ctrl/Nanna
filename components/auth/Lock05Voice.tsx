'use client'

import { useState, useEffect, useRef } from 'react'
import { AnimatedSkull, ScanLines, ParticleBackground, LockProgress, SoundButton, HackerSpinner, Waveform } from '@/components/ui/hacker-ui'
import { getVoiceSystem } from '@/lib/voice/voice-system'
import { VERIFICATION_PHRASES, extractAcousticSpectrum } from '@/lib/biometrics/voice'

interface LockProps {
  locksPassed: number
  onPass: () => void
  onFail: (message: string, revoked?: boolean) => void
  soundEnabled: boolean
  onSoundToggle: () => void
}

export default function Lock05Voice({ locksPassed, onPass, onFail, soundEnabled, onSoundToggle }: LockProps) {
  const [status, setStatus] = useState<'idle' | 'recording' | 'processing' | 'failed'>('idle')
  const [challenge, setChallenge] = useState('')
  const [transcript, setTranscript] = useState('')
  const [attemptsLeft, setAttemptsLeft] = useState(3)
  const [errorMsg, setErrorMsg] = useState('')
  const [micError, setMicError] = useState('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recognitionRef = useRef<unknown>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const spectralSnapshotsRef = useRef<number[][]>([])
  const energyLevelsRef = useRef<number[]>([])
  const sampleIntervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Pick a fresh randomized challenge phrase
    setChallenge(VERIFICATION_PHRASES[Math.floor(Math.random() * VERIFICATION_PHRASES.length)])
    getVoiceSystem().speak('lock_5_start')
    return () => {
      cleanupAudio()
    }
  }, [])

  function cleanupAudio() {
    if (sampleIntervalRef.current) {
      clearInterval(sampleIntervalRef.current)
      sampleIntervalRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
  }

  async function startRecording() {
    setMicError('')
    setTranscript('')
    setErrorMsg('')
    setStatus('recording')
    spectralSnapshotsRef.current = []
    energyLevelsRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // Initialize Web Audio API AnalyserNode for biometric frequency profiling
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const audioCtx = new AudioCtx()
      audioContextRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)
      analyserRef.current = analyser

      const freqData = new Uint8Array(analyser.frequencyBinCount)

      // Sample acoustic spectrum every 100ms
      sampleIntervalRef.current = setInterval(() => {
        if (analyserRef.current) {
          analyserRef.current.getByteFrequencyData(freqData)
          const result = extractAcousticSpectrum(freqData)
          if (result.energy > 0.5) {
            spectralSnapshotsRef.current.push(result.spectrum)
            energyLevelsRef.current.push(result.energy)
          }
        }
      }, 100)

      // Optional Web Speech API for speech-to-text transcript
      const w = window as unknown as Record<string, unknown>
      const SpeechRecognitionCtor = (w['SpeechRecognition'] || w['webkitSpeechRecognition']) as
        | (new () => { continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: unknown) => void) | null; start(): void; stop(): void })
        | undefined

      if (SpeechRecognitionCtor) {
        try {
          const recognition = new SpeechRecognitionCtor()
          recognition.continuous = false
          recognition.interimResults = true
          recognition.lang = 'en-US'
          recognition.onresult = (e: unknown) => {
            const event = e as { results: { [key: number]: { [key: number]: { transcript: string } } } }
            const res = Object.values(event.results).map((r) => (r[0] as { transcript: string }).transcript).join('')
            setTranscript(res)
          }
          recognition.start()
          recognitionRef.current = recognition
        } catch {
          // Non-critical aid
        }
      }

      // Record audio
      const recorder = new MediaRecorder(stream)
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        ;(recognitionRef.current as { stop?: () => void } | null)?.stop?.()
        cleanupAudio()
        await submitVoice()
      }
      mediaRecorderRef.current = recorder
      recorder.start()

      // Auto-stop after 4.5 seconds
      setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop()
      }, 4500)

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Microphone access denied'
      setMicError(msg)
      setStatus('failed')
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }

  async function submitVoice() {
    setStatus('processing')

    const snapshots = spectralSnapshotsRef.current
    const energies = energyLevelsRef.current

    if (snapshots.length < 3) {
      setStatus('failed')
      setErrorMsg('No audible speech detected. Please speak clearly into your microphone.')
      onFail('No audible speech detected. Retrying voice authorization.')
      return
    }

    // Average acoustic spectrum across time
    const bandCount = snapshots[0].length
    const avgSpectrum = new Array(bandCount).fill(0)
    for (const snap of snapshots) {
      for (let i = 0; i < bandCount; i++) {
        avgSpectrum[i] += snap[i]
      }
    }
    for (let i = 0; i < bandCount; i++) {
      avgSpectrum[i] = Number((avgSpectrum[i] / snapshots.length).toFixed(6))
    }

    const avgEnergy = energies.reduce((a, b) => a + b, 0) / energies.length

    try {
      const res = await fetch('/api/auth/verify?lock=5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceSpectrum: avgSpectrum,
          energyLevel: avgEnergy,
        }),
      })
      const data = await res.json()

      if (res.ok && data.success) {
        onPass()
      } else {
        const left = data.attemptsLeft ?? (attemptsLeft - 1)
        setAttemptsLeft(left)
        setStatus('failed')
        setErrorMsg(data.error || `VOICEPRINT MISMATCH — ${left} ATTEMPT${left !== 1 ? 'S' : ''} LEFT`)
        if (data.revoked) onFail('SECURITY LOCKOUT: SESSION TERMINATED', true)
        else onFail(data.error || `VOICEPRINT MISMATCH — ${left} ATTEMPTS LEFT`)
      }
    } catch {
      setStatus('failed')
      setErrorMsg('NETWORK ERROR — RETRY')
    }
  }

  return (
    <div className="relative fixed inset-0 bg-[#050505] overflow-hidden scanline-overlay hacker-grid flex flex-col items-center justify-center">
      <ParticleBackground color="red" />
      <ScanLines color="red" />
      <div className="absolute top-4 right-4 z-20"><SoundButton enabled={soundEnabled} onToggle={onSoundToggle} /></div>
      <div className="absolute top-4 left-4 z-20"><LockProgress currentLock={5} locksPassed={locksPassed} /></div>

      <div className="relative z-10 flex flex-col items-center gap-6 px-4 max-w-lg w-full text-center">
        <AnimatedSkull color="red" size={100} />

        <div>
          <div className="text-xs font-mono text-red-700 tracking-widest mb-1">BIOMETRIC AUDIO ANALYSIS</div>
          <h2 className="text-2xl font-mono font-bold glow-red uppercase tracking-widest" style={{ color: '#cc0000' }}>
            VOICEPRINT AUTHENTICATION
          </h2>
          <div className="text-xs font-mono text-gray-400 mt-1">LOCK 05 — 64-BAND ACOUSTIC FORMANT VERIFICATION</div>
        </div>

        {/* Challenge phrase */}
        <div className="border border-red-900 bg-black/80 px-6 py-4 font-mono text-sm text-red-300 max-w-sm rounded">
          <div className="text-xs text-red-600 mb-2 font-bold tracking-widest uppercase">RANDOMIZED CHALLENGE PHRASE:</div>
          <div className="text-red-400 italic font-bold">"{challenge}"</div>
        </div>

        {/* Waveform visualizer */}
        <div className="flex flex-col items-center gap-2">
          <Waveform active={status === 'recording'} color="red" />
          {status === 'recording' && (
            <div className="text-red-400 text-xs font-mono animate-pulse">● SAMPLING ACOUSTIC FREQUENCY SPECTRUM...</div>
          )}
        </div>

        {/* Transcript */}
        {transcript && (
          <div className="text-xs font-mono text-gray-400 border border-gray-800 px-4 py-2 max-w-sm bg-black/60">
            DETECTED: "{transcript}"
          </div>
        )}

        {micError && (
          <div className="text-red-500 text-sm font-mono border border-red-900 px-3 py-1">⚠ {micError}</div>
        )}
        {errorMsg && (
          <div className="text-red-500 text-xs font-mono border border-red-900 px-3 py-1">⚠ {errorMsg}</div>
        )}

        {/* Action button */}
        {status !== 'recording' && status !== 'processing' && (
          <button
            onClick={startRecording}
            className="px-8 py-3 font-mono text-sm uppercase tracking-widest border-2 transition-all cursor-pointer"
            style={{ borderColor: '#cc0000', color: '#cc0000', background: 'rgba(204,0,0,0.05)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(204,0,0,0.15)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(204,0,0,0.05)' }}
          >
            {status === 'idle' ? '[ ACTIVATE MICROPHONE ]' : '[ RETRY RECORDING ]'}
          </button>
        )}

        {status === 'recording' && (
          <button
            onClick={stopRecording}
            className="px-8 py-3 font-mono text-sm uppercase tracking-widest border-2 cursor-pointer"
            style={{ borderColor: '#ff0000', color: '#ff0000', background: 'rgba(255,0,0,0.1)' }}
          >
            [ STOP RECORDING ]
          </button>
        )}

        {status === 'processing' && (
          <div className="flex items-center gap-2 text-red-600 font-mono text-sm">
            <HackerSpinner color="red" /> COMPARING ACOUSTIC VOICEPRINT PROFILE...
          </div>
        )}
      </div>
    </div>
  )
}
