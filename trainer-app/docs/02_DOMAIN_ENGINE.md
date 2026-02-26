# 02 Domain Engine

Owner: Aaron
Last reviewed: 2026-02-26
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
- `MANUAL` selection mode bypasses mesocycle continuity enforcement by design; continuity pinning only applies to auto/intention-generated sessions.
- For `INTENT` generation, active mesocycle `CORE_COMPOUND` role exercises for the matching intent are required fixtures (pre-assigned before beam search), not optional scored candidates.
- When a mesocycle role exists, section/main-accessory mapping is role-driven:
  - `CORE_COMPOUND -> MAIN`
  - `ACCESSORY -> ACCESSORY`
  - Exercise metadata defaults are only used when no mesocycle role exists.
- Intent role-list completeness is server-owned: a role list is complete iff the current mesocycle has at least one `CORE_COMPOUND` and at least one `ACCESSORY` role for that intent; client `roleListIncomplete=false` is ignored, while `roleListIncomplete=true` can force incomplete-mode reselection.
- Role continuity set floors are lifecycle-budget constrained in accumulation weeks: continuity progression cannot exceed lifecycle weekly muscle targets or W4 MAV caps unless prior-week continuity floors already exceed those caps (no mid-mesocycle reduction in that case).
- `MANUAL` sessions are ingested into progression with confidence discounting and anomaly-aware downgrades (see MANUAL Session Contract below) rather than treated as equal-signal to `INTENT` by default.

## Progression and load assignment
- Progression math is implemented in `src/lib/engine/progression.ts`.
- Load assignment and fallback logic are implemented in `src/lib/engine/apply-loads.ts`.
- Historical training signals are mapped from persisted workouts/logs in `mapHistory()` within `src/lib/api/workout-context.ts`.
- Performed-history filtering (not completed-only filtering) is canonical for load progression and plateau/deload checks via `filterPerformedHistory()` and `isPerformedHistoryEntry()` in `src/lib/engine/history.ts`.
- Effective-reps filtering is enforced at signal derivation: sets logged below `RPE 6` are excluded from modal-load and progression anchoring (data is still persisted).
- Intermediate double-progression decision tree is enforced for load updates (hold at high fatigue; progress load only when reps/RPE thresholds are met; use conservative anchoring under high intra-session load variance).
- Progression outlier thresholds and sample-size confidence scaling are centralized in `PROGRESSION_CONFIG` (`src/lib/engine/progression.ts`) and emitted into progression decision logs.
- Bodyweight working sets are canonicalized at write-time to `actualLoad=0` when `targetLoad=0`; `null` is not treated as canonical bodyweight load.
- Bodyweight progression is rep-driven only at `anchorLoad=0` in `computeDoubleProgressionDecision()`; the engine never auto-increments external load from `0` and logs `bodyweight exercise — rep progression only`.
- Empty performed logs are invalid (`LOGGED_EMPTY` is rejected on write); unresolved sets should remain `MISSING` and are treated as unresolved during completion status resolution.
- On first session of a new mesocycle (`accumulationSessionsCompleted=0` or explicit first-session flag), load anchoring history is sourced from accumulation history only: prefer week-4 accumulation, else highest available accumulation week, else any non-deload performed history; deload (`DELOAD`/`ACTIVE_DELOAD`) snapshots are excluded as baseline sources.

## Periodization and readiness
- Macro/meso/block logic lives in `src/lib/engine/periodization`.
- Readiness, fatigue scoring, and autoregulation logic lives in `src/lib/engine/readiness`.
- API orchestration for readiness and periodization endpoints lives in `src/lib/api/readiness.ts` and `src/lib/api/periodization.ts`.

## Workout status semantics
- The split exists to separate adaptation signals from advancement control: partially performed work should inform future load/selection, while schedule/phase advancement remains a stricter completion event.
- Performed-signal consumers use `COMPLETED` + `PARTIAL` via `PERFORMED_WORKOUT_STATUSES` in `src/lib/workout-status.ts`.
- Program advancement remains `COMPLETED` only via `ADVANCEMENT_WORKOUT_STATUSES` in `src/lib/workout-status.ts`.
- Mesocycle lifecycle progression is driven by first transition into performed status (`COMPLETED` or `PARTIAL`). Lifecycle counters (`accumulationSessionsCompleted`, `deloadSessionsCompleted`) are incremented atomically inside the save-workout transaction in `src/app/api/workouts/save/route.ts`; `transitionMesocycleState()` in `src/lib/api/mesocycle-lifecycle.ts` reads the already-incremented counters and applies state transitions when thresholds are reached.
- Canonical mesocycle progression counters are `accumulationSessionsCompleted` and `deloadSessionsCompleted` (not `completedSessions`) and drive lifecycle week/phase derivation.

## Mesocycle lifecycle service
- Service file: `src/lib/api/mesocycle-lifecycle.ts`.
- `transitionMesocycleState(mesocycleId)`: increments accumulation/deload counters, transitions state (`ACTIVE_ACCUMULATION` -> `ACTIVE_DELOAD` -> `COMPLETED`), and initializes the next mesocycle when deload is complete.
- `getCurrentMesoWeek(mesocycle)`: derives effective lifecycle week from `state`, `accumulationSessionsCompleted`, and `sessionsPerWeek`.
- `getWeeklyVolumeTarget(mesocycle, muscleGroup, week)`: returns lifecycle week-specific target sets from mesocycle ramp semantics and landmarks. Landmark values (MEV/MAV/MRV) are sourced from `VOLUME_LANDMARKS` in `src/lib/engine/volume-landmarks.ts` (single source of truth; the former local `INTERMEDIATE_LANDMARKS` table has been removed).
- Weekly accumulation targets are linearly interpolated from `MEV` (W1) to `MAV` (W4): W2/W3 use 1/3 and 2/3 interpolation; deload remains `~45%` of W4.
- Pull musculature landmarks are split (`lats`, `upper_back`) and rear-delt landmarks are reduced to evidence-aligned defaults (`rear_delts: MEV 4, MAV 12`; `lats: MEV 8, MAV 16`; `upper_back: MEV 6, MAV 14`).
- `getRirTarget(mesocycle, week)`: returns lifecycle week/state-specific RIR bands, including deload targets.
- `initializeNextMesocycle(completedMesocycle)`: closes current mesocycle, creates next active mesocycle with reset lifecycle counters, and carries forward core exercise roles.

## Deload generation path
- Deload generation has a separate pipeline in `src/lib/api/template-session/deload-session.ts`.
- Route hard gate:
  - `POST /api/workouts/generate-from-intent` (`src/app/api/workouts/generate-from-intent/route.ts`) routes to `generateDeloadSessionFromIntent()` when active mesocycle state is `ACTIVE_DELOAD`.
  - `POST /api/workouts/generate-from-template` (`src/app/api/workouts/generate-from-template/route.ts`) routes to `generateDeloadSessionFromTemplate()` when active mesocycle state is `ACTIVE_DELOAD`.
- During `ACTIVE_DELOAD`, normal accumulation generation paths are unreachable from these routes.

## Explainability
- Explainability domain modules are in `src/lib/engine/explainability`.
- API composition for workout explanations is in `src/lib/api/explainability.ts`.
- Explanation endpoint is `src/app/api/workouts/[id]/explanation/route.ts`.
- Workout explanations include per-exercise progression receipts (`WorkoutExplanation.progressionReceipts` in `src/lib/engine/explainability/types.ts`), derived from performed history and current prescription in `src/lib/api/explainability.ts`.
- Session context now includes cycle provenance and readiness availability labels (`SessionContext.cycleSource`, `ReadinessStatus.availability`, `ReadinessStatus.label`) in `src/lib/engine/explainability/types.ts`, produced in `src/lib/engine/explainability/session-context.ts`.
- Explainability consumes persisted cycle context from `selectionMetadata.cycleContext` when available and falls back safely when missing/invalid via `parseCycleContext()` in `src/lib/api/explainability.ts`.
- Progression receipts only use recent performed evidence (42-day recency window) when loading `lastPerformed` in `loadLatestPerformedSetSummary()` within `src/lib/api/explainability.ts`.
- Progression receipts include a decision log summarizing which load-progression rule path fired and why.
- Explainability renders per-exercise progression decision logs in the Evidence tab under `Progression Logic` when logs are available.
- Workout explanations include per-muscle weekly volume compliance (`WorkoutExplanation.volumeCompliance` in `src/lib/engine/explainability/types.ts`), computed by `computeVolumeCompliance()` in `src/lib/api/explainability.ts`. Per-muscle compliance is annotated with `VolumeComplianceStatus` — one of `OVER_MAV | AT_MAV | APPROACHING_MAV | OVER_TARGET | ON_TARGET | APPROACHING_TARGET | UNDER_MEV` — and carries projected weekly totals against week-specific targets.

## Session Composition Constraints
- Canonical session composition caps:
  - `minExercises=3`
  - `maxExercises=6`
  - `maxDirectSetsPerMuscle=12`
- These caps are represented by `SESSION_CAPS` in `src/lib/api/template-session/selection-adapter.ts` and must remain aligned with selection-v2 enforcement comments/rules.

## MANUAL Session Contract
- MANUAL bypasses:
  - Mesocycle role continuity enforcement
  - Lifecycle RIR band prescription
  - Intent/beam exercise-selection logic
- MANUAL still enforces:
  - Lifecycle counter advancement when workout enters performed status
  - Performed-history inclusion for progression (with confidence scaling/discounting)
  - Set-log persistence and audit trail semantics
- MANUAL anomaly handling during progression-context ingestion:
  - Uniform-RPE sessions (`variance=0`) flagged as synthetic
  - Modal load below 50% of most recent INTENT modal load for same exercise flagged as implausible regression
  - `RPE=10` on >50% of sets flagged as unsustainable effort
  - Anomalous MANUAL entries remain included but are downgraded to confidence `0.3`
