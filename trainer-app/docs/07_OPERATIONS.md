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

## Pre-session readiness snapshot rollout

1. Back up the target database and run `npm run test:db:readiness-snapshots` locally; this disposable command must pass before deployment.
2. Apply migration `20260714210000_make_pre_session_readiness_snapshots_atomic` through the normal reviewed `prisma migrate deploy` path.
3. Existing snapshots remain `LEGACY_UNKNOWN`; do not backfill or claim exact identity from incomplete historical evidence. New preparation writes create `EXACT` rows.
4. Deploy the producer and exact-identity readers with the migration. Current Home/log reads intentionally treat legacy-only evidence as unavailable until the user explicitly prepares a new snapshot.
5. Use the read-only pre-session audit diagnostics to confirm no duplicate active identity/target, hash mismatch, or active/current-evidence mismatch before considering rollout complete.

Rollback before new exact rows are written may restore the pre-migration backup. After exact rows exist, roll forward; do not drop hashes/indexes or relabel legacy evidence as exact.

## Immutable seed revision rollout

1. Back up the target database and stop seeded workout generation for the rollout window.
2. Run `npx prisma migrate deploy`. Migration `20260713180000_add_immutable_mesocycle_seed_revisions` additively creates deterministic `legacy_unknown` revision-1 baselines for existing seeded mesocycles, selects them as current, and leaves historical workouts unassigned because exact prior provenance cannot be proven.
3. Run `npm run ops:backfill-seed-revisions` and review the dry-run candidates and hashes.
4. Run `npm run ops:backfill-seed-revisions -- --write` to append an exact normalized N+1 for each legacy current revision. Do not resume seeded generation until every active seeded mesocycle has exact current provenance.
5. Run focused verification plus `npm run verify:contracts` and `npm run verify`.

Rollback before application traffic may restore the pre-migration backup. After exact revisions or workouts reference the new model, roll forward; do not drop revision/workout provenance columns or rewrite accepted history. The configured application database must not be used for disposable migration/concurrency testing.

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
- `npm run audit:exercise-exposure-retirement -- --user-id=<user-id>` is a read-only rollout comparison. It reports legacy stable-ID mappings, orphans/ambiguity, last-used drift, retained-table status, and any production source that still accesses the retired model. It never rebuilds or writes rows; the old backfill command is retired.
- Audit CLIs now follow app-default owner resolution when neither `--user-id` nor `--owner` is provided: use `OWNER_EMAIL` from env when present, otherwise fall back to `owner@local`. Explicit `--user-id` and `--owner` still take precedence.
- `npm run audit:week`: fast current-week operator loop. Runs `projected-week-volume` with `.env.local`, the app-default owner resolution path, and a compact CLI verdict before the artifact path.
- `npm run audit:week:debug`: same current-week operator path plus an expanded CLI drill-down for below-MEV groups, below-target-only groups, warnings, projection notes, and projected slot order.
- `npm run audit:week:retro`: fast retrospective operator loop. Runs `weekly-retro` with `.env.local`; pass `--week`, `--mesocycle-id`, and owner targeting flags after `--`.
- `npm run audit:workout -- --env-file .env.local --mode historical-week --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id>`: completed-week audit artifact
- `npm run audit:workout -- --env-file .env.local --mode weekly-retro --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id>`: retrospective week audit artifact with load-calibration, slot-balance, and actual-vs-target volume summaries
- `npm run audit:workout -- --env-file .env.local --mode future-week`: next generated session / week artifact for the app-default owner
- `npm run audit:workout -- --env-file .env.local --mode future-week --user-id <user-id>`: next generated session / week artifact
- `npm run audit:workout -- --env-file .env.local --mode future-week --user-id <user-id> --intent pull`: explicit-intent future-week artifact through the same canonical mode
- `npm run audit:mesocycle-explain:compare -- --before <artifact.json> --after <artifact.json>`: DB-free compare of two existing `mesocycle-explain` artifacts, with linked V2 debug indexes/shards or legacy sidecars auto-read when present
- `npm run audit:workout -- --env-file .env.local --mode v2-accepted-seed-prepare-compare --owner owner@local [--mesocycle-id <handoff-mesocycle-id>]`: read-only V2 accepted-seed preparation compare for a pending handoff candidate. If `--mesocycle-id` is omitted, the CLI resolves the latest `AWAITING_HANDOFF` mesocycle for the owner. The mode writes only the audit artifact, reports `consumedByProduction=false`, reports `v2ProductionWriteEligible=true` only when the V2 preview and all production gates are satisfied, keeps `transactionStatus=no_write`, and does not change accept route behavior or seed/runtime/receipt state.
- `npm run ops:refresh-next-seed-draft -- --origin http://localhost:<TRAINER_PORT> --owner owner@local --source-mesocycle-id <source-mesocycle-id>`: guarded operator loop for refreshing the pending next-seed draft through the existing `POST /api/mesocycles/[id]/refresh-next-seed-draft` route, then pairing `next-mesocycle-handoff-dry-run` and `next-mesocycle-acceptance-gate` with `--no-artifact --operator-debug`. The script requires an explicit origin and does not assume port 3000. Because there is no dedicated app identity endpoint, it verifies the safest current signal, the home page text `Personal AI Trainer`, before calling the route; if that signal is absent, it fails before refresh. The script uses read-only Prisma checks for owner/source state and before/after counts, fails unless the source is `AWAITING_HANDOFF` and the visible draft source is `v2_materialized_seed` (or `--allow-non-v2-draft-source` is explicitly supplied), never calls the accept route, and exits nonzero for rejected or not-runnable acceptance-gate decisions.
- `npm run audit:workout -- --env-file .env.local --mode next-mesocycle-handoff-dry-run --owner owner@local --source-mesocycle-id <source-mesocycle-id> --no-artifact --operator-debug`: read-only rehearsal of the real next-mesocycle handoff preparation path. It calls `prepareMesocycleHandoffAcceptance()` only for `AWAITING_HANDOFF` sources, stops before `acceptPreparedMesocycleHandoffInTransaction()`, prints `writes=no`, and does not create successors, workouts, logs, sessions, or seed/runtime behavior changes. When a refreshed `nextSeedDraftJson.acceptedSeedDraft.source = "v2_materialized_seed"` exists, that persisted draft is candidate truth; legacy prepared projection is labeled compatibility/diagnostic evidence only and must not be used as silent fallback.
- `npm run audit:workout -- --env-file .env.local --mode replace-empty-successor-from-accepted-seed-draft --owner owner@local --source-mesocycle-id <completed-source-mesocycle-id> --mesocycle-id <active-empty-successor-id> --replace-empty-successor-from-accepted-seed-draft --dry-run`: fail-closed recovery dry-run for an accept-path mismatch where the completed source has a persisted V2 `nextSeedDraftJson.acceptedSeedDraft.slotPlanSeedJson` and the active successor has no workouts/logs/session state. The candidate source is exactly the persisted draft seed, not fresh V2 generation or legacy projection. Apply requires the same command with `--write --confirm-accepted-seed-draft-successor-recovery` after reviewing a `safe_to_accept_upgrade` dry-run.
- `npm run audit:workout -- --env-file .env.local --mode projected-week-volume`: canonical full current-week projected volume artifact for the app-default owner
- `npm run audit:workout -- --env-file .env.local --mode current-week-audit --owner owner@local`: pre-execution current-week guidance artifact that reuses `projected-week-volume` output and adds audit-only `currentWeekAudit`, `interventionHints`, and `sessionRisks`
- `npm run audit:workout -- --env-file .env.local --mode deload --user-id <user-id> --intent pull`: explicit deload preview artifact
- `npm run audit:workout -- --env-file .env.local --mode progression-anchor --user-id <user-id> --exercise-id <exercise-id> --workout-id <workout-id>`: single-exercise progression trace artifact
- `npm run audit:split-sanity -- --env-file .env.local --owner owner@local --debug`: run bundled split sanity audit for `push,pull,legs` and write one compact summary artifact under `artifacts/audits/split-sanity/`
- `npm run audit:sequencing`: emit the dedicated order-sensitivity matrix under `artifacts/audits/sequencing/`
- `npm run audit:accounting -- --selection-mode MANUAL --status COMPLETED --advances-split false --optional-gap-fill true`: emit the focused accounting semantics audit under `artifacts/audits/accounting/`
- `npm run audit:week-close-handoff -- --env-file .env.local --owner owner@local --target-week 3`: inspect the final-advancing-session -> week-close -> optional-gap-fill handoff for one real user/week and flag `historical_mixed_contract_state` when a strict gap-fill workout exists without a persisted week-close owner
- `npm run repair:week-close-handoff -- --env-file .env.local --owner owner@local --target-week 3`: dry-run targeted week-close ownership reconciliation for one user/week
- `npm run repair:week-close-handoff -- --env-file .env.local --owner owner@local --target-week 3 --apply`: apply the targeted reconciliation using canonical week-close persistence/resolution helpers
- `npm run repair:historical-session-slot-receipts -- --workout-id <workout-id>`: dry-run bounded historical repair for pre-fix completed advancing workouts missing `selectionMetadata.sessionDecisionReceipt.sessionSlot`
- `npm run repair:historical-session-slot-receipts -- --workout-id <workout-id> --apply`: apply the canonical receipt-slot repair for uniquely proven rows only
- `npm run backfill:week1-performed -- --env-file .env.local --owner aaron8819@gmail.com --mesocycle-id ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4 --backfill-week1-performed-sessions`: dry-run the V2 transition-week performed-session backfill. The operator writes a JSON artifact, does not mutate `slotPlanSeedJson` or `slotSequenceJson`, and reports whether write mode is eligible.
- `npm run backfill:week1-performed -- --env-file .env.local --owner aaron8819@gmail.com --mesocycle-id ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4 --backfill-week1-performed-sessions --write --confirm-backfill`: guarded write for the same transition-week backfill. Use only after reviewing the dry-run artifact; write mode is blocked if any performed row cannot satisfy the existing set-log contract, if the target slot/date already has logged work, or if the seed/slot sequence changed between dry-run and write.
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
- `npm run sync:exercise-library` (and `:apply`) for catalog-only exercise-library sync. It writes only `Exercise`, `ExerciseMuscle`, `ExerciseEquipment`, and `ExerciseAlias`; it does not run full `prisma/seed.ts`, seed owners, or seed workout templates.
- `npm run repair:exercise-library` (and `:apply`) for the repair workflow; apply delegates to the catalog-only sync path.
- Keep `docs/contracts/runtime-contracts.json` aligned with `src/lib/validation.ts`
- Current baseline migration history is squashed to `prisma/migrations/20260222_baseline/migration.sql`; historical per-feature migration folders are archived at `docs/archive/prisma-migrations-backup/` (see `docs/archive/MIGRATIONS_BACKUP_ARCHIVE.md`).
- Lifecycle backfill/role management scripts:
  - `prisma/reset-backfill-mesocycle-lifecycle.ts`: reset and rebuild mesocycle lifecycle state from existing performed workouts.
  - `prisma/repair-mesocycle-rir-bands.ts`: repair legacy 5-week `rirBandConfig` JSON to the corrected duration-aware default week bands.
  - `prisma/backfill-week2-pull.ts`: example manual session backfill flow.
  - `prisma/repair-historical-session-slot-receipts.ts`: strict-match-and-skip repair for pre-fix completed advancing workouts missing canonical receipt `sessionSlot`; requires persisted ordered-flex slot sequence plus seeded slot-plan evidence and skips ambiguous/conflicting rows.
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

## Immutable post-session review rollout

1. Back up the database and pause workout-completion writes.
2. Apply the additive `PostSessionReviewSnapshot` migration.
3. Deploy compatibility readers and exact completion writers together; resume completion only after exact snapshot creation is active.
4. Run `npm run ops:backfill-post-session-reviews -- --batch-size 100` for a dry-run report. Resume with `--after-id <id>` when needed.
5. Review invalid/unproducible rows and hash distribution. Only with explicit database-write authorization, rerun with `--write`.
6. Rerun the same command to confirm idempotence, then run `npm run audit:post-session-reviews` for the read-only integrity report. Add `--include-current-reinterpretation` only for an explicit diagnostic comparison.

Backfilled rows are permanently `legacy_derived`; they do not represent what an older app version displayed. Ordinary GET/page reads never persist snapshots. Do not require historical backfill completion before new exact completion writes are enabled.

## Historical stimulus-accounting rollout

1. Apply `20260714120000_add_workout_exercise_stimulus_snapshot` through the normal reviewed migration process.
2. Deploy application writers/readers. Null legacy rows remain readable as labeled `legacy_derived` or `legacy_unknown` during rollout.
3. Run the default dry-run report: `npm run ops:backfill-stimulus-accounting -- --batch-size 100`. Review counts, unknown/invalid IDs, hash distribution, and the last scanned ID.
4. Resume a bounded dry run with `--after-id <id>` and optionally `--limit <n>`.
5. Only after explicit database-write approval, use `--write`. Updates are idempotent and conditional on the snapshot still being null; reruns report existing exact/derived rows without rewriting them.

The schema has no immutable exercise rename or active/inactive history, so the report labels those historical capabilities unsupported instead of claiming exact reconstruction. Backfilled rows are `legacy_derived`, never `exact`.
