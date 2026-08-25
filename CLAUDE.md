# AGENTS.md

## Repo Scope
- Most active code lives in `trainer-app/`. Run app, test, Prisma, and audit commands from that directory.
- This repo is a single-user, local-first personal training app built with Next.js App Router, Prisma, and Postgres.
- The fastest canonical doc entry point is `trainer-app/docs/00_START_HERE.md`.

## Repo Map
- `trainer-app/src/app`: App Router pages and route handlers only.
- `trainer-app/src/app/api/**/route.ts`: request parsing, validation, owner resolution, and orchestration entrypoints.
- `trainer-app/src/lib/api`: DB-backed orchestration, read models, lifecycle, and runtime composition.
- `trainer-app/src/lib/engine`: pure generation/progression/periodization/readiness logic. Keep persistence out.
- `trainer-app/src/lib/session-semantics`, `src/lib/progression`, `src/lib/ui`, `src/lib/audit`: shared semantic seams.
- `trainer-app/prisma`: schema, migrations, seed, and one-off repair/backfill scripts.
- `trainer-app/docs/01-09`: canonical runtime docs. `docs/archive/` is historical context, not active contract truth.

## Explore Before Editing
- Do not change code until you have identified the owning seam, read the current route/page, the owning `src/lib/*` implementation, and the nearby tests.
- Start with `trainer-app/docs/00_START_HERE.md`, then read the owning canonical doc for the seam you are changing.
- Confirm an existing canonical helper does not already own the behavior before adding or moving logic.
- Use `rg` first. Typical passes:
- `rg "<feature|symbol|state>" trainer-app/src trainer-app/docs`
- `rg --files trainer-app/src | rg "<feature>"`
- `rg --files trainer-app/src -g "*.test.ts" -g "*.test.tsx" | rg "<feature>"`

## Skills
- Use `architecture-guard` when ownership is unclear or a non-trivial change crosses canonical seams or consumers.
- Use `receipt-integrity` only when receipt creation, persistence, reconciliation, meaning, or receipt-derived consumers can change.
- Use `seed-runtime-source-of-truth` for accepted seed revision, correction, replay, provenance, or session-local deviation boundaries.
- Use `v2-planner-migration-guard` for pure V2 planning, materialization/acceptance boundaries, or controlled promotion of V2 evidence.
- Use `test-impact-triage` to review the deterministic verification plan after the owning seam and diff are known.
- Use `audit-workflow` to choose authorized audit modes, interpret artifacts, and validate generation-facing output.
- Use `trainer-loop-triage` only when asked to select or design bounded next-work loops or `/goal` prompts.

## Canonical Boundaries
- Resolve runtime identity via `resolveOwner()` in `trainer-app/src/lib/api/workout-context.ts`. Do not add alternate user-resolution paths in app routes.
- Keep route handlers thin. Business logic belongs in `src/lib/api`; pure decision logic belongs in `src/lib/engine`.
- `selectionMetadata.sessionDecisionReceipt` is the canonical stored session-decision/evidence payload. Do not introduce parallel top-level mirrors for session context.
- `deriveSessionSemantics()` is the owner for session-level meaning such as advancing vs non-advancing, progression-history eligibility, and slot consumption.
- `loadNextWorkoutContext()` is the canonical next-session derivation seam.
- When an immutable revision exists, runtime exercise composition is owned by `Mesocycle.currentSeedRevision.seedPayload` plus canonical slot-runtime resolution. `Mesocycle.slotPlanSeedJson` is compatibility or historical state in that case; legacy/no-revision fallback must not become competing runtime truth.
- Mesocycle lifecycle transitions belong in `mesocycle-lifecycle*` and `mesocycle-handoff*`, not in page/UI heuristics.
- Closed-mesocycle save/log/resume fences belong at route/workflow contracts, not client-only checks.
- Validation-backed enum/runtime contract values are centralized in `trainer-app/docs/contracts/runtime-contracts.json` and `trainer-app/src/lib/validation.ts`.

## Search-First Workflow
- Locate all callsites of a symbol or behavior before modifying it.
- If a behavior appears in generation, save, explainability, review, and history, assume there is already a canonical seam and find it first.
- For read-side/UI work, prefer extending an existing read model in `src/lib/api` or `src/lib/ui` instead of recomputing domain semantics inside components.
- Treat nearby `*.test.ts` and `*.test.tsx` files as the contract: read them before changing behavior, then update them when behavior changes.

## Change Safety Rules
- Do not introduce a second source of truth.
- Do not move logic across `src/app`, `src/lib/api`, and `src/lib/engine` without a clear ownership reason.
- Do not introduce new enums, flags, or booleans for domain meaning if a canonical semantic helper already exists.
- If a value is persisted and treated as canonical, derive from it instead of recomputing it elsewhere.

## Debugging Workflow
- Reproduce with the smallest focused test first, then widen only as needed.
- Default loop:
- run a focused Vitest file for the changed seam
- run related route/integration tests if the change crosses API boundaries
- use the repository verification plan for shared contracts, lifecycle, generation, or broadly reused helpers; run `npm run verify` only when selected and do not repeat equivalent exact-tree evidence
- For generation/lifecycle questions, use the audit CLI before inventing debug code. Start with `trainer-app/docs/09_AUDIT_PLAYBOOK.md`.
- Useful commands from `trainer-app/`:
- `npm run test -- <path>`
- `npm run test:fast`
- `npm run verify`
- `npm run verify:contracts`
- `npm run audit:workout -- --env-file .env.local --mode future-week --owner owner@local`
- `npm run audit:week-close-handoff -- --env-file .env.local --owner owner@local --target-week <n>`

## Domain Semantics That Matter Often
- The app is receipt-first: generation, save, explainability, workout review, and audits all rely on the persisted session decision receipt.
- Mesocycle lifecycle is explicit: `ACTIVE_ACCUMULATION -> ACTIVE_DELOAD -> AWAITING_HANDOFF -> COMPLETED`.
- Deload completion closes into `AWAITING_HANDOFF`; successor mesocycles are created only by explicit accept-next-cycle flow.
- Optional gap-fill and supplemental deficit sessions are intentionally non-advancing. Their meaning is reconstructed from persisted fields plus canonical classifiers, not new workout enums.
- `advancesSplit` is a write-side contract. Read-side consumers should derive session meaning via canonical semantics helpers rather than ad hoc booleans.

## Validation Expectations
- If you change API contracts, receipt shape, or validation enums, update tests and run `npm run verify:contracts`.
- If you change shared engine/api seams, run focused tests and the checks selected by repository policy. Reuse valid exact-tree evidence for expensive hermetic checks.
- If you change Prisma schema or migrations, run `npm run prisma:generate` and keep migration state in sync before trusting runtime behavior.
- Standalone Prisma scripts in this repo must follow the adapter pattern documented in `trainer-app/docs/07_OPERATIONS.md`; do not use bare `new PrismaClient()` here.

## Definition of Done
- The behavior is implemented in the correct canonical seam, not patched into an incidental consumer.
- All callsites of modified symbols or behaviors have been reviewed for consistency.
- No duplicate or conflicting semantics were introduced across route, orchestration, engine, UI, or audit layers.
- Existing affected tests pass, and changed behavior is covered by new or updated nearby tests.
- Repository-selected verification is complete, including reused valid exact-tree evidence and any checks invalidated by the change.
- Docs are updated when behavior or contracts change, after the code and tests reflect the final behavior.

## Docs Updates
- When behavior changes, update the canonical doc for that seam in `trainer-app/docs/`, not an archive note.
- Common mappings:
- engine/generation/progression/readiness: `docs/02_DOMAIN_ENGINE.md`
- schema/migrations/runtime persistence: `docs/03_DATA_SCHEMA.md`
- route payloads/contracts: `docs/04_API_CONTRACTS.md`
- page flow or review/setup UX: `docs/05_UI_FLOWS.md`
- test strategy/commands: `docs/06_TESTING.md`
- operational scripts or repair flows: `docs/07_OPERATIONS.md`
- audit workflow or artifact interpretation: `docs/08_AUDIT_CLI_DB_VALIDATION.md` or `docs/09_AUDIT_PLAYBOOK.md`
- Do not duplicate enum lists across multiple prose files; use the canonical contract docs.
- Do not update docs as a substitute for verifying behavior in code and tests first.

## Common Failure Modes
- Adding new logic in a consumer instead of extending the canonical seam.
- Recomputing domain semantics in UI/components instead of shared `src/lib/*` helpers.
- Introducing parallel state to `selectionMetadata.sessionDecisionReceipt`.
- Putting business logic in routes instead of `src/lib/api`.
- Changing behavior without reading the nearby tests that already define the contract.

## Avoid
- Do not add new session-policy mirrors outside `selectionMetadata.sessionDecisionReceipt`.
- Do not scatter advancing/gap-fill/supplemental/deload policy across routes, UI, analytics, and history when a shared semantic seam already exists.
- Do not bypass `resolveOwner()` in app surfaces.
- Do not create UI-local progression or lifecycle rules that can drift from `src/lib/api` and `src/lib/engine`.
- Do not treat `MesocycleExerciseRole` as the seeded runtime composition source for supported accepted mesocycles; it is fallback/projection-only after the slot-plan migration.
- Do not treat `docs/archive/` as current contract truth.
