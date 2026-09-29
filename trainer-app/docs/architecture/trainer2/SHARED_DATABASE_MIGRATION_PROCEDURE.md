# Existing V1 database: Trainer2 schema procedure

Prepared 2026-09-29. This is a reviewable operator procedure, not authority to run it. The target is the existing `trainerapp` Supabase project (`siqmohcbvnbdrssgofzu`), PostgreSQL 17. No production SQL, migration, grant, owner binding, or deployment was changed while preparing it. Hosted Trainer2 admission remains disabled.

The owner has chosen to proceed without a fresh production backup or restore rehearsal for this personal project. **Without a fresh backup, recovery from a database-level mistake is limited.** A failed migration must be stopped and diagnosed in place; do not erase ledger rows, replay SQL blindly, or drop Trainer2 tables as rollback.

## Observed starting state

Read-only inspection found PostgreSQL 17.6, exactly 23 successful Prisma migrations through `20260823120000_add_zero_load_meaning`, no failed or rolled-back row, and no Trainer2 tables or `trainer2_` roles. All 23 ledger checksums match the checked-in SQL byte-for-byte or by Prisma's LF/CRLF compatibility rule. `public."User"."id"` is non-null text. One existing User matches the configured V1 owner email, and that exact ID has the format accepted by the provisioning helper. Keep the ID and email in operator-only configuration; never paste them into a report, command line, log, or repository file. The database has Supabase default grants to `anon`, `authenticated`, and `service_role` on new public objects, and PUBLIC can read the two `extensions.pg_stat_statements*` views.

## Connections and role preparation

Use an operator-only environment file outside the application deployment containing the existing project session-pooler administrator connection as `DIRECT_URL` and `DATABASE_URL`. Despite its variable name, the current `DIRECT_URL` uses Supavisor port 5432; the native `db.<project>.supabase.co` host did not resolve from this operator host. Verify the pooler host, project suffix and database, and use `sslmode=verify-full` with `sslrootcert` set to the project CA downloaded from Supabase Database Settings. A strict Node PostgreSQL connection through the session pooler succeeded with that CA and hostname verification; it failed with `SELF_SIGNED_CERT_IN_CHAIN` without the CA. A read-only Prisma `migrate status` using the CA reached the database and reported the expected pending migrations. Its nonzero exit reflects pending migrations, not a TLS failure. The currently saved `DIRECT_URL` uses `sslmode=require`, so replace that transport setting in the **operator-only** migration configuration before any production migration. Do not put this privileged URL, a role password, or the owner ID in Trainer2 runtime variables, Preview, or a build artifact.

For runtime, create **fresh LOGIN roles** only after the grant transaction below creates the three NOLOGIN roles. Set distinct generated passwords privately for `trainer2_identity_runtime`, `trainer2_draft_reader`, and `trainer2_draft_runtime`; do not use the migration/admin account. Their three server-only URLs must point to the same database. Supavisor session-pooler usernames use `<role>.siqmohcbvnbdrssgofzu` on port 5432. A direct role URL can use the bare role name if direct IPv6 works in the host. The runtime accepts either form but verifies `current_user` and `session_user` are the exact limited role. Use `TRAINER2_DB_CA_CERT_PEM` with the project CA downloaded from Supabase Database Settings for a pooler URL. Keep `rejectUnauthorized=true`; the present pooler URL failed strict TLS without the CA (`SELF_SIGNED_CERT_IN_CHAIN`). Prove each role connects with CA and hostname verification before any hosted admission. Do not use `DATABASE_SSL_NO_VERIFY` or `sslmode=require` as a substitute.

## Preflight and stop points

1. Freeze competing schema/grant work and identify the exact project, direct URL host, database, source commit and migration file hashes. Confirm PostgreSQL major 17. Stop on any mismatch.
2. In one read-only transaction, compare `_prisma_migrations` with the 23-name prefix and compatible checksums in `src/lib/operations/migration-integrity.ts`. Require no failed, rolled-back, unknown, reordered, or partially applied row. Confirm `public."User"` exists, the owner lookup by the private configured V1 email returns exactly one ID, and `Trainer2Owner`/other Trainer2 objects and `trainer2_` roles are absent. Stop on any difference. Do not log the owner row.
3. Check the migration SQL and `prisma/trainer2-runtime-grants.sql` against the reviewed commit. Keep V1 writes paused for the short DDL/grant window using the existing operational write-pause process; inspect pending device actions first. Do not change the production setting as part of this preparation task.

Run the repository checker with the verified-TLS operator file before and after migration: `node --env-file=<operator-only-env-file> node_modules/tsx/dist/cli.mjs scripts/check-migration-status.ts --env-file <operator-only-env-file>`. Before, expect `checkedIn=35`, `applied=23`, `pending=12`, `checksumsMatched=23`, zero incomplete/order violations and `integrityValid=true`. After, expect `applied=35`, `pending=0`, `checksumsMatched=35`, zero incomplete/order violations and `integrityValid=true`. The checker is read-only and sanitizes connection failures. Compare the V1 catalog inventory and private owner lookup independently; the checker does not print the owner ID.

Useful private-session SQL preflight:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT current_setting('server_version_num')::int AS version_num;
SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
       rolled_back_at IS NOT NULL AS rolled_back
FROM public._prisma_migrations ORDER BY started_at, migration_name;
SELECT count(*) AS trainer2_tables FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'Trainer2%';
SELECT count(*) AS trainer2_roles FROM pg_roles WHERE left(rolname, 9) = 'trainer2_';
COMMIT;
```

The expected results are version `170000`–`179999`, 23 exact successful ledger rows, and zero Trainer2 tables/roles. Separately run `SELECT id FROM public."User" WHERE email = $1` through a parameterized client call with the V1 owner email held in private operator configuration; require exactly one row and confirm the ID has the provisioning helper's UUID shape. Never print that query result in a report.

## Exact application order after separate production authorization

Run `node --env-file=<operator-only-env-file> node_modules/prisma/build/index.js migrate deploy` from `trainer-app/` after a read-only Prisma status call using the same verified-TLS URL. `prisma.config.ts` uses `DIRECT_URL`. The operator file must contain the session-pooler URL with `sslmode=verify-full` and a readable `sslrootcert` path. It must apply these checked-in migrations in this exact order and stop immediately on the first error:

1. `20260909120000_trainer2_drafts`
2. `20260910020000_trainer2_acceptance_integrity`
3. `20260913120000_trainer2_activation`
4. `20260914010000_trainer2_workout_start`
5. `20260914020000_trainer2_set_results`
6. `20260914030000_trainer2_workout_finish`
7. `20260915010000_trainer2_historical_set_corrections`
8. `20260915020000_trainer2_discard_empty_execution`
9. `20260915030000_trainer2_skip_occurrence`
10. `20260916010000_trainer2_optional_correction_reason`
11. `20260922010000_trainer2_set_skip`
12. `20260924190000_trainer2_single_user_access`

Before granting runtime access, set `PGHOST`, `PGPORT=5432`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE=verify-full`, and `PGSSLROOTCERT` in the private operator process, then run `psql -X -v ON_ERROR_STOP=1 -1 -f prisma/trainer2-runtime-grants.sql`. No password belongs in command arguments or shell history. `-1` wraps the file in one transaction. The file first revokes Supabase API-role grants on Trainer2 tables/functions and PUBLIC function execute, then creates the three restricted NOLOGIN roles, column grants, and RLS policies. Do not run it twice: duplicate role/policy creation must fail rather than silently alter an existing role. Stop and inspect if the transaction fails. Do not authorize a browser role, V1 app role, or PUBLIC on Trainer2 objects.

Only after grant verification, set LOGIN and distinct passwords for the three roles using a private administrative session. Passwords must be supplied by the operator's secret mechanism, not embedded in checked-in SQL or terminal history. Test the three URLs with verified TLS, PostgreSQL 17 effective-privilege admission, and direct negative reads/writes as `anon`, `authenticated`, and an unrelated role. If any limited role receives V1 table access or any unauthorized role receives Trainer2 access, stop. The default provider statistics views are the only exact provider view exceptions in the admission checker; no grants to them are added.

In private `psql`, execute `ALTER ROLE trainer2_identity_runtime LOGIN;`, `ALTER ROLE trainer2_draft_reader LOGIN;`, and `ALTER ROLE trainer2_draft_runtime LOGIN;`, followed by interactive `\password` for each exact role. Do not include passwords in SQL text. The database effective role must be the bare role name even when the pooler login includes the project suffix.

Owner binding is a **separate authorized action after the schema is accepted**. Re-read the exact V1 `User.id` privately, require zero historical `Trainer2AccountPrincipal` rows and zero `Trainer2Owner` rows, then use `provisionSingleUser` with a random setup code held only in operator memory/secret storage. The helper fails if either count is nonzero or the User is missing. Configure the exact ID as server-only `TRAINER2_OWNER_USER_ID` when hosted access is separately reviewed and enabled. Do not infer identity from email at runtime or copy V1 history into Trainer2.

## Post-migration checks

In a read-only transaction, require 35 successful ledger rows in exact checked-in order and checksum compatibility, no failed or rolled-back row, PostgreSQL 17, all expected Trainer2 tables with RLS enabled, and exactly the preflight V1 table/column inventory. Check V1 owner row and a representative V1 read path still work, without printing personal data. Confirm no Trainer2 owner/session rows exist before separately authorized provisioning. Inspect effective table and function grants: `anon`, `authenticated`, unrelated roles, and PUBLIC must have no Trainer2 read/write rights; identity can only access owner/session data and its listed update columns; training roles cannot select verifier or token-hash columns. Prove the three runtime sessions identify as their respective limited roles and accept the project CA under strict TLS. Keep hosted admission disabled; migration success alone does not enable Trainer2 or permit dual V1/Trainer2 writing.

At any mismatch, leave the application write state unchanged, preserve all rows and the Prisma ledger, and investigate the exact failing migration/role/transport before deciding on a forward fix. Record only sanitized counts, migration names and checksums, schema facts and pass/fail results.
