# Multi-Intent Selection Audit

Generated: 2026-02-12T18:04:22.905Z

## A1 - push

- Status: PASS
- Session summary: intent=push, exercises=5, estimatedMinutes=49.6, budgetRemaining=5.4

Selected exercises:

- Dumbbell Bench Press [main] - 5 sets - primary: Chest, Triceps
- Dumbbell Overhead Press [accessory] - 5 sets - primary: Front Delts, Triceps
- Cable Lateral Raise [accessory] - 5 sets - primary: Side Delts
- Overhead Cable Triceps Extension [accessory] - 2 sets - primary: Triceps
- Cable Front Raise [accessory] - 2 sets - primary: Front Delts

Validation checks:

- Intent scope: PASS (all selected exercises have in-scope primary muscles)
- No redundant same-primary-pattern pairs: PASS (no duplicate accessory pairs detected)
- Expected muscle coverage: PASS (all high-priority muscles covered)
- Time budget: PASS (49.6 min / 55 min)
- Exercise count: PASS (5 exercises)
- Set count range: PASS (all exercises within 2-5 sets)

## A2 - pull

- Status: PASS
- Session summary: intent=pull, exercises=6, estimatedMinutes=64.8, budgetRemaining=0.3

Selected exercises:

- Chin-Up [main] - 5 sets - primary: Lats, Biceps
- T-Bar Row [main] - 5 sets - primary: Lats, Upper Back
- Cable Rear Delt Fly [accessory] - 5 sets - primary: Rear Delts
- Bayesian Curl [accessory] - 4 sets - primary: Biceps
- Barbell Shrug [accessory] - 2 sets - primary: Upper Back
- Suitcase Carry [accessory] - 2 sets - primary: Core, Forearms

Validation checks:

- Intent scope: PASS (all selected exercises have in-scope primary muscles)
- No redundant same-primary-pattern pairs: PASS (no duplicate accessory pairs detected)
- Expected muscle coverage: PASS (all high-priority muscles covered)
- Time budget: PASS (64.8 min / 65 min)
- Exercise count: PASS (6 exercises)
- Set count range: PASS (all exercises within 2-5 sets)

## A3 - legs

- Status: PASS
- Session summary: intent=legs, exercises=5, estimatedMinutes=53.3, budgetRemaining=1.7

Selected exercises:

- Romanian Deadlift [main] - 5 sets - primary: Hamstrings, Glutes
- Bulgarian Split Squat [accessory] - 5 sets - primary: Quads, Glutes
- Seated Calf Raise [accessory] - 5 sets - primary: Calves
- Cable Crunch [accessory] - 2 sets - primary: Abs
- Cable Hip Abduction [accessory] - 2 sets - primary: Abductors

Validation checks:

- Intent scope: PASS (all selected exercises have in-scope primary muscles)
- No redundant same-primary-pattern pairs: PASS (no duplicate accessory pairs detected)
- Expected muscle coverage: PASS (all high-priority muscles covered)
- Time budget: PASS (53.3 min / 55 min)
- Exercise count: PASS (5 exercises)
- Set count range: PASS (all exercises within 2-5 sets)

## A4 - upper

- Status: PASS
- Session summary: intent=upper, exercises=6, estimatedMinutes=59.4, budgetRemaining=0.6

Selected exercises:

- Chin-Up [main] - 5 sets - primary: Lats, Biceps
- Dumbbell Bench Press [main] - 4 sets - primary: Chest, Triceps
- Chest-Supported Dumbbell Row [accessory] - 5 sets - primary: Lats, Upper Back
- Dumbbell Overhead Press [accessory] - 2 sets - primary: Front Delts, Triceps
- Cable Rear Delt Fly [accessory] - 3 sets - primary: Rear Delts
- Cable Lateral Raise [accessory] - 2 sets - primary: Side Delts

Validation checks:

- Intent scope: PASS (all selected exercises have in-scope primary muscles)
- No redundant same-primary-pattern pairs: PASS (no duplicate accessory pairs detected)
- Expected muscle coverage: PASS (missing=none; hasPush=true; hasPull=true)
- Time budget: PASS (59.4 min / 60 min)
- Exercise count: PASS (6 exercises)
- Set count range: PASS (all exercises within 2-5 sets)

## A5 - lower

- Status: PASS
- Session summary: intent=lower, exercises=6, estimatedMinutes=59.9, budgetRemaining=0.1

Selected exercises:

- Romanian Deadlift [main] - 4 sets - primary: Hamstrings, Glutes
- Hack Squat [main] - 5 sets - primary: Quads
- Seated Calf Raise [accessory] - 2 sets - primary: Calves
- Cable Hip Abduction [accessory] - 2 sets - primary: Abductors
- Bulgarian Split Squat [accessory] - 5 sets - primary: Quads, Glutes
- Seated Leg Curl [accessory] - 2 sets - primary: Hamstrings

Validation checks:

- Intent scope: PASS (all selected exercises have in-scope primary muscles)
- No redundant same-primary-pattern pairs: PASS (no duplicate accessory pairs detected)
- Expected muscle coverage: PASS (all high-priority muscles covered)
- Time budget: PASS (59.9 min / 60 min)
- Exercise count: PASS (6 exercises)
- Set count range: PASS (all exercises within 2-5 sets)

## A6 - full body

- Status: PASS
- Session summary: intent=full_body, exercises=5, estimatedMinutes=59.8, budgetRemaining=0.2

Selected exercises:

- Romanian Deadlift [main] - 4 sets - primary: Hamstrings, Glutes
- Chin-Up [main] - 4 sets - primary: Lats, Biceps
- Dumbbell Bench Press [main] - 5 sets - primary: Chest, Triceps
- Chest-Supported Dumbbell Row [accessory] - 4 sets - primary: Lats, Upper Back
- Cable Rear Delt Fly [accessory] - 2 sets - primary: Rear Delts

Validation checks:

- Intent scope: PASS (all selected exercises have in-scope primary muscles)
- No redundant same-primary-pattern pairs: PASS (no duplicate accessory pairs detected)
- Expected muscle coverage: PASS (pushCompound=true, pullCompound=true, lowerCompound=true)
- Time budget: PASS (59.8 min / 60 min)
- Exercise count: PASS (5 exercises)
- Set count range: PASS (all exercises within 2-5 sets)

## A7 - body part (chest, triceps)

- Status: PASS
- Session summary: intent=body_part, exercises=3, estimatedMinutes=22.7, budgetRemaining=32.3

Selected exercises:

- Dumbbell Bench Press [main] - 4 sets - primary: Chest, Triceps
- Dip (Chest Emphasis) [accessory] - 2 sets - primary: Chest, Triceps
- Overhead Cable Triceps Extension [accessory] - 2 sets - primary: Triceps

Validation checks:

- Intent scope: PASS (all selected exercises have in-scope primary muscles)
- No redundant same-primary-pattern pairs: PASS (no duplicate accessory pairs detected)
- Expected muscle coverage: PASS (all target muscles covered)
- Time budget: PASS (22.7 min / 55 min)
- Exercise count: PASS (3 exercises)
- Set count range: PASS (all exercises within 2-5 sets)

## A8 - body part (lats, biceps)

- Status: PASS
- Session summary: intent=body_part, exercises=3, estimatedMinutes=36.3, budgetRemaining=18.8

Selected exercises:

- Chin-Up [main] - 5 sets - primary: Lats, Biceps
- Chest-Supported Dumbbell Row [accessory] - 5 sets - primary: Lats, Upper Back
- Bayesian Curl [accessory] - 3 sets - primary: Biceps

Validation checks:

- Intent scope: PASS (all selected exercises have in-scope primary muscles)
- No redundant same-primary-pattern pairs: PASS (no duplicate accessory pairs detected)
- Expected muscle coverage: PASS (all target muscles covered)
- Time budget: PASS (36.3 min / 55 min)
- Exercise count: PASS (3 exercises)
- Set count range: PASS (all exercises within 2-5 sets)

## Aggregate

- Passed: 8/8
- Failed: 0/8

