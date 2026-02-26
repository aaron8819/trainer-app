# 06 Testing

Owner: Aaron
Last reviewed: 2026-02-26
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
- Save-route terminal transition coverage: `src/app/api/workouts/save/route.integration.test.ts`
- Validation/status coverage: `src/lib/validation.workout-save.test.ts`, `src/lib/validation.test.ts`, `src/lib/api/exercise-history.test.ts`, `src/lib/api/readiness.test.ts`
- Performed-history progression coverage: `src/lib/engine/apply-loads.correctness.test.ts` and `src/lib/engine/history.test.ts` (includes `PARTIAL` and malformed legacy-status handling).
- Explainability progression receipt coverage: `src/lib/api/explainability.progression-receipt.test.ts` (includes recency-window guard and `PARTIAL` + `COMPLETED` performed-status query assertions).
- Explainability session-context correctness coverage: `src/lib/engine/explainability/session-context.correctness.test.ts` (readiness availability labels and fallback cycle-source behavior).
- UI session overview copy guards: `src/lib/ui/session-overview.test.ts` (`PARTIAL`/`COMPLETED` performed basis and load-provenance wording).
- Save-route cycle-context fallback persistence coverage: `src/app/api/workouts/save/route.integration.test.ts`.

## Configuration
- Vitest include patterns: `src/**/*.test.ts` and `src/**/*.test.tsx`
- Environment: `jsdom`
- Reporter: `dot`
- Setup: `vitest.setup.ts`
