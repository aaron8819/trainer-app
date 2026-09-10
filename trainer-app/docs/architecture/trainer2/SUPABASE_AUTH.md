# Trainer2 Supabase authentication

September 10, 2026. Supabase Auth is the selected identity authority. The cookie/session slice is locally implemented; **hosted Trainer2 admission remains unconditionally disabled**. Authentication neither provisions a Trainer2 account nor completes Phase 0. [Principal mapping and role boundary](PRINCIPAL_BOUNDARY.md) remains authoritative for application authorization.

## Flow and ownership

- `src/lib/api/trainer2/authentication.ts` owns configured Supabase clients and server identity verification.
- `auth-http.ts` owns auth HTTP policy, response cookies and proxy refresh. Thin routes live under `src/app/trainer2/auth`.
- `GET /trainer2/auth` renders a dynamic, identity-dependent sign-in/status page without querying application accounts or training tables.
- `POST /trainer2/auth/sign-in` accepts an email form, uses `signInWithOtp({ options: { shouldCreateUser: false } })`, and returns the same generic redirect/notice for unknown addresses, invalid email syntax, provider errors and successful initiation. Provider rate limits still apply; this is not a timing-side-channel guarantee.
- The email uses Supabase's default confirmation link. The provider verifies that link and redirects to `/trainer2/auth/callback?code=...`. The initiating browser's SSR PKCE verifier cookie and the single-use code are exchanged with `exchangeCodeForSession`. Both identity checks below must pass before response session cookies are installed.
- `GET /trainer2/auth/callback` accepts only one UUID-shaped code and optional approved `next`. Implicit tokens, token hashes, extra/duplicate parameters and malformed codes are rejected. Codes require the initiating browser and expire under the provider's PKCE lifetime (five minutes). Starting another flow in the same browser replaces its verifier; restart sign-in if an earlier link fails.
- `POST /trainer2/auth/logout` signs out this session with `scope: "local"` and clears all session/PKCE cookie chunks, including refresh cookies created during that request. Other sessions remain signed in. On provider failure it still clears this browser and explicitly says revocation could not be confirmed.

Auth routes remain reachable separately from the disabled Draft/training admission path. No signup, social-provider, bearer-token, account-provisioning or execution API was introduced.

The shared navigation omits legacy application links on auth routes, preventing their production prefetch from opening legacy pages during sign-in. Other navigation and local Draft behavior are unchanged.

## Server trust and verification

All variables are server-only, required for configured authentication, and read per request. No `NEXT_PUBLIC_` variables or administrative Auth credentials are used by application code.

| Variable | Meaning |
| --- | --- |
| `TRAINER2_AUTH_URL` | Exact Supabase project origin without trailing slash; the SDK builds its Auth endpoint from this configured URL |
| `TRAINER2_AUTH_PUBLISHABLE_KEY` | Public/publishable project API key; the disposable older GoTrue harness uses a synthetic legacy anon key |
| `TRAINER2_AUTH_ISSUER` | Exact `TRAINER2_AUTH_URL + "/auth/v1"`; no issuer alias or token-directed discovery |
| `TRAINER2_AUTH_AUDIENCE` | Exactly `authenticated`; multi-audience tokens are not supported |
| `TRAINER2_APP_ORIGIN` | Exact approved application origin without path/trailing slash; redirect and Origin authority |

HTTPS is required except explicit loopback HTTP configuration for local qualification. No forwarded header, request hostname or JWT field selects the trusted provider or application origin. Hosted provider/TLS/custom-domain configuration requires separate qualification.

Transport is SSR cookies only. Any Authorization header is rejected, including bearer-only and mixed cookie/bearer requests. Cookie claims and request account IDs have no authority. Per-request clients keep session state isolated.

`getSession` supplies a token and may refresh its transport; its user object is never trusted. `getClaims(accessToken)` verifies that exact token through the installed supported SDK (asymmetric JWKS/WebCrypto or provider verification for symmetric keys). After successful verification, the adapter requires exact issuer and scalar audience, UUID subject, finite unexpired `exp`, finite nonfuture `iat`, and a valid nonfuture `nbf` when present. It then requires live `getUser(accessToken)` to return that exact subject. Thus even cached signing keys cannot hide provider unavailability. Provider requests are no-store and each fetch has a five-second timeout; SDK refresh retries can extend total request time.

The returned principal is only `{ issuer: configuredIssuer, subject: verifiedSupabaseUserId }`. Email, upstream identity IDs, user metadata, cookie user data, OWNER_EMAIL and browser assertions never supply mapping authority. Errors deny identity; there is no development rescue or environment-selectable verifier fixture.

## Cookies, redirects and request protections

SSR 0.8.0 cookies use the dedicated `trainer2-auth` storage name and chunk suffixes, plus its PKCE verifier cookie. They are host-only, Path=/, SameSite=Lax, Secure on HTTPS. This integration retains the supported SSR browser-compatible default `HttpOnly=false`; same-origin scripts can read these credentials. It must not be described as an HttpOnly session. There is currently no browser Supabase client. The library's 400-day cookie max-age is storage retention, not token/session validity; provider expiry and refresh revocation remain authoritative.

The proxy preserves UI audit handling and public-asset exemptions. It refreshes identity-dependent Trainer2 page/API requests, writes refreshed cookies to the downstream request and response, and never passes an authenticated identity header. Handlers verify independently. Auth route handlers own their exchanges and cookies. Cookie changes survive response reconstruction. Failures never create fallback identities.

Auth responses/pages are private/no-store and vary on Cookie/Authorization; the page is force-dynamic. Auth endpoint proxy headers also cover framework method rejections. The form page uses Referrer-Policy=same-origin: no-referrer there makes Chromium emit Origin:null on form POST. Callback success/error responses use no-referrer, remove credentials from the destination URL, and Next development logging excludes callback request URLs. Hosting/gateway logging must likewise redact callback queries before a hosted run; no hosted logging setup was inspected.

Sign-in and logout require POST, exact configured Origin, and no cross-site/same-site Fetch Metadata assertion (missing Fetch Metadata is tolerated, Origin is not). GET cannot log out. The callback uses PKCE rather than a same-origin POST check, since it follows an email/provider navigation. An unsolicited failed callback discards pending cookie changes and preserves any existing valid session.

The sole approved post-authentication destination is `/trainer2/auth`. Supplied destinations must match exactly. External, protocol-relative, backslash, encoded external, traversal, malformed, query-bearing and fragment-bearing alternatives are rejected. Redirects are built from configured origin, never Host/X-Forwarded-*.

## Mapping, logout and revocation boundaries

Sign-in, callback, refresh, status and logout do not insert User or principal-binding rows. `principal.ts` still resolves exact issuer/subject using the restricted identity connection on each authorization. Unknown subjects are denied. Mapped identities still encounter `HOSTED_ADMISSION_DISABLED` before any training pool or Draft command. Dedicated read/write/identity/legacy/admin connections and effective privilege checks are unchanged.

Successful local-scope logout invalidates that session's refresh credential. A previously issued access JWT can remain cryptographically valid until expiry; this slice does not query `auth.sessions` or claim instantaneous access-token revocation. The additional live user lookup detects provider-side rejection when returned, but is not a new strict session-revocation subsystem. If logout cannot reach the provider, copied refresh credentials may remain usable even though browser cookies are cleared.

Application authorization is separate: binding removal/reassignment is seen on the next lookup and denies historical action replay for the old account. Already-authorized in-flight operations may finish, as documented in PRINCIPAL_BOUNDARY.md. No cancellation subsystem or offline workspace lifecycle was added.

## Reproducible local qualification

Use installed lockfile dependencies (`npm ci`, then `npm run prisma:generate` if needed), Docker and installed Edge. Run from `trainer-app`, without inherited hosted/database targets:

```text
node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-auth-postgres.ts --confirm-disposable
node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-principal-postgres.ts --confirm-disposable
node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-drafts-postgres.ts --confirm-disposable
node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-legacy-postgres.ts --confirm-disposable
npm run test:verify-gate
npm run test:environment-classification
```

For focused credential-free tests, set `TRAINER_CREDENTIAL_FREE_TEST=1` and run the installed Vitest over `src/lib/api/trainer2/` and `src/proxy.test.ts`. The normal repository verification plan also selects PowerShell tooling tests and command-registry validation.

The Auth harness uses already-installed images with --pull=never: postgres:17-alpine, public.ecr.aws/supabase/gotrue:v2.187.0 and public.ecr.aws/supabase/mailpit:v1.22.3. It creates uniquely named containers/network, two separate disposable Auth/application databases, explicit synthetic Auth users, application accounts and restricted roles. The Auth database has its own auth schema/search path. SMTP is only the task's Mailpit; no real email is sent. Admin keys exist only in the harness. App processes receive only the synthetic anon key and dedicated application-role connections. Inherited `GOTRUE_DB_DATABASE_URL` is included in canonical target rejection/sanitization.

The harness starts the installed Next webpack dev server, drives two Edge contexts, reads the local inbox through its API and navigates the real callback in Edge. It tests real refresh rotation by aging only the browser's expiry hint, and real callback expiry by aging only the disposable Auth flow. Its combined Vitest fixture uses the real verifier and real PostgreSQL, adapting only the hosted database transport to loopback; production has no such selector. It checks unknown/mapped identity, no provisioning, removal/reassignment, historical replay and no training-pool/command execution on hosted denial. Existing principal and legacy harnesses additionally exercise effective-grant/RLS adversaries.

`authentication.test.ts` uses real SDK RSA signature verification against controlled JWKS/provider responses for invalid signatures, claims, malformed credentials, provider errors, concurrency and refresh-cookie propagation. These are explicitly fixtures, not real-service evidence. The local service flow uses its real HS256 tokens; hosted asymmetric signing-key rotation is not qualified by that run.

Harnesses retain source hashes before/after, timestamps, versions, statuses and sanitized commands under ignored `artifacts/trainer2-auth`, `trainer2-principal`, `trainer2` and `trainer2-legacy`. They clean up task-owned services/processes; they do not retain inbox bodies, browser storage state, traces or full credentials. `artifacts/trainer2-auth/REPORT.md` binds final source and all qualification results. Do not infer a pass merely from these instructions.

## Remaining gates

The next step is one focused independent review of this verifier/session flow together with mapping and database roles; it has not passed. Hosted project access/configuration, actual project keys/issuer, callback allowlist, SMTP, secure cookies, gateway logging, TLS/pooler compatibility, signing-key rotation and deployed session behavior require named-environment authorization and separate qualification. The exact configured callback is `TRAINER2_APP_ORIGIN + "/trainer2/auth/callback"`.

Phase 0 still needs hosted identity/role/source qualification, remaining source/device/backup obligations and legacy direct-route protection. N1–N4 remain tracked in the legacy inventory; closed F1–F3/RLS corrections remain closed. Migration/cutover still requires source reconciliation, backup/recovery/device completeness, writer fences and the Phase 0–5 foundation. No hosted access, real mapping, push, merge, deployment, cutover or training admission is authorized or enabled by this slice.

## Official references consulted

Checked September 10, 2026, alongside installed SSR 0.8.0, supabase-js/auth-js 2.93.3 and Next 16.1.6 source. Dependencies and lockfile are unchanged.

- [Supabase SSR and Next proxy integration](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)
- [Supabase getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [SSR cookie/session guidance](https://supabase.com/docs/guides/auth/server-side/advanced-guide), [sign-out semantics](https://supabase.com/docs/guides/auth/signout)
- [Next proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy), [Next request logging](https://nextjs.org/docs/app/api-reference/config/next-config-js/logging)
- [Self-hosted external URL default change](https://supabase.com/changelog/47093-self-hosted-supabase-api-external-url-to-include-auth-v1): the pinned harness explicitly sets matching issuer and email paths; it does not adopt a changing compose default.
- [Email-template restrictions](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier): no hosted template changes; this flow uses the default confirmation-link pattern and local SMTP.
