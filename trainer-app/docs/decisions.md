# Architectural Decisions

Record of significant design decisions and their rationale. Newest first.

---

## ADR-031: SRA windows read from DB muscle metadata with constant fallback (2026-02-11)

**Decision**:
- `buildMuscleRecoveryMap()` now prefers per-muscle SRA windows from mapped exercise metadata (`Exercise.muscleSraHours`, sourced from `Muscle.sraHours`).
- Falls back to `volume-landmarks.ts` `sraHours` constants when DB-derived values are unavailable.
- Supports a runtime kill switch: `USE_DB_SRA_WINDOWS=false` forces constants-only behavior.

**Rationale**: `Muscle.sraHours` is already seeded and aligned with current constants. Reading it at runtime removes duplicated source-of-truth drift risk while preserving deterministic fallback behavior and a safe operational rollback path.

**Note**: This supersedes the "constants-only" part of ADR-012 for SRA windows.

---

## ADR-030: Completion-aware history semantics in engine planning/progression (2026-02-10)

**Decision**:
- Added shared history helpers in `src/lib/engine/history.ts` for completion checks and date-stable ordering.
- Standardized progression/planning consumers to use completion-aware history:
  - `apply-loads.ts` history index
  - `volume.ts` volume context
  - `filtering.ts` stall detection
  - `utils.ts` recency index
- Updated fatigue derivation to resolve the most recent history entry by date, not by input array position.
- Updated split advancement compatibility to count completed legacy entries (`completed: true`) even when `status` is missing, while still honoring `advancesSplit !== false`.

**Rationale**: Planned/in-progress sessions were contaminating progression and volume logic, and fatigue derivation could regress when history ordering was inconsistent. A shared completion/date contract removes ambiguity across modules, preserves backward compatibility for legacy history records, and keeps split/progression behavior consistent with persisted workout state semantics.

**Reference**: `docs/engine-audit-remediation-2026-02-10.md`.

---

## ADR-029: Canonical exercise preferences by ID + transactional toggles (2026-02-10)

**Decision**:
- Added `UserPreference.favoriteExerciseIds` and `UserPreference.avoidExerciseIds` as canonical preference storage.
- Kept legacy `favoriteExercises`/`avoidExercises` arrays for backward compatibility and settings UX continuity.
- Exercise library favorite/avoid status now resolves by ID first, with legacy name fallback.
- Favorite/avoid toggle endpoints now use serializable transactions with retry on write conflicts.
- `sortExercises(..., { field: "muscleGroup" })` now sorts by canonical mapped muscle group instead of `primaryMuscles[0]` order.
- Exercise detail substitute generation now uses user constraints when available and a short-lived in-process cache for the substitution pool.
- Verification script now deep-normalizes contraindication JSON to avoid false drift mismatches from nested key ordering.

**Rationale**: Name-based preference identity is brittle under exercise renames and can produce stale or lost preference behavior. ID-based identity removes rename fragility while preserving existing UI and engine behavior. Toggle endpoints previously used non-atomic read-modify-write updates, which were vulnerable to lost updates under concurrency. Serializable transactions with bounded retries provide correct write semantics. Deterministic sorting and deeper normalization remove avoidable non-determinism in UI and verification workflows.

---

## ADR-028: Exercise library filter model refactor (2026-02-10)

**Decision**:
- Replaced single-value exercise-library filters (`muscleGroup`, `muscle`, `movementPattern`, `isCompound`) with multi-select arrays (`muscleGroups[]`, `muscles[]`, `movementPatterns[]`, `exerciseTypes[]`).
- Filter semantics are now explicit: OR within each category, AND across categories.
- Muscle matching for library filters uses primary-muscle mappings only.
- Compact picker mode now exposes the same filters as the full library via a collapsible toggle instead of hiding them.
- Removed legacy single-select `MuscleGroupChips` behavior and deleted `SINGLE_MUSCLE_GROUPS`.
- Expanded movement pattern chips to include the full pattern taxonomy (`carry`, `rotation`, `anti_rotation`, `abduction`, `adduction`, `isolation`), not just the common subset.

**Rationale**: The spec defines multi-select hierarchical muscle filtering and multi-select movement patterns. The previous implementation was single-select and hid advanced filters in the template/preferences picker, which made template assembly slower and made filter behavior feel inconsistent. Aligning the filter contract and UI across library + picker improves discoverability, predictability, and reduces classification confusion caused by missing chip categories.

---

## ADR-027: Single-owner runtime context + set-log upsert semantics (2026-02-10)

**Decision**:
- Runtime identity is now resolved server-side as a canonical owner (`resolveOwner()`); client-supplied `userId` is no longer part of core API contracts.
- ID-based template/workout/log operations enforce owner scoping before mutation or read.
- `SetLog` moved to one-current-record semantics via unique `(workoutSetId)` and route-level `upsert`.
- `/api/workouts/next` was removed; split preview logic is centralized and aligned with generator behavior.

**Rationale**: This app is intentionally single-user long-term, so optional user identity in request payloads was unnecessary complexity and a source of drift. Enforcing owner-scoped operations keeps boundaries explicit and future-proofs for eventual multi-user support. Set logging was previously append-style while reads used `logs[0]`, which could produce stale progression/baseline signals; unique upsert semantics make log reads deterministic.

---

## ADR-026: Exercise rep range clamping in prescription (2026-02-10)

**Decision**: `prescribeSetsReps()` accepts an optional `exerciseRepRange: { min, max }` parameter. When provided, the goal-based rep range is intersected with the exercise's range via `clampRepRange()`. If the intersection is invalid (no overlap), the exercise's range is used as a fallback.

**Rationale**: Exercises like calf raises, face pulls, or lateral raises have biomechanical rep ranges that may not overlap with goal defaults (e.g., strength goal prescribes 3-6 reps, but calf raises are best at 10-20). The exercise's own range, defined in the seed data, is more authoritative than generic goal defaults. The clamping is backward compatible — exercises without `repRangeMin`/`repRangeMax` use goal-based ranges unchanged.

---

## ADR-025: Standardized defaults in mapExercises (2026-02-10)

**Decision**: Changed `fatigueCost`, `sfrScore`, and `lengthPositionScore` defaults in `mapExercises()` from `?? undefined` to `?? 3`. This matches the defaults already used in `loadExerciseLibrary()` and eliminates downstream `?? 3` guards in engine modules.

**Rationale**: The engine modules (`prescription.ts`, `pick-accessories-by-slot.ts`, `filtering.ts`) all assumed these fields could be undefined and applied `?? 3` fallbacks locally. Centralizing the default at the mapping layer reduces redundancy and prevents bugs where a new consumer forgets the fallback.

---

## ADR-024: fatigueCost promoted to ExerciseListItem (2026-02-10)

**Decision**: Moved `fatigueCost` from `ExerciseDetail` to `ExerciseListItem` in the exercise library types. Added the `fatigueCost` sort case to `sortExercises()`. Removed the now-redundant `fatigueCost` from `ExerciseDetail` (it's inherited via `extends ExerciseListItem`).

**Rationale**: The "Lowest Fatigue" sort option in the exercise library was silently falling through to the default name sort because `fatigueCost` wasn't on `ExerciseListItem`. Promoting it follows the same pattern used for `sfrScore` and `lengthPositionScore` (ADR-017). All three scoring fields are now available at the list level for sorting and analysis without requiring a detail-level fetch.

---

## ADR-023: JSON-driven exercise database (133 exercises) (2026-02-09)

**Decision**: Replaced the hardcoded TypeScript exercise arrays (`exercises[]`, `EXERCISE_FIELD_TUNING`, `exerciseMuscleMappings`) in `seed.ts` with a single JSON import from `prisma/exercises_comprehensive.json`. The JSON contains 133 exercises (up from 66) with all metadata: movement patterns, split tags, muscle mappings, equipment, difficulty, rep ranges, and unilateral flags.

**Changes**:
- Schema: Added `Difficulty` enum, `ABDUCTION`/`ADDUCTION`/`ISOLATION` movement patterns, `EZ_BAR`/`TRAP_BAR` equipment types, and new Exercise fields (`difficulty`, `isUnilateral`, `repRangeMin`, `repRangeMax`)
- Muscles: Renamed "Back" → "Lats", removed "Hip Flexors", added "Abs" and "Abductors" (18 total)
- Seed: Complete rewrite — imports JSON, applies 19 exercise renames, renames muscles, seeds 34 aliases, prunes 5 stale exercises
- Engine types: Updated with new movement patterns, equipment types, `Difficulty` type, and optional Exercise fields
- Tests: Updated across 9 test files for muscle renames; seed-validation tests validate JSON directly

**Rationale**: The previous seed used 3 separate parallel data structures (exercise array, tuning map, muscle mapping map) that were hard to keep in sync and limited to 66 exercises. A single JSON file is reviewable, diffable, and extensible. It also eliminates the regex-based derivation that caused classification errors (ADR-021). The 67 new exercises fill gaps in the library: forearm exercises, unilateral variations, ab exercises, adductor/abductor isolation, and more curl/triceps variations.

---

## ADR-022: Baseline unique constraint recovery (2026-02-09)

**Decision**: Manually added the `Baseline_userId_exerciseId_context_key` unique constraint to the database after deduplicating existing rows. The constraint was defined in `schema.prisma` (`@@unique([userId, exerciseId, context])`) but was missing from the actual database.

**Rationale**: The migration `20260206_schema_improvements` was marked as applied by Prisma, but the `ADD CONSTRAINT` statement failed silently because duplicate `(userId, exerciseId, context)` rows existed. This caused `prisma.baseline.upsert()` to fail with "no unique or exclusion constraint matching the ON CONFLICT specification." The fix was to deduplicate rows first (`DELETE FROM "Baseline" a USING "Baseline" b WHERE a."userId" = b."userId" AND a."exerciseId" = b."exerciseId" AND a."context" = b."context" AND a."id" < b."id"`), then add the constraint manually. This is a one-time recovery, not a new migration — the schema already declares the constraint correctly.

**Lesson**: Prisma `migrate deploy` can mark a migration as applied even when individual statements within it fail. After migration issues, always verify the actual DB state matches the schema.

---

## ADR-021: Explicit exercise categorization — no regex (2026-02-09)

**Decision**: Replaced regex-based `resolveMovementPatternsV2()` and `resolveSplitTag()` in `seed.ts` with explicit `movementPatterns`, `splitTag`, `isCompound`, and `isMainLiftEligible` fields on each `SeedExercise`. Deleted all regex constants (`HORIZONTAL_PUSH_REGEX`, etc.), `compoundAccessoryNames`, and `mainLiftEligibleOverrides`.

**Rationale**: The regex approach derived structured data (movement pattern) from unstructured data (exercise name), causing widespread misclassification: curls were tagged `HORIZONTAL_PULL`, triceps pushdowns as `HORIZONTAL_PUSH`, leg extensions as `SQUAT`, calf raises as `CARRY`. These errors made exercise library filters return empty results for shoulders, arms, legs, compound, and isolation categories. Explicit assignment follows the same pattern already used for muscle mappings and equipment — each exercise's categorization is visible, reviewable, and has zero edge cases.

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

## ADR-016: Template session generation - enforce budget with pre/post timeboxing, don't advance split (2026-02-09; updated 2026-02-11)

**Decision**: Template-based workout generation (`generateWorkoutFromTemplate`) enforces `sessionMinutes` with pre-load accessory trimming (projected warmup ramps included for load-resolvable main lifts) and keeps post-load trimming in `applyLoads(...)` as a safety net. Saved template workouts set `advancesSplit: false` so they don't rotate the PPL split queue.

**Rationale**: Template sessions must honor user time constraints and stay behaviorally consistent with auto-generation while template-only mode deprecates the auto path. Pre-load trimming removes most avoidable second-pass trims; post-load trimming remains necessary when projected and assigned warmups diverge (for example, unresolved-load main lifts producing no ramp sets). Template workouts still should not advance the PPL rotation because they operate outside that queue.

**Implementation**: `generateWorkoutFromTemplate()` is a pure engine module in `template-session.ts` that accepts selected exercises, prescribes sets/reps/rest, applies pre-load timeboxing using projected warmup ramps, and enforces volume caps. The API layer (`src/lib/api/template-session.ts`) loads template + workout context in parallel for template mode, derives `weekInBlock` and `mesocycleLength`, maps to engine types, passes `sessionMinutes`, then applies loads via `applyLoads()` for final load assignment and post-load safety-net trimming. Intent mode now uses shared deterministic exercise selection before calling the same prescription/load pipeline. `/api/workouts/generate` and `engine.ts` remain removed, and split-queue UI artifacts remain removed from active pages.

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

