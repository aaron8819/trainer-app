# Draft slice bounded correction report

Branch/worktree: `codex/trainer2-draft-corrections` at `C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-draft-corrections`.

Correction base: `58623de537df05f8fbf6cb02b0dc7931d3d9d849`, tree `fb4422c9067a19b34f6902cab7695e9f80d1bbc3`. Original implementation base: `eb1b45e9c516d14e8857e5b028f2be13233619cd`. The original candidate was clean and matched all supplied coordinates. Final commit/tree/state are recorded in ignored `artifacts/trainer2/final-attestation.json`, outside the source being attested.

## Corrections

- **F1:** additive migration `20260910020000_trainer2_acceptance_integrity` adds the deferred acceptance-side seal. Same-account/action revision ownership, root, bound target/type/expected parent and exact result metadata must agree. Historical acceptance does not depend on the current head or tombstone. The original revision-to-acceptance seal remains. Consecutive accepted numbers and the account counter must agree; the independently reproduced old-schema counter-only increment now fails. SQL owns referential/result integrity, the handler remains acceptance authority, and pure Planning owns edit policy.
- **F2:** the workbench retains accepted plan identity and a historical notice before refresh. Non-OK and thrown reads produce an accepted-but-refresh-failed state with GET-only recovery. Old snapshots are labeled stale. Only successful reads claim current-head retrieval. Delivery-uncertain command retry remains distinct.
- **F3:** both fields and all request buttons are locked throughout submission/refresh. A synchronous guard prevents overlap before React rerenders. Input becomes editable after completion; stale snapshots require reload before editing.

## Verification and upgrade behavior

The [acceptance matrix](DRAFT_ACCEPTANCE.md) maps corrections to executable assertions and fresh evidence. Real PostgreSQL controls construct complete acceptance sets, change a relationship, assert the intended commit error and compare whole-state snapshots after rollback. Concurrent create, stale-edit, immutable-history and tombstone controls remain. Desired-behavior component regressions replace the review's intentionally faulty assertions. Actual installed Edge separately checks controlled response failures/delays and read recovery against real server commands.

Migration qualification covers fresh deployment, populated candidate upgrade, unchanged historical records/replay, and rejection of phantom/counter-inconsistent databases. No repair is performed. PostgreSQL reports the precise `23514` constraint; Prisma 7 may instead surface an aborted transaction and leave an unfinished migration ledger entry. Any real recovery needs separately reviewed records/ledger handling and explicit authorization. A second successful deploy is a ledger no-op.

Repository checks and build results use fresh source manifests and command logs. These bind migration, harness, tests, lockfile, raw/LF-normalized hashes and dirty state; there is no separate regression overlay. Final attestation remains outside tracked source to avoid self-reference. Historical results are not retroactively attributed to the corrected commit. The original independent `trainer2-draft-review-58623de5/trainer-app/artifacts/review/REVIEW.md` is preserved.

Harness development exposed two verification issues, corrected before final qualification: schema-only Prisma selection still used the configured full migration path, and Prisma obscured explicit-transaction migration errors. Fixtures now use a copied config and verify the old ledger before population; rejected-upgrade checks distinguish PostgreSQL errors from CLI presentation. TypeScript also caught an unsupported Testing Library `exact` option, which was removed. These are correction-work iterations, not claimed baseline failures.

## Stopping point

Corrected candidate for focused independent re-review; no independent re-review pass is claimed. No merge, push, deployment, persistent/provider database change, source inventory/import implementation, activation, execution, progression or offline redesign occurred. Future command types and large-history performance require separate qualification. Work stops before the next Phase 0 slice.
