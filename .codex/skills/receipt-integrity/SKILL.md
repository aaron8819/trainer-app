---
name: receipt-integrity
description: Protect the Trainer app's receipt-first architecture. Use when a task may affect `selectionMetadata.sessionDecisionReceipt`, receipt persistence, receipt-derived semantics, explainability, audit reconciliation, workout review/history/dashboard reads, generation/finalization flows, or validation/contracts tied to persisted session-decision context. Enforce the receipt as canonical stored truth, prevent mirrors and drift, and require downstream consumer review before editing.
---

# Receipt Integrity

Protect receipt-first truth.

---

## HARD RULE

Do not write or modify code that affects receipt-related behavior until canonical persistence, write path ownership, and downstream consumers have been explicitly traced.

---

## Purpose

Use this skill when stored session-decision meaning is in play.

- `seam-locator` finds the owner
- `implementation-planner` orders the change
- `architecture-guard` protects layering
- `workout-generation-audit` validates generation-facing output
- `receipt-integrity` protects canonical stored receipt truth and receipt-backed consumers

---

## Read first

1. Read `AGENTS.md`
2. Read `trainer-app/docs/00_START_HERE.md`
3. Read receipt-relevant canonical docs:
   - `trainer-app/docs/01_ARCHITECTURE.md`
   - `trainer-app/docs/02_DOMAIN_ENGINE.md`
   - `trainer-app/docs/03_DATA_SCHEMA.md`
   - `trainer-app/docs/04_API_CONTRACTS.md`
   - `trainer-app/docs/06_TESTING.md`
4. Read the owning receipt seams:
   - `trainer-app/src/lib/evidence/session-decision-receipt.ts`
   - `trainer-app/src/lib/ui/selection-metadata.ts`
   - `trainer-app/src/lib/api/template-session/finalize-session.ts`
   - `trainer-app/src/app/api/workouts/save/route.ts`
5. Read nearby tests before editing.
6. Search all relevant callsites before editing:
   - `rg "sessionDecisionReceipt|receipt-first|workoutStructureState|selectionMetadata" trainer-app/src trainer-app/docs`
   - `rg --files trainer-app/src -g "*.test.ts" -g "*.test.tsx" | rg "receipt|selection-metadata|explainability|session-summary|workout-list|program|history|audit"`

---

## Canonical boundaries

- `selectionMetadata.sessionDecisionReceipt` is the canonical stored session-decision and evidence payload.
- `selectionMetadata.workoutStructureState` is the canonical mutation-reconciliation companion record, not a receipt replacement.
- Receipt build/parse/normalization belongs at `trainer-app/src/lib/evidence/session-decision-receipt.ts`.
- Receipt-safe metadata stamping/sanitization belongs at `trainer-app/src/lib/ui/selection-metadata.ts`.
- Generation/finalization owns original receipt creation; save/mutation paths must preserve original receipt truth.
- Read-side consumers must read canonical stored receipt data plus documented shared semantics, not create a second truth source.

---

## Guardrails

Do NOT:

- add new top-level mirrors of receipt meaning
- add convenience copies that become de facto truth
- recompute persisted receipt truth when canonical stored data should be read
- put receipt policy in routes, pages, or UI components
- rewrite `sessionDecisionReceipt` to mimic post-save structural mutations
- let explainability, audit, dashboard, review, or history reads diverge from persisted receipt-backed meaning
- let read-side semantics drift away from stored receipt fields and documented shared helpers
- add new derived booleans, flags, or enums that restate receipt meaning outside the canonical receipt or shared semantic helpers

---

## REQUIRED OUTPUT

Before editing, output:

- **Receipt owner / canonical boundary**
- **Affected write path**
- **Affected read-side consumers**
- **Receipt fields or contracts touched**
- **Duplication/drift risks**
- **Verification plan**

Keep it concrete. Name real files and seams.

---

## Verification requirements

- Run focused tests for the changed seam.
- Run related route, explainability, audit, and UI read-side tests when receipt-backed behavior crosses boundaries.
- Run `npm run verify:contracts` from `trainer-app/` when receipt shape, validation, or runtime contract values change.
- Run `npm run verify` from `trainer-app/` when shared receipt consumers or shared seams change.
- Use canonical audit tooling, not ad hoc inspection, when receipt-backed generation, explainability, or audit reconciliation behavior is affected.

Prefer checking these high-risk consumers when relevant:

- explainability: `src/lib/api/explainability.ts`, `src/lib/ui/explainability.ts`
- semantics: `src/lib/session-semantics/derive-session-semantics.ts`
- review and summary: `src/lib/ui/session-summary.ts`, `src/app/workout/[id]/page.tsx`
- history and list reads: `src/lib/ui/workout-list-items.ts`, `src/app/api/workouts/history/route.ts`
- dashboard/program reads: `src/lib/api/program.ts`
- audit reconciliation: `src/lib/audit/workout-audit/*`

---

## REQUIRED POST-CHECK

Before concluding, state:

- **What receipt truth remains canonical**
- **Which consumers were verified**
- **Whether any receipt shape or meaning changed**
- **Whether mirrors were avoided**

---

## Exit condition

Do not proceed or conclude until:

- canonical receipt persistence has been checked
- the affected write path has been identified
- downstream receipt-backed consumers have been identified
- all relevant callsites were searched
- duplication and drift risks are explicit
- focused verification is defined