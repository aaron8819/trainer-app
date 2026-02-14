# timePerSetSec Audit

Updated every exercise in `prisma/exercises_comprehensive.json` with active-set-only `timePerSetSec` values.

## 2026-02-12 Metadata Correction Pass

This audit now tracks broader exercise metadata calibration (not only timing).  
In this pass, the following `timePerSetSec` values were corrected:

- `Barbell Curl`: `55 -> 30`
- `EZ-Bar Curl`: `25 -> 30`
- `Reverse Curl`: `55 -> 30`
- `Barbell Shrug`: `55 -> 30`
- `Dumbbell Shrug`: `30 -> 25`
- `One-Arm Dumbbell Row`: `80 -> 60`
- `Reverse Lunge`: `75 -> 55`
- `Walking Lunge`: `75 -> 60`
- `Meadows Row`: `25 -> 45`
- `Seated Barbell Overhead Press`: `80 -> 70`
- `Preacher Curl`: `40 -> 35`
- `Single-Leg Hip Thrust`: `80 -> 55`
- `Stiff-Legged Deadlift`: `75 -> 60`
- `Bulgarian Split Squat`: `75 -> 65`

Additional non-timing metadata updates in the same pass covered `sfrScore`, `lengthPositionScore`, `fatigueCost`, `isCompound`, `isMainLiftEligible`, `difficulty`, and unilateral flags.

| Exercise | Old `timePerSetSec` | New `timePerSetSec` | Category |
|---|---:|---:|---|
| Ab Wheel Rollout | 60 | 30 | bodyweight isolations/accessories |
| Alternating Dumbbell Curl | 120 | 30 | dumbbell isolations |
| Arnold Press | 120 | 50 | dumbbell compounds |
| Back Extension (45 Degree) | 120 | 35 | bodyweight compounds |
| Barbell Back Squat | 210 | 75 | heavy barbell compounds |
| Barbell Bench Press | 180 | 75 | heavy barbell compounds |
| Barbell Curl | 120 | 55 | moderate barbell/trap movements |
| Barbell Hip Thrust | 120 | 75 | heavy barbell compounds |
| Barbell Overhead Press | 180 | 75 | heavy barbell compounds |
| Barbell Row | 150 | 75 | heavy barbell compounds |
| Barbell Shrug | 120 | 55 | moderate barbell/trap movements |
| Bayesian Curl | 75 | 35 | cable movements |
| Belt Squat | 150 | 50 | machine compounds |
| Bicycle Crunch | 60 | 25 | bodyweight isolations/accessories |
| Bulgarian Split Squat | 120 | 75 | dumbbell compounds |
| Cable Crossover | 120 | 35 | cable movements |
| Cable Crunch | 60 | 35 | cable movements |
| Cable Curl | 75 | 35 | cable movements |
| Cable Fly | 75 | 35 | cable movements |
| Cable Front Raise | 120 | 35 | cable movements |
| Cable Hip Abduction | 75 | 35 | cable movements |
| Cable Lateral Raise | 75 | 35 | cable movements |
| Cable Pull-Through | 120 | 45 | machine compounds |
| Cable Pullover | 120 | 35 | cable movements |
| Cable Rear Delt Fly | 75 | 35 | cable movements |
| Cable Triceps Pushdown | 75 | 35 | cable movements |
| Chest-Supported Dumbbell Row | 120 | 55 | dumbbell compounds |
| Chest-Supported T-Bar Row | 120 | 55 | machine compounds |
| Chin-Up | 210 | 35 | bodyweight compounds |
| Close-Grip Bench Press | 120 | 75 | heavy barbell compounds |
| Close-Grip Lat Pulldown | 120 | 50 | machine compounds |
| Close-Grip Seated Cable Row | 120 | 50 | machine compounds |
| Concentration Curl | 75 | 30 | dumbbell isolations |
| Conventional Deadlift | 210 | 85 | heavy barbell compounds |
| Copenhagen Plank | 120 | 25 | bodyweight isolations/accessories |
| Cross-Body Hammer Curl | 75 | 30 | dumbbell isolations |
| Dead Hang | 120 | 25 | bodyweight isolations/accessories |
| Decline Barbell Bench Press | 180 | 80 | heavy barbell compounds |
| Decline Dumbbell Bench Press | 120 | 55 | dumbbell compounds |
| Decline Sit-Up | 60 | 30 | bodyweight isolations/accessories |
| Deficit Push-Up | 120 | 35 | bodyweight compounds |
| Diamond Push-Up | 120 | 35 | bodyweight compounds |
| Dip (Chest Emphasis) | 120 | 35 | bodyweight compounds |
| Dip (Triceps Emphasis) | 120 | 35 | bodyweight compounds |
| Dragon Flag | 60 | 30 | bodyweight isolations/accessories |
| Dumbbell Bench Press | 210 | 50 | dumbbell compounds |
| Dumbbell Curl | 75 | 30 | dumbbell isolations |
| Dumbbell Fly | 120 | 30 | dumbbell isolations |
| Dumbbell Front Raise | 120 | 30 | dumbbell isolations |
| Dumbbell Lateral Raise | 75 | 30 | dumbbell isolations |
| Dumbbell Overhead Press | 210 | 50 | dumbbell compounds |
| Dumbbell Pullover | 120 | 30 | dumbbell isolations |
| Dumbbell Rear Delt Fly | 75 | 30 | dumbbell isolations |
| Dumbbell Row | 120 | 50 | dumbbell compounds |
| Dumbbell Shrug | 120 | 30 | dumbbell isolations |
| EZ-Bar Curl | 90 | 25 | bodyweight isolations/accessories |
| Face Pull | 75 | 35 | cable movements |
| Farmer's Walk | 75 | 40 | bodyweight compounds |
| Front Squat | 180 | 75 | heavy barbell compounds |
| Glute Bridge | 120 | 50 | dumbbell compounds |
| Goblet Squat | 120 | 50 | dumbbell compounds |
| Good Morning | 120 | 55 | moderate barbell/trap movements |
| Hack Squat | 150 | 50 | machine compounds |
| Hammer Curl | 75 | 30 | dumbbell isolations |
| Hanging Knee Raise | 60 | 30 | bodyweight isolations/accessories |
| Hanging Leg Raise | 60 | 30 | bodyweight isolations/accessories |
| Hip Abduction Machine | 75 | 35 | machine isolations |
| Hip Adduction Machine | 75 | 35 | machine isolations |
| Incline Barbell Bench Press | 180 | 80 | heavy barbell compounds |
| Incline Dumbbell Bench Press | 210 | 55 | dumbbell compounds |
| Incline Dumbbell Curl | 75 | 35 | dumbbell isolations |
| Incline Dumbbell Fly | 120 | 35 | dumbbell isolations |
| Incline Machine Press | 120 | 55 | machine compounds |
| Inverted Row | 120 | 35 | bodyweight compounds |
| Landmine Press | 120 | 30 | bodyweight isolations/accessories |
| Landmine Rotation | 60 | 30 | bodyweight isolations/accessories |
| Lat Pulldown | 120 | 50 | machine compounds |
| Leg Extension | 90 | 35 | machine isolations |
| Leg Press | 120 | 50 | machine compounds |
| Leg Press Calf Raise | 75 | 35 | machine isolations |
| Low-to-High Cable Fly | 75 | 35 | cable movements |
| Lying Leg Curl | 90 | 40 | machine isolations |
| Lying Triceps Extension (Skull Crusher) | 120 | 35 | dumbbell isolations |
| Machine Chest Press | 120 | 50 | machine compounds |
| Machine Crunch | 60 | 35 | machine isolations |
| Machine Lateral Raise | 75 | 35 | machine isolations |
| Machine Shoulder Press | 120 | 50 | machine compounds |
| Meadows Row | 120 | 25 | bodyweight isolations/accessories |
| Neutral Grip Pull-Up | 210 | 35 | bodyweight compounds |
| Nordic Hamstring Curl | 120 | 25 | bodyweight isolations/accessories |
| One-Arm Dumbbell Row | 120 | 80 | dumbbell compounds |
| Overhead Cable Triceps Extension | 120 | 35 | cable movements |
| Overhead Carry | 90 | 40 | bodyweight compounds |
| Overhead Dumbbell Extension | 120 | 30 | dumbbell isolations |
| Pallof Press | 60 | 35 | cable movements |
| Pec Deck Machine | 75 | 35 | machine isolations |
| Pendlay Row | 150 | 75 | heavy barbell compounds |
| Plank | 60 | 25 | bodyweight isolations/accessories |
| Preacher Curl | 75 | 40 | machine isolations |
| Pull-Up | 210 | 35 | bodyweight compounds |
| Push-Up | 120 | 35 | bodyweight compounds |
| Reverse Crunch | 60 | 25 | bodyweight isolations/accessories |
| Reverse Curl | 75 | 55 | moderate barbell/trap movements |
| Reverse Hyperextension | 120 | 50 | machine compounds |
| Reverse Lunge | 120 | 75 | dumbbell compounds |
| Reverse Pec Deck | 75 | 35 | machine isolations |
| Reverse Wrist Curl | 60 | 30 | dumbbell isolations |
| RKC Plank | 60 | 25 | bodyweight isolations/accessories |
| Romanian Deadlift | 210 | 75 | heavy barbell compounds |
| Rope Triceps Pushdown | 75 | 35 | cable movements |
| Russian Twist | 60 | 30 | dumbbell isolations |
| Seated Barbell Overhead Press | 180 | 80 | heavy barbell compounds |
| Seated Cable Row | 120 | 50 | machine compounds |
| Seated Calf Raise | 75 | 40 | machine isolations |
| Seated Leg Curl | 90 | 40 | machine isolations |
| Side Plank | 60 | 25 | bodyweight isolations/accessories |
| Single-Leg Hip Thrust | 120 | 80 | dumbbell compounds |
| Sissy Squat | 120 | 35 | machine isolations |
| Sled Drag | 90 | 45 | machine compounds |
| Sled Pull | 90 | 45 | machine compounds |
| Sled Push | 90 | 45 | machine compounds |
| Spider Curl | 75 | 35 | dumbbell isolations |
| Standing Calf Raise | 75 | 35 | machine isolations |
| Stiff-Legged Deadlift | 120 | 75 | heavy barbell compounds |
| Straight-Arm Pulldown | 120 | 35 | cable movements |
| Suitcase Carry | 90 | 40 | bodyweight compounds |
| Sumo Deadlift | 210 | 85 | heavy barbell compounds |
| T-Bar Row | 150 | 75 | heavy barbell compounds |
| Trap Bar Deadlift | 210 | 75 | heavy barbell compounds |
| Walking Lunge | 120 | 75 | dumbbell compounds |
| Weighted Pull-Up | 210 | 55 | dumbbell compounds |
| Wood Chop | 60 | 35 | cable movements |
| Wrist Curl | 60 | 30 | dumbbell isolations |

