BEGIN;
-- Contiguous stage runs follow immutable authored occurrence order, including
-- recurring stage identities. Resolution remains Finished or explicit Skip.
CREATE FUNCTION trainer2_current_week_eligible(account_id text, plan_id uuid, document jsonb, occurrence_id text)
RETURNS boolean LANGUAGE sql AS $$
 WITH ordered AS (
   SELECT o, n, CASE WHEN lag(o->>'stageId') OVER (ORDER BY n) IS DISTINCT FROM o->>'stageId' THEN 1 ELSE 0 END AS boundary
   FROM jsonb_array_elements(document->'occurrences') WITH ORDINALITY a(o,n)
 ), grouped AS (
   SELECT o, n, sum(boundary) OVER (ORDER BY n) AS week FROM ordered
 ), pending AS (
   SELECT * FROM grouped WHERE NOT trainer2_occurrence_resolved(account_id,plan_id,o->>'id')
 )
 SELECT EXISTS (SELECT 1 FROM pending WHERE o->>'id'=occurrence_id
   AND week=(SELECT week FROM pending ORDER BY n LIMIT 1))
$$;
REVOKE ALL ON FUNCTION trainer2_current_week_eligible(text,uuid,jsonb,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION trainer2_start_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Trainer2Plan"; r "Trainer2PlanRevision"; s jsonb; e jsonb; o jsonb; ip jsonb; it jsonb; pos integer; target integer;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO p FROM "Trainer2Plan" WHERE "id"=NEW."planId" AND "accountId"=NEW."accountId";
 SELECT * INTO r FROM "Trainer2PlanRevision" WHERE "id"=NEW."revisionId" AND "accountId"=NEW."accountId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 s := NEW."initialPrescription";
 SELECT v INTO o FROM jsonb_array_elements(r."document"->'occurrences') WITH ORDINALITY a(v,n)
 WHERE v->>'id'=NEW."occurrenceId"::text;
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
   OR NEW."planCompleted" IS DISTINCT FROM (jsonb_array_length(pending)=1) OR NEW."priorPlanLifecycle" IS DISTINCT FROM p."lifecycle"
   OR NEW."endpoint" IS DISTINCT FROM jsonb_build_object('kind',r."document"->>'endpoint','occurrenceIds',
     (SELECT jsonb_agg(o->>'id' ORDER BY n) FROM jsonb_array_elements(r."document"->'occurrences') WITH ORDINALITY a(o,n)))
   OR NEW."createdTx"<>txid_current()
   OR EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId")
 THEN RAISE EXCEPTION 'TRAINER2_SKIP_SOURCE'; END IF;
 NEW."skippedAt" := clock_timestamp();
 RETURN NEW;
END $$;
-- Preserve provider denial even on databases with provider default function ACLs.
DO $$ DECLARE provider_role text; BEGIN
 FOREACH provider_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=provider_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION trainer2_current_week_eligible(text,uuid,jsonb,text) FROM %I',provider_role);
  END IF;
 END LOOP;
END $$;
COMMIT;
