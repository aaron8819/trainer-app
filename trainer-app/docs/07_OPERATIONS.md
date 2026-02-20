# 07 Operations

Owner: Aaron  
Last reviewed: 2026-02-20  
Purpose: Operational runbook for local development/runtime setup, migrations, seed, and verification for this single-user app.

This doc covers:
- Environment variables and DB connection behavior
- Migration/seed workflow
- Operational verification commands

Invariants:
- `DATABASE_URL` is required for runtime.
- Prisma client generation must be in sync with schema changes.
- Contract verification should be run with tests for release hygiene.

Sources of truth:
- `trainer-app/.env.example`
- `trainer-app/src/lib/db/prisma.ts`
- `trainer-app/prisma/schema.prisma`
- `trainer-app/prisma/migrations`
- `trainer-app/prisma/seed.ts`
- `trainer-app/package.json`

## Environment
- Required: `DATABASE_URL`
- Optional SSL override: `DATABASE_SSL_NO_VERIFY`
- Single-user owner identity: `OWNER_EMAIL`

## Local setup
1. `npm install`
2. `npm run prisma:generate`
3. Apply migrations (`npx prisma migrate deploy` or local dev flow)
4. Optional seed: `npm run db:seed`
5. Start app: `npm run dev`

## Verification and maintenance
- `npm run verify`: lint + test + contracts
- `npm run verify:exercise-library`: validates exercise library integrity
- `npm run repair:exercise-library` (and `:apply`) for repair workflow
- Keep `docs/contracts/runtime-contracts.json` aligned with `src/lib/validation.ts`
- Recent schema changes to apply in order include:
  - `prisma/migrations/20260220_add_partial_workout_status/migration.sql`
  - `prisma/migrations/20260220_workout_revision_and_exercise_order_unique/migration.sql`
