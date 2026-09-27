import { NextRequest, NextResponse } from 'next/server'
import { getSession, allLocksCleared } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/db/supabase'
import {
  generateStorageKey,
  isAllowedMediaType,
  getMaxFileSize,
  getUploadSignedUrl,
} from '@/lib/storage/storage'
import { z } from 'zod'

// GET /api/media — List all media for authenticated owner
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session || !allLocksCleared(session.locksPassed)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const url = new URL(request.url)
  const section = url.searchParams.get('section') || 'all'
  const albumId = url.searchParams.get('albumId')
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100)
  const offset = (page - 1) * limit

  const supabase = createServiceClient()

  let query = supabase
    .from('media')
    .select('id, original_filename, mime_type, file_size, thumbnail_key, album_id, is_favorite, uploaded_at, width, height, duration_seconds', { count: 'exact' })
    .eq('owner_id', session.ownerId)
    .eq('is_deleted', false)
    .order('uploaded_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (section === 'photos') {
    query = query.like('mime_type', 'image/%')
  } else if (section === 'videos') {
    query = query.like('mime_type', 'video/%')
  } else if (section === 'favorites') {
    query = query.eq('is_favorite', true)
  } else if (section === 'recent') {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('uploaded_at', oneWeekAgo)
  }

  if (albumId) {
    query = query.eq('album_id', albumId)
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch media.' }, { status: 500 })
  }

  return NextResponse.json({ media: data || [], total: count || 0, page, limit })
}

// POST /api/media — Request a signed upload URL
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session || !allLocksCleared(session.locksPassed)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const schema = z.object({
    filename: z.string().min(1).max(256),
    mimeType: z.string().min(1).max(128),
    fileSize: z.number().positive(),
    albumId: z.string().uuid().optional(),
  })

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', issues: parsed.error.issues }, { status: 400 })
  }

  const { filename, mimeType, fileSize, albumId } = parsed.data

  if (!isAllowedMediaType(mimeType)) {
    return NextResponse.json({ error: `File type "${mimeType}" is not allowed.` }, { status: 400 })
  }

  const maxSize = getMaxFileSize(mimeType)
  if (fileSize > maxSize) {
    return NextResponse.json(
      { error: `File too large. Maximum size: ${Math.round(maxSize / 1024 / 1024)}MB.` },
      { status: 400 }
    )
  }

  const storageKey = generateStorageKey(session.ownerId, filename)
  const thumbnailKey = generateStorageKey(session.ownerId, filename, 'thumb')

  // Create media record (pending upload)
  const supabase = createServiceClient()
  const { data: media, error } = await supabase
    .from('media')
    .insert({
      owner_id: session.ownerId,
      original_filename: filename,
      storage_key: storageKey,
      thumbnail_key: thumbnailKey,
      mime_type: mimeType,
      file_size: fileSize,
      album_id: albumId || null,
    })
    .select('id')
    .single()

  if (error || !media) {
    return NextResponse.json({ error: 'Failed to create media record.' }, { status: 500 })
  }

  // Get signed upload URL
  const signedUrl = await getUploadSignedUrl(storageKey, 300)

  return NextResponse.json({
    mediaId: media.id,
    storageKey,
    thumbnailKey,
    signedUrl,
  })
}
