-- Administrative preparation, NOT an automatic migration. Fresh dedicated roles only.
-- Execute in one transaction after the accepted migration chain. No passwords here.
-- Hosted application of this file requires named environment/action authorization.
-- Supabase grants new public objects to named API roles by default. Remove only
-- grants on Trainer2 objects; leave V1 and provider objects untouched.
DO $$
DECLARE object record;
DECLARE api_role text;
BEGIN
  FOR object IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND left(p.proname, 9) = 'trainer2_' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', object.signature);
  END LOOP;
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    FOR object IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname LIKE 'Trainer2%' AND c.relkind IN ('r', 'p', 'S') LOOP
      EXECUTE format('REVOKE ALL ON %s public.%I FROM %I',
        CASE WHEN object.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, object.relname, api_role);
    END LOOP;
    FOR object IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND left(p.proname, 9) = 'trainer2_' LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', object.signature, api_role);
    END LOOP;
  END LOOP;
END $$;
CREATE ROLE trainer2_identity_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE trainer2_draft_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE trainer2_draft_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO trainer2_identity_runtime, trainer2_draft_reader, trainer2_draft_runtime;
-- Historical issuer/subject rows receive no runtime or administration grant.
GRANT SELECT ON "Trainer2Owner", "Trainer2DeviceSession" TO trainer2_identity_runtime;
GRANT SELECT ("id", "accountId", "sessionEpoch") ON "Trainer2Owner" TO trainer2_draft_reader, trainer2_draft_runtime;
GRANT SELECT ("id", "ownerId", "epoch", "revokedAt", "expiresAt", "absoluteExpiresAt") ON "Trainer2DeviceSession" TO trainer2_draft_reader, trainer2_draft_runtime;
GRANT UPDATE ("passcodeVerifier", "setupVerifier", "failedAttempts", "lockedUntil", "sessionEpoch") ON "Trainer2Owner" TO trainer2_identity_runtime;
GRANT UPDATE ("expiresAt", "renewedAt", "revokedAt") ON "Trainer2DeviceSession" TO trainer2_identity_runtime;
GRANT INSERT ON "Trainer2DeviceSession" TO trainer2_identity_runtime;
CREATE POLICY trainer2_owner_identity ON "Trainer2Owner" TO trainer2_identity_runtime USING (true) WITH CHECK (true);
CREATE POLICY trainer2_session_identity ON "Trainer2DeviceSession" TO trainer2_identity_runtime USING (true) WITH CHECK (true);
CREATE POLICY trainer2_owner_training_read ON "Trainer2Owner" FOR SELECT TO trainer2_draft_reader, trainer2_draft_runtime USING (true);
CREATE POLICY trainer2_session_training_read ON "Trainer2DeviceSession" FOR SELECT TO trainer2_draft_reader, trainer2_draft_runtime USING (true);
GRANT SELECT ON "Trainer2AccountTrainingState", "Trainer2Plan", "Trainer2PlanRevision", "Trainer2Identity", "Trainer2DurableAction", "Trainer2ActionOutcome" TO trainer2_draft_reader, trainer2_draft_runtime;
GRANT EXECUTE ON FUNCTION trainer2_check_acceptance(text), trainer2_document_ids(jsonb) TO trainer2_draft_runtime;
GRANT INSERT ON "Trainer2AccountTrainingState", "Trainer2Plan", "Trainer2PlanRevision", "Trainer2Identity", "Trainer2DurableAction", "Trainer2ActionOutcome" TO trainer2_draft_runtime;
GRANT UPDATE ON "Trainer2AccountTrainingState", "Trainer2Plan" TO trainer2_draft_runtime;
CREATE POLICY trainer2_read ON "Trainer2AccountTrainingState" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_read ON "Trainer2Plan" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_read ON "Trainer2PlanRevision" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_read ON "Trainer2Identity" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_read ON "Trainer2DurableAction" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_read ON "Trainer2ActionOutcome" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_write ON "Trainer2AccountTrainingState" TO trainer2_draft_runtime USING (true) WITH CHECK (true);
CREATE POLICY trainer2_write ON "Trainer2Plan" TO trainer2_draft_runtime USING (true) WITH CHECK (true);
CREATE POLICY trainer2_write ON "Trainer2PlanRevision" TO trainer2_draft_runtime USING (true) WITH CHECK (true);
CREATE POLICY trainer2_write ON "Trainer2Identity" TO trainer2_draft_runtime USING (true) WITH CHECK (true);
CREATE POLICY trainer2_write ON "Trainer2DurableAction" TO trainer2_draft_runtime USING (true) WITH CHECK (true);
CREATE POLICY trainer2_write ON "Trainer2ActionOutcome" TO trainer2_draft_runtime USING (true) WITH CHECK (true);
-- RLS admits these server roles to all accounts. Application predicates enforce account scope.
-- No browser roles, legacy grants, memberships, database/schema ownership, or SECURITY DEFINER functions are added.
-- Additional local activation owners; same restricted server/account boundary.
GRANT SELECT ON "Trainer2InstructionRevision", "Trainer2PlanDecision" TO trainer2_draft_reader, trainer2_draft_runtime;
GRANT INSERT ON "Trainer2InstructionRevision", "Trainer2PlanDecision" TO trainer2_draft_runtime;
CREATE POLICY trainer2_read ON "Trainer2InstructionRevision" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_read ON "Trainer2PlanDecision" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_write ON "Trainer2InstructionRevision" TO trainer2_draft_runtime USING (true) WITH CHECK (true);
CREATE POLICY trainer2_write ON "Trainer2PlanDecision" TO trainer2_draft_runtime USING (true) WITH CHECK (true);
GRANT SELECT ON "Trainer2Execution" TO trainer2_draft_reader, trainer2_draft_runtime;
GRANT INSERT ON "Trainer2Execution" TO trainer2_draft_runtime;
CREATE POLICY trainer2_read ON "Trainer2Execution" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_write ON "Trainer2Execution" TO trainer2_draft_runtime USING (true) WITH CHECK (true);

GRANT SELECT ON "Trainer2SetResultRevision" TO trainer2_draft_reader, trainer2_draft_runtime;
GRANT INSERT ON "Trainer2SetResultRevision" TO trainer2_draft_runtime;
CREATE POLICY trainer2_read ON "Trainer2SetResultRevision" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_write ON "Trainer2SetResultRevision" TO trainer2_draft_runtime USING (true) WITH CHECK (true);

GRANT SELECT ON "Trainer2ExecutionFinish" TO trainer2_draft_reader, trainer2_draft_runtime;
GRANT INSERT ON "Trainer2ExecutionFinish" TO trainer2_draft_runtime;
GRANT UPDATE ("lifecycle") ON "Trainer2Execution" TO trainer2_draft_runtime;
CREATE POLICY trainer2_read ON "Trainer2ExecutionFinish" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_write ON "Trainer2ExecutionFinish" TO trainer2_draft_runtime USING (true) WITH CHECK (true);

GRANT SELECT ON "Trainer2ExecutionDiscard" TO trainer2_draft_reader, trainer2_draft_runtime;
GRANT INSERT ON "Trainer2ExecutionDiscard" TO trainer2_draft_runtime;
CREATE POLICY trainer2_read ON "Trainer2ExecutionDiscard" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_write ON "Trainer2ExecutionDiscard" TO trainer2_draft_runtime USING (true) WITH CHECK (true);

GRANT SELECT ON "Trainer2OccurrenceSkip" TO trainer2_draft_reader, trainer2_draft_runtime;
GRANT INSERT ON "Trainer2OccurrenceSkip" TO trainer2_draft_runtime;
CREATE POLICY trainer2_read ON "Trainer2OccurrenceSkip" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_write ON "Trainer2OccurrenceSkip" TO trainer2_draft_runtime USING (true) WITH CHECK (true);
GRANT EXECUTE ON FUNCTION trainer2_occurrence_resolved(text,uuid,text) TO trainer2_draft_runtime;

GRANT SELECT ON "Trainer2SetSkip" TO trainer2_draft_reader, trainer2_draft_runtime;
GRANT INSERT ON "Trainer2SetSkip" TO trainer2_draft_runtime;
CREATE POLICY trainer2_read ON "Trainer2SetSkip" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_write ON "Trainer2SetSkip" TO trainer2_draft_runtime USING (true) WITH CHECK (true);
