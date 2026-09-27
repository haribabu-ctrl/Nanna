import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createServiceClient } from '@/lib/db/supabase'
import {
  getClientIP,
  checkRateLimit,
  incrementRateLimit,
  resetRateLimit,
  logSecurityEvent,
} from '@/lib/auth/rate-limit'
import { getSession } from '@/lib/auth/session'
import { z } from 'zod'

const reEnrollSchema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/).optional(),
  recoveryKey: z.string().min(10).optional(),
  setupToken: z.string().min(1).optional(),
  faceDescriptor: z.array(z.number()).length(128),
  livenessPassed: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const ua = request.headers.get('user-agent') || 'unknown'

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const parsed = reEnrollSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid data format. Exactly 128-D descriptor required.' }, { status: 400 })
  }

  const { pin, recoveryKey, setupToken, faceDescriptor, livenessPassed } = parsed.data

  const supabase = createServiceClient()

  // Retrieve owner record
  const { data: owner } = await supabase
    .from('owner_settings')
    .select('*')
    .limit(1)
    .single()

  if (!owner) {
    return NextResponse.json({ error: 'Owner record not found.' }, { status: 404 })
  }

  // Authenticate the request:
  // Option 1: Existing fully-authenticated session cookie
  let isAuthorized = false
  const session = await getSession()
  if (session && session.ownerId === owner.id && session.locksPassed === 63) {
    isAuthorized = true
  }

  // Option 2: Authorized with master setup token (administrative recovery)
  if (!isAuthorized && setupToken && process.env.VAULT_SETUP_TOKEN && setupToken.trim() === process.env.VAULT_SETUP_TOKEN.trim()) {
    isAuthorized = true
  }

  // Option 3: Authorized with Recovery Key + 6-digit PIN
  if (!isAuthorized && pin && recoveryKey) {
    const pinValid = await bcrypt.compare(pin.trim(), owner.pin_hash)
    const recoveryValid = await bcrypt.compare(recoveryKey.trim(), owner.recovery_key_hash)
    if (pinValid && recoveryValid) {
      isAuthorized = true
    }
  }

  // If not authorized by valid credentials, check re_enroll rate limit before rejecting
  if (!isAuthorized) {
    const rateCheck = await checkRateLimit(ip, 're_enroll_face')
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many failed re-enrollment attempts. Please wait before retrying.', retryAfter: rateCheck.retryAfter },
        { status: 429 }
      )
    }

    await incrementRateLimit(ip, 're_enroll_face')
    await logSecurityEvent('face_re_enroll_failed', false, 1, ip, ua)
    return NextResponse.json(
      { error: 'Unauthorized: Invalid Master Setup Token or PIN/Recovery Key.' },
      { status: 403 }
    )
  }

  // Owner is verified and authorized!
  // Validate biometric descriptor
  if (livenessPassed === false) {
    return NextResponse.json({ error: 'Liveness check failed: Static photo detected. A live subject is required.' }, { status: 400 })
  }

  // Validate descriptor numbers
  const hasInvalidNumbers = faceDescriptor.some(v => typeof v !== 'number' || !Number.isFinite(v))
  if (hasInvalidNumbers) {
    return NextResponse.json({ error: 'Corrupted biometric vector values.' }, { status: 400 })
  }

  // Check vector normalization (L2 norm should be approx 1.0)
  const normSq = faceDescriptor.reduce((sum, v) => sum + v * v, 0)
  if (normSq < 0.80 || normSq > 1.25) {
    return NextResponse.json({ error: 'Biometric vector failed normalization validation.' }, { status: 400 })
  }

  // Update biometric face template
  const newEnrollmentId = `face_bio_${Date.now()}`
  const { error: updateError } = await supabase
    .from('owner_settings')
    .update({
      face_enrollment_id: newEnrollmentId,
      face_template: JSON.stringify(faceDescriptor),
      updated_at: new Date().toISOString(),
    })
    .eq('id', owner.id)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to persist updated face template.' }, { status: 500 })
  }

  // Clear rate limits for both re_enroll and auth_lock so owner can immediately authenticate!
  await resetRateLimit(ip, 'auth_lock')
  await resetRateLimit(ip, 're_enroll_face')

  // Un-revoke active sessions for this owner so Lock 01 can proceed
  await supabase
    .from('auth_sessions')
    .update({ failed_attempts: 0, is_revoked: false })
    .eq('owner_id', owner.id)

  console.log(`[BIOMETRIC_UPDATE] Owner face re-enrolled successfully (ID: ${newEnrollmentId}, Dimensions: 128)`)
  await logSecurityEvent('face_re_enrolled', true, 1, ip, ua)

  return NextResponse.json({
    success: true,
    message: 'Face biometric template re-enrolled successfully. You can now authenticate with Lock 01.',
    enrollmentId: newEnrollmentId,
  })
}
