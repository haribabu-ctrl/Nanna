import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/db/supabase'
import { getClientIP, checkRateLimit, incrementRateLimit } from '@/lib/auth/rate-limit'

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)

  // Check rate limit
  const rateCheck = await checkRateLimit(ip, 'setup')
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { valid: false, error: 'Too many attempts. Please wait.', retryAfter: rateCheck.retryAfter },
      { status: 429 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const setupToken = body.setupToken?.trim()

  const expectedToken = process.env.VAULT_SETUP_TOKEN

  if (!expectedToken) {
    return NextResponse.json(
      { valid: false, error: 'VAULT_SETUP_TOKEN is not configured on the server.' },
      { status: 500 }
    )
  }

  if (!setupToken || setupToken !== expectedToken) {
    await incrementRateLimit(ip, 'setup')
    return NextResponse.json(
      { valid: false, error: 'Invalid setup token. Please verify VAULT_SETUP_TOKEN in your environment variables.' },
      { status: 403 }
    )
  }

  // Token is valid! Now check if vault owner already exists
  const supabase = createServiceClient()
  const { data: existingOwner } = await supabase
    .from('owner_settings')
    .select('id, username, setup_completed, face_enrollment_id')
    .limit(1)
    .single()

  if (existingOwner && existingOwner.setup_completed) {
    return NextResponse.json({
      valid: true,
      alreadyConfigured: true,
      ownerUsername: existingOwner.username || 'Hari',
      message: 'Vault is already configured. Owner authorization verified.',
      reEnrollUrl: '/auth/re-enroll-face',
    })
  }

  return NextResponse.json({ valid: true, alreadyConfigured: false, message: 'Setup token verified successfully.' })
}
