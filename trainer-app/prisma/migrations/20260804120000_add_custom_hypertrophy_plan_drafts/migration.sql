-- Existing plans already have an established schedule. New custom drafts
-- explicitly write NULL until their first activation.
ALTER TABLE "MacroCycle"
ADD COLUMN "scheduleAnchoredAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "HypertrophyPlanDraft" (
    "macroCycleId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HypertrophyPlanDraft_pkey" PRIMARY KEY ("macroCycleId")
);

ALTER TABLE "HypertrophyPlanDraft"
ADD CONSTRAINT "HypertrophyPlanDraft_macroCycleId_fkey"
FOREIGN KEY ("macroCycleId") REFERENCES "MacroCycle"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HypertrophyPlanDraft"
ADD CONSTRAINT "HypertrophyPlanDraft_revision_check"
CHECK ("revision" >= 1);
