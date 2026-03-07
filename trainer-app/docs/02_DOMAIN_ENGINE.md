# 02 Domain Engine

Owner: Aaron
Last reviewed: 2026-03-07
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
- Template session orchestration bridges API data to engine inputs in `src/lib/api/template-session.ts`, with dedicated seams in `src/lib/api/template-session/role-budgeting.ts` and `src/lib/api/template-session/closure-actions.ts`.
- `MANUAL` selection mode bypasses mesocycle continuity enforcement by design; continuity pinning only applies to auto/intention-generated sessions.
- For `INTENT` generation, active mesocycle `CORE_COMPOUND` role exercises for the matching intent are required fixtures (pre-assigned before beam search), not optional scored candidates.
- When a mesocycle role exists, section/main-accessory mapping is role-driven:
  - `CORE_COMPOUND -> MAIN`
  - `ACCESSORY -> ACCESSORY`
  - Exercise metadata defaults are only used when no mesocycle role exists.
- Intent role-list completeness is server-owned: a role list is complete iff the current mesocycle has at least one `CORE_COMPOUND` and at least one `ACCESSORY` role for that intent; client `roleListIncomplete=false` is ignored, while `roleListIncomplete=true` can force incomplete-mode reselection.
- Role continuity set floors are lifecycle-budget constrained in accumulation weeks: continuity progression cannot exceed lifecycle weekly muscle targets or the peak-accumulation MAV cap for the configured mesocycle length unless prior-week continuity floors already exceed those caps (no mid-mesocycle reduction in that case).
- `CORE_COMPOUND` role exercises are hard-capped at `MAIN_LIFT_MAX_WORKING_SETS = 5` working sets in role-budgeting logic (`src/lib/api/template-session/role-budgeting.ts`). This cap fires after the continuity ramp, preventing back-off set accumulation from exceeding prescription.
- `MANUAL` sessions are ingested into progression with confidence discounting and anomaly-aware downgrades (see MANUAL Session Contract below) rather than treated as equal-signal to `INTENT` by default.

## Stimulus accounting boundaries
- Exercise taxonomy (`primaryMuscles`, `secondaryMuscles`, split/pattern metadata) remains classification/filtering input and explainability language input; it is not the canonical hypertrophy contribution math source.
- Canonical hypertrophy contribution math is the weighted `stimulusProfile` model on engine exercises (`src/lib/engine/types.ts`) and must flow through shared helpers in `src/lib/engine/stimulus.ts`:
  - `resolveStimulusProfile()`
  - `getEffectiveStimulusByMuscleId()`
  - `getEffectiveStimulusByMuscle()`
- Effective-set accounting surfaces (`effectiveActual`, planning deficits, session planning contributions, volume compliance) are expected to consume that shared stimulus helper path rather than re-deriving contribution ad hoc.
- Transitional fallback policy for missing explicit profiles is centralized in `src/lib/engine/stimulus.ts` and coverage-checked in `src/lib/api/template-session/context-loader.ts` via `validateStimulusProfileCoverage()`.
- Strict fallback enforcement is controlled by `STRICT_STIMULUS_PROFILE_COVERAGE` in `src/lib/api/template-session/context-loader.ts`.
- Coverage reporting command is `npm run report:stimulus-coverage` (`scripts/report-stimulus-profile-coverage.ts`).

## Role and closure guardrails
- Mesocycle exercise roles are anchors for continuity and structure; role-list presence is not a session sufficiency stop condition.
- Session sufficiency remains deficit/constraint outcome-based and includes closure passes when material unresolved deficits remain (`src/lib/api/template-session/closure-actions.ts` via `src/lib/api/template-session.ts` orchestration).
- Closure candidate and action diagnostics are persisted in planner diagnostics to keep ranking/filtering decisions auditable from receipts (`src/lib/planner-diagnostics/types.ts`, `src/lib/evidence/session-decision-receipt.ts`).
- Deterministic tie-breaking is required for equivalent-score closure candidates to keep audits/regressions stable (`src/lib/api/template-session/closure-actions.ts`).

## Progression and load assignment
- Progression math is implemented in `src/lib/engine/progression.ts`.
- Load assignment and fallback logic are implemented in `src/lib/engine/apply-loads.ts`.
- Historical training signals are mapped from persisted workouts/logs in `mapHistory()` within `src/lib/api/workout-context.ts`.
- Performed-history filtering (not completed-only filtering) is canonical for load progression and plateau/deload checks via `filterPerformedHistory()` and `isPerformedHistoryEntry()` in `src/lib/engine/history.ts`.
- Effective-reps filtering is enforced at signal derivation: sets logged below `RPE 6` are excluded from modal-load and progression anchoring (data is still persisted).
- Intermediate double-progression decision tree is enforced for load updates (hold at high fatigue; progress load only when reps/RPE thresholds are met; use conservative anchoring under high intra-session load variance).
- `computeDoubleProgressionDecision()` in `src/lib/engine/progression.ts` accepts an optional `anchorOverride` parameter. When provided it replaces the modal-load computation as the progression anchor. Used by `resolveLoadForExercise()` in `src/lib/engine/apply-loads.ts` to anchor main lifts (non-modal path) to the top-set load rather than the more-frequent back-off weight, preventing a phantom ~11% load reduction each session.
- Progression outlier thresholds and sample-size confidence scaling are centralized in `PROGRESSION_CONFIG` (`src/lib/engine/progression.ts`) and emitted into progression decision logs.
- Bodyweight working sets are canonicalized at write-time to `actualLoad=0` when `targetLoad=0`; `null` is not treated as canonical bodyweight load.
- `estimateLoad()` in `src/lib/engine/apply-loads.ts` returns `undefined` (no estimate) for exercises whose equipment list includes `"bodyweight"` when no non-zero load history exists. This prevents phantom load assignments on hybrid bodyweight/machine exercises (e.g., Dip) on their first weighted use.
- Bodyweight progression is rep-driven only at `anchorLoad=0` in `computeDoubleProgressionDecision()`; the engine never auto-increments external load from `0` and logs `bodyweight exercise — rep progression only`.
- Empty performed logs are invalid (`LOGGED_EMPTY` is rejected on write); unresolved sets should remain `MISSING` and are treated as unresolved during completion status resolution.
- On first session of a new mesocycle (`accumulationSessionsCompleted=0` or explicit first-session flag), load anchoring history is sourced from accumulation history only: prefer week-4 accumulation, else highest available accumulation week, else any non-deload performed history; deload (`DELOAD`/`ACTIVE_DELOAD`) snapshots are excluded as baseline sources.

## Periodization and readiness
- Macro/meso/block logic lives in `src/lib/engine/periodization`.
- Readiness, fatigue scoring, and autoregulation logic lives in `src/lib/engine/readiness`.
- API orchestration for readiness and periodization endpoints lives in `src/lib/api/readiness.ts` and `src/lib/api/periodization.ts`.
- Session-decision ownership is receipt-first. The canonical flow is defined once in `docs/01_ARCHITECTURE.md`; domain logic here assumes session-level cycle/readiness context is carried only by `selectionMetadata.sessionDecisionReceipt` and parsed by `src/lib/evidence/session-decision-receipt.ts`.
- Default readiness autoregulation policy is conservative down-regulation only (`allowUpRegulation=false`) unless explicitly overridden by policy input (`src/lib/engine/readiness/types.ts`, `src/lib/engine/readiness/autoregulate.ts`).

## Evidence and rule guardrails
- Reactive deload logic in `shouldDeload()` is evidence-gated and requires stronger signals (sustained low-readiness streak or repeated main-lift plateau evidence) rather than flat total-session-rep plateaus alone (`src/lib/engine/progression.ts`, `src/lib/engine/progression.correctness.test.ts`).
- Intent alignment enforcement is diagnostics-first by default (`minRatio=0` unless explicitly requested), with explicit intent diagnostics returned on selection output (`src/lib/api/template-session/intent-filters.ts`).
- Post-hoc optimizer stretch swapping is removed; final selection remains optimizer-owned (`src/lib/engine/selection-v2/optimizer.evidence.test.ts`).

## Workout status semantics
- The split exists to separate adaptation signals from advancement control: partially performed work should inform future load/selection, while schedule/phase advancement remains a stricter completion event.
- Performed-signal consumers use `COMPLETED` + `PARTIAL` via `PERFORMED_WORKOUT_STATUSES` in `src/lib/workout-status.ts`.
- Program advancement remains `COMPLETED` only via `ADVANCEMENT_WORKOUT_STATUSES` in `src/lib/workout-status.ts`.
- Mesocycle lifecycle progression is driven by first transition into performed status (`COMPLETED` or `PARTIAL`). Lifecycle counters (`accumulationSessionsCompleted`, `deloadSessionsCompleted`) are incremented atomically inside the save-workout transaction in `src/app/api/workouts/save/route.ts`; status/action resolution is isolated in `src/app/api/workouts/save/status-machine.ts`; `transitionMesocycleState()` in the lifecycle facade (`src/lib/api/mesocycle-lifecycle.ts`) applies state transitions when thresholds are reached.
- Canonical mesocycle progression counters are `accumulationSessionsCompleted` and `deloadSessionsCompleted` (not `completedSessions`) and drive lifecycle week/phase derivation.

## Optional session policy (gap-fill)
- Phase-1 optional sessions reuse canonical INTENT generation (`intent=body_part`) and do not introduce a separate planner path (`src/lib/api/template-session.ts`).
- Pending week-close context is canonical for gap-fill week anchoring. `generateSessionFromIntent()` now passes `optionalGapFillContext.targetWeek` into `loadMappedGenerationContext()` so accumulation lifecycle math is pinned from the pending week-close row rather than route-local receipt rewriting (`src/lib/api/template-session.ts`, `src/lib/api/template-session/context-loader.ts`).
- Gap-fill policy read model is surfaced by `loadHomeProgramSupport()` (`src/lib/api/program.ts`) with fields:
  - `requiredSessionsPerWeek`
  - `maxOptionalGapFillSessionsPerWeek`
  - `maxGeneratedHardSets`
  - `maxGeneratedExercises`
- Current default policy: required sessions = active mesocycle `sessionsPerWeek` (min 1), max optional sessions/week = 1, max hard sets = 12, max exercises = 4.
- Override precedence is policy-first and split-agnostic: policy values are resolved centrally in `program.ts`; generation/save do not fork by split type.
- Strict classification for optional sessions uses the shared triplet predicate in `src/lib/gap-fill/classifier.ts`.
- Canonical optional-session receipt/metadata stamping is shared in `src/lib/ui/selection-metadata.ts`; generation and UI callers attach `weekCloseId`, `targetMuscles`, and the `optional_gap_fill` exception through `attachOptionalGapFillMetadata()` instead of duplicating route/component-local mutation logic.

## Gap-fill decision order
1. Compute anchor gate from lifecycle boundary: active accumulation + `accumulationSessionsCompleted % requiredSessionsPerWeek === 0`.
2. Apply next-week suppression: `PLANNED` does not suppress; `IN_PROGRESS`/`PARTIAL` suppress.
3. Enforce weekly optional cap using strict classification (`optional_gap_fill` + `INTENT` + `BODY_PART`) when counting is enabled; missing marker never counts as gap-fill.
4. Resolve deficits and target muscles for the pending week-close `targetWeek` only.
5. Fail closed when canonical week-bounded data is insufficient.

## Mesocycle lifecycle service
- Facade: `src/lib/api/mesocycle-lifecycle.ts`.
- Math module: `src/lib/api/mesocycle-lifecycle-math.ts` (week derivation, RIR targets, lifecycle volume targets).
- State module: `src/lib/api/mesocycle-lifecycle-state.ts` (state transitions + next-mesocycle initialization).
- `transitionMesocycleState(mesocycleId)`: transitions state (`ACTIVE_ACCUMULATION` -> `ACTIVE_DELOAD` -> `COMPLETED`) and initializes the next mesocycle when deload is complete.
- `getCurrentMesoWeek(mesocycle)`: derives effective lifecycle week from `state`, `durationWeeks`, `accumulationSessionsCompleted`, and `sessionsPerWeek`. Accumulation weeks are `durationWeeks - 1`; the final week is deload.
- `getWeeklyVolumeTarget(mesocycle, muscleGroup, week)`: returns lifecycle week-specific target sets from mesocycle ramp semantics and landmarks. Landmark values (MEV/MAV/MRV) are sourced from `VOLUME_LANDMARKS` in `src/lib/engine/volume-landmarks.ts`.
- Weekly accumulation targets are interpolated via centralized helper `interpolateWeeklyVolumeTarget()` in `src/lib/engine/volume-targets.ts`; deload remains `~45%` of peak accumulation volume.
- Pull musculature landmarks are split (`lats`, `upper_back`) and rear-delt landmarks are reduced to evidence-aligned defaults (`rear_delts: MEV 4, MAV 12`; `lats: MEV 8, MAV 16`; `upper_back: MEV 6, MAV 14`).
- `getRirTarget(mesocycle, week)`: returns lifecycle week/state-specific RIR bands, including deload targets. Default hypertrophy bands are duration-aware: 4-week total = `3-4 -> 2-3 -> 1-2 -> deload`; 5-week total = `3-4 -> 2-3 -> 1-2 -> 0-1 -> deload`; 6-week total = `3-4 -> 2-3 -> 2 -> 1-2 -> 0-1 -> deload`.
- `initializeNextMesocycle(completedMesocycle)`: closes current mesocycle, creates next active mesocycle with reset lifecycle counters, and carries forward core exercise roles.

## Deload generation path
- Deload generation has a separate pipeline in `src/lib/api/template-session/deload-session.ts`.
- Route hard gate:
  - `POST /api/workouts/generate-from-intent` (`src/app/api/workouts/generate-from-intent/route.ts`) routes to `generateDeloadSessionFromIntent()` when active mesocycle state is `ACTIVE_DELOAD`.
  - `POST /api/workouts/generate-from-template` (`src/app/api/workouts/generate-from-template/route.ts`) routes to `generateDeloadSessionFromTemplate()` when active mesocycle state is `ACTIVE_DELOAD`.
- During `ACTIVE_DELOAD`, normal accumulation generation paths are unreachable from these routes.

## Explainability
- Explainability domain modules are in `src/lib/engine/explainability`.
- API explainability facade is `src/lib/api/explainability.ts`, split into `src/lib/api/explainability/query.ts` (read/query) and `src/lib/api/explainability/assembly.ts` (response assembly/scoring).
- Explanation endpoint is `src/app/api/workouts/[id]/explanation/route.ts`.
- Workout explanations include per-exercise progression receipts (`WorkoutExplanation.progressionReceipts` in `src/lib/engine/explainability/types.ts`), derived from performed history and current prescription in `src/lib/api/explainability.ts`.
- Session context now includes cycle provenance and readiness availability labels (`SessionContext.cycleSource`, `ReadinessStatus.availability`, `ReadinessStatus.label`) in `src/lib/engine/explainability/types.ts`, produced in `src/lib/engine/explainability/session-context.ts`.
- Explainability is strictly receipt-first: it reads session-level cycle/readiness context only from `selectionMetadata.sessionDecisionReceipt`, and missing canonical receipt means missing session-level evidence (`src/lib/evidence/session-decision-receipt.ts`, `src/lib/api/explainability.ts`, `src/lib/ui/explainability.ts`).
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
