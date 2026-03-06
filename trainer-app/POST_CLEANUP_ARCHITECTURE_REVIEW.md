# Post-Cleanup Architecture Review

Date: 2026-03-06
Scope: post-cleanup delta review against the current codebase, not a from-scratch audit.

Current baseline:
- `npm run verify` passes.
- Doc/runtime enum contract verification passes via `scripts/check-doc-runtime-contracts.ts`.
- Residual hygiene signals are limited to two lint warnings in user-modified UI files and one known centralized stimulus fallback warning for `EZ-Bar Skull Crusher`.

## 1. Cleanup Impact Assessment

| Area | Assessment | Evidence |
| --- | --- | --- |
| Architectural clarity | Improved | Lifecycle logic is now explicitly split into facade + math + state modules in `src/lib/api/mesocycle-lifecycle.ts`, `src/lib/api/mesocycle-lifecycle-math.ts`, and `src/lib/api/mesocycle-lifecycle-state.ts`. Save-route status resolution and lifecycle contract logic are extracted into `src/app/api/workouts/save/status-machine.ts` and `src/app/api/workouts/save/lifecycle-contract.ts`. Explainability query/assembly seams exist in `src/lib/api/explainability/query.ts` and `src/lib/api/explainability/assembly.ts`. |
| SSOT enforcement | Improved | Runtime session decision ownership is receipt-first and enforced at save in `src/app/api/workouts/save/route.ts` via `WORKOUT_SELECTION_METADATA_REQUIRED`, with parsing/normalization centralized in `src/lib/evidence/session-decision-receipt.ts`. Weekly volume interpolation is centralized in `src/lib/engine/volume-targets.ts` and consumed from `src/lib/api/mesocycle-lifecycle-math.ts` and `src/lib/engine/volume.ts`. |
| Workflow simplicity | Improved | `package.json` now exposes a canonical `verify` path (`verify -> verify:fast -> lint + tsc + test:fast + verify:contracts`). Contract drift checking is scripted in `scripts/check-doc-runtime-contracts.ts`. Stimulus and weekly-volume reporting are explicit commands in `package.json`. |
| Test reliability | Improved | High-risk seams have direct coverage: `src/app/api/workouts/save/route.integration.test.ts`, `src/app/api/workouts/save/lifecycle-contract.test.ts`, `src/lib/api/mesocycle-lifecycle.test.ts`, `src/lib/api/explainability.volume-compliance.test.ts`, `src/app/api/workouts/receipt-pipeline.integration.test.ts`, `src/lib/api/template-session.push-week3.regression.test.ts`. |
| Module boundaries | Partially improved | Boundaries are clearer than before, but the main orchestration files remain concentrated: `src/lib/api/template-session.ts` is still 1512 LOC and `src/lib/api/explainability.ts` is still 1153 LOC even after seam extraction. The cleanup reduced ambiguity more than it reduced centralization. |

Conclusion: complexity did go down materially in ownership clarity and verification flow, but not evenly. The biggest gain is reduced ambiguity, not uniformly smaller modules.

## 2. Remaining Architectural Risks

### 1. Transitional stimulus fallback remains a live semantic escape hatch
- Evidence: `src/lib/engine/stimulus.ts` still contains `INITIAL_STIMULUS_PROFILE_BY_NAME`, `buildFallbackStimulusProfile()`, `resolveStimulusProfile()`, `collectStimulusFallbackExercises()`, and `validateStimulusProfileCoverage()`. Enforcement is optional through `STRICT_STIMULUS_PROFILE_COVERAGE` in `src/lib/api/template-session/context-loader.ts` and reporting in `scripts/report-stimulus-profile-coverage.ts`.
- Risk level: High
- Recommendation: complete Phase 2 deletion by removing remaining implicit fallback usage and making explicit profiles mandatory for planner-eligible exercises.

### 2. Lifecycle compatibility residue still writes `completedSessions`
- Evidence: `src/app/api/workouts/save/lifecycle-contract.ts` still increments `completedSessions`; `src/app/api/workouts/save/route.ts` writes that payload; `src/lib/api/program.ts` still exposes `completedSessions` on `ProgramMesoSummary` and writes it in `applyCycleAnchor()`. The schema column also remains in `prisma/schema.prisma`.
- Risk level: Medium
- Recommendation: keep treating `accumulationSessionsCompleted` / `deloadSessionsCompleted` as canonical, but document `completedSessions` as explicit compatibility debt until it is removed.

### 3. `template-session.ts` is still an oversized orchestration center
- Evidence: `src/lib/api/template-session.ts` still owns intent generation, role-fixture budgeting integration, closure scoring/selection helpers, planner diagnostics assembly, and deload entrypoints, even after extracting `context-loader`, `role-budgeting`, `closure-actions`, `plan-assembly`, and `finalize-session`.
- Risk level: Medium
- Recommendation: do not rewrite broadly; treat this as controlled debt and only continue slimming if a focused seam can remove one full concern cleanly.

### 4. `explainability.ts` still mixes orchestration with domain-heavy assembly
- Evidence: `src/lib/api/explainability.ts` imports the new query/assembly seams but still owns stats derivation, rationale parsing, progression receipt assembly, history confidence rules, anomaly analysis, and volume compliance.
- Risk level: Medium
- Recommendation: keep the current split, but any future explainability work should move a full subdomain out rather than adding more local helpers here.

### 5. Program/dashboard read model still carries fallback-style semantics
- Evidence: `src/lib/api/program.ts` still uses static `BLOCK_COACHING_CUES`, retains a `completedSessions` compatibility field, and performs legacy week scoping fallback in `loadMesoWeekMuscleVolume()` via `mesocycleWeekSnapshot` or bounded date fallback.
- Risk level: Medium
- Recommendation: keep the snapshot-first behavior, but document the remaining legacy fallback and compatibility fields more explicitly in canonical docs.

### 6. Canonical docs are mostly aligned, but residual debt is under-documented
- Evidence: `docs/01_ARCHITECTURE.md` and `docs/02_DOMAIN_ENGINE.md` describe the canonical path correctly, but they do not explicitly call out the still-active `completedSessions` compatibility writes or the still-active stimulus fallback path as post-cleanup debt.
- Risk level: Medium
- Recommendation: next doc pass should add a small “remaining compatibility/debt” note instead of reopening broader architecture prose.

## 3. Drift Check

| Domain | Current SSOT | Residual drift risk | Why |
| --- | --- | --- | --- |
| Lifecycle | `src/lib/api/mesocycle-lifecycle-math.ts`, `src/lib/api/mesocycle-lifecycle-state.ts`, save-route lifecycle boundary in `src/app/api/workouts/save/lifecycle-contract.ts` | Medium | Runtime ownership is clear, but `completedSessions` is still written for coexistence in save/program paths. |
| Stimulus | `src/lib/engine/stimulus.ts` | Medium | The SSOT is centralized, but it still contains a transitional fallback path and optional strict enforcement rather than hard enforcement. |
| Volume targeting | `src/lib/engine/volume-targets.ts` | Low | Interpolation is centralized and reused by lifecycle math and reporting. This area now has a real shared target function instead of duplicate math. |
| Taxonomy | Exercise library metadata plus contract/verification scripts (`scripts/verify-exercise-library.ts`, `scripts/repair-exercise-library.ts`) | Low | Cleanup tightened taxonomy ownership and guardrails. Residual risk is mostly data hygiene, not code-path ambiguity. |
| Route contracts | `src/lib/validation.ts` plus `docs/contracts/runtime-contracts.json` verified by `scripts/check-doc-runtime-contracts.ts` | Low | Contract values are centralized and verified; save/generate routes also have direct tests. |
| Docs vs implementation | Canonical docs `docs/01_ARCHITECTURE.md`, `docs/02_DOMAIN_ENGINE.md`, `docs/06_TESTING.md`, `docs/07_OPERATIONS.md` | Medium | The main architecture is aligned, but residual compatibility/fallback debt is more visible in code than in docs. |

## 4. Large File Review

### `src/lib/api/template-session.ts` (~1512 LOC)
- Role: primary session-generation orchestrator for intent/template/deload flows.
- Why still large: it still owns closure-scoring helpers, role-fixture integration, planner diagnostics assembly, and multiple entrypoints.
- Acceptable now: Yes, provisionally. The extracted seams are real, and the file is large because it remains the planner hub.
- Focused audit next: Not first. Only revisit if a single concern can be extracted without destabilizing the planner.

### `src/lib/api/explainability.ts` (~1153 LOC)
- Role: top-level explainability facade and assembly pipeline.
- Why still large: it still carries progression receipt logic, historical confidence rules, rationale normalization, workout stats, and volume compliance.
- Acceptable now: Borderline but acceptable. The new query/assembly seams reduced boundary ambiguity even though the facade stayed large.
- Focused audit next: Maybe, but lower priority than stimulus fallback deletion.

### `src/lib/api/program.ts` (~622 LOC)
- Role: dashboard read model, block-phase helpers, week-volume queries, next-session support, and cycle anchor mutations.
- Why still large: it mixes read-model loading, coaching-cue semantics, gap-fill support, and cycle anchor writes.
- Acceptable now: Mostly yes, but this is still a central coupling point between lifecycle and home/program surfaces.
- Focused audit next: No immediate refactor required, but this file should be watched for further scope creep.

### `src/lib/engine/stimulus.ts` (~544 LOC)
- Role: weighted stimulus SSOT, explicit profile lookup, fallback mapping, muscle-id mapping, and coverage validation.
- Why still large: it owns both the canonical math and the transitional migration/fallback policy.
- Acceptable now: Only temporarily.
- Focused audit next: Yes, this is the strongest candidate because the file is large for a reason that still represents active semantic debt.

### `src/app/api/workouts/save/route.ts` (~437 LOC)
- Role: workout save transaction boundary.
- Why still large: it still has to coordinate validation, receipt enforcement, mesocycle snapshotting, persistence, and rewrite behavior in one transaction.
- Acceptable now: Yes. The highest-risk logic has already been split into `status-machine.ts` and `lifecycle-contract.ts`.
- Focused audit next: No. This file is no longer the top architectural concern.

### `src/lib/engine/selection-v2/beam-search.ts` (~956 LOC)
- Role: optimizer implementation.
- Why still large: algorithmic core, not general orchestration drift.
- Acceptable now: Yes.
- Focused audit next: No, unless optimizer behavior changes.

### `src/lib/engine/apply-loads.ts` (~845 LOC)
- Role: load assignment and progression anchoring.
- Why still large: dense domain logic and correctness branching.
- Acceptable now: Yes, given the matching correctness coverage.
- Focused audit next: No immediate architecture action needed.

## 5. Documentation Alignment Check

| Doc | Assessment | What should change |
| --- | --- | --- |
| `docs/00_START_HERE.md` | Aligned | No structural change needed. It correctly points canonical ownership back to code and the contracts doc. |
| `docs/01_ARCHITECTURE.md` | Aligned | Optional small update: add a brief note that `completedSessions` still exists as compatibility residue even though lifecycle SSOT moved to `accumulationSessionsCompleted` / `deloadSessionsCompleted`. |
| `docs/02_DOMAIN_ENGINE.md` | Partially aligned | Add one short residual-debt note for the still-active stimulus fallback path and one note that `completedSessions` may still be written for coexistence even though it is not the lifecycle SSOT. |
| `docs/06_TESTING.md` | Aligned | No major change needed. It matches the current `verify` path and high-risk regression coverage. |
| `docs/07_OPERATIONS.md` | Partially aligned | Add `npm run report:weekly-volume-targets` from `package.json`. Consider noting that current verification may still emit the known centralized stimulus fallback warning until fallback deletion is complete. |

Overall: canonical docs are substantially aligned with the post-cleanup architecture, but they under-document the remaining compatibility/fallback debt.

## 6. Next Best Initiative

Selected initiative: stimulus fallback Phase 2 deletion

Why it is highest value:
- It removes the last active semantic escape hatch in one of the most cross-cutting domains: planning, effective volume accounting, and explainability all depend on stimulus resolution.
- The repo already surfaces this debt explicitly through `report:stimulus-coverage`, `validateStimulusProfileCoverage()`, and the live fallback warning during `npm run verify`.

Why now:
- The cleanup already centralized stimulus ownership into one file and added guardrails.
- This is the point where finishing the migration yields a cleaner architecture than starting another large-file slimming effort.

Scope:
- Eliminate remaining planner-eligible fallback users.
- Make strict coverage the default runtime behavior for planner-eligible exercises.
- Remove fallback-only mapping branches that no longer serve live data.

Risk:
- Low to Medium. This is data-and-guardrail work more than structural refactoring, but it can break generation if uncovered exercises remain.

Expected payoff:
- Lower drift risk across stimulus, volume compliance, and selection behavior.
- Simpler semantics in `src/lib/engine/stimulus.ts`.
- Fewer “cleanup complete, except fallback” caveats in both code and docs.

## 7. Stop / Continue Recommendation

CONTINUE — one focused initiative is justified.

Reason:
- The cleanup achieved its primary goal. SSOT ownership, test guardrails, and verification flow are materially better now.
- The remaining highest-value issue is narrow and well-defined: the still-active stimulus fallback path.
- Broader architectural refactoring is not justified now. One targeted initiative is enough; beyond that, the cleanup should be considered complete.
