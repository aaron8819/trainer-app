# Template Session Generation (Current Behavior)

Last updated: 2026-02-10

This document describes the current template-generation runtime after Phase 3 follow-up implementation.

## Source of Truth

- `src/app/api/workouts/generate-from-template/route.ts`
- `src/lib/api/template-session.ts`
- `src/lib/engine/template-session.ts`
- `src/lib/engine/prescription.ts`
- `src/lib/engine/rules.ts`
- `src/lib/engine/apply-loads.ts`
- `src/lib/engine/timeboxing.ts`

## What A Template Stores

Template-level fields:

- `name`
- `targetMuscles`
- `isStrict`
- `intent` (`FULL_BODY | UPPER_LOWER | PUSH_PULL_LEGS | BODY_PART | CUSTOM`)

Template exercise rows store:

- `exerciseId`
- `orderIndex`
- `supersetGroup` (optional)

Templates do not store fixed set-by-set prescriptions. Sets/reps/rest/load are generated at runtime.

## End-To-End Flow

`POST /api/workouts/generate-from-template`:

1. Validate `templateId`.
2. Load template + workout context (profile/goals/constraints/history/preferences/check-in/exercise library/baselines).
3. Derive `weekInBlock` and periodization modifiers with `getPeriodizationModifiers(...)`.
4. Map template exercises into engine inputs, including `orderIndex` and `supersetGroup`.
5. Generate prescription in `generateWorkoutFromTemplate(...)`.
6. Apply loads in `applyLoads(...)`.
7. Enforce session budget using `constraints.sessionMinutes` during load application.
8. Return `{ workout, templateId, sraWarnings }`.

## Sets, Reps, RPE, Rest

### Set counts

`resolveSetCount(...)`:

- Base: main `4`, accessory `3`
- Training age modifier: beginner `0.85`, intermediate `1.0`, advanced `1.15`
- Recovery adjustment: apply a single `-1` set reduction when readiness `<=2` **or** the last session was missed (non-stacking)
- Periodization multiplier: `setMultiplier`
- Floor: `2` sets

### Rep targets by goal

From `REP_RANGES_BY_GOAL`:

- Hypertrophy: main `6-10`, accessory `10-15`
- Strength: main `3-6`, accessory `6-10`
- Fat loss: main `8-12`, accessory `12-20`
- Athleticism: main `4-8`, accessory `8-12`
- General health: main `8-12`, accessory `10-15`

Exercise-specific rep-range handling in template mode:

- Template generation passes exercise metadata (`repRangeMin` / `repRangeMax`) into `prescribeSetsReps(...)` when available.
- Effective range is the intersection of goal range and exercise range.
- If ranges do not overlap, the exercise range is used.
- If an exercise is `isMainLiftEligible` but its exercise range does not overlap the goal's main-lift range, it is demoted to accessory prescription for that session.
- Main-lift slots are capped at `2` per session; eligible movements are selected by ascending `orderIndex`, and additional eligible movements are prescribed as accessories.

Main-lift prescription:

- Top set reps: lower bound of effective main range
- Back-off reps: always match top-set reps (no multiplier-based rep cliff)

Accessory prescription:

- `targetReps` remains lower bound for backward compatibility
- `targetRepRange` now included on each accessory set (`{ min, max }`) for double progression support
- When accessory clamping yields a single-point range, the engine widens it to a minimum 2-rep span, expanding upward first within the exercise range.

### RPE targeting

Base target RPE:

- Hypertrophy is training-age dependent:
- beginner `7.0`
- intermediate `8.0`
- advanced `8.5`
- Other goals use static table in `rules.ts`

Adjustments:

- Readiness `<=2`: `-0.5`
- Hypertrophy isolation accessories: `+0.5`
- Periodization `rpeOffset`
- Deload cap: `min(targetRpe, 6.0)`

### Rest assignment

`getRestSeconds(...)`:

- Main lift, reps `<=5`: `240-300s` by fatigue cost
- Main lift, reps `>5`: `150-180s` by fatigue cost
- Accessory compound: `120-150s` by reps
- Isolation: `90s` when fatigue `>=3`, else `75s` floor

## Superset Runtime Behavior

Superset behavior is accessory-only and metadata-driven:

- `supersetGroup` is carried from template row to workout exercise
- Timing optimization applies only when exactly two accessory exercises share a group
- Pair round timing is: work(A) + work(B) + reduced shared rest
- Shared rest = `max(60, round(max(restA, restB) * 0.6))`
- Non-pair or malformed groups fall back to normal timing
- Main lifts do not use superset timing behavior
- Notes are labeled with `Superset {groupId}` for valid accessory pairs

## Load Assignment

`applyLoads(...)` priority:

1. Exact exercise history (`computeNextLoad`)
2. Baseline for exercise (goal-aware context preference)
3. Estimated fallback (donor baselines, bodyweight heuristics, equipment defaults)

Main lifts:

- Top set gets computed load
- Back-off sets get `topLoad * backOffMultiplier` (goal/periodization-aware; hypertrophy default is `0.88`)
- Warmup sets are added to main lifts

Accessories:

- Working sets receive uniform target load unless already set

Progression model ownership:

- Beginner: linear load progression (`+2.5-5` lbs upper, `+5-10` lbs lower), with auto-fallback to double progression after repeated stalls.
- Intermediate: double progression (increase load only after all sets reach rep ceiling at target RPE).
- Advanced: periodized loading driven by `weekInBlock` and deload modifiers.

## Timeboxing And Trimming

Template generation now enforces timeboxing:

- Session budget comes from user constraints (`sessionMinutes`)
- If estimated duration exceeds budget, accessories are trimmed by priority
- Priority prefers retaining exercises that cover uncovered muscles and reducing redundant/high-cost accessories first

## SRA Warnings

SRA warnings are generated from recent history and target muscles:

- Returned as `sraWarnings`
- Also summarized into workout `notes` when applicable

## Strict/Flexible Behavior

`isStrict` is now passed into template generation:

- `isStrict === false` enables substitution suggestion logic when check-in pain flags conflict with contraindications
- Current API response does not include substitution suggestions (they are computed internally but not returned by `generate-from-template`)

## Response And Persistence Notes

Generation route returns:

- `workout`
- `templateId`
- `sraWarnings`

Save path (`POST /api/workouts/save`) persists `targetRepRange` via `WorkoutSet.targetRepMin` / `WorkoutSet.targetRepMax` (nullable). Read paths map those columns back to `targetRepRange` when both are present, and fall back to `targetReps` when null for backward compatibility.

## Weekly Scoring Note

Template generation logic is unchanged by weekly volume recalibration. Weekly program analysis now computes effective sets as:

- `effectiveSets = directSets + 0.3 * indirectSets`
- `indirectSetMultiplier` is reported on each weekly muscle check (`0.3` in Phase 2)
- weekly muscle coverage now uses muscle-class hit targets (`3-4`, `2-3`, `1.5-2` hits/week) with a `2x/week` fallback for unknown classes (Phase 5)
