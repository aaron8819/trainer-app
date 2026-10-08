# Private passcode replacement candidate

Base: `b79d15c7a7b53adf74bcf43e2e8038c9da504e4f`.
Base tree: `8be3fecd8a1261b9710807219ca8e4691ce160e9`.

This local candidate adds a signed-in Device access form. Aaron enters and confirms his own
12–128 character passcode privately in the app. No setup credential is generated, transported
through chat, or returned by the endpoint. No live credential action was performed.

The POST requires the existing exact-origin admission and an active same-owner session. Under
the singleton owner row lock it rechecks the session, owner identity, expected epoch, and epoch
capacity. One transaction replaces the verifier, clears setup and lockout state, increments the
epoch, and revokes all active V2 device sessions. It then expires this device's cookie. No training
models, owner rebinding, migration, grants, or deployment configuration are changed.

## Action-time handoff

After independent review and separately authorized publication, Aaron must still have a valid
signed-in laptop session at the protected app origin. He opens Device access, expands Choose a
new passcode, and privately enters and confirms his chosen passcode. Before submitting, approve
the concrete action: replace this same owner's V2 passcode and sign out every V2 device,
including the laptop. Aaron submits the form himself, then signs in on laptop and iPhone with
his chosen passcode. Do not send the passcode to the agent or chat. An expired session or stale
epoch fails closed; do not substitute an operator reset or generate a setup credential.

The active plan `436c1aa6-a428-4e41-a0ca-3cee843a5079` and identity/training data must remain
unchanged except for the explicitly approved authentication fields at action time. This task
did not inspect or mutate live data. No release or independent approval is claimed.

## Qualification

Six synthetic test files: 31 tests passed, process exit 0. Includes authentication and epoch
contracts, replacement confirmation and length checks, stale owner/epoch, expired authorization,
locked session recheck, serialized competing submissions, rollback on failed revocation, exact
origin admission, malformed form rejection, cookie expiration, and private sanitized responses.
The transaction tests use mocks; they do not qualify PostgreSQL concurrency or a deployed flow.
The synthetic training sentinel remains unchanged and replacement writes target auth models only.

No server, database, browser, hosted resource, or real plan was created or activated. Only local
test processes and this isolated worktree's dependency copy were used. No shared process was
stopped. The earlier historical preservation failure remains open and attribution unknown;
missing resources were not recreated. No desktop/mobile or physical iPhone/Safari journey was run.

Independent review must use the frozen commit and tree reported with this handoff, examine the
same-owner authorization under the row lock, atomic epoch/revocation semantics, secret handling,
private browser entry, and absence of training writes. Parent owns that review and subsequent
publication/action-time approval. Logs and explicit exit files are retained beside this report.

Additional qualification: two private-form render checks passed (exit 0); TypeScript and scoped ESLint passed (exit 0). Initial render-run sandbox and fixture-hook failures are retained. The fixture returned a mock as an unintended cleanup callback; correction uses a void hook. No product behavior was changed to accommodate the test.
