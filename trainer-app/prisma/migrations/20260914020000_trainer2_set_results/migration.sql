BEGIN;
CREATE TABLE "Trainer2SetResultRevision" (
 "accountId" text NOT NULL, "executionId" uuid NOT NULL, "targetId" uuid NOT NULL,
 "performedSetId" uuid NOT NULL, "version" integer NOT NULL CHECK ("version">0),
 "actionId" uuid NOT NULL, "result" jsonb NOT NULL, "reason" text,
 "recordedAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("executionId","targetId","version"), UNIQUE("accountId","actionId"), UNIQUE("performedSetId","version"),
 FOREIGN KEY("accountId","executionId") REFERENCES "Trainer2Execution"("accountId","id"),
 FOREIGN KEY("accountId","actionId") REFERENCES "Trainer2DurableAction"("accountId","actionId"),
 CHECK (("version"=1 AND "reason" IS NULL AND "result"<>'null'::jsonb) OR
        ("version">1 AND "reason" IS NOT NULL AND length(trim("reason")) BETWEEN 1 AND 200))
);
CREATE TRIGGER trainer2_result_immutable BEFORE UPDATE OR DELETE ON "Trainer2SetResultRevision"
 FOR EACH ROW EXECUTE FUNCTION trainer2_immutable();
CREATE FUNCTION trainer2_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x "Trainer2Execution"; previous "Trainer2SetResultRevision"; e jsonb;
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 SELECT * INTO x FROM "Trainer2Execution" WHERE "accountId"=NEW."accountId" AND "id"=NEW."executionId";
 SELECT * INTO previous FROM "Trainer2SetResultRevision" WHERE "executionId"=NEW."executionId" AND "targetId"=NEW."targetId" ORDER BY "version" DESC LIMIT 1;
 SELECT "submittedEnvelope"::jsonb INTO e FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
 IF x."lifecycle" IS DISTINCT FROM 'Open' OR NOT EXISTS (
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
CREATE TRIGGER trainer2_result_guard BEFORE INSERT ON "Trainer2SetResultRevision" FOR EACH ROW EXECUTE FUNCTION trainer2_result_guard();
CREATE FUNCTION trainer2_result_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" o WHERE o."accountId"=NEW."accountId" AND o."actionId"=NEW."actionId"
   AND o."status"='Accepted' AND o."outcome"->'result'=jsonb_build_object('executionId',NEW."executionId"::text,
     'targetId',NEW."targetId"::text,'performedSetId',NEW."performedSetId"::text,'version',NEW."version"))
 THEN RAISE EXCEPTION 'TRAINER2_RESULT_OUTCOME'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trainer2_result_seal AFTER INSERT ON "Trainer2SetResultRevision"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_result_seal();
REVOKE ALL ON "Trainer2SetResultRevision" FROM PUBLIC;
REVOKE ALL ON FUNCTION trainer2_result_guard(), trainer2_result_seal() FROM PUBLIC;
ALTER TABLE "Trainer2SetResultRevision" ENABLE ROW LEVEL SECURITY;

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
