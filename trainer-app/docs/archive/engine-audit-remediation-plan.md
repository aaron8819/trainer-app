# Engine Audit Remediation Implementation Plan

**Date:** 2026-02-11  
**Inputs:** `docs/analysis/engine-audit-findings.md`, `docs/analysis/engine-audit-findings-evaluation.md`  
**Scope:** Findings 1-15 from the engine audit.  
**Out of scope for remediation closure:** Finding 16 (future feature).

## Goal

Implement and validate all scoped findings (1-15) with deterministic behavior, explicit rollback controls, and measurable acceptance criteria.

## Finalized decisions

| ID | Decision | Selected Option | Rationale | Date |
| --- | --- | --- | --- | --- |
| D1 | Indirect volume multiplier | `0.3` | Conservative discount on indirect overlap, reduces false-positive cap pruning, matches weekly scorer semantics | 2026-02-11 |
| D2 | Fat-loss policy approach | Option A (minimal path) | Small targeted policy changes without enum/architecture refactor | 2026-02-11 |

## Guardrails

1. No regressions in active generation flow: `generateSessionFromTemplate -> generateWorkoutFromTemplate -> applyLoads`.
2. All behavior-changing changes in findings 1, 3, 10 are flag-gated.
3. Every acceptance criterion maps to at least one named test.
4. Update runtime docs for each behavior change.

## Feature flags and rollback

| Flag | Default | Kill-switch location | Purpose |
| --- | --- | --- | --- |
| `USE_EFFECTIVE_VOLUME_CAPS` | `false` | `src/lib/engine/volume.ts` cap predicate | Gates effective-set MRV checks (findings 1 and 2) |
| `USE_REVISED_FAT_LOSS_POLICY` | `false` | `src/lib/engine/rules.ts` and `src/lib/engine/prescription.ts` | Gates revised fat-loss reps, RPE, and set reduction (finding 3) |
| `USE_MAIN_LIFT_PLATEAU_DETECTION` | `false` | `src/lib/engine/progression.ts` | Gates main-lift e1RM plateau trigger (finding 10) |

### Flag parsing standard

1. Follow the existing `USE_DB_SRA_WINDOWS` parser pattern.
2. Truthy values: `1`, `true`, `yes`, `on`.
3. Missing/empty uses default.
4. Any other explicit value is treated as disabled.

### Rollout checklist for flag-gated changes

1. Merge with all three flags off.
2. Enable one flag at a time in Vercel environment variables (or `.env.local` for staging).
3. After each flag flip, generate a workout from an existing template and verify:
- no runtime errors
- expected behavior change for that specific flag
4. Recommended enable order:
- `USE_REVISED_FAT_LOSS_POLICY` first (lowest blast radius; fat-loss goal users only)
- `USE_EFFECTIVE_VOLUME_CAPS` second (broadest impact; enhanced-mode generation)
- `USE_MAIN_LIFT_PLATEAU_DETECTION` third (requires sufficient history to exercise path)
5. Rollback for any flag: set value to `off` and redeploy.

### Rollout log

| Date | Environment | Flag | Action | Observation |
| --- | --- | --- | --- | --- |
| Pending | Staging | `USE_REVISED_FAT_LOSS_POLICY` | Not enabled | |
| Pending | Staging | `USE_EFFECTIVE_VOLUME_CAPS` | Not enabled | |
| Pending | Staging | `USE_MAIN_LIFT_PLATEAU_DETECTION` | Not enabled | |

## Delivery phases

| Phase | Focus | Findings |
| --- | --- | --- |
| Phase 0 | Constants, flags, and policy cleanup | 2, 4 |
| Phase 1 | Volume correctness | 1, 5 |
| Phase 2 | Prescription calibration | 3, 6, 8, 11 |
| Phase 3 | Plateau and baseline safety | 7, 10 |
| Phase 4 | Timing, substitutions, scoring, UX, maintainability | 9, 12, 13, 14, 15 |

## Phase status

| Phase | Status | Date | Notes |
| --- | --- | --- | --- |
| Phase 0 | Completed | 2026-02-11 | Implemented findings 2 and 4. Shared `INDIRECT_SET_MULTIPLIER` constant introduced and `proactiveMaxWeeks` removed from policy exports. |
| Phase 1 | Completed | 2026-02-11 | Implemented findings 1 and 5. Effective-volume MRV cap path added behind `USE_EFFECTIVE_VOLUME_CAPS`, and landmarks updated (Biceps MRV `26`, Hamstrings MEV `6`). |
| Phase 2 | Completed | 2026-02-11 | Implemented findings 3, 6, 8, 11. Revised fat-loss policy flag added, training-age periodization offsets added, isolation floor raised to 90s, and training-age back-off rep bump applied. |
| Phase 3 | Completed | 2026-02-11 | Implemented findings 7 and 10. Baseline context safety scaling added for cross-goal fallback, and main-lift e1RM plateau detection wired behind `USE_MAIN_LIFT_PLATEAU_DETECTION`. |
| Phase 4 | Completed | 2026-02-11 | Implemented findings 9, 12, 13, 14, 15. Accessory superset timing coverage expanded for compound pairs, scorer weights rebalanced, stale substitutions filtered post-trim, donor-fatigue safety intent documented, and bodyweight load UI labeling corrected. |

## Remediation closure status

**Closure decision:** Approved for closure on 2026-02-11.

| Scope | Status | Notes |
| --- | --- | --- |
| Findings 1-15 | Complete | All in-scope findings are implemented and documented in this plan with status, files, and acceptance coverage. |
| Finding 16 | Backlog (out of scope) | Tracked as future work and does not block remediation closure. |

1. Flag-gated findings: 1 (`USE_EFFECTIVE_VOLUME_CAPS`), 3 (`USE_REVISED_FAT_LOSS_POLICY`), 10 (`USE_MAIN_LIFT_PLATEAU_DETECTION`).
2. Always-on findings: 2, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15.
3. Test summary across phases: engine suite increased from `203` (Phase 0) to `226` (Phase 4), with lint and type-check passing in each phase validation run.

## PR slicing

1. One PR per phase.
2. Optional split for Phase 3 into `3A` (baseline) and `3B` (plateau).
3. Each PR must include:
- changed behaviors summary
- before/after scenario examples
- acceptance tests added or updated
- doc updates

## Finding-by-finding implementation specs

## 1) Effective volume cap enforcement

**Status:** Completed in Phase 1 on 2026-02-11.
**Flag:** `USE_EFFECTIVE_VOLUME_CAPS` (default `false`).

**Files**

- `src/lib/engine/volume.ts`
- `src/lib/engine/volume.test.ts`
- `docs/engine-prescription-progression-volume.md`
- `docs/architecture.md`

**Implementation**

1. In planned-cap calculations, track planned direct and planned indirect sets per muscle.
2. Compute effective planned sets as `direct + (indirect * INDIRECT_SET_MULTIPLIER)`.
3. In enhanced mode, compare effective sets to MRV when `USE_EFFECTIVE_VOLUME_CAPS=true`.
4. Keep spike cap as a secondary safety net.
5. Keep non-enhanced behavior unchanged.

**Acceptance tests**

1. `volume.test.ts` `effective-cap-under-mrv`:
- input: `direct=6`, `indirect=12`, multiplier `0.3`, `mrv=20`
- expected: no MRV trim.
2. `volume.test.ts` `effective-cap-over-mrv`:
- input: `direct=16`, `indirect=20`, multiplier `0.3`, `mrv=20`
- expected: MRV trim removes lowest-retention accessory.
3. `volume.test.ts` `effective-cap-flag-off`:
- expected: legacy direct-only cap behavior.

## 2) Indirect multiplier consistency

**Status:** Completed in Phase 0 on 2026-02-11.

**Files**

- `src/lib/engine/volume.ts`
- `src/lib/engine/weekly-program-analysis.ts`
- `src/lib/engine/weekly-program-analysis.test.ts`
- docs listed above

**Implementation**

1. Introduce one exported constant `INDIRECT_SET_MULTIPLIER=0.3`.
2. Replace all local indirect multiplier literals in runtime calculations.
3. Ensure scorer output `indirectSetMultiplier` reports the shared constant.

**Acceptance tests**

1. `weekly-program-analysis.test.ts` `reports-shared-indirect-multiplier`:
- expected: every check reports `0.3`.
2. `volume.test.ts` `uses the shared indirect multiplier constant`:
- expected: cap math uses shared constant.

## 3) Fat-loss calibration (Option A)

**Status:** Completed in Phase 2 on 2026-02-11.
**Flag:** `USE_REVISED_FAT_LOSS_POLICY` (default `false`).

**Files**

- `src/lib/engine/rules.ts`
- `src/lib/engine/prescription.ts`
- `src/lib/engine/rules.test.ts`
- `src/lib/engine/prescription.test.ts`
- `docs/engine-prescription-progression-volume.md`

**Implementation**

1. Under `USE_REVISED_FAT_LOSS_POLICY=true`:
- fat-loss main range becomes `[6, 10]`
- fat-loss base RPE becomes `7.5`
- fat-loss set multiplier is `0.75` in set resolution path
2. Keep legacy values when flag is off.

**Acceptance tests**

1. `rules.test.ts` `fat-loss-policy-flag-on`:
- expected: main `[6,10]`, base RPE `7.5`.
2. `prescription.test.ts` `fat-loss-set-reduction`:
- intermediate, normal readiness, no periodization
- expected: fat-loss main set count is lower than hypertrophy for same profile.
3. `rules.test.ts` `fat-loss-policy-flag-off`:
- expected: current behavior unchanged.

## 4) Proactive deload policy cleanup

**Status:** Completed in Phase 0 on 2026-02-11.

**Files**

- `src/lib/engine/rules.ts`
- `src/lib/engine/progression.ts` (only if needed)
- `src/lib/engine/progression.test.ts`
- docs

**Implementation**

1. Keep scheduled deload from periodization as primary proactive mechanism.
2. Remove or rename unused `proactiveMaxWeeks` constant to eliminate dead policy exports.
3. Do not add extra time-based trigger in this remediation phase.

**Acceptance tests**

1. `rules.test.ts` `returns deload on week 3 of a 4-week block`.
2. `rules.test.ts` `returns non-deload on week 0`.
3. Static check: no unused proactive deload threshold export remains.

## 5) Landmark corrections (Biceps MRV, Hamstrings MEV)

**Status:** Completed in Phase 1 on 2026-02-11.

**Files**

- `src/lib/engine/volume-landmarks.ts`
- `src/lib/engine/volume-landmarks.test.ts`
- `src/lib/engine/weekly-program-analysis.test.ts`

**Implementation**

1. Update landmark constants to:
- Biceps MRV `26`
- Hamstrings MEV `6`
2. Update snapshot expectations in weekly scorer tests.

**Acceptance tests**

1. `volume-landmarks.test.ts` `uses corrected landmark values for biceps mrv and hamstrings mev`.
2. `weekly-program-analysis.test.ts` `uses updated biceps and hamstrings landmark boundaries`.

## 6) Training-age-scaled RPE offsets

**Status:** Completed in Phase 2 on 2026-02-11.

**Files**

- `src/lib/engine/rules.ts`
- `src/lib/engine/rules.test.ts`
- `src/lib/engine/prescription.test.ts`

**Implementation**

1. Add age-aware RPE offset profile for non-deload training weeks.
2. Keep deload offset behavior unchanged.

**Acceptance tests**

1. `rules.test.ts` `uses age-scaled offsets for beginners`:
- week 0 offset does not drive beginner effective RPE below target floor.
2. `rules.test.ts` `uses age-scaled offsets for intermediate and advanced lifters`:
- progression ramps smoothly without premature near-failure jump.

## 7) Baseline context safety scaling

**Status:** Completed in Phase 3 on 2026-02-11.

**Files**

- `src/lib/engine/apply-loads.ts`
- `src/lib/engine/apply-loads.test.ts`

**Implementation**

1. Track baseline selection metadata in baseline index: selected context and preferred context.
2. Apply one-time scaling only when fallback context differs from preferred context and history is unavailable.
3. Keep history-derived progression precedence unchanged.

**Acceptance tests**

1. `apply-loads.test.ts` `scales strength baselines down for volume-preferred goals`.
2. `apply-loads.test.ts` `scales volume baselines up for strength-preferred goals`.
3. `apply-loads.test.ts` `uses history-derived load when available and applies back-off multiplier`.
4. `apply-loads.test.ts` `does not scale default-context baselines`.

## 8) Isolation rest floor to 90s

**Status:** Completed in Phase 2 on 2026-02-11.

**Files**

- `src/lib/engine/prescription.ts`
- `src/lib/engine/prescription.test.ts`

**Implementation**

1. Set low-fatigue isolation rest floor to `90`.

**Acceptance tests**

1. `prescription.test.ts` `uses 90 seconds as the isolation rest floor`:
- expected: low-fatigue isolation returns `90`.
2. `prescription.test.ts` `keeps higher-fatigue isolations at 90 seconds`.

## 9) Superset timing for eligible compounds

**Status:** Completed in Phase 4 on 2026-02-11.

**Files**

- `src/lib/engine/template-session.ts`
- `src/lib/engine/timeboxing.ts`
- `src/lib/engine/template-session.test.ts`
- `src/lib/engine/timeboxing.test.ts`

**Implementation**

1. Expand superset timing eligibility to include non-top-set compound pairings.
2. Keep top sets of primary main lifts excluded from superset timing reductions.
3. Preserve group validation and shared-rest safety floor.

**Acceptance tests**

1. `timeboxing.test.ts` `applies superset timing to compound accessories`.
2. `timeboxing.test.ts` `keeps main-lift exercises excluded from superset timing`.

## 10) Plateau detection data contract and metric

**Status:** Completed in Phase 3 on 2026-02-11.
**Flag:** `USE_MAIN_LIFT_PLATEAU_DETECTION` (default `false`).

**Files**

- `src/lib/engine/progression.ts`
- `src/lib/api/template-session.ts` (exercise library is already in context)
- `src/lib/engine/progression.test.ts`

**Data contract**

1. Do not add new fields to `WorkoutHistoryEntry`.
2. Resolve main-lift identity at runtime using `exercise.isMainLiftEligible===true` from exercise metadata already loaded in generation context.
3. Trigger-B metric under `USE_MAIN_LIFT_PLATEAU_DETECTION=true` uses top-set estimated 1RM:
- `e1RM = load * (1 + reps / 30)` (Epley)

**Plateau logic**

1. For each main-lift-eligible exercise appearing in at least 2 sessions of the N-session window:
- compute top-set e1RM per session
2. Plateau is true when no such exercise improves versus oldest window baseline.
3. If no main-lift-eligible exercise appears consistently across window, fall back to current total-reps comparator.

**Acceptance tests**

1. `progression.test.ts` `triggers when main-lift e1RM stalls even if accessories improve`:
- no e1RM improvement across window
- expected: trigger true.
2. `progression.test.ts` `does not trigger when a main lift improves within the window`:
- at least one main lift improves e1RM
- expected: trigger false.
3. `progression.test.ts` `falls back to total reps when no main lifts appear in the window`:
- expected: fallback comparator used.
4. `progression.test.ts` `keeps the legacy plateau behavior when the flag is off`:
- expected: current comparator unchanged.

## 11) Optional back-off rep bump

**Status:** Completed in Phase 2 on 2026-02-11.

**Files**

- `src/lib/engine/prescription.ts`
- `src/lib/engine/prescription.test.ts`

**Implementation**

1. Add configurable `backOffRepBump` policy with default `0`.
2. Apply only to non-top main-lift working sets.

**Acceptance tests**

1. `prescription.test.ts` `keeps beginner main-lift back-off reps equal to top-set reps`.
2. `prescription.test.ts` `applies training-age back-off rep bumps for non-top main sets`.
3. `prescription.test.ts` `clamps back-off rep bumps to exercise rep-range max`.

## 12) Scoring rebalance (push/pull > movement diversity)

**Status:** Completed in Phase 4 on 2026-02-11.

**Files**

- `src/lib/engine/template-analysis.ts`
- `src/lib/engine/template-analysis.test.ts`
- `docs/template/template-documentation.md`

**Implementation**

1. Increase push/pull weight and reduce movement-diversity weight while preserving normalized total behavior.

**Acceptance tests**

1. `template-analysis.test.ts` `gates push/pull balance for single-direction split intents`.
2. `template-analysis.test.ts` `uses intent-specific movement expectations`.

## 13) Remove stale substitutions after trimming

**Status:** Completed in Phase 4 on 2026-02-11.

**Files**

- `src/lib/engine/template-session.ts`
- `src/lib/engine/template-session.test.ts`

**Implementation**

1. Filter substitutions against final workout exercise IDs after timebox and volume-cap passes.

**Acceptance tests**

1. `template-session.test.ts` `removes substitutions for exercises trimmed from the final workout`.

## 14) Donor fatigue scaling intent comment

**Status:** Completed in Phase 4 on 2026-02-11.

**Files**

- `src/lib/engine/apply-loads.ts`

**Implementation**

1. Add concise inline comment documenting conservative fallback intent.

**Acceptance tests**

1. `manual-review` `donor-fatigue-intent-comment-present`:
- expected: comment is present near donor fatigue scaling computation.

## 15) Bodyweight UI handling for undefined target load

**Status:** Completed in Phase 4 on 2026-02-11.

**Files**

- `src/components/GenerateFromTemplateCard.tsx`
- `src/app/workout/[id]/page.tsx`
- `src/components/LogWorkoutClient.tsx`

**Implementation**

1. Display `BW` or `Bodyweight` when exercise is bodyweight and `targetLoad` is undefined.
2. Keep numeric logging path available for weighted bodyweight variants.

**Acceptance tests**

1. `manual-ui` `bodyweight-undefined-load-displays-bw`:
- expected: bodyweight + undefined load displays `BW` on generation and detail surfaces.
2. `manual-ui` `bodyweight-logging-keeps-optional-load-entry`:
- expected: logging UI keeps optional load semantics for bodyweight sets while preserving numeric entry for weighted variants.

## Validation checklist per phase

1. `npm run test -- src/lib/engine --run`
2. `npm run test -- src/lib/api --run` for touched APIs
3. `npm run lint`
4. `npx tsc --noEmit`
5. Behavior docs updated for changed modules

### Phase 0 validation evidence (2026-02-11)

1. `npm run test -- src/lib/engine --run` passed (`18` files, `203` tests).
2. `npm run lint` completed with `0` errors (`1` warning in `coverage/block-navigation.js`, unrelated to Phase 0 code).
3. `npx tsc --noEmit` passed.

### Phase 1 validation evidence (2026-02-11)

1. `npm run test -- src/lib/engine --run` passed (`18` files, `208` tests).
2. `npm run lint` completed with `0` errors (`1` warning in `coverage/block-navigation.js`, unrelated to Phase 1 code).
3. `npx tsc --noEmit` passed.

### Phase 2 validation evidence (2026-02-11)

1. `npm run test -- src/lib/engine --run` passed (`18` files, `217` tests).
2. `npm run test -- src/lib/api --run` passed (`6` files, `37` tests).
3. `npm run lint` completed with `0` errors (`1` warning in `coverage/block-navigation.js`, unrelated to Phase 2 code).
4. `npx tsc --noEmit` passed.

### Phase 3 validation evidence (2026-02-11)

1. `npm run test -- src/lib/engine --run` passed (`18` files, `224` tests).
2. `npm run test -- src/lib/api --run` passed (`6` files, `37` tests).
3. `npm run lint` completed with `0` errors (`1` warning in `coverage/block-navigation.js`, unrelated to Phase 3 code).
4. `npx tsc --noEmit` passed.

### Phase 4 validation evidence (2026-02-11)

1. `npm run test -- src/lib/engine --run` passed (`18` files, `226` tests).
2. `npm run test -- src/lib/api --run` passed (`6` files, `37` tests).
3. `npm run lint` completed with `0` errors (`1` warning in `coverage/block-navigation.js`, unrelated to Phase 4 code).
4. `npx tsc --noEmit` passed.

## Done definition (remediation scope)

1. Findings 1-15 implemented or policy-closed with code/docs parity.
2. All scoped acceptance tests pass.
3. All three feature flags exist and default to off.
4. Rollback path validated by disabling each flag.
5. No unresolved dead constants related to scoped findings.

## Future work (out of scope for remediation closure)

### Finding 16: Stall escalation system beyond deload

1. Track as separate backlog epic.
2. Requires dedicated spec for schema, recommendation service, and UI surfaces.
3. Does not block remediation done-definition for findings 1-15.
