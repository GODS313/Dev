-- CMS store for the public single-box download page (/dl).
-- Mirrors the key/value + revision pattern already used by bot_settings/config_revision.
CREATE TABLE IF NOT EXISTS site_content (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Metadata for files uploaded to the MEDIA R2 bucket from the admin panel or the master bot.
-- The R2 object key itself is the primary key; slot marks single-instance images (logo/icon)
-- so re-uploading the same slot replaces the previous object instead of accumulating orphans.
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  slot TEXT,
  kind TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_assets_slot ON media_assets(slot);
CREATE INDEX IF NOT EXISTS idx_media_assets_kind_sort ON media_assets(kind, sort_order);
