BEGIN;
CREATE TABLE "Trainer2ExerciseSwap" (
 "accountId" text NOT NULL, "executionId" uuid NOT NULL, "positionId" uuid NOT NULL, "version" integer NOT NULL CHECK ("version">0),
 "actionId" uuid NOT NULL, "previousActionId" uuid, "instructionEpoch" integer NOT NULL CHECK ("instructionEpoch">=0),
 "contentHash" text NOT NULL, "content" jsonb NOT NULL, "canonicalContent" text NOT NULL,
 "recordedAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("executionId","positionId","version"), UNIQUE ("accountId","actionId"),
 FOREIGN KEY ("accountId","executionId") REFERENCES "Trainer2Execution"("accountId","id"),
 FOREIGN KEY ("accountId","actionId") REFERENCES "Trainer2DurableAction"("accountId","actionId"),
 CHECK ("content"="canonicalContent"::jsonb), CHECK ("contentHash"=encode(sha256(convert_to("canonicalContent",'UTF8')),'hex'))
);
ALTER TABLE "Trainer2SetResultRevision" ADD COLUMN "assignment" jsonb;
CREATE TRIGGER trainer2_swap_immutable BEFORE UPDATE OR DELETE ON "Trainer2ExerciseSwap" FOR EACH ROW EXECUTE FUNCTION trainer2_immutable();
CREATE FUNCTION trainer2_assignment(execution_id uuid, position_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('positionId',position_id::text,'version',coalesce(s."version",0),'actionId',s."actionId"::text,'contentHash',coalesce(s."contentHash",x."contentHash"))
 FROM "Trainer2Execution" x LEFT JOIN LATERAL (SELECT * FROM "Trainer2ExerciseSwap" WHERE "executionId"=execution_id AND "positionId"=position_id ORDER BY "version" DESC LIMIT 1) s ON true
 WHERE x."id"=execution_id
$$;
CREATE FUNCTION trainer2_assignments(execution_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN EXISTS (SELECT 1 FROM "Trainer2ExerciseSwap" WHERE "executionId"=execution_id)
 THEN jsonb_build_object('assignments',(SELECT jsonb_agg(trainer2_assignment(execution_id,(p->>'id')::uuid) ORDER BY p->>'id') FROM "Trainer2Execution" x,
 jsonb_array_elements(x."initialPrescription"->'positions') p WHERE x."id"=execution_id)) ELSE '{}'::jsonb END
$$;
CREATE FUNCTION trainer2_swap_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x "Trainer2Execution"; previous "Trainer2ExerciseSwap"; e jsonb; owned jsonb; original jsonb; binding jsonb;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO x FROM "Trainer2Execution" WHERE "accountId"=NEW."accountId" AND "id"=NEW."executionId";
 SELECT * INTO previous FROM "Trainer2ExerciseSwap" WHERE "executionId"=NEW."executionId" AND "positionId"=NEW."positionId" ORDER BY "version" DESC LIMIT 1;
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 SELECT p INTO owned FROM jsonb_array_elements(x."initialPrescription"->'positions') p WHERE p->>'id'=NEW."positionId"::text;
 SELECT p INTO original FROM jsonb_array_elements(x."initialPrescription"->'occurrence'->'positions') p WHERE p->>'id'=owned->>'sourcePositionId';
 binding := trainer2_assignment(NEW."executionId",NEW."positionId");
 IF x."lifecycle" IS DISTINCT FROM 'Open' OR owned IS NULL OR original IS NULL
 OR EXISTS (SELECT 1 FROM "Trainer2ExecutionFinish" WHERE "executionId"=x."id")
 OR EXISTS (SELECT 1 FROM "Trainer2ExecutionDiscard" WHERE "executionId"=x."id")
 OR EXISTS (SELECT 1 FROM jsonb_array_elements(owned->'targets') t WHERE
   EXISTS (SELECT 1 FROM "Trainer2SetResultRevision" r WHERE r."executionId"=x."id" AND r."targetId"::text=t->>'id')
   OR EXISTS (SELECT 1 FROM "Trainer2SetSkip" s WHERE s."executionId"=x."id" AND s."targetId"::text=t->>'id'))
 OR NEW."version"<>coalesce(previous."version",0)+1 OR NEW."previousActionId" IS DISTINCT FROM previous."actionId"
 OR NEW."instructionEpoch" IS DISTINCT FROM (SELECT "instructionEpoch" FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId")
 OR e->>'commandType' IS DISTINCT FROM 'SwapExercise'
 OR e->'target' IS DISTINCT FROM jsonb_build_object('executionId',x."id"::text,'positionId',NEW."positionId"::text)
 OR e->'expected' IS DISTINCT FROM jsonb_build_object('contentHash',x."contentHash",'assignment',binding,'instructionEpoch',NEW."instructionEpoch",'effectiveHash',NEW."contentHash")
 OR NEW."content"->>'policyVersion' IS DISTINCT FROM 'trainer2-exercise-swap-v1'
 OR NEW."content"->>'positionId' IS DISTINCT FROM NEW."positionId"::text
 OR (NEW."content"->'restoreOriginal' IS DISTINCT FROM e->'intent'->'restoreOriginal')
 OR (e->'intent'->'restoreOriginal'='false'::jsonb AND NEW."content"->'exercise'->>'catalogId' IS DISTINCT FROM e->'intent'->>'catalogId')
 OR (e->'intent'->'restoreOriginal'='true'::jsonb AND NEW."content"->'exercise' IS DISTINCT FROM original->'exercise')
 OR jsonb_array_length(NEW."content"->'targets') IS DISTINCT FROM jsonb_array_length(owned->'targets')
 OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW."content"->'targets') WITH ORDINALITY a(t,n) WHERE
   t->>'id' IS DISTINCT FROM owned->'targets'->(n::int-1)->>'id'
   OR (t - 'id' - 'reps' - 'measurement') IS DISTINCT FROM ((original->'targets'->(n::int-1)) - 'id' - 'reps' - 'measurement')
   OR (e->'intent'->'restoreOriginal'='true'::jsonb AND (t-'id') IS DISTINCT FROM ((original->'targets'->(n::int-1))-'id'))
   OR (e->'intent'->'restoreOriginal'='false'::jsonb AND t->'measurement' NOT IN ('null'::jsonb,'{"kind":"bodyweight","convention":"bodyweightOnly"}'::jsonb)))
 OR EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId")
 THEN RAISE EXCEPTION 'TRAINER2_SWAP_SOURCE'; END IF;
 NEW."recordedAt" := clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER trainer2_swap_guard BEFORE INSERT ON "Trainer2ExerciseSwap" FOR EACH ROW EXECUTE FUNCTION trainer2_swap_guard();
CREATE FUNCTION trainer2_swap_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" o WHERE o."accountId"=NEW."accountId" AND o."actionId"=NEW."actionId" AND o."status"='Accepted'
 AND o."outcome"->>'commandType'='SwapExercise' AND o."outcome"->'result'=jsonb_build_object('executionId',NEW."executionId"::text,'positionId',NEW."positionId"::text,'version',NEW."version",'contentHash',NEW."contentHash"))
 THEN RAISE EXCEPTION 'TRAINER2_SWAP_OUTCOME'; END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trainer2_swap_seal AFTER INSERT ON "Trainer2ExerciseSwap" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_swap_seal();
ALTER TABLE "Trainer2ExerciseSwap" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "Trainer2ExerciseSwap" FROM PUBLIC;
REVOKE ALL ON FUNCTION trainer2_assignment(uuid,uuid),trainer2_assignments(uuid),trainer2_swap_guard(),trainer2_swap_seal() FROM PUBLIC;

CREATE OR REPLACE FUNCTION trainer2_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x "Trainer2Execution"; previous "Trainer2SetResultRevision"; e jsonb;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO x FROM "Trainer2Execution" WHERE "accountId"=NEW."accountId" AND "id"=NEW."executionId";
 IF EXISTS (SELECT 1 FROM "Trainer2ExecutionDiscard" WHERE "executionId"=NEW."executionId") THEN RAISE EXCEPTION 'TRAINER2_RESULT_DISCARDED'; END IF;
 SELECT * INTO previous FROM "Trainer2SetResultRevision" WHERE "executionId"=NEW."executionId" AND "targetId"=NEW."targetId" ORDER BY "version" DESC LIMIT 1;
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 IF (e->>'commandType' IN ('RecordSetResult','SkipSet')) AND (e->'expected'->'assignment' IS DISTINCT FROM (
 SELECT trainer2_assignment(x."id",(p->>'id')::uuid) FROM jsonb_array_elements(x."initialPrescription"->'positions') p,
 jsonb_array_elements(p->'targets') t WHERE t->>'id'=NEW."targetId"::text)) THEN
 -- Old clients are safe only for version zero; a remote swap makes their command stale.
 IF e->'expected' ? 'assignment' OR EXISTS (SELECT 1 FROM "Trainer2ExerciseSwap" s,
 jsonb_array_elements(x."initialPrescription"->'positions') p,jsonb_array_elements(p->'targets') t
 WHERE p->>'id'=s."positionId"::text AND s."executionId"=x."id" AND t->>'id'=NEW."targetId"::text)
 THEN RAISE EXCEPTION 'TRAINER2_STALE_EXERCISE'; END IF; END IF;
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
   IF e->>'commandType' IS DISTINCT FROM 'RecordSetResult' OR ((e->'expected')-'assignment') IS DISTINCT FROM ('{"resultVersion":0}'::jsonb || coalesce((SELECT jsonb_build_object('skipActionId',s."actionId"::text) FROM "Trainer2SetSkip" s WHERE s."executionId"=NEW."executionId" AND s."targetId"=NEW."targetId"),'{}'::jsonb))
     OR NEW."result"='null'::jsonb OR NEW."reason" IS NOT NULL
   THEN RAISE EXCEPTION 'TRAINER2_RESULT_INITIAL'; END IF;
 ELSE
   IF (e->>'commandType' IN ('CorrectSetResult','CorrectHistoricalSetResult')) IS NOT TRUE OR NEW."performedSetId" IS DISTINCT FROM previous."performedSetId"
     OR ((e->'expected')-'assignment') IS DISTINCT FROM jsonb_build_object('resultVersion',previous."version",'performedSetId',previous."performedSetId"::text)
     OR e->'intent'->>'reason' IS DISTINCT FROM NEW."reason"
     OR (NEW."reason" IS NOT NULL AND length(trim(NEW."reason")) NOT BETWEEN 1 AND 200)
     OR (NEW."result"='null'::jsonb AND NEW."reason" IS NULL)
   THEN RAISE EXCEPTION 'TRAINER2_RESULT_VERSION'; END IF;
 END IF;
 IF previous."version" IS NULL THEN
 IF NEW."assignment" IS DISTINCT FROM (SELECT trainer2_assignment(x."id",(p->>'id')::uuid) FROM jsonb_array_elements(x."initialPrescription"->'positions') p,
 jsonb_array_elements(p->'targets') t WHERE t->>'id'=NEW."targetId"::text)
 THEN RAISE EXCEPTION 'TRAINER2_RESULT_ASSIGNMENT'; END IF;
 ELSIF NEW."assignment" IS DISTINCT FROM previous."assignment" THEN RAISE EXCEPTION 'TRAINER2_RESULT_ASSIGNMENT'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION trainer2_set_skip_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x "Trainer2Execution"; e jsonb;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO x FROM "Trainer2Execution" WHERE "accountId"=NEW."accountId" AND "id"=NEW."executionId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 IF (e->>'commandType' IN ('RecordSetResult','SkipSet')) AND (e->'expected'->'assignment' IS DISTINCT FROM (
 SELECT trainer2_assignment(x."id",(p->>'id')::uuid) FROM jsonb_array_elements(x."initialPrescription"->'positions') p,
 jsonb_array_elements(p->'targets') t WHERE t->>'id'=NEW."targetId"::text)) THEN
 -- Old clients are safe only for version zero; a remote swap makes their command stale.
 IF e->'expected' ? 'assignment' OR EXISTS (SELECT 1 FROM "Trainer2ExerciseSwap" s,
 jsonb_array_elements(x."initialPrescription"->'positions') p,jsonb_array_elements(p->'targets') t
 WHERE p->>'id'=s."positionId"::text AND s."executionId"=x."id" AND t->>'id'=NEW."targetId"::text)
 THEN RAISE EXCEPTION 'TRAINER2_STALE_EXERCISE'; END IF; END IF;
 IF x."lifecycle" IS DISTINCT FROM 'Open'
 OR EXISTS (SELECT 1 FROM "Trainer2ExecutionFinish" WHERE "executionId"=NEW."executionId")
 OR EXISTS (SELECT 1 FROM "Trainer2ExecutionDiscard" WHERE "executionId"=NEW."executionId")
 OR EXISTS (SELECT 1 FROM "Trainer2SetResultRevision" WHERE "executionId"=NEW."executionId" AND "targetId"=NEW."targetId")
 OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(x."initialPrescription"->'positions') p,
   jsonb_array_elements(p->'targets') t WHERE t->>'id'=NEW."targetId"::text)
 OR e->>'commandType' IS DISTINCT FROM 'SkipSet'
 OR e->'target' IS DISTINCT FROM jsonb_build_object('executionId',NEW."executionId"::text,'targetId',NEW."targetId"::text)
 OR ((e->'expected')-'assignment') IS DISTINCT FROM '{"resultVersion":0,"skipActionId":null}'::jsonb
 OR e->'intent' IS DISTINCT FROM '{}'::jsonb
 OR EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId")
 THEN RAISE EXCEPTION 'TRAINER2_SET_SKIP_SOURCE'; END IF;
 NEW."skippedAt" := clock_timestamp();
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
 binding := binding || trainer2_assignments(x."id");
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
 binding := binding || trainer2_assignments(x."id");
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
       WHEN 'SwapExercise' THEN NOT EXISTS (SELECT 1 FROM "Trainer2ExerciseSwap" s WHERE s."accountId"=o."accountId" AND s."actionId"=o."actionId"
 AND o."outcome"->'result'=jsonb_build_object('executionId',s."executionId"::text,'positionId',s."positionId"::text,'version',s."version",'contentHash',s."contentHash"))
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
