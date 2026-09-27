import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createServiceClient } from '@/lib/db/supabase'
import { getClientIP, checkRateLimit, incrementRateLimit } from '@/lib/auth/rate-limit'
import { z } from 'zod'

const setupSchema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
  secretName: z.string().min(4).max(128),
  code: z.string().length(4).regex(/^\d{4}$/, 'Code must be exactly 4 digits'),
  recoveryKey: z.string().min(16).max(256),
  setupToken: z.string().min(1), // Must match SETUP_TOKEN env var
  faceDescriptor: z.array(z.number()).min(32).optional(),
  voiceSpectrum: z.array(z.number()).min(16).optional(),
})

// POST /api/setup — First-time owner enrollment
export async function POST(request: NextRequest) {
  const ip = getClientIP(request)

  // Block if already set up
  if (process.env.SETUP_COMPLETED === 'true') {
    return NextResponse.json(
      { error: 'Setup has already been completed. Contact the vault owner for access.' },
      { status: 403 }
    )
  }

  // Rate limit setup attempts
  const rateCheck = await checkRateLimit(ip, 'setup')
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Too many setup attempts.', retryAfter: rateCheck.retryAfter },
      { status: 429 }
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const parsed = setupSchema.safeParse(body)
  if (!parsed.success) {
    await incrementRateLimit(ip, 'setup')
    return NextResponse.json(
      { error: 'Validation failed.', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { pin, secretName, code, recoveryKey, setupToken, faceDescriptor, voiceSpectrum } = parsed.data

  // Verify the setup token
  const expectedToken = process.env.VAULT_SETUP_TOKEN
  if (!expectedToken || setupToken !== expectedToken) {
    await incrementRateLimit(ip, 'setup')
    return NextResponse.json({ error: 'Invalid setup token.' }, { status: 403 })
  }

  const supabase = createServiceClient()

  // Check if owner already exists
  const { data: existingOwner } = await supabase
    .from('owner_settings')
    .select('id, setup_completed')
    .limit(1)
    .single()

  // Hash all credentials with bcrypt (cost factor 12 for slow hashing)
  const SALT_ROUNDS = 12
  const [pinHash, secretNameHash, codeHash, recoveryKeyHash] = await Promise.all([
    bcrypt.hash(pin, SALT_ROUNDS),
    bcrypt.hash(secretName.trim(), SALT_ROUNDS),
    bcrypt.hash(code, SALT_ROUNDS),
    bcrypt.hash(recoveryKey, SALT_ROUNDS),
  ])

  const faceEnrollmentId = faceDescriptor ? `face_bio_${Date.now()}` : null
  const voiceEnrollmentId = voiceSpectrum ? `voice_bio_${Date.now()}` : null

  if (existingOwner) {
    // Owner is re-configuring or updating their credentials with the valid Master Setup Token
    const updatePayload: Record<string, unknown> = {
      username: 'Hari',
      pin_hash: pinHash,
      secret_name_hash: secretNameHash,
      code_hash: codeHash,
      recovery_key_hash: recoveryKeyHash,
      setup_completed: true,
      updated_at: new Date().toISOString(),
    }

    if (faceDescriptor) {
      updatePayload.face_enrollment_id = faceEnrollmentId
      updatePayload.face_template = JSON.stringify(faceDescriptor)
    }

    if (voiceSpectrum) {
      updatePayload.voice_enrollment_id = voiceEnrollmentId
      updatePayload.voice_template = JSON.stringify(voiceSpectrum)
    }

    const { error: updateError } = await supabase
      .from('owner_settings')
      .update(updatePayload)
      .eq('id', existingOwner.id)

    if (updateError) {
      console.error('Setup update error:', updateError)
      return NextResponse.json({ error: 'Failed to update owner configuration.' }, { status: 500 })
    }

    console.log(`[SETUP] Owner credentials and biometrics updated successfully via Master Setup Token.`)
  } else {
    const { error } = await supabase.from('owner_settings').insert({
      username: 'Hari',
      pin_hash: pinHash,
      secret_name_hash: secretNameHash,
      code_hash: codeHash,
      recovery_key_hash: recoveryKeyHash,
      face_enrollment_id: faceEnrollmentId,
      voice_enrollment_id: voiceEnrollmentId,
      face_template: faceDescriptor ? JSON.stringify(faceDescriptor) : null,
      voice_template: voiceSpectrum ? JSON.stringify(voiceSpectrum) : null,
      setup_completed: true,
    })

    if (error) {
      console.error('Setup error:', error)
      return NextResponse.json({ error: 'Failed to save owner configuration.' }, { status: 500 })
    }
  }

  // Also ensure storage bucket exists
  try {
    const bucketName = process.env.STORAGE_BUCKET || 'vault-media'
    const { data: buckets } = await supabase.storage.listBuckets()
    const exists = buckets?.some((b: { name: string }) => b.name === bucketName)
    if (!exists) {
      await supabase.storage.createBucket(bucketName, {
        public: false,
        allowedMimeTypes: [
          'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
          'video/mp4', 'video/webm', 'video/quicktime', 'video/mpeg',
        ],
        fileSizeLimit: 500 * 1024 * 1024, // 500MB
      })
    }
  } catch {
    // Non-critical — bucket may already exist
  }

  return NextResponse.json({
    success: true,
    message: 'Vault owner enrolled successfully. Set SETUP_COMPLETED=true in your environment variables.',
  })
}

// GET /api/setup — Check setup status
export async function GET() {
  if (process.env.SETUP_COMPLETED === 'true') {
    return NextResponse.json({ setupCompleted: true })
  }

  const supabase = createServiceClient()
  const { data } = await supabase
    .from('owner_settings')
    .select('setup_completed')
    .limit(1)
    .single()

  return NextResponse.json({ setupCompleted: Boolean(data?.setup_completed) })
}
