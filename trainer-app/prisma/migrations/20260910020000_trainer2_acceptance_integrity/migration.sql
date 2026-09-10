-- Corrective, additive migration. Never repair or relabel accepted history.
BEGIN;
LOCK TABLE "Trainer2AccountTrainingState", "Trainer2DurableAction", "Trainer2Plan",
  "Trainer2PlanRevision", "Trainer2ActionOutcome" IN SHARE ROW EXCLUSIVE MODE;

-- Validate final account state, not the NEW counter snapshot from an earlier write.
-- This is referential/result integrity; draft edit policy remains in the handler.
CREATE FUNCTION trainer2_check_acceptance(account_id text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM "Trainer2ActionOutcome" o
   LEFT JOIN "Trainer2DurableAction" a ON a."accountId"=o."accountId" AND a."actionId"=o."actionId"
   LEFT JOIN "Trainer2PlanRevision" r ON r."accountId"=o."accountId" AND r."actionId"=o."actionId"
   LEFT JOIN "Trainer2Plan" p ON p."accountId"=r."accountId" AND p."id"=r."planId"
   WHERE o."accountId"=account_id AND o."status"='Accepted' AND (
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

CREATE FUNCTION trainer2_seal_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM trainer2_check_acceptance(NEW."accountId");
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trainer2_acceptance_seal AFTER INSERT ON "Trainer2ActionOutcome"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_seal_acceptance();
CREATE CONSTRAINT TRIGGER trainer2_acceptance_counter_seal AFTER INSERT OR UPDATE ON "Trainer2AccountTrainingState"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_seal_acceptance();

-- Constraint triggers do not validate existing rows. Fail the whole DDL transaction
-- on an inconsistent old database; recovery requires separate review/authorization.
DO $$ DECLARE account_id text; BEGIN
 FOR account_id IN SELECT "accountId" FROM "Trainer2AccountTrainingState" LOOP
   PERFORM trainer2_check_acceptance(account_id);
 END LOOP;
END $$;
COMMIT;
