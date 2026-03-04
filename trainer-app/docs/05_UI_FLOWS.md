# 05 UI Flows

Owner: Aaron
Last reviewed: 2026-03-04
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
- `/workout/[id]`: workout detail + receipt-first session summary (`src/app/workout/[id]/page.tsx`)
- `/workout/[id]/audit`: internal explainability audit surface (`src/app/workout/[id]/audit/page.tsx`)
- `/log/[id]`: logging workflow (`src/app/log/[id]/page.tsx`). AppNavigation marks the home (`/`) item active for all `/log/*` paths (`src/components/navigation/AppNavigation.tsx`).
- `/analytics`: analytics dashboards (`src/app/analytics/page.tsx`)
- `/templates`, `/templates/new`, `/templates/[id]/edit`: template management
- `/library`: exercise library (`src/app/library/page.tsx`)
- `/history`: paginated workout history with intent/date/mesocycle filters and derived week/session snapshot badges (`src/app/history/page.tsx`, `src/components/HistoryClient.tsx`)
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
- `IntentWorkoutCard` and `GenerateFromTemplateCard` consume shared generation response types and save only canonicalized selection metadata; session-level context is passed through `selectionMetadata.sessionDecisionReceipt`, not duplicated as top-level mirrors (`src/components/IntentWorkoutCard.tsx`, `src/components/GenerateFromTemplateCard.tsx`, `src/components/log-workout/api.ts`).

3. Log sets and complete workout
- UI: `/log/[id]`, `LogWorkoutClient`
- API: `POST /api/logs/set` (and `DELETE /api/logs/set` for log removal)
- Completion actions call `POST /api/workouts/save` with explicit action commands (`mark_completed`, `mark_partial`, `mark_skipped`).
- `mark_completed` can return `workoutStatus: PARTIAL` when unresolved sets remain; UI must treat this as a performed session result, not a hard error.
- `mark_partial` is surfaced as a single footer-level "Leave for now" action once at least one set has been logged (`loggedCount > 0`). It persists a `PARTIAL` status without requiring all sets to be resolved first (`src/components/LogWorkoutClient.tsx`).
- Plan writes remain non-terminal (`save_plan`) and do not finalize `COMPLETED|PARTIAL|SKIPPED`.
- Log page now renders the same receipt-first session summary card used on workout detail by building a `SessionSummaryModel` from explainability context plus `selectionMetadata.sessionDecisionReceipt` (`src/app/log/[id]/page.tsx`, `src/lib/ui/session-summary.ts`, `src/components/explainability/SessionContextCard.tsx`).

4. Review workout rationale
- UI: `/workout/[id]` for the default user-facing session summary, `/workout/[id]/audit` for detailed explainability
- API: `GET /api/workouts/[id]/explanation`
- Workout detail now renders the receipt-first session summary directly and no longer mounts the full explainability panel in the default flow (`src/app/workout/[id]/page.tsx`, `src/lib/ui/session-summary.ts`, `src/components/explainability/SessionContextCard.tsx`).
- Detailed explainability is intentionally separated into `/workout/[id]/audit`, which loads `WorkoutExplanation` and exposes the richer evidence and exercise-detail panels for internal auditing (`src/app/workout/[id]/audit/page.tsx`, `src/components/WorkoutExplanation.tsx`, `src/components/explainability/ExplainabilityPanel.tsx`).
- The audit explainability panel now uses the same summary card at the top, then places confidence details and the Evidence vs Exercise details breakdown inside a secondary disclosure (`src/components/explainability/ExplainabilityPanel.tsx`, `src/components/explainability/ExerciseRationaleCard.tsx`).
- Workout detail copy for prescription/load provenance now treats `PARTIAL` and `COMPLETED` as performed states through `src/lib/ui/session-overview.ts` and usage in `src/app/workout/[id]/page.tsx`.
- Workout detail and log pages both read session-level context through `parseExplainabilitySelectionMetadata()`, which is now canonical-receipt only for `sessionDecisionReceipt` (`src/app/workout/[id]/page.tsx`, `src/app/log/[id]/page.tsx`, `src/lib/ui/explainability.ts`).

5. Program and readiness loop
- UI: `/program`, readiness components
- APIs: `/api/program`, `/api/readiness/submit`, `/api/stalls`, `/api/periodization/macro`
- Dashboard training status is rendered by `ProgramStatusCard` (`src/components/ProgramStatusCard.tsx`), a client component that replaces the former `TrainingStatusCard`. It supports historical week navigation: clicking a week pill fetches `GET /api/program?week=N` and re-renders volume data for that week without a full-page reload.
- `ProgramDashboardData` includes `lastSessionSkipped` (bool), `latestIncomplete` (workout id/status), `rirTarget` (RIR band for the viewed meso week), `coachingCue` (human-readable session readiness message), `currentWeek`, and `viewedWeek` (the week whose volume is displayed), all consumed by `ProgramStatusCard`.
- `currentWeek`, `viewedWeek`, lifecycle RIR, and weekly volume targets are duration-aware: accumulation spans `durationWeeks - 1`, and the final week is deload instead of assuming a fixed 4+1 structure.
- `ProgramStatusCard` is mounted on both the home dashboard (`src/app/page.tsx`) and the `/program` page (`src/app/program/page.tsx`), replacing the prior inline server-rendered volume table on `/program`.
- Recent Workouts (`src/components/RecentWorkouts.tsx`) and History (`src/components/HistoryClient.tsx`) now display a week/session badge from a derived `sessionSnapshot` summary built from mesocycle snapshot persistence. Planned workouts show this badge immediately upon plan-save because the save route now snapshots mesocycle context for new plan writes.
