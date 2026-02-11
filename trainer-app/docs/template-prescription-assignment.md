# Template Prescription Assignment Reference

Last updated: 2026-02-10

This document explains exactly how the engine assigns sets, rep targets/ranges, RPE, rest, and loads when generating a workout from a template.

## Source of Truth

- `src/lib/api/template-session.ts`
- `src/lib/engine/template-session.ts`
- `src/lib/engine/prescription.ts`
- `src/lib/engine/rules.ts`
- `src/lib/engine/apply-loads.ts`
- `src/lib/engine/volume.ts`

## Generation Order

1. Load user context + template.
2. Derive `weekInBlock` and periodization modifiers (`rpeOffset`, `setMultiplier`, `backOffMultiplier`, `isDeload`).
3. For each template exercise:
- classify as main vs accessory
- assign sets/reps/RPE/rest
4. Estimate duration.
5. Apply loads.
6. Trim accessories if over time budget.

## 1) Main vs Accessory Classification

Per template exercise:

- Main lift if `exercise.isMainLiftEligible === true` and the exercise rep range overlaps the goal main-lift range
- Otherwise accessory
- Main-lift slots are capped at `2` per session; eligible movements are selected by ascending `orderIndex`

Non-overlap demotion rule:

- If `isMainLiftEligible` is true but exercise range and goal main-lift range do not overlap (example: strength goal `3-6`, exercise range `10-20`), classification is demoted to accessory for prescription.

This classification controls set-count base, rep logic, rest logic, and load/warmup behavior.

## 2) Fatigue State Used For Prescription

`deriveFatigueState(history, checkIn)`:

- `readinessScore`: latest check-in readiness, else latest history readiness, else `3`
- `missedLastSession`: true if most recent workout status is `SKIPPED`
- `painFlags`: check-in pain flags if present, else latest history flags

`readinessScore` and `missedLastSession` affect set count and RPE.

## 3) Set Count Assignment

Function: `resolveSetCount(isMainLift, trainingAge, fatigueState, setMultiplier)`

Base sets:

- Main: `4`
- Accessory: `3`

Training-age modifier:

- Beginner: `0.85`
- Intermediate: `1.0`
- Advanced: `1.15`

Then:

1. `baselineSets = round(baseSets * ageModifier)`, floor `2`
2. If readiness `<=2` **or** `missedLastSession`, subtract `1` once (non-stacking), floor `2`
3. Apply periodization: `round(recoveryAdjusted * setMultiplier)`, floor `2`

## 4) Rep Range And Rep Target Assignment

Goal rep ranges (`REP_RANGES_BY_GOAL`):

- Hypertrophy: main `6-10`, accessory `10-15`
- Strength: main `3-6`, accessory `6-10`
- Fat loss: main `8-12`, accessory `12-20`
- Athleticism: main `4-8`, accessory `8-12`
- General health: main `8-12`, accessory `10-15`

Important template-path behavior:

- Template generation passes `exerciseRepRange` from `exercise.repRangeMin` / `exercise.repRangeMax` when available.
- Effective range is `intersection(goalRange, exerciseRange)`.
- If there is no overlap, effective range falls back to the exercise range.

### Main-lift reps

- Top set reps = lower bound of main range.
- Back-off reps = top-set reps (no multiplier-based rep change).
- Deload: all sets use top-set reps.

### Accessory reps

Each set gets:

- `targetReps = accessoryRange.min` (legacy-compatible field)
- `targetRepRange = { min: accessoryRange.min, max: accessoryRange.max }`
- If clamping produces a single-point accessory range, the engine widens to at least a 2-rep span for progression room, preferring upward expansion within the exercise range (and only expanding downward if upward is constrained by `exercise.repRangeMax`).

So accessories now carry range metadata for double progression, while older consumers still use `targetReps`.

## 5) Target RPE Assignment

Base target RPE:

- Hypertrophy is training-age specific:
- Beginner `7.0`
- Intermediate `8.0`
- Advanced `8.5`
- Other goals use static base table in `rules.ts`.

Adjustments are applied in this order:

1. Readiness penalty: `-0.5` if readiness `<=2`
2. Hypertrophy isolation accessory bump: `+0.5`
3. Periodization `rpeOffset`
4. Deload cap: `targetRpe = min(targetRpe, 6.0)` when `isDeload`

## 6) Rest Assignment

Function: `getRestSeconds(exercise, isMainLift, targetReps)`

Main lifts:

- Reps `<=5`: `300s` if fatigue `>=4`, else `240s`
- Reps `>5`: `180s` if fatigue `>=4`, else `150s`

Accessories:

- Compound: `150s` if reps `<=8`, else `120s`
- Isolation: `90s` if fatigue `>=3`, else `75s`

All generated working sets are written with explicit `restSeconds`.

## 7) Load Assignment (After Sets/Reps/RPE/Rest)

`applyLoads(...)` runs after prescription.

Load source priority:

1. Recent history for same exercise (`computeNextLoad`)
2. Baseline for exercise (goal-context aware)
3. Estimated fallback (donor baselines, bodyweight heuristic, equipment defaults)

Main lifts:

- Set 1 gets top load
- Sets 2+ get `topLoad * backOffMultiplier` (hypertrophy default `0.88`)
- Warmup sets are auto-generated
- Deload: all working sets use `topLoad * backOffMultiplier`

Accessories:

- Uniform load across working sets unless pre-filled

Progression model selection is engine-owned from `trainingAge`:

- Beginner: linear progression with fixed jump ranges and stall fallback to double progression.
- Intermediate: double progression (hold until rep ceiling at target RPE).
- Advanced: periodized top-set adjustments with explicit deload weeks.

## 8) Timeboxing Interaction

After loads are applied, estimated duration is checked against `constraints.sessionMinutes`.

If over budget:

- accessories are trimmed iteratively via `trimAccessoriesByPriority(...)`
- main lifts are preserved
- for valid accessory supersets, shared rest is reduced to `max(60, round(max(restA, restB) * 0.6))` before trimming decisions

## 9) Output And Persistence Notes

Generation response includes set-level `targetReps`, optional `targetRepRange`, `targetRpe`, `targetLoad`, and `restSeconds`.

DB save path persists `targetReps`/RPE/load/rest and `targetRepRange` (`WorkoutSet.targetRepMin` / `WorkoutSet.targetRepMax`, nullable). Read paths map those columns back into `targetRepRange` when present.

## Quick Examples

### Example A: Intermediate hypertrophy accessory isolation, normal readiness

- Set count base: accessory `3`
- Age modifier: `1.0` -> `3` sets
- Goal accessory range: `10-15`
- Assigned per set:
- `targetReps = 10`
- `targetRepRange = { min: 10, max: 15 }`
- Target RPE base: `8.0`
- Isolation bump: `+0.5` -> `8.5`
- Rest: `75s` or `90s` depending on fatigue cost

### Example B: Advanced strength main lift, low readiness, deload week

- Base sets: `4`
- Age modifier: `1.15` -> round to `5`
- Low readiness penalty -> `4`
- Periodization deload multiplier `0.5` -> `2` sets (floor `2`)
- Goal main range: `3-6`
- Reps: top-set reps (`3`) for all deload sets
- RPE after adjustments capped at `6.0`
- Load: deload load (`topLoad * backOffMultiplier`) applied to all working sets

### Example C: Strength goal with non-overlap main-lift-eligible exercise

- Exercise marked `isMainLiftEligible = true`
- Goal main range: `3-6`
- Exercise range: `10-20`
- Result: exercise is demoted to accessory prescription for this session
- Accessory effective range: intersection of strength accessory (`6-10`) with exercise (`10-20`) -> `10-10`, widened to `10-12` for minimum progression span
- Assigned per set:
- `targetReps = 10`
- `targetRepRange = { min: 10, max: 12 }`

## Weekly Scoring Note

Prescription assignment logic is unchanged by weekly volume recalibration. Weekly program analysis now computes effective sets as:

- `effectiveSets = directSets + 0.3 * indirectSets`
- `indirectSetMultiplier` is reported on each weekly muscle check (`0.3` in Phase 2)
- weekly muscle coverage now uses muscle-class hit targets (`3-4`, `2-3`, `1.5-2` hits/week) with a `2x/week` fallback for unknown classes (Phase 5)
