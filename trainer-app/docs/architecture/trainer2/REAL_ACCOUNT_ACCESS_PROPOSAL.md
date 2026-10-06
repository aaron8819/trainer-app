# Real-account access preparation — review handoff

Prepared 2026-10-06. Status: **local proposal; real admission remains disabled**.
This is access setup only. Program creation, V1 cutover, imports and training
writes are outside this task. V1 stays available with writes enabled.

## Confirmed state

The stable protected origin is
https://trainer2-hosted-synthetic-git-codex-e763ff-aaron8819s-projects.vercel.app/.
Live alias/provider inspection resolves deployment
`dpl_F8hbhPb17M11MUL16zp7KE9Qjkkz`, READY, Preview/staging, source
`124d57e0c2b8138b75e3f716729a9c9d26885456`, tree
`7f04590a59d2e7efe724b5a13b5d6982841c471e`. Protection covers all deployments;
there is no bypass. Nine configured keys have Preview scope; no legacy DB/admin
or V1 owner key appears in that inventory. Full private values were not printed.
Live plain build/runtime mode values both equal hosted-test, and the configured
application origin exactly matches the stable origin above.

User-reported hands-on approval: the owner approved the deployed redesign on a
physical iPhone. This does not establish particular timer/backgrounding checks.

An administrator connection with strict CA/hostname verification performed only
a repeatable-read READ ONLY transaction. The configured V1 email privately
matched exactly one existing User with a valid ID. That identity differs from
the configured synthetic singleton. All 20 account-scoped Trainer2 tables have
zero rows for the real identity, including owner, plan, execution, result,
draft/revision, action/outcome and training-state tables. Twenty-four synthetic
device-session rows remain. No setup code or passcode was generated.

The existing provisionSingleUser helper deliberately refuses an existing owner.
The principal runbook describes hosted-test as synthetic-only; the shared cutover
plan requires a separately reviewed real-owner admission change. Merely changing
the environment ID is not a supported transition. The current code's singleton
comparison would deny it; rebinding without session invalidation would be unsafe.

## Bounded local implementation

Canonical owner: the existing owner/session boundary, not routes or UI.
`src/lib/api/trainer2/owner-transition.ts` supplies an operator-only proposal,
with no HTTP route or runtime callsite. It:

1. Requires the exact expected synthetic ID and privately verified real ID.
2. Locks the singleton, rejects unexpected binding, historical principals,
   missing users, non-synthetic source and epoch overflow.
3. Discovers all account-scoped Trainer2 tables and rejects any real-owner data.
4. Locks retained sessions and requires the caller to durably encrypt the full
   previous owner/session snapshot outside Git/reports/logs before proceeding.
5. Revokes all active synthetic sessions, preserves their rows, advances epoch,
   resets credentials to a fresh one-time setup verifier, and changes only the
   singleton account binding. It updates no User or training record.

The private archive is required because retained sessions reference singleton
key 1 rather than an immutable account ID. Historical sessions must be interpreted
using that archived synthetic binding/epoch; they must never be reported as real
device activity. Archiving failure aborts before writes; a later transaction
failure may leave a harmless private archive of the unchanged prior state.

Synthetic impact if applied: existing sessions lose access, and old pending
requests must be denied. The old pending-action tab must remain untouched;
never clear storage, replay it, or reuse its drafts. Synthetic User, plans,
executions, results and audit records retain their account IDs. Synthetic login
at this origin ceases; concurrent synthetic and real admission is not provided.

No schema/grants, application admission mode, public identity path, dependency,
training contract or remote configuration changed. The new helper is not yet a
supported production procedure. Review must qualify it before execution.

## Required review and remaining preparation

Review exact helper, tests and existing sessions/principal/DB role/HTTP admission
seams. Qualify actual PostgreSQL transaction rollback, concurrent setup/session
renewal, archive failure, stale synthetic cookies, real-account empty admission,
and an unrelated account using disposable synthetic data. Unit mocks do not
prove database rollback or locks. Implement/review an operator runner that
encrypts and verifies the archive durably outside Git, privately re-resolves
the real User, checks exact database/schema/roles and refuses unexpected state.
No general SQL runner, unchecked recovery command or browser binding route.

Review must explicitly qualify using the existing exact-ID single-user mechanism
for real hosted access: hosted-test currently has synthetic-only documented scope.
Do not treat its configuration-only technical capability as reviewed real access.
Retain build/runtime match, Preview restriction, exact origin/Host, protection,
restricted-role checks, session rechecks and same-origin POST requirements.

After review, pause/drain Trainer2 only while archiving/rebinding; never pause V1.
Configure only this project's Preview owner ID privately, redeploy exact approved
source/configuration, and retain the same stable protected origin. Verify owner,
old-session denial, empty read models and real setup via existing auth POSTs.
Do not create a plan or test training mutation. No approval for schema/grants
is implied by this proposal.

Recovery must keep the real binding, epoch and owner configuration. Old synthetic
immutable deployments embed synthetic configuration and are **not** real-account
recovery artifacts. Prepare/verify a compatible recovery deployment with the same
real ID/origin/restricted credentials and protection before enabling real access.
An access pause is safe; switching the alias to synthetic config is not recovery.
Never restore archived synthetic credentials/session validity as rollback.

## Private setup and device steps (after admission is enabled)

Deliver a generated one-time setup code through a private operator secret channel
or OS-protected local secret file outside the repository. Never include it in a
URL, report, chat log, clipboard automation log, source file or command argument.
Use the existing setup form to choose a unique 12–128 character passcode; save it
in a password manager. The operator need not know the chosen passcode. If secure
delivery is not available, stop before generating the code.

On the phone, use a normal Safari profile, open the stable origin, pass Vercel's
protection prompt with the authorized Vercel account, then use setup once. On
desktop, use a normal browser profile at the same origin, pass protection and
sign in with the chosen passcode. Each browser receives its own device session.
Do not use private browsing for persistence verification.

Expected home: empty Training with no plan, workout or result. Do not enter
Builder inputs. On each device reload, close/reopen its browser normally, return
to the same origin, and confirm it remains signed in and empty. Actual physical
phone/desktop restart persistence remains a user check until performed.

Automated session unit coverage establishes Secure, HttpOnly, SameSite=Lax,
host-only cookie name, Path=/, 90-day cookie lifetime and denial after epoch
change/revocation. Source establishes 30-day sliding/90-day absolute DB expiry,
renewal within seven days, separate sessions and no client-readable token store.
The principal runbook describes disposable device/browser restart tests; this
task did not execute those browser checks. Neither that description nor the
unit tests prove a real-owner deployed session or Vercel protection-cookie
persistence. No real session exists yet.

## Verification limits and preservation

Focused local test results and sanitized read-only inventory live in
`artifacts/real-access/`. No live owner/configuration mutation or deployment was
performed. V1 reports source `eb1b45e9c516d14e8857e5b028f2be13233619cd`, deployment
`dpl_BKDcSbGTQUZvWe4tUe8ErgpB2aUH`, writes ENABLED. All retained worktrees, previews,
synthetic sessions and pending tabs remain. No task bypass or verification server
was created. Efficiency work remains paused.

Local checks: four focused files / 23 tests PASS (transition, session, deployment
and proxy boundaries); repository test:fast / 86 tests PASS; full TypeScript
noEmit PASS; focused ESLint PASS; git diff --check PASS. Verification policy
planning succeeds and recommends test:fast/diff for implementation and verify
for release. No release is being performed; full verify and disposable PostgreSQL
transition qualification remain review/release gates. The initial inspection
attempt lacked OWNER_EMAIL in the rollout file; it failed before connecting,
then succeeded using the private existing V1 owner configuration. Two incorrect
verification-planner invocations failed before a corrected plan succeeded.

Combined release evidence is reused for unchanged application/domain behavior.
Its stale isolation test failure remains FAIL, with the documented exact-base
disposition; no full inventory, physical timer/backgrounding or real hosted
admission PASS is claimed here. The real account is verified empty in the DB;
an authenticated empty real-owner Training home cannot yet be claimed.
