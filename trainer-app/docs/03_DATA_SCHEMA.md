# 03 Data Schema

Owner: Aaron  
Last reviewed: 2026-02-20  
Purpose: Canonical data-model reference for runtime persistence used by workout generation, logging, templates, analytics, readiness, and periodization.

This doc covers:
- Primary Prisma models used by runtime
- Enums and persisted state contracts
- Schema-level invariants that impact behavior

Invariants:
- `prisma/schema.prisma` is canonical for all model and enum definitions.
- `Workout.status`, `Workout.selectionMode`, and `WorkoutExercise.section` must stay aligned with runtime contracts.
- `SetLog.workoutSetId` is unique, so set logging is one log record per set.

Sources of truth:
- `trainer-app/prisma/schema.prisma`
- `trainer-app/prisma/migrations`
- `trainer-app/src/lib/api/workout-context.ts`
- `trainer-app/src/app/api/workouts/save/route.ts`
- `trainer-app/src/app/api/logs/set/route.ts`

## Core runtime models
- User context: `User`, `Profile`, `Goals`, `Constraints`, `Injury`, `UserPreference`, `SessionCheckIn`
- Workout execution: `Workout`, `WorkoutExercise`, `WorkoutSet`, `SetLog`, `FilteredExercise`
- Catalog/template: `Exercise`, `Muscle`, `Equipment`, `WorkoutTemplate`, `WorkoutTemplateExercise`
- Adaptive systems: `ReadinessSignal`, `ExerciseExposure`, `MacroCycle`, `Mesocycle`, `TrainingBlock`

## Runtime-critical enums
- `WorkoutStatus`: `PLANNED`, `IN_PROGRESS`, `PARTIAL`, `COMPLETED`, `SKIPPED`
- `WorkoutSelectionMode`: `AUTO`, `MANUAL`, `BONUS`, `INTENT`
- `WorkoutSessionIntent`: `PUSH`, `PULL`, `LEGS`, `UPPER`, `LOWER`, `FULL_BODY`, `BODY_PART`
- `WorkoutExerciseSection`: `WARMUP`, `MAIN`, `ACCESSORY`

Canonical machine-readable values: `docs/contracts/runtime-contracts.json`.

## Behavioral schema notes
- Workout saves rewrite workout exercises/sets when exercise payload is supplied (`/api/workouts/save`).
- Set logging upserts by `workoutSetId` (`/api/logs/set`), making log state idempotent per set.
- Filtered/rejected intent exercises are persisted to `FilteredExercise` for later explainability rendering.
- Workout rewrites are revision-guarded by `Workout.revision` (see migration `prisma/migrations/20260220_workout_revision_and_exercise_order_unique/migration.sql` and route enforcement in `src/app/api/workouts/save/route.ts`).
- Exercise ordering is deterministic per workout via unique index `WorkoutExercise(workoutId, orderIndex)` (same migration as above).
