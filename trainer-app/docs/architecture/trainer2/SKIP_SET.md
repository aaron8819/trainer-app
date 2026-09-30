# Local set skipping and logger alignment

Execution & Evidence owns `src/lib/api/trainer2/skip-set.ts`, alongside the existing result and finish owners. `src/lib/trainer2-contracts/skip-set.ts` defines the strict command and immutable read fact. This is a local synthetic implementation; hosted admission and V1 behavior are unchanged. The new route is classified as `set_logging` and checks the standard maintenance-pause guard before opening a request context.

## Command and lifecycle

`POST /api/trainer2/executions/skip-set` accepts `SkipSet` with the established action/device/account/ownership-epoch/dependency envelope. Its exact execution-owned target is `{ executionId, targetId }`; expected state is `{ resultVersion: 0, skipActionId: null }`; intent is empty. The trusted principal must own the Open execution. Targets with any result revision, including a cleared result, cannot be skipped. A second distinct skip conflicts; an exact envelope replay returns the original durable outcome without another effect.

An accepted skip appends `Trainer2SetSkip`, recording the account, execution, target, action and server timestamp. It creates no performed identity, reps, load, RIR or result revision. The immutable starting prescription is unchanged. Resolving every target leaves the workout Open; only explicit Finish resolves its occurrence.

An explicitly skipped target with no result revision is currently skipped. Selecting its queue chip exposes **Log this set**. The existing `RecordSetResult` command then requires `expected.skipActionId` to equal the reviewed skip event. Old clients and stale tabs omitting that event conflict. Recording creates the normal first result revision and retains the earlier skip event. Subsequent result corrections never erase skip history or turn a cleared result back into a current skip. Logging a skipped target after completion is prohibited.

All commands share `acceptCommand`'s account-first transaction lock, exact-envelope identity, accepted sequence and durable outcomes. A Log/Skip race yields one accepted effect and one conflict. Skip-first invalidates a previously reviewed Finish binding; Finish-first closes the execution before Skip can write. SQL guards recheck lifecycle, exact target, result absence, command binding and outcome existence under the same account lock. Deferred sealing rolls back an event without its accepted outcome.

## Readback, finish and discard

Execution reads add `skips`, the immutable skip history. Current performed results remain exclusively in `results`; history-based prefill reads performed results only and cannot borrow values from a skip.

`finishBinding.results` retains the existing result version/identity fields and includes `skipActionId` only for targets with skip history, even if subsequently recorded. Older finish facts without skips retain their original representation. `unknownTargetIds` retains its established meaning of **all targets without a current performed result**; it can include explicitly skipped targets. Finish review separates those targets into explicitly skipped and untouched required/optional counts. Both remain bound by the existing exact-snapshot acknowledgement in the submitted command. The UI prompts only for untouched work; existing explicit skips need no second confirmation. Neither is represented as performed. Completed readback shows skip provenance alongside any subsequent result.

Any persisted skip makes empty-execution discard ineligible, even if no results exist. Discard's application check, SQL insert guard and deferred seal all enforce this authored-history boundary.

## Logger presentation and recovery

`ActiveWorkout` owns selection and deliberate reveal; `SetResultRow` retains identity-scoped drafts and delivery envelopes. Incrementing inputs does not add a visible dirty legend. Dirty-state protection remains internal. Feedback appears below the actions only when needed; exact-envelope Retry save appears only after an uncertain request. Editing retains drafts across queue navigation and offers Update set and Return to active set. The separate reasoned erroneous-clear action remains in Options; Skip never clears a result.

The card uses a compact ACTIVE SET/resolved count header, thin black progress indicator, upper-right History, explicit load-meaning labels, full-width inputs and equal-width pill actions. Selected RIR/chips and primary actions are black; logged chips are green; skipped chips are dashed and labeled. Queue muscle roles use filled/outlined tags with accessible descriptions and the existing verified catalog mapping.

The dark rest timer appears immediately above the card only while active, in normal page flow with visible ±30 and dismiss controls. Its bottom green progress line drains smoothly against the deadline; reduced-motion users receive a static-tick fallback. No space remains after dismissal or expiry. Deliberate selection/advance reveals the active card without a sticky-timer offset; background replies and ticks never request focus or scrolling. Deadline recovery, three-minute main-lift/two-minute other rest, event deduplication and correction behavior remain unchanged. Skip never starts or restarts rest.

An edited draft requires confirmation before Skip; untouched suggestions do not. Cancellation preserves the draft. Uncertain delivery retains the exact skip envelope across same-tab reload. Only confirmed authoritative readback clears it and advances once, subject to the existing selection-epoch protection. Skips persist through process restart while the database exists.

## Migration and verification

Additive migration `20260922010000_trainer2_set_skip` creates the append-only table with same-account foreign keys, RLS, immutable guards and outcome seals, then extends result, finish, discard and accepted-owner guards. Historical migration bytes and rows are preserved. Local runtime grants add SELECT/INSERT; the read role gets SELECT. No browser grants or SECURITY DEFINER functions are introduced. The Prisma model describes the table; the owner uses parameterized SQL for its small read/append surface.

Focused regressions extend existing SetResultRow, Workout, FinishWorkout and execution HTTP suites; no Vitest files or inventory classifications are added. `artifacts/trainer2/verify-v1-alignment.ts` exercises real Edge/HTTP/PostgreSQL, observed blocked transaction queues, rollback, retry, prefill, layout, selection and completion. `verify-alignment-upgrade.ts` copies a prior disposable synthetic database read-only into a separate task database and verifies historical row hashes across migration and repeat deploy. These explicitly confirmed task runners supplement accepted unchanged foundation evidence. See the local alignment handoff for exact source/evidence bindings, screenshot inspection and demo restart instructions.
