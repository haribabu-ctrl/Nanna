-- ============================================================
-- Private Love Vault — Database Schema
-- Run these migrations in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Owner Settings ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS owner_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  secret_name_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  -- References to face/voice enrollment IDs and biometric templates
  face_enrollment_id TEXT,
  voice_enrollment_id TEXT,
  face_template TEXT,
  voice_template TEXT,
  -- Recovery key (hashed)
  recovery_key_hash TEXT,
  -- Setup completed flag
  setup_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Auth Sessions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES owner_settings(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL UNIQUE,
  -- Tracks which locks have been passed (bitmask: 1=face1, 2=pin, 4=name, 8=code, 16=voice, 32=face2)
  locks_passed INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT
);

-- ── Media ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES owner_settings(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  thumbnail_key TEXT,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  duration_seconds FLOAT, -- for videos
  width INTEGER,
  height INTEGER,
  album_id UUID REFERENCES albums(id) ON DELETE SET NULL,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE, -- soft delete / trash
  deleted_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Albums ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS albums (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES owner_settings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  cover_media_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fix forward reference: albums -> media cover
ALTER TABLE albums
  ADD CONSTRAINT fk_album_cover
  FOREIGN KEY (cover_media_id)
  REFERENCES media(id) ON DELETE SET NULL;

-- ── Security Events ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT NOT NULL,
  lock_step INTEGER, -- 1-6
  success BOOLEAN NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Rate Limit Tracking ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  identifier TEXT NOT NULL, -- IP or session ID
  action TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ,
  UNIQUE(identifier, action)
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_owner ON auth_sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_id);
CREATE INDEX IF NOT EXISTS idx_media_album ON media(album_id);
CREATE INDEX IF NOT EXISTS idx_media_uploaded ON media(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier ON rate_limits(identifier, action);

-- ── Updated_at trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_owner_settings_updated_at
  BEFORE UPDATE ON owner_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_media_updated_at
  BEFORE UPDATE ON media
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_albums_updated_at
  BEFORE UPDATE ON albums
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Row Level Security ───────────────────────────────────────
-- Enable RLS on all tables
ALTER TABLE owner_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
ALTER TABLE albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- All operations go through service role (server-side only)
-- Deny all access from anon/authenticated roles
CREATE POLICY "deny_anon_owner_settings" ON owner_settings
  FOR ALL TO anon, authenticated USING (FALSE);

CREATE POLICY "deny_anon_auth_sessions" ON auth_sessions
  FOR ALL TO anon, authenticated USING (FALSE);

CREATE POLICY "deny_anon_media" ON media
  FOR ALL TO anon, authenticated USING (FALSE);

CREATE POLICY "deny_anon_albums" ON albums
  FOR ALL TO anon, authenticated USING (FALSE);

CREATE POLICY "deny_anon_security_events" ON security_events
  FOR ALL TO anon, authenticated USING (FALSE);

CREATE POLICY "deny_anon_rate_limits" ON rate_limits
  FOR ALL TO anon, authenticated USING (FALSE);
