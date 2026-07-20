---
name: seed-runtime-source-of-truth
description: Protect the Trainer accepted seed and runtime replay source-of-truth boundary. Use for tasks touching slotPlanSeedJson, slotSequenceJson, acceptedPlannerIntent, buildMesocycleSlotPlanSeed, parseSlotPlanSeedJson, template-session, slot-plan-seed, deload-session, mesocycle-slot-runtime, accepted mesocycle handoff, V2 materialized seed acceptance, seed parser or serializer work, runtime replay, session receipts, provenance, save/log flows that might mutate plan shape, active reseed or runtime-added exercises, accepted planner metadata, audit claims about seed/runtime behavior, or any work that could make runtime consume planner diagnostics.
---

# Seed / Runtime Source-of-Truth Skill

Use this with `v2-planner-migration-guard` when V2, accepted seed, runtime replay, receipts, or audit provenance could drift into a second executable plan.

## Core Thesis

Accepted seed is executable truth.
Planner metadata is explanatory truth.
Runtime replay consumes executable truth only.

V2 may author better accepted seeds.
Runtime should not become V2-aware.

## Canonical Executable Seed Shape

The runtime-consumed executable composition contract is:

```txt
slotPlanSeedJson.slots[].exercises[{ exerciseId, role, setCount }]
```

These are the only executable composition fields runtime should consume:

- `exerciseId`: which exercise appears
- `role`: what role it has
- `setCount`: how many planned sets it has

Runtime must not require or interpret:

- lane IDs
- planner strategy
- materializer blockers
- materializer omissions
- dry-run reports
- promotion readiness
- strategy recommendations
- projection diffs
- repair diagnostics
- audit sidecar fields
- inventory evidence
- production gate evidence

Default answer: do not change executable seed shape.

## Metadata Boundary

Planner metadata may exist only as explanatory metadata. Examples:

- `acceptedPlannerIntent`
- V2 provenance
- materialization source/version
- phase strategy id
- mesocycle objective
- muscle demand summary
- lane/class intent summary
- continuity rationale
- production gate provenance

Rules:

- Metadata may explain why the seed exists.
- Metadata must not change how runtime replays the seed.
- Metadata must not override `exerciseId`, `role`, or `setCount`.
- Metadata must not become a second executable plan.

## Runtime Replay Rules

Runtime replay should:

- read persisted `slotPlanSeedJson`
- replay accepted exercise identities
- replay accepted set counts
- preserve slot order from `slotSequenceJson`
- apply runtime/local user edits as session-local deviations
- log performed reality
- produce receipts/provenance explaining what happened

Runtime replay should not:

- reselect exercises from planner metadata
- infer exercises from lane IDs
- recompute set counts from strategy metadata
- consume V2 diagnostics
- consume materializer blockers/omissions
- mutate canonical seed during normal logging
- silently reseed because a user swapped, skipped, or added work

## Runtime Edits Boundary

Runtime edits are session-local deviations unless explicitly reseeded.

Session-local deviations include:

- exercise swap
- added exercise
- removed exercise
- skipped exercise
- added set
- removed/reduced set
- changed reps/load/RPE
- partial session
- readiness/time/equipment adjustment

Log these as performed reality or session-level deviation. Do not silently write them back into `slotPlanSeedJson`.

Plan-level changes require an explicit reseed, update, or acceptance path.

## V2 Accepted Seed Rules

Allowed path:

```txt
V2 planner/materializer
-> guarded acceptance helper
-> existing buildMesocycleSlotPlanSeed()
-> persisted slotPlanSeedJson
-> runtime replay unchanged
```

Forbidden path:

```txt
V2 materializer/debug output
-> handcrafted slotPlanSeedJson
-> runtime interprets V2 metadata
```

Require:

- V2 output must pass promotion/write gates before persistence.
- V2 output must delegate final JSON shape to the existing seed serializer.
- Failed V2 opt-in must fail closed or explicitly labeled fallback.
- Fallback must never be labeled V2 success.
- Runtime composition source must remain persisted seed replay, not V2 materializer.

## Deload Replay Rules

Deload replay preserves the same boundary:

- deload may reduce volume/effort
- deload may use accepted seed identities
- deload must not reselect from V2 metadata
- deload must not treat planner metadata as executable truth
- deload-specific behavior must be tested separately from accumulation replay

## Receipts / Provenance Rules

Receipts may record:

- composition source
- runtime deviation source
- seed replay provenance
- V2-authored seed provenance, if applicable
- fallback labels, if applicable

Receipts must not:

- become executable source of plan composition
- duplicate full seed truth as a parallel plan
- hide fallback as V2 success
- imply V2 write occurred when only helper/probe preparation occurred

Distinguish:

- helper/probe provenance = preparation evidence
- transaction provenance = persistence evidence
- runtime receipt = replay/performed evidence

## Failure Modes This Skill Prevents

- runtime begins reading `acceptedPlannerIntent`
- V2 diagnostic output becomes seed truth
- materializer lane IDs leak into runtime behavior
- receipts duplicate plan composition
- session-local swaps mutate canonical seed
- deload reselects instead of replaying accepted seed
- fallback is mislabeled as V2 success
- helper readiness is mistaken for persisted DB write
- handcrafted seed JSON bypasses serializer/parser
- audit diagnostics are treated as runtime contract

## Required Pre-Edit Classification

Before changing code, state:

```txt
Owner layer:
Seed/runtime touched: yes/no
Executable seed shape changed: yes/no
Planner metadata touched: yes/no
Runtime replay touched: yes/no
Receipt/provenance touched: yes/no
DB persistence touched: yes/no
Migration risk:
```

If executable seed shape changes, require explicit justification and contract verification.

## Repository verification workflow

Before implementation, run `.\scripts\codex\Start-TrainerTask.ps1` from the repository root with `shared-seam-write`, or `db-migration` if persistence or migration files are in scope, using the authorized base. Stop on blockers and respect its database and path policies; Phase 1 is inspect-only and neither classification authorizes a database connection, migration, or write.

Run the default local-only `.\scripts\codex\Invoke-TrainerDoctor.ps1` before checks that depend on local tools or dependencies. Optional-tool gaps warn and required-prerequisite gaps block affected execution. It does not install, authenticate, repair, connect, migrate, or deploy; do not enable remote/database scopes without explicit need and authorization.

After changes, generate `.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef <authorized-base>` and route the plan to `test-impact-triage`. Review the selected seed/runtime, contract, and release checks before execution. Use `-Run` only for registry-approved local implementation checks and report skipped release or authorization-gated checks. When generated output or audit artifacts change, also route to `workout-generation-audit` or `audit-workflow` for the matching authorized domain audit.

## Required Assertions

For any seed/runtime task, tests or output must prove:

- legacy seeds still parse
- malformed optional metadata does not break valid executable seed replay
- runtime ignores `acceptedPlannerIntent`
- runtime consumes only `exerciseId`, `role`, and `setCount` for composition
- deload replay remains stable
- session-local deviations do not mutate canonical seed
- V2-authored ready output still uses existing seed serializer
- blocked V2 output writes no seed
- fallback, if present, is explicitly labeled and not V2 success

## Required Output Format

Return:

```md
# Seed / Runtime Classification

# Source-of-Truth Boundary

# Files Changed

# Executable Seed Impact

# Planner Metadata Impact

# Runtime Replay Impact

# Receipt / Provenance Impact

# Verification Results

# Remaining Risks
```
