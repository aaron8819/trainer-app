# Engine Refactor 2.5 - Final Implementation Plan

This document captures the finalized implementation plan for the workout engine refactor ("2.5"), incorporating the latest decisions and refinements.

## Implementation Status (as of 2026-02-06)

- Item 1 (applyLoads + hybrid estimation) implemented with unit tests and wired into API generation.
- Item 2 (Baseline.exerciseId + migration + backfill script) added to schema and scripts.
- Seeded ExerciseAlias entries for baseline names; backfill now resolves all seeded baselines (26 additional matched via alias).
- Removed legacy applyBaselines path to avoid conflicting load assignment.
- Item 3 (perpetual PPL split queue) implemented with coverage test.
- Item 5 (main vs accessory rep ranges) implemented in rules and prescription.
- Item 4 (top set + back-off structure with set-aware load assignment) implemented in engine + applyLoads.
- Item 6 (rest period scaling by exercise type) implemented with tests.
- Item 7 (SessionCheckIn gating UI) implemented with inline check-in form + API route.
- Item 10 (seed stimulusBias assignments) implemented in seed data.
- Item 8 (slot-based accessory selection) implemented with standalone tests and engine integration.
- Item 9 (recency weighting + seeded randomization) implemented for slot selection.
- Item 11 (smart timeboxing trims by priority) implemented with tests.
- Item 12 (seed isCompound for accessories) implemented in seed data.
- Item 13 (seed contraindications + pain filtering) implemented in seed data and engine filtering.
- Item 14 (warmup ramp-up sets per main lift) implemented with timeboxing coverage.
- Item 15 (periodization modifiers + week derivation) implemented.
- End-to-end PPL fixture tests added for generateWorkout + applyLoads coverage.
- Item 16 (proactive volume-aware accessory selection) implemented in slot scoring.



## Decisions Locked

- Baselines will be FK-based: add exerciseId to Baseline, backfill, and use it as the primary lookup.
- Load assignment stays in the API/context layer (not inside the engine) to keep the engine pure.
- Execution order: Item 1 -> Item 2 -> Item 3 -> Item 5 -> Item 4 -> Item 6 -> Item 7.
- Split queue for PPL is perpetual, not weekly-reset.
- Top set/back-off semantics are inferred by setIndex (no setType field).
- Hybrid load estimation is required (history -> baseline -> estimation).
- Periodization fallback uses calendar-based weeks, not count-based.
- Weighted selection must be deterministic in tests via a seeded PRNG.

## Scope and Goals

Primary goals:
- Always output targetLoad where possible.
- Correct PPL rotation across weeks.
- Improve programming quality (rep ranges, top set/back-off, rest scaling).
- Replace fragile accessory selection with muscle-target slots and diversity.
- Enable readiness and pain inputs via check-in gating.

Non-goals:
- Full periodization engine rework beyond the 4-week linear model.
- UI overhaul beyond the minimal SessionCheckIn flow.

## Execution Order (Confirmed)

1. Item 1 - Apply loads with hybrid estimation (history -> baseline -> estimate).
2. Item 2 - Baseline FK migration and backfill.
3. Item 3 - Perpetual split queue fix.
4. Item 5 - Separate main/accessory rep ranges.
5. Item 4 - Top set + back-off structure with set-aware load assignment.
6. Item 6 - Rest period scaling by exercise type.
7. Item 7 - SessionCheckIn gating UI.

## Tier 1 - Fix What’s Broken

### Item 1 - Apply Loads with Hybrid Estimation

Goal:
- Every exercise gets a targetLoad unless it is truly bodyweight-only.

Strategy:
- Tier 1: Use history via computeNextLoad for the exact exercise.
- Tier 2: Use baselines by exerciseId.
- Tier 3: Estimate.

Estimation details (Tier 3):
- Step A: Same-muscle inheritance from baselined exercises.
- Scale by equipment compatibility and compound status.
- Scale by fatigueCost ratio: scaledLoad = donorLoad * clamp(targetFatigue / donorFatigue, 0.45, 0.80).
- Step B: Bodyweight ratios by movement and equipment when no donors exist.
- Step C: Conservative equipment defaults when bodyweight is unknown.

Implementation notes:
- applyLoads() lives in workout-context layer and is post-generation.
- applyLoads() should accept a map keyed by exerciseId.
- Before Item 2 lands, the caller resolves name/alias -> exerciseId.
- After Item 2, the caller uses baseline.exerciseId directly.

Acceptance:
- targetLoad is present for main lifts and accessories when history, baseline, or estimation is available.
- Bodyweight-only exercises can keep targetLoad undefined or 0 (explicitly documented).

### Item 2 - Baseline FK Migration

Goal:
- Remove fragile string matching in the hot path.

Plan:
- Add Baseline.exerciseId (nullable initially).
- Backfill using:
  - exact name match
  - alias table lookup
  - normalized name fallback
- Make exerciseId the primary resolution path in applyLoads.
- Keep alias table for display/legacy only.
- Backfill utility: trainer-app/scripts/backfill-baseline-exercise-id.ts.

Acceptance:
- Baseline resolution uses exerciseId first.
- Documented mismatch rate goes to near-zero for seeded exercises.

### Item 3 - Perpetual Split Queue Fix

Goal:
- PPL rotation advances continuously across weeks.

Plan:
- Use completed advancing workouts count modulo pattern length.
- pattern length = SPLIT_PATTERNS[splitType].length.
- Ignore daysPerWeek for modulo.

Example:
- PPL length 5, training 3 days/week yields:
  - Week 1: Push, Pull, Legs
  - Week 2: Push, Pull, Push
  - Week 3: Pull, Legs, Push

Acceptance:
- Sequence matches perpetual queue behavior.
- UX displays next split day clearly in workout detail view.

## Tier 2 - Core Quality Improvements

### Item 5 - Separate Main/Accessory Rep Ranges

Goal:
- Avoid too-heavy accessories and too-light main lifts.

Plan:
- Change REP_RANGES_BY_GOAL to { main, accessory }.
- Update ProgressionRule or derivation logic accordingly.
- Ensure computeNextLoad uses the role-correct range.

Acceptance:
- Strength accessories target 6-10 reps, not 3-6.
- Hypertrophy main lifts can sit in 6-10 range, accessories in 10-15.

### Item 4 - Top Set + Back-Off Structure

Goal:
- Main lifts use a real programming structure rather than identical sets.

Set semantics:
- If isMainLift and setIndex == 1 -> top set.
- If isMainLift and setIndex > 1 -> back-off set.
- If not main lift -> uniform sets.

Load semantics:
- Top set load comes from applyLoads (history/baseline/estimate).
- Back-off load = topSetLoad * backOffMultiplier.

Back-off multipliers:
- Strength: 0.90
- Hypertrophy: 0.85
- Fat loss and general health: 0.85

Acceptance:
- Main lifts show varied load across sets.
- Accessories remain uniform unless explicitly changed later.

### Item 6 - Rest Period Scaling

Goal:
- Compound accessories receive more rest, isolation less.

Plan:
- Add getRestSeconds(exercise, isMainLift).
- Use isCompound and fatigueCost to scale rest.

Acceptance:
- Accessory rest ranges roughly 60-120 seconds.

### Item 7 - SessionCheckIn Gating UI

Goal:
- Readiness and pain signals are captured before generation.

Flow:
- Generate -> Check-In screen -> Submit -> Generate workout.
- Skip path defaults readiness to 3.

Acceptance:
- Latest check-in is stored before generation.
- Engine uses check-in when present.
- Workout detail panel shows readiness and pain flags when a check-in exists.

## Tier 3 - Selection Intelligence

### Item 8 - Muscle-Target Slots for PPL Accessories

Slot definitions (locked):
- Push: chest isolation (stretch/metabolic bias), side delt, triceps isolation, fill.
- Pull: rear delt or upper back, biceps, row or vertical pull variant, fill.
- Legs: quad isolation, hamstring isolation, glute/unilateral, calf, fill.

Selection criteria:
- Use primaryMuscles, stimulusBias, movementPatternsV2.
- Avoid overlap with main lifts where possible.

### Item 9 - Recency Weighting + Controlled Randomization

Plan:
- Weighted pick with:
  - favorite bonus
  - recency penalty
  - novelty bonus
- Deterministic seeded PRNG for tests.
- Default to Math.random in production if no seed is provided.

### Item 10 - Seed stimulusBias and use for diversity

Plan:
- Add stimulusBias in seed data.
- Map to engine types and use in slot selection.

### Item 11 - Smart Timeboxing

Plan:
- Trim accessories by lowest priority, not by position order.
- Suggested priority uses fatigueCost and unique muscle contribution.

## Tier 4 - Polish and Depth

### Item 12 - Fix isCompound Derivation

Plan:
- Seed compound status for non-main compound accessories.
- Avoid relying on isMainLift.

### Item 13 - Seed contraindications

Plan:
- Populate contraindications and use them as primary pain filter.
- Keep regex heuristics only as a fallback.

### Item 14 - Warmup Ramp-Up Sets for Main Lifts

Plan:
- After load assignment, add warmup sets for main lifts.
- Do not overload timeboxing logic.

### Item 15 - Periodization (4-week linear model)

Implementation summary:
- Model: 4-week linear block (Week 1 accumulation, Week 2 baseline, Week 3 intensification, Week 4 deload).
- Week derivation: ProgramBlock present uses `weekInBlock = floor((scheduledDate - blockStartDate) / 7) % blockWeeks` with `blockStartDate` = earliest workout date in the block; no ProgramBlock uses a rolling 4-week window `weekInBlock = floor((scheduledDate - oldestRecentWorkoutDate) / 7) % 4`; sparse history (< 2 weeks) forces `weekInBlock = 0`.
- Modifiers by week: Week 1 `rpeOffset = -1.0`, `setMultiplier = 1.0`, `backOffMultiplier = standard`; Week 2 `rpeOffset = 0`, `setMultiplier = 1.0`, `backOffMultiplier = standard`; Week 3 `rpeOffset = +0.5`, `setMultiplier = 0.85`, `backOffMultiplier = standard`; Week 4 deload `setMultiplier = 0.6`, `backOffMultiplier = 0.75`, `rpeCap = 6.0`.
- Deload behavior: main-lift top-set structure is skipped; all sets are uniform at deload RPE, and deload loads use the 0.75 back-off scale.
- Touchpoints: `deriveWeekInBlock` in `trainer-app/src/lib/api/periodization.ts`; `getPeriodizationModifiers` in `trainer-app/src/lib/engine/rules.ts`; `generateWorkout` and `applyLoads` consume modifiers.
- Schema: no new fields (week is derived at generation time).
### Item 16 - Volume-aware Proactive Selection

Plan:
- Use volume caps during selection to avoid trimming later.
- Down-weight or skip candidates that would exceed caps.

## Testing Strategy

- Add canonical fixture builder in engine tests to avoid repeated setup.
- Use seeded PRNG in tests for any randomized selection.
- Add tests for:
  - Perpetual PPL queue
  - Hybrid load estimation tiers
  - Top set/back-off load scaling
  - Rep range split (main vs accessory)
  - Slot-based accessory selection
  - End-to-end PPL fixtures (push/pull/legs) covering generate -> applyLoads

## Risks and Mitigations

- Risk: Estimation loads are too aggressive.
- Mitigation: conservative clamps, fatigueCost scaling, and defaults.

- Risk: PPL perpetual queue confusion.
- Mitigation: clear "Next split" UI indicator.

- Risk: FK migration misses legacy baselines.
- Mitigation: alias-driven backfill with a mismatch report.

## Known Follow-ups

- Legs slot isolation picks should enforce non-compound constraints (quad/hamstring iso slots can still pick compound hinges in edge cases).

## File Touchpoints (Core)

- trainer-app/src/lib/engine/engine.ts
- trainer-app/src/lib/engine/rules.ts
- trainer-app/src/lib/engine/types.ts
- trainer-app/src/lib/api/workout-context.ts
- trainer-app/src/app/api/workouts/generate/route.ts
- trainer-app/src/app/api/workouts/next/route.ts
- trainer-app/prisma/schema.prisma
- trainer-app/prisma/seed.ts
- trainer-app/src/lib/engine/engine.test.ts

