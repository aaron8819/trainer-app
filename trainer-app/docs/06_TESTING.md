# 06 Testing

Owner: Aaron
Last reviewed: 2026-03-04
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
- `npm run verify`: lint + type-check (`tsc --noEmit`) + tests + contract verification
- `npm run verify:contracts`: docs/runtime enum drift check

## Scope
- Engine tests: `src/lib/engine/**/*.test.ts`
- API helper tests: `src/lib/api/**/*.test.ts`
- UI tests: component tests under `src/components/**`
- UI session summary-model coverage: `src/lib/ui/session-summary.test.ts` (receipt-first summary text/tags/items, including deload, soreness hold, and readiness-scaling cases).
- Save-route terminal transition coverage: `src/app/api/workouts/save/route.integration.test.ts`
- Validation/status coverage: `src/lib/validation.workout-save.test.ts`, `src/lib/validation.test.ts`, `src/lib/api/exercise-history.test.ts`, `src/lib/api/readiness.test.ts`
- Performed-history progression coverage: `src/lib/engine/apply-loads.correctness.test.ts` and `src/lib/engine/history.test.ts` (includes `PARTIAL` and malformed legacy-status handling; also covers top-set anchor correctness and bodyweight early-exit behavior).
- Double-progression decision coverage: `src/lib/engine/progression.correctness.test.ts` (covers `computeDoubleProgressionDecision` paths, bodyweight rep-only progression, high-variance trimming, confidence scaling, and `anchorOverride` pass-through).
- Mesocycle lifecycle coverage: `src/lib/api/mesocycle-lifecycle.test.ts` (duration-aware week derivation, accumulation/deload thresholds, volume ramping, and default RIR bands for 4-, 5-, and 6-week mesocycles).
- Periodization bridge coverage: `src/lib/engine/periodization.correctness.test.ts` asserts that longer accumulation phases continue progressing before deload rather than hard-stopping at week 4.
- Template-session regression coverage: `src/lib/api/template-session.push-week3.regression.test.ts` (W3S1 Push scenario covering CORE_COMPOUND set-count cap ≤5, bodyweight Dip `targetLoad=0`, and top-set load anchoring ≥ top-set history value across 0-based and 1-based `setIndex` history).
- Volume landmark coverage: `src/lib/engine/volume-landmarks.test.ts` (MEV/MAV/MRV values for all muscles; ramp interpolation correctness).
- Explainability volume compliance coverage: `src/lib/api/explainability.volume-compliance.test.ts` (meso-week scoped muscle volume, compliance status classification, and `UNDER_MEV`/`OVER_MAV` boundary assertions).
- Workout generation route contract coverage: `src/app/api/workouts/generate-from-intent/route.test.ts` and `src/app/api/workouts/generate-from-template/route.test.ts` assert receipt-first `selectionMetadata` responses and absence of top-level generation autoregulation payloads.
- Explainability progression receipt coverage: `src/lib/api/explainability.progression-receipt.test.ts` (includes recency-window guard and `PARTIAL` + `COMPLETED` performed-status query assertions).
- Canonical session receipt coverage: `src/lib/evidence/session-decision-receipt.test.ts` (receipt build/parse/read behavior and canonical-only extraction from `selectionMetadata.sessionDecisionReceipt`).
- Selection metadata sanitization coverage: `src/lib/ui/selection-metadata.test.ts` (save-safe metadata keeps canonical `sessionDecisionReceipt`, drops legacy top-level session mirrors, and keeps generation readiness context inside the receipt).
- Persisted mesocycle snapshot normalization coverage: `src/lib/api/workout-mesocycle-snapshot.test.ts` and `src/lib/ui/workout-list-items.test.ts` cover the shared normalized snapshot helper and list-surface summary builder used by history/recent-workout UI.
- Explainability session-context correctness coverage: `src/lib/engine/explainability/session-context.correctness.test.ts` (readiness availability labels and fallback cycle-source behavior).
- End-to-end-ish receipt pipeline coverage: `src/app/api/workouts/receipt-pipeline.integration.test.ts` (generate -> save -> explainability with canonical `sessionDecisionReceipt` and no legacy fallback).
- UI session overview copy guards: `src/lib/ui/session-overview.test.ts` (`PARTIAL`/`COMPLETED` performed basis and load-provenance wording).
- Explainability panel UI coverage: `src/components/explainability/ExplainabilityPanel.test.tsx` now also asserts the simplified audit labels (`Exercise details`, `Why it made the plan`, `Main factors`) instead of the older engine-jargon labels.
- UI program dashboard coverage: `src/components/ProgramStatusCard.test.ts` (volume dot class logic, deload banner, week navigation, and `getVolumeDotClass` boundary assertions).
- Save-route canonical receipt enforcement coverage: `src/app/api/workouts/save/route.integration.test.ts`.

## Configuration
- Vitest include patterns: `src/**/*.test.ts` and `src/**/*.test.tsx`
- Environment: `jsdom`
- Reporter: `dot`
- Setup: `vitest.setup.ts`
