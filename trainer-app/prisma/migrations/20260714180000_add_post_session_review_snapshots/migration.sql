-- Finalized post-session reviews are immutable historical evidence. Legacy
-- workouts remain valid without a snapshot and can be backfilled explicitly.
CREATE TABLE "PostSessionReviewSnapshot" (
  "id" TEXT NOT NULL,
  "workoutId" TEXT NOT NULL,
  "contractVersion" INTEGER NOT NULL,
  "computationPolicyVersion" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "evidenceFingerprint" TEXT NOT NULL,
  "provenance" TEXT NOT NULL,
  "finalizedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PostSessionReviewSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PostSessionReviewSnapshot_provenance_check"
    CHECK ("provenance" IN ('exact', 'legacy_derived', 'legacy_unknown'))
);

CREATE UNIQUE INDEX "PostSessionReviewSnapshot_workoutId_key"
ON "PostSessionReviewSnapshot"("workoutId");

CREATE INDEX "PostSessionReviewSnapshot_provenance_finalizedAt_idx"
ON "PostSessionReviewSnapshot"("provenance", "finalizedAt");

CREATE INDEX "PostSessionReviewSnapshot_contractVersion_computationPolicyVersion_idx"
ON "PostSessionReviewSnapshot"("contractVersion", "computationPolicyVersion");

ALTER TABLE "PostSessionReviewSnapshot"
ADD CONSTRAINT "PostSessionReviewSnapshot_workoutId_fkey"
FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_post_session_review_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PostSessionReviewSnapshot rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PostSessionReviewSnapshot_immutable_mutation"
BEFORE UPDATE OR DELETE ON "PostSessionReviewSnapshot"
FOR EACH ROW EXECUTE FUNCTION prevent_post_session_review_snapshot_mutation();
