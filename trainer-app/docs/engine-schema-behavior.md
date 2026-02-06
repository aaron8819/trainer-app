# Engine Schema and Behavior Reference

This document summarizes the new schema fields and engine behavior introduced in the refactor.

## Schema Changes (Summary)

### Exercise (extended)
- `splitTags` (SplitTag[]) : strict split eligibility (PUSH, PULL, LEGS, CORE, MOBILITY, PREHAB, CONDITIONING)
- `movementPatternsV2` (MovementPatternV2[]) : programming intelligence (horizontal/vertical patterns)
- `isMainLiftEligible` (boolean) : replaces legacy `isMainLift` for main lift selection
- `isCompound` (boolean)
- `fatigueCost` (int 1-5)
- `stimulusBias` (StimulusBias[])
- `contraindications` (jsonb)
- `timePerSetSec` (int)

### ExerciseAlias (new)
- `exerciseId` -> `Exercise.id`
- `alias` (unique)

### Baseline (extended)
- `exerciseId` (nullable FK) : primary linkage for baseline resolution (name/alias only as fallback)

### ExerciseVariation (extended)
- `variationType` (VariationType)
- `metadata` (jsonb)

### Constraints (extended)
- `availableEquipment` (EquipmentType[])

### SessionCheckIn (new)
- `readiness` (1-5)
- `painFlags` (jsonb)
- `date`, `notes`, `workoutId`

### SubstitutionRule (extended)
- `priority` (int)
- `constraints` (jsonb)
- `preserves` (jsonb)

## Engine Behavior (Summary)

### Split purity
- Exercises are filtered by `splitTags` first.
- Any exercise tagged both `PUSH` and `PULL` is invalid and must be reclassified.
- `CORE`, `MOBILITY`, `PREHAB`, `CONDITIONING` are only included via explicit template blocks.
- PPL split queues advance perpetually by the pattern length (not by daysPerWeek).

### PPL main lift pairing
- Push: 1 horizontal + 1 vertical press.
- Pull: 1 vertical pull + 1 horizontal row.
- Legs: 1 squat + 1 hinge.
### PPL accessories
- Accessories use slot-based selection driven by primaryMuscles and stimulusBias.
- Fill slots favor uncovered muscles relative to main lifts and prior accessories.
- Recency weighting and seeded randomness add variety; recent exercises are deprioritized.

### Timeboxing
- `timePerSetSec` and `sessionMinutes` drive trimming; accessories are dropped first.
- Rest periods scale by exercise type (compound accessories get more rest).
- Timeboxing trims lowest-priority accessories first (fatigue/coverage-based).
- Warmup sets are included in estimated time and can trigger additional trimming.

### Readiness and pain
- Readiness 1-2 reduces volume and caps RPE.
- Pain flags filter out contraindicated exercises (seeded per exercise) and trigger joint-friendly substitutions.

### Progression guardrails
- Double progression with RPE guardrails.
- Load changes capped at 7% per step.
- Stalled exercises (3 exposures without improvement) are deprioritized.
- Rep ranges are role-specific (main vs accessory).
- Main lifts use a top set + back-off structure; back-off loads are derived from set 1.
- Main lifts can include `warmupSets` (ramp-up sets) when a top-set load is resolved.
- Periodization modifiers adjust RPE and set counts by week-in-block, with deload weeks using uniform sets and lighter back-offs.

### Volume caps
- Rolling 7-day window per muscle group.
- >20% increase vs the previous 7-day window will trim accessories.
- Accessory slot selection now deprioritizes candidates that would exceed the 20% cap.

## Migration Utilities
- `trainer-app/scripts/migrate-exercises.ts` performs:
  - dedupe and alias creation
  - splitTag and movementPatternsV2 tagging
  - canonical rename handling

## Notes
- Muscle volume caps depend on `Exercise.primaryMuscles` data being seeded. `seed.ts` now includes full ExerciseMuscle mappings for known exercises.
- Substitution suggestions exist in engine helper `suggestSubstitutes` but are not yet shown in UI.
