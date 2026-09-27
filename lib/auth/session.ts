import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = process.env.VAULT_SESSION_COOKIE || 'plv_session'
const SESSION_MAX_AGE = parseInt(process.env.SESSION_MAX_AGE || '86400', 10)

function getSecret(): Uint8Array {
  const secret = process.env.VAULT_SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('VAULT_SESSION_SECRET must be at least 32 characters.')
  }
  return new TextEncoder().encode(secret)
}

export interface VaultSession {
  sessionId: string
  ownerId: string
  locksPassed: number // bitmask: 1=face1, 2=pin, 4=name, 8=code, 16=voice, 32=face2
  fullyAuthenticated: boolean
  iat: number
  exp: number
}

// Lock bitmask values
export const LOCK = {
  FACE1: 1,
  PIN: 2,
  SECRET_NAME: 4,
  CODE: 8,
  VOICE: 16,
  FACE2: 32,
  ALL: 63, // 1+2+4+8+16+32
} as const

export function hasLock(locksPassed: number, lock: number): boolean {
  return (locksPassed & lock) === lock
}

export function allLocksCleared(locksPassed: number): boolean {
  return locksPassed === LOCK.ALL
}

export async function createSessionToken(
  sessionId: string,
  ownerId: string,
  locksPassed: number
): Promise<string> {
  const fullyAuthenticated = allLocksCleared(locksPassed)

  const token = await new SignJWT({
    sessionId,
    ownerId,
    locksPassed,
    fullyAuthenticated,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret())

  return token
}

export async function verifySessionToken(token: string): Promise<VaultSession | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return payload as unknown as VaultSession
  } catch {
    return null
  }
}

export async function getSession(): Promise<VaultSession | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifySessionToken(token)
}

export async function setSessionCookie(
  response: NextResponse,
  token: string
): Promise<void> {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  })
}

export async function clearSessionCookie(response: NextResponse): Promise<void> {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  })
}

// Get session from request (for middleware)
export async function getSessionFromRequest(
  request: NextRequest
): Promise<VaultSession | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifySessionToken(token)
}
