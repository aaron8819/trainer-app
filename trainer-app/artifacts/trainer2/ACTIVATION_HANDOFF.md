# Trainer2 local activation handoff

Ready for focused independent review. This is implementation evidence, not independent acceptance. V1 remains live; hosting stays paused and Phase 0 remains incomplete.

## User-visible result

The user can build the populated five-week plan, save it, review the exact saved revision, activate it explicitly and reload its bookmark to see the authoritative Active plan and exact saved schedule. Independent workouts and mixed prescriptions remain supported. Unsaved changes require saving/reviewing first. Starting workouts, recording results, automatic progression, active-plan edits, pause/end and replacement remain later work.

Current contract and ownership: [ACTIVATION.md](../../docs/architecture/trainer2/ACTIVATION.md). The preimplementation contract and matrix are retained in [ACTIVATION_CONTRACT.md](ACTIVATION_CONTRACT.md).

## Coordinates and source binding

- Branch: `codex/trainer2-local-activation`.
- Verified accepted base branch: `codex/trainer2-progression-review-corrections`.
- Base commit: `5865cb9dec901d55a9c0afdad1ea397dd1b7347e`.
- Base tree: `489d23475a3a5a1c8da85a2b4cf50a1461610619`.
- Worktree: `C:/Users/aabloch/claude/vibe-coding/.worktrees/trainer/trainer2-local-activation`.
- Final commit/tree, exact source comparison and artifact hashes: [FINAL_BINDING.json](activation-evidence/FINAL_BINDING.json), written after the clean local commit to avoid a self-referential commit hash.
- Authoritative retained PostgreSQL/browser receipt: [verification.json](activation-evidence/verification.json). Its before/after source manifests are identical. The only later non-handoff source delta is registry metadata for the already accepted progression-review command, qualified separately by the registry test below. No runtime or test implementation changed after the final PostgreSQL/browser run.

The final evidence bundle is `artifacts/trainer2/activation-evidence/`. It is separate from the disposable launcher's overwriteable working receipt. The originating accepted review and ignored evidence were inspected read-only. Earlier builder/progression and Auth/principal assessments remain closed.

## Activation and persisted effects

`ActivatePlan` uses the existing immutable action envelope, exact expected PlanRevision and complete reviewed plan/instruction binding. Trusted account authority is the existing server principal/mapping, revalidated under the account lock. A browser success flag never authorizes activation.

The transaction reloads the exact current Draft, verifies ownership epoch and eligibility, recomputes saved validity and current exclusion applicability under supported policies, and checks Active/Paused exclusivity. It atomically records Active lifecycle, initial-approved/current revision semantics, one immutable PlanDecision, accepted sequence and durable outcome. The immutable saved document remains the only prescription/intent/order/identity source. No execution-start capture, workout, set or result is created.

The new migration adds lifecycle/approval fields, immutable instruction revisions and PlanDecisions, same-account foreign keys, approval/lifecycle checks, a partial unique Active/Paused index, immutable guards and deferred acceptance seals. It extends the accepted action-integrity validator for the new owners without editing historical migrations. The restricted runtime can append the new owned records; the read role cannot mutate them. Identity-reader scope and unconditional hosted admission denial remain intact. No V1 mutation privileges or runtime administrator credentials were added.

Instructions use the same command lock/outcome infrastructure with named AddRestriction, ClearRestriction and AddScopedException operations. Exclusions select exact catalog exercises with explicit account/plan scope and validity. Custom descriptions surface uncertainty. Exceptions name the current restriction revision, exact saved plan revision, selected positions, validity and reason. A later equal-valued plan revision invalidates the exception too. History and retired identities remain preserved.

## Behavior matrix

| Distinct path | Verification result |
| --- | --- |
| Populated template -> save -> review -> activate -> reload | PASS: real Edge/HTTP/PostgreSQL; all 20 workouts retain saved sequence and deload |
| Independent workouts, repeated-stage order and mixed sets | PASS: exact persisted document, decimal spelling, progression and stable identities unchanged |
| Missing/malformed binding or unsupported policy | PASS: schema rejection without activation or partial records |
| Account/plan/revision/review/instruction mismatch | PASS: stale/rejected request, no activation |
| Unsupported progression or saved readiness issues | PASS: unsupported save rejected; missing intent blocks activation; pure readiness regressions retained |
| Newer changed or equal-visible-value revision | PASS: both invalidate old activation; real browser stale-review recovery also covered |
| Wrong account and foreign plan/work references | PASS: no foreign read/activation/exception authority |
| Existing Active or Paused plan | PASS: actionable owned-plan conflict; direct SQL unique-index rejection; no replacement |
| Same command submitted concurrently | PASS: observed lock queue, one decision/outcome effect and one historical replay |
| Same action identity with changed payload | PASS: collision preserves original envelope/outcome |
| Lost response after commit | PASS: real server commit, response dropped, bookmark reload and byte-identical retry |
| Fresh command for already activated plan | PASS: explicit ALREADY_ACTIVATED conflict; no duplicate decision |
| Distinct same-plan and different-plan activation races | PASS: one accepted activation, valid durable losing outcome |
| Save vs activation in both orders | PASS: controlled PostgreSQL queues yield stale activation or rejected Draft edit |
| Stale editor/direct active mutation | PASS: handler rejects non-Draft; SQL guard freezes active state |
| Restriction wins activation race; exception changes | PASS: current epoch rechecked, exclusion blocks, exact exception permits, later equal-valued revision requires new exception |
| Transaction failure | PASS: injected decision failure leaves plan, revision/identity graph, action/outcome and counters unchanged; original command retries |
| Historical success vs current lifecycle | PASS: replay remains original success while a separate read returns synthetic Paused state |
| Unsaved edits and delayed plan-switch response | PASS: input retained; old success cannot change new screen/bookmark; consumer tests are explicitly mocked response probes |
| Malformed/uncertain activation response | PASS: cannot become active display; original request retained; separate current-state read required |
| Fresh install and accepted-base upgrade | PASS: full migration chain, eight populated historical tables preserved, repeated deploy no-op, restricted grants verified |
| Desktop/mobile presentation | PASS: final viewport/full-page screenshots inspected; no overflow or page errors |

The Paused prerequisite is an explicitly administrative synthetic fixture, not an implemented Pause command. Concurrency synchronization observes PostgreSQL blocking chains and releases a controller lock; it does not assume sleep timing. Database snapshots and durable-outcome assertions are separate from command helpers. Malformed browser outcomes are consumer probes; they are not claimed as genuine server output.

## Commands and evidence

From `trainer-app`, exact final app checks and exit receipts are in [qualified-check-receipts.json](activation-evidence/qualified-check-receipts.json):

- `node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-activation.ts --confirm-disposable` — PASS; [PostgreSQL/browser log](activation-evidence/activation-qualified-final.log), [receipt](activation-evidence/verification.json).
- `node node_modules/vitest/vitest.mjs run src/lib/engine/trainer2/ src/components/trainer2/ src/lib/api/trainer2/isolation.test.ts src/lib/api/trainer2/read-review.test.ts --maxWorkers=1 --testTimeout=20000` — 160 tests / 14 files passed.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false` — exit 0.
- `npm run lint` — exit 0, no warnings.
- `npm run test:fast` — 86 tests / 8 files passed.
- `npm run verify:contracts`, `npm run test:preflight`, `git diff --check` — exit 0.

Root `pwsh -NoProfile -File scripts/codex/tests/Run-Tests.ps1` passed 107/108 tests; the sole failure was the pre-existing missing progression-review registry entry. [Accepted-base reproduction](activation-evidence/registry-base.json) confirms the same failure. The metadata-only correction passed `Run-Tests.ps1 -Filter 'registry parses and covers committed command surfaces'` (1/1), and [final registry validation](activation-evidence/registry-final.json) passes. The other 107 unchanged checks were not repeated. The repository verification plan selected the fast/tooling gates and excluded release-class full inventory/migration/Finisher checks; no production build or closed historical assessment was restarted.

Dependencies are a task-owned standalone installation from `npm ci --offline`, with generated Prisma Client 7.3.0 and passing exact-lock preflight. Node is 24.12.0; PostgreSQL 17 and actual installed Edge are recorded in receipts. The final qualified browser run uses default Turbopack. Earlier junction-based evidence and failed development attempts remain separately retained; they are not the final environment qualification. Early failures included incomplete UI wiring, test identity/setup mistakes, cold-compile/default assertion timeouts, and dependency-layout qualification. Each was corrected before the final successful evidence.

Screenshots: [desktop Active](activation-evidence/activation-active-desktop-viewport.png), [mobile Active](activation-evidence/activation-active-mobile-viewport.png), [desktop review](activation-evidence/activation-review-desktop.png), and full saved schedules in the same folder. Desktop bottom padding was corrected after visual inspection so the fixed save bar cannot cover the activation action.

## Demo and service status

Retained, independently verified fresh demo: **http://127.0.0.1:40738/trainer2/dev/drafts**.

- Launcher PID: `47428`; task-owned PostgreSQL container: `trainer2-draft-02d023f91f9e`.
- The existing disposable launcher was started hidden with task-owned resources. READY, HTTP 200, populated UI, enabled Save, disabled pre-save Review, no page errors and mobile layout were verified. The smoke check performed zero mutations, so the demo has no active plan yet.
- [Service metadata](activation-evidence/demo-state.json) and [browser receipt](activation-evidence/demo-browser.json) identify this retained demo separately. Existing containers were preserved.
- **Disposable data:** plans are deleted when this demo stops. One Active/Paused plan is supported; another activation requires conclusion, which is outside this slice. Restarting the disposable demo provides a fresh account for another complete trial.
- Restart from this worktree's `trainer-app`: `node node_modules/tsx/dist/cli.mjs scripts/demo-trainer2-drafts.ts --confirm-disposable`. Wait for its new READY URL. In a foreground terminal, Enter/Ctrl+C invokes launcher cleanup. For the retained hidden instance, verify the recorded PID/creation time still identifies this launcher before terminating its process tree, and remove only its recorded task-owned container; never stop a different demo by port or broad name pattern.

All verification web processes and containers were cleaned up with successful cleanup receipts; the final development-server exit 1 is forced test-server shutdown, not an application failure. The demo above is the only deliberately retained service from this task. No push, merge, deployment, hosted setting change, real email, production data access, V1 import or V1 runtime edit occurred.

The next boundary is a separate explicit Start Occurrence command with execution capture, restrictions/open-execution concurrency and durable recovery. This activation work does not implement or authorize that boundary.
