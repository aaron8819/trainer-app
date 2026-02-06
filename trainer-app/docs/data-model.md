# Data Model (Comprehensive)

This document describes the current data model for the Trainer App, with emphasis on workout generation, exercise definitions, and the engine’s decision inputs.

## Core Entities

### User
- `id`, `email`, `createdAt`
- Relations: `profile`, `constraints`, `goals`, `injuries`, `preferences`, `programs`, `workouts`, `readinessLogs`, `fatigueLogs`, `sessionCheckIns`, `baselines`

### Profile
- `userId`, `age`, `sex`, `heightCm`, `weightKg`, `trainingAge`
- Purpose: drives set scaling and general defaults.

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
- `movementPattern` (legacy, coarse)
- `movementPatternsV2` (programming intelligence)
- `splitTags` (strict split eligibility)
- `isMainLift`, `isMainLiftEligible`, `isCompound`
- `fatigueCost`
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
- Purpose: muscle definitions for volume accounting and analytics.

### Equipment
- `name`, `type`
- Purpose: equipment availability and filtering.

## Substitution System

### SubstitutionRule
- `fromExerciseId`, `toExerciseId`
- `priority` (new), `constraints`, `preserves`
- `score` (legacy, retained for backward compatibility)
- Purpose: deterministic substitution ranking and constraint-aware swaps.

## Programs and Workouts

### Program
- `userId`, `name`, `isActive`, `createdAt`
- Relations: `blocks`

### ProgramBlock
- `programId`, `blockIndex`, `weeks`, `deloadWeek`
- Relations: `workouts`

### Workout
- `userId`, `programBlockId?`
- `scheduledDate`, `completedAt`, `status`
- `estimatedMinutes`, `notes`
- `selectionMode`, `forcedSplit`, `advancesSplit`
- Relations: `exercises`

### WorkoutExercise
- `workoutId`, `exerciseId`, `orderIndex`, `isMainLift`
- `movementPattern` (legacy)
- `notes`
- Relations: `sets`

### WorkoutSet
- `workoutExerciseId`, `setIndex`, `targetReps`, `targetRpe`, `targetLoad`, `restSeconds`
- Relations: `logs`

### SetLog
- `workoutSetId`, `actualReps`, `actualRpe`, `actualLoad`, `completedAt`, `notes`, `wasSkipped`

## Readiness and Fatigue

### ReadinessLog
- `userId`, `date`, `score`, `sleepHours`, `soreness`, `notes`

### FatigueLog
- `userId`, `date`, `score`, `notes`

## Progression and Baselines

### ProgressionRule
- `name`, `primaryGoal`, `movementPattern?`, `rules` (json)
- Purpose: configurable progression behavior.

### Baseline
- `userId`, `exerciseName`, `context`, `category`, `unit`
- `workingWeightMin`, `workingWeightMax`, `workingRepsMin`, `workingRepsMax`
- `topSetWeight`, `topSetReps`
- `projected1RMMin`, `projected1RMMax`, `notes`
- Purpose: seed loads for newly generated workouts.

## Enum Reference (Highlights)

- `SplitType`: `PPL`, `UPPER_LOWER`, `FULL_BODY`, `CUSTOM`
- `SplitTag`: `PUSH`, `PULL`, `LEGS`, `CORE`, `MOBILITY`, `PREHAB`, `CONDITIONING`
- `MovementPatternV2`: `HORIZONTAL_PUSH`, `VERTICAL_PUSH`, `HORIZONTAL_PULL`, `VERTICAL_PULL`, `SQUAT`, `HINGE`, `LUNGE`, `CARRY`, `ROTATION`, `ANTI_ROTATION`, `FLEXION`, `EXTENSION`
- `StimulusBias`: `MECHANICAL`, `METABOLIC`, `STRETCH`, `STABILITY`

## Engine-Relevant Notes

- Split purity is enforced via `Exercise.splitTags`.
- `movementPatternsV2` powers main lift pairing and substitution logic.
- `SessionCheckIn` is the primary source for readiness and pain adjustments.
- Weekly volume caps use `ExerciseMuscle` primary roles.
- `prisma/seed.ts` seeds ExerciseMuscle mappings; supplemental scripts exist in `prisma/seed-exercise-muscles.ts` and `prisma/patch-exercise-muscles.ts` when needed.
