---
name: v2-planner-migration-guard
description: Guard Trainer V2 hypertrophy planner migration work from architectural seam drift. Use for any task touching or near src/lib/engine/planning/v2, V2 plan-quality benchmark gates, V2 strategy, demand, weekly curve, slot allocation, materialization dry-run, strategy evidence, recommendations, promotion readiness, projection diffs, planning-reality diagnostics, audit artifact serialization, V2 debug shards, handoff acceptance, accepted seed creation, slotPlanSeedJson, acceptedPlannerIntent, runtime seed replay, repair promotion/deprecation/materiality, no-repair versus repaired projection comparisons, or mesocycle-explain audit output.
---

# V2 Planner Migration Guard Skill

Protect the Trainer app V2 hypertrophy planner migration. Classify the layer first, then apply the matching guardrails before editing code.

## When To Use

Use this skill for any task touching or near:

- `src/lib/engine/planning/v2/*`
- V2 strategy / demand / weekly curve / slot allocation
- V2 materialization dry-run
- V2 strategy evidence / recommendations / promotion readiness / projection diffs
- V2 plan-quality benchmark gates and source attribution
- planning-reality diagnostics
- audit artifact serialization / V2 debug shards
- handoff acceptance / accepted seed creation
- `slotPlanSeedJson`
- `acceptedPlannerIntent`
- runtime seed replay
- repair promotion / repair materiality
- repair deprecation or cleanup
- no-repair / repaired projection comparisons
- mesocycle-explain audit output

## Step 1: Classify The Task Layer

Before editing code, classify the task as one or more of:

```txt
1. Pure planner policy
2. Strategy evidence / recommendation diagnostic
3. Materialization dry-run
4. Promotion readiness / projection diff
5. Audit serialization / artifact shard
6. Accepted seed contract
7. Runtime replay
8. Repair safety net
9. UI / read model
10. Tooling / verification / docs
```

State this before edits:

```txt
Owner layer:
Forbidden layers:
Behavior change: yes/no
Seed/runtime/receipt change: yes/no
Repaired projection used as: evidence/target
Artifact output changed: yes/no
```

If multiple layers apply, use the most restrictive guardrails.

## Pause And Ask / Re-scope

Pause before editing if:

- the prompt asks to "promote" a diagnostic but does not name the behavior owner
- the task could affect seed/runtime semantics
- the task uses repaired projection as the expected output
- the task asks for production V2 writes without explicit gates
- the task would add detailed arrays to the main artifact
- the task crosses pure V2 and API/audit/runtime seams

## Step 2: Global Invariants

- V2 should replace the plan author, not the plan executor.
- Runtime replay should remain boring.
- Diagnostics explain; they do not govern.
- Repair is evidence and safety net, not target policy.
- Performed reality is evidence; old repair-shaped prescribed plans are not north-star policy.
- Pure V2 stays pure.
- Accepted seed stores executable truth.
- Runtime edits are session-local unless explicitly reseeded.

## Step 3: Pure V2 Boundary

Pure V2 modules may contain:

- strategy types
- demand
- weekly curve
- slot allocation
- class distribution
- set intent
- support policy
- capacity plan
- selection plan
- materialization dry-run
- pure diagnostics

Pure V2 modules must not import:

- Prisma / DB
- API routes
- audit serializers
- planningReality
- repair/projection production paths
- runtime replay
- receipts
- UI
- save/log flows

If a task needs DB/read-model evidence, collect it in an API/read-model adapter and pass a normalized DTO into pure V2.

## Step 4: Diagnostic / Readout-Only Guardrails

For diagnostic/readout-only tasks, require:

- No generation behavior change.
- No selection behavior change.
- No repair behavior change.
- No seed serialization change.
- No runtime replay change.
- No receipts change.
- No DB mutation.
- No UI change unless explicitly requested.

Also require:

```txt
readOnly: true
affectsScoringOrGeneration: false
consumedByDemandOrMaterializer: false, when applicable
```

For audits, prove or state:

- selected identities unchanged unless explicitly intended
- slot plans unchanged unless explicitly intended
- raw repair evidence unchanged unless explicitly intended
- unflagged/default output unchanged unless explicitly intended

## Step 4b: V2 Plan-Quality Benchmark Guardrails

For V2 plan-quality benchmark work, separate evidence sources before changing behavior:

- Pure V2 base-plan / compare evidence = candidate-quality truth for V2-authored plan shape.
- V2 shadow/projection evidence = high-fidelity preview or stress evidence.
- Planner-only no-repair evidence = handoff/projection risk, not automatic pure V2 failure.
- Repaired projection = safety-net evidence only, never target policy.
- Acceptance/no-repair readouts = trainability watch items unless explicitly promoted through the acceptance gate.

Rules:

- A benchmark gate must name status, owner seam, evidence source, and smallest safe next move.
- Use failing benchmark gates as the default work queue before repair-row probes.
- Do not claim V2 failed from no-repair evidence when pure V2 candidate evidence passes.
- Do not claim repair is obsolete from `no candidate impact` alone; require source-attributed benchmark coverage and non-regression proof.
- Repair deprecation must be a cleanup change with explicit safety evidence, not a side effect of planner policy work.

## Step 5: Seed / Runtime Source Of Truth

Executable seed truth:

```txt
slotPlanSeedJson.slots[].exercises[{ exerciseId, role, setCount }]
```

Everything else is explanatory unless explicitly promoted through a guarded contract:

- `acceptedPlannerIntent`
- provenance
- strategy recommendations
- promotion readiness
- materializer `laneIds`
- blockers
- omissions
- debug evidence
- audit diagnostics

Runtime should consume only executable seed truth.

Explicitly forbidden:

- runtime interpreting strategy diagnostics
- runtime interpreting materializer `laneIds`
- runtime using `acceptedPlannerIntent` as executable policy
- handcrafted `slotPlanSeedJson` bypassing `buildMesocycleSlotPlanSeed()`

## Step 6: Materialization Dry-Run Guardrails

Materializer may:

- consume pure `ExerciseSelectionPlan`
- consume normalized inventory
- emit seed-shaped preview
- report blockers/omissions
- prove seed-shape compatibility

Materializer must not:

- write `slotPlanSeedJson`
- call runtime replay
- import API/DB/repair/planningReality/audit serializers
- become production selector by default
- treat optional omissions as required blockers unless required lane coverage or seed-shape compatibility is affected

## Step 7: Promotion / Behavior Guardrails

Before any strategy hypothesis, recommendation, promotion readiness, or projection diff can affect behavior, require:

- clear planner owner
- bounded behavior scope
- sufficient evidence quality
- known risks
- non-regression gates
- audit comparison path
- rollback criteria

Use this rule:

```txt
recommendation = evidence-backed hypothesis
not production planner instruction
```

No hypothesis may affect behavior directly from evidence.

For projection gates:

```txt
A gate passes only from measured projected deltas.
Unknown remains unknown.
Do not infer pass from absence of evidence.
```

## Step 8: Hypertrophy Evidence Alignment

Any planning policy change must label its rationale as one or more:

```txt
hypertrophy_training_principle
user_performed_evidence
north_star_target_spec
app_architecture_invariant
diagnostic_readout
legacy_repair_evidence_only
```

Hard rule:

```txt
Never create policy solely because repaired projection did it.
```

## Step 9: Audit Artifact / Shard Discipline

Current artifact architecture:

```txt
main artifact = compact operator summary
v2 index = manifest
v2 shards = detailed diagnostics by domain
```

Rules:

- Do not add large arrays to the main artifact.
- Put strategy evidence in `v2-strategy`.
- Put promotion gates/diffs in `v2-promotion-diffs`.
- Put repair rows in `v2-repair-evidence`.
- Put materialization detail in `v2-materialization`.
- Use compact summaries and top-N examples by default.
- Track artifact sizes in live audit output when audit serialization changes.

## Step 10: Verification Matrix

For pure V2 / strategy work:

```bash
npm run test -- src/lib/engine/planning/v2/mesocycle-strategy.test.ts src/lib/engine/planning/v2/mesocycle-demand.test.ts src/lib/engine/planning/v2/architecture-boundary.test.ts
```

For strategy input adapter work:

```bash
npm run test -- src/lib/api/v2-mesocycle-strategy-input-adapter.test.ts
```

For audit artifact/readout work:

```bash
npm run test -- src/lib/audit/workout-audit/artifact-serialization.test.ts src/lib/audit/workout-audit/serializer.test.ts src/lib/audit/workout-audit/workout-audit-cli.test.ts src/lib/audit/workout-audit/mesocycle-explain-compare.test.ts
```

For V2 plan-quality benchmark work:

```bash
npm run test -- src/lib/audit/workout-audit/v2-plan-quality-benchmark.test.ts src/lib/engine/planning/v2/architecture-boundary.test.ts
```

For seed/runtime work:

```bash
npm run test -- src/lib/api/slot-plan-seed-parser.test.ts src/lib/api/template-session/slot-plan-seed.test.ts src/lib/api/template-session/deload-session.test.ts src/lib/api/template-session.test.ts src/lib/api/mesocycle-slot-runtime.test.ts
```

For handoff acceptance work:

```bash
npm run test -- src/lib/api/mesocycle-handoff.test.ts src/lib/api/mesocycle-handoff-v2-materialized-seed.test.ts
```

Always run when code changes:

```bash
npx tsc --noEmit
npm run verify:contracts
npm run verify
```

When audit/debug output changes, run:

```bash
npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com --operator-debug --planner-only-no-repair --compare-repaired --v2-debug-artifact
```

Record:

```txt
main artifact size
v2 index size
relevant shard sizes
planningShape
materialRepairCount
majorRepairCount
suspicious repair count
```

For skill/workflow-doc-only edits with no app behavior or contract claims, app verification is not required; run `git diff --check` on touched files and inspect the instruction diff for contradictions. If canonical behavior docs or contracts changed, triage that underlying seam normally.

## Step 11: Required Output Format For Codex Using This Skill

Return:

```md
# Layer Classification

# Guardrails Applied

# Files Changed

# Behavior / Runtime / Seed Impact

# Artifact Impact

# Verification Results

# Remaining Risks / Next Safe Slice
```
