-- Apply once after 20261004020000. Fresh installations use the full grants file.
GRANT SELECT ON "Trainer2WeekAdvance" TO trainer2_draft_reader,trainer2_draft_runtime;
GRANT INSERT ON "Trainer2WeekAdvance" TO trainer2_draft_runtime;
CREATE POLICY trainer2_week_reader ON "Trainer2WeekAdvance" FOR SELECT TO trainer2_draft_reader USING (true);
CREATE POLICY trainer2_week_runtime ON "Trainer2WeekAdvance" TO trainer2_draft_runtime USING (true) WITH CHECK (true);
GRANT EXECUTE ON FUNCTION trainer2_authored_weeks(jsonb) TO trainer2_draft_runtime;
