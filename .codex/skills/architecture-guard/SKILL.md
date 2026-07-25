---
name: architecture-guard
description: Protect Trainer canonical ownership during non-trivial changes that cross app layers, shared seams, persistence, or behavior contracts. Use when ownership is unclear, multiple consumers or seams may change, or a proposed implementation could duplicate domain meaning or create a competing source of truth. Do not auto-trigger for isolated prompt, skill, or workflow-doc maintenance that makes no app behavior or contract claim.
---

# Architecture Guard

Find the rightful owner, define the smallest coherent change, and prevent drift.

## Establish ownership

Before implementation:

1. Read `trainer-app/docs/00_START_HERE.md` and the canonical doc for the affected behavior.
2. Read the request surface, candidate owner, nearby tests, and all relevant callsites.
3. Name one canonical owner. If evidence supports two candidates, state the unresolved evidence and stop before writing.
4. Trace supporting seams and downstream consumers far enough to identify contract, persistence, read-side, and audit consequences.

Use repository search to follow symbols and state. Do not assume a route, page, or nearest file owns the behavior.

## Produce the change map

State:

- canonical owner and why it owns the behavior
- supporting seams and consumers
- smallest coherent change surface
- explicit no-touch boundaries
- required edits in execution order
- architecture-specific risks
- unresolved evidence or authorization gates
- verification handoff

Keep the map proportional to the task. Do not reproduce general worktree policy, command recipes, or deterministic path-to-check mappings.

## Plan the implementation

Order changes so the owner and contract exist before consumers depend on them:

1. canonical types or persistence contract, when needed
2. owning domain or orchestration seam
3. adapters, routes, and consumers
4. focused tests
5. canonical documentation after behavior is established

Use a different order only when the named owner requires it. Separate required work from optional cleanup and exclude speculative refactors.

## Guardrails

- Extend an existing owner instead of patching incidental consumers.
- Keep routes and pages thin.
- Keep DB-backed orchestration in `trainer-app/src/lib/api`.
- Keep pure policy in `trainer-app/src/lib/engine`.
- Keep shared session meaning in `trainer-app/src/lib/session-semantics`.
- Keep presentation semantics in shared read-model/UI seams.
- Do not add mirrors, convenience flags, or local recomputation for canonical meaning.
- Do not cross persistence, receipt, accepted-seed, runtime, or audit boundaries without reviewing the specialized retained guard for that boundary.

## Repository workflow

For an authorized write, use `.\scripts\codex\Start-TrainerTask.ps1` with the task's real classification and base before editing. Treat its output as inspection and policy evidence, not additional authority.

After the diff exists, generate `.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef <authorized-base>` and route the plan to `test-impact-triage`. Use the repository command registry and policy as the deterministic source of checks.

## Exit criteria

Conclude only when the canonical owner is explicit, all affected consumers were reviewed, no competing truth was introduced, no-touch boundaries held, and selected verification is accounted for.
