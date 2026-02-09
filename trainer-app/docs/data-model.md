# Data Model (Comprehensive)

This document describes the current data model for the Trainer App, with emphasis on workout generation, exercise definitions, and the engine’s decision inputs.

## Core Entities

### User
- `id`, `email`, `createdAt`
- Relations: `profile`, `constraints`, `goals`, `injuries`, `preferences`, `programs`, `workouts`, `sessionCheckIns`, `baselines`

### Profile
- `userId`, `age`, `sex`, `heightIn`, `weightLb`, `trainingAge` (non-nullable, default `INTERMEDIATE`)
- Purpose: drives set scaling and general defaults.
- Note: height is stored in inches, weight in pounds. The engine receives these converted to metric (cm, kg) via `mapProfile()`.

### Goals
- `userId`, `primaryGoal`, `secondaryGoal`, `proteinTarget`
- Purpose: sets rep ranges and target RPE by goal.

### Constraints
- `userId`, `daysPerWeek`, `sessionMinutes`, `splitType`, `equipmentNotes`, `availableEquipment`
- Purpose: drives split queue, timeboxing, and equipment filtering.

### UserPreference
- `favoriteExercises`, `avoidExercises`, `rpeTargets`, `progressionStyle`
- `optionalConditioning`, `benchFrequency`, `squatFrequency`, `deadliftFrequency`
- Purpose: biases selection and targets.

### Injury
- `userId`, `bodyPart`, `severity`, `isActive`
- Purpose: injury filter and risk reduction.

### SessionCheckIn
- `userId`, `workoutId?`, `date`, `readiness`, `painFlags`, `notes`, `createdAt`
- Purpose: dynamic readiness and pain signals for session-level adaptation.

## Exercise Catalog

### Exercise
Canonical exercise definition used by the engine.

Key fields:
- `name` (unique)
- `movementPatterns` (MovementPatternV2[], programming intelligence)
- `splitTags` (strict split eligibility)
- `isMainLiftEligible`, `isCompound`
- `fatigueCost`
- `sfrScore` (stimulus-to-fatigue ratio, 1-5, default 3)
- `lengthPositionScore` (lengthened-position loading, 1-5, default 3)
- `stimulusBias`
- `contraindications`
- `timePerSetSec`

Relations:
- `exerciseMuscles` (primary/secondary muscle groups)
- `exerciseEquipment` (required equipment)
- `variations`
- `aliases`
- `substitutionsFrom`, `substitutionsTo`

### ExerciseAlias
- `exerciseId`, `alias`
- Purpose: dedupe legacy names and preserve historical references.

### ExerciseVariation
- `exerciseId`, `name`, `description`, `variationType`, `metadata`
- Purpose: tempo/paused/grip/angle variants without duplicating canonical exercises.

### ExerciseMuscle
- `exerciseId`, `muscleId`, `role` (PRIMARY/SECONDARY)
- Purpose: muscle volume accounting and weekly cap enforcement.

### ExerciseEquipment
- `exerciseId`, `equipmentId`
- Purpose: equipment-aware filtering.

### Muscle
- `name`
- `mv` (Maintenance Volume, sets/week, default 0)
- `mev` (Minimum Effective Volume, default 0)
- `mav` (Maximum Adaptive Volume, default 0)
- `mrv` (Maximum Recoverable Volume, default 0)
- `sraHours` (SRA recovery window in hours, default 48)
- Purpose: muscle definitions for volume accounting, per-muscle volume caps, and SRA tracking.

### Equipment
- `name`, `type`
- Purpose: equipment availability and filtering.

## Substitution System

### SubstitutionRule
- `fromExerciseId`, `toExerciseId`
- `priority` (non-nullable, default 50), `constraints`, `preserves`
- Purpose: deterministic substitution ranking and constraint-aware swaps.

## Programs and Workouts

### Program
- `userId`, `name`, `isActive`, `createdAt`
- Relations: `blocks`

### ProgramBlock
- `programId`, `blockIndex`, `weeks`, `deloadWeek`
- Relations: `workouts`

### Workout
- `userId`, `programBlockId?`, `templateId?`
- `scheduledDate`, `completedAt`, `status`
- `estimatedMinutes`, `notes`
- `selectionMode`, `forcedSplit`, `advancesSplit`
- Relations: `exercises`, `template?`

### WorkoutTemplate
- `id`, `userId`, `name`, `targetMuscles`, `isStrict`, `createdAt`, `updatedAt`
- Relations: `exercises` (WorkoutTemplateExercise[]), `workouts` (Workout[])
- Purpose: user-defined workout templates for template mode sessions.
- API: CRUD via `/api/templates` (list, create) and `/api/templates/[id]` (detail, update, delete).
- API layer: `src/lib/api/templates.ts` — `loadTemplates`, `loadTemplateDetail`, `createTemplate`, `updateTemplate`, `deleteTemplate`.
- On delete: associated `Workout.templateId` is set to null (preserves workout history).

### WorkoutTemplateExercise
- `id`, `templateId`, `exerciseId`, `orderIndex`
- Unique constraint: `(templateId, orderIndex)`
- Purpose: ordered exercise list within a template.
- On template update: exercises are fully replaced (delete all + insert new) in a transaction.

### WorkoutExercise
- `workoutId`, `exerciseId`, `orderIndex`, `isMainLift`
- `movementPatterns` (MovementPatternV2[], default `{}`)
- `notes`
- Relations: `sets`

### WorkoutSet
- `workoutExerciseId`, `setIndex`, `targetReps`, `targetRpe`, `targetLoad`, `restSeconds`
- Relations: `logs`

### SetLog
- `workoutSetId`, `actualReps`, `actualRpe`, `actualLoad`, `completedAt`, `notes`, `wasSkipped`

## Baselines

### Baseline
- `userId`, `exerciseId` (non-nullable FK), `exerciseName` (denormalized display field), `context`, `category`, `unit`
- `workingWeightMin`, `workingWeightMax`, `workingRepsMin`, `workingRepsMax`
- `topSetWeight`, `topSetReps`
- `projected1RMMin`, `projected1RMMax`, `notes`
- Unique constraint: `(userId, exerciseId, context)`
- Purpose: seed loads for newly generated workouts.

## Removed Tables

The following tables were removed in Phase 6 (2026-02-06) as they were unused:
- **ReadinessLog** — superseded by `SessionCheckIn`
- **FatigueLog** — superseded by `SessionCheckIn`
- **ProgressionRule** — engine uses hardcoded constants from `rules.ts`; the engine `ProgressionRule` type remains for future extensibility

## Enum Reference (Highlights)

- `SplitType`: `PPL`, `UPPER_LOWER`, `FULL_BODY`, `CUSTOM`
- `SplitTag`: `PUSH`, `PULL`, `LEGS`, `CORE`, `MOBILITY`, `PREHAB`, `CONDITIONING`
- `MovementPatternV2`: `HORIZONTAL_PUSH`, `VERTICAL_PUSH`, `HORIZONTAL_PULL`, `VERTICAL_PULL`, `SQUAT`, `HINGE`, `LUNGE`, `CARRY`, `ROTATION`, `ANTI_ROTATION`, `FLEXION`, `EXTENSION`
- `StimulusBias`: `MECHANICAL`, `METABOLIC`, `STRETCH`, `STABILITY`

## Engine-Relevant Notes

- Split purity is enforced via `Exercise.splitTags`.
- `movementPatterns` powers main lift pairing and substitution logic.
- `SessionCheckIn` is the primary source for readiness and pain adjustments.
- Weekly volume caps use `ExerciseMuscle` primary roles.
- `prisma/seed.ts` seeds ExerciseMuscle mappings; supplemental scripts exist in `prisma/seed-exercise-muscles.ts` and `prisma/patch-exercise-muscles.ts` when needed.
