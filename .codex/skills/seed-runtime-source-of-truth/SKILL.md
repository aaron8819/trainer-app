---
name: seed-runtime-source-of-truth
description: Protect Trainer accepted executable seed authority and runtime replay. Use for acceptance or correction of `MesocycleSeedRevision`, `currentSeedRevision`, seed parsing or serialization, runtime composition from an accepted seed, exact seed provenance, active reseed, or writes that could promote session-local deviations into plan truth. Do not trigger for generic V2 diagnostics, receipts, audits, or unrelated runtime work.
---

# Seed / Runtime Source of Truth

Keep accepted intent, immutable executable truth, runtime execution, and performed reality distinct.

## Authority

When an immutable revision exists:

- `Mesocycle.currentSeedRevision.seedPayload` is the accepted executable authority.
- The payload contains ordered `slotId -> exercises[{ exerciseId, role, setCount }]` composition.
- `Mesocycle.slotPlanSeedJson` is a compatibility or historical acceptance snapshot, not a competing runtime authority.
- Runtime and read models must prefer the current revision payload.

Compatibility fallback to `slotPlanSeedJson` is valid only for an explicitly supported legacy or no-revision record. A fallback does not create a second current truth and must not override an existing revision.

`acceptedPlannerIntent` may remain parseable compatibility or explanatory metadata. It is not immutable executable revision truth, is not part of runtime composition, and must not override `exerciseId`, `role`, or `setCount`.

A versioned `sessionCapacityReductionManifest` inside compatibility `slotPlanSeedJson.acceptedPlannerIntent` may validate an explicit session-local capacity transform. It remains explanatory metadata rather than executable revision rows, and it must not rewrite or compete with `currentSeedRevision.seedPayload`.

## Acceptance

Acceptance must:

1. validate and serialize the candidate through the canonical seed serializer
2. persist the compatibility snapshot only where the existing acceptance contract requires it
3. create immutable revision 1 from the accepted executable payload in the acceptance transaction
4. advance `currentSeedRevisionId`
5. keep diagnostic, lane, recommendation, and debug data outside executable revision truth

Failed or blocked acceptance must not write or claim accepted seed truth. Fallback must be explicit and must not be labeled as successful V2 acceptance.

## Revision correction

A correction:

- creates append-only revision N+1
- links the source revision
- advances the current pointer with optimistic concurrency
- never updates or deletes a prior revision
- does not rewrite `slotPlanSeedJson`
- affects future generation only

Already materialized workouts retain the exact revision they used.

## Runtime replay and provenance

Normal runtime seed replay:

- composes only from the current revision's `exerciseId`, `role`, and `setCount`
- preserves accepted slot order from the canonical slot sequence
- ignores planner intent and diagnostics
- stamps exact revision id, revision number, and payload hash into the session receipt and workout provenance
- fails closed where exact provenance is required

Legacy/no-revision fallback remains explicitly classified as compatibility behavior.

## Session-local deviations

An explicitly offered capacity-reduced structure is session-local offered truth. Swaps, added or removed exercises or sets, skipped work, partial sessions, and load/rep/RPE changes are performed/session-local reality unless an authorized acceptance or corrective-revision path promotes a new executable seed. Normal generation/save/log flows and future-generation or seed-carry-forward reconciliation directives must not mutate accepted revision truth.

## Required classification

Before editing, state:

- acceptance, correction, replay, provenance, or deviation boundary affected
- current-revision authority impact
- compatibility fallback impact
- executable payload shape impact
- persistence and migration risk
- consumers that must continue preferring the revision

Use `architecture-guard` when ownership crosses layers. Generate the deterministic verification plan with `.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef <authorized-base>` and interpret the resulting evidence against the claimed seed/runtime boundary; treat an unavailable required check as unresolved.

## Required assertions

Verify as relevant that:

- a current revision always wins over `slotPlanSeedJson`
- legitimate no-revision records retain compatibility behavior
- malformed explanatory metadata cannot change valid replay
- a capacity-reduction manifest can validate only the explicit session-local transform and never becomes executable seed rows
- base runtime seed composition consumes only `exerciseId`, `role`, and `setCount`
- corrections leave prior revisions and historical workouts unchanged
- session-local deviations do not mutate accepted truth
- exact provenance matches the consumed revision

## Exit criteria

Report the accepted authority, fallback status, payload-shape impact, correction/replay behavior, provenance result, and remaining risk.
