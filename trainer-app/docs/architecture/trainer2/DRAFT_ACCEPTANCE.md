# Draft slice correction acceptance evidence

Scope: F1–F3 on `codex/trainer2-draft-corrections`, based exactly on reviewed commit `58623de537df05f8fbf6cb02b0dc7931d3d9d849`, tree `fb4422c9067a19b34f6902cab7695e9f80d1bbc3`. Original implementation base: `eb1b45e9c516d14e8857e5b028f2be13233619cd`. Candidate coordinates and cleanliness were verified before creating the isolated correction worktree. Original implementation/review checkouts remain intact.

Status: corrected locally for focused independent re-review. This is not an independent re-review pass or completion of Phase 0. [Correction report](DRAFT_CORRECTIONS.md).

## Source attribution

Fresh evidence is retained under ignored `artifacts/trainer2/`:

- `verification.json`: PostgreSQL, upgrades, actual browser and build results; full tested commit/tree, dirty/clean state, exact source manifest, raw/LF-normalized hashes, migration/harness/test definitions, sanitized commands, versions and timestamps.
- `checks.json`, `checks-source.json` and command logs: focused tests, classification, Prisma generation and repository gates with source attribution.
- `final-attestation.json`: final commit/tree/state and evidence hashes with source-equivalence checks. Kept outside tracked source to avoid self-reference.
- `accepted-refresh-failed.png`, `recovered-current-head.png`, `draft-loop.png`: actual Edge screenshots.

All correction regression definitions are tracked source. A separate ignored baseline probe reproduces the reviewed candidate's canonical-chain omission; its module/test/probe hashes and exact method are in `reviewed-chain-baseline.json`. It does not replace correction tests or claim a full base suite run. Raw checkout hashes qualify Windows CRLF/LF differences. The original applied migration is unchanged in Git. Historical implementation artifacts lacked sufficient attribution and are not retroactively certified. The review's green component probes asserted faulty behavior; these correction regressions assert desired behavior.

## F1 database matrix

Entry: `npm run test:db:trainer2-drafts -- --confirm-disposable`. The guarded entrypoint classifies arguments/inherited targets before database imports, then creates only its own loopback PostgreSQL 17 container. [`verify-acceptance.ts`](../../../scripts/trainer2/verify-acceptance.ts) uses the restricted runtime role, complete positive controls and exact errors. Whole-table rollback snapshots include heads, revisions, registry, actions, outcomes and counters.

| Claim | Evidence | Result |
| --- | --- | --- |
| Complete Create/Edit sets commit | Acceptance inserted before graph completion; deferred seal at COMMIT; real handlers also pass | Pass |
| Phantom acceptance cannot commit | Missing revision fails `23514 / trainer2_acceptance_revision` at COMMIT | Pass |
| Account/action/plan/revision/result agreement | Foreign-account and other-action results; wrong target/type/expected parent; wrong revision ID/number/content hash | Pass |
| Acceptance sequence/counter consistency | Fabricated/duplicate/missing sequence, unchanged/skipped counter and counter-only increment rejected by `trainer2_acceptance_sequence` | Pass |
| No partial acceptance | Full snapshots unchanged after every malformed acceptance/graph transaction | Pass |
| Existing revision-to-acceptance seal | Missing outcome fails specifically `TRAINER2_REVISION_WITHOUT_ACCEPTANCE` | Pass |
| Discriminating graph tests | Complete successor control, then missing-stage/duplicate/foreign-ID cases fail specifically `TRAINER2_DOCUMENT_REFERENCES`, with acceptance present | Pass |
| Historical replay | Original outcomes preserved after edits/tombstone; successor head unchanged and tombstone remains hidden | Pass |
| Concurrency | Concurrent identical first creates produce one acceptance/one replay; same-base edits yield one acceptance/one conflict with losing envelope retained | Pass |

The main harness retains the original strict-envelope, identity continuity, immutable-history, read-only GET, legacy-grant, outcome-pagination and rollback checks. SQL owns structural/result integrity; existing application/domain owners still judge acceptance/edit policy.

## F2/F3 UI matrix

[`DraftWorkbench.test.tsx`](../../../src/components/trainer2/DraftWorkbench.test.tsx) has six cases including parameterized failures/replay. The focused component/domain/isolation run totals 13 tests. [`verify-workbench-browser.ts`](../../../scripts/trainer2/verify-workbench-browser.ts) separately uses installed Edge against actual Next handlers; delayed POST delivery still uses real commands.

| Claim | Component evidence | Actual browser evidence | Result |
| --- | --- | --- | --- |
| Accepted create plus failed read retains ID/recovery | Non-OK and thrown GET cases | GET 503 after real Create | Pass |
| Failed edit/replay read does not claim freshness | Historical notice and stale snapshot | Aborted edit GET; historical edit replay plus 503 after newer server edit | Pass |
| Thrown refresh preserves acceptance | Network-failed Create refresh | Aborted GET after accepted Edit | Pass |
| Retry only reads | Exact GET/POST call counts | Recovery leaves POST count unchanged | Pass |
| Delayed responses cannot erase new input | Both fields/all request buttons locked through POST, accepted GET and manual GET | Delayed real POST and GET; accepted identity visible before GET finishes | Pass |
| Normal loop remains usable | Create/edit and exact-envelope uncertain-delivery retry | Create/reorder/page reload/stale conflict; recovery to newer head, then editable input | Pass |

Component tests are not browser evidence. Browser failures/delays use controlled interception, not physical network/device interruption or offline persistence.

## Migration qualification

[`verify-draft-upgrade.ts`](../../../scripts/trainer2/verify-draft-upgrade.ts) copies the reviewed migration chain with its own Prisma config and verifies that the correction is absent from the old ledger before populating fixtures. A schema-only override is insufficient because the configured migration path still wins.

| Scenario | Result |
| --- | --- |
| Fresh full migration chain | Pass |
| Populated candidate schema with drafts, multiple revisions, outcomes, conflict, rejection and tombstone | Upgrade passes; all domain records/counters preserved |
| Historical Create/Edit/tombstone replay after upgrade | Original outcomes preserved; newer head/tombstone unchanged |
| Second successful migrate deploy | Already-applied ledger no-op; ledger unchanged; no SQL re-execution claim |
| Reproduced old-schema phantom acceptance | Exact SQL rejects `23514 / trainer2_acceptance_revision`; deploy fails; rows unchanged; DDL rolled back |
| Old-schema counter-only corruption | Exact SQL rejects `23514 / trainer2_acceptance_sequence`; deploy fails; rows unchanged; DDL rolled back |

Prisma 7 can obscure the primary error with “current transaction is aborted” and leave an unfinished ledger entry. The harness records CLI failure separately from the exact SQL assertion. No revision is fabricated, result rewritten, evidence deleted or ledger resolved. Real recovery requires separately reviewed records/ledger handling and explicit target/action authorization.

## Gates and limits

The path-derived plan is retained in `verification-policy.json`. Checks cover Prisma generation, focused Trainer2 suites, environment classification, command registry, migration/readiness-integrity tests and `test:verify-gate` (lint, TypeScript, focused engine/review/version/ownership/write-gate checks and contracts). The canonical migration chain list now includes the reviewed draft migration and its additive correction; its pending-migration assertion follows the new last migration. The disposable harness runs the production build against its own target. Exact outcomes belong to `checks.json` and `verification.json`. The release-only Finisher schema-diff gate is not run for this draft correction; no Finisher schema was changed.

The expensive full credential-free inventory is a PR/release-class check and is not claimed here. No persistent/shared database, hosted authentication/provider configuration, merge, push or deployment was exercised. Acceptance checks scan account-local accepted history; large-history performance and future command types need separate qualification. Forced transient retries and offline recovery remain outside this correction. Stop at focused independent re-review of F1–F3; no next Phase 0 slice is included.
