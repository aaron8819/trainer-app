# Local historical set corrections

Execution & Evidence owns `CorrectHistoricalSetResult` in `src/lib/api/trainer2/set-results.ts`, with strict contracts in `src/lib/trainer2-contracts/set-results.ts`. This is the bounded next step defined by the accepted workout-finish review, implementing blueprint §18, architecture §7.3 and the implementation plan's historical command row for existing recorded sets only.

## Command and scope

`POST /api/trainer2/executions/corrections` uses the established version-1 action/device/account/ownership-epoch/dependency envelope and trusted server principal. Target is exact executionId/targetId; expected is positive resultVersion plus performedSetId. The execution must be owned and Finished, and its current result non-null. Existing and previously corrected required or optional sets are supported. Actual reps, basis, measurement, units, zero meaning and optional RIR reuse [SET_RESULTS](SET_RESULTS.md) validation unchanged.

Intent contains a non-null result and fixed reason `Correct recorded result`. Save correction supplies that explicit correction context; no explanation typing is required. The implementation plan explicitly permits `reason?`, and the broader blueprint/architecture requires provenance rather than mandatory user text. The fixed reason satisfies the finish review's correction-context requirement. Account identity is taken from the reauthorized server principal and durably retained on the revision/action; deviceId is provenance, never actor authorization.

Never-recorded and currently cleared targets are denied. Historical addition, removal, restoration, assignment/classification/time changes and Undo Finish are outside this slice. The ordinary results endpoint continues to accept only RecordSetResult/CorrectSetResult on Open executions. The historical endpoint rejects Open and ordinary commands.

## History, completion and concurrency

Each accepted command appends one immutable Trainer2SetResultRevision. Its predecessor is the same execution/target/performedSetId at version minus one. Equal-value submissions append too and must pass the exact viewed-version check. History retains original values, every accepted correction, reason, trusted account identity, action and database-assigned recording time. The current projection is derived from the latest revision; no separately mutable projection table exists.

Existing account-first transaction locking orders result, finish and start commands, while per-target expected versions allow corrections to different sets to succeed independently. Ownership, lifecycle, membership and expected version are checked under the transaction; parsed supported values are bound to the durable envelope. Revision, accepted sequence and outcome commit together. Rejection retains its durable outcome without changing domain evidence. Infrastructure failure rolls back action/history/sequence/outcome. Exact replay returns its original outcome; changed envelopes under the same action collide.

No correction writes execution lifecycle, finish time/evidence, plan lifecycle, activated revision, occurrence resolution, original prescription, later executions or next selection. No progression or prescription regeneration runs. Corrections remain available after a subsequent workout starts/finishes and after plan completion.

Execution reads expose latest results plus immutable history. Browser validation checks history identity/contiguous versions/current projection and resolves the finish's exact reviewed versions from history. The finish receipt and unknown-target acknowledgement remain historical. Latest corrected values are displayed separately; collapsed Result history marks the revision acknowledged at finish. Workout start/finish times and later correction recording times remain distinct. Existing result-derived displays use latest results; no analytics system is added.

## UI and recovery

Completed recorded sets show Correct result with prefilled actual values, Save correction and Cancel. Never-recorded and cleared sets have no correction action. History is collapsed by default. Inputs have labels, mobile keyboards and keyboard access; Cancel returns focus to the correction action.

Historical editors retain their original base and exact pending command in account/execution/target-scoped sessionStorage, separate from ongoing drafts. Reload restores unsaved values without rebasing. Background refresh updates saved display but not the editor base. Stale conflict requires Review latest result, Use this version for my correction, then a separate Save correction. Invalid input remains visible. Pending commands disable duplicate actions; transport/malformed/mismatched replies retain Check again. Replay performs a fresh validated read and never installs old outcome values. Late replies from unmounted subjects are ignored. Link/before-unload guards protect unsaved input. Any retained ongoing draft after finish stays separately recoverable and cannot be silently promoted to a historical correction.

This is same-tab recovery, not broad offline synchronization or device-loss durability. Acknowledged data survives an app restart while the disposable database exists.

## Migration and verification

Forward migration `20260915010000_trainer2_historical_set_corrections` extends result and accepted-owner guards. Existing tables, immutable checks, same-account foreign keys, RLS, runtime SELECT/INSERT and reader SELECT permissions are reused. No historical rows are rewritten/backfilled, old migration changes, grants, new SECURITY DEFINER functions, hosted admission or provider access are introduced. Runtime direct writes remain constrained by command binding, version and outcome seals; trusted application value validation remains part of the accepted server-role threat model.

Run `node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-historical-corrections.ts --confirm-disposable` for task-owned synthetic PostgreSQL and Edge verification. It covers fresh/repeated deployment, populated accepted-base upgrade, observed lock queues, rollback, permission negative controls, persisted-state comparison, browser recovery/history/screenshots and same-database restart. Existing SetResultRow, HTTP and isolation suites are extended; no Vitest suite is added or removed (406 total, 367 credential-free, 34 import-only, five DB-required). Route inventory adds the dedicated corrections route (10 to 11); the separately guarded disposable launcher adds one registry entry (130 to 131), retaining negative controls.

See `artifacts/trainer2/HISTORICAL_SET_CORRECTIONS_HANDOFF.md` for actual results and source-bound evidence. V1 remains live, hosting paused and Phase 0 incomplete. This local implementation does not claim independent acceptance, deployment readiness or authorization for real training.
