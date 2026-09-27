import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createServiceClient } from '@/lib/db/supabase'
import { getClientIP, checkRateLimit, incrementRateLimit, logSecurityEvent } from '@/lib/auth/rate-limit'
import { createSessionToken, setSessionCookie, LOCK } from '@/lib/auth/session'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'

// POST /api/auth/init — Start an auth session (called from welcome screen)
export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const ua = request.headers.get('user-agent') || ''

  // Check rate limit
  const rateCheck = await checkRateLimit(ip, 'auth_session')
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait.', retryAfter: rateCheck.retryAfter },
      { status: 429 }
    )
  }

  try {
    const supabase = createServiceClient()

    // Get owner (there should be exactly one)
    const { data: owner } = await supabase
      .from('owner_settings')
      .select('id, setup_completed')
      .single()

    if (!owner || !owner.setup_completed) {
      return NextResponse.json(
        { error: 'Vault is not yet configured. Please complete setup first.', needsSetup: true },
        { status: 403 }
      )
    }

    // Create a new auth session in DB
    const sessionId = uuidv4()
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000) // 30 min to complete auth

    await supabase.from('auth_sessions').insert({
      id: sessionId,
      owner_id: owner.id,
      session_token: sessionId,
      locks_passed: 0,
      failed_attempts: 0,
      is_revoked: false,
      expires_at: expiresAt.toISOString(),
      ip_address: ip,
      user_agent: ua,
    })

    // Create a partial JWT (no locks passed yet)
    const token = await createSessionToken(sessionId, owner.id, 0)

    const response = NextResponse.json({ success: true, sessionId })
    await setSessionCookie(response, token)

    await logSecurityEvent('auth_init', true, undefined, ip, ua)
    return response
  } catch (error) {
    console.error('Auth init error:', error)
    return NextResponse.json({ error: 'Failed to initialize session.' }, { status: 500 })
  }
}
