# Architecture Cleanup Completed Summary

## Status

Cleanup initiative is functionally complete and stable after PR0.1-PR14 plus follow-ups PR14.1 (strict coverage test fix), plan-history doc correction, and a final lint cleanup.

Final health checks:
- `npm test`: pass (`68` files, `397` tests)
- `npm run verify`: pass (`lint`, `tsc`, `test:fast`, `verify:contracts`)
- `npx prisma migrate status`: schema up to date

## What Changed (High Level)

- Established and enforced a canonical verification flow (`npm run verify`) and repaired broken script paths.
- Added lifecycle guardrails (monotonic counters, deterministic week/session derivation, idempotency boundary tests).
- Removed major dual-source lifecycle behavior and separated lifecycle math/state concerns.
- Extracted save-route status state machine from the route orchestration path.
- Split explainability layers (query vs assembly) and reduced mixed-concern coupling.
- Split template-session by seams (role budgeting and closure/adjustment logic) while preserving behavior.
- Simplified test suite by deleting redundant contract/test overlaps and retaining boundary/invariant coverage.

## SSOTs Now in Place

- Verification SSOT:
  - `npm run verify` is canonical pre-merge health gate.
- Runtime contract SSOT:
  - `scripts/check-doc-runtime-contracts.ts` + `docs/contracts/runtime-contracts.json`.
- Lifecycle runtime source SSOT:
  - active lifecycle calculations use `accumulationSessionsCompleted` / `deloadSessionsCompleted`.
- Status/action/selection constants SSOT:
  - canonical validation/runtime constant exports reused across routes/modules.
- Stimulus/effective volume path SSOT:
  - canonical helpers in `src/lib/engine/stimulus.ts` and volume builders in engine volume modules.
- Template-session seams SSOT:
  - role budgeting and closure actions extracted from orchestrator into dedicated modules.

## Intentional Compatibility Remaining

- `completedSessions` is still written in save/lifecycle mutation payloads for compatibility/coexistence:
  - preserved in save route lifecycle update path and lifecycle contract helper/tests.
- `completedSessions` also remains in schema and non-runtime bootstrap/backfill scripts.
- One explicit stimulus fallback coverage warning source still surfaces during tests (`skull-crusher`) and is intentionally tolerated under current phase guardrails.

## Drift Check Notes

1) `completedSessions` scan:
- No active lifecycle read-path drift found in runtime derivation logic.
- Remaining references are compatibility writes, contract types/tests, schema, and bootstrap/backfill/test fixtures.
- `src/lib/api/program.ts` still carries a `completedSessions` field in mapped objects, but values are sourced from lifecycle counters.

2) Stimulus fallback entrypoints (`INITIAL_STIMULUS_PROFILE_BY_NAME|fallback`):
- Primary fallback engine entrypoint remains centralized in `src/lib/engine/stimulus.ts`.
- Coverage reporting/strict checks remain in `scripts/report-stimulus-profile-coverage.ts`.
- Additional `fallback` matches across the repo include unrelated generic fallback concepts (UI, explainability defaults, weekly analysis classes, progression path naming) and are not stimulus-profile fallback routing.

3) Remaining >400 LOC critical-path files (selected):
- `src/lib/api/template-session.ts` (1512)
- `src/lib/api/explainability.ts` (1153)
- `src/lib/engine/selection-v2/beam-search.ts` (956)
- `src/lib/engine/apply-loads.ts` (844)
- `src/lib/engine/stimulus.ts` (544)
- `src/lib/api/program.ts` (456)
- `src/app/api/workouts/save/route.ts` (406)

## Ranked Follow-Ups (Only If New Objective Is Opened)

1. Phase 2 stimulus fallback deletion:
   - eliminate remaining implicit fallback dependencies and close strict coverage gaps.
2. Save-route persistence extraction:
   - isolate DB transaction/persistence mechanics from route handler orchestration.
3. Template-session further decomposition:
   - continue reducing `template-session.ts` orchestration surface area.
4. Explainability final split:
   - reduce remaining assembly/scoring concentration in `explainability.ts`.
5. Selection/apply-loads module slimming:
   - reduce complexity in beam search and load application paths.

## Recommended Stop Point

Given passing health checks and drift profile, this is a reasonable close point for the cleanup initiative. Open new work only when a specific next objective is selected (for example, Phase 2 stimulus fallback deletion or save-route persistence extraction).
