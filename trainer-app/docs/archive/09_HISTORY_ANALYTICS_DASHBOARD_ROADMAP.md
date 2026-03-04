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
Status: COMPLETE (audited 2026-03-04)

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

Audit findings:

#### Canonical read models to preserve

1. `ProgramDashboardData` in `src/lib/api/program.ts`
- Canonical owner for the shared program dashboard card used on `/` and `/program`.
- Canonical fields in-scope for later phases:
  - `activeMeso`
  - `currentWeek`
  - `viewedWeek`
  - `sessionsUntilDeload`
  - `volumeThisWeek`
  - `deloadReadiness`
  - `rirTarget`
  - `coachingCue`
- Boundary note: this model is canonical for dashboard state, not for generic workout-list rows.

2. `WorkoutListSurfaceSummary` in `src/lib/ui/workout-list-items.ts`
- Canonical list/read summary for recent workouts and history.
- Current consumers:
  - home page recent workouts (`src/app/page.tsx` -> `src/components/RecentWorkouts.tsx`)
  - `/history` server preload (`src/app/history/page.tsx`)
  - `GET /api/workouts/history` (`src/app/api/workouts/history/route.ts`)
- Canonical fields:
  - `id`
  - `scheduledDate`
  - `completedAt`
  - `status`
  - `selectionMode`
  - `sessionIntent`
  - `mesocycleId`
  - `sessionSnapshot`
  - `exerciseCount`
  - `totalSetsLogged`

3. Normalized mesocycle snapshot readers
- Persisted columns remain canonical derived storage:
  - `mesocycleId`
  - `mesocycleWeekSnapshot`
  - `mesoSessionSnapshot`
  - `mesocyclePhaseSnapshot`
- Canonical normalized readers already exist and should be preserved:
  - `mesocycleSnapshot` for engine/history readers in `src/lib/api/workout-context.ts`
  - `WorkoutSessionSnapshotSummary` for UI badges in `src/lib/ui/workout-session-snapshot.ts`
  - `readPersistedWorkoutMesocycleSnapshot()` for explainability/history overlap in `src/lib/api/workout-mesocycle-snapshot.ts`

4. Explainability overlap boundary to preserve
- Keep receipt-first session ownership unchanged.
- Preserve only the read-side overlap points that touch dashboard/history/analytics summaries:
  - `sessionDecisionReceipt.cycleContext` as explainability-only context input
  - persisted mesocycle snapshot -> explainability `volumeCompliance` week scoping
  - shared lifecycle target helper `getWeeklyVolumeTarget()` for week-target interpretation
- Do not pull broader explainability payloads into dashboard/history contracts.

#### Duplicated or drifting contracts to collapse in later phases

1. `/program` recent session history is on a separate row contract
- `ProgramDashboardData.recentWorkouts` returns `ProgramRecentWorkout[]` from `src/lib/api/program.ts`.
- `/program` renders that shape directly in `src/app/program/page.tsx`.
- Drift vs canonical workout-list summary:
  - no `sessionSnapshot`
  - no `exerciseCount`
  - no `totalSetsLogged`
  - lower-cased `status` / `sessionIntent` instead of the history/recent-workouts shape
  - separate local status-dot / split-badge formatting
- Later collapse target: move `/program` session-history rendering onto `WorkoutListSurfaceSummary` or an explicit thin derivative of it.

2. Program dashboard mixes live dashboard state with convenience list data
- `ProgramDashboardData` currently carries both canonical dashboard fields and `/program`-only `recentWorkouts`.
- The shared `ProgramStatusCard` only needs the dashboard portion.
- Later collapse target: keep `ProgramDashboardData` focused on program/dashboard state and isolate session-history list data behind the workout-list summary contract.

3. Status/count semantics drift across analytics routes
- `/api/analytics/recovery` and `/api/analytics/volume` use performed-workout semantics (`COMPLETED` + `PARTIAL`) via `PERFORMED_WORKOUT_STATUSES`.
- `/api/analytics/summary` uses `COMPLETED`-only for `workoutsCompleted`, while also counting generated/completed KPIs off the full workout table.
- `/api/analytics/templates` uses `COMPLETED`-only completion rate semantics.
- Program/dashboard surfaces talk about mesocycle progression and performed sessions, not only completed sessions.
- Later collapse target: document one explicit counting vocabulary for `performed`, `completed`, and `generated`.

4. Time-window semantics drift across program vs analytics
- Program dashboard volume is mesocycle-relative and week-targeted:
  - `loadProgramDashboardData()` uses `viewedWeek`
  - `volumeThisWeek` is anchored to mesocycle week start
  - `rirTarget` is also mesocycle-week scoped
- Analytics volume uses rolling ISO-week buckets from `computeWeeklyMuscleVolume()`.
- Explainability session context uses a rolling 7-day `loadVolumeByMuscle()` window.
- Recovery uses a rolling 14-day history window.
- Later collapse target: preserve these as separate intents, but document them explicitly so surfaces stop implying they are the same "weekly volume" number.

5. Volume row semantics drift across dashboard vs analytics
- `ProgramVolumeRow` is a target-bearing mesocycle-week row for dashboard decision support.
- `/api/analytics/volume` returns weekly time-series buckets for charting.
- Both count direct/indirect sets, but only the dashboard row includes target/MEV/MAV/MRV semantics.
- Later collapse target: share counting semantics and landmark source, not the full payload shape.

6. Home/history list consumers still duplicate surface formatting
- `RecentWorkouts.tsx` and `HistoryClient.tsx` both format:
  - status labels/classes
  - intent display text
  - session snapshot badge rendering
- This is not a domain-shape problem anymore, but it is duplicated presentation logic that can drift.

7. One mixed-responsibility edge inside the current program dashboard contract
- `deloadReadiness` is documented as live/current-week state in `src/lib/api/program.ts`.
- The current loader computes it with `currentWeek` plus `volumeThisWeek`, where `volumeThisWeek` may represent `viewedWeek` when historical navigation is active.
- This is a Phase 2 contract cleanup target, not a Phase 1 implementation change.

#### Surface-only formatting that should stay local

- Date formatting for cards/tables/charts (`toLocaleDateString`, `MM-DD` chart labels).
- Status badge classes, status dots, and compact badge copy.
- Intent display casing (`push` -> `Push`, `full_body` -> `Full Body`).
- Chart grouping and display choices in analytics:
  - top-muscle selection for trend lines
  - Push/Pull/Legs aggregation map for split distribution
  - recovery panel grouping by split family
- History-only interaction state:
  - filters
  - pagination
  - empty/loading states
- Home-page compact recent-workouts layout vs history full-card layout.
- `/program`-specific table layout and cycle-anchor controls.

#### Canonical boundary decisions for later phases

- Preserve one canonical program dashboard read model: `ProgramDashboardData`.
- Preserve one canonical workout/session list summary: `WorkoutListSurfaceSummary`.
- Preserve one canonical normalized mesocycle snapshot boundary:
  - `mesocycleSnapshot` for engine/history
  - `WorkoutSessionSnapshotSummary` for UI
  - `readPersistedWorkoutMesocycleSnapshot()` for explainability overlap
- Treat analytics route payloads as surface projections until Phase 4, but standardize them around explicit counting/time-window semantics rather than reusing dashboard contracts.

#### Obvious stale or suspicious areas noticed during the audit

- `ProgramDashboardData.nextSessionIntent` was a backward-compat alias for `nextSession.intent`; removed in Phase 2.
- `ProgramDashboardData.recentWorkouts` looked like convenience scaffolding for the `/program` page rather than a durable canonical contract; removed in Phase 2.
- `ProgramStatusCard` initialized local week state from `currentWeek` instead of `viewedWeek`; corrected in Phase 2.
- `/api/analytics/program-weekly` is a separate analysis surface and does not currently participate in the home/history/program dashboard boundary set.

### Phase 2 - Program Dashboard Contract Pass
Status: COMPLETE (implemented 2026-03-04)

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

Implementation summary:
- `ProgramDashboardData` in `src/lib/api/program.ts` is now the shared dashboard-card contract only:
  - `activeMeso`
  - `currentWeek`
  - `viewedWeek`
  - `sessionsUntilDeload`
  - `volumeThisWeek`
  - `deloadReadiness`
  - `rirTarget`
  - `coachingCue`
- Home-page operational helpers were split out into `loadHomeProgramSupport()`:
  - `nextSession`
  - `latestIncomplete`
  - `lastSessionSkipped`
- `/program` session history no longer comes from `ProgramDashboardData.recentWorkouts`; it now reads separately from the canonical workout-list summary builder in `src/lib/ui/workout-list-items.ts`.
- Historical week navigation is now explicit in the contract:
  - `volumeThisWeek` and `rirTarget` are tied to `viewedWeek`
  - `deloadReadiness` remains tied to the live `currentWeek`
- `ProgramStatusCard` now initializes local week state from `viewedWeek`, matching the route contract for historical navigation.

### Phase 3 - Workout List Surface Unification
Status: COMPLETE (implemented 2026-03-04)

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

Implementation summary:
- `WorkoutListSurfaceSummary` in `src/lib/ui/workout-list-items.ts` is now the explicit canonical row contract for:
  - home-page Recent Workouts
  - `/history` initial server preload
  - `GET /api/workouts/history`
- Shared list-surface display semantics now live alongside that contract in `src/lib/ui/workout-list-items.ts`:
  - status label mapping
  - status badge classes
  - intent label formatting
  - exercise-count copy
  - logged-set copy
- `RecentWorkouts.tsx` now consumes `WorkoutListSurfaceSummary[]` directly instead of a thinner page-local adapter shape.
- `HistoryClient.tsx` now reuses the same shared list display helpers for row rendering and status-filter labels.
- Session snapshot badge labels remain canonical through `formatWorkoutSessionSnapshotLabel()` in `src/lib/ui/workout-session-snapshot.ts`.
- Surface-local behavior remains local:
  - `/history` filters, pagination, deletion, empty/loading states
  - home-page compact row layout
  - local date formatting per surface

### Phase 4 - Analytics Contract and Semantics Pass
Status: COMPLETE (implemented 2026-03-04)

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

Implementation summary:
- Shared analytics counting/window semantics now live in `src/lib/api/analytics-semantics.ts`:
  - generated vs performed vs completed workout counting
  - explicit rolling-day, rolling-ISO-week, date-range, and all-time window descriptors
- `GET /api/analytics/summary` now exposes one explicit workout vocabulary:
  - `workoutsGenerated`
  - `workoutsPerformed`
  - `workoutsCompleted`
  - performed-set totals scoped separately by `completedAt`
- `GET /api/analytics/templates` now reports template follow-through with explicit generated/performed/completed fields instead of one ambiguous total/completion pair.
- `GET /api/analytics/volume` and `GET /api/analytics/recovery` now return explicit semantics metadata documenting their rolling windows and performed-workout basis.
- `/analytics` overview now consumes the summary route directly and uses the same generated/performed/completed language shown by the route contract.
- Shared concepts are now intentionally separated rather than implied to be the same:
  - program/dashboard volume remains mesocycle-week scoped
  - analytics volume remains rolling ISO-week charting
  - recovery remains a rolling 14-day SRA view from performed sessions
  - template usage remains an all-time generated/performed/completed follow-through view

### Phase 5 - User-Facing Summary and Navigation Simplification
Status: COMPLETE (implemented 2026-03-04)

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

Implementation summary:
- Primary navigation now includes `/program`, so the core read-side surfaces are reachable from the top-level nav without relying on the home dashboard as the only entry point.
- Shared surface-purpose metadata now lives in `src/lib/ui/app-surface-map.ts`, with a small `SurfaceGuideCard` component used to explain adjacent surfaces and reinforce the “what should I look at next?” flow.
- Home remains the operational dashboard for today:
  - next-session and resume-workout actions stay on `/`
  - the weak settings promo card was replaced with a clearer Program / History / Analytics navigation card
- `/program`, `/history`, and `/analytics` now each state their purpose relative to the others:
  - `/program` = live mesocycle state and current-week decisions
  - `/history` = past session review and filtering
  - `/analytics` = broader trend review
- This phase did not redesign contracts, training logic, or analytics calculations; it only simplified how users understand and move between the already-stabilized surfaces.

### Phase 6 - Explainability Quality Pass
Status: COMPLETE (implemented 2026-03-04)

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

Implementation summary:
- Explainability confidence wording in `src/lib/api/explainability.ts` now names missing signals directly:
  - `same-day readiness check-in`
  - `receipt-backed cycle context`
  - `stored exercise selection reasons`
  - `recent performance-derived workout stats`
- Confidence summaries now distinguish between:
  - complete evidence
  - one approximated signal
  - multiple missing signals where the audit can explain only part of the session with confidence
- `/workout/[id]/audit` now scans in two passes instead of one mixed disclosure:
  - a session-level scan for evidence quality, cycle context, progression evidence, and week-volume checks
  - an exercise drill-down for per-lift rationale and prescription details
- Repetitive low-signal copy was removed from the audit panel:
  - the generic session-rules bullet list
  - the older disclosure framing around â€œDetailed programming breakdownâ€
  - engine-shaped confidence notes such as raw `confidence=...` wording for MANUAL/INTENT history cases
- Exercise-level progression copy now emphasizes:
  - what anchor was available
  - what todayâ€™s target is
  - whether progression was held, advanced, deloaded, or readiness-scaled

### Phase 7 - Documentation, Deletion, and Verification Pass
Status: COMPLETE (implemented 2026-03-04)

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

Implementation summary:
- Updated canonical docs to describe the current explainability/audit route split once in `docs/01_ARCHITECTURE.md`, with other docs referencing that boundary instead of restating it.
- Removed stale comments and low-signal copy tied to the earlier explainability panel structure.
- Added focused tests for the new confidence/missing-signal wording and the new audit scan layout.
- Focused validation passed for the touched explainability/session-summary paths.

## Priority buckets

Do now:
- Treat this roadmap as complete through Phase 7.
- Use it as the read-side completion log and boundary reference.

Do next:
- The next substantial follow-on is the workout audit harness work in `docs/archive/10_WORKOUT_AUDIT_HARNESS_DESIGN.md`.
- Only reopen history/analytics/dashboard phases if a future product pass needs them.

Do later:
- Broader UX or analytics refinement after new product requirements emerge.

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
