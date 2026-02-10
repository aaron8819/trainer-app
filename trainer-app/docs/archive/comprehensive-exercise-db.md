# Comprehensive Exercise Database Replacement

**Completed**: 2026-02-09
**Scope**: Replace 66-exercise hardcoded seed with 133-exercise JSON-driven database

---

## Overview

Replaced the entire exercise database foundation. The previous seed used three parallel TypeScript data structures (`exercises[]`, `EXERCISE_FIELD_TUNING`, `exerciseMuscleMappings`) that were hard to keep in sync. The new approach uses a single JSON file (`prisma/exercises_comprehensive.json`) as the sole source of truth for all 133 exercises.

## What Changed

### Schema (Batch 1)

New Prisma enums:
- `Difficulty`: `BEGINNER`, `INTERMEDIATE`, `ADVANCED`
- `MovementPatternV2` additions: `ABDUCTION`, `ADDUCTION`, `ISOLATION`
- `EquipmentType` additions: `EZ_BAR`, `TRAP_BAR`

New Exercise model fields:
- `difficulty Difficulty @default(BEGINNER)` — exercise complexity level
- `isUnilateral Boolean @default(false)` — single-limb exercises
- `repRangeMin Int @default(1)` — recommended minimum reps
- `repRangeMax Int @default(20)` — recommended maximum reps

Engine types (`src/lib/engine/types.ts`), API mappers (`src/lib/api/workout-context.ts`, `src/lib/api/exercise-library.ts`), and exercise library types/constants updated to support all new enums and fields.

Migration: `prisma/migrations/20260209_exercise_comprehensive_enums/migration.sql`

### Muscle Renames (Batch 2)

| Before | After |
|--------|-------|
| Back | Lats |
| Hip Flexors | (removed) |
| — | Abs (new) |
| — | Abductors (new) |

Total: 17 muscles → 18 muscles

Propagated across:
- `src/lib/engine/volume-landmarks.ts` (VOLUME_LANDMARKS + MUSCLE_SPLIT_MAP)
- `src/lib/exercise-library/constants.ts` (MUSCLE_GROUP_HIERARCHY)
- `src/lib/engine/smart-build.ts` (MUSCLE_GROUP_MAP)
- `src/lib/engine/sample-data.ts` (test fixture primaryMuscles)
- 8 test files (all "Back" → "Lats", "Hip Flexors" → "Abductors" references)

### Seed Rewrite (Batch 3)

**Deleted** from `prisma/seed.ts`:
- `SeedExercise` type and `exercises[]` array (66 entries)
- `ExerciseTuning` type and `EXERCISE_FIELD_TUNING` map
- `exerciseMuscleMappings` map

**Added**:
- `import exercisesJson from "./exercises_comprehensive.json"` — single source of truth
- `EXERCISE_RENAMES` — 19 rename pairs for migrating old → canonical names
- `MUSCLE_RENAMES` — `[["Back", "Lats"]]`
- `EXERCISES_TO_DELETE_BEFORE_RENAME` — `["Dumbbell Lateral Raises"]` (merge conflict)
- `TIME_PER_SET_OVERRIDES` — ~50 entries for exercises needing non-120s values
- 34 exercise aliases for backward compatibility

New seed flow:
```
main():
  renameExercises()              — apply EXERCISE_RENAMES via prisma.exercise.update
  renameMuscles()                — "Back"→"Lats" in Muscle table
  seedEquipment()                — 12 equipment types (added EZ_Bar, Trap_Bar)
  seedMuscles()                  — 18 muscles
  seedExercisesFromJson()        — upsert 133 exercises from JSON
  seedExerciseAliases()          — 34 aliases
  seedExerciseMusclesFromJson()  — primary/secondary mappings from JSON
  seedExerciseEquipmentFromJson()— equipment mappings from JSON
  seedOwner + seedBaselines      — 31 baselines for owner@local
  pruneStaleExercises()          — remove 5 exercises not in JSON
```

### Exercise Renames (19)

| Old Name | New Name |
|----------|----------|
| Hip Thrust | Barbell Hip Thrust |
| Leg Curl | Lying Leg Curl |
| Incline Barbell Bench | Incline Barbell Bench Press |
| Smith Machine Incline Press | Incline Machine Press |
| Dumbbell Incline Press | Incline Dumbbell Bench Press |
| Pec Deck | Pec Deck Machine |
| Overhead Press | Barbell Overhead Press |
| Dumbbell Shoulder Press | Dumbbell Overhead Press |
| Lateral Raise | Dumbbell Lateral Raise |
| Triceps Pushdown | Cable Triceps Pushdown |
| Skull Crusher | Lying Triceps Extension (Skull Crusher) |
| Dips | Dip (Chest Emphasis) |
| Overhead Triceps Extension | Overhead Dumbbell Extension |
| Chest-Supported Row | Chest-Supported Dumbbell Row |
| Single-Arm Dumbbell Row | One-Arm Dumbbell Row |
| Machine Rear Delt Fly | Reverse Pec Deck |
| Reverse Fly | Dumbbell Rear Delt Fly |
| Cable Preacher Curl | Preacher Curl |
| Farmer's Carry | Farmer's Walk |

### Exercises Pruned (5)

Removed (not in JSON): Reverse Hack Squat, Split Squat, Low-Incline Dumbbell Press, JM Press, Dead Bug

### Exercise Count by Split Tag

| Split Tag | Count |
|-----------|-------|
| Pull | 42 |
| Push | 36 |
| Legs | 33 |
| Core | 16 |
| Conditioning | 6 |
| **Total** | **133** |

### New Exercises Added (~67)

Key additions filling previous gaps:
- **Forearms**: Wrist Curl, Reverse Wrist Curl, Reverse Curl
- **Unilateral variations**: Single-Leg Hip Thrust, One-Arm Dumbbell Row, Concentration Curl
- **Abs**: Ab Wheel Rollout, Bicycle Crunch, Decline Sit-Up, Dragon Flag, Reverse Crunch, Russian Twist, Machine Crunch, Hanging Knee Raise
- **Adductor/Abductor**: Hip Adduction Machine, Cable Hip Abduction, Copenhagen Plank
- **Curl variations**: EZ-Bar Curl, Spider Curl, Cable Curl, Alternating Dumbbell Curl, Cross-Body Hammer Curl
- **Triceps variations**: Dip (Triceps Emphasis), Overhead Cable Triceps Extension, Rope Triceps Pushdown, Diamond Push-Up
- **Back variations**: Meadows Row, Pendlay Row, Inverted Row, Chin-Up, Neutral Grip Pull-Up, Weighted Pull-Up
- **Chest variations**: Close-Grip Bench Press, Decline variations, Incline Dumbbell Fly, Cable Crossover, Low-to-High Cable Fly
- **Shoulder**: Arnold Press, Seated Barbell Overhead Press, Cable/Dumbbell Front Raise, Machine Lateral Raise
- **Leg**: Sissy Squat, Nordic Hamstring Curl, Good Morning, Goblet Squat, Reverse Lunge, Stiff-Legged Deadlift, Sumo Deadlift
- **Carries**: Suitcase Carry, Overhead Carry

### Test Updates (Batch 4)

- `seed-validation.test.ts`: Rewritten to import from JSON directly (10 tests)
- `filtering.test.ts`: Muscle references updated
- 7 additional test files: Updated for "Back" → "Lats" rename

### Documentation Updates (Batch 5)

- `docs/data-model.md`: Added new Exercise fields + enums
- `docs/seeded-data.md`: Complete rewrite with 133 exercises
- `docs/decisions.md`: ADR-023 for JSON-driven exercise DB
- MEMORY.md: Updated exercise count, muscle list

## Issues Encountered

### Shadow DB migration failure
`prisma migrate dev` failed with P3006/P1014 because old migrations don't replay cleanly in the shadow DB. Fixed by using `prisma migrate diff --from-config-datasource` to generate SQL, then manually creating the migration file and applying with `prisma migrate deploy`.

### Ghost Baseline constraint
A `@@unique([userId, exerciseName, context])` constraint persisted in the DB from a partially-failed earlier migration. `ALTER TABLE DROP CONSTRAINT` reported success but didn't actually remove it. Fixed with `DROP INDEX IF EXISTS "Baseline_userId_exerciseName_context_key"` — PostgreSQL stores unique constraints as indexes, so dropping the index removes the constraint.

## Verification

| Check | Result |
|-------|--------|
| Tests | 277 passed (19 files) |
| Lint | 0 errors, 0 warnings |
| tsc --noEmit | Clean |
| Build | Clean |
| Seed | 133 exercises, 344 muscle mappings, 197 equipment mappings, 31 baselines, 5 pruned |

## ADR

ADR-023 in `docs/decisions.md`
