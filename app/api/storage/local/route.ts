import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const STORAGE_DIR = path.join(process.cwd(), 'database', 'vault_storage')

// PUT /api/storage/local?key=... — Handle direct file upload in local mode
export async function PUT(request: NextRequest) {
  const url = new URL(request.url)
  const key = url.searchParams.get('key')

  if (!key) {
    return NextResponse.json({ error: 'Missing storage key' }, { status: 400 })
  }

  // Sanitize path
  const safeKey = key.replace(/\.\./g, '').replace(/^[/\\]+/, '')
  const filePath = path.join(STORAGE_DIR, safeKey.replace(/\//g, path.sep))
  const dir = path.dirname(filePath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const arrayBuffer = await request.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  fs.writeFileSync(filePath, buffer)

  return NextResponse.json({ success: true, key: safeKey })
}

// GET /api/storage/local?key=... — Serve file for viewing or downloading
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const key = url.searchParams.get('key')
  const action = url.searchParams.get('action') || 'view'

  if (!key) {
    return NextResponse.json({ error: 'Missing storage key' }, { status: 400 })
  }

  const safeKey = key.replace(/\.\./g, '').replace(/^[/\\]+/, '')
  const filePath = path.join(STORAGE_DIR, safeKey.replace(/\//g, path.sep))

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const buffer = fs.readFileSync(filePath)
  const filename = path.basename(filePath)

  // Determine mime type
  const ext = path.extname(filename).toLowerCase()
  let contentType = 'application/octet-stream'
  if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg'
  else if (ext === '.png') contentType = 'image/png'
  else if (ext === '.webp') contentType = 'image/webp'
  else if (ext === '.mp4') contentType = 'video/mp4'
  else if (ext === '.webm') contentType = 'video/webm'
  else if (ext === '.mov') contentType = 'video/quicktime'

  const headers = new Headers()
  headers.set('Content-Type', contentType)
  headers.set('Content-Length', buffer.length.toString())
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')

  if (action === 'download') {
    headers.set('Content-Disposition', `attachment; filename="${filename}"`)
  } else {
    headers.set('Content-Disposition', `inline; filename="${filename}"`)
  }

  return new NextResponse(buffer, {
    status: 200,
    headers,
  })
}
