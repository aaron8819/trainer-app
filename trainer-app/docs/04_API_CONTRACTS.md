# 04 API Contracts

Owner: Aaron  
Last reviewed: 2026-03-09
Purpose: Canonical API contract map for App Router endpoints and payload validation boundaries.

This doc covers:
- Current API route surface
- Validation contract source files
- Runtime enum contract source and verification

Invariants:
- Validation schemas in `src/lib/validation.ts` are canonical for request payloads.
- Enum contract values are canonical in `docs/contracts/runtime-contracts.json` and verified by script.
- API docs should reference schemas and route files, not duplicate large inline contracts.

Sources of truth:
- `trainer-app/src/app/api`
- `trainer-app/src/lib/validation.ts`
- `trainer-app/docs/contracts/runtime-contracts.json`
- `trainer-app/scripts/check-doc-runtime-contracts.ts`

## Canonical runtime contracts
- File: `docs/contracts/runtime-contracts.json`
- Verification command: `npm run verify:contracts`
- Runtime enum sources:
  - `WORKOUT_STATUS_VALUES` in `src/lib/validation.ts`
  - `WORKOUT_SELECTION_MODE_VALUES` in `src/lib/validation.ts`
  - `WORKOUT_SESSION_INTENT_DB_VALUES` in `src/lib/validation.ts`
  - `WORKOUT_EXERCISE_SECTION_VALUES` in `src/lib/validation.ts`
  - Matching Prisma enums in `prisma/schema.prisma`

## API route groups
- Workouts: `src/app/api/workouts/**` (generate-from-intent, generate-from-template, save, `GET /api/workouts/history`)
- Logging: `src/app/api/logs/set/route.ts`
- Mesocycles: `GET /api/mesocycles` (`src/app/api/mesocycles/route.ts`) - returns list of user mesocycles with state, durationWeeks, startDate, isActive
- Program/periodization/readiness: `src/app/api/program/route.ts`, `src/app/api/periodization/macro/route.ts`, `src/app/api/readiness/submit/route.ts`, `src/app/api/stalls/route.ts`
- Templates: `src/app/api/templates/**`
- Exercises and preferences: `src/app/api/exercises/**`, `src/app/api/preferences/route.ts`
- Analytics: `src/app/api/analytics/**`
- Profile/session support: `src/app/api/profile/setup/route.ts`, `src/app/api/session-checkins/route.ts`

## Program dashboard response notes
- Route: `GET /api/program` (`src/app/api/program/route.ts`) returns `loadProgramDashboardData()` output directly.
- `GET /api/program` accepts an optional `?week=N` query parameter (`src/app/api/program/route.ts`). When supplied, `loadProgramDashboardData()` returns the selected dashboard payload for that historical week, including week-specific volume, `rirTarget`, `coachingCue`, and `viewedBlockType`. The live `currentWeek` is always present in the response; the requested week is returned as `viewedWeek`.
- `ProgramDashboardData.viewedWeek` is the effective week whose selected dashboard payload is rendered - equals `currentWeek` by default, overridden by `?week=N`. Clamped to `[1, durationWeeks]`.
- `ProgramDashboardData.viewedBlockType` is the effective block type for `viewedWeek`, used by the shared program card to keep historical block chrome coherent with the selected week.
- `ProgramDashboardData.activeMeso.completedSessions` is now sourced from `accumulationSessionsCompleted` (the canonical lifecycle counter), not the `completedSessions` DB column. Clients should treat this field as the lifecycle-derived session count.
- `ProgramDashboardData` is now the shared dashboard-card contract only. Home-page operational helpers (`nextSession`, `latestIncomplete`, `lastSessionSkipped`) are loaded separately through `loadHomeProgramSupport()` in `src/lib/api/program.ts` and are not part of `GET /api/program`.
- `ProgramDashboardData.deloadReadiness` is always computed from the live `currentWeek` state even when `viewedWeek` is historical. Historical week navigation changes the selected week payload, but the current UI intentionally hides live-only deload recommendation chrome while browsing history rather than implying historical deload replay.
- `ProgramDashboardData.volumeThisWeek` rows now expose canonical weighted weekly actuals as `effectiveSets`, with `directSets` and `indirectSets` retained as contextual/debug fields only (`src/lib/api/program.ts`, `src/components/ProgramStatusCard.tsx`).
- `ProgramDashboardData.volumeThisWeek` rows also expose dashboard-only opportunity fields: `opportunityScore`, `opportunityState`, and `opportunityRationale` (`src/lib/api/program.ts`). These are computed from canonical weekly target pressure plus a recent weighted-stimulus adapter in `src/lib/api/recent-muscle-stimulus.ts`, with optional downward-only modulation from fresh readiness signals via `src/lib/api/readiness.ts`.
- Historical `GET /api/program?week=N` responses still carry those opportunity fields, but the current UI only renders `opportunityState` for the live current week because opportunity currently uses present recency/readiness context rather than a historical as-of timestamp.
- `ProgramDashboardData.deloadReadiness` saturation logic now keys off weighted `effectiveSets` rather than primary-only direct sets (`src/lib/api/program.ts`, `src/lib/api/weekly-volume.ts`).

## Analytics response notes
- Shared analytics semantics helpers now live in `src/lib/api/analytics-semantics.ts`. That helper is the canonical source for analytics counting vocabulary (`generated`, `performed`, `completed`) and explicit time-window descriptors (`all_time`, `rolling_days`, `rolling_iso_weeks`, `date_range`).
- `GET /api/analytics/summary` now returns explicit totals for `workoutsGenerated`, `workoutsPerformed`, `workoutsCompleted`, performed set totals, and a `consistency` block (`targetSessionsPerWeek`, `thisWeekPerformed`, `rollingFourWeekAverage`, `currentTrainingStreakWeeks`, `weeksMeetingTarget`, `trackedWeeks`). Workout counts use `scheduledDate` within the selected query range; performed set totals use `setLog.completedAt` within that same query range. The response also returns `semantics` metadata documenting both windows and the generated/performed/completed definitions.
- `GET /api/analytics/templates` now returns template usage rows with `generatedWorkouts`, `performedWorkouts`, `completedWorkouts`, `performedRate`, and `completionRate`, plus `semantics` metadata describing the all-time generated/performed/completed vocabulary.
- `GET /api/analytics/volume` returns `weeklyVolume` and `landmarks` plus `semantics` metadata documenting that:
  - the chart window is rolling ISO weeks by `scheduledDate`
  - only performed workouts (`COMPLETED` + `PARTIAL`) are included
  - only non-skipped logged sets contribute to direct/indirect volume
  - each weekly muscle bucket now also includes canonical weighted `effectiveSets` for analytics views that need lifecycle-aligned volume interpretation
- `GET /api/analytics/muscle-outcomes` returns the active-week `review` model for analytics outcome auditing. Each row includes `muscle`, `targetSets`, `actualEffectiveSets`, `delta`, `percentDelta`, `status`, `contributingExerciseCount`, and up to three `topContributors`. Targets come from canonical lifecycle volume targeting and actuals come from canonical weighted effective stimulus.
- Read-side consumers that expose lifecycle weekly targets (`GET /api/program`, `GET /api/analytics/muscle-outcomes`, week-close deficit snapshots, and explainability volume compliance) now rely on the same `getWeeklyVolumeTarget()` seam as generation. When the mesocycle row includes ordered `TrainingBlock` definitions, those reads are block-aware without requiring a separate API-specific override payload.
- `GET /api/analytics/recovery` now returns `muscles` plus `semantics` metadata documenting that the screen is a rolling 14-day SRA-style stimulus-recency view built from performed workouts only.
- Each recovery row now also carries a 7-day `timeline` of canonical weighted effective stimulus buckets (`date`, `effectiveSets`, `intensityBand`) derived with the shared stimulus engine, not raw direct sets (`src/lib/api/muscle-stimulus-timeline.ts`, `src/lib/engine/stimulus.ts`).
- Dashboard opportunity does not consume `GET /api/analytics/recovery`; analytics stimulus recency remains a separate pattern-review surface and is not the dashboard source of truth.

## Validation-backed contracts (examples)
- Workout generation/save: `generateFromTemplateSchema`, `generateFromIntentSchema`, `saveWorkoutSchema`
- Workout history query: `workoutHistoryQuerySchema` in `src/lib/validation.ts`; consumed by `GET /api/workouts/history`. Supports `intent`, `status` (comma-separated), `mesocycleId`, `from`/`to` date range, and cursor-based pagination (`cursor`, `take`). History items expose only a derived `sessionSnapshot` summary for week/session/phase badge rendering instead of parallel top-level snapshot fields in the response shape (`src/app/api/workouts/history/route.ts`).
- Logging: `setLogSchema`
- Dumbbell load contract: clients submit dumbbell `actualLoad` in per-hand units and `POST /api/logs/set` persists the provided per-hand value directly.
- Performed-set signal requirement: `POST /api/logs/set` returns 400 when a non-skipped set log supplies neither `actualReps` nor `actualRpe`. Unresolved sets must remain un-logged (missing) rather than being written as empty performed logs.
- Bodyweight auto-normalization: when `targetLoad=0` and the set is not skipped, `actualLoad` is written as `0` even when the client omits it (`src/app/api/logs/set/route.ts`).
- Templates: `createTemplateSchema`, `updateTemplateSchema`, `addExerciseToTemplateSchema`
- Profile/readiness/analytics: `profileSetupSchema`, `readinessSignalSchema`, `analyticsSummarySchema`
- `profileSetupSchema` no longer accepts `sessionMinutes`; profile setup persists `daysPerWeek` and optional `splitType` through `POST /api/profile/setup` (`src/lib/validation.ts`, `src/app/api/profile/setup/route.ts`).
- Session-decision request/response ownership follows the canonical flow in `docs/01_ARCHITECTURE.md`: save and generation contracts carry `selectionMetadata.sessionDecisionReceipt`, and validation rejects removed top-level session mirrors / top-level autoregulation inputs (`src/lib/validation.ts`, `src/app/api/workouts/save/route.ts`).

## Workout save terminal transition contract
- Route: `POST /api/workouts/save` (`src/app/api/workouts/save/route.ts`).
- Request action enum (validation source): `WORKOUT_SAVE_ACTION_VALUES` in `src/lib/validation.ts`.
- Terminal transitions are action-based:
  - `mark_completed` => finalize as `COMPLETED` or auto-normalize to `PARTIAL` when unresolved sets remain.
  - `mark_partial` => finalize as `PARTIAL`.
  - `mark_skipped` => finalize as `SKIPPED`.
- `save_plan` cannot finalize terminal statuses (`COMPLETED`, `PARTIAL`, `SKIPPED`); terminal `status` in a plan write is ignored and persisted status remains non-terminal/current.
- `save_plan` on a **new workout** (no existing record) now triggers a mesocycle snapshot lookup and writes `mesocycleWeekSnapshot` / `mesoSessionSnapshot` / `mesocyclePhaseSnapshot` - the same fields written on performed transition - so the week/session badge appears in Recent Workouts immediately upon plan save (`src/app/api/workouts/save/route.ts`). The performed-transition error gate (`ACTIVE_MESOCYCLE_NOT_FOUND`) is skipped for plan saves; missing active mesocycle is tolerated gracefully.
- Those persisted mesocycle snapshot columns are canonical derived metadata for history badges and progression/explainability week context. UI/list contracts should consume only derived summaries (`sessionSnapshot`), while runtime history/progression consumers should use a normalized `mesocycleSnapshot` object rather than raw column mirrors.
- Completion gating: `mark_completed` requires at least one performed non-skipped set log; otherwise route returns `409`.
- Mesocycle snapshots are duration-aware: `mesocycleWeekSnapshot` is derived from `durationWeeks`, `accumulationSessionsCompleted`, and `sessionsPerWeek`, and `mesoSessionSnapshot` during deload is capped by `sessionsPerWeek` rather than a fixed `3`.
- Mesocycle lifecycle counter increment split:
  - Performed-signal readers use `COMPLETED` + `PARTIAL` (`src/lib/workout-status.ts`).
  - Lifecycle counters (`accumulationSessionsCompleted`, `deloadSessionsCompleted`) are incremented on any first transition to a performed status (`COMPLETED` or `PARTIAL`) atomically inside the save-workout transaction (`src/app/api/workouts/save/route.ts`); `transitionMesocycleState()` is then called post-transaction to apply threshold-based state transitions.
- Lifecycle thresholds are duration-aware: accumulation completes after `(durationWeeks - 1) * sessionsPerWeek` performed sessions and deload completes after `sessionsPerWeek` performed sessions.
- Save route persists session-level cycle context only inside `selectionMetadata.sessionDecisionReceipt`; `POST /api/workouts/save` rejects writes that omit the canonical receipt instead of synthesizing fallback state (`src/app/api/workouts/save/route.ts`).
- Optional gap-fill enforcement is strictly scoped to the canonical triplet:
  - receipt marker `optional_gap_fill`
  - effective `selectionMode=INTENT`
  - `sessionIntent=BODY_PART`
  When true, save forces `advancesSplit=false`, blocks lifecycle counter updates/state transition, and allows `mesocycleWeekSnapshot` anchor override. Non-triplet payloads use normal lifecycle behavior.

## Deload gate contract
- Routes:
  - `POST /api/workouts/generate-from-intent` (`src/app/api/workouts/generate-from-intent/route.ts`)
  - `POST /api/workouts/generate-from-template` (`src/app/api/workouts/generate-from-template/route.ts`)
- Gate condition: when active mesocycle state is `ACTIVE_DELOAD`, both routes dispatch to deload generation and do not execute the normal accumulation generation path.
- Deload generation implementation: `src/lib/api/template-session/deload-session.ts`.
- Deload prescription contract:
  - Exercise list is anchored to the final accumulation week/session history for the requested intent.
  - Set volume is reduced to ~40-50% (`DELOAD_SET_FACTOR = 0.45`) with minimum set floor safeguards.
  - Load anchoring comes from the final accumulation modal load selection logic.
  - RIR target is deload band (`4-6`) via lifecycle RIR targeting.
- Default lifecycle hypertrophy RIR bands are duration-aware rather than fixed to a 4+1 template.

## Workout generation receipt contract
- Routes:
  - `POST /api/workouts/generate-from-intent` (`src/app/api/workouts/generate-from-intent/route.ts`)
  - `POST /api/workouts/generate-from-template` (`src/app/api/workouts/generate-from-template/route.ts`)
- Generation responses persist canonical selection metadata only:
  - intent route returns `selectionMetadata`, carrying canonical `sessionDecisionReceipt`
  - template route returns `selectionMetadata`, carrying canonical `sessionDecisionReceipt`
- Generation routes canonicalize receipt readiness/autoregulation fields through shared selection metadata helpers rather than returning ad hoc top-level session mirrors (`src/lib/ui/selection-metadata.ts`, `src/lib/api/template-session/types.ts`).
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
- Week-close ownership is canonical for optional gap-fill. Runtime optional gap-fill generation depends on a pending `MesocycleWeekClose` row and links the generated workout back to that row via `selectionMetadata.weekCloseId`; audit and repair tooling may detect or reconcile legacy data that predates that ownership contract, but they do not change the runtime route semantics.
- Within that shared generation path, optional gap-fill currently enters the planner through the explicit `rescue` inventory layer on `SessionOpportunityDefinition` rather than widening standard inventory eligibility for all `body_part` requests.
- Canonical receipt fields for gap-fill payloads:
  - `selectionMetadata.sessionDecisionReceipt.exceptions` contains `optional_gap_fill`
  - `selectionMetadata.sessionDecisionReceipt.targetMuscles` carries chosen muscles
  - `selectionMetadata.weekCloseId` carries the linked pending week-close id
  - `selectionMetadata.sessionDecisionReceipt.cycleContext.weekInMeso` is pinned from the pending week-close `targetWeek`
  - `selectionMetadata.sessionDecisionReceipt.cycleContext.weekInBlock` is derived from the block containing that anchored mesocycle week when `TrainingBlock` rows exist, with lifecycle fallback only when block data is unavailable
  - `selectionMetadata.sessionDecisionReceipt.cycleContext.blockDurationWeeks` carries the active block horizon when canonical block context exists, so read-side explainability can speak in block-relative terms without re-deriving block length

## Week-close deficit snapshot notes
- Pending week-close rows returned through `findPendingWeekCloseForUser()` in `src/lib/api/mesocycle-week-close.ts` still serialize `deficitSnapshot.muscles[]` as `{ muscle, target, actual, deficit }`.
- After the weekly-volume unification, `actual` and `deficit` in that snapshot are based on weighted effective weekly volume from `loadMesocycleWeekMuscleVolume()` in `src/lib/api/weekly-volume.ts`, not primary-only direct-set counts.

## Workout explanation response contract
- Route: `GET /api/workouts/[id]/explanation` (`src/app/api/workouts/[id]/explanation/route.ts`).
- Response includes `progressionReceipts` keyed by `exerciseId` in addition to `exerciseRationales` and `prescriptionRationales`.
- Receipt payload shape is defined by `ProgressionReceipt` in `src/lib/evidence/types.ts` and populated by `generateWorkoutExplanation()` in `src/lib/api/explainability.ts`.
- `ProgressionSetSummary` now supports `performedAt` for historical evidence timestamps (`src/lib/evidence/types.ts`), and receipt history is recency-bounded in `loadLatestPerformedSetSummary()` (`src/lib/api/explainability.ts`).
- Session context payload now carries cycle/readiness contract fields (`sessionContext.cycleSource`, `sessionContext.readinessStatus.availability`, `sessionContext.readinessStatus.label`) defined in `src/lib/engine/explainability/types.ts` and produced by `explainSessionContext()` in `src/lib/engine/explainability/session-context.ts`.
- Route responsibilities are documented canonically in `docs/01_ARCHITECTURE.md`; this section only records payload shape.
- Explanation-layer consumers should treat `deriveSessionSemantics()` plus canonical progression receipts/decision outputs as the source of session behavior. Explanation routes should not independently re-author session-level progression meaning that could drift from generator-owned next-exposure behavior.
- `nextExposureDecisions` is a read-side interpretation layer only. Its progression verdict must be computed through `computeDoubleProgressionDecision()` using the same material confidence-sensitive inputs as canonical generation for that exercise (`anchorOverride`, `priorSessionCount`, `historyConfidenceScale`; `confidenceReasons` remains log-only).
- `confidence.missingSignals` now uses user-facing diagnostic labels rather than engine shorthand:
  - `same-day readiness check-in`
  - `receipt-backed cycle context`
  - `stored exercise selection reasons`
  - `recent performance-derived workout stats`
- `confidence.summary` is intentionally diagnostic:
  - high confidence means the audit has enough evidence to explain the session without major guesswork
  - medium confidence means one signal is being approximated
  - low confidence means the audit can only explain part of the session with confidence
