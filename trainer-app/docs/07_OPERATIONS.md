# 07 Operations

Owner: Aaron
Last reviewed: 2026-03-07
Purpose: Operational runbook for local development/runtime setup, migrations, seed, and verification for this single-user app.

This doc covers:
- Environment variables and DB connection behavior
- Migration/seed workflow
- Operational verification commands

Invariants:
- `DATABASE_URL` is required for runtime.
- Prisma client generation must be in sync with schema changes.
- Standalone Prisma scripts must use the adapter pattern from `src/lib/db/prisma.ts` (with `@prisma/adapter-pg` + `pg` pool), not bare `new PrismaClient()`.
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
- Required for `prisma migrate dev` against Supabase: `SHADOW_DATABASE_URL` (or `SHADOW_URL`) so Prisma can create/apply shadow migrations (`prisma.config.ts`).
- Optional SSL override: `DATABASE_SSL_NO_VERIFY`
- Single-user owner identity: `OWNER_EMAIL`
- Optional strict stimulus coverage gate: `STRICT_STIMULUS_PROFILE_COVERAGE` (fails generation-context loading when planner-eligible exercises are missing explicit stimulus profile coverage)

## Local setup
1. `npm install`
2. `npm run prisma:generate`
3. Apply migrations (`npx prisma migrate deploy` or local dev flow)
4. Optional seed: `npm run db:seed`
5. Start app: `npm run dev`

Migration hygiene:
- After pulling any branch with new files under `prisma/migrations/`, run `npx prisma migrate deploy` before relying on the app runtime.
- If the Prisma schema/client include a model but the database is missing its table, runtime reads will fail with `PrismaClientKnownRequestError` reporting that the table does not exist.

## Verification and maintenance
- `npm run verify`: lint + type-check (`tsc --noEmit`) + `test:fast` + contracts
- `npm run verify:exercise-library`: validates exercise library integrity
- `npm run report:stimulus-coverage`: reports planner-eligible exercise stimulus-profile coverage and remaining centralized fallback usage
- `npm run audit:workout -- --mode next-session --owner owner@local`: generate structured workout-audit artifact under `artifacts/audits/`
- `npm run audit:workout -- --mode intent-preview --owner owner@local --intent push`: explicit-intent audit artifact
- `npm run repair:exercise-library` (and `:apply`) for repair workflow
- Keep `docs/contracts/runtime-contracts.json` aligned with `src/lib/validation.ts`
- Current baseline migration history is squashed to `prisma/migrations/20260222_baseline/migration.sql`; historical per-feature migration folders are archived at `docs/archive/prisma-migrations-backup/` (see `docs/archive/MIGRATIONS_BACKUP_ARCHIVE.md`).
- Lifecycle backfill/role management scripts:
  - `prisma/reset-backfill-mesocycle-lifecycle.ts`: reset and rebuild mesocycle lifecycle state from existing performed workouts.
  - `prisma/repair-mesocycle-rir-bands.ts`: repair legacy 5-week `rirBandConfig` JSON to the corrected duration-aware default week bands.
  - `prisma/backfill-week2-pull.ts`: example manual session backfill flow.
  - `prisma/update-pull-exercise-roles.ts` and `prisma/update-push-exercise-roles.ts`: canonical mesocycle exercise role updates.
  - `prisma/audit-mesocycle.ts`: diagnostic — prints active mesocycle state, lifecycle counters, and recent workout snapshots.
  - `prisma/fix-workout-388f.ts`: one-off data repair (corrects `mesocycleId` + snapshots after lifecycle counter backfill).
- Generated local artifacts under `trainer-app/output/` are ignored via the repo root `.gitignore` and are not part of the operational source of truth.
- Lifecycle verification query pattern (mesocycle state, counters, snapshots, roles):
```sql
-- Mesocycle lifecycle state + counters
select id, state, "accumulationSessionsCompleted", "deloadSessionsCompleted", "sessionsPerWeek", "daysPerWeek", "splitType"
from "Mesocycle"
where "isActive" = true
order by "updatedAt" desc nulls last;

-- Recent workout lifecycle snapshots
select id, status, "mesocycleId", "mesocyclePhaseSnapshot", "mesocycleWeekSnapshot", "mesoSessionSnapshot", "scheduledDate"
from "Workout"
where "mesocycleId" is not null
order by "scheduledDate" desc
limit 50;

-- Exercise role continuity
select "mesocycleId", "sessionIntent", role, "exerciseId", "addedInWeek"
from "MesocycleExerciseRole"
order by "mesocycleId", "sessionIntent", role, "addedInWeek", "exerciseId";
```

## Standalone Prisma scripts
Use this pattern for one-off scripts in `prisma/` (backfills, diagnostics, cleanup).

Why adapter pattern is required:
- The Next.js app uses `@prisma/adapter-pg` with a `pg` `Pool`.
- In Prisma 7, bare `new PrismaClient()` fails in this setup without an adapter.
- Standalone scripts must mirror `src/lib/db/prisma.ts`.

Standard script header (copy exactly):
```ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
```

Standard run command:
```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED='0'; node -r dotenv/config .\node_modules\tsx\dist\cli.mjs prisma/your-script.ts
```

Command notes:
- `NODE_TLS_REJECT_UNAUTHORIZED=0`: local Postgres uses a self-signed cert; this suppresses the SSL warning. Not needed in production.
- `-r dotenv/config`: loads `.env.local` then `.env` so `DATABASE_URL` is available without manual export.

User resolution in scripts:
```ts
prisma.user.findFirst({
  orderBy: { createdAt: "asc" },
  where: { email: { not: { endsWith: "@test.com" } } },
})
```

Never use bare `findFirst()` for user resolution:
- Test users exist in the live DB and may be returned first.
