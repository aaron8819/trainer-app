-- Optional explanation for value edits; clearing remains reasoned and lifecycle-scoped.
BEGIN;
ALTER TABLE "Trainer2SetResultRevision" DROP CONSTRAINT "Trainer2SetResultRevision_check";
ALTER TABLE "Trainer2SetResultRevision" ADD CONSTRAINT "Trainer2SetResultRevision_check" CHECK (
  ("version"=1 AND "reason" IS NULL AND "result"<>'null'::jsonb) OR
  ("version">1 AND ("reason" IS NULL OR length(trim("reason")) BETWEEN 1 AND 200)
    AND ("result"<>'null'::jsonb OR "reason" IS NOT NULL))
);
CREATE OR REPLACE FUNCTION trainer2_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x "Trainer2Execution"; previous "Trainer2SetResultRevision"; e jsonb;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO x FROM "Trainer2Execution" WHERE "accountId"=NEW."accountId" AND "id"=NEW."executionId";
 IF EXISTS (SELECT 1 FROM "Trainer2ExecutionDiscard" WHERE "executionId"=NEW."executionId") THEN RAISE EXCEPTION 'TRAINER2_RESULT_DISCARDED'; END IF;
 SELECT * INTO previous FROM "Trainer2SetResultRevision" WHERE "executionId"=NEW."executionId" AND "targetId"=NEW."targetId" ORDER BY "version" DESC LIMIT 1;
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 IF e->>'commandType'='CorrectHistoricalSetResult' THEN
   IF x."lifecycle" IS DISTINCT FROM 'Finished' OR NOT EXISTS (SELECT 1 FROM "Trainer2ExecutionFinish" WHERE "executionId"=NEW."executionId")
     OR previous."version" IS NULL OR previous."result"='null'::jsonb OR NEW."result"='null'::jsonb
   THEN RAISE EXCEPTION 'TRAINER2_HISTORICAL_RESULT_SOURCE'; END IF;
 ELSIF EXISTS (SELECT 1 FROM "Trainer2ExecutionFinish" WHERE "executionId"=NEW."executionId") OR x."lifecycle" IS DISTINCT FROM 'Open' THEN
   RAISE EXCEPTION 'TRAINER2_RESULT_SOURCE';
 END IF;
 IF e->>'commandType'='CorrectHistoricalSetResult' THEN NEW."recordedAt" := clock_timestamp(); END IF;
 IF NOT EXISTS (
   SELECT 1 FROM jsonb_array_elements(x."initialPrescription"->'positions') p,
   jsonb_array_elements(p->'targets') t WHERE t->>'id'=NEW."targetId"::text
 ) OR e->'target' IS DISTINCT FROM jsonb_build_object('executionId',NEW."executionId"::text,'targetId',NEW."targetId"::text)
   OR e->'intent'->'result' IS DISTINCT FROM NEW."result"
   OR NEW."version" <> coalesce(previous."version",0)+1
   OR EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId")
 THEN RAISE EXCEPTION 'TRAINER2_RESULT_SOURCE'; END IF;
 IF previous."version" IS NULL THEN
   IF e->>'commandType' IS DISTINCT FROM 'RecordSetResult' OR e->'expected' IS DISTINCT FROM '{"resultVersion":0}'::jsonb
     OR NEW."result"='null'::jsonb OR NEW."reason" IS NOT NULL
   THEN RAISE EXCEPTION 'TRAINER2_RESULT_INITIAL'; END IF;
 ELSE
   IF (e->>'commandType' IN ('CorrectSetResult','CorrectHistoricalSetResult')) IS NOT TRUE OR NEW."performedSetId" IS DISTINCT FROM previous."performedSetId"
     OR e->'expected' IS DISTINCT FROM jsonb_build_object('resultVersion',previous."version",'performedSetId',previous."performedSetId"::text)
     OR e->'intent'->>'reason' IS DISTINCT FROM NEW."reason"
     OR (NEW."reason" IS NOT NULL AND length(trim(NEW."reason")) NOT BETWEEN 1 AND 200)
     OR (NEW."result"='null'::jsonb AND NEW."reason" IS NULL)
   THEN RAISE EXCEPTION 'TRAINER2_RESULT_VERSION'; END IF;
 END IF;
 RETURN NEW;
END $$;

COMMIT;
