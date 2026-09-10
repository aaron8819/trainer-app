# Trainer2 principal and database boundary

September 10, 2026. Local provider-independent implementation. Hosted authentication, hosted qualification and training admission remain incomplete/disabled. Base: `76889e88a8a6c0087e773c926ae974f451fd3f05`, tree `09cd414812a94e25d470114b07b9933996494d9a`. Implementation branch: `codex/trainer2-principal-boundary`.

## Actual foundation and ownership

Repository inspection found no application sign-in, callback, session verifier, Supabase client, or authentication middleware. `@supabase/ssr` and `@supabase/supabase-js` are installed dependencies only. `src/proxy.ts` handles UI audit fixtures and otherwise passes requests through. There is no committed provider/application or callback/origin contract from which to implement a verifier. Hosting protection cannot establish an app principal; its actual deployment configuration was not inspected.

Legacy `src/lib/api/workout-context.ts` still reads `OWNER_EMAIL`/`owner@local`; mutation provisioning can upsert that owner. This remains a legacy access assumption, not authentication, and is not imported by Trainer2. Changing all legacy routes is outside this slice. A future hosted boundary must separately address direct legacy API access.

The canonical access owner is `src/lib/api/trainer2/principal.ts`: exact issuer/subject resolves through the existing `Trainer2AccountPrincipal` to a stable User ID. Planning calls its authorization check before reads, edits, new commands and historical replay, including inside acceptance transactions. There is no schema duplication or new ownership model. `authentication.ts` is the narrow server verifier adapter; absent a provider integration, it always throws `AUTHENTICATION_NOT_CONFIGURED`. It does not decode or accept tokens. These server modules import Next's server-only `next/headers` boundary and are excluded from client import graphs.

`access.ts` selects local development only through the existing explicit environment guard and loopback request check. Hosted requests call the verifier, then exact mapping lookup, then the unconditional `HOSTED_ADMISSION_DISABLED` gate. Authentication errors never fall back to development. No environment setting can enable hosted admission or select a synthetic verifier. No hosted training pool is opened after admission denial. Activation/execution/import/cutover handlers remain absent.

The change surface is access orchestration, connection admission, a grant preparation file, an administrative provisioning helper, their tests and this contract. Existing Draft semantics, immutable acceptance, migration history, legacy capture/RLS rejection and N1–N4 are unchanged. Authentication, mapping, database privileges and admission each retain their own failure boundary.

## Mapping and freshness

- Exact `(issuer, subject)` is the sole binding key. Email is never queried or used to link accounts. Equal subjects under different issuers are distinct.
- Unknown principals fail without writes. The User foreign key requires an already-existing account. Ordinary runtime roles cannot insert/update/delete bindings; callbacks and Draft commands do not provision them.
- `resolveAccount` performs a database lookup each time. Nothing stores account authorization in a session, module cache, cookie or token. Pool caching does not cache mappings.
- `authorizeAccount` checks the current binding against the supplied account before each planning operation; acceptance checks again inside its transaction before replay or action insertion. A removed/reassigned binding denies the old principal/account pair, including retry of previously accepted actions. A fresh resolution can return the deliberately assigned new account, which cannot read the prior account's plan.
- Freshness boundary: each authorization observes committed state at its database statement/snapshot. Operations already authorized may finish while an administrator removes a binding. This is **not** instantaneous cancellation of in-flight work. A subsequent request re-resolves; a subsequent planning operation rechecks. Administrative revocation requiring a strict no-in-flight boundary must pause/drain requests first. No transaction-spanning authorization cache exists.
- Removal/replacement requires an explicit separately reviewed administrative action. The insert-or-confirm helper cannot transfer ownership. It returns a binding ID and creation status for the operator's audit receipt; it does not write an account-administration audit product.

## Connections and effective privileges

| Purpose | Exact variable | Required role | Effective scope |
| --- | --- | --- | --- |
| Principal lookup | `TRAINER2_IDENTITY_CONNECTION_STRING` | `trainer2_identity_reader` | SELECT AccountPrincipal only |
| Trainer2 reads | `TRAINER2_READ_CONNECTION_STRING` | `trainer2_draft_reader` | SELECT seven Trainer2 tables |
| Named Draft writes | `TRAINER2_WRITE_CONNECTION_STRING` | `trainer2_draft_runtime` | SELECT seven; INSERT six training tables; UPDATE AccountTrainingState and Plan |
| Legacy reference capture | `TRAINER2_LEGACY_DATABASE_URL` | `trainer2_legacy_reader` | Existing disposable capture contract, unchanged |
| Provisioning | Operator-supplied pool, never runtime configuration | `trainer2_principal_admin` | SELECT/INSERT/DELETE AccountPrincipal; no UPDATE or User creation |
| Migrations/grants | Separately authorized administrator | Environment-specific administrative identity | Outside app runtime |

`database.ts` never falls back to `DATABASE_URL`, `DIRECT_URL`, the legacy Prisma pool, or another purpose's pool. Missing/wrong configuration fails closed. URLs must explicitly name the required role, database and password, and cannot contain query overrides. Local targets must be `127.0.0.1/trainer2_disposable_<suffix>`. Read/write targets must match the identity connection's host/port/database. Configuration changes after pool creation require process restart. Hosted connections require certificate-verified TLS; neither URL parameters nor `DATABASE_SSL_NO_VERIFY` can disable it. Hosted TLS/pooler compatibility has not been tested.

The existing local workbench now needs all three dedicated variables above plus `NODE_ENV=development` and `TRAINER2_LOCAL_DRAFTS=enabled`; the harness supplies them. Legacy code may still need `DATABASE_URL` for its own imports/build. That variable supplies no Trainer2 access. The page and GET use the reader; GET also runs a read-only transaction. Both POST entry points retain the operational write-pause gate. Local mutations retain Host/Origin checks. All Draft HTTP success/error responses use `private, no-store` and `Vary: Cookie, Authorization`. Hosted cookie mutations are unreachable; a provider integration must add canonical configured-origin/CSRF enforcement before any future admission change.

`assertConnectionPrivileges` checks each context before use: session/current role identity; superuser/BYPASSRLS/role creation/database creation/replication attributes; even NOINHERIT membership; database/schema creation and ownership; relation ownership; effective table and column ACLs including PUBLIC; unauthorized readable views/foreign tables; sequence mutation; and executable non-system SECURITY DEFINER functions, including outside public. Missing required table grants also fail. It does not repair grants. Database administrators must freeze DDL/grant changes during admission: a check does not lock all catalogs against concurrent administrator changes. A privileged administrator can always invalidate a previously checked boundary.

`prisma/trainer2-runtime-grants.sql` is an explicit fresh-role preparation file, **not** an automatic migration. It creates NOLOGIN roles and role-specific RLS policies without passwords, memberships or legacy grants. It fails on existing role/policy names rather than modifying unknown existing state. Do not run it against an established environment without inspection and a scoped reviewed plan. A hosted environment with broad existing PUBLIC grants or SECURITY DEFINER functions may be rejected and require separately authorized remediation; this slice does not revoke unrelated provider permissions.

These policies admit server roles across accounts. This is database **privilege isolation plus application account predicates**, not database-enforced per-account isolation. A stolen write-role credential is not constrained to one account or to named application functions. No stronger claim is made.

## Reviewable provisioning procedure

Do not obtain or guess a real subject from email. Before any real provisioning:

1. Authorize the exact environment and INSERT action, verify deployment/provider application identity, and obtain a successful server-verifier result. Record issuer and subject from that result in a restricted review record without tokens/cookies.
2. Review `{issuer, subject, accountId}` against the existing stable User ID obtained through a separately authorized account inventory. Record the operator, reason, timestamp and requested action. An email can be context only. No real binding is proposed in this slice because no verified subject or authorized account inventory exists.
3. With a dedicated `trainer2_principal_admin` login pool, call the exported helper below from a reviewed administrative runner. Credentials are supplied privately by the authorized environment, never committed or passed in command-line arguments. Runtime modules do not import this script.

```ts
import { provisionPrincipal } from "./scripts/trainer2/provision-principal";
// adminPool is an already classified/authorized dedicated pg Pool.
// reviewedBinding contains exactly issuer, subject, accountId; no email or token.
const receipt = await provisionPrincipal(adminPool, reviewedBinding);
// Retain the returned binding ID, creation status, operator, reason and timestamp
// in the approved restricted change record, then close adminPool.
```

The helper verifies the exact session/current administrator role, uses bound SQL parameters and a transaction, and inserts with `ON CONFLICT DO NOTHING`. An existing equal binding returns `created: false`; a different account conflicts. The unique index serializes concurrent insert races; the User foreign key prevents account creation. A concurrent administrative deletion can invalidate a just-returned receipt, so the final check is a fresh runtime lookup. Provisioning does not admit training.

For separately authorized reversal, pause/drain if strict in-flight revocation is needed, then delete only the recorded binding, checking all original coordinates:

```sql
BEGIN;
DELETE FROM public."Trainer2AccountPrincipal"
WHERE id = $1 AND issuer = $2 AND subject = $3 AND "accountId" = $4
RETURNING id;
-- Require exactly one returned row; otherwise ROLLBACK and investigate.
COMMIT;
```

These are pg parameter placeholders for a reviewed runner, not string interpolation. Record reversal and prove the old principal is denied. Never bulk-delete mappings or delete User/training records. Ownership transfer is not supplied as a product feature.

## Local qualification and evidence

`scripts/test-trainer2-principal-postgres.ts --confirm-disposable` classifies inherited canonical targets before importing DB/Docker code, creates its own loopback PostgreSQL 17 container with `--pull=never`, applies the unchanged migration chain and grant file, uses synthetic accounts, and removes its own container. It does not read dotenv or hosted credentials. The harness generates every connection itself; inherited Trainer2 connection strings are not used as targets.

Coverage: exact mapped identity; unknown/same-email/different-subject denial; issuer separation; foreign-key and concurrent/conflicting provisioning; removed/replaced mappings and historical replay; cross-account read/edit/envelope denial; actual runtime mapping/legacy mutation rejection; read-role write rejection; unsafe PUBLIC/column grants, membership, ownership, SECURITY DEFINER, schema CREATE, views and BYPASSRLS. Complete public-row snapshots around read operations and hosted fixture requests establish no database writes.

`hosted-boundary.fixture.ts` is collected only by a generated test configuration. It substitutes server-verifier output and routes database transport to the disposable target while exercising the actual mapping, privilege checker and hosted HTTP orchestration. It proves admission denial, unknown mapping denial and no development rescue. There is no production fixture selector. Unit tests separately cover verifier-error propagation and the real unconfigured adapter. **Invalid signature, wrong issuer/audience, expiry, revocation and session integrity are not cryptographically tested: no verifier library integration exists.** Error-propagation fixtures are not authentication qualification.

The existing Draft harness uses the same grant file and dedicated connections for its real browser create/edit/reload/GET checks. When dependencies are a junction outside the worktree, it records and uses the installed Next CLI's webpack option: Turbopack rejects that filesystem arrangement before app startup. This qualifies the local webpack build, not a hosted Turbopack build. Server startup failures are retained without allowing an already-exited process to interrupt container cleanup. The source-capture adapter, CLI target guards, queries and RLS tests are unchanged; the accepted exact-source RLS evidence remains the baseline for that unchanged boundary. Focused source regressions are included in local verification.

Ignored `artifacts/trainer2-principal/verification.json`, `artifacts/trainer2/verification.json` and the local verification report retain source manifests, commands, timestamps, versions, results and limitations. Before/after raw and LF-normalized source hashes qualify runs against committed source; a Git ancestry claim alone is insufficient. These are local checks, not clean-producer CI inventory or independent review evidence.

## Hosted handoff

### A. Local work

Provider-independent account/role boundary and local fixtures are implemented. Hosted admission remains hard-disabled. No provider writes, hosted reads, real mapping, push, merge or deployment occurred. The local report identifies exact final source and executed checks.

### B. Read-only hosted checks needing a named authorized environment

Propose a dedicated non-production Trainer2 qualification deployment/database, not the production alias or a shared production pool. Before access, the user must name and authorize the environment. Verify the hosting project/team, immutable deployment ID and exact commit/tree, public origin and corresponding database/project identity through independently corroborated deployment and database inventory. A hostname alone does not qualify identity.

Inventory the established login/access model and any authentication application: provider, tenant/project/application ID, supported issuer, audience, callback allowlist, session type, signing-key rotation and revocation behavior. Determine whether hosting protection covers direct routes; it still does not establish app identity. Inspect effective database role/catalog state with the same checks, including PUBLIC, membership, object owners, security-definer paths and RLS policies. The legacy capture CLI remains disposable-only; do not use it for these hosted checks or relax its RLS guard.

Pass evidence: exact deployment/source, authorized provider/application coordinates, sanitized config-name inventory, catalog/check outputs and timestamp. Fail on mismatched identity, missing verified principal, unsafe grants or unknown required configuration. No state changes belong to this read-only step.

### C. Hosted changes needing explicit scope

1. **Provider decision/integration:** choose the existing suitable application provider. Supabase Auth is only a candidate because its libraries are installed; it has not been selected. For that candidate, a later implementation would use maintained `@supabase/ssr`/`@supabase/supabase-js` verification, not decoded token claims or `getSession` alone. Confirm official current library/protocol documentation, required issuer/audience/expiry/session validation and revocation behavior before coding. No new provider has been chosen here.
2. **Proposed provider variables, not implemented selectors:** if Supabase is selected, review `TRAINER2_AUTH_URL`, `TRAINER2_AUTH_PUBLISHABLE_KEY`, `TRAINER2_AUTH_ISSUER`, `TRAINER2_AUTH_AUDIENCE`, and `TRAINER2_APP_ORIGIN`. No service-role key is needed for ordinary authentication. These names reserve the design contract only; setting them currently enables nothing. Callback proposal: exact `https://<approved-origin>/auth/callback`, with PKCE/state/session integrity, secure cookie policy and exact redirect allowlist; no callback exists yet. Confirm the route and variables in that next implementation, not in provider configuration now.
3. **Database preparation:** approve the exact grants/login/TLS/pooler changes for the named database, using the delivered roles. Migrations run only through a distinct admin connection. Review current state before applying the fresh-role file. Configure the three implemented connection variable names above on the qualification deployment; never configure the provisioning credential in runtime. Keep the operational pause enabled during qualification.
4. **Real binding:** obtain issuer/subject only from the actual successful server verifier, review the exact existing User ID, then approve and execute one insert-or-confirm action with the administrative procedure. No exact real account tuple is available yet. Retain the receipt and test unknown subject, same-email/different-subject and removal behavior.
5. **Deploy/check:** deployment itself needs exact source/environment authorization. Verify real missing/invalid/expired/wrong-issuer/wrong-audience/signature/session tests using the supported library and controlled fixtures, provider sign-in/callback/logout, direct routes, cookie Origin/CSRF, no shared cache leakage, role checks and account denial. A valid real mapped principal must still receive `HOSTED_ADMISSION_DISABLED`. Do not add an admission flag to make this test pass.
6. **Evidence/reversal:** retain sanitized request statuses and database before/after evidence, not tokens or secret values. Remove only qualification bindings created by this operation; revoke dedicated login access/configuration only under the approved reversal scope. Roll back the qualification deployment if needed. Preserve production, legacy records and existing account mappings. Training admission stays disabled throughout.

Phase 0 still needs real provider/principal and hosted role/source qualification plus its remaining source/device/backup obligations. Those do not block isolated Phase 1 development. Hosted admission additionally requires operational gates, cookie/CSRF and cache checks, legacy direct-route protection and separately approved readiness. Migration/cutover still requires source reconciliation, backup/recovery/device completeness, runtime fences and the Phase 0–5 foundation; no such completion is claimed here.

Recommended next bounded step: decide the application authentication provider/application, then implement and locally qualify its real verifier and callback/session contract while leaving hosted admission disabled. Separately authorize the named non-production read-only inventory before any hosted changes.
