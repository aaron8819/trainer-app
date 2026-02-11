# Data Model (Current)

Last verified against schema: 2026-02-11 (`prisma/schema.prisma`)

This document summarizes the persisted model used by workout generation, logging, and adaptation loops.

## Core user models

### `User`

- Fields: `id`, `email`, `createdAt`
- Key relations: `profile`, `constraints`, `goals`, `injuries`, `preferences`, `programs`, `workouts`, `sessionCheckIns`, `baselines`, `templates`

### `Profile`

- Fields: `userId`, `age`, `sex`, `heightIn`, `weightLb`, `trainingAge`
- `trainingAge` default: `INTERMEDIATE`
- Runtime note: engine mapping converts `heightIn` and `weightLb` to metric values.

### `Goals`

- Fields: `userId`, `primaryGoal`, `secondaryGoal`, `proteinTarget`
- Runtime-critical fields: `primaryGoal`, `secondaryGoal`

### `Constraints`

- Fields: `userId`, `daysPerWeek`, `sessionMinutes`, `splitType`, `equipmentNotes`, `availableEquipment`
- Runtime-critical fields: split type, session minutes, equipment availability

### `UserPreference`

- Fields:
  - name-based: `favoriteExercises`, `avoidExercises`
  - id-based: `favoriteExerciseIds`, `avoidExerciseIds`
  - optional knobs: `optionalConditioning`, `rpeTargets`, `progressionStyle`, `benchFrequency`, `squatFrequency`, `deadliftFrequency`
- Runtime-critical fields today: favorite/avoid arrays and `optionalConditioning`

### `Injury`

- Fields: `id`, `userId`, `bodyPart`, `description`, `severity`, `isActive`, `createdAt`
- Index: `@@index([userId, isActive])`

### `SessionCheckIn`

- Fields: `id`, `userId`, `workoutId?`, `date`, `readiness`, `painFlags`, `notes`, `createdAt`
- Index: `@@index([userId, date])`
- Runtime use: latest check-in (readiness and pain flags) influences generation.

## Exercise catalog models

### `Exercise`

Core fields:

- identity: `id`, `name` (unique)
- programming metadata: `movementPatterns`, `splitTags`, `jointStress`
- lift characteristics: `isMainLiftEligible`, `isCompound`, `fatigueCost`, `stimulusBias`
- safety and execution: `contraindications`, `timePerSetSec`
- quality scores: `sfrScore`, `lengthPositionScore`
- prescription bounds: `repRangeMin`, `repRangeMax`
- metadata: `difficulty`, `isUnilateral`

Relations:

- `exerciseMuscles`, `exerciseEquipment`
- `aliases`, `variations`
- `substitutionsFrom`, `substitutionsTo`
- `workoutExercises`, `baselines`, `templateExercises`

### `Muscle`

- Fields: `id`, `name` (unique), `mv`, `mev`, `mav`, `mrv`, `sraHours`
- Relation: `exerciseMuscles`

### `Equipment`

- Fields: `id`, `name` (unique), `type`
- Relation: `exerciseEquipment`

### `ExerciseMuscle`

- Fields: `exerciseId`, `muscleId`, `role`
- PK: `@@id([exerciseId, muscleId])`

### `ExerciseEquipment`

- Fields: `exerciseId`, `equipmentId`
- PK: `@@id([exerciseId, equipmentId])`

### `ExerciseAlias`

- Fields: `id`, `exerciseId`, `alias`
- Unique: `alias`

### `ExerciseVariation`

- Fields: `id`, `exerciseId`, `name`, `description`, `variationType`, `metadata`

### `SubstitutionRule`

- Fields: `id`, `fromExerciseId`, `toExerciseId`, `reason`, `priority`, `constraints`, `preserves`
- Default priority: `50`

## Program and workout execution models

### `Program`

- Fields: `id`, `userId`, `name`, `isActive`, `createdAt`
- Relation: `blocks`

### `ProgramBlock`

- Fields: `id`, `programId`, `blockIndex`, `weeks`, `deloadWeek`
- Relation: `workouts`

### `Workout`

- Fields:
  - ownership/scheduling: `id`, `userId`, `programBlockId?`, `templateId?`, `scheduledDate`, `completedAt`
  - status/selection: `status`, `selectionMode`, `forcedSplit`, `advancesSplit`
  - display/meta: `estimatedMinutes`, `notes`
- Defaults:
  - `status = PLANNED`
  - `selectionMode = AUTO`
  - `advancesSplit = true`
- Index: `@@index([userId, scheduledDate])`
- Relations: `exercises`, `sessionCheckIns`, optional `template`, optional `programBlock`

### `WorkoutExercise`

- Fields: `id`, `workoutId`, `exerciseId`, `orderIndex`, `section?`, `isMainLift`, `movementPatterns`, `notes`
- `section` enum: `WARMUP | MAIN | ACCESSORY` (nullable for legacy rows created before section persistence)
- Relation: `sets`

### `WorkoutSet`

- Fields:
  - `id`, `workoutExerciseId`, `setIndex`
  - prescription: `targetReps`, `targetRepMin?`, `targetRepMax?`, `targetRpe?`, `targetLoad?`, `restSeconds?`
- Relation: `logs`

### `SetLog`

- Fields: `id`, `workoutSetId`, `actualReps?`, `actualRpe?`, `actualLoad?`, `completedAt`, `notes?`, `wasSkipped`
- Uniqueness: `workoutSetId @unique`
- Implication: set logging is upserted per set, not append-only.

## Baseline and template models

### `Baseline`

- Fields:
  - identity: `id`, `userId`, `exerciseId`, `exerciseName`, `context`, `category`, `unit`
  - load and reps: `workingWeightMin?`, `workingWeightMax?`, `workingRepsMin?`, `workingRepsMax?`, `topSetWeight?`, `topSetReps?`
  - estimates/meta: `projected1RMMin?`, `projected1RMMax?`, `notes?`, `createdAt`
- Constraints:
  - unique: `@@unique([userId, exerciseId, context])`
  - index: `@@index([exerciseId])`
- Runtime purpose: load fallback/seed data for future generation.

### `WorkoutTemplate`

- Fields: `id`, `userId`, `name`, `targetMuscles`, `isStrict`, `intent`, `createdAt`, `updatedAt`
- Defaults: `targetMuscles = []`, `isStrict = false`, `intent = CUSTOM`
- Relations: `exercises`, `workouts`

### `WorkoutTemplateExercise`

- Fields: `id`, `templateId`, `exerciseId`, `orderIndex`, `supersetGroup?`
- Unique constraint: `@@unique([templateId, orderIndex])`
- Purpose: ordered template exercise list with optional superset metadata.

## Enum highlights

- `TrainingAge`: `BEGINNER`, `INTERMEDIATE`, `ADVANCED`
- `PrimaryGoal`: `HYPERTROPHY`, `STRENGTH`, `FAT_LOSS`, `ATHLETICISM`, `GENERAL_HEALTH`
- `SecondaryGoal`: `POSTURE`, `CONDITIONING`, `INJURY_PREVENTION`, `NONE`
- `SplitType`: `PPL`, `UPPER_LOWER`, `FULL_BODY`, `CUSTOM`
- `SplitDay`: `PUSH`, `PULL`, `LEGS`, `UPPER`, `LOWER`, `FULL_BODY`
- `WorkoutStatus`: `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `SKIPPED`
- `WorkoutSelectionMode`: `AUTO`, `MANUAL`, `BONUS`
- `WorkoutExerciseSection`: `WARMUP`, `MAIN`, `ACCESSORY`
- `MovementPatternV2`: push/pull/squat/hinge/lunge/carry/rotation and accessory pattern enums
- `SplitTag`: `PUSH`, `PULL`, `LEGS`, `CORE`, `MOBILITY`, `PREHAB`, `CONDITIONING`
- `EquipmentType`: includes `BARBELL`, `DUMBBELL`, `MACHINE`, `CABLE`, `BODYWEIGHT`, `KETTLEBELL`, `BAND`, `CARDIO`, `SLED`, `BENCH`, `RACK`, `EZ_BAR`, `TRAP_BAR`, `OTHER`
- `MuscleRole`: `PRIMARY`, `SECONDARY`
- `TemplateIntent`: `FULL_BODY`, `UPPER_LOWER`, `PUSH_PULL_LEGS`, `BODY_PART`, `CUSTOM`

## Runtime invariants and notes

- Workout generation context currently loads the latest 12 workouts per user.
- Split advancement logic reads `Workout.status` and `Workout.advancesSplit`.
- Workout sectioning for log/detail UI should use `WorkoutExercise.section` when present, with legacy fallback only for rows where it is null.
- `SetLog` values override target set values in mapped history when present.
- Baselines are updated only when workouts are marked `COMPLETED` and logged performance qualifies.
- Template deletion preserves workout history by nulling `Workout.templateId` before deleting template rows.
- Seed process hydrates exercise metadata from `prisma/exercises_comprehensive.json`.
