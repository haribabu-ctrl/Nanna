import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest, allLocksCleared } from '@/lib/auth/session'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Handle CORS for API requests
  const origin = request.headers.get('origin')
  const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_URL || '*'
  const isAllowedOrigin = origin && (allowedOrigin === '*' || origin === allowedOrigin || origin === 'http://localhost:3000')

  if (request.method === 'OPTIONS') {
    const preflight = new NextResponse(null, { status: 204 })
    if (origin) {
      preflight.headers.set('Access-Control-Allow-Origin', isAllowedOrigin ? origin : allowedOrigin)
      preflight.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      preflight.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Cookie')
      preflight.headers.set('Access-Control-Allow-Credentials', 'true')
      preflight.headers.set('Access-Control-Max-Age', '86400')
    }
    return preflight
  }

  // Public routes — always accessible
  const publicPaths = ['/', '/setup', '/auth', '/api/auth', '/api/setup', '/_next', '/favicon.ico', '/public']
  const isPublic = publicPaths.some(p => pathname.startsWith(p))

  if (isPublic) {
    const res = NextResponse.next()
    if (origin) {
      res.headers.set('Access-Control-Allow-Origin', isAllowedOrigin ? origin : allowedOrigin)
      res.headers.set('Access-Control-Allow-Credentials', 'true')
    }
    return res
  }

  // Protected routes — require full authentication
  const session = await getSessionFromRequest(request)

  if (!session || !allLocksCleared(session.locksPassed)) {
    // API routes return 401
    if (pathname.startsWith('/api/')) {
      const errRes = NextResponse.json(
        { error: 'Unauthorized. Complete all six authentication steps.' },
        { status: 401 }
      )
      if (origin) {
        errRes.headers.set('Access-Control-Allow-Origin', isAllowedOrigin ? origin : allowedOrigin)
        errRes.headers.set('Access-Control-Allow-Credentials', 'true')
      }
      return errRes
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

  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', isAllowedOrigin ? origin : allowedOrigin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
