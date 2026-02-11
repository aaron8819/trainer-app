# User Settings Downstream Usage

Last updated: 2026-02-10

This document describes how user settings flow into runtime generation after the settings simplification implementation.

## Settings Capture Surface

Settings are captured in two forms:

- Profile, goals, constraints, injuries: `src/app/onboarding/ProfileForm.tsx` -> `src/app/api/profile/setup/route.ts`
- Preferences: `src/components/UserPreferencesForm.tsx` -> `src/app/api/preferences/route.ts`

Active settings surface:

- Profile: `age`, `sex`, `heightIn`, `weightLb`, `trainingAge`
- Goals and constraints: `primaryGoal`, `secondaryGoal`, `daysPerWeek`, `sessionMinutes`, `splitType`
- Preferences: `favoriteExercises`, `avoidExercises`, `optionalConditioning`
- Injuries: `injuryBodyPart`, `injurySeverity`, `injuryDescription`, `injuryActive`

Removed from UI/API writes:

- `rpeTargets`
- `progressionStyle`
- `benchFrequency`, `squatFrequency`, `deadliftFrequency`
- `proteinTarget`
- `equipmentNotes`

## Runtime Assembly (DB -> Engine)

Workout generation and template session generation load and map context through `src/lib/api/workout-context.ts`:

- `mapProfile`
- `mapGoals`
- `mapConstraints`
- `mapPreferences`
- `mapHistory`
- `mapCheckIn`

Legacy preference columns still present in DB are intentionally ignored by mapping and engine logic.

## Downstream Usage

### Engine Prescription

- Set and rep prescriptions are driven by `trainingAge`, `primaryGoal`, fatigue/readiness, and periodization.
- Target RPE is engine-computed only in `src/lib/engine/prescription.ts`.
- Stored `rpeTargets` are ignored.

### Engine Progression

`computeNextLoad` in `src/lib/engine/progression.ts` selects progression model by training age:

- Beginner: linear increments by region (`+2.5-5` lbs upper, `+5-10` lbs lower), with stall fallback to double progression.
- Intermediate: double progression, with regression-triggered deload reduction.
- Advanced: week-based periodized loading and deload handling.

### Exercise Selection and Secondary Goal

`selectExercises` in `src/lib/engine/filtering.ts` consumes:

- `availableEquipment`
- `favoriteExercises` / `avoidExercises`
- `optionalConditioning`
- `secondaryGoal`

Secondary-goal behavior:

- `conditioning`: conditioning-tagged movements are biased up; carry variants are injected into the conditioning pool when equipment allows.
- `strength`: main-lift selection is biased toward compound `isMainLiftEligible` exercises.

### Split Warning (UI)

`getSplitMismatchWarning` in `src/lib/settings/split-recommendation.ts` derives a non-blocking warning from `daysPerWeek` and `splitType`.

- Example: `PPL with 3 days/week trains each muscle once per week. Consider Full Body or Upper/Lower for better weekly frequency.`

The warning is rendered next to split selection in `src/app/onboarding/ProfileForm.tsx` (used by onboarding and settings page).

## Persistence Strategy

No destructive schema change was applied in this pass.

- Deprecated columns remain in `prisma/schema.prisma`.
- Write paths stop populating deprecated fields.
- Read paths no longer map deprecated programming-control fields into engine behavior.

This preserves backward compatibility while moving programming ownership into engine rules.
