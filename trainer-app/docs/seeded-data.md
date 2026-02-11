# Seeded Data (Current)

This document summarizes the data seeded by `trainer-app/prisma/seed.ts`. It reflects what is inserted when running `npm run db:seed`.

The single source of truth for exercises is `prisma/exercises_comprehensive.json` (133 exercises). The seed script imports this JSON and upserts all exercises, muscle mappings, and equipment mappings from it.

## Equipment (12)

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
- EZ_Bar
- Trap_Bar

## Muscles (18)

- Chest
- Lats
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
- Abductors
- Calves
- Core
- Abs

## Exercises (133)

All exercises are seeded with explicit fields from JSON (no name-based derivation):
- `splitTag`, `movementPatterns`, `isCompound`, `isMainLiftEligible`
- `fatigueCost`, `sfrScore`, `lengthPositionScore`, `stimulusBias`, `contraindications`
- `timePerSetSec`, `difficulty`, `isUnilateral`, `repRangeMin`, `repRangeMax`
- Primary and secondary muscle mappings
- Equipment requirements

### Legs (33)

- Back Extension (45 Degree)
- Barbell Back Squat
- Barbell Hip Thrust
- Belt Squat
- Bulgarian Split Squat
- Cable Hip Abduction
- Cable Pull-Through
- Conventional Deadlift
- Copenhagen Plank
- Front Squat
- Glute Bridge
- Goblet Squat
- Good Morning
- Hack Squat
- Hip Abduction Machine
- Hip Adduction Machine
- Leg Extension
- Leg Press
- Leg Press Calf Raise
- Lying Leg Curl
- Nordic Hamstring Curl
- Reverse Hyperextension
- Reverse Lunge
- Romanian Deadlift
- Seated Calf Raise
- Seated Leg Curl
- Single-Leg Hip Thrust
- Sissy Squat
- Standing Calf Raise
- Stiff-Legged Deadlift
- Sumo Deadlift
- Trap Bar Deadlift
- Walking Lunge

### Push (36)

- Arnold Press
- Barbell Bench Press
- Barbell Overhead Press
- Cable Crossover
- Cable Fly
- Cable Front Raise
- Cable Lateral Raise
- Cable Triceps Pushdown
- Close-Grip Bench Press
- Decline Barbell Bench Press
- Decline Dumbbell Bench Press
- Deficit Push-Up
- Diamond Push-Up
- Dip (Chest Emphasis)
- Dip (Triceps Emphasis)
- Dumbbell Bench Press
- Dumbbell Fly
- Dumbbell Front Raise
- Dumbbell Lateral Raise
- Dumbbell Overhead Press
- Incline Barbell Bench Press
- Incline Dumbbell Bench Press
- Incline Dumbbell Fly
- Incline Machine Press
- Landmine Press
- Low-to-High Cable Fly
- Lying Triceps Extension (Skull Crusher)
- Machine Chest Press
- Machine Lateral Raise
- Machine Shoulder Press
- Overhead Cable Triceps Extension
- Overhead Dumbbell Extension
- Pec Deck Machine
- Push-Up
- Rope Triceps Pushdown
- Seated Barbell Overhead Press

### Pull (42)

- Alternating Dumbbell Curl
- Barbell Curl
- Barbell Row
- Barbell Shrug
- Bayesian Curl
- Cable Curl
- Cable Pullover
- Cable Rear Delt Fly
- Chest-Supported Dumbbell Row
- Chest-Supported T-Bar Row
- Chin-Up
- Close-Grip Lat Pulldown
- Close-Grip Seated Cable Row
- Concentration Curl
- Cross-Body Hammer Curl
- Dead Hang
- Dumbbell Curl
- Dumbbell Pullover
- Dumbbell Rear Delt Fly
- Dumbbell Row
- Dumbbell Shrug
- EZ-Bar Curl
- Face Pull
- Hammer Curl
- Incline Dumbbell Curl
- Inverted Row
- Lat Pulldown
- Meadows Row
- Neutral Grip Pull-Up
- One-Arm Dumbbell Row
- Pendlay Row
- Preacher Curl
- Pull-Up
- Reverse Curl
- Reverse Pec Deck
- Reverse Wrist Curl
- Seated Cable Row
- Spider Curl
- Straight-Arm Pulldown
- T-Bar Row
- Weighted Pull-Up
- Wrist Curl

### Core (16)

- Ab Wheel Rollout
- Bicycle Crunch
- Cable Crunch
- Decline Sit-Up
- Dragon Flag
- Hanging Knee Raise
- Hanging Leg Raise
- Landmine Rotation
- Machine Crunch
- Pallof Press
- Plank
- RKC Plank
- Reverse Crunch
- Russian Twist
- Side Plank
- Wood Chop

### Conditioning (6)

- Farmer's Walk
- Overhead Carry
- Sled Drag
- Sled Pull
- Sled Push
- Suitcase Carry

## Exercise Aliases (34)

Aliases resolve legacy names and backward-compatible references. Each alias maps to a canonical exercise name via the `ExerciseAlias` table.

Examples:
- Hip Thrust → Barbell Hip Thrust
- Leg Curl → Lying Leg Curl
- Overhead Press → Barbell Overhead Press
- Dumbbell Shoulder Press → Dumbbell Overhead Press
- Lateral Raise → Dumbbell Lateral Raise
- Triceps Pushdown → Cable Triceps Pushdown
- Skull Crusher → Lying Triceps Extension (Skull Crusher)
- Dips → Dip (Chest Emphasis)
- Chest-Supported Row → Chest-Supported Dumbbell Row
- Single-Arm Dumbbell Row → One-Arm Dumbbell Row
- Machine Rear Delt Fly → Reverse Pec Deck
- Reverse Fly → Dumbbell Rear Delt Fly
- Cable Preacher Curl → Preacher Curl
- Farmer's Carry → Farmer's Walk

## Exercise Renames (Applied During Seed)

When the seed runs, 19 exercise renames are applied to migrate old names to canonical names. After renaming, old names become aliases. Renames include:
- Hip Thrust → Barbell Hip Thrust
- Incline Barbell Bench → Incline Barbell Bench Press
- Dumbbell Incline Press → Incline Dumbbell Bench Press
- Overhead Press → Barbell Overhead Press
- Lateral Raise → Dumbbell Lateral Raise

## Baselines

Baselines are seeded for the owner user (`owner@local`) and include 31 baselines covering main lifts and accessories.

## Workout Templates

20 workout templates are seeded for the owner user (`owner@local`) from `docs/workouts/workouts.md`.

Each template stores:
- Template name
- Target muscles
- Ordered exercise list (`WorkoutTemplateExercise.orderIndex`)

Note: sets/reps/rest are not persisted on template rows. They are prescribed at generation time by the template engine using each user's profile/goals/fatigue context.

## Stale Exercise Pruning

After seeding, exercises not in `exercises_comprehensive.json` are pruned (5 removed):
- Reverse Hack Squat, Split Squat, Low-Incline Dumbbell Press, JM Press, Dead Bug

## Notes

- All exercise metadata is explicit in JSON — no regex or name-based derivation.
- The JSON file is the single source of truth for the exercise catalog.
- `splitTag`, `movementPatterns`, `isCompound`, `isMainLiftEligible` are directly defined per exercise.
- Runtime SRA windows are DB-driven from `Muscle.sraHours` via mapped exercise metadata, with fallback to `volume-landmarks.ts` constants.
