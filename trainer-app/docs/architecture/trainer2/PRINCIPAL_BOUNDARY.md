Current real-owner access and recovery contract: [REAL_OWNER_EXECUTION.md](REAL_OWNER_EXECUTION.md). Its minimal attribution and serialized revocation replace earlier full-credential archive/drain proposals. Hosted execution remains separately authorized.

# Trainer2 single-user access and database boundary

Trainer2 is for one person. Supabase Auth, signup, email links and issuer/subject mapping are not part of the access design. The separate hosted-test mode admits only the exact configured singleton owner. The reviewed one-time synthetic-to-real owner transition supports one existing V1 User, subject to the separately authorized deployment and database procedure in REAL_OWNER_EXECUTION.md. No training cutover or import occurs.

## Canonical owner

`prisma/schema.prisma` and migration `20260924190000_trainer2_single_user_access` define one `Trainer2Owner` row (`id=1`) with an FK to the existing V1 `User.id`, and separate `Trainer2DeviceSession` rows. `TRAINER2_OWNER_USER_ID` is a server-side exact ID configured only after an operator verifies that User. `src/lib/api/trainer2/sessions.ts::soleOwner` requires exactly one row, fixed key and exact configured ID; absent or inconsistent state denies access. The FK rejects an unknown User. The local `scripts/trainer2/provision-single-user.ts` helper refuses existing historical `Trainer2AccountPrincipal` rows and creates no User. It is a function for an explicitly authorized operator runner, not a public route. Historical issuer/subject rows are left intact and receive no Trainer2 runtime grant. They are never converted or treated as an alternate owner.

`src/lib/api/trainer2/access.ts::requestContext` owns HTTP admission. Every Trainer2 read and mutation adapter calls it before command parsing or opening a training pool. Local mode requires explicit development configuration, a loopback Host and the same persisted owner/device session as every other request. Hosted requests are admitted only when the built and runtime modes both equal `hosted-test`, Vercel reports Preview, the three restricted credentials and CA are configured, and no legacy credentials are present. Other hosted modes deny. `principal.ts::authorizeAccount` rechecks owner configuration, account ID, session epoch, revocation and expiry inside planning/execution operations and acceptance transactions. Revoke-all revalidates its original cookie/account under the singleton lock shared with setup and transition. An old synthetic revoke cannot advance the new owner epoch. Already scoped reads may finish; instantaneous cancellation is not claimed.

## Passcode and session lifecycle

An operator creates a random one-time setup code and stores only its salted scrypt verifier with the bound owner. The browser submits setup code and a new passcode by same-origin POST; success removes the setup verifier. The passcode must be 12–128 characters. The server stores a salted scrypt verifier (`N=2^17`, `r=8`, `p=1`) and applies a persistent five-failure, 15-minute global lock against online guessing. A correct passcode creates a separate 256-bit random secret and session row per browser/device. Only a SHA-256 hash of that random secret is stored. The cookie is host-only (`__Host-`), Secure, HttpOnly, SameSite=Lax, Path=/ and has a 90-day max age. The database enforces 30-day sliding expiry, renewal within seven days of that deadline, and 90-day absolute expiry. Browser closure and app restart do not erase a valid session. Sign out revokes the current row; Sign out every device advances `sessionEpoch` so all older sessions fail on their next request. The owner can sign in again after losing a device and revoke all sessions.

Auth POSTs and Trainer2 data mutation POSTs require `Origin === TRAINER2_APP_ORIGIN` and reject cross-site Fetch Metadata. Bearer credentials are unsupported. Passcodes, setup codes and session tokens are never placed in URLs, client-readable storage, application logs or source control. The local browser test uses a synthetic generated passcode kept in process memory. Responses containing auth state are private/no-store. Client `accountId` remains only a checked command claim, never authentication.

## Restricted connections

`src/lib/api/trainer2/database.ts` uses `TRAINER2_IDENTITY_CONNECTION_STRING`, `TRAINER2_READ_CONNECTION_STRING` and `TRAINER2_WRITE_CONNECTION_STRING`; no Trainer2 path falls back to V1 `DATABASE_URL` or `DIRECT_URL`. `prisma/trainer2-runtime-grants.sql` is fresh-role administrator preparation, not an automatic migration. The identity runtime role can read owner/session rows, insert sessions and update only passcode/setup/lock/epoch or session expiry/revocation columns. Read/write training roles can select only the owner/session columns needed for transaction rechecks; they cannot read passcode verifiers or token hashes. They cannot administer the binding. Effective privilege checks reject role mismatch, dangerous inherited/PUBLIC grants, ownership, delegation, elevated parameters, unsafe RLS/replication state and unsupported PostgreSQL major versions. The grant checker qualifies PostgreSQL 17 only. Server roles remain able to query all accounts under their allowed tables; application account predicates and this singleton boundary provide account scope, not per-account RLS isolation.

The [shared-database procedure](SHARED_DATABASE_MIGRATION_PROCEDURE.md) records the PostgreSQL 17 representative-V1 rehearsal and read-only provider inspection. Supavisor's `<role>.<project>` username form is accepted only for its pooler host, while effective database role identity remains exact. The runtime supports a project CA with certificate and hostname verification. The grant file removes Supabase named API-role access and PUBLIC function execute on Trainer2 objects; the effective privilege checker tolerates only the two existing provider statistics views. New restricted roles have not been created or authenticated against production. A compromised runtime role or concurrent administrator grant change is outside the per-request checker guarantee; freeze DDL/grants during admission.

## Preview boundary

`next.config.ts` binds `TRAINER_BUILT_MODE` to the server artifact using build `VERCEL_ENV=preview` or explicit `TRAINER_BUILD_MODE=preview`. `src/lib/operations/deployment-boundary.ts` requires a Preview runtime to declare `TRAINER_DEPLOYMENT_MODE=preview`, forbids inherited V1 DB/admin/owner variables and rejects either build/runtime mismatch. `src/proxy.ts` applies this before audit fixtures and before V1 handlers; a correctly bound Preview only exposes Trainer2 routes and static assets. `src/lib/db/prisma.ts` independently blocks the V1 DB composition root before constructing its pool outside ordinary V1 mode. During Next page-data collection, a Preview build can instantiate an inert loopback placeholder only when legacy credential variables are absent; it cannot connect to production through that placeholder. Ordinary V1 production behavior with an absent runtime mode remains unchanged.

The original Vercel project's Preview still inherits V1 credentials, so it remains denied. A separate Vercel project must contain only `TRAINER_BUILD_MODE=hosted-test`, `TRAINER_DEPLOYMENT_MODE=hosted-test`, `TRAINER2_APP_ORIGIN`, `TRAINER2_OWNER_USER_ID`, `TRAINER2_DB_CA_CERT_PEM`, and the three restricted Trainer2 connection strings in Preview scope. `next.config.ts` rejects a hosted-test build with V1 credentials; `deployment-boundary.ts` repeats the runtime check; `proxy.ts` denies every V1 route and any Host other than the configured origin. The V1 DB composition root remains unavailable. Deployment protection, exact origin, exact configured owner binding and the restricted role privileges must be verified on the actual deployment before hosted writes.

## Local verification and limits

`scripts/test-trainer2-principal-postgres.ts --confirm-disposable` runs the single-user PostgreSQL 17 fixture with the V1 migration prefix, a synthetic V1 User, then additive Trainer2 migrations and grants. It compares V1 columns, indexes, constraints, triggers, functions and grants, exercises a V1 User write, and checks effective API-role denial for Trainer2 tables, sequences and functions. `TRAINER2_BROWSER=1` adds desktop and phone-sized browser profiles, browser and Next restarts, sign-out and revocation. `scripts/trainer2/verify-deployment-artifact.ts` probes real Preview and ordinary Next builds with `next start` in both mismatch directions. These tests do not authorize production migration, real account binding, hosted login or real training.


## Explicit V2 production mode

`v2-production` is a separate build/runtime mode, accepted only in Vercel Production with
matching mode values, all three restricted connections, CA, configured owner, a canonical HTTPS
`TRAINER2_APP_ORIGIN`, and no legacy credentials. It does not admit hosted-test into Production
or weaken Preview isolation. Existing strict TLS, effective role checks, owner/session checks,
and same-origin mutations remain required. The proxy and direct request/auth adapters reject
requests whose Host differs from the configured origin. Unknown/mismatched modes fail closed.

Only V2 routes and existing static assets are exposed. `/` privately rewrites to Training at
`/trainer2`, preserving query parameters and preventing the V1 landing handler from executing.
The existing `/trainer2` path remains valid. The manifest is accessible in production with root
start URL/scope and standalone display, using the existing icons. Apple installation metadata
uses the existing Apple icon. There is no service worker or offline mutation queue. V1 mode
retains its landing, navigation and route admission. Production V2 omits disposable/trial labels.

This code does not authorize or perform hosting configuration, domain transfer, credential
changes, database migration, or cutover. The release executor must verify exact domain and secure
environment scopes, keep Preview protected, preserve the existing owner/passcode/plan/history,
and qualify the frozen source before publishing. A new host requires Aaron to sign in with his
already chosen passcode; no reset or session transfer is performed by this patch. Desktop/mobile
viewport automation does not establish physical iPhone/Safari installation behavior.
