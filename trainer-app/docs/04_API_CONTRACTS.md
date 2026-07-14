# 04 API Contracts

Owner: Aaron  
Last reviewed: 2026-03-19
Purpose: Canonical API contract map for App Router endpoints and payload validation boundaries.

This doc covers:
- Current API route surface
- Validation contract source files
- Runtime enum contract source and verification

Invariants:
- Validation schemas in `src/lib/validation.ts` are canonical for request payloads.
- Validation-backed workout enum contract values are canonical in `docs/contracts/runtime-contracts.json` and verified by script.
- API docs should reference schemas and route files, not duplicate large inline contracts.

Sources of truth:
- `trainer-app/src/app/api`
- `trainer-app/src/lib/validation.ts`
- `trainer-app/docs/contracts/runtime-contracts.json`
- `trainer-app/scripts/check-doc-runtime-contracts.ts`

## Canonical runtime contracts
- File: `docs/contracts/runtime-contracts.json`
- Verification command: `npm run verify:contracts`

## Seeded workout provenance contract

- Seeded generation returns `selectionMetadata.sessionDecisionReceipt.sessionProvenance.seedProvenance = { revisionId, revision, hash }` from the immutable revision it actually consumed.
- `POST /api/workouts/save` does not trust caller provenance as authority. `src/lib/api/save-workout/seed-provenance.ts` verifies the tuple against `MesocycleSeedRevision`, persists it on new workouts, rejects mismatches, and preserves the existing tuple on resume/update.
- New seeded workouts fail closed when exact revision provenance is unavailable. Existing legacy workouts with null provenance remain readable and resumable without backfilled guesses.
- Runtime enum sources:
  - `WORKOUT_STATUS_VALUES` in `src/lib/validation.ts`
  - `WORKOUT_SELECTION_MODE_VALUES` in `src/lib/validation.ts`
  - `WORKOUT_SESSION_INTENT_DB_VALUES` in `src/lib/validation.ts`
  - `WORKOUT_EXERCISE_SECTION_VALUES` in `src/lib/validation.ts`
  - Matching Prisma enums in `prisma/schema.prisma`

## API route groups
- Workouts: `src/app/api/workouts/**` (generate-from-intent, generate-from-template, save, `GET /api/workouts/history`, `POST /api/workouts/[id]/dismiss-closeout`)
- Logging: `src/app/api/logs/set/route.ts`
- Logging support reads: `GET /api/workouts/[id]/logging-weekly-volume-check` (`src/app/api/workouts/[id]/logging-weekly-volume-check/route.ts`)
- Mesocycles: `GET /api/mesocycles` (`src/app/api/mesocycles/route.ts`) plus handoff endpoints `POST /api/mesocycles/[id]/finish-deload`, `PATCH /api/mesocycles/[id]/draft`, `POST /api/mesocycles/[id]/refresh-next-seed-draft`, and `POST /api/mesocycles/[id]/accept-next-cycle`
- Week-close workflow: `POST /api/mesocycles/week-close/[id]/dismiss` and `POST|GET /api/mesocycles/week-close/[id]/closeout`
- Program/periodization/readiness: `src/app/api/program/route.ts`, `src/app/api/periodization/macro/route.ts`, `src/app/api/readiness/submit/route.ts`, `src/app/api/pre-session-readiness/prepare/route.ts`, `src/app/api/stalls/route.ts`
- Templates: `src/app/api/templates/**`
- Exercises and preferences: `src/app/api/exercises/**`, `src/app/api/preferences/route.ts`
  - `GET /api/exercises/search?q=<query>&limit=<n>` is the bounded typed-search route for discovery surfaces such as Add Exercise. Ranking is server-owned in `src/lib/api/exercise-library.ts` and may combine name, alias, muscle, muscle-group, and equipment signals; it is intentionally separate from full-library hydration reads.
- Analytics: `src/app/api/analytics/**`
- Profile/readiness support: `src/app/api/profile/setup/route.ts`, `src/app/api/readiness/submit/route.ts`

## Program dashboard response notes
- Route: `GET /api/program` (`src/app/api/program/route.ts`) returns `loadProgramDashboardData()` output directly.
- `GET /api/program` accepts an optional `?week=N` query parameter (`src/app/api/program/route.ts`). When supplied, `loadProgramDashboardData()` returns the selected dashboard payload for that historical week, including week-specific volume, `rirTarget`, `coachingCue`, and `viewedBlockType`. The live `currentWeek` is always present in the response; the requested week is returned as `viewedWeek`.
- `ProgramDashboardData.viewedWeek` is the effective week whose selected dashboard payload is rendered - equals `currentWeek` by default, overridden by `?week=N`. Clamped to `[1, durationWeeks]`.
- `ProgramDashboardData.viewedBlockType` is the effective block type for `viewedWeek`, used by the shared program card to keep historical block chrome coherent with the selected week.
- `ProgramDashboardData.activeMeso.completedSessions` is now sourced from `accumulationSessionsCompleted` (the canonical lifecycle counter), not the `completedSessions` DB column. Clients should treat this field as the lifecycle-derived session count.
- `ProgramDashboardData` is now the shared dashboard-card contract only. Home-page operational helpers (`nextSession`, `latestIncomplete`, `lastSessionSkipped`) are loaded separately through `loadHomeProgramSupport()` in `src/lib/api/program.ts` and are not part of `GET /api/program`.
- `ProgramDashboardData.deloadReadiness` is always computed from the live `currentWeek` state even when `viewedWeek` is historical. Historical week navigation changes the selected week payload, but the current UI intentionally hides live-only deload advisory chrome while browsing history rather than implying historical deload replay or canonical generator output.
- `ProgramDashboardData.volumeThisWeek` rows now expose canonical weighted weekly actuals as `effectiveSets`, with `directSets` and `indirectSets` retained as contextual/debug fields only (`src/lib/api/program.ts`, `src/components/ProgramStatusCard.tsx`).
- `ProgramDashboardData.volumeThisWeek` rows also expose UI-owned volume display strings as `weightedSetsLabel`, `targetLabel`, `deltaLabel`, optional `landmarkContext` (`mevLabel`, `mavLabel`, `mrvLabel`, `rangeSummaryLabel`, `positionLabel`), `statusLabel`, `statusDescription`, and `badges`. Rows carry compatibility `targetKind`, optional `targetRange`, `displayGroup`, and additive tier fields (`targetTier`, `warningSeverity`, `dashboardGroup`) so clients can render primary drivers, support targets, secondary targets, and implicit rows without reclassifying MEV/MAV/MRV or soft-target ranges locally. Front Delts are implicit and omitted from default rows unless actual volume exists.
- `ProgramDashboardData.volumeThisWeek` rows also expose dashboard-only opportunity fields: `opportunityScore`, `opportunityState`, and `opportunityRationale` (`src/lib/api/program.ts`). These are computed from canonical weekly target pressure plus a recent weighted-stimulus adapter in `src/lib/api/recent-muscle-stimulus.ts`, with optional downward-only modulation from fresh readiness signals via `src/lib/api/readiness.ts`.
- Those opportunity and deload-readiness fields are advisory snapshot outputs for the dashboard card. They are intentionally weaker than canonical next-session generation/explainability semantics and should not be presented as authoritative progression decisions.
- `ProgramDashboardData.coachingCue` and `ProgramDashboardData.deloadReadiness` are descriptive dashboard framing only. Canonical deload policy still lives in `src/lib/deload/semantics.ts` and generator/session receipts.
- Historical `GET /api/program?week=N` responses still carry those opportunity fields, but the current UI only renders `opportunityState` for the live current week because opportunity currently uses present recency/readiness context rather than a historical as-of timestamp.
- `ProgramDashboardData.deloadReadiness` saturation logic now keys off weighted `effectiveSets` rather than primary-only direct sets (`src/lib/api/program.ts`, `src/lib/api/weekly-volume.ts`).
- `GET /api/program` and `PATCH /api/program` now return `409` with `{ error: "Mesocycle handoff pending.", handoff }` while any mesocycle is in `AWAITING_HANDOFF`. Program controls are intentionally blocked until the next cycle is explicitly accepted.
- `POST /api/pre-session-readiness/prepare` is the explicit app-owned pre-session readiness snapshot producer action. It resolves the owner through `resolveOwner()`, delegates to `preparePreSessionReadinessSnapshot()` in `src/lib/api/pre-session-readiness-producer.ts`, may write only `PreSessionReadinessSnapshot`, and returns `{ ok: true, status: "prepared", snapshotId, invalidatedSnapshotCount, replacementPolicy, preSessionReadinessContract, preSessionReadinessCard }` on success. `preSessionReadinessCard` is the display-safe Home DTO and may include an ordered `workoutPreview` derived from the generated session audit snapshot plus structured optional add-on reason/guardrail copy. Prescription-confidence calibration rows may also carry read-only target/load-source/confidence fields, `adjustmentRangeBasis`, and `suggestedAdjustmentRange` copied or derived from generation `prescriptionReadouts`; these fields are coaching metadata only and must not become seed truth, runtime replay input, planner policy, receipt mirrors, or persistence mutation triggers. Home must not parse raw contract prose or audit artifacts to reconstruct those fields. Blocked/no-op cases return `409` with `{ ok: false, status: "blocked", reason, message }`. The route must not create workouts/logs, call the audit CLI, read audit artifacts, mutate seed/runtime replay, or change Home rendering.
- `PreSessionReadinessContract.doseClosure.decisions` is the optional structured compatibility addition for new snapshots. Each row carries the canonical muscle status (`not_needed`, `not_final_opportunity`, `suppressed`, `eligible`, or `no_valid_candidate`), explicit performed/current/later/week/MEV evidence, target-specific later contributing slots and evidence sources, active movement/exercise constraints and candidate filter reasons, and at most one exact recommendation. Only `eligible` decisions may carry a recommendation. Legacy persisted snapshots without `decisions` remain valid; new producers and consumers must prefer the structured rows and must not reconstruct finality, suppression, or candidate policy from prose.

## Analytics response notes
- Shared analytics semantics helpers now live in `src/lib/api/analytics-semantics.ts`. That helper is the canonical source for analytics counting vocabulary (`generated`, `performed`, `completed`) and explicit time-window descriptors (`all_time`, `rolling_days`, `rolling_iso_weeks`, `date_range`).
- `GET /api/analytics/summary` now returns explicit totals for `workoutsGenerated`, `workoutsPerformed`, `workoutsCompleted`, performed set totals, and a `consistency` block (`targetSessionsPerWeek`, `thisWeekPerformed`, `rollingFourWeekAverage`, `currentTrainingStreakWeeks`, `weeksMeetingTarget`, `trackedWeeks`). Workout counts use `scheduledDate` within the selected query range; performed set totals use `setLog.completedAt` within that same query range. The response also returns `semantics` metadata documenting both windows and the generated/performed/completed definitions.
- `GET /api/analytics/templates` now returns template usage rows with `generatedWorkouts`, `performedWorkouts`, `completedWorkouts`, `performedRate`, and `completionRate`, plus `semantics` metadata describing the all-time generated/performed/completed vocabulary.
- `GET /api/analytics/volume` returns `weeklyVolume` and `landmarks` plus `semantics` metadata documenting that:
  - the chart window is rolling ISO weeks by `scheduledDate`
  - only performed workouts (`COMPLETED` + `PARTIAL`) are included
  - only non-skipped logged sets contribute to direct/indirect volume
  - each weekly muscle bucket now also includes canonical weighted `effectiveSets` for analytics views that need lifecycle-aligned volume interpretation
- `GET /api/analytics/muscle-outcomes` returns the active-week `review` model for analytics outcome auditing. Each row includes `muscle`, optional readout-only `targetKind`/`targetRange`, `targetSets`, `actualEffectiveSets`, target-gap `delta`/`percentDelta`, zone-aware `status`, `contributingExerciseCount`, and up to three `topContributors`. Hard-target statuses treat below MEV as the floor issue, above-MEV/below-target as below preferred rather than failure, and MAV/cap rows as caution. Hard targets come from canonical lifecycle volume targeting; soft target ranges are display semantics only. Actuals come from canonical weighted effective stimulus.
- Read-side consumers that expose lifecycle weekly targets (`GET /api/program`, `GET /api/analytics/muscle-outcomes`, week-close deficit snapshots, and explainability volume compliance) now rely on the same `getWeeklyVolumeTarget()` seam as generation. When the mesocycle row includes ordered `TrainingBlock` definitions, those reads are block-aware without requiring a separate API-specific override payload.
- `GET /api/analytics/recovery` now returns `muscles` plus `semantics` metadata documenting that the screen is a rolling 14-day SRA-style stimulus-recency view built from performed workouts only.
- Each recovery row now also carries a 7-day `timeline` of canonical weighted effective stimulus buckets (`date`, `effectiveSets`, `intensityBand`) derived with the shared stimulus engine, not raw direct sets (`src/lib/api/muscle-stimulus-timeline.ts`, `src/lib/engine/stimulus.ts`).
- Dashboard opportunity does not consume `GET /api/analytics/recovery`; analytics stimulus recency remains a separate pattern-review surface and is not the dashboard source of truth.

## Validation-backed contracts (examples)
- Workout generation/save: `generateFromTemplateSchema`, `generateFromIntentSchema`, `saveWorkoutSchema`
- Workout history query: `workoutHistoryQuerySchema` in `src/lib/validation.ts`; consumed by `GET /api/workouts/history`. Supports `intent`, `status` (comma-separated), `mesocycleId`, `from`/`to` date range, and cursor-based pagination (`cursor`, `take`). History items expose the derived workout-list summary contract for badge rendering, including `sessionSnapshot` for week/session/phase chrome and `isDeload` for explicit deload labeling, instead of parallel top-level snapshot fields in the response shape (`src/app/api/workouts/history/route.ts`).
- Logging: `setLogSchema`
- `POST /api/logs/set` accepts optional `setIntent: "WORK" | "WARMUP"` and defaults omitted values to `WORK`. Work-set logs are keyed by `workoutSetId`. Warmup/ramp logs may be submitted with `workoutExerciseId + setIntent="WARMUP"`; the route creates a current-workout-only runtime set and `SetLog` atomically so the UI does not treat warmups as prescribed `WorkoutSet` work. `WARMUP` is explicit user capture for performed reality; it does not infer from load, order, reps, or RPE, and it does not mutate receipts, seed/runtime replay, planner metadata, or prescribed work-set completion.
- `GET /api/workouts/[id]/post-session-review` is a read-only completed-workout review contract for immediate post-save UI. The route resolves identity through `resolveOwner()`, delegates to `loadCompletedWorkoutReviewReadModel(userId, workoutId)`, and returns `{ postSessionReview: PostSessionReviewDisplayDto | null }`. Its performed-reality rows and prescription-calibration summary may include completion-vs-prescription labels plus load/reps/RPE coherence facts derived only from persisted `WorkoutSet` targets and `SetLog` actuals. Runtime-added exercise rows remain session-local evidence, but their own logged sets still supply actual performed set count and median reps/load/RPE for review display. The contract may also include bounded exact-exercise prior-exposure calibration summaries and compact performed-reality trend groups from performed-history-eligible workouts for diagnostic recurrence context. Those facts are learning evidence for review copy and must not become progression policy, prescription policy, seed/runtime truth, receipt mirrors, or persistence triggers. It must not change the explanation endpoint, parse raw post-session contract rows in the client, import audit/CLI/artifact paths, mutate workouts/logs/receipts/seeds, or imply automatic plan changes.
- The completed-review response also includes `reviewEvidence` provenance/version/hash metadata. Exact snapshots are contract-validated and checked against their payload hash and persisted-evidence fingerprint before display. Integrity failure returns an unavailable review and never falls back to current recomputation. A legacy completed workout without a snapshot is read through current policy as `legacy_derived` and is never persisted by GET; resumable `PARTIAL` reviews have no historical-provenance claim.
- `src/lib/api/weekly-retro-calibration-contract.ts` owns the app-side weekly retro calibration contract. It summarizes existing post-session performed-reality rows into repeated under-plan, repeated over-plan, stable/as-planned, missing-actuals, mixed, or no-history display-safe evidence. Row identity is preserved by `workoutId + workoutExerciseId + sourceOrder`, so duplicate same-catalog exercises are not collapsed by `exerciseId`. This contract is read-only evidence only: it does not consume audit weekly-retro artifacts, mutate DB state, alter progression or prescription policy, change seed/runtime replay, change receipts or `selectionMetadata`, feed planner/materializer behavior, or affect acceptance decisions.
- `GET /api/workouts/[id]/logging-weekly-volume-check` is a read-only logging support contract owned by `src/lib/api/logging-weekly-volume-guidance.ts`. It is intentionally narrow:
  - request identity comes from the route param plus `resolveOwner()`
  - response returns `shouldShow`, active week identity when available, and flagged-muscle rows only
  - `summary.status="no_addons_recommended"` is returned when no rows need attention
  - each row carries session-local projection fields: `performedSoFar`, `plannedRemaining`, `projectedFinish`, `MEV`, `MAV`, `status`, `recommendationKind`, `reasonCopy`, and `optionalOrSuppress`
  - row semantics frame below-MEV as floor risk, exact/thin MEV landings as optional low-fatigue floor buffers, above-MEV/below-preferred rows as productive-zone watches with no add-on recommendation, and near/over-MAV rows as suppress-extra guidance
  - empty rows mean the compact card should render the server-provided `No add-ons recommended` summary
  - projection is server-owned and uses the canonical equation `performed baseline excluding current workout + persisted current-workout actuals so far + projected remaining week`
  - current-workout actuals are recomputed from persisted workout structure and logged non-skipped sets, including runtime-added sets and runtime-added exercises
- `GET /api/workouts/[id]/bonus-suggestions` remains a read-only, non-persistent shortlist endpoint for the Add Exercise sheet.
  - request identity comes from the route param plus `resolveOwner()`
  - non-closeout workouts preserve the legacy shortlist owner in `src/lib/api/bonus-suggestions.ts`
  - closeout workouts branch on the canonical `closeout_session` receipt marker and delegate to `src/lib/api/closeout-suggestions.ts`
  - closeout ranking is server-owned and deterministic: projected floor gap is `max(0, MEV - projectedLanding)`, floor gaps under `2.0` are ignored, floor gaps `>= 3.5` sort ahead of lower tiers, and the response is capped to the remaining closeout budget (`4` exercises / `8` sets total, `4` sets per muscle)
  - closeout suggestions stay advisory only; they are not persisted and they reuse the runtime-added accessory preview seam for set/rep framing rather than inventing a second prescription owner
- Mesocycle handoff draft editing: `nextCycleSeedDraftUpdateSchema`
- Dumbbell load contract: clients submit dumbbell `actualLoad` in per-hand units and `POST /api/logs/set` persists the provided per-hand value directly. Client read/write helpers must stay aligned with canonical 2.5 lb quantization in `src/lib/units/load-quantization.ts`; the API contract does not define a separate dumbbell snap whitelist.
- Performed-set signal requirement: `POST /api/logs/set` returns 400 when a non-skipped set log supplies neither `actualReps` nor `actualRpe`. Unresolved sets must remain un-logged (missing) rather than being written as empty performed logs. Warmup/ramp logs follow the same validity rule, remain visible in review/history as performed sets, and are excluded from work-set evidence consumers.
- Bodyweight auto-normalization: when `targetLoad=0` and the set is not skipped, `actualLoad` is written as `0` even when the client omits it (`src/app/api/logs/set/route.ts`).
- Templates: `createTemplateSchema`, `updateTemplateSchema`, `addExerciseToTemplateSchema`
- Profile/readiness/analytics: `profileSetupSchema`, `readinessSignalSchema`, `analyticsSummarySchema`
- `profileSetupSchema` no longer accepts `sessionMinutes`; profile setup persists `daysPerWeek` and optional `splitType` through `POST /api/profile/setup` (`src/lib/validation.ts`, `src/app/api/profile/setup/route.ts`).
- Session-decision request/response ownership follows the canonical flow in `docs/01_ARCHITECTURE.md`: save and generation contracts carry `selectionMetadata.sessionDecisionReceipt`, and validation rejects removed top-level session mirrors / top-level autoregulation inputs (`src/lib/validation.ts`, `src/app/api/workouts/save/route.ts`).
- Mutation reconciliation is part of the persisted workout contract, not a read-side convenience. Structural mutation writers persist `selectionMetadata.workoutStructureState`, and the canonical write-side seam in `src/lib/api/runtime-edit-reconciliation.ts` may also append `selectionMetadata.runtimeEditReconciliation` edit facts for supported runtime mutations.

## Mesocycle handoff route contract
- `POST /api/mesocycles/[id]/finish-deload` (`src/app/api/mesocycles/[id]/finish-deload/route.ts`)
  - state gate: target mesocycle must exist for the owner and be in `ACTIVE_DELOAD`
  - success: `{ ok: true, action: "finish_deload_early", mesocycle, skippedWorkoutIds, skippedWorkoutCount, handoffSummaryCreated, nextSeedDraftCreated }`
  - ownership: route resolves the owner through `resolveOwner()` and delegates lifecycle behavior to `finishDeloadEarly()` in `src/lib/api/mesocycle-lifecycle-state.ts`
  - semantics: this is an explicit user action to end the remaining deload without performing the remaining scheduled deload workouts; it does not create `SetLog` rows, does not create fake completed workouts, does not increment `deloadSessionsCompleted`, does not mutate `slotPlanSeedJson`, and does not change runtime replay
  - incomplete deload workouts: unperformed `PLANNED`/`IN_PROGRESS` workouts in the source mesocycle are marked `SKIPPED` with additive `selectionMetadata.finishDeloadEarly` audit metadata before entering handoff; `PARTIAL` workouts or workouts with performed non-skipped logs are rejected with `409`

- `PATCH /api/program` action `end_early` (`src/app/api/program/route.ts`)
  - purpose: intentionally close the active accumulation mesocycle without fabricating completion, then expose the existing handoff review/accept flow
  - ownership: the route resolves the owner and delegates through `applyCycleAnchor()` to canonical `finishMesocycleEarly()` lifecycle behavior
  - incomplete workouts: untouched `PLANNED`/`IN_PROGRESS` workouts are marked `SKIPPED` with additive `selectionMetadata.finishMesocycleEarly`; canonical `sessionDecisionReceipt` data is preserved
  - conflicts: `PARTIAL` workouts, any incomplete workout with performed non-skipped logs, non-`ACTIVE_ACCUMULATION` state, or existing handoff artifacts return `409`
  - invariants: accumulation/deload counters, accepted seed, runtime replay, performed logs, and successor acceptance behavior are unchanged
  - handoff: success calls the same canonical handoff entry seam as normal deload completion, freezing `handoffSummaryJson` and seeding `nextSeedDraftJson`; successor creation remains reserved for `POST /api/mesocycles/[id]/accept-next-cycle`
- `POST /api/mesocycles/[id]/setup-preview` (`src/app/api/mesocycles/[id]/setup-preview/route.ts`)
  - state gate: target mesocycle must exist for the owner and be in `AWAITING_HANDOFF`
  - request payload: `nextCycleSeedDraftUpdateSchema`
  - success: `{ ok: true, preview }`
  - preview ownership:
    - server sanitizes the ephemeral draft through the same handoff-draft rules used by persistence
    - preview and accept load projection inputs from the same handoff-owned source seam: `loadHandoffSourceMesocycle()` narrowed through `toHandoffProjectionSource()` in `src/lib/api/mesocycle-handoff.ts`
    - server preview composition flows through `loadMesocycleSetupPreviewFromPrisma()` in `src/lib/api/mesocycle-setup.ts`
    - projected slot session plans come from the canonical handoff-owned slot-plan projection seam in `src/lib/api/mesocycle-handoff-slot-plan-projection.ts`
    - `preview.slotPlanProjection` is the narrow canonical projected slot-plan payload; `preview.display.projectedSlotPlans` is display-only decoration for setup UI labels and exercise names
    - route does not persist `nextSeedDraftJson`
  - conflict behavior:
    - `409` when handoff is not pending
    - `409` when `keep` carry-forward selections no longer match any session intent in the edited split/session structure
  - validation behavior:
    - `400` when the draft payload is structurally invalid
- `PATCH /api/mesocycles/[id]/draft` (`src/app/api/mesocycles/[id]/draft/route.ts`)
  - state gate: target mesocycle must exist for the owner and be in `AWAITING_HANDOFF`
  - request payload: `nextCycleSeedDraftUpdateSchema`
  - success: `{ ok: true, handoff }` with the updated pending handoff payload
  - conflict behavior:
    - `409` when handoff is not pending
    - `409` when `keep` carry-forward selections no longer match any session intent in the edited split/session structure
  - validation behavior:
    - `400` when the draft payload is structurally invalid
- `POST /api/mesocycles/[id]/refresh-next-seed-draft` (`src/app/api/mesocycles/[id]/refresh-next-seed-draft/route.ts`)
  - state gate: target mesocycle must exist for the owner and be in `AWAITING_HANDOFF`
  - ownership: route resolves the owner through `resolveOwner()` and delegates the guarded refresh to `refreshMesocycleHandoffNextSeedDraftFromV2()` in `src/lib/api/mesocycle-handoff.ts`
  - semantics: this is an explicit draft rebuild action only. It refreshes `nextSeedDraftJson.acceptedSeedDraft` from a production-eligible V2 materialized seed and does not accept the successor, create a mesocycle, create workouts/logs/sessions, mutate the source seed/runtime truth, or change runtime replay. Supported pending draft transitions are legacy `handoff_slot_plan_projection` to V2 and existing `v2_materialized_seed` to refreshed V2, so planner/materializer fixes can safely replace stale draft candidate truth before acceptance.
  - V2 gates: refresh fails closed unless base-plan validation is `pass` or `pass_with_warnings` with no blockers, the V2 materializer reports `materialized`, promotion readiness is `eligible_for_guarded_write`, required production gates are present, and the serialized seed is parser-compatible minimal `exerciseId`, `role`, `setCount` data aligned to the projected slot sequence.
  - failure behavior: `409` when handoff is not pending, a successor mesocycle already exists, the stored draft is missing/ambiguous/changed outside the refreshable `acceptedSeedDraft`, keep selections conflict, an existing draft source is unsupported, or V2 materialization is not eligible. Failed refresh leaves the existing draft unchanged.
  - provenance: the stored draft source is recorded as `v2_materialized_seed` with compact gate/provenance facts and `runtimeReplayUnchanged=true`; lane ids, materializer diagnostics, and planner debug payloads remain non-executable evidence and are not consumed by runtime.
- `POST /api/mesocycles/[id]/accept-next-cycle` (`src/app/api/mesocycles/[id]/accept-next-cycle/route.ts`)
  - state gate: target mesocycle must exist for the owner, be in `AWAITING_HANDOFF`, and have a readable stored draft; retries after a completed accept may return the already-active successor when the source is already `COMPLETED`
  - success: `{ ok: true, priorMesocycleId, nextMesocycle }`
  - acceptance semantics are prepare-then-transactional: sanitize the stored draft and build deterministic successor projection plus aligned minimal `slotPlanSeedJson` before the Prisma interactive transaction; inside the transaction, re-read/revalidate the source, create or reuse the successor mesocycle, persist `slotSequenceJson`, persist the prepared `slotPlanSeedJson` when materialized slot plans are available and no blocking support-floor failure exists, copy allowed carry-forward roles, update `Constraints`, then mark the source mesocycle `COMPLETED`
  - existing-successor retries are fail-closed against stored V2 candidate truth: when `nextSeedDraftJson.acceptedSeedDraft.source = "v2_materialized_seed"` exists, both `AWAITING_HANDOFF` and `COMPLETED` source retry branches require the successor `slotPlanSeedJson` to exactly match the persisted accepted seed draft before returning the successor.
  - V2 materialized-seed acceptance is disabled by default unless the stored `nextSeedDraftJson` already contains an explicit refreshed `acceptedSeedDraft` from `POST /api/mesocycles/[id]/refresh-next-seed-draft`, or acceptance preparation is explicitly passed `enableV2MaterializedSeedWrite: true`. The API-owned helper in `src/lib/api/mesocycle-handoff-v2-materialized-seed.ts` requires V2 dry-run materialization readiness, promotion readiness status `eligible_for_guarded_write`, complete required-lane coverage, seed-shape compatibility, and all production gates set true. Blocked opt-in fails closed instead of falling back to handoff projection, and ready output still flows through `buildMesocycleSlotPlanSeed()` rather than handcrafting persisted seed JSON. Ready V2-authored seeds pass the serializer source label `v2_materialized_seed`; legacy projection callers keep the serializer default `handoff_slot_plan_projection`.
  - V2 acceptance helper/probe results carry compact `V2MaterializedSeedAcceptanceProvenance`. The source is `v2_disabled`, `v2_blocked_fail_closed`, or `v2_materialized_seed`; provenance records dry-run/readiness versions, mapped production gates, blocker categories only, the seed serializer name, `dbWriteOccurred=false`, and the unchanged runtime replay expectation. It must not embed lane ids, blocker/omission bulk, inventory evidence, dry-run debug payloads, or executable seed previews.
  - Accepted-seed persistence has a separate transaction-level provenance contract, `AcceptedSeedPersistenceProvenance`, owned by the handoff API seam. Its source is `legacy_projection_seed`, `v2_disabled`, `v2_blocked_fail_closed`, or `v2_materialized_seed`; it records whether the seed source was selected before the transaction, whether `slotPlanSeedJson` was persisted inside the existing acceptance transaction, the persisted mesocycle id when known, explicit fallback labeling, and `dbWriteOccurred=true` only after the existing transaction write succeeds. Blocked V2 opt-in reports `v2_blocked_fail_closed` with `dbWriteOccurred=false` before any transaction. Default acceptance selects `legacy_projection_seed` and does not report V2 success.
  - `buildV2MaterializedSeedAcceptanceProbe()` is read-only and may be used to inspect live owner/mesocycle evidence without enabling V2 seed writes. It reports the helper result with opt-in disabled, `simulated_opt_in_readiness` for all-gates-provided readiness, grouped blockers, optional omissions, production-gate values, required-lane coverage, seed-preview counts, and disabled-source provenance; it never writes `slotPlanSeedJson` and always reports `safeToPromoteToProductionWrite=false`.
  - `prepareV2AcceptedSeedPreparationProbe()` is the handoff-context probe wrapper. It reads the stored source handoff summary/draft, derives the same successor slot sequence shape that acceptance preparation would use, and then calls the V2 probe without calling legacy slot-plan projection/repair or writing through Prisma. Probe responses explicitly include `readOnly=true`, `affectsScoringOrGeneration=false`, `wouldWriteTransaction=false`, `wouldCallLegacyProjection=false`, `wouldCallLegacyRepair=false`, `seedSerializer="buildMesocycleSlotPlanSeed"`, base-plan validation status when provided, compact gate results, projection/repair bypass facts, serializer-preview counts, separate preparation provenance, and explicit fallback labels (`legacy_projection_seed` or `fallback_existing_projection`) when fallback is represented.
  - `prepareV2AcceptedSeedPreparationCompare()` is the disabled-by-default read-only comparison over the same handoff preparation seam. It can build the legacy accepted-seed preparation as baseline evidence and a V2 preparation preview through the materialization probe/serializer path, then reports availability, seed shape deltas, identity/class/lane coverage deltas, repair-dependency avoidance, and provenance/no-write boundary facts. The V2-selected preparation path still reports `wouldCallLegacyProjection=false`, `wouldCallLegacyRepair=false`, `consumedByProduction=false`, and `wouldWriteTransaction=false`; the comparison never enters the acceptance transaction, never persists a V2 seed, never labels disabled/blocked V2 as persisted success, and never exposes a production `slotPlanSeedJson` write result.
  - persisted `slotSequenceJson` is placement plus authored slot semantics for new accepted mesocycles. The canonical authored fields are `slotArchetype`, `primaryLaneContract`, `supportCoverageContract`, and `continuityScope`, normalized through `src/lib/api/mesocycle-slot-contract.ts`.
  - `slotPlanSeedJson` stores ordered `slotId -> exercises[{ exerciseId, role, setCount }]` data from the final repaired canonical handoff slot-plan projection or a future explicit V2 materialized-seed opt-in, remains distinct from setup display DTOs, and becomes the canonical seeded runtime composition source for supported accepted mesocycles. The contract may also carry optional seed-safe `acceptedPlannerIntent` metadata for future planner provenance, but runtime replay ignores it and no live caller writes V2 materialized seeds by default. For newly accepted seeded mesocycles, `setCount` is required and runtime replays it as an explicit override rather than recomputing sets. Legacy identity-only seeds remain readable through the compatibility fallback and emit a runtime warning.
  - unsupported raw slot-plan projection cases such as current `BODY_PART` projection limits do not change accept behavior yet; acceptance still succeeds without persisting `slotPlanSeedJson`
  - `409` when handoff is not pending, the draft is missing, or carry-forward keep selections are no longer compatible with the edited split/session structure

## Workout save terminal transition contract

Successful first transition to `COMPLETED` also creates the immutable exact post-session review snapshot before the transaction commits. Snapshot production or insertion failure rolls back completion and lifecycle effects. Completion retries return the existing terminal state without rewriting workout evidence or the snapshot. `PARTIAL` remains resumable and does not finalize an immutable snapshot; `SKIPPED` remains review-ineligible.
- Route: `POST /api/workouts/save` (`src/app/api/workouts/save/route.ts`).
- Request action enum (validation source): `WORKOUT_SAVE_ACTION_VALUES` in `src/lib/validation.ts`.
- Terminal transitions are action-based:
  - `mark_completed` => finalize as `COMPLETED` or auto-normalize to `PARTIAL` when unresolved sets remain.
  - `mark_partial` => finalize as `PARTIAL`.
  - `mark_skipped` => finalize as `SKIPPED`.
- `save_plan` cannot finalize terminal statuses (`COMPLETED`, `PARTIAL`, `SKIPPED`); terminal `status` in a plan write is ignored and persisted status remains non-terminal/current.
- Save success responses now require canonical `workoutStatus` through `src/lib/api/workout-save-contract.ts` and `src/components/log-workout/api.ts`. Clients must derive terminal UI state from the returned `workoutStatus`; `mark_completed` is a requested action, not authoritative completion truth by itself.
- Save success responses may also include `weekClose`, with `weekCloseId`, compatibility `resolution`, canonical `workflowState`, canonical `deficitState`, and `remainingDeficitSets`. Consumers that surface week-close state should treat `workflowState` + `deficitState` as truth and use `resolution` only as a backward-compatible mirror.
- `save_plan` on a **new workout** (no existing record) now triggers a mesocycle snapshot lookup and writes `mesocycleWeekSnapshot` / `mesoSessionSnapshot` / `mesocyclePhaseSnapshot` - the same fields written on performed transition - so the week/session badge appears in Recent Workouts immediately upon plan save (`src/app/api/workouts/save/route.ts`). The performed-transition error gate (`ACTIVE_MESOCYCLE_NOT_FOUND`) is skipped for plan saves; missing active mesocycle is tolerated gracefully.
- Those persisted mesocycle snapshot columns are canonical derived metadata for history badges and progression/explainability week context. UI/list contracts should consume only derived summaries (`sessionSnapshot`), while runtime history/progression consumers should use a normalized `mesocycleSnapshot` object rather than raw column mirrors.
- Completion gating: `mark_completed` requires at least one performed non-skipped set log; otherwise route returns `409`.
- Mesocycle snapshots are duration-aware: `mesocycleWeekSnapshot` is derived from `durationWeeks`, `accumulationSessionsCompleted`, and `sessionsPerWeek`, and `mesoSessionSnapshot` during deload is capped by `sessionsPerWeek` rather than a fixed `3`.
- Mesocycle lifecycle counter increment split:
  - Performed-signal readers use `COMPLETED` + `PARTIAL` (`src/lib/workout-status.ts`).
- Lifecycle counters (`accumulationSessionsCompleted`, `deloadSessionsCompleted`) are incremented on any first transition to a performed status (`COMPLETED` or `PARTIAL`) atomically inside the save-workout transaction (`src/app/api/workouts/save/route.ts`); `transitionMesocycleState()` is then called post-transaction to apply threshold-based state transitions.
- Lifecycle thresholds are duration-aware: accumulation completes after `(durationWeeks - 1) * sessionsPerWeek` performed sessions and deload completes after `sessionsPerWeek` performed sessions.
- Deload completion now transitions the source mesocycle into `AWAITING_HANDOFF`; it does not auto-create the successor. Successor creation is reserved for `POST /api/mesocycles/[id]/accept-next-cycle`.
- Save route persists session-level cycle context only inside `selectionMetadata.sessionDecisionReceipt`; `POST /api/workouts/save` rejects writes that omit the canonical receipt instead of synthesizing fallback state (`src/app/api/workouts/save/route.ts`).
- Save-route exercise rewrites also persist canonical `selectionMetadata.workoutStructureState`, may append `selectionMetadata.runtimeEditReconciliation`, and keep the original receipt intact. They do not rewrite `sessionDecisionReceipt` to match the new structure.
- Structural mutation contract:
  - `POST /api/workouts/save` with exercise rewrite updates `selectionMetadata.workoutStructureState` and appends `runtimeEditReconciliation.rewrite_structure` only when the saved structure drifts from the generated snapshot
  - `GET /api/exercises/search?q=<query>&limit=<n>` returns a bounded ranked shortlist for typed exercise discovery and must not be treated as a preview/defaults surface
  - `GET /api/workouts/[id]/swap-exercise?workoutExerciseId=<id>` returns the ranked initial eligible swap shortlist for the current source exercise
  - `GET /api/workouts/[id]/swap-exercise?workoutExerciseId=<id>&q=<query>&limit=<n>` returns a bounded typed-search shortlist. Text relevance bounds the search set, then the final candidate list is re-ranked by canonical runtime swap eligibility and read-only lane-fit diagnostics before it reaches the client. Typed search may additionally include caution-tier candidates that are blocked from the default shortlist but pass same movement-pattern, primary-muscle, stress, and fatigue guardrails; those candidates carry server-provided caution copy and rank below strict candidates unless a top text-search hit must be preserved in the bounded visible list after passing guardrails.
  - Runtime swap candidates may include additive read-only lane-fit diagnostics (`swapLaneFitScore`, `swapCandidateReason`, `swapFallbackTier`, source lane/class fields, movement/fatigue/stress deltas, stability/loadability tiers, and warning arrays). These diagnostics can read source seed/receipt and accepted V2 lane intent metadata when available, but they must not mutate `slotPlanSeedJson`, `slotSequenceJson`, planner/materializer output, workouts, logs, or saved session state.
  - `POST /api/workouts/[id]/add-exercise-preview` returns the canonical runtime-added accessory preview for requested exercise ids using the same server-owned defaults seam as the add-exercise mutation; the Add Exercise sheet consumes this read path and must not invent local default copy
  - `POST /api/workouts/[id]/add-exercise` updates `selectionMetadata.workoutStructureState`, appends `runtimeEditReconciliation.add_exercise`, and returns the new log-row payload with server-shaped per-exercise capabilities. Same-exercise duplicates are guarded at the route: unresolved planned sets return `DUPLICATE_EXERCISE_PLANNED_UNRESOLVED`, an already runtime-added row returns `DUPLICATE_EXERCISE_ALREADY_ADDED`, and resolved planned work requires explicit `allowDuplicate=true` confirmation before extra work is created.
  - `DELETE /api/workouts/[id]/exercises/[exerciseId]` removes only runtime-added workout exercises that belong to the resolved owner and have no logged `SetLog` rows, deletes the child `WorkoutSet` rows plus `WorkoutExercise`, updates `selectionMetadata.workoutStructureState`, appends `runtimeEditReconciliation.remove_exercise`, and increments `Workout.revision`
  - `GET /api/workouts/[id]/swap-exercise-preview?workoutExerciseId=<id>&exerciseId=<candidate>` returns the canonical swap preview payload from the same server-owned swap seam used by mutation; preview and commit must resolve the same replacement prescription, including set ids, rep targets, load hint, target RPE, and rest. Caution-tier preview and commit must include the typed-search context and are revalidated server-side against the same bounded search guardrails.
  - `POST /api/workouts/[id]/swap-exercise` preserves `gapFillExerciseSwapState`, updates `selectionMetadata.workoutStructureState`, appends `runtimeEditReconciliation.replace_exercise`, and returns the same resolved swap payload shape used by the preview route, including per-exercise capabilities
  - Log page read models pass `LogWorkoutCapabilities` and per-row `LogExerciseCapabilities`; logging controls must be gated by those fields rather than client-side permission inference.
  - Swap route errors include a stable server-owned `code` alongside `error`, including strict logged-state blockers for partially and fully logged source exercises.
  - structural mutations increment `Workout.revision`
- Optional gap-fill enforcement is strictly scoped to the canonical triplet:
  - receipt marker `optional_gap_fill`
  - effective `selectionMode=INTENT`
  - `sessionIntent=BODY_PART`
  When true, save forces `advancesSplit=false`, blocks lifecycle counter updates/state transition, and allows `mesocycleWeekSnapshot` anchor override. Non-triplet payloads use normal lifecycle behavior.
- Closeout enforcement is receipt-scoped, not enum-scoped:
  - receipt marker `closeout_session`
  - additive `selectionMetadata.weekCloseId` may carry the owning closeout/week-close context
  When true, save requires a valid user-owned `weekCloseId` for the canonical mesocycle week context, strips both any top-level `selectionMetadata.sessionSlot` and receipt `sessionDecisionReceipt.sessionSlot`, forces `advancesSplit=false`, skips lifecycle advancement, and keeps the session out of canonical progression/performance-history anchors while still preserving weekly-volume semantics through `deriveSessionSemantics()`.
- Closed-mesocycle fencing:
  - `POST /api/workouts/save` returns `409` for workouts whose parent mesocycle is `AWAITING_HANDOFF` or `COMPLETED`
  - `POST /api/logs/set` and `DELETE /api/logs/set` return `409` for the same closed-mesocycle cases
  - workflow/UI resume logic should treat those workouts as non-resumable rather than retrying writes

## Deload gate contract
- Routes:
  - `POST /api/workouts/generate-from-intent` (`src/app/api/workouts/generate-from-intent/route.ts`)
  - `POST /api/workouts/generate-from-template` (`src/app/api/workouts/generate-from-template/route.ts`)
- Gate condition: when active mesocycle state is `ACTIVE_DELOAD`, both routes dispatch to deload generation and do not execute the normal accumulation generation path.
- Deload generation implementation: `src/lib/api/template-session/deload-session.ts`.
- Deload prescription contract:
  - Exercise list stays continuous with accumulation for the requested intent, with core compounds preserved when possible.
  - Hard sets are reduced roughly 50% with floor safeguards (`1 -> 1`, `2 -> 1`, `3-4 -> 2`, `5-6 -> 3`).
  - Rep targets are maintained for movement continuity.
  - Deload generation does not pre-populate `targetLoad`; canonical load assignment happens later in `src/lib/engine/apply-loads.ts`.
  - The canonical load engine resolves the normal source load first, then applies the lighter deload prescription (currently about 25% down after quantization).
  - Canonical deload effort target is `5-6 RIR` (approximately `RPE 4.5`) via shared deload semantics and lifecycle targeting.
  - Deload sessions remain valid performed work for compliance and weekly-volume context, but they are excluded from progression eligibility, anchor updates, and canonical performance-history/explainability trend reads.
- Default lifecycle hypertrophy RIR bands are duration-aware rather than fixed to a 4+1 template.

## Workout generation receipt contract
- Routes:
  - `POST /api/workouts/generate-from-intent` (`src/app/api/workouts/generate-from-intent/route.ts`)
  - `POST /api/workouts/generate-from-template` (`src/app/api/workouts/generate-from-template/route.ts`)
- Generation responses return canonical selection metadata and server-owned prescription readouts only:
  - intent route returns `selectionMetadata`, carrying canonical `sessionDecisionReceipt`
  - template route returns `selectionMetadata`, carrying canonical `sessionDecisionReceipt`
  - both routes may return optional `prescriptionReadouts` (`PrescriptionConfidenceReadout[]` from `src/lib/api/template-session/types.ts`) after canonical load assignment. When targeted selected-exercise prescription-anchor history backfills an exact anchor, the matching readout row may include compact `selectedAnchorEvidence` with the selected exercise id/name, whether normal history already had usable exact evidence, the backfill reason, ignored skipped/unperformed row count, and aggregate source counts. This is response/read-model metadata only; it must not be persisted as executable seed truth, planner policy, runtime replay input, or a receipt mirror.
- Generation routes canonicalize receipt readiness/autoregulation fields through shared selection metadata helpers rather than returning ad hoc top-level session mirrors (`src/lib/ui/selection-metadata.ts`, `src/lib/api/template-session/types.ts`).
- Generation routes own original plan metadata. Mutation reconciliation is added later by write-side mutation paths when the saved workout structure changes.
- Both generation routes now return `409` with `{ error: "Mesocycle handoff pending.", handoff }` when the prior mesocycle is closed into `AWAITING_HANDOFF` and no successor has been accepted yet.
- Both generation routes accept optional `slotId` input and stamp canonical `selectionMetadata.sessionDecisionReceipt.sessionSlot` for seeded advancing sessions from the truthful runtime slot identity, including off-order explicit-intent generation when the requested intent maps to an unresolved runtime slot. That receipt snapshot carries `slotId`, `intent`, `sequenceIndex`, optional `sequenceLength`, and `source`.
- Generation/finalization stamps `selectionMetadata.sessionDecisionReceipt.sessionProvenance` with the active mesocycle id and the session-level composition source. Supported values are `persisted_slot_plan_seed`, `runtime_selection`, `deload_seed_replay`, `legacy_fallback`, and `unknown`. This is intentionally narrower than audit `generationPath`; generation path remains audit-only and is not part of the saved receipt contract.
- Advancing generation no longer waits for post-generation route stamping to make slot meaning concrete. When runtime next-session resolution already knows the advancing slot, `generateSessionFromIntent()` receives that canonical slot snapshot up front, and the audit future-week generation path forwards the same slot context for derived advancing runs.
- For deload generation, receipt-backed user messaging should describe recovery intent, lighter loads, and reduced volume without hard-coding a fixed percentage promise. The canonical receipt scope is the deload decision payload, especially `selectionMetadata.sessionDecisionReceipt.deloadDecision.appliedTo`.
- Planning semantics behind those routes are centralized in `src/lib/planning/session-opportunities.ts`. Route contracts do not expose planner inventory mode directly; `standard`, `closure`, and `rescue` remain internal generation concepts selected by the orchestration layer.
- `POST /api/workouts/generate-from-intent` request fields include optional gap-fill controls (`src/lib/validation.ts`, `src/lib/api/template-session/types.ts`):
  - `optionalGapFill?: boolean`
  - `anchorWeek?: number` (legacy/manual override path; current week-close flow derives the effective week from pending week-close context)
  - `weekCloseId?: string`
  - `optionalGapFillContext?: { weekCloseId: string; targetWeek: number }` on the internal generation seam used by `src/app/api/workouts/generate-from-intent/route.ts`
  - `maxGeneratedHardSets?: number`
  - `maxGeneratedExercises?: number`
  - `targetMuscles` remains required for `intent=body_part`
- Optional gap-fill generation uses the same planner/selection engine path as standard intent generation. Allowed route-level deltas are:
  - post-generation caps trimming
  - canonical metadata stamping via `attachOptionalGapFillMetadata()` (`src/lib/ui/selection-metadata.ts`)
  - week-close-context injection (`optionalGapFillContext.targetWeek`) before planner context loading (`src/app/api/workouts/generate-from-intent/route.ts`, `src/lib/api/template-session.ts`)
- Week-close ownership remains canonical for legacy/manual optional gap-fill. Normal weekly close no longer creates pending optional work from target deficits. Runtime optional gap-fill generation still requires an existing pending `MesocycleWeekClose` row and links the generated workout back to that row via `selectionMetadata.weekCloseId`; audit and repair tooling may detect or reconcile legacy data that predates that ownership contract, but they do not change the runtime route semantics.
- Within that shared generation path, optional gap-fill currently enters the planner through the explicit `rescue` inventory layer on `SessionOpportunityDefinition` rather than widening standard inventory eligibility for all `body_part` requests.
- Workout-audit artifacts now expose additive normalized canonical semantics alongside snapshots:
  - top-level `canonicalSemantics` when a session snapshot is present
  - per-session `historicalWeek.sessions[*].canonicalSemantics`
  - `progressionAnchor.canonicalSemantics`
  This block is the stable artifact-facing summary for `phase`, `isDeload`, `countsTowardProgressionHistory`, `countsTowardPerformanceHistory`, and `updatesProgressionAnchor`.
- Canonical receipt fields for gap-fill payloads:
  - `selectionMetadata.sessionDecisionReceipt.exceptions` contains `optional_gap_fill`
  - `selectionMetadata.sessionDecisionReceipt.targetMuscles` carries chosen muscles
  - `selectionMetadata.weekCloseId` carries the linked pending week-close id
  - `selectionMetadata.sessionDecisionReceipt.cycleContext.weekInMeso` is pinned from the pending week-close `targetWeek`
  - `selectionMetadata.sessionDecisionReceipt.cycleContext.weekInBlock` is derived from the block containing that anchored mesocycle week when `TrainingBlock` rows exist, with lifecycle fallback only when block data is unavailable
  - `selectionMetadata.sessionDecisionReceipt.cycleContext.blockDurationWeeks` carries the active block horizon when canonical block context exists, so read-side explainability can speak in block-relative terms without re-deriving block length

## Week-close deficit snapshot notes
- Pending and resolved week-close rows in `src/lib/api/mesocycle-week-close.ts` serialize `deficitSnapshot.muscles[]` as `{ muscle, target, actual, deficit }`.
- After the weekly-volume unification, `actual` and `deficit` in that snapshot are based on weighted effective weekly volume from `loadMesocycleWeekMuscleVolume()` in `src/lib/api/weekly-volume.ts`, not primary-only direct-set counts.
- `findRelevantWeekCloseForUser()` is the canonical broad selector for relevant week-close truth, rather than a direct UI-visibility contract. Surfaces with current-week semantics must additionally scope that row to the active/displayed week before rendering. Normal-flow `resolution=AUTO_DISMISSED` rows are review evidence, not active optional closeout work, and must not be surfaced as blocking Home/Program actions.
- Week-close truth model:
  - `workflowState=PENDING_OPTIONAL_GAP_FILL`: optional gap-fill workflow is still actionable
  - `workflowState=COMPLETED`: workflow is handled or no longer actionable
  - `deficitState=OPEN`: deficit remains and workflow is still pending
  - `deficitState=PARTIAL`: workflow is complete but weighted weekly deficit still remains
  - `deficitState=CLOSED`: no qualifying weekly deficit remains
- `resolution=NO_GAP_FILL_NEEDED` is the only resolution that implies deficit closure by itself. `GAP_FILL_COMPLETED`, `GAP_FILL_DISMISSED`, and `AUTO_DISMISSED` must not be interpreted as equivalent to `deficitState=CLOSED`.
- At a required scheduled week boundary, target deficits resolve as `status=RESOLVED`, `workflowState=COMPLETED`, and `resolution=AUTO_DISMISSED`; they are review evidence and do not block rollover into the next accumulation week or deload.
- `POST /api/mesocycles/week-close/[id]/closeout` is the canonical server-owned legacy/manual closeout creation path. The route resolves owner identity and delegates to `createCloseoutSessionForWeek()` in `src/lib/api/mesocycle-week-close.ts`, which validates that the user-owned week-close row is still `PENDING_OPTIONAL_GAP_FILL`, validates it against the current or immediately previous active accumulation week in the same active mesocycle, rejects resolved/deload/duplicate closeouts, and creates a slotless `PLANNED` scaffold workout with `selectionMode=MANUAL`, `advancesSplit=false`, `selectionMetadata.weekCloseId`, and the canonical `closeout_session` receipt marker. `GET /api/mesocycles/week-close/[id]/closeout` uses the same seam for link-based UI creation and redirects to `/log/[workoutId]` after creation.
- `POST /api/workouts/[id]/dismiss-closeout` is the canonical closeout skip path. The route resolves owner identity and delegates to `dismissCloseoutSession()` in `src/lib/api/mesocycle-week-close.ts`, which only marks planned receipt-backed closeout workouts with additive `selectionMetadata.closeoutDismissed=true` and `closeoutDismissedAt`, increments `Workout.revision`, and leaves workout status, week-close resolution, optional workout linkage, slot plan state, and the stored receipt untouched.

## Workout explanation response contract
- Route: `GET /api/workouts/[id]/explanation` (`src/app/api/workouts/[id]/explanation/route.ts`).
- Response includes `progressionReceipts` keyed by `exerciseId` in addition to `exerciseRationales` and `prescriptionRationales`.
- Receipt payload shape is defined by `ProgressionReceipt` in `src/lib/evidence/types.ts` and populated by `generateWorkoutExplanation()` in `src/lib/api/explainability.ts`.
- `ProgressionSetSummary` now supports `performedAt` for historical evidence timestamps (`src/lib/evidence/types.ts`), and receipt history is recency-bounded in `loadLatestPerformedSetSummary()` (`src/lib/api/explainability.ts`).
- Session context payload now carries cycle/readiness contract fields (`sessionContext.cycleSource`, `sessionContext.readinessStatus.availability`, `sessionContext.readinessStatus.label`) defined in `src/lib/engine/explainability/types.ts` and produced by `explainSessionContext()` in `src/lib/engine/explainability/session-context.ts`.
- Route responsibilities are documented canonically in `docs/01_ARCHITECTURE.md`; this section only records payload shape.
- Explanation-layer consumers should treat `deriveSessionSemantics()` plus canonical progression receipts/decision outputs as the source of session behavior. Explanation routes should not independently re-author session-level progression meaning that could drift from generator-owned next-exposure behavior.
- `nextExposureDecisions` is a read-side interpretation layer only. Its progression verdict must be computed through `computeDoubleProgressionDecision()` using the same material confidence-sensitive inputs as canonical generation for that exercise (`workingSetLoad`, `priorSessionCount`, `historyConfidenceScale`; `confidenceReasons` remains log-only).
- `nextExposureDecisions` also depend on preserved prescribed-load evidence. `targetLoad` must survive context/history mapping so explainability can justify overshoot-based increases or overshoot-block reasons against the same canonical inputs used by generation.
- Post-session review calibration rows may use same-exercise `nextExposureDecisions` as read-only alignment evidence when canonical explainability reframes an otherwise clean-looking row as `target_too_high` or `hold_at_recalibrated_anchor`. This keeps the review copy coherent without changing progression, prescription, seed/runtime, receipt, or planner/materializer behavior.
- User-facing review surfaces that consume this route, including immediate completion review and `/workout/[id]`, should preserve that same verdict through the shared `PostWorkoutInsights` model rather than translating a canonical `hold` into stronger progression language.
- User-facing rendering of canonical `nextExposureDecisions[*].action` should route through `src/lib/ui/next-exposure-copy.ts`. Heuristic/advisory surfaces may describe context, but they should not define alternate canonical action wording for the same decision.
- `confidence.missingSignals` now uses user-facing diagnostic labels rather than engine shorthand:
  - `same-day readiness check-in`
  - `receipt-backed cycle context`
  - `stored exercise selection reasons`
  - `recent performance-derived workout stats`
- `confidence.summary` is intentionally diagnostic:
  - high confidence means the audit has enough evidence to explain the session without major guesswork
  - medium confidence means one signal is being approximated
  - low confidence means the audit can only explain part of the session with confidence

## Session-decision receipt accounting evidence

- Receipt version 3 may include `stimulusAccounting.contractVersion=1` and one server-authored entry per initially materialized exercise: order index, source exercise ID, snapshot contract version, hash, and provenance.
- The save route never trusts client-supplied accounting evidence. Exercise rewrites replace it from server-resolved snapshots; non-rewrite saves preserve only already-persisted evidence.
- Runtime add/swap evidence is appended to `runtimeEditReconciliation` and includes the exact snapshot hash/provenance written in the same transaction.
- The receipt and runtime-edit ledger are evidence manifests; `WorkoutExercise.stimulusAccountingSnapshot` remains the canonical accounting payload.
