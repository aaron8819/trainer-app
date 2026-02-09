# Seeded Data (Current)

This document summarizes the data seeded by `trainer-app/prisma/seed.ts`. It reflects what is inserted when running `npm run db:seed`.

## Equipment

- Barbell
- Dumbbell
- Machine
- Cable
- Bodyweight
- Kettlebell
- Band
- Sled
- Bench
- Rack

## Muscles

- Chest
- Back
- Upper Back
- Lower Back
- Front Delts
- Side Delts
- Rear Delts
- Biceps
- Triceps
- Forearms
- Quads
- Hamstrings
- Glutes
- Adductors
- Calves
- Core
- Hip Flexors

## Exercises

Seeded exercises are created with:
- `splitTags` (derived by pattern + name heuristics)
- `movementPatterns` (derived by name heuristics)
- `isMainLiftEligible`, `isCompound`
- `fatigueCost`, `timePerSetSec`, `sfrScore`, `lengthPositionScore`
- `stimulusBias` (seeded for key compounds and accessories)
- `contraindications` (seeded for pain filtering)

## Exercise Aliases

Aliases are seeded to resolve baseline names and legacy variants via `ExerciseAlias`:
- DB Shoulder Press -> Dumbbell Shoulder Press
- Front-Foot Elevated Split Squat -> Split Squat
- Romanian Deadlift (BB) -> Romanian Deadlift
- DB Romanian Deadlift -> Romanian Deadlift
- Incline DB Press -> Dumbbell Incline Press
- One-Arm DB Row -> Single-Arm Dumbbell Row
- Incline DB Curls -> Incline Dumbbell Curl
- DB Skull Crushers -> Skull Crusher
- DB Lateral Raise -> Lateral Raise
- Face Pulls (Rope) -> Face Pull
- Tricep Rope Pushdown -> Triceps Pushdown
- Decline Barbell Bench -> Barbell Bench Press
- Flat DB Press -> Dumbbell Bench Press

## Stimulus Bias (Seeded)

Examples (non-exhaustive):
- MECHANICAL: Barbell Bench Press, Barbell Back Squat, Conventional Deadlift, Trap Bar Deadlift, Overhead Press, Barbell Row, Pull-Up.
- STRETCH: Cable Fly, Pec Deck, Overhead Triceps Extension, Romanian Deadlift, Incline Dumbbell Curl.
- METABOLIC: Lateral Raise, Face Pull, Leg Extension, Leg Curl, Cable Crunch, Triceps Pushdown.
- STABILITY: Plank, Pallof Press, Dead Bug, Farmer's Carry.

## Contraindications (Seeded)

Examples (non-exhaustive):
- Elbow: Skull Crusher, Barbell Curl.
- Shoulder: Overhead Press, Dumbbell Shoulder Press, Machine Shoulder Press, Overhead Triceps Extension, Dips.
- Low back: Barbell Row, T-Bar Row.

### Squat Pattern

- Barbell Back Squat (main)
- Front Squat (main)
- Hack Squat
- Reverse Hack Squat
- Leg Press
- Belt Squat (main)
- Leg Extension

### Hinge Pattern

- Romanian Deadlift (main)
- Conventional Deadlift (main)
- Trap Bar Deadlift (main)
- Hip Thrust
- Leg Curl
- Hip Abduction Machine
- Glute Bridge

### Lunge Pattern

- Walking Lunge
- Split Squat
- Bulgarian Split Squat

### Push (Pressing)

- Barbell Bench Press (main)
- Incline Barbell Bench (main)
- Smith Machine Incline Press (main)
- Dumbbell Bench Press (main)
- Dumbbell Incline Press
- Low-Incline Dumbbell Press
- Push-Up
- Overhead Press (main)
- Dumbbell Shoulder Press
- Machine Chest Press (main)
- Machine Shoulder Press

### Push Accessories

- Triceps Pushdown
- JM Press
- Skull Crusher
- Dips
- Overhead Triceps Extension
- Cable Fly
- Pec Deck
- Lateral Raise
- Cable Lateral Raise

### Pull (Rows / Pulls)

- Pull-Up (main)
- Lat Pulldown
- Barbell Row (main)
- Seated Cable Row
- Chest-Supported Row
- Chest-Supported T-Bar Row (main)
- Single-Arm Dumbbell Row
- T-Bar Row (main)
- Reverse Fly
- Face Pull
- Machine Rear Delt Fly

### Pull Accessories (Arms)

- Dumbbell Curl
- Barbell Curl
- Hammer Curl
- Incline Dumbbell Curl
- Bayesian Curl
- Cable Preacher Curl

### Core / Rotation

- Plank
- Hanging Leg Raise
- Cable Crunch
- Pallof Press
- Dead Bug

### Conditioning / Carries

- Farmer's Carry
- Sled Push
- Sled Pull
- Sled Drag

### Legacy / Variant Names (Compatibility)

`seed.ts` also includes **ExerciseMuscle mappings for all known DB exercises**, including legacy and variant names that may already exist in the database. These mappings are applied only if the exercise name exists.

Examples (non-exhaustive):
- Barbell Deadlift
- Decline Barbell Bench Press
- Incline Barbell Bench Press
- Rear Delt Fly Machine
- Seated Calf Raises
- Sled Drags
- Captain's Chair Knee Raises

## Baselines

Baselines are seeded for the owner user (`owner@local`) and include:

### Main Lift Baselines

- Barbell Back Squat (heavy + volume contexts)
- Flat Barbell Bench Press (strength + volume contexts)
- Barbell Deadlift (strength + volume contexts)
- Overhead Press

### Accessory Baselines

- DB Shoulder Press
- Incline Barbell Bench
- Romanian Deadlift (BB)
- Incline DB Press
- Flat DB Press
- One-Arm DB Row
- DB Romanian Deadlift
- Incline DB Curls
- DB Skull Crushers
- DB Lateral Raise
- Front-Foot Elevated Split Squat
- Chest-Supported Machine Row
- Iso-Lateral Low Row
- Lat Pulldown
- Straight-Arm Pulldown
- Face Pulls (Rope)
- Machine Shrugs
- Machine Shoulder Press
- Rope Hammer Curls
- Tricep Rope Pushdown
- Rear Delt Fly Machine
- Assisted Dips
- Leg Press
- Decline Barbell Bench

## Notes

- `splitTags` and `movementPatterns` are derived during seeding using name heuristics.
- The exercise list is intentionally focused on PPL-friendly movements and the user's preferred training style.
- `seed.ts` now seeds **ExerciseMuscle mappings** for all known exercises (including legacy/variant names).


