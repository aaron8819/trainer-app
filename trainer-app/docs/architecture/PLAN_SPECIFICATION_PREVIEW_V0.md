# PlanSpecificationPreviewV0 compiler proof

Status: read-only bounded proof
Decision: `PROVEN WITH LIMITATIONS`

## What the proof establishes

`src/lib/engine/plan-specification-preview-v0.ts` owns a strict, non-persisted V0 semantic contract and a pure compiler. The compiler adapts V0 through the existing `HypertrophyPlanDraftV1` construction path, then uses `compileAcceptedHypertrophySeed()` and `projectExecutableSeed()` to produce the current executable version-1 seed shape:

```text
slotId -> exercises[{ exerciseId, role, setCount }]
```

`src/lib/api/plan-specification-preview-v0.ts` is read-only orchestration. It validates exercise IDs against supplied catalog context, runs the existing accepted-seed normalizer, and evaluates the existing hypertrophy Plan Health rules through an exact V0-to-draft adapter. It has no database dependency or acceptance, activation, materialization, or runtime entry point.

The proof fixture is a deterministic four-day Upper 1 / Lower 1 / Upper 2 / Lower 2 plan using fixture-stable identifiers for checked-in catalog movements: Barbell Back Squat, Pull-Up, Chest-Supported T-Bar Row, Cable Crunch, Lying Leg Curl, and Bulgarian Split Squat. It does not depend on production data.

## Current-state findings

1. `Mesocycle.currentSeedRevision.seedPayload` is accepted executable authority when a revision exists. Version 1 carries ordered exercise ID, executable role, and set count. Version 2 custom hypertrophy seeds additionally retain accepted settings and minimal intent, while runtime consumes their version-1 executable projection.
2. `normalizeAcceptedSeedPayload()` plus `parseSlotPlanSeedJson()` own accepted payload normalization and validation. Only the existing transactional acceptance helpers create immutable revisions and advance `currentSeedRevisionId`.
3. Custom hypertrophy make-ready validates `HypertrophyPlanDraftV1` and Plan Health, compiles `AcceptedHypertrophySeedV2`, derives compatibility projections, creates revision 1, and consumes the draft atomically.
4. Generated Strength builds a version-1 slot seed during plan creation and finalization promotes it to a revision. Generated Hypertrophy remains runtime-selected unless a later accepted handoff supplies a seed. Workout templates do not author plan seeds; runtime may overlay an already accepted seed while materializing a session.
5. Existing Plan Health consumes a custom hypertrophy draft, normalized catalog rows, and limitation keys. It produces structural/catalog/equipment/semantic blockers plus coverage, frequency, redundancy, and duration warnings without writing.
6. `next-session.ts` prefers `currentSeedRevision.seedPayload`; template-session composition and deload replay consume the captured accepted seed. `slotPlanSeedJson` is only the explicit legacy/no-revision compatibility path.
7. Executable meaning in the current contract is slot order plus `exerciseId`, `role`, and `setCount`. Source labels, accepted planner intent, diagnostics, names, settings, priorities, continuity, and rationale are provenance or explanatory meaning. Rep targets, progression, measurement, and layer execution are absent rather than inferred.
8. The existing custom draft compiler/projection is reusable without writes. V0 delegates to it instead of creating another seed constructor.

## Exact V0 fields

- `version: 0`
- metadata excluded from semantic canonical bytes and executable output:
  - normalized `planName`
  - `authoringSource: "USER_AUTHORED"`
- `primaryGoal: "HYPERTROPHY"`
- existing Plan Health constraints:
  - `equipmentProfile`
  - `sessionDurationMinutes`
- fixed phase intent:
  - `accumulationWeeks: 4`
  - `deloadWeeks: 1`
- one to five ranked priorities:
  - `priorityId`, contiguous `rank`, `kind`, `targetId`, `objective`
- exactly four ordered sessions:
  - `slotId`, normalized `name`, current hypertrophy `focus`, ordered `placements`
- each placement:
  - globally unique `candidatePlacementId`
  - catalog-context `exerciseId`
  - `layer: "PROGRAMMED_WORK"`
  - `prominence: "PRIMARY" | "SECONDARY" | "ACCESSORY"`
  - `continuity: "ANCHOR" | "FLEXIBLE"` (the only input default is `FLEXIBLE`)
  - explicit `priorityIds`
  - integer `setCount` from 1 through 10
  - current accepted movement-pattern or muscle `target`
  - optional existing bounded `requiredExerciseClass`

Unknown fields are rejected. This is how rep ranges, progression, measurement, extra layers, and other future concepts fail visibly instead of being discarded.

## Deterministic boundary

For identical normalized semantic input and catalog context:

- canonical semantic JSON and its SHA-256 hash are identical;
- ordered sessions and placements are preserved;
- the compiled executable seed and existing accepted-seed hash are identical;
- plan name and authoring source are metadata and do not enter semantic canonical bytes or executable rows;
- priorities, continuity, names, constraints, phase intent, and targets remain review/validation semantics and do not alter current version-1 executable rows;
- changing `exerciseId`, prominence, order, or `setCount` changes the executable projection deterministically.

There are no timestamps, generated IDs, locale-sensitive operations, randomness, environment defaults, or persistence envelopes in this boundary.

## Run and interpret the preview

From `trainer-app/`:

```powershell
npm run preview:plan-specification-v0
```

The JSON output includes source and normalized specifications, canonical semantic bytes/hash, compiler version/defaults, specification findings, the compiled version-1 seed, accepted-seed validation/hash, existing Plan Health findings, explicit unsupported/deferred concepts, and read-only isolation facts. A specification or seed validation failure exits nonzero. Plan Health warnings are reported but do not mutate or accept anything.

## What the proof does not establish

V0 does not persist a plan specification, create a revision, accept or activate a plan, materialize a workout, alter runtime selection, add a fallback, or represent preparation, optional closeout, rep targets, progression execution, measurement profiles, fixed weekdays, conditioning, cross-block lineage, or generalized goals. Removing the proof modules and CLI would leave all execution behavior unchanged.

## Decision gate

`PROVEN WITH LIMITATIONS`: a bounded semantic plan can compile faithfully into the complete current executable composition contract, and runtime authority remains accepted-seed-only. Persistence should not proceed yet because the current seed cannot carry layers, rep/measurement meaning, or progression policy. The next smallest slice is the reviewed bounded execution-distinct catalog subset, followed by measurement-aware execution; only then should a persistent public specification and a correspondingly complete versioned seed contract be frozen.
