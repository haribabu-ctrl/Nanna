'use client'

import { useEffect, useRef } from 'react'

// Animated skull SVG component
export function AnimatedSkull({
  color = 'red',
  size = 120,
  className = '',
}: {
  color?: 'red' | 'green'
  size?: number
  className?: string
}) {
  const c = color === 'red' ? '#cc0000' : '#00ff41'
  const glow = color === 'red' ? '#ff0000' : '#00ff41'

  return (
    <div
      className={`skull-animate ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" width={size} height={size}>
        <defs>
          <filter id={`glow-${color}`}>
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter={`url(#glow-${color})`} stroke={c} strokeWidth="1.5" fill="none">
          {/* Skull dome */}
          <path d="M20,55 Q15,25 50,18 Q85,25 80,55 L75,65 L25,65 Z" fill={`${c}22`} />
          {/* Jaw */}
          <rect x="28" y="65" width="44" height="18" rx="4" fill={`${c}22`} />
          {/* Teeth */}
          <rect x="30" y="65" width="8" height="10" rx="2" fill={`${c}44`} />
          <rect x="41" y="65" width="8" height="10" rx="2" fill={`${c}44`} />
          <rect x="52" y="65" width="8" height="10" rx="2" fill={`${c}44`} />
          <rect x="63" y="65" width="8" height="10" rx="2" fill={`${c}44`} />
          {/* Eye sockets */}
          <ellipse cx="36" cy="48" rx="10" ry="10" fill={glow} opacity="0.8" />
          <ellipse cx="64" cy="48" rx="10" ry="10" fill={glow} opacity="0.8" />
          {/* Nose */}
          <path d="M46,56 L50,62 L54,56" fill={`${c}66`} />
          {/* Cheekbones */}
          <path d="M22,58 Q28,62 32,60" />
          <path d="M78,58 Q72,62 68,60" />
          {/* Top detail lines */}
          <path d="M35,25 Q50,20 65,25" strokeDasharray="3,3" opacity="0.5" />
          <path d="M30,35 Q50,30 70,35" strokeDasharray="2,4" opacity="0.3" />
        </g>
      </svg>
    </div>
  )
}

// Scanning laser lines
export function ScanLines({ color = 'red' }: { color?: 'red' | 'green' }) {
  const c = color === 'red' ? 'rgba(204,0,0,0.4)' : 'rgba(0,255,65,0.4)'
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className="absolute w-full h-px"
          style={{
            top: `${12 + i * 12}%`,
            background: `linear-gradient(90deg, transparent, ${c}, transparent)`,
            animation: `scan-horizontal ${2 + i * 0.3}s linear infinite`,
            animationDelay: `${i * 0.4}s`,
            opacity: 0.6,
          }}
        />
      ))}
    </div>
  )
}

// Digital particle background
export function ParticleBackground({ color = 'red' }: { color?: 'red' | 'green' }) {
  const c = color === 'red' ? '#cc0000' : '#00ff41'
  const chars = ['0', '1', 'X', 'Ψ', 'Ω', '∆', '◆', '▓', '░', '╬', '⬡']

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-20">
      {[...Array(40)].map((_, i) => (
        <div
          key={i}
          className="absolute text-xs font-mono"
          style={{
            color: c,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animation: `data-stream ${3 + Math.random() * 5}s linear infinite`,
            animationDelay: `${Math.random() * 5}s`,
          }}
        >
          {chars[Math.floor(Math.random() * chars.length)]}
        </div>
      ))}
    </div>
  )
}

// Progress indicator for 6 locks
export function LockProgress({ currentLock, locksPassed }: { currentLock: number; locksPassed: number }) {
  const LOCK_BITS = [1, 2, 4, 8, 16, 32]

  return (
    <div className="flex items-center gap-3 justify-center">
      {LOCK_BITS.map((bit, i) => {
        const passed = (locksPassed & bit) === bit
        const active = i + 1 === currentLock && !passed
        return (
          <div key={i} className="flex flex-col items-center gap-1">
            <div
              className={`progress-dot ${passed ? 'passed' : active ? 'active' : ''}`}
            />
            <span className="text-xs font-mono opacity-50" style={{ color: passed ? '#00ff41' : active ? '#ff0000' : '#444' }}>
              {i + 1}
            </span>
          </div>
        )
      })}
      <span className="ml-2 text-xs font-mono text-gray-500">
        LOCK {currentLock}/6
      </span>
    </div>
  )
}

// Glitch error overlay
export function GlitchError({ message, visible }: { message: string; visible: boolean }) {
  if (!visible) return null
  return (
    <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center">
      <div
        className="px-8 py-4 border border-red-600 bg-red-900/20 text-red-400 font-mono text-lg uppercase tracking-widest"
        style={{ animation: 'glitch 0.3s steps(1) forwards' }}
      >
        ⚠ {message}
      </div>
    </div>
  )
}

// Sound control button
export function SoundButton({
  enabled,
  onToggle,
  onReplay,
}: {
  enabled: boolean
  onToggle: () => void
  onReplay?: () => void
}) {
  return (
    <div className="flex gap-2">
      <button
        onClick={onToggle}
        className="px-3 py-1 text-xs font-mono border rounded transition-all"
        style={{
          borderColor: enabled ? '#00ff41' : '#444',
          color: enabled ? '#00ff41' : '#666',
          background: 'transparent',
        }}
        title={enabled ? 'Disable sound' : 'Enable sound'}
      >
        {enabled ? '🔊 SOUND ON' : '🔇 SOUND OFF'}
      </button>
      {onReplay && (
        <button
          onClick={onReplay}
          className="px-3 py-1 text-xs font-mono border border-gray-700 text-gray-500 rounded transition-all hover:border-red-600 hover:text-red-400"
          title="Replay voice"
        >
          ▶ REPLAY
        </button>
      )}
    </div>
  )
}

// Waveform visualizer
export function Waveform({ active, color = 'red' }: { active: boolean; color?: 'red' | 'green' }) {
  const c = color === 'red' ? '#cc0000' : '#00ff41'
  return (
    <div className="flex items-end gap-1 h-8">
      {[...Array(16)].map((_, i) => (
        <div
          key={i}
          className="wave-bar"
          style={{
            background: c,
            animationPlayState: active ? 'running' : 'paused',
            animationDuration: `${0.3 + (i % 5) * 0.1}s`,
            animationDelay: `${i * 0.05}s`,
            height: active ? undefined : '4px',
            opacity: active ? 0.9 : 0.3,
          }}
        />
      ))}
    </div>
  )
}

// Loading spinner
export function HackerSpinner({ color = 'red' }: { color?: 'red' | 'green' }) {
  const c = color === 'red' ? '#cc0000' : '#00ff41'
  return (
    <div
      className="w-8 h-8 border-2 border-transparent rounded-full"
      style={{
        borderTopColor: c,
        borderRightColor: `${c}44`,
        animation: 'rotate-slow 0.8s linear infinite',
      }}
    />
  )
}
