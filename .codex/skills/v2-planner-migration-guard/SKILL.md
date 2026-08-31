---
name: v2-planner-migration-guard
description: Guard Trainer V2 planner changes at the pure planner, materialization, acceptance, and evidence-promotion boundaries. Use for changes under `trainer-app/src/lib/engine/planning/v2`, V2 materialization or acceptance adapters, or proposals to promote V2 candidate or diagnostic evidence into accepted behavior. Do not trigger for generic seed, receipt, runtime, repair, audit serialization, or benchmark interpretation work.
---

# V2 Planner Migration Guard

Keep V2 as a plan author, not a runtime executor.

## Classify the boundary

State which boundary owns the proposed change:

1. pure V2 planner policy
2. materialization of planner output
3. acceptance of a materialized candidate
4. controlled promotion of candidate or diagnostic evidence
5. non-consumption guard at runtime

Name forbidden layers, behavior impact, accepted-seed impact, and unresolved evidence before editing. If the owner is ambiguous or the request crosses boundaries without an explicit contract, use `architecture-guard` and stop before writing.

## Pure planner boundary

Pure V2 may own strategy, demand, weekly curves, slot allocation, class/set intent, support and capacity policy, selection plans, pure validation, and dry-run inputs.

Pure V2 must not import or depend on:

- Prisma, routes, or DB state
- runtime replay or save/log flows
- receipts or UI
- audit serializers or artifact shapes
- repair output as target policy

Normalize DB or performed evidence outside the pure planner and pass a bounded DTO inward.

## Materialization boundary

Materialization may translate a pure candidate and normalized inventory into a parser-compatible seed-shaped preview and report omissions or blockers. It must not persist, call runtime replay, or become policy by interpreting audit diagnostics.

Keep candidate validation distinct from acceptance. A materialized preview is not accepted truth.

## Acceptance boundary

Before V2 output can affect accepted behavior, require:

- a named planner owner and bounded behavior scope
- valid materialization and parser compatibility
- explicit acceptance gates and failure behavior
- non-regression evidence
- rollback criteria
- persistence through the canonical acceptance seam

Accepted executable authority then belongs to the immutable seed revision boundary protected by `seed-runtime-source-of-truth`; V2 diagnostics do not accompany it as executable fields.

A compiled `sessionCapacityReductionManifest` may remain inside compatibility/explanatory accepted planner intent for an explicit session-local transform. It is not an executable revision row, does not alter normal replay, and must not mutate future generation or seed carry-forward.

## Evidence promotion

Treat recommendations, benchmark gates, projection diffs, planning-reality diagnostics, and repaired projections as evidence.

- Unknown remains unknown.
- A repaired projection is a safety-net comparison, never target policy.
- Do not promote a diagnostic directly into selection, materialization, acceptance, or runtime.
- Promote one bounded owner-specific behavior only after measured candidate deltas and non-regression evidence support it.
- Keep readout-only work read-only.

## Runtime non-consumption

Runtime must not interpret V2 strategy, lane IDs, blockers, omissions, recommendation status, benchmark results, repair evidence, debug fields, or a capacity-reduction manifest as normal executable seed composition. Any runtime dependency on V2-only diagnostics is a boundary violation.

## Required change record

Report:

- owning boundary and forbidden layers
- smallest coherent files and explicit no-touch surface
- behavior/materialization/acceptance impact
- evidence used and evidence still missing
- runtime non-consumption proof
- deterministic verification and any authorization-gated output audit

Generate the deterministic verification plan with `.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef <authorized-base>` and interpret the resulting evidence against the claimed planner boundary; treat an unavailable required check as unresolved. Use `audit-workflow` only when an authorized matching output-level audit is necessary; the skill does not authorize that audit.

## Exit criteria

Conclude only when planner ownership is explicit, diagnostics remain non-executable, materialization and acceptance are not conflated, runtime remains V2-unaware, and residual promotion risk is named.
