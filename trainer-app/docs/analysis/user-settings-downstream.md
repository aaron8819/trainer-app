# User Settings Downstream Reference

Last verified against code: 2026-02-12

This document explains user settings end to end:

- where each field is collected
- how it is validated
- where it is persisted
- how it is consumed downstream in generation, analytics, and UI

Scope is runtime behavior in the current app, not aspirational future usage.

## Source Of Truth

- DB schema: `prisma/schema.prisma`
- Validation contracts: `src/lib/validation.ts`
- Settings write APIs:
  - `src/app/api/profile/setup/route.ts`
  - `src/app/api/preferences/route.ts`
  - `src/app/api/exercises/[id]/favorite/route.ts`
  - `src/app/api/exercises/[id]/avoid/route.ts`
- Settings UI:
  - `src/app/onboarding/ProfileForm.tsx`
  - `src/components/UserPreferencesForm.tsx`
  - `src/app/settings/page.tsx`
- Generation + mapping:
  - `src/lib/api/workout-context.ts`
  - `src/lib/api/template-session.ts`
  - `src/lib/engine/exercise-selection.ts`
  - `src/lib/engine/template-session.ts`
  - `src/lib/engine/prescription.ts`
  - `src/lib/engine/apply-loads.ts`
- Weekly analysis + schedule selection:
  - `src/lib/api/weekly-program.ts`
  - `src/lib/api/weekly-program-selection.ts`

## Settings Surfaces

## 1) Profile setup payload (`/api/profile/setup`)

Validated by `profileSetupSchema`:

- `email`
- `age`
- `sex`
- `heightIn`
- `weightLb`
- `trainingAge`
- `primaryGoal`
- `secondaryGoal`
- `daysPerWeek`
- `sessionMinutes`
- `weeklySchedule`
- `splitType` (optional)
- `injuryBodyPart`
- `injurySeverity`
- `injuryDescription`
- `injuryActive`

Write behavior in `profile/setup` route:

- upserts `User` by email (if provided), otherwise writes against resolved owner
- upserts `Profile`, `Goals`, and `Constraints`
- upserts/updates active `Program.weeklySchedule` when provided
- upserts or updates injury row by `bodyPart` for that user
- if no `injuryBodyPart` and `injuryActive === false`, deactivates all active injuries for user

## 2) Preferences payload (`/api/preferences`)

Validated by `preferencesSchema`:

- `favoriteExercises`
- `avoidExercises`
- `favoriteExerciseIds` (accepted by schema but not trusted as source input)
- `avoidExerciseIds` (accepted by schema but not trusted as source input)
- `optionalConditioning`

Write behavior in `preferences` route:

- normalizes/dedupes names
- removes overlaps so an exercise cannot be both favorite and avoid
- resolves names to IDs from `Exercise`
- writes both name arrays and ID arrays to `UserPreference`
- defaults `optionalConditioning` to `true` when omitted

## 3) Per-exercise toggle APIs

- `POST /api/exercises/[id]/favorite`
- `POST /api/exercises/[id]/avoid`

Both routes:

- serialize updates in a transaction
- call `computeExercisePreferenceToggle(...)`
- keep name and ID arrays synchronized
- ensure favorite/avoid exclusivity is preserved

## Field Mapping Matrix

`Used downstream` means active consumption in current runtime path.  
`Stored only` means persisted but no current behavior depends on it.

| Field | Collected from UI | Persisted model field | Used downstream? | Main downstream consumers |
|---|---|---|---|---|
| `email` | Profile form | `User.email` | Yes (identity resolution) | `resolveOwner()` and owner-bound queries |
| `age` | Profile form | `Profile.age` | Limited | Mapped into engine profile only (`mapProfile`), not used in active scoring/selection logic |
| `sex` | Profile form | `Profile.sex` | Limited | Mapped into engine profile only (`mapProfile`), not used in active scoring/selection logic |
| `heightIn` | Profile form | `Profile.heightIn` | Yes | Converted to `heightCm` in `mapProfile`; available to engine profile context |
| `weightLb` | Profile form | `Profile.weightLb` | Yes | Converted to `weightKg`; used by `apply-loads` bodyweight heuristics and load estimation |
| `trainingAge` | Profile form | `Profile.trainingAge` | Yes (high impact) | Set count, RPE, progression behavior, intent set-cap logic, weekly program analysis |
| `primaryGoal` | Profile form | `Goals.primaryGoal` | Yes (high impact) | Prescription ranges/RPE and selection scoring inputs |
| `secondaryGoal` | Profile form | `Goals.secondaryGoal` | Yes | Selection preference shaping (goal bias in candidate scoring) |
| `proteinTarget` | Not currently collected | `Goals.proteinTarget` | Stored only | No active readers |
| `daysPerWeek` | Profile form | `Constraints.daysPerWeek` | Yes | Weekly template selection count and weekly-program analysis inputs |
| `sessionMinutes` | Profile form | `Constraints.sessionMinutes` | Yes (high impact) | Selection budget, set-allocation ceiling, pre/post-load timeboxing |
| `splitType` | Not currently exposed in form | `Constraints.splitType` | Partial | Used by split preview and substitution constraint mapping; active template/intent generation path currently keys primarily off intent + selected constraints |
| `equipmentNotes` | Not currently collected | `Constraints.equipmentNotes` | Stored only | No active readers |
| `availableEquipment` | Not currently collected in profile form | `Constraints.availableEquipment` | Yes | Equipment eligibility filter in selection and substitute generation |
| `weeklySchedule` | Profile form | `Program.weeklySchedule` | Yes | Weekly program template picking by intent sequence |
| `injuryBodyPart` | Profile form | `Injury.bodyPart` | Yes | Mapped as pain flags/constraints context for exercise filtering |
| `injurySeverity` | Profile form | `Injury.severity` | Yes | Carried through mapped injury context; used in pain constraint checks |
| `injuryDescription` | Profile form | `Injury.description` | Limited | Persisted and shown in settings; not directly used in active selector scoring |
| `injuryActive` | Profile form | `Injury.isActive` | Yes | Controls whether injury participates in active injury query/filtering |
| `favoriteExercises` | Preferences form and toggle routes | `UserPreference.favoriteExercises` | Yes | Selection boost inputs by name |
| `avoidExercises` | Preferences form and toggle routes | `UserPreference.avoidExercises` | Yes | Hard exclusion inputs by name |
| `favoriteExerciseIds` | Derived server-side from names / toggles | `UserPreference.favoriteExerciseIds` | Yes | Selection boost inputs by ID |
| `avoidExerciseIds` | Derived server-side from names / toggles | `UserPreference.avoidExerciseIds` | Yes | Hard exclusion inputs by ID |
| `optionalConditioning` | Preferences form | `UserPreference.optionalConditioning` | Limited | Mapped and persisted; currently consumed by legacy `engine/filtering.ts`, not active selector path |
| `rpeTargets` | Not currently collected | `UserPreference.rpeTargets` | Stored only | No active readers |
| `progressionStyle` | Not currently collected | `UserPreference.progressionStyle` | Stored only | No active readers |
| `benchFrequency` | Not currently collected | `UserPreference.benchFrequency` | Stored only | No active readers |
| `squatFrequency` | Not currently collected | `UserPreference.squatFrequency` | Stored only | No active readers |
| `deadliftFrequency` | Not currently collected | `UserPreference.deadliftFrequency` | Stored only | No active readers |

## Normalization, Defaults, And Guardrails

## Validation and preprocessing

- Empty strings and `null` are normalized to `undefined` for optional numeric/text fields in `validation.ts` (`optionalNumber`, `optionalString`).
- Profile numeric ranges:
  - `age`: `13-100`
  - `heightIn`: `48-96`
  - `weightLb`: `80-600`
  - `injurySeverity`: `1-5`
- Constraint ranges:
  - `daysPerWeek`: `1-7`
  - `sessionMinutes`: `20-180`
- `weeklySchedule` max length: `7`.

## UI defaults (`ProfileForm.tsx`)

- `trainingAge`: `INTERMEDIATE`
- `primaryGoal`: `HYPERTROPHY`
- `secondaryGoal`: `CONDITIONING`
- `daysPerWeek`: `4`
- `sessionMinutes`: `55`
- `weeklySchedule`: `["PUSH", "PULL", "LEGS", "UPPER"]`
- `injuryActive`: `true`

Schedule normalization in form submit:

- clamps day count to `1..7`
- slices schedule to `daysPerWeek`
- fills missing day slots with `"PUSH"`

## API-side defaults

- `Constraints.splitType` defaults to `CUSTOM` on create when missing.
- Injury create defaults:
  - `severity: 2` when omitted
  - `isActive: true` when omitted
- Preferences defaults:
  - empty arrays for favorites/avoids
  - `optionalConditioning: true` when omitted

## DB-to-engine mapping conversions

In `mapProfile` and related mappers:

- `heightIn -> heightCm` (`* 2.54`, rounded)
- `weightLb -> weightKg` (`* 0.45359237`, rounded to 1 decimal)
- enum values converted from DB uppercase to engine lowercase:
  - `trainingAge`
  - `primaryGoal` / `secondaryGoal`
  - `splitType`
  - `availableEquipment` values

## Downstream Usage By Subsystem

## Generation context construction

`loadMappedGenerationContext(...)` in `template-session.ts` requires:

- `Profile`
- `Goals`
- `Constraints`

If any are missing, generation returns `"Profile, goals, or constraints missing"`.

It then maps:

- profile + injuries -> `UserProfile`
- goals -> engine `Goals`
- constraints -> engine `Constraints`
- preferences -> `UserPreferences | undefined`
- recent workouts -> engine history
- latest check-in -> fatigue input

## Exercise selection

Active selector: `src/lib/engine/exercise-selection.ts`

Directly uses:

- `sessionMinutes`
- `trainingAge`
- goals (`primary`, `secondary`)
- `constraints.availableEquipment`
- preference favorites/avoids (name + ID)
- pain flags from mapped check-in/injuries

Selection effects include:

- hard excludes (avoid list, equipment mismatch, pain contraindications)
- deterministic ranking boosts for favorites and goal-aligned candidates
- set-allocation caps by training age
- time-budget trimming based on session minutes

## Prescription and loads

- `trainingAge` and goals drive set-count and RPE behavior in `prescription.ts` / `rules.ts`.
- `weightKg` and history/baselines drive fallback load estimation in `apply-loads.ts`.
- `sessionMinutes` gates timeboxing before and after load assignment.

## Weekly program analysis and schedule selection

- `daysPerWeek` controls default number of templates considered when explicit IDs are absent.
- `Program.weeklySchedule` drives intent-priority template picking in `weekly-program-selection.ts`.
- `trainingAge` is used to estimate deterministic per-exercise set counts in weekly scoring inputs.

## Settings and exercise library UI

- `settings/page.tsx` hydrates form defaults from profile/goals/constraints/program/preferences.
- Exercise library marks each movement as favorite/avoided by reading `UserPreference`.
- Exercise detail uses mapped constraints (including equipment) to suggest substitutes.

## Current Gaps And Non-Active Fields

These fields are persisted but not currently driving active runtime behavior:

- `Goals.proteinTarget`
- `Constraints.equipmentNotes`
- `UserPreference.rpeTargets`
- `UserPreference.progressionStyle`
- `UserPreference.benchFrequency`
- `UserPreference.squatFrequency`
- `UserPreference.deadliftFrequency`

Also note:

- `optionalConditioning` is persisted and mapped, but active generation uses `exercise-selection.ts`; the `optionalConditioning` branch currently lives in legacy `engine/filtering.ts`.
- `age` and `sex` are retained in mapped profile context but are not currently used by active selection/prescription scoring rules.

## Practical Implications For Changes

When adding a new user-setting field, update all of:

1. `prisma/schema.prisma` (storage)
2. `src/lib/validation.ts` (contract)
3. relevant write route (`profile/setup`, `preferences`, or dedicated route)
4. settings/onboarding UI (if user-editable)
5. mapping in `workout-context.ts` (if engine needs it)
6. active consumers (`exercise-selection`, `prescription`, `apply-loads`, weekly analysis, or UI readers)
7. this document (field matrix + downstream section)
