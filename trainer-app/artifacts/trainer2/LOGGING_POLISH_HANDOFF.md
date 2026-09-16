# Trainer2 logging polish — local evaluation handoff

**[Open the prepared demo — Week 2 Lower A](http://127.0.0.1:32470/trainer2/dev/drafts?planId=3287f5c3-fadc-431c-92e9-6735ff9fcf2a)**

Ready for hands-on evaluation and focused independent review of the accumulated training UI. This is implementation verification, not independent acceptance, deployment readiness, or real-training authorization.

## Coordinates and boundaries

- Verified starting branch: `codex/trainer2-active-set-ui`; commit `9f9d3587aa60c0364a48489b7ae9015c5e219c42`, tree `ccc2dd73856da0f42ed1a16c466a3add5745c38e`. Clean tracked/untracked state before editing; existing ignored evidence/demo files preserved.
- Verified direct parent: `e84f9a5ed7f53e6db62f95622798820b13f1ae5c`, tree `a9834c0a8b3274d0aff35e9bca538c308cd15fba`. The supplied parent was not the latest implementation. The active-set FINAL_BINDING matched the actual branch/tree, and ancestry was checked with Git.
- Delivery branch: `codex/trainer2-logging-polish`.
- Worktree: `C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-logging-polish`.
- Exact final commit/tree, clean status, source manifests, runtime deltas and evidence hashes: [FINAL_BINDING.json](polish-evidence/FINAL_BINDING.json), generated after the local commit.
- Ownership: `SetResultRow` owns suggestions/drafts/command recovery; `ActiveWorkout` owns selection/queue/scroll; `rest-state`/`RestBar` own advisory browser state; `pound-display` owns display conversion. The existing previous-performance read model now considers supported mass units compatible; all identity, load-type/convention and rep-basis checks remain.
- No schema, server command, persistence, admission, planner, accepted-seed, V1 handler, import, hosted access, push, merge or deployment changes. Earlier accepted domain reviews remain closed. Package/lockfiles are unchanged; the existing dependency installation is reused through a local junction.

## Feedback → change

| Request | Result |
| --- | --- |
| Pounds without setup | Weight (lb), immediate ±5/±1 controls, no unit picker; semantic load options remain explicit. |
| Useful defaults | Explicit prescribed load/exact reps/RIR, or compatible preceding actuals within the same execution-owned position. Unsaved input wins. |
| V1 density | Reps first between circular ±1; weight adjustment row/Clear; circular RIR choices/direct entry; green selected controls and slim Log set. |
| Rest at active area | Dark countdown bar, green progress, Controls with ±30 seconds/dismiss; inputs stay usable. |
| Queue detail | Saved-order collapsible role groups, expandable chips, recorded/planned counts, concise semantic results and selected highlight. |
| Scroll/focus | Queue selection and confirmed new-record advance reveal the active card only when needed, focus its heading and announce selection. |
| Contextual recovery | Retry save, Check saved results, explicit conflict review; no permanent Recovery/Refresh controls. Eligible discard is under Workout menu. |
| Finish | Separate discoverable action, nearby blockers, explicit incomplete-work acknowledgement, home navigation only after confirmation. |

## Conversion and prefill rules

Canonical detail: [TRAINING_UI.md](../../docs/architecture/trainer2/TRAINING_UI.md).

Kg presentation divides by exactly **0.45359237**, rounded to **two decimals**; existing lb decimal spelling is retained. Bodyweight/non-mass/unspecified values are not treated as kg. Load convention, assistance/added meaning, rep basis and zero semantics remain explicit. Targets, previous performance, saved/history results and chips use this presentation. Original kg prescription is available in History; saved results expose Original units; historical revision details retain original units.

New entered mass is lb. When correcting only reps/RIR, an unchanged mass field retains its **original persisted measurement bytes**, including kg and decimal spelling. Opening a pounds view creates no dirty draft; unchanged Save correction is a no-op. Original prescriptions/history remain immutable. Clear blanks a weight input; it is distinct from reasoned Clear erroneous result.

Priority: unsaved draft → saved result → nearest compatible preceding logged set in immutable set order within the same execution-owned exercise position → explicit prescription. No carry across exercise occurrences or duplicate names. Rep ranges stay visible with blank actual reps; a single target value prefills. No prescribed load means blank, never previous-workout weight. Missing actuals carry as missing; zero stays zero. Next-set targets remain visible even when actual suggestions differ.

Suggestions are captured once when first presented and retained separately in same-tab sessionStorage. Background refresh/later correction cannot overwrite them. Suggestions do not block finish and never write results. Typed drafts, pending exact commands and original version bindings retain the existing protection. Older unitless drafts retain their amounts with the lb default; older kg drafts convert only their visible form; any retained command envelope stays byte-exact.

## Timer event, retry and reload behavior

- Only bound accepted **RecordSetResult**, confirmed by matching current readback, starts rest. It uses the logged exercise's role: Main lift **180 seconds**, otherwise **120 seconds**. Authored rest is still visible as prescription; it does not override this requested timer default.
- Deadline is the server record timestamp plus duration, not response arrival. A late exact retry gets remaining time; an already-expired record gets no new visible countdown.
- Account/execution-scoped localStorage includes originating action ID and seen events. Duplicate/old replay, refresh, readback alone, corrections and historical correction do not restart. Clear/re-record remains a correction under the original performed identity and also does not restart.
- A new recorded set replaces current rest. Older out-of-order events cannot replace a newer deadline. Dismissal/expiry are retained; replay does not resurrect them.
- Reload/browser restart retain the timer if the same origin's localStorage survives. Delayed/background browser ticks use wall-clock deadline. Cross-tab storage events synchronize it. Reasonably aligned browser/server clocks are assumed; recording time is not inferred actual performance time.
- ±30 seconds and dismissal clamp at zero. No per-second server writes, sounds or notification permissions. Finish/discard confirmed readback clears rest. Storage loss can lose this advisory convenience state; it never blocks logging/finish.

## Queue, movement and recovery

Trainer2 catalog version 1 has purpose/equipment/measurement metadata, but **no verified muscle-group metadata**. Tags are omitted; none are guessed from exercise names or borrowed from V1. Consecutive role grouping preserves saved order. Expansion survives logging/selection within the mounted workout; expansion is not retained on reload. Logged chips directly open the correction form; corrections stay selected and do not restart rest.

Selection generation and target identity prevent late responses from pulling the user away. Only queue selection or confirmed new-record advance requests scrolling. Heading focus uses preventScroll, a polite announcement and no automatic numeric focus/keyboard. Visual viewport bounds reserve bottom space; reduced motion is respected. Trainer2 excludes V1 sticky navigation. Typing, ordinary refresh, correction save and ticks do not initiate movement.

Uncertain commands expose Retry save plus Check saved results with Checking…/outcome/error feedback. Readback alone retains pending input and cannot prove the individual command succeeded. Conflict review preserves original expected versions until explicit rebase, followed by separate save. Finish/discard conflicts expose Review latest values. Finish still blocks retained unsaved/pending input and never records/discards it automatically.

## Verification and visual evidence

| Check | Evidence |
| --- | --- |
| Browser + real PostgreSQL log/rest/log journey | [browser.json](polish-evidence/browser.json), [runner](verify-logging-polish.ts): prescriptions/ranges/absence, sequential and out-of-order input, duplicate exercise identities, corrections/clear/re-record, zero/unspecified/bodyweight/assistance/alternating, reload, held/lost responses, byte-exact retry, duplicate replay, two-tab conflicts, timer adjustment/dismissal/expiry, complete and incomplete finish, empty discard. |
| Extended kg journey | Same receipt: original persisted `20.000000 kg` stays byte-identical after rep-only correction; repeated reopen/save does not drift or append a display-only correction; compatible kg history remains after lb logging. |
| Timing qualifications | Real reload and 2.2 seconds of wall-clock browser freezing/background elapsed time via CDP; deterministic browser-clock advancement for expiry, plus pure timer event tests. No physical-device/background-OS qualification claimed. |
| Final demo/browser smoke | [demo-final.json](polish-evidence/demo-final.json), [runner](inspect-logging-demo.ts): fresh separate history/demo, home/Program, one editor, pound input/history, touch sizes/inputmode, reduced-height scrolling, finish guard, confirmed empty discard and Week 2 Lower A still ready. No page/console errors. |
| Focused affected tests | [focused-final.log](polish-evidence/focused-final.log): **7 files / 86 passed**. |
| TypeScript / full lint | [TypeScript](polish-evidence/typescript-final.log), [lint](polish-evidence/lint-final.log): passed. |
| Repository selected implementation gate | [policy-run.json](polish-evidence/policy-run.json): fast tests **86 passed**; conservative release aggregate is excluded by policy from local implementation mode. |
| Preflight / contracts / environment | [preflight](polish-evidence/preflight.log), [contracts](polish-evidence/contracts.log), [environment](polish-evidence/environment.log): contracts aligned; environment **212 passed / one platform skip**. No new Vitest test files, so inventory unchanged. |

Visual inspection used the actual V1 card/queue source and existing source-bound V1 fixture ([V1 mobile](polish-evidence/v1-patterns-mobile.png) copied unchanged from the sibling worktree; see its ACTIVE_SET_UI_HANDOFF). Revised captures: [desktop rest](polish-evidence/desktop-rest.png), [mobile rest](polish-evidence/mobile-rest.png), [final demo desktop](polish-evidence/after-desktop.png), [final demo mobile](polish-evidence/after-mobile.png), [390×500 reduced-height emulation](polish-evidence/keyboard-height-emulation.png). Desktop is 1360×1000; mobile viewport is 390×844. These are headless Edge viewport emulations, not physical mobile screenshots or an actual software keyboard. Labels remain readable, buttons are at least 44px, no horizontal overflow was observed, and the active inputs remain available below rest.

Browser receipts bind source manifests. The final binding explicitly lists changes after the deep journey (historical provenance labels, unused unit-hint removal, storage-failure handling and older unitless-draft migration) rather than representing the earlier run as an exact final-tree run. Final focused checks and demo smoke cover the final runtime. The [application-restart readback](polish-evidence/restart.json) also confirms the same next workout and deeply equal synthetic history. Existing accepted domain evidence is reused for unchanged database transaction/race owners. Evidence logs/screenshots/receipts are local ignored artifacts; reproducible runners and this handoff are committed.

Resolved development failures: outdated UI expectations, missing test-environment scroll API, initial Python text encoding, lint's event-callback purity interpretation, and one browser assertion that read the timer before retry completion. No domain regression or independent acceptance was inferred.

## Demo lifetime and restart

Demo container: `trainer2-draft-25c70d6fbab2`; PostgreSQL loopback port **57796**; app **32470**; launcher terminal session **72037**. Synthetic Week 1 has 56 recorded sets, one historical correction, and Week 2 Lower A ready. The smoke checks truthfully discarded empty inspection attempts; they recorded no Week 2 work.

**Application-only restart:** type `r` then Enter in the running launcher terminal. Same database and URL remain. Reload/browser close preserves saved results while this database exists. Unsaved drafts/suggestions are same-tab sessionStorage; rest is origin/account/execution localStorage. Neither is a cross-device backup.

**Full shutdown:** Enter alone or Ctrl+C in that launcher deletes its disposable database. Fresh recreation:

```powershell
Set-Location 'C:\Users\aabloch\claude\vibe-coding\.worktrees\trainer\trainer2-logging-polish\trainer-app'
node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable
```

Keep that terminal open. In a second terminal in the same directory, substitute the newly printed port:

```powershell
node node_modules/tsx/dist/cli.mjs artifacts/trainer2/prepare-active-demo.ts http://127.0.0.1:NEW_PORT --confirm-synthetic-trial
```

Preparation prints the new bookmark with fresh identities. Run it only against a fresh disposable demo; it recreates synthetic history, not later evaluation actions. Docker, the already-installed `postgres:17-alpine` image and installed lockfile dependencies are prerequisites.

Task-owned verification app/database (`37250`, `trainer2-draft-c13cc2724b77`) were stopped and removed. Its launch had closed stdin, so cleanup verified the exact application path/PID ancestry before terminating only that process tree and stopping only that container. Original demos on **37847**, **33947** and **37020**, their databases, worktrees and evidence remain untouched.

Deferred: Skip Set, Add Set, Add Exercise, warmup authoring, finishers, Pause/Resume, Undo Finish and undo-skip. Muscle tags await authoritative metadata. Physical mobile usability and focused independent review of the accumulated training UI remain outstanding.
