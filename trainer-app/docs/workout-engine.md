# Workout Engine Deep Dive (Updated)

This document reflects the current engine behavior after the split-tag refactor and schema upgrades. It focuses on how a workout is generated, what inputs are required, and what constraints are enforced.

## Where the Engine Lives

Core logic:
- `trainer-app/src/lib/engine/engine.ts`
- `trainer-app/src/lib/engine/rules.ts`
- `trainer-app/src/lib/engine/types.ts`

API integration:
- `trainer-app/src/app/api/workouts/generate/route.ts`
- `trainer-app/src/app/api/workouts/next/route.ts`
- `trainer-app/src/lib/api/workout-context.ts`

Data migration:
- `trainer-app/scripts/migrate-exercises.ts`

## Key Engine Guarantees

1) **Strict split purity (hard gate)**
- PPL days are filtered by `Exercise.splitTags`.
- Push day only selects exercises tagged `PUSH`.
- Pull day only selects exercises tagged `PULL`.
- Legs day only selects exercises tagged `LEGS`.
- Exercises tagged with both `PUSH` and `PULL` are rejected and must be reclassified.

2) **Template-only special blocks**
- `CORE`, `MOBILITY`, `PREHAB`, `CONDITIONING` exercises are *only* selectable in explicit warmup/finisher blocks.
- They are never chosen as general accessories.

3) **Movement intelligence**
- The engine now uses `movementPatternsV2` to pair main lifts:
  - Push: 1 horizontal + 1 vertical press
  - Pull: 1 vertical pull + 1 horizontal row (prefers chest-supported when low-back pain)
  - Legs: 1 squat + 1 hinge

4) **Timeboxing is enforced**
- The session time budget is enforced by dropping accessories first until the plan fits `sessionMinutes`.

5) **Load progression guardrails**
- Double progression logic remains the default.
- RPE guardrails adjust load up/down by 2-3%.
- Any load change is capped at 7% per step.

6) **Volume spike caps**
- Weekly volume is enforced using a rolling 7-day window.
- If a muscle group would exceed 20% over the prior window, accessories are trimmed.

7) **Readiness + pain check-ins**
- The most recent `SessionCheckIn` drives readiness and pain filtering.
- Injuries still reduce high joint-stress exercises.

## Data Inputs Used

### Profile
- Training age still controls set scaling.

### Goals
- Rep range and target RPE are taken from `rules.ts` by primary goal.
- Rep ranges are role-specific (main vs accessory).

### Constraints
- `Constraints.availableEquipment` is now enforced (no more assuming all equipment types).
- `sessionMinutes` is used to timebox the plan.

### Exercise Library
- Uses the upgraded `Exercise` model:
  - `splitTags` (hard split eligibility)
  - `movementPatternsV2` (horizontal/vertical patterns)
  - `isMainLiftEligible`, `isCompound`, `fatigueCost`, `timePerSetSec`

### Session Check-In
- `readiness` drives fatigue adjustments.
- `painFlags` drive joint-friendly filtering and substitutions.

## End-to-End Flow

1) **API request**
- `POST /api/workouts/generate` or `POST /api/workouts/next`

2) **Load data**
- `loadWorkoutContext()` fetches profile, goals, constraints, injuries, baselines, exercises, workouts, preferences, and the most recent `SessionCheckIn`.

3) **Map DB models to engine types**
- `mapProfile`, `mapGoals`, `mapConstraints`, `mapExercises`, `mapHistory`, `mapCheckIn`.

4) **Generate workout**
- `generateWorkout()` selects a split day, chooses main lifts and accessories, then timeboxes the plan.

5) **Apply loads**
- `applyLoads()` assigns target load using: history -> baseline -> estimation (muscle-based donor scaling, then bodyweight ratios, then equipment defaults).

6) **Return plan**
- The API returns the final `WorkoutPlan` with warmup, main lifts, accessories, sets, and estimated time.

## Selection Details (PPL)

### Main lift pairing
- Push: 1 horizontal press + 1 vertical press
- Pull: 1 vertical pull + 1 horizontal row
- Legs: 1 squat + 1 hinge

### Accessories
- Accessories are chosen from the same splitTag pool.
- PPL accessory selection uses slot-based picks by primary muscles and stimulusBias, with a fill phase that favors uncovered muscles.
- Selection uses recency weighting and seeded randomness for variety (recent exercises are deprioritized).
- Special blocks (core, mobility, prehab, conditioning) only appear if the template explicitly requests them.

### Warmup/finisher blocks
- `MOBILITY` and `PREHAB` are used as warmup options.
- `CORE` can be appended as an optional finisher.
- `CONDITIONING` can be appended on legs day when optional conditioning is enabled.

## Progression Summary

- If all sets hit the top of the rep range at or below target RPE, load increases.
- If early sets exceed target RPE by +1, load decreases next session.
- If all sets are at or below target RPE by -2, load increases.
- All load changes are capped at 7%.
- Main lifts use a top set + back-off structure; back-off loads are derived from the top set.
- Rest periods scale by exercise type (main lift vs compound accessory vs isolation).

## Known Gaps (Tracked)

- Muscle volume caps rely on `Exercise.primaryMuscles`; these are not fully seeded yet.
- Substitution suggestions are available (`suggestSubstitutes`) but not currently surfaced in the UI.
- Contraindications are now seeded and used as the primary pain filter; regex heuristics are still a fallback.
- Legs slot isolation picks should enforce non-compound constraints (quad/hamstring iso slots can still pick compound hinges in edge cases).

## Related Docs
- `trainer-app/docs/engine_refactor`
- `trainer-app/docs/engine_refactor_clarifications`
- `trainer-app/docs/ppl_programmingguidelines`
- `trainer-app/docs/ppl-exercise-options.md`
## Current UI Flow (Generation)

- Entry point is the dashboard at `/`, which renders `GenerateWorkoutCard`.
- Tapping "Generate Workout" expands the inline `SessionCheckInForm` instead of calling the API immediately.
- Submit path: `POST /api/session-checkins` then `POST /api/workouts/generate`.
- Skip path: `POST /api/workouts/generate` directly with no check-in saved.
- During generation, buttons show "Generating..." and disable; errors appear inline.
- After generation, the card shows a preview (estimated minutes, main lifts, accessories) and a "Save Workout" button.
- Saving calls `POST /api/workouts/save`; on success, links appear for `/workout/[id]` and `/log/[id]`.

## Workout Detail Layout (Current)

- Route `/workout/[id]` shows a "Session Overview" header with estimated minutes and a "Start logging" button.
- The "Why this workout was generated" panel includes readiness and pain flags when a check-in exists.
- Exercises are grouped into Warmup, Main Lifts, and Accessories sections.
- Each exercise card shows set count, target reps, target load (if any), target RPE, and a short "Why" note.

## UI File Touchpoints

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

