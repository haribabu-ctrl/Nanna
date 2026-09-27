'use client'

import { useState, useEffect, useCallback } from 'react'
import { SoundButton } from '@/components/ui/hacker-ui'
import { getVoiceSystem } from '@/lib/voice/voice-system'
import MediaGrid from '@/components/vault/MediaGrid'
import MediaViewer from '@/components/media/MediaViewer'
import UploadZone from '@/components/media/UploadZone'

type Section = 'all' | 'photos' | 'videos' | 'favorites' | 'recent' | 'settings'

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

interface VaultDashboardProps {
  soundEnabled: boolean
  onSoundToggle: () => void
}

const NAV_ITEMS: { id: Section; label: string; icon: string }[] = [
  { id: 'all', label: 'All Memories', icon: '◈' },
  { id: 'photos', label: 'Photos', icon: '◎' },
  { id: 'videos', label: 'Videos', icon: '▶' },
  { id: 'favorites', label: 'Favorites', icon: '♥' },
  { id: 'recent', label: 'Recently Added', icon: '◷' },
  { id: 'settings', label: 'Vault Settings', icon: '⚙' },
]

export default function VaultDashboard({ soundEnabled, onSoundToggle }: VaultDashboardProps) {
  const [section, setSection] = useState<Section>('all')
  const [media, setMedia] = useState<Media[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selectedMedia, setSelectedMedia] = useState<Media | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const fetchMedia = useCallback(async (sec: Section) => {
    if (sec === 'settings') return
    setLoading(true)
    try {
      const res = await fetch(`/api/media?section=${sec}`)
      const data = await res.json()
      setMedia(data.media || [])
      setTotal(data.total || 0)
    } catch {
      setMedia([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMedia(section)
  }, [section, fetchMedia])

  async function handleLogout() {
    const voice = getVoiceSystem()
    voice.speak('logout')
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/'
  }

  async function handleDelete(id: string) {
    const voice = getVoiceSystem()
    voice.speak('deleting')
    setDeleteConfirm(id)
  }

  async function confirmDelete(id: string) {
    try {
      await fetch(`/api/media/${id}`, { method: 'DELETE' })
      setMedia(m => m.filter(item => item.id !== id))
      setDeleteConfirm(null)
      if (selectedMedia?.id === id) setSelectedMedia(null)
    } catch {
      alert('Failed to delete. Please try again.')
    }
  }

  async function toggleFavorite(id: string) {
    const item = media.find(m => m.id === id)
    if (!item) return
    await fetch(`/api/media/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorite: !item.is_favorite }),
    })
    setMedia(m => m.map(item => item.id === id ? { ...item, is_favorite: !item.is_favorite } : item))
  }

  return (
    <div className="fixed inset-0 vault-gradient flex flex-col overflow-hidden">
      {/* ── Soft particle overlay ───────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none opacity-10">
        {[...Array(30)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: Math.random() * 4 + 1,
              height: Math.random() * 4 + 1,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              background: Math.random() > 0.5 ? '#6b21a8' : '#db2777',
              animation: `data-stream ${5 + Math.random() * 10}s linear infinite`,
              animationDelay: `${Math.random() * 8}s`,
            }}
          />
        ))}
      </div>

      {/* ── Top navbar ───────────────────────────────────────── */}
      <nav className="relative z-10 h-14 flex items-center justify-between px-4 md:px-6"
        style={{ background: 'rgba(5,0,15,0.9)', borderBottom: '1px solid rgba(107,33,168,0.3)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="md:hidden text-purple-400 text-xl"
          >☰</button>
          <div>
            <span className="font-serif text-lg md:text-xl text-white tracking-widest" style={{ textShadow: '0 0 20px #6b21a8' }}>
              Our Memories
            </span>
            <div className="text-xs text-purple-500 font-mono hidden md:block">Every moment, safely preserved.</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => { setShowUpload(true); getVoiceSystem().speak('uploading') }}
            className="px-4 py-1.5 text-sm font-mono rounded-full transition-all"
            style={{
              background: 'linear-gradient(135deg, #6b21a8, #db2777)',
              color: 'white',
              boxShadow: '0 0 20px rgba(107,33,168,0.4)',
            }}
          >
            + Upload
          </button>
          <SoundButton enabled={soundEnabled} onToggle={onSoundToggle} />
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 text-xs font-mono text-purple-400 border border-purple-900 rounded transition-all hover:border-purple-500 hover:text-purple-300"
          >
            LOCK VAULT
          </button>
        </div>
      </nav>

      <div className="relative z-10 flex flex-1 overflow-hidden">
        {/* ── Sidebar ────────────────────────────────────────── */}
        <aside
          className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 
            fixed md:relative z-20 md:z-auto top-14 md:top-0 left-0 h-full md:h-auto
            w-64 flex-shrink-0 flex flex-col transition-transform duration-300`}
          style={{ background: 'rgba(5,0,15,0.95)', borderRight: '1px solid rgba(107,33,168,0.2)' }}
        >
          <div className="p-4 border-b border-purple-900/30">
            <div className="text-xs font-mono text-purple-600 tracking-widest">PRIVATE VAULT</div>
            <div className="text-sm font-mono text-purple-300 mt-1">Hari's Memories</div>
          </div>

          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => { setSection(item.id); setSidebarOpen(false) }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-mono transition-all text-left ${
                  section === item.id
                    ? 'text-white'
                    : 'text-purple-400 hover:text-purple-200'
                }`}
                style={{
                  background: section === item.id
                    ? 'linear-gradient(135deg, rgba(107,33,168,0.4), rgba(219,39,119,0.2))'
                    : 'transparent',
                  borderLeft: section === item.id ? '2px solid #db2777' : '2px solid transparent',
                }}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="p-4 border-t border-purple-900/30">
            <div className="text-xs font-mono text-gray-600">{total} items stored</div>
          </div>
        </aside>

        {/* ── Main content ──────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {/* Section header */}
          <div className="mb-6">
            <h2 className="text-xl md:text-2xl font-serif text-white"
              style={{ textShadow: '0 0 20px rgba(107,33,168,0.5)' }}
            >
              {NAV_ITEMS.find(n => n.id === section)?.label}
            </h2>
            <div className="mt-1 h-px max-w-xs" style={{
              background: 'linear-gradient(90deg, #6b21a8, #db2777, transparent)'
            }} />
          </div>

          {section === 'settings' ? (
            <VaultSettings onLogout={handleLogout} />
          ) : loading ? (
            <SkeletonGrid />
          ) : media.length === 0 ? (
            <EmptyState section={section} onUpload={() => setShowUpload(true)} />
          ) : (
            <MediaGrid
              media={media}
              onSelect={setSelectedMedia}
              onDelete={handleDelete}
              onFavorite={toggleFavorite}
            />
          )}
        </main>
      </div>

      {/* ── Media Viewer Modal ────────────────────────────────── */}
      {selectedMedia && (
        <MediaViewer
          media={selectedMedia}
          onClose={() => setSelectedMedia(null)}
          onDelete={() => handleDelete(selectedMedia.id)}
          onFavorite={() => toggleFavorite(selectedMedia.id)}
        />
      )}

      {/* ── Upload Zone Modal ─────────────────────────────────── */}
      {showUpload && (
        <UploadZone
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); fetchMedia(section) }}
        />
      )}

      {/* ── Delete confirmation modal ─────────────────────────── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div
            className="max-w-sm w-full mx-4 p-6 rounded-xl border"
            style={{ background: 'rgba(5,0,15,0.95)', borderColor: 'rgba(219,39,119,0.4)' }}
          >
            <div className="text-lg font-serif text-white mb-2">Delete this memory?</div>
            <div className="text-sm text-gray-400 mb-6">This action is permanent and cannot be undone.</div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2 border border-gray-700 text-gray-400 rounded-lg text-sm font-mono hover:border-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmDelete(deleteConfirm)}
                className="flex-1 py-2 rounded-lg text-sm font-mono text-white"
                style={{ background: 'linear-gradient(135deg, #7f1d1d, #991b1b)' }}
              >
                Delete Forever
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {[...Array(12)].map((_, i) => (
        <div
          key={i}
          className="aspect-square rounded-xl"
          style={{ background: 'rgba(107,33,168,0.1)', animation: 'pulse-red 2s infinite' }}
        />
      ))}
    </div>
  )
}

function EmptyState({ section, onUpload }: { section: Section; onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-64 gap-4 text-center">
      <div className="text-5xl opacity-20">◈</div>
      <div className="text-purple-300 font-serif text-lg">No memories here yet</div>
      <div className="text-gray-500 text-sm font-mono">
        {section === 'favorites' ? 'Heart a photo or video to see it here.' : 'Upload your first memory to begin.'}
      </div>
      {section !== 'favorites' && (
        <button
          onClick={onUpload}
          className="px-6 py-2 text-sm font-mono rounded-full text-white"
          style={{ background: 'linear-gradient(135deg, #6b21a8, #db2777)' }}
        >
          Upload Memory
        </button>
      )}
    </div>
  )
}

function VaultSettings({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="max-w-lg space-y-4">
      {[
        { label: 'Authentication', value: 'Six-Layer Biometric Active', note: 'All 6 locks are configured.' },
        { label: 'Storage', value: 'Private Supabase Bucket', note: 'Files stored with private access only.' },
        { label: 'Session', value: '24 Hours', note: 'Session expires after 24 hours of inactivity.' },
        { label: 'Encryption', value: 'TLS 1.3 in Transit', note: 'All files encrypted in transit and at rest.' },
      ].map(item => (
        <div key={item.label} className="rounded-xl p-4 border"
          style={{ background: 'rgba(107,33,168,0.05)', borderColor: 'rgba(107,33,168,0.2)' }}
        >
          <div className="flex justify-between items-start">
            <span className="text-sm font-mono text-purple-300">{item.label}</span>
            <span className="text-xs font-mono text-green-500">{item.value}</span>
          </div>
          <p className="text-xs text-gray-600 mt-1">{item.note}</p>
        </div>
      ))}

      <a
        href="/auth/re-enroll-face"
        className="block text-center w-full py-3 border border-purple-900/60 text-purple-400 font-mono text-sm rounded-lg hover:bg-purple-950/20 hover:border-purple-600 transition-all"
      >
        RE-ENROLL FACE BIOMETRICS
      </a>

      <button
        onClick={onLogout}
        className="w-full py-3 border border-red-900 text-red-500 font-mono text-sm rounded-lg hover:bg-red-900/20 transition-all"
      >
        LOCK VAULT & SIGN OUT
      </button>
    </div>
  )
}
