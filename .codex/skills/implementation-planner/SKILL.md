---
name: implementation-planner
description: Force a concrete ordered implementation plan before non-trivial Trainer app code changes. Use for features, refactors, bug fixes, migrations, or any task that may touch multiple seams, tests, routes, docs, persistence, or verification steps across `trainer-app/src`, `trainer-app/prisma`, and `trainer-app/docs`. Produce the smallest correct execution plan, preserve canonical ownership, minimize blast radius, and make verification explicit before implementation begins.
---

# Implementation Planner

Produce the execution plan before writing code.

---

## HARD RULE

Do not read “I know what to do” as sufficient. Do not write or modify code until the ordered plan is fully produced.

---

## Purpose

Use this skill after ownership is known and before non-trivial edits begin.

- `seam-locator` finds the owner
- `architecture-guard` protects the seams during editing
- `workout-generation-audit` validates generation-facing output
- `implementation-planner` defines the smallest correct change set and the order to execute it

---

## Inputs to read first

1. Read `AGENTS.md`
2. Read `trainer-app/docs/00_START_HERE.md`
3. Read the owning canonical doc for the seam
4. Read the current surface file
5. Read the canonical owner under `trainer-app/src/lib/*` or `trainer-app/prisma/*`
6. Read nearby tests
7. Search callsites:
   - `rg "<feature|symbol|state>" trainer-app/src trainer-app/docs`
   - `rg --files trainer-app/src | rg "<feature>"`
   - `rg --files trainer-app/src -g "*.test.ts" -g "*.test.tsx" | rg "<feature>"`

If ownership is still unclear, stop and use `seam-locator` first.

---

## Planning rules

- Prefer the smallest valid change set.
- Prefer extending an existing seam over creating a new one.
- Assume canonical ownership is already known; plan around extending that owner rather than rediscovering architecture during implementation.
- Separate required edits from optional cleanup.
- Minimize blast radius across routes, persistence, UI, and docs.
- Treat nearby tests as the contract.
- Make verification explicit before edits start.
- Order edits so downstream consumers are not updated before the canonical seam or contract they depend on.

---

## Default edit order

Plan edits in this order unless the task requires a different order:

1. shared types and contracts
2. canonical lib seam
3. dependent adapters or routes
4. UI consumers
5. tests
6. docs

If this order is wrong for the task, say why and provide the corrected order.

---

## REQUIRED OUTPUT

Return a structured plan with these fields:

- **Requested behavior**
- **Canonical owner**
- **Files to inspect**
- **Smallest viable path**
- **Planned edits in order**
- **Required edits**
- **Optional cleanup**
- **Tests to update/run**
- **Verification commands**
- **Risks**
- **Out of scope / do not touch**

Keep each field concrete. Use real file paths and seams when known.

Under **Planned edits in order**, number the steps and keep them execution-ready.

Under **Risks**, explicitly call out:

- duplication risk
- contract drift risk
- persistence risk
- read-side/write-side mismatch risk
- audit/semantics drift risk

---

## Plan quality bar

A valid plan:

- names the canonical owner clearly
- lists only the files likely to matter
- separates must-do edits from nice-to-have cleanup
- keeps consumers delegating instead of owning policy
- makes the verification path obvious
- avoids speculative refactors unrelated to the request

An invalid plan:

- starts editing before ordering the work
- mixes ownership discovery with implementation
- spreads logic across multiple layers without justification
- hides verification until the end
- expands scope just because nearby cleanup is tempting

---

## Ambiguity rule

If the plan cannot be made concrete because ownership, contract shape, or verification path is still unclear, stop and resolve that ambiguity before implementation.

---

## Exit condition

Do not switch from planning to implementation until:

- the ordered plan is complete
- the canonical owner is named
- the required edits are separated from optional cleanup
- the tests and verification commands are explicit
- the main drift risks are called out