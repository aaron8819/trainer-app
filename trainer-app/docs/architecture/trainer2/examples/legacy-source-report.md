# Legacy source reference dry-run

Source: "trainer-legacy-synthetic-v1" / account "legacy-owner-A"

Scope: complete-within-declared-families; hash 86866d6cbf385ed8d210f395db0381ab4330d8cdb966ec6548fdbf8f3498ee56

17 distinct records; 3 sessions; 5 stored set logs; 17 distinct records with 72 discrepancies.

DeviceDraft: 1 records; 1 affected; 2 discrepancies.

FinisherExecution: 1 records; 1 affected; 2 discrepancies.

FinisherExecutionStep: 1 records; 1 affected; 1 discrepancies.

PostSessionReviewSnapshot: 1 records; 1 affected; 1 discrepancies.

SetLog: 5 records; 5 affected; 42 discrepancies.

Workout: 3 records; 3 affected; 9 discrepancies.

WorkoutExercise: 2 records; 2 affected; 10 discrepancies.

WorkoutSet: 3 records; 3 affected; 5 discrepancies.

DeviceDraft "draft_set_session-known_target-known" | unconfirmed-draft | not-applicable
Raw stored fields: {"load":"40.00","reps":"10","rpe":"8","savedAt":"1770000000000","workoutId":"session-known","workoutSetId":"target-known"}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: DRAFT_OR_PREFILL_NOT_PERFORMANCE, PERFORMED_TIME_UNKNOWN

FinisherExecution "timer-known" | unsupported-timed-reference | not-applicable
Raw stored fields: {"completedAt":"2026-01-03 11:00:00","offerId":"offer-uninspected","ownerId":"legacy-owner-A","state":"COMPLETED","workoutId":"session-known"}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: TIMED_FINISHER_REFERENCE_ONLY, UNAVAILABLE_RELATION:offerId:FinisherOffer

FinisherExecutionStep "timer-step-known" | unsupported-timed-reference | not-applicable
Raw stored fields: {"actualWorkMs":"90000","executionId":"timer-known","resolvedAt":"2026-01-03 11:00:00","routineStepId":"routine-step-uninspected","status":"COMPLETED"}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: TIMED_FINISHER_REFERENCE_ONLY

PostSessionReviewSnapshot "review-known" | source-context | not-applicable
Raw stored fields: {"contractVersion":"1","createdAt":"2026-01-04 11:00:00","payload":"{\"prescription\":{\"sets\":2}}","provenance":"BACKFILLED","workoutId":"session-known"}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: PRESCRIPTION_NOT_VERIFIED_START

SetLog "log-known" | source-asserted-performance | not-applicable
Raw stored fields: {"actualLoad":"40.00","actualReps":"10","actualRpe":"8.5","completedAt":"2026-01-03 11:00:00","wasSkipped":"false","workoutSetId":"target-known"}
unit=kg (external-source-assertion); convention=BARBELL_TOTAL (external-source-assertion); repBasis=TOTAL (external-source-assertion); equipment=synthetic-bar-A (external-source-assertion); zeroMeaning=unknown (unknown); performed date=2026-01-01; performed instant=unknown
Unresolved: LATEST_VALUES_WITHOUT_CORRECTION_CHAIN, RPE_ORIGIN_NOT_RIR, ZEROMEANING_UNKNOWN

SetLog "log-missing" | recorded-log-unconfirmed | not-applicable
Raw stored fields: {"wasSkipped":"false","workoutSetId":"orphan-target"}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: CONVENTION_UNKNOWN, EQUIPMENT_UNKNOWN, LATEST_VALUES_WITHOUT_CORRECTION_CHAIN, PERFORMANCE_ORIGIN_UNCONFIRMED, PERFORMED_TIME_UNKNOWN, REPBASIS_UNKNOWN, RPE_ORIGIN_NOT_RIR, UNAVAILABLE_RELATION:workoutSetId:WorkoutSet, UNIT_UNKNOWN, ZEROMEANING_UNKNOWN

SetLog "log-null" | recorded-log-unconfirmed | not-applicable
Raw stored fields: {"actualLoad":null,"actualReps":null,"actualRpe":null,"wasSkipped":"false","workoutSetId":"orphan-target"}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: CONVENTION_UNKNOWN, EQUIPMENT_UNKNOWN, LATEST_VALUES_WITHOUT_CORRECTION_CHAIN, PERFORMANCE_ORIGIN_UNCONFIRMED, PERFORMED_TIME_UNKNOWN, REPBASIS_UNKNOWN, RPE_ORIGIN_NOT_RIR, UNAVAILABLE_RELATION:workoutSetId:WorkoutSet, UNIT_UNKNOWN, ZEROMEANING_UNKNOWN

SetLog "log-skipped" | skipped-log | not-applicable
Raw stored fields: {"actualLoad":"0","actualReps":"0","wasSkipped":"true","workoutSetId":"target-ambiguous"}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: CONVENTION_UNKNOWN, EQUIPMENT_UNKNOWN, LATEST_VALUES_WITHOUT_CORRECTION_CHAIN, PERFORMED_TIME_UNKNOWN, REPBASIS_UNKNOWN, RPE_ORIGIN_NOT_RIR, UNIT_UNKNOWN, ZEROMEANING_UNKNOWN, ZERO_REQUIRES_PROVENANCE

SetLog "log-zero" | recorded-log-unconfirmed | not-applicable
Raw stored fields: {"actualLoad":"0","actualReps":"8","actualRpe":null,"completedAt":"2026-01-03 11:00:00","wasSkipped":"false","workoutSetId":"target-zero"}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: CONVENTION_UNKNOWN, EQUIPMENT_UNKNOWN, LATEST_VALUES_WITHOUT_CORRECTION_CHAIN, PERFORMANCE_ORIGIN_UNCONFIRMED, PERFORMED_TIME_UNKNOWN, REPBASIS_UNKNOWN, RPE_ORIGIN_NOT_RIR, UNIT_UNKNOWN, ZEROMEANING_UNKNOWN, ZERO_REQUIRES_PROVENANCE

Workout "session-known" | session-reference | source-completed
Raw stored fields: {"completedAt":"2026-01-03 11:00:00","id":"session-known","scheduledDate":"2026-01-01 09:00:00","seedRevisionId":"missing-seed","status":"COMPLETED","userId":"legacy-owner-A"}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: PERFORMED_TIME_UNKNOWN, PRESCRIPTION_NOT_VERIFIED_START, UNAVAILABLE_RELATION:seedRevisionId:MesocycleSeedRevision

Workout "session-lookalike-1" | session-reference | unresolved
Raw stored fields: {"completedAt":null,"scheduledDate":"2026-01-01 09:00:00","status":"PARTIAL"}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: PERFORMED_TIME_UNKNOWN, PRESCRIPTION_NOT_VERIFIED_START, SESSION_FINALITY_UNRESOLVED

Workout "session-lookalike-2" | session-reference | unresolved
Raw stored fields: {"completedAt":null,"scheduledDate":"2026-01-01 09:00:00","status":"PARTIAL"}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: PERFORMED_TIME_UNKNOWN, PRESCRIPTION_NOT_VERIFIED_START, SESSION_FINALITY_UNRESOLVED

WorkoutExercise "position-known" | source-context | not-applicable
Raw stored fields: {"exerciseId":"catalog-uninspected","loadConvention":"BARBELL_TOTAL","measurementProfile":"REPS_EXTERNAL_LOAD","orderIndex":"0","repBasis":"TOTAL","workoutId":"session-known","zeroLoadMeaning":null}
unit=unknown (unknown); convention=BARBELL_TOTAL (stored-reference); repBasis=TOTAL (stored-reference); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: EQUIPMENT_UNKNOWN, UNAVAILABLE_RELATION:exerciseId:Exercise, UNIT_UNKNOWN, ZEROMEANING_UNKNOWN

WorkoutExercise "position-unknown" | source-context | not-applicable
Raw stored fields: {"exerciseId":"catalog-uninspected","loadConvention":null,"measurementProfile":null,"orderIndex":"0","repBasis":null,"workoutId":"session-lookalike-1","zeroLoadMeaning":null}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: CONVENTION_UNKNOWN, EQUIPMENT_UNKNOWN, REPBASIS_UNKNOWN, UNAVAILABLE_RELATION:exerciseId:Exercise, UNIT_UNKNOWN, ZEROMEANING_UNKNOWN

WorkoutSet "target-ambiguous" | prescription-reference | not-applicable
Raw stored fields: {"setIndex":"0","targetLoad":"40.00","targetReps":"10","workoutExerciseId":"position-known"}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: AMBIGUOUS_POSITION_LINEAGE, PRESCRIPTION_NOT_VERIFIED_START

WorkoutSet "target-known" | prescription-reference | not-applicable
Raw stored fields: {"setIndex":"0","targetLoad":"40.00","targetReps":"10","targetRpe":"8","workoutExerciseId":"position-known"}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: AMBIGUOUS_POSITION_LINEAGE, PRESCRIPTION_NOT_VERIFIED_START

WorkoutSet "target-zero" | prescription-reference | not-applicable
Raw stored fields: {"setIndex":"0","targetLoad":"0","targetReps":"8","workoutExerciseId":"position-unknown"}
unit=unknown (unknown); convention=unknown (unknown); repBasis=unknown (unknown); equipment=unknown (unknown); zeroMeaning=unknown (unknown); performed date=unknown; performed instant=unknown
Unresolved: PRESCRIPTION_NOT_VERIFIED_START

All rows excluded from quantitative qualification and import acceptance in this slice.

Targets and device drafts excluded from performed facts.

Timed/finisher evidence retained as unsupported reference.

Synthetic reference dry-run only; no imports, acceptance, reconciliation, or production verification.

Repository schema and synthetic rows do not establish deployed schema, counts, grants, writer eras, devices, backups, or completeness.

Direct PostgreSQL column text preserves surviving stored values (including SQL NULL versus JSON null), not original user entry spelling, pre-rounding float values, JSONB whitespace, or overwritten/deleted history.

Complete means owner-reachable rows in declared families only. Ownerless orphan rows cannot be attributed or exported. Unavailable references may be absent, foreign, or outside scope; no foreign lookup is performed.

Device storage, backup histories, provider data, muscle/scoring metadata, finisher routine definitions/decisions/library, and mesocycle exercise roles are not database capture families in v1.

Connected source component (including catalog links) is the conservative revision dependency basis; related changes may revise multiple references. No content-based record deduplication.

All references remain quantitatively unqualified. External assertions are preserved claims, not independently verified historical truth.
