-- Historical rows do not contain enough persisted source evidence to reconstruct
-- an exact identity. Keep them readable and label that uncertainty honestly.
ALTER TABLE "PreSessionReadinessSnapshot"
  ADD COLUMN "identityStatus" TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN',
  ADD COLUMN "identityContractVersion" INTEGER,
  ADD COLUMN "identityJson" JSONB,
  ADD COLUMN "identityHash" TEXT,
  ADD COLUMN "targetHash" TEXT,
  ADD COLUMN "payloadHash" TEXT,
  ADD COLUMN "readinessEvidenceFingerprint" TEXT,
  ADD COLUMN "projectionFingerprint" TEXT,
  ADD COLUMN "seedRevisionId" TEXT,
  ADD COLUMN "seedRevisionNumber" INTEGER,
  ADD COLUMN "seedPayloadHash" TEXT,
  ADD COLUMN "prescriptionFingerprint" TEXT;

ALTER TABLE "PreSessionReadinessSnapshot"
  ADD CONSTRAINT "psrs_identity_status_check"
    CHECK ("identityStatus" IN ('LEGACY_UNKNOWN', 'EXACT')),
  ADD CONSTRAINT "psrs_exact_identity_complete_check"
    CHECK (
      "identityStatus" <> 'EXACT'
      OR (
        "identityContractVersion" IS NOT NULL
        AND "identityJson" IS NOT NULL
        AND "identityHash" IS NOT NULL
        AND "targetHash" IS NOT NULL
        AND "payloadHash" IS NOT NULL
        AND "readinessEvidenceFingerprint" IS NOT NULL
        AND "projectionFingerprint" IS NOT NULL
      )
    );

CREATE INDEX "psrs_exact_identity_lookup_idx"
  ON "PreSessionReadinessSnapshot"("userId", "identityHash");

CREATE INDEX "psrs_target_history_idx"
  ON "PreSessionReadinessSnapshot"("userId", "targetHash", "createdAt" DESC);

-- PostgreSQL is the final concurrency guard. Application checks provide useful
-- conflict messages, while these partial indexes make duplicate active exact
-- identities and duplicate active logical targets impossible.
CREATE UNIQUE INDEX "psrs_one_active_exact_identity_uidx"
  ON "PreSessionReadinessSnapshot"("userId", "identityHash")
  WHERE "invalidatedAt" IS NULL AND "identityStatus" = 'EXACT';

CREATE UNIQUE INDEX "psrs_one_active_target_uidx"
  ON "PreSessionReadinessSnapshot"("userId", "targetHash")
  WHERE "invalidatedAt" IS NULL AND "identityStatus" = 'EXACT';
