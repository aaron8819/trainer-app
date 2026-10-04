BEGIN;
ALTER TABLE "Trainer2Plan" ADD COLUMN "currentWeekIndex" integer NOT NULL DEFAULT 0 CHECK ("currentWeekIndex">=0);
-- Initialize already-progressed plans once using the released derivation.
-- All historical business facts and lifecycle values remain untouched.
ALTER TABLE "Trainer2Plan" DISABLE TRIGGER trainer2_activation_guard;
WITH ordered AS (
 SELECT p."id",o,n,CASE WHEN lag(o->>'stageId') OVER (PARTITION BY p."id" ORDER BY n) IS DISTINCT FROM o->>'stageId' THEN 1 ELSE 0 END boundary
 FROM "Trainer2Plan" p JOIN "Trainer2PlanRevision" r ON r."id"=p."currentRevisionId",
 jsonb_array_elements(r."document"->'occurrences') WITH ORDINALITY a(o,n)
 WHERE p."lifecycle" IN ('Active','Completed','Paused')
), grouped AS (
 SELECT *,sum(boundary) OVER (PARTITION BY "id" ORDER BY n)-1 week FROM ordered
), baseline AS (
 SELECT g."id",coalesce(min(week) FILTER (WHERE NOT trainer2_occurrence_resolved(p."accountId",p."id",o->>'id')),max(week)) week
 FROM grouped g JOIN "Trainer2Plan" p ON p."id"=g."id" GROUP BY g."id"
)
UPDATE "Trainer2Plan" p SET "currentWeekIndex"=b.week FROM baseline b WHERE p."id"=b."id";
SET CONSTRAINTS trainer2_activation_seal IMMEDIATE;
ALTER TABLE "Trainer2Plan" ENABLE TRIGGER trainer2_activation_guard;
SET CONSTRAINTS trainer2_activation_seal DEFERRED;
CREATE TABLE "Trainer2WeekAdvance" (
 "accountId" text NOT NULL,"planId" uuid NOT NULL,"revisionId" uuid NOT NULL,"actionId" uuid NOT NULL,
 "fromWeek" integer NOT NULL CHECK ("fromWeek">=0),"toWeek" integer NOT NULL,"planCompleted" boolean NOT NULL,
 "expected" jsonb NOT NULL,"createdTx" bigint NOT NULL DEFAULT txid_current(),
 PRIMARY KEY ("accountId","actionId"),UNIQUE ("planId","fromWeek"),
 FOREIGN KEY ("accountId","planId","revisionId") REFERENCES "Trainer2PlanRevision"("accountId","planId","id"),
 FOREIGN KEY ("accountId","actionId") REFERENCES "Trainer2DurableAction"("accountId","actionId")
);
CREATE TRIGGER trainer2_week_immutable BEFORE UPDATE OR DELETE ON "Trainer2WeekAdvance" FOR EACH ROW EXECUTE FUNCTION trainer2_immutable();
CREATE FUNCTION trainer2_authored_weeks(document jsonb) RETURNS TABLE(o jsonb,n bigint,week bigint) LANGUAGE sql AS $$
 WITH ordered AS (
 SELECT o,n,CASE WHEN lag(o->>'stageId') OVER (ORDER BY n) IS DISTINCT FROM o->>'stageId' THEN 1 ELSE 0 END boundary
 FROM jsonb_array_elements(document->'occurrences') WITH ORDINALITY a(o,n)
 ) SELECT o,n,sum(boundary) OVER (ORDER BY n)-1 FROM ordered
$$;
CREATE OR REPLACE FUNCTION trainer2_current_week_eligible(account_id text,plan_id uuid,document jsonb,occurrence_id text)
RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS (SELECT 1 FROM trainer2_authored_weeks(document) w JOIN "Trainer2Plan" p ON p."id"=plan_id AND p."accountId"=account_id
 WHERE w.week=p."currentWeekIndex" AND w.o->>'id'=occurrence_id AND NOT trainer2_occurrence_resolved(account_id,plan_id,occurrence_id))
$$;
CREATE FUNCTION trainer2_week_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Trainer2Plan"; r "Trainer2PlanRevision"; e jsonb; binding jsonb; final boolean;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO p FROM "Trainer2Plan" WHERE "id"=NEW."planId" AND "accountId"=NEW."accountId";
 SELECT * INTO r FROM "Trainer2PlanRevision" WHERE "id"=NEW."revisionId" AND "accountId"=NEW."accountId" AND "planId"=NEW."planId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 SELECT jsonb_build_object('planRevisionId',r."id"::text,'acceptedSequence',"acceptedSequence"::text,'weekIndex',p."currentWeekIndex",
 'firstOccurrenceId',(SELECT o->>'id' FROM trainer2_authored_weeks(r."document") WHERE week=p."currentWeekIndex" ORDER BY n LIMIT 1)) INTO binding
 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId";
 SELECT p."currentWeekIndex"=max(week) INTO final FROM trainer2_authored_weeks(r."document");
 IF p."lifecycle" IS DISTINCT FROM 'Active' OR p."tombstonedAt" IS NOT NULL
 OR p."currentRevisionId" IS DISTINCT FROM NEW."revisionId" OR p."initialApprovedRevisionId" IS DISTINCT FROM NEW."revisionId"
 OR NEW."fromWeek" IS DISTINCT FROM p."currentWeekIndex" OR NEW."planCompleted" IS DISTINCT FROM final OR final IS NULL
 OR NEW."toWeek" IS DISTINCT FROM (CASE WHEN final THEN p."currentWeekIndex" ELSE p."currentWeekIndex"+1 END)
 OR NOT EXISTS (SELECT 1 FROM trainer2_authored_weeks(r."document") WHERE week=p."currentWeekIndex")
 OR EXISTS (SELECT 1 FROM trainer2_authored_weeks(r."document") WHERE week=p."currentWeekIndex" AND NOT trainer2_occurrence_resolved(NEW."accountId",NEW."planId",o->>'id'))
 OR EXISTS (SELECT 1 FROM "Trainer2Execution" WHERE "accountId"=NEW."accountId" AND "lifecycle"='Open')
 OR e->>'commandType' IS DISTINCT FROM 'AdvanceWeek' OR e->'target' IS DISTINCT FROM jsonb_build_object('planId',NEW."planId"::text)
 OR e->'expected' IS DISTINCT FROM binding OR NEW."expected" IS DISTINCT FROM binding OR e->'intent' IS DISTINCT FROM '{}'::jsonb
 OR NEW."createdTx"<>txid_current() OR EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId")
 THEN RAISE EXCEPTION 'TRAINER2_WEEK_SOURCE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trainer2_week_guard BEFORE INSERT ON "Trainer2WeekAdvance" FOR EACH ROW EXECUTE FUNCTION trainer2_week_guard();
CREATE FUNCTION trainer2_week_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId" AND "status"='Accepted'
 AND "outcome"->>'commandType'='AdvanceWeek' AND "outcome"->'result'=jsonb_build_object('planId',NEW."planId"::text,'revisionId',NEW."revisionId"::text,
 'fromWeek',NEW."fromWeek",'toWeek',NEW."toWeek",'planCompleted',NEW."planCompleted"))
 OR NOT EXISTS (SELECT 1 FROM "Trainer2Plan" WHERE "id"=NEW."planId" AND "accountId"=NEW."accountId" AND "currentWeekIndex">=NEW."toWeek"
 AND (NOT NEW."planCompleted" OR "lifecycle"='Completed'))
 THEN RAISE EXCEPTION 'TRAINER2_WEEK_OUTCOME'; END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trainer2_week_seal AFTER INSERT ON "Trainer2WeekAdvance" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_week_seal();

CREATE OR REPLACE FUNCTION trainer2_skip_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Trainer2Plan"; r "Trainer2PlanRevision"; e jsonb; binding jsonb; pending jsonb;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO p FROM "Trainer2Plan" WHERE "id"=NEW."planId" AND "accountId"=NEW."accountId";
 SELECT * INTO r FROM "Trainer2PlanRevision" WHERE "id"=NEW."revisionId" AND "accountId"=NEW."accountId" AND "planId"=NEW."planId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 SELECT jsonb_build_object('planRevisionId',r."id"::text,'acceptedSequence',"acceptedSequence"::text) INTO binding
   FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId";
 SELECT coalesce(jsonb_agg(o->>'id' ORDER BY n),'[]'::jsonb) INTO pending
   FROM jsonb_array_elements(r."document"->'occurrences') WITH ORDINALITY a(o,n)
   WHERE NOT trainer2_occurrence_resolved(NEW."accountId",NEW."planId",o->>'id');
 IF p."lifecycle" IS DISTINCT FROM 'Active' OR p."tombstonedAt" IS NOT NULL
   OR p."currentRevisionId" IS DISTINCT FROM NEW."revisionId" OR p."initialApprovedRevisionId" IS DISTINCT FROM NEW."revisionId"
   OR NOT trainer2_current_week_eligible(NEW."accountId",NEW."planId",r."document",NEW."occurrenceId"::text)
   OR EXISTS (SELECT 1 FROM "Trainer2Execution" x WHERE x."accountId"=NEW."accountId" AND x."lifecycle"='Open')
   OR EXISTS (SELECT 1 FROM "Trainer2Execution" x WHERE x."accountId"=NEW."accountId" AND x."occurrenceId"=NEW."occurrenceId" AND x."lifecycle"<>'Discarded')
   OR e->>'commandType' IS DISTINCT FROM 'SkipOccurrence'
   OR e->'target' IS DISTINCT FROM jsonb_build_object('planId',NEW."planId"::text,'occurrenceId',NEW."occurrenceId"::text)
   OR NEW."expected" IS DISTINCT FROM binding OR e->'expected' IS DISTINCT FROM binding OR e->'intent' IS DISTINCT FROM '{}'::jsonb
   OR NEW."planCompleted" IS DISTINCT FROM false OR NEW."priorPlanLifecycle" IS DISTINCT FROM p."lifecycle"
   OR NEW."endpoint" IS DISTINCT FROM jsonb_build_object('kind',r."document"->>'endpoint','occurrenceIds',
     (SELECT jsonb_agg(o->>'id' ORDER BY n) FROM jsonb_array_elements(r."document"->'occurrences') WITH ORDINALITY a(o,n)))
   OR NEW."createdTx"<>txid_current()
   OR EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId")
 THEN RAISE EXCEPTION 'TRAINER2_SKIP_SOURCE'; END IF;
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
 INTO binding,unknowns FROM jsonb_array_elements(trainer2_execution_positions(x."id")) pos,
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
   OR NEW."planCompleted" IS DISTINCT FROM false OR NEW."priorPlanLifecycle" IS DISTINCT FROM p."lifecycle"
   OR NEW."endpoint" IS DISTINCT FROM jsonb_build_object('kind',d->>'endpoint','occurrenceIds',(SELECT jsonb_agg(o->>'id' ORDER BY n) FROM jsonb_array_elements(d->'occurrences') WITH ORDINALITY a(o,n)))
   OR NEW."createdTx"<>txid_current() OR NEW."finishedAt"<x."startedAt"
   OR EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId")
 THEN RAISE EXCEPTION 'TRAINER2_FINISH_SOURCE'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION trainer2_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 IF TG_OP='INSERT' THEN
   IF NEW."lifecycle"<>'Draft' OR NEW."currentWeekIndex"<>0 THEN RAISE EXCEPTION 'TRAINER2_CREATE_DRAFT_REQUIRED'; END IF;
 ELSE
   IF OLD."lifecycle"='Active' AND (to_jsonb(NEW)-'lifecycle'-'currentWeekIndex')=(to_jsonb(OLD)-'lifecycle'-'currentWeekIndex') AND EXISTS (
     SELECT 1 FROM "Trainer2WeekAdvance" w WHERE w."accountId"=OLD."accountId" AND w."planId"=OLD."id" AND w."fromWeek"=OLD."currentWeekIndex"
     AND w."toWeek"=NEW."currentWeekIndex" AND w."createdTx"=txid_current()
     AND NEW."lifecycle"=CASE WHEN w."planCompleted" THEN 'Completed' ELSE 'Active' END
   ) THEN RETURN NEW; END IF;
   IF NEW."currentWeekIndex" IS DISTINCT FROM OLD."currentWeekIndex" THEN RAISE EXCEPTION 'TRAINER2_WEEK_CURSOR'; END IF;
   IF OLD."lifecycle"<>'Draft' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'TRAINER2_ACTIVE_IMMUTABLE'; END IF;
   IF NEW."lifecycle"<>OLD."lifecycle" AND (OLD."lifecycle"<>'Draft' OR NEW."lifecycle"<>'Active' OR
     NEW."currentRevisionId"<>OLD."currentRevisionId" OR NEW."initialApprovedRevisionId" IS DISTINCT FROM OLD."currentRevisionId" OR NEW."tombstonedAt" IS NOT NULL)
   THEN RAISE EXCEPTION 'TRAINER2_INVALID_ACTIVATION'; END IF;
 END IF;
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
       WHEN 'AdvanceWeek' THEN NOT EXISTS (SELECT 1 FROM "Trainer2WeekAdvance" w WHERE w."accountId"=o."accountId" AND w."actionId"=o."actionId"
         AND o."outcome"->'result'=jsonb_build_object('planId',w."planId"::text,'revisionId',w."revisionId"::text,'fromWeek',w."fromWeek",'toWeek',w."toWeek",'planCompleted',w."planCompleted"))
       WHEN 'AddExercise'  THEN NOT EXISTS (SELECT 1 FROM "Trainer2ExerciseAddition" a WHERE a."accountId"=o."accountId" AND a."actionId"=o."actionId"
 AND o."outcome"->'result'=jsonb_build_object('executionId',a."executionId"::text,'positionId',a."positionId"::text,'ordinal',a."ordinal",'contentHash',a."contentHash"))
       WHEN 'AddSet' THEN NOT EXISTS (SELECT 1 FROM "Trainer2SetAddition" a WHERE a."accountId"=o."accountId" AND a."actionId"=o."actionId"
 AND o."outcome"->'result'=jsonb_build_object('executionId',a."executionId"::text,'positionId',a."positionId"::text,'targetId',a."targetId"::text,'ordinal',a."ordinal",'contentHash',a."contentHash"))
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
ALTER TABLE "Trainer2WeekAdvance" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Trainer2WeekAdvance" FROM PUBLIC;
REVOKE ALL ON FUNCTION trainer2_authored_weeks(jsonb),trainer2_week_guard(),trainer2_week_seal() FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
 EXECUTE format('REVOKE ALL ON TABLE "Trainer2WeekAdvance" FROM %I',api_role);
 EXECUTE format('REVOKE ALL ON FUNCTION trainer2_authored_weeks(jsonb),trainer2_week_guard(),trainer2_week_seal() FROM %I',api_role);
 END IF; END LOOP;
END $$;
COMMIT;
