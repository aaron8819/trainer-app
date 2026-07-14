-- Immutable accepted-seed revisions. Existing seed JSON remains as compatibility
-- storage; baseline rows are explicitly legacy/unknown because prior in-place
-- mutation cannot be ruled out.
CREATE TABLE "MesocycleSeedRevision" (
    "id" TEXT NOT NULL,
    "mesocycleId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "seedPayload" JSONB NOT NULL,
    "payloadHash" TEXT,
    "hashAlgorithm" TEXT,
    "provenanceStatus" TEXT NOT NULL,
    "creationReason" TEXT NOT NULL,
    "actorSource" TEXT,
    "sourceRevisionId" TEXT,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MesocycleSeedRevision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Mesocycle" ADD COLUMN "currentSeedRevisionId" TEXT;
ALTER TABLE "Workout" ADD COLUMN "seedRevisionId" TEXT;
ALTER TABLE "Workout" ADD COLUMN "seedRevisionNumber" INTEGER;
ALTER TABLE "Workout" ADD COLUMN "seedPayloadHash" TEXT;

CREATE UNIQUE INDEX "Mesocycle_currentSeedRevisionId_key"
ON "Mesocycle"("currentSeedRevisionId");
CREATE UNIQUE INDEX "MesocycleSeedRevision_mesocycleId_revision_key"
ON "MesocycleSeedRevision"("mesocycleId", "revision");
CREATE UNIQUE INDEX "MesocycleSeedRevision_mesocycleId_payloadHash_key"
ON "MesocycleSeedRevision"("mesocycleId", "payloadHash");
CREATE INDEX "MesocycleSeedRevision_sourceRevisionId_idx"
ON "MesocycleSeedRevision"("sourceRevisionId");
CREATE INDEX "MesocycleSeedRevision_mesocycleId_activatedAt_idx"
ON "MesocycleSeedRevision"("mesocycleId", "activatedAt");
CREATE INDEX "Workout_seedRevisionId_idx" ON "Workout"("seedRevisionId");

ALTER TABLE "MesocycleSeedRevision"
ADD CONSTRAINT "MesocycleSeedRevision_mesocycleId_fkey"
FOREIGN KEY ("mesocycleId") REFERENCES "Mesocycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MesocycleSeedRevision"
ADD CONSTRAINT "MesocycleSeedRevision_sourceRevisionId_fkey"
FOREIGN KEY ("sourceRevisionId") REFERENCES "MesocycleSeedRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "MesocycleSeedRevision" (
    "id",
    "mesocycleId",
    "revision",
    "seedPayload",
    "payloadHash",
    "hashAlgorithm",
    "provenanceStatus",
    "creationReason",
    "actorSource",
    "activatedAt",
    "createdAt"
)
SELECT
    'legacy-baseline:' || "id",
    "id",
    1,
    "slotPlanSeedJson",
    NULL,
    NULL,
    'legacy_unknown',
    'legacy_baseline_import',
    'migration_20260713180000',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Mesocycle"
WHERE "slotPlanSeedJson" IS NOT NULL;

UPDATE "Mesocycle"
SET "currentSeedRevisionId" = 'legacy-baseline:' || "id"
WHERE "slotPlanSeedJson" IS NOT NULL;

ALTER TABLE "Mesocycle"
ADD CONSTRAINT "Mesocycle_currentSeedRevisionId_fkey"
FOREIGN KEY ("currentSeedRevisionId") REFERENCES "MesocycleSeedRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Workout"
ADD CONSTRAINT "Workout_seedRevisionId_fkey"
FOREIGN KEY ("seedRevisionId") REFERENCES "MesocycleSeedRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_mesocycle_seed_revision_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MesocycleSeedRevision rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MesocycleSeedRevision_immutable_mutation"
BEFORE UPDATE OR DELETE ON "MesocycleSeedRevision"
FOR EACH ROW EXECUTE FUNCTION prevent_mesocycle_seed_revision_mutation();
