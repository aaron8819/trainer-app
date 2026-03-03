# 04 API Contracts

Owner: Aaron  
Last reviewed: 2026-03-03
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
- Mesocycles: `GET /api/mesocycles` (`src/app/api/mesocycles/route.ts`) — returns list of user mesocycles with state, durationWeeks, startDate, isActive
- Program/periodization/readiness: `src/app/api/program/route.ts`, `src/app/api/periodization/macro/route.ts`, `src/app/api/readiness/submit/route.ts`, `src/app/api/stalls/route.ts`
- Templates: `src/app/api/templates/**`
- Exercises and preferences: `src/app/api/exercises/**`, `src/app/api/preferences/route.ts`
- Analytics: `src/app/api/analytics/**`
- Profile/session support: `src/app/api/profile/setup/route.ts`, `src/app/api/session-checkins/route.ts`

## Program dashboard response notes
- Route: `GET /api/program` (`src/app/api/program/route.ts`) returns `loadProgramDashboardData()` output directly.
- `GET /api/program` accepts an optional `?week=N` query parameter (`src/app/api/program/route.ts`). When supplied, `loadProgramDashboardData()` returns volume and RIR data for the requested historical week instead of the current week. The live `currentWeek` is always present in the response; the requested week is returned as `viewedWeek`.
- `ProgramDashboardData` now includes `daysPerWeek` (`src/lib/api/program.ts`) sourced from user constraints and used by clients to avoid hardcoded frequency assumptions.
- `ProgramDashboardData.viewedWeek` is the effective week whose volume/RIR data is rendered — equals `currentWeek` by default, overridden by `?week=N`. Clamped to `[1, durationWeeks]`.
- `ProgramDashboardData.activeMeso.completedSessions` is now sourced from `accumulationSessionsCompleted` (the canonical lifecycle counter), not the `completedSessions` DB column. Clients should treat this field as the lifecycle-derived session count.

## Validation-backed contracts (examples)
- Workout generation/save: `generateFromTemplateSchema`, `generateFromIntentSchema`, `saveWorkoutSchema`
- Workout history query: `workoutHistoryQuerySchema` in `src/lib/validation.ts`; consumed by `GET /api/workouts/history`. Supports `intent`, `status` (comma-separated), `mesocycleId`, `from`/`to` date range, and cursor-based pagination (`cursor`, `take`). History items now include `mesoSessionSnapshot` (session-within-week number, nullable) in the response shape (`src/app/api/workouts/history/route.ts`).
- Logging: `setLogSchema`
- Dumbbell load contract: clients submit dumbbell `actualLoad` in per-hand units and `POST /api/logs/set` persists the provided per-hand value directly.
- Performed-set signal requirement: `POST /api/logs/set` returns 400 when a non-skipped set log supplies neither `actualReps` nor `actualRpe`. Unresolved sets must remain un-logged (missing) rather than being written as empty performed logs.
- Bodyweight auto-normalization: when `targetLoad=0` and the set is not skipped, `actualLoad` is written as `0` even when the client omits it (`src/app/api/logs/set/route.ts`).
- Templates: `createTemplateSchema`, `updateTemplateSchema`, `addExerciseToTemplateSchema`
- Profile/readiness/analytics: `profileSetupSchema`, `readinessSignalSchema`, `analyticsSummarySchema`
- `profileSetupSchema` no longer accepts `sessionMinutes`; profile setup persists `daysPerWeek` and optional `splitType` through `POST /api/profile/setup` (`src/lib/validation.ts`, `src/app/api/profile/setup/route.ts`).
- Save payload supports explainability/runtime metadata passthrough for persisted workouts via `saveWorkoutSchema` fields `wasAutoregulated` and `autoregulationLog` in `src/lib/validation.ts` and persistence in `src/app/api/workouts/save/route.ts`.
- `saveWorkoutSchema` rejects legacy top-level session metadata mirrors inside `selectionMetadata` (`cycleContext`, `deloadDecision`, `sorenessSuppressedMuscles`, `adaptiveDeloadApplied`, `periodizationWeek`, `lifecycleRirTarget`, `lifecycleVolumeTargets`) and requires canonical session-level metadata to live under `selectionMetadata.sessionDecisionReceipt` (`src/lib/validation.ts`, `src/app/api/workouts/save/route.ts`).

## Workout save terminal transition contract
- Route: `POST /api/workouts/save` (`src/app/api/workouts/save/route.ts`).
- Request action enum (validation source): `WORKOUT_SAVE_ACTION_VALUES` in `src/lib/validation.ts`.
- Terminal transitions are action-based:
  - `mark_completed` => finalize as `COMPLETED` or auto-normalize to `PARTIAL` when unresolved sets remain.
  - `mark_partial` => finalize as `PARTIAL`.
  - `mark_skipped` => finalize as `SKIPPED`.
- `save_plan` cannot finalize terminal statuses (`COMPLETED`, `PARTIAL`, `SKIPPED`); terminal `status` in a plan write is ignored and persisted status remains non-terminal/current.
- `save_plan` on a **new workout** (no existing record) now triggers a mesocycle snapshot lookup and writes `mesocycleWeekSnapshot` / `mesoSessionSnapshot` / `mesocyclePhaseSnapshot` — the same fields written on performed transition — so the week/session badge appears in Recent Workouts immediately upon plan save (`src/app/api/workouts/save/route.ts`). The performed-transition error gate (`ACTIVE_MESOCYCLE_NOT_FOUND`) is skipped for plan saves; missing active mesocycle is tolerated gracefully.
- Completion gating: `mark_completed` requires at least one performed non-skipped set log; otherwise route returns `409`.
- Mesocycle snapshots are duration-aware: `mesocycleWeekSnapshot` is derived from `durationWeeks`, `accumulationSessionsCompleted`, and `sessionsPerWeek`, and `mesoSessionSnapshot` during deload is capped by `sessionsPerWeek` rather than a fixed `3`.
- Mesocycle lifecycle counter increment split:
  - Performed-signal readers use `COMPLETED` + `PARTIAL` (`src/lib/workout-status.ts`).
  - Lifecycle counters (`accumulationSessionsCompleted`, `deloadSessionsCompleted`) are incremented on any first transition to a performed status (`COMPLETED` or `PARTIAL`) atomically inside the save-workout transaction (`src/app/api/workouts/save/route.ts`); `transitionMesocycleState()` is then called post-transaction to apply threshold-based state transitions.
- Lifecycle thresholds are duration-aware: accumulation completes after `(durationWeeks - 1) * sessionsPerWeek` performed sessions and deload completes after `sessionsPerWeek` performed sessions.
- Save route persists session-level cycle context only inside `selectionMetadata.sessionDecisionReceipt`; top-level `selectionMetadata.cycleContext` is no longer a supported write shape. When upstream omits a canonical receipt, the route computes a receipt-backed cycle snapshot or falls back to `source: "fallback"` (`src/app/api/workouts/save/route.ts`).

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
  - intent route returns `selectionMetadata` and optional debug `selection`, both carrying canonical `sessionDecisionReceipt`
  - template route returns `selection`, carrying canonical `sessionDecisionReceipt`
- Generation routes canonicalize receipt readiness/autoregulation fields through shared selection metadata helpers rather than returning ad hoc top-level session mirrors (`src/lib/ui/selection-metadata.ts`, `src/lib/api/template-session/types.ts`).

## Workout explanation response contract
- Route: `GET /api/workouts/[id]/explanation` (`src/app/api/workouts/[id]/explanation/route.ts`).
- Response includes `progressionReceipts` keyed by `exerciseId` in addition to `exerciseRationales` and `prescriptionRationales`.
- Receipt payload shape is defined by `ProgressionReceipt` in `src/lib/evidence/types.ts` and populated by `generateWorkoutExplanation()` in `src/lib/api/explainability.ts`.
- `ProgressionSetSummary` now supports `performedAt` for historical evidence timestamps (`src/lib/evidence/types.ts`), and receipt history is recency-bounded in `loadLatestPerformedSetSummary()` (`src/lib/api/explainability.ts`).
- Session context payload now carries cycle/readiness contract fields (`sessionContext.cycleSource`, `sessionContext.readinessStatus.availability`, `sessionContext.readinessStatus.label`) defined in `src/lib/engine/explainability/types.ts` and produced by `explainSessionContext()` in `src/lib/engine/explainability/session-context.ts`.
