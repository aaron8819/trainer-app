# Architectural Decisions

Record of significant design decisions and their rationale. Newest first.

---

## ADR-020: Analytics dashboard with recharts (2026-02-09)

**Decision**: Added a tabbed analytics dashboard at `/analytics` using `recharts` for charting. Four tabs: Recovery (progress bars), Volume (bar chart + line chart), Overview (pie chart), Templates (stat cards). Each tab fetches from dedicated API endpoints.

**Rationale**: Users need visibility into their training patterns — muscle recovery status, volume trends relative to landmarks, push/pull/legs balance, and template usage. Recharts was chosen for its React-native API and SSR compatibility (all chart components use `"use client"` directive). Dedicated API routes keep the analytics data pipeline separate from workout generation.

---

## ADR-019: Smart Build — training goal bias and time budget (2026-02-09)

**Decision**: `smartBuild()` accepts optional `trainingGoal` (strength/hypertrophy/fat_loss/general_health) and `timeBudgetMinutes`. Goal bias adjusts exercise scoring and compound count. Time budget trims the exercise list after ordering by cumulative `sets * (timePerSetSec + restSec)`.

**Rationale**: Different goals call for different exercise compositions — strength training needs more compounds, hypertrophy benefits from high-SFR isolations. Time budgets allow users to constrain template length without manually trimming. Trimming happens after ordering (not during selection) so the highest-quality exercises are preserved.

---

## ADR-018: Schema cleanup — drop V1 movementPattern, remove isMainLift from Exercise (2026-02-09)

**Decision**: Dropped `Exercise.movementPattern` (V1 singular enum) and renamed `movementPatternsV2` to `movementPatterns` across the codebase. Dropped `Exercise.isMainLift` (kept `WorkoutExercise.isMainLift` for historical data). All fallback patterns `?? exercise.isMainLift` changed to `?? false`, using `isMainLiftEligible` as the sole source of truth.

**Rationale**: The V1 `movementPattern` was a coarse single-value enum superseded by the V2 array (which supports multiple fine-grained patterns like horizontal_push + vertical_push). Keeping both created mapping complexity in every consumer. Similarly, `isMainLift` on Exercise was redundant with `isMainLiftEligible` — the former was a static seed value while the latter reflects actual engine selection criteria. The V1→V2 pattern mapping was handled via a `matchesV1Pattern()` helper during the transition, and `WorkoutHistoryEntry` retains a derived V1 pattern for backward compatibility.

---

## ADR-017: Template analysis — 6 scoring dimensions with rebalanced weights (2026-02-09)

**Decision**: Template analysis scores 6 dimensions: muscle coverage (0.30), push/pull balance (0.15), compound/isolation ratio (0.15), movement diversity (0.15), lengthened-position coverage (0.10), and SFR efficiency (0.15). The `sfrScore` and `lengthPositionScore` fields were promoted from `ExerciseDetail` to `ExerciseListItem` so they flow through the exercise library API to all consumers.

**Rationale**: The spec calls for 5 scoring dimensions; we split "movement balance" into push/pull and compound/isolation (already done) and added the two missing evidence-based dimensions. SFR efficiency gets more weight than length-position because fatigue management has a bigger practical impact on training sustainability. Muscle coverage remains the heaviest weight because missing entire muscle groups is the most impactful template deficiency. Promoting the scores to `ExerciseListItem` ensures Smart Build and the analysis panel can access them without requiring full `ExerciseDetail` loads.

---

## ADR-016: Template session generation — skip timeboxing, don't advance split (2026-02-09)

**Decision**: Template-based workout generation (`generateWorkoutFromTemplate`) preserves the full template exercise list without timeboxing. Saved template workouts set `advancesSplit: false` so they don't rotate the PPL split queue.

**Rationale**: When a user defines a template, they've intentionally chosen their exercises — trimming exercises to fit a time budget would undermine the template's purpose. Template workouts also shouldn't advance the PPL rotation because they operate outside the PPL system; a user doing a custom arm day shouldn't cause their next auto-generated session to skip a push/pull/legs day.

**Implementation**: `generateWorkoutFromTemplate()` is a pure engine module in `template-session.ts` that accepts template exercises and prescribes sets/reps/rest using the same `prescribeSetsReps()` and `getRestSeconds()` functions as PPL auto mode. The API layer (`src/lib/api/template-session.ts`) loads template + workout context in parallel, maps to engine types, calls the pure function, then applies loads via `applyLoads()`. SRA warnings are generated but advisory — under-recovered muscles don't cause exercise removal. The dashboard uses a `DashboardGenerateSection` mode selector to toggle between PPL Auto and Template generation.

---

## ADR-015: Template CRUD — delete nullifies workout FK, exercises use full replacement (2026-02-08)

**Decision**: When a template is deleted, associated `Workout.templateId` values are set to null (preserving workout history). When updating a template's exercises, the API uses full replacement (delete all existing + insert new) rather than diffing.

**Rationale**: Deleting a template shouldn't cascade-delete completed workouts — those are historical training data. Nullifying the FK is handled in a transaction in the API layer rather than via Prisma `onDelete: SetNull` to avoid a schema migration. Full replacement for exercises is simpler than diffing (which requires matching by exerciseId + orderIndex) and the exercise list is always small (< 20 items), so the cost is negligible.

---

## ADR-014: History-based PPL split queue (2026-02-08)

**Decision**: PPL split selection now uses `getHistoryBasedSplitDay()` which classifies the last 3 completed sessions by dominant muscle split (via `MUSCLE_SPLIT_MAP`) and picks the least-recently-trained split. Falls back to movement-pattern classification when muscle data is unavailable.

**Rationale**: Position-based split rotation (count % pattern_length) doesn't account for user behavior — skipped sessions, forced splits, or template-based workouts can desynchronize the queue. History-based selection ensures balanced coverage regardless of training pattern irregularities.

---

## ADR-013: SRA as soft penalty, not hard filter (2026-02-08)

**Decision**: Under-recovered muscles (trained within their SRA window) receive a scoring penalty during accessory selection but are not excluded. SRA warnings are included in workout notes.

**Rationale**: Hard filtering could create impossible selection scenarios (e.g., all available exercises target under-recovered muscles). A soft penalty lets the engine gracefully degrade while informing the user.

---

## ADR-012: Volume landmarks as engine constants (2026-02-08)

**Decision**: Per-muscle volume landmarks (MV/MEV/MAV/MRV, SRA hours) live in `volume-landmarks.ts` as pure constants, not queried from the database. The DB Muscle model has corresponding fields for future user customization.

**Rationale**: Volume landmarks are universal, evidence-based scientific data that doesn't vary per user. Keeping them as constants avoids DB round-trips in the pure engine layer. The DB fields exist as a shell for future per-user overrides.

---

## ADR-011: Flexible mesocycles with RIR ramp (2026-02-08)

**Decision**: `getMesocyclePeriodization()` supports 3-6 week mesocycles with a continuous RIR ramp. `getPeriodizationModifiers()` is a backward-compatible wrapper using a fixed 4-week cycle.

**Rationale**: Fixed 4-week blocks don't suit all training ages or goals. Flexible mesocycles allow beginners to use shorter blocks (3 weeks) and advanced lifters to use longer blocks (5-6 weeks). The RIR ramp (3-4 RIR early → 0-1 RIR late) is well-supported by literature.

---

## ADR-010: Training-age-based load progression (2026-02-08)

**Decision**: `computeNextLoad()` dispatches by training age — beginners use linear progression (fixed weight increments), intermediates use double progression (RPE-based), advanced uses autoregulated RPE. RPE adjustment changed from 3% to 4%.

**Rationale**: Beginners progress too fast for RPE-based rules (they can add weight every session). Advanced lifters need wider RPE bands and wave structure. The 4% RPE adjustment provides stronger autoregulatory signals.

---

## ADR-009: Archive completed project docs (2026-02-07)

**Decision**: Move `engine_refactor_2.5.md`, `engine-and-data-model-analysis.md`, and `implementation-plan.md` to `docs/archive/`. Create `architecture.md` as the durable engine reference.

**Rationale**: These docs were project artifacts for the engine refactor (completed 2026-02-06). They're historical records, not active references. Durable content (engine behavior, locked decisions) was extracted into `architecture.md` and this file.

---

## ADR-008: Weighted selection must use seeded PRNG (2026-02-06)

**Decision**: All randomized selection (main lifts, accessories) uses a seeded PRNG (`createRng` from `random.ts`). Tests always pass `randomSeed`.

**Rationale**: Deterministic tests are non-negotiable for a randomized engine. `Math.random()` is only used in production when no seed is provided.

---

## ADR-007: Periodization fallback uses calendar-based weeks (2026-02-06)

**Decision**: When no `ProgramBlock` exists, derive `weekInBlock` from a rolling 4-week window based on the oldest recent workout date.

**Rationale**: Count-based weeks would require tracking workout counts per block. Calendar-based is simpler and matches user expectations ("I'm in week 2 of my block"). Sparse history (< 14 day span) forces week 0 (Introduction) as a safe default.

---

## ADR-006: Hybrid load estimation: history -> baseline -> estimate (2026-02-06)

**Decision**: Load assignment follows a three-tier strategy. Estimation uses muscle-based donor scaling, then bodyweight ratios, then equipment defaults.

**Rationale**: Every exercise should have a target load where possible. The tiered approach gives the best available estimate while being conservative (donor scaling uses fatigueCost clamps, bodyweight ratios are proven, equipment defaults are intentionally low).

---

## ADR-005: Top set / back-off inferred by setIndex (2026-02-06)

**Decision**: No explicit `setType` field. `setIndex == 1` is the top set for main lifts, `setIndex > 1` are back-off sets.

**Rationale**: Adding a `setType` field creates redundancy with `setIndex` and complicates the data model. The convention is simple and unambiguous.

---

## ADR-004: Split queue is perpetual, not weekly-reset (2026-02-06)

**Decision**: PPL rotation advances continuously across weeks. Originally used completed workout count modulo pattern length; **updated in ADR-014** to use history-based classification for PPL splits. Non-PPL splits (upper_lower, full_body) still use position-based rotation.

**Rationale**: Weekly reset causes uneven coverage. Perpetual rotation ensures even coverage. History-based selection (ADR-014) further improves this by adapting to actual training patterns.

---

## ADR-003: Load assignment stays in the API/context layer (2026-02-06)

**Decision**: `applyLoads()` is a pure function in `src/lib/engine/apply-loads.ts`, but it's called from `src/lib/api/workout-context.ts` which supplies DB-sourced history and baselines.

**Rationale**: The engine must remain pure (no DB access). Load assignment needs workout history and baselines which come from the database. The API layer bridges this gap by fetching data and passing it to the pure function.

---

## ADR-002: Baselines use FK-based lookup (2026-02-06)

**Decision**: `Baseline.exerciseId` is a non-nullable FK with unique constraint `(userId, exerciseId, context)`. String-matching fallback removed.

**Rationale**: Name-based matching was fragile (exercise renames, aliases, normalization edge cases). FK-based lookup is O(1) and unambiguous. `ExerciseAlias` table handles legacy name resolution during backfill only.

---

## ADR-001: Engine purity (pre-refactor)

**Decision**: `src/lib/engine/` contains no database access, no I/O, and produces deterministic output given the same inputs + seed.

**Rationale**: Pure computation is testable without mocking, predictable, and portable. The engine can be tested with fixture data (`sample-data.ts`) and seeded PRNG without standing up a database.
