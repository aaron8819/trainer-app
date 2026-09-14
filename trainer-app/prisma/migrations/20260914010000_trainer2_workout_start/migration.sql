BEGIN;
CREATE TABLE "Trainer2Execution" (
 "id" uuid PRIMARY KEY, "accountId" text NOT NULL, "planId" uuid NOT NULL,
 "revisionId" uuid NOT NULL, "occurrenceId" uuid NOT NULL UNIQUE, "actionId" uuid NOT NULL,
 "lifecycle" text NOT NULL DEFAULT 'Open' CHECK ("lifecycle"='Open'),
 "startedAt" timestamptz(3) NOT NULL, "initialPrescription" jsonb NOT NULL,
 "canonicalContent" text NOT NULL, "contentHash" text NOT NULL,
 UNIQUE("accountId","id"), UNIQUE("accountId","actionId"),
 FOREIGN KEY("accountId","planId","revisionId") REFERENCES "Trainer2PlanRevision"("accountId","planId","id"),
 FOREIGN KEY("accountId","planId","occurrenceId") REFERENCES "Trainer2Identity"("accountId","planId","id"),
 FOREIGN KEY("accountId","actionId") REFERENCES "Trainer2DurableAction"("accountId","actionId"),
 CHECK ("initialPrescription"="canonicalContent"::jsonb),
 CHECK ("contentHash"=encode(sha256(convert_to("canonicalContent",'UTF8')),'hex')),
 CHECK (("initialPrescription"->>'schemaVersion'='1' AND "initialPrescription"->>'kind'='START'
   AND "initialPrescription"->>'provenance'='VERIFIED_START'
   AND "initialPrescription"->>'policyVersion'='trainer2-start-v1') IS TRUE)
);
CREATE UNIQUE INDEX trainer2_one_open_execution ON "Trainer2Execution"("accountId") WHERE "lifecycle"='Open';
CREATE TRIGGER trainer2_execution_immutable BEFORE UPDATE OR DELETE ON "Trainer2Execution" FOR EACH ROW EXECUTE FUNCTION trainer2_immutable();
CREATE FUNCTION trainer2_start_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Trainer2Plan"; r "Trainer2PlanRevision"; s jsonb; e jsonb; o jsonb; ip jsonb; it jsonb; pos integer; target integer;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO p FROM "Trainer2Plan" WHERE "id"=NEW."planId" AND "accountId"=NEW."accountId";
 SELECT * INTO r FROM "Trainer2PlanRevision" WHERE "id"=NEW."revisionId" AND "accountId"=NEW."accountId";
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 s := NEW."initialPrescription"; o := r."document"->'occurrences'->0;
 IF p."lifecycle" IS DISTINCT FROM 'Active' OR p."tombstonedAt" IS NOT NULL
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
CREATE TRIGGER trainer2_start_guard BEFORE INSERT ON "Trainer2Execution" FOR EACH ROW EXECUTE FUNCTION trainer2_start_guard();
CREATE FUNCTION trainer2_start_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" o WHERE o."accountId"=NEW."accountId" AND o."actionId"=NEW."actionId"
   AND o."status"='Accepted' AND o."outcome"->'result'=jsonb_build_object('executionId',NEW."id"::text,
    'planId',NEW."planId"::text,'revisionId',NEW."revisionId"::text,'occurrenceId',NEW."occurrenceId"::text,'contentHash',NEW."contentHash"))
 THEN RAISE EXCEPTION 'TRAINER2_START_OUTCOME'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trainer2_start_seal AFTER INSERT ON "Trainer2Execution" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_start_seal();
REVOKE ALL ON "Trainer2Execution" FROM PUBLIC;
ALTER TABLE "Trainer2Execution" ENABLE ROW LEVEL SECURITY;
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

DO $$ DECLARE a text; BEGIN FOR a IN SELECT "accountId" FROM "Trainer2AccountTrainingState" LOOP PERFORM trainer2_check_acceptance(a); END LOOP; END $$;
COMMIT;
