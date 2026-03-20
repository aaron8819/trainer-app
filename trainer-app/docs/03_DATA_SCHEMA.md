# 03 Data Schema

Owner: Aaron  
Last reviewed: 2026-03-19  
Purpose: Canonical data-model reference for runtime persistence used by workout generation, logging, templates, analytics, readiness, and periodization.

This doc covers:
- Primary Prisma models used by runtime
- Enums and persisted state contracts
- Schema-level invariants that impact behavior

Invariants:
- `prisma/schema.prisma` is canonical for all model and enum definitions.
- `Workout.status`, `Workout.selectionMode`, and `WorkoutExercise.section` must stay aligned with runtime contracts.
- `SetLog.workoutSetId` is unique, so set logging is one log record per set.
- Mesocycle handoff state, frozen handoff artifacts, editable next-cycle draft, accepted slot sequence, and accepted slot-plan seeds all persist on `Mesocycle`.

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
- Adaptive systems: `ReadinessSignal`, `ExerciseExposure`, `MacroCycle`, `Mesocycle`, `TrainingBlock`, `MesocycleExerciseRole`

## Runtime-critical enums
- `WorkoutStatus`: `PLANNED`, `IN_PROGRESS`, `PARTIAL`, `COMPLETED`, `SKIPPED`
- `WorkoutSelectionMode`: `AUTO`, `MANUAL`, `BONUS`, `INTENT`
- `WorkoutSessionIntent`: `PUSH`, `PULL`, `LEGS`, `UPPER`, `LOWER`, `FULL_BODY`, `BODY_PART`
- `WorkoutExerciseSection`: `WARMUP`, `MAIN`, `ACCESSORY`
- `MesocycleState`: `ACTIVE_ACCUMULATION`, `ACTIVE_DELOAD`, `AWAITING_HANDOFF`, `COMPLETED`

Canonical machine-readable values in `docs/contracts/runtime-contracts.json` currently cover the validation-backed workout enums above. `MesocycleState` remains schema-owned in `prisma/schema.prisma`.

## Behavioral schema notes
- Workout saves rewrite workout exercises/sets when exercise payload is supplied (`/api/workouts/save`).
- Set logging upserts by `workoutSetId` (`/api/logs/set`), making log state idempotent per set.
- Filtered/rejected intent exercises are persisted to `FilteredExercise` for later explainability rendering.
- `Constraints` now persists scheduling constraints as `daysPerWeek` and `splitType` (no `sessionMinutes` field) in `prisma/schema.prisma`, and is mapped into runtime constraints in `src/lib/api/workout-context.ts`.
- Workout rewrites are revision-guarded by `Workout.revision` in `prisma/schema.prisma` and route enforcement in `src/app/api/workouts/save/route.ts`.
- Structural workout mutations also advance that revision. Planned workout rewrites and add-exercise mutations both persist updated reconciliation state and increment `Workout.revision`.
- Exercise ordering is deterministic per workout via unique index `WorkoutExercise(workoutId, orderIndex)` in `prisma/schema.prisma` (materialized in baseline migration `prisma/migrations/20260222_baseline/migration.sql`).
- Workouts tied to a non-active mesocycle remain readable, but save/log/resume is fenced at the route/workflow layer when the parent mesocycle is `AWAITING_HANDOFF` or `COMPLETED` (`src/app/api/workouts/save/lifecycle-contract.ts`, `src/app/api/logs/set/route.ts`, `src/lib/workout-workflow.ts`).

## Mesocycle lifecycle fields
- `Mesocycle.state` (`MesocycleState`)
- `Mesocycle.accumulationSessionsCompleted`
- `Mesocycle.deloadSessionsCompleted`
- `Mesocycle.sessionsPerWeek`
- `Mesocycle.daysPerWeek`
- `Mesocycle.splitType`
- `Mesocycle.volumeRampConfig` (JSONB in Postgres)
- `Mesocycle.rirBandConfig` (JSONB in Postgres)
- `Mesocycle.closedAt`
- `Mesocycle.handoffSummaryJson`
- `Mesocycle.nextSeedDraftJson`
- `Mesocycle.slotSequenceJson`
- `Mesocycle.slotPlanSeedJson`

Lifecycle/handoff meanings:
- `AWAITING_HANDOFF` means the prior mesocycle is closed, reviewable, and no successor mesocycle has been created yet.
- `handoffSummaryJson` stores the frozen closeout snapshot: terminal lifecycle facts, final training structure, carry-forward recommendations, and the original recommended next-cycle seed.
- `nextSeedDraftJson` stores the mutable pending setup draft while the mesocycle is in `AWAITING_HANDOFF`. It is not editable once the mesocycle is archived as `COMPLETED`.
- `slotSequenceJson` stores the accepted ordered-flexible slot sequence on the successor mesocycle and is the canonical runtime authority for slot-aware sequencing.
- `slotPlanSeedJson` stores the accepted minimal slot-plan seeds on the successor mesocycle as ordered `slotId -> exercises[{ exerciseId, role }]` data derived from the canonical raw handoff slot-plan projection. It must align with persisted `slotSequenceJson` slot ids and is the canonical runtime composition source for seeded mesocycles until the user explicitly edits a generated workout.

## Training block fields
- `TrainingBlock.mesocycleId`
- `TrainingBlock.blockNumber`
- `TrainingBlock.blockType` (`BlockType`)
- `TrainingBlock.startWeek`
- `TrainingBlock.durationWeeks`
- `TrainingBlock.volumeTarget`
- `TrainingBlock.intensityBias`
- `TrainingBlock.adaptationType`
- These rows are now read directly by generation through `src/lib/api/generation-phase-block-context.ts`; they are no longer passive schema-only periodization metadata.

## Mesocycle exercise roles
- `MesocycleExerciseRole.mesocycleId`
- `MesocycleExerciseRole.exerciseId`
- `MesocycleExerciseRole.sessionIntent`
- `MesocycleExerciseRole.role` (`MesocycleExerciseRoleType`)
- `MesocycleExerciseRole.addedInWeek`
- `MesocycleExerciseRole` remains the fallback/projection continuity registry: unseeded runtime composition, explicit continuity metadata, and successor slot-plan projection may still read it, but accepted seeded supported runtime composition is owned by `Mesocycle.slotPlanSeedJson`, not these rows.

## Workout mesocycle snapshots
- `Workout.trainingBlockId`
- `Workout.weekInBlock`
- `Workout.mesocycleId`
- `Workout.mesocycleWeekSnapshot`
- `Workout.mesocyclePhaseSnapshot`
- `Workout.mesoSessionSnapshot`
- `trainingBlockId` / `weekInBlock` remain compatibility-oriented persisted context on the workout row; the canonical generation-time phase/block context is assembled from active `MacroCycle -> Mesocycle -> TrainingBlock` rows and stamped into `selectionMetadata.sessionDecisionReceipt.cycleContext`.
- Slot-aware runtime identity is persisted alongside those snapshots in `Workout.selectionMetadata.sessionDecisionReceipt.sessionSlot`. That receipt snapshot carries `slotId`, `intent`, `sequenceIndex`, and `source` for the generated session.

## Compatibility-only workout fields
- `Workout.wasAutoregulated`
- `Workout.autoregulationLog`
- These fields are retained in the schema for backward compatibility and historical inspection only.
- Active runtime session-decision state is persisted under `Workout.selectionMetadata.sessionDecisionReceipt`, and `POST /api/workouts/save` no longer accepts these compatibility fields as write inputs.
- Canonical mutation reconciliation state is persisted alongside the receipt under `Workout.selectionMetadata.workoutStructureState`. That record stores:
  - current saved structure summary
  - generated-vs-saved reconciliation
  - reconciliation timestamp
- `selectionMetadata.sessionDecisionReceipt` remains the original generated/evidence payload even after mutation; `workoutStructureState` is the saved-structure companion record rather than a receipt replacement.
- Optional-session semantics are receipt-driven, not enum-driven. Supplemental deficit sessions and optional gap-fill sessions do not add new database enums; they are represented by canonical `selectionMetadata.sessionDecisionReceipt.exceptions` markers plus persisted `Workout.selectionMode`, `Workout.sessionIntent`, and `Workout.advancesSplit`.
- Read-side consumers now centralize that interpretation in `src/lib/session-semantics/derive-session-semantics.ts`; no persisted `sessionKind` column or enum has been added.
- Next-cycle carry-forward compatibility is draft-validated rather than schema-enforced: if split/session edits remove a slot intent, `keep` selections for that prior intent are rejected before acceptance (`src/lib/api/mesocycle-handoff.ts`).
