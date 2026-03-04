# 09 History Analytics Dashboard Roadmap

Owner: Aaron
Last reviewed: 2026-03-04
Purpose: Phased plan for unifying history, analytics, and program dashboard surfaces around stable post-Phase-7 read contracts.

This doc covers:
- The next cleanup sequence after mesocycle simplification
- The canonical read-model and contract targets for history, analytics, and dashboard surfaces
- The phased order for implementation across multiple sessions

Sources of truth:
- `trainer-app/src/lib/api/program.ts`
- `trainer-app/src/app/page.tsx`
- `trainer-app/src/app/program/page.tsx`
- `trainer-app/src/components/ProgramStatusCard.tsx`
- `trainer-app/src/app/history/page.tsx`
- `trainer-app/src/components/HistoryClient.tsx`
- `trainer-app/src/components/RecentWorkouts.tsx`
- `trainer-app/src/lib/ui/workout-list-items.ts`
- `trainer-app/src/app/api/workouts/history/route.ts`
- `trainer-app/src/app/analytics/page.tsx`
- `trainer-app/src/app/api/analytics/**`

## Why this roadmap exists

The mesocycle simplification work is done. Runtime session-decision ownership is stable and receipt-first.

The next highest-value cleanup is not another rule redesign. It is the read side:
- home-page program dashboard
- `/program` dashboard
- recent workouts
- history
- analytics

These surfaces already share some normalized pieces (`sessionSnapshot`, `mesocycleSnapshot`, `ProgramDashboardData`), but they still evolve as separate feature islands. That creates drift in:
- counting semantics
- naming
- date/week scopes
- user-facing terminology
- duplicated UI summary logic

This roadmap treats those areas as one contract pass, with the home-page `ProgramStatusCard` explicitly included.

## Working assumptions

- The receipt-first session-decision contract stays unchanged.
- This is a read-model and surface-contract roadmap, not a new training-rule roadmap.
- Prefer shared derived summaries over raw DB-column leakage into UI.
- Prefer one user-facing explanation path per concept (session status, week progress, volume status, readiness/recovery context).
- Preserve current user-visible behavior unless a simplification clearly reduces confusion.

## Canonical targets

By the end of this roadmap, the app should have:
- One canonical program/dashboard read model for both `/` and `/program`
- One canonical workout list/read summary model for recent workouts and history
- One canonical definition of analytics counting/time-window semantics, shared across program and analytics surfaces where concepts overlap
- One short doc explanation of how dashboard/history/analytics read models relate to receipt-first runtime ownership

## Revised roadmap

### Phase 1 - Audit and Canonical Read-Model Boundaries
Status: NOT STARTED

Goal:
- Inventory the current read contracts and define the minimum canonical models before changing UI behavior.

Focus:
- Audit `ProgramDashboardData`, workout list summary models, analytics route response shapes, and the home-page dashboard composition.
- Identify where the same concept is named or computed differently across `/`, `/program`, `/history`, and `/analytics`.
- Separate canonical derived read models from surface-only view formatting.

Expected outputs:
- A written classification of:
  - canonical read models to preserve
  - duplicated or drifting contract shapes to collapse
  - surface-only formatting logic that should stay local
- A short canonical flow note that links:
  - receipt-first runtime ownership
  - mesocycle snapshots
  - session snapshots
  - program/dashboard analytics read models

Exit criteria:
- Clear boundaries exist for program, workout-list, and analytics read contracts.
- The next phases can delete duplication instead of adding another abstraction layer.

### Phase 2 - Program Dashboard Contract Pass
Status: NOT STARTED

Goal:
- Make the home-page program card and `/program` dashboard a single intentional surface backed by one contract.

Focus:
- Treat `ProgramStatusCard` on `/` and `/program` as the same feature, not two consumers that may drift.
- Audit `ProgramDashboardData` in `src/lib/api/program.ts` for mixed responsibilities:
  - current vs viewed week
  - live coaching cue vs historical display state
  - recent-workout/resume-session helpers
  - volume rows and deload readiness
- Clarify which data is:
  - core dashboard state
  - home-page convenience data
  - derived display metadata
- Tighten terminology in the card so week progression, RIR target, volume status, and deload timing are described consistently.

Important inclusion:
- This phase explicitly includes the home-page `ProgramStatusCard` shown on `/` as well as the `/program` page.

Exit criteria:
- `/` and `/program` consume the same intentional program dashboard contract.
- Historical week navigation semantics are clear and do not leak confusing live-state assumptions.
- Home-page dashboard behavior is stable but easier to reason about and document.

### Phase 3 - Workout List Surface Unification
Status: NOT STARTED

Goal:
- Collapse recent workouts and history onto one shared workout-list summary contract and shared display language.

Focus:
- Audit `buildWorkoutListSurfaceSummary()` and verify it is the only canonical list-summary builder.
- Remove duplicate status/intent/session-badge formatting between `RecentWorkouts` and `HistoryClient`.
- Make sure recent workouts and history use the same:
  - status labels
  - session snapshot labels
  - set/exercise count semantics
  - intent display formatting
- Keep surface-specific behavior local:
  - history filters and pagination
  - recent-workout compact layout

Exit criteria:
- Recent workouts and history render from one canonical summary contract.
- Shared list semantics are centralized; only layout and interaction differ by surface.
- No raw snapshot columns or ad hoc count logic leak into those components.

### Phase 4 - Analytics Contract and Semantics Pass
Status: NOT STARTED

Goal:
- Standardize analytics route semantics and align them with the rest of the app’s read models.

Focus:
- Audit `src/app/api/analytics/**` and the `/analytics` page for inconsistent time windows, counting semantics, and naming.
- Align analytics wording with program/dashboard concepts where they refer to the same thing:
  - weekly volume
  - recovery/readiness
  - split distribution
  - template usage
- Decide which concepts should remain analytics-only versus shared with program/history surfaces.
- Remove duplicated derivation logic when the same summary can come from a shared helper.

Guardrails:
- Do not invent new score systems unless required to fix existing contract confusion.
- Prefer clarifying and normalizing existing metrics over expanding metric count.

Exit criteria:
- Analytics endpoints use clear, documented counting/time-window semantics.
- Shared concepts between analytics and program/history are named and computed consistently.
- Surface-specific analytics metrics remain intentionally separate where appropriate.

### Phase 5 - User-Facing Summary and Navigation Simplification
Status: NOT STARTED

Goal:
- Reduce surface fragmentation once the contracts are stable.

Focus:
- Re-evaluate how users move between:
  - home dashboard
  - `/program`
  - `/history`
  - `/analytics`
- Remove duplicated summary copy or weak secondary panels where the same information appears in multiple places.
- Tighten the “what should I look at next?” flow:
  - live training state on home
  - current mesocycle state on dashboard
  - past sessions in history
  - deeper trends in analytics

Exit criteria:
- Each surface has a clearer purpose.
- Cross-surface duplication is reduced.
- The home page remains a useful operational dashboard rather than becoming a second analytics page.

### Phase 6 - Explainability Quality Pass
Status: NOT STARTED

Goal:
- Improve explainability usefulness now that ownership and read contracts are stable.

Focus:
- Audit explainability output for debugging value rather than contract ownership.
- Tighten confidence wording so missing-signal states are easier to interpret.
- Improve audit readability on `/workout/[id]/audit` so session-level and exercise-level reasoning is easier to scan.
- Re-evaluate whether surfaced rationale actually helps explain bad or surprising plan choices.
- Remove repetitive, low-signal, or overly engine-shaped explanation copy where it does not improve debugging.

Guardrails:
- Do not reintroduce duplicate session-decision ownership.
- Do not broaden into new selection/progression rule design unless a tiny local wording/shape fix requires it.
- Prefer improving explanation structure and wording over adding more explanation volume.

Exit criteria:
- Confidence summaries are clearer about what evidence is present vs missing.
- The audit surface is easier to use when inspecting poor or surprising plans.
- Explanation copy is more diagnostic and less repetitive.

### Phase 7 - Documentation, Deletion, and Verification Pass
Status: NOT STARTED

Goal:
- Finish with the same discipline used in the mesocycle simplification roadmap: docs aligned, residue deleted, tests tightened.

Focus:
- Remove stale helpers, stale comments, and stale docs left behind by Phases 1-5.
- Collapse duplicate architectural descriptions into one short canonical explanation for the read side.
- Update docs so history, analytics, and program dashboard responsibilities are documented once and referenced elsewhere.
- Add or update focused tests only where they defend canonical contracts.

Exit criteria:
- Docs match code.
- Dead read-model/scaffolding residue is removed.
- Focused tests and type/build validation pass.

## Priority buckets

Do now:
- Phase 1 audit and contract-boundary definition
- Phase 2 program dashboard contract pass, including the home-page dashboard card

Do next:
- Phase 3 workout list surface unification
- Phase 4 analytics semantics pass

Do later:
- Phase 5 user-facing navigation/summary simplification
- Phase 6 explainability quality pass
- Phase 7 documentation and deletion pass

Avoid during this roadmap:
- New mesocycle rule redesign
- New autoregulation heuristics
- Broad schema changes unless a read-contract cleanup genuinely requires one

## Practical sequence for the next sessions

1. Audit the existing read contracts and write down the canonical boundaries before editing UI.
2. Stabilize the program dashboard contract first because it appears both on home and `/program` and anchors the user’s weekly mental model.
3. Unify recent workouts and history around the same workout-list summary model.
4. Normalize analytics semantics after the dashboard/history contracts are stable.
5. Simplify cross-surface UX only after contract and naming drift are reduced.
6. Improve explainability quality after the surrounding read contracts are stable.
7. Finish with documentation, dead-code deletion, and focused verification.

## Working principle

For each phase, require clear answers to:
- What is the canonical read model?
- Which surfaces consume it?
- What user-facing confusion does this remove?
- What duplicated logic or wording can be deleted afterward?
