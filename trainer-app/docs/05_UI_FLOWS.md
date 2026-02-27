# 05 UI Flows

Owner: Aaron
Last reviewed: 2026-02-27
Purpose: Canonical reference for current UI routes and core user flows implemented in the Next.js App Router.

This doc covers:
- Route-level UI map
- Core workflows for onboarding, generation, logging, analytics, templates, and program view
- UI to API boundary references

Invariants:
- Routes are defined by `src/app/**/page.tsx`.
- Workout detail and logging flows must stay consistent with workout status transitions.
- UI should consume API responses and avoid duplicating contract logic.

Sources of truth:
- `trainer-app/src/app`
- `trainer-app/src/components/LogWorkoutClient.tsx`
- `trainer-app/src/app/api/workouts/save/route.ts`
- `trainer-app/src/app/api/logs/set/route.ts`

## Route map
- `/`: dashboard (`src/app/page.tsx`)
- `/onboarding`: profile setup (`src/app/onboarding/page.tsx`)
- `/workout/[id]`: workout detail + explainability (`src/app/workout/[id]/page.tsx`)
- `/log/[id]`: logging workflow (`src/app/log/[id]/page.tsx`). AppNavigation marks the home (`/`) item active for all `/log/*` paths (`src/components/navigation/AppNavigation.tsx`).
- `/analytics`: analytics dashboards (`src/app/analytics/page.tsx`)
- `/templates`, `/templates/new`, `/templates/[id]/edit`: template management
- `/library`: exercise library (`src/app/library/page.tsx`)
- `/history`: paginated workout history with intent/date/mesocycle filters and volume compliance dots (`src/app/history/page.tsx`, `src/components/HistoryClient.tsx`)
- `/settings`: user settings (`src/app/settings/page.tsx`)
- `/program`: mesocycle/block/program dashboard (`src/app/program/page.tsx`)

## Core user flows
1. Onboarding/profile setup
- UI: `/onboarding`
- API: `POST /api/profile/setup`
- Onboarding/settings profile constraints no longer include session duration input; the form persists goal fields plus `daysPerWeek` and `splitType` (`src/app/onboarding/ProfileForm.tsx`, `src/app/settings/page.tsx`, `src/lib/validation.ts`).

2. Generate and save workout
- UI entry points: dashboard/template/intent components
- APIs: `POST /api/workouts/generate-from-template`, `POST /api/workouts/generate-from-intent`, `POST /api/workouts/save`

3. Log sets and complete workout
- UI: `/log/[id]`, `LogWorkoutClient`
- API: `POST /api/logs/set` (and `DELETE /api/logs/set` for log removal)
- Completion actions call `POST /api/workouts/save` with explicit action commands (`mark_completed`, `mark_partial`, `mark_skipped`).
- `mark_completed` can return `workoutStatus: PARTIAL` when unresolved sets remain; UI must treat this as a performed session result, not a hard error.
- `mark_partial` is surfaced as an explicit "Save progress" button in the active-set panel once at least one set has been logged (`loggedCount > 0`). It persists a `PARTIAL` status without requiring all sets to be resolved first (`src/components/LogWorkoutClient.tsx`).
- Plan writes remain non-terminal (`save_plan`) and do not finalize `COMPLETED|PARTIAL|SKIPPED`.
- Log page now surfaces persisted cycle/explainability context (`cycleContext`, deload decision reason, and derived target RIR) from `selectionMetadata` parsing in `src/app/log/[id]/page.tsx` and `src/lib/ui/explainability.ts`.

4. Review workout rationale
- UI: `/workout/[id]` via `WorkoutExplanation`
- API: `GET /api/workouts/[id]/explanation`
- Explainability panel now renders a session-level Training Status card (intent, cycle-source badge, readiness label, deload summary, and conditional Start logging CTA) via `src/components/explainability/SessionContextCard.tsx` and `src/components/explainability/ExplainabilityPanel.tsx`.
- Programming Logic UI is split into Evidence vs Selection tabs in `src/components/explainability/ExplainabilityPanel.tsx`, while selection details continue through `src/components/explainability/ExerciseRationaleCard.tsx`.
- Workout detail copy for prescription/load provenance now treats `PARTIAL` and `COMPLETED` as performed states through `src/lib/ui/session-overview.ts` and usage in `src/app/workout/[id]/page.tsx`.

5. Program and readiness loop
- UI: `/program`, readiness components
- APIs: `/api/program`, `/api/readiness/submit`, `/api/stalls`, `/api/periodization/macro`
- Dashboard training status uses API-provided `daysPerWeek` for session totals (not a fixed weekly constant) in `src/components/TrainingStatusCard.tsx`, with value supplied by `loadProgramDashboardData()` in `src/lib/api/program.ts`.
- `ProgramDashboardData` now includes `lastSessionSkipped` (bool), `latestIncomplete` (workout id/status), `rirTarget` (RIR band for current meso week), and `coachingCue` (human-readable session readiness message), all used by `TrainingStatusCard` to surface coaching context on the dashboard.
