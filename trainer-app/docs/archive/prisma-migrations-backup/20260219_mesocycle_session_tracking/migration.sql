-- ADR-080: Session-count-based week tracking for Mesocycle
-- Adds completedSessions and isActive to support session-count-based week derivation
-- instead of calendar-based derivation (which auto-advances weeks on missed sessions)

ALTER TABLE "Mesocycle" ADD COLUMN IF NOT EXISTS "completedSessions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Mesocycle" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Mesocycle_macroCycleId_isActive_idx"
  ON "Mesocycle"("macroCycleId", "isActive");
