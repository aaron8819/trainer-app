---
name: architecture-guard
description: Enforce Trainer app canonical ownership and prevent architectural drift. Use for non-trivial app behavior or architecture changes involving trainer-app/src, trainer-app/prisma, or canonical behavior docs. For prompt-writing, skill edits, and docs-only workflow changes, use a lightweight ownership/verification note unless app behavior or contracts change.
---

# Architecture Guard

Protect canonical seams. Do not allow drift.

---

## Scope Note

For app behavior/code changes, run the full guard below before editing.

For prompt-generation, skill maintenance, or workflow-doc-only edits that do not change app behavior, contracts, seed/runtime truth, or DB shape, do a lightweight check instead:

- identify whether any Trainer app runtime seam is affected
- state that no production behavior/contract path changes
- validate with diff/format checks rather than app test suites unless the edit claims behavior changed
- use the repository verification planner for the actual diff instead of hard-coding path-to-test rules

---

## HARD RULE

Do not write or modify app code until a complete architecture audit is produced.

---

## Pre-edit architecture audit (required)

Before editing, you MUST:

0. Run `.\scripts\codex\Start-TrainerTask.ps1` from the repository root with the appropriate `application-write` or `shared-seam-write` policy classification and authorized base. Stop on blockers; Phase 1 is inspect-only and classification does not authorize writes outside the user-approved task.

1. Read `trainer-app/docs/00_START_HERE.md`
2. Read the relevant canonical docs for the seam
3. Read the current surface file
4. Read the owning implementation under `trainer-app/src/lib/*`
5. Read nearby tests
6. Search all callsites

Commands:
- `rg "<feature|symbol|state>" trainer-app/src trainer-app/docs`
- `rg --files trainer-app/src | rg "<feature>"`
- `rg --files trainer-app/src -g "*.test.ts" -g "*.test.tsx" | rg "<feature>"`

---

## REQUIRED OUTPUT (before edits)

You MUST output this audit:

- **Owning seam**
- **Relevant files**
- **What changes**
- **What must NOT change**
- **Duplication risks**
- **Verification plan**

Keep it concise and concrete.

---

## Canonical ownership rules

- `src/app` → surface only
- `src/app/api` → request parsing + orchestration entry
- `src/lib/api` → DB-backed orchestration + read models
- `src/lib/engine` → pure logic
- `src/lib/session-semantics` → session meaning
- `src/lib/ui` → shared display semantics

Never violate this layering without explicit justification.

---

## Drift guards (failure modes to prevent)

Do NOT:

- patch behavior in UI when a shared seam exists
- duplicate logic across routes, UI, and lib layers
- introduce a second source of truth
- add new enums/flags when a canonical contract exists
- fork logic instead of extending the owner
- skip callsite search before editing

---

## Change execution

- Extend the canonical owner
- Update consumers to read from it
- Do not split logic across layers unless already defined

If no seam exists:
- identify nearest owner
- justify why it’s insufficient
- introduce the smallest valid seam

---

## Post-edit verification

- Run `.\scripts\codex\Invoke-TrainerDoctor.ps1` before checks that depend on tools or dependencies; do not let it install, repair, authenticate, connect, migrate, or deploy.
- Generate `.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef <authorized-base>` from the repository root and review why each implementation and release check was selected.
- Route the plan to `test-impact-triage`. Use `-Run` only for registry-approved local implementation checks; report release-only and authorization-gated checks as skipped.
- Use `workout-generation-audit` when generation or lifecycle output needs domain validation beyond the repository verification plan.

---

## Done criteria

Change is NOT done unless:

- correct canonical seam owns behavior
- all callsites reviewed
- no duplication introduced
- tests updated or validated
- verification commands run
- docs updated if contracts changed
