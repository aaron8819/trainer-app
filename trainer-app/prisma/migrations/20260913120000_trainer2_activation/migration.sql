BEGIN;
-- Local activation only. Historical migrations and V1 rows remain untouched.
ALTER TABLE "Trainer2AccountTrainingState" ADD COLUMN "instructionEpoch" integer NOT NULL DEFAULT 0 CHECK ("instructionEpoch">=0);
ALTER TABLE "Trainer2Plan" ADD COLUMN "lifecycle" text NOT NULL DEFAULT 'Draft'
 CHECK ("lifecycle" IN ('Draft','Active','Paused','Completed','ConcludedEarly')),
 ADD COLUMN "initialApprovedRevisionId" uuid,
 ADD CONSTRAINT trainer2_approved_revision FOREIGN KEY ("accountId","id","initialApprovedRevisionId")
 REFERENCES "Trainer2PlanRevision"("accountId","planId","id") DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT trainer2_lifecycle_approval CHECK (("lifecycle"='Draft')=("initialApprovedRevisionId" IS NULL));
CREATE UNIQUE INDEX trainer2_one_current_plan ON "Trainer2Plan"("accountId") WHERE "lifecycle" IN ('Active','Paused');

CREATE TABLE "Trainer2InstructionRevision" (
 "id" uuid PRIMARY KEY, "accountId" text NOT NULL REFERENCES "Trainer2AccountTrainingState"("accountId"),
 "epoch" integer NOT NULL CHECK ("epoch">0), "actionId" uuid NOT NULL,
 "document" jsonb NOT NULL, "canonicalContent" text NOT NULL, "contentHash" text NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 UNIQUE("accountId","epoch"), UNIQUE("accountId","id"), UNIQUE("accountId","actionId"),
 FOREIGN KEY("accountId","actionId") REFERENCES "Trainer2DurableAction"("accountId","actionId"),
 CHECK ("document"="canonicalContent"::jsonb),
 CHECK ("contentHash"=encode(sha256(convert_to("canonicalContent",'UTF8')),'hex')),
 CHECK (("document"->>'version'='1') IS TRUE)
);
CREATE TABLE "Trainer2PlanDecision" (
 "id" uuid PRIMARY KEY, "accountId" text NOT NULL, "planId" uuid NOT NULL, "revisionId" uuid NOT NULL,
 "actionId" uuid NOT NULL, "kind" text NOT NULL CHECK ("kind"='ActivatePlan'),
 "instructionRevisionId" uuid, "reviewedDigest" text NOT NULL CHECK ("reviewedDigest" ~ '^[a-f0-9]{64}$'),
 "policyVersion" text NOT NULL CHECK ("policyVersion"='trainer2-activation-v1'), "createdAt" timestamptz NOT NULL DEFAULT now(),
 UNIQUE("accountId","actionId"), UNIQUE("planId","kind"),
 FOREIGN KEY("accountId","planId","revisionId") REFERENCES "Trainer2PlanRevision"("accountId","planId","id"),
 FOREIGN KEY("accountId","instructionRevisionId") REFERENCES "Trainer2InstructionRevision"("accountId","id"),
 FOREIGN KEY("accountId","actionId") REFERENCES "Trainer2DurableAction"("accountId","actionId")
);
CREATE TRIGGER trainer2_instructions_immutable BEFORE UPDATE OR DELETE ON "Trainer2InstructionRevision" FOR EACH ROW EXECUTE FUNCTION trainer2_immutable();
CREATE TRIGGER trainer2_decision_immutable BEFORE UPDATE OR DELETE ON "Trainer2PlanDecision" FOR EACH ROW EXECUTE FUNCTION trainer2_immutable();

CREATE FUNCTION trainer2_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM "Trainer2AccountTrainingState" WHERE "accountId"=NEW."accountId" FOR UPDATE;
 IF TG_OP='INSERT' THEN
   IF NEW."lifecycle"<>'Draft' THEN RAISE EXCEPTION 'TRAINER2_CREATE_DRAFT_REQUIRED'; END IF;
 ELSE
   IF OLD."lifecycle"<>'Draft' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'TRAINER2_ACTIVE_IMMUTABLE'; END IF;
   IF NEW."lifecycle"<>OLD."lifecycle" AND (OLD."lifecycle"<>'Draft' OR NEW."lifecycle"<>'Active' OR
     NEW."currentRevisionId"<>OLD."currentRevisionId" OR NEW."initialApprovedRevisionId" IS DISTINCT FROM OLD."currentRevisionId" OR NEW."tombstonedAt" IS NOT NULL)
   THEN RAISE EXCEPTION 'TRAINER2_INVALID_ACTIVATION'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trainer2_activation_guard BEFORE INSERT OR UPDATE ON "Trainer2Plan" FOR EACH ROW EXECUTE FUNCTION trainer2_activation_guard();
CREATE FUNCTION trainer2_activation_seal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "Trainer2Plan"; a "Trainer2DurableAction"; e jsonb;
BEGIN
 IF TG_TABLE_NAME='Trainer2Plan' THEN
   IF NEW."lifecycle"='Draft' THEN RETURN NULL; END IF;
   IF NOT EXISTS (SELECT 1 FROM "Trainer2PlanDecision" d WHERE d."planId"=NEW."id" AND d."revisionId"=NEW."initialApprovedRevisionId")
   THEN RAISE EXCEPTION 'TRAINER2_ACTIVATION_WITHOUT_DECISION'; END IF;
 ELSE
   SELECT * INTO p FROM "Trainer2Plan" WHERE "id"=NEW."planId" AND "accountId"=NEW."accountId";
   SELECT * INTO a FROM "Trainer2DurableAction" WHERE "accountId"=NEW."accountId" AND "actionId"=NEW."actionId";
   e := a."submittedEnvelope"::jsonb;
   IF p."lifecycle" IS DISTINCT FROM 'Active' OR p."initialApprovedRevisionId" IS DISTINCT FROM NEW."revisionId"
     OR p."currentRevisionId" IS DISTINCT FROM NEW."revisionId"
     OR e->>'commandType' IS DISTINCT FROM 'ActivatePlan'
     OR e->'target'->>'planId' IS DISTINCT FROM NEW."planId"::text
     OR e->'expected'->>'planRevisionId' IS DISTINCT FROM NEW."revisionId"::text
     OR e->'intent'->'reviewed'->>'digest' IS DISTINCT FROM NEW."reviewedDigest"
     OR (e->'intent'->'reviewed'->'binding'->>'instructionRevisionId')::uuid IS DISTINCT FROM NEW."instructionRevisionId"
     OR NOT EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" o WHERE o."accountId"=NEW."accountId" AND o."actionId"=NEW."actionId" AND o."status"='Accepted'
       AND o."outcome"->'result'->>'decisionId'=NEW."id"::text AND o."outcome"->'result'->>'revisionId'=NEW."revisionId"::text)
   THEN RAISE EXCEPTION 'TRAINER2_ACTIVATION_SEAL'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trainer2_activation_seal AFTER INSERT OR UPDATE ON "Trainer2Plan" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_activation_seal();
CREATE CONSTRAINT TRIGGER trainer2_decision_seal AFTER INSERT ON "Trainer2PlanDecision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_activation_seal();
CREATE FUNCTION trainer2_instruction_epoch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."instructionEpoch"<>OLD."instructionEpoch" AND NEW."instructionEpoch"<>OLD."instructionEpoch"+1
 THEN RAISE EXCEPTION 'TRAINER2_INSTRUCTION_EPOCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trainer2_instruction_epoch_guard BEFORE UPDATE ON "Trainer2AccountTrainingState" FOR EACH ROW EXECUTE FUNCTION trainer2_instruction_epoch_guard();
CREATE FUNCTION trainer2_instruction_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='Trainer2AccountTrainingState' THEN
   IF NEW."instructionEpoch">0 AND NOT EXISTS (SELECT 1 FROM "Trainer2InstructionRevision" r WHERE r."accountId"=NEW."accountId" AND r."epoch"=NEW."instructionEpoch")
   THEN RAISE EXCEPTION 'TRAINER2_INSTRUCTION_HEAD'; END IF;
 ELSE
   IF NOT EXISTS (SELECT 1 FROM "Trainer2AccountTrainingState" s WHERE s."accountId"=NEW."accountId" AND s."instructionEpoch"=NEW."epoch") OR
     NOT EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" o WHERE o."accountId"=NEW."accountId" AND o."actionId"=NEW."actionId" AND o."status"='Accepted'
       AND o."outcome"->'result'->>'instructionRevisionId'=NEW."id"::text)
   THEN RAISE EXCEPTION 'TRAINER2_INSTRUCTION_SEAL'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trainer2_instruction_head AFTER INSERT OR UPDATE ON "Trainer2AccountTrainingState" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_instruction_seal();
CREATE CONSTRAINT TRIGGER trainer2_instruction_seal AFTER INSERT ON "Trainer2InstructionRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_instruction_seal();
REVOKE ALL ON "Trainer2InstructionRevision", "Trainer2PlanDecision" FROM PUBLIC;
ALTER TABLE "Trainer2InstructionRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trainer2PlanDecision" ENABLE ROW LEVEL SECURITY;

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
