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

## Skills (mandatory usage)
- Use `seam-locator` before any change where ownership is not obvious
- Use `architecture-guard` before and during all non-trivial code edits
- Use `workout-generation-audit` for any non-trivial change that can affect generated or projected training output.
- Use `implementation-planner` before any non-trivial change that requires more than one edit step or touches multiple files, seams, tests, routes, docs, or verification commands.
- Use `receipt-integrity` for any change that touches `selectionMetadata.sessionDecisionReceipt`, receipt-backed meaning, or consumers that depend on persisted session-decision context.

## Canonical Boundaries
- Resolve runtime identity via `resolveOwner()` in `trainer-app/src/lib/api/workout-context.ts`. Do not add alternate user-resolution paths in app routes.
- Keep route handlers thin. Business logic belongs in `src/lib/api`; pure decision logic belongs in `src/lib/engine`.
- `selectionMetadata.sessionDecisionReceipt` is the canonical stored session-decision/evidence payload. Do not introduce parallel top-level mirrors for session context.
- `deriveSessionSemantics()` is the owner for session-level meaning such as advancing vs non-advancing, progression-history eligibility, and slot consumption.
- `loadNextWorkoutContext()` is the canonical next-session derivation seam.
- For accepted mesocycles with supported intents, runtime exercise composition is owned by `Mesocycle.slotPlanSeedJson` plus canonical slot-runtime resolution. Do not reintroduce `MesocycleExerciseRole`, raw intent composition, or UI-local heuristics as a second seeded runtime source of truth.
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
- run `npm run verify` when you touch shared contracts, lifecycle, generation, or broadly reused helpers
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
- If you change shared engine/api seams, run the focused tests plus `npm run verify`.
- If you change Prisma schema or migrations, run `npm run prisma:generate` and keep migration state in sync before trusting runtime behavior.
- Standalone Prisma scripts in this repo must follow the adapter pattern documented in `trainer-app/docs/07_OPERATIONS.md`; do not use bare `new PrismaClient()` here.

## Definition of Done
- The behavior is implemented in the correct canonical seam, not patched into an incidental consumer.
- All callsites of modified symbols or behaviors have been reviewed for consistency.
- No duplicate or conflicting semantics were introduced across route, orchestration, engine, UI, or audit layers.
- Existing affected tests pass, and changed behavior is covered by new or updated nearby tests.
- `npm run verify` is run when shared seams, lifecycle, generation, validation, or contracts are touched.
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
