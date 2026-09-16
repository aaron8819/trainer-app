# Local performed set results

This bounded local slice implements recording and correcting existing prescribed sets. Execution & Evidence owns `src/lib/api/trainer2/set-results.ts`; `src/lib/trainer2-contracts/set-results.ts` defines measurement and command shapes. The existing command owner supplies trusted account authorization, account-lock ordering, exact envelope identity, atomic accepted sequence and durable outcomes. Domain architecture §§5.4, 7.3, 9, 10 and 13 and blueprint §§15, 17–19 supply the semantic obligations. Broader offline capabilities remain intended architecture. Explicit [workout finish](WORKOUT_FINISH.md) is now implemented locally.

## Commands and versions

`POST /api/trainer2/executions/results` accepts the established schemaVersion/actionId/deviceId/originatingAccountId/ownershipEpoch/dependsOn envelope. The submitted account is checked against the trusted server principal; it does not authorize the request. Both commands name `target.executionId` and the exact execution-owned `target.targetId` from the immutable initial identity map, not an index, label, source target or position ID. The owned execution must be Open. No result command needs the current plan to remain active or reapplies exercise exclusions to honest performance.

| Command | Expected state | Intent | Effect |
| --- | --- | --- | --- |
| RecordSetResult | `resultVersion: 0`, no previous revision for this target | Non-null result | Creates one performedSetId and version 1 |
| CorrectSetResult | Exact positive resultVersion and performedSetId reviewed by the user | Result and nonblank correction reason, at most 200 characters | Appends version + 1, preserving performedSetId |
| CorrectSetResult with result null | Same correction precondition | Explicit erroneous-removal reason | Excludes current evidence; retains the revision and provenance |
| CorrectSetResult after clearing | Exact cleared version and same performedSetId | New non-null result and reason | Re-records under the same identity with a newer version |

A new Record after clearing conflicts; clearing never recreates version zero. Equal values do not restore an earlier version. No unconditional upsert or delete exists. Per-target versions define conflict scope; the existing account transaction lock orders acceptance without forcing independent sets to share an expected version. These ongoing result commands require Open; completed results use the separate [historical correction command](HISTORICAL_SET_CORRECTIONS.md). Logging all prescribed sets leaves the execution Open and the occurrence unresolved.

## Actual measurements

A result contains nullable `reps: { value, basis }`, nullable `measurement`, and nullable `rir`; at least one must be specified. Reps are integer 0–1000 with explicit total, perSide or alternating basis. PerSide records the stated count per side; this slice has no independent left/right counts. Load reuses the strict existing bodyweight/externalLoad/addedLoad/assistance union, original kg/lb, convention, decimal spelling and zero meaning. External load identifies barbellTotal, perImplement or machineDisplayed. Added load uses addedExternal; assistance uses displayedAssistance; bodyweight uses bodyweightOnly. Zero remains distinct from missing, and external zero requires validZero. Decimal syntax is nonnegative, at most nine integral and six fractional digits; RIR is optional and bounded at 10. Blank form fields stay unspecified, never zero.

Actual values, units and counting/loading basis may differ from targets. All actual fields are visibly entered/selected; none are copied from targets into saved evidence. Editing starts from the saved result. The actual exercise and classification remain linked to the exact immutable prescribed set in this slice; no exercise substitution or classification correction is introduced. Entry/correction timestamps are server recording times, not inferred performed times or actual performance order.

Workout start currently admits rep targets only. Duration, distance, unequal sided counts, unsupported-measurement notes, exercise/set additions, removal of prescribed work are outside result entry; explicit completion is owned by WORKOUT_FINISH.md. The form states its sided/duration limitation. Unsupported start captures continue to fail explicitly rather than being coerced into reps.

## Persistence and access

Migration `20260914020000_trainer2_set_results` adds append-only `Trainer2SetResultRevision`. Its primary key is executionId/targetId/version; account/action and performedSetId/version are unique. Same-account execution/action foreign keys, an immutable update/delete trigger, exact target membership, contiguous version and stable identity checks, submitted-command binding and deferred accepted-outcome seals protect provenance. The acceptance validator gains the two result owners and preserves its previous owner and accepted-sequence checks. Domain validation remains in the trusted server, as in the accepted threat model. Administrative DDL or trigger bypass is outside runtime guarantees.

Result append, accepted sequence, durable action and outcome commit together. A failure after append rolls everything back. Initial prescriptions, activated revisions and target IDs are never updated. Historical migrations are unchanged; fresh and populated accepted-base upgrades create no invented results. `trainer2-runtime-grants.sql` adds SELECT for reader/runtime and INSERT only for runtime on the new table. Runtime connection validation includes that table. RLS is enabled, PUBLIC/browser receives no new table grants, new trigger functions have PUBLIC execution revoked, and no SECURITY DEFINER function is introduced. Existing hosted admission and local Host/Origin protections remain in effect.

Execution GET and next-workout reads include `results`, containing the latest revision per target (including cleared null results), stable identity, version, action, reason and recordedAt. They remain account-scoped, read-only, private/no-store transactions. Initial target values are still read exclusively from the immutable START document.

## UI and recovery

`ActiveWorkout` renders one selected `SetResultRow` above the compact exercise queue in an Open `Workout`; inactive identity-keyed controllers preserve recovery state without rendering forms. See [active-set rules](TRAINING_UI.md#active-set-logging). Enter actual result, Record set, Edit result, Save correction, Clear erroneous result and Re-record result are separate explicit actions. Not recorded, unsaved, pending confirmation, saved and failed/conflicting states are distinct. Numeric mobile keyboards, labels and 44px controls support compact inline logging.

Each row retains its draft and reviewed base in account/execution/target-scoped sessionStorage. Pending exact commands are stored before submission and survive same-tab reload. A ref prevents double submission. Background/unrelated refresh preserves input and expected version; changing executions unmounts the keyed consumer and late replies are ignored. Before-unload and link interception protect pending input. This is same-tab recovery, not a complete offline-first or cross-device local-storage guarantee; acknowledged server results survive application-process restart while the task-owned DB exists.

Malformed responses, transport failure or a failed confirmation read retain Check again with the original envelope. Exact retry returns the durable historical outcome; changed-envelope identity is rejected. An accepted response triggers a current validated read, never installation of historical result values. Display merging preserves newer per-target versions. A conflict retains input and requires Review latest result, then Use this version for my correction, then a separate save. No automatic rebase or resubmission occurs.

Root layout still renders `AppNavigation`; its existing Trainer2 exclusion now includes `/trainer2/dev/executions/`. The execution page links to Trainer2 plans. V1 desktop/mobile navigation tests remain intact. This is a presentation correction, not access-control redesign.

## Verification

Run the registered `node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-set-results.ts --confirm-disposable` only with task-owned synthetic database authorization. It creates disposable PostgreSQL 17, applies fresh migrations and an accepted-base upgrade, uses restricted runtime/read roles, observes blocking chains for controlled races, checks rollback and direct-write denial, independently inspects current/history rows and compares original prescription/plan rows after mutation categories. The Edge journey records, reloads, corrects, loses a committed response and replays, conflicts across tabs, preserves unrelated drafts, inspects desktop/mobile and restarts the app against the same DB. Services are cleaned up in finally blocks.

`SetResultRow.test.tsx` adds five credential-free cases; existing HTTP and navigation suites cover the extended boundaries. Inventory is 405 files: 366 credential-free, 34 import-only and five DB-required. The disposable harness is separately registered, not a new Vitest DB suite. See `artifacts/trainer2/SET_RESULTS_HANDOFF.md` for source-bound receipts and explicit qualifications. The existing disposable demo launcher remains usable; no hosted deployment, independent acceptance, real-training readiness or Phase 0 completion is claimed.
