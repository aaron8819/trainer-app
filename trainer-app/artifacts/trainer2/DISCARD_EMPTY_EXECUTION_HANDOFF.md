# Discard Empty Execution — local implementation handoff

Ready for focused independent review. This report is implementation evidence, not independent acceptance. V1 remains live, hosting paused and Phase 0 incomplete. No hosted access, real training data, imports, push, merge, deployment, spending or admission change occurred.

## Coordinates and ownership

- Branch: `codex/trainer2-discard-empty-execution`.
- Worktree: `C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-discard-empty-execution`.
- Verified accepted base: `codex/trainer2-historical-set-corrections`, commit `7dbb7f538e26366a4360df6df19ee6e4214a29e0`, tree `02e44f3c1f48ab42c0c0d4472008c175e00a4421`.
- The requested branch/path were absent, the main checkout clean, and registration/base verified before creation. Start-TrainerTask inspection used classification db-migration and reported no blockers. Unrelated worktrees, evidence, demos and data were preserved.
- Final commit/tree and artifact/source hashes: [FINAL_BINDING.json](discard-evidence/FINAL_BINDING.json), written after the clean local commit. This handoff is committed; detailed local receipts and screenshots remain beside it in the preserved worktree.

Read the applicable root AGENTS.md, documentation entry point, architecture lifecycle §§8.2–8.3 and implementation command contract, accepted historical-correction review/next-slice definition and handoff, and accepted workout-start/finish contracts, owners, tests, handoffs and review evidence. Earlier reviews remain closed. The architecture-guard and React review skills guided the change; repository-native PostgreSQL/Playwright tooling supplied browser verification.

Canonical owner: `src/lib/api/trainer2/discard-execution.ts` in Execution & Evidence. Supporting seams are the shared `acceptCommand`, strict contracts, immutable SQL fact/guards, execution and next read models, thin HTTP route, Workout/DiscardWorkout and retained result UI. Planning continues to derive resolution only from Finished attempts. No legacy owner, accepted seed, progression, planner, admission or hosted seam changes.

Canonical behavior: [DISCARD_EMPTY_EXECUTION.md](../../docs/architecture/trainer2/DISCARD_EMPTY_EXECUTION.md).

## Exact emptiness, lifecycle and identity

An eligible execution is account-owned, Open and has **zero Trainer2SetResultRevision rows**. Required/optional sets and valid zero values all count as performed history. Record → correct → clear remains nonempty. Re-recording cannot restore discard authority. Failed commands and read-only visits do not count as work. This bounded model has no persisted session adjustments, omissions, execution notes or other performed-activity owner; future activity owners must extend this check. The stricter no-history rule is consistent with the authoritative prohibition on losing actual or recoverable recorded work.

Discard appends an immutable fact and changes Open → Discarded. It preserves execution identity, occurrence/source membership as provenance, initial prescription/hash, original start time and all command history. The fact records the trusted reauthorized account actor, database-assigned discard time and action identity. Finished/Discarded attempts reject new discard commands. No physical deletion, general abandonment, skip, undo-discard, reopening or historical deletion is introduced.

`DiscardEmptyExecution` is exposed at `POST /api/trainer2/executions/discard`. It retains the established version-1 action/device/account/ownership-epoch/dependency envelope. Target names exact executionId and occurrenceId. Expected binds initial contentHash and every execution target's resultVersion/performedSetId in target-ID order. Empty work binds zero/null; intent is empty. Missing/malformed/stale/foreign bindings fail without domain effects. Immutable snapshot identity, complete result versions and an irreversible terminal lifecycle make this binding sufficient without adding a competing execution version counter.

The shared account-first lock orders trusted ownership revalidation, exact membership/lifecycle/binding checks and authoritative history inspection with every result, finish and start mutation. Discard fact, lifecycle release, accepted sequence and durable outcome commit atomically. SQL guards also reject result/finish inserts after the discard fact within the same transaction before the lifecycle UPDATE. Direct runtime callers cannot bypass the outcome or lifecycle seals.

Exact retry returns the original durable outcome before current-state checks. Changed envelope under that action identity collides. Original start replay always identifies its original attempted start, even after discard and replacement. Old discard replay changes neither replacement nor next selection. Stale result, finish and historical-correction requests address the old execution and reject; they never redirect.

Discard leaves the stable occurrence unresolved and next, with unchanged order, plan position/lifecycle, later workouts and prior completion evidence. Nothing starts automatically. Deliberate fresh StartOccurrence uses the accepted start owner and creates a distinct execution, target identities and initial snapshot. Continue is read-only. Repeated cycles retain every attempted start and permit only the current Open attempt to be selected.

## Migration and authority

One forward migration: `20260915020000_trainer2_discard_empty_execution`. No accepted historical migration is rewritten.

- Adds immutable, RLS-enabled Trainer2ExecutionDiscard, with same-account execution/action foreign keys, trusted time, insertion guard and deferred outcome seal.
- Extends lifecycle to Discarded. Replaces the occurrence-wide unique constraint with `trainer2_one_ordinary_execution` on occurrenceId where lifecycle is not Discarded. The existing one-Open-per-account index remains.
- Retains source foreign keys and immutable execution contents; extends lifecycle/result/finish/accepted-owner guards narrowly.
- Runtime receives SELECT/INSERT on the fact; reader receives SELECT. Existing lifecycle-column-only UPDATE and all existing restrictions remain. No PUBLIC/browser grant or SECURITY DEFINER function is added.
- `database.ts` recognizes the new exact table. Administrative role preparation adds four discard-table statements in `prisma/trainer2-runtime-grants.sql`. Existing roles require those statements after migration; migrations do not silently broaden role authority.

Fresh installation, redeploy and populated base upgrade passed. The upgrade seeds Open and Finished executions with recorded history under base-compatible commands, compares every existing Trainer2/User table unchanged across migration/redeploy, verifies no invented discard facts, then discards the existing empty Open execution. A test-only proxy supplies null for the not-yet-existing discard read while exercising base-compatible command code against accepted SQL. This is a populated schema upgrade, not an old application binary deployment. Existing histories, initial snapshots, prior finish facts and outcomes remain intact.

The accepted server-role model remains trusted across accounts; request principals and predicates supply account authority. Administrative DDL bypass is outside this guarantee. Hosted admission stays denied.

## Behavior matrix and persisted evidence

Final [PostgreSQL/browser receipt](discard-evidence/postgres-browser-delivery.json), [service and domain evidence](discard-evidence/verification-delivery.json), and [progress/persisted comparisons](discard-evidence/progress-delivery.json) report **10 passing groups**.

| Boundary | Result |
| --- | --- |
| Empty discard and no prior work | One immutable discard fact; original snapshot preserved; same occurrence next; no automatic start. |
| Required/optional recorded, valid zero, record→clear, completed | Reject; result history, plan and execution state unchanged. |
| Wrong account/occurrence/execution, missing/malformed/stale binding | Explicit reject/conflict; failed commands do not make the execution nonempty. |
| Same identity, changed payload, repeated attempts | Original replay once; changed payload collision; three deliberate replacement starts have distinct execution/target IDs. |
| Original start replay after discard and replacement | Returns original identity without changing the historical attempt or current availability. |
| Old discard replay after replacement | Same outcome, no new effects; only replacement is selected Open. |
| Concurrent distinct/identical discards | One transition; distinct loser conflicts; identical command replays same outcome. |
| Discard vs first recording, both orders | Discard-first rejects recording; record-first makes discard nonempty. |
| Discard vs acknowledged finish, both orders | Discard-first rejects finish; finish-first rejects discard. No false resolution. |
| Discard vs start/continue | Early distinct start conflicts; start ordered after discard creates a fresh attempt. Continue/read never mutates. |
| Rollback at lifecycle, sequence, outcome boundaries | Fact, action and all transactional effects roll back; exact retry succeeds. |
| Direct runtime bypass probes | Missing outcome, forged accepted outcome, wrong binding and same-transaction late result/finish all reject atomically. |
| Stale logging/finish/historical correction on discarded attempt | Reject without affecting a replacement. |
| Browser cancellation and unsaved/pending input | Cancellation changes no persisted state; focus restored; unsaved and held result POST block discard. |
| Lost response, exact retry, stale two-tab decision | Committed response lost; byte-identical retry confirms once. Intervening recording rejects the frozen confirmation; explicit refresh reveals nonempty state. |
| Bookmark/reload/restart | Old attempt stays Discarded, replacement stays Finished; full readbacks and domain snapshots remain unchanged across restart. |

Races use a separate transaction holding the account row, observe participant one and then participant two in PostgreSQL's blocking graph, and only then release the holder. Holder/backend IDs, blocker arrays and outcomes are retained. Poll intervals sample the graph; timing sleeps do not establish commit order.

Persisted comparisons retain full plan/revision/decision/execution/finish rows, original and replacement readbacks, original histories, finish outcomes, and before/after cases. They prove unchanged plan order/position/lifecycle, later intent and prior completed-workout evidence, intact discarded snapshots, distinct replacement identities and one selectable live attempt. Rejections may append durable rejection outcomes, but have no domain effects. Browser cancellation has no command effect.

## Browser and visual verification

Actual installed Edge journey: Save → Review/Activate → Start → cancel discard → enter/discard unsaved input → discard with committed response loss → reload/exact retry → reload → Start same workout again → inspect old bookmark → hold pending result POST → record valid zero → confirm discard unavailable → acknowledged Finish. A second tab confirms the old empty view after the record and receives a conflict, then explicitly refreshes. Application process restart uses the same still-existing disposable DB and reopens both old and replacement URLs.

Component/HTTP regressions additionally cover malformed responses, wrong execution/occurrence/plan acceptance, failed authoritative readback, retained exact requests across remount, and delayed acceptance after keyed execution replacement. These are component-level response controls, not claims of physical cross-device/offline qualification.

Inspected final [desktop](discard-desktop.png), [390×844 mobile emulation](discard-mobile.png), [mobile confirmation detail](discard-mobile-confirm.png), and [old bookmark after replacement](discard-bookmark.png). Prescription text and discard copy are readable, no horizontal overflow, controls are at least 44px, and Cancel receives/restores focus. The old page has no logging, finish or historical correction actions and offers a separate Continue link to the replacement. Mobile evidence is **Edge viewport emulation, not a physical device**.

## Verification and source integrity

| Check | Final result |
| --- | --- |
| PostgreSQL/browser, upgrade, races, permissions, restart | 10 groups passed; final source. |
| Focused UI/HTTP/access/isolation | 7 files, 59 passed; final source. |
| Historical-correction compatibility | 12 groups passed; shared SQL guards and existing upgrade/browser recovery remain supported. |
| TypeScript | Passed; final source. |
| Lint | Passed; final source. |
| Doc/runtime contracts | Passed; final source. |
| Fast tests | 8 files, 86 passed; unchanged affected foundations, one worker. |
| Environment/inventory | 5 files, 212 passed, one existing Windows-only skip. |
| Explicit guard/coverage selection | 5 passed; 124 name-filter exclusions are not executed coverage. |
| Repository tooling | 108 passed, zero failed. |
| Registry | 132 commands, all 84 package scripts registered, no errors/warnings. |
| Preflight/policy/whitespace | Passed; standalone compatible dependencies; seven DB target variables absent; no policy blockers. |

Inventory reconciled to **407 = 368 credential-free + 34 import-only + five DB-required**. One new Vitest file; no removals. Existing HTTP tests expanded. Route inventory adds exactly discard, 11→12. Registry and exact guard-first launcher allowlist add exactly one command, 131→132. Negative controls remain.

Policy excludes local execution of release aggregate, migration-integrity and schema-drift gates. Full credential-free inventory was not rerun or claimed. Prisma generation and synthetic migration/role writes were explicitly authorized by this task and verified separately. [Policy](discard-evidence/policy-final.json) retains permitted skips and conservative unmatched-path warnings. The platform skip is the existing win32 signal-termination test, distinct from name-filter exclusions.

Each successful command receipt records sanitized invocation, UTC start/end, exit status, Node version, log hash and before/after source manifests. FINAL_BINDING compares each receipt against final source and lists exact differences. Final application verification has no behavior-source delta; earlier environment/tooling evidence is qualified to unchanged gate definitions. The final discard/TypeScript/lint/focused receipts cover final behavior; earlier gate receipts differ only in explicitly listed files outside their unchanged gate definitions. The only subsequent tracked delivery addition is this handoff. Failed receipts are not promoted.

Final PostgreSQL/browser run ended 2026-09-15T16:58:16.896Z, status 0. Node 24.12.0, PostgreSQL 17.10 (aarch64 Alpine), Docker 29.6.2, Prisma 7.3.0; installed Edge 153.0.4234.32; Next dev uses default Turbopack. Exact lock dependencies installed offline with scripts disabled (693 packages), followed by local Prisma generation. No dotenv files or hosted credentials copied.

## Failed attempts and limitations

- First SQL run passed four groups, then stopped on an incorrectly named race test helper. Corrected the helper/type annotations; retained failed receipt.
- Second SQL run passed eight groups; browser selector incorrectly expected Cancel instead of the existing Discard input button. Corrected test selector; retained failed receipt.
- Third complete PostgreSQL/browser run passed; its outer receipt recorder then failed on an unavailable import.meta.filename in CommonJS. The inner service/domain receipt retains the successful run, and the outer log is retained. Recorder uses its actual argv path now; final run and receipt both passed.
- Diff/screenshot inspection caught punctuation mojibake from a Windows default text decoding operation. Restored accepted punctuation bytes using explicit UTF-8, reran final UI/browser/TypeScript/lint checks and inspected corrected screenshots.
- The existing historical-correction upgrade fixture reproduced a missing-discard-table error while applying current grants against its older base. Updated only that fixture to defer new grants and supply the absent discard read until migration; its full 12-group SQL/browser suite passed, including historical correction after completion. This verifies compatibility rather than reopening the accepted review.
- Initial targeted lint had one unused harness import; subsequent direct command-guard probes use that import. Final lint is clean.

No broader abandonment, performed-work deletion, undo-discard, undo-finish, reopening, skip, offline/device-loss synchronization, new execution activity kinds, administrator-bypass guarantee, hosted readiness or real-training authorization. Client-only work on another device that has not reached the server is outside the admitted local synchronization model; known local drafts/pending results are retained and block discard, and later server writes to discarded attempts conflict without rebinding.

## Demo, restart and cleanup

From this worktree's trainer-app:

```
node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable
```

Use only synthetic input. Open the exact printed READY URL, save/review/activate a plan, start a workout, choose Discard empty workout, then deliberately start again. Record a set to see discard become unavailable. The launcher owns its synthetic DB/server and removes them on Enter/Ctrl+C. Restarting the launcher creates a new disposable DB; the automated harness separately proves app-process restart against the same still-existing DB.

All 7 task-owned verification containers were removed: trainer2-draft-110799a59bbd, trainer2-draft-2116ec8bc63c, trainer2-draft-2f551a98a7b9, trainer2-draft-a18542860e5e, trainer2-draft-bddc86fd5b06, trainer2-draft-d65eb13e544a, trainer2-draft-e62402763969. [Cleanup evidence](discard-evidence/cleanup.json) independently confirms absence. Web cleanup succeeded; server exit 1 is intentional Windows taskkill shutdown. No task demo remains. Existing demos/services, worktrees, evidence and data were preserved.

Stop ready for focused independent review. No independent acceptance is claimed.
