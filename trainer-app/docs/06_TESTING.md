# 06 Testing

Owner: Aaron
Last reviewed: 2026-03-07
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
- `npm run verify`: lint + type-check (`tsc --noEmit`) + `test:fast` + contract verification
- `npm run verify:contracts`: docs/runtime enum drift check

## Scope
- Engine tests: `src/lib/engine/**/*.test.ts`
- API helper tests: `src/lib/api/**/*.test.ts`
- UI tests: component tests under `src/components/**`
- Workout log UI regressions are covered in `src/components/LogWorkoutClient.test.tsx`, including all-skipped completion routing, timer resume/remount behavior, queue-chip targeting, queue-row scroll neutrality, skipped terminal state copy/actions, and reduced mobile edit-state chrome.
- Timer/session-layout hook coverage lives in `src/components/log-workout/useRestTimerState.test.tsx` and `src/components/log-workout/useWorkoutSessionLayout.test.tsx`, covering visibility-return timer re-sync and explicit-only scroll correction.
- UI session summary-model coverage: `src/lib/ui/session-summary.test.ts` (receipt-first summary text/tags/items, including deload, soreness hold, and readiness-scaling cases).
- Save-route terminal transition coverage (including status-machine behavior through route boundary): `src/app/api/workouts/save/route.integration.test.ts`
- Validation/status coverage: `src/lib/validation.workout-save.test.ts`, `src/lib/validation.test.ts`, `src/lib/api/exercise-history.test.ts`, `src/lib/api/readiness.test.ts`
- Performed-history progression coverage: `src/lib/engine/apply-loads.correctness.test.ts` and `src/lib/engine/history.test.ts` (includes `PARTIAL` and malformed legacy-status handling; also covers top-set anchor correctness and bodyweight early-exit behavior).
- Double-progression decision coverage: `src/lib/engine/progression.correctness.test.ts` (covers `computeDoubleProgressionDecision` paths, bodyweight rep-only progression, high-variance trimming, confidence scaling, and `anchorOverride` pass-through).
- Mesocycle lifecycle coverage: `src/lib/api/mesocycle-lifecycle.test.ts` (facade + math/state split behavior, duration-aware week derivation, accumulation/deload thresholds, volume ramping, and default RIR bands for 4-, 5-, and 6-week mesocycles).
- Periodization bridge coverage: `src/lib/engine/periodization.correctness.test.ts` asserts that longer accumulation phases continue progressing before deload rather than hard-stopping at week 4.
- Template-session regression coverage: `src/lib/api/template-session.push-week3.regression.test.ts` (W3S1 Push scenario covering role-budgeting/closure seams, CORE_COMPOUND set-count cap <=5, bodyweight Dip `targetLoad=0`, and top-set load anchoring >= top-set history value across 0-based and 1-based `setIndex` history).
- Volume landmark coverage: `src/lib/engine/volume-landmarks.test.ts` (MEV/MAV/MRV values for all muscles; ramp interpolation correctness).
- Explainability volume compliance coverage: `src/lib/api/explainability.volume-compliance.test.ts` (query/assembly split surfaced through explainability facade; meso-week scoped muscle volume, compliance status classification, and `UNDER_MEV`/`OVER_MAV` boundary assertions).
- Workout generation route contract coverage: `src/app/api/workouts/generate-from-intent/route.test.ts` and `src/app/api/workouts/generate-from-template/route.test.ts` assert receipt-first `selectionMetadata` responses, absence of top-level generation autoregulation payloads, and pending-week-close `optionalGapFillContext` pinning for optional gap-fill requests.
- Explainability progression receipt coverage: `src/lib/api/explainability.progression-receipt.test.ts` (includes recency-window guard and `PARTIAL` + `COMPLETED` performed-status query assertions).
- Canonical session receipt coverage: `src/lib/evidence/session-decision-receipt.test.ts` (receipt build/parse/read behavior and canonical-only extraction from `selectionMetadata.sessionDecisionReceipt`).
- Selection metadata sanitization coverage: `src/lib/ui/selection-metadata.test.ts` (save-safe metadata keeps canonical `sessionDecisionReceipt`, drops legacy top-level session mirrors, and keeps generation readiness context inside the receipt).
- Persisted mesocycle snapshot normalization coverage: `src/lib/api/workout-mesocycle-snapshot.test.ts` and `src/lib/ui/workout-list-items.test.ts` cover the shared normalized snapshot helper and list-surface summary builder used by history/recent-workout UI.
- Explainability session-context correctness coverage: `src/lib/engine/explainability/session-context.correctness.test.ts` (readiness availability labels and fallback cycle-source behavior).
- End-to-end-ish receipt pipeline coverage: `src/app/api/workouts/receipt-pipeline.integration.test.ts` (generate -> save -> explainability with canonical `sessionDecisionReceipt` and no legacy fallback).
- UI session overview copy guards: `src/lib/ui/session-overview.test.ts` (`PARTIAL`/`COMPLETED` performed basis and load-provenance wording).
- Explainability panel UI coverage: `src/components/explainability/ExplainabilityPanel.test.tsx` now also asserts the scan-first audit labels (`Session scan`, `Exercise drill-down`, `Missing or weak signals`, `Why this lift stayed in`, `Top factors`) instead of the older disclosure/jargon-heavy copy.
- UI program dashboard coverage: `src/components/ProgramStatusCard.test.ts` (volume dot class logic, deload banner, week navigation, and `getVolumeDotClass` boundary assertions).
- Save-route canonical receipt enforcement coverage: `src/app/api/workouts/save/route.integration.test.ts`.
- Audit harness context/generation/serialization coverage: `src/lib/audit/workout-audit/context-builder.test.ts`, `src/lib/audit/workout-audit/generation-runner.test.ts`, `src/lib/audit/workout-audit/serializer.test.ts`.
- Audit diagnostics matrix coverage:
  - `src/lib/audit/workout-audit/intent-matrix.test.ts`
  - `src/lib/audit/workout-audit/next-session-intent-matrix.test.ts`
  - Matrix assertions keep standard/debug selection parity while verifying diagnostics gating for closure candidate trace persistence.

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
