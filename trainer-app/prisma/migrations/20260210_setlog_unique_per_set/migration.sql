-- Ensure one current log record per workout set.
-- Keep the latest completedAt record for each workoutSetId.
DELETE FROM "SetLog" a
USING "SetLog" b
WHERE a."workoutSetId" = b."workoutSetId"
  AND (
    a."completedAt" < b."completedAt"
    OR (a."completedAt" = b."completedAt" AND a."id" < b."id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "SetLog_workoutSetId_key"
  ON "SetLog"("workoutSetId");
