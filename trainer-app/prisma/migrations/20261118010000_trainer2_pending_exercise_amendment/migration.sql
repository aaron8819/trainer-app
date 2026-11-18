BEGIN;
-- Prospective overlay only: the accepted revision and all prior START snapshots remain immutable.
CREATE TABLE "Trainer2PlanExerciseAmendment" (
 "accountId" text NOT NULL,"planId" uuid NOT NULL,"revisionId" uuid NOT NULL,"actionId" uuid NOT NULL,
 "version" integer NOT NULL CHECK ("version">0),"instructionEpoch" integer NOT NULL CHECK ("instructionEpoch">=0),
 "contentHash" text NOT NULL,"canonicalContent" text NOT NULL,"content" jsonb NOT NULL,
 "createdTx" bigint NOT NULL DEFAULT txid_current(),"createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("accountId","actionId"),UNIQUE ("planId","version"),
 FOREIGN KEY ("accountId","planId","revisionId") REFERENCES "Trainer2PlanRevision"("accountId","planId","id"),
 FOREIGN KEY ("accountId","actionId") REFERENCES "Trainer2DurableAction"("accountId","actionId"),
 CHECK ("content"="canonicalContent"::jsonb),CHECK ("contentHash"=encode(sha256(convert_to("canonicalContent",'UTF8')),'hex'))
);
CREATE TRIGGER trainer2_amendment_immutable BEFORE UPDATE OR DELETE ON "Trainer2PlanExerciseAmendment" FOR EACH ROW EXECUTE FUNCTION trainer2_immutable();
CREATE FUNCTION trainer2_amendment_binding(account_id text,plan_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('version',"version",'actionId',"actionId"::text,'contentHash',"contentHash")
 FROM "Trainer2PlanExerciseAmendment" WHERE "accountId"=account_id AND "planId"=plan_id ORDER BY "version" DESC LIMIT 1
$$;
CREATE FUNCTION trainer2_amended_occurrence(account_id text,plan_id uuid,original jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT original || jsonb_build_object('positions',coalesce(jsonb_agg(
 CASE WHEN replacement IS NULL THEN position ELSE position || jsonb_build_object('exercise',replacement->'exercise','targets',replacement->'targets') END ORDER BY ordinal),'[]'::jsonb))
 FROM jsonb_array_elements(original->'positions') WITH ORDINALITY a(position,ordinal)
 LEFT JOIN LATERAL (
 SELECT replacement FROM "Trainer2PlanExerciseAmendment" m,jsonb_array_elements(m."content"->'replacements') replacement
 WHERE m."accountId"=account_id AND m."planId"=plan_id AND replacement->>'occurrenceId'=original->>'id' AND replacement->>'positionId'=position->>'id'
 ORDER BY m."version" DESC LIMIT 1) latest ON true
$$;
CREATE FUNCTION trainer2_amendment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Trainer2Plan";r "Trainer2PlanRevision";e jsonb;binding jsonb;replacement jsonb;original jsonb;selected jsonb;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO p FROM "Trainer2Plan" WHERE "accountId"=NEW."accountId" AND "id"=NEW."planId";
 SELECT * INTO r FROM "Trainer2PlanRevision" WHERE "accountId"=NEW."accountId" AND "planId"=NEW."planId" AND "id"=NEW."revisionId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 binding:=trainer2_amendment_binding(NEW."accountId",NEW."planId");
 IF p."lifecycle" IS DISTINCT FROM 'Active' OR p."tombstonedAt" IS NOT NULL OR r."id" IS NULL
 OR p."currentRevisionId" IS DISTINCT FROM NEW."revisionId" OR p."initialApprovedRevisionId" IS DISTINCT FROM NEW."revisionId"
 OR NEW."version" IS DISTINCT FROM coalesce((binding->>'version')::integer,0)+1
 OR NEW."instructionEpoch" IS DISTINCT FROM (SELECT "instructionEpoch" FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId")
 OR e->>'commandType' IS DISTINCT FROM 'AmendPendingExercise'
 OR e->'target' IS DISTINCT FROM jsonb_build_object('planId',NEW."planId"::text)
 OR e->'expected' IS DISTINCT FROM jsonb_build_object('planRevisionId',NEW."revisionId"::text,'amendmentVersion',NEW."version"-1,'instructionEpoch',NEW."instructionEpoch",'effectiveHash',NEW."contentHash")
 OR NEW."content"->>'policyVersion' IS DISTINCT FROM 'trainer2-plan-exercise-amendment-v1'
 OR (NEW."content"-'policyVersion'-'replacements') IS DISTINCT FROM '{}'::jsonb
 OR jsonb_typeof(NEW."content"->'replacements') IS DISTINCT FROM 'array'
 OR NEW."createdTx"<>txid_current()
 OR EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId")
 THEN RAISE EXCEPTION 'TRAINER2_AMENDMENT_SOURCE'; END IF;
 IF jsonb_array_length(NEW."content"->'replacements') NOT BETWEEN 1 AND 500
 OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW."content"->'replacements') v GROUP BY v->>'occurrenceId',v->>'positionId' HAVING count(*)>1)
 THEN RAISE EXCEPTION 'TRAINER2_AMENDMENT_SELECTION'; END IF;
 SELECT jsonb_agg(jsonb_build_object('occurrenceId',v->>'occurrenceId','positionId',v->>'positionId') ORDER BY n) INTO selected
 FROM jsonb_array_elements(NEW."content"->'replacements') WITH ORDINALITY a(v,n);
 IF e->'intent' IS DISTINCT FROM jsonb_build_object('positions',selected,'catalogId','t2:45-degree-back-extension')
 THEN RAISE EXCEPTION 'TRAINER2_AMENDMENT_INTENT'; END IF;
 FOR replacement IN SELECT value FROM jsonb_array_elements(NEW."content"->'replacements') LOOP
  SELECT pos INTO original FROM jsonb_array_elements(r."document"->'occurrences') o,jsonb_array_elements(o->'positions') pos
  WHERE o->>'id'=replacement->>'occurrenceId' AND pos->>'id'=replacement->>'positionId';
  IF original IS NULL OR original->'exercise'->>'catalogId' IS DISTINCT FROM 't2:bodyweight-45-degree-back-extension'
  OR original->'exercise'->>'kind' IS DISTINCT FROM 'catalogSnapshot'
  OR (replacement-'occurrenceId'-'positionId'-'exercise'-'targets') IS DISTINCT FROM '{}'::jsonb
  OR replacement->'exercise' IS DISTINCT FROM '{"kind": "catalogSnapshot", "catalogVersion": 1, "catalogId": "t2:45-degree-back-extension", "name": "45-Degree Back Extension", "variation": "Fixed 45-degree bench, feet secured, both legs together. One controlled lower and return is one rep. Log total external weight held (e.g. plates); 0 means bodyweight only.", "equipment": ["Machine", "Bodyweight"], "purpose": "extension", "repBasis": "total", "loadKind": "addedLoad", "convention": "addedExternal", "catalogFacts": {"movementPatterns": ["extension"], "primaryMuscles": ["Glutes", "Hamstrings", "Lower Back"], "secondaryMuscles": [], "externalZeroMeaning": null, "repDefaults": {"min": 6, "max": 12}}}'::jsonb
  OR replacement->'targets' IS DISTINCT FROM (SELECT jsonb_agg(t || jsonb_build_object('measurement',NULL) ORDER BY n) FROM jsonb_array_elements(original->'targets') WITH ORDINALITY a(t,n))
  OR EXISTS (SELECT 1 FROM "Trainer2Execution" WHERE "accountId"=NEW."accountId" AND "planId"=NEW."planId" AND "occurrenceId"::text=replacement->>'occurrenceId')
  OR EXISTS (SELECT 1 FROM "Trainer2OccurrenceSkip" WHERE "accountId"=NEW."accountId" AND "planId"=NEW."planId" AND "occurrenceId"::text=replacement->>'occurrenceId')
  OR EXISTS (SELECT 1 FROM "Trainer2PlanExerciseAmendment" m,jsonb_array_elements(m."content"->'replacements') v WHERE m."accountId"=NEW."accountId" AND m."planId"=NEW."planId" AND v->>'occurrenceId'=replacement->>'occurrenceId' AND v->>'positionId'=replacement->>'positionId')
  THEN RAISE EXCEPTION 'TRAINER2_AMENDMENT_POSITION'; END IF;
 END LOOP;
 NEW."createdAt":=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER trainer2_amendment_guard BEFORE INSERT ON "Trainer2PlanExerciseAmendment" FOR EACH ROW EXECUTE FUNCTION trainer2_amendment_guard();
CREATE FUNCTION trainer2_amendment_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId" AND "status"='Accepted'
 AND "outcome"->>'commandType'='AmendPendingExercise' AND "outcome"->'result'=jsonb_build_object('planId',NEW."planId"::text,'version',NEW."version",'contentHash',NEW."contentHash"))
 THEN RAISE EXCEPTION 'TRAINER2_AMENDMENT_OUTCOME';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trainer2_amendment_seal AFTER INSERT ON "Trainer2PlanExerciseAmendment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_amendment_seal();
CREATE OR REPLACE FUNCTION trainer2_start_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Trainer2Plan"; r "Trainer2PlanRevision"; s jsonb; e jsonb; o jsonb; ip jsonb; it jsonb; pos integer; target integer; amendment jsonb;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO p FROM "Trainer2Plan" WHERE "id"=NEW."planId" AND "accountId"=NEW."accountId";
 SELECT * INTO r FROM "Trainer2PlanRevision" WHERE "id"=NEW."revisionId" AND "accountId"=NEW."accountId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 s := NEW."initialPrescription";
 SELECT v INTO o FROM jsonb_array_elements(r."document"->'occurrences') WITH ORDINALITY a(v,n)
 WHERE v->>'id'=NEW."occurrenceId"::text;
 amendment:=trainer2_amendment_binding(NEW."accountId",NEW."planId");
 o:=trainer2_amended_occurrence(NEW."accountId",NEW."planId",o);
 IF coalesce(e->'expected'->'amendmentVersion','0'::jsonb) IS DISTINCT FROM coalesce(amendment->'version','0'::jsonb)
 OR s->'amendment' IS DISTINCT FROM amendment THEN RAISE EXCEPTION 'TRAINER2_START_AMENDMENT'; END IF;
 IF NEW."lifecycle" IS DISTINCT FROM 'Open' OR p."lifecycle" IS DISTINCT FROM 'Active' OR p."tombstonedAt" IS NOT NULL
   OR p."currentRevisionId" IS DISTINCT FROM NEW."revisionId" OR p."initialApprovedRevisionId" IS DISTINCT FROM NEW."revisionId"
   OR o->>'id' IS DISTINCT FROM NEW."occurrenceId"::text
   OR NOT trainer2_current_week_eligible(NEW."accountId",NEW."planId",r."document",NEW."occurrenceId"::text)
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
       WHEN 'AmendPendingExercise' THEN NOT EXISTS (SELECT 1 FROM "Trainer2PlanExerciseAmendment" m WHERE m."accountId"=o."accountId" AND m."actionId"=o."actionId"
 AND o."outcome"->'result'=jsonb_build_object('planId',m."planId"::text,'version',m."version",'contentHash',m."contentHash"))
       WHEN 'SwapExercise'  THEN NOT EXISTS (SELECT 1 FROM "Trainer2ExerciseSwap" s WHERE s."accountId"=o."accountId" AND s."actionId"=o."actionId"
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
ALTER TABLE "Trainer2PlanExerciseAmendment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Trainer2PlanExerciseAmendment" FROM PUBLIC;
REVOKE ALL ON FUNCTION trainer2_amendment_binding(text,uuid),trainer2_amended_occurrence(text,uuid,jsonb),trainer2_amendment_guard(),trainer2_amendment_seal() FROM PUBLIC;
DO $$ DECLARE api_role text;BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
 EXECUTE format('REVOKE ALL ON TABLE "Trainer2PlanExerciseAmendment" FROM %I',api_role);
 EXECUTE format('REVOKE ALL ON FUNCTION trainer2_amendment_binding(text,uuid),trainer2_amended_occurrence(text,uuid,jsonb),trainer2_amendment_guard(),trainer2_amendment_seal() FROM %I',api_role);
 END IF;END LOOP;
END $$;
COMMIT;
