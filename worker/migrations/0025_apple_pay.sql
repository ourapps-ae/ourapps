-- Apple Pay, once per app: the merchant identifier (Apple's id and the identifier), the App IDs whose Apple Pay
-- capability ourapps turned on, when the developer confirmed ticking the merchant identifier on them, when the App
-- Store profiles were made again, and the last error of each step.
CREATE TABLE apple_pay_apps (
  app_id TEXT PRIMARY KEY REFERENCES apps(id) ON DELETE CASCADE,
  merchant_id TEXT,
  merchant_identifier TEXT,
  merchant_name TEXT,
  app_ids_json TEXT NOT NULL DEFAULT '[]',
  capability_at TEXT,
  ticked_at TEXT,
  profiles_at TEXT,
  errors_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

-- Payment Processing certificates ourapps made from a payment processor's request. The private key stays with the
-- processor; the certificate is public and is given back to the processor.
CREATE TABLE apple_pay_certificates (
  certificate_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  certificate_base64 TEXT NOT NULL,
  expiration_date TEXT,
  activated INTEGER CHECK (activated IS NULL OR activated IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX apple_pay_certificates_app ON apple_pay_certificates(app_id, merchant_id, created_at);
