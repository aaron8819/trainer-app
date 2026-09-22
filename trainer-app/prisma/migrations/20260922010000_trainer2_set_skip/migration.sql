-- Explicit set skip audit and reviewed reopening. Historical migrations are unchanged.
BEGIN;
CREATE TABLE "Trainer2SetSkip" (
 "executionId" uuid NOT NULL, "targetId" uuid NOT NULL, "accountId" text NOT NULL, "actionId" uuid NOT NULL,
 "skippedAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("executionId","targetId"), UNIQUE ("accountId","actionId"),
 FOREIGN KEY ("accountId","executionId") REFERENCES "Trainer2Execution"("accountId","id"),
 FOREIGN KEY ("accountId","actionId") REFERENCES "Trainer2DurableAction"("accountId","actionId")
);
CREATE TRIGGER trainer2_set_skip_immutable BEFORE UPDATE OR DELETE ON "Trainer2SetSkip"
 FOR EACH ROW EXECUTE FUNCTION trainer2_immutable();
CREATE FUNCTION trainer2_set_skip_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x "Trainer2Execution"; e jsonb;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO x FROM "Trainer2Execution" WHERE "accountId"=NEW."accountId" AND "id"=NEW."executionId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 IF x."lifecycle" IS DISTINCT FROM 'Open'
 OR EXISTS (SELECT 1 FROM "Trainer2ExecutionFinish" WHERE "executionId"=NEW."executionId")
 OR EXISTS (SELECT 1 FROM "Trainer2ExecutionDiscard" WHERE "executionId"=NEW."executionId")
 OR EXISTS (SELECT 1 FROM "Trainer2SetResultRevision" WHERE "executionId"=NEW."executionId" AND "targetId"=NEW."targetId")
 OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(x."initialPrescription"->'positions') p,
   jsonb_array_elements(p->'targets') t WHERE t->>'id'=NEW."targetId"::text)
 OR e->>'commandType' IS DISTINCT FROM 'SkipSet'
 OR e->'target' IS DISTINCT FROM jsonb_build_object('executionId',NEW."executionId"::text,'targetId',NEW."targetId"::text)
 OR e->'expected' IS DISTINCT FROM '{"resultVersion":0,"skipActionId":null}'::jsonb
 OR e->'intent' IS DISTINCT FROM '{}'::jsonb
 OR EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId")
 THEN RAISE EXCEPTION 'TRAINER2_SET_SKIP_SOURCE'; END IF;
 NEW."skippedAt" := clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER trainer2_set_skip_guard BEFORE INSERT ON "Trainer2SetSkip" FOR EACH ROW EXECUTE FUNCTION trainer2_set_skip_guard();
CREATE FUNCTION trainer2_set_skip_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" o WHERE o."accountId"=NEW."accountId" AND o."actionId"=NEW."actionId"
 AND o."status"='Accepted' AND o."outcome"->>'commandType'='SkipSet'
 AND o."outcome"->'result'=jsonb_build_object('executionId',NEW."executionId"::text,'targetId',NEW."targetId"::text))
 THEN RAISE EXCEPTION 'TRAINER2_SET_SKIP_OUTCOME'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trainer2_set_skip_seal AFTER INSERT ON "Trainer2SetSkip" DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION trainer2_set_skip_seal();
ALTER TABLE "Trainer2SetSkip" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "Trainer2SetSkip" FROM PUBLIC;
REVOKE ALL ON FUNCTION trainer2_set_skip_guard(),trainer2_set_skip_seal() FROM PUBLIC;

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
   IF e->>'commandType' IS DISTINCT FROM 'RecordSetResult' OR e->'expected' IS DISTINCT FROM ('{"resultVersion":0}'::jsonb || coalesce((SELECT jsonb_build_object('skipActionId',s."actionId"::text) FROM "Trainer2SetSkip" s WHERE s."executionId"=NEW."executionId" AND s."targetId"=NEW."targetId"),'{}'::jsonb))
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
CREATE OR REPLACE FUNCTION trainer2_finish_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x "Trainer2Execution"; p "Trainer2Plan"; e jsonb; d jsonb; binding jsonb; unknowns jsonb; complete boolean;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO x FROM "Trainer2Execution" WHERE "id"=NEW."executionId" AND "accountId"=NEW."accountId";
 SELECT * INTO p FROM "Trainer2Plan" WHERE "id"=x."planId" AND "accountId"=NEW."accountId";
 SELECT "document" INTO d FROM "Trainer2PlanRevision" WHERE "id"=x."revisionId" AND "accountId"=NEW."accountId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 SELECT jsonb_build_object('contentHash',x."contentHash",'results',coalesce(jsonb_agg(jsonb_build_object(
   'targetId',t->>'id','resultVersion',coalesce(r."version",0),'performedSetId',r."performedSetId"::text) || coalesce((SELECT jsonb_build_object('skipActionId',s."actionId"::text) FROM "Trainer2SetSkip" s WHERE s."executionId"=x."id" AND s."targetId"::text=t->>'id'),'{}'::jsonb) ORDER BY t->>'id'),'[]'::jsonb)),
   coalesce(jsonb_agg(t->>'id' ORDER BY t->>'id') FILTER (WHERE r."result" IS NULL OR r."result"='null'::jsonb),'[]'::jsonb)
 INTO binding,unknowns FROM jsonb_array_elements(x."initialPrescription"->'positions') pos,
   jsonb_array_elements(pos->'targets') t LEFT JOIN LATERAL (
    SELECT * FROM "Trainer2SetResultRevision" r WHERE r."executionId"=x."id" AND r."targetId"::text=t->>'id' ORDER BY "version" DESC LIMIT 1
   ) r ON true;
 SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'occurrences') o WHERE o->>'id'<>x."occurrenceId"::text
   AND NOT trainer2_occurrence_resolved(NEW."accountId",x."planId",o->>'id')) INTO complete;
 IF EXISTS (SELECT 1 FROM "Trainer2ExecutionDiscard" WHERE "executionId"=NEW."executionId") THEN RAISE EXCEPTION 'TRAINER2_FINISH_DISCARDED'; END IF;
 IF x."lifecycle" IS DISTINCT FROM 'Open' OR p."lifecycle" IS DISTINCT FROM 'Active' OR p."tombstonedAt" IS NOT NULL
   OR p."currentRevisionId" IS DISTINCT FROM x."revisionId" OR p."initialApprovedRevisionId" IS DISTINCT FROM x."revisionId"
   OR (NEW."planId",NEW."revisionId",NEW."occurrenceId") IS DISTINCT FROM (x."planId",x."revisionId",x."occurrenceId")
   OR e->>'commandType' IS DISTINCT FROM 'FinishExecution' OR e->'target' IS DISTINCT FROM jsonb_build_object('executionId',x."id"::text)
   OR NEW."expected" IS DISTINCT FROM binding OR e->'expected' IS DISTINCT FROM binding
   OR NEW."unknownTargetIds" IS DISTINCT FROM unknowns
   OR e->'intent' NOT IN ('{"acknowledgeUnrecorded":true}'::jsonb,'{"acknowledgeUnrecorded":false}'::jsonb)
   OR e->'intent' IS NULL OR (jsonb_array_length(unknowns)>0 AND e->'intent'->'acknowledgeUnrecorded' IS DISTINCT FROM 'true'::jsonb)
   OR NEW."planCompleted" IS DISTINCT FROM complete OR NEW."priorPlanLifecycle" IS DISTINCT FROM p."lifecycle"
   OR NEW."endpoint" IS DISTINCT FROM jsonb_build_object('kind',d->>'endpoint','occurrenceIds',(SELECT jsonb_agg(o->>'id' ORDER BY n) FROM jsonb_array_elements(d->'occurrences') WITH ORDINALITY a(o,n)))
   OR NEW."createdTx"<>txid_current() OR NEW."finishedAt"<x."startedAt"
   OR EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId")
 THEN RAISE EXCEPTION 'TRAINER2_FINISH_SOURCE'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION trainer2_discard_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x "Trainer2Execution"; e jsonb; binding jsonb;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO x FROM "Trainer2Execution" WHERE "id"=NEW."executionId" AND "accountId"=NEW."accountId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 SELECT jsonb_build_object('contentHash',x."contentHash",'results',coalesce(jsonb_agg(jsonb_build_object(
   'targetId',t->>'id','resultVersion',0,'performedSetId',NULL) ORDER BY t->>'id'),'[]'::jsonb))
 INTO binding FROM jsonb_array_elements(x."initialPrescription"->'positions') pos, jsonb_array_elements(pos->'targets') t;
 IF x."lifecycle" IS DISTINCT FROM 'Open' OR NEW."occurrenceId" IS DISTINCT FROM x."occurrenceId"
   OR EXISTS (SELECT 1 FROM "Trainer2SetSkip" WHERE "executionId"=x."id")
   OR EXISTS (SELECT 1 FROM "Trainer2SetResultRevision" WHERE "executionId"=x."id")
   OR EXISTS (SELECT 1 FROM "Trainer2ExecutionFinish" WHERE "executionId"=x."id")
   OR e->>'commandType' IS DISTINCT FROM 'DiscardEmptyExecution'
   OR e->'target' IS DISTINCT FROM jsonb_build_object('executionId',x."id"::text,'occurrenceId',x."occurrenceId"::text)
   OR NEW."expected" IS DISTINCT FROM binding OR e->'expected' IS DISTINCT FROM binding OR e->'intent' IS DISTINCT FROM '{}'::jsonb
   OR NEW."createdTx"<>txid_current()
   OR EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId")
 THEN RAISE EXCEPTION 'TRAINER2_DISCARD_SOURCE'; END IF;
 -- Trusted server time; never accept a caller-supplied timestamp.
 NEW."discardedAt" := clock_timestamp();
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION trainer2_discard_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Trainer2Execution" x WHERE x."id"=NEW."executionId" AND x."lifecycle"='Discarded'
   AND NOT EXISTS (SELECT 1 FROM "Trainer2SetSkip" WHERE "executionId"=x."id")
   AND NOT EXISTS (SELECT 1 FROM "Trainer2SetResultRevision" r WHERE r."executionId"=x."id")
   AND NOT EXISTS (SELECT 1 FROM "Trainer2ExecutionFinish" f WHERE f."executionId"=x."id")
   AND EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" o WHERE o."accountId"=NEW."accountId" AND o."actionId"=NEW."actionId" AND o."status"='Accepted'
    AND o."outcome"->'result'=jsonb_build_object('executionId',x."id"::text,'planId',x."planId"::text,'occurrenceId',x."occurrenceId"::text)))
 THEN RAISE EXCEPTION 'TRAINER2_DISCARD_OUTCOME'; END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION trainer2_check_acceptance(account_id text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM "Trainer2ActionOutcome" o
   LEFT JOIN "Trainer2DurableAction" a ON a."accountId"=o."accountId" AND a."actionId"=o."actionId"
   LEFT JOIN "Trainer2PlanRevision" r ON r."accountId"=o."accountId" AND r."actionId"=o."actionId"
   LEFT JOIN "Trainer2Plan" p ON p."accountId"=r."accountId" AND p."id"=r."planId"
   WHERE o."accountId"=account_id AND o."status"='Accepted' AND a."submittedEnvelope"::jsonb->>'commandType' IN ('CreateDraft','EditDraft') AND (
     p."id" IS NULL OR
     (a."submittedEnvelope"::jsonb->>'commandType' IN ('CreateDraft','EditDraft')) IS NOT TRUE OR
     o."outcome"->>'commandType' IS DISTINCT FROM a."submittedEnvelope"::jsonb->>'commandType' OR
     a."submittedEnvelope"::jsonb->'target'->>'planId' IS DISTINCT FROM r."planId"::text OR
     o."outcome"->'result' IS DISTINCT FROM jsonb_build_object(
       'planId',r."planId"::text,'revisionId',r."id"::text,
       'revisionNumber',r."revisionNumber",'contentHash',r."contentHash") OR
     CASE a."submittedEnvelope"::jsonb->>'commandType'
       WHEN 'CreateDraft' THEN r."parentRevisionId" IS NOT NULL OR r."revisionNumber"<>1
       WHEN 'EditDraft' THEN r."parentRevisionId" IS NULL OR
         a."submittedEnvelope"::jsonb->'expected'->>'planRevisionId' IS DISTINCT FROM r."parentRevisionId"::text
       ELSE true END
   )
 ) THEN
   RAISE EXCEPTION 'TRAINER2_ACCEPTANCE_REVISION' USING ERRCODE='23514', CONSTRAINT='trainer2_acceptance_revision';
 END IF;
 IF EXISTS (
   SELECT 1 FROM "Trainer2ActionOutcome" o JOIN "Trainer2DurableAction" a USING ("accountId","actionId")
   LEFT JOIN "Trainer2PlanDecision" d USING ("accountId","actionId")
   LEFT JOIN "Trainer2InstructionRevision" i ON i."accountId"=o."accountId" AND i."actionId"=o."actionId"
   WHERE o."accountId"=account_id AND o."status"='Accepted' AND (
     o."outcome"->>'commandType' IS DISTINCT FROM a."submittedEnvelope"::jsonb->>'commandType' OR
     CASE a."submittedEnvelope"::jsonb->>'commandType'
       WHEN 'CreateDraft' THEN false
       WHEN 'EditDraft' THEN false
       WHEN 'ActivatePlan' THEN d."id" IS NULL OR o."outcome"->'result' IS DISTINCT FROM jsonb_build_object(
         'planId',d."planId"::text,'revisionId',d."revisionId"::text,'decisionId',d."id"::text,'lifecycle','Active')
       WHEN 'ChangeInstructions' THEN i."id" IS NULL OR o."outcome"->'result' IS DISTINCT FROM jsonb_build_object(
         'instructionRevisionId',i."id"::text,'instructionEpoch',i."epoch")
       WHEN 'RecordSetResult' THEN NOT EXISTS (SELECT 1 FROM "Trainer2SetResultRevision" r WHERE r."accountId"=o."accountId" AND r."actionId"=o."actionId"
         AND r."version"=1 AND o."outcome"->'result'=jsonb_build_object('executionId',r."executionId"::text,'targetId',r."targetId"::text,'performedSetId',r."performedSetId"::text,'version',r."version"))
       WHEN 'CorrectSetResult' THEN NOT EXISTS (SELECT 1 FROM "Trainer2SetResultRevision" r WHERE r."accountId"=o."accountId" AND r."actionId"=o."actionId"
         AND r."version">1 AND o."outcome"->'result'=jsonb_build_object('executionId',r."executionId"::text,'targetId',r."targetId"::text,'performedSetId',r."performedSetId"::text,'version',r."version"))
       WHEN 'CorrectHistoricalSetResult' THEN NOT EXISTS (SELECT 1 FROM "Trainer2SetResultRevision" r WHERE r."accountId"=o."accountId" AND r."actionId"=o."actionId"
         AND r."version">1 AND o."outcome"->'result'=jsonb_build_object('executionId',r."executionId"::text,'targetId',r."targetId"::text,'performedSetId',r."performedSetId"::text,'version',r."version"))
       WHEN 'DiscardEmptyExecution' THEN NOT EXISTS (SELECT 1 FROM "Trainer2ExecutionDiscard" d JOIN "Trainer2Execution" x ON x."id"=d."executionId"
         WHERE d."accountId"=o."accountId" AND d."actionId"=o."actionId" AND o."outcome"->'result'=jsonb_build_object('executionId',x."id"::text,'planId',x."planId"::text,'occurrenceId',x."occurrenceId"::text))
       WHEN 'FinishExecution'  THEN NOT EXISTS (SELECT 1 FROM "Trainer2ExecutionFinish" f WHERE f."accountId"=o."accountId" AND f."actionId"=o."actionId"
         AND o."outcome"->'result'=jsonb_build_object('executionId',f."executionId"::text,'planId',f."planId"::text,'occurrenceId',f."occurrenceId"::text,'planCompleted',f."planCompleted"))
       WHEN 'SkipSet' THEN NOT EXISTS (SELECT 1 FROM "Trainer2SetSkip" s WHERE s."accountId"=o."accountId" AND s."actionId"=o."actionId"
         AND o."outcome"->'result'=jsonb_build_object('executionId',s."executionId"::text,'targetId',s."targetId"::text))
       WHEN 'SkipOccurrence' THEN NOT EXISTS (SELECT 1 FROM "Trainer2OccurrenceSkip" s WHERE s."accountId"=o."accountId" AND s."actionId"=o."actionId"
         AND o."outcome"->'result'=jsonb_build_object('planId',s."planId"::text,'revisionId',s."revisionId"::text,'occurrenceId',s."occurrenceId"::text,'planCompleted',s."planCompleted"))
       WHEN 'StartOccurrence' THEN NOT EXISTS (SELECT 1 FROM "Trainer2Execution" x WHERE x."accountId"=o."accountId" AND x."actionId"=o."actionId"
         AND o."outcome"->'result'=jsonb_build_object('executionId',x."id"::text,'planId',x."planId"::text,'revisionId',x."revisionId"::text,'occurrenceId',x."occurrenceId"::text,'contentHash',x."contentHash"))
       ELSE true END
   )
 ) THEN RAISE EXCEPTION 'TRAINER2_ACCEPTANCE_OWNER'; END IF;
 -- Accepted commands alone advance the counter, exactly once in outcome order.
 -- Comparing JSON avoids casts of untrusted sequence text and rejects missing,
 -- duplicated, fabricated, noncanonical or out-of-order acceptance sequences.
 IF EXISTS (
   SELECT 1 FROM (
     SELECT "outcome", row_number() OVER (ORDER BY "outcomeCursor") AS sequence
     FROM "Trainer2ActionOutcome" WHERE "accountId"=account_id AND "status"='Accepted'
   ) accepted WHERE "outcome"->'acceptedSequence' IS DISTINCT FROM to_jsonb(sequence::text)
 ) OR NOT EXISTS (
   SELECT 1 FROM "Trainer2AccountTrainingState" s WHERE s."accountId"=account_id AND s."acceptedSequence"=(
     SELECT count(*) FROM "Trainer2ActionOutcome" WHERE "accountId"=account_id AND "status"='Accepted'
   )
 ) THEN
   RAISE EXCEPTION 'TRAINER2_ACCEPTANCE_SEQUENCE' USING ERRCODE='23514', CONSTRAINT='trainer2_acceptance_sequence';
 END IF;
END $$;
COMMIT;
