import { NextRequest, NextResponse } from 'next/server'
import { getSession, allLocksCleared } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/db/supabase'
import { getDownloadSignedUrl, deleteStorageFile, deleteStorageFiles } from '@/lib/storage/storage'
import { z } from 'zod'

type Params = { params: Promise<{ id: string }> }

// Verify media belongs to authenticated owner
async function verifyOwnership(mediaId: string, ownerId: string) {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('media')
    .select('*')
    .eq('id', mediaId)
    .eq('owner_id', ownerId)
    .eq('is_deleted', false)
    .single()
  return data
}

// GET /api/media/[id] — get a short-lived signed view URL
export async function GET(request: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !allLocksCleared(session.locksPassed)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const { id } = await params
  const media = await verifyOwnership(id, session.ownerId)
  if (!media) {
    return NextResponse.json({ error: 'Media not found.' }, { status: 404 })
  }

  const url = new URL(request.url)
  const action = url.searchParams.get('action') || 'view'
  const expiresIn = action === 'download' ? 300 : 120 // 5 min download, 2 min view

  const signedUrl = await getDownloadSignedUrl(media.storage_key, expiresIn)
  let thumbnailUrl: string | null = null

  if (media.thumbnail_key) {
    try {
      thumbnailUrl = await getDownloadSignedUrl(media.thumbnail_key, expiresIn)
    } catch {
      // Thumbnail might not exist yet
    }
  }

  return NextResponse.json({
    id: media.id,
    signedUrl,
    thumbnailUrl,
    mimeType: media.mime_type,
    originalFilename: media.original_filename,
    fileSize: media.file_size,
    isFavorite: media.is_favorite,
    uploadedAt: media.uploaded_at,
    width: media.width,
    height: media.height,
    durationSeconds: media.duration_seconds,
  })
}

// PATCH /api/media/[id] — update metadata (favorite, album)
export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !allLocksCleared(session.locksPassed)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const { id } = await params
  const media = await verifyOwnership(id, session.ownerId)
  if (!media) {
    return NextResponse.json({ error: 'Media not found.' }, { status: 404 })
  }

  const body = await request.json().catch(() => ({}))
  const schema = z.object({
    isFavorite: z.boolean().optional(),
    albumId: z.string().uuid().nullable().optional(),
  })

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid update data.' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (parsed.data.isFavorite !== undefined) updates.is_favorite = parsed.data.isFavorite
  if (parsed.data.albumId !== undefined) updates.album_id = parsed.data.albumId

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('media')
    .update(updates)
    .eq('id', id)
    .eq('owner_id', session.ownerId)

  if (error) {
    return NextResponse.json({ error: 'Failed to update media.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// DELETE /api/media/[id] — soft-delete, then permanently delete from storage
export async function DELETE(request: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !allLocksCleared(session.locksPassed)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const { id } = await params
  const media = await verifyOwnership(id, session.ownerId)
  if (!media) {
    return NextResponse.json({ error: 'Media not found.' }, { status: 404 })
  }

  const supabase = createServiceClient()

  // First delete from storage (permanent)
  const storageKeys = [media.storage_key]
  if (media.thumbnail_key) storageKeys.push(media.thumbnail_key)

  try {
    await deleteStorageFiles(storageKeys)
  } catch (err) {
    // If storage deletion fails, do NOT mark DB record as deleted
    console.error('Storage deletion failed:', err)
    return NextResponse.json(
      { error: 'Failed to delete file from storage. Media record preserved.' },
      { status: 500 }
    )
  }

  // Only mark as deleted in DB after successful storage deletion
  const { error: dbError } = await supabase
    .from('media')
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_id', session.ownerId)

  if (dbError) {
    return NextResponse.json(
      { error: 'Storage deleted but DB update failed. Please contact support.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
