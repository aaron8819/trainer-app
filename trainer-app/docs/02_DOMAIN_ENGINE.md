# 02 Domain Engine

Owner: Aaron  
Last reviewed: 2026-02-21  
Purpose: Canonical reference for workout-generation domain logic, including selection, progression, periodization, readiness, and explainability.

This doc covers:
- Selection and session construction
- Progression/load assignment
- Periodization and readiness/autoregulation
- Explainability generation

Invariants:
- Selection and generation logic live in `src/lib/engine` and are invoked by `src/lib/api`.
- Persisted session enums must stay aligned with `docs/contracts/runtime-contracts.json`.
- Logged set data is the primary progression feedback input.

Sources of truth:
- `trainer-app/src/lib/engine/selection-v2`
- `trainer-app/src/lib/engine/progression.ts`
- `trainer-app/src/lib/engine/template-session.ts`
- `trainer-app/src/lib/engine/periodization`
- `trainer-app/src/lib/engine/readiness`
- `trainer-app/src/lib/engine/explainability`
- `trainer-app/src/lib/api/template-session.ts`
- `trainer-app/src/lib/api/workout-context.ts`

## Selection and generation
- Intent and template generation both rely on engine-level session construction and selection primitives.
- Selection-v2 beam search implementation is under `src/lib/engine/selection-v2`.
- Template session orchestration bridges API data to engine inputs in `src/lib/api/template-session.ts`.

## Progression and load assignment
- Progression math is implemented in `src/lib/engine/progression.ts`.
- Load assignment and fallback logic are implemented in `src/lib/engine/apply-loads.ts`.
- Historical training signals are mapped from persisted workouts/logs in `mapHistory()` within `src/lib/api/workout-context.ts`.
- Performed-history filtering (not completed-only filtering) is canonical for load progression and plateau/deload checks via `filterPerformedHistory()` and `isPerformedHistoryEntry()` in `src/lib/engine/history.ts`.

## Periodization and readiness
- Macro/meso/block logic lives in `src/lib/engine/periodization`.
- Readiness, fatigue scoring, and autoregulation logic lives in `src/lib/engine/readiness`.
- API orchestration for readiness and periodization endpoints lives in `src/lib/api/readiness.ts` and `src/lib/api/periodization.ts`.

## Workout status semantics
- The split exists to separate adaptation signals from advancement control: partially performed work should inform future load/selection, while schedule/phase advancement remains a stricter completion event.
- Performed-signal consumers use `COMPLETED` + `PARTIAL` via `PERFORMED_WORKOUT_STATUSES` in `src/lib/workout-status.ts`.
- Program advancement remains `COMPLETED` only via `ADVANCEMENT_WORKOUT_STATUSES` in `src/lib/workout-status.ts`.
- Mesocycle advancement is incremented only on transition to `COMPLETED` in `src/app/api/workouts/save/route.ts` (`completedSessions` update path).

## Explainability
- Explainability domain modules are in `src/lib/engine/explainability`.
- API composition for workout explanations is in `src/lib/api/explainability.ts`.
- Explanation endpoint is `src/app/api/workouts/[id]/explanation/route.ts`.
- Workout explanations include per-exercise progression receipts (`WorkoutExplanation.progressionReceipts` in `src/lib/engine/explainability/types.ts`), derived from performed history and current prescription in `src/lib/api/explainability.ts`.
- Session context now includes cycle provenance and readiness availability labels (`SessionContext.cycleSource`, `ReadinessStatus.availability`, `ReadinessStatus.label`) in `src/lib/engine/explainability/types.ts`, produced in `src/lib/engine/explainability/session-context.ts`.
- Explainability consumes persisted cycle context from `selectionMetadata.cycleContext` when available and falls back safely when missing/invalid via `parseCycleContext()` in `src/lib/api/explainability.ts`.
- Progression receipts only use recent performed evidence (42-day recency window) when loading `lastPerformed` in `loadLatestPerformedSetSummary()` within `src/lib/api/explainability.ts`.
