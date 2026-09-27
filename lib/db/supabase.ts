import { createClient } from '@supabase/supabase-js'
import { createLocalServiceClient } from './local-db'

// Server-only Supabase client with service role key
// NEVER import this in client components
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key || url.includes('YOUR_PROJECT') || url.includes('localhost') || url === 'local') {
    // Seamless persistent local database and storage for development
    return createLocalServiceClient() as unknown as ReturnType<typeof createClient>
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

// Browser-safe Supabase client (uses anon key, protected by RLS)
let browserClient: ReturnType<typeof createClient> | null = null

export function createBrowserClient() {
  if (browserClient) return browserClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key || url.includes('YOUR_PROJECT') || url.includes('localhost') || url === 'local') {
    return null
  }

  browserClient = createClient(url, key)
  return browserClient
}
