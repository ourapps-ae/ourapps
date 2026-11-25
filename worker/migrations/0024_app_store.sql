-- App Store review. Once per app: listing, App Store Connect app information, and the default privacy
-- policy served at /privacy/<policy_id> when the developer gives no address of their own.
CREATE TABLE app_store_apps (
  app_id TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,
  listing TEXT NOT NULL DEFAULT 'public' CHECK (listing IN ('public', 'unlisted')),
  unlisted_granted_at TEXT,
  info_json TEXT,
  policy_id TEXT UNIQUE CHECK (policy_id IS NULL OR length(policy_id) >= 16),
  policy_json TEXT,
  privacy_confirmed_at TEXT,
  info_synced_to TEXT,
  updated_at TEXT NOT NULL
);

-- Per app and Apple platform: the version being prepared, where each step stands, and Apple's review.
CREATE TABLE app_store_versions (
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'macos', 'tvos')),
  draft_json TEXT NOT NULL,
  synced_json TEXT NOT NULL DEFAULT '{}',
  screenshots_json TEXT,
  errors_json TEXT NOT NULL DEFAULT '{}',
  apple_app_id TEXT,
  apple_version_id TEXT,
  submission_id TEXT,
  stage TEXT NOT NULL DEFAULT 'draft' CHECK (stage IN ('draft', 'waiting', 'in-review', 'rejected', 'pending-release', 'releasing', 'ready')),
  apple_state TEXT,
  release_type TEXT NOT NULL DEFAULT 'AFTER_APPROVAL' CHECK (release_type IN ('AFTER_APPROVAL', 'MANUAL')),
  message TEXT,
  live_version TEXT,
  submitted_at TEXT,
  checked_at TEXT,
  released_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, platform)
);
CREATE INDEX app_store_versions_stage ON app_store_versions(stage, checked_at);
