# Skip Workout — local implementation handoff

Ready for focused independent review. This is implementation evidence, not independent acceptance. V1 remains live, hosting paused, and Phase 0 incomplete. No hosted access, production data, imports, push, merge, deployment, spending or admission change occurred. Undo Finish is deferred.

## Coordinates and ownership

- Branch: `codex/trainer2-skip-workout`.
- Worktree: `C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-skip-workout`.
- Accepted base: `codex/trainer2-discard-empty-execution`, commit `fc98700041580e14d2e084105ba323aa933e0f38`, tree `b395790c45bdd674eda689b78c391cb613cc7a56`.
- Base coordinates, clean source, absent destination branch/path and worktree registration were verified before creation. `Start-TrainerTask` inspection used `db-migration` and reported no blockers. Existing worktrees and evidence were preserved.
- Final commit/tree, exact file hashes, receipt qualifications and artifact hashes are in [FINAL_BINDING.json](skip-evidence/FINAL_BINDING.json), written after the clean local commit. This handoff is committed; detailed receipts and screenshots remain in this worktree.

Read the applicable AGENTS.md, documentation entry point, blueprint/lifecycle/ordering/endpoint/command contracts, accepted discard review and handoff, and Start/Finish/Discard owners and contracts. Earlier reviews remain closed. Architecture-guard and React skills guided implementation; the browser workflow used repository-local Playwright and installed Edge because the optional agent-browser CLI was unavailable. No package was fetched to replace it.

**Canonical owner:** Planning's `src/lib/api/trainer2/skip-occurrence.ts`. The shared Planning resolution owners are `src/lib/api/trainer2/occurrence-resolution.ts` and `src/lib/engine/trainer2/occurrence-resolution.ts`. Supporting seams are existing `acceptCommand`, activated-source validation, SQL guards, strict command/read contracts, the thin occurrence route, and Workout/SkipWorkout/plan-card consumers. No V1, seed, receipt, progression, admission or hosted owner changed.

Canonical contract: [SKIP_WORKOUT.md](../../docs/architecture/trainer2/SKIP_WORKOUT.md).

## User-visible behavior and command

The secondary **Skip workout** action sits beside Start. Confirmation names the exact workout and stage, explains that it will be marked skipped and the plan will move on, and explicitly explains final-plan completion. Cancel writes nothing and restores focus. The next workout starts only through a separate Start action. Readback labels skipped work separately from completed work and retains the saved prescription.

`POST /api/trainer2/occurrences/skip` invokes **SkipOccurrence** with the established version-1 action/device/account/ownership-epoch/dependency envelope. It requires exact `target.planId`, `target.occurrenceId`, empty intent and `expected: { planRevisionId, acceptedSequence }`. The sequence is a canonical decimal string from ReadNext. Any accepted account change invalidates an older confirmation, including Start→Discard, instructions or historical correction. Rejected commands do not advance that sequence. This conservative binding is deliberate; there is no implicit “whatever is next” target or typed reason.

Under the shared account-first lock, the trusted principal is reauthorized. The plan must be owned, non-tombstoned and Active; its current revision must equal the activated revision; the exact occurrence must belong to it and remain first unresolved in saved order; no ordinary Open/Finished execution or prior skip may claim it. Empty Open executions are not skippable. An explicitly discarded empty attempt permits a fresh reviewed skip, while its snapshot, identity and discard history stay unchanged. Pausing and broader lifecycle operations remain outside the admitted implementation.

The immutable `Trainer2OccurrenceSkip` decision retains occurrence/plan/revision, trusted account actor, action, expected binding, database-assigned time, approved endpoint IDs, prior Active state and the causal completion consequence. Skip creates no execution, set result, zero-valued evidence or finish record. The skip, mandatory completion, accepted sequence and exact durable outcome commit in one transaction.

Exact replay returns the historical receipt without another skip or advancement. Changed payload under the same identity collides. Stale/foreign/ineligible commands fail explicitly without domain effects. Historical Start/Discard/Skip replays cannot revive an attempt or rewind current next selection.

## Ordering, endpoint and preservation evidence

All saved occurrences remain retained obligations, including optional-only working workouts. The accepted schema has optional sets, not optional occurrences. All-finisher plans still fail existing activation validity. The shared resolution rule recognizes Finished executions or explicit skips; saved array order governs selection across duplicate names, independent workouts and stage boundaries. No mutable position pointer exists. Final resolution completes the plan without wrapping or fabricating a next occurrence. Both final Finish after earlier skips and final Skip after earlier finishes work.

[Final PostgreSQL/browser receipt](skip-evidence/postgres-ready.json), [service/migration receipt](skip-evidence/verification-ready.json), and [persisted comparisons and observed queues](skip-evidence/progress-ready.json) record nine passing groups:

| Boundary | Verified result |
| --- | --- |
| First, middle, consecutive, single and final skip | Exactly one targeted decision and advancement. Expected next is independently derived from saved SQL order and terminal rows, not the production selector. |
| Independent workouts, duplicate names, stage boundaries | Saved UUID order preserved, including deliberately reversed stage labels. |
| Mixed completion and optional work | Finish recognizes earlier skips; final skip recognizes earlier finished obligations. Optional-only working workouts remain retained. |
| Prior performed/corrected history | Before/after comparisons retain original execution captures, finish facts, historical correction revisions and original durable outcomes unchanged around a middle skip. |
| Discarded attempts | Execution and discard rows compare unchanged; an old pre-Start binding conflicts after Start→Discard; fresh review succeeds. |
| Wrong account/plan/revision/occurrence, future target, missing/malformed/stale binding | Reject/conflict without domain effects. Changed payload under an existing action identity is rejected. |
| Empty or recorded live execution; completed/skipped target | New Skip conflicts. No implicit finish/discard or target substitution. |
| Historical retries after later start/finish | Complete persisted snapshots remain unchanged; actual current execution/next state remains authoritative. |
| Effect accounting | Only the skip, necessary plan lifecycle change, one action/outcome and account counters change. No fabricated execution/result; earlier actions/outcomes remain byte-equivalent JSON rows. |

Rejections may append rejection outcomes and advance their delivery cursor; accepted sequence and domain state remain unchanged. Browser cancellation changes no command or domain rows.

## Controlled concurrency and rollback

The harness holds the account row in a separate PostgreSQL transaction, starts participant one, observes its backend in `pg_blocking_pids`, starts participant two, observes the blocking chain, and then releases the holder. Poll intervals observe locks; timing sleeps do not determine commit order. Queue holder/backend IDs and outcomes are retained.

| Case | Result |
| --- | --- |
| Start→Skip | Start accepted; Skip conflicts, including an empty execution. |
| Skip→Start | Skip accepted; stale exact-target Start conflicts and cannot retarget. |
| Distinct Skip commands | One decision; losing command conflicts. |
| Same Skip command concurrently | One decision; identical historical outcome replayed. |
| Skip against Finish, either order | Skip cannot resolve an Open attempt; Finish wins its valid transition, with no skip. |
| Skip against Discard, either order | No implicit release; discard-first also makes the old Skip binding stale. |
| Fault at plan completion, accepted-sequence update or outcome insert | All rows roll back, including skip and action; identical retry succeeds. |
| Direct runtime missing outcome, forged acceptance, wrong binding/account | SQL guards reject atomically. |

The [SQL owner diff](skip-evidence/migration-owner-diff.txt) shows only the shared resolution predicate substitutions, the new causal plan-completion branch and the Skip acceptance owner branch. Existing Start/Finish/Discard/historical-correction guards remain intact.

## Browser, restart and response recovery

Actual installed Edge journeys passed:

1. **A:** Save/activate → cancel Skip → Skip with response lost after server commit → reload and byte-identical retry → Start next → record → Finish.
2. **B:** Start → discard empty attempt → Skip that same occurrence → reload its discarded bookmark.
3. **C:** Finish a recorded workout in a small plan → Skip the final obligation → truthful Plan complete with separate Completed/Skipped rows.

The harness restarts the application process against the same still-existing disposable DB, reopens completed and discarded execution bookmarks and the plan bookmark, and compares full persisted snapshots unchanged. No page errors occurred. No next workout starts automatically, and skipped rows have no Start or result-edit controls.

Inspected [desktop confirmation](skip-desktop.png), [mobile page](skip-mobile.png), [mobile confirmation detail](skip-mobile-confirm.png) and [mixed completion](skip-completed-mobile.png). Controls are at least 44px, Cancel receives/restores focus, and no horizontal overflow was observed. **Browser: Edge 153.0.4234.32, headless. Mobile is 390×844 viewport emulation, not a physical device.** Development HMR transport alone is suppressed by the harness; application HTTP, reload and restart are real. The existing builder/navigation is preserved.

The focused suite verifies frozen confirmation across target/revision/sequence changes, retained storage, duplicate-click protection, exact retries after later state changes, malformed/mismatched receipts, wrong skip fact/consequence/sequence, failed readback, current completion after historical replay, older-read suppression and unmount invalidation. Start remains locked until retained Skip storage is checked. Historical outcomes never directly supply current plan state.

## Migration, permissions and gates

One forward migration: `20260915030000_trainer2_skip_occurrence`. [Preservation hashes](skip-evidence/migration-preservation.json) verify 32 accepted historical migration files unchanged. Fresh install, redeploy and a populated upgrade from the exact accepted base passed with Active/Completed plans, results, historical corrections and discarded attempts. All preexisting tables compare unchanged across migration/redeploy; no skips are invented. Test-only adapters supply absent skip reads while using base-compatible commands against old SQL. This qualifies a populated schema upgrade, not deployment of an old application binary.

Runtime gains only SELECT/INSERT on the immutable skip table and EXECUTE on the invoker resolution predicate; reader gains SELECT. Existing roles require the five documented grant/policy statements after migration. UPDATE/DELETE/TRUNCATE, forged acceptance and cross-account bindings are denied. RLS remains enabled; no PUBLIC grant or SECURITY DEFINER function is added. The accepted server roles remain trusted across accounts; administrator DDL bypass is outside this guarantee.

| Required/affected check | Result |
| --- | --- |
| PostgreSQL/browser, races, rollback, upgrade, permissions, restart | 9 groups passed; final behavior source. |
| Focused UI/domain/HTTP/access/isolation | 9 files, 97 passed. |
| Historical-correction compatibility | 12 groups passed, including controlled races, upgrade, browser recovery and restart. |
| TypeScript / lint / Prisma generation | Passed; final lint has no warnings. Prisma 7.3.0. |
| Doc/runtime contracts | Passed. |
| Fast tests | 8 files, 86 passed. |
| Environment/inventory and guard negative controls | 5 files, 212 passed; one existing Windows signal-termination skip. |
| Repository tooling | 108 passed, zero failed; provider checks use mocks. |
| Command registry | 133 commands; all 84 package scripts covered; no errors/warnings. |
| Doctor / preflight / policy / whitespace | Passed. Standalone compatible dependencies, no dotenv files, seven DB target variables absent, no policy blockers. |

Inventory is **409 = 370 credential-free + 34 import-only + five DB-required**: exactly two Vitest files added, none removed. Trainer2 routes increase 12→13 and registered commands 132→133. The guarded launcher is explicitly confirmed disposable-only; no package script was added. Negative controls remain.

Policy excludes local execution of the release aggregate, migration-integrity and finisher-schema-drift gates. Prisma generation and the exact synthetic migration/role writes were explicitly authorized and verified separately. No full credential-free inventory rerun, production build or release qualification is claimed. [Policy](skip-evidence/policy-ready.json) records permitted exclusions and conservative unmatched-path warnings; these are not reported as executed checks.

## Evidence integrity, development failures and limits

Successful receipts record sanitized invocation, UTC start/end, exit status, Node version, log hash and before/after source manifests. [FINAL_BINDING](skip-evidence/FINAL_BINDING.json) lists exact deltas to the committed source, verifies logs/artifacts and qualifies earlier checks against unchanged gate definitions. PostgreSQL/browser uses unchanged final behavior source. Focused/TypeScript/historical receipts differ later only by an explanatory lint-suppression comment and this delivery handoff; other gate receipts are qualified to their unchanged definitions. Failed/intermediate receipts are retained and not promoted.

Final PostgreSQL/browser run: **2026-09-15 19:46:41–19:47:50 UTC**, status passed. Node 24.12.0; PostgreSQL 17.10 aarch64 Alpine; Docker 29.6.2; Prisma 7.3.0; Edge 153.0.4234.32; default Turbopack. Exact lock dependencies were installed offline with scripts disabled (693 packages), followed by local Prisma generation. No credentials or dotenv files were copied.

Development failures retained: an invalid historical-correction reason in a synthetic fixture; an all-finisher activation fixture corrected to optional working sets; newly inserted punctuation encoded incorrectly before the browser pass; early component tests clicking hydration-disabled controls and an outdated ReadNext fixture; initial TypeScript union annotations; and a historical compatibility assertion that needed to account for seven accepted corrections advancing the new sequence field. Source review also found and fixed unmount invalidation after multiple reads, with a dedicated regression test. These are not reopened findings against earlier accepted reviews.

Limits: Undo Finish, undo-skip, reopening, arbitrary/bulk future skipping, paused-plan operations, rescheduling, automatic progression and offline/device-loss synchronization remain deferred. No physical-mobile, hosted-readiness, administrator-bypass or real-training authorization is claimed.

## Demo and cleanup

From this worktree's `trainer-app`:

```text
node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable
```

Use synthetic input only. Open its exact printed READY URL, save/activate a plan, choose Skip workout, then explicitly Start next. To try discard→skip, start an empty workout, discard it, then review Skip. Reload/bookmarks persist while that disposable DB exists. The launcher removes its own DB/server on Enter/Ctrl+C; restarting the launcher creates a new DB. The automated harness separately proves app-only restart against the same DB.

[Cleanup evidence](skip-evidence/cleanup.json) confirms all **nine** task-owned verification containers removed, including failed runs. Task-owned web processes exited; Windows taskkill server exit 1 is expected termination. No task demo remains. Existing services, demos, data, worktrees and evidence were preserved. Dependencies and local evidence remain for review.

Stop ready for focused independent review; no independent acceptance is claimed.
