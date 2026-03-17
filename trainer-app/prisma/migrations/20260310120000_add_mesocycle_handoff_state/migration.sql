-- Add explicit mesocycle handoff boundary state and persistence.
ALTER TYPE "MesocycleState" ADD VALUE 'AWAITING_HANDOFF';

ALTER TABLE "Mesocycle"
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "handoffSummaryJson" JSONB,
ADD COLUMN "nextSeedDraftJson" JSONB;

CREATE INDEX "Mesocycle_macroCycleId_state_idx" ON "Mesocycle"("macroCycleId", "state");
