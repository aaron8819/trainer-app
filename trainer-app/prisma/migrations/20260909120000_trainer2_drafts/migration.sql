-- Additive, draft-only. No catalog, User, or legacy training rows are changed.
CREATE TABLE "Trainer2AccountPrincipal" (
 "id" uuid PRIMARY KEY, "accountId" text NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "issuer" text NOT NULL, "subject" text NOT NULL, UNIQUE ("issuer","subject")
);
CREATE TABLE "Trainer2AccountTrainingState" (
 "accountId" text PRIMARY KEY REFERENCES "User"("id") ON DELETE RESTRICT,
 "runtimeOwner" text NOT NULL DEFAULT 'LEGACY' CHECK ("runtimeOwner" IN ('LEGACY','FENCED','TRAINER2')),
 "ownershipEpoch" integer NOT NULL DEFAULT 0 CHECK ("ownershipEpoch">=0),
 "acceptedSequence" bigint NOT NULL DEFAULT 0 CHECK ("acceptedSequence">=0),
 "outcomeSequence" bigint NOT NULL DEFAULT 0 CHECK ("outcomeSequence">=0)
);
CREATE TABLE "Trainer2DurableAction" (
 "accountId" text NOT NULL REFERENCES "Trainer2AccountTrainingState"("accountId"), "actionId" uuid NOT NULL,
 "hashVersion" text NOT NULL CHECK ("hashVersion"='trainer2-command-envelope-v1'),
 "envelopeHash" text NOT NULL, "submittedEnvelope" text NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY ("accountId","actionId"),
 CHECK ("envelopeHash"=encode(sha256(convert_to("hashVersion" || E'\n' || "submittedEnvelope",'UTF8')),'hex')),
 CHECK ((("submittedEnvelope"::jsonb->>'actionId')::uuid="actionId") IS TRUE),
 CHECK (("submittedEnvelope"::jsonb->>'originatingAccountId'="accountId") IS TRUE)
);
CREATE TABLE "Trainer2Plan" (
 "id" uuid PRIMARY KEY, "accountId" text NOT NULL REFERENCES "Trainer2AccountTrainingState"("accountId"),
 "currentRevisionId" uuid NOT NULL, "tombstonedAt" timestamptz, UNIQUE("accountId","id")
);
CREATE TABLE "Trainer2PlanRevision" (
 "id" uuid PRIMARY KEY, "accountId" text NOT NULL, "planId" uuid NOT NULL,
 "revisionNumber" integer NOT NULL CHECK ("revisionNumber">0), "parentRevisionId" uuid,
 "actionId" uuid NOT NULL, "document" jsonb NOT NULL, "canonicalContent" text NOT NULL, "contentHash" text NOT NULL,
 "createdTx" bigint NOT NULL DEFAULT txid_current(), "createdAt" timestamptz NOT NULL DEFAULT now(),
 UNIQUE("accountId","planId","id"), UNIQUE("planId","revisionNumber"), UNIQUE("accountId","actionId"),
 FOREIGN KEY ("accountId","planId") REFERENCES "Trainer2Plan"("accountId","id") DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY ("accountId","planId","parentRevisionId") REFERENCES "Trainer2PlanRevision"("accountId","planId","id") DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY ("accountId","actionId") REFERENCES "Trainer2DurableAction"("accountId","actionId"),
 CHECK ("document"="canonicalContent"::jsonb),
 CHECK ("contentHash"=encode(sha256(convert_to("canonicalContent",'UTF8')),'hex')),
 CHECK (("revisionNumber"=1)=("parentRevisionId" IS NULL))
);
ALTER TABLE "Trainer2Plan" ADD CONSTRAINT "Trainer2Plan_same_root_head" FOREIGN KEY ("accountId","id","currentRevisionId")
 REFERENCES "Trainer2PlanRevision"("accountId","planId","id") DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE "Trainer2Identity" (
 "id" uuid PRIMARY KEY, "accountId" text NOT NULL, "planId" uuid NOT NULL,
 "kind" text NOT NULL CHECK ("kind" IN ('Stage','Occurrence','Position','Target')), "parentId" uuid, "firstRevisionId" uuid NOT NULL,
 UNIQUE("accountId","planId","id"),
 FOREIGN KEY ("accountId","planId") REFERENCES "Trainer2Plan"("accountId","id") DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY ("accountId","planId","parentId") REFERENCES "Trainer2Identity"("accountId","planId","id") DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY ("accountId","planId","firstRevisionId") REFERENCES "Trainer2PlanRevision"("accountId","planId","id") DEFERRABLE INITIALLY DEFERRED,
 CHECK (("kind" IN ('Stage','Occurrence'))=("parentId" IS NULL))
);
CREATE TABLE "Trainer2ActionOutcome" (
 "accountId" text NOT NULL, "outcomeCursor" bigint NOT NULL DEFAULT 0, "actionId" uuid NOT NULL,
 "status" text NOT NULL CHECK ("status" IN ('Waiting','Accepted','Rejected','Conflict','Superseded')),
 "outcome" jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY("accountId","outcomeCursor"),
 FOREIGN KEY("accountId","actionId") REFERENCES "Trainer2DurableAction"("accountId","actionId"),
 CHECK (("outcome"->>'status'="status") IS TRUE), CHECK ((("outcome"->>'actionId')::uuid="actionId") IS TRUE)
);
CREATE INDEX "Trainer2ActionOutcome_accountId_actionId_outcomeCursor_idx" ON "Trainer2ActionOutcome"("accountId","actionId","outcomeCursor");
CREATE UNIQUE INDEX "Trainer2ActionOutcome_one_acceptance" ON "Trainer2ActionOutcome"("accountId","actionId") WHERE "status"='Accepted';

CREATE FUNCTION trainer2_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'TRAINER2_IMMUTABLE'; END $$;
CREATE TRIGGER trainer2_revision_immutable BEFORE UPDATE OR DELETE ON "Trainer2PlanRevision" FOR EACH ROW EXECUTE FUNCTION trainer2_immutable();
CREATE TRIGGER trainer2_identity_immutable BEFORE UPDATE OR DELETE ON "Trainer2Identity" FOR EACH ROW EXECUTE FUNCTION trainer2_immutable();
CREATE TRIGGER trainer2_action_immutable BEFORE UPDATE OR DELETE ON "Trainer2DurableAction" FOR EACH ROW EXECUTE FUNCTION trainer2_immutable();
CREATE TRIGGER trainer2_outcome_immutable BEFORE UPDATE OR DELETE ON "Trainer2ActionOutcome" FOR EACH ROW EXECUTE FUNCTION trainer2_immutable();

CREATE FUNCTION trainer2_account_counters() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."accountId"<>OLD."accountId" OR NEW."ownershipEpoch"<OLD."ownershipEpoch" OR
 NEW."acceptedSequence"<OLD."acceptedSequence" OR NEW."outcomeSequence"<OLD."outcomeSequence"
 THEN RAISE EXCEPTION 'TRAINER2_COUNTER_REGRESSION'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trainer2_account_counters BEFORE UPDATE ON "Trainer2AccountTrainingState" FOR EACH ROW EXECUTE FUNCTION trainer2_account_counters();

-- Every outcome transition locks the same account before allocating its cursor.
-- A later writer cannot commit past an earlier uncommitted cursor in this account.
CREATE FUNCTION trainer2_outcome_cursor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "Trainer2AccountTrainingState" SET "outcomeSequence"="outcomeSequence"+1 WHERE "accountId"=NEW."accountId"
 RETURNING "outcomeSequence" INTO NEW."outcomeCursor";
 IF NOT FOUND THEN RAISE EXCEPTION 'TRAINER2_ACCOUNT_MISSING'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trainer2_outcome_cursor BEFORE INSERT ON "Trainer2ActionOutcome" FOR EACH ROW EXECUTE FUNCTION trainer2_outcome_cursor();

CREATE FUNCTION trainer2_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'TRAINER2_TOMBSTONE_REQUIRED'; END IF;
 IF (OLD."id",OLD."accountId") IS DISTINCT FROM (NEW."id",NEW."accountId") OR
   (OLD."tombstonedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'TRAINER2_PLAN_IMMUTABLE_IDENTITY'; END IF;
 IF NEW."currentRevisionId"<>OLD."currentRevisionId" AND NOT EXISTS (
   SELECT 1 FROM "Trainer2PlanRevision" r WHERE r."id"=NEW."currentRevisionId" AND r."parentRevisionId"=OLD."currentRevisionId"
   AND r."createdTx"=txid_current()) THEN RAISE EXCEPTION 'TRAINER2_HEAD_NOT_SUCCESSOR'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trainer2_plan_guard BEFORE UPDATE OR DELETE ON "Trainer2Plan" FOR EACH ROW EXECUTE FUNCTION trainer2_plan_guard();

-- Return document identities with structural parents; order never supplies identity.
CREATE FUNCTION trainer2_document_ids(d jsonb) RETURNS TABLE(id uuid,kind text,parent uuid) LANGUAGE sql IMMUTABLE AS $$
 SELECT (s->>'id')::uuid,'Stage',NULL::uuid FROM jsonb_array_elements(d->'stages') s
 UNION ALL SELECT (o->>'id')::uuid,'Occurrence',NULL::uuid FROM jsonb_array_elements(d->'occurrences') o
 UNION ALL SELECT (p->>'id')::uuid,'Position',(o->>'id')::uuid FROM jsonb_array_elements(d->'occurrences') o, jsonb_array_elements(o->'positions') p
 UNION ALL SELECT (t->>'id')::uuid,'Target',(p->>'id')::uuid FROM jsonb_array_elements(d->'occurrences') o, jsonb_array_elements(o->'positions') p, jsonb_array_elements(p->'targets') t
$$;
CREATE FUNCTION trainer2_seal_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Trainer2Plan" p WHERE p."id"=NEW."planId" AND p."accountId"=NEW."accountId"
   AND p."currentRevisionId"=NEW."id" AND p."tombstonedAt" IS NULL)
 THEN RAISE EXCEPTION 'TRAINER2_REVISION_NOT_LIVE_HEAD'; END IF;
 IF NEW."createdTx"<>txid_current() OR NEW."document"->>'schemaVersion' IS DISTINCT FROM '1' OR
   jsonb_typeof(NEW."document"->'stages') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW."document"->'occurrences') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'TRAINER2_DOCUMENT_INVALID'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW."document"->'occurrences') o WHERE jsonb_typeof(o->'positions') IS DISTINCT FROM 'array') OR
 EXISTS (SELECT 1 FROM jsonb_array_elements(NEW."document"->'occurrences') o, jsonb_array_elements(o->'positions') p WHERE jsonb_typeof(p->'targets') IS DISTINCT FROM 'array')
 THEN RAISE EXCEPTION 'TRAINER2_DOCUMENT_INVALID'; END IF;
 IF EXISTS (SELECT id FROM trainer2_document_ids(NEW."document") GROUP BY id HAVING count(*)>1) OR
 EXISTS (SELECT 1 FROM trainer2_document_ids(NEW."document") d LEFT JOIN "Trainer2Identity" i
 ON i."id"=d.id AND i."accountId"=NEW."accountId" AND i."planId"=NEW."planId" AND i."kind"=d.kind AND i."parentId" IS NOT DISTINCT FROM d.parent
 WHERE i."id" IS NULL) OR
 EXISTS (SELECT 1 FROM jsonb_array_elements(NEW."document"->'occurrences') o WHERE NOT EXISTS
 (SELECT 1 FROM jsonb_array_elements(NEW."document"->'stages') s WHERE s->>'id'=o->>'stageId'))
 THEN RAISE EXCEPTION 'TRAINER2_DOCUMENT_REFERENCES'; END IF;
 IF NEW."parentRevisionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Trainer2PlanRevision" p
 WHERE p."id"=NEW."parentRevisionId" AND p."revisionNumber"=NEW."revisionNumber"-1)
 THEN RAISE EXCEPTION 'TRAINER2_REVISION_CHAIN'; END IF;
 -- Existing identities must have continued from the parent, never be reintroduced.
 IF EXISTS (SELECT 1 FROM trainer2_document_ids(NEW."document") d JOIN "Trainer2Identity" i ON i."id"=d.id
 WHERE i."firstRevisionId"<>NEW."id" AND NOT EXISTS (SELECT 1 FROM "Trainer2PlanRevision" p,
 LATERAL trainer2_document_ids(p."document") prior_identity WHERE p."id"=NEW."parentRevisionId" AND prior_identity.id=d.id))
 THEN RAISE EXCEPTION 'TRAINER2_IDENTITY_REINTRODUCED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "Trainer2ActionOutcome" a WHERE a."accountId"=NEW."accountId" AND a."actionId"=NEW."actionId"
 AND a."status"='Accepted' AND a."outcome"->'result'->>'revisionId'=NEW."id"::text
 AND a."outcome"->'result'->>'planId'=NEW."planId"::text)
 THEN RAISE EXCEPTION 'TRAINER2_REVISION_WITHOUT_ACCEPTANCE'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trainer2_revision_seal AFTER INSERT ON "Trainer2PlanRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_seal_revision();
CREATE FUNCTION trainer2_seal_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "Trainer2PlanRevision" r, LATERAL trainer2_document_ids(r."document") d
 WHERE r."id"=NEW."firstRevisionId" AND r."createdTx"=txid_current() AND d.id=NEW."id" AND d.kind=NEW."kind" AND d.parent IS NOT DISTINCT FROM NEW."parentId")
 THEN RAISE EXCEPTION 'TRAINER2_LATE_OR_UNREFERENCED_IDENTITY'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trainer2_identity_seal AFTER INSERT ON "Trainer2Identity" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trainer2_seal_identity();

REVOKE ALL ON "Trainer2AccountPrincipal", "Trainer2AccountTrainingState", "Trainer2Plan", "Trainer2PlanRevision", "Trainer2Identity", "Trainer2DurableAction", "Trainer2ActionOutcome" FROM PUBLIC;
ALTER TABLE "Trainer2AccountPrincipal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trainer2AccountTrainingState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trainer2Plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trainer2PlanRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trainer2Identity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trainer2DurableAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trainer2ActionOutcome" ENABLE ROW LEVEL SECURITY;
-- Runtime roles/policies are provisioned only by the disposable harness here.
-- Real environment grants and authentication require separately authorized work.
