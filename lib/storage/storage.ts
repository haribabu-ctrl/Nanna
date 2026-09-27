import { createServiceClient } from '@/lib/db/supabase'

const BUCKET = process.env.STORAGE_BUCKET || 'vault-media'

// Generate a signed URL for private uploads
export async function getUploadSignedUrl(
  storageKey: string,
  expiresInSeconds: number = 300 // 5 minutes to complete upload
): Promise<string> {
  const supabase = createServiceClient()
  
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storageKey)

  if (error || !data) {
    throw new Error(`Failed to create upload URL: ${error?.message}`)
  }

  return data.signedUrl
}

// Generate a short-lived signed URL for viewing/downloading
export async function getDownloadSignedUrl(
  storageKey: string,
  expiresInSeconds: number = 120 // 2 minutes
): Promise<string> {
  const supabase = createServiceClient()
  
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storageKey, expiresInSeconds)

  if (error || !data) {
    throw new Error(`Failed to create download URL: ${error?.message}`)
  }

  return data.signedUrl
}

// Delete a file from storage
export async function deleteStorageFile(storageKey: string): Promise<void> {
  const supabase = createServiceClient()
  
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([storageKey])

  if (error) {
    throw new Error(`Failed to delete file: ${error.message}`)
  }
}

// Delete multiple files
export async function deleteStorageFiles(storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return
  
  const supabase = createServiceClient()
  
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove(storageKeys)

  if (error) {
    throw new Error(`Failed to delete files: ${error.message}`)
  }
}

// Generate a storage key for a new upload
export function generateStorageKey(
  ownerId: string,
  originalFilename: string,
  suffix?: string
): string {
  const timestamp = Date.now()
  const safeFilename = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase()
  const base = suffix ? `${timestamp}_${suffix}_${safeFilename}` : `${timestamp}_${safeFilename}`
  return `${ownerId}/${base}`
}

// Validate allowed file types
export function isAllowedMediaType(mimeType: string): boolean {
  const allowed = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
    'video/mpeg',
    'video/ogg',
  ]
  return allowed.includes(mimeType.toLowerCase())
}

// Maximum file size: 500MB for videos, 50MB for images
export function getMaxFileSize(mimeType: string): number {
  if (mimeType.startsWith('video/')) {
    return 500 * 1024 * 1024 // 500MB
  }
  return 50 * 1024 * 1024 // 50MB
}
