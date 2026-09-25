-- Local-only additive access schema. Do not migrate historical principal rows.
CREATE TABLE "Trainer2Owner" (
  "id" integer PRIMARY KEY CHECK ("id" = 1),
  "accountId" text NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE RESTRICT,
  "passcodeVerifier" text,
  "setupVerifier" text,
  "failedAttempts" integer NOT NULL DEFAULT 0 CHECK ("failedAttempts" >= 0),
  "lockedUntil" timestamptz(3),
  "sessionEpoch" integer NOT NULL DEFAULT 0 CHECK ("sessionEpoch" >= 0),
  CHECK (("passcodeVerifier" IS NULL) <> ("setupVerifier" IS NULL))
);
CREATE TABLE "Trainer2DeviceSession" (
  "id" uuid PRIMARY KEY,
  "ownerId" integer NOT NULL REFERENCES "Trainer2Owner"("id") ON DELETE RESTRICT,
  "tokenHash" text NOT NULL UNIQUE,
  "createdAt" timestamptz(3) NOT NULL,
  "expiresAt" timestamptz(3) NOT NULL,
  "absoluteExpiresAt" timestamptz(3) NOT NULL,
  "renewedAt" timestamptz(3) NOT NULL,
  "revokedAt" timestamptz(3),
  "epoch" integer NOT NULL
);
CREATE INDEX "Trainer2DeviceSession_owner_active_idx" ON "Trainer2DeviceSession"("ownerId", "expiresAt") WHERE "revokedAt" IS NULL;
REVOKE ALL ON "Trainer2Owner", "Trainer2DeviceSession" FROM PUBLIC;
ALTER TABLE "Trainer2Owner" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trainer2DeviceSession" ENABLE ROW LEVEL SECURITY;
