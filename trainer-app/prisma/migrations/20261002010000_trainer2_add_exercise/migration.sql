BEGIN;
CREATE TABLE "Trainer2ExerciseAddition" (
 "accountId" text NOT NULL, "executionId" uuid NOT NULL, "positionId" uuid NOT NULL UNIQUE,
 "ordinal" integer NOT NULL CHECK ("ordinal" BETWEEN 1 AND 100), "actionId" uuid NOT NULL,
 "content" jsonb NOT NULL, "canonicalContent" text NOT NULL, "contentHash" text NOT NULL,
 "recordedAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("executionId","positionId"), UNIQUE ("executionId","ordinal"), UNIQUE ("accountId","actionId"),
 FOREIGN KEY ("accountId","executionId") REFERENCES "Trainer2Execution"("accountId","id"),
 FOREIGN KEY ("accountId","actionId") REFERENCES "Trainer2DurableAction"("accountId","actionId"),
 CHECK ("content"="canonicalContent"::jsonb), CHECK ("contentHash"=encode(sha256(convert_to("canonicalContent",'UTF8')),'hex'))
);
CREATE TRIGGER trainer2_exercise_addition_immutable BEFORE UPDATE OR DELETE ON "Trainer2ExerciseAddition" FOR EACH ROW EXECUTE FUNCTION trainer2_immutable();
CREATE FUNCTION trainer2_original_positions(execution_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT x."initialPrescription"->'occurrence'->'positions' || coalesce((SELECT jsonb_agg(a."content"->'position' ORDER BY a."ordinal") FROM "Trainer2ExerciseAddition" a WHERE a."executionId"=execution_id),'[]'::jsonb) FROM "Trainer2Execution" x WHERE x."id"=execution_id
$$;
CREATE FUNCTION trainer2_base_positions(execution_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT x."initialPrescription"->'positions' || coalesce((SELECT jsonb_agg(jsonb_build_object('id',a."positionId"::text,'targets',
 (SELECT jsonb_agg(jsonb_build_object('id',t->>'id') ORDER BY n) FROM jsonb_array_elements(a."content"->'position'->'targets') WITH ORDINALITY b(t,n))) ORDER BY a."ordinal") FROM "Trainer2ExerciseAddition" a WHERE a."executionId"=execution_id),'[]'::jsonb) FROM "Trainer2Execution" x WHERE x."id"=execution_id
$$;

CREATE OR REPLACE FUNCTION trainer2_execution_positions(execution_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_agg(p || jsonb_build_object('targets',(p->'targets') || coalesce((SELECT jsonb_agg(jsonb_build_object('id',a."targetId"::text) ORDER BY a."ordinal")
 FROM "Trainer2SetAddition" a WHERE a."executionId"=execution_id AND a."positionId"::text=p->>'id'),'[]'::jsonb)) ORDER BY n)
 FROM "Trainer2Execution" x,jsonb_array_elements(trainer2_base_positions(x."id")) WITH ORDINALITY a(p,n) WHERE x."id"=execution_id
$$;

CREATE OR REPLACE FUNCTION trainer2_effective_targets(execution_id uuid, position_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT jsonb_agg(coalesce(s.t,base.t) ORDER BY n) FROM (
 SELECT t,n FROM "Trainer2Execution" x,jsonb_array_elements(trainer2_base_positions(x."id")) p,
 jsonb_array_elements(trainer2_original_positions(x."id")) o,
 jsonb_array_elements(o->'targets') WITH ORDINALITY a(t,n)
 WHERE x."id"=execution_id AND p->>'id'=position_id::text AND o->>'id'=coalesce(p->>'sourcePositionId',p->>'id')
 ) base LEFT JOIN LATERAL (SELECT st AS t FROM "Trainer2ExerciseSwap" sw,jsonb_array_elements(sw."content"->'targets') st
 WHERE sw."executionId"=execution_id AND sw."positionId"=position_id AND st->>'id'=(SELECT p->'targets'->(n::int-1)->>'id' FROM "Trainer2Execution" x,jsonb_array_elements(trainer2_base_positions(x."id")) p WHERE x."id"=execution_id AND p->>'id'=position_id::text)
 ORDER BY sw."version" DESC LIMIT 1) s ON true),'[]'::jsonb) ||
 coalesce((SELECT jsonb_agg(coalesce((SELECT t FROM "Trainer2ExerciseSwap" s,jsonb_array_elements(s."content"->'targets') t WHERE s."executionId"=execution_id AND s."positionId"=position_id AND t->>'id'=a."targetId"::text ORDER BY s."version" DESC LIMIT 1),a."content"->'target') ORDER BY a."ordinal")
 FROM "Trainer2SetAddition" a WHERE a."executionId"=execution_id AND a."positionId"=position_id),'[]'::jsonb)
$$;

CREATE OR REPLACE FUNCTION trainer2_restored_addition_target(execution_id uuid, target_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT (a."content"->'target') || jsonb_build_object(
 'reps',CASE WHEN a."content"->'exercise'=o->'exercise' OR
 (a."content"->'exercise'->>'kind'='catalogSnapshot' AND o->'exercise'->>'kind'='catalogSnapshot' AND
 a."content"->'exercise'->>'purpose'=o->'exercise'->>'purpose' AND a."content"->'exercise'->>'repBasis'=o->'exercise'->>'repBasis')
 THEN a."content"->'target'->'reps' ELSE (SELECT t->'reps' FROM jsonb_array_elements(o->'targets') WITH ORDINALITY b(t,n) WHERE t->>'classification'='working' ORDER BY n LIMIT 1) END,
 'measurement',CASE WHEN a."content"->'exercise'=o->'exercise' THEN a."content"->'target'->'measurement'
 WHEN o->'exercise'->>'loadKind'='bodyweight' THEN '{"kind":"bodyweight","convention":"bodyweightOnly"}'::jsonb ELSE 'null'::jsonb END)
 FROM "Trainer2SetAddition" a JOIN "Trainer2Execution" x ON x."id"=a."executionId",
 jsonb_array_elements(trainer2_base_positions(x."id")) p,jsonb_array_elements(trainer2_original_positions(x."id")) o
 WHERE a."executionId"=execution_id AND a."targetId"=target_id AND p->>'id'=a."positionId"::text AND o->>'id'=coalesce(p->>'sourcePositionId',p->>'id')
$$;

CREATE OR REPLACE FUNCTION trainer2_addition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x "Trainer2Execution"; e jsonb; owned jsonb; original jsonb; effective jsonb; exercise jsonb; previous jsonb; binding jsonb; ordinal integer;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO x FROM "Trainer2Execution" WHERE "accountId"=NEW."accountId" AND "id"=NEW."executionId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 SELECT p INTO owned FROM jsonb_array_elements(trainer2_base_positions(x."id")) p WHERE p->>'id'=NEW."positionId"::text;
 SELECT p INTO original FROM jsonb_array_elements(trainer2_original_positions(x."id")) p WHERE p->>'id'=coalesce(owned->>'sourcePositionId',owned->>'id');
 binding := trainer2_assignment(x."id",NEW."positionId");
 SELECT coalesce((SELECT s."content"->'exercise' FROM "Trainer2ExerciseSwap" s WHERE s."executionId"=x."id" AND s."positionId"=NEW."positionId" ORDER BY s."version" DESC LIMIT 1),original->'exercise') INTO exercise;
 effective := trainer2_effective_targets(x."id",NEW."positionId");
 ordinal := jsonb_array_length(effective)+1;
 SELECT t INTO previous FROM jsonb_array_elements(effective) WITH ORDINALITY a(t,n) WHERE t->>'classification'='working' ORDER BY n DESC LIMIT 1;
 IF x."lifecycle" IS DISTINCT FROM 'Open' OR owned IS NULL OR previous IS NULL OR ordinal>100
 OR EXISTS (SELECT 1 FROM "Trainer2ExecutionFinish" WHERE "executionId"=x."id") OR EXISTS (SELECT 1 FROM "Trainer2ExecutionDiscard" WHERE "executionId"=x."id")
 OR EXISTS (SELECT 1 FROM "Trainer2Execution" y,jsonb_array_elements(y."initialPrescription"->'positions') p,jsonb_array_elements(p->'targets') t WHERE t->>'id'=NEW."targetId"::text OR t->>'sourceTargetId'=NEW."targetId"::text OR p->>'id'=NEW."targetId"::text OR p->>'sourcePositionId'=NEW."targetId"::text OR y."id"=NEW."targetId" OR y."planId"=NEW."targetId" OR y."revisionId"=NEW."targetId" OR y."occurrenceId"=NEW."targetId")
 OR e->>'commandType' IS DISTINCT FROM 'AddSet'
 OR e->'target' IS DISTINCT FROM jsonb_build_object('executionId',x."id"::text,'positionId',NEW."positionId"::text)
 OR e->'expected' IS DISTINCT FROM jsonb_build_object('contentHash',x."contentHash",'assignment',binding) OR e->'intent' IS DISTINCT FROM '{}'::jsonb
 OR NEW."ordinal" IS DISTINCT FROM ordinal
 OR NEW."content" IS DISTINCT FROM jsonb_build_object('policyVersion','trainer2-add-set-v1','positionId',NEW."positionId"::text,'ordinal',ordinal,
 'target',(previous-'id') || jsonb_build_object('id',NEW."targetId"::text,'classification','working','required',true),'exercise',exercise,'assignment',binding)
 OR EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId")
 THEN RAISE EXCEPTION 'TRAINER2_ADDITION_SOURCE'; END IF;
 NEW."recordedAt" := clock_timestamp(); RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION trainer2_swap_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x "Trainer2Execution"; previous "Trainer2ExerciseSwap"; e jsonb; owned jsonb; original jsonb; binding jsonb;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO x FROM "Trainer2Execution" WHERE "accountId"=NEW."accountId" AND "id"=NEW."executionId";
 SELECT * INTO previous FROM "Trainer2ExerciseSwap" WHERE "executionId"=NEW."executionId" AND "positionId"=NEW."positionId" ORDER BY "version" DESC LIMIT 1;
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 SELECT p INTO owned FROM jsonb_array_elements(trainer2_execution_positions(x."id")) p WHERE p->>'id'=NEW."positionId"::text;
 SELECT p INTO original FROM jsonb_array_elements(trainer2_original_positions(x."id")) p WHERE p->>'id'=coalesce(owned->>'sourcePositionId',owned->>'id');
 original := original || jsonb_build_object('targets',(original->'targets') || coalesce((SELECT jsonb_agg(a."content"->'target' ORDER BY a."ordinal") FROM "Trainer2SetAddition" a WHERE a."executionId"=x."id" AND a."positionId"=NEW."positionId"),'[]'::jsonb));
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
   OR (e->'intent'->'restoreOriginal'='true'::jsonb AND n<=jsonb_array_length((SELECT p->'targets' FROM jsonb_array_elements(trainer2_base_positions(x."id")) p WHERE p->>'id'=NEW."positionId"::text)) AND (t-'id') IS DISTINCT FROM ((original->'targets'->(n::int-1))-'id'))
   OR (e->'intent'->'restoreOriginal'='true'::jsonb AND EXISTS (SELECT 1 FROM "Trainer2SetAddition" a WHERE a."executionId"=x."id" AND a."targetId"::text=t->>'id') AND t IS DISTINCT FROM trainer2_restored_addition_target(x."id",(t->>'id')::uuid))
   OR (e->'intent'->'restoreOriginal'='false'::jsonb AND t->'measurement' NOT IN ('null'::jsonb,'{"kind":"bodyweight","convention":"bodyweightOnly"}'::jsonb)))
 OR EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId")
 THEN RAISE EXCEPTION 'TRAINER2_SWAP_SOURCE'; END IF;
 NEW."recordedAt" := clock_timestamp(); RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION trainer2_discard_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x "Trainer2Execution"; e jsonb; binding jsonb;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO x FROM "Trainer2Execution" WHERE "id"=NEW."executionId" AND "accountId"=NEW."accountId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 SELECT jsonb_build_object('contentHash',x."contentHash",'results',coalesce(jsonb_agg(jsonb_build_object(
   'targetId',t->>'id','resultVersion',0,'performedSetId',NULL) ORDER BY t->>'id'),'[]'::jsonb))
 INTO binding FROM jsonb_array_elements(trainer2_execution_positions(x."id")) pos, jsonb_array_elements(pos->'targets') t;
 binding := binding || trainer2_assignments(x."id");
 IF x."lifecycle" IS DISTINCT FROM 'Open' OR NEW."occurrenceId" IS DISTINCT FROM x."occurrenceId"
   OR EXISTS (SELECT 1 FROM "Trainer2ExerciseAddition" WHERE "executionId"=x."id")
   OR EXISTS (SELECT 1 FROM "Trainer2SetAddition" WHERE "executionId"=x."id")
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

CREATE OR REPLACE FUNCTION trainer2_assignments(execution_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN EXISTS (SELECT 1 FROM "Trainer2ExerciseSwap" WHERE "executionId"=execution_id)
 THEN jsonb_build_object('assignments',(SELECT jsonb_agg(trainer2_assignment(execution_id,(p->>'id')::uuid) ORDER BY p->>'id') FROM jsonb_array_elements(trainer2_execution_positions(execution_id)) p)) ELSE '{}'::jsonb END
$$;
CREATE FUNCTION trainer2_exercise_addition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x "Trainer2Execution"; e jsonb; p jsonb; expected_ordinal integer;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO x FROM "Trainer2Execution" WHERE "accountId"=NEW."accountId" AND "id"=NEW."executionId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 expected_ordinal := jsonb_array_length(trainer2_base_positions(x."id"))+1;
 p := NEW."content"->'position';
 IF x."lifecycle" IS DISTINCT FROM 'Open' OR expected_ordinal>100 OR NEW."ordinal" IS DISTINCT FROM expected_ordinal
 OR EXISTS (SELECT 1 FROM "Trainer2ExecutionFinish" WHERE "executionId"=x."id") OR EXISTS (SELECT 1 FROM "Trainer2ExecutionDiscard" WHERE "executionId"=x."id")
 OR e->>'commandType' IS DISTINCT FROM 'AddExercise' OR e->'target' IS DISTINCT FROM jsonb_build_object('executionId',x."id"::text)
 OR e->'expected' IS DISTINCT FROM jsonb_build_object('contentHash',x."contentHash")
 OR NEW."content"->>'policyVersion' IS DISTINCT FROM 'trainer2-add-exercise-v1' OR NEW."content"->'ordinal' IS DISTINCT FROM to_jsonb(expected_ordinal)
 OR p->>'id' IS DISTINCT FROM NEW."positionId"::text OR p->>'role' IS DISTINCT FROM 'Accessory' OR p ? 'sourceKey'
 OR p->'exercise'->>'kind' IS DISTINCT FROM 'catalogSnapshot' OR p->'exercise'->>'catalogId' IS DISTINCT FROM e->'intent'->>'catalogId'
 OR jsonb_array_length(p->'targets') NOT BETWEEN 1 AND 20 OR p->'targets' IS NULL OR to_jsonb(jsonb_array_length(p->'targets')) IS DISTINCT FROM e->'intent'->'sets'
 OR (SELECT count(DISTINCT t->>'id') FROM jsonb_array_elements(p->'targets') t) <> jsonb_array_length(p->'targets')
 OR EXISTS (SELECT 1 FROM jsonb_array_elements(p->'targets') t WHERE t->>'id'=NEW."positionId"::text OR (t->>'id')::uuid IS NULL OR
 (t-'id') IS DISTINCT FROM jsonb_build_object('classification','working','required',true,'reps',e->'intent'->'reps','rir',e->'intent'->'rir','restSeconds','120',
 'measurement',CASE WHEN e->'intent'->'startingLoad'='null'::jsonb AND p->'exercise'->>'loadKind'='bodyweight' THEN '{"kind":"bodyweight","convention":"bodyweightOnly"}'::jsonb ELSE e->'intent'->'startingLoad' END))
 OR EXISTS (SELECT 1 FROM "Trainer2Execution" y,jsonb_array_elements(trainer2_execution_positions(y."id")) op,jsonb_array_elements(op->'targets') ot WHERE
 op->>'id'=NEW."positionId"::text OR ot->>'id'=NEW."positionId"::text OR EXISTS (SELECT 1 FROM jsonb_array_elements(p->'targets') t WHERE t->>'id' IN (op->>'id',ot->>'id',ot->>'sourceTargetId',op->>'sourcePositionId',y."id"::text,y."planId"::text,y."revisionId"::text,y."occurrenceId"::text)))
 OR EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId")
 THEN RAISE EXCEPTION 'TRAINER2_EXERCISE_ADDITION_SOURCE'; END IF;
 NEW."recordedAt" := clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER trainer2_exercise_addition_guard BEFORE INSERT ON "Trainer2ExerciseAddition" FOR EACH ROW EXECUTE FUNCTION trainer2_exercise_addition_guard();
CREATE FUNCTION trainer2_exercise_addition_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" o WHERE o."accountId"=NEW."accountId" AND o."actionId"=NEW."actionId" AND o."status"='Accepted'
 AND o."outcome"->>'commandType'='AddExercise' AND o."outcome"->'result'=jsonb_build_object('executionId',NEW."executionId"::text,'positionId',NEW."positionId"::text,'ordinal',NEW."ordinal",'contentHash',NEW."contentHash"))
 THEN RAISE EXCEPTION 'TRAINER2_EXERCISE_ADDITION_OUTCOME'; END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trainer2_exercise_addition_seal AFTER INSERT ON "Trainer2ExerciseAddition" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_exercise_addition_seal();
ALTER TABLE "Trainer2ExerciseAddition" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Trainer2ExerciseAddition" FROM PUBLIC;
REVOKE ALL ON FUNCTION trainer2_original_positions(uuid),trainer2_base_positions(uuid),trainer2_exercise_addition_guard(),trainer2_exercise_addition_seal() FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
 EXECUTE format('REVOKE ALL ON TABLE "Trainer2ExerciseAddition" FROM %I',api_role);
 EXECUTE format('REVOKE ALL ON FUNCTION trainer2_original_positions(uuid),trainer2_base_positions(uuid),trainer2_exercise_addition_guard(),trainer2_exercise_addition_seal() FROM %I',api_role);
 END IF; END LOOP;
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
       WHEN 'AddExercise' THEN NOT EXISTS (SELECT 1 FROM "Trainer2ExerciseAddition" a WHERE a."accountId"=o."accountId" AND a."actionId"=o."actionId"
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

COMMIT;
