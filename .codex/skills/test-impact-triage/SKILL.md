---
name: test-impact-triage
description: Select the minimum sufficient verification stack for a proposed or completed `trainer-app` change. Use when deciding what tests to run, whether seam-boundary coverage is needed, or whether `npm run verify:contracts`, full `npm run verify`, or audit validation is required based on changed files and canonical seam ownership.
---

# Test Impact Triage

Decide verification scope after the changed seam is already known or can be inferred from the touched files. Bias toward the smallest meaningful stack, then escalate only when shared seams, contract boundaries, persistence, or generation-facing behavior make narrow tests insufficient.

## Use this skill

Use this skill when the task is selecting verification scope for a proposed or completed `trainer-app` change.

Good fits:
- deciding the minimum sufficient test run
- deciding whether targeted tests are enough
- deciding whether seam-boundary tests are required
- deciding whether `npm run verify:contracts` or `npm run verify` is required
- deciding whether audit CLI or manual domain validation is mandatory

Do not use this skill:
- to find the canonical owner from scratch when ownership is unclear; use `seam-locator` first
- to plan code edits; use `implementation-planner`
- to enforce layering during implementation; use `architecture-guard`
- as the generation QA gate itself; use `workout-generation-audit`
- as a generic testing skill when there is no concrete change, diff, or touched surface to triage
- for architecture-only, design-only, or brainstorming discussions with no concrete proposed change, diff, or touched surface

## Hard rule

Do not recommend `npm run verify` or broad test sweeps by default. Start with the narrowest verification that exercises the changed owner and widen only when a seam boundary, runtime contract, persistence change, or generation-facing risk makes targeted tests insufficient.

## Inputs to read first

1. Read `AGENTS.md`.
2. Read the changed files, diff, or proposed file list.
3. Read the owning seam and nearby tests.
4. Read `trainer-app/docs/00_START_HERE.md` when you need the canonical doc map or likely doc-update target.
5. Read `trainer-app/docs/06_TESTING.md` when command selection or escalation thresholds are unclear.
6. Read the canonical doc for the changed seam when behavior, contracts, or operational validation may change.
7. Search affected consumers and tests:
   - `rg "<feature|symbol|state>" trainer-app/src trainer-app/docs`
   - `rg --files trainer-app/src | rg "<feature|folder|file-basename>"`
   - `rg --files trainer-app/src -g "*.test.ts" -g "*.test.tsx" | rg "<feature|folder|file-basename>"`

If the user gives only touched files, infer the seam from those files before selecting verification.
If no diff exists yet, use the intended seam and likely boundary crossings to produce a provisional recommendation, mark assumptions explicitly, and say that the stack should be re-triaged after implementation.

## Triage workflow

Work in one of two modes:
- completed-change mode: use the actual diff, touched files, and observed seam crossings
- proposed-change mode: use the intended files/seams, likely boundary crossings, and explicit assumptions

1. Classify the highest-risk touched surface, not the noisiest file.
2. Map touched files to canonical seams:
   - `src/app` pages/components -> UI surface
   - `src/app/api/**/route.ts` -> route boundary
   - `src/lib/api` -> orchestration/read-model boundary
   - `src/lib/engine`, `src/lib/session-semantics`, `src/lib/progression` -> shared domain seam
   - `src/lib/ui` -> shared read-side/display seam
   - `src/lib/audit/workout-audit` or `scripts/workout-audit.ts` -> audit seam
   - `src/lib/validation.ts`, `docs/contracts/runtime-contracts.json` -> contract seam
   - `prisma/schema.prisma`, migrations, Prisma scripts -> persistence seam
   - `trainer-app/docs/**` -> documentation seam
3. Find the nearest focused tests for the owner.
4. Decide whether one or more seam boundaries were crossed:
   - surface -> shared lib
   - route -> validation or lib/api
   - shared lib -> multiple consumers
   - persistence -> API/lib readers and writers
   - audit artifact -> generation/lifecycle/read-side consumers
5. Add only the smallest extra verification needed to cover those boundaries.
6. When helpful, separate what is required now for safe iteration from what is required before merge or task completion.
7. State what the selected stack still does not prove.

## Change classes and escalation rules

### 1. Local unit-level change

Typical shape:
- single component, hook, helper, or isolated function
- behavior stays inside one local owner
- no request/response contract, persisted shape, or shared semantics change

Minimum:
- run the nearest focused test file(s)

Escalate when:
- the helper is reused across multiple surfaces
- the changed file has route or UI consumers that encode behavior at the boundary
- the diff changes behavior that nearby unit tests cannot observe

### 2. Route / handler / API boundary change

Typical shape:
- `src/app/api/**/route.ts`
- request parsing, validation wiring, owner resolution, or response shaping
- route-level conflicts or terminal transition behavior

Minimum:
- run the route test or integration test
- run the owning lib/api or validation tests that back the route behavior

Targeted tests alone are not enough when:
- route payload shape changes
- validation or normalization changed
- route behavior depends on shared lifecycle, receipt, or semantics helpers

Add boundary tests that exercise the route and its canonical owner together.

### 3. Shared lib / canonical seam change

Typical shape:
- `src/lib/api`
- `src/lib/engine`
- `src/lib/session-semantics`
- `src/lib/progression`
- shared `src/lib/ui` read models used by multiple surfaces

Minimum:
- run the owner seam tests
- run at least one high-value consumer or boundary test for each changed behavior path

Prefer a small set of proving consumer tests over a blanket suite when only a few consumers carry the risk.

Require broader escalation when:
- the seam is reused widely
- the change touches lifecycle, progression, generation, validation, or receipt-backed meaning
- a consumer-visible contract is derived from the shared seam

### 4. Persistence / Prisma / data-shape change

Typical shape:
- `prisma/schema.prisma`
- migrations
- Prisma-backed scripts
- persisted JSON shape or normalization logic

Minimum:
- run focused tests for the owning persistence adapters or routes
- run affected read/write boundary tests
- run `npm run prisma:generate` when schema changed

Escalate when:
- Prisma enums or validation-backed persisted contract values changed
- multiple read and write consumers depend on the changed shape
- migrations or persistence semantics affect lifecycle, history, or audit behavior

### 5. Audit / reporting / read-model change

Typical shape:
- `src/lib/audit/workout-audit/**`
- `scripts/workout-audit.ts`
- `src/lib/api` read models
- `src/lib/ui` summary/list/explainability adapters
- route responses that expose read-side assembled data

Minimum:
- run the nearest read-model or audit tests
- run the consumer boundary test if the read model feeds a route or UI surface

Escalate when:
- audit artifact meaning, generated output, lifecycle interpretation, or progression interpretation changed
- a read-side surface must stay aligned with a canonical engine/api seam
- reporting logic depends on persisted snapshots, receipts, or reconciliation data

Audit-related read-side tests alone are not enough when runtime-generated or lifecycle-owned truth changed; add the matching audit CLI flow.

### 6. Docs-only change

Minimum:
- no code verification if the change is truly docs-only and does not claim behavior changed

Escalate when:
- docs were updated because behavior, commands, contracts, or canonical semantics changed elsewhere
- the docs update exposes that the underlying code or verification command also changed and needs validation

Docs changes do not erase the need for code verification; they follow it.

## Mandatory escalation triggers

### Add seam-boundary tests when

- a route delegates to a changed shared seam
- a shared read model feeds multiple surfaces
- a local unit test cannot observe the regression risk at the owning boundary
- the change spans write-side and read-side meaning
- the diff touches receipt-backed, lifecycle, or mutation-reconciliation behavior

### Require `npm run verify:contracts` when

- `src/lib/validation.ts` changed
- `trainer-app/docs/contracts/runtime-contracts.json` changed
- runtime enum values changed
- API request/response contract values changed in a validation-backed way
- Prisma enum changes must stay aligned with validation/docs contracts

If unsure whether the change is validation-backed, inspect the schema or enum source instead of guessing.

### Require full `npm run verify` when

- a shared engine/api seam changed and is broadly reused
- lifecycle, progression, generation, validation, or shared contract behavior changed
- focused tests do not cover the plausible blast radius
- the task modifies a canonical helper consumed across multiple routes or read-side surfaces

Do not require full `verify` just because multiple files changed. Require it because shared-seam or contract blast radius justifies it.

### Require audit CLI or domain-specific validation when

- generation, projected session output, progression, deload routing, slot-plan/runtime composition, week-close handoff, or audit artifact logic changed
- a read-side explanation or summary must stay aligned with generation-owned truth
- focused tests pass but the real confidence question is about generated output or persisted lifecycle semantics

Use the narrowest matching audit:
- `npm run audit:workout -- --env-file .env.local --mode future-week --owner owner@local`
- `npm run audit:workout -- --env-file .env.local --mode deload --owner owner@local --intent <intent>`
- `npm run audit:workout -- --env-file .env.local --mode progression-anchor --owner owner@local --exercise-id <exercise-id> --workout-id <workout-id>`
- `npm run audit:week-close-handoff -- --env-file .env.local --owner owner@local --target-week <n>`
- `npm run test:audit:matrix` when diagnostics gating or cross-intent audit stability changed

If the change is generation-facing, pair this skill with `workout-generation-audit` instead of re-inventing the QA gate locally.

## Docs follow-up rule

Call out doc updates when the change affects:
- behavior or semantics in canonical docs `01-05`
- test commands or verification expectations in `trainer-app/docs/06_TESTING.md`
- operational or audit workflows in `trainer-app/docs/07_OPERATIONS.md`, `trainer-app/docs/08_AUDIT_CLI_DB_VALIDATION.md`, or `trainer-app/docs/09_AUDIT_PLAYBOOK.md`
- validation-backed contract values in `trainer-app/docs/contracts/runtime-contracts.json`

## Required output

Return exactly this structure:

1. **Change classification**
2. **Impacted seams / surfaces**
3. **Minimum targeted tests**
4. **Additional required verification**
5. **Whether `verify:contracts` is required**
6. **Whether full `verify` is required**
7. **Whether audit CLI / manual validation is required**
8. **Residual risk / what this stack does not prove**

Under each section:
- name concrete files, tests, and commands when known
- order commands from smallest to broadest
- explain each escalation in one sentence
- separate required from nice-to-have
- when useful, distinguish `required now` from `required before merge`; omit the split when both are the same
- say `none` explicitly when a broader layer is not required

## Quality bar

A good verification recommendation:
- starts with the owning seam, not the diff size
- names the smallest focused tests that prove the change
- adds boundary tests only when the regression can cross a seam
- calls `verify:contracts` only for real contract drift risk
- calls full `verify` only for shared-seam blast radius
- names audit commands only when runtime-output confidence depends on them

A bad verification recommendation:
- defaults to `npm run verify` for every non-trivial task
- equates "many files changed" with "broad verification required"
- ignores route/lib or read/write boundaries
- forgets docs when behavior or verification commands changed
- recommends audit CLI for non-generation read-only changes with no runtime-output risk
