# Trainer2 training interface — local handoff

## Try the prepared demo

**[Open Training — Week 2 Lower A](http://127.0.0.1:33947/trainer2/dev/drafts?planId=fba9c36f-1e25-41cb-ad20-f3eabc5546e6)**

Ready for hands-on evaluation and focused review of the changed UI/read flows. This is implementation verification, not independent acceptance or hosted/real-training readiness.

- Branch: `codex/trainer2-training-ui`.
- Accepted base: `codex/trainer2-skip-workout`, commit `28e64e6057fcc432e7fca02e0de7629f013d287d`, tree `58d912d54e4ece5c84c8ed5231deba11265d3da9`. All three coordinates verified before worktree creation.
- Worktree: `C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-training-ui`.
- Final commit/tree, source manifest comparisons, artifact hashes and verification qualifications: [FINAL_BINDING.json](training-ui-evidence/FINAL_BINDING.json), produced after the clean local commit.
- Original usability trial remains at port 37020, container `trainer2-draft-474db3c25bd8`. Its source, data, demo and original evidence were not changed. Services were inspected locally; no hosted provider was contacted.

## Feedback → implementation map

| Friction | Changed surface |
| --- | --- |
| Activated plan looks like a builder; disabled Save footer | `DraftWorkbench` renders a separate training shell for Active/Completed plans. Draft authoring/review/activation remains available. |
| Week, phase, effort and weekly status hard to find | `TrainingOverview` shows saved program position, saved-metadata phase, target RIR summary and compact status cards. Finished and skipped counts stay separate. |
| Repeated prescriptions and missing load/rest filler | `PlannedWorkout` / `training-summary` collapse only identical consecutive target meanings. Different units, per-side counts, classification, requiredness, rest and effort remain distinct. |
| Full schedule overwhelms home | Dedicated bookmarkable Program view (`&view=program`) groups all saved weeks and links completed occurrence UUIDs to their execution results. Browsing is read-only. |
| Large forms and repeated technical setup | `SetResultRow` exposes compact load/reps/optional RIR controls, numeric input modes and explicit record actions. Options retain all supported measurement choices. No automatic result writes. |
| No previous performance | Execution GET gains account-scoped compatible exercise summaries through `readExecutionWithPrevious`, retaining source date/workout and latest corrected results. |
| Duplicate-name skip confirmation | Frozen confirmation now includes stage/week and unique workout ordinal within the saved program. Command binding is unchanged. |
| Finish immediately offers another workout | Confirmed finish/readback invokes navigation to Training. Home verifies a success marker against Finished status, refreshes weekly status and offers results access. Completed execution pages no longer embed the next-workout launcher. |

Canonical owners: existing Planning resolution/next reads, existing Execution & Evidence commands, and the new read-only execution enrichment. Presentation owns grouping and labels. No schema, migration, grants, planner, accepted seed, V1 handler, auth/admission or progression owner changed. Start/skip/set/correction/finish/discard command bodies and accepted lifecycle rules remain the existing authority.

Read the blueprint, relevant UI/result/finish/history contracts, accepted Skip handoff/review and usability worksheet. Earlier reviews remain closed. Architecture-guard guided ownership; Next.js/React guidance supported component work. Browser skills used repository-local Playwright and installed Edge because optional agent-browser was unavailable. No replacement package was fetched.

## V1 inspection and interaction comparison

Inspected actual `WorkoutActiveSetCard`, `ExerciseSetChipsEditor`, `ActiveSetPanel`, `WorkoutFooter`, logging types and rest-timer source. Rendered the actual V1 active card/chips with synthetic props and inert handlers: [V1 mobile fixture](training-ui-evidence/v1-patterns-mobile.png). No V1 account resolution, history query or mutation handler ran.

Adapted exercise/target hierarchy, compact numeric entry, explicit logging, touch controls, saved-state feedback and clear mobile spacing. Kept Trainer2's result units and RIR, immutable start capture, explicit corrections, version checks and delivery state. V1's heavier stateful logger was not imported.

[Measured two-set fixture](training-ui-evidence/interaction-counts.json): accepted-base Trainer2 **12 interactions**, new Trainer2 **10** to record two 70 kg × 8 sets with actual RIR 2, initially without a known current-workout unit. A click, fill or select is one interaction; keystrokes, scrolling, navigation and time are excluded. First set requires explicit unit selection; the second can reuse that known current-workout unit. This is a reproducible synthetic task count, not a user-study speed claim. [Fixture runner](inspect-logging-patterns.ts) uses synthetic transport only.

## Previous performance and rest

Exact rules and limitations: [TRAINING_UI.md](../../docs/architecture/trainer2/TRAINING_UI.md).

History matches a stable catalog identity/version plus its full snapshot, including variation/measurement semantics. It requires compatible specified reps and load, respects authored units until current actual measurements supply more specific context, performs no conversion, and labels each actual unit. Known current actual units/load types/rep bases constrain comparison, including partial results. Custom descriptions and ambiguous duplicate appearances are omitted. Candidates are the account's finished executions before this execution started, newest finish first. Current execution, discarded attempts, skips and cleared results are excluded. Existing readers supply the latest corrections. Summaries describe an exercise, not inferred one-to-one target correspondence; historical amounts are never prefilled or recommended.

Limitations: conservative full-snapshot matching can omit renamed snapshots; partially incompatible candidate results are filtered; unmatched large histories can cause multiple validation queries. A missing match shows a brief empty state. No history-import or progression algorithm was added.

V1 has a timer; Trainer2 does not. Authored rest remains visible where present, and missing-rest filler is removed. No activated target or starting snapshot gains invented defaults. A separate timer slice should use authored rest first, then clearly labeled **3 minutes for Main lift / 2 minutes otherwise**.

## Screenshots

- [Training desktop](training-ui-evidence/demo-final-desktop.png) · [Training mobile](training-ui-evidence/demo-final-mobile.png)
- [Program](training-ui-evidence/program-desktop.png)
- [Logging desktop](training-ui-evidence/logging-final-desktop.png) · [Logging mobile](training-ui-evidence/logging-final-mobile.png)
- [Post-finish home](training-ui-evidence/post-finish-mobile.png)
- [Mixed independent prescriptions](training-ui-evidence/independent-mixed.png) · [Duplicate confirmation](training-ui-evidence/duplicate-confirmation.png) · [Final completion](training-ui-evidence/final-completion.png)

Inspected desktop and 390×844 mobile viewport emulation in Edge 153.0.4234.32. No physical device or actual soft-keyboard behavior is claimed. Verified numeric/decimal input modes, 44px input height, select-on-focus, scrolling, no horizontal overflow and absence of the active builder footer. Long workouts still require vertical scrolling; there is no active-set auto-advance or rest timer.

## Verification

Real task-owned PostgreSQL 17 and actual Edge were exercised through existing commands/authorized read routes. No direct domain-table seeding or production/legacy handler use. Setup created the default five-week plan, completed Week 1 with varied results and corrected its first squat result historically. Browser test accounts/data are synthetic.

| Check | Evidence/result |
| --- | --- |
| Home → Program/results → Start → record/correct/clear/re-record → finish → home → skip | [browser.json](training-ui-evidence/browser.json), [final log](training-ui-evidence/browser-final.log): passed. Lost committed record and finish responses retried exactly; finish did not navigate before readback. Starting prescription compared unchanged. |
| Two-tab stale edits | Real browser conflict retained input and original version; explicit latest-review/rebase/save required. |
| Independent/mixed/measurement controls | [controls.json](training-ui-evidence/controls.json): kg/lb, external zero, bodyweight zero reps, assistance zero, per-side reps, optional actual RIR, differing set RIR/units, no-history/custom identity, duplicate names, final completion all passed. |
| Actual-versus-prescribed unit control | [history-context.json](training-ui-evidence/history-context.json): a historical correction to lb on the separate synthetic control plan removes prior kg comparisons while preserving initial intent, finish evidence and evaluation-plan position. [Final read-only confirmation](training-ui-evidence/history-context-final-read.json) binds the final matcher. |
| Navigation and discarded attempts | Pending input survives leaving and returning. Explicit Discard input required before discard. Discarded attempts are absent from current work and their bookmarks remain readable. |
| Application restart/bookmark reload | [restart.json](training-ui-evidence/restart.json): application restarted on the same port/database; next read, completed histories/corrections/captures and discarded attempt compare equal. Reopened plan/completed/discarded bookmarks. |
| Focused UI/read/HTTP tests | 7 files, **93 passed**: [focused-final.log](training-ui-evidence/focused-final.log). Includes late/mismatched replies, uncertain mutations, stale finish, target aggregation, truthful counts, compatible-history matching and account/cutoff query scope. After the final partial-actual-context refinement, the affected 2 files / 28 tests passed again: [history-focused-final.log](training-ui-evidence/history-focused-final.log). |
| Access/isolation; V1 navigation | [isolation-navigation.log](training-ui-evidence/isolation-navigation.log), [v1-navigation.log](training-ui-evidence/v1-navigation.log). Passed; no V1 source changes. |
| TypeScript / full lint | Passed: [TypeScript](training-ui-evidence/typescript-final.log), [lint](training-ui-evidence/lint-final.log). |
| Fast tests / contracts | 8 files, **86 passed**; doc/runtime contracts aligned. [fast](training-ui-evidence/fast.log), [contracts](training-ui-evidence/contracts.log). |
| Environment/inventory controls | Initial run: 211 passed, one Windows skip and one subprocess failure (null exit status). The exact failing identity and two sibling controls passed unchanged on isolated retry: [initial](training-ui-evidence/environment.log), [retry](training-ui-evidence/environment-retry.log). This is qualified combined evidence, not a single all-green run or a baseline-failure claim. |
| Registry / doctor / preflight / policy / whitespace | Passed; [registry](training-ui-evidence/registry.json), [doctor](training-ui-evidence/doctor.json), [preflight](training-ui-evidence/preflight.log), [policy](training-ui-evidence/policy.json). Registry remains 133 commands / 84 package scripts. Vitest file inventory and routes are unchanged. |

Policy proposes conservative fallback checks for unmatched Trainer2 UI paths; it excludes the release aggregate from local execution. No full credential-free inventory, production build, deployment/migration gate or renewed historical acceptance review was run. Existing accepted lifecycle evidence is reused for unchanged transaction/SQL/race internals. Source manifests are in browser/control/restart receipts; final binding documents exact later deltas and log hashes rather than treating every earlier receipt as an exact final-tree run.

Development evidence is retained: updated legacy UI expectations; synthetic browser locator ambiguity; re-record fixture needing explicit unit selection after clearing; a 5-second initial page-load timeout that passed at the bounded 20-second readiness wait; TypeScript fixes confined to test/fixture typing; and the environment subprocess failure/retry. No domain defect or production data repair was inferred from these failures.

## Demo lifetime and exact restart

The running evaluation service uses container `trainer2-draft-312fe2dc5550`, loopback DB port **56607**, app port **33947**. The prepared plan has 56 Week 1 results, one historical correction, Week 2 Lower A ready, no open execution, no Week 2 result and no skips. One empty Week 2 inspection attempt remains truthfully discarded. Other verification plans in this disposable DB are separate completed synthetic plans.

**Application-only restart:** in its running launcher terminal, type `r` then Enter. It keeps the same database, URL and data. This path was verified. Browser reload/closing tabs also preserves data.

**Full shutdown:** Enter alone or Ctrl+C stops this launcher and deletes its database/data. To start fresh:

```powershell
Set-Location 'C:\Users\aabloch\claude\vibe-coding\.worktrees\trainer\trainer2-training-ui\trainer-app'
node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable
```

Keep that launcher running. In a second terminal, same directory, use its newly printed loopback origin:

```powershell
node node_modules/tsx/dist/cli.mjs artifacts/trainer2/prepare-training-ui.ts http://127.0.0.1:NEW_PORT --confirm-synthetic-trial
```

The command prints a fresh prepared plan URL. It recreates the scenario with new IDs/timestamps; it does not restore later evaluation actions. Run it against a fresh task demo, not the original trial or an existing active user plan. Docker, the installed `postgres:17-alpine` image and installed lockfile dependencies are required. No hosted login is needed.

## Deferred and review boundary

Add a finisher after completion remains a separate feature requirement—no inert button, reopening or new lifecycle. Pause/Resume, Undo Finish, undo-skip, progression algorithms, full offline recovery and physical-mobile qualification remain deferred. Large-history query cost, long-workout scrolling and the absent rest timer are known usability/implementation limits.

No hosted access, production imports/data, push, merge, deployment, spending or admission change. Original trial/demo/evidence preserved. Stop ready for user evaluation and focused review of this UI/read-model diff.
