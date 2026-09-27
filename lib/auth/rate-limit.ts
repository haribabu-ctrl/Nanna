import { createServiceClient } from '@/lib/db/supabase'
import { NextRequest } from 'next/server'

// Rate limiting configuration
const RATE_LIMITS: Record<string, { maxAttempts: number; windowSeconds: number; blockSeconds: number }> = {
  'auth_lock': { maxAttempts: 5, windowSeconds: 300, blockSeconds: 300 },   // 5 tries per 5 min, block 5 min
  'auth_session': { maxAttempts: 20, windowSeconds: 60, blockSeconds: 300 }, // 20 per min, block 5 min
  'setup': { maxAttempts: 10, windowSeconds: 600, blockSeconds: 600 },       // 10 tries per 10 min, block 10 min
  're_enroll_face': { maxAttempts: 6, windowSeconds: 300, blockSeconds: 180 }, // 6 attempts per 5 min, block 3 min
}

export function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')
  const realIP = request.headers.get('x-real-ip')
  const cfConnecting = request.headers.get('cf-connecting-ip')
  
  if (cfConnecting) return cfConnecting.split(',')[0].trim()
  if (forwardedFor) return forwardedFor.split(',')[0].trim()
  if (realIP) return realIP
  return '127.0.0.1'
}

export async function checkRateLimit(
  identifier: string,
  action: string
): Promise<{ allowed: boolean; retryAfter?: number; attemptsLeft?: number }> {
  const config = RATE_LIMITS[action] || RATE_LIMITS['auth_lock']
  const supabase = createServiceClient()
  const now = new Date()

  // Clean up expired windows where no active block exists
  await supabase
    .from('rate_limits')
    .delete()
    .eq('identifier', identifier)
    .eq('action', action)
    .lt('window_start', new Date(now.getTime() - config.windowSeconds * 1000).toISOString())

  const { data: existing } = await supabase
    .from('rate_limits')
    .select('*')
    .eq('identifier', identifier)
    .eq('action', action)
    .single()

  if (existing) {
    // Check if currently blocked
    if (existing.blocked_until) {
      const blockedUntil = new Date(existing.blocked_until)
      if (blockedUntil > now) {
        const retryAfter = Math.max(1, Math.ceil(
          (blockedUntil.getTime() - now.getTime()) / 1000
        ))
        return { allowed: false, retryAfter }
      } else {
        // Block window has expired! Clean up the expired record to allow a fresh retry
        await supabase
          .from('rate_limits')
          .delete()
          .eq('identifier', identifier)
          .eq('action', action)

        return { allowed: true, attemptsLeft: config.maxAttempts }
      }
    }

    if (existing.attempts >= config.maxAttempts) {
      // Block the identifier for blockSeconds
      const blockedUntil = new Date(now.getTime() + config.blockSeconds * 1000)
      await supabase
        .from('rate_limits')
        .update({ blocked_until: blockedUntil.toISOString() })
        .eq('identifier', identifier)
        .eq('action', action)
      
      return { allowed: false, retryAfter: config.blockSeconds }
    }

    return { allowed: true, attemptsLeft: config.maxAttempts - existing.attempts }
  }

  return { allowed: true, attemptsLeft: config.maxAttempts }
}

export async function incrementRateLimit(
  identifier: string,
  action: string
): Promise<void> {
  const config = RATE_LIMITS[action] || RATE_LIMITS['auth_lock']
  const supabase = createServiceClient()
  const now = new Date()

  const { data: existing } = await supabase
    .from('rate_limits')
    .select('*')
    .eq('identifier', identifier)
    .eq('action', action)
    .single()

  if (existing) {
    const newAttempts = existing.attempts + 1
    const updates: Record<string, unknown> = { attempts: newAttempts }
    
    if (newAttempts >= config.maxAttempts) {
      updates.blocked_until = new Date(now.getTime() + config.blockSeconds * 1000).toISOString()
    }

    await supabase
      .from('rate_limits')
      .update(updates)
      .eq('identifier', identifier)
      .eq('action', action)
  } else {
    await supabase
      .from('rate_limits')
      .insert({
        identifier,
        action,
        attempts: 1,
        window_start: now.toISOString(),
      })
  }
}

export async function resetRateLimit(
  identifier: string,
  action: string
): Promise<void> {
  const supabase = createServiceClient()
  await supabase
    .from('rate_limits')
    .delete()
    .eq('identifier', identifier)
    .eq('action', action)
}

export async function logSecurityEvent(
  eventType: string,
  success: boolean,
  lockStep?: number,
  ipAddress?: string,
  userAgent?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase.from('security_events').insert({
      event_type: eventType,
      lock_step: lockStep,
      success,
      ip_address: ipAddress,
      user_agent: userAgent,
      metadata: metadata || {},
    })
  } catch {
    // Non-critical — don't throw
    console.error('Failed to log security event')
  }
}
