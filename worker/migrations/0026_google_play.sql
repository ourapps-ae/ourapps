-- Google Play: the app's Android application ID, the package name its Play Console app was created with.
ALTER TABLE apps ADD COLUMN android_package TEXT NOT NULL DEFAULT '';

-- Once per app: where each Google Play step stands. The default privacy policy's answers stay in app_store_apps.
CREATE TABLE google_play_apps (
  app_id TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,
  -- The package name Google Play answered for, and when.
  found_package TEXT,
  found_at TEXT,
  content_confirmed_at TEXT,
  listing_json TEXT,
  listing_synced_at TEXT,
  -- The privacy policy address given in App content: the developer's own, or empty for ourapps' default policy.
  policy_url TEXT,
  graphics_json TEXT,
  testing_link INTEGER NOT NULL DEFAULT 0 CHECK (testing_link IN (0, 1)),
  first_closed_at TEXT,
  errors_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

-- Each release ourapps committed to a Google Play track, and what Google says of it.
CREATE TABLE google_play_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  track TEXT NOT NULL CHECK (track IN ('internal', 'alpha', 'beta', 'production')),
  version TEXT NOT NULL,
  version_code INTEGER NOT NULL,
  bundle_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'inProgress', 'draft')),
  user_fraction REAL,
  stage TEXT NOT NULL DEFAULT 'sent' CHECK (stage IN ('sent', 'not-sent', 'in-review', 'approved', 'rejected', 'draft', 'live', 'replaced')),
  google_state TEXT,
  message TEXT,
  committed_at TEXT NOT NULL,
  checked_at TEXT,
  live_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX google_play_releases_app ON google_play_releases(app_id, id);
CREATE INDEX google_play_releases_stage ON google_play_releases(stage, checked_at);

-- Android version codes ourapps hands out per app: the last one given (0 before the first), and Play's highest when last read.
CREATE TABLE android_version_codes (
  app_id TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,
  counter INTEGER NOT NULL DEFAULT 0 CHECK (typeof(counter) = 'integer' AND counter >= 0 AND counter <= 2100000000),
  play_maximum INTEGER,
  play_checked_at TEXT
);

-- The code each verified workflow run attempt was given, so a retried attempt gets the same one.
CREATE TABLE android_version_code_runs (
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  github_repo TEXT NOT NULL,
  run_id TEXT NOT NULL,
  run_attempt TEXT NOT NULL,
  version_code INTEGER NOT NULL,
  version TEXT,
  run_created_at TEXT NOT NULL,
  run_started_at TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  PRIMARY KEY (app_id, github_repo, run_id, run_attempt)
);
