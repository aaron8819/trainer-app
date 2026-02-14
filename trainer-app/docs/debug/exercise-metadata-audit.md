# Exercise Metadata Audit

Date: 2026-02-12  
Status: Applied and reseeded

## Purpose

Permanent record of the metadata correction pass applied to `prisma/exercises_comprehensive.json`.

These fields directly affect selection quality and behavior:

- Hard filtering (`sfrScore`, `isMainLiftEligible`)
- Soft scoring (`sfrScore`, `lengthPositionScore`, `fatigueCost`)
- Time estimation (`timePerSetSec`)
- Compound/coverage logic (`isCompound`)
- Candidate suitability and profile fit (`difficulty`, `unilateral`)

## Scope

- Source of truth: `prisma/exercises_comprehensive.json` (`exercises` array)
- Exercise count: 133
- Seed run after updates: `npm run db:seed` (0 created, 133 updated)
- Follow-up validations passed:
  - `npx tsx scripts/audit-intent-selection.ts --strict` (8/8)
  - `npm run build`
  - `npx vitest run src/lib/engine/exercise-selection.test.ts src/lib/engine/timeboxing.test.ts`

## Rationale Summary

- **SFR corrections:** reduce hypertrophy-slot pollution from low-stimulus holds/carries and improve ranking of productive hypertrophy movements.
- **Lengthened-position corrections:** better reflect true loaded-lengthened stimulus where overstated/understated.
- **Fatigue corrections:** align fatigue penalties with real systemic/local cost and readiness sensitivity.
- **Main-lift eligibility corrections:** promote valid machine/barbell lower-body mains that should compete for main slots.
- **Timing corrections:** improve `estimateWorkoutMinutes` and selection time-fit behavior using more realistic active-set durations.
- **Difficulty corrections:** better represent skill demands for bodyweight compounds and barbell hinge execution.
- **Unilateral normalization:** ensure unilateral-aware metadata is explicit and consistent.

## 1) `sfrScore` Changes

| Exercise | Old | New |
|---|---:|---:|
| Dead Hang | 3 | 1 |
| Plank | 3 | 1 |
| Side Plank | 3 | 1 |
| Farmer's Walk | 3 | 2 |
| Overhead Carry | 3 | 2 |
| Sled Push | 3 | 2 |
| Sled Pull | 3 | 2 |
| Sled Drag | 3 | 2 |
| Walking Lunge | 1 | 3 |
| Barbell Back Squat | 2 | 3 |
| Front Squat | 2 | 3 |
| Romanian Deadlift | 3 | 4 |
| Reverse Wrist Curl | 3 | 2 |
| Russian Twist | 3 | 2 |
| Bicycle Crunch | 3 | 2 |
| Decline Sit-Up | 3 | 2 |
| Wrist Curl | 3 | 2 |
| Reverse Crunch | 4 | 3 |

## 2) `lengthPositionScore` Changes

| Exercise | Old | New |
|---|---:|---:|
| Cable Triceps Pushdown | 2 | 1 |
| Rope Triceps Pushdown | 2 | 1 |
| Concentration Curl | 2 | 1 |
| Spider Curl | 2 | 1 |
| Hanging Knee Raise | 2 | 1 |
| Barbell Hip Thrust | 2 | 1 |
| Glute Bridge | 2 | 1 |
| Dip (Triceps Emphasis) | 3 | 4 |
| Hack Squat | 3 | 4 |
| Leg Press | 3 | 4 |
| Dumbbell Lateral Raise | 3 | 2 |
| Machine Lateral Raise | 3 | 2 |
| Cable Lateral Raise | 4 | 3 |
| Dumbbell Front Raise | 3 | 2 |
| Dumbbell Rear Delt Fly | 3 | 2 |
| Barbell Shrug | 3 | 2 |
| Dumbbell Shrug | 3 | 2 |

## 3) `fatigueCost` Changes

| Exercise | Old | New |
|---|---:|---:|
| Barbell Curl | 2 | 1 |
| EZ-Bar Curl | 2 | 1 |
| Reverse Curl | 2 | 1 |
| One-Arm Dumbbell Row | 2 | 3 |
| T-Bar Row | 3 | 4 |
| Meadows Row | 2 | 3 |
| Bulgarian Split Squat | 3 | 4 |
| Nordic Hamstring Curl | 3 | 4 |
| Sissy Squat | 3 | 2 |

## 4) `isCompound` Changes

| Exercise | Old | New |
|---|---|---|
| Ab Wheel Rollout | false | true |

## 5) `isMainLiftEligible` Changes

| Exercise | Old | New |
|---|---|---|
| Hack Squat | false | true |
| Leg Press | false | true |
| Barbell Hip Thrust | false | true |

## 6) `timePerSetSec` Changes

| Exercise | Old | New |
|---|---:|---:|
| Barbell Curl | 55 | 30 |
| EZ-Bar Curl | 25 | 30 |
| Reverse Curl | 55 | 30 |
| Barbell Shrug | 55 | 30 |
| Dumbbell Shrug | 30 | 25 |
| One-Arm Dumbbell Row | 80 | 60 |
| Reverse Lunge | 75 | 55 |
| Walking Lunge | 75 | 60 |
| Meadows Row | 25 | 45 |
| Seated Barbell Overhead Press | 80 | 70 |
| Preacher Curl | 40 | 35 |
| Single-Leg Hip Thrust | 80 | 55 |
| Stiff-Legged Deadlift | 75 | 60 |
| Bulgarian Split Squat | 75 | 65 |

## 7) `difficulty` Changes

| Exercise | Old | New |
|---|---|---|
| Chin-Up | beginner | intermediate |
| Pull-Up | beginner | intermediate |
| Neutral Grip Pull-Up | beginner | intermediate |
| Dip (Chest Emphasis) | beginner | intermediate |
| Dip (Triceps Emphasis) | beginner | intermediate |
| Good Morning | beginner | intermediate |

## 8) Unilateral Flag Normalization

Note: in JSON this field is stored as `unilateral` (maps to `isUnilateral` in engine types).

Set `unilateral: true` for:

- Alternating Dumbbell Curl
- Bulgarian Split Squat
- Cable Hip Abduction
- Concentration Curl
- Copenhagen Plank
- Cross-Body Hammer Curl
- Meadows Row
- One-Arm Dumbbell Row
- Reverse Lunge
- Single-Leg Hip Thrust
- Suitcase Carry
- Walking Lunge

Set `unilateral: false` for all remaining exercises that were null/undefined.

## Operational Impact

- Improves accessory candidate quality for hypertrophy/fat-loss sessions by reducing low-SFR selections.
- Improves session time-fit reliability and downstream trim decisions via corrected set-time estimates.
- Improves main-lift slot quality in lower-body sessions by admitting appropriate machine/barbell options.
- Improves ranking stability by aligning fatigue and lengthened-load metadata with intended training stimulus.
