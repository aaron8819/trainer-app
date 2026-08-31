---
name: audit-workflow
description: Route Trainer audit questions, validate generation-facing output, and interpret canonical audit artifacts. Use when choosing or running an audit mode, checking runtime targeting or write scope, reading workout-audit or V2 artifacts, or deciding whether generated/projected output satisfies a change. Do not use to author generation policy.
---

# Audit Workflow

Use one audit router for question selection, authorization, targeting, artifact interpretation, and output-level validation.

## Start with the question

State the exact question the audit must answer. Read `trainer-app/docs/09_AUDIT_PLAYBOOK.md` for current mode semantics, command patterns, artifact fields, and interpretation details. Read operations guidance only when runtime targeting or protected access matters.

Choose the narrowest mode and target that answer the question. Keep next-session, full-week, mesocycle, deload, progression, and historical conclusions separate.

## Check authorization before execution

Classify:

- read-only inspection versus artifact write
- local-only versus database or remote access
- intended owner, mesocycle, week, phase, workout, or exercise target
- whether the command is available in the current environment

Never infer database, production, artifact-write, or destructive authorization from this skill, an audit mode, or a command name.

Run a matching output-level audit only when it is authorized and available. Otherwise report the missing audit as an unresolved validation gate; do not substitute code inspection or a different mode and do not claim the output passed.

For audit-tooling writes, use `.\scripts\codex\Start-TrainerTask.ps1` with the authorized base and real classification. Before an eligible audit execution, use `.\scripts\codex\Invoke-TrainerDoctor.ps1`. After a tooling diff, generate `.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef <authorized-base>` directly, use the normal verification workflow, and interpret the resulting evidence against the audit question.

## Validate generation-facing output

When a change can affect generated or projected sessions:

1. identify the owning generation/materialization/lifecycle seam
2. run focused deterministic tests selected by repository policy
3. select the matching canonical audit question and mode
4. inspect the artifact fields named by the playbook
5. compare observed selection, sets, semantics, provenance, progression, deload, warnings, or projection behavior with the intended contract
6. treat disagreement between tests and the artifact as a failed gate

Do not validate output by eyeballing code, UI summaries, or ad hoc debug data. Do not treat read-side explanation as proof of generator correctness unless the canonical artifact agrees.

## Interpret without changing ownership

First confirm the artifact targets the intended runtime state. Then classify the result as:

- `tooling/readout`
- `runtime correctness`
- `real engine allocation/policy issue`

Keep fixes in the audit/reporting seam when the defect is mode selection, targeting, serialization, labeling, or interpretation. Escalate into generation policy only when a correctly targeted canonical artifact demonstrates a real engine defect.

Diagnostics and repaired projections remain evidence. They do not authorize promotion into planner, acceptance, seed, runtime, receipt, or persistence behavior.

For a capacity-reduced session, keep the full generated snapshot, offered reduced structure, performed logs, original receipt, and reconciliation evidence distinct. A `sessionCapacityReductionManifest` is compatibility/explanatory metadata, and reconciliation directives such as future-generation or seed-carry-forward `ignore` are audit interpretation evidence only; they are runtime-inert.

## Required output

Report:

- clarified audit question
- chosen mode and target
- authorization and availability result
- owning output seam, when validating generation
- tests and audit commands run
- artifact fields inspected
- truthful interpretation frame and issue classification
- output-level pass/fail verdict
- unresolved validation gates and next safe step
