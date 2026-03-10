# 06 Testing

Owner: Aaron
Last reviewed: 2026-03-10
Purpose: Canonical testing reference for Vitest-based coverage of engine, API helpers, and UI components.

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
- `npm run test:watch`: watch mode
- `npm run test:fast`: focused fast subset
- `npm run test:slow`: slow simulation suite opt-in
- `npm run test:audit:matrix`: workout-audit diagnostics matrix regression sweep (`intent-preview` + `next-session` across intents)
- `npm run test -- src/lib/audit/workout-audit/bundle.test.ts`: focused split-sanity audit summary/verdict coverage
- `npm run test -- src/lib/audit/workout-audit/scenario-audits.test.ts`: focused sequencing/accounting audit coverage
- `npm run test -- src/lib/audit/workout-audit/week-close-handoff.test.ts`: focused week-close handoff and historical mixed-contract detector coverage
- `npm run verify`: lint + type-check (`tsc --noEmit`) + `test:fast` + contract verification
- `npm run verify:contracts`: docs/runtime enum drift check
- Owner-scoped audit commands accept `--env-file .env.local --owner owner@local` so local audit scripts can load the intended runtime environment explicitly

## Scope
- Engine tests: `src/lib/engine/**/*.test.ts`
- API helper tests: `src/lib/api/**/*.test.ts`
- UI tests: component tests under `src/components/**`
- Workout log UI regressions are covered in `src/components/LogWorkoutClient.test.tsx`, including all-skipped completion routing, timer resume/remount behavior, queue-chip targeting, queue-row scroll neutrality, skipped terminal state copy/actions, and reduced mobile edit-state chrome.
- Timer/session-layout hook coverage lives in `src/components/log-workout/useRestTimerState.test.tsx` and `src/components/log-workout/useWorkoutSessionLayout.test.tsx`, covering visibility-return timer re-sync and explicit-only scroll correction.
- UI session summary-model coverage: `src/lib/ui/session-summary.test.ts` (receipt-first summary text/tags/items, including deload, soreness hold, and readiness-scaling cases).
- Save-route terminal transition coverage (including status-machine behavior through route boundary): `src/app/api/workouts/save/route.integration.test.ts`
- Validation/status coverage: `src/lib/validation.workout-save.test.ts`, `src/lib/validation.test.ts`, `src/lib/api/exercise-history.test.ts`, `src/lib/api/readiness.test.ts`
- Exercise-library personal-history presentation coverage: `src/components/library/PersonalHistorySection.test.tsx` asserts weaker `Recent top-set trend` framing and guards against strong `Improving` / `Stable` / `Declining` chip labels in the library surface.
- Performed-history progression coverage: `src/lib/engine/apply-loads.correctness.test.ts` and `src/lib/engine/history.test.ts` (includes `PARTIAL` and malformed legacy-status handling; also covers top-set anchor correctness and bodyweight early-exit behavior).
- Double-progression decision coverage: `src/lib/engine/progression.correctness.test.ts` (covers `computeDoubleProgressionDecision` paths, bodyweight rep-only progression, high-variance trimming, confidence scaling, and `anchorOverride` pass-through).
- Shared progression-input seam coverage: `src/lib/progression/canonical-progression-input.test.ts` asserts the canonical assembly of `priorSessionCount`, mixed-history `historyConfidenceScale`, and deduped `confidenceReasons` before either generation or explainability calls `computeDoubleProgressionDecision()`.
- Live workout cue coverage: `src/lib/progression/load-coaching.test.ts` (covers prescribed-load hold, above-prescribed-load hold messaging, rising-effort hold messaging, and standard increase/decrease paths without changing canonical progression math).
- Mesocycle lifecycle coverage: `src/lib/api/mesocycle-lifecycle.test.ts` (facade + math/state split behavior, duration-aware week derivation, accumulation/deload thresholds, volume ramping, default RIR bands for 4-, 5-, and 6-week mesocycles, and the canonical `mesocycle.blocks -> getWeeklyVolumeTarget()` seam).
- Weekly target-profile coverage: `src/lib/engine/volume-targets.test.ts` (block-aware target-profile construction, compatibility fallback to duration-only interpolation, preserved default 5-week behavior, and non-default realization-week target reduction).
- Block-prescription intent coverage: `src/lib/engine/periodization/block-prescription-intent.test.ts` asserts that block-aware RIR targets, lifecycle set targets, set multipliers, and legacy `getPrescriptionModifiers()` all read from one shared seam instead of separate block-policy implementations.
- Generation phase/block bridge coverage: `src/lib/api/generation-phase-block-context.test.ts` verifies that generation resolves real block-relative context when `TrainingBlock` rows exist and falls back cleanly when they do not.
- Context-loader phase/block propagation coverage: `src/lib/api/template-session/context-loader.test.ts` asserts that generation now receives real phase/block context rather than dropping `blockContext` to `null`, that lifecycle weekly volume targets are materialized through the same block-aware path, and that anchored gap-fill requests keep anchored `weekInMeso` while deriving block-relative `weekInBlock`.
- Periodization bridge coverage: `src/lib/engine/periodization.correctness.test.ts` asserts that longer accumulation phases continue progressing before deload rather than hard-stopping at week 4.
- Template-session regression coverage: `src/lib/api/template-session.push-week3.regression.test.ts` (W3S1 Push scenario covering role-budgeting/closure seams, CORE_COMPOUND set-count cap <=5, bodyweight Dip `targetLoad=0`, and top-set load anchoring >= top-set history value across 0-based and 1-based `setIndex` history).
- Volume landmark coverage: `src/lib/engine/volume-landmarks.test.ts` (MEV/MAV/MRV values for all muscles; shared target interpolation correctness through the canonical volume-target helper).
- Weekly-volume read-model coverage: `src/lib/api/program.test.ts`, `src/lib/api/mesocycle-week-close.test.ts`, `src/lib/api/muscle-outcome-review.test.ts`, and `src/lib/api/explainability.volume-compliance.test.ts` assert that dashboard rows, week-close deficits, analytics muscle outcomes, and explainability compliance read weighted effective weekly volume from the canonical shared adapter in `src/lib/api/weekly-volume.ts` and read weekly target shape through the shared lifecycle target seam rather than ad hoc duration-only interpolation.
- Dashboard RIR/cue sync coverage: `src/lib/api/program.test.ts` asserts that the dashboard's `rirTarget` and accumulation coaching cue use the same block-aware lifecycle RIR seam as generation instead of a separate dashboard-only week mapping.
- Explainability volume compliance coverage: `src/lib/api/explainability.volume-compliance.test.ts` (query/assembly split surfaced through explainability facade; meso-week scoped muscle volume, compliance status classification, and `UNDER_MEV`/`OVER_MAV` boundary assertions).
- Workout generation route contract coverage: `src/app/api/workouts/generate-from-intent/route.test.ts` and `src/app/api/workouts/generate-from-template/route.test.ts` assert receipt-first `selectionMetadata` responses, absence of top-level generation autoregulation payloads, and pending-week-close `optionalGapFillContext` pinning for optional gap-fill requests.
- Supplemental deficit route/UI contract coverage: `src/lib/validation.generate-workout.test.ts`, `src/app/api/workouts/generate-from-intent/route.test.ts`, and `src/components/IntentWorkoutCard.test.tsx` assert BODY_PART-only request validation, backend-owned supplemental receipt stamping, unchanged client persistence of returned metadata, and non-advancing save payloads for strict supplemental sessions.
- Derived session-semantics coverage: `src/lib/session-semantics/derive-session-semantics.test.ts` asserts canonical derived kinds plus compatibility behavior for `advancing`, strict `gap_fill`, strict `supplemental`, `non_advancing_generic`, and `null`/`undefined` `advancesSplit` inputs.
- Explainability progression receipt coverage: `src/lib/api/explainability.progression-receipt.test.ts` (includes recency-window guard and `PARTIAL` + `COMPLETED` performed-status query assertions).
- Explainability next-exposure alignment coverage also lives in `src/lib/api/explainability.progression-receipt.test.ts`, including the audited Week 4 Pull hold case, discounted `MANUAL` history collapsing a would-be increment to hold, a standard non-discounted increment case, and a top-set/backoff anchor-sensitive main-lift case. The discounted-history regression now builds its canonical comparison input through `buildCanonicalProgressionEvaluationInput()` so the read-side parity assertion uses the same seam as production.
- Main-path post-workout UX coverage now spans `src/lib/ui/post-workout-insights.test.ts`, `src/components/LogWorkoutClient.test.tsx`, `src/app/workout/[id]/page.test.tsx`, and `src/components/WorkoutExplanation.test.tsx`, asserting shared outcome framing, emphasized next-exposure messaging, non-duplicated program-impact presentation, consistency between immediate completion review and the full workout review page, and user-facing workout-explanation loading/error copy.
- Canonical session receipt coverage: `src/lib/evidence/session-decision-receipt.test.ts` (receipt build/parse/read behavior and canonical-only extraction from `selectionMetadata.sessionDecisionReceipt`).
- Selection metadata sanitization coverage: `src/lib/ui/selection-metadata.test.ts` (save-safe metadata keeps canonical `sessionDecisionReceipt`, drops legacy top-level session mirrors, and keeps generation readiness context inside the receipt).
- Persisted mesocycle snapshot normalization coverage: `src/lib/api/workout-mesocycle-snapshot.test.ts` and `src/lib/ui/workout-list-items.test.ts` cover the shared normalized snapshot helper and list-surface summary builder used by history/recent-workout UI.
- Supplemental list-label coverage: `src/lib/ui/workout-list-items.test.ts`, `src/components/RecentWorkouts.test.tsx`, and `src/components/HistoryClient.test.tsx` assert strict supplemental badge rendering while preserving existing gap-fill labeling.
- Explainability session-context correctness coverage: `src/lib/engine/explainability/session-context.correctness.test.ts` (readiness availability labels, fallback cycle-source behavior, receipt block-horizon milestones, and cautious fallback when receipt block duration is absent).
- End-to-end-ish receipt pipeline coverage: `src/app/api/workouts/receipt-pipeline.integration.test.ts` (generate -> save -> explainability with canonical `sessionDecisionReceipt` and no legacy fallback).
- UI session overview copy guards: `src/lib/ui/session-overview.test.ts` (`PARTIAL`/`COMPLETED` performed basis and load-provenance wording).
- Explainability panel UI coverage: `src/components/explainability/ExplainabilityPanel.test.tsx` now also asserts the scan-first audit labels (`Session scan`, `Exercise drill-down`, `Missing or weak signals`, `Why this lift stayed in`, `Top factors`) instead of the older disclosure/jargon-heavy copy.
- UI program dashboard coverage: `src/components/ProgramStatusCard.test.ts` (volume dot class logic, deload banner, week navigation, and `getVolumeDotClass` boundary assertions).
- UI program volume presentation coverage: `src/components/ProgramStatusCard.render.test.tsx` now asserts that weighted effective sets are shown as the primary weekly value while raw direct/indirect counts remain contextual, that the dashboard-only opportunity badge is shown for the live current week but hidden for historical week views, that the rendered badge copy stays in advisory snapshot language, and that fetched historical browsing does not mix current-week chrome with past-week volume rows.
- Receipt block-week semantics coverage: `src/lib/ui/session-summary.test.ts` and `src/lib/evidence/session-decision-receipt.test.ts` assert receipt-backed block-week tags and round-trip parsing of `cycleContext.blockDurationWeeks`.
- UI program-card copy guard: `src/components/ProgramStatusCard.render.test.tsx` covers the rendered `rirTarget` value, while timeline pill copy intentionally stays generic so phase tooltips do not encode a second hardcoded RIR policy.
- Dashboard opportunity model coverage: `src/lib/api/opportunity.test.ts` (weekly pressure, covered-vs-deprioritize rules, downward-only readiness modulation, and rationale text) plus `src/lib/api/recent-muscle-stimulus.test.ts` (recent weighted local stimulus uses the canonical weighted stimulus engine rather than analytics recovery percent).
- Save-route canonical receipt enforcement coverage: `src/app/api/workouts/save/route.integration.test.ts`.
- Audit harness context/generation/serialization coverage: `src/lib/audit/workout-audit/context-builder.test.ts`, `src/lib/audit/workout-audit/generation-runner.test.ts`, `src/lib/audit/workout-audit/serializer.test.ts`.
- Focused audit semantics coverage: `src/lib/audit/workout-audit/scenario-audits.test.ts` and `src/lib/api/template-session/remaining-week-planner.test.ts` assert off-order sequencing behavior and the `advancesSplit=false` accounting split between weekly accounting and split advancement.
- Read-side session-semantics regression coverage: `src/lib/progression/progression-eligibility.test.ts`, `src/lib/api/workout-context.test.ts`, `src/lib/api/template-session/remaining-week-planner.test.ts`, and `src/lib/api/next-session.test.ts` assert that the derived helper preserves existing progression, history, remaining-week, and next-session behavior.
- Bundled split-sanity audit coverage: `src/lib/audit/workout-audit/bundle.test.ts` verifies compact summary emission, optional rich-artifact emission, and automatic failure when unresolved same-intent deficits remain with `futureCapacity=0`.
- Week-close handoff audit coverage: `src/lib/audit/workout-audit/week-close-handoff.test.ts` verifies boundary-aware conclusions for final advancing-session ownership handoff, optional gap-fill eligibility basis, and `historical_mixed_contract_state` detection only when a strict optional gap-fill workout exists without a persisted week-close owner.
- Audit diagnostics matrix coverage:
  - `src/lib/audit/workout-audit/intent-matrix.test.ts`
  - `src/lib/audit/workout-audit/next-session-intent-matrix.test.ts`
  - Matrix assertions keep standard/debug selection parity while verifying diagnostics gating for closure candidate trace persistence.

## Audit commands
- `npm run audit:workout -- --env-file .env.local --mode next-session --owner owner@local`: owner-scoped next-session artifact with preflight and conclusion blocks
- `npm run audit:sequencing`: emits the focused sequencing audit artifact under `artifacts/audits/sequencing/`
- `npm run audit:accounting -- --env-file .env.local --owner owner@local --selection-mode MANUAL --status COMPLETED --advances-split false --optional-gap-fill true`: emits the focused accounting semantics artifact under `artifacts/audits/accounting/`
- `npm run audit:week-close-handoff -- --env-file .env.local --owner owner@local --target-week 3`: emits the boundary-aware week-close handoff artifact for one concrete owner/week

## Gap-fill regression
- Key invariants:
  - lifecycle counters/state do not advance for strict optional gap-fill (`advancesSplit=false`)
  - persisted non-advancing workouts cannot be flipped advancing via request payload
  - strict classifier triplet is enforced (`optional_gap_fill` + `INTENT` + `BODY_PART`)
  - anchor week is pinned in both persisted snapshot and receipt cycle context
  - program week-volume queries are week-bounded and snapshot-aware (no cross-week leak)
- Fixture location:
  - `src/lib/audit/workout-audit/fixtures/optional-gap-fill-body-part.intent-preview.json`
- Focused test files:
  - `src/app/api/workouts/save/route.integration.test.ts`
  - `src/app/api/workouts/save/lifecycle-contract.test.ts`
  - `src/lib/ui/gap-fill.test.ts`
  - `src/app/api/workouts/generate-from-intent/route.test.ts`
  - `src/lib/ui/selection-metadata.test.ts`
  - `src/lib/audit/workout-audit/optional-gap-fill.fixture-regression.test.ts`
  - `src/lib/api/program.test.ts`
- Recommended focused command:
  - `npm run test -- src/app/api/workouts/generate-from-intent/route.test.ts src/app/api/workouts/save/lifecycle-contract.test.ts src/app/api/workouts/save/route.integration.test.ts src/lib/api/program.test.ts src/lib/ui/gap-fill.test.ts src/lib/ui/selection-metadata.test.ts src/lib/audit/workout-audit/optional-gap-fill.fixture-regression.test.ts`

## Configuration
- Vitest include patterns: `src/**/*.test.ts` and `src/**/*.test.tsx`
- Environment: `jsdom`
- Reporter: `dot`
- Setup: `vitest.setup.ts`
