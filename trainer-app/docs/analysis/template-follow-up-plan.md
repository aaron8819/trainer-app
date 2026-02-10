# Template Follow-Up Plan

**Date:** 2026-02-10  
**Status:** Phases 1-5 Implemented; docs synced to shipped behavior  
**Scope:** Follow-up work based on `docs/analysis/post-refactor-analysis.md` after completion of `docs/archive/template-remediation-plan.md`.

## Current Implementation Status (2026-02-10)

| Phase | Priority | Status | Validation Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | P0 | Complete | Complete | Exercise rep-range clamp/demotion, `targetRepRange` persistence, and UI/read path mapping shipped. |
| 2 | P0 | Complete | Complete | Weekly indirect effective-set multiplier recalibrated to `0.3` with per-check multiplier reporting. |
| 3 | P1 | Complete | Complete | Main-lift slot cap, non-stacking recovery penalties, same-rep back-off logic, and hypertrophy back-off multiplier `0.88` shipped atomically. |
| 4 | P2 | Complete | Partially complete | Superset timing and order-scoring nuance shipped; automated tests/typecheck passed. Manual template editor analysis-panel sanity pass still recommended. |
| 5 | P3 | Complete | Complete | Weekly muscle-frequency scoring moved to muscle-class targets with `2x/week` fallback and target-aware suggestions/reporting. |

Validation run summary (implemented phases):

1. `npx prisma generate` (Phase 1)
2. `npm run test -- src/lib/engine/template-session.test.ts src/lib/engine/prescription.test.ts src/lib/validation.workout-save.test.ts src/lib/ui/workout-sections.test.ts` (Phase 1)
3. `npm run test -- src/lib/engine/weekly-program-analysis.test.ts` (Phases 2 and 5)
4. `npm run test -- src/lib/engine/template-session.test.ts src/lib/engine/prescription.test.ts src/lib/engine/weekly-program-analysis.test.ts` (Phase 3)
5. `npm run test -- src/lib/engine/apply-loads.test.ts src/lib/engine/rules.test.ts` (Phase 3)
6. `npm run test -- src/lib/engine/timeboxing.test.ts src/lib/engine/template-analysis.test.ts` (Phase 4)
7. `npx tsc --noEmit` (run after each implementation phase)

## Phase 1 Implementation Summary (2026-02-10)

### Delivered
1. Exercise-specific rep ranges are enforced in template generation.
- `src/lib/engine/template-session.ts` now passes `exercise.repRangeMin/repRangeMax` into `prescribeSetsReps(...)`.
2. Non-overlapping range edge case is handled with main-lift demotion.
- If an exercise is `isMainLiftEligible` but its rep range does not overlap the goal main range (example: strength `3-6` vs exercise `10-20`), it is prescribed as an accessory in template generation.
3. Rep ranges persist through save/reload.
- `prisma/schema.prisma` adds `WorkoutSet.targetRepMin Int?` and `WorkoutSet.targetRepMax Int?`.
- `prisma/migrations/20260210_workout_set_rep_range/migration.sql` adds both nullable columns.
- `src/lib/validation.ts` accepts optional `targetRepRange { min, max }` for save payload sets.
- `src/app/api/workouts/save/route.ts` stores `targetRepRange` to DB columns.
4. UI/read paths now preserve and show target rep ranges.
- `src/lib/ui/workout-sections.ts` maps persisted min/max back to `targetRepRange`.
- `src/app/workout/[id]/page.tsx`, `src/components/LogWorkoutClient.tsx`, and `src/components/GenerateFromTemplateCard.tsx` display ranges when present and fall back to `targetReps` when null.

### Validation Completed
1. `npx prisma generate`
2. `npm run test -- src/lib/engine/template-session.test.ts src/lib/engine/prescription.test.ts src/lib/validation.workout-save.test.ts src/lib/ui/workout-sections.test.ts`
3. `npm run test -- src/lib/engine/template-session.test.ts src/lib/engine/prescription.test.ts` (after demotion edge-case update)
4. `npx tsc --noEmit`

## Priority Summary

| Priority | Recommendation | Source Issue | Phase |
| --- | --- | --- | --- |
| P0 | Respect exercise-specific rep ranges in template generation | #1 | 1 |
| P0 | Persist `targetRepRange` to DB and return it on saved workouts | #7 | 1 |
| P0 | Recalibrate weekly indirect volume weighting to avoid double-counting | #5 | 2 |
| P1 | Cap template main-lift slots to 1-2 per session | #2 | 3 |
| P1 | Make readiness/missed penalties non-stacking | #4 | 3 |
| P1 | Remove back-off rep discontinuity at `0.9` multiplier | #3 | 3 |
| P2 | Reduce superset shared-rest assumption in time estimation | #6 | 4 |
| P2 | Add goal-sensitive nuance to Exercise Order scoring | #8 | 4 |
| P3 | Add muscle-specific weekly frequency targets | #9 | 5 |

## Phase 1: Prescription Integrity and Persistence (P0)

### Objectives
- Ensure template prescriptions use exercise-aware rep constraints.
- Preserve accessory progression ranges after save/reload.

### Changes
1. Pass exercise rep-range metadata into template prescription:
- `src/lib/engine/template-session.ts`
- Use `exercise.repRangeMin` and `exercise.repRangeMax` when calling `prescribeSetsReps(...)`.
2. Persist rep ranges at set level:
- `prisma/schema.prisma` (add `WorkoutSet.targetRepMin Int?`, `WorkoutSet.targetRepMax Int?`)
- `prisma/migrations/<timestamp>_workout_set_rep_range/migration.sql`
3. Accept and store rep-range payload on save route:
- `src/lib/validation.ts`
- `src/app/api/workouts/save/route.ts`
4. Include persisted rep range in workout/logging reads and UI:
- `src/lib/ui/workout-sections.ts`
- `src/app/workout/[id]/page.tsx`
- `src/components/LogWorkoutClient.tsx`
- `src/components/GenerateFromTemplateCard.tsx`

### Validation
- Update/add tests:
- `src/lib/engine/template-session.test.ts`
- `src/lib/engine/prescription.test.ts`
- `src/lib/validation.template.test.ts` or a new save-schema test file
- Run:
- `npx prisma generate`
- `npx tsc --noEmit`
- `npm run test -- src/lib/engine/template-session.test.ts src/lib/engine/prescription.test.ts`
- Documentation sync:
- Update `docs/template-prescription-assignment.md` and `docs/template-generation.md` to match shipped Phase 1 behavior.

## Phase 2: Weekly Volume Scorer Calibration (P0)

### Objectives
- Avoid inflated weekly effective set totals from indirect-volume double counting.

### Changes
1. Replace global indirect multiplier `0.5` with a single calibrated baseline:
- Implement global `0.3` only in this phase.
- Defer muscle-specific multipliers to a later phase (paired with muscle-classification/frequency infrastructure).
2. Keep scorer deterministic and transparent:
- Expose multiplier used in each muscle check output.
3. Update documentation:
- `docs/template-score-report.md`

### Implementation Targets
- `src/lib/engine/weekly-program-analysis.ts`
- `src/lib/engine/weekly-program-analysis.test.ts`

### Validation
- `npm run test -- src/lib/engine/weekly-program-analysis.test.ts`
- Add fixed-case snapshots for at least:
- high pressing overlap week
- mixed push/pull week
- lower-body dominant week
- Documentation sync:
- Update `docs/template-prescription-assignment.md` and `docs/template-generation.md` for any behavior touched in this phase.

## Phase 3: Main-Lift and Autoregulation Controls (P1)

### Objectives
- Prevent overloading template sessions with too many heavy main lifts.
- Smooth prescription behavior under low readiness and progression phases.

### Changes
1. Main-lift slot cap in template generation path:
- Default cap `2`, selected by template `orderIndex`.
- Eligible exercises beyond cap become accessory prescription.
2. Make readiness and missed penalties non-stacking:
- In `resolveSetCount(...)`, apply maximum single reduction (`-1`) instead of summing reductions.
3. Remove back-off rep cliff at multiplier `0.9`:
- Use top-set reps for back-off sets to keep progression continuous across small load changes.
4. Recalibrate back-off load multiplier after same-rep change:
- Update hypertrophy back-off multiplier from `0.85` to approximately `0.87-0.88` so back-off sets remain near intended target RPE when reps no longer increase.
5. Ensure load assignment remains coherent with same-rep back-off sets:
- Validate `apply-loads` behavior so `topLoad * backOffMultiplier` still aligns with expected effort and does not drift toward excessive RIR.
6. Ensure weekly-program estimation mirrors main-lift cap assumptions.

Atomic delivery note (items 3-5):
- Items `3`, `4`, and `5` are tightly coupled and must be shipped together as one atomic change.
- Removing the `0.9` rep cliff without the multiplier bump creates a regression window where back-off sets become too easy (same reps at `0.85` load -> higher RIR than intended).
- If split sequencing is unavoidable, gate item `3` behind item `4` in the same commit.

### Implementation Targets
- `src/lib/engine/template-session.ts`
- `src/lib/engine/prescription.ts`
- `src/lib/engine/rules.ts`
- `src/lib/engine/apply-loads.ts`
- `src/lib/api/weekly-program.ts`
- `src/lib/engine/template-session.test.ts`
- `src/lib/engine/prescription.test.ts`
- `src/lib/engine/apply-loads.test.ts`
- `src/lib/engine/rules.test.ts`
- `src/lib/engine/weekly-program-analysis.test.ts`

### Validation
- `npm run test -- src/lib/engine/template-session.test.ts src/lib/engine/prescription.test.ts src/lib/engine/weekly-program-analysis.test.ts`
- `npm run test -- src/lib/engine/apply-loads.test.ts src/lib/engine/rules.test.ts`
- `npx tsc --noEmit`
- Documentation sync:
- Update `docs/template-prescription-assignment.md` and `docs/template-generation.md` to match shipped Phase 3 behavior.

## Phase 4: Timing and Template-Order Scoring Nuance (P2)

### Objectives
- Improve superset time realism.
- Align order scoring with evidence differences between strength and hypertrophy priorities.

### Changes
1. Superset rest reduction in time estimator:
- Replace shared rest `max(restA, restB)` with reduced shared rest (`Math.round(max * 0.6)`), with a hard floor of `60` seconds.
2. Exercise Order weighting by template intent:
- Increase order weight for strength-oriented intents.
- Decrease order weight for hypertrophy-oriented intents.
3. Add soft penalty when non-main-eligible movements appear before main-lift-eligible movements.

### Implementation Targets
- `src/lib/engine/timeboxing.ts`
- `src/lib/engine/timeboxing.test.ts`
- `src/lib/engine/template-analysis.ts`
- `src/lib/engine/template-analysis.test.ts`
- `src/components/templates/TemplateAnalysisPanel.tsx`

### Validation
- `npm run test -- src/lib/engine/timeboxing.test.ts src/lib/engine/template-analysis.test.ts`
- Manual sanity pass in template editor analysis panel.
- Documentation sync:
- Update `docs/template-prescription-assignment.md` and `docs/template-generation.md` for any behavior touched in this phase.

## Phase 5: Weekly Frequency Precision (P3)

### Objectives
- Move from flat `2x/week` target to muscle-class-aware targets.

### Changes
1. Add frequency target profiles:
- Small muscles: `3-4` hits/week
- Medium muscles: `2-3` hits/week
- Large muscles: `1.5-2` hits/week (implemented as integer scoring thresholds)
2. Keep current `2x/week` as a fallback when muscle class is unknown.
3. Update weekly suggestions messaging to reference muscle-specific targets.

### Implementation Targets
- `src/lib/engine/weekly-program-analysis.ts`
- `src/lib/engine/weekly-program-analysis.test.ts`
- `docs/template-score-report.md`

### Validation
- `npm run test -- src/lib/engine/weekly-program-analysis.test.ts`
- Confirm no regression in existing weekly score label thresholds.
- Documentation sync:
- Update `docs/template-prescription-assignment.md` and `docs/template-generation.md` for any behavior touched in this phase.

## Cross-Phase Guardrails

1. Maintain backward compatibility for existing workouts with null rep-range columns.
2. Preserve deterministic scoring outputs for identical inputs.
3. Keep template generation within session time budget after main-lift and superset timing updates.

## Recommended PR Split

1. PR1: Phase 1 (rep-range clamp + persistence)
2. PR2: Phase 2 (weekly indirect-volume recalibration)
3. PR3: Phase 3 (main-lift cap + non-stacking fatigue + back-off smoothing)
4. PR4: Phase 4 (superset timing + order nuance)
5. PR5: Phase 5 (muscle-specific weekly frequency targets)

This sequence lands user-visible prescription correctness first, then scoring calibration, then lower-risk refinements.
