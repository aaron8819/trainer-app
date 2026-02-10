# User Settings Downstream Usage

This doc explains how user settings flow from the Settings UI into the engine, templates, and exercise library. It includes a real snapshot of your current settings (owner account) and concrete examples of how those values are applied downstream.

## Data Sources (Settings UI + APIs)

Settings are captured in two forms on the Settings page and persisted through API routes:
- Profile + goals + constraints + injury: `src/app/onboarding/ProfileForm.tsx`, saved via `src/app/api/profile/setup/route.ts`.
- Preferences (favorites, avoid list, RPE targets, etc.): `src/components/UserPreferencesForm.tsx`, saved via `src/app/api/preferences/route.ts`.

Data is stored in Prisma models: `Profile`, `Goals`, `Constraints`, `Injury`, `UserPreference` in `prisma/schema.prisma`.

## Runtime Assembly (DB -> Engine Context)

When generating workouts or templates, the app loads all relevant records and maps them into the engine’s types:
- Loader: `loadWorkoutContext` in `src/lib/api/workout-context.ts`.
- Mapping helpers:
  - `mapProfile` converts inches/lbs to cm/kg and normalizes training age.
  - `mapGoals` and `mapConstraints` normalize enums and equipment.
  - `mapPreferences` normalizes favorites/avoid lists, RPE targets, and optional conditioning.

These mapped objects are passed into the engine in:
- `src/app/api/workouts/generate/route.ts` (on-demand generation).
- `src/lib/api/template-session.ts` (template-based sessions).

## Downstream Usage by Feature

### Workout Generation (Auto)
- **Split selection** uses `constraints.splitType` and history to pick the next day (PPL history-based rotation). `src/lib/engine/engine.ts`.
- **Exercise eligibility** filters by `constraints.availableEquipment` and preference filters. `src/lib/engine/filtering.ts`.
- **Favorites vs avoid** lists bias selection toward favorites and remove avoids. `src/lib/engine/filtering.ts`.
- **Optional conditioning** uses `preferences.optionalConditioning` to add core/conditioning finishers. `src/lib/engine/filtering.ts`.
- **Session time budget** uses `constraints.sessionMinutes` to trim accessories. `src/lib/engine/engine.ts` and `src/lib/engine/apply-loads.ts`.
- **Set/rep prescriptions** use `goals.primary` and `profile.trainingAge`. `src/lib/engine/prescription.ts`.
- **RPE targets** override defaults based on `preferences.rpeTargets`. `src/lib/engine/prescription.ts`.
- **Load estimation** uses `profile.weightKg` + training age + baselines/history. `src/lib/engine/apply-loads.ts`.

### Template Sessions
Template-based sessions re-use the same mapped profile/goals/constraints/preferences, then apply loads and timeboxing:
- `src/lib/api/template-session.ts` uses `applyLoads(...)` with `mappedConstraints.sessionMinutes` and `mappedProfile`.

### Exercise Library UI
Preferences are also used to mark favorite/avoid status in the exercise list and detail views:
- `loadExerciseLibrary` and `loadExerciseDetail` in `src/lib/api/exercise-library.ts`.
- Preference state resolution in `src/lib/api/exercise-preferences.ts`.

### Weekly Program / Template Selection
`constraints.daysPerWeek` and `profile.trainingAge` are used to limit how many templates appear in the weekly program analysis and to compute set counts:
- `src/lib/api/weekly-program.ts`.

## Settings Snapshot (Owner)

Snapshot from the owner account (`aaron8819@gmail.com`) as of 2026-02-10, with preferences last updated at `2026-02-10T15:17:37.186Z`:

```json
{
  "profile": {
    "age": 31,
    "sex": "Male",
    "heightIn": 72,
    "weightLb": 195,
    "trainingAge": "INTERMEDIATE"
  },
  "goals": {
    "primaryGoal": "HYPERTROPHY",
    "secondaryGoal": "CONDITIONING",
    "proteinTarget": 180
  },
  "constraints": {
    "daysPerWeek": 3,
    "sessionMinutes": 55,
    "splitType": "PPL",
    "equipmentNotes": "LA fitness style full gym, cables, machines, benches, DB, KB, BB, cardio etc.",
    "availableEquipment": [
      "BARBELL",
      "DUMBBELL",
      "MACHINE",
      "CABLE",
      "BODYWEIGHT",
      "KETTLEBELL",
      "BAND",
      "CARDIO",
      "SLED",
      "BENCH",
      "RACK",
      "OTHER"
    ]
  },
  "preferences": {
    "favoriteExercises": [
      "Barbell Bench Press",
      "Barbell Back Squat",
      "Barbell Deadlift",
      "Incline Dumbbell Bench Press"
    ],
    "avoidExercises": ["Incline Dumbbell Curl"],
    "rpeTargets": [
      { "min": 5, "max": 8, "targetRpe": 8 },
      { "min": 8, "max": 12, "targetRpe": 7.5 },
      { "min": 12, "max": 20, "targetRpe": 7.5 }
    ],
    "progressionStyle": "double_progression",
    "optionalConditioning": true,
    "benchFrequency": 2,
    "squatFrequency": 1,
    "deadliftFrequency": 1
  },
  "injuries": []
}
```

### Engine-Mapped Snapshot (Derived)
Based on `mapProfile`/`mapConstraints`/`mapPreferences` in `src/lib/api/workout-context.ts`:

```json
{
  "profile": {
    "heightCm": 183,
    "weightKg": 88.5,
    "trainingAge": "intermediate",
    "injuries": []
  },
  "goals": {
    "primary": "hypertrophy",
    "secondary": "conditioning"
  },
  "constraints": {
    "daysPerWeek": 3,
    "sessionMinutes": 55,
    "splitType": "ppl",
    "availableEquipment": [
      "barbell",
      "dumbbell",
      "machine",
      "cable",
      "bodyweight",
      "kettlebell",
      "band",
      "cardio",
      "sled",
      "bench",
      "rack",
      "other"
    ]
  },
  "preferences": {
    "favoriteExercises": [
      "Barbell Bench Press",
      "Barbell Back Squat",
      "Barbell Deadlift",
      "Incline Dumbbell Bench Press"
    ],
    "avoidExercises": ["Incline Dumbbell Curl"],
    "rpeTargets": [
      { "min": 5, "max": 8, "targetRpe": 8 },
      { "min": 8, "max": 12, "targetRpe": 7.5 },
      { "min": 12, "max": 20, "targetRpe": 7.5 }
    ],
    "optionalConditioning": true,
    "progressionStyle": "double_progression",
    "benchFrequency": 2,
    "squatFrequency": 1,
    "deadliftFrequency": 1
  }
}
```

## What This Means in Practice (With Your Settings)

### Profile
- `heightIn: 72` and `weightLb: 195` are converted to `heightCm: 183` and `weightKg: 88.5` in `mapProfile`. These values feed load estimation in `applyLoads` (if no baselines/history exist).
- `trainingAge: INTERMEDIATE` affects set counts (main lift base 4 sets, accessories 3 sets) and base RPE for hypertrophy (8.0 before RPE overrides). See `src/lib/engine/prescription.ts` and `src/lib/engine/rules.ts`.

### Goals
- `primaryGoal: HYPERTROPHY` drives rep ranges (main 6-10, accessory 10-15) and base RPE selection. `src/lib/engine/rules.ts`.
- `secondaryGoal: CONDITIONING` is mapped and stored, but is not currently referenced by engine selection logic.
- `proteinTarget: 180` is stored in `Goals` but is not currently used downstream.

### Constraints
- `splitType: PPL` triggers the PPL logic that picks the least-recently-trained split day. `src/lib/engine/engine.ts`.
- `daysPerWeek: 3` is used in weekly program/template selection limits. `src/lib/api/weekly-program.ts`.
- `sessionMinutes: 55` enforces timeboxing that trims accessory volume when needed. `src/lib/engine/engine.ts` and `src/lib/engine/apply-loads.ts`.
- `availableEquipment` includes a full gym, so the equipment filter is effectively permissive for most exercises. `src/lib/engine/filtering.ts`.
- `equipmentNotes` is stored but not currently used downstream.

### Preferences
- **Favorites**: The engine sorts candidates to prefer your favorites when selecting main/accessory lifts. Favorites also surface in the exercise library UI (`isFavorite`).
- **Avoid list**: `Incline Dumbbell Curl` is removed from candidate pools and marked as avoided in the library (`isAvoided`).
- **RPE targets** override defaults:
  - Main lifts (hypertrophy, 6 reps target) fall into the 5-8 range ? target RPE becomes **8**.
  - Accessory sets (10 reps target) fall into 8-12 ? target RPE becomes **7.5**.
- **Optional conditioning** is `true`, so the engine will add core/conditioning extras on PPL days when available (core always, conditioning on leg days). `src/lib/engine/filtering.ts`.
- **Progression style + big-three frequency** are stored but not currently consumed by the engine.

### Injuries
- No active injuries, so the joint stress filter (severity >= 3) does not apply. If injuries are present, high-stress exercises are removed from the pool. `src/lib/engine/filtering.ts`.

## Fields Captured But Not Yet Used Downstream

These settings are saved but not referenced by the current generation logic:
- `proteinTarget` (Goals)
- `equipmentNotes` (Constraints)
- `secondaryGoal` (Goals)
- `progressionStyle`, `benchFrequency`, `squatFrequency`, `deadliftFrequency` (Preferences)

If you want any of these to influence generation (e.g., frequency-based push/pull/legs weighting), we can wire that into `selectExercises` or template assignment logic.
