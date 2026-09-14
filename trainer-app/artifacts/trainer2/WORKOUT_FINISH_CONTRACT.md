# Workout finish: preimplementation contract and matrix

Authority: blueprint §§8,16–18,26; domain architecture §§7.3,8,9,13.3; accepted set-results review closing specification. Base e12bc081 / d9ba6021.

Execution & Evidence owns FinishExecution in lib/api/trainer2/workout-finish.ts. Planning derives occurrence resolution from its finish fact. The same transaction establishes mandatory plan closure. Supporting seams: strict contracts, account-locked acceptCommand, PostgreSQL guards, immutable captures, read models, Workout and SetResultRow. Implementation order: contract, additive persistence, command/read owners, HTTP/UI, tests, canonical docs. V1, historical migrations, prescriptions, admission and unrelated lifecycle commands remain untouched.

Finish uses the existing trusted principal/envelope. Expected binds initial content hash and every execution target's reviewed resultVersion and performedSetId (zero/null for never recorded), sorted by target ID. Missing, extra, stale and equal-value newer versions fail. Intent acknowledgeUnrecorded requires an explicit decision for any unrecorded work. Required, optional and cleared targets without results remain unknown; no results or omissions are manufactured. Reasons are optional. Pending finish remains authoritative Open.

Atomic effects: append immutable finish fact with action, binding, unknown targets, timestamp, source and closure provenance; Open → Finished and release account open membership; resolve linked occurrence; Active → Completed if all retained occurrences resolve; seal outcome. No automatic start. Schema has optional sets, not optional occurrences: all saved occurrences are retained obligations, including optional-only workouts. Optional sets never prevent finish or closure.

All ongoing Record/Correct/Clear/Re-record paths require Open at the locked command and SQL boundaries. Historical correction is a distinct future action in architecture §7.3; no ongoing command is repurposed and no historical correction workflow is added. Historical command replay remains separate from current lifecycle.

| Case | Behavior / verification |
| --- | --- |
| All recorded | Finish → completed read/reload → explicit accepted start of next |
| Required/optional/cleared unrecorded | One bound confirmation; remain unknown; partial finish resolves occurrence |
| Local edits/pending requests | Block initiating finish; explicitly save/discard/recover; preserve input |
| Background refresh | Confirmation snapshot stays frozen |
| Stale/equal-value newer version | Conflict, explicit refresh and new finish decision |
| Result wins race | Included only with matching reviewed binding; otherwise stale finish |
| Finish wins race | All ongoing result mutations rejected without append |
| Exact replay/lost response | Durable outcome, no repeated effects |
| Changed payload | Action collision |
| Concurrent distinct finishes | One completion; ALREADY_FINISHED for loser |
| Finish vs next start | Account lock orders; early start conflicts; later start selects saved UUID |
| Mixed/template/independent/duplicate names/stages | Saved occurrence array order; no wraparound |
| Final occurrence/optional-only targets | Atomic Completed with endpoint, revision, prior Active provenance; no next |
| Rollback/wrong account/execution/state | No partial domain transition |
| Malformed/delayed response | Retain pending envelope; cannot affect another execution |
| Fresh/upgrade/restart | Preserve prescriptions/results/history; same-DB restart readback |
| Permissions | Sealed insert and narrow lifecycle update; reader read-only; no PUBLIC/browser grants |

Verify real PostgreSQL controlled queues with independent SQL assertions, focused UI/HTTP tests, desktop/mobile journey, same-DB app restart, populated upgrade, TypeScript/lint/contracts, explicit registry/command guard/environment inventory and policy gates. No independent acceptance, deployment or Phase 0 completion claim.
