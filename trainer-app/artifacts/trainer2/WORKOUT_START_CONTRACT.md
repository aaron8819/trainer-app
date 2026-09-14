# Workout start: preimplementation contract

Base: `010836c5a12f5e85a36b53c00b408ffeb5cbdee9`, tree `c11a6cecfdf33efa69c30e928e7007d3e0cd2ebe`.

Execution & Evidence owns `StartOccurrence` in `src/lib/api/trainer2/execution.ts`; shared `acceptCommand` owns principal revalidation, account locking, envelope identity and atomic outcomes. Planning retains activated intent. No V1, hosted admission, results, completion, skipping, adjustments or progression computation changes.

The existing versioned action/device/account/ownership-epoch/dependency envelope names `target.planId`, `target.occurrenceId`, `expected.planRevisionId`, `expected.instructionEpoch`, and empty intent. Account input is an assertion against the trusted server principal. The exact immutable revision identifies the reviewed source without accepting a browser prescription. Current restrictions are checked at acceptance for the selected occurrence.

Selection is the first occurrence in the authoritative saved occurrence order, identified by UUID. This bounded lifecycle has no resolution commands: starting never advances selection. Only an Active plan with current revision equal to its initial approval may start. The named occurrence must exist in that revision and equal the selected next occurrence. No fallback to another occurrence is permitted.

One account lock protects all reads and writes. One Open execution per account and one ordinary execution per occurrence are database-enforced. A successful command atomically appends an execution with immutable versioned START capture, execution-owned position/target identities and explicit source identities; an accepted sequence and durable outcome. The full snapshot preserves source occurrence/stage, exact ordered exercise and target semantics, progression intent, revision/hash and instruction/policy provenance. No result is created. Read/reopen uses this snapshot only and fails explicitly on missing, corrupt or unsupported capture.

| Path | Outcome/effects |
| --- | --- |
| Eligible first occurrence | Accepted; one Open execution and fixed capture |
| Exact envelope retry, including response loss | Original durable outcome; same identities/timestamps/capture |
| Same action, changed envelope | Action collision; original outcome retained |
| New action for started source | ALREADY_STARTED conflict; separate read finds existing execution |
| Other account Open execution | OPEN_EXECUTION_CONFLICT; no start |
| Draft/nonactive, wrong source, later occurrence | Explicit rejection/conflict; no substitute start |
| Changed revision/instruction epoch or exclusion | Refresh/restriction failure before domain writes |
| Competing requests | Account lock orders outcomes; unique constraints backstop duplicates |
| Infrastructure failure before commit | Full rollback; original action retry remains possible |
| Reopen, bookmark, refresh, prefetch | Read only; no action or lifecycle transition |

Implementation order: strict capture/command contracts; additive SQL constraints and permission qualification; owning command/read; thin HTTP and UI; focused pure/UI and controlled real PostgreSQL/browser tests; canonical documentation and handoff. Main risks are acceptance-seal extension, faithful capture validation independent of catalog defaults, stale asynchronous UI responses, and source-bound upgrade/race evidence. Historical acceptance reviews remain closed; unchanged evidence is reused.

Verification covers independently expected saved semantics, template/independent ordered workouts, zero/null and mixed targets; access and eligibility; observed-lock concurrency and rollback; exact replay/restart; corrupt snapshot failure; read-only reopening; fresh/upgrade migrations and grants; desktop and mobile emulation; command guards, inventory/classification, contracts, TypeScript, lint and selected repository gates.
