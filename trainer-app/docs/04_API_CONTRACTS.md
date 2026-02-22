# 04 API Contracts

Owner: Aaron  
Last reviewed: 2026-02-22  
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
- Workouts: `src/app/api/workouts/**`
- Logging: `src/app/api/logs/set/route.ts`
- Program/periodization/readiness: `src/app/api/program/route.ts`, `src/app/api/periodization/macro/route.ts`, `src/app/api/readiness/submit/route.ts`, `src/app/api/stalls/route.ts`
- Templates: `src/app/api/templates/**`
- Exercises and preferences: `src/app/api/exercises/**`, `src/app/api/preferences/route.ts`
- Analytics: `src/app/api/analytics/**`
- Profile/session support: `src/app/api/profile/setup/route.ts`, `src/app/api/session-checkins/route.ts`

## Program dashboard response notes
- Route: `GET /api/program` (`src/app/api/program/route.ts`) returns `loadProgramDashboardData()` output directly.
- `ProgramDashboardData` now includes `daysPerWeek` (`src/lib/api/program.ts`) sourced from user constraints and used by clients to avoid hardcoded frequency assumptions.

## Validation-backed contracts (examples)
- Workout generation/save: `generateFromTemplateSchema`, `generateFromIntentSchema`, `saveWorkoutSchema`
- Logging: `setLogSchema`
- Templates: `createTemplateSchema`, `updateTemplateSchema`, `addExerciseToTemplateSchema`
- Profile/readiness/analytics: `profileSetupSchema`, `readinessSignalSchema`, `analyticsSummarySchema`
- Save payload supports explainability/runtime metadata passthrough for persisted workouts via `saveWorkoutSchema` fields `wasAutoregulated` and `autoregulationLog` in `src/lib/validation.ts` and persistence in `src/app/api/workouts/save/route.ts`.

## Workout save terminal transition contract
- Route: `POST /api/workouts/save` (`src/app/api/workouts/save/route.ts`).
- Request action enum (validation source): `WORKOUT_SAVE_ACTION_VALUES` in `src/lib/validation.ts`.
- Terminal transitions are action-based:
  - `mark_completed` => finalize as `COMPLETED` or auto-normalize to `PARTIAL` when unresolved sets remain.
  - `mark_partial` => finalize as `PARTIAL`.
  - `mark_skipped` => finalize as `SKIPPED`.
- `save_plan` cannot finalize terminal statuses (`COMPLETED`, `PARTIAL`, `SKIPPED`); terminal `status` in a plan write is ignored and persisted status remains non-terminal/current.
- Completion gating: `mark_completed` requires at least one performed non-skipped set log; otherwise route returns `409`.
- Program advancement split:
  - Performed-signal readers use `COMPLETED` + `PARTIAL` (`src/lib/workout-status.ts`).
  - Mesocycle advancement increments on transition to `COMPLETED` only (`src/app/api/workouts/save/route.ts`).
- Save route normalizes/persists cycle context into `selectionMetadata.cycleContext`; when not supplied upstream it writes a fallback snapshot with `source: "fallback"` (`deriveCycleContext()` in `src/app/api/workouts/save/route.ts`).

## Workout explanation response contract
- Route: `GET /api/workouts/[id]/explanation` (`src/app/api/workouts/[id]/explanation/route.ts`).
- Response includes `progressionReceipts` keyed by `exerciseId` in addition to `exerciseRationales` and `prescriptionRationales`.
- Receipt payload shape is defined by `ProgressionReceipt` in `src/lib/evidence/types.ts` and populated by `generateWorkoutExplanation()` in `src/lib/api/explainability.ts`.
- `ProgressionSetSummary` now supports `performedAt` for historical evidence timestamps (`src/lib/evidence/types.ts`), and receipt history is recency-bounded in `loadLatestPerformedSetSummary()` (`src/lib/api/explainability.ts`).
- Session context payload now carries cycle/readiness contract fields (`sessionContext.cycleSource`, `sessionContext.readinessStatus.availability`, `sessionContext.readinessStatus.label`) defined in `src/lib/engine/explainability/types.ts` and produced by `explainSessionContext()` in `src/lib/engine/explainability/session-context.ts`.
