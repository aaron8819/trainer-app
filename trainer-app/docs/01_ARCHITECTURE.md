# 01 Architecture

Owner: Aaron  
Last reviewed: 2026-03-04  
Purpose: Defines the current runtime architecture for the single-user local-first Trainer app and the boundaries between UI, API routes, orchestration, engine, and persistence.

This doc covers:
- App Router UI and API boundaries
- Orchestration and engine boundaries
- Persistence and runtime identity model

Invariants:
- Runtime identity is owner-scoped via `resolveOwner()`.
- App routes and API routes are the only external app surface.
- Engine logic is pure/domain-focused under `src/lib/engine`; DB access lives in API/orchestration.
- Mesocycle lifecycle state transitions are owned by `src/lib/api/mesocycle-lifecycle.ts`.

Sources of truth:
- `trainer-app/src/lib/api/workout-context.ts`
- `trainer-app/src/lib/db/prisma.ts`
- `trainer-app/src/app`
- `trainer-app/src/app/api`
- `trainer-app/src/lib/api`
- `trainer-app/src/lib/engine`

## Runtime layers
1. UI layer: App Router pages and client components under `src/app` and `src/components`.
2. API layer: route handlers under `src/app/api/**/route.ts`.
3. Orchestration layer: runtime composition under `src/lib/api`.
4. Mesocycle lifecycle service layer: lifecycle counters/state transitions and week/volume/RIR derivation in `src/lib/api/mesocycle-lifecycle.ts`.
5. Engine layer: selection/progression/periodization/readiness/explainability logic under `src/lib/engine`.
6. Data layer: Prisma models and migrations under `prisma/` and client setup in `src/lib/db/prisma.ts`.

## Single-user local-first behavior
- `resolveOwner()` upserts a deterministic owner user, using `OWNER_EMAIL` or fallback `owner@local`.
- `RUNTIME_MODE` defaults to `single_user_local`; current behavior is owner-scoped upsert for runtime data access.
- All major pages and API flows resolve the owner before loading/writing data.

## App surface
- UI pages are defined in `src/app/**/page.tsx` (dashboard, onboarding, workout/log detail, analytics, templates, library, settings, program).
- API routes are defined in `src/app/api/**/route.ts` and validated through `src/lib/validation.ts` where applicable.

## Data and control flow (high level)
1. UI calls API routes.
2. API routes validate input, resolve owner, and call orchestration helpers in `src/lib/api`.
3. Orchestration loads context from Prisma and invokes engine functions.
4. Engine returns deterministic plan/rationale outputs.
5. API persists workout/log changes and returns response payloads.

## Canonical session-decision flow
- Generation/finalization build the canonical session decision under `selectionMetadata.sessionDecisionReceipt` in `src/lib/api/template-session.ts` and `src/lib/api/template-session/finalize-session.ts`.
- Save requires that receipt, then only re-parses/re-normalizes the persisted JSON shape at the database boundary in `src/app/api/workouts/save/route.ts` and `src/lib/evidence/session-decision-receipt.ts`.
- Runtime readers in UI and explainability consume only `selectionMetadata.sessionDecisionReceipt` via `src/lib/ui/selection-metadata.ts`, `src/lib/ui/explainability.ts`, and `src/lib/api/explainability.ts`.
- Removed top-level session mirrors (`wasAutoregulated`, `autoregulationLog`, legacy `selectionMetadata.*` session fields) remain guardrail rejects in `src/lib/validation.ts`; they are not active runtime inputs.
- User-facing workout detail and log routes stay on the compact receipt-first `SessionSummaryModel`, while the internal `/workout/[id]/audit` route layers a session-level audit scan plus exercise drill-down on top of the same receipt/explainability inputs. That split is a presentation boundary only; ownership remains receipt-first in `selectionMetadata.sessionDecisionReceipt`.

## Lifecycle ownership and data entities
- Lifecycle state transitions (`ACTIVE_ACCUMULATION` -> `ACTIVE_DELOAD` -> `COMPLETED`) are executed by `transitionMesocycleState()` in `src/lib/api/mesocycle-lifecycle.ts`, invoked from `src/app/api/workouts/save/route.ts` after first transition into a performed status.
- Lifecycle-derived targeting helpers (`getCurrentMesoWeek()`, `getWeeklyVolumeTarget()`, `getRirTarget()`) are consumed by template-session orchestration.
- `MesocycleExerciseRole` is a first-class data-layer entity for intent-scoped exercise role continuity (`CORE_COMPOUND` / `ACCESSORY`) across mesocycle lifecycle events.

## Canonical read-side boundaries
- `ProgramDashboardData` in `src/lib/api/program.ts` is the canonical program dashboard read model for the shared `ProgramStatusCard` mounted on `/` and `/program`. It owns mesocycle header/timeline state, current vs viewed week, lifecycle RIR target, deload/readiness cue, and mesocycle-week volume rows. It is not the canonical contract for generic workout-history lists.
- Home-page operational helpers that are not part of the shared dashboard card contract live separately in `loadHomeProgramSupport()` in `src/lib/api/program.ts`. That loader owns next-session intent, resume-workout targeting, and skipped-last-session hints for `/` only.
- `WorkoutListSurfaceSummary` in `src/lib/ui/workout-list-items.ts` is the canonical workout/session summary read model for list surfaces. `/history`, `GET /api/workouts/history`, and the home-page Recent Workouts section should anchor on this shape rather than ad hoc row contracts.
- Shared workout-list display semantics for those list surfaces now live with that contract in `src/lib/ui/workout-list-items.ts`: status labels/classes, intent labels, and exercise/set count copy are centralized there so Recent Workouts and History do not drift.
- Shared route-purpose/navigation metadata now lives in `src/lib/ui/app-surface-map.ts`. That metadata is a UI-navigation aid only; it does not own read-model semantics.
- Persisted workout mesocycle snapshot columns (`mesocycleId`, `mesocycleWeekSnapshot`, `mesoSessionSnapshot`, `mesocyclePhaseSnapshot`) are canonical derived storage, but read-side consumers should normalize them before use:
  - engine/history readers use `mesocycleSnapshot` via `mapHistory()` in `src/lib/api/workout-context.ts`
  - UI list surfaces use `WorkoutSessionSnapshotSummary` via `buildWorkoutSessionSnapshotSummary()` in `src/lib/ui/workout-session-snapshot.ts`
  - explainability week-scoped volume compliance uses `readPersistedWorkoutMesocycleSnapshot()` in `src/lib/api/workout-mesocycle-snapshot.ts`
- Analytics routes under `src/app/api/analytics/**` remain surface-oriented projections rather than one shared read model, but they now share one explicit semantics helper in `src/lib/api/analytics-semantics.ts` for generated/performed/completed counting vocabulary and rolling-window descriptions. The stable shared boundary with the rest of the app is still the performed-workout / mesocycle-week semantics they reuse, not the full route payload shapes.
- Surface-local formatting stays in the consuming UI when it does not change domain semantics: date formatting, compact vs full layouts, chart grouping, and tab/panel composition.
