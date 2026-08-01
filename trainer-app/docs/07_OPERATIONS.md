# 07 Operations

## Phase 1 Finisher rollout

The canonical runtime gate is the server-only
`TRAINER_FINISHERS_ROLLOUT` setting owned by
`src/lib/operations/finisher-rollout.ts`. Only the exact value `enabled`
enables Finishers. Unset, empty, `false`, case variants, surrounding
whitespace, and every other value disable the feature. Never expose this
setting with a `NEXT_PUBLIC_` prefix. Disabled application paths do not query
the Finisher schema, and changing the setting requires a new deployment.

`20260728120000_add_finishers_phase_1` is additive and does not rewrite workout
history. Apply it only through the reviewed, separately authorized conventional migration workflow.
Run the normal Prisma generation, contract, migration
integrity/drift, and deployment readiness checks before release. Curated routine
version 1 rows are installed inside the same atomic migration with deterministic
routine/version/step identities. Production must not run the broad general
seed. Re-running `prisma migrate deploy` is safe because the migration ledger
does not reapply a successful migration. Development seed uses the same
canonical catalog and stable identities; it creates missing rows, verifies an
existing immutable version exactly, and fails on drift instead of rewriting it.
New versions and their complete child graph are created atomically and sealed
before commit. Ordinary seed/application work cannot append to or rewrite a
sealed definition.
`npm run generate:finisher-catalog` verifies that the migration's generated SQL
matches the canonical catalog. Later definition changes must create a new
version and must never update an existing version.
Finisher command receipt cleanup is application-initiated and opportunistic, but
the database owns the only permitted mutation. After
each successful or exactly replayed existing-execution command, the service
invokes the security-definer cleanup function for one global oldest-first,
`SKIP LOCKED` batch of at most 100 database-expired receipts. Public execute is
revoked. `trainer_finisher_owner` and `trainer_finisher_cleanup` are fixed
`NOLOGIN NOINHERIT` roles with no elevated attributes. The former owns all ten
Finisher tables and protection functions; the latter owns only the cleanup
function and has command-table `SELECT` plus column-level `UPDATE` on
`response` and `cleanedAt`. `trainer_app_runtime` is the ordinary
`LOGIN INHERIT` role with no elevated attributes or protected-role membership.
It receives explicit least-privilege Finisher table grants and `EXECUTE` on
the canonical cleanup function plus the read-only terminal-outcome validator
invoked by deferred trigger wrappers, but no command-table update/delete
privilege or execute access to any Finisher mutator.
Default privileges do not grant any protected capability. The command trigger permits only the exact `response -> NULL` and
`cleanedAt` transition made by that function; it rejects premature cleanup,
restoration, mixed-field updates, every permanent-field update, and every row
delete. Cleanup never deletes command IDs, executions, or execution steps.
Logical `expiresAt`
enforcement is synchronous and does not depend on cleanup success or cadence,
and cleanup failure does not replace an already-committed command response.
The function fixes `search_path` to `pg_catalog, pg_temp`, accepts only the
bounded batch size, uses database time, and does not trust a custom GUC.

These roles are a migration prerequisite, not created by the application
migration. Their exact prerequisite contract is:

- `trainer_app_runtime`: `LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS`; no `CREATE` on `public`; no incoming or outgoing
  role membership; no default privilege involving the role; and one SCRAM-SHA-256
  credential with no password hash exposed in evidence. The clear credential is
  read only from the process-scoped `TRAINER_APP_RUNTIME_PASSWORD`. The
  operator supplies it with a masked prompt immediately before provisioning
  and removes it immediately afterward. The command derives the SCRAM verifier
  locally and never prints or writes the clear credential.
- `trainer_finisher_owner`: `NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS`; no credential, `public` schema-create
  privilege, incoming or outgoing membership, or default privilege.
- `trainer_finisher_cleanup`: the same prerequisite attributes and prohibitions
  as `trainer_finisher_owner`.

A separately authorized database administrator must provision those exact
attributes before migration. Missing principals and an otherwise safe runtime
principal missing its credential are the only permitted reconciliation cases.
Any unexpected attribute, credential, schema-create capability, membership, or
default privilege fails closed and is not silently repaired. The migration
connection must remain the reviewed privileged
direct connection capable of transferring ownership and grants; application
`DATABASE_URL` must use `trainer_app_runtime`. Never run Prisma migration or
seed commands through the runtime connection, and never give the runtime role
membership in either non-login role. No role provisioning is authorized by
this document alone. Principal provisioning never creates schema objects,
transfers ownership, or grants Finisher object privileges; those operations
belong exclusively to the migration.

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

`npm run test:db:workout-mutations -- --confirm-disposable` starts an isolated PostgreSQL 16 container, injects a failure after partial Finisher migration work and proves the explicit transaction leaves no target objects, applies checked-in migrations to a fresh empty database without the general seed, reruns `migrate deploy` to prove the permitted provisioning path is safe, verifies the exact curated catalog and immutable definitions, regenerates the matching client, runs the protected Finisher Prisma relationship-drift check, proves deferred terminal parent/child coherence and permanent command-tombstone enforcement through Prisma, direct SQL, bulk, insert, delete, expiry, cleanup, race, and ABA paths, runs the remaining lifecycle/CAS/rollback tests, and always removes the container. It sets its own `DATABASE_URL`/`TEST_DATABASE_URL` and does not read `.env.local` or mutate a configured database.

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

This section remains the general policy for other production schema changes. The Finisher
migration uses the narrower procedure below; its specific exception does not weaken these controls
for any other migration or production operation.

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
npm run ops:preflight-multi-plan -- --env-file $rolloutEnv
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

### Production logical backup evidence

The supported Trainer backup operator platform is Windows PowerShell. The repository provides two separate commands:

- `scripts/database/Backup-TrainerProduction.ps1` creates one external PostgreSQL custom archive of the Trainer-owned `public` schema.
- `scripts/database/Inspect-TrainerBackup.ps1` performs an offline checksum, manifest, freshness, and fresh `pg_restore --list` inspection.

Neither command authorizes a migration, restore, deployment, write resumption, or any other production mutation. The artifact is evidence for a separately paused and human-authorized migration process.

The dump contains schema definitions, table data, `_prisma_migrations`, and other restoreable objects within `public`. Structural checks require the `public` schema, `_prisma_migrations`, and the stable application-owned `User`, `Workout`, and `Mesocycle` tables. Those tables cover identity, performed training history, and program lifecycle without depending on a short-lived feature table. Supabase-managed schemas such as `auth`, `storage`, and platform-internal schemas are excluded. Supabase Storage objects are not included.

#### Target and secret contract

Prefer the Supabase direct endpoint `db.<project-reference>.supabase.co:5432`. A Supabase session pooler on port `5432` is permitted only with `-AllowSessionPooler`; transaction-pooler port `6543` and unsupported host shapes are rejected. The URL must identify the expected project, database `postgres`, and `sslmode=require`, `verify-ca`, or `verify-full`.

The preferred secret input is one deliberately selected, Git-ignored environment file containing exactly the connection variable needed by this workflow:

```dotenv
TRAINER_PRODUCTION_DATABASE_URL=postgresql://...
```

The script does not search for environment files. A repository-local selected file must pass `git check-ignore`; an operator-controlled file outside the repository is also supported. `-UseProcessEnvironment` may be used only when the operator deliberately preloaded `TRAINER_PRODUCTION_DATABASE_URL` into the current process. Passwords and complete URLs are never accepted as ordinary command-line values and are not written to the manifest or console.

Create and inspect one external backup:

```powershell
$backupEnv = 'C:\secure\trainer-production-backup.env'
$backupRoot = 'D:\TrainerBackups'
$projectReference = '<expected-20-character-project-reference>'
$postgresBin = 'C:\Program Files\PostgreSQL\16\bin'

pwsh -NoProfile -File scripts/database/Backup-TrainerProduction.ps1 `
  -EnvironmentFilePath $backupEnv `
  -ExpectedProjectReference $projectReference `
  -DestinationRoot $backupRoot `
  -PostgreSQLBinDirectory $postgresBin
```

The creator prints a sanitized target summary and then requires the operator to type the exact project-specific confirmation. Do not pipe, embed, or automatically supply that confirmation. Use `-AllowSessionPooler` only after independently selecting a compatible session-pooler endpoint. `-GitShaOverride` is only for the exceptional case where repository identity cannot be resolved normally.

The final directory contains only:

- `database.dump`
- `manifest.json`

Creation happens under a unique same-volume `<name>.partial` directory. The final directory becomes visible only after `pg_dump`, nonempty-file validation, `pg_restore --list`, required-object checks, SHA-256, and manifest creation succeed. Failure removes the partial directory when safe; if cleanup cannot complete, it retains a clearly failed artifact with no successful manifest.

The manifest records only sanitized host, port, database, connection mode, TLS mode, expected project reference, dump scope, start and successful completion timestamps, Git SHA, `pg_dump`/`pg_restore` versions, archive size, SHA-256, required-object results, and explicit evidence levels. It states `restoreStatus: not_tested` and `applicationQueryStatus: not_tested`; there is no editable restore-verification flag.

Inspect the exact final directory immediately before the paused migration step:

```powershell
$backupDirectory = 'D:\TrainerBackups\trainer-production-<timestamp>-<id>'
pwsh -NoProfile -File scripts/database/Inspect-TrainerBackup.ps1 `
  -BackupDirectory $backupDirectory `
  -ExpectedProjectReference $projectReference `
  -MaximumAgeMinutes 60 `
  -PostgreSQLBinDirectory $postgresBin
```

Freshness defaults to 60 minutes and is calculated from successful completion, not start time. Override `-MaximumAgeMinutes` only as an explicit operator decision. A passing inspection proves that the local archive is nonempty, its checksum matches, `pg_restore --list` succeeds now, and expected objects are listed. It does not prove a restore, restored-data queries, or application recovery.

Retain the latest three successful backups outside the repository. Retention is manual; these scripts never delete backups. A logical dump is not point-in-time recovery. Provider-hosted backups may be lost with project deletion, so independently retained off-site artifacts remain valuable.

#### Disposable restore for elevated confidence

A disposable restore is optional for ordinary additive migrations. It is strongly recommended before destructive, irreversible, difficult-to-roll-forward, or broad data-transforming migrations. Never restore into production for verification.

1. Provision an isolated disposable PostgreSQL target and independently prove its identity is non-production.
2. Verify the target database is empty and has no application traffic.
3. Load its credentials through the approved secure process into `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and an appropriate `PGSSLMODE`; do not put the password in the command.
4. Restore with ownership and privilege suppression at restore time:

```powershell
pg_restore --exit-on-error --no-owner --no-privileges --dbname postgres $backupArchive
```

5. Query migration history and at least one stable Trainer table:

```powershell
psql --no-password --dbname postgres --command 'select migration_name, finished_at from public._prisma_migrations order by started_at;'
psql --no-password --dbname postgres --command 'select count(*) from public."Workout";'
```

6. When appropriate, run a small application-level smoke against only the disposable target.
7. Record the target identity, commands, results, and cleanup. This elevated evidence is required by this workflow only for destructive/high-risk migrations.

This PR does not automate or execute a restore.

#### Canonical paused migration workflow

For a production migration:

1. Confirm the production Supabase project independently.
2. Select the direct endpoint, or explicitly approve the compatible session pooler for backup creation only.
3. Confirm database `postgres` and required TLS.
4. Pause writes using the separately approved mechanism.
5. Create one external `public`-schema backup.
6. Inspect its checksum, fresh archive listing, required objects, and selected freshness.
7. For destructive/high-risk changes, perform the disposable restore and query smoke above.
8. Run the existing direct-connectivity and migration-integrity gates.
9. Review the rollback or roll-forward plan.
10. Stop for explicit migration authorization.
11. Run the existing environment-pinned Prisma migration command separately.
12. Run post-migration verification before resuming writes.
13. Retain the latest three successful external backups.

No backup or inspection result grants migration authorization. Database backups do not contain Supabase Storage objects.


### Direct migration endpoint

`DATABASE_URL` is the application/runtime connection and `DIRECT_URL` is the direct PostgreSQL
connection used for migration inspection and execution. Both must come from the same explicitly
named operator-controlled environment file and resolve to the same target classification. The
read-only status command connects through `DIRECT_URL`, starts repeatable-read read-only
transactions, and reports sanitized target fingerprints rather than connection details.

Migration execution is a separate operation. Use the normal trusted direct Supabase/PostgreSQL
administrator path required by the SQL; never execute this migration through the application
runtime role. `npm run ops:migration-status` performs no DDL, ledger mutation, repair, deployment,
environment mutation, or execution authorization. The Finisher-specific retained safeguards and
command are defined in the procedure below.

### Gate A readiness integrity

`npm run ops:audit-readiness-integrity -- --env-file $rolloutEnv` is the canonical Gate A readiness-data check. It uses `DIRECT_URL`, requires the same explicit environment ownership as migration integrity, and supports both the first-10-migration schema and the fully migrated 18-migration schema. It does not import Prisma, call `loadNextWorkoutContext()`, generate a workout, reconstruct the next session, activate readiness, invalidate rows, repair data, or assign new identity evidence.

The command detects its mode from PostgreSQL catalog objects and verifies that result against the Prisma ledger and checked-in migration checksums:

- `pre_architecture_migration` requires exactly the first 10 migrations applied, the legacy readiness lifecycle columns present, and the seed-revision table, current-seed pointer, atomic-readiness identity columns, and both exact partial unique indexes absent. It queries only legacy columns. Every row is classified as `legacy_valid`, `legacy_duplicate`, `legacy_stale`, `legacy_invalid`, or `legacy_unknown`.
- `fully_migrated` requires the complete checked-in chain (currently 18 migrations) applied and the complete seed-revision/readiness identity catalog, including both valid, ready, live partial unique indexes. It verifies canonical identity and target hashes, payload hashes, identity/contract versions, contract-to-row agreement, lifecycle consistency, duplicate active identities and logical targets under canonical recomputation, stale workout and seed revisions, readiness/projection/prescription fingerprint agreement, supersession integrity, and honest retained legacy rows.
- `partial_or_incompatible` covers every intermediate, incomplete, index-missing, or ledger/catalog-disagreeing state and fails closed without issuing a schema-specific readiness-row query.

Pre-migration rows do not contain enough persisted evidence to prove exact post-migration identity. The report therefore labels exact checks `not_applicable_pre_migration`, leaves their finding arrays empty only under that explicit label, and never fabricates identity hashes, target hashes, projection fingerprints, or seed-revision references. The migration-safety section follows the checked-in atomic-readiness SQL: existing rows receive `identityStatus=LEGACY_UNKNOWN`, while the two new unique indexes include only active `EXACT` rows. It separately reports reconstructable active legacy-target duplicates and ambiguous targets; those integrity conflicts block readiness authorization even though the raw index DDL excludes legacy rows.

All catalog, ledger, and stage-appropriate data reads execute inside one `REPEATABLE READ READ ONLY` transaction. The adapter rejects mutation-capable SQL, rereads and hashes normalized catalog/ledger/data evidence inside the transaction, reports the pre/post fingerprints and `transactionReadOnly`, redacts credentials and connection details, and always reports `writes: 0`. Read-only use remains allowed while `TRAINER_WRITE_PAUSE=enabled`.

For a readiness-snapshot architecture rollout, inventory may proceed only when the migration report has `technicalMigrationReady=true` and this report has `readinessIntegrityReady=true`; operational authorization is evaluated separately. For the current multi-plan migration, `ops:preflight-multi-plan` supplies the migration-specific data result instead. A partial schema, corrupt exact evidence, stale references, duplicate reconstructable active legacy targets, invalid legacy contracts, or unclassifiable legacy targets blocks readiness authorization. The command performs no repair.

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
npm run verify:finisher-schema-drift
```

The PostgreSQL 16 rollout test uses the installed Prisma CLI to create zero-step resolved baseline and set-intent rows, requires repeat resolution to return `P3008` without changing schema or ledger fingerprints, rejects the stale 10/8 rollout shape, and proves the current 17/1 shape can become authorization-ready with simulated evidence while execution remains unauthorized. It also exercises standalone indexes, constraint-backed indexes, missing uniqueness, wrong column order, non-unique/invalid/unready/non-live indexes, changed predicates, columns and foreign-key actions, removed/cascading composite Finisher bindings, removed supporting uniqueness, missing/disabled/replica-only/retargeted triggers, removal or non-deferred timing of either terminal-coherence path, completed/partial/skipped/dismissal matrix weakening, command-delete event removal, weakened terminal/step/command functions, premature or identity-changing cleanup definitions, changed function owners, unexpected execute or table grants, protected-role membership, weakened security mode/search path, removed canonical grants, GUC reintroduction, neutrally named static-SQL helpers, unexpected trigger mutation paths, unvalidated/weakened checks, unexpected Finisher-owned objects and catalog rows, partial pending objects, checksum mismatch, failed/incomplete/rolled-back ledger rows, and the fully migrated 18/0 state. Its readiness states cover the legacy pre-architecture schema and the fully migrated chain. It does not load a configured rollout environment or connect to production.

The exact repository-owned deploy command, once migration authorization is granted, is:

```powershell
node --env-file=$rolloutEnv .\node_modules\prisma\build\index.js migrate deploy
```

Do not run it during preflight. A backup being available, a reachable direct endpoint, a clean migration status, an approved write pause, and an approved deployment plan are all required first.


## Finisher migration readiness and rollout

The Finisher migration uses a conventional, separately authorized migration procedure. The
readiness command is read-only and never executes or authorizes the migration.

Reviewed identity:

- production application commit: `014b6dce5f1872b1b4d66af508a03e23f6a540e0`;
- migration: `20260728120000_add_finishers_phase_1`;
- Git blob: `55985a32851d9de042b43db3880b5cb857373313`;
- SHA-256 of the Git blob bytes:
  `491bd022e0f5478cf80f805c64b0cf46c03d301ae4c34779c09f9f111823eb43`.

The migration is backward-compatible with the deployed application while Finishers remain
disabled. It creates twelve enum types, ten Finisher tables, indexes, foreign keys, functions,
triggers, grants, and four curated routine definitions inside one explicit transaction. It does
not alter or rewrite an existing application row, column, constraint, or trigger. Its only DDL on
an existing application table is a non-concurrent unique index on `Workout(id, userId)`.
PostgreSQL scans `Workout` and blocks concurrent writes to that table while the index is built.
Since `id` is already the primary key, duplicate data cannot invalidate this index. The migration
also changes only its prerequisite Finisher-role memberships/schema privileges to their intended
terminal least-privilege state. It performs no existing-data backfill or transformation.

Ordinary application reads and writes remain schema-compatible before, during, and after the
migration. During the index build, writes touching `Workout` may wait on PostgreSQL's DDL lock;
they cannot create inconsistent Finisher data. Disabled Finisher pages and API routes do not
query the new tables. A separate application write pause, Vercel pause deployment, or environment
mutation provides no material additional safety and is not required for this migration.

### Read-only readiness

Immediately before execution, use the explicitly owned production environment file with:

```powershell
npm run ops:migration-status -- `
  --env-file <operator-controlled-production-env> `
  --confirm-disposable-verification-passed `
  --confirm-backup-pitr-available `
  --confirm-finishers-disabled
```

The confirmation flags record operator confirmations; they do not contact or reproduce provider
state. Before supplying them, inspect the authenticated canonical PostgreSQL 16 disposable
workflow result, authenticated Supabase backup/PITR status, and effective production Finisher
runtime state through the normal trusted interfaces. Require a current recovery option, not
correlation to a rollout or write-pause timestamp.

Readiness requires exactly 17 clean applied migrations and only the reviewed Finisher migration
pending; exact migration bytes; clean migration history, ordering, checksums, schema, and catalog;
canonical disposable application/integrity success; current backup/PITR availability; Finishers
disabled; and zero inspection writes. It returns `migrationReady: true` only when all checks pass
and always returns `executionAuthorized: false`. Missing confirmations fail closed. Readiness and
migration execution are separate operator decisions.

The SQL requires the already-reviewed `trainer_app_runtime`, `trainer_finisher_owner`, and
`trainer_finisher_cleanup` roles and executor attributes checked at transaction start. The
read-only catalog preflight verifies those prerequisites. If they are missing or incompatible,
stop; do not mutate principals as part of readiness.

### Linear production procedure

1. Verify production still runs commit `014b6dce5f1872b1b4d66af508a03e23f6a540e0` and verify
   the migration Git blob and SHA-256 above.
2. Confirm the canonical PostgreSQL 16 disposable workflow applied the exact migration and passed
   its schema, catalog, atomicity, and application-integrity checks.
3. Through the authenticated Supabase interface, confirm a current backup/PITR recovery option is
   available for the production database.
4. Confirm `TRAINER_FINISHERS_ROLLOUT` is not exact `enabled` in the effective production
   deployment and the Finisher endpoint remains unavailable.
5. Run the immediate read-only readiness command above. Require `migrationReady: true`,
   `executionAuthorized: false`, one exact pending migration, and `writes: 0`.
6. Obtain separate explicit authorization, then execute the exact migration once through the
   normal trusted Supabase/PostgreSQL migration path. Do not automatically retry after timeout,
   disconnect, or any ambiguous result.
7. If the result is ambiguous, inspect read-only migration history and expected Finisher schema.
   Retry only when both are reconciled and prove the migration was not applied.
8. Run `npm run ops:migration-status -- --env-file <operator-controlled-production-env>
   --post-migration`; require 18 clean applied migrations, zero pending, exact schema/catalog,
   checksum/order integrity, and zero writes. Then check application health, ordinary read/write
   compatibility, drift, and runtime error telemetry.
9. Leave Finishers disabled.
10. Enable Finishers only through a separate, later reviewed and authorized release step.

The migration has no object-by-object rollback automation. Its explicit transaction is the
failure boundary. If execution fails or is ambiguous, reconcile the ledger and schema first.



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
1. From `trainer-app/`, run `npm ci` to install the exact lockfile deliberately.
2. `npm run prisma:generate`
3. Apply migrations only through the separately authorized local development or deployment workflow.
4. Optional seed: `npm run db:seed`
5. Start app: `npm run dev`

Migration hygiene:
- After pulling any branch with new files under `prisma/migrations/`, apply them through the separately authorized migration workflow before relying on the app runtime.
- If the Prisma schema/client include a model but the database is missing its table, runtime reads will fail with `PrismaClientKnownRequestError` reporting that the table does not exist.

## Verification and maintenance
- `npm run verify:fast`: first checks that the worktree has a valid local dependency installation, then runs lint, the local TypeScript compiler, focused tests, and contract checks. npm package scripts resolve binaries from local `node_modules/.bin`.
- Routine verification must not use `npx`: it can download a missing package. Missing dependencies fail nonzero with instructions to run `npm ci` deliberately instead of using a network-capable fallback.
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
- `npm run ops:refresh-next-seed-draft -- --origin http://localhost:<TRAINER_PORT> --owner owner@local --source-mesocycle-id <source-mesocycle-id>`: guarded operator loop for…1013 tokens truncated…ff -- --env-file .env.local --owner owner@local --target-week 3`: dry-run targeted week-close ownership reconciliation for one user/week
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
Before deploying `20260726120000_add_active_macrocycle_foundation`, run the read-only integrity inventory against the explicitly authorized target:

```powershell
npm run ops:preflight-multi-plan -- --env-file $rolloutEnv
```

Optionally add `--artifact-dir <audit-artifact-directory>` after the environment arguments to inspect historical-week artifacts. The command requires `DATABASE_URL` and `DIRECT_URL`, uses the direct target, emits only a sanitized target fingerprint plus counts and identifiers, returns non-zero for blocking corruption, and treats zero legacy active-plan candidates as valid absence. It performs no repair or migration. More than one legacy active mesocycle for an owner is blocking; the migration never chooses by time, order, or date overlap.

The migration is explicitly wrapped in `BEGIN`/`COMMIT`, so ambiguity detection, pointer backfill, foreign-key creation, and active-state constraints apply atomically on PostgreSQL. A blocking ambiguity or later DDL failure leaves the pre-migration schema intact.

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

This generic control remains available for migrations that need it. It is explicitly not required
for `20260728120000_add_finishers_phase_1`; use the Finisher procedure above.

This control is a short full-write pause, not a full read outage. Users may view existing pages,
history, reviews, explanations, and weekly-volume data, but must not begin or continue workouts
during the pause. Mutation attempts receive `503 Service Unavailable` and should be retried after
maintenance. Duration remains operator-estimated until direct-endpoint, migration, deployment,
backup, and smoke-test evidence is complete.

## Contract

- Server-only variable: `TRAINER_WRITE_PAUSE` (never prefix it with `NEXT_PUBLIC_`).
- Exact paused value: `enabled`.
- In the application runtime, only exact `enabled` pauses writes; all other values preserve the
  ordinary enabled state. Production-capable operational commands are stricter: a remote write
  requires an explicitly loaded value of exact `enabled` or exact `disabled`, and missing or
  ambiguous pause evidence fails closed before database-dependent loading.
- The app gate applies to all classified HTTP mutations.
- Read pages and handlers use non-provisioning owner lookup; owner provisioning is itself gated as
  a mutation and cannot run during the pause.
- Rollout tooling applies the pause to remote writes only. Local/disposable writes and remote dry
  runs remain available. Every registered production-capable seed, studio, backfill, repair,
  lifecycle, principal, administration, and migration command must use the target-aware boundary.
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
3. Verify the runtime evidence endpoint reports exact contract version 2, `production`, the
   expected deployed commit SHA, the authenticated deployment ID, the matching pause-operation
   ID `trainer-write-pause:<vercel-project-id>:production:<commit-sha>:<deployment-id>` derived
   from trusted Vercel system metadata, `PAUSED`,
   `application_all_classified_write_paths`, and enforcement-contract version 2.
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
- Remote production-capable commands fail closed when pause state is missing or ambiguous, and
  commands using `--write`, `--apply`, or equivalent write intent fail with
  `PRODUCTION_WRITE_PAUSED` when paused, before their callback imports Prisma or creates a pool.
- Mutating workout-audit recovery/reseed modes use the same target classification and require
  `--confirm-remote-write` for remote targets.
- Repository repair/sync tools with explicit `--write`, `--apply`, or `--execute` modes use the
  same remote-target confirmation and pause gate; their dry-run modes remain available.
- Never use a local/disposable target classification to bypass the pause against a remote
  database.

## Resume procedure

Do not resume until all migrations are applied, the new application deployment is verified,
the migration-provisioned Finisher catalog is exact, and post-deployment smoke tests pass.

1. Set `TRAINER_WRITE_PAUSE=disabled` in Vercel Production. Do not remove it: operational remote
   writes require an explicit verified state.
2. Redeploy the verified production commit.
3. Verify the runtime evidence remains bound to the authenticated deployment, exact commit,
   production environment, pause-operation ID, and current enforcement-contract versions.
4. Refresh the operator-controlled environment file, then run
   `npm run ops:write-status -- --env-file .env.production`; require `ENABLED`.
5. Execute one controlled mutation smoke test.
6. Verify its single expected database effect and revision change.
7. Confirm no maintenance 503 responses remain.

## Failure and rollback behavior

If migration fails while paused:

- keep writes paused;
- do not automatically redeploy old code;
- for `20260728120000_add_finishers_phase_1`, confirm the failed explicit
  transaction left no Finisher objects or curated rows and no successful ledger
  row; do not claim or attempt an object-by-object rollback;
- for another migration, inspect its reviewed atomicity contract before
  classifying schema state;
- follow the reviewed roll-forward or backup-restore plan;
- leave read-only access available only if it is verified safe.

If deployment fails after successful migration:

- keep writes paused;
- roll back the application only if the prior app is proven schema-compatible;
- otherwise fix forward with the merged application;
- do not resume because the homepage alone loads.

The write pause does not authorize migrations, deployment, database repair, backfills, seed
changes, or environment mutation. Those remain separate operator decisions.
