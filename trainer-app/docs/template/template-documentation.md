# Template System: Generation, Prescription, And Scoring (Consolidated)

Last updated: 2026-02-11

This document consolidates template session generation, prescription assignment, and scoring behavior into one reference.

## Source Of Truth

- `src/app/api/workouts/generate-from-template/route.ts`
- `src/app/api/analytics/program-weekly/route.ts`
- `src/lib/api/template-session.ts`
- `src/lib/api/weekly-program.ts`
- `src/lib/engine/template-session.ts`
- `src/lib/engine/prescription.ts`
- `src/lib/engine/rules.ts`
- `src/lib/engine/apply-loads.ts`
- `src/lib/engine/timeboxing.ts`
- `src/lib/engine/template-analysis.ts`
- `src/lib/engine/weekly-program-analysis.ts`
- `src/lib/engine/volume.ts`

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

Templates do not store fixed set-by-set prescriptions. Sets, reps, rest, RPE, and load are generated at runtime.

## End-To-End Generation Flow

`POST /api/workouts/generate-from-template`:

1. Validate `templateId`.
2. Load template and workout context (profile, goals, constraints, history, preferences, check-in, exercise library, baselines).
3. Ignore check-ins older than 48 hours.
4. Derive `weekInBlock` and periodization modifiers via `getPeriodizationModifiers(...)`.
5. If `shouldDeload(history)` is true and the week is not already a deload, override to deload modifiers.
6. Map template rows into engine inputs, including `orderIndex` and `supersetGroup`.
7. Generate the prescription in `generateWorkoutFromTemplate(...)`.
8. Pre-load timebox using projected warmup ramps for load-resolvable main lifts.
9. Apply loads via `applyLoads(...)`.
10. Post-load timebox as a safety net if still over budget.
11. Return `{ workout, templateId, sraWarnings, substitutions }`.

## Main Vs Accessory Classification

For each template exercise:

- Main lift if `exercise.isMainLiftEligible === true` and exercise rep range overlaps the goal main-lift range.
- Otherwise accessory.
- Main-lift slots are capped at `2` per session; eligible movements are selected by ascending `orderIndex`.
- If `isMainLiftEligible` is true but the exercise range does not overlap the goal main-lift range, the exercise is demoted to accessory for that session.

This classification controls set-count base, rep logic, rest logic, and load and warmup behavior.

## Fatigue State Inputs

`deriveFatigueState(history, checkIn)`:

- `readinessScore`: latest non-stale check-in readiness (<=48 hours old), else latest history readiness, else `3`.
- `missedLastSession`: true if most recent workout status is `SKIPPED`.
- `painFlags`: latest non-stale check-in pain flags if present, else latest history flags.

`readinessScore` and `missedLastSession` affect set count and target RPE.

## Set Count Assignment

`resolveSetCount(isMainLift, trainingAge, fatigueState, setMultiplier)`:

- Base sets: main `4`, accessory `3`.
- Training age modifiers: beginner `0.85`, intermediate `1.0`, advanced `1.15`.
- Step 1: `baselineSets = round(baseSets * ageModifier)`, floor `2`.
- Step 2: if readiness `<=2` or `missedLastSession`, subtract `1` once, floor `2`.
- Step 3: apply periodization `round(recoveryAdjusted * setMultiplier)`, floor `2`.

## Rep Ranges And Rep Targets

Goal rep ranges (`REP_RANGES_BY_GOAL`):

- Hypertrophy: main `6-10`, accessory `10-15`.
- Strength: main `3-6`, accessory `6-10`.
- Fat loss: main `8-12`, accessory `12-20`.
- Athleticism: main `4-8`, accessory `8-12`.
- General health: main `8-12`, accessory `10-15`.

Template-path behavior:

- Template generation passes `exerciseRepRange` from `exercise.repRangeMin` / `exercise.repRangeMax` when available.
- Effective range is the intersection of goal range and exercise range.
- If there is no overlap, the exercise range is used.

Main-lift reps:

- Top set reps = lower bound of effective main range.
- Back-off reps = top-set reps (no multiplier-based rep change).
- Deload: all working sets use top-set reps.

Accessory reps:

- Each set gets `targetReps = accessoryRange.min` (legacy field) and `targetRepRange = { min, max }`.
- If clamping yields a single-point range, the engine widens to at least a 2-rep span for progression, expanding upward first within the exercise range.

## RPE Targeting

Base target RPE:

- Hypertrophy is training-age specific: beginner `7.0`, intermediate `8.0`, advanced `8.5`.
- Other goals use the static base table in `rules.ts`.

Adjustments applied in order:

- Readiness `<=2`: `-0.5`.
- Hypertrophy isolation accessories: `+0.5`.
- Periodization `rpeOffset`.
- Deload cap: `targetRpe = min(targetRpe, 6.0)`.

## Rest Assignment

`getRestSeconds(exercise, isMainLift, targetReps)`:

Main lifts:

- Reps `<=5`: `300s` if fatigue `>=4`, else `240s`.
- Reps `>5`: `180s` if fatigue `>=4`, else `150s`.

Accessories:

- Compound: `150s` if reps `<=8`, else `120s`.
- Isolation: `90s` if fatigue `>=3`, else `75s`.

All working sets are persisted with explicit `restSeconds`.

## Superset Runtime Behavior

Superset behavior is accessory-only and metadata-driven:

- `supersetGroup` is carried from template row to workout exercise.
- Timing optimization applies only when exactly two accessory exercises share a group.
- Pair round timing is work(A) + work(B) + reduced shared rest.
- Shared rest = `max(60, round(max(restA, restB) * 0.6))`.
- Non-pair or malformed groups fall back to normal timing.
- Main lifts do not use superset timing behavior.
- Notes are labeled with `Superset {groupId}` for valid accessory pairs.

## Load Assignment

`applyLoads(...)` priority:

1. Exact exercise history (`computeNextLoad`).
2. Baseline for exercise (goal-aware context preference).
3. Estimated fallback (donor baselines, bodyweight heuristics, equipment defaults).

Main lifts:

- Set 1 gets computed top load.
- Sets 2+ get `topLoad * backOffMultiplier` (hypertrophy default `0.88`).
- Warmup sets are added automatically.
- Role assignment is explicit in two places:
- `template-session.ts` sets exercise/working-set roles (`main` / `accessory`) during prescription.
- `apply-loads.ts` sets generated warmup-ramp set role to `warmup` at creation time.
- Deload: all working sets use `topLoad * backOffMultiplier`.

Accessories:

- Uniform working load unless pre-filled.

Progression model selection is engine-owned by `trainingAge`:

- Beginner: linear load progression with fixed jump ranges and stall fallback to double progression.
- Intermediate: double progression (increase load only after all sets reach rep ceiling at target RPE).
- Advanced: periodized loading driven by `weekInBlock` and deload modifiers.
- Adaptive deloads: if `shouldDeload(history)` triggers outside the scheduled deload week, periodization is overridden and a recovery note is appended.

## Timeboxing And Trimming

Timeboxing runs twice against `constraints.sessionMinutes`.

Pre-load pass (`generateWorkoutFromTemplate(...)`):

- Estimated duration includes projected main-lift warmup ramps for load-resolvable lifts.
- Accessories are trimmed iteratively via `trimAccessoriesByPriority(...)` when over budget.

Post-load safety net (`applyLoads(...)`):

- Re-estimate includes assigned warmup ramps.
- Accessories are trimmed iteratively only if still over budget.
- Main lifts are preserved.
- For valid accessory supersets, shared rest is reduced to `max(60, round(max(restA, restB) * 0.6))` before trimming decisions.

Priority prefers retaining exercises that cover uncovered muscles and reducing redundant or high-cost accessories first.

## Strict Vs Flexible Template Behavior

`isStrict` is passed into template generation:

- `isStrict === false` enables substitution suggestion logic when check-in pain flags conflict with contraindications.
- API response includes substitution suggestions as non-blocking recommendations (`substitutions`).

## SRA Warnings

SRA warnings are generated from recent history and target muscles:

- Returned as `sraWarnings`.
- Also summarized into workout `notes` when applicable.

## Output And Persistence Notes

Generation response includes set-level `targetReps`, optional `targetRepRange`, `targetRpe`, `targetLoad`, and `restSeconds`.

Save path (`POST /api/workouts/save`) persists `targetRepRange` via `WorkoutSet.targetRepMin` / `WorkoutSet.targetRepMax` (nullable). Read paths map those columns back to `targetRepRange` when both are present, and fall back to `targetReps` when null for backward compatibility.
Save path also persists `WorkoutExercise.section` (`WARMUP | MAIN | ACCESSORY`) when provided, so log/detail rendering can use persisted sectioning instead of warmup-count heuristics.

## Template Scoring (Single Session)

Scoring labels:

- `Excellent`: `>=85`.
- `Good`: `>=70`.
- `Fair`: `>=55`.
- `Needs Work`: `>=40`.
- `Poor`: `<40`.

Template scorer inputs:

- Exercise metadata: `isCompound`, `isMainLiftEligible`, `movementPatterns`, `muscles` (primary or secondary), `sfrScore`, `lengthPositionScore`, `fatigueCost`, `orderIndex`.
- Template metadata: `intent`.

Overall score:

- Weighted average, rounded and clamped to `0-100`.
- Base weights:
- Muscle Coverage `0.24`.
- Push/Pull Balance `0.12`.
- Compound/Isolation `0.12`.
- Movement Diversity `0.12`.
- Lengthened Position `0.14`.
- SFR Efficiency `0.14`.
- Exercise Order is intent-adjusted:
- `FULL_BODY` or `UPPER_LOWER`: `0.16`.
- `CUSTOM`: `0.12`.
- `PUSH_PULL_LEGS` or `BODY_PART`: `0.08`.
- Intent-adjusted weights are normalized by the active-dimension total before final score calculation, so overall weighting still sums effectively to `1.0`.
- Push/Pull is gated by intent and scope applicability. If not applicable, that dimension is excluded and weights are normalized by total included weight.

Template scoring dimensions:

- Muscle Coverage: critical muscles are `MEV > 0` in `VOLUME_LANDMARKS`, coverage is intent-scoped, score is 80% critical and 20% non-critical with primary hit `1.0` and secondary hit `0.4`.
- Push/Pull Balance: primary-muscle bucket counts, applicable only when scope includes both push and pull, non-applicable templates get neutral `75` and are excluded from overall weighting, applicable score targets a `1:1` session balance.
- Compound/Isolation Ratio: intent-specific target ranges, in-range scores `100`, out-of-range scales linearly.
- Movement Pattern Diversity: expected pattern set is intent-scoped, `FULL_BODY` targets `5`, others target `max(2, ceil(expected * 0.75))`, rotation and anti-rotation add `+5` each.
- Lengthened Position Coverage: average `lengthPositionScore` (default `3` when missing) maps 1-5 to 0-100, bonus or penalty ratio-normalized by exercise count.
- SFR Efficiency: average `sfrScore` (default `3` when missing) maps 1-5 to 0-100, bonus or penalty ratio-normalized by exercise count, low-SFR penalties apply only to low-SFR isolation movements.
- Exercise Order: exercises sorted by `orderIndex`, score penalizes upward `fatigueCost` transitions, soft penalty if non-main-lift-eligible movements are ordered before main-lift-eligible movements, best score is achieved when fatigue cost trends down through the session.

Suggestions:

- Up to 3 suggestions are generated.
- Triggered by missing coverage, push/pull imbalance, ratio drift, missing movement patterns, low length or SFR, poor fatigue ordering, and main-lift-priority ordering violations.

## Weekly Program Scoring (Rotation Level)

Phase 5 introduced a rotation-level scorer that evaluates what template-level scoring cannot fully assess.

Data selection:

- `loadWeeklyProgramInputs(...)` builds session inputs from templates.
- If `templateIds` query param is provided, those templates are scored.
- Otherwise, templates are selected by most recent update order, limited by `constraints.daysPerWeek`.
- Per-exercise set counts are estimated deterministically using `resolveSetCount(...)` with neutral fatigue defaults and user training age.

Endpoint:

- `GET /api/analytics/program-weekly`.
- Optional query: `templateIds=id1,id2,id3`.
- Response includes `selection` metadata and `analysis` (weekly scores and suggestions).

Weekly scoring weights:

- Weekly Muscle Coverage `0.30`.
- Weekly Push/Pull Balance `0.20`.
- Weekly Movement Pattern Diversity `0.20`.
- Weekly Volume Checks `0.30`.

Weekly dimensions:

- Weekly Muscle Coverage: critical muscles are `MEV > 0`, weekly hit targets by muscle class with fallback of `2` hits when class is unknown, credit uses 1.0 for full threshold, 0.5 for partial, 0 for none, per-muscle targets are included in outputs as `targetWeeklyHitsByMuscle`.
- Weekly Push/Pull Balance: primary-muscle set totals across selected sessions, target pull to push ratio `1.0` to `2.0`, in-range scores `100`, out-of-range scales down, if either side is zero score is `0`.
- Weekly Movement Pattern Diversity: core patterns are horizontal or vertical push or pull, squat, hinge, lunge, carry; bonus patterns rotation and anti-rotation add `+5` each.
- Weekly Volume Checks: per-muscle `directSets` from primary exposure and `indirectSets` from secondary exposure, `effectiveSets = directSets + 0.3 * indirectSets`, zones `below_mv`, `mv_to_mev`, `mev_to_mav`, `mav_to_mrv`, `above_mrv`.

Weekly volume scoring for critical muscles:

- `1.0` point when `effectiveSets` is within `MEV-MAV`.
- `0.6` point when within `MV-MRV` but outside `MEV-MAV`.
- `0` otherwise.

## Determinism

Both scorers are deterministic for identical inputs:

- No random weighting or stochastic tie-break logic.
- Sorted and normalized operations are used where ordering matters.

## Weekly Scoring Note

Template generation and prescription assignment are unchanged by weekly volume recalibration. Weekly program analysis computes:

- `effectiveSets = directSets + 0.3 * indirectSets`.
- `indirectSetMultiplier` is reported on each weekly muscle check (`0.3` in Phase 2).
- Weekly muscle coverage uses muscle-class hit targets (`3-4`, `2-3`, `1.5-2` hits per week) with a `2x/week` fallback for unknown classes (Phase 5).
