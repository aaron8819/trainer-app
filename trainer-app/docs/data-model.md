# Data Model (Current)

Last verified against schema: 2026-02-20 (`prisma/schema.prisma`)

This document summarizes the persisted model used by workout generation, logging, and adaptation loops.

## Core user models

### `User`

- Fields: `id`, `email`, `createdAt`
- Key relations: `profile`, `constraints`, `goals`, `injuries`, `preferences`, `workouts`, `sessionCheckIns`, `templates`

### `Profile`

- Fields: `userId`, `age`, `sex`, `heightIn`, `weightLb`, `trainingAge`
- `trainingAge` default: `INTERMEDIATE`
- Runtime note: engine mapping converts `heightIn` and `weightLb` to metric values.

### `Goals`

- Fields: `userId`, `primaryGoal`, `secondaryGoal`
- Runtime-critical fields: `primaryGoal`, `secondaryGoal`

### `Constraints`

- Fields: `userId`, `daysPerWeek`, `sessionMinutes`, `splitType`
- Runtime-critical fields: split type, session minutes
- Note: `availableEquipment` was removed (ADR-067) — always defaulted to ALL_EQUIPMENT_TYPES with no UI for per-user filtering.

### `UserPreference`

- Fields: `favoriteExerciseIds` (String[]), `avoidExerciseIds` (String[])
- Both default to `[]`
- Runtime use: drives `userPreference` scoring in beam search

### `Injury`

- Fields: `id`, `userId`, `bodyPart`, `description`, `severity`, `isActive`, `createdAt`
- Index: `@@index([userId, isActive])`

### `SessionCheckIn`

- Fields: `id`, `userId`, `workoutId?`, `date`, `readiness`, `painFlags`, `notes`, `createdAt`
- Index: `@@index([userId, date])`
- Runtime use: latest check-in (readiness and pain flags) influences generation.

### `ReadinessSignal` (Phase 3)

- Fields:
  - identity: `id`, `userId`, `timestamp`
  - Whoop data (stubbed): `whoopRecovery`, `whoopStrain`, `whoopHrv`, `whoopSleepQuality`, `whoopSleepHours`
  - Subjective: `subjectiveReadiness`, `subjectiveMotivation`, `subjectiveSoreness` (JSON), `subjectiveStress`
  - Performance: `performanceRpeDeviation`, `performanceStalls`, `performanceCompliance`
  - Computed: `fatigueScoreOverall`, `fatigueScoreBreakdown` (JSON)
- Index: `@@index([userId, timestamp])`
- Runtime use: Latest signal drives autoregulation decisions in workout generation.
- See `POST /api/readiness/submit` and `src/lib/engine/readiness/compute-fatigue.ts`

### `UserIntegration` (Phase 3 - Stubbed)

- Fields: `id`, `userId`, `provider`, `accessToken`, `refreshToken`, `expiresAt`, `isActive`, `createdAt`, `updatedAt`
- Unique: `@@unique([userId, provider])`
- Index: `@@index([userId])`
- Runtime use: Future OAuth integration for Whoop, Garmin, etc. (stubbed in Phase 3).
- See `src/lib/api/readiness.ts` (`fetchWhoopRecovery`, `refreshWhoopToken`)

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
- `workoutExercises`, `templateExercises`

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

## Workout execution models

### `Workout`

- Fields:
  - ownership/scheduling: `id`, `userId`, `templateId?`, `scheduledDate`, `completedAt`
  - status/selection: `status`, `selectionMode`, `forcedSplit`, `advancesSplit`
  - display/meta: `estimatedMinutes`, `notes`
  - autoregulation (Phase 3): `wasAutoregulated`, `autoregulationLog` (JSON)
- Defaults:
  - `status = PLANNED`
  - `selectionMode = AUTO`
  - `advancesSplit = true`
  - `wasAutoregulated = false`
- Index: `@@index([userId, scheduledDate])`
- Relations: `exercises`, `sessionCheckIns`, optional `template`
- Runtime use: `wasAutoregulated` + `autoregulationLog` track intensity/volume adjustments based on fatigue score

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

### `FilteredExercise`

- Fields: `id`, `workoutId`, `exerciseId?`, `exerciseName`, `reason`, `userFriendlyMessage`
- Index: `workoutId`
- Relation: belongs to `Workout` (`onDelete: Cascade`)
- Purpose: Persists the hard-constraint rejection list from intent-mode selection for explainability — "Why didn't I get this exercise?" Written by the save route; loaded by `generateWorkoutExplanation()` so `FilteredExercisesCard` displays on every workout detail view (not just immediately after generation).
- `exerciseId` is nullable (exercise may have been identified by name only at rejection time).
- Scope: Intent mode only (PPL / full_body / body_part). Template mode has no rejected exercises.

## Periodization models (Phase 1 - 2026-02-14)

### `MacroCycle`

- Fields:
  - identity: `id`, `userId`
  - scheduling: `startDate`, `endDate`, `durationWeeks`
  - programming: `trainingAge`, `primaryGoal`
  - timestamps: `createdAt`, `updatedAt`
- Relations: `mesocycles`
- Index: `@@index([userId, startDate])`
- Purpose: Top-level periodization structure spanning multiple mesocycles (typically 12-52 weeks)

### `Mesocycle`

- Fields:
  - identity: `id`, `macroCycleId`
  - sequencing: `mesoNumber` (1, 2, 3...)
  - scheduling: `startWeek` (offset from macro start, 0-indexed), `durationWeeks`
  - programming: `focus` (e.g., "Upper Body Hypertrophy"), `volumeTarget`, `intensityBias`
- Relations: `blocks`
- Constraints:
  - unique: `@@unique([macroCycleId, mesoNumber])`
  - index: `@@index([macroCycleId])`
- Purpose: Training phase within macro cycle (typically 4-6 weeks)

### `TrainingBlock`

- Fields:
  - identity: `id`, `mesocycleId`
  - sequencing: `blockNumber` (1, 2, 3... within meso)
  - type: `blockType` (ACCUMULATION | INTENSIFICATION | REALIZATION | DELOAD)
  - scheduling: `startWeek` (offset from macro start), `durationWeeks`
  - programming: `volumeTarget`, `intensityBias`, `adaptationType`
- Relations: `workouts`
- Constraints:
  - unique: `@@unique([mesocycleId, blockNumber])`
  - index: `@@index([mesocycleId])`
- Purpose: Distinct training phase with specific volume/intensity characteristics (typically 1-3 weeks)
- Block modifiers:
  - **Accumulation**: High volume (1.0 → 1.2), moderate intensity (RIR +2), myofibrillar hypertrophy
  - **Intensification**: Moderate volume (1.0 → 0.8), high intensity (RIR +1), neural adaptation
  - **Realization**: Low volume (0.6 → 0.7), max intensity (RIR +0), peak performance
  - **Deload**: 50% volume, low intensity (RIR +3), active recovery

### `ExerciseExposure`

- Fields:
  - identity: `id`, `userId`, `exerciseName`
  - timing: `lastUsedAt`, `updatedAt`
  - usage windows: `timesUsedL4W`, `timesUsedL8W`, `timesUsedL12W`
  - averages: `avgSetsPerWeek`, `avgVolumePerWeek`
- Constraints:
  - unique: `@@unique([userId, exerciseName])`
  - index: `@@index([userId, lastUsedAt])`
- Purpose: Track exercise exposure for intelligent rotation management

### `Workout` extensions for periodization

Optional fields wired to periodization:
- `trainingBlockId?`: FK to `TrainingBlock`
- `weekInBlock?`: 1-indexed week number within block

## Template models

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
- `EquipmentType`: includes `BARBELL`, `DUMBBELL`, `MACHINE`, `CABLE`, `BODYWEIGHT`, `KETTLEBELL`, `BAND`, `SLED`, `BENCH`, `RACK`, `EZ_BAR`, `TRAP_BAR`, `OTHER`
- `MuscleRole`: `PRIMARY`, `SECONDARY`
- `TemplateIntent`: `FULL_BODY`, `UPPER_LOWER`, `PUSH_PULL_LEGS`, `BODY_PART`, `CUSTOM`

## Runtime invariants and notes

- Workout generation context currently loads the latest 12 workouts per user.
- Split advancement logic reads `Workout.status` and `Workout.advancesSplit`.
- Workout sectioning for log/detail UI should use `WorkoutExercise.section` when present, with legacy fallback only for rows where it is null.
- `SetLog` values override target set values in mapped history when present.
- Template deletion preserves workout history by nulling `Workout.templateId` before deleting template rows.
- Seed process hydrates exercise metadata from `prisma/exercises_comprehensive.json`.
