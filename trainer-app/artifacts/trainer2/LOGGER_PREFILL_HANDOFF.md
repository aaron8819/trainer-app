# Workout logger prefill and corrections

[Open the separate demo](http://127.0.0.1:36565/trainer2/dev/drafts?planId=1a9fd963-1df8-4945-ad83-c385c1e0d3ea).

## Source

- Worktree: `C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-logger-prefill-corrections`.
- Branch: `codex/trainer2-logger-prefill-corrections`.
- Exact base commit: `52480fc56552c500e19dc04171c87d7af65f6263`; tree: `f78493e76a3b96357d852be3f62fe265d386588c`.
- The latest completed visual-polish handoff, final binding and clean working tree matched Git before branching. Earlier UI commits were not used as the base.
- Exact final commit/tree and clean status: [FINAL_BINDING.json](prefill-evidence/FINAL_BINDING.json), generated after committing to avoid a self-referential hash.
- Local synthetic data only. No hosted/provider access, push, merge, deployment, admission, planner or lifecycle changes. Existing worktrees and evidence were preserved. No independent acceptance is claimed.

## Reproduced root causes

1. RDL history existed, but `SetResultRow` never consumed historical performance as a weight source.
2. An untouched form captured empty defaults once. After **83.125 lb, 9 reps, 3 RIR** persisted exactly, the previously opened next form kept blank weight/reps. The break was next-set initialization.
3. Another tab saved an RIR-only result. A refresh updated the saved summary while the first tab retained its old prescription suggestion and Log set action. This reproduced **Saved v1: load unspecified × reps unspecified · 3 RIR** beside a **132.28 lb** input. Command, database and readback agreed; the cached editor was stale.

[History reproduction](prefill-evidence/reproduction.json), [pre-mounted form](prefill-evidence/reproduction-blank.json), [stale editor](prefill-evidence/reproduction-stale-edit.json). The original user's action envelope was unavailable, so these establish reproducible defects rather than proving that user's exact sequence. No submitted-value loss was found in the verified journeys.

## Final behavior

`SetResultRow` owns drafts/editing; `ActiveWorkout` owns selection. Read-only `previous-performance.ts` supplies `firstSetLoads`, using pure rules in `engine/trainer2/logging-prefill.ts`. Result commands and their SQL guard remain the recording authority.

Precedence: **user-edited draft, including cleared fields → persisted result → compatible nearest preceding recorded set in this exercise position → first-set prescription/history**. Untouched forms derive fresh defaults. Drafts retain their reviewed version and exact pending command; late responses retain existing selection protections.

First-set history selects the latest eligible Finished workout at/before this execution's start, excluding current/discarded/skipped attempts. Catalog ID/version, variation, equipment and measurement meanings establish identity; names alone never match. Within the workout, scan matching positions/targets in saved order for the first compatible numeric **working** result, including its latest correction. Missing reps do not disqualify weight. The unchanged comparison-history table has a stricter matcher requiring reps and can omit weight-only records.

Initial mass suggestions convert to pounds then round to 5 lb, positive ties upward: **60 kg → 130 lb**. Zero remains zero. History says Last time and never authors a prescription. Following sets copy actuals without five-pound rounding, including missing fields. An incompatible nearest result does not cause borrowing from another exercise or an older compatible set. Exact reps/RIR defaults remain; ranges never become performed reps. Unchanged carried/edited kg measurements retain original bytes.

Current and historical value edits omit reason. Forward migration `20260916010000_trainer2_optional_correction_reason` permits SQL null for non-null corrected results while retaining envelope binding. Existing reasons, immutable records, actor, timestamp, action, versions, stale checks and replay seals remain. Erroneous clearing still requires its separate reasoned Open-only action; historical clearing remains prohibited.

UI: active-card muscle tags removed; queue tags retained; −10/−5/+5/+10 lb then Clear; RIR 0–5 plus numeric entry; always-visible set chips; Original units disclosures and the Options explanatory paragraph removed. Shared history load bases appear once. Green layout, timer, scrolling and finish behavior remain.

## Verification

- [Real Edge/PostgreSQL journey](prefill-evidence/browser.json): every revision matches its submitted command and database/readback; source priority, precision, zero/blanks, pre-mounted defaults, retained drafts, out-of-order selection, reload, reason-free edits, unchanged kg, exact retries, late responses, stale edits and acknowledged finish-to-home passed. No browser errors.
- [Focused tests](prefill-evidence/focused-final.log): 77 tests across five files. [TypeScript](prefill-evidence/typescript-status.json), [lint](prefill-evidence/lint-status.json), [repository gates](prefill-evidence/policy-run.json): passed, including 86 fast tests and contracts. Preflight and final doc contracts passed.
- Migration passed on populated synthetic data and fresh PostgreSQL 17. No historical migration/data rewrite.
- Inspected [desktop history](prefill-evidence/desktop-history.png), [desktop edit](prefill-evidence/desktop-edit.png), [320px](prefill-evidence/mobile-320.png), [390px edit](prefill-evidence/mobile-edit.png), and final demo captures. No overflow; RIR buttons remain at least 44px, wrapping at 320px.
- [Resume binding](prefill-evidence/resume-binding.json) matches implementation hashes to the successful journey. Accepted foundation evidence was reused. Full aggregate and Prisma generation are excluded by local execution policy; Prisma model shape is unchanged. No broad review was restarted.
- [Demo inspection](prefill-evidence/demo-inspection.json) and [restart](prefill-evidence/demo-restart.json) preserve corrected histories and the next workout. The empty inspection attempt was explicitly discarded.

Limits: desktop Edge emulation, not physical mobile/keyboard qualification. Existing history scanning and browser clock/storage limits remain. Logs/images/receipts are local ignored evidence; preparation, verification and inspection runners are committed.

## Demo and restart

App **36565**; container `trainer2-draft-a17643871b96`; PostgreSQL loopback **54399**; launcher session **91098**. Start Prefill practice: squat **130 lb**, RDL **140 lb**, Machine Crunch blank, incompatible Seated Leg Curl blank. Corrected history and a skipped occurrence are ready.

**Disposable data: Enter alone or Ctrl+C in the launcher stops it and deletes its database.** Application-only restart is `r`, then Enter; the same URL/data remain. This was verified. Task verification services are stopped; no other task's services were stopped. Earlier Trainer demos were already absent on September 22 resume.

Fresh recreation requires Docker, installed `postgres:17-alpine`, and repository dependencies:

```powershell
Set-Location 'C:\Users\aabloch\claude\vibe-coding\.worktrees\trainer\trainer2-logger-prefill-corrections\trainer-app'
node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable
```

Keep that terminal open. In a second terminal in the same directory, use the printed port:

```powershell
node node_modules/tsx/dist/cli.mjs artifacts/trainer2/prepare-prefill-demo.ts http://127.0.0.1:NEW_PORT --confirm-synthetic-trial
```

Preparation requires a fresh synthetic demo and prints its bookmark. It recreates fixtures, not later evaluation actions. Run `inspect-prefill-demo.ts --confirm-synthetic-trial` with the same Node/tsx prefix to check readiness without recording sets. Use a separate disposable launcher for `verify-prefill.ts CONTAINER_NAME --confirm-synthetic-trial`, which consumes the prepared practice workout.
