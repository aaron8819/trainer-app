---
name: seam-locator
description: Identify the canonical Trainer app seam before implementation. Use when ownership is unclear or cross-layer changes are involved.
---

# Seam Locator

Find the single canonical owner before writing code.

---

## HARD RULE

Do not begin implementation until a complete ownership map is produced.

---

## Workflow

1. Read `trainer-app/docs/00_START_HERE.md`
2. Read relevant canonical docs
3. Search feature, symbol, state, and tests:

- `rg "<feature|symbol|state>" trainer-app/src trainer-app/docs`
- `rg --files trainer-app/src | rg "<feature>"`
- `rg --files trainer-app/src -g "*.test.ts" -g "*.test.tsx" | rg "<feature>"`

4. Read surface (page/route)
5. Trace inward to shared owner
6. Read nearby tests

---

## Ownership layers

- `src/app` → surface only
- `src/app/api` → entrypoint only
- `src/lib/api` → orchestration + read models
- `src/lib/engine` → pure logic
- `src/lib/session-semantics` → meaning
- `src/lib/ui` → display semantics
- `prisma` → persistence

---

## REQUIRED OUTPUT

You MUST return:

- **Request surface**
- **Canonical owner (file + function)**
- **Supporting seams**
- **Inputs**
- **Consumers**
- **Tests to update**
- **Docs to update**
- **Do NOT implement in**
- **Recommended change shape**

---

## Decision rules

- Prefer extending an existing seam
- Prefer server/lib over UI
- Prefer shared read model over local computation
- Prefer lifting duplication over patching consumers

---

## Tie-break rule

If multiple valid owners exist:
- choose the one already used by the most consumers
- or closest to persistence / canonical data

---

## Exit condition

Do not proceed until:

- one canonical owner is identified
- tests for that seam are known
- verification path is clear

If ambiguous:
- present top 2 options
- choose one with justification