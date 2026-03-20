---
name: architecture-guard
description: Enforce Trainer app canonical ownership and prevent architectural drift. Use for any non-trivial change involving src/app, src/lib/*, Prisma, or docs.
---

# Architecture Guard

Protect canonical seams. Do not allow drift.

---

## HARD RULE

Do not write or modify code until a complete architecture audit is produced.

---

## Pre-edit architecture audit (required)

Before editing, you MUST:

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

- run focused tests
- run boundary tests if cross-layer
- run `npm run verify:contracts` if contracts changed
- run `npm run verify` for shared seams
- use audit tooling for generation/lifecycle

---

## Done criteria

Change is NOT done unless:

- correct canonical seam owns behavior
- all callsites reviewed
- no duplication introduced
- tests updated or validated
- verification commands run
- docs updated if contracts changed