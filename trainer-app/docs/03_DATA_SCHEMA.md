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
- Mesocycle handoff state, frozen handoff artifacts, editable next-cycle draft, and accepted slot sequence persist on `Mesocycle`; immutable accepted executable seeds persist as `MesocycleSeedRevision` rows selected by `Mesocycle.currentSeedRevisionId`.

Sources of truth:
- `trainer-app/prisma/schema.prisma`
- `trainer-app/prisma/migrations`
- `trainer-app/src/lib/api/workout-context.ts`
- `trainer-app/src/app/api/workouts/save/route.ts`
- `trainer-app/src/app/api/logs/set/route.ts`

## Core runtime models
- User context: `User`, `Profile`, `Goals`, `Constraints`, `Injury`, `UserPreference`
- Workout execution: `Workout`, `WorkoutExercise`, `WorkoutSet`, `SetLog`, `FilteredExercise`
- Catalog/template: `Exercise`, `Muscle`, `Equipment`, `WorkoutTemplate`, `WorkoutTemplateExercise`
- Adaptive systems: `ReadinessSignal`, `PreSessionReadinessSnapshot`, `MacroCycle`, `Mesocycle`, `MesocycleSeedRevision`, `TrainingBlock`, `MesocycleExerciseRole`

## Runtime-critical enums
- `WorkoutStatus`: `PLANNED`, `IN_PROGRESS`, `PARTIAL`, `COMPLETED`, `SKIPPED`
- `WorkoutSelectionMode`: `AUTO`, `MANUAL`, `BONUS`, `INTENT`
- `WorkoutSessionIntent`: `PUSH`, `PULL`, `LEGS`, `UPPER`, `LOWER`, `FULL_BODY`, `BODY_PART`
- `WorkoutExerciseSection`: `WARMUP`, `MAIN`, `ACCESSORY`
- `SetIntent`: `WORK`, `WARMUP`
- `MesocycleState`: `ACTIVE_ACCUMULATION`, `ACTIVE_DELOAD`, `AWAITING_HANDOFF`, `COMPLETED`

Canonical machine-readable values in `docs/contracts/runtime-contracts.json` currently cover the validation-backed workout enums above. `SetIntent` and `MesocycleState` remain schema-owned in `prisma/schema.prisma`.

## Behavioral schema notes
- `Muscle` is shared catalog identity and relationship metadata. Its `mv`, `mev`, `mav`, `mrv`, and `sraHours` columns are materialized compatibility copies derived by `prisma/muscle-seed-data.ts` from the canonical code policy in `src/lib/engine/muscle-policy.ts`; runtime generation, recovery, selection, analytics, and explainability do not treat those columns as policy overrides.
- There is no current API, UI, or per-user persistence contract for muscle-policy customization. A future override feature must use a separate user-owned model and an explicit canonical resolution seam rather than mutating shared `Muscle` rows.
- Workout saves rewrite workout exercises/sets when exercise payload is supplied (`/api/workouts/save`).
- Set logging upserts by `workoutSetId` (`/api/logs/set`), making log state idempotent per set.
- `SetLog.setIntent` persists performed-set intent. `WORK` is the default for old rows and omitted payloads; `WARMUP` marks a logged warmup/ramp set that remains visible as performed reality but is excluded from work-set evidence, progression/next-exposure anchors, prescription calibration, and weekly/effective volume. There is no automatic historical reclassification.
- Performed `WorkoutExercise`/`SetLog` history keyed by `Exercise.id` is authoritative for exercise rotation and freshness. `LegacyExerciseExposure` maps the old physical `ExerciseExposure` table as `@@ignore` for read-only rollout comparison only; it has no generated Prisma client API, no production reader or writer, and its name-keyed counts and averages are untrusted. The transitional migration intentionally retains its data for a later explicit drop.
- Filtered/rejected intent exercises are persisted to `FilteredExercise` for later explainability rendering.
- `Constraints` now persists scheduling constraints as `daysPerWeek` and `splitType` (no `sessionMinutes` field) in `prisma/schema.prisma`, and is mapped into runtime constraints in `src/lib/api/workout-context.ts`.
- Existing-workout saves are guarded atomically by `Workout.revision`: `persistWorkoutRow()` updates only `{ id, userId, revision: expectedRevision }` and increments the revision in that same `updateMany` statement. A failed predicate performs no child, receipt/reconciliation, filtered-exercise, completion, or lifecycle mutation.
- New workouts start at revision `1`. Every accepted `POST /api/workouts/save` mutation of an existing workout consumes exactly one expected revision and returns exactly one incremented revision, including status/completion and no-op-equivalent saves. The compare-and-swap is the first mutation in the transaction, so later failures roll back the revision and all related writes together.
- Structural and performed-state mutations outside the save route use `executeWorkoutMutation()`: add/remove/swap exercise, add set, persisted warmup creation, set log/skip/unskip/delete, workout deletion, and closeout dismissal consume the caller's expected revision and return the authoritative next revision. The claim, child rows, status updates, and runtime-edit reconciliation commit or roll back together.
- A successful revision change makes readiness evidence keyed to the prior workout revision ineligible without route-local invalidation mirrors. Failed or stale mutations leave both workout state and prior readiness identity unchanged.
- Exercise ordering is deterministic per workout via unique index `WorkoutExercise(workoutId, orderIndex)` in `prisma/schema.prisma` (materialized in baseline migration `prisma/migrations/20260222_baseline/migration.sql`).
- Workouts tied to a non-active mesocycle remain readable, but save/log/resume is fenced at the route/workflow layer when the parent mesocycle is `AWAITING_HANDOFF` or `COMPLETED` (`src/app/api/workouts/save/lifecycle-contract.ts`, `src/app/api/logs/set/route.ts`, `src/lib/workout-workflow.ts`).
- `SessionCheckIn` remains in `prisma/schema.prisma` as historical/compatibility persistence only. Current readiness writes and reads use `ReadinessSignal` through `src/app/api/readiness/submit/route.ts` and `src/lib/api/readiness.ts`.
- `PreSessionReadinessSnapshot` is immutable readiness evidence for one versioned exact session identity. Exact rows persist `identityJson`, `identityHash`, `targetHash`, `payloadHash`, readiness/projection fingerprints, and applicable workout/seed revision evidence. `invalidatedAt IS NULL` defines active lifecycle state. Migration `20260714210000_make_pre_session_readiness_snapshots_atomic` adds database checks plus PostgreSQL partial unique indexes for at most one active exact row per owner/identity and per owner/logical target. Existing rows remain `LEGACY_UNKNOWN` with null exact hashes; the migration does not fabricate historical identity and current product reads do not treat legacy rows as exact.
- `src/lib/api/pre-session-readiness-producer.ts` completes and validates the contract before mutation. `src/lib/api/pre-session-readiness-snapshot.ts` revalidates mutable evidence and performs supersession plus insertion in one `ReadCommitted` transaction; the decisive statement observes evidence committed before that revalidation completes, while partial unique indexes select the concurrent active-row winner. Equivalent identity/payload retries reuse the existing row; same-identity/different-payload preparation fails as an integrity conflict; failed replacement rolls back the prior invalidation. Consumers derive current identity and query the active exact hash rather than ordering by `createdAt`.

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
- `Mesocycle.currentSeedRevisionId`

Lifecycle/handoff meanings:
- `AWAITING_HANDOFF` means the prior mesocycle is closed, reviewable, and no successor mesocycle has been created yet.
- `handoffSummaryJson` stores the frozen closeout snapshot: terminal lifecycle facts, final training structure, carry-forward recommendations, and the original recommended next-cycle seed.
- The frozen handoff recommendation is explainability-bearing data, not a UI-local recomputation target. `recommendedDesign` now persists branch-owned structure explainability (`structureReasonCodes` plus `structureSignalQuality`) and each carry-forward recommendation persists the canonical returned `reasonCodes` plus `signalQuality` from the genesis policy seam.
- `nextSeedDraftJson` stores the mutable pending setup draft while the mesocycle is in `AWAITING_HANDOFF`. It is not editable once the mesocycle is archived as `COMPLETED`. An explicit guarded V2 draft refresh may add `acceptedSeedDraft` while still in `AWAITING_HANDOFF`; that object records `source=v2_materialized_seed`, compact production-eligibility provenance, and a parser-compatible minimal seed candidate. It is draft candidate truth only until accept creates the successor's immutable revision 1 in the same transaction.
- `slotSequenceJson` stores the accepted ordered-flexible slot sequence on the successor mesocycle and is the canonical runtime authority for slot-aware sequencing. Each persisted slot may now carry authored slot semantics alongside placement using the additive contract fields `slotArchetype`, `primaryLaneContract`, `supportCoverageContract`, and `continuityScope`.
- `MesocycleSeedRevision.seedPayload` stores the accepted minimal executable slot plan as ordered `slotId -> exercises[{ exerciseId, role, setCount }]`. `Mesocycle.currentSeedRevisionId` selects the runtime authority when present. Revision rows are append-only, uniquely numbered per mesocycle, hash the normalized executable payload with SHA-256, and link corrections through `sourceRevisionId`; a database trigger rejects updates and deletes. `slotPlanSeedJson` remains a transitional acceptance/legacy compatibility snapshot and is not rewritten by corrections or consumed when a current revision exists. Migration `20260713180000_add_immutable_mesocycle_seed_revisions` leaves the completed identity-only mesocycle `12079700-5333-4ffc-9cbd-bb303588f288` without a revision because its historical set intent is unresolved; compatibility readers retain its existing snapshot and do not reinterpret it as an executable set prescription. Planner diagnostics, lane ids, accepted intent, and provenance sidecars are excluded from the executable hash and runtime replay.
- `Workout.seedRevisionId`, `Workout.seedRevisionNumber`, and `Workout.seedPayloadHash` preserve the exact accepted seed revision used to materialize the workout. The same tuple is stored in `selectionMetadata.sessionDecisionReceipt.sessionProvenance.seedProvenance`. Exact tuples are immutable on resume/update; legacy workouts remain readable with null fields and are reported as `legacy_unknown` rather than assigned fabricated provenance.

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
- Session-level generation provenance is persisted in `Workout.selectionMetadata.sessionDecisionReceipt.sessionProvenance`. The durable shape is `mesocycleId?: string | null`, `compositionSource?: "persisted_slot_plan_seed" | "runtime_selection" | "deload_seed_replay" | "legacy_fallback" | "unknown"`, and exact seeded runs add `seedProvenance?: { revisionId, revision, hash }`; audit execution paths such as `generationPath` remain audit artifacts rather than receipt fields.

## Compatibility-only workout fields
- `Workout.wasAutoregulated`
- `Workout.autoregulationLog`
- These fields are retained in the schema for backward compatibility and historical inspection only.
- Active runtime session-decision state is persisted under `Workout.selectionMetadata.sessionDecisionReceipt`, and `POST /api/workouts/save` no longer accepts these compatibility fields as write inputs.
- Canonical mutation reconciliation state is persisted alongside the receipt under two additive fields:
  - `Workout.selectionMetadata.workoutStructureState`
  - `Workout.selectionMetadata.runtimeEditReconciliation`
- `workoutStructureState` stores:
  - current saved structure summary
  - generated-vs-saved reconciliation
  - reconciliation timestamp
- `runtimeEditReconciliation` stores:
  - `version`
  - `lastReconciledAt`
  - `ops[]` with v1 kinds `add_exercise`, `add_set`, `remove_exercise`, `replace_exercise`, `rewrite_structure`
  - `remove_exercise` facts keep the runtime-added `workoutExerciseId`, `exerciseId`, `orderIndex`, `section`, and removed `setCount` after the unlogged current-session row is deleted
  - `replace_exercise` facts keep `workoutExerciseId`, original/replacement exercise ids, original/replacement names, the route-known reason, and `setCount`
  - conservative directives `{ continuityAlias: "none", progressionAlias: "none", futureSessionGeneration: "ignore", futureSeedCarryForward: "ignore" }`
- `selectionMetadata.sessionDecisionReceipt` remains the original generated/evidence payload even after mutation; `workoutStructureState` and `runtimeEditReconciliation` are additive companion records rather than receipt replacements.
- Runtime swaps do not create a second workout row or an extra-exercise record. The canonical execution shape is an in-place `WorkoutExercise.exerciseId` replacement plus the persisted `replace_exercise` ledger fact above, which keeps slot/session identity stable while preserving auditability of the original programmed exercise.
- Optional-session semantics are receipt-driven, not enum-driven. Supplemental deficit sessions, optional gap-fill sessions, and closeout sessions do not add new database enums; they are represented by canonical `selectionMetadata.sessionDecisionReceipt.exceptions` markers plus persisted `Workout.selectionMode`, `Workout.sessionIntent`, `Workout.advancesSplit`, and additive metadata such as `selectionMetadata.weekCloseId` when applicable.
- Closeout dismissal is also additive metadata: `selectionMetadata.closeoutDismissed=true` with `selectionMetadata.closeoutDismissedAt` hides an optional planned closeout without changing `Workout.status`, deleting the row, mutating slot plans, or rewriting the session-decision receipt.
- Read-side consumers now centralize that interpretation in `src/lib/session-semantics/derive-session-semantics.ts`; no persisted `sessionKind` column or enum has been added.
- Closeout persistence stays slotless by contract: `selectionMetadata.sessionDecisionReceipt.sessionSlot` must be absent on closeout workouts, and write-side helpers strip that slot snapshot rather than introducing a separate closeout slot mirror.
- Next-cycle carry-forward compatibility is draft-validated rather than schema-enforced: if split/session edits remove a slot intent, `keep` selections for that prior intent are rejected before acceptance (`src/lib/api/mesocycle-handoff.ts`).

## Immutable post-session review snapshots

`PostSessionReviewSnapshot` is an optional one-to-one child of `Workout`. New `COMPLETED` transitions create one `exact` row in the same transaction as completion and lifecycle effects. Legacy completed workouts may remain without a row; controlled backfills create `legacy_derived` rows and never claim historical exactness.

The row stores the semantic `PostSessionReviewContract` payload, `contractVersion`, independent `computationPolicyVersion`, SHA-256 payload hash, deterministic workout-evidence fingerprint, provenance, and finalization time. The database rejects application `UPDATE` and `DELETE` operations through an immutability trigger, and the parent foreign key restricts workout deletion while historical review evidence exists. Administrative destruction therefore requires a deliberate trigger/constraint-aware operation outside supported application paths.

Contract version changes when the persisted semantic JSON shape or parser contract changes. Computation-policy version changes when interpretation rules can change conclusions without changing JSON shape. Display-only formatting, CSS, and copy changes outside the semantic contract require neither bump.

The evidence fingerprint covers workout identity/status/revision, persisted session metadata and receipt, seed revision provenance fields, ordered workout exercises/sets, target prescription, latest set logs and set intent, and frozen stimulus-accounting snapshots. It excludes catalog display names, current policy tables, mutable current mesocycle state, and UI formatting.

## `WorkoutExercise.stimulusAccountingSnapshot`

- Nullable JSONB, added additively for rollout compatibility.
- Version 1 fields: `version`, `sourceExerciseId`, sorted `contributions`, sorted `relationships`, `policyHash`, and `provenance` (`exact` or `legacy_derived`).
- `policyHash` covers the version, normalized contribution vector, and relationships. It does not depend on mutable display names.
- New application-created rows must persist an `exact` snapshot. Legacy backfill writes only null rows and never changes set logs, workout totals, stimulus fractions, landmarks, or accepted seed shape.
- Persisted incomplete-workout projection accepts only a present, valid snapshot whose `sourceExerciseId` matches the current persisted `WorkoutExercise.exerciseId`, with supported runtime add/swap/remove attribution verified from the persisted edit ledger. It never derives a missing or invalid vector from the current exercise catalog.
- The projection loader reads incomplete workouts before completed weekly volume and excludes those workout ids from the subsequent performed query. This is query-level read isolation rather than a database transaction snapshot: it prevents double counting if a workout transitions to `PARTIAL` between reads, while log writes after the incomplete query are intentionally reflected only on the next report load.
