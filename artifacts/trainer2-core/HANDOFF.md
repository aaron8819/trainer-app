# Trainer2 plan builder — local handoff

September 12, 2026. Implemented on `codex/trainer2-draft-editor`, continuing the existing uncommitted editor at base `18fa308d21d64d43381534e584c8ab184cca326e`. No reset, reconstruction, push, merge, deployment or production access. Phase 0 remains incomplete. The final local commit is the commit containing this handoff (`git log -1 --format=%H`); the completion message gives its exact hash.

## What works

Opening `/trainer2/dev/drafts` immediately shows an unsaved hypertrophy plan: five weeks, Lower A / Upper A / Lower B / Upper B in order, four training weeks and one deload. Add/replace/remove/reorder exercises, edit sets/reps/effort, optionally specify weight/rest/measurement details, inspect each week, save, reopen the bookmark and review actual saved prescriptions. Save is usable at desktop and 390px mobile width; V1 navigation is suppressed only on this demo route.

No authoritative exercise program/catalog is available in the accepted Trainer2 slice. The picker uses its supported authored-description source: names already entered in this plan plus a new-name input. It does not import legacy catalog authority or invent a personal exercise program. Newly added exercises start with three working sets of 8–12 reps and unspecified weight.

Template constants initialize once. Editable defaults then belong to the plan; they cannot be overwritten by a template on reload. The existing RIR field holds one value, so defaults are **3, 3, 2, 1, 4**, rather than the requested ranges. Rep ranges remain ranges. Deload retains exercises/reps and halves working sets rounded up, minimum one; effort defaults to four reps left. No automatic load/set increases or readiness claims are added.

Normal edits update linked workouts across weeks. A week-only edit makes that **whole workout in that week** independent; shared changes preserve it, including week 1. Restore previews what will be replaced and deliberately reapplies current shared defaults. Edit schedule supports workout reordering and weekly effort changes; five weeks/four workouts remains the only supported configuration. Existing non-template drafts reopen in the retained structural editor without inferred recurrence.

## Ownership and persistence

Planning owns initialization/expansion in `trainer-app/src/lib/engine/trainer2/plan-builder.ts`. The optional versioned builder value records plan-owned defaults, explicit correspondence keys and week overrides. Each expanded occurrence/position/target has its own executable identity. Domain validation rejects inconsistent non-overridden prescriptions. Existing identities survive edits and reordering; removed work receives new identities if later reintroduced.

CreateDraft saves the initial complete plan. EditDraft saves named operations through the existing expected-revision, owner-checked atomic transaction. The contract adds `editWorkoutDefaults`, `setWeekOverride`, and `editPositionTargets`; the bounded 1,000-operation batch accommodates up to 20 recipe exercises per workout and 20 sets per row. Target-list edits retain historical-ID and parent protections. Schema/migrations, authentication and admission are unchanged.

Uncertain responses freeze new mutations and Check again resends the exact envelope. Confirmed save plus failed read offers GET-only recovery. Stale conflicts retain a readable submitted plan and require reload plus deliberate continuation. Saved revisions remain immutable. Unsaved input/retry state is memory-only.

## Verification

- Real PostgreSQL 17 + installed Edge: **PASS**, [source-qualified receipt](builder-browser-final.json). Includes existing identity/owner/role/immutable graph, rollback, replay, stale conflict, cursor and migration-upgrade protections; five-week form authoring, overrides, deload, saved round trips, mobile operation and five immutable revisions.
- Actual interactive demo command plus complete browser scenario: **PASS**, [browser receipt](manual-demo-browser.json), [stop/cleanup receipt](builder-demo-final.json). Verified startup announces setup, then READY, the full URL and deletion warning. Enter stopped the server and removed its own synthetic database.
- Focused domain/editor/navigation/isolation: **33 passed**, [receipt](builder-focused-final.json). Final readable-review changes: **7 component tests passed**, [receipt](builder-final-components.json).
- TypeScript and affected-file ESLint: see [final type receipt](builder-final-types.json) and [final lint receipt](builder-final-lint.json).
- Selected fast suite: **86 passed**; environment classification: **212 passed, 1 Windows skip**; tooling: **108 passed**; command registry: **PASS**. Receipts are adjacent to this handoff.
- [Repository-selected verification plan](builder-verification-plan.json): generic `npm run verify` is explicitly ineligible in local implementation mode. Full credential-free/release inventory and production build were not rerun; no hosted/release qualification is claimed.

The SQL/browser receipt precedes final review wording/mixed-set explanation, documentation, trailing-newline cleanup and two stricter validations rejecting unsupported deload layouts or inconsistent workout order. The latter are covered by the final domain/command/component regression run (`builder-contract-final.json`); they add no supported schedule or persistence path. The final actual-demo browser run and component/type/lint checks cover the later UI changes. Tooling execution overlapped UI/documentation edits; its tooling/policy inputs were unchanged. Earlier development attempts are not passing evidence: initial mobile navigation covered Save, the first unbounded browser attempt was stopped with only its task processes/container cleaned up, and a manual review probe initially toggled an already-open review closed. Both UI and bounded probe were corrected before the passing runs.

Screenshots were opened and visually inspected after correction:

- [Initial default plan](../../trainer-app/artifacts/trainer2/initial-plan.png)
- [Populated workout](../../trainer-app/artifacts/trainer2/populated-workout.png)
- [Five weeks including deload](../../trainer-app/artifacts/trainer2/five-weeks.png)
- [390px editor](../../trainer-app/artifacts/trainer2/mobile-editor.png)

Generated screenshots/receipts are retained locally and ignored by Git. The earlier editor handoff is retained as `prior-editor-handoff.md` beside these artifacts.

## Restart the demo

In an interactive PowerShell terminal:

```powershell
Set-Location 'C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-draft-editor/trainer-app'
node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable
```

Prerequisites: installed local dependencies, Docker running, installed `postgres:17-alpine`, and no development dotenv files. No package/browser download is needed.

Wait for **READY — Trainer plan builder**. The next line is the exact clickable `http://127.0.0.1:<port>/trainer2/dev/drafts` URL. The verified run used port 36035; each restart chooses a new port. Keep the terminal open. Enter/Ctrl+C stops the demo and deletes its synthetic plans; bookmarks last only for that run. **The verification demo has been stopped.**

Local plan editing only. Activation, logging, hosted Preview, deployment, real login work and cutover remain outside this slice. V1 remains the live training authority.
