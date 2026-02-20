# 05 UI Flows

Owner: Aaron  
Last reviewed: 2026-02-20  
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
- `/log/[id]`: logging workflow (`src/app/log/[id]/page.tsx`)
- `/analytics`: analytics dashboards (`src/app/analytics/page.tsx`)
- `/templates`, `/templates/new`, `/templates/[id]/edit`: template management
- `/library`: exercise library (`src/app/library/page.tsx`)
- `/settings`: user settings (`src/app/settings/page.tsx`)
- `/program`: mesocycle/block/program dashboard (`src/app/program/page.tsx`)

## Core user flows
1. Onboarding/profile setup
- UI: `/onboarding`
- API: `POST /api/profile/setup`

2. Generate and save workout
- UI entry points: dashboard/template/intent components
- APIs: `POST /api/workouts/generate-from-template`, `POST /api/workouts/generate-from-intent`, `POST /api/workouts/save`

3. Log sets and complete workout
- UI: `/log/[id]`, `LogWorkoutClient`
- API: `POST /api/logs/set` (and `DELETE /api/logs/set` for log removal)
- Completion actions call `POST /api/workouts/save` with explicit action commands (`mark_completed`, `mark_skipped`).
- `mark_completed` can return `workoutStatus: PARTIAL` when unresolved sets remain; UI must treat this as a performed session result, not a hard error.
- Plan writes remain non-terminal (`save_plan`) and do not finalize `COMPLETED|PARTIAL|SKIPPED`.

4. Review workout rationale
- UI: `/workout/[id]` via `WorkoutExplanation`
- API: `GET /api/workouts/[id]/explanation`

5. Program and readiness loop
- UI: `/program`, readiness components
- APIs: `/api/program`, `/api/readiness/submit`, `/api/stalls`, `/api/periodization/macro`
