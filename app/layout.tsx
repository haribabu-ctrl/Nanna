import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Private Love Vault',
  description: 'Classified — Authorized Access Only',
  robots: { index: false, follow: false },
  openGraph: { title: 'Access Denied', description: 'Classified.' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#050505" />
        {/* No analytics, no external tracking */}
      </head>
      <body className="min-h-screen bg-[#050505] text-white antialiased">
        {children}
      </body>
    </html>
  )
}
