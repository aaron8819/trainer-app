# Architectural Decisions

Record of significant design decisions and their rationale. Newest first.

---

## ADR-041: Remove all legacy selection code (2026-02-15)

**Status:** Implemented

**Context:**
Phase 2 (ADR-040) archived legacy selection to `src/lib/engine/legacy/`. After production validation with zero issues, all legacy code can be safely deleted. No production users exist, so backward compatibility is not required.

**Decision:**
Delete all legacy selection code:
1. `src/lib/engine/legacy/` - Entire directory (2,182 lines)
   - `exercise-selection.ts` - Greedy algorithm
   - `exercise-selection.test.ts` - 11 tests
   - `README.md` - Archive documentation
2. Secondary legacy modules (966 lines):
   - `filtering.ts` - Old selection entry point
   - `pick-accessories-by-slot.ts` - Slot-based selection
   - `pick-accessories-by-slot.test.ts` - 7 tests
3. Unused utilities:
   - `src/lib/api/split-preview.ts` - Split preview utility
   - `src/lib/api/split-preview.test.ts` - 2 tests
4. Deprecated calibration scripts (3 files):
   - `scripts/audit-intent-selection.ts`
   - `scripts/calibrate-selection-weights.ts`
   - `scripts/generate-intent-session-review.ts`

**Total deleted:** 10 files, 3,100+ lines of dead code

**Verification:**
- Zero active imports confirmed via grep
- Tests passing after deletion (20 legacy tests removed)
- Build succeeds, lint passes
- No API routes reference deleted code

**Consequences:**
- ✅ Single source of truth (selection-v2 only)
- ✅ 3,100 fewer lines to maintain
- ✅ Reduced cognitive load for future development
- ✅ Git history preserves code for reference if needed
- ✅ Clean production codebase ready for Phase 3 (autoregulation)

**References:** ADR-036, ADR-040, redesign-overview.md Phase 2

---

## ADR-040: Clean cut-over to selection-v2 (2026-02-14)

**Status:** Implemented

**Context:**
After deploying selection-v2 to production, post-deployment issue revealed architectural problem: legacy timeboxing logic in `applyLoads()` was trimming exercises AFTER beam search selection, causing metadata mismatch (7 selected → 5 shown).

**Problem:**
- Beam search selected 7 exercises optimally
- Legacy timeboxing trimmed to 5 post-hoc to fit time budget
- Metadata showed "7 selected" but only 5 exercises displayed
- Dual-mode complexity (new selection + legacy trimming) caused confusion
- No production users yet, so safe to make breaking changes

**Decision:**
Execute clean cut-over to selection-v2 architecture:
1. Remove legacy timeboxing trimming from `applyLoads()` (lines 203-224)
2. Archive legacy selection code to `src/lib/engine/legacy/`
3. Remove `selectExercises()` export from engine barrel
4. Extract shared types (`SessionIntent`, `ColdStartStage`, `SelectionOutput`) to `session-types.ts`
5. Update API imports to use selection-v2 exclusively

**Consequences:**
- ✅ Single source of truth (selection-v2 is the only path)
- ✅ No metadata mismatch (selected count matches displayed)
- ✅ Cleaner architecture (no dual-mode complexity)
- ✅ 559 engine tests passing
- ⚠️ Timeboxing enforcement temporarily removed (will be added to beam search later)
- ⚠️ Template mode still has legacy timeboxing in `generateWorkoutFromTemplate()` (technical debt)

**Deferred Work:**
- Timeboxing architecture design (where and how it should work)
- Move timeboxing into beam search as hard constraint (not post-processing)
- Remove legacy timeboxing from template generation

**Files Changed:**
- `src/lib/engine/apply-loads.ts`: Removed trimming loop, kept `estimateWorkoutMinutes()` for metadata only
- `src/lib/engine/legacy/exercise-selection.ts`: Archived with deprecation notice
- `src/lib/engine/legacy/exercise-selection.test.ts`: Archived
- `src/lib/engine/session-types.ts`: New file for shared session types
- `src/lib/engine/index.ts`: Export `session-types` and `selection-v2`, removed `exercise-selection`
- `src/lib/api/template-session.ts`: Import types from `session-types.ts`
- `src/lib/engine/apply-loads.test.ts`: Removed legacy timeboxing test

**Reference:** See `src/lib/engine/legacy/README.md` for archival rationale.

---

## ADR-035: Block-aware prescription modifiers (2026-02-14)

**Decision**:
- Added `prescribeWithBlock()` in `src/lib/engine/periodization/prescribe-with-block.ts` to apply block-specific modifiers to exercise prescriptions.
- Modifiers adjust volume (via `volumeMultiplier`), intensity (via `rirAdjustment`), and rest periods (via `restMultiplier`) based on training block type and week within block.
- Accumulation blocks: Higher volume (1.0 → 1.2), reduced intensity (RIR +2), shorter rest (0.9x).
- Intensification blocks: Moderate volume (1.0 → 0.8), higher intensity (RIR +1), normal rest (1.0x).
- Realization blocks: Low volume (0.6 → 0.7), max intensity (RIR +0), longer rest (1.2x).
- Deload blocks: 50% volume, low intensity (RIR +3), short rest (0.8x for active recovery).
- `blockContext` parameter is optional in session generation for backward compatibility.

**Rationale**: Evidence-based periodization requires systematic variation of volume and intensity across training phases. Block-specific modifiers allow the engine to adapt prescriptions to match periodization goals (accumulation for volume tolerance, intensification for adaptation, realization for peak performance, deload for recovery). Progressive modifiers within each block (based on `weekInBlock / durationWeeks`) provide smooth training stimulus progression.

**Reference**: `src/lib/engine/periodization/prescribe-with-block.ts`, `src/lib/engine/periodization/prescribe-with-block.test.ts` (18 tests).

---

## ADR-039: Deficit-driven session variation (2026-02-14)

**Status:** Accepted

**Context:**
Deficit-driven selection produces focused sessions based on remaining volume gaps:
- Push workout 1: Chest/triceps filled → 15 chest sets, 7.5 effective triceps sets
- Push workout 2: Side delt deficit remains → all shoulder exercises selected

User feedback: "all shoulders, no chest/triceps" breaks PPL expectations.

**Analysis:**

*Evidence-based validity:*
- Volume landmarks are weekly per-muscle (Renaissance Periodization framework)
- Frequency is the vehicle for distributing volume, not a goal itself
- Focusing shoulders after chest/triceps are filled is scientifically correct

*UX/semantic issue:*
- PPL split implies balanced coverage per session type
- Users expect "push" = chest + shoulders + triceps in every session
- Current behavior is algorithmically correct but semantically confusing

*Rejected alternatives:*

1. **Muscle group balance constraint** (maxExercisesPerMuscleGroup)
   - Violates deficit-driven optimization (core benefit of selection-v2)
   - Forces unnecessary exercises when volume already met
   - Band-aid fix that doesn't address root cause
   - Reduces training efficiency

2. **Weight tuning** (increase movementDiversity, reduce volumeDeficitFill)
   - Attempted but reverted: movementDiversity 0.15, volumeDeficitFill 0.30
   - Result: FAILED - identical focused sessions regardless of weights
   - Root cause: Candidates scored once at initialization, beam can't adapt based on beam state
   - **Decision:** Reverted to original weights (0.40 deficit, 0.05 diversity) because deficit-driven optimization is evidence-based and movement diversity is architecturally ineffective until Phase 3

3. **Defer to Phase 3** (beam state tracking)
   - Phase 3 won't change this behavior - deficit-driven selection is the goal
   - Beam state tracking enables movement diversity WITHIN deficit-driven framework
   - Doesn't solve the semantic labeling issue

**Decision:**
Accept deficit-driven session variation as correct behavior. Document as expected in architecture.md.

Future enhancement (Phase 4): Add session focus labels ("Push - Chest Focus", "Push - Shoulder Focus") to clarify intent.

**Consequences:**
- ✅ Maintains deficit-driven optimization (evidence-based)
- ✅ Maximizes training efficiency (no redundant volume)
- ✅ Enables focused sessions based on individual recovery/volume needs
- ⚠️ May confuse users expecting balanced sessions
- ⚠️ Requires clear documentation of session focus semantics

---

## ADR-038: Exercise rotation name-based lookup (2026-02-14)

**Status:** Implemented

**Context:**
ExerciseExposure table tracks usage by exercise NAME (not ID). Initial implementation used exercise.id as rotation context key, causing 100% accessory repeat (rotation system completely non-functional).

**Decision:**
Rotation context keyed by exercise.name to match ExerciseExposure schema:
- `RotationContext = Map<string, ExposureData>` where key is exercise NAME
- `scoreRotationNovelty()` looks up by `exercise.name`
- Test helpers use `createMockExercise(id)` with `name === id` for simplicity

**Consequences:**
- ✅ Rotation system functional (0% → 100% rotation rate)
- ✅ Matches DB schema (ExerciseExposure.exerciseName primary key)
- ✅ Prevents accessory staleness
- ⚠️ Name-based lookup fragile (renames break tracking)

---

## ADR-037: Structural constraints for workout balance (2026-02-14)

**Status:** Implemented

**Context:**
Initial beam search implementation produced structurally invalid workouts:
- Workout 1: 8 accessories, 0 main lifts
- Workout 2: 1 main lift, 0 accessories

Root cause: No constraints enforcing balance between main lifts and accessories.

**Decision:**
Add structural constraints to SelectionObjective:
- `minMainLifts`: 1 for PPL splits, 0 for body_part splits
- `maxMainLifts`: 3 (prevent over-fatigue)
- `minAccessories`: 2 (ensure variety)

Enforcement via `wouldSatisfyStructure()` in beam expansion phase.

**Consequences:**
- ✅ Guarantees balanced workouts (main lifts + accessories)
- ✅ Prevents degenerate cases (all accessories OR only main lift)
- ✅ Maintains flexibility (different minimums for PPL vs body_part)
- ⚠️ Adds complexity to beam search validation

---

## ADR-036: Multi-objective selection with beam search (2026-02-14)

**Status:** Implemented

**Context:**
Greedy selection (v1) optimizes individual picks but produces suboptimal combinations:
- Front delts receive direct work (OHP) after heavy indirect volume from bench
- Accessories repeat too frequently without rotation policy
- No consideration of exercise exposure patterns

**Decision:**
Replace greedy selection with multi-objective beam search optimizer (selection-v2):
- Beam width = 5, max depth = 8
- 7 weighted objectives: volume deficit fill (0.40), rotation novelty (0.25), SFR efficiency (0.15), movement diversity (0.05), lengthened bias (0.10), SRA readiness (0.03), user preference (0.02)
- Hard constraints: equipment, contraindications, volume ceiling, time budget, structural balance
- Indirect volume accounting: effective = direct + (indirect × 0.3)
- Integration with ExerciseExposure rotation tracking

**Consequences:**
- ✅ Prevents redundant selections (indirect volume properly accounted)
- ✅ Enforces rotation (accessories change every 3-4 weeks)
- ✅ Multi-objective optimization finds better combinations
- ✅ Structural constraints ensure balanced workouts (1-3 main lifts, 2+ accessories)
- ⚠️ Increased complexity vs greedy (beam search logic)
- ⚠️ Performance overhead (2000 state evaluations typical)
- ⚠️ Candidates scored once at initialization, beam can't adapt to beam state

---

## ADR-034: Macro cycle generation with nested structures (2026-02-14)

**Decision**:
- Added `generateMacroCycle()` in `src/lib/engine/periodization/generate-macro.ts` to generate complete MacroCycle → Mesocycle → TrainingBlock hierarchies.
- Block templates vary by training age:
  - Beginner: 3-week accumulation + 1-week deload (4-week meso).
  - Intermediate: 2-week accumulation + 2-week intensification + 1-week deload (5-week meso).
  - Advanced: 2-week accumulation + 2-week intensification + 1-week realization + 1-week deload (6-week meso).
- Macro cycles fill available duration with complete mesocycles (e.g., 12-week macro = 3× beginner mesos).
- Mesocycle focus rotates between "Upper Body Hypertrophy", "Lower Body Strength", "Full Body Power", etc.
- All IDs assigned deterministically via `createId()` for reproducibility.

**Rationale**: Evidence-based periodization structures training into distinct phases with specific adaptation goals. Beginner templates use simpler structures (accumulation/deload only) while advanced templates include all block types for maximal adaptation. Rotating mesocycle focus ensures balanced development across muscle groups and qualities. Nested creation in a single transaction ensures data integrity.

**Reference**: `src/lib/engine/periodization/generate-macro.ts`, `src/lib/engine/periodization/generate-macro.test.ts` (34 tests).

---

## ADR-033: Periodization-first training system foundation (2026-02-14)

**Decision**:
- Added periodization schema: `MacroCycle`, `Mesocycle`, `TrainingBlock`, `ExerciseExposure` models.
- Added `Workout.trainingBlockId`, `Workout.weekInBlock`, `Workout.blockPhase` for block context tracking.
- Created engine types (`BlockType`, `VolumeTarget`, `IntensityBias`, `AdaptationType`, `BlockContext`, `PrescriptionModifiers`) with lowercase string unions.
- Created Prisma ↔ engine type mappers following existing patterns (UPPER_CASE ↔ lowercase).
- Block context derivation (`deriveBlockContext()`) resolves current training block from macro cycle + workout date.
- API helper (`loadCurrentBlockContext()`) loads user's active macro cycle and derives block context.
- Integrated block context into workout generation: `loadMappedGenerationContext()` → `generateWorkoutFromTemplate()` → `prescribeWithBlock()` → `applyLoads()`.

**Rationale**: The previous system used simple 4-week periodization blocks without structured progression. True periodization requires hierarchical training structures (macro → meso → block) with systematic variation of volume/intensity/rest. The new system provides a foundation for evidence-based training progression while maintaining backward compatibility (all new fields nullable, blockContext optional). Engine purity is preserved by keeping all periodization logic in `src/lib/engine/periodization/` with no DB access.

**Impact**: This is a foundational change that enables future enhancements (multi-objective selection, autoregulation, exercise rotation tracking). The system gracefully degrades when no macro cycle exists (returns null block context, uses base prescriptions).

**Reference**: Phase 1 implementation plan, `src/lib/engine/periodization/` modules, backfill scripts.

---

## ADR-032: Exercise exposure tracking for rotation management (2026-02-14)

**Decision**:
- Added `ExerciseExposure` model to track per-user exercise usage patterns.
- Fields track usage in L4W/L8W/L12W windows, last usage date, and average sets/volume per week.
- Backfill script (`backfill-exercise-exposure.ts`) aggregates from completed workout history.
- Uses `WorkoutSet.logs[0]` for actual performance data, falls back to target data if no logs exist.

**Rationale**: Intelligent exercise rotation requires tracking historical exposure across multiple time windows. L4W/L8W/L12W granularity matches evidence-based exercise variation recommendations (rotate exercises every 4-12 weeks). Tracking average volume per week enables future auto-regulation features. Using SetLog data (when available) provides more accurate exposure metrics than targets alone.

**Reference**: `scripts/backfill-exercise-exposure.ts`.

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


## ADR-042: Fix structural constraint enforcement in beam search (2026-02-14)

**Context:** Beam search was selecting 0 main lifts for pull workouts despite `minMainLifts: 1` constraint. Investigation revealed two issues: (1) structural constraints weren't validated in `buildResult()`, allowing `constraintsSatisfied: true` with 0 main lifts; (2) time budget exhaustion prevented main lift addition during enforcement phase.

**Problem:** High-scoring accessories filled time budget before enforcement step ran. When `enforceStructuralConstraints()` tried to add main lifts, all candidates exceeded the 65min budget (~72-75min each). Main lifts require longer rest periods (3-5min vs 1-2min for accessories), consuming more time per set.

**Decision:**
1. **Added structural constraint validation** in `buildResult()` - now checks `minMainLifts`, `maxMainLifts`, `minAccessories` alongside existing exercise count / volume / time checks
2. **Implemented swap mechanism** in `enforceStructuralConstraints()` - when a main lift can't be added due to constraints, iteratively removes lowest-scoring accessories until it fits
3. **Aligned 5 exercise classifications with knowledgebase**:
   - Low-Incline Dumbbell Press (push) → main lift
   - Chest-Supported Row (pull) → main lift
   - Seated Cable Row (pull) → main lift
   - Hack Squat (legs) → main lift
   - Leg Press (legs) → main lift

**Implementation:**
- `buildResult()`: Added `meetsStructuralConstraints` check combining main lift and accessory counts
- `enforceStructuralConstraints()`: Greedily adds required main lifts/accessories; calls `trySwapForMainLift()` when direct addition fails
- `trySwapForMainLift()`: Removes accessories (lowest-score-first) until main lift fits within time/volume budgets
- `canAddCandidate()`: Unified constraint checking for both direct adds and swaps

**Rationale:** Knowledgebase recommends compounds (weighted pull-ups, barbell rows, squats, leg press) as foundation exercises. Allowing beam search to skip all main lifts violates evidence-based programming principles. Swap mechanism preserves scoring optimization while enforcing minimum structural requirements.

**Evidence alignment:** Verified against `docs/knowledgebase/hypertrophyandstrengthtraining_researchreport.md` sections on exercise selection. KB explicitly lists chest-supported rows, seated cable rows, hack squats, and leg press as "top exercises" for their muscle groups.

**Result:** Pull workouts now include 1-3 main lifts (T-Bar Row, Pull-Up, Barbell Row, etc.). Push/legs verified working. All 14 beam-search tests pass. Main lift totals: push (9), pull (7), legs (8).

---

## ADR-043: New ReadinessSignal model for multi-source fatigue tracking (2026-02-15)

**Context:** Existing `SessionCheckIn` captures basic readiness (1-5 scale) and pain flags but lacks granularity for evidence-based autoregulation. Research shows fatigue is multi-dimensional (physiological, psychological, performance-based) and requires composite scoring.

**Decision:** Created standalone `ReadinessSignal` model instead of enhancing `SessionCheckIn`. New model includes:
- Whoop data fields (recovery, strain, HRV, sleep quality/duration)
- Subjective signals (readiness, motivation, stress, per-muscle soreness)
- Performance signals (RPE deviation, stall count, volume compliance)
- Computed fatigue score (overall + per-muscle breakdown)

**Rationale:**
1. **Separation of concerns**: `SessionCheckIn` is tightly coupled to workout generation (pain flags influence exercise selection). `ReadinessSignal` serves autoregulation, a distinct use case.
2. **Schema evolution**: Adding 10+ fields to `SessionCheckIn` would bloat its interface and break backward compatibility.
3. **Composite scoring**: Fatigue score requires weighted aggregation of multiple signals (Whoop 50%, subjective 30%, performance 20%). This is better computed once and stored rather than derived on-the-fly.
4. **Historical tracking**: Separate table enables time-series analysis of fatigue patterns without joining workout history.

**Alternative considered:** Enhance `SessionCheckIn` with new fields. Rejected because:
- Creates dependency between check-in UI and autoregulation logic
- Pain flags and readiness serve different purposes (safety vs intensity modulation)
- Whoop integration would add OAuth complexity to existing check-in flow

**Reference:** Phase 3 implementation in `src/lib/engine/readiness/`, `POST /api/readiness/submit`

---

## ADR-044: Stub Whoop integration with graceful degradation (2026-02-15)

**Context:** Whoop recovery data is a valuable fatigue signal (HRV, sleep, strain) but requires OAuth integration, API credentials, and external service reliability. Phase 3 focuses on proving autoregulation value before investing in integration complexity.

**Decision:** Implemented Whoop interface with stubbed returns (`fetchWhoopRecovery()` → `null`, `refreshWhoopToken()` → throws). System gracefully degrades when Whoop is unavailable:
- Fatigue score weights auto-adjust: Whoop 0% → Subjective 60% (+30%), Performance 40% (+20%)
- All autoregulation logic remains functional using subjective + performance signals only
- `UserIntegration` schema exists for future OAuth (provider, tokens, expiresAt)

**Rationale:**
1. **De-risk rollout**: Prove autoregulation works with subjective signals before adding external dependencies
2. **User value first**: Users can benefit from fatigue-aware programming immediately without Whoop devices
3. **Future-proof schema**: `UserIntegration` table supports multiple providers (Whoop, Garmin, Apple Health)
4. **Testability**: Stubbed integration enables deterministic testing without API mocking

**Implementation path:**
- Phase 3: Stub (current)
- Phase 4: Whoop OAuth + real API calls
- Phase 5: Additional providers (Garmin, Apple Health)

**Reference:** `src/lib/api/readiness.ts` (`fetchWhoopRecovery`, `refreshWhoopToken`), ADR-043

---

## ADR-045: Progressive stall intervention ladder (2026-02-15)

**Context:** Previous stall detection was binary (stalled / not stalled) with generic "deload or vary" advice. Research on plateau breaking shows escalating interventions are more effective than immediate drastic changes.

**Decision:** Implemented 5-level intervention ladder based on weeks without progress:
1. **2 weeks** → `microload`: +1-2 lbs increments instead of +5 lbs (linear progression fatigue)
2. **3 weeks** → `deload`: -10% load, rebuild over 2-3 weeks (accumulated fatigue)
3. **5 weeks** → `variation`: Swap exercise (e.g., flat bench → incline) (adaptation plateau)
4. **8 weeks** → `volume_reset`: Drop to MEV, rebuild over 4 weeks (chronic overreaching)
5. **12+ weeks** → `goal_reassess`: Re-evaluate training goals (structural limitation)

**Rationale:**
1. **Graduated response**: Matches intervention intensity to problem severity. Microloading addresses early plateaus without disrupting training; volume reset addresses chronic overreaching.
2. **Evidence alignment**: Knowledgebase references progressive overload, deloads, and variation as standard plateau-breaking strategies. Ladder formalizes this progression.
3. **Actionable guidance**: Each level provides specific instructions ("use +1-2 lbs" vs vague "change something")
4. **Timing transparency**: User sees weeks without progress, understands why intervention is suggested

**Alternative considered:** Fixed 3-week threshold with user-selected intervention. Rejected because:
- Places decision burden on user who may not know best strategy
- Doesn't account for severity differences (2 weeks vs 12 weeks)
- Lacks progressive escalation built into training science

**Reference:** `src/lib/engine/readiness/stall-intervention.ts`, `GET /api/stalls`, knowledgebase plateau section

---

## ADR-046: Continuous 0-1 fatigue score vs discrete 1-5 scale (2026-02-15)

**Context:** User input uses discrete 1-5 scales (readiness, motivation, stress, soreness 1-3) for simplicity. Autoregulation needs precise scaling decisions (e.g., -7% load vs -10%).

**Decision:** Normalize all inputs to 0-1 continuous scale, compute weighted fatigue score (0-1), use for autoregulation decisions. UI displays percentage (0-100%) with color coding.

**Rationale:**
1. **Precision**: Continuous scale supports fine-grained adjustments. Fatigue 0.35 (35%) can trigger -10% load; 0.32 (32%) might trigger -5%. Discrete 1-5 loses this granularity.
2. **Weighted aggregation**: Multi-signal scoring (Whoop 50%, subjective 30%, performance 20%) requires normalized inputs. Can't meaningfully weight "3 out of 5" + "72% HRV" + "0.2 stall rate".
3. **Algorithmic flexibility**: Decision thresholds (0.3, 0.5, 0.85) are easily tuned. Discrete scales require remapping logic ("3 out of 5" → which action?).
4. **Physiological grounding**: Research-based fatigue markers (HRV, RPE deviation) are inherently continuous, not categorical.

**Normalization formulas** (from `computeFatigueScore()`):
- Readiness: `(readiness - 1) / 4` → maps 1-5 to 0-1
- Soreness: `1 - ((soreness - 1) / 2)` → maps 1-3 to 1.0-0.0 (inverted, higher soreness = lower score)
- Whoop recovery: `recovery / 100` → maps 0-100% to 0-1
- RPE deviation: `max(0, 1 - abs(deviation) / 2)` → caps at 0 for ±2 RPE miss

**UI presentation**: Displays as percentage with color bands (0-30% red, 30-50% orange, 50-80% yellow, 80-100% green) for interpretability.

**Reference:** `src/lib/engine/readiness/compute-fatigue.ts`, `ReadinessCheckInForm.tsx`

---

## ADR-047: Autoregulation at route level vs deep in generation logic (2026-02-15)

**Context:** Autoregulation modifies workout intensity/volume based on fatigue. Two integration points considered: (1) deep in engine during exercise selection/prescription, (2) post-generation at route level before returning to client.

**Decision:** Applied autoregulation at route level (`POST /api/workouts/generate-from-template`, `POST /api/workouts/generate-from-intent`) via `applyAutoregulation()` wrapper after `generateSessionFromTemplate()` / intent generation completes.

**Rationale:**
1. **Separation of concerns**: Engine generates ideal workout assuming recovered state. Autoregulation is a modulation layer based on readiness context. Clean boundary.
2. **Testability**: Engine tests validate generation logic independently. Autoregulation tests validate adjustment logic independently. No coupling.
3. **Auditability**: `autoregulationLog` in DB clearly shows what changed and why. Deep integration would lose this transparency.
4. **Flexibility**: Easy to disable autoregulation (skip `applyAutoregulation()` call) or apply different policies per user without touching engine.
5. **Template preservation**: Templates store ideal prescriptions. Autoregulation adjusts instance execution without mutating template definition.

**Implementation:**
```typescript
// Route level (src/app/api/workouts/generate-from-template/route.ts)
const result = await generateSessionFromTemplate(userId, templateId);
const autoregulated = await applyAutoregulation(userId, result.workout);
return { workout: autoregulated.adjusted, autoregulation: { ... } };
```

**Alternative considered:** Pass `fatigueScore` to engine, apply adjustments during prescription. Rejected because:
- Mixes generation logic (what to select) with modulation logic (how to adjust)
- Complicates testing (need to inject fatigue score into all engine tests)
- Harder to trace what changed (no clear before/after diff)

**Reference:** `src/lib/api/autoregulation.ts`, `src/app/api/workouts/*/route.ts`, ADR-001 (engine purity)

---

## ADR-048: Per-muscle fatigue penalty in overall score (2026-02-15)

**Context:** Phase 3 computes per-muscle fatigue scores from soreness input (1-3 scale) but only used them for tracking. The overall fatigue score (0-1) was computed purely from multi-signal integration (Whoop + subjective + performance) without considering localized muscle soreness. This created a mismatch: a user with very sore quads (3/3) but otherwise good readiness (5/5) would receive 90% fatigue score and minimal autoregulation, despite needing aggressive scale-down on quad-dominant exercises.

**Decision:** Apply 20% worst-muscle penalty to overall fatigue score. Formula changed from:

```
overall = baseScore
```

to:

```
overall = baseScore * 0.8 + worstMuscleFatigue * 0.2
```

where `worstMuscleFatigue = min(perMuscle values)` if soreness data exists, else 1.0 (fresh).

**Rationale:**

1. **Localized damage matters**: DOMS (delayed onset muscle soreness) in one muscle group (e.g., quads after heavy squats) should reduce training readiness more than global subjective scores capture. A user might feel mentally ready (high motivation) but physically compromised in specific muscles.

2. **20% weight balances sensitivity**:
   - Very sore muscle (fatigue 0.0) pulls down overall score by 20% max (e.g., 90% → 72%)
   - Fresh muscles (fatigue 1.0) add 20% boost to low base scores (e.g., 40% → 52%)
   - Moderate soreness (fatigue 0.5) has neutral impact (e.g., 90% → 82%)

3. **Triggers autoregulation appropriately**: Example scenario:
   - User: Readiness 5/5, Motivation 5/5 → base score 90% (maintain)
   - Quads: Very sore (3/3) → fatigue 0.0
   - Overall: 90% * 0.8 + 0% * 0.2 = 72% → scale-down action
   - **Result**: Workout gets -10% load, +1 RIR on all exercises (uniform, not per-muscle)

4. **Simpler than per-exercise penalties**: Alternative considered was applying differential penalties per exercise based on muscle targets (e.g., scale squats more than RDLs when quads sore). Rejected because:
   - More complex logic (muscle-exercise mapping, partial overlap handling)
   - Harder to test and validate
   - Uniform workout scaling already achieves goal of preventing overload when any muscle is very sore
   - Can revisit per-exercise approach in Phase 4 if needed

**Alternatives considered:**

- **No penalty (status quo)**: Rejected. Localized soreness doesn't influence autoregulation, leading to overtraining scenarios.
- **50% worst-muscle weight**: Too aggressive. Base score 90% + sore muscle (0%) → 45% overall, triggering deload unnecessarily.
- **Per-exercise differential scaling**: More complex, harder to implement/test. Uniform scaling via overall score is simpler and achieves 80% of the value.

**Example outcomes:**

| Base Score | Soreness | Worst Muscle Fatigue | Overall Score | Action |
|---|---|---|---|---|
| 90% | None | 1.0 (fresh) | 90% * 0.8 + 1.0 * 0.2 = 92% | Maintain |
| 90% | Quads 3/3 | 0.0 (exhausted) | 90% * 0.8 + 0.0 * 0.2 = 72% | Scale down |
| 90% | Legs 2/3 | 0.5 (moderate) | 90% * 0.8 + 0.5 * 0.2 = 82% | Maintain |
| 40% | Quads 3/3 | 0.0 (exhausted) | 40% * 0.8 + 0.0 * 0.2 = 32% | Deload |

**Reference:** `src/lib/engine/readiness/compute-fatigue.ts` (lines 42-62), `compute-fatigue.test.ts` (tests: "should apply per-muscle penalty when one muscle is very sore", "should not apply significant penalty when all muscles are fresh")

---

