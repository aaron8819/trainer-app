# Trainer2 workout start handoff

Implemented locally and ready for focused independent review. This is implementation evidence, not independent acceptance. V1 remains live, hosting paused and Phase 0 incomplete.

## Try it

Separate disposable demo: **http://127.0.0.1:32852/trainer2/dev/drafts**. READY was observed and the exact URL returned HTTP 200. Build or customize a plan, Save plan, Review plan, Activate plan, then Start workout. Inspect the prescribed sets, bookmark the execution URL and reload. Return to the plan bookmark for Continue workout. Set logging is explicitly unavailable.

The existing user demo/checkouts/data were preserved. This task's demo is separate and synthetic: **all its plans/workouts are deleted when its launcher stops**. Do not enter real plans. The deliberately retained launcher is unified terminal session `4288`; Enter/Ctrl+C invokes its own cleanup. To launch another disposable demo, from this worktree's `trainer-app`, run `node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable` and wait for its own READY URL. A new launcher creates a new database. The verification harness separately proves an app-process restart against the same still-running database; its localhost port may change but execution identity and stored prescription do not.

## Coordinates and ownership

- Branch: `codex/trainer2-workout-start`.
- Accepted base: `010836c5a12f5e85a36b53c00b408ffeb5cbdee9`; tree `c11a6cecfdf33efa69c30e928e7007d3e0cd2ebe`.
- Worktree: `C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-workout-start`.
- Final commit/tree and source/artifact hashes: [FINAL_BINDING.json](workout-start-evidence/FINAL_BINDING.json), generated after commit to avoid self-reference.
- Preimplementation contract/matrix: [WORKOUT_START_CONTRACT.md](WORKOUT_START_CONTRACT.md).
- Canonical implementation contract: [WORKOUT_START.md](../../docs/architecture/trainer2/WORKOUT_START.md).

Execution & Evidence owns `src/lib/api/trainer2/execution.ts`; `acceptCommand` retains trusted principal validation, account serialization, durable envelope identity and atomic outcomes. Thin routes use the existing access/Origin/admission boundary. Planning still owns the activated immutable revision. No V1/history import, hosted admission, result, finish/skip/abandon, replacement, automatic progression, active-plan edit or LLM API was added.

## Start and stored prescription

`StartOccurrence` names plan/occurrence UUIDs, exact expected approved PlanRevision and instruction epoch, with the existing action/device/account/ownership/dependency envelope and empty intent. Browser account is an assertion against the trusted server principal; browser prescriptions are not accepted.

The first occurrence in the authoritative saved occurrence order is eligible. Labels and array indexes do not establish identity. This slice has no resolution command: start does not advance selection or imply completion. Direct requests for later or unrelated occurrences fail; the handler never substitutes a different workout.

Under the account lock, source ownership/lifecycle/revision, saved validity, next eligibility, Open exclusivity and current restrictions are checked. One transaction creates an immutable Open `Trainer2Execution`, its full START document, sequence increment and durable outcome. Capture fields include exact source occurrence/stage/revision/hash; ordered exercise identities/descriptions/catalog meaning; ordered set identities/classification/requiredness; rep ranges/basis; original load decimals/unit/convention/zero meaning or null; effort/rest; planned-prescription progression and policy/version/instruction provenance. Execution positions/targets have new stable IDs plus explicit ordered source links. The identity map has no duplicate prescription values.

The capture is embedded in the immutable execution root; no mutable prescription head or default-derived copy is maintained. Reload reads this record only. Unsupported/corrupt/missing capture fails explicitly, never rebuilding from current intent/catalog. Future set assertions and session adjustments need separate owned records and must preserve this START reference.

Exact retries, including lost responses, return the same outcome/IDs/timestamp/hash. Changed envelopes collide. New same-source requests receive ALREADY_STARTED. Another Open execution blocks start with OPEN_EXECUTION_CONFLICT. Read/Continue creates no action and is not a pause/resume transition. Canonical sessionStorage commands survive reload; repeated clicks and stale response generations are guarded. Accepted responses navigate to an independently validated execution read.

## SQL and privilege changes

Only new migration `20260914010000_trainer2_workout_start` is added; historical migration bytes are unchanged. It adds same-account source/action foreign keys, one ordinary source execution, a partial unique Open-per-account index, immutable update/delete guards, canonical/hash checks, source/identity and deferred outcome seals. The existing acceptance validator now recognizes StartOccurrence and preserves earlier owner/sequence checks.

Runtime gains SELECT/INSERT on `Trainer2Execution`; reader gets SELECT; neither gets UPDATE/DELETE/DDL. RLS is enabled and PUBLIC has no new grants. No browser role, V1 permission or privileged runtime connection is added. As in the accepted boundary, server roles cover all accounts and application predicates enforce account isolation; administrative DDL/owner corruption is outside runtime immutability guarantees. Corruption fixtures explicitly use the disposable owner, never application capabilities.

## Verification and evidence

Source-bound receipts/logs are in [workout-start-evidence](workout-start-evidence/). The recorder stores command, environment classification, times, status, before/after source hashes and log hash. [verification.json](workout-start-evidence/verification.json) additionally binds PostgreSQL/browser results, migration commands and service cleanup.

| Check | Result |
| --- | --- |
| Disposable `scripts/test-trainer2-workout-start.ts --confirm-disposable` via installed tsx | PASS, 8 distinct groups; real PostgreSQL 17 and Edge |
| Fresh full migration chain and repeated deploy | PASS; disposable database, no migration replay |
| Upgrade from accepted-base migration chain with activated synthetic plan | PASS; 10 historical tables preserved; restricted-role read/start succeeds |
| Template and independent/nonalphabetical/repeated-name workouts | PASS; independent source expectations, mixed optional/per-side zero/null targets and stable source/session identities |
| Exact retry, changed payload, response loss, concurrent identical/distinct/competing requests | PASS; observed blocking chains and durable outcomes; one execution |
| Draft, wrong account/revision/occurrence, later occurrence, stale instructions/exclusions | PASS; no start or substituted source |
| Old Open execution plus newly activated plan | PASS; new start blocked, existing execution remains readable |
| Post-insert trigger failure | PASS; execution/action/outcome/counters roll back; original command then succeeds |
| Immutable SQL and catalog independence | PASS; owner update/delete rejected; prospective catalog fixture cannot change stored read |
| Corrupt snapshot and read-only reopen | PASS; explicit failure, no fallback; repeated reads do not write |
| Actual browser journey, dropped response/exact retry, bookmarks, Continue, reload, same-DB process restart | PASS; API/DB round trips, exact saved source and unchanged persisted rows |
| Desktop and 390×844 mobile emulation | PASS; screenshots visually inspected, no horizontal overflow or page errors; not physical-device verification |
| Focused Trainer2 engine/UI/API/import-boundary suites | PASS: 16 files, 166 tests |
| TypeScript `tsc --noEmit --pretty false` | PASS |
| `npm run lint` | PASS, no warnings |
| `npm run verify:contracts` | PASS |
| `npm run test:fast` | PASS: 8 files, 86 tests |
| `npm run test:environment-classification` | PASS: 5 files, 212 tests, 1 existing Windows skip |
| Explicit `command coverage honesty` filter | PASS: 2 tests; 106 other tests unselected, not execution evidence |
| Registry validator | PASS: 128 commands, all 84 package scripts, no errors/warnings |
| Full `scripts/codex/tests/Run-Tests.ps1` | PASS: 108 tests, zero failures |
| `npm run test:preflight` | PASS: standalone exact-lock dependencies, generated compatible Prisma client, DB targets absent |
| Whitespace and final repository policy plan | Recorded in final evidence |

Two new Vitest files (`Workout.test.tsx`, `execution-http.test.ts`) are credential-free and add six cases. Fixed inventory expectations were reconciled from 402→404 and 363→365; the 34 import-only and 5 DB-required selections are unchanged. The disposable script is separately registered with exact confirmation and included in guard coverage. The route-isolation test now visits all eight Trainer2 API routes and explicitly admits only the new execution page, retaining legacy-owner restrictions.

The accepted inventory review at `trainer2-test-inventory-review/trainer-app/artifacts/review/TEST_INVENTORY_REVIEW.md` closes prior builder/progression/activation/guard work. Unchanged behavior uses that accepted base evidence; those reviews were not reopened. Full credential-free inventory and release-only DB/build gates were not mechanically rerun; the repository planner marks release `verify` and migration/drift release gates outside this local implementation mode. The new SQL has its own fresh/upgrade/real-transaction verification.

Earlier failures remain labeled failures: the first SQL probe found an ambiguous variable; browser interception initially asserted before commit; a new closure prerequisite fixture required flushing deferred triggers; the isolation allowlist needed the new exact page. The completed final DB/browser and focused receipts pass with unchanged before/after source. Other successful receipts predate only the two test-fixture corrections and EOF whitespace normalization. Full tooling ran across those changes; its before/after differences are exactly the policy EOF, SQL fixture test and isolation test, with no tooling implementation change. Final binding lists source deltas rather than pretending every check ran on identical bytes. The handoff is added after execution evidence. No broader unverified runtime delta is introduced.

Screenshots: [desktop](workout-start-evidence/desktop.png), [mobile emulation](workout-start-evidence/mobile-emulation.png). Verification containers and app processes were cleaned up; the final harness records removal of `trainer2-draft-ba1577456fc1` with exit 0. One earlier interrupted test container was identified by its exact fixture plan and removed; its known server port was confirmed closed. Only the separately identified demo is deliberately retained.

Next boundary: explicit performed-set assertions and subsequent session adjustments, owned separately from this immutable initial prescription. No partial foundation/hosted readiness or Phase 0 completion is claimed.
