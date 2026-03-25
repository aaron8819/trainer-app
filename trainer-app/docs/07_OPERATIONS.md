# 07 Operations

Owner: Aaron
Last reviewed: 2026-03-16
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
- `npm run audit:workout` is the unified workout-audit CLI entrypoint. Recurring audit workflow lives in `docs/09_AUDIT_PLAYBOOK.md`; direct DB-backed CLI validation lives in `docs/08_AUDIT_CLI_DB_VALIDATION.md`.
- Audit CLIs now follow app-default owner resolution when neither `--user-id` nor `--owner` is provided: use `OWNER_EMAIL` from env when present, otherwise fall back to `owner@local`. Explicit `--user-id` and `--owner` still take precedence.
- `npm run audit:week`: fast current-week operator loop. Runs `projected-week-volume` with `.env.local`, the app-default owner resolution path, and a compact CLI verdict before the artifact path.
- `npm run audit:week:debug`: same current-week operator path plus an expanded CLI drill-down for below-MEV groups, below-target-only groups, warnings, projection notes, and projected slot order.
- `npm run audit:workout -- --env-file .env.local --mode historical-week --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id>`: completed-week audit artifact
- `npm run audit:workout -- --env-file .env.local --mode future-week`: next generated session / week artifact for the app-default owner
- `npm run audit:workout -- --env-file .env.local --mode future-week --user-id <user-id>`: next generated session / week artifact
- `npm run audit:workout -- --env-file .env.local --mode future-week --user-id <user-id> --intent pull`: explicit-intent future-week artifact through the same canonical mode
- `npm run audit:workout -- --env-file .env.local --mode projected-week-volume`: canonical full current-week projected volume artifact for the app-default owner
- `npm run audit:workout -- --env-file .env.local --mode deload --user-id <user-id> --intent pull`: explicit deload preview artifact
- `npm run audit:workout -- --env-file .env.local --mode progression-anchor --user-id <user-id> --exercise-id <exercise-id> --workout-id <workout-id>`: single-exercise progression trace artifact
- `npm run audit:split-sanity -- --env-file .env.local --owner owner@local --debug`: run bundled split sanity audit for `push,pull,legs` and write one compact summary artifact under `artifacts/audits/split-sanity/`
- `npm run audit:sequencing`: emit the dedicated order-sensitivity matrix under `artifacts/audits/sequencing/`
- `npm run audit:accounting -- --selection-mode MANUAL --status COMPLETED --advances-split false --optional-gap-fill true`: emit the focused accounting semantics audit under `artifacts/audits/accounting/`
- `npm run audit:week-close-handoff -- --env-file .env.local --owner owner@local --target-week 3`: inspect the final-advancing-session -> week-close -> optional-gap-fill handoff for one real user/week and flag `historical_mixed_contract_state` when a strict gap-fill workout exists without a persisted week-close owner
- `npm run repair:week-close-handoff -- --env-file .env.local --owner owner@local --target-week 3`: dry-run targeted week-close ownership reconciliation for one user/week
- `npm run repair:week-close-handoff -- --env-file .env.local --owner owner@local --target-week 3 --apply`: apply the targeted reconciliation using canonical week-close persistence/resolution helpers
- Post-repair verification: rerun `npm run audit:week-close-handoff -- --env-file .env.local --owner owner@local --target-week 3` and confirm the missing-row detector no longer fires
- Add `--intents push,pull,legs` to override the default bundle and `--write-rich-artifacts` to also persist the full per-intent workout-audit JSON files under `artifacts/audits/split-sanity/rich/`
- Add `--debug` when you need full layered planner diagnostics in the artifact/receipt. Default mode is compact `standard`.
- Workout and split-sanity audit artifacts now include a top-level `conclusions` block that records the canonical runtime basis for next-session, weekly volume, recovery, progression, week-close, sequencing, and `advancesSplit` semantics.
- Workout-audit artifacts also persist `warningSummary` with merged counts and warning messages; use the CLI summary for quick triage and the artifact for durable review.
- For the common weekly operator path, prefer `npm run audit:week`: read the compact `below_mev`, `below_target_only`, `over_mav`, `over_target_only`, and `recommendation` lines first, then open the JSON artifact only when the CLI says deeper investigation is warranted.
- When the fast loop recommends inspection, prefer `npm run audit:week:debug` before opening the JSON artifact. It keeps the same canonical run but expands the CLI with full underdosed-group detail, warning text, projection notes, and projected session order.
- Non-blocking warning noise is summarized as `blocking_errors`, `semantic_warnings`, and `background_warnings` in CLI output; use `--debug` to keep raw warning detail on stdout.
- Split-sanity summary artifacts encode explicit verdict checks for:
  - block/week context presence and consistency
  - lifecycle RIR plausibility for the active block profile
  - no unexpected target drop in accumulation
  - same-intent capacity exhaustion when `futureCapacity = 0` and week-close fallback becomes the canonical next subsystem
  - unexpected rescue usage
- Current planner diagnostics blocks in audit artifacts:
  - `opportunity`: session intent, character, and remaining-week scarcity inputs
  - `anchor`: fixture/anchor decisions and floor-envelope outcomes
  - `standard` / `supplemental` / `rescue`: inventory-layer usage and candidate summaries
  - `closure`: selected actions and, in debug mode, first-iteration candidate trace
  - `outcome`: deficit snapshots through base session, supplementation, and closure plus key tradeoffs
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

## Week-close handoff workflow
- `npm run audit:week-close-handoff -- --env-file .env.local --owner owner@local --target-week 3`: audit dry-run for one concrete owner/week. This reads canonical runtime state and writes a handoff artifact without mutating data.
- `npm run repair:week-close-handoff -- --env-file .env.local --owner owner@local --target-week 3`: repair dry-run. This shows whether the audited state matches `historical_mixed_contract_state` and what canonical repair actions would run.
- `npm run repair:week-close-handoff -- --env-file .env.local --owner owner@local --target-week 3 --apply`: repair apply. This performs the targeted reconciliation with canonical week-close ownership helpers.
- `npm run audit:week-close-handoff -- --env-file .env.local --owner owner@local --target-week 3`: post-repair audit. Confirm the artifact now shows observed ownership instead of a missing-row handoff gap.

`historical_mixed_contract_state`:
- This is an audit/ops inference, not runtime state. It is emitted only when the handoff audit sees an expected week-close boundary, no persisted or pending owner row for that anchored week, and a strict optional gap-fill workout already exists for the same anchored week.
- The detector is high-confidence because that combination should not be created by the current canonical ownership contract. It is not proof of the exact historical code version that produced the data.
- Runtime behavior is unchanged. The detector and repair script exist to surface and reconcile legacy mixed-contract mesocycles without changing current save-route, progression, or generation logic.
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
