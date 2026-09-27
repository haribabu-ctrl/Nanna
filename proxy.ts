import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest, allLocksCleared } from '@/lib/auth/session'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public routes — always accessible
  const publicPaths = ['/', '/setup', '/auth', '/api/auth', '/api/setup', '/_next', '/favicon.ico', '/public']
  const isPublic = publicPaths.some(p => pathname.startsWith(p))

  if (isPublic) {
    return NextResponse.next()
  }

  // Protected routes — require full authentication
  const session = await getSessionFromRequest(request)

  if (!session || !allLocksCleared(session.locksPassed)) {
    // API routes return 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized. Complete all six authentication steps.' },
        { status: 401 }
      )
    }
    // Page routes redirect to home
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Set security headers on all responses
  const response = NextResponse.next()
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(self), camera=(self)')
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co",
      "media-src 'self' blob: https://*.supabase.co",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "font-src 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  )
  // No caching for private content
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  response.headers.set('Pragma', 'no-cache')

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
