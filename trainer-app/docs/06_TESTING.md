# 06 Testing

Owner: Aaron
Last reviewed: 2026-04-12
Purpose: Canonical testing reference for Vitest-based coverage of engine, API helpers, and UI components, plus the Playwright UI audit harness.

This doc covers:
- Test runner configuration
- Standard test commands
- Contract drift checks included in verification

Invariants:
- `npm test` must run `vitest run` (non-watch).
- API/engine contract changes must include tests or updated assertions.
- Contract drift check must pass when enum contracts change.

Sources of truth:
- `trainer-app/package.json`
- `trainer-app/vitest.config.ts`
- `trainer-app/src/**/*.test.ts`
- `trainer-app/src/**/*.test.tsx`
- `trainer-app/scripts/check-doc-runtime-contracts.ts`

## Commands
- `npm test`: full Vitest run
- `npm run test:seed-revision-concurrency -- --confirm-disposable`: against a local disposable PostgreSQL database, verifies one-winner concurrent correction, generation/correction revision preservation, and full rollback after a failed correction. The command refuses non-local or unconfirmed targets.
- `npm run test:db:workout-mutations`: creates disposable PostgreSQL 16 from the checked-in migration chain, then verifies main-save CAS, runtime mutation races, exact stimulus snapshot persistence, and immutable review-snapshot storage without `db push` or `.env.local`.
- `npm run test:db:historical-snapshots`: explicit schema-dependent historical-evidence alias for the same consolidated disposable harness.
- `npm run test:db:readiness-snapshots`: starts an isolated Docker PostgreSQL 16 container, applies all checked-in migrations without reading `.env.local`, verifies legacy-unknown migration behavior, partial unique enforcement, identical concurrent activation, conflicting payload rejection, forced replacement rollback, stale-evidence rejection, and owner isolation, then removes the container.
- Immutable seed changes require focused revision/receipt/save/runtime/audit tests, `npm run verify:contracts`, `npm run verify`, and a real `prisma migrate deploy` on disposable PostgreSQL.
- `npm run lint`: ESLint with cache at `.eslintcache`; generated/local-only outputs such as `artifacts/`, `.tmp/`, `.vercel/`, `output/`, `playwright-report/`, and `test-results/` are ignored by ESLint
- `npm run test:ui-audit`: Playwright core-route UI audit plus lightweight fixture-backed interaction checks against mobile and desktop projects
- `npm run test:ui-audit:update`: update Playwright baseline screenshots after an intentional visual/UI baseline change
- `npm run test:watch`: watch mode
- `npm run test:fast`: focused fast subset
- `npm run test:slow`: slow simulation suite opt-in
- `npm run test:audit:matrix`: workout-audit diagnostics matrix regression sweep across canonical `future-week` flows (`derived next-session context` + `explicit intent`)
- `npm run test -- src/lib/audit/workout-audit/bundle.test.ts`: focused split-sanity audit summary/verdict coverage
- `npm run test -- src/lib/audit/workout-audit/scenario-audits.test.ts`: focused sequencing/accounting audit coverage
- `npm run test -- src/lib/audit/workout-audit/week-close-handoff.test.ts`: focused week-close handoff and historical mixed-contract detector coverage
- `npm run verify`: lint + type-check (`tsc --noEmit`) + `test:fast` + contract verification
- `npm run verify:completed-review`: canonical DTO/loader + immediate API/component + shared card + reopened workout-page matrix; this is included in `npm run verify`
- `npm run verify:contracts`: docs/runtime enum drift check
- Owner-scoped audit commands accept `--env-file .env.local --owner owner@local` so local audit scripts can load the intended runtime environment explicitly

## Scope
- Engine tests: `src/lib/engine/**/*.test.ts`
- API helper tests: `src/lib/api/**/*.test.ts`
- UI tests: component tests under `src/components/**`
- Playwright UI audit tests: `tests/ui-audit/**/*.spec.ts`, with flat baseline screenshots named `<route>.<viewport>.<state>.png` under `tests/ui-audit/__screenshots__/`; the same harness also includes minimal fixture-backed interaction checks for the log screen and swap sheet.
- Workout log UI regressions are covered in `src/components/LogWorkoutClient.test.tsx`, including all-skipped completion routing, timer resume/remount behavior, queue-chip targeting, queue-row scroll neutrality, skipped terminal state copy/actions, and reduced mobile edit-state chrome.
- Timer/session-layout hook coverage lives in `src/components/log-workout/useRestTimerState.test.tsx` and `src/components/log-workout/useWorkoutSessionLayout.test.tsx`, covering visibility-return timer re-sync and explicit-only scroll correction.
- UI session summary-model coverage: `src/lib/ui/session-summary.test.ts` (receipt-first summary text/tags/items, including deload, soreness hold, and readiness-scaling cases).
- Mutation-aware summary truth-label coverage: `src/lib/ui/session-summary.test.ts` also asserts that drifted workouts are relabeled as `Original plan context` and expose a truth-boundary note.
- Save-route terminal transition coverage (including status-machine behavior through route boundary): `src/app/api/workouts/save/route.integration.test.ts`
- Validation/status coverage: `src/lib/validation.workout-save.test.ts`, `src/lib/validation.test.ts`, `src/lib/api/exercise-history.test.ts`, `src/lib/api/readiness.test.ts`
- Exercise-history coverage: `src/lib/api/exercise-history.test.ts` protects exact-ID performed-work qualification, lifetime records outside the recent display limit, incomplete-exposure context, deload exclusion, and bodyweight/assistance suppression; `src/app/api/exercises/[id]/history/route.test.ts` protects owner-scoped delegation and bounds; `src/components/library/PersonalHistorySection.test.tsx` protects the shared history presentation and non-blocking error state; `src/components/LogWorkoutClient.test.tsx` protects one-tap access from the active log card.
- Performed-history progression coverage: `src/lib/engine/apply-loads.correctness.test.ts` and `src/lib/engine/history.test.ts` (includes `PARTIAL` and malformed legacy-status handling; also covers uniform main-lift working loads, representative working-set anchoring, accumulation-anchored scheduled deload load-down with canonical fallback/history exclusion, and bodyweight early-exit behavior).
- Load calibration coverage: `src/lib/engine/load-calibration.test.ts`, `src/lib/engine/apply-loads.correctness.test.ts`, `src/lib/api/workout-context.test.ts`, `src/lib/api/template-session/finalize-session.test.ts`, `src/lib/progression/canonical-progression-input.test.ts`, and `src/lib/audit/workout-audit/progression-anchor.test.ts` cover equipment reliability tiers, mixed cable/machine resolution, estimate-only scaling, early-exposure confidence scaling, and the separate runtime-added exact same-exercise calibration lane.
- Double-progression decision coverage: `src/lib/engine/progression.correctness.test.ts` (covers `computeDoubleProgressionDecision` paths, bodyweight rep-only progression, high-variance trimming, confidence scaling, and `workingSetLoad` pass-through).
- Shared progression-input seam coverage: `src/lib/progression/canonical-progression-input.test.ts` asserts the canonical assembly of `priorSessionCount`, mixed-history `historyConfidenceScale`, and deduped `confidenceReasons` before either generation or explainability calls `computeDoubleProgressionDecision()`.
- Live workout cue coverage: `src/lib/progression/load-coaching.test.ts` (covers prescribed-load hold, above-prescribed-load hold messaging, rising-effort hold messaging, and standard increase/decrease paths without changing canonical progression math).
- Mesocycle lifecycle coverage: `src/lib/api/mesocycle-lifecycle.test.ts` (facade + math/state split behavior, duration-aware week derivation, accumulation/deload thresholds, volume ramping, default RIR bands for 4-, 5-, and 6-week mesocycles, and the canonical `mesocycle.blocks -> getWeeklyVolumeTarget()` seam).
- Weekly target-profile coverage: `src/lib/engine/volume-targets.test.ts` (block-aware target-profile construction, compatibility fallback to duration-only interpolation, preserved default 5-week behavior, and non-default realization-week target reduction).
- Block-prescription intent coverage: `src/lib/engine/periodization/block-prescription-intent.test.ts` asserts that block-aware RIR targets, lifecycle set targets, set multipliers, and legacy `getPrescriptionModifiers()` all read from one shared seam instead of separate block-policy implementations.
- Generation phase/block bridge coverage: `src/lib/api/generation-phase-block-context.test.ts` verifies that generation resolves real block-relative context when `TrainingBlock` rows exist and falls back cleanly when they do not.
- Context-loader phase/block propagation coverage: `src/lib/api/template-session/context-loader.test.ts` asserts that generation now receives real phase/block context rather than dropping `blockContext` to `null`, that lifecycle weekly volume targets are materialized through the same block-aware path, and that anchored gap-fill requests keep anchored `weekInMeso` while deriving block-relative `weekInBlock`.
- Periodization bridge coverage: `src/lib/engine/periodization.correctness.test.ts` asserts that longer accumulation phases continue progressing before deload rather than hard-stopping at week 4.
- Template-session regression coverage: `src/lib/api/template-session.push-week3.regression.test.ts` (W3S1 Push scenario covering role-budgeting/closure seams, CORE_COMPOUND set-count cap <=5, bodyweight Dip `targetLoad=0`, and uniform main-lift working loads anchored to the representative legacy working-load signal across 0-based and 1-based `setIndex` history).
- Volume landmark coverage: `src/lib/engine/volume-landmarks.test.ts` (MEV/MAV/MRV values for all muscles; shared target interpolation correctness through the canonical volume-target helper).
- Weekly-volume read-model coverage: `src/lib/api/program.test.ts`, `src/lib/api/mesocycle-week-close.test.ts`, `src/lib/api/muscle-outcome-review.test.ts`, and `src/lib/api/explainability.volume-compliance.test.ts` assert that dashboard rows, week-close deficits, analytics muscle outcomes, and explainability compliance read weighted effective weekly volume from the canonical shared adapter in `src/lib/api/weekly-volume.ts` and read weekly target shape through the shared lifecycle target seam rather than ad hoc duration-only interpolation.
- Dashboard RIR/cue sync coverage: `src/lib/api/program.test.ts` asserts that the dashboard's `rirTarget` and accumulation coaching cue use the same block-aware lifecycle RIR seam as generation instead of a separate dashboard-only week mapping.
- Explainability volume compliance coverage: `src/lib/api/explainability.volume-compliance.test.ts` (query/assembly split surfaced through explainability facade; meso-week scoped muscle volume, compliance status classification, and `UNDER_MEV`/`OVER_MAV` boundary assertions).
- Workout generation route contract coverage: `src/app/api/workouts/generate-from-intent/route.test.ts` and `src/app/api/workouts/generate-from-template/route.test.ts` assert receipt-first `selectionMetadata` responses, absence of top-level generation autoregulation payloads, and pending-week-close `optionalGapFillContext` pinning for optional gap-fill requests.
- Slot-semantics ownership coverage now centers on `src/lib/api/mesocycle-handoff-projection.test.ts`, `src/lib/api/mesocycle-handoff.test.ts`, `src/lib/planning/session-slot-profile.test.ts`, `src/lib/api/template-session/selection-adapter.test.ts`, `src/lib/api/next-session.test.ts`, and `src/lib/audit/workout-audit/generation-runner.test.ts`, covering authored slot-semantics persistence, canonical contract normalization, explicit legacy fallback for pre-authored mesocycles, resolved continuity consumption, and generation/audit forwarding of canonical advancing slot context.
- Supplemental deficit route/UI contract coverage: `src/lib/validation.generate-workout.test.ts`, `src/app/api/workouts/generate-from-intent/route.test.ts`, and `src/components/IntentWorkoutCard.test.tsx` assert BODY_PART-only request validation, backend-owned supplemental receipt stamping, unchanged client persistence of returned metadata, and non-advancing save payloads for strict supplemental sessions.
- Derived session-semantics coverage: `src/lib/session-semantics/derive-session-semantics.test.ts` asserts canonical derived kinds plus compatibility behavior for `advancing`, strict `gap_fill`, strict `supplemental`, scheduled `deload`, `non_advancing_generic`, and `null`/`undefined` `advancesSplit` inputs.
- Scheduled deload contract coverage: `src/lib/api/template-session/deload-session.test.ts`, `src/lib/engine/apply-loads.correctness.test.ts`, `src/lib/progression/progression-eligibility.test.ts`, `src/lib/api/exercise-history.test.ts`, `src/lib/api/exercise-exposure.test.ts`, and `src/lib/api/explainability.progression-receipt.test.ts` assert that scheduled deload keeps exercise continuity, cuts sets, applies lighter canonical loads anchored to performed accumulation work when available, falls back cleanly when accumulation history is missing, stays out of progression anchors, and does not contaminate canonical performance-history/trend/explainability reads.
- Explainability progression receipt coverage: `src/lib/api/explainability.progression-receipt.test.ts` (includes recency-window guard and `PARTIAL` + `COMPLETED` performed-status query assertions).
- Explainability next-exposure alignment coverage also lives in `src/lib/api/explainability.progression-receipt.test.ts`, including the audited Week 4 Pull hold case, discounted `MANUAL` history collapsing a would-be increment to hold, a standard non-discounted increment case, representative-working-load main-lift cases, and downward/upward recalibrated hold cases where review copy must name the performed anchor rather than implying the written target should be repeated. The discounted-history regression now builds its canonical comparison input through `buildCanonicalProgressionEvaluationInput()` so the read-side parity assertion uses the same seam as production.
- Golden-path completed-workout regression coverage now also lives in `src/lib/regression/golden-path-workout-review.test.ts` and `src/lib/regression/golden-path-workout-increase.test.ts`, asserting complementary audited Week 4 Pull-style main-lift scenarios across performed semantics, live load-coaching cues, canonical progression via `buildCanonicalProgressionEvaluationInput()`, explainability `nextExposureDecisions`, and the shared post-workout review model used by both immediate completion review and `/workout/[id]`. The paired regressions protect both the "above prescription but still hold" path and the true earned-increase path.
- Main-path completed-workout UX coverage spans `src/lib/api/post-session-review-display.test.ts`, `src/components/post-workout/PostSessionReviewCard.test.tsx`, `src/components/log-workout/CompletedWorkoutReview.test.tsx`, and `src/app/workout/[id]/page.test.tsx`. It asserts that immediate and reopened reviews use the same snapshot-backed DTO, render one default conclusion, keep evidence/set logs behind disclosures, and do not reinstate explanation or client-derived summary paths.
- Run `npm run verify:completed-review` whenever completed-workout review DTOs or display semantics change. The matrix groups `src/lib/api/post-session-review-display.test.ts`, `src/lib/api/completed-workout-review.test.ts`, `src/app/api/workouts/[id]/post-session-review/route.test.ts`, `src/components/post-workout/PostSessionReviewCard.test.tsx`, `src/components/log-workout/CompletedWorkoutReview.test.tsx`, and `src/app/workout/[id]/page.test.tsx`; also search exact expected copy across all consumers before full verification.
- Canonical session receipt coverage: `src/lib/evidence/session-decision-receipt.test.ts` (receipt build/parse/read behavior and canonical-only extraction from `selectionMetadata.sessionDecisionReceipt`).
- Selection metadata sanitization coverage: `src/lib/ui/selection-metadata.test.ts` (save-safe metadata keeps canonical `sessionDecisionReceipt`, drops legacy top-level session mirrors, and keeps generation readiness context inside the receipt).
- Mutation reconciliation metadata coverage: `src/lib/ui/selection-metadata.test.ts` also asserts canonical `workoutStructureState` persistence, current saved structure summaries, and generated-vs-saved reconciliation retention.
- Add-exercise mutation coverage: `src/app/api/workouts/[id]/add-exercise/route.test.ts` asserts reconciliation persistence, revision increment, returned log-row capabilities, and duplicate same-exercise guards for unresolved planned work, resolved extra-work confirmation, and already-added rows.
- Save optimistic-concurrency coverage: `src/app/api/workouts/save/route.integration.test.ts` asserts request/error mapping and that stale saves stop before child/lifecycle mutations. `src/lib/api/save-workout/persistence.db.test.ts` runs against an explicitly supplied disposable PostgreSQL `TEST_DATABASE_URL` and proves successful CAS, stale rejection, same-revision concurrency, child-state isolation, rollback, ownership classification, and revision-1 creation using the real Prisma transaction boundary.
- Runtime mutation OCC coverage: `src/lib/api/workout-mutation.test.ts` covers claim/classification contracts; focused route/service tests cover command validation and reconciliation; `npm run test:db:workout-mutations` provisions PostgreSQL 16 and proves same-revision structural races, log-versus-structure serialization, rollback, owner isolation, and the main-save CAS boundary. `npm run verify:workout-mutations` guards canonical ownership and rejects local unconditional revision increments.
- Persisted mesocycle snapshot normalization coverage: `src/lib/api/workout-mesocycle-snapshot.test.ts` and `src/lib/ui/workout-list-items.test.ts` cover the shared normalized snapshot helper and list-surface summary builder used by history/recent-workout UI.
- Supplemental list-label coverage: `src/lib/ui/workout-list-items.test.ts`, `src/components/RecentWorkouts.test.tsx`, and `src/components/HistoryClient.test.tsx` assert strict supplemental badge rendering while preserving existing gap-fill labeling.
- Explainability session-context correctness coverage: `src/lib/engine/explainability/session-context.correctness.test.ts` (readiness availability labels, fallback cycle-source behavior, receipt block-horizon milestones, and cautious fallback when receipt block duration is absent).
- End-to-end-ish receipt pipeline coverage: `src/app/api/workouts/receipt-pipeline.integration.test.ts` (generate -> save -> explainability with canonical `sessionDecisionReceipt` and no legacy fallback).
- UI session overview copy guards: `src/lib/ui/session-overview.test.ts` (`PARTIAL`/`COMPLETED` performed basis and load-provenance wording).
- Explainability panel UI coverage: `src/components/explainability/ExplainabilityPanel.test.tsx` now also asserts the scan-first audit labels (`Session scan`, `Exercise drill-down`, `Missing or weak signals`, `Why this lift stayed in`, `Top factors`) instead of the older disclosure/jargon-heavy copy.
- Truth-boundary UI coverage: `src/components/explainability/SessionContextCard.test.tsx` and `src/components/explainability/ExplainabilityPanel.test.tsx` cover mutation-aware truth messaging and original-plan relabeling on summary/explainability surfaces.
- UI program volume presentation coverage: `src/components/ProgramStatusCard.render.test.tsx` now asserts that weighted effective sets are shown as the primary weekly value while raw direct/indirect counts remain contextual, that weekly status labels/descriptions/badges come from server-shaped row fields, that historical week views suppress `Today:` entirely, that the breakdown sheet explains raw-to-weighted math per contributor, and that fetched historical browsing does not mix current-week chrome with past-week volume rows.
- Log capability coverage: `src/components/LogWorkoutClient.test.tsx` asserts add-set/remove/swap/add-exercise/finish/weekly-check controls are gated by `LogWorkoutCapabilities` and per-exercise `LogExerciseCapabilities`.
- Receipt block-week semantics coverage: `src/lib/ui/session-summary.test.ts` and `src/lib/evidence/session-decision-receipt.test.ts` assert receipt-backed block-week tags and round-trip parsing of `cycleContext.blockDurationWeeks`.
- UI program-card copy guard: `src/components/ProgramStatusCard.render.test.tsx` covers the rendered `rirTarget` value, while timeline pill copy intentionally stays generic so phase tooltips do not encode a second hardcoded RIR policy.
- Dashboard opportunity model coverage: `src/lib/api/opportunity.test.ts` (weekly pressure, covered-vs-deprioritize rules, downward-only readiness modulation, and rationale text) plus `src/lib/api/recent-muscle-stimulus.test.ts` (recent weighted local stimulus uses the canonical weighted stimulus engine rather than analytics recovery percent).
- Save-route canonical receipt enforcement coverage: `src/app/api/workouts/save/route.integration.test.ts`.
- Audit harness context/generation/serialization coverage: `src/lib/audit/workout-audit/context-builder.test.ts`, `src/lib/audit/workout-audit/generation-runner.test.ts`, `src/lib/audit/workout-audit/serializer.test.ts`, `src/lib/audit/workout-audit/mesocycle-explain.test.ts`, `src/lib/audit/workout-audit/weekly-retro.test.ts`, and `src/lib/audit/workout-audit/workout-audit-cli.test.ts`.
- Focused audit semantics coverage: `src/lib/audit/workout-audit/scenario-audits.test.ts` and `src/lib/api/template-session/remaining-week-planner.test.ts` assert off-order sequencing behavior and the `advancesSplit=false` accounting split between weekly accounting and split advancement.
- Read-side session-semantics regression coverage: `src/lib/progression/progression-eligibility.test.ts`, `src/lib/api/workout-context.test.ts`, `src/lib/api/template-session/remaining-week-planner.test.ts`, and `src/lib/api/next-session.test.ts` assert that the derived helper preserves existing progression, history, remaining-week, and next-session behavior.
- Bundled split-sanity audit coverage: `src/lib/audit/workout-audit/bundle.test.ts` verifies compact summary emission, optional rich-artifact emission, and automatic failure when unresolved same-intent deficits remain with `futureCapacity=0`.
- Week-close handoff audit coverage: `src/lib/audit/workout-audit/week-close-handoff.test.ts` verifies boundary-aware conclusions for final advancing-session ownership handoff, legacy optional gap-fill evidence, and `historical_mixed_contract_state` detection only when a strict optional gap-fill workout exists without a persisted week-close owner.
- Audit diagnostics matrix coverage:
  - `src/lib/audit/workout-audit/future-week-explicit-intent-matrix.test.ts`
  - `src/lib/audit/workout-audit/future-week-derived-intent-matrix.test.ts`
  - Matrix assertions keep standard/debug selection parity while verifying diagnostics gating for closure candidate trace persistence.

## Audit commands

- Exercise rotation-history ownership: `npm run test -- src/lib/api/exercise-rotation-history.test.ts src/lib/api/exercise-rotation-history-ownership.test.ts src/lib/engine/selection-v2/scoring.rotation-history.test.ts`. These tests protect exact-ID rename stability, performed-set semantics, and the absence of legacy aggregate access.
- `npm run audit:workout -- --env-file .env.local --mode future-week --owner owner@local`: canonical owner-scoped future-week artifact with preflight and conclusion blocks
- `npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com`: canonical mesocycle preview vs accepted-seed vs runtime-drift artifact for the real runtime owner
- `npm run audit:sequencing`: emits the focused sequencing audit artifact under `artifacts/audits/sequencing/`
- `npm run audit:accounting -- --env-file .env.local --owner owner@local --selection-mode MANUAL --status COMPLETED --advances-split false --optional-gap-fill true`: emits the focused accounting semantics artifact under `artifacts/audits/accounting/`
- `npm run audit:week-close-handoff -- --env-file .env.local --owner owner@local --target-week 3`: emits the boundary-aware week-close handoff artifact for one concrete owner/week

## Gap-fill regression
- Key invariants:
  - normal scheduled week close auto-resolves target deficits as review evidence and does not create blocking optional work
  - lifecycle counters/state do not advance for strict optional gap-fill (`advancesSplit=false`)
  - persisted non-advancing workouts cannot be flipped advancing via request payload
  - strict classifier triplet is enforced (`optional_gap_fill` + `INTENT` + `BODY_PART`)
  - anchor week is pinned in both persisted snapshot and receipt cycle context
  - program week-volume queries are week-bounded and snapshot-aware (no cross-week leak)
- Fixture location:
  - `src/lib/audit/workout-audit/fixtures/optional-gap-fill-body-part.future-week-explicit-intent.json`
- Focused test files:
  - `src/app/api/workouts/save/route.integration.test.ts`
  - `src/lib/api/mesocycle-week-close.test.ts`
  - `src/app/api/workouts/save/lifecycle-contract.test.ts`
  - `src/lib/ui/gap-fill.test.ts`
  - `src/app/api/workouts/generate-from-intent/route.test.ts`
  - `src/lib/ui/selection-metadata.test.ts`
  - `src/lib/audit/workout-audit/optional-gap-fill.fixture-regression.test.ts`
  - `src/lib/api/program.test.ts`
  - `src/lib/api/program-page.test.ts`
  - `src/app/api/mesocycles/week-close/[id]/closeout/route.integration.test.ts`
- Recommended focused command:
  - `npm run test -- src/lib/api/mesocycle-week-close.test.ts src/app/api/workouts/save/route.integration.test.ts src/lib/api/program.test.ts src/lib/api/program-page.test.ts src/app/api/mesocycles/week-close/[id]/closeout/route.integration.test.ts src/app/api/workouts/generate-from-intent/route.test.ts src/app/api/workouts/save/lifecycle-contract.test.ts src/lib/ui/gap-fill.test.ts src/lib/ui/selection-metadata.test.ts src/lib/audit/workout-audit/optional-gap-fill.fixture-regression.test.ts`

## Post-session review snapshot verification

Run the focused snapshot, producer, loader, save-route, and audit tests before broad verification:

```powershell
npm run test -- src/lib/api/post-session-review-contract.test.ts src/lib/api/post-session-review-producer.test.ts src/lib/api/post-session-review-snapshot.test.ts src/lib/api/completed-workout-review.test.ts src/lib/api/post-session-review-audit.test.ts src/app/api/workouts/save/route.integration.test.ts
```

Disposable PostgreSQL verification must cover migration apply, unique one-to-one insertion, update/delete trigger rejection, transaction rollback, concurrent completion, and dry-run/write/idempotent backfill. Never use the configured application database for these tests.

## Configuration
- Vitest include patterns: `src/**/*.test.ts` and `src/**/*.test.tsx`
- Environment: `jsdom`
- Reporter: `dot`
- Setup: `vitest.setup.ts`
- Playwright config: `playwright.config.ts`; by default it starts a managed local Next dev server on port `3100` with `UI_AUDIT_FIXTURE_MODE=1`, uses the isolated `.next-ui-audit/managed` output directory, and runs the core-route audit at mobile (`390x844`) and desktop (`1366x768`) viewport sizes.
- The UI audit fixture harness is development-only. Fixture mode requires `UI_AUDIT_FIXTURE_MODE=1`, is disabled when `NODE_ENV=production`, and selects a named scenario through the `x-ui-audit-fixture` request header.
- Current UI audit fixture scenarios:
  - `active`: fixture-backed Home, Program, History, Analytics, Settings, and lightweight log-workout interaction state with populated representative data.
  - `empty`: fixture-backed Home and Program empty-ish setup state.
  - `handoff`: fixture-backed Home pending-handoff state.
  - `timer-visible`: fixture-backed log-workout state with one logged set and an active rest timer for direct layout audit coverage.
- Use `npm run test:ui-audit:update` only after an intentional baseline change, then review screenshots under `tests/ui-audit/__screenshots__/`.
- If `PLAYWRIGHT_BASE_URL` is set, Playwright targets that server instead of starting the managed fixture server. Start that server with `UI_AUDIT_FIXTURE_MODE=1` when the fixture-backed scenarios should be active.

## Stimulus accounting verification

- Run focused contract tests: `npm run test -- src/lib/stimulus-accounting/`.
- Run save/add/swap tests for atomic snapshot creation and runtime-edit evidence.
- Run historical reader tests to prove policy/catalog edits do not change snapshotted results.
- Run `src/lib/api/persisted-incomplete-workout-projection.test.ts` for exact performed/remaining partitioning, optional-session behavior, runtime add/swap/remove attribution, corrupt/duplicate evidence fail-closed behavior, deterministic ordering, and Prisma relation query shape.
- Run projected-week and closure tests together to verify explicit completed/incomplete/future categories, immutable current-session evidence, transition-race identity exclusion, the `0.5` meaningful-later threshold, and unreliable-evidence suppression.
- Validate the additive migration and both dry-run/write backfill modes only against disposable Postgres before rollout; do not execute migrations or `--write` against the configured shared database without explicit approval.
# Production write-pause verification

Run the static ownership guard after adding or changing an API mutation method or rollout write
script:

```powershell
npm run verify:production-write-gate
```

The guard inventories every exported `POST`, `PUT`, `PATCH`, and `DELETE` handler, requires a
central gate for classified mutations, keeps the two read-only POST previews explicit, rejects
direct production environment checks outside the owner module, and verifies rollout write
scripts use target-aware tooling. It is included in `npm run verify`.

Focused behavior coverage lives in:

- `src/lib/operations/production-write-gate.test.ts`
- `src/lib/operations/production-write-gate-http.test.ts`
- `src/lib/operations/production-write-status-command.test.ts`
- `src/lib/operations/rollout-environment.test.ts`
- representative mesocycle acceptance, workout materialization/save/structural edit, set logging,
  readiness preparation, and readiness submission route tests

Paused route tests must assert the stable 503 contract and zero calls to owner resolution,
Prisma, workout revision CAS/transactions, and the relevant receipt/readiness/snapshot producer.
Existing route success tests prove the missing/disabled pause preserves response and revision
behavior.

## Inspecting a proposed Codex task

`scripts/codex/Start-TrainerTask.ps1` inspects a proposed task against the versioned
`scripts/codex/trainer-policy.v1.json` policy. It reports repository and worktree state, path
and database policy, conflicts, and proposed verification. Phase 1 is strictly inspect-only: it
does not create worktrees or branches, install packages, execute proposed checks, access a
database, or contact release services.

Human-readable inspection:

```powershell
.\scripts\codex\Start-TrainerTask.ps1 `
  -Name freeze-effective-set-accounting `
  -Classification shared-seam-write `
  -BaseBranch master
```

JSON inspection:

```powershell
.\scripts\codex\Start-TrainerTask.ps1 `
  -Name freeze-effective-set-accounting `
  -Classification shared-seam-write `
  -BaseBranch master `
  -ChangedPath trainer-app/src/lib/engine/example.ts `
  -Json
```

JSON uses the stable `trainer-task-manifest` version 1 structure. Repeatable `-ChangedPath`
values add matching path-based checks in policy order; commands are deterministically
deduplicated. Supported classifications are `audit`, `application-write`, `shared-seam-write`,
`db-migration`, and `release-incident`.

Exit codes are `0` for a successful inspection without blockers, `1` for a valid inspection
with blockers or conflicts, `2` for an invalid invocation or requested policy value, and `3`
for a policy-loading or unexpected execution failure. Warnings do not change a successful exit
code. Proposed verification is planning output only and is never executed by this script.

Run the focused temporary-fixture tests with:

```powershell
pwsh -NoProfile -File .\scripts\codex\tests\Run-Tests.ps1
```

## Local environment doctor

`scripts/codex/Invoke-TrainerDoctor.ps1` reports whether the local checkout has the repository,
runtime, tool, dependency, Prisma, migration, and environment-file capabilities needed for
Trainer work. Its default scope is local and inspect-only:

```powershell
.\scripts\codex\Invoke-TrainerDoctor.ps1
.\scripts\codex\Invoke-TrainerDoctor.ps1 -Json
```

JSON uses the stable `trainer-doctor-report` version 1 structure. Capability statuses are
`available`, `missing`, `warning`, `not-checked`, or `invalid`. Missing optional tools produce
warnings, not a global failure. Environment files are listed by filename only; values, URLs,
tokens, and credentials are never printed.

`-Database`, `-GitHub`, `-Deployment`, and `-All` explicitly select additional reporting
scopes. Phase 2 still reports those scopes as `not-checked`: database selection inventories
local prerequisites without connecting, while GitHub and deployment selection inventory CLI
presence without authentication, project lookup, or remote access. Returning `not-checked`
is preferred whenever an inspect-only guarantee cannot be proven.

Doctor exit codes are `0` when inspection completes without blockers, `1` when required local
project or policy prerequisites block the requested work, `2` for an invalid scope/invocation,
and `3` for policy-loading or unexpected failures. Warnings do not change exit code `0`.

The doctor reports capabilities and risks. It does not install, authenticate, repair, connect,
migrate, deploy, or execute recommended commands.

## Command side-effect registry

`scripts/codex/trainer-policy.v1.json` contains the authoritative Phase 2 command registry.
Each entry identifies its package script or operational entrypoint, resolved side-effect
profile, network/database/local/tracked-file behavior, production-mutation potential,
authorization requirement, mutation-flag escalations, and naming caveats. Commands named
`audit`, `verify`, `preflight`, `refresh`, or `repair` must be judged by this metadata and their
implementation, not by their names.

Run deterministic offline registry coverage validation with:

```powershell
.\scripts\codex\Test-TrainerCommandRegistry.ps1
.\scripts\codex\Test-TrainerCommandRegistry.ps1 -Json
```

The validator requires every `trainer-app/package.json` script and designated operational
entrypoint to be registered or explicitly ignored, verifies referenced files, rejects duplicate
IDs and invalid side-effect classes, and checks known mutation flags for escalation metadata.
The ignore list is limited to documented internal helpers and data modules; the full registry is
not duplicated in this document.

## Offline remote identity status

`scripts/codex/trainer-remote.v1.json` is the versioned, non-secret expected-identity contract
for Trainer's production integrations. It may contain provider owner/project identifiers,
display names, production aliases, project references, environment labels, default branches,
and connection-class names. Unknown values stay explicitly `null` until an operator verifies
them.

Never place tokens, passwords, API keys, database URLs, connection strings, environment-variable
values, credential-bearing Git remotes, or other secrets in this file. Immutable provider IDs
are preferred over display names. Expected identity in this committed contract is distinct from
observed local linkage and from live provider state.

Run the Phase 1 offline inspection in human or JSON mode:

```powershell
.\scripts\codex\Invoke-TrainerRemoteStatus.ps1
.\scripts\codex\Invoke-TrainerRemoteStatus.ps1 -Json
```

The stable JSON output uses `trainer-remote-status` version 1. It reports contract completeness,
sanitized local Git comparison, committed/local Vercel linkage-file presence, committed Supabase
configuration presence, Prisma migration count, exact operator identity gaps, and an explicitly
offline traceability chain. Ignored `.vercel/project.json` values are not read. Raw Git remotes,
credential-bearing URLs, environment values, and secret-like contract values are never emitted.

GitHub HTTPS and SSH remotes are normalized before comparing owner/repository. A configured
GitHub owner, repository, or cached default-branch mismatch is a blocker and is never downgraded
to a warning. Unknown Supabase identity remains unknown rather than being treated as a match.
The explicit `-GitHub` and `-Deployment` scopes run deterministic fake-provider coverage for
pre-provider zero-call gates, authentication/access failures, exact identity mismatches, paginated
GET-only reads, stable human/JSON output, and repository-state immutability. `-Database` and `-All`
remain unsupported and exit `2`.

Vercel fixtures inject a registered HTTP dispatcher directly into the private provider. They never
contact Vercel and never require a Vercel CLI. Coverage validates the eight official REST endpoint
shapes, HTTPS/host/GET/query restrictions, redirect refusal, finite-timeout handling, process-only
`VERCEL_TOKEN` gating, token redaction, alias-to-deployment production truth, and conservative
rollback-candidate reporting. The public command's missing-token fixture requires zero HTTP calls
and null live evidence.

Exit codes are `0` when offline inspection completes without blockers, `1` for a valid report
with blockers or identity mismatch, `2` for an invalid or unsupported scope, and `3` for
identity/policy loading or unexpected failure. Registry validation requires both the identity
contract and the read-only/offline command registration.

Offline remote status validates expected identity and local linkage only. It does not
authenticate, contact providers, inspect deployments, connect to databases, or prove production
state.

## Diff-aware verification planning and execution

`scripts/codex/Invoke-TrainerVerification.ps1` reads the same versioned policy, task-manifest
contract, command registry, and local capability discovery used by Phases 1 and 2. It combines
committed, staged, unstaged, and untracked Git paths with any explicit or manifest paths,
normalizes separators, matches every applicable path rule, retains every selection reason,
deduplicates commands in policy order, and keeps implementation checks separate from release
checks.

Planning is the default. Verification commands run only with explicit `-Run` authorization,
and only registry-approved local implementation checks are eligible.

Plan the current branch/worktree delta from a Git base:

```powershell
.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef origin/master
.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef origin/master -Json
```

Plan paths without requiring them to exist, or combine them deterministically with a Git base:

```powershell
.\scripts\codex\Invoke-TrainerVerification.ps1 `
  -ChangedPath trainer-app/src/lib/example.ts `
  -ChangedPath trainer-app/prisma/schema.prisma

.\scripts\codex\Invoke-TrainerVerification.ps1 `
  -BaseRef origin/master `
  -ChangedPath trainer-app/src/lib/example.ts
```

Consume an unchanged `trainer-task-manifest` version 1 contract:

```powershell
.\scripts\codex\Invoke-TrainerVerification.ps1 `
  -ManifestPath C:\path\to\trainer-task-manifest.json
```

The manifest classification, allowed/forbidden path policy, changed paths, and proposed checks
are applied alongside current policy rules. An unsupported schema/version or unknown
classification is invalid rather than silently upgraded.

Execute eligible local implementation checks only after reviewing the complete plan:

```powershell
.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef origin/master -Run
.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef origin/master -Run -ContinueOnFailure
```

Execution is sequential and stops on the first failed required check by default. Results retain
the child exit code, duration, stdout, and stderr. `-ContinueOnFailure` runs remaining eligible
checks but does not turn a failed result into success. In `-Json -Run` mode the pre-execution
plan is printed to stderr and the completed `trainer-verification-plan` version 1 report is
printed to stdout.

Policy and registry metadata decide execution eligibility. Phase 3 refuses release-only,
production-write, deploy, destructive, database, network, separately authorized,
mutation-escalated, install/download, and unresolved-side-effect commands. Unsafe or unsupported
commands remain visible in the plan with skip reasons and are never attempted. Current full
`verify` and Prisma generation selections are plan-only; focused commands explicitly approved by
policy may run when their local prerequisites are available.

Prerequisites are reported per selected command: PowerShell, Git-owned comparison state,
Node/npm, the existing dependency installation, Prisma, Docker, clean-worktree, database, and
network requirements. `-Run` reuses the doctor report for capability discovery. Missing
prerequisites block only affected eligible execution; planning remains available and never
installs, links, repairs, authenticates, connects, or remediates.

Exit codes are `0` for a valid plan or successful authorized execution, `1` for a valid plan
with blockers or any failed executed check, `2` for an invalid invocation, manifest, base, or
option combination, and `3` for policy-loading or unexpected failures. `-ContinueOnFailure`
without `-Run` exits `2`.

Phase 3 does not create an evidence bundle, create or clean a worktree, execute a release stage,
connect to services, authenticate, install packages, remediate prerequisites, or clean artifacts
created by an approved local check. Those boundaries are intentional and are not hidden behind
command names.
