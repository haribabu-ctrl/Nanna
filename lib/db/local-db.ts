import fs from 'fs'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'database', 'vault_db.json')
const STORAGE_DIR = path.join(process.cwd(), 'database', 'vault_storage')

interface LocalSchema {
  owner_settings: Array<Record<string, unknown>>
  auth_sessions: Array<Record<string, unknown>>
  media: Array<Record<string, unknown>>
  albums: Array<Record<string, unknown>>
  security_events: Array<Record<string, unknown>>
  rate_limits: Array<Record<string, unknown>>
}

function ensureDb(): LocalSchema {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  }
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true })
  }
  if (!fs.existsSync(DB_PATH)) {
    const initial: LocalSchema = {
      owner_settings: [],
      auth_sessions: [],
      media: [],
      albums: [],
      security_events: [],
      rate_limits: [],
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf-8')
    return initial
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8')
    return JSON.parse(raw) as LocalSchema
  } catch {
    const fallback: LocalSchema = {
      owner_settings: [],
      auth_sessions: [],
      media: [],
      albums: [],
      security_events: [],
      rate_limits: [],
    }
    return fallback
  }
}

function saveDb(data: LocalSchema) {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

// Fluent query builder that matches Supabase API
class LocalTableQuery {
  private tableName: keyof LocalSchema
  private filters: Array<(item: Record<string, unknown>) => boolean> = []
  private sortField?: string
  private sortAscending: boolean = true
  private rangeOffset: number = 0
  private rangeLimit?: number
  private queryMode: 'select' | 'delete' | 'update' = 'select'
  private pendingUpdates?: Record<string, unknown>

  constructor(tableName: keyof LocalSchema) {
    this.tableName = tableName
  }

  select(_columns?: string, _opts?: { count?: string }) {
    this.queryMode = 'select'
    return this
  }

  delete() {
    this.queryMode = 'delete'
    return this
  }

  update(updates: Record<string, unknown>) {
    this.queryMode = 'update'
    this.pendingUpdates = updates
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push((item) => item[field] === value)
    return this
  }

  neq(field: string, value: unknown) {
    this.filters.push((item) => item[field] !== value)
    return this
  }

  like(field: string, pattern: string) {
    const regex = new RegExp('^' + pattern.replace(/%/g, '.*') + '$', 'i')
    this.filters.push((item) => typeof item[field] === 'string' && regex.test(item[field] as string))
    return this
  }

  gte(field: string, value: unknown) {
    this.filters.push((item) => {
      const v = item[field]
      if (typeof v === 'string' && typeof value === 'string') return new Date(v) >= new Date(value)
      return (v as number) >= (value as number)
    })
    return this
  }

  lt(field: string, value: unknown) {
    this.filters.push((item) => {
      const v = item[field]
      if (typeof v === 'string' && typeof value === 'string') return new Date(v) < new Date(value)
      return (v as number) < (value as number)
    })
    return this
  }

  order(field: string, { ascending = true }: { ascending?: boolean } = {}) {
    this.sortField = field
    this.sortAscending = ascending
    return this
  }

  range(from: number, to: number) {
    this.rangeOffset = from
    this.rangeLimit = to - from + 1
    return this
  }

  limit(count: number) {
    this.rangeLimit = count
    return this
  }

  async single(): Promise<{ data: Record<string, unknown> | null; error: null }> {
    const db = ensureDb()
    const rows = db[this.tableName] || []
    const filtered = rows.filter((r) => this.filters.every((f) => f(r)))
    if (filtered.length === 0) {
      return { data: null, error: null }
    }
    return { data: filtered[0], error: null }
  }

  // Executing as thenable
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; count: number; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    const db = ensureDb()
    const rows = db[this.tableName] || []

    if (this.queryMode === 'delete') {
      const remaining = rows.filter((r) => !this.filters.every((f) => f(r)))
      const removedCount = rows.length - remaining.length
      db[this.tableName] = remaining
      saveDb(db)
      const result = { data: null, count: removedCount, error: null }
      return Promise.resolve(result).then(onfulfilled, onrejected)
    }

    if (this.queryMode === 'update') {
      let updatedCount = 0
      for (let i = 0; i < rows.length; i++) {
        if (this.filters.every((f) => f(rows[i]))) {
          rows[i] = {
            ...rows[i],
            ...(this.pendingUpdates || {}),
            updated_at: new Date().toISOString(),
          }
          updatedCount++
        }
      }
      saveDb(db)
      const result = { data: null, count: updatedCount, error: null }
      return Promise.resolve(result).then(onfulfilled, onrejected)
    }

    // Default: select
    let filtered = rows.filter((r) => this.filters.every((f) => f(r)))
    const count = filtered.length

    if (this.sortField) {
      const f = this.sortField
      const asc = this.sortAscending
      filtered.sort((a, b) => {
        const valA = a[f]
        const valB = b[f]
        if (typeof valA === 'string' && typeof valB === 'string') {
          return asc ? valA.localeCompare(valB) : valB.localeCompare(valA)
        }
        return asc ? (valA as number) - (valB as number) : (valB as number) - (valA as number)
      })
    }

    if (this.rangeOffset > 0 || this.rangeLimit !== undefined) {
      const start = this.rangeOffset
      const end = this.rangeLimit !== undefined ? start + this.rangeLimit : undefined
      filtered = filtered.slice(start, end)
    }

    const result = { data: filtered, count, error: null }
    return Promise.resolve(result).then(onfulfilled, onrejected)
  }

  async insert(recordOrRecords: Record<string, unknown> | Record<string, unknown>[]) {
    const db = ensureDb()
    const records = Array.isArray(recordOrRecords) ? recordOrRecords : [recordOrRecords]
    const inserted: Record<string, unknown>[] = []

    for (const r of records) {
      const id = r.id || 'id_' + Math.random().toString(36).substring(2, 11)
      const now = new Date().toISOString()
      const newRecord = {
        ...r,
        id,
        created_at: r.created_at || now,
        updated_at: r.updated_at || now,
      }
      db[this.tableName].push(newRecord)
      inserted.push(newRecord)
    }
    saveDb(db)

    return {
      data: Array.isArray(recordOrRecords) ? inserted : inserted[0],
      error: null,
      select: () => ({
        single: async () => ({ data: inserted[0], error: null }),
      }),
    }
  }
}

export function createLocalServiceClient() {
  return {
    from(tableName: keyof LocalSchema) {
      return new LocalTableQuery(tableName)
    },
    storage: {
      from(_bucket: string) {
        return {
          createSignedUploadUrl: async (storageKey: string) => {
            const url = `/api/storage/local?key=${encodeURIComponent(storageKey)}&action=upload`
            return { data: { signedUrl: url }, error: null }
          },
          createSignedUrl: async (storageKey: string, _expiresIn: number) => {
            const url = `/api/storage/local?key=${encodeURIComponent(storageKey)}&action=view`
            return { data: { signedUrl: url }, error: null }
          },
          remove: async (storageKeys: string[]) => {
            for (const key of storageKeys) {
              const fullPath = path.join(STORAGE_DIR, key.replace(/\//g, path.sep))
              if (fs.existsSync(fullPath)) {
                try {
                  fs.unlinkSync(fullPath)
                } catch {
                  // ignore
                }
              }
            }
            return { data: null, error: null }
          },
        }
      },
      listBuckets: async () => ({ data: [{ name: 'vault-media' }], error: null }),
      createBucket: async (_name: string) => ({ data: null, error: null }),
    },
  }
}
