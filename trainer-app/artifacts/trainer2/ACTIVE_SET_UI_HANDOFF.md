# Trainer2 active-set UI — local evaluation handoff

**[Open the prepared demo — Week 2 Lower A](http://127.0.0.1:37847/trainer2/dev/drafts?planId=69f999df-7863-4eaf-a2e5-4587415b5dae)**

Ready for user evaluation and focused independent review of the accumulated UI changes. This is implementation verification, not independent acceptance, deployment readiness or real-training authorization.

## Coordinates and ownership

- Branch: `codex/trainer2-active-set-ui`.
- Candidate base: `e84f9a5ed7f53e6db62f95622798820b13f1ae5c`, tree `a9834c0a8b3274d0aff35e9bca538c308cd15fba`, branch `codex/trainer2-training-ui`. All matched before creating the clean isolated worktree. The base UI candidate has not passed independent review.
- Worktree: `C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-active-set-ui`.
- Final commit/tree, clean status, runtime source comparisons and evidence hashes: [FINAL_BINDING.json](active-set-evidence/FINAL_BINDING.json), generated after commit.
- `Workout` integrates `ActiveWorkout` for Open execution presentation. `ActiveWorkout` owns selection/queue, and the existing `SetResultRow` owns drafts, pending commands and corrections. No route, database/schema, admission, planner, history matcher, V1 runtime or accepted-domain behavior changed.
- Training home, Program, previous-performance matching, terminal readback and confirmed finish-to-home are preserved. Earlier accepted domain reviews remain closed.

## V1 baseline and visual comparison

Inspected the actual `src/components/log-workout/WorkoutActiveSetCard.tsx`, `WorkoutExerciseQueue.tsx`, `ExerciseSetChipsEditor.tsx`, `ActiveSetPanel.tsx` and `useWorkoutLogState.ts`, including the card's Tailwind styles, numeric controls, quick RPE selection, history affordance, queue grouping/chips and first-unlogged fallback.

Rendered the actual V1 card and queue with synthetic presentation props and inert actions using [capture-v1.ts](capture-v1.ts). No legacy account/history/mutation handler ran. Adopted the single-card-before-queue hierarchy, progress at the card top, current exercise/role/set/target, explicit logging, adjustment controls, effort shortcuts, and per-exercise recorded counts/set selection. V2 adapts these patterns without importing V1 state or commands.

| Viewport | V1 actual components | Candidate before | Revised V2 |
| --- | --- | --- | --- |
| 1360×1000 | [V1 desktop](active-set-evidence/v1-patterns-desktop.png) | [Before desktop](active-set-evidence/before-desktop.png) | [After desktop](active-set-evidence/after-desktop.png) |
| 390×844 | [V1 mobile](active-set-evidence/v1-patterns-mobile.png) | [Before mobile](active-set-evidence/before-mobile.png) | [After mobile](active-set-evidence/after-mobile.png) |

Images were visually inspected, not accepted solely from tests. Before images are copied unchanged from the candidate's source-bound handoff evidence. V1/revised images are full-page captures at the listed viewport sizes; before images are viewport captures. V1's fixture has one representative queue row, while the real V2 scenario has five exercises. Revised V2 has one editor, followed by a useful queue; no repeated editable forms or dominant history lists remain. Current exercise/set is visible immediately. Unit selection and load meaning are explicit, and the unanimous saved unit hint removes repeated setup. No sticky element covers input/actions.

Remaining visual differences are deliberate: RIR rather than RPE, a unit selector and explicit load convention, inline collapsible history rather than V1's sheet, always-visible set chips, teal primary action and no Skip Set/timer. V2's labels/history and disposable-demo banner make its mobile card taller than the stripped V1 fixture; reaching Log set can require a short scroll, but never scrolling through other set forms. [390×500 keyboard-height emulation](active-set-evidence/keyboard-height-emulation.png) checks scrolling and overflow, not a physical mobile keyboard.

## Selection, input and recovery

Canonical details: [TRAINING_UI.md](../../docs/architecture/trainer2/TRAINING_UI.md#active-set-logging).

- Account/execution-scoped retained selection names the execution-owned target UUID. Invalid/missing selection chooses the first unrecorded target in immutable saved order. Exercise selection chooses its first unrecorded set, otherwise its first recorded set. Duplicate labels are never identifiers.
- Each identity-keyed result controller stays mounted but renders nothing when inactive. Draft/base/pending envelope remain in existing account/execution/target sessionStorage. Switching selection preserves them; queue dots locate unresolved input. Finish remains blocked until explicit save, discard or exact recovery.
- Only matching accepted response plus authoritative readback clears a draft. Non-cleared readback at the accepted version advances to the next unrecorded set after the saved target, wrapping to earlier unrecorded work. Both target identity and selection generation must still match submission time. A newer known result version prevents stale advancement. Clear, validation failure, uncertain response or unrelated response never advances.
- All-recorded state says Ready to finish; it does not finish automatically. Progress counts only non-null current results. Partial finish never fills missing results or manufactures skips.
- Numeric reps/load/RIR begin blank. Authored prescription supplies semantic defaults, including unit/rep basis/load convention/zero meaning; saved catalog metadata supplies missing load semantics. The existing unanimous current-workout unit hint is used only when authored unit is absent. Existing drafts always win. No historical amount, prior-set numeric value, progression recommendation or RIR is carried forward.
- Direct numeric entry remains available: reps ±1, kg ±2.5, lb ±5, clamped at zero. Unitless numeric loads cannot be stepped. Quick choices are **0, 1, 2, 3 RIR**; direct entry supports 0–10 and blank unspecified. No RPE conversion occurs. Bodyweight, external, added and assistance loads, zero, unspecified values, total/per-side/alternating reps remain supported.
- Previous summary is explicitly exercise-level: one previous result and a count of additional history results. History retains source workout/date and latest corrections without inventing corresponding previous-set identity. Opening/closing it preserves selection/input.
- Existing in-flight lock, exact retry, expected-version conflict and explicit review/rebase/save remain authoritative. Recovery refresh is below Finish. Finished/discarded pages expose no Open active-set editor; existing historical correction remains separate.

## Verification and qualifications

| Check | Result/evidence |
| --- | --- |
| Actual browser + PostgreSQL journey | [browser.json](active-set-evidence/browser.json), [runner](verify-active-set.ts): successive saves/cross-exercise advancement, out-of-order drafts, reload, correction, clear/re-record, zeros, held late response, lost committed response with byte-exact retry and one history row, two-tab equal-value newer-version conflict/recovery, partial acknowledged finish and all-recorded finish. Confirmed home navigation only after finish readback. |
| Independent controls | [controls.json](active-set-evidence/controls.json), [runner](verify-active-controls.ts): duplicate exercise names, saved independent order, differing set reps/RIR, kg/lb, zero/bodyweight, assistance per-side, added-load/alternating correction, absent authored-description history and completed readback. Existing matcher tests cover ambiguous previous identities. |
| Application restart | [restart.json](active-set-evidence/restart.json): restarted verification app against its same PostgreSQL; all three exercised execution readbacks compared deeply equal. Browser midway reload was separately exercised. |
| Final demo/browser smoke | [demo-final.json](active-set-evidence/demo-final.json), [runner](inspect-active-demo.ts): final runtime source, desktop/mobile, Program/home, one editor, history/input preservation, numeric keyboards, reduced-height scrolling, finish guard, empty discard, terminal readback and Week 2 Lower A ready. No page/console errors. |
| Focused affected tests | [focused-final.log](active-set-evidence/focused-final.log): 7 files / 73 tests passed, including integrated Workout key uniqueness and delayed responses after selection changes away/back. |
| TypeScript / full lint | [TypeScript](active-set-evidence/typescript-final.log), [lint](active-set-evidence/lint-final.log): passed. |
| Fast / contracts / preflight | [fast](active-set-evidence/fast.log): 86 passed; [contracts](active-set-evidence/contracts.log) aligned; [preflight](active-set-evidence/test-preflight.log) passed without hosted credentials. |
| Environment / inventory controls | [environment](active-set-evidence/environment.log): 212 passed / one platform skip. No Vitest files were added, so inventory remains unchanged. |
| Repository policy / registry / doctor | [policy](active-set-evidence/policy.json), [registry](active-set-evidence/registry.json), [doctor](active-set-evidence/doctor.json). Policy excludes its conservative release aggregate from local run mode; no full credential-free release inventory was rerun. |

Browser/control receipts contain the source manifests at their runs. Deep journeys preceded final layout tightening and conservative newer-read advancement protection; final focused tests and demo smoke bind those final runtime changes. FINAL_BINDING records exact deltas rather than calling earlier journeys exact final-tree runs. Unchanged domain transaction/race behavior reuses candidate and earlier accepted evidence. Evidence logs/screenshots/receipts are local ignored artifacts; handoff and reproducible runners are committed.

Development failures were resolved: JSX integration typo, duplicate sibling React key (caught in actual browser and now regression-tested), fixture/locator issues, and test-fixture typing. A premature second launcher was refused by Next's worktree lock and cleaned its own DB; it did not disturb either original demo. Preflight reported this already-created worktree/branch as occupied; exact clean coordinates had already been verified. Doctor's primary-checkout dependency warning is inapplicable to the actual dependency donor: this worktree uses the candidate's installed dependency junction with unchanged package/lockfile bytes, never a fetched/global substitute. No domain regression, hosted repair or independent acceptance was inferred.

## Live demo, restart and cleanup

The separate evaluation demo is container `trainer2-draft-b7f1c3d0a458`, PostgreSQL loopback port **59981**, app port **37847**, launcher session **93992**. It contains only synthetic Week 1 completions, one historical correction, Week 2 Lower A ready, and an empty inspection attempt truthfully discarded. No Week 2 result or skip was created in this evaluation database.

**Application-only restart:** type `r` then Enter in the running launcher terminal. Database, URL and saved results remain. Reloading/closing browser tabs preserves server data; unsaved drafts are same-tab sessionStorage, not cross-device backups.

**Full shutdown:** Enter alone or Ctrl+C stops the launcher and deletes its disposable database. Exact fresh-start commands:

```powershell
Set-Location 'C:\Users\aabloch\claude\vibe-coding\.worktrees\trainer\trainer2-active-set-ui\trainer-app'
node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable
```

Keep that terminal open. In a second terminal, same directory, substitute the newly printed port:

```powershell
node node_modules/tsx/dist/cli.mjs artifacts/trainer2/prepare-active-demo.ts http://127.0.0.1:NEW_PORT --confirm-synthetic-trial
```

The command prints the fresh prepared URL with new IDs/timestamps. Use a fresh demo, not an existing active plan. Docker, the already installed postgres:17-alpine image and lockfile dependencies are prerequisites. Preparation recreates synthetic data; it cannot restore later evaluation actions.

Task-owned verification app/database were stopped/deleted through their launcher; failed second-launch resources also cleaned. The separate evaluation demo stays running. Original candidate demo at 33947/container `trainer2-draft-312fe2dc5550` and original trial at 37020/container `trainer2-draft-474db3c25bd8`, all worktrees and their evidence/data remain intact.

No hosted access, real data, imports, push, merge, deployment, spending, admission change or V1 behavior change. Skip Set, finishers, timers, Pause/Resume, Undo Finish and undo-skip remain outside scope.
