# Isolated Linux combined qualification

This test-only path reuses `equipment-journey.ts` (seven combined groups) and
`navigation-journey.ts` (empty and populated accounts). It does not establish
physical iPhone/Safari behavior or qualify the Windows native ownership helpers.

The `trainer2-combined-acceptance` GitHub-hosted Ubuntu job explicitly opts in with
`TRAINER2_ISOLATED_LINUX_JOB=1`. It runs the equipment worker directly, avoiding the
Windows controller. Every fixture creates its own Docker PostgreSQL container,
random ownership label, synthetic account and local Next process. No configured
or real account database is used. Existing restricted fixture grants are reused.

Next is spawned into a new detached group. Only that freshly spawned child handle
can authorize one SIGTERM to its group. An already exited leader blocks signaling;
actual close and group absence are required. No PID inventory, descendant search
or escalation exists. Playwright closes its own server handle with bounded waits.
Docker removal retains the existing exact random ownership-label check. Failures
and command exit codes remain artifacts; CI runner disposal is not a passing
cleanup receipt. Job cancellation or outer timeout may prevent normal receipts.

The CI job checks out the PR head SHA and records commit/tree plus dirty status.
It pre-pulls postgres:17-alpine, installs Chromium/dependencies and uploads source,
journey, worker-exit and cleanup evidence. An exit-zero assertion requires successful
cleanup as well as journey assertions. This patch is not a live Linux qualification.

Publishing requires separate authorization. The existing workflow triggers on PRs
to master, including existing inventory jobs; no push/manual trigger or permission
was added. A Vercel project is linked in committed remote metadata. Provider-side
Git preview settings are unknown and a push/PR may trigger a hosted preview build.
No remote provider query, push, PR, dispatch or deployment was performed locally.

The prior Windows failure and historical preservation incident remain open.
Primary AND recovery readers must eventually be updated compatibly for the new
equipment snapshots/conventions; neither is authorized for deployment here.
