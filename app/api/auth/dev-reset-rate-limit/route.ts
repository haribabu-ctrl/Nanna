import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/db/supabase'
import { getClientIP } from '@/lib/auth/rate-limit'

// POST /api/auth/dev-reset-rate-limit
// Secure, strictly DEVELOPMENT-ONLY rate-limit recovery endpoint
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Endpoint only available in development mode.' }, { status: 403 })
  }

  const ip = getClientIP(request)
  const supabase = createServiceClient()

  // Reset rate limits for this IP
  await supabase
    .from('rate_limits')
    .delete()
    .eq('identifier', ip)

  // Reset any active session revocations
  await supabase
    .from('auth_sessions')
    .update({ failed_attempts: 0, is_revoked: false })
    .eq('ip_address', ip)

  return NextResponse.json({
    success: true,
    message: `Development rate limits and session lockout reset for IP: ${ip}`,
  })
}
