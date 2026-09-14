BEGIN;
ALTER TABLE "Trainer2Execution" DROP CONSTRAINT "Trainer2Execution_lifecycle_check";
ALTER TABLE "Trainer2Execution" ADD CONSTRAINT "Trainer2Execution_lifecycle_check" CHECK ("lifecycle" IN ('Open','Finished'));
CREATE TABLE "Trainer2ExecutionFinish" (
 "executionId" uuid PRIMARY KEY, "accountId" text NOT NULL, "planId" uuid NOT NULL,
 "revisionId" uuid NOT NULL, "occurrenceId" uuid NOT NULL, "actionId" uuid NOT NULL,
 "expected" jsonb NOT NULL, "unknownTargetIds" jsonb NOT NULL, "planCompleted" boolean NOT NULL,
 "priorPlanLifecycle" text NOT NULL CHECK ("priorPlanLifecycle"='Active'), "endpoint" jsonb NOT NULL,
 "finishedAt" timestamptz(3) NOT NULL, "createdTx" bigint NOT NULL DEFAULT txid_current(),
 UNIQUE("accountId","actionId"),
 FOREIGN KEY("accountId","executionId") REFERENCES "Trainer2Execution"("accountId","id"),
 FOREIGN KEY("accountId","planId","revisionId") REFERENCES "Trainer2PlanRevision"("accountId","planId","id"),
 FOREIGN KEY("accountId","actionId") REFERENCES "Trainer2DurableAction"("accountId","actionId")
);
CREATE TRIGGER trainer2_finish_immutable BEFORE UPDATE OR DELETE ON "Trainer2ExecutionFinish" FOR EACH ROW EXECUTE FUNCTION trainer2_immutable();
CREATE FUNCTION trainer2_finish_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x "Trainer2Execution"; p "Trainer2Plan"; e jsonb; d jsonb; binding jsonb; unknowns jsonb; complete boolean;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO x FROM "Trainer2Execution" WHERE "id"=NEW."executionId" AND "accountId"=NEW."accountId";
 SELECT * INTO p FROM "Trainer2Plan" WHERE "id"=x."planId" AND "accountId"=NEW."accountId";
 SELECT "document" INTO d FROM "Trainer2PlanRevision" WHERE "id"=x."revisionId" AND "accountId"=NEW."accountId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 SELECT jsonb_build_object('contentHash',x."contentHash",'results',coalesce(jsonb_agg(jsonb_build_object(
   'targetId',t->>'id','resultVersion',coalesce(r."version",0),'performedSetId',r."performedSetId"::text) ORDER BY t->>'id'),'[]'::jsonb)),
   coalesce(jsonb_agg(t->>'id' ORDER BY t->>'id') FILTER (WHERE r."result" IS NULL OR r."result"='null'::jsonb),'[]'::jsonb)
 INTO binding,unknowns FROM jsonb_array_elements(x."initialPrescription"->'positions') pos,
   jsonb_array_elements(pos->'targets') t LEFT JOIN LATERAL (
    SELECT * FROM "Trainer2SetResultRevision" r WHERE r."executionId"=x."id" AND r."targetId"::text=t->>'id' ORDER BY "version" DESC LIMIT 1
   ) r ON true;
 SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'occurrences') o WHERE o->>'id'<>x."occurrenceId"::text
   AND NOT EXISTS (SELECT 1 FROM "Trainer2Execution" other WHERE other."accountId"=NEW."accountId" AND other."planId"=x."planId"
     AND other."occurrenceId"::text=o->>'id' AND other."lifecycle"='Finished')) INTO complete;
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
CREATE TRIGGER trainer2_finish_guard BEFORE INSERT ON "Trainer2ExecutionFinish" FOR EACH ROW EXECUTE FUNCTION trainer2_finish_guard();
CREATE FUNCTION trainer2_execution_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'TRAINER2_EXECUTION_IMMUTABLE'; END IF;
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=OLD."accountId" FOR UPDATE;
 IF OLD."lifecycle"<>'Open' OR NEW."lifecycle"<>'Finished' OR
    (to_jsonb(NEW)-'lifecycle') IS DISTINCT FROM (to_jsonb(OLD)-'lifecycle') OR NOT EXISTS (
    SELECT 1 FROM "Trainer2ExecutionFinish" f WHERE f."executionId"=OLD."id" AND f."accountId"=OLD."accountId" AND f."createdTx"=txid_current())
 THEN RAISE EXCEPTION 'TRAINER2_EXECUTION_TRANSITION'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER trainer2_execution_immutable ON "Trainer2Execution";
CREATE TRIGGER trainer2_execution_immutable BEFORE UPDATE OR DELETE ON "Trainer2Execution" FOR EACH ROW EXECUTE FUNCTION trainer2_execution_transition();
CREATE FUNCTION trainer2_finish_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Trainer2Execution" WHERE "id"=NEW."executionId" AND "lifecycle"='Finished')
   OR NOT EXISTS (SELECT 1 FROM "Trainer2Plan" WHERE "id"=NEW."planId" AND "lifecycle"=CASE WHEN NEW."planCompleted" THEN 'Completed' ELSE 'Active' END)
   OR NOT EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" o WHERE o."accountId"=NEW."accountId" AND o."actionId"=NEW."actionId" AND o."status"='Accepted'
    AND o."outcome"->'result'=jsonb_build_object('executionId',NEW."executionId"::text,'planId',NEW."planId"::text,'occurrenceId',NEW."occurrenceId"::text,'planCompleted',NEW."planCompleted"))
 THEN RAISE EXCEPTION 'TRAINER2_FINISH_OUTCOME'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trainer2_finish_seal AFTER INSERT ON "Trainer2ExecutionFinish" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_finish_seal();
REVOKE ALL ON "Trainer2ExecutionFinish" FROM PUBLIC;
ALTER TABLE "Trainer2ExecutionFinish" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON FUNCTION trainer2_finish_guard(),trainer2_execution_transition(),trainer2_finish_seal() FROM PUBLIC;
CREATE OR REPLACE FUNCTION trainer2_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 IF TG_OP='INSERT' THEN
   IF NEW."lifecycle"<>'Draft' THEN RAISE EXCEPTION 'TRAINER2_CREATE_DRAFT_REQUIRED'; END IF;
 ELSE
   IF OLD."lifecycle"='Active' AND NEW."lifecycle"='Completed' AND
     (to_jsonb(NEW)-'lifecycle')=(to_jsonb(OLD)-'lifecycle') AND EXISTS (
       SELECT 1 FROM "Trainer2ExecutionFinish" f WHERE f."accountId"=OLD."accountId" AND f."planId"=OLD."id"
         AND f."planCompleted" AND f."createdTx"=txid_current()) THEN RETURN NEW; END IF;
   IF OLD."lifecycle"<>'Draft' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'TRAINER2_ACTIVE_IMMUTABLE'; END IF;
   IF NEW."lifecycle"<>OLD."lifecycle" AND (OLD."lifecycle"<>'Draft' OR NEW."lifecycle"<>'Active' OR
     NEW."currentRevisionId"<>OLD."currentRevisionId" OR NEW."initialApprovedRevisionId" IS DISTINCT FROM OLD."currentRevisionId" OR NEW."tombstonedAt" IS NOT NULL)
   THEN RAISE EXCEPTION 'TRAINER2_INVALID_ACTIVATION'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION trainer2_start_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Trainer2Plan"; r "Trainer2PlanRevision"; s jsonb; e jsonb; o jsonb; ip jsonb; it jsonb; pos integer; target integer;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO p FROM "Trainer2Plan" WHERE "id"=NEW."planId" AND "accountId"=NEW."accountId";
 SELECT * INTO r FROM "Trainer2PlanRevision" WHERE "id"=NEW."revisionId" AND "accountId"=NEW."accountId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 s := NEW."initialPrescription";
 SELECT v INTO o FROM jsonb_array_elements(r."document"->'occurrences') WITH ORDINALITY a(v,n)
 WHERE NOT EXISTS (SELECT 1 FROM "Trainer2Execution" prior WHERE prior."accountId"=NEW."accountId" AND prior."planId"=NEW."planId"
   AND prior."occurrenceId"::text=v->>'id' AND prior."lifecycle"='Finished') ORDER BY n LIMIT 1;
 IF NEW."lifecycle" IS DISTINCT FROM 'Open' OR p."lifecycle" IS DISTINCT FROM 'Active' OR p."tombstonedAt" IS NOT NULL
   OR p."currentRevisionId" IS DISTINCT FROM NEW."revisionId" OR p."initialApprovedRevisionId" IS DISTINCT FROM NEW."revisionId"
   OR o->>'id' IS DISTINCT FROM NEW."occurrenceId"::text
   OR e->>'commandType' IS DISTINCT FROM 'StartOccurrence'
   OR e->'target' IS DISTINCT FROM jsonb_build_object('planId',NEW."planId"::text,'occurrenceId',NEW."occurrenceId"::text)
   OR e->'expected'->>'planRevisionId' IS DISTINCT FROM NEW."revisionId"::text
   OR s->>'executionId' IS DISTINCT FROM NEW."id"::text OR s->>'accountId' IS DISTINCT FROM NEW."accountId"
   OR s->>'planId' IS DISTINCT FROM NEW."planId"::text OR s->>'revisionId' IS DISTINCT FROM NEW."revisionId"::text
   OR (s->>'startedAt')::timestamptz IS DISTINCT FROM NEW."startedAt"
   OR s->>'sourceContentHash' IS DISTINCT FROM r."contentHash" OR s->'occurrence' IS DISTINCT FROM o
   OR s->'progression' IS DISTINCT FROM r."document"->'progression'
   OR s->'stage' IS DISTINCT FROM (SELECT v FROM jsonb_array_elements(r."document"->'stages') v WHERE v->>'id'=o->>'stageId')
   OR s->'instructions'->'epoch' IS DISTINCT FROM e->'expected'->'instructionEpoch'
   OR s->'instructions'->'epoch' IS DISTINCT FROM (SELECT to_jsonb("instructionEpoch") FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId")
   OR jsonb_array_length(s->'positions') IS DISTINCT FROM jsonb_array_length(o->'positions')
 THEN RAISE EXCEPTION 'TRAINER2_START_SOURCE'; END IF;
 IF (s->'instructions'->>'epoch')::integer > 0 AND NOT EXISTS (
   SELECT 1 FROM "Trainer2InstructionRevision" i WHERE i."accountId"=NEW."accountId"
   AND i."id"::text=s->'instructions'->>'revisionId' AND i."document"=s->'instructions'->'document'
   AND i."contentHash"=s->'instructions'->>'contentHash' AND i."epoch"=(s->'instructions'->>'epoch')::integer
 ) THEN RAISE EXCEPTION 'TRAINER2_START_INSTRUCTIONS'; END IF;
 FOR ip,pos IN SELECT value, ordinality::integer-1 FROM jsonb_array_elements(s->'positions') WITH ORDINALITY LOOP
   IF ip->>'sourcePositionId' IS DISTINCT FROM o->'positions'->pos->>'id'
     OR jsonb_array_length(ip->'targets') IS DISTINCT FROM jsonb_array_length(o->'positions'->pos->'targets')
   THEN RAISE EXCEPTION 'TRAINER2_START_IDENTITIES'; END IF;
   FOR it,target IN SELECT value, ordinality::integer-1 FROM jsonb_array_elements(ip->'targets') WITH ORDINALITY LOOP
     IF it->>'sourceTargetId' IS DISTINCT FROM o->'positions'->pos->'targets'->target->>'id'
     THEN RAISE EXCEPTION 'TRAINER2_START_IDENTITIES'; END IF;
   END LOOP;
 END LOOP;
 IF EXISTS (SELECT value FROM (
   SELECT NEW."id"::text value UNION ALL SELECT v->>'id' FROM jsonb_array_elements(s->'positions') v
   UNION ALL SELECT t->>'id' FROM jsonb_array_elements(s->'positions') jp, jsonb_array_elements(jp->'targets') t
 ) ids GROUP BY value HAVING count(*)>1 OR value IS NULL OR value !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
 THEN RAISE EXCEPTION 'TRAINER2_START_IDENTITIES'; END IF;
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
       WHEN 'FinishExecution' THEN NOT EXISTS (SELECT 1 FROM "Trainer2ExecutionFinish" f WHERE f."accountId"=o."accountId" AND f."actionId"=o."actionId"
         AND o."outcome"->'result'=jsonb_build_object('executionId',f."executionId"::text,'planId',f."planId"::text,'occurrenceId',f."occurrenceId"::text,'planCompleted',f."planCompleted"))
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


CREATE OR REPLACE FUNCTION trainer2_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x "Trainer2Execution"; previous "Trainer2SetResultRevision"; e jsonb;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO x FROM "Trainer2Execution" WHERE "accountId"=NEW."accountId" AND "id"=NEW."executionId";
 SELECT * INTO previous FROM "Trainer2SetResultRevision" WHERE "executionId"=NEW."executionId" AND "targetId"=NEW."targetId" ORDER BY "version" DESC LIMIT 1;
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 IF EXISTS (SELECT 1 FROM "Trainer2ExecutionFinish" WHERE "executionId"=NEW."executionId") OR x."lifecycle" IS DISTINCT FROM 'Open' OR NOT EXISTS (
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
   IF e->>'commandType' IS DISTINCT FROM 'CorrectSetResult' OR NEW."performedSetId" IS DISTINCT FROM previous."performedSetId"
     OR e->'expected' IS DISTINCT FROM jsonb_build_object('resultVersion',previous."version",'performedSetId',previous."performedSetId"::text)
     OR NEW."reason" IS NULL OR e->'intent'->>'reason' IS DISTINCT FROM NEW."reason" OR length(trim(NEW."reason")) NOT BETWEEN 1 AND 200
   THEN RAISE EXCEPTION 'TRAINER2_RESULT_VERSION'; END IF;
 END IF;
 RETURN NEW;
END $$;

DO $$ DECLARE a text; BEGIN FOR a IN SELECT "accountId" FROM "Trainer2AccountTrainingState" LOOP PERFORM trainer2_check_acceptance(a); END LOOP; END $$;
COMMIT;
