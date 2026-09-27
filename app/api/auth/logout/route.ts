import { NextRequest, NextResponse } from 'next/server'
import { getSession, clearSessionCookie } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/db/supabase'
import { getClientIP, logSecurityEvent } from '@/lib/auth/rate-limit'

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const ua = request.headers.get('user-agent') || ''

  const session = await getSession()
  if (session) {
    try {
      const supabase = createServiceClient()
      await supabase
        .from('auth_sessions')
        .update({ is_revoked: true })
        .eq('id', session.sessionId)
      await logSecurityEvent('logout', true, undefined, ip, ua)
    } catch {
      // Non-critical
    }
  }

  const response = NextResponse.json({ success: true })
  await clearSessionCookie(response)
  return response
}
