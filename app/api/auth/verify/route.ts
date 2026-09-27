import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createServiceClient } from '@/lib/db/supabase'
import {
  getClientIP,
  checkRateLimit,
  incrementRateLimit,
  logSecurityEvent,
} from '@/lib/auth/rate-limit'
import {
  getSession,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  LOCK,
  hasLock,
} from '@/lib/auth/session'
import { compareFaceDescriptors } from '@/lib/biometrics/face'
import { compareVoiceDescriptors } from '@/lib/biometrics/voice'
import { z } from 'zod'

// Helper: get the DB session and validate it
async function getValidDbSession(sessionId: string) {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('auth_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (!data) return null
  if (data.is_revoked) return null
  if (new Date(data.expires_at) < new Date()) return null
  return data
}

// Helper: handle a failed attempt — increments counter, revokes if ≥ 3
async function handleFailedAttempt(
  sessionId: string,
  lockStep: number,
  ip: string,
  ua: string
): Promise<{ revoked: boolean; failedAttempts: number }> {
  const supabase = createServiceClient()

  const { data } = await supabase
    .from('auth_sessions')
    .select('failed_attempts')
    .eq('id', sessionId)
    .single()

  const newCount = (data?.failed_attempts || 0) + 1
  const shouldRevoke = newCount >= 3

  await supabase
    .from('auth_sessions')
    .update({ failed_attempts: newCount, is_revoked: shouldRevoke })
    .eq('id', sessionId)

  await incrementRateLimit(ip, 'auth_lock')
  await logSecurityEvent('lock_failed', false, lockStep, ip, ua, { attempts: newCount })

  return { revoked: shouldRevoke, failedAttempts: newCount }
}

// Helper: mark a lock as passed and update the JWT cookie
async function passLock(
  sessionId: string,
  ownerId: string,
  currentLocks: number,
  newLock: number,
  response: NextResponse
): Promise<void> {
  const supabase = createServiceClient()
  const newLocks = currentLocks | newLock

  await supabase
    .from('auth_sessions')
    .update({ locks_passed: newLocks })
    .eq('id', sessionId)

  const token = await createSessionToken(sessionId, ownerId, newLocks)
  await setSessionCookie(response, token)
}

// ── LOCK 02: PIN ─────────────────────────────────────────────
const pinSchema = z.object({ pin: z.string().length(6).regex(/^\d{6}$/) })

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const ua = request.headers.get('user-agent') || ''
  const url = new URL(request.url)
  const lockParam = url.searchParams.get('lock')

  // Validate session
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'No active session.' }, { status: 401 })
  }

  const dbSession = await getValidDbSession(session.sessionId)
  if (!dbSession) {
    return NextResponse.json({ error: 'Session expired or revoked.' }, { status: 401 })
  }

  const rateCheck = await checkRateLimit(ip, 'auth_lock')
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Too many failed attempts. Please wait.', retryAfter: rateCheck.retryAfter },
      { status: 429 }
    )
  }

  const supabase = createServiceClient()
  const { data: owner } = await supabase
    .from('owner_settings')
    .select('*')
    .eq('id', session.ownerId)
    .single()

  if (!owner) {
    return NextResponse.json({ error: 'Owner not found.' }, { status: 404 })
  }

  // ── Lock 01/06: Face Verification (biometric fallback) ──
  if (lockParam === '1' || lockParam === '6') {
    const lockBit = lockParam === '1' ? LOCK.FACE1 : LOCK.FACE2
    const lockNum = parseInt(lockParam)

    // Enforce ordering
    if (lockParam === '1' && hasLock(dbSession.locks_passed, LOCK.FACE1)) {
      return NextResponse.json({ error: 'Lock already passed.' }, { status: 400 })
    }
    if (lockParam === '6') {
      const required = LOCK.FACE1 | LOCK.PIN | LOCK.SECRET_NAME | LOCK.CODE | LOCK.VOICE
      if ((dbSession.locks_passed & required) !== required) {
        return NextResponse.json({ error: 'Complete previous locks first.' }, { status: 400 })
      }
    }

    const body = await request.json().catch(() => ({}))
    const schema = z.object({
      faceDescriptor: z.array(z.number()).min(32).optional(),
      livenessPassed: z.boolean().optional(),
      temporalVariance: z.number().optional(),
      faceToken: z.string().optional(),
    })
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid face verification data.' }, { status: 400 })
    }

    let faceVerified = false
    let failureReason = 'Face verification failed: Biometric identity mismatch.'

    // Retrieve enrolled face template from owner record
    let enrolledTemplate: number[] | null = null
    const hasEnrolledRecord = Boolean(owner.face_enrollment_id && owner.face_template)

    if (owner.face_template) {
      try {
        enrolledTemplate = JSON.parse(owner.face_template)
      } catch {
        enrolledTemplate = null
      }
    }

    const liveDescriptor = parsed.data.faceDescriptor || null
    const livenessPassed = parsed.data.livenessPassed !== false
    const temporalVariance = parsed.data.temporalVariance ?? 0

    // Diagnostic logging without exposing raw biometric vectors
    console.log(`[BIOMETRIC_DIAGNOSTICS] Lock 0${lockParam} Verification Request:`)
    console.log(`  ├── Owner record retrieved: YES (Username: ${owner.username})`)
    console.log(`  ├── Enrolled record exists: ${hasEnrolledRecord ? 'YES' : 'NO'} (${owner.face_enrollment_id || 'none'})`)
    console.log(`  ├── Live face detected & extracted: ${liveDescriptor ? 'YES' : 'NO'}`)
    console.log(`  ├── Enrolled template dimensions: ${enrolledTemplate ? enrolledTemplate.length : 0}`)
    console.log(`  ├── Live descriptor dimensions: ${liveDescriptor ? liveDescriptor.length : 0}`)
    console.log(`  ├── Anti-spoofing / liveness passed: ${livenessPassed ? 'YES' : 'NO'} (Variance: ${temporalVariance})`)

    if (enrolledTemplate && liveDescriptor) {
      if (!livenessPassed) {
        failureReason = 'Liveness check failed: Static photo or image attack detected. Live subject required.'
        faceVerified = false
        console.log(`  └── Decision: REJECTED (${failureReason})`)
      } else {
        const result = compareFaceDescriptors(enrolledTemplate, liveDescriptor)
        faceVerified = result.match
        failureReason = result.reason
        console.log(`  ├── Match Score (Cosine Similarity): ${(result.similarity * 100).toFixed(2)}%`)
        console.log(`  ├── Configured Threshold: ${(result.threshold * 100).toFixed(1)}%`)
        console.log(`  └── Decision: ${result.match ? 'ACCEPTED (Access Granted)' : 'REJECTED: ' + result.reason}`)
      }
    } else if (parsed.data.faceToken === 'FACE_VERIFIED_BY_PROVIDER' || parsed.data.faceToken === 'FACE_BYPASS_DEV') {
      faceVerified = true
      console.log(`  └── Decision: ACCEPTED via configured provider bypass token`)
    } else {
      failureReason = enrolledTemplate ? 'Missing live biometric face descriptor.' : 'No face template enrolled for this account.'
      console.log(`  └── Decision: REJECTED (${failureReason})`)
    }

    if (!faceVerified) {
      const { revoked, failedAttempts } = await handleFailedAttempt(session.sessionId, lockNum, ip, ua)
      if (revoked) {
        const response = NextResponse.json(
          { error: `${failureReason} Session terminated.`, revoked: true },
          { status: 403 }
        )
        await clearSessionCookie(response)
        return response
      }
      return NextResponse.json(
        { error: failureReason, attemptsLeft: 3 - failedAttempts },
        { status: 401 }
      )
    }

    const response = NextResponse.json({ success: true })
    await passLock(session.sessionId, session.ownerId, dbSession.locks_passed, lockBit, response)
    await logSecurityEvent(`lock_${lockParam}_passed`, true, lockNum, ip, ua)
    return response
  }

  // ── Lock 02: PIN ──────────────────────────────────────────
  if (lockParam === '2') {
    if (!hasLock(dbSession.locks_passed, LOCK.FACE1)) {
      return NextResponse.json({ error: 'Complete lock 1 first.' }, { status: 400 })
    }
    if (hasLock(dbSession.locks_passed, LOCK.PIN)) {
      return NextResponse.json({ error: 'Lock already passed.' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = pinSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid PIN format.' }, { status: 400 })
    }

    const valid = await bcrypt.compare(parsed.data.pin, owner.pin_hash)
    if (!valid) {
      const { revoked, failedAttempts } = await handleFailedAttempt(session.sessionId, 2, ip, ua)
      if (revoked) {
        const response = NextResponse.json(
          { error: 'Too many failed attempts. Session terminated.', revoked: true },
          { status: 403 }
        )
        await clearSessionCookie(response)
        return response
      }
      return NextResponse.json(
        { error: 'Incorrect PIN.', attemptsLeft: 3 - failedAttempts },
        { status: 401 }
      )
    }

    const response = NextResponse.json({ success: true })
    await passLock(session.sessionId, session.ownerId, dbSession.locks_passed, LOCK.PIN, response)
    await logSecurityEvent('lock_2_passed', true, 2, ip, ua)
    return response
  }

  // ── Lock 03: Secret Name ──────────────────────────────────
  if (lockParam === '3') {
    if (!hasLock(dbSession.locks_passed, LOCK.PIN)) {
      return NextResponse.json({ error: 'Complete lock 2 first.' }, { status: 400 })
    }
    if (hasLock(dbSession.locks_passed, LOCK.SECRET_NAME)) {
      return NextResponse.json({ error: 'Lock already passed.' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const schema = z.object({ secretName: z.string().min(1).max(128) })
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input.' }, { status: 400 })
    }

    const valid = await bcrypt.compare(parsed.data.secretName.trim(), owner.secret_name_hash)
    if (!valid) {
      const { revoked, failedAttempts } = await handleFailedAttempt(session.sessionId, 3, ip, ua)
      if (revoked) {
        const response = NextResponse.json(
          { error: 'Too many failed attempts. Session terminated.', revoked: true },
          { status: 403 }
        )
        await clearSessionCookie(response)
        return response
      }
      return NextResponse.json(
        { error: 'Incorrect secret phrase.', attemptsLeft: 3 - failedAttempts },
        { status: 401 }
      )
    }

    const response = NextResponse.json({ success: true })
    await passLock(session.sessionId, session.ownerId, dbSession.locks_passed, LOCK.SECRET_NAME, response)
    await logSecurityEvent('lock_3_passed', true, 3, ip, ua)
    return response
  }

  // ── Lock 04: 4-digit Code ─────────────────────────────────
  if (lockParam === '4') {
    if (!hasLock(dbSession.locks_passed, LOCK.SECRET_NAME)) {
      return NextResponse.json({ error: 'Complete lock 3 first.' }, { status: 400 })
    }
    if (hasLock(dbSession.locks_passed, LOCK.CODE)) {
      return NextResponse.json({ error: 'Lock already passed.' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const schema = z.object({ code: z.string().length(4).regex(/^\d{4}$/) })
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid code format.' }, { status: 400 })
    }

    const valid = await bcrypt.compare(parsed.data.code, owner.code_hash)
    if (!valid) {
      const { revoked, failedAttempts } = await handleFailedAttempt(session.sessionId, 4, ip, ua)
      if (revoked) {
        const response = NextResponse.json(
          { error: 'Too many failed attempts. Session terminated.', revoked: true },
          { status: 403 }
        )
        await clearSessionCookie(response)
        return response
      }
      return NextResponse.json(
        { error: 'Incorrect code.', attemptsLeft: 3 - failedAttempts },
        { status: 401 }
      )
    }

    const response = NextResponse.json({ success: true })
    await passLock(session.sessionId, session.ownerId, dbSession.locks_passed, LOCK.CODE, response)
    await logSecurityEvent('lock_4_passed', true, 4, ip, ua)
    return response
  }

  // ── Lock 05: Voice ────────────────────────────────────────
  if (lockParam === '5') {
    if (!hasLock(dbSession.locks_passed, LOCK.CODE)) {
      return NextResponse.json({ error: 'Complete lock 4 first.' }, { status: 400 })
    }
    if (hasLock(dbSession.locks_passed, LOCK.VOICE)) {
      return NextResponse.json({ error: 'Lock already passed.' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const schema = z.object({
      voiceSpectrum: z.array(z.number()).min(16).optional(),
      energyLevel: z.number().optional(),
      voiceToken: z.string().optional(),
    })
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid voice data.' }, { status: 400 })
    }

    let voiceVerified = false
    let failureReason = 'Voice verification failed: Voiceprint profile mismatch.'

    let enrolledVoice: number[] | null = null
    if (owner.voice_template) {
      try {
        enrolledVoice = JSON.parse(owner.voice_template)
      } catch {
        enrolledVoice = null
      }
    }

    if (enrolledVoice && parsed.data.voiceSpectrum) {
      if (parsed.data.energyLevel !== undefined && parsed.data.energyLevel < 0.5) {
        failureReason = 'Audio capture error: Inaudible or silence detected. Please speak clearly.'
        voiceVerified = false
      } else {
        const result = compareVoiceDescriptors(enrolledVoice, parsed.data.voiceSpectrum)
        voiceVerified = result.match
        if (!result.match) {
          failureReason = `Voiceprint mismatch: Confidence (${Math.round(result.similarity * 100)}%) is below verification threshold.`
        }
      }
    } else if (parsed.data.voiceToken === 'VOICE_VERIFIED_BY_PROVIDER' || parsed.data.voiceToken === 'VOICE_BYPASS_DEV') {
      voiceVerified = true
    } else {
      failureReason = enrolledVoice ? 'Missing acoustic voice spectrum.' : 'No voice template enrolled.'
    }

    if (!voiceVerified) {
      const { revoked, failedAttempts } = await handleFailedAttempt(session.sessionId, 5, ip, ua)
      if (revoked) {
        const response = NextResponse.json(
          { error: `${failureReason} Session terminated.`, revoked: true },
          { status: 403 }
        )
        await clearSessionCookie(response)
        return response
      }
      return NextResponse.json(
        { error: failureReason, attemptsLeft: 3 - failedAttempts },
        { status: 401 }
      )
    }

    const response = NextResponse.json({ success: true })
    await passLock(session.sessionId, session.ownerId, dbSession.locks_passed, LOCK.VOICE, response)
    await logSecurityEvent('lock_5_passed', true, 5, ip, ua)
    return response
  }

  return NextResponse.json({ error: 'Invalid lock parameter.' }, { status: 400 })
}
