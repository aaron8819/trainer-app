# Engine Training Logic Reference

Last verified against code: 2026-02-11

Sources:
- `src/lib/engine/rules.ts`
- `src/lib/engine/prescription.ts`
- `src/lib/engine/progression.ts`
- `src/lib/engine/apply-loads.ts`
- `src/lib/engine/template-session.ts`
- `src/lib/engine/sra.ts`
- `src/lib/engine/volume.ts`
- `src/lib/engine/volume-constants.ts`
- `src/lib/engine/volume-landmarks.ts` (requested as `volume-landmark.ts`; code file is plural)

## Purpose

This document consolidates engine runtime behavior for:
- Policy defaults and periodization (`rules.ts`)
- Set/rep/RPE/rest assignment (`prescription.ts`)
- Load progression and deload triggers (`progression.ts`)
- Concrete load assignment and warmup ramp insertion (`apply-loads.ts`)
- Template-session construction and timeboxing (`template-session.ts`)
- SRA recovery state and warning generation (`sra.ts`)
- Volume context, landmark caps, and accessory pruning (`volume.ts`, `volume-landmarks.ts`)

## Module Responsibilities

| Module | Primary responsibility | Key consumers |
|---|---|---|
| `rules.ts` | Goal policy maps, base RPE, periodization modifiers, deload constants | `prescription.ts`, `apply-loads.ts`, `progression.ts`, template generation |
| `prescription.ts` | Set count, target reps/ranges, target RPE, per-set rest prescription | `template-session.ts` |
| `progression.ts` | Next-load recommendation and deload detection from history patterns | `apply-loads.ts` |
| `apply-loads.ts` | Fill `targetLoad` and warmup ramps from history/baseline/estimation; post-load timebox safeguard | Workout generation routes/services |
| `template-session.ts` | Convert template exercise list into session plan with roles, sets/reps, caps, SRA warnings, and notes | Template workout generation paths |
| `sra.ts` | Muscle recovery map and under-recovery warning derivation | `template-session.ts` |
| `volume.ts` | Recent/previous volume aggregation, fatigue derivation, accessory cap enforcement | `template-session.ts` |
| `volume-landmarks.ts` | Canonical per-muscle MV/MEV/MAV/MRV/SRA constants and split mapping | `sra.ts`, `volume.ts` |

## Shared Inputs and Terms

Types are primarily from `src/lib/engine/types.ts`.

Core enums:
- `PrimaryGoal`: `hypertrophy | strength | fat_loss | athleticism | general_health`
- `TrainingAge`: `beginner | intermediate | advanced`

Volume landmark terms:
- `mv`: Maintenance Volume
- `mev`: Minimum Effective Volume
- `mav`: Maximum Adaptive Volume
- `mrv`: Maximum Recoverable Volume
- `sraHours`: Stimulus-Recovery-Adaptation estimate

## `rules.ts` Policy Layer

### Goal rep ranges: `REP_RANGES_BY_GOAL`

| Goal | Main | Accessory |
|---|---|---|
| `hypertrophy` | `[6, 10]` | `[10, 15]` |
| `strength` | `[3, 6]` | `[6, 10]` |
| `fat_loss` | `[8, 12]` | `[12, 20]` |
| `athleticism` | `[4, 8]` | `[8, 12]` |
| `general_health` | `[8, 12]` | `[10, 15]` |

### Goal target RPE: `TARGET_RPE_BY_GOAL`

| Goal | Baseline target RPE |
|---|---|
| `hypertrophy` | `7.5` |
| `strength` | `8.0` |
| `fat_loss` | `7.0` |
| `athleticism` | `7.5` |
| `general_health` | `7.0` |

### Goal-policy overrides

For `primaryGoal === "hypertrophy"`:
- `beginner -> 7.0`
- `intermediate -> 8.0`
- `advanced -> 8.5`

For all other goals (default path):
- `TARGET_RPE_BY_GOAL[primaryGoal]`

`USE_REVISED_FAT_LOSS_POLICY` (default `false`):
- Missing/empty env var uses default `false`.
- Truthy values: `1`, `true`, `yes`, `on`.
- Any other explicit value is treated as disabled.
- When enabled:
  - fat-loss main rep range resolves to `[6, 10]` via `getGoalRepRanges(...)`
  - fat-loss base target RPE resolves to `7.5`
  - fat-loss set multiplier resolves to `0.75` via `getGoalSetMultiplier(...)`

### Periodization modifiers

`PeriodizationModifiers`:
- `rpeOffset: number`
- `setMultiplier: number`
- `backOffMultiplier: number`
- `isDeload: boolean`

`getMesocyclePeriodization(config, goal, trainingAge?)`:
- Deload path (`config.isDeload === true`):
  - `rpeOffset = -2.0`
  - `setMultiplier = 0.5`
  - `backOffMultiplier = 0.75`
  - `isDeload = true`
- Non-deload path:
  - `t = totalWeeks <= 1 ? 0.5 : currentWeek / (totalWeeks - 1)`
  - `rpeOffset`:
    - when `trainingAge` omitted: legacy bucket behavior (`-1.5`, `-0.5`, `+0.5`, `+1.0`)
    - when `trainingAge` provided:
      - `t <= 0.25` (early), `t <= 0.75` (middle), else late
      - beginner: `-0.5`, `0.0`, `+0.5`
      - intermediate: `-1.0`, `-0.5`, `+0.5`
      - advanced: `-1.5`, `-0.5`, `+1.0`
  - `setMultiplier = 1.0 + 0.3 * t`
  - `backOffMultiplier = goal-specific default`
  - `isDeload = false`

Goal back-off defaults:

| Goal | `getBackOffMultiplier` |
|---|---|
| `hypertrophy` | `0.88` |
| `strength` | `0.90` |
| `fat_loss` | `0.85` |
| `athleticism` | `0.85` |
| `general_health` | `0.85` |

### 4-week compatibility wrapper

`getPeriodizationModifiers(weekInBlock, goal, trainingAge?)`:
- Normalizes by modulo-4, so negative and overflow values wrap.
- Weeks `0-2`: training weeks.
- Week `3`: deload.
- Calls `getMesocyclePeriodization({ totalWeeks: 3, currentWeek: min(weekIndex,2), isDeload })`.

### Deload and plateau constants

- `DELOAD_RPE_CAP = 6.0`
- `DELOAD_THRESHOLDS`:
  - `lowReadinessScore = 2`
  - `consecutiveLowReadiness = 4`
  - `plateauSessions = 5` (policy export, not consumed by current `shouldDeload`)
- `PLATEAU_CRITERIA.noProgressSessions = 5`

## `prescription.ts` Set, Rep, RPE, and Rest Assignment

### Public exports

- `REST_SECONDS`:
  - `main = 150`
  - `accessory = 90`
  - `warmup = 45`
- `resolveSetTargetReps(set)`: returns `set.targetReps ?? set.targetRepRange?.min`
- `prescribeSetsReps(...)`: main set prescription entry point
- `clampRepRange(goalRange, exerciseRange?)`
- `resolveSetCount(...)`
- `getRestSeconds(exercise, isMainLift, targetReps?)`

### Main-lift prescription behavior

`prescribeMainLiftSets(...)`:
- Starts from `getGoalRepRanges(goal).main`.
- Clamps to `exerciseRepRange` when provided.
- Set count from `resolveSetCount(true, ...)`.
- Uses lower bound as `topSetReps`.
- Back-off reps use a training-age bump, clamped to the effective rep-range max:
  - beginner: `+0`
  - intermediate: `+1`
  - advanced: `+2`
- `targetRpe` is resolved once and applied to all sets.
- Deload branch still returns same `targetReps`, with periodization-deload-adjusted RPE.

### Accessory prescription behavior

`prescribeAccessorySets(...)`:
- Starts from `getGoalRepRanges(goal).accessory`.
- Clamps to `exerciseRepRange`.
- Calls `widenAccessoryRangeForProgression(...)` to ensure at least a 2-rep span when possible.
- Uses lower bound as `targetReps`.
- Emits `targetRepRange = { min, max }`.
- Set count from `resolveSetCount(false, ...)`.

Accessory range widening rules:
- If span already `>= 2`, unchanged.
- Expands upward first within exercise bounds.
- Expands downward only if upward expansion cannot satisfy span.

### Set count logic

`resolveSetCount(isMainLift, trainingAge, fatigueState, periodizationSetMultiplier = 1, primaryGoal?)`:
- Base sets:
  - Main lift: `4`
  - Accessory: `3`
- Training-age modifier:
  - `advanced: 1.15`
  - `beginner: 0.85`
  - otherwise `1`
- Baseline: `max(2, round(baseSets * ageModifier))`
- Recovery penalty (`readinessScore <= 2` or `missedLastSession`):
  - one non-stacking `-1` set penalty (floor 2)
- Goal multiplier:
  - `fat_loss` and revised-policy flag on: `0.75`
  - otherwise `1`
- Applies `goalMultiplier * periodizationSetMultiplier` (multiplicative), then `round`, then floor `2`

### Target RPE logic

`resolveTargetRpe(...)`:
- Starts at `getBaseTargetRpe(goal, trainingAge)`.
- Readiness penalty:
  - if `readinessScore <= 2`, subtract `0.5`.
- Hypertrophy isolation accessories:
  - add `+0.5` RPE.
- Periodization:
  - add `periodization.rpeOffset` if provided.
  - if `periodization.isDeload`, cap final value with `DELOAD_RPE_CAP`.

### Rest assignment logic

`getRestSeconds(exercise, isMainLift, targetReps?)`:
- Main lift, reps `<= 5`:
  - fatigue cost `>= 4`: `300s`
  - else `240s`
- Main lift, reps `>= 6`:
  - fatigue cost `>= 4`: `180s`
  - else `150s`
- Accessory compound:
  - reps `<= 8`: `150s`
  - else `120s`
- Accessory isolation:
  - fatigue cost `>= 3`: `90s`
  - else `90s` (floor raised to 90s)

## `progression.ts` Load Progression and Deload Detection

### Public exports

- `computeNextLoad(lastSets, repRange, targetRpe, maxLoadIncreasePct = 0.07, options?)`
- `shouldDeload(history, mainLiftExerciseIds?)`

Supporting option fields:
- `trainingAge`
- `isUpperBody`
- `weekInBlock`
- `backOffMultiplier`
- `isDeloadWeek`
- `recentSessions` (most-recent-first from caller)

### Load selection flow

`computeNextLoad(...)`:
1. Reads first available `lastLoad` from `lastSets`.
2. If missing, returns `undefined`.
3. Builds `sessionHistory = [lastSets, ...recentSessions]`.
4. Applies training-age branch:
  - Beginner: linear progression, with stall fallback to double progression.
  - Intermediate: double progression, with regression-triggered reduction.
  - Advanced: periodized weekly percent model, or explicit deload multiplier.

### Percent clamping

Internal `applyChange(pct)`:
- Clamps absolute pct to `maxLoadIncreasePct` (default `0.07`).
- Applies signed change to `lastLoad`.
- Rounds via `roundLoad(...)`.

This cap applies to both increases and decreases.

### Beginner branch

- Default linear increment via `resolveLinearIncrement(lastLoad, isUpperBody)`:
  - Upper body:
    - `< 185`: `+2.5`
    - `>= 185`: `+5`
  - Lower body:
    - `< 275`: `+5`
    - `>= 275`: `+10`
- Stall detection `hasBeginnerStall(sessionHistory)`:
  - Requires 3 sessions and identical representative loads.
  - Detects non-improving trend in total reps (`current <= previous <= older`).
  - If stalled, switches to double progression behavior.

### Intermediate branch

- Regression detection `hasConsecutiveRepRegression(sessionHistory)`:
  - Requires 3 sessions.
  - Detects strict decline in total reps (`current < previous < older`).
  - On trigger, applies `-6%` change (still clamp-limited by `maxLoadIncreasePct`).
- Otherwise uses double progression:
  - Increase by `+2.5%` only when all sets hit rep ceiling and RPE is at/below target.
  - Otherwise maintain load.

### Advanced branch

- If `isDeloadWeek`:
  - Applies multiplier `backOffMultiplier ?? 0.75`.
- Else periodized weekly pct by normalized 4-week index:
  - Week `0`: `-2%`
  - Week `1`: `0%`
  - Week `2`: `+2%`
  - Week `3`: `+3%`

### Deload trigger from history

`shouldDeload(history)`:
- Returns `false` when fewer than 2 history entries exist.
- Trigger A: low-readiness streak.
  - Uses last `DELOAD_THRESHOLDS.consecutiveLowReadiness` entries.
  - Requires all readiness scores `<= DELOAD_THRESHOLDS.lowReadinessScore`.
  - Missing readiness defaults to `3`.
- Trigger B: plateau window.
  - Uses last `PLATEAU_CRITERIA.noProgressSessions` entries.
  - Requires all entries completed.
  - Behavior depends on `USE_MAIN_LIFT_PLATEAU_DETECTION` (default `false`):
  - Missing/empty env var uses default `false`.
  - Truthy values: `1`, `true`, `yes`, `on`.
  - Any other explicit value is treated as disabled.
  - When enabled and `mainLiftExerciseIds` is provided:
    - Computes top-set e1RM per main-lift-eligible exercise per session.
    - Top set = lowest `setIndex` with a logged load and reps.
    - `e1RM = load * (1 + reps / 30)` (Epley).
    - Exercises must appear in at least 2 sessions within the window to count.
    - If every such exercise has `maxE1RM <= oldestSessionE1RM`, plateau triggers.
    - If no qualifying main lifts appear, falls back to the total-reps comparator.
  - When disabled (flag off or missing `mainLiftExerciseIds`):
    - Computes session total reps across all logged sets.
    - If no entry exceeds prior entry in that window, deload triggers.

## `apply-loads.ts` Load Assignment and Warmup Ramps

### Public API

- `applyLoads(workout, options): WorkoutPlan`
- `BaselineInput`:
  - `exerciseId`
  - `context?` (`strength`, `volume`, `default`, or other caller-defined labels)
  - `workingWeightMin?`
  - `workingWeightMax?`
  - `topSetWeight?`
- `ApplyLoadsOptions`:
  - `history?`
  - `baselines?`
  - `exerciseById`
  - `primaryGoal`
  - `profile?` (`weightKg`, `trainingAge`)
  - `sessionMinutes?`
  - `periodization?`
  - `weekInBlock?`

### Main flow in `applyLoads(...)`

1. Build history index from completed history only.
2. Build baseline index with goal-aware context preference and track selected context.
3. Resolve rep ranges and default training age.
4. For each main lift and accessory:
  - Normalize role metadata on exercise and sets.
  - Resolve top-set target RPE default when missing.
  - Resolve top-set load using explicit load, history progression, baseline, or estimation fallback.
5. Assign set-level loads:
  - Main lifts:
    - Non-deload: top set uses resolved load; back-off sets use `backOffMultiplier`.
    - Deload: all sets use `load * backOffMultiplier`.
    - Adds concrete warmup ramp sets for load-resolvable movements.
  - Accessories:
    - Sets receive the resolved load, no warmup ramp.
6. Recompute estimated duration.
7. If budget is exceeded, trim accessories post-load as safety net.

### Default RPE and rep-range context for load progression

- Rep ranges come from `REP_RANGES_BY_GOAL`.
- Default target RPE fallback for top-set load progression:
  - `getBaseTargetRpe(primaryGoal, trainingAge)`.
  - Plus `+0.5` for hypertrophy isolation accessories.

This value is used only when set-level target RPE is absent.

### History and baseline precedence

Per exercise, load resolution order:
1. Existing `targetLoad` on top set.
2. `computeNextLoad(...)` from latest completed history set performance.
3. Baseline load from selected baseline context.
4. Estimated load from donor exercises/bodyweight/equipment defaults.

History preprocessing:
- `filterCompletedHistory` then `sortHistoryByDateDesc`.
- Keeps only exercises with non-empty set logs.

Baseline selection:
- Preferred context:
  - `strength` goal -> `"strength"`
  - all other goals -> `"volume"`
- Fallbacks:
  - `"default"` context
  - first baseline entry for that exercise
- If selected context differs from preferred context:
  - `"strength"` baseline with volume-preferred goal scales by `0.78`.
  - `"volume"` baseline with strength goal scales by `1.12`.
  - `"default"` context and preferred-context matches do not scale.
- Baseline load from:
  - average of min/max if both present
  - else top set
  - else min
  - else max
- Rounded to nearest 0.5.

### Estimation path when history/baseline are unavailable

`estimateLoad(...)` uses:
1. Bodyweight-only guard:
  - If `canResolveLoadForWarmupRamp(exercise)` is false, returns `undefined`.
2. Donor inference:
  - Uses baseline exercises that overlap on primary muscles.
  - Applies scaling for equipment, compound/isolation mismatch, and fatigue cost.
  - Chooses highest score candidate; ties broken by donor name.
3. Bodyweight heuristic if `weightKg` exists.
4. Equipment default fallback.

Donor score:
- `muscleOverlap * 4`
- `patternOverlap * 3`
- `+2` same equipment
- `+1` same compound flag

Donor scaling:
- `equipmentScale` from pair map (default `0.8` if pair not mapped).
- `compoundScale`:
  - same type: `1.0`
  - donor compound -> target isolation: `1.0` then separate isolation penalty applies
  - donor isolation -> target compound: `1.15`
- Isolation penalty:
  - donor compound and target isolation -> `0.5`
  - otherwise `1.0`
- Fatigue scaling:
  - `clamp(targetFatigue / donorFatigue, 0.45, 0.9)`

Bodyweight ratio estimation:
- Converts `weightKg` to lb.
- Uses equipment+compound lookup and max movement-pattern multiplier.
- Pattern multipliers:
  - `squat: 1.2`
  - `hinge: 1.15`
  - `lunge: 1.1`
  - `carry: 1.1`
  - `rotation: 0.6`
  - `anti_rotation: 0.6`

### Warmup ramp behavior

- Main-lift warmup sets are generated via `buildWarmupSetsFromTopSet(topSetLoad, trainingAge, roundToHalf)`.
- During deload, warmups are generated from the deload-adjusted top load.
- Accessories always return `warmupSets: undefined`.

### Timeboxing safeguard behavior

Even if template generation already timeboxed accessories, `applyLoads(...)` repeats timebox checks after concrete loads and warmup sets are added:
- Re-estimates full session duration.
- If over budget, trims accessories one at a time with `trimAccessoriesByPriority`.
- Stops when under budget or no accessories remain.

## `template-session.ts` Template Session Construction

### Public API

- `generateWorkoutFromTemplate(templateExercises, options): TemplateWorkoutResult`
- `TemplateExerciseInput`:
  - `exercise`
  - `orderIndex`
  - `supersetGroup?`
- `GenerateFromTemplateOptions`:
  - `profile`, `goals`, `history`, `exerciseLibrary`
  - `sessionMinutes?`
  - `preferences?`
  - `checkIn?`
  - `weekInBlock?`
  - `mesocycleLength?`
  - `periodization?`
  - `isStrict?`
- `TemplateWorkoutResult`:
  - `workout`
  - `sraWarnings`
  - `substitutions`

### End-to-end generation flow

1. Build fatigue state via `deriveFatigueState(history, checkIn)`.
2. Build volume context:
  - Standard mode: `buildVolumeContext(history, exerciseLibrary)`.
  - Enhanced mode when `weekInBlock` is provided:
    - `mesocycleLength` normalized with floor 1 (default 4).
3. Resolve main-lift slots from template list.
4. Build each workout exercise:
  - Main/accessory role assignment.
  - Set/rep/RPE prescription via `prescribeSetsReps(...)`.
  - Rest assignment via `getRestSeconds(...)`.
5. Optional substitution suggestions in flexible mode (`isStrict === false`).
6. Add projected warmup ramps to main lifts for duration estimation only.
7. Pre-load timebox trim by session budget.
8. Enforce volume caps on accessories.
9. Apply superset metadata to valid accessory pairs.
10. Build SRA recovery map and warnings.
11. Assemble workout notes (autoregulation and under-recovery summary).
12. Return workout and diagnostics (`sraWarnings`, `substitutions`).

### Main-lift slot resolution

`resolveMainLiftSlots(...)` behavior:
- Default slot cap: 2.
- Candidate must satisfy:
  - `exercise.isMainLiftEligible === true`
  - Not demoted by rep-range mismatch to goal main range.
- Demotion rule:
  - If exercise-specific rep range exists and does not overlap goal main range, it becomes accessory.
- Eligible entries are ordered by `orderIndex`, then by input index for tie-break.
- First `slotCap` entries become main lifts.

### Exercise build details

`buildTemplateExercise(...)`:
- Computes optional exercise-specific rep range from `repRangeMin/repRangeMax`.
- Calls `prescribeSetsReps(...)` with:
  - `isMainLift`
  - profile training age
  - goals/fatigue/preferences/periodization
  - exercise rep range
  - hypertrophy isolation flag for accessory isolations
- Sets per-set `restSeconds`.
- Main lifts get note `"Primary movement"`.
- Accessory `supersetGroup` is preserved from template input.

### Flexible substitution logic

Substitutions run only when:
- `isStrict === false`
- `checkIn.painFlags` exists

For each exercise with contraindications:
- Detects conflicts against pain flags (`>= 1`).
- Calls `suggestSubstitutes(...)` with default fallback constraints.
- Stores suggestion payload with:
  - `originalExerciseId`, `originalName`
  - human-readable reason (for example, `"Knee pain flagged"`)
  - alternatives with placeholder score `0`
- Before return, substitutions are filtered to only exercises that remain in the final workout after timebox and volume-cap trimming.

### Time estimation and trimming behavior

- Initial estimate includes projected warmup ramps for load-resolvable main lifts.
- If `sessionMinutes` is set and exceeded, accessories are trimmed iteratively via `trimAccessoriesByPriority`.
- After volume-capping step, minutes are recalculated using:
  - projected main lifts
  - final accessories

### Volume and superset behavior

- Accessories are filtered through `enforceVolumeCaps(...)`.
- Superset metadata (`"Superset N"` note) is applied only when exactly two accessories share a `supersetGroup`.
- Superset timing reductions apply to eligible accessory pairs (compound or isolation); main lifts remain excluded from superset timing reduction.
- Main lifts do not carry `supersetGroup`.

### SRA warnings and workout notes

- Recovery map from `buildMuscleRecoveryMap(history, exerciseLibrary)`.
- Target muscles are deduplicated from final main lifts + accessories.
- Under-recovered muscles become warnings via `generateSraWarnings(...)`.
- Notes include:
  - `"Autoregulated for recovery"` if readiness `<= 2`
  - `"Under-recovered: ..."` listing warning muscles and recovery percentages

### Output shape notes

- Returned `workout.warmup` is currently empty.
- Main-lift projected warmups in this module are for duration modeling only.
- Concrete warmup sets are later attached in `apply-loads.ts`.

## `sra.ts` Recovery Modeling and Warnings

### Public API

- `buildMuscleRecoveryMap(history, exerciseLibrary, now?)`
- `generateSraWarnings(recoveryMap, targetMuscles)`
- Types:
  - `MuscleRecoveryState`
  - `SraWarning`

### Core behavior

`buildMuscleRecoveryMap(...)`:
- Uses `now` override when provided, otherwise current system time.
- Builds fallback SRA windows from `VOLUME_LANDMARKS`.
- Optionally overlays DB-provided windows from `exercise.muscleSraHours`.
- Computes last-trained timestamp per normalized muscle key from completed workouts.
- Produces recovery state per muscle with:
  - `lastTrainedHoursAgo` (rounded, nullable)
  - `sraWindowHours`
  - `recoveryPercent`
  - `isRecovered` (`recoveryPercent >= 100`)

Muscle-source precedence for training detection:
- Exercise library `primaryMuscles`
- History exercise entry `primaryMuscles`
- Deduplicated per exercise entry

Window precedence:
- DB window (if enabled and available)
- Landmark default (`VOLUME_LANDMARKS`)
- Hard fallback `48` hours

### Environment toggle

`USE_DB_SRA_WINDOWS` controls whether exercise-level DB SRA windows are used:
- Missing/empty env var -> treated as enabled (`true`).
- Truthy values: `1`, `true`, `yes`, `on`.
- Any other explicit value disables DB windows and uses engine constants only.

### DB window ingestion rules

`buildDbSraWindows(exerciseLibrary)`:
- Reads `exercise.muscleSraHours` entries.
- Accepts only finite positive values.
- Rounds hours to nearest integer.
- Uses first seen entry for each normalized muscle key.

### Warning generation behavior

`generateSraWarnings(...)`:
- Accepts explicit target muscle list for the current planned session.
- Matches case-insensitively against recovery map.
- Emits warnings only when:
  - muscle exists
  - `lastTrainedHoursAgo` is not null
  - `isRecovered === false`

## `volume-landmarks.ts` Landmark Tables

### Type

`VolumeLandmarks`:
- `mv: number`
- `mev: number`
- `mav: number`
- `mrv: number`
- `sraHours: number`

### Landmark data (`VOLUME_LANDMARKS`)

| Muscle | mv | mev | mav | mrv | sraHours |
|---|---:|---:|---:|---:|---:|
| Chest | 6 | 10 | 16 | 22 | 60 |
| Lats | 6 | 10 | 18 | 25 | 60 |
| Upper Back | 6 | 10 | 18 | 25 | 48 |
| Front Delts | 0 | 0 | 7 | 12 | 48 |
| Side Delts | 6 | 8 | 19 | 26 | 36 |
| Rear Delts | 6 | 8 | 19 | 26 | 36 |
| Quads | 6 | 8 | 15 | 20 | 72 |
| Hamstrings | 6 | 6 | 13 | 20 | 72 |
| Glutes | 0 | 0 | 8 | 16 | 72 |
| Biceps | 6 | 8 | 17 | 26 | 36 |
| Triceps | 4 | 6 | 12 | 18 | 36 |
| Calves | 6 | 8 | 14 | 20 | 36 |
| Core | 0 | 0 | 12 | 20 | 36 |
| Lower Back | 0 | 0 | 4 | 10 | 72 |
| Forearms | 0 | 0 | 6 | 12 | 36 |
| Adductors | 0 | 0 | 8 | 14 | 48 |
| Abductors | 0 | 0 | 6 | 12 | 36 |
| Abs | 0 | 0 | 10 | 16 | 36 |

### Split map (`MUSCLE_SPLIT_MAP`)

- `push`: Chest, Front Delts, Side Delts, Triceps
- `pull`: Lats, Upper Back, Rear Delts, Biceps, Forearms
- `legs`: Quads, Hamstrings, Glutes, Calves, Adductors, Abductors, Core, Abs, Lower Back

## `volume.ts` Context and Cap Enforcement

### Public exports

- `buildVolumeContext(history, exerciseLibrary, mesocycleOptions?)`
- `getTargetVolume(landmark, mesocycleWeek, mesocycleLength)`
- `enforceVolumeCaps(accessories, mainLifts, volumeContext)`
- `deriveFatigueState(history, checkIn?)`
- `effectiveWeeklySets(state)`

### Context building

`buildVolumeContext(...)` computes:
- `recent`: direct sets by muscle from completed workouts in last 7 days.
- `previous`: direct sets by muscle from completed workouts in days 8-14.

Rules:
- Uses `isCompletedHistoryEntry(entry)` to exclude planned/skipped/incomplete sessions.
- Ignores workouts outside the 14-day window.
- Uses exercise library lookup by `exerciseId`.
- Primary muscles contribute direct sets.
- Secondary muscles contribute indirect sets in the recent window for enhanced context calculations.

Enhanced mode (`mesocycleOptions` provided) adds:
- `muscleVolume[muscle]` with:
  - `weeklyDirectSets`
  - `weeklyIndirectSets`
  - `plannedSets` (initialized `0`)
  - `landmark`
- `mesocycleWeek`
- `mesocycleLength`

### Target volume ramp

`getTargetVolume(landmark, mesocycleWeek, mesocycleLength)`:
- If `mesocycleLength <= 1`, returns `landmark.mav`.
- Else linearly interpolates from `mev` to `mav`:
  - `mev + (mav - mev) * t`, where `t = mesocycleWeek / (mesocycleLength - 1)`

### Cap enforcement

`enforceVolumeCaps(...)`:
- Starts with all accessories.
- Rebuilds planned direct and indirect volume as:
  - direct baseline from `recent`.
  - indirect baseline from enhanced-context `muscleVolume`.
  - adds primary muscles to direct and secondary muscles to indirect for planned main lifts and accessory candidates.
- If caps are exceeded, removes one accessory at a time.
- Removal order is by retention score from `scoreAccessoryRetention(...)`:
  - lowest score is removed first.

Cap predicates:
- Basic context:
  - Spike cap only: `plannedDirectSets > previousSets * 1.2` when previous baseline exists.
- Enhanced context:
  - With `USE_EFFECTIVE_VOLUME_CAPS=true`:
    - Landmark cap: `effectiveSets > mrv`, where `effectiveSets = direct + indirect * INDIRECT_SET_MULTIPLIER`.
    - Spike cap remains a direct-set safety net.
  - With `USE_EFFECTIVE_VOLUME_CAPS` disabled (default):
    - Legacy direct-set landmark cap remains active: `plannedDirectSets > mrv`.
    - Spike cap remains active.

`USE_EFFECTIVE_VOLUME_CAPS` parsing:
- Missing/empty env var uses default `false`.
- Truthy values: `1`, `true`, `yes`, `on`.
- Any other explicit value is treated as disabled.

### Fatigue derivation

`deriveFatigueState(history, checkIn?)`:
- Uses most recent history entry by date via `getMostRecentHistoryEntry`.
- `readinessScore` priority:
  - `checkIn.readiness`
  - else most recent workout readiness
  - else default `3`
- `missedLastSession` true when latest status is `SKIPPED`.
- Carries forward soreness/pain notes when available.

### Effective weekly sets

`effectiveWeeklySets(state)`:
- `weeklyDirectSets + (weeklyIndirectSets * INDIRECT_SET_MULTIPLIER)`
- `INDIRECT_SET_MULTIPLIER` is shared from `volume-constants.ts` and currently set to `0.3`.

## Cross-Module Integration

### Runtime flow coupling

1. `template-session.ts` creates a role-aware session skeleton with prescribed sets/reps/RPE/rest.
2. `volume.ts` applies session-level accessory cap safety before load assignment.
3. `sra.ts` computes recovery warnings attached to template output.
4. `apply-loads.ts` resolves set loads from history/baselines/estimation and adds warmup ramps.
5. `progression.ts` governs how loads evolve from completed sessions.
6. `rules.ts` and `volume-landmarks.ts` provide global policy constants used across all steps.

### Key dependency contracts

- Deload behavior:
  - Policy from `rules.ts`.
  - RPE cap in `prescription.ts`.
  - Load reductions from `progression.ts` and `apply-loads.ts`.
- Warmup modeling:
  - `template-session.ts` uses projected warmup ramps for time estimation only.
  - `apply-loads.ts` injects actual warmup sets once top-set loads are resolved.
- Volume and recovery safety:
  - `volume.ts` prevents accessory volume spikes and MRV breaches.
  - `sra.ts` flags under-recovery for planned target muscles.

## Test Coverage

Relevant tests:
- `src/lib/engine/rules.test.ts`
- `src/lib/engine/periodization.test.ts`
- `src/lib/engine/prescription.test.ts`
- `src/lib/engine/progression.test.ts`
- `src/lib/engine/apply-loads.test.ts`
- `src/lib/engine/template-session.test.ts`
- `src/lib/engine/sra.test.ts`
- `src/lib/engine/volume.test.ts`
- `src/lib/engine/volume-landmarks.test.ts`

Covered behaviors include:
- Goal coverage for rep ranges and target RPE defaults.
- Mesocycle ramp and deload overrides.
- Rep-range clamping and accessory range widening.
- Beginner/intermediate/advanced progression branches and regression handling.
- Completed-history-only load progression for apply-loads.
- Baseline fallback, donor estimation, bodyweight-ratio fallback, and post-load timebox trimming.
- Main-lift slot capping and rep-range demotion in template generation.
- Flexible substitutions for pain flags in non-strict mode.
- SRA DB-window override and case-insensitive muscle matching.
- Accessory pruning by score under spike and MRV caps.
- Landmark and split-map integrity checks.

## Change Safety Checklist

When changing these modules, verify:

1. Goal policy changes
- Update all goal-indexed maps in `rules.ts`.
- Validate downstream behavior in `prescription.ts`, `progression.ts`, and `apply-loads.ts`.

2. Prescription logic changes
- Re-run `prescription.test.ts`, `rules.test.ts`, and `periodization.test.ts`.
- Confirm deload RPE capping and set-multiplier behavior remain coherent.

3. Progression changes
- Re-run `progression.test.ts`.
- Validate clamp behavior if modifying percent deltas or `maxLoadIncreasePct`.

4. Apply-loads changes
- Re-run `apply-loads.test.ts`.
- Verify precedence chain: explicit load -> history -> baseline -> estimation.
- Verify post-load timebox trimming still respects budget after warmup sets are added.

5. Template-session changes
- Re-run `template-session.test.ts`.
- Verify main-lift slot cap, rep-range demotion, superset annotations, and notes behavior.

6. SRA changes
- Re-run `sra.test.ts`.
- Validate env-toggle behavior for `USE_DB_SRA_WINDOWS` and case-insensitive matching.

7. Volume changes
- Re-run `volume.test.ts` and `volume-landmarks.test.ts`.
- Confirm enhanced mode keeps both MRV and spike constraints.

8. Naming consistency
- Keep muscle labels consistent between exercise data, `VOLUME_LANDMARKS`, and planned-session muscles so MRV/SRA logic applies predictably.
