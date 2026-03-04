# 00 Start Here

Owner: Aaron  
Last reviewed: 2026-03-04  
Purpose: Canonical entry point for the Trainer app docs. Use this file to find current docs, update docs after code changes, and prevent drift.

This doc covers:
- Documentation map and ownership for `trainer-app/docs`
- Review checklist for schema, API, engine, and UI changes
- Drift prevention rules

Invariants:
- Code is source of truth. If docs conflict with code, docs must change.
- Each canonical doc must include concrete code references.
- Contracts are defined once in `docs/contracts/runtime-contracts.json` and referenced, not duplicated.

Sources of truth:
- `trainer-app/prisma/schema.prisma`
- `trainer-app/src/lib/validation.ts`
- `trainer-app/src/app/api`
- `trainer-app/src/lib/api`
- `trainer-app/src/lib/engine`

## Canonical docs
- `docs/01_ARCHITECTURE.md`: runtime architecture and boundaries
- `docs/02_DOMAIN_ENGINE.md`: generation, selection, progression, readiness, periodization, explainability
- `docs/03_DATA_SCHEMA.md`: Prisma models and runtime persistence invariants
- `docs/04_API_CONTRACTS.md`: API surface + validation contracts
- `docs/05_UI_FLOWS.md`: App Router pages and major user flows
- `docs/06_TESTING.md`: test strategy and run commands
- `docs/07_OPERATIONS.md`: env, migrations, seed, verification, production hygiene
- `docs/contracts/runtime-contracts.json`: canonical enum/runtime contract values

Reference-only docs:
- `docs/research/` is non-canonical reference material and not a source of runtime truth.

Archived roadmap/design logs:
- `docs/archive/08_MESOCYCLE_SIMPLIFICATION_ROADMAP.md`
- `docs/archive/09_HISTORY_ANALYTICS_DASHBOARD_ROADMAP.md`
- `docs/archive/10_WORKOUT_AUDIT_HARNESS_DESIGN.md`
- `docs/archive/11_HYPERTROHPY_SESSION_GENERATION_ENGINE_REFACTOR`
- These files are historical decision logs and implementation history, not active contract sources.
- Durable outcomes from these docs are captured in canonical docs `01/02/04/05/06/07`.

## Docs Review Checklist

### When to update docs
- Schema change: any edit under `prisma/schema.prisma` or new migration under `prisma/migrations`
- API contract change: any Zod schema edit in `src/lib/validation.ts` or API route payload change in `src/app/api`
- Engine logic change: any edit in `src/lib/engine` or orchestration behavior in `src/lib/api`
- UI flow change: any route/page or major workflow change under `src/app` or `src/components`

### What to update
- Schema/model changes: update `docs/03_DATA_SCHEMA.md` and, when enum-related, `docs/contracts/runtime-contracts.json`
- Request/response contract changes: update `docs/04_API_CONTRACTS.md` and `docs/contracts/runtime-contracts.json` when enums changed
- Generation/progression/readiness logic changes: update `docs/02_DOMAIN_ENGINE.md`
- Route/navigation/user flow changes: update `docs/05_UI_FLOWS.md`
- Operational or script changes: update `docs/07_OPERATIONS.md`
- Test command/config changes: update `docs/06_TESTING.md`

### How to prevent contradictions
- Link directly to implementation paths (not prose-only restatements)
- Keep one canonical location per topic
- Do not copy enum values into multiple files; reference `docs/contracts/runtime-contracts.json`
- Prefer short invariants over speculative roadmap language
- Before archiving roadmap/design docs, migrate durable invariants and contracts into canonical docs `01-07`.
