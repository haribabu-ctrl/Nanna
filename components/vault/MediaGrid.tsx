'use client'

import { useState, useEffect } from 'react'

interface Media {
  id: string
  original_filename: string
  mime_type: string
  file_size: number
  thumbnail_key: string | null
  album_id: string | null
  is_favorite: boolean
  uploaded_at: string
  width: number | null
  height: number | null
  duration_seconds: number | null
}

interface MediaGridProps {
  media: Media[]
  onSelect: (media: Media) => void
  onDelete: (id: string) => void
  onFavorite: (id: string) => void
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(secs: number | null) {
  if (!secs) return ''
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Single card component with thumbnail fetching
function MediaCard({
  item,
  onSelect,
  onDelete,
  onFavorite,
}: {
  item: Media
  onSelect: (m: Media) => void
  onDelete: (id: string) => void
  onFavorite: (id: string) => void
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [hovered, setHovered] = useState(false)
  const isVideo = item.mime_type.startsWith('video/')

  useEffect(() => {
    // Fetch a short-lived signed thumbnail URL
    let cancelled = false
    fetch(`/api/media/${item.id}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && d.thumbnailUrl) setThumbUrl(d.thumbnailUrl) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [item.id])

  const date = new Date(item.uploaded_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  return (
    <div
      className="media-card relative group rounded-xl overflow-hidden cursor-pointer select-none"
      style={{
        background: 'rgba(10,0,25,0.8)',
        border: '1px solid rgba(107,33,168,0.25)',
        aspectRatio: '1',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(item)}
    >
      {/* Thumbnail */}
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt={item.original_filename}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-4xl opacity-30">{isVideo ? '▶' : '◎'}</span>
        </div>
      )}

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

      {/* Video badge */}
      {isVideo && (
        <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-xs font-mono bg-black/70 text-purple-300">
          ▶ {formatDuration(item.duration_seconds)}
        </div>
      )}

      {/* Favorite badge */}
      {item.is_favorite && (
        <div className="absolute top-2 right-2 text-pink-400 text-sm" style={{ textShadow: '0 0 8px #db2777' }}>
          ♥
        </div>
      )}

      {/* Hover actions */}
      <div className={`absolute inset-x-0 bottom-0 p-2 flex items-end justify-between transition-all duration-200 ${hovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
        <div className="text-xs font-mono text-gray-300 truncate max-w-[70%]">{date}</div>
        <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onFavorite(item.id)}
            title="Favorite"
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm transition-all"
            style={{ background: 'rgba(0,0,0,0.7)', color: item.is_favorite ? '#db2777' : '#888' }}
          >♥</button>
          <button
            onClick={() => onDelete(item.id)}
            title="Delete"
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm transition-all"
            style={{ background: 'rgba(0,0,0,0.7)', color: '#666' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#666' }}
          >✕</button>
        </div>
      </div>
    </div>
  )
}

export default function MediaGrid({ media, onSelect, onDelete, onFavorite }: MediaGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {media.map(item => (
        <MediaCard
          key={item.id}
          item={item}
          onSelect={onSelect}
          onDelete={onDelete}
          onFavorite={onFavorite}
        />
      ))}
    </div>
  )
}
