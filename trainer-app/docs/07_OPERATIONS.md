# 07 Operations

## Codex remote identity and GitHub status

Use the repository-level [`scripts/codex/README.md`](../../scripts/codex/README.md) for the offline remote-identity contract and the explicit authenticated `-GitHub` and `-Deployment` read-only status scopes. The Vercel scope validates the committed team, project, and production alias before reading process-scoped `VERCEL_TOKEN`, then uses built-in PowerShell with the official GET-only Vercel REST endpoint allowlist; it requires no Vercel CLI or project link. It reports the active alias deployment and Git SHA, and treats any previous successful production deployment only as a rollback candidate with unknown schema compatibility. GitHub deployment records do not establish active Vercel production truth, a Vercel rollback is distinct from a Git revert, and neither status scope authorizes remediation or writes.

## Public production version verification

`GET /api/version` returns exactly `{ "commitSha": "<full-git-sha>" }`. The primary source is Vercel's `VERCEL_GIT_COMMIT_SHA` system variable, which Vercel documents as available at build and runtime when system environment variables are exposed. `TRAINER_BUILD_GIT_SHA` is the explicit repository build fallback for non-Vercel production builds. Local development/test returns `{ "commitSha": "unknown" }`; a production build with neither valid SHA fails closed instead of claiming an identity. See [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables).

After the intended `master` commit is integrated and deployed, run the read-only production check with that exact full SHA:

```powershell
$expectedIntegratedSha = git rev-parse origin/master
npm run verify:production-version -- --base-url https://trainer-app-indol.vercel.app --expected-sha $expectedIntegratedSha
```

The command performs two independent GET requests and fails on either problem:

- commit identity: `/api/version` must return HTTP 200 and the exact expected `commitSha` contract
- alias availability: the public production origin must separately return HTTP 200

This is public endpoint evidence. It does not authenticate to Vercel, prove provider-side alias-to-deployment assignment, deploy code, read secrets, connect to the database, or authorize remediation.

## Disposable workout-mutation database tests

`npm run test:db:workout-mutations` starts an isolated PostgreSQL 16 container, applies checked-in migrations, synchronizes that fresh database to the current Prisma schema, regenerates the matching client, runs CAS/race/rollback tests, and always removes the container. It sets its own `DATABASE_URL`/`TEST_DATABASE_URL` and does not read `.env.local` or mutate a configured database.

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

## Production architecture rollout authorization

Migration authorization is blocked until every external prerequisite below is supplied and reviewed. Repository tooling may inventory and diagnose the target, but it does not authorize migration deployment, application deployment, traffic changes, or backfill writes.

### Explicit environment ownership

- Every production-rollout command listed in this section, plus the shared workout/readiness audit and repair commands routed through `audit-cli-support.ts`, requires `--env-file <path>`. These operational helpers do not fall back to `.env`, `.env.local`, or `.env.production`.
- Those files may point to different databases. Treat the file path as part of the reviewed command, and use the same absolute path throughout one rollout.
- The named file must define `DATABASE_URL`; direct-endpoint checks and migration status also require `DIRECT_URL`.
- Reports show only sanitized target classification and fingerprint fields. They never print environment-file contents, connection strings, credentials, passwords, or project references.
- Dry-run is the default. A remote backfill write requires both `--write` and `--confirm-remote-write`; each write gate requires separate approval.
- `prisma.config.ts` does not load dotenv implicitly. Direct Prisma CLI commands must use an explicitly pinned environment as shown below.

Use one operator-selected path for the examples:

```powershell
$rolloutEnv = 'C:\absolute\path\to\operator-reviewed-rollout.env'
npm run ops:check-direct-db -- --env-file $rolloutEnv
npm run ops:migration-status -- --env-file $rolloutEnv
npm run ops:preflight-seed-revisions -- --env-file $rolloutEnv
npm run ops:preflight-stimulus-accounting -- --env-file $rolloutEnv
npm run ops:preflight-post-session-reviews -- --env-file $rolloutEnv
npm run ops:audit-readiness-integrity -- --env-file $rolloutEnv
```

`ops:preflight-stimulus-accounting` and `ops:preflight-post-session-reviews` are projected pre-migration inventories. They do not query the missing snapshot column/table. After migration, use the normal dry runs to validate persisted schema state and reconcile counts:

```powershell
npm run ops:backfill-seed-revisions -- --env-file $rolloutEnv
npm run ops:backfill-stimulus-accounting -- --env-file $rolloutEnv --batch-size 100
npm run ops:backfill-post-session-reviews -- --env-file $rolloutEnv --batch-size 100
```

Only after a separate, explicit write approval:

```powershell
npm run ops:backfill-seed-revisions -- --env-file $rolloutEnv --write --confirm-remote-write
npm run ops:backfill-stimulus-accounting -- --env-file $rolloutEnv --batch-size 100 --write --confirm-remote-write
npm run ops:backfill-post-session-reviews -- --env-file $rolloutEnv --batch-size 100 --write --confirm-remote-write
```

Invalid or conflicting accepted seeds block the entire exact seed-promotion write. An inactive completed invalid seed may remain honestly `legacy_unknown` when exact intent cannot be proven; do not rewrite it merely to clear the backfill count.

### Direct migration endpoint

`npm run ops:check-direct-db -- --env-file $rolloutEnv` resolves DNS, opens a short TCP connection, and performs the PostgreSQL/TLS/authentication handshake without running SQL. It reports a redacted host fingerprint and distinguishes DNS, timeout, network rejection, TLS, authentication, database rejection, and success. Pooler connectivity is not sufficient evidence for Prisma migration deployment, and the transaction pooler must not replace `DIRECT_URL`.

After the direct check succeeds, `npm run ops:migration-status -- --env-file $rolloutEnv` performs the complete read-only Gate A migration-integrity verification through `DIRECT_URL`. Counts alone are insufficient. The command:

- hashes the exact checked-in `migration.sql` bytes with SHA-256 and compares every successfully applied migration with `_prisma_migrations.checksum`;
- rejects failed, rolled-back, unfinished, duplicate, unknown, missing-checksum, and out-of-prefix ledger states;
- requires the checked-in chain to contain exactly 15 migrations with the first 10 applied and these final five pending in order: immutable seed revisions, workout-exercise stimulus accounting, ExerciseExposure retirement, post-session review snapshots, and atomic readiness snapshots;
- verifies material definitions owned by the applied architecture migrations, including relevant column types/nullability/defaults, enum order, indexes, constraints, foreign keys, and safe migration prerequisites;
- verifies every table, column, index, constraint, foreign key, trigger, and function introduced by a pending architecture migration is absent. The ExerciseExposure retirement migration is comments-only and deliberately retains the legacy table;
- runs catalog and ledger queries inside a repeatable-read, read-only transaction, rejects mutation-capable statements in its query adapter, and reports `writes: 0`;
- emits `migrationAuthorizationReady: true` only when the direct target is remote (or an explicitly confirmed disposable test target), checksums and ledger are clean, exactly the expected five migrations are pending, applied definitions are compatible, pending objects are absent, every catalog category was verified, and no writes occurred.

Ledger classification follows Prisma row state, not step count:

- A row is successfully applied when `finished_at` is populated, `rolled_back_at` is null, the checksum and required identity fields are present, the step count is a non-negative integer, and `logs` contains no failure evidence. `applied_steps_count = 0` is valid for a row created by Prisma's supported `migrate resolve --applied`; it is not independently incomplete.
- Applied mode is operator context only: positive-step rows are `executed`; zero-step rows with a matching checksum and verified schema effects are `resolved_applied`; another internally valid success is `unknown_successful`. Every clean successful mode counts as applied before prefix/order calculation.
- A missing `finished_at`, missing required field, negative/non-integer step count, or contradictory finished-and-rolled-back state is incomplete. Non-empty Prisma failure logs classify an unrolled row as failed.
- A rolled-back row without a clean replacement remains rolled back and blocks. One clean successful replacement may coexist with rolled-back history. Multiple successful rows, or a successful row mixed with unresolved failed/incomplete rows, are ambiguous duplicates and block.
- Repeating `prisma migrate resolve --applied <migration>` for an already successful row is not a repair; Prisma returns `P3008`. Do not repeat it and do not edit `_prisma_migrations`.

Baseline uniqueness has two separate results. Semantic equivalence requires the same table, unique enforcement, ordered columns, predicate, PostgreSQL null semantics, and a valid/ready enforcing index. Catalog representation equivalence additionally requires the same object kind and constraint/index ownership linkage. Missing uniqueness, a non-unique replacement, changed column order or predicate, incompatible null semantics, invalid enforcement, a conflicting same-name object, unverifiable enforcement, or a representation required by a pending migration blocks Gate A.

`ExerciseAlias_alias_key` and `WorkoutTemplateExercise_templateId_orderIndex_key` are the two reviewed baseline representation differences. The baseline SQL creates standalone unique indexes; production may store identically named unique constraints backed by identically named unique indexes. Native PostgreSQL constraint-to-index linkage proves the same enforcement, and none of the five pending migrations depends on those objects being standalone indexes. Therefore each is reported as semantic-equivalent, catalog-representation-different, and a non-blocking diagnostic warning. This narrow policy does not make other constraint/index differences harmless, and no production schema or ledger repair is required for these two objects or for the two valid resolved rows.

Any partial pending-migration object or migration-blocking schema difference blocks Gate A. The expected production-equivalent pre-Gate-A result is 15 checked in, 10 clean successful applied, 5 exact pending, 10 matching checksums, zero incomplete rows, zero order violations, zero blocking semantic differences, two representation warnings, `writes: 0`, and `migrationAuthorizationReady: true`. Do not run the seed, stimulus-accounting, or post-session-review inventories until both this migration-integrity command and the readiness-integrity command below pass.

The command never deploys migrations, creates temporary objects, modifies the Prisma ledger, executes DDL, repairs schema state, or authorizes deployment by itself. A fully migrated 15-applied/0-pending target is reported as clean with `gateAApplicable: false` and `migrationAuthorizationReady: false` because nothing remains for Gate A to authorize.

### Gate A readiness integrity

`npm run ops:audit-readiness-integrity -- --env-file $rolloutEnv` is the canonical Gate A readiness-data check. It uses `DIRECT_URL`, requires the same explicit environment ownership as migration integrity, and supports both the first-10-migration schema and the fully migrated 15-migration schema. It does not import Prisma, call `loadNextWorkoutContext()`, generate a workout, reconstruct the next session, activate readiness, invalidate rows, repair data, or assign new identity evidence.

The command detects its mode from PostgreSQL catalog objects and verifies that result against the Prisma ledger and checked-in migration checksums:

- `pre_architecture_migration` requires exactly the first 10 migrations applied, the legacy readiness lifecycle columns present, and the seed-revision table, current-seed pointer, atomic-readiness identity columns, and both exact partial unique indexes absent. It queries only legacy columns. Every row is classified as `legacy_valid`, `legacy_duplicate`, `legacy_stale`, `legacy_invalid`, or `legacy_unknown`.
- `fully_migrated` requires all 15 migrations applied and the complete seed-revision/readiness identity catalog, including both valid, ready, live partial unique indexes. It verifies canonical identity and target hashes, payload hashes, identity/contract versions, contract-to-row agreement, lifecycle consistency, duplicate active identities and logical targets under canonical recomputation, stale workout and seed revisions, readiness/projection/prescription fingerprint agreement, supersession integrity, and honest retained legacy rows.
- `partial_or_incompatible` covers every intermediate, incomplete, index-missing, or ledger/catalog-disagreeing state and fails closed without issuing a schema-specific readiness-row query.

Pre-migration rows do not contain enough persisted evidence to prove exact post-migration identity. The report therefore labels exact checks `not_applicable_pre_migration`, leaves their finding arrays empty only under that explicit label, and never fabricates identity hashes, target hashes, projection fingerprints, or seed-revision references. The migration-safety section follows the checked-in atomic-readiness SQL: existing rows receive `identityStatus=LEGACY_UNKNOWN`, while the two new unique indexes include only active `EXACT` rows. It separately reports reconstructable active legacy-target duplicates and ambiguous targets; those integrity conflicts block readiness authorization even though the raw index DDL excludes legacy rows.

All catalog, ledger, and stage-appropriate data reads execute inside one `REPEATABLE READ READ ONLY` transaction. The adapter rejects mutation-capable SQL, rereads and hashes normalized catalog/ledger/data evidence inside the transaction, reports the pre/post fingerprints and `transactionReadOnly`, redacts credentials and connection details, and always reports `writes: 0`. Read-only use remains allowed while `TRAINER_WRITE_PAUSE=enabled`.

Gate A inventory may proceed only when the migration report has `migrationAuthorizationReady=true` and this report has `readinessIntegrityReady=true`. A partial schema, corrupt exact evidence, stale references, duplicate reconstructable active legacy targets, invalid legacy contracts, or unclassifiable legacy targets blocks readiness authorization. The command performs no repair.

The existing workout audit mode remains available for its normal post-migration coaching and current-session diagnostic purpose:

```powershell
npm run audit:workout -- --env-file $rolloutEnv --mode pre-session-readiness --owner <owner-email> --no-artifact --operator-debug
```

That mode loads canonical next-session/runtime context and is not a Gate A readiness-integrity check. Do not use it against a pre-migration database or substitute it for `ops:audit-readiness-integrity`.

Focused and disposable verification commands:

```powershell
npm run test:migration-integrity
npm run test:readiness-integrity
npm run test:db:rollout-tooling
```

The PostgreSQL 16 rollout test uses the installed Prisma CLI to create zero-step resolved baseline and set-intent rows, requires repeat resolution to return `P3008` without changing schema or ledger fingerprints, and proves the production-like 10/5 state authorizes with two representation warnings. It also exercises standalone indexes, constraint-backed indexes, missing uniqueness, wrong column order, a non-unique index, a changed partial predicate, partial pending objects, checksum mismatch, failed/incomplete/rolled-back ledger rows, and the fully migrated 15/0 state. Its readiness states cover a clean first-10 schema, a duplicate legacy conflict, a partial readiness column, a clean all-15 schema, corrupt and canonically duplicate exact rows, and a production-like 10-row/8-active legacy fixture. It does not load a configured rollout environment.

The exact repository-owned deploy command, once migration authorization is granted, is:

```powershell
node --env-file=$rolloutEnv .\node_modules\prisma\build\index.js migrate deploy
```

Do not run it during preflight. A backup being available, a reachable direct endpoint, a clean migration status, an approved write pause, and an approved deployment plan are all required first.

### Operator-owned prerequisites

Record these values in the rollout approval before migration deployment:

- Supabase backup/PITR status: `<operator-provided evidence required>`
- Latest recovery point: `<operator-provided timestamp required>`
- Restore procedure: `<operator-provided procedure required>`
- Restore test or confidence level: `<operator-provided evidence required>`
- Recovery time objective: `<operator-provided RTO required>`
- Exact Vercel deployment command or workflow: `<operator-provided command/workflow required>`
- Exact write-pause mechanism: `<operator-provided mechanism required>`
- Deployed-commit verification: `<operator-provided command/check required>`
- Exact write-resume mechanism: `<operator-provided mechanism required>`

Do not infer or invent these commands. Migration authorization remains blocked while any placeholder is unresolved.

### Current configured-target findings

The last explicitly environment-pinned, read-only preflight established these rollout facts:

- The configured direct Supabase endpoint fails DNS resolution. Do not substitute the transaction pooler for Prisma migration deployment.
- One completed inactive mesocycle has a fully legacy-format accepted seed with 17 missing `setCount` entries. It remains `legacy_unknown`; the available evidence does not justify an exact repair or normalization default.
- The stimulus-accounting pre-migration inventory projects 548 `legacy_derived` snapshots.
- The post-session-review pre-migration inventory projects 64 producible `legacy_derived` reviews across 119 completed workouts.

These findings are diagnostic evidence only. Migration deployment, backfill writes, application deployment, and rollout authorization remain blocked pending the operator-owned prerequisites above.

### Disposable rollout-tooling gate

`npm run test:db:rollout-tooling` uses PostgreSQL 16, applies the first 10 migrations, validates all three pre-migration inventories, applies all 15 migrations, reconciles projected and normal dry-run candidate counts, checks direct connectivity, and asserts zero snapshot or exact-seed writes. It creates its own explicit environment file and never reads a configured environment file.

## Pre-session readiness snapshot rollout

1. Back up the target database and run `npm run test:db:readiness-snapshots` locally; this disposable command must pass before deployment.
2. Apply migration `20260714210000_make_pre_session_readiness_snapshots_atomic` through the normal reviewed `prisma migrate deploy` path.
3. Existing snapshots remain `LEGACY_UNKNOWN`; do not backfill or claim exact identity from incomplete historical evidence. New preparation writes create `EXACT` rows.
4. Deploy the producer and exact-identity readers with the migration. Current Home/log reads intentionally treat legacy-only evidence as unavailable until the user explicitly prepares a new snapshot.
5. Use the read-only pre-session audit diagnostics to confirm no duplicate active identity/target, hash mismatch, or active/current-evidence mismatch before considering rollout complete.

Rollback before new exact rows are written may restore the pre-migration backup. After exact rows exist, roll forward; do not drop hashes/indexes or relabel legacy evidence as exact.

## Immutable seed revision rollout

1. Satisfy every production architecture rollout prerequisite above, back up the target database, and use the operator-approved write pause.
2. Run `npm run ops:preflight-seed-revisions -- --env-file $rolloutEnv` before migration. Review every `normalizable`, `legacy_baseline_only`, `legacy_exception`, `already_exact`, `invalid_seed`, `conflict`, and `missing_seed` row. The only allowed `legacy_exception` is completed, inactive mesocycle `12079700-5333-4ffc-9cbd-bb303588f288` with an entirely identity-only seed; any other invalid seed still blocks writes.
3. After separate migration authorization, use the environment-pinned Prisma deploy command above. Migration `20260713180000_add_immutable_mesocycle_seed_revisions` additively creates deterministic `legacy_unknown` revision-1 baselines only for parser-compatible executable seeds and selects only those inserted revisions as current. The reviewed production inventory projects three revision inserts, three pointer updates, and one explicit legacy exception whose `slotPlanSeedJson` remains unchanged and whose `currentSeedRevisionId` remains null. Historical workouts remain unassigned because exact prior provenance cannot be proven.
4. Run `npm run ops:backfill-seed-revisions -- --env-file $rolloutEnv` and review the post-migration dry-run candidates and hashes.
5. Only after separate backfill-write authorization, run the guarded remote write command shown above. Do not resume seeded generation until every active seeded mesocycle has exact current provenance.
6. Run focused verification plus `npm run verify:contracts` and `npm run verify`.

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
npm run <operational-command> -- --env-file C:\absolute\path\to\reviewed.env
```

Command notes:
- `NODE_TLS_REJECT_UNAUTHORIZED=0`: local Postgres uses a self-signed cert; this suppresses the SSL warning. Not needed in production.
- Operational commands must delegate to `src/lib/operations/rollout-environment.ts` before importing modules that instantiate Prisma. Do not use `dotenv/config` or add a default environment file.

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
4. Before migration, run `npm run ops:preflight-post-session-reviews -- --env-file $rolloutEnv`. After migration, run `npm run ops:backfill-post-session-reviews -- --env-file $rolloutEnv --batch-size 100` for a dry-run report. Resume with `--after-id <id>` when needed.
5. Review invalid/unproducible rows and hash distribution. Only with explicit database-write authorization, rerun with both `--write` and `--confirm-remote-write`.
6. Rerun the same command to confirm idempotence, then run `npm run audit:post-session-reviews -- --env-file $rolloutEnv` for the read-only integrity report. Add `--include-current-reinterpretation` only for an explicit diagnostic comparison.

Backfilled rows are permanently `legacy_derived`; they do not represent what an older app version displayed. Ordinary GET/page reads never persist snapshots. Do not require historical backfill completion before new exact completion writes are enabled.

## Historical stimulus-accounting rollout

1. Apply `20260714120000_add_workout_exercise_stimulus_snapshot` through the normal reviewed migration process.
2. Deploy application writers/readers. Null legacy rows remain readable as labeled `legacy_derived` or `legacy_unknown` during rollout.
3. Before migration, run `npm run ops:preflight-stimulus-accounting -- --env-file $rolloutEnv`. After migration, run `npm run ops:backfill-stimulus-accounting -- --env-file $rolloutEnv --batch-size 100`. Review counts, unknown/invalid IDs, hash distribution, and the last scanned ID.
4. Resume a bounded dry run with `--after-id <id>` and optionally `--limit <n>`.
5. Only after explicit database-write approval, use both `--write` and `--confirm-remote-write`. Updates are idempotent and conditional on the snapshot still being null; reruns report existing exact/derived rows without rewriting them.

The schema has no immutable exercise rename or active/inactive history, so the report labels those historical capabilities unsupported instead of claiming exact reconstruction. Backfilled rows are `legacy_derived`, never `exact`.
# Production write pause for database rollout

This control is a short full-write pause, not a full read outage. Users may view existing pages,
history, reviews, explanations, and weekly-volume data, but must not begin or continue workouts
during the pause. Mutation attempts receive `503 Service Unavailable` and should be retried after
maintenance. Duration remains operator-estimated until direct-endpoint, migration, deployment,
backup, and smoke-test evidence is complete.

## Contract

- Server-only variable: `TRAINER_WRITE_PAUSE` (never prefix it with `NEXT_PUBLIC_`).
- Exact paused value: `enabled`.
- Missing, empty, `disabled`, `false`, `1`, and every other value mean writes are enabled.
- The app gate applies to all classified HTTP mutations.
- Rollout tooling applies the pause to remote writes only. Local/disposable writes and remote dry
  runs remain available.
- The gate is process environment state. It is not stored in the database and does not connect to
  the database to determine status.

Verify a named environment file without making a database connection:

```powershell
npm run ops:write-status -- --env-file .env.production
```

Expected output is exactly one of:

```text
Trainer production write status: PAUSED
Trainer production write status: ENABLED
```

The command exits zero for either status and never prints environment values or secrets.

## Activation procedure

1. Set `TRAINER_WRITE_PAUSE=enabled` in the Vercel Production environment variables.
2. Redeploy the currently verified production commit so the environment change reaches a new
   deployment. Changing a Vercel environment variable does not alter an already-running
   deployment.
3. Verify the deployed commit SHA is still the expected release commit.
4. Export/download the production variables into the operator-controlled `.env.production`
   file through the established secure process; do not commit or edit that file in the repo.
5. Run `npm run ops:write-status -- --env-file .env.production` and require `PAUSED`.
6. Execute representative safe mutation smoke requests for mesocycle acceptance, workout save,
   set logging, and readiness preparation. Require status 503, `Retry-After: 60`, and code
   `PRODUCTION_WRITE_PAUSED`.
7. Compare the pre-smoke and post-smoke row/revision counts. Require no changes.
8. Confirm home, workout history, completed review, workout explanation, weekly volume, health,
   migration-status diagnostics, and read-only audit/inventory commands still load.

Do not begin migrations unless all eight steps pass.

## Migration-window behavior

- Keep users out of active workout execution for the entire write-pause window.
- Read-only audit modes, migration status, direct endpoint diagnostics, exposure-retirement
  audit, backfill inventory/dry-run modes, and health checks remain available.
- Remote rollout commands using `--write` and `--confirm-remote-write` fail with
  `PRODUCTION_WRITE_PAUSED` before their callback imports Prisma or creates a pool.
- Mutating workout-audit recovery/reseed modes use the same target classification and require
  `--confirm-remote-write` for remote targets.
- Repository repair/sync tools with explicit `--write`, `--apply`, or `--execute` modes use the
  same remote-target confirmation and pause gate; their dry-run modes remain available.
- Never use a local/disposable target classification to bypass the pause against a remote
  database.

## Resume procedure

Do not resume until all migrations are applied, the new application deployment is verified,
required active seed provenance is valid, and post-deployment smoke tests pass.

1. Remove `TRAINER_WRITE_PAUSE` or set it to a value other than exact `enabled` in Vercel
   Production.
2. Redeploy the verified production commit.
3. Verify the deployed commit SHA.
4. Refresh the operator-controlled environment file, then run
   `npm run ops:write-status -- --env-file .env.production`; require `ENABLED`.
5. Execute one controlled mutation smoke test.
6. Verify its single expected database effect and revision change.
7. Confirm no maintenance 503 responses remain.

## Failure and rollback behavior

If migration fails while paused:

- keep writes paused;
- do not automatically redeploy old code;
- inspect the Prisma migration ledger and partial schema state;
- follow the reviewed roll-forward or backup-restore plan;
- leave read-only access available only if it is verified safe.

If deployment fails after successful migration:

- keep writes paused;
- roll back the application only if the prior app is proven schema-compatible;
- otherwise fix forward with the merged application;
- do not resume because the homepage alone loads.

The write pause does not authorize migrations, deployment, database repair, backfills, seed
changes, or environment mutation. Those remain separate operator decisions.
