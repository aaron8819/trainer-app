# TRAINER APP - ARCHITECTURE CLEANUP EXECUTION PLAN

## 0. Response to External Review (Agree / Pushback)

### Where I Agree

- Guardrails-first sequencing is correct and should stay.
- Highest-risk modules are correctly identified: `template-session.ts`, `save/route.ts`, `mesocycle-lifecycle.ts`, `stimulus.ts`.
- PR4 (migration backup archive) should move earlier for immediate repo clarity.
- `template-session` decomposition should be split into two PRs.
- Add explicit lifecycle idempotency invariant tests.

### Pushback / Adjustment

- I agree with a single canonical verification command, but not with running only the heaviest flow on every tiny local iteration.
- Plan update:
  - `npm run verify` is mandatory pre-merge for each PR.
  - keep an optional fast local loop (`lint`, `tsc`, `test:fast`, `verify:contracts`) for inner-loop speed.

---

## 1. Execution Philosophy

- Deletion-first: remove broken, duplicate, and compatibility-only paths before introducing structure.
- Guardrails first: add/repair verification and invariant tests before risky refactors.
- SSOT enforcement: each domain concept gets one canonical source; all others import from it.
- PR-sized increments: each PR independently reviewable/releasable.
- Commit discipline: create one commit after each completed PR before starting the next PR.
- No rewrites: extract seams from large files while preserving behavior.
- Contract-first boundaries: zod/Prisma/runtime contracts drive API and persistence behavior.

---

## 2. Core Invariants (Must Never Break)

### Lifecycle Logic

- Lifecycle counters are monotonic: `accumulationSessionsCompleted`, `deloadSessionsCompleted`.
- Week/session derivation remains deterministic for identical mesocycle state.
- Deload transitions remain threshold-based and deterministic.
- `transitionMesocycleState` never decrements or replays counters.
- Repeating an identical save request must not cause lifecycle drift (idempotency at boundary level).

### Volume Accounting

- Effective volume is computed through canonical helpers only:
  - `getEffectiveStimulusByMuscle*` in `src/lib/engine/stimulus.ts`
  - `buildVolumeContext` / `buildVolumePlanByMuscle` in `src/lib/engine/volume.ts`

### Stimulus Accounting

- Stimulus coverage remains complete for production exercise set.
- No silent fallback expansion without explicit warning/failure policy.

### Persistence

- `POST /api/workouts/save` remains idempotent under same payload + revision.
- Workout status transitions remain valid and terminal rules unchanged.
- Lifecycle updates remain transactionally tied to save path.

### Selection/Optimizer

- Optimizer scoring remains deterministic for identical inputs.
- Role fixture inclusion and intent filtering remain deterministic.

---

## 3. Guardrail PRs (PR0)

### PR0.1 - Repair Broken NPM Scripts

- Purpose: remove operational dead-ends before refactors.
- Files changed:
  - `package.json`
  - optional restore file: `scripts/export-ppl-options.ts`
- Changes:
  - fix/remove `export:ppl-options` (currently missing target file)
  - fix `test:slow` cross-platform env syntax and test target
- Verify:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run export:ppl-options` (or confirm removed)
  - `npm run test:slow` (or confirm replaced/removed)

### PR0.2 - Standardize Verification Command

- Purpose: one canonical command for PR sign-off.
- Files changed:
  - `package.json`
- Changes:
  - ensure `npm run verify` covers: lint + typecheck + fast tests + contract checks
  - add/keep `npm run verify:fast` for local loops only
- Verify:
  - `npm run verify`

### PR0.3 - Add Lifecycle Invariant Tests

- Purpose: lock lifecycle behavior before SSOT refactors.
- Files changed:
  - `src/lib/api/mesocycle-lifecycle.test.ts`
  - `src/app/api/workouts/save/lifecycle-contract.test.ts`
  - `src/lib/api/next-session.test.ts`
  - `src/app/api/workouts/save/route.integration.test.ts`
- Changes:
  - assert monotonic counters, deterministic week/session mapping, transitions
  - add idempotency case: same save request repeated -> no lifecycle drift
- Verify:
  - `npx vitest run src/lib/api/mesocycle-lifecycle.test.ts src/app/api/workouts/save/lifecycle-contract.test.ts src/lib/api/next-session.test.ts src/app/api/workouts/save/route.integration.test.ts`

### PR0.4 - Stimulus Coverage Guardrail Hardening

- Purpose: prevent stimulus drift during registry cleanup.
- Files changed:
  - `src/lib/api/template-session/context-loader.ts`
  - `src/lib/engine/stimulus.test.ts`
  - `scripts/report-stimulus-profile-coverage.ts`
- Changes:
  - tighten strict coverage mode for CI/cleanup flow
- Verify:
  - `npm run report:stimulus-coverage`
  - `npm run test:fast`

---

## 4. PR Dependency Graph

```text
PR0 (guardrails)
 |- PR4 archive migration backups (early noise reduction)
 |- PR1 lifecycle SSOT (remove dual-source week logic)
 |   |- PR7 split lifecycle math/state modules
 |   `- PR12 compatibility deletion
 |- PR2 volume target SSOT
 |   `- PR5 remove duplicate target calculators (engine/scripts/api)
 |- PR3 constants SSOT (statuses/intents/modes)
 |   `- PR6 taxonomy/stimulus SSOT
 |- PR8 large-file extraction: save route
 |- PR9 large-file extraction: mesocycle-lifecycle
 |- PR10 large-file extraction: explainability
 |- PR11 template-session role budgeting extraction
 |- PR12 template-session closure loop extraction
 `- PR13 test suite simplification/deletions
```

---

## 5. Core Cleanup Roadmap (Sequenced PRs)

### PR4 - Archive Migration Backups Out of Active Prisma Path

- Problem: `prisma/migrations_backup` creates noise and confusion.
- Files touched:
  - `prisma/migrations_backup/**` (move)
  - `docs/archive/**` (archive index/location)
- Summary:
  - move backup SQL snapshots out of active Prisma tree
- Risk: Low
- Verification:
  - `npx prisma migrate status`
  - `npm run lint`
- Dependencies: PR0

### PR1 - Remove Lifecycle Dual-Source (`completedSessions`)

- Problem: lifecycle/periodization week logic split across legacy and new counters.
- Files touched:
  - `src/lib/api/periodization.ts`
  - `src/lib/api/program.ts`
  - `src/lib/api/mesocycle-lifecycle.ts`
  - optional later schema cleanup: `prisma/schema.prisma`
- Summary:
  - stop using `completedSessions` as runtime lifecycle source
  - use only `accumulationSessionsCompleted` / `deloadSessionsCompleted`
- Risk: Medium
- Verification:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npx vitest run src/lib/api/mesocycle-lifecycle.test.ts src/lib/api/program.test.ts src/lib/api/next-session.test.ts`
- Dependencies: PR0, PR4

### PR2 - Centralize Weekly Volume Target Interpolation

- Problem: duplicated interpolation in engine/api/scripts.
- Files touched:
  - `src/lib/engine/volume-landmarks.ts` or new `src/lib/engine/volume-targets.ts`
  - `src/lib/engine/volume.ts`
  - `src/lib/api/mesocycle-lifecycle.ts`
  - `scripts/report-weekly-volume-targets.ts`
- Summary:
  - one canonical interpolation function used everywhere
- Risk: Low
- Verification:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npx vitest run src/lib/api/mesocycle-lifecycle.test.ts src/lib/engine/volume-landmarks.test.ts`
  - `npm run report:weekly-volume-targets`
- Dependencies: PR0

### PR3 - Remove Duplicate Constants Across Routes/Modules

- Problem: status/mode/intent constants duplicated and drift-prone.
- Files touched:
  - `src/app/api/analytics/summary/route.ts`
  - `src/lib/api/template-session/deload-session.ts`
  - `src/lib/validation.ts`
  - `src/lib/workout-status.ts`
- Summary:
  - replace route/local constants with canonical imports
- Risk: Low
- Verification:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run test:fast`
- Dependencies: PR0

### PR5 - Enforce Stimulus Profile SSOT (Phase 1: Coverage Enforcement)

- Problem: mixed explicit + fallback stimulus profile paths.
- Files touched:
  - `src/lib/engine/stimulus.ts`
  - `src/lib/api/workout-context.ts`
  - `scripts/report-stimulus-profile-coverage.ts`
- Summary:
  - tighten coverage gates and reduce name-based fallback usage
- Risk: Medium
- Verification:
  - `npm run report:stimulus-coverage`
  - `npm run test:fast`
- Dependencies: PR0, PR2, PR3

### PR6 - Taxonomy SSOT via Canonical Types

- Problem: taxonomy duplicated across Prisma, engine types, seed maps, UI labels.
- Files touched:
  - `src/lib/engine/types.ts`
  - `prisma/seed.ts`
  - `src/lib/exercise-library/constants.ts`
- Summary:
  - align runtime taxonomy to canonical schema source
- Risk: Medium
- Verification:
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run verify:exercise-library`
- Dependencies: PR3, PR5

### PR7 - Split Lifecycle Math from Lifecycle State Transitions

- Problem: pure math and DB side effects coupled in one module.
- Files touched:
  - `src/lib/api/mesocycle-lifecycle.ts`
  - `src/lib/api/mesocycle-lifecycle-math.ts` (new)
  - `src/lib/api/mesocycle-lifecycle-state.ts` (new)
- Summary:
  - extract pure week/RIR/volume/session derivation from transition orchestration
- Risk: Medium
- Verification:
  - `npx vitest run src/lib/api/mesocycle-lifecycle.test.ts`
  - `npm run lint`
  - `npx tsc --noEmit`
- Dependencies: PR1, PR2

### PR8 - Save Route Extraction (Status Machine First)

- Problem: `save/route.ts` mixes status machine + persistence + lifecycle branching.
- Files touched:
  - `src/app/api/workouts/save/route.ts`
  - `src/app/api/workouts/save/status-machine.ts` (new)
  - optional follow-up: `src/app/api/workouts/save/persistence.ts`
- Summary:
  - extract pure action/final-status resolution first
- Risk: Medium
- Verification:
  - `npx vitest run src/app/api/workouts/save/route.integration.test.ts src/app/api/workouts/save/lifecycle-contract.test.ts`
  - `npm run lint`
- Dependencies: PR0, PR1

### PR9 - Mesocycle Lifecycle Module Extraction Follow-Up

- Problem: remaining lifecycle module responsibilities still broad after PR7.
- Files touched:
  - `src/lib/api/mesocycle-lifecycle.ts`
  - extracted helper modules introduced in PR7
- Summary:
  - complete separation of read-only derivation helpers vs mutation/state-transition helpers
- Risk: Medium
- Verification:
  - `npx vitest run src/lib/api/mesocycle-lifecycle.test.ts src/lib/api/program.test.ts src/lib/api/next-session.test.ts`
  - `npm run lint`
- Dependencies: PR7

### PR10 - Explainability Layer Split (Query vs Assembly)

- Problem: explainability module mixes DB reads and assembly/scoring.
- Files touched:
  - `src/lib/api/explainability.ts`
  - `src/lib/api/explainability/query.ts` (new)
  - `src/lib/api/explainability/assembly.ts` (new)
- Summary:
  - extract query layer first, keep external behavior unchanged
- Risk: Medium
- Verification:
  - `npx vitest run src/lib/api/explainability.progression-receipt.test.ts src/lib/api/explainability.volume-compliance.test.ts`
  - `npm run lint`
- Dependencies: PR0, PR3

### PR11 - Template Session Decomposition (Role Budgeting Seam)

- Problem: `template-session.ts` is oversized and mixes multiple responsibilities.
- Files touched:
  - `src/lib/api/template-session.ts`
  - `src/lib/api/template-session/role-budgeting.ts` (new)
- Summary:
  - extract role fixture budgeting and related diagnostics first
- Risk: High
- Verification:
  - `npm run test:fast`
  - `npx vitest run src/lib/api/template-session.test.ts src/lib/api/template-session.pull-week2.integration.test.ts src/lib/api/template-session.push-week3.regression.test.ts`
- Dependencies: PR0, PR1, PR2, PR5

### PR12 - Template Session Decomposition (Closure/Adjustment Seam)

- Problem: closure add/drop/adjustment logic still embedded in orchestrator.
- Files touched:
  - `src/lib/api/template-session.ts`
  - `src/lib/api/template-session/closure-actions.ts` (new)
- Summary:
  - extract closure loop and keep API stable
- Risk: High
- Verification:
  - `npm run test:fast`
  - `npx vitest run src/lib/api/template-session.test.ts src/lib/api/template-session.pull-week2.integration.test.ts src/lib/api/template-session.push-week3.regression.test.ts`
- Dependencies: PR11

### PR13 - Remove Compatibility-Only Save/Metadata Residue

- Problem: compatibility rejection logic remains broad/duplicated.
- Files touched:
  - `src/lib/validation.ts`
  - `src/lib/ui/selection-metadata.ts`
  - `src/app/api/workouts/save/route.integration.test.ts`
  - `src/lib/validation.workout-save.test.ts`
- Summary:
  - remove dead compatibility fields and simplify boundary checks
- Risk: Medium
- Verification:
  - `npx vitest run src/app/api/workouts/save/route.integration.test.ts src/lib/validation.workout-save.test.ts src/lib/contracts-runtime.test.ts`
  - `npm run verify:contracts`
- Dependencies: PR8, PR12

### PR14 - Test Suite Simplification and Redundancy Cleanup

- Problem: oversized/redundant compatibility and contract test coverage.
- Files touched:
  - `src/lib/validation.workout-save.test.ts`
  - `src/lib/contracts-runtime.test.ts` (or contract script overlap target)
  - `src/lib/api/template-session.push-week3.regression.test.ts`
- Summary:
  - keep highest-leverage boundary/invariant tests, remove duplicate assertions
- Risk: Low-Medium
- Verification:
  - `npm test`
  - `npm run verify:contracts`
  - `npm run test:fast`
- Dependencies: PR0-PR13

---

## 6. Large File Refactor Plan

### `src/lib/api/template-session.ts`

- Responsibilities:
  - intent/template generation orchestration
  - role fixture continuity
  - optimizer prep/selection mapping
  - deload path switching
- Problems:
  - hard to reason about invariants, high regression risk, test fixture explosion
- Incremental strategy:
  - PR11 extract role budgeting seam
  - PR12 extract closure/adjustment seam
  - keep orchestrator as thin coordinator
- First safe extraction step:
  - move role-budgeting helpers and diagnostics writes to `template-session/role-budgeting.ts`

### `src/lib/api/explainability.ts`

- Responsibilities:
  - query history/workout context
  - compute compliance and progression narrative
  - shape API output
- Problems:
  - DB + compute + DTO concerns tightly coupled
- Incremental strategy:
  - extract query layer first
  - then pure scoring/assembly helpers
- First safe extraction step:
  - create `explainability/query.ts` and call it from existing module

### `src/lib/api/mesocycle-lifecycle.ts`

- Responsibilities:
  - week/session derivation
  - volume/RIR targets
  - state transitions + next mesocycle initialization
- Problems:
  - pure math and side effects mixed; dual-source lifecycle risk
- Incremental strategy:
  - extract pure math module (PR7)
  - isolate state transition orchestration (PR9)
- First safe extraction step:
  - move `deriveCurrentMesocycleSession`, `getRirTarget`, `getWeeklyVolumeTarget` to pure module

### `src/app/api/workouts/save/route.ts`

- Responsibilities:
  - request validation
  - action/status inference
  - transactional upsert/rewrite
  - lifecycle update trigger
- Problems:
  - large transactional flow, hard to review correctness changes
- Incremental strategy:
  - extract pure status machine first (PR8)
  - optional follow-up extract persistence command helpers
- First safe extraction step:
  - move `inferAction` + final status resolution into `status-machine.ts`

---

## 7. Deletion Plan

### 1) Broken script entry

- Path: `package.json` (`export:ppl-options`)
- Reason: points to missing file
- Proof of safety: command already fails in current repo
- Verify: `npm run export:ppl-options` no longer fails (removed or repaired)

### 2) Broken slow-test command

- Path: `package.json` (`test:slow`)
- Reason: Windows-incompatible env syntax + missing target file
- Proof of safety: command currently unusable
- Verify: `npm run test:slow` works or is intentionally replaced/removed

### 3) Duplicate performed status constant

- Path: `src/lib/api/template-session/deload-session.ts`
- Reason: duplicates canonical `PERFORMED_WORKOUT_STATUSES`
- Proof of safety: replace with import from `src/lib/workout-status.ts`
- Verify: `npm run test:fast`

### 4) Route-local duplicate selection mode table

- Path: `src/app/api/analytics/summary/route.ts`
- Reason: duplicates contract constants
- Proof of safety: import from canonical constants
- Verify: `npx vitest run src/lib/api/analytics-semantics.test.ts`

### 5) Legacy runtime counter source

- Path: `src/lib/api/periodization.ts` (`completedSessions` path)
- Reason: conflicts with lifecycle counters used elsewhere
- Proof of safety: lifecycle/program/next-session tests cover behavior
- Verify: lifecycle/program/next-session targeted test commands

### 6) Duplicate volume target calculators

- Paths:
  - `src/lib/engine/volume.ts` (`getTargetVolume`)
  - `src/lib/api/mesocycle-lifecycle.ts` (`getWeeklyVolumeTarget`)
  - `scripts/report-weekly-volume-targets.ts` local mirror
- Reason: formula drift risk
- Proof of safety: all callers switched to shared helper + test comparison
- Verify: `npm run test:fast`, lifecycle tests, report script

### 7) Migration backup runtime clutter

- Path: `prisma/migrations_backup/**`
- Reason: non-runtime historical snapshots in active schema tree
- Proof of safety: not used by active migrations
- Verify: `npx prisma migrate status`

### 8) Stimulus fallback registry (phase-gated deletion)

- Path: `src/lib/engine/stimulus.ts` (`INITIAL_STIMULUS_PROFILE_BY_NAME`, fallback builder)
- Reason: not SSOT; drift against DB stimulus metadata
- Proof of safety: only after strict coverage reaches zero for production set
- Verify: `npm run report:stimulus-coverage` then full test pass

### 9) Redundant compatibility test assertions

- Paths:
  - `src/lib/validation.workout-save.test.ts`
  - overlapping checks in `src/app/api/workouts/save/route.integration.test.ts`
- Reason: duplicated behavior checks across layers
- Proof of safety: retain single highest-value boundary test per rule
- Verify: `npm test`

---

## 8. Test Suite Simplification Plan

### Delete

- Compatibility-only duplicate tests in `src/lib/validation.workout-save.test.ts` once save-route integration covers the same boundary.
- Duplicate contract parity checks when both script and test assert the same contract set.

### Merge

- Consolidate lifecycle behavior checks into focused suites spanning:
  - `mesocycle-lifecycle`
  - save lifecycle contract
  - next-session derivation
- Consolidate selection metadata compatibility checks into one boundary suite.

### Add

- High-leverage invariants:
  - deterministic week/session derivation for identical counters
  - monotonic lifecycle counter transitions across save calls
  - lifecycle idempotency under repeated identical save request
  - canonical effective-volume path assertions (no alternate calculators)
  - taxonomy consistency test (Prisma enum <-> runtime type mapping)

### Goal State

- Smaller suite, stronger guarantees:
  - fewer compatibility-era tests
  - more invariant/property-style tests around lifecycle, accounting, and contracts

---

## 9. Deep Audit Modules (Next)

### `src/lib/api/template-session.ts`

- Why critical: central orchestration for workout generation
- Audit should check:
  - role fixture continuity invariants
  - closure add/drop scoring correctness
  - intent filter correctness across intents

### `src/app/api/workouts/save/route.ts`

- Why critical: highest-risk write boundary
- Audit should check:
  - transaction boundaries and idempotency
  - revision conflict behavior
  - lifecycle update ordering and failure handling

### `src/lib/api/mesocycle-lifecycle.ts` + `src/lib/api/periodization.ts`

- Why critical: lifecycle and temporal correctness
- Audit should check:
  - single-source week derivation
  - transition threshold correctness
  - remaining dual-source reads

### `src/lib/engine/stimulus.ts` + `prisma/seed.ts`

- Why critical: accounting correctness for optimizer and analytics
- Audit should check:
  - fallback elimination readiness
  - profile completeness and naming drift
  - muscle key normalization consistency

### `src/lib/api/explainability.ts`

- Why critical: user-visible rationale integrity
- Audit should check:
  - consistency with selection/volume calculations
  - stale alias/fallback residue

---

## 10. Effort Estimate

- Small (1-2 hours):
  - PR0.1, PR0.2, PR3, PR4
- Medium (half day):
  - PR0.3, PR0.4, PR2, PR5, PR8
- Large (1-2 days):
  - PR1, PR6, PR7, PR9, PR10, PR11, PR12, PR13, PR14

---

## 11. Top 10 Actions (Highest Impact / Lowest Risk)

1. Fix/remove broken scripts in `package.json`.
2. Use `npm run verify` as the canonical pre-merge command for cleanup PRs.
3. Move `prisma/migrations_backup` out of active Prisma tree early.
4. Replace route-local status/mode constants with canonical imports.
5. Centralize weekly volume interpolation and delete duplicates.
6. Stop using `completedSessions` for active lifecycle calculations.
7. Add lifecycle monotonic/determinism/idempotency invariant tests.
8. Tighten stimulus coverage guardrails before fallback removal.
9. Extract save-route status state machine into pure helper.
10. Split `template-session.ts` via role-budgeting seam first, then closure seam.

---

## Baseline Verification Commands

```bash
# Mandatory pre-merge for each cleanup PR
npm run verify
```

## Additional Targeted Commands

```bash
# Optional fast local loop
npm run verify:fast

# PR-specific targeted checks
npx vitest run src/lib/api/mesocycle-lifecycle.test.ts src/lib/api/next-session.test.ts src/lib/api/program.test.ts
npx vitest run src/app/api/workouts/save/route.integration.test.ts src/app/api/workouts/save/lifecycle-contract.test.ts
npm run report:stimulus-coverage
npx prisma migrate status
```
