'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { getVoiceSystem } from '@/lib/voice/voice-system'

interface UploadZoneProps {
  onClose: () => void
  onUploaded: () => void
}

interface FileItem {
  file: File
  id: string
  status: 'pending' | 'uploading' | 'done' | 'error'
  progress: number
  previewUrl?: string
  errorMsg?: string
  mediaId?: string
}

const ALLOWED_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/mpeg', 'video/ogg',
]

function formatBytes(b: number) {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

export default function UploadZone({ onClose, onUploaded }: UploadZoneProps) {
  const [files, setFiles] = useState<FileItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())

  useEffect(() => {
    // Cleanup preview URLs on unmount
    return () => {
      files.forEach(f => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl) })
    }
  }, [])

  const addFiles = useCallback((incoming: File[]) => {
    const newItems: FileItem[] = incoming
      .filter(f => ALLOWED_TYPES.includes(f.type))
      .map(f => ({
        file: f,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        status: 'pending' as const,
        progress: 0,
        previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
      }))
    setFiles(prev => [...prev, ...newItems])
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }, [addFiles])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files))
  }, [addFiles])

  const removeFile = (id: string) => {
    setFiles(prev => {
      const item = prev.find(f => f.id === id)
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return prev.filter(f => f.id !== id)
    })
    abortControllersRef.current.get(id)?.abort()
  }

  const updateFile = (id: string, updates: Partial<FileItem>) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f))
  }

  async function uploadSingle(item: FileItem): Promise<void> {
    const controller = new AbortController()
    abortControllersRef.current.set(item.id, controller)

    updateFile(item.id, { status: 'uploading', progress: 5 })

    try {
      // Step 1: Request signed upload URL
      const metaRes = await fetch('/api/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: item.file.name,
          mimeType: item.file.type || 'application/octet-stream',
          fileSize: item.file.size,
        }),
        signal: controller.signal,
      })

      if (!metaRes.ok) {
        const err = await metaRes.json()
        throw new Error(err.error || 'Failed to get upload URL')
      }

      const { signedUrl, mediaId } = await metaRes.json()
      updateFile(item.id, { progress: 15, mediaId })

      // Step 2: Upload directly to Supabase Storage using signed URL
      await uploadWithProgress(signedUrl, item.file, (progress) => {
        updateFile(item.id, { progress: 15 + Math.round(progress * 0.8) })
      }, controller.signal)

      updateFile(item.id, { status: 'done', progress: 100 })

    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const msg = err instanceof Error ? err.message : 'Upload failed'
      updateFile(item.id, { status: 'error', errorMsg: msg })
    } finally {
      abortControllersRef.current.delete(item.id)
    }
  }

  function uploadWithProgress(
    url: string,
    file: File,
    onProgress: (p: number) => void,
    signal: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      signal.addEventListener('abort', () => { xhr.abort(); reject(new DOMException('Aborted', 'AbortError')) })
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
      xhr.onload = () => { xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)) }
      xhr.onerror = () => reject(new Error('Network error during upload'))
      xhr.open('PUT', url)
      xhr.setRequestHeader('Content-Type', file.type)
      xhr.send(file)
    })
  }

  async function startUpload() {
    const pending = files.filter(f => f.status === 'pending' || f.status === 'error')
    if (pending.length === 0) return

    setUploading(true)
    const voice = getVoiceSystem()
    voice.speak('uploading')

    // Upload sequentially to avoid overwhelming the connection
    for (const item of pending) {
      await uploadSingle(item)
    }

    setUploading(false)

    const allDone = files.every(f => f.status === 'done' || f.status === 'error')
    if (allDone) {
      voice.speak('upload_complete')
      setTimeout(onUploaded, 800)
    }
  }

  const pendingCount = files.filter(f => f.status === 'pending' || f.status === 'error').length
  const doneCount = files.filter(f => f.status === 'done').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
      <div
        className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{ background: 'rgba(5,0,15,0.97)', border: '1px solid rgba(107,33,168,0.4)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'rgba(107,33,168,0.2)' }}>
          <div>
            <h3 className="text-white font-serif text-lg">Upload Memories</h3>
            <p className="text-xs font-mono text-purple-500 mt-0.5">Photos &amp; Videos · Private &amp; Secure</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl transition-colors">✕</button>
        </div>

        {/* Drop zone */}
        <div
          className="mx-6 mt-4 rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-8 gap-3 transition-all cursor-pointer"
          style={{
            borderColor: dragging ? '#db2777' : 'rgba(107,33,168,0.4)',
            background: dragging ? 'rgba(219,39,119,0.05)' : 'rgba(107,33,168,0.03)',
          }}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="text-3xl opacity-40">◈</div>
          <div className="text-purple-300 font-serif">Drop files here or click to browse</div>
          <div className="text-xs font-mono text-gray-600">
            JPG · PNG · WebP · HEIC · MP4 · WebM · MOV
          </div>
          <div className="text-xs font-mono text-gray-700">
            Max 50MB images · 500MB videos
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ALLOWED_TYPES.join(',')}
            className="hidden"
            onChange={handleFileInput}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
            {files.map(item => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-lg p-3"
                style={{ background: 'rgba(107,33,168,0.08)', border: '1px solid rgba(107,33,168,0.15)' }}
              >
                {/* Preview */}
                <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
                  style={{ background: 'rgba(0,0,0,0.5)' }}>
                  {item.previewUrl
                    ? <img src={item.previewUrl} className="w-full h-full object-cover" alt="" />
                    : <span className="text-purple-400 text-xl">{item.file.type.startsWith('video/') ? '▶' : '◎'}</span>
                  }
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{item.file.name}</div>
                  <div className="text-xs font-mono text-gray-500">{formatBytes(item.file.size)}</div>
                  {item.status === 'uploading' && (
                    <div className="mt-1.5 h-1 bg-purple-950 rounded overflow-hidden">
                      <div
                        className="h-full rounded transition-all"
                        style={{
                          width: `${item.progress}%`,
                          background: 'linear-gradient(90deg, #6b21a8, #db2777)',
                        }}
                      />
                    </div>
                  )}
                  {item.status === 'error' && (
                    <div className="text-xs text-red-400 mt-0.5">⚠ {item.errorMsg}</div>
                  )}
                </div>

                {/* Status */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {item.status === 'done' && <span className="text-green-400 text-sm">✓</span>}
                  {item.status === 'uploading' && (
                    <span className="text-xs font-mono text-purple-400">{item.progress}%</span>
                  )}
                  {item.status === 'error' && <span className="text-red-400 text-sm">✕</span>}
                  {(item.status === 'pending' || item.status === 'error') && !uploading && (
                    <button
                      onClick={() => removeFile(item.id)}
                      className="text-gray-600 hover:text-red-400 text-sm transition-colors"
                    >✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: 'rgba(107,33,168,0.2)' }}>
          <div className="text-xs font-mono text-gray-600">
            {doneCount > 0 && <span className="text-green-500">{doneCount} uploaded · </span>}
            {files.length} file{files.length !== 1 ? 's' : ''} selected
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-mono text-gray-400 border border-gray-800 rounded-lg hover:border-gray-600 transition-all"
            >
              Close
            </button>
            <button
              onClick={startUpload}
              disabled={uploading || pendingCount === 0}
              className="px-6 py-2 text-sm font-mono text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #6b21a8, #db2777)' }}
            >
              {uploading ? 'Uploading...' : `Upload ${pendingCount > 0 ? pendingCount : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
