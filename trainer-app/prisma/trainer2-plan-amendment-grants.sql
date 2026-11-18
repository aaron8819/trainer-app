-- Apply once after 20261118010000; no historical rows or existing privileges change.
GRANT SELECT ON "Trainer2PlanExerciseAmendment" TO trainer2_draft_reader,trainer2_draft_runtime;
GRANT INSERT ON "Trainer2PlanExerciseAmendment" TO trainer2_draft_runtime;
CREATE POLICY trainer2_amendment_reader ON "Trainer2PlanExerciseAmendment" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_amendment_runtime ON "Trainer2PlanExerciseAmendment" FOR ALL TO trainer2_draft_runtime USING (true) WITH CHECK (true);
GRANT EXECUTE ON FUNCTION trainer2_amendment_binding(text,uuid),trainer2_amended_occurrence(text,uuid,jsonb) TO trainer2_draft_reader,trainer2_draft_runtime;
