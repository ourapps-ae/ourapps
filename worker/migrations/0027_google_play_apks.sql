-- The universal APK Google Play generates and signs from each bundle ourapps released, per app and version code: the
-- download ID generatedapks.list gives once Google has generated it, the SHA-256 of the certificate it is signed with,
-- and the last refusal of the list or the download.
CREATE TABLE google_play_apks (
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version_code INTEGER NOT NULL,
  version TEXT NOT NULL,
  download_id TEXT,
  certificate_sha256 TEXT,
  error TEXT,
  found_at TEXT,
  checked_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, version_code)
);
CREATE INDEX google_play_apks_waiting ON google_play_apks(checked_at) WHERE download_id IS NULL;
