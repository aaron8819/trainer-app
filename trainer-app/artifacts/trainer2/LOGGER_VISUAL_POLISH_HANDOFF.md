# Trainer2 logger visual polish — local handoff

[Open the separate evaluation demo](http://127.0.0.1:32817/trainer2/dev/drafts?planId=c8f71925-ed70-4828-a9dc-416fb1323665).

## Source and scope

- Branch: `codex/trainer2-logger-visual-polish`.
- Worktree: `C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-logger-visual-polish`.
- Exact base commit: `15783474ca21457a171451742d594dd6e1c77698`; tree: `b2710cbc5b9f46ede81c2c0f5592ab7f24d84873`.
- Base logging-polish handoff/FINAL_BINDING matched Git; tracked/untracked state was clean. Its parent is active-set commit `9f9d3587`, whose parent is the supplied older `e84f9a5e`. Existing worktrees, demos and evidence were preserved.
- Exact final commit/tree and clean status are in [FINAL_BINDING.json](visual-evidence/FINAL_BINDING.json), written after the local commit to avoid a self-referential hash.
- No schema, command, acceptance, admission, planner, prescription, history-selection, V1 handler, package/lockfile, hosted access, push, merge or deployment changes. Existing local dependencies are reused through a junction.

## Changes and ownership

`SetResultRow` retains all suggestion/draft/retry/correction logic and now matches V1's actual `WorkoutActiveSetCard` control order: full-width reps between circular steppers; weight label, left-aligned ±5/±1/Clear controls, then full-width input; RIR presets above direct input; compact rounded green Log set/Update set. Nested gray panel padding is removed and focus states/input heights are consistent.

`ActiveWorkout` adds a recorded-set edit banner and Return to active set, retaining both sets' unsaved input. History becomes an aligned table with workout/date/source link, visibly missing values, load convention and rep basis. Original units are optional; duplicate converted-weight prose and technical comparison copy are removed. Previous rows enumerate available results in saved set order; the unchanged read model does not expose original ordinals when comparison results are excluded. Rows never claim current-set correspondence.

`RestBar` exposes accessible circular ±30-second controls beside the countdown and retains dismissal. Deadline/event logic, 180/120-second defaults, refresh/background behavior and nonblocking persistence are unchanged.

`MuscleTags` uses a bounded display-only map for all 48 version-1 catalog IDs. Provenance: `prisma/exercises_comprehensive.json` at the base commit; each `t2:` ID matched a unique V1 `catalogKey`, with names verified offline. Primary/secondary words and distinct styling make the distinction independent of color. Custom descriptions, unknown IDs and other versions get no tags. Saved exercise identities are unchanged.

## First-set investigation

The old demo's actual saved revision `a2c91dc9-aa52-4d7f-9bb1-49c3121efcde` has **null measurement on all three Week 2 squat targets** ([read-only evidence](visual-evidence/original-demo-prescription.json)). Historical performed weights were never authored starting loads. The empty first-set field was correct for that demo, not a remaining conversion defect.

Trace: the builder authors `targets[].measurement`; draft creation stores the validated document; `activeSource` reads/hash-validates the approved revision; `startOccurrence` copies the occurrence into immutable `initialPrescription`; `readExecution` validates/returns it; `ActiveWorkout` passes the source target; `SetResultRow.initialForm` converts explicit mass through `pounds`. These owners were inspected; no competing load source was introduced.

The new demo authors **60.00 kg through the existing builder before save/activation**. [Demo verification](visual-evidence/demo-final.json) compares the saved occurrence with the immutable execution snapshot and verifies **132.28 lb** in the input and starting target. Its second exercise has a null prescribed measurement and a blank weight field. Saved prescription bytes remain unchanged. Ranged reps remain blank, optional zero RIR stays valid, and prior-workout performance is never substituted for a prescription. No runtime prefill-policy change was needed.

## Visual and behavioral evidence

Inspected actual V1 source and source-bound fixtures at matching 1360×1000 and 390×844 viewports. The supplied attachment contained the request text only, so no separately attached screenshots were available. V1 references: [desktop](visual-evidence/v1-desktop.png), [mobile](visual-evidence/v1-mobile.png), copied unchanged from the active-set worktree.

| State | Screenshots / result |
| --- | --- |
| Prescribed first set | [Desktop](visual-evidence/prescribed-desktop.png), [mobile](visual-evidence/prescribed-mobile.png) |
| Unspecified first set | [Mobile](visual-evidence/unspecified-mobile.png) |
| Following set and live timer controls | [Desktop](polish-evidence/desktop-rest.png), [mobile](polish-evidence/mobile-rest.png) |
| Expanded history | [Desktop](visual-evidence/history-desktop.png), [mobile](visual-evidence/history-mobile.png) |
| Recorded-set editing | [Desktop](visual-evidence/editing-desktop-replay.png), [mobile](visual-evidence/editing-mobile-replay.png) |
| Queue/muscle distinction | Visible in the captures above; no guessed labels on custom exercises |

Visual inspection confirmed V1's alignment/order, consistent full-width fields, compact circular controls, readable history columns and visible primary/secondary tags. Editing captures are explicitly labeled **source-component replay of the first real persisted record** from the PostgreSQL journey, with all API calls blocked; [replay receipt](visual-evidence/edit-replay.json) verifies Return to active set and retained edit input. Actual correction writes were separately verified in the live PostgreSQL journey.

- [Browser/PostgreSQL receipt](polish-evidence/browser.json), [log](visual-evidence/journey.log), [runner](verify-logger-visual-polish.ts): prescribed/absent mass, kg conversion, same-exercise carry-forward, duplicate identities, zero/optional RIR, correction/no-op/no conversion drift, exact retries/lost responses/stale edits, refresh/input preservation, 180/120-second deadlines, ±30/dismissal/background elapsed time, selection/focus/autoscroll, complete and acknowledged incomplete finish-to-home. No browser errors.
- [Demo inspection](visual-evidence/demo-final.json), [runner](inspect-visual-demo.ts): saved revision → immutable snapshot → readback → input equality; both prescribed/unspecified cases; history; no overflow at 320/390/1360px; visible form buttons at least 44px; retained typing on reload; original prescription and 56-set corrected history unchanged. The empty inspection attempt was truthfully discarded; Week 2 remains unrecorded and ready.
- [Focused tests](visual-evidence/focused-final.log): **7 files, 105 passed**, including new direct timer clamp/storage and Return-to-active input-preservation cases.
- [TypeScript](visual-evidence/typescript-final.log), [full lint](visual-evidence/lint-final.log), [contracts](visual-evidence/contracts.log), [preflight](visual-evidence/preflight.log): passed.
- [Repository policy](visual-evidence/policy-run.json): selected diff check passed; the conservative full aggregate is explicitly excluded from local implementation execution by repository policy. No full credential-free inventory rerun or independent-review pass is claimed. Earlier accepted domain evidence is reused for unchanged transaction/security owners.
- [Application restart](visual-evidence/restart.json): same next workout and deeply equal completed history after `r` restart.

Limitations: desktop Edge viewport emulation, not physical mobile/software-keyboard qualification. Existing clock/storage assumptions remain. Verification screenshots/logs/receipts are local ignored evidence; reproducible runners and this handoff are committed. Development-only failures were corrected: Windows text encoding, an overlapping Next dev lock, and a synthetic builder payload inconsistent with its defaults. Failed task-owned containers/services were removed; no user demo was altered.

## Demo and exact restart

Live app: **32817**. Container: `trainer2-draft-8c7287b06ff1`; PostgreSQL loopback **58441**. Launcher terminal session **30848**. Week 1 contains 56 synthetic recorded sets and a historical correction; Week 2 Lower A has an explicit 60 kg squat prescription, other unspecified loads, and previous exercise history. No Week 2 results were recorded by inspection.

**Disposable data only. Enter alone or Ctrl+C in the launcher stops it and deletes its database.** Browser reload and application-only restart preserve saved data; sessionStorage/localStorage conveniences are not cross-device backups.

Application-only restart: type `r`, then Enter in the running launcher. Same URL and database remain; this was verified.

Fresh recreation in an interactive terminal:

```powershell
Set-Location 'C:\Users\aabloch\claude\vibe-coding\.worktrees\trainer\trainer2-logger-visual-polish\trainer-app'
node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable
```

Keep it open. In a second terminal in that directory, substitute the printed port:

```powershell
node node_modules/tsx/dist/cli.mjs artifacts/trainer2/prepare-visual-demo.ts http://127.0.0.1:NEW_PORT --confirm-synthetic-trial
```

Preparation requires a fresh local synthetic demo and prints its new bookmark. It recreates sample data, not later evaluation actions. Docker, the installed `postgres:17-alpine` image and repository lockfile dependencies are prerequisites. Previous demos on 32470, 37847, 33947 and 37020 and all their data/evidence remain intact. Only this task's verification service on 39338 and failed setup services were cleaned up.
