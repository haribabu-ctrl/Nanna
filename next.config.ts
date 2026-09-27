import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Security headers applied to all routes
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'geolocation=(), camera=(self), microphone=(self)' },
        ],
      },
    ]
  },

  // Allow Supabase storage image domains for signed URL images
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/**',
      },
    ],
  },

  // Ensure server-only packages are not bundled for browser
  serverExternalPackages: ['bcryptjs', 'sharp'],
}

export default nextConfig
