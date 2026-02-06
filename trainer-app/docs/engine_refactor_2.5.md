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
- Main lift selection now uses the same recency-weighted seeded randomization for PPL main lifts.
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

## Consolidated Engine Behavior + Schema

This section consolidates the prior `workout-engine.md` and `engine-schema-behavior.md` references into a single source of truth.

### Key Engine Guarantees

1. **Strict split purity (hard gate)**
- PPL days are filtered by `Exercise.splitTags`.
- Push day only selects exercises tagged `PUSH`.
- Pull day only selects exercises tagged `PULL`.
- Legs day only selects exercises tagged `LEGS`.
- Exercises tagged with both `PUSH` and `PULL` are rejected and must be reclassified.

2. **Template-only special blocks**
- `CORE`, `MOBILITY`, `PREHAB`, `CONDITIONING` exercises are only selectable in explicit warmup or finisher blocks.
- They are never chosen as general accessories.

3. **Movement intelligence**
- The engine pairs main lifts by `movementPatternsV2`:
- Push: 1 horizontal + 1 vertical press.
- Pull: 1 vertical pull + 1 horizontal row (prefers chest-supported when low-back pain).
- Legs: 1 squat + 1 hinge.

4. **Timeboxing is enforced**
- The session time budget is enforced by dropping accessories first until the plan fits `sessionMinutes`.

5. **Load progression guardrails**
- Double progression logic remains the default.
- RPE guardrails adjust load up or down by 2-3%.
- Any load change is capped at 7% per step.

6. **Volume spike caps**
- Weekly volume is enforced using a rolling 7-day window.
- If a muscle group would exceed 20% over the prior window, accessories are trimmed.

7. **Readiness + pain check-ins**
- The most recent `SessionCheckIn` drives readiness and pain filtering.
- Injuries reduce high joint-stress exercises.

### Schema Changes (Summary)

Exercise (extended):
- `splitTags` (SplitTag[])
- `movementPatternsV2` (MovementPatternV2[])
- `isMainLiftEligible` (boolean)
- `isCompound` (boolean)
- `fatigueCost` (int 1-5)
- `stimulusBias` (StimulusBias[])
- `contraindications` (jsonb)
- `timePerSetSec` (int)

ExerciseAlias (new):
- `exerciseId` -> `Exercise.id`
- `alias` (unique)

Baseline (extended):
- `exerciseId` (non-nullable FK, unique constraint: `userId, exerciseId, context`)

ExerciseVariation (extended):
- `variationType` (VariationType)
- `metadata` (jsonb)

Constraints (extended):
- `availableEquipment` (EquipmentType[])

SessionCheckIn (new):
- `readiness` (1-5)
- `painFlags` (jsonb)
- `date`, `notes`, `workoutId`

SubstitutionRule (extended):
- `priority` (int)
- `constraints` (jsonb)
- `preserves` (jsonb)

### Data Inputs Used

Profile:
- Training age controls set scaling.

Goals:
- Rep range and target RPE are taken from `rules.ts` by primary goal.
- Rep ranges are role-specific (main vs accessory).

Constraints:
- `Constraints.availableEquipment` is enforced.
- `sessionMinutes` is used to timebox the plan.

Exercise Library:
- Uses the upgraded `Exercise` model:
- `splitTags`, `movementPatternsV2`, `isMainLiftEligible`, `isCompound`, `fatigueCost`, `timePerSetSec`.

Session Check-In:
- `readiness` drives fatigue adjustments.
- `painFlags` drive joint-friendly filtering and substitutions.

### End-to-End Flow

1. **API request**
- `POST /api/workouts/generate` or `POST /api/workouts/next`

2. **Load data**
- `loadWorkoutContext()` fetches profile, goals, constraints, injuries, baselines, exercises, workouts, preferences, and the most recent `SessionCheckIn`.

3. **Map DB models to engine types**
- `mapProfile`, `mapGoals`, `mapConstraints`, `mapExercises`, `mapHistory`, `mapCheckIn`.

4. **Generate workout**
- `generateWorkout()` selects a split day, chooses main lifts and accessories, then timeboxes the plan.

5. **Apply loads**
- `applyLoads()` assigns target load using: history -> baseline -> estimation (muscle-based donor scaling, then bodyweight ratios, then equipment defaults).

6. **Return plan**
- The API returns the final `WorkoutPlan` with warmup, main lifts, accessories, sets, and estimated time.

### Selection Details (PPL)

Main lift pairing:
- Push: 1 horizontal press + 1 vertical press.
- Pull: 1 vertical pull + 1 horizontal row.
- Legs: 1 squat + 1 hinge.

Main lift variety:
- Main lifts use recency weighting and seeded randomness for variety.
- Recent main lifts are deprioritized.

Accessories:
- Accessories are chosen from the same splitTag pool.
- PPL accessory selection uses slot-based picks by primary muscles and stimulusBias.
- Fill slots favor uncovered muscles relative to main lifts and prior accessories.
- Selection uses recency weighting and seeded randomness for variety.
- Special blocks only appear if the template explicitly requests them.

Warmup or finisher blocks:
- `MOBILITY` and `PREHAB` are used as warmup options.
- `CORE` can be appended as an optional finisher.
- `CONDITIONING` can be appended on legs day when optional conditioning is enabled.

### Progression Summary

- If all sets hit the top of the rep range at or below target RPE, load increases.
- If early sets exceed target RPE by +1, load decreases next session.
- If all sets are at or below target RPE by -2, load increases.
- All load changes are capped at 7%.
- Main lifts use a top set + back-off structure; back-off loads are derived from the top set.
- Rest periods scale by exercise type (main lift vs compound accessory vs isolation).

### Known Gaps (Tracked)

- Muscle volume caps rely on `Exercise.primaryMuscles`; these are not fully seeded yet.
- Substitution suggestions are available (`suggestSubstitutes`) but not currently surfaced in the UI. Tests added in Phase 4B.
- ~~Contraindications are still a fallback~~ — now the primary pain filter; regex heuristics are still a fallback for untagged exercises.
- ~~Legs slot isolation picks should enforce non-compound constraints~~ — **Resolved in Phase 3B**: isolation slots prefer `!isCompound` with compound fallback when the filtered pool is empty.

### Current UI Flow (Generation)

- Entry point is the dashboard at `/`, which renders `GenerateWorkoutCard`.
- Tapping "Generate Workout" expands the inline `SessionCheckInForm` instead of calling the API immediately.
- Submit path: `POST /api/session-checkins` then `POST /api/workouts/generate`.
- Skip path: `POST /api/workouts/generate` directly with no check-in saved.
- During generation, buttons show "Generating..." and disable; errors appear inline.
- After generation, the card shows a preview and a "Save Workout" button.
- Saving calls `POST /api/workouts/save`; on success, links appear for `/workout/[id]` and `/log/[id]`.

### Workout Detail Layout (Current)

- Route `/workout/[id]` shows a "Session Overview" header with estimated minutes and a "Start logging" button.
- The "Why this workout was generated" panel includes readiness and pain flags when a check-in exists.
- Exercises are grouped into Warmup, Main Lifts, and Accessories sections.
- Each exercise card shows set count, target reps, target load, target RPE, and a short "Why" note.

### UI File Touchpoints

- `trainer-app/src/app/page.tsx`
- `trainer-app/src/components/GenerateWorkoutCard.tsx`
- `trainer-app/src/components/SessionCheckInForm.tsx`
- `trainer-app/src/app/api/session-checkins/route.ts`
- `trainer-app/src/app/api/workouts/generate/route.ts`
- `trainer-app/src/app/api/workouts/save/route.ts`
- `trainer-app/src/app/workout/[id]/page.tsx`
- `trainer-app/src/app/log/[id]/page.tsx`
- `trainer-app/src/components/LogWorkoutClient.tsx`
- `trainer-app/src/lib/ui/workout-sections.ts`

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
- Main lifts now use the same recency-weighted selection as accessories.

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
- Modifiers by week: Week 0 (Introduction) `rpeOffset = -1.0`, `setMultiplier = 1.0`, `backOffMultiplier = standard`; Week 1 (Accumulation) `rpeOffset = 0`, `setMultiplier = 1.0`, `backOffMultiplier = standard`; Week 2 (Intensification) `rpeOffset = +0.5`, `setMultiplier = 0.85`, `backOffMultiplier = standard`; Week 3 (Deload) `setMultiplier = 0.6`, `backOffMultiplier = 0.75`, `rpeCap = 6.0`.
- Deload behavior: main-lift top-set structure is skipped; all sets are uniform at deload RPE, and deload loads use the 0.75 back-off scale.
- Touchpoints: `deriveWeekInBlock` in `trainer-app/src/lib/api/periodization.ts`; `getPeriodizationModifiers` in `trainer-app/src/lib/engine/rules.ts`; `generateWorkout` and `applyLoads` consume modifiers.
- Schema: no new fields (week is derived at generation time).
### Item 16 - Volume-aware Proactive Selection

Plan:
- Use volume caps during selection to avoid trimming later.
- Down-weight or skip candidates that would exceed caps.

## Testing Strategy

- Canonical fixture builder in `sample-data.ts` (`exampleUser`, `exampleGoals`, `exampleConstraints`, `exampleExerciseLibrary`).
- Seeded PRNG in all randomized tests (`randomSeed` parameter).
- Test coverage includes:
  - Perpetual PPL queue
  - Hybrid load estimation tiers (history, baseline, donor, bodyweight)
  - Top set/back-off load scaling
  - Rep range split (main vs accessory)
  - Slot-based accessory selection (PPL, upper_lower, full_body)
  - End-to-end PPL fixtures covering generate -> applyLoads
  - Non-PPL integration tests (upper_lower, full_body) — Phase 4C
  - Baseline update logic (`baseline-updater.test.ts`, 20 tests) — Phase 4A
  - Substitution suggestions (`substitution.test.ts`, 8 tests) — Phase 4B
  - Donor estimation with movement pattern overlap — Phase 7A
  - Volume caps using `scoreAccessoryRetention` — Phase 3A
  - Utils (`utils.test.ts`, 26 tests) — Phase 1A

## Risks and Mitigations

- Risk: Estimation loads are too aggressive.
- Mitigation: conservative clamps, fatigueCost scaling, and defaults.

- Risk: PPL perpetual queue confusion.
- Mitigation: clear "Next split" UI indicator.

- Risk: FK migration misses legacy baselines.
- Mitigation: alias-driven backfill with a mismatch report.

## Known Follow-ups

- ~~Legs slot isolation picks should enforce non-compound constraints~~ — **Resolved in Phase 3B.**

## File Touchpoints (Core)

Engine modules (decomposed from monolithic `engine.ts` in Phase 2):
- `src/lib/engine/engine.ts` — orchestrator (`generateWorkout`, `buildWorkoutExercise`)
- `src/lib/engine/split-queue.ts` — `SPLIT_PATTERNS`, `getSplitDayIndex`, `resolveTargetPatterns`, `resolveAllowedPatterns`
- `src/lib/engine/filtering.ts` — `selectExercises`, `isMainLiftEligible`, `hasBlockedTag`, pain/stall/injury filtering
- `src/lib/engine/main-lift-picker.ts` — `pickMainLiftsForPpl`
- `src/lib/engine/pick-accessories-by-slot.ts` — slot-based accessory selection (PPL + upper_lower + full_body)
- `src/lib/engine/prescription.ts` — `prescribeSetsReps`, `resolveSetCount`, `getRestSeconds`
- `src/lib/engine/volume.ts` — `buildVolumeContext`, `enforceVolumeCaps`, `deriveFatigueState`
- `src/lib/engine/timeboxing.ts` — `estimateWorkoutMinutes`, `trimAccessoriesByPriority`
- `src/lib/engine/substitution.ts` — `suggestSubstitutes`
- `src/lib/engine/progression.ts` — `computeNextLoad`, `shouldDeload`
- `src/lib/engine/utils.ts` — shared helpers (`normalizeName`, `buildRecencyIndex`, `weightedPick`, etc.)
- `src/lib/engine/random.ts` — seeded PRNG (`createRng`)
- `src/lib/engine/rules.ts` — constants and periodization (`REP_RANGES_BY_GOAL`, `getBackOffMultiplier`, etc.)
- `src/lib/engine/types.ts` — all engine type definitions
- `src/lib/engine/index.ts` — barrel re-exports

Other core files:
- `src/lib/api/workout-context.ts` — DB-to-engine mapping
- `src/lib/api/baseline-updater.ts` — baseline update logic (extracted from route in Phase 4A)
- `src/app/api/workouts/generate/route.ts`
- `src/app/api/workouts/next/route.ts`
- `src/app/api/workouts/save/route.ts`
- `prisma/schema.prisma`
- `prisma/seed.ts`

