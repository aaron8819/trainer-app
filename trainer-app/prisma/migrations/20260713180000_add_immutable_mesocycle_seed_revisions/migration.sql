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

WITH executable_legacy_seeds AS (
    SELECT "id", "slotPlanSeedJson"
    FROM "Mesocycle"
    WHERE "slotPlanSeedJson" IS NOT NULL
      -- This completed identity-only legacy seed has unresolved historical set intent.
      -- Preserve its compatibility snapshot and leave currentSeedRevisionId NULL.
      AND "id" <> '12079700-5333-4ffc-9cbd-bb303588f288'
      AND jsonb_typeof("slotPlanSeedJson") = 'object'
      AND "slotPlanSeedJson" -> 'version' = '1'::jsonb
      AND CASE
        WHEN jsonb_typeof("slotPlanSeedJson" -> 'slots') = 'array'
        THEN jsonb_array_length("slotPlanSeedJson" -> 'slots') > 0
        ELSE false
      END
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof("slotPlanSeedJson" -> 'slots') = 'array'
            THEN "slotPlanSeedJson" -> 'slots'
            ELSE '[]'::jsonb
          END
        ) AS slot(value)
        WHERE jsonb_typeof(slot.value) IS DISTINCT FROM 'object'
           OR jsonb_typeof(slot.value -> 'slotId') IS DISTINCT FROM 'string'
           OR btrim(slot.value ->> 'slotId') = ''
           OR CASE
                WHEN jsonb_typeof(slot.value -> 'exercises') = 'array'
                THEN jsonb_array_length(slot.value -> 'exercises') = 0
                ELSE true
              END
           OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(
                  CASE
                    WHEN jsonb_typeof(slot.value -> 'exercises') = 'array'
                    THEN slot.value -> 'exercises'
                    ELSE '[]'::jsonb
                  END
                ) AS exercise(value)
                WHERE jsonb_typeof(exercise.value) IS DISTINCT FROM 'object'
                   OR jsonb_typeof(exercise.value -> 'exerciseId') IS DISTINCT FROM 'string'
                   OR btrim(exercise.value ->> 'exerciseId') = ''
                   OR jsonb_typeof(exercise.value -> 'role') IS DISTINCT FROM 'string'
                   OR exercise.value ->> 'role' NOT IN ('CORE_COMPOUND', 'ACCESSORY')
                   OR NOT CASE
                        WHEN jsonb_typeof(exercise.value -> 'setCount') = 'number'
                        THEN (exercise.value ->> 'setCount')::numeric > 0
                          AND mod((exercise.value ->> 'setCount')::numeric, 1) = 0
                        ELSE false
                      END
                   OR CASE
                        WHEN exercise.value ? 'name'
                        THEN jsonb_typeof(exercise.value -> 'name') IS DISTINCT FROM 'string'
                          OR btrim(exercise.value ->> 'name') = ''
                        ELSE false
                      END
           )
      )
)
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
FROM executable_legacy_seeds;

UPDATE "Mesocycle" AS mesocycle
SET "currentSeedRevisionId" = revision."id"
FROM "MesocycleSeedRevision" AS revision
WHERE revision."id" = 'legacy-baseline:' || mesocycle."id"
  AND revision."mesocycleId" = mesocycle."id"
  AND revision."revision" = 1
  AND revision."creationReason" = 'legacy_baseline_import'
  AND mesocycle."currentSeedRevisionId" IS NULL;

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
