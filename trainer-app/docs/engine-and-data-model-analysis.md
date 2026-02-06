# Engine & Data Model Analysis

Comprehensive analysis of the workout engine (`src/lib/engine/`) and data model (`prisma/schema.prisma`) as of 2026-02-06, with prioritized recommendations.

---

## 1. Engine Architecture

### What Works Well

The core architectural decision — **engine purity** — is sound and well-enforced. The engine accepts typed inputs and produces deterministic outputs with no I/O. This makes it testable, predictable, and portable. The seeded PRNG (`mulberry32`) ensures test reproducibility without sacrificing production randomness.

The **layered design** is clean: route handlers are thin, the `workout-context.ts` bridge handles all DB-to-engine mapping, and `applyLoads` correctly lives outside the engine. The `map*` functions handle the enum casing translation (Prisma UPPER_CASE → engine lowercase) in one place.

The **slot-based accessory selection** is well-designed. Scoring by muscle coverage, stimulus bias, recency, novelty, favorites, and volume awareness produces intelligent and varied selections.

### Issues Found

#### 1.1 Significant Code Duplication — **RESOLVED (Phase 1A)**

~~Six functions were duplicated verbatim between `engine.ts` and `pick-accessories-by-slot.ts`.~~

All shared functions extracted to `src/lib/engine/utils.ts`. All consumers import from there.

#### 1.2 engine.ts Is a 1310-Line Monolith — **RESOLVED (Phase 2)**

~~`engine.ts` contained 1310 lines with 10+ distinct responsibilities.~~

Decomposed into 8 focused modules (engine.ts reduced to ~190 lines as orchestrator):
- `split-queue.ts`, `filtering.ts`, `main-lift-picker.ts`, `prescription.ts`
- `volume.ts`, `timeboxing.ts`, `substitution.ts`, `progression.ts`

Public API (`generateWorkout`) unchanged.

#### 1.3 Non-PPL Splits Don't Use Slot-Based Selection — **RESOLVED (Phase 7B)**

~~Non-PPL paths used a simple loop instead of slot-based selection.~~

`pickAccessoriesBySlot` now accepts `"upper"`, `"lower"`, and `"full_body"` day tags with dedicated slot configurations. A new `back_compound` slot type was added. The non-PPL path in `selectExercises` calls `pickAccessoriesBySlot` via `resolveNonPplDayTag`.

#### 1.4 Double Timeboxing

Both `generateWorkout` (engine.ts:148–159) and `applyLoads` (apply-loads.ts:168–182) independently trim accessories to fit `sessionMinutes`. The engine trims first, then `applyLoads` adds warmup sets (which increase time) and may need to trim again.

This is defensive and correct, but creates a subtle issue: the engine trims without load information (it can't estimate warmup set time accurately), then `applyLoads` may trim further after adding warmup sets. The result is that the engine's trim decisions are sometimes wasted.

**Recommendation**: This is acceptable for now. If it becomes a problem (e.g., too-short workouts), consider deferring all timeboxing to `applyLoads` where warmup set time is known. This would mean the engine produces a "fat" plan and the context layer does final trimming. Low priority.

#### 1.5 Dead and Underused Code — **PARTIALLY RESOLVED (Phase 1B, 4B)**

- ~~**`adjustForFatigue`** was dead code~~ — **Removed in Phase 1B.**
- **`suggestSubstitutes`** still not surfaced in UI, but **tests added in Phase 4B** (8 tests) to prevent rot.
- The **`progressionRule` parameter** to `generateWorkout` remains — only overrides `targetRpe`. Deferred: acceptable as-is for future extensibility.

#### 1.6 `validateSplitTagIntegrity` Throws — **RESOLVED (Phase 1D)**

~~The engine threw on dual-tagged PUSH/PULL exercises.~~

Changed to graceful filtering with `console.warn`. Dual-tagged exercises are silently removed from the pool.

#### 1.7 `enforceVolumeCaps` Uses Naive Pop Strategy — **RESOLVED (Phase 3A)**

~~Volume cap enforcement removed the last accessory instead of the least valuable one.~~

Now uses `scoreAccessoryRetention` to sort before trimming, matching timeboxing behavior.

---

## 2. Data Model

### What Works Well

The schema is well-normalized. The `Exercise` model is rich with the fields the engine needs (`splitTags`, `movementPatternsV2`, `fatigueCost`, `stimulusBias`, `contraindications`). The `ExerciseMuscle` join table with PRIMARY/SECONDARY roles enables proper volume accounting. The `SessionCheckIn` model cleanly separates per-workout readiness from historical `ReadinessLog` data.

### Issues Found

#### 2.1 Legacy/Transitional Dual Fields — **MOSTLY RESOLVED (Phases 5B, 5D, 6C)**

| Model | Legacy Field | New Field | Status |
|-------|-------------|-----------|--------|
| Exercise | `movementPattern` (single enum) | `movementPatternsV2` (enum array) | V2 authoritative; `WorkoutExercise` now has V2 (Phase 6C), legacy optional |
| Baseline | `exerciseName` (denormalized display) | `exerciseId` (non-nullable FK) | **Resolved Phase 5B**: unique constraint now `(userId, exerciseId, context)` |
| SubstitutionRule | ~~`score`~~ | `priority` (non-nullable, default 50) | **Resolved Phase 5D**: `score` dropped |

Remaining: `Exercise.movementPattern` legacy field still exists for backward compat. `WorkoutExercise.movementPattern` is now optional with `movementPatternsV2` as the primary field.

#### 2.2 Overlapping Readiness Models — **RESOLVED (Phase 6A)**

~~`ReadinessLog` and `FatigueLog` were unused, superseded by `SessionCheckIn`.~~

Both tables dropped in Phase 6A. `SessionCheckIn` is the sole readiness/pain model.

#### 2.3 `ProgressionRule` Table Is Unused — **RESOLVED (Phase 6B)**

~~Table existed but was never queried.~~

Table dropped in Phase 6B. Engine uses hardcoded constants from `rules.ts`. The engine `ProgressionRule` type in `types.ts` is retained for future extensibility.

#### 2.4 Missing Indexes — **RESOLVED (Phase 5A)**

~~Hot-path queries lacked compound indexes.~~

Added:
- `@@index([userId, scheduledDate])` on Workout
- `@@index([userId, isActive])` on Injury
- `@@index([userId, date])` on SessionCheckIn

#### 2.5 Untyped JSON Fields

Several fields use `Json?` without schema-level validation:

| Model | Field | Expected Shape |
|-------|-------|---------------|
| Exercise | `contraindications` | `Record<string, boolean>` (e.g., `{ "elbow": true }`) |
| SessionCheckIn | `painFlags` | `Record<string, 0\|1\|2\|3>` |
| SubstitutionRule | `constraints` | Unknown structure |
| SubstitutionRule | `preserves` | Unknown structure |
| UserPreference | `rpeTargets` | `Array<{ min: number, max: number, targetRpe: number }>` |
| ProgressionRule | `rules` | Unknown structure |
| ExerciseVariation | `metadata` | Unknown structure |

The engine casts these with `as Record<string, unknown>` or `as Record<string, 0 | 1 | 2 | 3>`, trusting the data shape.

**Recommendation**: This is acceptable for a single-user app where seed data is controlled. If the app scales to multiple users or external data sources, add Zod validation when reading JSON fields from the DB (in the `map*` functions). No schema change needed — this is a runtime validation concern.

#### 2.6 Profile Fields Could Be Tighter — **PARTIALLY RESOLVED (Phase 5C)**

- ~~`Profile.trainingAge` is nullable~~ — **Resolved Phase 5C**: now non-nullable with `@default(INTERMEDIATE)`.
- `Profile.sex` is `String?` with no validation. Acceptable as-is (engine doesn't use sex for logic).
- `Exercise.timePerSetSec` defaults to 120 seconds. Acceptable — `estimateWorkoutMinutes` uses its own calculation.

---

## 3. Load Assignment (`apply-loads.ts`)

### What Works Well

The three-tier estimation strategy (history → baseline → estimate) is well-ordered and conservative. The donor-based estimation using muscle overlap, equipment scaling, compound scaling, and fatigue ratio is sophisticated. The warmup set generation is training-age-aware.

### Issues Found

#### 3.1 Equipment Scaling Table Is Hardcoded and Incomplete

The `getEquipmentScale` function uses a hardcoded lookup table of equipment pair scaling factors. 24 pairs are defined, but the matrix has 9 equipment types × 9 equipment types = 81 possible pairs. Missing pairs fall through to a default of 0.8.

Some notable missing pairs:
- `kettlebell->barbell`, `barbell->kettlebell`
- `sled->*`, `*->sled` (only sled has no scaling)
- `band->*` (only has default)

**Recommendation**: This is acceptable — the missing pairs are uncommon donor→target transitions. The 0.8 default is conservative. If estimation accuracy becomes a priority, add the missing pairs. Low priority.

#### 3.2 Donor Estimation Doesn't Consider Movement Pattern Similarity — **RESOLVED (Phase 7A)**

~~`estimateFromDonors` ignored `movementPatternsV2` overlap.~~

Added `patternOverlap * 3` to donor scoring: `muscleOverlap * 4 + patternOverlap * 3 + equipMatch * 2 + compoundMatch * 1`. Test verifies pattern-matching donors are preferred.

#### 3.3 Back-Off Multiplier Source of Truth Is Split — **RESOLVED (Phase 1C)**

~~Multiplier defined in three places.~~

Consolidated to `rules.ts`. `getBackOffMultiplier` now lives in `rules.ts` and delegates to `DEFAULT_BACKOFF_MULTIPLIER_BY_GOAL`. All consumers import from there.

---

## 4. Testing Gaps

### What's Well-Tested
- PPL split queue (perpetual advancement, skipped workouts)
- Exercise filtering (equipment, injury, avoid list, stall detection)
- Set/rep prescription (training age scaling, fatigue adjustment, rep ranges by goal)
- Rest period scaling
- Timeboxing by priority
- Load estimation tiers (history, baseline, body-weight formula)
- Warmup set generation
- End-to-end PPL fixtures with deterministic seeds
- Periodization modifier application

### What's Not Tested

| Area | Risk | Status |
|------|------|--------|
| `resolveUser` fallback logic | Medium | Untested |
| ~~Baseline update in `save/route.ts`~~ | ~~High~~ | **RESOLVED Phase 4A**: extracted to `baseline-updater.ts` with 20 tests |
| ~~`suggestSubstitutes`~~ | ~~Low~~ | **RESOLVED Phase 4B**: 8 tests added |
| ~~`enforceVolumeCaps` in isolation~~ | ~~Medium~~ | **RESOLVED Phase 3A**: unit test verifies lowest-scored accessory removed |
| ~~Non-PPL split generation~~ | ~~Medium~~ | **RESOLVED Phase 4C**: 11 integration tests for upper_lower and full_body |
| ~~`mapBaselinesToExerciseIds` alias resolution~~ | ~~Medium~~ | **RESOLVED Phase 5B**: simplified to direct `exerciseId` lookup (no alias chain) |
| Pain filtering edge cases | Medium | Only tested indirectly |
| Periodization week derivation edge cases | Medium | Sparse history (< 14 day span), exact boundary conditions |

---

## 5. Prioritized Recommendations

### High Priority (Address Soon) — ALL RESOLVED

| # | Recommendation | Status |
|---|---------------|--------|
| H1 | Extract duplicated utils into `engine/utils.ts` | **Phase 1A** |
| H2 | Add tests for baseline update logic | **Phase 4A** (20 tests) |
| H3 | Use priority scoring in `enforceVolumeCaps` | **Phase 3A** |
| H4 | Remove dead `adjustForFatigue` function | **Phase 1B** |

### Medium Priority (Next Iteration) — ALL RESOLVED

| # | Recommendation | Status |
|---|---------------|--------|
| M1 | Make `Baseline.exerciseId` non-nullable | **Phase 5B** |
| M2 | Add compound indexes | **Phase 5A** |
| M3 | Split `engine.ts` into focused modules | **Phase 2** (8 modules) |
| M4 | Add movement pattern similarity to donor estimation | **Phase 7A** |
| M5 | Consolidate back-off multiplier | **Phase 1C** |
| M6 | Generalize slot-based selection to non-PPL splits | **Phase 7B** |

### Low Priority (When Relevant) — ALL RESOLVED

| # | Recommendation | Status |
|---|---------------|--------|
| L1 | Migrate `WorkoutExercise` to V2 patterns | **Phase 6C** (V2 added, legacy optional) |
| L2 | Remove `ReadinessLog` and `FatigueLog` | **Phase 6A** |
| L3 | Remove `ProgressionRule` table | **Phase 6B** |
| L4 | Drop `SubstitutionRule.score` | **Phase 5D** |
| L5 | Make `Profile.trainingAge` non-nullable | **Phase 5C** |
| L6 | `validateSplitTagIntegrity`: filter vs throw | **Phase 1D** (now filters) |
| L7 | Add tests for non-PPL split generation | **Phase 4C** (11 tests) |
| L8 | Add tests for `suggestSubstitutes` | **Phase 4B** (8 tests) |
| L9 | Defer all timeboxing to `applyLoads` | Deferred (acceptable as-is) |

---

## 6. Architectural Observations

### The Legs Isolation Slot Edge Case — **RESOLVED (Phase 3B)**

~~Isolation slots could pick compound exercises.~~

`pickForSlot` now prefers `!isCompound` for `quad_isolation` and `hamstring_isolation` slots, falling back to compounds when the filtered pool is empty.

### Periodization Week 0 Naming — **RESOLVED (Phase 3C)**

~~Docs labeled week 0 as "Deload" but code sets `isDeload: false`.~~

Renamed to "Introduction" in CLAUDE.md and all documentation.

### `loadWorkoutContext` Fetches All Exercises

`loadWorkoutContext` fetches the entire exercise library on every workout generation (`prisma.exercise.findMany` with includes for equipment, muscles, and aliases). For a 60+ exercise library, this is fine. At 500+ exercises, consider adding equipment pre-filtering at the query level.

### Profile Unit Conversion

Profile stores height in inches and weight in pounds. The engine receives these as metric (cm, kg) via `mapProfile`. The conversion happens correctly but the weight uses a precise conversion factor (`0.45359237`) while height uses a rounded one (`2.54`). Both are fine for fitness purposes, but documenting the units in the engine type comments would prevent future confusion.
