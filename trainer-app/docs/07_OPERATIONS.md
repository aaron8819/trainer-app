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
history. Apply it only through the reviewed migration workflow while production
writes are paused. Run the normal Prisma generation, contract, migration
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
Because this migration exists only on the unmerged feature branch and has never
been applied to a shared or production database, review corrections update this
single migration in place. An additive follow-up migration would falsely imply
that the reviewed, never-deployed defect was an accepted production schema.

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

`npm run ops:check-direct-db -- --env-file $rolloutEnv` resolves DNS, opens a short TCP connection, and performs the PostgreSQL/TLS/authentication handshake without running SQL. It reports a redacted host fingerprint and distinguishes DNS, timeout, network rejection, TLS, authentication, database rejection, and success. Pooler connectivity is not sufficient evidence for Prisma migration deployment, and the transaction pooler must not replace `DIRECT_URL`.

After the direct check succeeds, `npm run ops:migration-status -- --env-file
$rolloutEnv --principal-audit-file
<sanitized-principal-audit-record> --required-application-commit <full-sha>`
performs the read-only Gate A migration-integrity verification through
`DIRECT_URL`. Counts and caller-authored evidence are insufficient. The command
always re-reads the principal catalog and proves the runtime credential with a
bounded read-only login. A principal audit record is optional explanatory
output and is never authorization input. `src/lib/operations/migration-integrity.ts`
owns the rollout policy and result model. The command:

- hashes the exact checked-out migration SQL bytes with SHA-256, matching how Prisma creates `_prisma_migrations.checksum`, and validates historical rows with Prisma's exact compatibility set: the script as read, `CRLF` converted to `LF`, and `LF` converted to `CRLF`;
- rejects failed, unresolved rolled-back, unfinished, duplicate, unknown, missing-checksum, skipped, and out-of-prefix ledger states;
- compares the actual pending suffix with the exact named sequence in repository policy; caller evidence cannot redefine that sequence and a fixed pending count never authorizes;
- verifies material definitions owned by every applied migration and requires every object owned by each pending migration to be absent;
- runs catalog and ledger queries inside a repeatable-read, read-only transaction, rejects mutation-capable statements in its query adapter, and reports `writes: 0`;
- reports `technicalMigrationReady`, `migrationAuthorizationReady`, and `executionAuthorized` separately.

`technicalMigrationReady` means the repository chain, exact pending sequence,
ledger, Prisma-compatible checksums, applied and pending schema state,
migration-specific data preflight, and current disposable PostgreSQL target
verification are all valid. No Finisher table must exist for the separate live
prerequisite-role checks.
`migrationAuthorizationReady` additionally requires fresh live principal
verification, canonical provider verification of the recovery point,
production deployment and write pause, application compatibility, and exact
migration and application commits. The current command has no authenticated
provider adapter for those hosted facts, so remote Gate A remains fail closed.
`executionAuthorized` is always `false` in this preparation command. A clean
data preflight never grants operational or execution authorization.

Ledger classification follows Prisma row state, not step count:

- A row is successfully applied when `finished_at` is populated, `rolled_back_at` is null, the checksum and required identity fields are present, the step count is a non-negative integer, and `logs` contains no failure evidence. `applied_steps_count = 0` is valid for a row created by Prisma's supported `migrate resolve --applied`; it is not independently incomplete.
- Applied mode is operator context only: positive-step rows are `executed`; zero-step rows with a matching checksum and verified schema effects are `resolved_applied`; another internally valid success is `unknown_successful`. Every clean successful mode counts as applied before prefix/order calculation.
- A missing `finished_at`, missing required field, negative/non-integer step count, or contradictory finished-and-rolled-back state is incomplete. Non-empty Prisma failure logs classify an unrolled row as failed.
- A rolled-back row without a clean replacement remains rolled back and blocks. One clean successful replacement may coexist with rolled-back history. Multiple successful rows, or a successful row mixed with unresolved failed/incomplete rows, are ambiguous duplicates and block.
- Repeating `prisma migrate resolve --applied <migration>` for an already successful row is not a repair; Prisma returns `P3008`. Do not repeat it and do not edit `_prisma_migrations`.

Baseline uniqueness has two separate results. Semantic equivalence requires the same table, unique enforcement, ordered columns, predicate, PostgreSQL null semantics, and a valid/ready enforcing index. Catalog representation equivalence additionally requires the same object kind and constraint/index ownership linkage. Missing uniqueness, a non-unique replacement, changed column order or predicate, incompatible null semantics, invalid enforcement, a conflicting same-name object, unverifiable enforcement, or a representation required by a pending migration blocks Gate A. Finisher expectations additionally require exact enabled trigger metadata; all material columns, constraints, indexes, owners, and grants; restrictive delete/update actions and the execution/version, step/version/order, and alternative/prescribed-step bindings with supporting uniqueness; and independently authored semantic clauses for irreversible `startedAt`, valid execution transitions, permanent performed uniqueness, the exact completed/partial/skipped/never-started-dismissed/performed-dismissed parent-child outcome matrix, deferred validation from both mutation paths, nonempty contiguous finalized offers, exact recommendation membership, finalized item immutability, and complete selection/decline decision identity including expected offer revision. These corrected semantic clauses are not read from the migration SQL. Gate A also checks protected-role attributes, memberships, schema-create access, default privileges, trigger/function dependencies and static references to Finisher relations/functions, the cleanup function's fixed search path and security-definer state, no caller-controlled setting, and both command cleanup consistency checks. Neutral names do not exempt a helper: any function referencing or triggering on a Finisher object is inventoried as a possible access or mutation path.

`ExerciseAlias_alias_key` and `WorkoutTemplateExercise_templateId_orderIndex_key` are the two reviewed baseline representation differences. The baseline SQL creates standalone unique indexes; production may store identically named unique constraints backed by identically named unique indexes. Native PostgreSQL constraint-to-index linkage proves the same enforcement, and the pending multi-plan migration does not depend on those objects being standalone indexes. Therefore each is reported as semantic-equivalent, catalog-representation-different, and a non-blocking diagnostic warning. This narrow policy does not make other constraint/index differences harmless, and no production schema or ledger repair is required for these two objects or for the two valid resolved rows.

Any partial pending-migration object, drift in the complete Finisher table,
column, enum, key, index, constraint, trigger/function, relationship, or exact
curated-row manifest, or other migration-blocking schema difference blocks
Gate A. The current Finisher rollout policy expects 18 checked in, 17 clean
successful applied, and exactly `20260728120000_add_finishers_phase_1` pending.
That sequence is fixed repository policy, not operator evidence: an evidence
file containing `expectedPendingMigrations` is rejected rather than trusted.
On the current disposable PostgreSQL target, clean schema/data inspection yields
`technicalMigrationReady: true`. A remote target remains false until a canonical,
commit-bound disposable-workflow verifier exists; caller JSON cannot fill that
gap. It remains
`migrationAuthorizationReady: false` until fresh recovery, deployment,
compatibility, write-boundary, and exact post-migration application-commit
evidence is supplied, and remains `executionAuthorized: false` in every
preparation run.

The command never deploys migrations, creates temporary objects, modifies the Prisma ledger, executes DDL, repairs schema state, or authorizes execution. A fully migrated 18-applied/0-pending target is reported as clean with `gateAApplicable: false`, `migrationAuthorizationReady: false`, and `executionAuthorized: false` because nothing remains for Gate A to authorize. It still exits nonzero if that fully applied schema has checksum, order, schema, or data drift.

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

### Authorization evidence contract

The optional migration audit-input file is operator-controlled and may contain
only an empty JSON object; any supplied fact is rejected. Principal-audit files
contain sanitized observations only—never URLs, credentials, tokens, passwords,
password hashes, or environment values. They are audit records, not authority.
Gate A resolves repository HEAD, database identity, migration state,
principal state, credential equality, and its evaluation time from live seams.
It rejects every caller field, including fields that attempt to supply data
preflight, disposable execution, the expected pending sequence, principal
verification, deployment commit, required commit, recovery point, write pause,
or deployment timestamp.

```json
{}
```

The principal command writes a second sanitized audit record using exclusive
creation (`wx`). It contains only:

- schema/version and canonical verifier identity;
- repository HEAD, required application commit, target migration, environment
  classification, sanitized target/project fingerprints, and database name;
- the observed lifecycle phase, administrator properties, exact role
  attributes, membership option bits and bootstrap grantor classification,
  schema-create state, credential-verification result, default privileges, and
  pre-migration object/capability counts;
- `authority: sanitized_audit_record_only`, `readOnlyTransaction`, and the exact
  write count.

`TRAINER_APP_RUNTIME_PASSWORD` is process-scoped and must not appear in the
named environment file. Exact credential equality is proven by opening a
bounded connection as `trainer_app_runtime`, starting a repeatable-read
read-only transaction, and checking the connected database, role, and
`transaction_read_only=on`. Existing roles are never accepted merely because a
password was supplied, and provisioning never rotates an existing credential.

PostgreSQL 16 automatically gives a non-superuser `CREATEROLE` creator an
ADMIN membership whose grantor is the bootstrap superuser and whose INHERIT and
SET options are false. The prerequisite phase retains those three unavoidable
rows and adds only two temporary administrator-granted memberships with SET
true for the owner and cleanup roles, plus temporary CREATE on `public` for
those two roles. The migration removes only those temporary rows and schema
capabilities. Terminal verification requires the exact three unavoidable
creator-admin rows and rejects every broader membership or default privilege.

All commit identities use the canonical full Git SHA: exactly 40 lowercase
hexadecimal characters with no whitespace. Gate A requires exact equality among
all three independently obtained values:

- `requiredApplicationCommit` is passed through the dedicated command-line
  argument after the integrated squash SHA exists; the command requires exact
  equality with repository HEAD.
- `repositoryHead` is resolved by `ops:migration-status` from
  `git rev-parse HEAD`; a value supplied in the evidence file cannot override
  it.
- `productionDeploymentCommit` must come from an authenticated provider adapter
  plus the independently checked `/api/version` response; caller JSON cannot
  supply it.

The authorized integrated SHA is therefore data supplied after merge, not a
source-code allowlist. A feature-branch guess, the old base commit, an arbitrary
valid SHA, or any mismatch fails closed before migration authorization. Do not
derive all three values from one caller-supplied field or copy a claimed
deployment SHA without the independent deployment checks.

Acceptable recovery evidence is either a provider PITR point with confirmed retention/recoverability or a repository-created logical backup that passes `Inspect-TrainerBackup.ps1`. A logical archive whose manifest still says `restoreStatus: not_tested` is evidence of a structurally inspectable dump, not proof of a tested restore; the operator must record that limitation. Backup creation is a separate production read/export action and is not part of Gate A preparation.

The repository-authoritative write boundary is `TRAINER_WRITE_PAUSE=enabled`. It blocks classified HTTP mutations and guarded remote operational writes, leaves documented read paths and dry-run diagnostics available, and requires a deployment of the same compatible commit before its state changes. Enable, verification, failure, and resume behavior is defined once in “Production write pause for database rollout” below.

### Finisher application sequencing verdict

The reviewed sequence is runtime-inert application, then migration, then
explicitly enabled application. Merging the application is safe before the
migration only because `TRAINER_FINISHERS_ROLLOUT` fails closed and every
application entry point avoids the Finisher schema while disabled. The exact
integrated `master` squash SHA is not known until merge and must be recorded as
`requiredApplicationCommit`; Gate A must not inherit a prior rollout's target.
Ancestors, descendants, feature-branch heads, and arbitrary revisions fail
closed.

### Bounded Finisher production migration runbook

This runbook documents order only. It does not authorize any merge, deployment,
environment change, role change, migration, production access, or verification.

1. Merge and deploy the reviewed runtime-inert application with
   `TRAINER_FINISHERS_ROLLOUT` unset or otherwise disabled. Confirm relevant
   completed, incomplete, history, navigation, and deletion paths load without
   Finisher UI or Finisher-schema access.
2. Record the actual integrated `master` squash SHA, bind it as
   `requiredApplicationCommit`, and confirm `/api/version` plus provider-side
   alias evidence identify that exact SHA. Do not substitute the feature-branch
   head.
3. Obtain canonical commit-bound disposable PostgreSQL verification for those
   exact repository and migration bytes. **Current residual prerequisite:** no
   repository workflow can yet produce authorization-grade evidence for this
   step. The local PostgreSQL 16 harness is review evidence only. Implement and
   separately review the commit-bound disposable verifier before continuing.
4. Establish and verify the required recovery point.
5. Activate and verify `TRAINER_WRITE_PAUSE=enabled` while keeping
   `TRAINER_FINISHERS_ROLLOUT` disabled.
6. Run the immediate live read-only direct-database and migration-status
   preflight:

   ```powershell
   npm run ops:check-direct-db -- --env-file $rolloutEnv
   npm run ops:migration-status -- --env-file $rolloutEnv `
     --required-application-commit $integratedSha
   ```

   Require exactly 18 checked in, 17 applied, and only
   `20260728120000_add_finishers_phase_1` pending; zero checksum, ledger, order,
   non-principal schema, or data blockers. This immediate preflight is expected
   to remain fail closed before principal provisioning and because canonical
   commit-bound disposable-workflow verification is unavailable; it must not report
   `technicalMigrationReady: true` or `migrationAuthorizationReady: true`.
7. Through the separately authorized database-administrator workflow, provision
   the three required role principals before migration:
   `trainer_app_runtime`, `trainer_finisher_owner`, and
   `trainer_finisher_cleanup`. This prerequisite creates only the principals
   with their reviewed role attributes; it does not create Finisher objects,
   assign migration-owned object ownership, or grant Finisher table/function
   privileges. Recovery-point and write-pause evidence must already be verified
   before this hosted role write. The canonical production command is:

   ```powershell
   $env:TRAINER_APP_RUNTIME_PASSWORD = Read-Host "Runtime role password" -MaskInput
   npm run ops:finisher-principals -- --mode provision --environment production `
     --env-file $rolloutEnv --expected-project-reference $projectReference `
     --expected-database postgres --required-application-commit $integratedSha `
     --write --confirm-remote-write `
     --confirm-principal-provisioning "trainer-principals:$projectReference" `
     --evidence-file $principalProvisionAudit
   Remove-Item Env:TRAINER_APP_RUNTIME_PASSWORD
   ```

   `DIRECT_URL` comes only from the named environment file. The runtime password
   is process-scoped and the command rejects it if it is stored in that file.
   Production mode accepts only the exact direct
   `db.<project-reference>.supabase.co` host, the exact expected database, and a
   project-bound confirmation. It rejects poolers, loopback/disposable
   classification, ambiguous hosts, a runtime/principal connection, missing
   write pause, and every incomplete authorization combination before writes.
   **Current residual prerequisite:** the repository does not yet have a
   canonical authenticated provider adapter for the recovery point and active
   write pause. Production provisioning therefore fails closed before database
   connection even when the confirmation flags are present. Do not substitute
   caller JSON, manual screenshots, or an ad hoc SQL session. Implement and
   separately review that provider verification seam before using this step.
8. Verify all three principals exist, have only the prerequisite attributes and
   capabilities needed by the migration, and have no prohibited memberships.
   The migration must remain responsible for transferring object ownership and
   installing the reviewed grants and protections. Run the distinct
   verification-only command:

   ```powershell
   $env:TRAINER_APP_RUNTIME_PASSWORD = Read-Host "Runtime role password" -MaskInput
   npm run ops:finisher-principals -- --mode verify --environment production `
     --env-file $rolloutEnv --expected-project-reference $projectReference `
     --expected-database postgres --required-application-commit $integratedSha `
     --evidence-file $principalVerificationAudit
   Remove-Item Env:TRAINER_APP_RUNTIME_PASSWORD
   ```

   Verification rejects every write/provisioning flag, uses a repeatable-read
   read-only transaction, reports `databaseWrites: 0`, and creates only the
   local sanitized audit file. Existing-runtime password mismatch fails without
   rotating the credential.
9. Run Gate A and the required pre-migration authorization checks. Require the
   exact canonical equality
   `requiredApplicationCommit === repositoryHead === productionDeploymentCommit`,
   and `executionAuthorized: false`. Until canonical provider verification and
   commit-bound disposable-workflow verification are implemented, require
   `migrationAuthorizationReady: false` and stop. An operator-authored file
   cannot satisfy either prerequisite:

   ```powershell
   $env:TRAINER_APP_RUNTIME_PASSWORD = Read-Host "Runtime role password" -MaskInput
   npm run ops:migration-status -- --env-file $rolloutEnv `
     --principal-audit-file $principalVerificationAudit `
     --required-application-commit $integratedSha
   Remove-Item Env:TRAINER_APP_RUNTIME_PASSWORD
   ```
10. Only after Gate A reports `migrationAuthorizationReady: true`, obtain
    separate explicit migration-execution authorization for the exact target,
    recovery point, paused-write boundary, command, and application sequence.
    Gate A still reports `executionAuthorized: false`; it never replaces this
    authorization.
11. Run the authorized production migration once:

   ```powershell
   node --env-file=$rolloutEnv .\node_modules\prisma\build\index.js migrate deploy
   ```

   Require exactly that migration once and exit zero. Do not run
   `npm run db:seed`, edit `_prisma_migrations`, or retry blindly.
12. Immediately verify the migration-owned object ownership, index and function
    ownership, exact table/column/type structure, type and object grants,
    RLS-disabled state, terminal role contract, restrictive
    relationships, schema access, default privileges, triggers, functions, and
    schema drift. Clearly distinguish these migration-created or
    migration-assigned protections from the pre-migration principal
    provisioning. Do not re-provision migration-owned grants after migration
    and do not rerun principal provisioning as a substitute for repair.
    Migration-owned ownership or grants may be repaired only through a
    separately reviewed recovery procedure.
    Then run the post-migration integrity verification and all required readiness
    checks. Gate A is no longer applicable after the target is applied. Require 18
    successful applied migrations, zero pending, the exact ten-table schema and
    curated catalog, correct roles/grants, no schema/data drift, and successful
    targeted integrity checks. Keep the write pause and Finisher rollout
    disabled. Run `ops:migration-status` again with the process-scoped runtime
    password so the terminal catalog is read through the least-privileged
    runtime connection; require `gateAApplicable: false` and zero integrity
    blockers.
13. Resume general writes only through the write-pause resume procedure after
    every migration and terminal verification check passes. If any check fails,
    keep writes paused and follow the abort procedure below.
14. Separately authorize Finishers enablement and bounded authenticated
    production verification. Set `TRAINER_FINISHERS_ROLLOUT=enabled`, create or
    promote the application deployment containing that setting, and require the
    production alias plus `/api/version` to prove the exact
    `requiredApplicationCommit`; an environment-variable edit does not change
    an already-running deployment.

If the migration fails, keep writes paused and Finishers disabled. Confirm the
explicit transaction left no successful target ledger row, target object, or
curated row, then use the reviewed roll-forward or recovery path. Do not perform
object-by-object rollback.

The Finisher flag can be disabled after rollout without reverting the migration
or deleting, rewriting, or hiding persisted history from the database. A
disabled application simply stops exposing and querying Finishers. An
application rollback after migration is permitted only to a version proven
compatible with the migrated schema. Never enable the flag before the
migration, role provisioning, Gate A, and required post-migration checks
succeed.

### Disposable rollout-tooling gate

`npm run test:db:rollout-tooling -- --confirm-disposable` uses PostgreSQL 16,
traces the real principal provision -> live credential proof -> Gate A flow,
proves clean/partial/idempotent provisioning, proves provisioning creates
no Finisher schema objects, advances to the current 17/1 shape, and then applies
and verifies the fully migrated 18/0 state with the post-migration
ownership/grant checks still distinct. `npm run test:db:multi-plan
-- --confirm-disposable` separately proves the earlier multi-plan migration
chain and compatibility. Both create and remove their containers and never read
a configured production environment.

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
the migration-provisioned Finisher catalog is exact, and post-deployment smoke tests pass.

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
