-- Add exerciseId to Baseline for FK-based resolution

ALTER TABLE "Baseline" ADD COLUMN IF NOT EXISTS "exerciseId" text;

DO $$ BEGIN
  ALTER TABLE "Baseline"
    ADD CONSTRAINT "Baseline_exerciseId_fkey"
    FOREIGN KEY ("exerciseId")
    REFERENCES "Exercise"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Baseline_exerciseId_idx" ON "Baseline"("exerciseId");
