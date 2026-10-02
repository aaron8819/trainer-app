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

GRANT SELECT ON "Trainer2ExerciseSwap" TO trainer2_draft_reader, trainer2_draft_runtime;
GRANT INSERT ON "Trainer2ExerciseSwap" TO trainer2_draft_runtime;
CREATE POLICY trainer2_read ON "Trainer2ExerciseSwap" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_write ON "Trainer2ExerciseSwap" TO trainer2_draft_runtime USING (true) WITH CHECK (true);
GRANT EXECUTE ON FUNCTION trainer2_assignment(uuid,uuid),trainer2_assignments(uuid) TO trainer2_draft_reader,trainer2_draft_runtime;
-- Incremental Add set grants; apply only after its forward migration.
-- Supabase default privileges also grant named API roles; RLS cannot protect
-- against service_role's BYPASSRLS. Revoke object ACLs before admitting servers.
REVOKE ALL ON TABLE "Trainer2SetAddition" FROM PUBLIC;
REVOKE ALL ON FUNCTION trainer2_execution_positions(uuid),trainer2_effective_targets(uuid,uuid),trainer2_restored_addition_target(uuid,uuid),trainer2_addition_guard(),trainer2_addition_seal() FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public."Trainer2SetAddition" FROM %I', api_role);
    EXECUTE format('REVOKE ALL ON FUNCTION public.trainer2_execution_positions(uuid),public.trainer2_effective_targets(uuid,uuid),public.trainer2_restored_addition_target(uuid,uuid),public.trainer2_addition_guard(),public.trainer2_addition_seal() FROM %I', api_role);
  END LOOP;
END $$;
GRANT SELECT ON "Trainer2SetAddition" TO trainer2_draft_reader, trainer2_draft_runtime;
GRANT INSERT ON "Trainer2SetAddition" TO trainer2_draft_runtime;
CREATE POLICY trainer2_addition_reader ON "Trainer2SetAddition" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_addition_runtime ON "Trainer2SetAddition" FOR ALL TO trainer2_draft_runtime USING (true) WITH CHECK (true);
GRANT EXECUTE ON FUNCTION trainer2_execution_positions(uuid),trainer2_effective_targets(uuid,uuid),trainer2_restored_addition_target(uuid,uuid) TO trainer2_draft_reader,trainer2_draft_runtime;

-- Incremental Add exercise grants (after 20261002010000).
REVOKE ALL ON TABLE "Trainer2ExerciseAddition" FROM PUBLIC;
REVOKE ALL ON FUNCTION trainer2_original_positions(uuid),trainer2_base_positions(uuid),trainer2_exercise_addition_guard(),trainer2_exercise_addition_seal() FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
 EXECUTE format('REVOKE ALL ON TABLE "Trainer2ExerciseAddition" FROM %I',api_role);
 EXECUTE format('REVOKE ALL ON FUNCTION trainer2_original_positions(uuid),trainer2_base_positions(uuid),trainer2_exercise_addition_guard(),trainer2_exercise_addition_seal() FROM %I',api_role);
 END IF; END LOOP;
END $$;
GRANT SELECT ON "Trainer2ExerciseAddition" TO trainer2_draft_reader,trainer2_draft_runtime;
GRANT INSERT ON "Trainer2ExerciseAddition" TO trainer2_draft_runtime;
CREATE POLICY trainer2_exercise_addition_reader ON "Trainer2ExerciseAddition" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_exercise_addition_runtime ON "Trainer2ExerciseAddition" FOR ALL TO trainer2_draft_runtime USING (true) WITH CHECK (true);
GRANT EXECUTE ON FUNCTION trainer2_original_positions(uuid),trainer2_base_positions(uuid) TO trainer2_draft_reader,trainer2_draft_runtime;
