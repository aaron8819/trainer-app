# User Settings Simplification Plan

**Date:** 2026-02-10
**Principle:** Settings capture constraints and identity. The engine handles programming decisions.

---

## Current State

The settings surface exposes fields that conflict with or duplicate engine logic:

| Field | Problem |
|---|---|
| `rpeTargets` | User overrides undercut training-age-aware RPE the engine already computes |
| `progressionStyle` | Stored but unused; engine should own progression model selection |
| `benchFrequency`, `squatFrequency`, `deadliftFrequency` | Stored but unused; creates constraints the engine can't optimize around |
| `splitType` | User can select splits incompatible with their `daysPerWeek` (e.g., 3-day PPL) |
| `secondaryGoal` | Stored but not wired into exercise selection |
| `proteinTarget` | Stored but unused downstream |
| `equipmentNotes` | Stored but unused downstream |

---

## Recommended Settings Model

### Keep (engine can't infer)

| Field | Source | Reason |
|---|---|---|
| `age` | Profile | Affects recovery expectations, age-related adjustments |
| `sex` | Profile | Affects load estimation baselines |
| `height` | Profile | Affects load estimation baselines |
| `weight` | Profile | Affects load estimation, bodyweight heuristics |
| `trainingAge` | Profile | Drives set counts, RPE base, progression model, volume landmarks |
| `primaryGoal` | Goals | Drives rep ranges, RPE base, load strategy |
| `secondaryGoal` | Goals | Biases exercise selection (see Engine-Owned section) |
| `daysPerWeek` | Constraints | Hard scheduling constraint |
| `sessionMinutes` | Constraints | Timeboxing budget |
| `availableEquipment` | Constraints | Exercise eligibility filter |
| `injuries` | Injuries | Joint stress filtering, contraindication checks |
| `favoriteExercises` | Preferences | Biases exercise selection toward preferred movements |
| `avoidExercises` | Preferences | Removes exercises from candidate pool |
| `optionalConditioning` | Preferences | Toggles core/conditioning finishers |

### Remove from user settings

| Field | Reason | Engine Replacement |
|---|---|---|
| `rpeTargets` | Conflicts with training-age + goal + periodization RPE system. Readiness check-in already handles day-to-day effort adjustment. | Engine computes RPE from `trainingAge` × `goal` × `weekInBlock` × `readinessScore` × main/accessory/isolation classification. No user input needed. |
| `progressionStyle` | Engine should select progression model based on training age, not user preference. | Beginner → linear progression (auto-increment every session). Intermediate → double progression (increment when rep ceiling hit on all sets). Advanced → periodized loading (mesocycle-driven). |
| `benchFrequency` | Constrains engine optimization. Favorites already signal preference. | Engine infers compound frequency from `daysPerWeek` + `splitType` + favorites. Favoriting bench press naturally increases its selection priority. |
| `squatFrequency` | Same as above. | Same as above. |
| `deadliftFrequency` | Same as above. | Same as above. |
| `proteinTarget` | Not used by generation engine. Nutrition guidance is outside engine scope. | Remove from settings or move to a separate nutrition section not connected to the engine. |
| `equipmentNotes` | Free text, not parseable by engine. | Remove. `availableEquipment` enum list covers the functional need. |

### Change behavior

| Field | Current | Recommended |
|---|---|---|
| `splitType` | User selects freely | Engine recommends based on `daysPerWeek`; user can override with a mismatch warning. |

Split recommendation logic:

| Days/Week | Recommended Split | Rationale |
|---|---|---|
| 2 | Full Body | Only way to hit each muscle 2×/week |
| 3 | Full Body or Upper/Lower | Full body = 3× frequency; U/L = 1.5× frequency. Both superior to 1×/week PPL. |
| 4 | Upper/Lower | Each muscle hit 2×/week |
| 5–6 | PPL or Upper/Lower | PPL at 6 days = 2× frequency per muscle; at 5 days ≈ 1.7× |

If the user selects a split that produces <2× weekly frequency for most muscle groups, surface: *"PPL with 3 days/week trains each muscle group once per week. For [goal], consider Full Body or Upper/Lower for better weekly frequency."* Don't block — inform.

---

## Engine-Owned Logic (replaces removed settings)

### RPE Assignment

No user input. Fully computed:

1. Base RPE from `trainingAge` × `goal`:
   - Hypertrophy: beginner 7.0, intermediate 8.0, advanced 8.5
   - Strength/other goals: static table in `rules.ts`
2. +0.5 for hypertrophy isolation accessories
3. −0.5 if readiness ≤ 2
4. Periodization `rpeOffset` from `weekInBlock`
5. Deload cap at 6.0

### Progression Model

No user input. Derived from `trainingAge`:

| Training Age | Model | Load Logic in `computeNextLoad` |
|---|---|---|
| Beginner | Linear progression | Auto-increment every session: +2.5–5 lbs upper, +5–10 lbs lower. Stall after 2 sessions at same load → switch to double progression. |
| Intermediate | Double progression | Hold load until all sets hit `targetRepMax` at target RPE → increment. If reps regress 2+ sessions → flag for deload. |
| Advanced | Periodized loading | Load follows mesocycle structure via `backOffMultiplier` and `weekInBlock`. Deload resets. |

### Compound Frequency

No user input. Derived from `daysPerWeek` + `splitType` + `favoriteExercises`:

- Favorited compounds get priority selection when the engine picks exercises for a session.
- The split structure determines how many sessions per week a compound can appear in.
- No explicit frequency cap or floor — the engine distributes favorites across available sessions naturally.

### Secondary Goal Influence

User sets `secondaryGoal` (keep this setting). Engine acts on it:

- `CONDITIONING`: boost selection weight for exercises with `splitTag: conditioning` (carries, sled work). Bias toward shorter accessory rest where evidence permits (≥75s floor). Include conditioning finishers when `optionalConditioning` is true.
- `STRENGTH`: bias main lift selection toward heavy compounds with `isMainLiftEligible`. Slightly increase main lift set allocation.
- No secondary goal: no bias applied.

---

## Migration Path

### Settings UI Changes
1. Remove RPE targets section from `UserPreferencesForm.tsx`.
2. Remove progression style selector.
3. Remove bench/squat/deadlift frequency inputs.
4. Remove protein target field (or move to a non-engine section).
5. Remove equipment notes field.
6. Add split-type validation warning when `daysPerWeek` and `splitType` mismatch.

### Engine Changes
1. Stop reading `preferences.rpeTargets` in `prescription.ts`. Remove the override step from RPE assignment.
2. Implement progression model selection in `computeNextLoad` based on `trainingAge`.
3. Wire `secondaryGoal` into exercise selection bias in `filtering.ts`.
4. Add split recommendation logic to settings validation or onboarding flow.

### Database Changes
1. `rpeTargets`, `progressionStyle`, `benchFrequency`, `squatFrequency`, `deadliftFrequency` columns can be soft-deprecated (nullable, no longer written) or removed in a cleanup migration.
2. `proteinTarget` and `equipmentNotes` same treatment.

### Backward Compatibility
- Existing users with stored `rpeTargets` will simply have them ignored once the override step is removed. No data migration needed — the engine stops reading the field.
- Progression behavior changes immediately for all users based on their `trainingAge`. No opt-in required.

---

## Resulting Settings Surface

After simplification, the settings page has three sections:

**Profile:** age, sex, height, weight, training age

**Goals & Constraints:** primary goal, secondary goal (optional), days per week, session minutes, available equipment, split type (with recommendation)

**Preferences:** favorite exercises, avoid exercises, optional conditioning toggle

**Injuries:** body region + severity

Everything else is engine-internal.
