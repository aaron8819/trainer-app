# PlanSpecificationPreviewV0 compiler proof

Status: read-only bounded proof
Decision: `PROVEN WITH LIMITATIONS`

## What was proven

`src/lib/engine/plan-specification-preview-v0.ts` owns a strict, non-persisted
input parser and pure compiler for the complete current version-1 executable
seed shape:

```text
ordered slots -> ordered exercises[{ exerciseId, role, setCount }]
```

The proof validates stable exercise IDs against supplied read-only catalog
context, preserves row order and executable values exactly, delegates v1 row
projection to the same pure projection core used by custom hypertrophy
acceptance, and passes the result through `normalizeAcceptedSeedPayload()`.
Previewing does not persist, accept, activate, schedule, or materialize anything.
Runtime remains unaware of V0 and continues to prefer the immutable current
`MesocycleSeedRevision.seedPayload`.

## Exact V0 contract

```ts
type PlanSpecificationPreviewV0 = {
  version: 0;
  slots: Array<{
    slotId: string;
    exercises: Array<{
      exerciseId: string;
      role: "CORE_COMPOUND" | "ACCESSORY";
      setCount: positiveInteger;
    }>;
  }>;
};
```

The parser is strict at every object boundary. It trims identifier whitespace,
applies no semantic defaults, requires at least one nonempty slot, and requires
unique slot IDs. The four-day fixture is representative evidence, not a schema
requirement.

### Retained-field classification

| Field or context | Classification | Repository evidence and reason |
| --- | --- | --- |
| `version: 0` | `REQUIRED FOR VALIDATION` | Selects the strict internal V0 parser and rejects other shapes. It does not enter the compiled v1 payload. |
| ordered `slots` | `REQUIRED FOR EXECUTION` | `parseSlotPlanSeedJson()` and template-session seed replay consume ordered slots. |
| `slotId` | `REQUIRED FOR EXECUTION` | Runtime resolves the scheduled slot against the accepted seed by `slotId` in `next-session.ts` and template-session seed handling. |
| ordered `exercises` | `REQUIRED FOR EXECUTION` | The seed parser and template-session materializer preserve this order. |
| `exerciseId` | `REQUIRED FOR EXECUTION` | Runtime selects the exact stable catalog identity from each accepted seed row. Supplied catalog IDs validate the reference before compilation. |
| `role` | `REQUIRED FOR EXECUTION` | The accepted parser permits only `CORE_COMPOUND` or `ACCESSORY`; template-session context maps those values to main/accessory behavior and role budgeting. |
| `setCount` | `REQUIRED FOR EXECUTION` | `normalizeAcceptedSeedPayload()` requires an explicit positive integer and runtime uses it for set-count overrides and exact replay. |
| compiler version in preview output | `REQUIRED PROVENANCE` | Identifies the non-persisted compiler result without becoming seed input or runtime truth. |
| supplied catalog ID set | `PREVIEW-ONLY BUT JUSTIFIED` | Rejects an exercise ID that is not in the supplied catalog context. It is validation context, excluded from the projection and hash. |

There are no retained authoring or planning metadata fields.

## Scope correction

The reviewed commit exposed a larger schema whose non-executable fields changed
a broadly named semantic hash. Repository tracing showed that the extra fields
were not required to produce or validate the version-1 seed. They were removed
instead of being preserved as a future fixture format.

| Removed concept | Executable effect | Validation/compiler effect | Decision |
| --- | --- | --- | --- |
| ranked priorities and priority links | None | None in accepted-seed validation or current projection | `DEFER`; hashing them did not establish executable fidelity. |
| placement prominence | Only `PRIMARY` was approximated to `CORE_COMPOUND`; two other values collapsed to `ACCESSORY` | Required an extra mapping not present in v1 | `REMOVE`; accept the exact executable role instead. |
| anchor/flexible continuity | None | None | `DEFER`; retaining it would freeze unsettled lineage/continuity meaning. |
| phase intent | None | The custom acceptance transaction creates four accumulation weeks plus one deload; the seed compiler does not | `REMOVE`; lifecycle construction is outside this proof. |
| accepted target | None in v1 rows | Required only by the richer custom accepted-v2/draft and Plan Health path | `REMOVE`; no proof value after exact executable roles are input. |
| exercise-class constraint | None in v1 rows | Required only by custom intent eligibility and Plan Health | `REMOVE`; it cannot be represented faithfully by v1. |
| equipment constraint | None | Used by custom Plan Health, not accepted v1 validation | `REMOVE`. |
| duration constraint | None | Used by custom Plan Health, not accepted v1 validation | `REMOVE`. |
| accumulation/deload structure | None | Created by acceptance/lifecycle code, not compilation | `REMOVE`. |
| plan name | None | Dropped before projection | `REMOVE`. |
| authoring source | None | Did not select behavior because V0 supports one direct v1 projection | `REMOVE`. |
| primary goal | None | Did not select behavior because V0 supports one direct v1 projection | `REMOVE`. |
| session name and focus | None | Required only to fabricate `HypertrophyPlanDraftV1`/accepted-v2 data | `REMOVE`. |
| candidate placement ID and layer | None | No current v1 representation | `DEFER`. |

Rep targets, measurement profiles, progression, preparation/closeout, fixed
weekdays, persistent specification revisions, acceptance, activation, and
runtime fallback also remain explicitly deferred or unsupported.

## Deterministic and hash boundaries

The proof now has one hash with one honest meaning:

1. **Normalized input boundary:** the strict V0 parser trims `slotId` and
   `exerciseId`; all accepted fields are executable and there are no defaults.
2. **Executable projection boundary:** `projectExecutableSeedRows()` copies the
   ordered V0 slots and the exact `exerciseId`, `role`, and `setCount` values into
   `{ version: 1, slots }`.
3. **Accepted-seed hash boundary:** `normalizeAcceptedSeedPayload()` validates
   and hashes the canonical compiled v1 payload with SHA-256.
4. **Excluded metadata:** supplied catalog context validates identity only.
   Every planning, provenance, display, constraint, phase, target, and health
   field is rejected by the V0 parser rather than ignored or hashed.
5. **Guarantee:** identical normalized V0 input produces byte-equivalent
   executable rows and the same accepted-seed hash. Changing any accepted field
   changes the compiled payload boundary; object-key ordering is normalized by
   the existing accepted-seed hasher while slot/exercise array order remains
   meaningful.

The earlier separate `semanticHash` was removed. It mixed executable and
non-executable fields and therefore could not support an executable-fidelity
claim.

## Compiler authority

Authority is shared at deliberate existing boundaries:

- `compileAcceptedHypertrophySeed()` owns custom draft-to-accepted-v2 mapping,
  including custom authoring intent and role conversion.
- `projectExecutableSeedRows()` owns construction of ordered v1 executable rows.
  `projectExecutableSeed()` and V0 both delegate to this core.
- `normalizeAcceptedSeedPayload()` plus `parseSlotPlanSeedJson()` own canonical
  accepted-seed normalization, validation, and hashing.

V0 does not invoke `compileAcceptedHypertrophySeed()` directly. Doing so would
require inventing settings, session focus, targets, and class constraints that
the minimal contract deliberately excludes. Focused equivalence coverage proves
that the same executable rows from an existing custom draft produce the same v1
projection. No second executable-row mapping remains in V0.

## Semantic fidelity

Every retained input value has an exact consumer interpretation:

- slot and exercise array order are preserved;
- `slotId` is the same identifier used to select the accepted slot;
- `exerciseId` is the same stable identity consumed by materialization;
- `role` is already the exact accepted/runtime enum, so there is no prominence
  approximation or fallback;
- `setCount` is already the exact explicit positive integer used for runtime
  set-count overrides and replay.

No mutable catalog metadata is needed to reinterpret a compiled row. Catalog
context only proves that the supplied stable ID exists before compilation.

## Plan Health decision

Current hypertrophy Plan Health cannot truthfully consume only the compiled v1
seed. It requires `HypertrophyPlanDraftV1` settings, session focus, accepted
targets/classes, limitation keys, and rich catalog facts. V0 therefore reports
Plan Health as omitted. Reconstructing a draft solely to obtain a richer report
would make those broader authoring concepts part of the proof contract even
though they do not execute.

## Read-only and runtime isolation

- The compiler is pure and has no Prisma, database, transaction, persistence, or
  lifecycle dependency.
- Preview orchestration calls only the parser, catalog-ID validation, compiler,
  and accepted-seed normalizer.
- Acceptance and runtime owners do not import the preview modules.
- `next-session.ts` continues to prefer the current immutable seed revision and
  uses `slotPlanSeedJson` only for the explicit legacy/no-revision path.
- V0 creates no specification fallback and is not imported by workout
  materialization.
- Removing the preview modules and CLI would not change application execution.

## Limitations and decision gate

`PROVEN WITH LIMITATIONS`: the smallest semantic input that exactly matches the
current executable contract can be validated, deterministically projected,
accepted-seed validated, and previewed without writes or runtime consumption.

The limitation is deliberate: current v1 seed truth can express only ordered
exercise identity, executable role, and set count. It cannot faithfully carry
priorities, continuity, placement identity, layers, measurement, progression,
phase policy, or richer Plan Health meaning. Those concepts must not return to a
public specification until a reviewed executable contract can preserve them.
