# Local discard of an empty execution

Execution & Evidence owns `DiscardEmptyExecution` in `src/lib/api/trainer2/discard-execution.ts`. This bounded local slice extends the accepted start, results, finish and historical-correction paths. V1 remains live, hosting paused and Phase 0 incomplete.

## Eligibility and lifecycle

Only an account-owned Open execution with **zero persisted set-result revisions** is empty. Any accepted performed-set history prevents discard: required or optional, valid zero, corrected, cleared or re-recorded. Current null results are not evidence of emptiness. Failed commands and read-only visits are not performed work. The admitted model has no session adjustments, omissions, execution notes or other persisted performed-activity owner; adding one must extend this eligibility boundary. Browser input and uncertain result requests block discard until explicitly saved, cancelled or recovered. Cross-device work which reaches the server first wins under the account lock; a later stale write conflicts and is never redirected.

Open becomes Discarded, with an immutable `Trainer2ExecutionDiscard` fact. Its account is the reauthorized actor, its timestamp is assigned by the database, and its action binds the durable outcome. The execution ID, source links, original start instant, canonical initial prescription/hash and all commands remain intact. Finished and Discarded attempts cannot be discarded. There is no deletion, skip, abandonment, reopening or undo-discard.

## Command, binding and atomicity

`POST /api/trainer2/executions/discard` accepts the established version-1 action/device/account/ownership-epoch/dependency envelope, `target.executionId`, `target.occurrenceId`, empty `intent`, and `expected` containing the initial content hash and every target's resultVersion/performedSetId sorted by target ID. Empty targets require zero/null. Missing, extra, malformed, foreign or stale bindings fail explicitly.

`acceptCommand` reauthorizes and locks the account before domain reads. The owner validates exact execution/occurrence membership, Open lifecycle, authoritative history and binding, then inserts the discard fact, transitions lifecycle and commits the accepted sequence/outcome atomically. SQL guards recheck eligibility and require a same-transaction fact plus deferred accepted outcome. Record/correct/clear/re-record, historical correction, finish and start share the same account-first order. Result and finish guards also reject a same-transaction discard fact before the lifecycle UPDATE. Infrastructure failure rolls back every effect.

An exact command replay returns its original outcome before present-state checks. Changed payload under that identity collides. Original start replay still identifies the discarded attempt; it never starts a replacement or claims current Open state. Old discard replay cannot affect a newer execution. Rejected valid commands may retain rejection outcomes but have no domain effects.

## Occurrence and fresh start

The forward migration `20260915020000_trainer2_discard_empty_execution` replaces the occurrence-wide unique constraint with `trainer2_one_ordinary_execution`, unique where lifecycle is not Discarded. The existing one-Open-per-account index remains. The original occurrence foreign key stays as immutable provenance. Thus multiple discarded attempts are retained, with at most one ordinary Open or Finished attempt for that occurrence.

Start excludes discarded attempts from its existing-attempt check; all other accepted start restrictions remain. Next selection still resolves only Finished occurrences. Discard does not write plans, revisions, decisions, finish records, order or position, and starts nothing. A deliberate fresh StartOccurrence creates a new execution ID, target identities and initial capture from the accepted source. Repeated start/discard cycles remain distinguishable.

## Readback and UI

Execution GET validates the retained snapshot and discard fact, returning lifecycle Discarded and its actor/action/time. The old URL remains bookmarkable, shows the original prescription and discard status, and offers Trainer2 plans and current next/continue navigation. It offers no new logging, finish or historical correction. Recoverable local input from another tab remains visible with closed-attempt copy; it cannot mutate or rebind to a replacement.

The secondary “Discard empty workout” action opens a short confirmation: “This removes this workout attempt. The workout will still be next in your plan.” Audit retention is explicit. Cancel performs no write and restores focus; confirmation initially focuses Cancel. Controls have 44px minimum height. Result input is locked during confirmation/delivery; pending finish blocks discard, and pending discard blocks finish. Nonempty history explains why discard is unavailable.

Before POST the exact command is saved in account/execution-scoped sessionStorage. Lost, malformed or mismatched responses retain Check discard again. Success requires validated authoritative discarded readback before clearing delivery state; the same workout's start option then appears. A stale outcome requires refresh and a separate new decision. Confirmation never automatically rebinds. Keyed components ignore responses after execution replacement.

## Permissions and verification

The immutable fact has RLS, same-account foreign keys, no PUBLIC privileges and no SECURITY DEFINER function. Restricted runtime receives SELECT/INSERT; reader receives SELECT. Existing lifecycle-column-only UPDATE remains. `database.ts` validates the extended exact table boundary. `prisma/trainer2-runtime-grants.sql` is administrative preparation, not an automatic migration or hosted authorization. Existing runtime roles on upgrade need its four new discard-table statements after migration. Server roles retain the accepted account-spanning trust model with application ownership predicates; administrative DDL bypass is outside it.

Run the registered disposable launcher with local dependencies:

```
node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-discard-execution.ts --confirm-disposable
```

It uses synthetic accounts, fresh PostgreSQL, populated accepted-base upgrade, observed blocking graphs, direct guard/permission probes, rollback injection, persisted comparisons, installed Edge, desktop and mobile viewport emulation, and same-database process restart. It removes only its own services. The upgrade adapter supplies the absent discard-table read as null while executing base-compatible commands against accepted base SQL; it is a populated schema upgrade, not an old application binary deployment.

One credential-free Vitest file is added: `DiscardWorkout.test.tsx`. Inventory is 407 = 368 credential-free + 34 import-only + five DB-required. The standalone PostgreSQL/browser launcher is separately registered, with explicit confirmation and guard coverage. Twelve Trainer2 routes include the dedicated discard endpoint. See `artifacts/trainer2/DISCARD_EMPTY_EXECUTION_HANDOFF.md` for actual results, source bindings and limitations. No independent acceptance or hosted/real-training readiness is implied.

[Skip Workout](SKIP_WORKOUT.md) can subsequently resolve the same occurrence through a separate explicit decision. Discard itself still never resolves or skips it.
