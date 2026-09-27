'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { getVoiceSystem } from '@/lib/voice/voice-system'

interface Media {
  id: string
  original_filename: string
  mime_type: string
  file_size: number
  is_favorite: boolean
  uploaded_at: string
  width: number | null
  height: number | null
  duration_seconds: number | null
}

interface MediaViewerProps {
  media: Media
  onClose: () => void
  onDelete: () => void
  onFavorite: () => void
}

function formatBytes(b: number) {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

export default function MediaViewer({ media, onClose, onDelete, onFavorite }: MediaViewerProps) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showDetails, setShowDetails] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const isVideo = media.mime_type.startsWith('video/')

  useEffect(() => {
    // Fetch short-lived signed URL
    fetch(`/api/media/${media.id}?action=view`)
      .then(r => r.json())
      .then(d => { setMediaUrl(d.signedUrl); setLoading(false) })
      .catch(() => setLoading(false))
  }, [media.id])

  // Keyboard shortcuts
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.25, 4))
      if (e.key === '-') setZoom(z => Math.max(z - 0.25, 0.5))
      if (e.key === '0') { setZoom(1); setPan({ x: 0, y: 0 }) }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [onClose])

  async function handleDownload() {
    const voice = getVoiceSystem()
    voice.speak('downloading')
    try {
      const res = await fetch(`/api/media/${media.id}?action=download`)
      const data = await res.json()
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.download = media.original_filename
      a.click()
    } catch {
      alert('Download failed. Please try again.')
    }
  }

  // Mouse drag for pan (when zoomed)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }, [zoom, pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    })
  }, [isDragging])

  const handleMouseUp = useCallback(() => setIsDragging(false), [])

  const date = new Date(media.uploaded_at).toLocaleString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'rgba(2,0,10,0.97)' }}
    >
      {/* ── Top controls ─────────────────────────────────────── */}
      <div
        className="absolute top-0 inset-x-0 z-10 flex items-center justify-between px-4 py-3"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-white transition-colors"
            style={{ background: 'rgba(255,255,255,0.1)' }}
          >✕</button>
          <div className="hidden md:block">
            <div className="text-sm text-white font-medium truncate max-w-xs">{media.original_filename}</div>
            <div className="text-xs text-gray-500">{date}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls (images only) */}
          {!isVideo && (
            <div className="flex items-center gap-1 bg-black/50 rounded-full px-2 py-1">
              <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))}
                className="text-gray-300 hover:text-white text-lg px-1">−</button>
              <span className="text-xs text-gray-400 font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(z + 0.25, 4))}
                className="text-gray-300 hover:text-white text-lg px-1">+</button>
            </div>
          )}

          <button
            onClick={() => onFavorite()}
            title="Toggle favorite"
            className="w-8 h-8 rounded-full flex items-center justify-center text-lg transition-all"
            style={{
              background: 'rgba(0,0,0,0.5)',
              color: media.is_favorite ? '#db2777' : '#666',
              textShadow: media.is_favorite ? '0 0 10px #db2777' : 'none',
            }}
          >♥</button>

          <button
            onClick={handleDownload}
            title="Download"
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm text-gray-400 hover:text-white transition-all"
            style={{ background: 'rgba(0,0,0,0.5)' }}
          >↓</button>

          <button
            onClick={() => setShowDetails(d => !d)}
            title="Details"
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm text-gray-400 hover:text-white transition-all"
            style={{ background: 'rgba(0,0,0,0.5)' }}
          >ℹ</button>

          <button
            onClick={onDelete}
            title="Delete"
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm text-gray-400 hover:text-red-400 transition-all"
            style={{ background: 'rgba(0,0,0,0.5)' }}
          >🗑</button>
        </div>
      </div>

      {/* ── Media area ───────────────────────────────────────── */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden"
        style={{ cursor: isDragging ? 'grabbing' : zoom > 1 ? 'grab' : 'default' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {loading && (
          <div className="flex flex-col items-center gap-3 text-purple-400">
            <div className="w-10 h-10 border-2 border-purple-900 border-t-purple-400 rounded-full animate-spin" />
            <div className="text-sm font-mono">Loading...</div>
          </div>
        )}

        {!loading && mediaUrl && !isVideo && (
          <img
            src={mediaUrl}
            alt={media.original_filename}
            className="max-w-full max-h-full object-contain transition-transform duration-200 select-none"
            style={{
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              draggable: false,
            } as React.CSSProperties}
            draggable={false}
          />
        )}

        {!loading && mediaUrl && isVideo && (
          <video
            src={mediaUrl}
            controls
            className="max-w-full max-h-full"
            controlsList="nodownload"
            style={{ outline: 'none' }}
            autoPlay={false}
          />
        )}

        {!loading && !mediaUrl && (
          <div className="text-red-400 font-mono text-sm">Failed to load media.</div>
        )}
      </div>

      {/* ── Details panel ────────────────────────────────────── */}
      {showDetails && (
        <div
          className="absolute right-0 top-14 bottom-0 w-64 p-4 overflow-y-auto"
          style={{ background: 'rgba(5,0,15,0.95)', borderLeft: '1px solid rgba(107,33,168,0.3)' }}
        >
          <div className="text-sm font-serif text-white mb-4">File Details</div>
          {[
            { label: 'Name', value: media.original_filename },
            { label: 'Type', value: media.mime_type },
            { label: 'Size', value: formatBytes(media.file_size) },
            { label: 'Uploaded', value: date },
            media.width && media.height ? { label: 'Dimensions', value: `${media.width} × ${media.height}` } : null,
            media.duration_seconds ? { label: 'Duration', value: `${Math.round(media.duration_seconds)}s` } : null,
          ].filter(Boolean).map(item => item && (
            <div key={item.label} className="mb-3">
              <div className="text-xs font-mono text-purple-500 mb-0.5">{item.label}</div>
              <div className="text-xs text-gray-300 break-all">{item.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
