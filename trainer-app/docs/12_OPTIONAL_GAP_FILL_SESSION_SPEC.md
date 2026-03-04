# 12 Optional Gap-Fill Session Spec

Owner: Aaron
Last reviewed: 2026-03-04
Status: Draft (architecture-aligned)
Purpose: Add an optional end-of-week gap-fill session without introducing contract drift from the current lifecycle, generation, save, and receipt-first architecture.

This doc covers:
- Product behavior and policy model
- Eligibility and deficit rules
- Runtime flow and ownership boundaries
- Data contract and persistence semantics
- Audit/testing rollout

Sources of truth:
- `trainer-app/docs/01_ARCHITECTURE.md`
- `trainer-app/docs/02_DOMAIN_ENGINE.md`
- `trainer-app/src/lib/api/program.ts`
- `trainer-app/src/lib/api/next-session.ts`
- `trainer-app/src/lib/api/template-session.ts`
- `trainer-app/src/lib/api/template-session/context-loader.ts`
- `trainer-app/src/app/api/workouts/generate-from-intent/route.ts`
- `trainer-app/src/app/api/workouts/save/route.ts`
- `trainer-app/src/app/api/workouts/save/lifecycle-contract.ts`
- `trainer-app/src/lib/evidence/session-decision-receipt.ts`
- `trainer-app/src/lib/validation.ts`

## Anti-drift invariants (must hold)

1. Next required session ownership remains in `loadNextWorkoutContext()` (`src/lib/api/next-session.ts`).
2. Lifecycle week/phase/session ownership remains in `mesocycle-lifecycle.ts` + save-route lifecycle contract.
3. Session generation remains on canonical intent/template generation paths (`template-session.ts`).
4. Session decision metadata remains receipt-first under `selectionMetadata.sessionDecisionReceipt`.
5. No new parallel persistence contract is introduced for optional-session state.
6. Optional gap-fill policy is configuration-driven by mesocycle context; never split-hardcoded in generation/save routes.

## Problem statement

For a 3x/week PPL mesocycle, users can finish the planned weekly rotation and still have meaningful weekly muscle-volume deficits versus lifecycle targets. We want an optional 4th session that closes the largest deficits while preserving:

- canonical lifecycle advancement behavior
- existing intent generation contracts
- receipt-first session decision ownership
- current next-session derivation ownership

## Design goals

- Keep PPL weekly rotation unchanged as the required baseline.
- Offer one optional gap-fill session only after required weekly sessions are complete.
- Reuse existing generation contract (`intent: "body_part"`) for first rollout.
- Avoid new parallel session-decision state outside `selectionMetadata.sessionDecisionReceipt`.
- Ensure optional sessions do not advance lifecycle counters or split rotation.
- Keep the model generic so future 4-day mesocycles can reuse the same policy shape.

## Non-goals (phase 1)

- No new workout session intent enum for gap fill.
- No replacement of the existing `loadNextWorkoutContext()` derivation path.
- No alternate persistence path for session-decision metadata.
- No projected mid-week deficit logic; this mode is end-of-rotation only.
- No rewrite of selection-v2 scoring architecture.

## Canonical policy model

Gap-fill eligibility is mesocycle-policy driven, not split-hardcoded.

Canonical derived policy fields:
- `requiredSessionsPerWeek = activeMesocycle.sessionsPerWeek`
- `maxOptionalGapFillSessionsPerWeek = 1` (phase 1)
- `unlockAfterRequiredSessionsComplete = true`

Policy source precedence (future-safe):
1. Explicit mesocycle policy override (recommended location: `mesocycle.volumeRampConfig.optionalSessions.gapFill`).
2. Fallback default policy derived from active mesocycle (`sessionsPerWeek`, `state`).

Proposed policy shape (derived runtime object, not new DB column in phase 1):
- `enabled: boolean`
- `requiredSessionsPerWeek: number`
- `unlockAfterRequiredSessionsComplete: boolean`
- `maxOptionalGapFillSessionsPerWeek: number`
- `minSingleMuscleDeficitSets: number`
- `minTotalDeficitSets: number`
- `excludedDuringDeload: boolean`

For current 3x/week PPL:
- required sessions = 3
- optional gap-fill max = 1

For future 4-day mesocycles:
- required sessions = 4
- optional gap-fill still unlocks only after those 4 are complete

## Eligibility rules

A gap-fill suggestion is eligible only when all conditions pass:

1. Active mesocycle exists and is not in deload state (`ACTIVE_DELOAD` is ineligible).
2. Required sessions for the current accumulation week are complete.
3. No higher-priority incomplete workout exists (`IN_PROGRESS`, `PARTIAL`, `PLANNED`).
4. Optional gap-fill count for the current mesocycle week is `< maxOptionalGapFillSessionsPerWeek`.
5. Deficit thresholds are met (see Deficit and trigger rules below).

### Required-session completion (canonical)

Use lifecycle counters as the source of truth for rotation completion:

- `accumulationSessionsCompleted > 0`
- `accumulationSessionsCompleted % sessionsPerWeek === 0`

This avoids introducing a new parallel "week-complete" state machine.

### Optional gap-fill weekly cap counting (canonical)

Count already-used optional gap-fill sessions from persisted workouts scoped to:
- `mesocycleId = activeMesocycle.id`
- `mesocycleWeekSnapshot = current lifecycle week`
- `status in PERFORMED_WORKOUT_STATUSES`
- `selectionMode = "INTENT"`
- `sessionIntent = "BODY_PART"`
- `advancesSplit = false`
- canonical receipt gap-fill marker present (see Receipt and explainability contract)

This uses existing persisted fields and avoids introducing new counters.

## Deficit and trigger rules

Use end-of-rotation actuals, not projection.

Per muscle:
- `target = lifecycleVolumeTargets[muscle]`
- `actual = effectiveActual[muscle]`
- `deficit = max(0, target - actual)`
- `deficitRatio = deficit / max(target, 1)`

Suggestion trigger (phase 1 defaults):
- at least one muscle `deficit >= 2` effective sets
- or total unresolved deficit across muscles `>= 6` effective sets

Exclusions:
- do not prioritize muscles already near MRV
- honor soreness suppression/readiness constraints already computed by context loader

Canonical deficit input ownership:
- Targets: `mapped.lifecycleVolumeTargets`
- Actuals: `objective.volumeContext.effectiveActual`
- MRV context: existing volume landmarks / objective ceilings

## Gap-fill session build contract

Generation path:
- Reuse `POST /api/workouts/generate-from-intent`
- Use `intent: "body_part"` and pass top deficit muscles as `targetMuscles`

Session constraints (phase 1):
- 2-4 exercises
- 8-12 hard sets total
- top 1-3 deficit muscles prioritized
- keep fatigue moderate; avoid turning optional session into a second full split day
- use lifecycle RIR target from mapped context (no special intensity exception)

Selection mode/session intent:
- `selectionMode = "INTENT"`
- `sessionIntent = "BODY_PART"` (existing enum)

Generation boundary rule:
- Gap-fill must call the same `generateSessionFromIntent()` flow as any other intent generation.
- No gap-fill-only selection engine branch is allowed in phase 1.

## Persistence and lifecycle semantics

Gap-fill workouts must be saved with:
- `advancesSplit: false`

Lifecycle requirement:
- performed optional gap-fill must not increment `accumulationSessionsCompleted` or `deloadSessionsCompleted`
- performed optional gap-fill must not trigger mesocycle state transition

Implementation note:
- save-route performed-transition logic must gate lifecycle counter update and transition on `advancesSplit !== false`
- this aligns behavior with existing `advancesSplit` contract intent and prevents lifecycle drift

Persistence boundary rule:
- Optional-session eligibility is derived at read time from canonical workout/mesocycle state.
- No new mutable "gapFillUsed" flags are persisted.

## Receipt and explainability contract

Do not add a second session-decision container.

All session-level context remains in:
- `selectionMetadata.sessionDecisionReceipt`

Gap-fill provenance should be represented without schema drift:
- primary: `sessionIntent = BODY_PART` plus canonical receipt marker
- required marker: add a typed session-decision exception code for optional gap-fill sessions (for example `optional_gap_fill`) under `selectionMetadata.sessionDecisionReceipt.exceptions`
- this marker is canonical because it lives inside the existing receipt contract rather than introducing a new top-level metadata path

No legacy top-level metadata mirrors are introduced.

## Runtime ownership and flow

1. Dashboard/program support layer computes and exposes optional gap-fill suggestion state.
2. User explicitly chooses to generate optional gap-fill.
3. Generation uses canonical intent route (`body_part`).
4. Save persists workout with canonical selection metadata and `advancesSplit: false`.
5. Logging/save keeps performed semantics, but lifecycle advancement remains off for this optional session.

Ownership boundaries:
- next required session derivation stays in `loadNextWorkoutContext()`
- generation stays in `template-session.ts` intent path
- lifecycle transitions stay in save + `mesocycle-lifecycle.ts`
- session decision remains receipt-first
- audit behavior stays in existing workout-audit harness paths

## Canonical decision order (to avoid branching drift)

1. Resolve owner and active mesocycle.
2. Resolve canonical next required session context via `loadNextWorkoutContext()`.
3. If an incomplete workout exists, suppress gap-fill suggestion.
4. Resolve optional-session policy from active mesocycle (override -> fallback defaults).
5. Evaluate end-of-required-rotation gate using lifecycle counters.
6. Evaluate performed optional gap-fill count for current lifecycle week.
7. Compute deficits from canonical lifecycle targets + effective actuals.
8. If threshold passes, expose suggestion and candidate muscles.
9. Generate via `intent: "body_part"` only on explicit user action.

## API/UI surface proposal (phase 1)

Extend read model (program support):
- add optional `gapFill` object in `HomeProgramSupportData`:
  - `eligible: boolean`
  - `reason: string | null`
  - `targetMuscles: string[]`
  - `deficitSummary: Array<{ muscle: string; target: number; actual: number; deficit: number }>`
  - `alreadyUsedThisWeek: boolean`
  - `policy: { requiredSessionsPerWeek: number; maxOptionalGapFillSessionsPerWeek: number }`

No new generation route is required in phase 1.

## Audit and test plan

Add/extend tests to enforce no-drift invariants:

1. Save lifecycle contract:
- `advancesSplit=false` performed workout does not increment lifecycle counters
- `advancesSplit=false` performed workout does not trigger `transitionMesocycleState`

2. Program support eligibility:
- eligible only at end of required weekly rotation
- ineligible when incomplete workouts exist
- ineligible during deload
- ineligible after optional weekly cap reached

3. Intent generation invariants:
- gap-fill generation uses existing `body_part` validation path
- canonical `selectionMetadata.sessionDecisionReceipt` persists and round-trips

4. Audit harness:
- add intent-preview fixture for representative gap-fill scenario (`body_part` with multiple muscles)
- confirm planner diagnostics remain receipt-auditable in standard/debug modes
5. Future-mesocycle policy:
- identical logic works when `sessionsPerWeek` is 4+ (no PPL-specific branching)
- policy override changes thresholds/cap without code-path fork

## Rollout sequence

1. Implement lifecycle-safe save behavior for `advancesSplit=false` performed workouts.
2. Add program-support gap-fill eligibility/read model.
3. Add UI affordance to generate optional gap-fill only when eligible.
4. Wire generation call to existing intent route (`body_part`).
5. Add tests and one audit artifact fixture for regression protection.

## Explicitly rejected approaches

- Adding a new `WorkoutSessionIntent` enum value for gap-fill in phase 1.
- Adding a separate gap-fill generation route with duplicated selection logic.
- Persisting optional-session usage as standalone mutable flags.
- Bypassing receipt construction for optional sessions.
- Deriving eligibility from UI state instead of canonical API/domain state.

## Implementation risk checklist

1. Lifecycle drift risk (critical)
- Risk: optional gap-fill sessions accidentally increment lifecycle counters or trigger mesocycle transition.
- Guardrail: performed transition logic in save route must require `advancesSplit !== false` before counter increment and transition calls.
- Tests: save-route integration tests for `mark_completed` and `mark_partial` with `advancesSplit=false`.

2. Session misclassification risk
- Risk: normal `BODY_PART` sessions get counted as optional gap-fill usage.
- Guardrail: weekly cap counting requires both `advancesSplit=false` and receipt marker `optional_gap_fill`.
- Tests: eligibility/count tests with mixed BODY_PART sessions (marked and unmarked).

3. Gap-fill alignment quality risk
- Risk: generated `body_part` session includes insufficient target-muscle focus.
- Guardrail: in gap-fill mode, require stronger target-muscle alignment threshold than default diagnostics-only behavior.
- Tests: intent-generation regression coverage for gap-fill target muscle concentration.

4. Fatigue/volume overshoot risk
- Risk: optional 4th day pushes user past recoverable volume.
- Guardrail: keep conservative deficit thresholds, 8-12 set cap, MRV/soreness/readiness exclusions.
- Tests: policy and generation tests that reject or down-prioritize high-fatigue candidates.

5. Legacy-data boundary risk
- Risk: historical workouts without consistent snapshot/receipt metadata break eligibility and counting logic.
- Guardrail: derive eligibility from canonical current-state fields first; treat missing markers as non-gap-fill.
- Tests: mixed fixture coverage with legacy workouts plus canonical new workouts.

6. Policy-fragmentation risk (future mesocycles)
- Risk: special-case branches for 3-day PPL diverge from 4+ day mesocycle behavior.
- Guardrail: all eligibility thresholds/caps resolve from a single policy object (override -> fallback), never split-specific branches.
- Tests: matrix tests across `sessionsPerWeek` values (3, 4, 5) with identical evaluation flow.

Release gate:
- Do not enable UI suggestion until checklist items 1 and 2 have passing tests.

## Acceptance criteria

- Users on 3x/week PPL only see gap-fill suggestion after completing the three required weekly sessions.
- Optional gap-fill is offered at most once per week.
- Generated gap-fill closes the largest unresolved weekly muscle deficits using canonical volume accounting.
- Saving/completing gap-fill does not advance mesocycle lifecycle counters.
- No new parallel session-decision contract is introduced outside canonical receipt metadata.
- The same policy/evaluation flow works unchanged for future mesocycles with different `sessionsPerWeek`.
