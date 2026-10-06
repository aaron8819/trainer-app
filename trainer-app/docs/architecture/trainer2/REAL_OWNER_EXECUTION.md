# Real-owner access execution and recovery

Status: local qualification is evidenced separately on the exact reviewed commit/tree; hosted execution and physical-device checks require separate authorization.
This document supersedes the full credential archive and drain requirements in the
original REAL_ACCOUNT_ACCESS_PROPOSAL. It does not authorize a hosted action.

## Supported scope and owners

One existing V1 User is privately re-resolved by exact email and matched to the
previously verified exact ID. `owner-transition.ts` owns the single synthetic →
real binding transition. `sessions.ts` owns setup, persistent device sessions and
revocation. No signup, V1 import, alternate identity or reversible binding exists.
`training-home.ts` owns the account-scoped read-only landing at `/trainer2`.
Setup/sign-in redirects there. Empty home displays Training, no-plan text and
Create plan. `/trainer2/dev/drafts?view=builder` is explicit Builder entry.
An unqualified empty draft bookmark redirects home. Opening home allocates no
plan, draft, execution, result, action or training state.

The existing `hosted-test` build/runtime mode supports this bounded single-owner
real admission after operator rebinding and separate Preview configuration
authorization. Its name remains unchanged; Preview restriction, exact protected
origin, restricted roles, strict TLS, server session checks and same-origin POSTs
remain mandatory. Earlier synthetic-only scope is not permission for real access.

Epochs are PostgreSQL integers. Transition reserves three increments: transition,
mandatory setup and a subsequent revoke-all. Starting epochs 0 through MAX_INT−3
are admissible. MAX_INT−2, MAX_INT−1 and MAX_INT fail before manifest publication
or writes. Setup/revoke-all check capacity before mutation; exhaustion leaves
owner and sessions unchanged. At MAX_INT normal sign-in, renewal and individual
logout remain supported; another epoch increment fails explicitly. No wrapping,
decrementing or silent session restoration is supported.

Revoke-all rechecks the cookie and exact original account under the same singleton
row lock as transition and setup. A request authorized before transition either
finishes before it or fails its locked recheck afterward. A pause cannot substitute
for this check. Renewal never clears revocation or changes epoch; downstream
authorization rechecks reject retained old principals. Prior scoped reads may
finish against their old snapshot; there is no instantaneous cancellation promise.

## Minimum private attribution

No old passcode/setup verifier or token hash is archived. Old passcode verifier is
cleared and setup verifier replaced in the transaction. Revoked session rows remain
as historical records; their token hashes are not cookie secrets and cannot admit a
session after revocation/epoch change. No reusable authentication material is copied
to recovery files. Do not back up obsolete credentials for this operation.

`scripts/trainer2/private-attribution.ts` publishes only original singleton ID,
synthetic account ID/epoch, session IDs/owner IDs/epochs/timestamps/revocation status,
operation UUID, source commit and recorded time. These facts are needed because
session rows reference singleton 1, which subsequently means a different owner.
The manifest must never be interpreted as real-device activity or a restore recipe.

An existing private Windows directory outside the repository must have inheritance
disabled and Allow rules restricted to the current operator and optional SYSTEM.
The runner rejects broader ACLs before writing. Newly created files inherit that
restricted directory. It exclusively creates a pending file, flushes via fsync,
closes, atomically renames on the same filesystem and verifies exact bytes both
locally and in a separate Node process before transition writes. No encryption/key
infrastructure is necessary for credential-free attribution protected by the OS ACL.
Do not place this directory in a shared/synced location or copy manifests into Git.
Keep the private manifest with the restricted operational records; public receipts
contain only operation UUID, checksum and counts.

Publication/readback failure aborts the transaction. A flushed pending file or a
published precommit manifest may remain after interruption; keep it as evidence.
Every manifest is explicitly precommit attribution: a file never proves commit.
On lost commit acknowledgement, privately inspect binding, epoch, credentials and
retained session status before retry. Recovery never reads credentials from a
manifest. Protect/restrict the existing manifest directory during recovery too.

## Concrete hosted execution procedure — not executed locally

1. Obtain separate authorization identifying the exact reviewed candidate commit
   and tree, existing Trainer2 project, protected stable origin below, Preview-only
   configuration/deployments, private identity re-resolution, narrow database owner
   transition, setup and device authentication. No schema/grant change is included.
   Preserve the 24 original hosted session rows, synthetic records, pending tab,
   browser storage, previews and retained evidence. Leave V1 and efficiency alone.
2. Before any database mutation, prepare two protected Preview deployment artifacts
   from the exact approved fixed source: primary and recovery. Both use
   `TRAINER_BUILD_MODE=hosted-test`, `TRAINER_DEPLOYMENT_MODE=hosted-test`, the same
   privately verified real `TRAINER2_OWNER_USER_ID`, same three restricted connection
   strings, same strict `TRAINER2_DB_CA_CERT_PEM`, and exact `TRAINER2_APP_ORIGIN`:
   `https://trainer2-hosted-synthetic-git-codex-e763ff-aaron8819s-projects.vercel.app`.
   Build/runtime source and mode must match, provider protection must cover all
   deployments and no bypass may be introduced. Exclude DATABASE_URL, DIRECT_URL,
   OWNER_EMAIL, admin credentials and insecure TLS from deployments. The existing
   synthetic recovery artifact is incompatible. READY alone is insufficient.
3. Review provider configuration/protection and effective runtime database roles
   using existing read-only tooling. Keep real admission unavailable while binding
   is synthetic: the exact real-ID check fails closed. Do not switch the stable
   alias to real access before primary and recovery artifacts are verified. Do not
   operate the old pending-action tab. A scoped ingress pause is optional for UX;
   no drain proof is needed for revoke-all correctness with the serialized fix.
4. Use an isolated clean approved checkout with repository-local dependencies.
   Prepare a private OS-protected operator configuration file outside Git. Supply
   its path through `TRAINER2_OPERATOR_ENV_PATH`, never secrets in arguments/logs.
   Required private fields: DIRECT_URL (the pinned postgres.siqmohcbvnbdrssgofzu
   Supavisor session pooler port 5432 `/postgres` target), OWNER_EMAIL,
   TRAINER2_OPERATOR_CA_CERT_PEM, TRAINER2_APPROVED_COMMIT,
   TRAINER2_VERIFIED_REAL_ID, TRAINER2_EXPECTED_SYNTHETIC_ID,
   TRAINER2_EXPECTED_SESSION_EPOCH (privately inventoried current epoch), all three restricted
   connection strings, TRAINER2_APPROVED_STABLE_ORIGIN,
   TRAINER2_PRIVATE_MANIFEST_DIRECTORY and TRAINER2_ONE_TIME_SETUP_CODE. Obtain a
   protected setup-code delivery channel before generating the code. No real code
   is generated by local qualification or this runner.
5. Run repository-local Node/tsx:
   `node node_modules/tsx/dist/cli.mjs scripts/trainer2/transition-real-owner.ts --inspect`.
   It pins clean source, target/TLS, migration names/completion, effective restricted
   roles, original binding and exact privately re-resolved real User. The canonical
   live integrity inspection now supplements the narrow binding inspect: it uses
   `inspectMigrationDatabase`, `loadCheckedInMigrations` and
   `buildMigrationIntegrityReport` against a repeatable-read, read-only snapshot.
   Require exact successful migration coverage, zero pending/unfinished/failed or
   duplicate migrations, canonical checksum matches and required schema integrity
   (tables, columns/defaults/nullability, enums, indexes/constraints, triggers and
   functions). Reviewed swap-checksum compatibility comes only from the existing
   loader/matcher and [provenance](../../operations/TRAINER2_SWAP_CHECKSUM_PROVENANCE.md);
   never approve arbitrary checksum drift. Require `migrationIntegrityValid=true`,
   zero pending migrations, no unable-to-verify objects or blocking semantic drift.
   Inspect any representation warning under its canonical disposition. Preserve
   the separately authorized live attestation and effective-grant receipts, then
   freeze DDL/grants through transition and admission. It performs
   no mutation. Missing/unreadable catalog objects, unfinished migrations, unmatched
   checksums, schema drift, changed source/target/TLS/grants/identity or an unfrozen
   DDL/grant window means stop and investigate;
   do not repair grants or migrations under this authorization.
6. After the explicit database-transition authorization, use the same runner with
   `--confirm-hosted-real-transition`. The transaction independently checks binding,
   locks users and singleton/sessions, rechecks real email/ID, rejects target data,
   durably publishes minimal attribution, revokes synthetic sessions, clears old
   passcode state, installs fresh single-use setup and advances epoch. It writes no
   User/training data. Require database commit/readback plus sanitized receipt;
   verify 24 retained original sessions revoked and zero target training rows.
7. If interrupted: unchanged synthetic binding means transition did not commit;
   review the private manifest and failure before a new authorized retry. Real
   binding means retain it and its epoch; repeated transition is denied. If commit
   status is uncertain, stop until readback settles it. Inspect original session IDs
   and attribution in the protected manifest: counts/epoch classification alone do
   not prove historical row integrity or cookie authorization. Never reset to synthetic,
   decrement epoch, restore old credentials, delete records or issue an unchecked
   general SQL recovery. Lost setup delivery requires separately reviewed forward
   setup repair; do not improvise one here.
8. Under deployment/alias authorization, activate primary at the same protected
   stable origin. Use existing private setup once; the owner chooses/stores their
   unique passcode. Separately sign in on desktop. Check empty Training home, reload,
   stale synthetic-cookie denial and zero real plans/executions/results. Do not
   submit Builder or training commands. Confirm actual normal browser/device restart
   persistence separately; local Edge viewport checks do not qualify phone Safari
   or Vercel protection-cookie lifetime.
9. Recovery: if primary fails, pause Trainer2 access or activate only the verified
   compatible recovery deployment at the same stable origin and real configuration.
   Keep database binding, epoch, setup/session state and protection intact. Readback
   must confirm real binding, stale synthetic denial, valid independent real device
   sessions and empty home. Candidate server restart with identical real identity
   is locally exercised; hosted artifact/protection/provider identity checks remain
   mandatory during separately authorized execution. Synthetic deployment rollback
   is forbidden. No database restore is part of this access recovery.

## Local qualification and integration limits

`scripts/test-trainer2-real-access.ts --confirm-disposable` uses only its own
PostgreSQL 17 container and generated fixture identities. It applies repository
migrations/grants locally, tests interruption/repetition/concurrency, epoch
boundaries, stale in-flight revoke-all, cross-owner denial, manifest readback,
setup, zero planning/execution writes and optional pinned Chromium native persistent-profile checks.
`node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-real-access-supervised.ts --confirm-disposable` selects the fresh bounded browser matrix
while reusing unchanged account-safeguard evidence. Desktop 1360px and phone-sized
390px profiles retain native cookies across browser-only, app-only and combined
compatible recovery restarts, with identical session IDs and owner binding. Actual
server session authorization and database rows/epoch/revocation/no-training-write
checks supplement browser appearance. This is local viewport qualification, not
physical desktop/phone, Safari or provider protection-session verification.
The native launcher avoids waiting on stale direct browser handles and reuses
qualified identity-pinned shutdown and fallback utilities. Native browser exit
code (including forced exit), independent native absence, launcher close and
worker/controller exit remain separate facts;
profiles and failed attempts remain retained. Primary errors, cleanup steps, native
child close, worker exit, controller exit and independent resource absence are
separate evidence.
Assertions, cleanup and actual worker exit have separate receipts. Hosted runner
TLS/provider target checks are source-reviewed; it is deliberately never pointed
at a hosted database during this task.

Parallel catalog/prefill source is not merged. Only Builder-entry navigation links
in DraftWorkbench/TrainingOverview overlap those UI surfaces; no catalog,
measurement, prefill, V1, schema or grant owner changes here. A combined candidate
requires navigation/auth integration qualification and its own exact source/tree.
