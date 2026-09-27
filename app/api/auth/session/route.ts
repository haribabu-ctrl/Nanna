import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createServiceClient } from '@/lib/db/supabase'
import { allLocksCleared } from '@/lib/auth/session'

// GET /api/auth/session — check current session state
export async function GET(request: NextRequest) {
  const session = await getSession()

  if (!session) {
    return NextResponse.json({ authenticated: false, locksPassed: 0 })
  }

  // Verify the DB session is still valid
  const supabase = createServiceClient()
  const { data: dbSession } = await supabase
    .from('auth_sessions')
    .select('id, locks_passed, is_revoked, expires_at, failed_attempts')
    .eq('id', session.sessionId)
    .single()

  if (!dbSession || dbSession.is_revoked || new Date(dbSession.expires_at) < new Date()) {
    return NextResponse.json({ authenticated: false, locksPassed: 0, revoked: true })
  }

  return NextResponse.json({
    authenticated: allLocksCleared(dbSession.locks_passed),
    locksPassed: dbSession.locks_passed,
    failedAttempts: dbSession.failed_attempts,
  })
}
