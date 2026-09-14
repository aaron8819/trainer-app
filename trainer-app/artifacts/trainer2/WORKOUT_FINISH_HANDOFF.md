# Trainer2 workout finish handoff

Implemented locally, ready for focused independent review. This is implementation evidence, not independent acceptance. V1 remains live, hosting paused and Phase 0 incomplete.

## Try the journey

From this worktree's trainer-app directory:

```
node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable
```

Wait for READY and open the exact printed URL. Save/review/activate a synthetic plan, Start workout, enter and Record set results, then Finish workout. Save, discard or recover pending local result input first. When sets remain unrecorded, confirm Finish with unrecorded sets. Inspect original targets and saved results, reload the bookmark, then explicitly Start workout for the next saved occurrence. Finish the final occurrence to see Plan complete / No next workout. Reopening the plan also identifies it as completed.

**Disposable data only:** no real training data. The demo launcher owns and deletes its synthetic database on Enter/Ctrl+C. A new launcher creates another database. The automated harness separately verifies restarting the app against the same task-owned database, retaining results and finish state. Existing demos were preserved; no new demo is retained.

## Coordinates and scope

- Branch: codex/trainer2-workout-finish.
- Worktree: C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-workout-finish.
- Accepted base: codex/trainer2-set-results, e12bc081be88a7fbd7e5aa65be13fdfc23a2bdf4; tree d9ba60212f5e1a4f5896d199d533f85ab485df75. Coordinates verified before worktree creation; no overlapping checkout was reused.
- Final commit/tree, source manifest, artifact hashes and receipt qualifications: [FINAL_BINDING.json](workout-finish-evidence/FINAL_BINDING.json).
- Preimplementation decision matrix: [WORKOUT_FINISH_CONTRACT.md](WORKOUT_FINISH_CONTRACT.md).
- Canonical implementation contract: [WORKOUT_FINISH.md](../../docs/architecture/trainer2/WORKOUT_FINISH.md).

Execution & Evidence owns FinishExecution; Planning consumes its authoritative finish fact for occurrence resolution and atomic final closure. Changes include the strict command/read contracts, one additive migration, guarded lifecycle/result/start boundaries, thin HTTP adapter, execution/plan consumers, focused tests, disposable harness and registry/guard/inventory updates. V1, historical migration bytes, original prescriptions, accepted revisions, identities and result history are preserved.

## Finish semantics and concurrency

The trusted server principal authorizes account/execution ownership. Finish expects Open and binds the initial content hash plus all execution target result versions and performed-set IDs, including version zero and cleared/equal-value newer revisions. The complete reviewed binding is recomputed from persisted state under the account lock. Missing, extra, stale or mismatched bindings fail without completion effects.

Unrecorded required/optional/cleared targets require a single explicit acknowledgement and remain unknown. Finish creates no performed results, zeros, omissions or skips. Logging every set alone does not finish. The immutable finish record retains action, versions, unknown IDs, timestamp, source and mandatory closure provenance. Execution completion, occurrence resolution, Open-membership release, any final plan transition and durable outcome commit together.

Record/correct/clear/re-record and finish use the same account-first transaction ordering. Result-first makes an older finish stale; finish-first rejects later ongoing mutations. SQL also blocks direct appends once the finish fact exists, before lifecycle update, so no stale preflight bypass remains. Exact finish retry returns its durable receipt; changed payload collides; a distinct finish returns ALREADY_FINISHED. Lost responses retain the original pending envelope. Background refresh cannot rebase confirmation. Conflicts retain local input and require an explicit new decision. Delayed responses cannot update another keyed execution screen.

The architecture's historical correction command is separate from ongoing result entry. It remains deferred alongside Undo Finish; this slice does not turn ordinary corrections into a post-completion workflow. Completed results are read-only. Broad offline synchronization and device-loss recovery are not claimed.

## Next occurrence and endpoint

ReadNext and the accepted StartOccurrence path use saved array order and stable UUIDs. Finished occurrences are ineligible; an existing account Open execution takes display precedence. Names, stage boundaries and copied prescriptions cannot choose identity. No wraparound, automatic start, scheduling or progression is added.

The accepted schema has optional sets, not optional occurrences. Every saved occurrence remains retained intent, including an optional-only workout. Missing optional work never prevents an acknowledged finish or resulting plan completion. The last resolved occurrence atomically changes Active to Completed, preserving prior lifecycle, source revision and approved endpoint IDs. Partial finish still resolves an occurrence without claiming complete performance. Historical command replay remains distinct from current plan state.

The existing template authoring schema fixes its supported schedule. Mixed verification uses independently owned copies of template prescriptions plus manual workouts; it does not claim support for inserting arbitrary workouts into an activated template.

## Schema and permissions

Only 20260914030000_trainer2_workout_finish is added. Trainer2ExecutionFinish is append-only, same-account bound, RLS-enabled and deferred-outcome sealed. Execution UPDATE is limited to lifecycle and guarded by a same-transaction finish fact; all original columns remain immutable. Existing Plan UPDATE admits only the associated mandatory completion. Connection validation rejects other execution-column UPDATE privileges. Reader has SELECT only, runtime has SELECT/INSERT on the new table and the narrow lifecycle grant. No PUBLIC/browser grant, SECURITY DEFINER, hosted admission or provider write is added. Server roles remain trusted across accounts, with application ownership predicates; administrative DDL bypass remains outside that threat model.

Fresh full-chain deployment/redeploy and a populated accepted-base upgrade pass. The upgrade restores base-compatible synthetic rows, compares twelve existing tables unchanged, adds no results or finish backfill, and finishes an existing Open execution through the restricted runtime. This is a populated base-schema upgrade, not an old application binary deployment. The older set-results upgrade helper only changes its migration cutoff to exclude later migrations.

## Verification

| Check | Result / evidence |
| --- | --- |
| Fresh and populated upgrade, required/optional/cleared work, original/history preservation | PASS; [stable PostgreSQL/browser receipt](workout-finish-evidence/postgres-browser-stable.json), [service and database evidence](workout-finish-evidence/verification-final.json) |
| Template, independent optional-only, mixed copied/manual order, duplicate names, stage boundaries, no wraparound | PASS; same stable harness, independently asserted source UUID order |
| Exact/distinct concurrent finish, lost response, changed-payload reuse | PASS; observed PostgreSQL blocking queues; one finish/outcome |
| Finish vs record/correct/clear/re-record, both orders, equal-value newer versions | PASS; controlled queues, lifecycle/history SQL assertions |
| Finish vs next-start, both orders | PASS; early start conflicts, later accepted start uses expected next UUID |
| Missing acknowledgement/binding, wrong account/execution, rollback | PASS; no partial execution/plan/result/action effects |
| Direct finish/outcome/binding/late-result/lifecycle bypass and permission denials | PASS; restricted-role transactions reject and roll back |
| Real browser journey | PASS; unsaved-input block, partial finish, dropped committed response, exact recovery after reload, completed readback, explicit next Start, same-DB app restart |
| Focused consumers/API/access/navigation | PASS; 8 files, 66 tests; [receipt](workout-finish-evidence/consumers-complete.json). Includes frozen confirmation, malformed endpoint/response, delayed valid acceptance, failed read recovery and completed-plan label |
| TypeScript / lint | PASS; [TypeScript](workout-finish-evidence/typescript-qualified.json), [lint](workout-finish-evidence/lint-qualified.json) |
| Fast tests | PASS; 8 files, 86 tests; [receipt](workout-finish-evidence/fast.json) |
| Runtime/doc contracts | PASS; [receipt](workout-finish-evidence/contracts-pass.json) |
| Environment/inventory | PASS; 5 files, 212 passed, 1 existing Windows skip, single-worker rerun; [receipt](workout-finish-evidence/environment-final.json) |
| Explicit command guard | PASS; 9 selected guard/coverage tests, including both command coverage honesty tests; 204 name-filtered exclusions are not executed coverage or platform skips; [receipt](workout-finish-evidence/command-guard.json) |
| Registry | PASS; 130 commands, all 84 package scripts; no errors/warnings; [result](workout-finish-evidence/registry-final.json) |
| Repository tooling | PASS; all 108 tests, no failures; [log](workout-finish-evidence/tooling.log) |
| Preflight / policy / whitespace | PASS; standalone dependencies, compatible Prisma, seven DB targets absent; [preflight](workout-finish-evidence/preflight.json), [policy](workout-finish-evidence/policy-final.json) |

Inventory is 406 files: 367 credential-free, 34 import-only, five DB-required. The new finish suite is credential-free; the registered PostgreSQL script is a separately confirmed disposable command. No full 367-suite inventory run is claimed. The only platform skip is test-environment-preflight.test.ts, dependency-free launcher / classifies signal termination without exposing a stack, conditional on win32. POSIX signals and physical mobile devices are unqualified.

Policy excludes aggregate verify and automatic Prisma generation in local implementation mode; explicit local client generation and the authorized disposable probes ran separately. Release-only migration-integrity/schema-drift and full release verification are not claimed. Accepted earlier reviews remain closed; unchanged behavior is not relabeled new independent acceptance.

Every retained command receipt contains before/after source manifests and output hash. FINAL_BINDING records exact differences from final source. The stable DB/browser run precedes documentation, the completed-plan label correction and restoration of the original body caps for other commands. Finish/SQL behavior is unchanged; final consumer/HTTP tests cover those corrections. Repository-tooling definitions/registry were unchanged through their full run; its log is bound separately. Failed attempts remain failed: exploratory run changed source mid-run; two mixed fixtures violated accepted authoring/canonical-value contracts; initial TypeScript encountered generated Next dev artifacts and test-only JSON input and matcher typing issues; an environment test timed out under parallel load and passed unchanged in the single-worker rerun. The npm.cmd recorder launch failed before lint ran; subsequent npm-through-Node lint passes are separate. No failed result is promoted to a pass.

## Screenshots and services

Visually inspected [desktop](workout-finish-desktop.png) and [390x844 mobile emulation](workout-finish-mobile.png): saved results and original targets are readable, optional/unknown work remains explicit and no horizontal overflow occurs. These are emulation, not physical-device qualification.

All task-owned PostgreSQL verification containers and app processes were cleaned up. Exact identities and cleanup statuses are retained in the service evidence. The final service was trainer2-draft-b383212b0e72, removed successfully; its app process exit 1 reflects intentional taskkill cleanup. No new demo remains. Existing checkouts, demos, evidence and user data were preserved.

Remaining work includes skips, abandonment, pause/resume, historical correction/Undo Finish, replacement/editing, automatic progression, broader offline support and release/hosted qualification. Stop for focused independent review; this handoff does not establish real-training readiness, deployment authorization or Phase 0 completion.
