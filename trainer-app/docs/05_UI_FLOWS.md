# 05 UI Flows

Owner: Aaron
Last reviewed: 2026-03-08
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

Route-purpose shorthand:
- `/` = today’s operational dashboard
- `/program` = live mesocycle and current-week decision support
- `/history` = past session review and filtering
- `/analytics` = longer-term trend review

## Core user flows
1. Onboarding/profile setup
- UI: `/onboarding`
- API: `POST /api/profile/setup`
- Onboarding/settings profile constraints no longer include session duration input; the form persists goal fields plus `daysPerWeek` and `splitType` (`src/app/onboarding/ProfileForm.tsx`, `src/app/settings/page.tsx`, `src/lib/validation.ts`).

2. Generate and save workout
- UI entry points: dashboard/template/intent components
- APIs: `POST /api/workouts/generate-from-template`, `POST /api/workouts/generate-from-intent`, `POST /api/workouts/save`
- `IntentWorkoutCard` and `GenerateFromTemplateCard` consume shared generation response types and pass session-level context through the canonical `selectionMetadata.sessionDecisionReceipt` flow described in `docs/01_ARCHITECTURE.md` (`src/components/IntentWorkoutCard.tsx`, `src/components/GenerateFromTemplateCard.tsx`, `src/components/log-workout/api.ts`).

3. Log sets and complete workout
- UI: `/log/[id]`, `LogWorkoutClient`
- API: `POST /api/logs/set` (and `DELETE /api/logs/set` for log removal)
- Completion actions call `POST /api/workouts/save` with explicit action commands (`mark_completed`, `mark_partial`, `mark_skipped`).
- Live set logs are the only actions that start or advance the rest timer. Historical set editing is timer-neutral.
- The rest timer is persisted per workout in session storage and re-synced when the user returns to the in-progress log page for the same workout.
- Queue browsing stays scroll-neutral: tapping an exercise row only expands/collapses that row. Active-card auto-scroll is reserved for explicit set-chip targeting and live auto-advance after a set log.
- If every set in the session is skipped, the footer completion path resolves through `mark_skipped` and the terminal state renders explicit skipped-session messaging with replacement/home actions instead of attempting a completed save path.
- `mark_completed` can return `workoutStatus: PARTIAL` when unresolved sets remain; UI must treat this as a performed session result, not a hard error.
- `mark_partial` is surfaced as a single footer-level "Leave for now" action once at least one set has been logged (`loggedCount > 0`). It persists a `PARTIAL` status without requiring all sets to be resolved first (`src/components/LogWorkoutClient.tsx`).
- Plan writes remain non-terminal (`save_plan`) and do not finalize `COMPLETED|PARTIAL|SKIPPED`.
- Log page now renders the same receipt-first session summary card used on workout detail by building a `SessionSummaryModel` from explainability context plus `selectionMetadata.sessionDecisionReceipt` (`src/app/log/[id]/page.tsx`, `src/lib/ui/session-summary.ts`, `src/components/explainability/SessionContextCard.tsx`).

4. Review workout rationale
- UI: `/workout/[id]` for the default user-facing session summary, `/workout/[id]/audit` for detailed explainability
- API: `GET /api/workouts/[id]/explanation`
- The route boundary is canonical in `docs/01_ARCHITECTURE.md`; this flow doc only records the implemented UX.
- Workout detail now renders the receipt-first session summary directly and no longer mounts the full explainability panel in the default flow (`src/app/workout/[id]/page.tsx`, `src/lib/ui/session-summary.ts`, `src/components/explainability/SessionContextCard.tsx`).
- `/workout/[id]` stays compact: session summary, practical set review, and short load-call context for main lifts.
- Detailed explainability is intentionally separated into `/workout/[id]/audit`, which loads `WorkoutExplanation` and exposes the richer evidence panels for internal auditing (`src/app/workout/[id]/audit/page.tsx`, `src/components/WorkoutExplanation.tsx`, `src/components/explainability/ExplainabilityPanel.tsx`).
- The audit page uses the same summary card at the top, then splits into a session-level scan and an exercise drill-down (`src/components/explainability/ExplainabilityPanel.tsx`, `src/components/explainability/ExerciseRationaleCard.tsx`).
- Workout detail copy for prescription/load provenance now treats `PARTIAL` and `COMPLETED` as performed states through `src/lib/ui/session-overview.ts` and usage in `src/app/workout/[id]/page.tsx`.
- Workout detail and log pages both read session-level context through `parseExplainabilitySelectionMetadata()`, which is canonical-receipt only for `sessionDecisionReceipt` (`src/app/workout/[id]/page.tsx`, `src/app/log/[id]/page.tsx`, `src/lib/ui/explainability.ts`).

5. Program and readiness loop
- UI: `/program`, readiness components
- APIs: `/api/program`, `/api/readiness/submit`, `/api/stalls`, `/api/periodization/macro`
- Dashboard training status is rendered by `ProgramStatusCard` (`src/components/ProgramStatusCard.tsx`), a client component that replaces the former `TrainingStatusCard`. It supports historical week navigation: clicking a week pill fetches `GET /api/program?week=N` and re-renders volume data for that week without a full-page reload.
- `ProgramDashboardData` is now scoped to the shared dashboard card: `activeMeso`, `currentWeek`, `viewedWeek`, `sessionsUntilDeload`, `volumeThisWeek`, `deloadReadiness`, `rirTarget`, and `coachingCue` (`src/lib/api/program.ts`, `src/components/ProgramStatusCard.tsx`). `volumeThisWeek` rows also carry dashboard-only opportunity metadata.
- `ProgramStatusCard` now renders weighted weekly `effectiveSets` as the primary per-muscle number and treats raw `directSets` / `indirectSets` as contextual copy only (`src/components/ProgramStatusCard.tsx`, `src/components/ProgramStatusCard.render.test.tsx`).
- `ProgramStatusCard` now renders a subtle per-muscle `opportunityState` badge for the live current week only (`High opportunity`, `Moderate opportunity`, `Covered`, `Deprioritize today`). Historical week views keep opportunity hidden because the current server model uses present recency/readiness context rather than historical replay.
- The home page loads next-session / resume-workout helpers separately through `loadHomeProgramSupport()` (`src/lib/api/program.ts`) instead of treating them as part of the shared dashboard-card contract.
- `currentWeek`, `viewedWeek`, lifecycle RIR, and weekly volume targets are duration-aware: accumulation spans `durationWeeks - 1`, and the final week is deload instead of assuming a fixed 4+1 structure.
- `ProgramStatusCard` is mounted on both the home dashboard (`src/app/page.tsx`) and the `/program` page (`src/app/program/page.tsx`), replacing the prior inline server-rendered volume table on `/program`.
- `/program` session history is no longer carried inside `ProgramDashboardData`; it is loaded independently from the canonical workout-list summary builder in `src/lib/ui/workout-list-items.ts`.
- Recent Workouts (`src/components/RecentWorkouts.tsx`) and History (`src/components/HistoryClient.tsx`) now share the same workout-list summary contract and display helpers from `src/lib/ui/workout-list-items.ts` for status labels, intent labels, and exercise/set count copy. Both still render the same derived week/session badge from `sessionSnapshot` via `src/lib/ui/workout-session-snapshot.ts`. Planned workouts show this badge immediately upon plan-save because the save route now snapshots mesocycle context for new plan writes.

## Optional gap-fill flow
1. Dashboard/home support computes optional-session state (`loadHomeProgramSupport()` in `src/lib/api/program.ts`) with `anchorWeek`, suppression flags, and policy caps.
2. UI shows the optional gap-fill card only when eligible (`src/components/OptionalGapFillCard.tsx`).
3. Generate action calls `POST /api/workouts/generate-from-intent` with:
  - `intent=body_part`
  - `optionalGapFill=true`
  - `weekCloseId`
  - `targetMuscles`
  - policy caps (`maxGeneratedHardSets`, `maxGeneratedExercises`)
  The route resolves the authoritative pending week-close row and injects `optionalGapFillContext.targetWeek` server-side before planner generation (`src/app/api/workouts/generate-from-intent/route.ts`, `src/lib/api/template-session.ts`).
  Generated response metadata is normalized through `attachOptionalGapFillMetadata()` before save so the client keeps canonical `selectionMetadata.weekCloseId`, `targetMuscles`, and `optional_gap_fill` receipt marker without UI-local metadata forks (`src/components/OptionalGapFillCard.tsx`, `src/lib/ui/selection-metadata.ts`).
4. Save action calls `POST /api/workouts/save` with `advancesSplit=false` semantics enforced server-side by strict triplet classification.
5. Disappearance rules:
  - Next-week `PLANNED` carryover does not hide prior-week optional gap-fill.
  - Started carryover (`IN_PROGRESS`/`PARTIAL`) suppresses prior-week optional gap-fill.
6. Labels and week/session mapping:
  - list/log summary labels use canonical strict classifier for `Gap Fill` title + muscles subtext
  - week/session badge uses snapshot-first semantics, so optional session renders as anchor `Wk:S` (sessions-per-week + 1 slot)

6. Analytics review
- UI: `/analytics`
- APIs: `GET /api/analytics/summary`, `GET /api/analytics/volume`, `GET /api/analytics/recovery`, `GET /api/analytics/templates`
- The analytics overview now consumes `GET /api/analytics/summary` directly to show generated vs performed vs completed workout counts plus selection-mode and intent follow-through (`src/app/analytics/page.tsx`, `src/components/analytics/AnalyticsSummaryPanel.tsx`).
- Analytics routes now expose explicit `semantics` metadata describing their counting vocabulary and time windows (`src/lib/api/analytics-semantics.ts`, `src/app/api/analytics/**/route.ts`).
- Volume analytics remains intentionally separate from the program dashboard:
  - `/program` volume is mesocycle-week scoped for decision support
  - `/analytics` volume is rolling ISO-week charting for trend review
- Recovery analytics remains a rolling 14-day SRA view from performed sessions rather than a live readiness/dashboard score.
- Dashboard opportunity is a separate abstraction from analytics recovery: it is driven by weekly target pressure, recent local weighted stimulus, and optional fresh readiness modulation rather than raw recovery percent.
- Template analytics now distinguishes generated, performed, and completed template workouts instead of treating one completion percentage as the only usage signal.

7. Cross-surface navigation simplification
- Primary navigation now includes `/program` in addition to `/`, `/history`, and `/analytics` (`src/components/navigation/AppNavigation.tsx`).
- Shared surface-purpose metadata lives in `src/lib/ui/app-surface-map.ts`, and `SurfaceGuideCard` uses it to show adjacent surfaces without duplicating route-purpose copy in multiple page-local implementations (`src/components/SurfaceGuideCard.tsx`).
- Home keeps the operational actions for “what should I do now?”, while `/program`, `/history`, and `/analytics` each include a short cross-linking guide to reinforce “where should I go next?” without duplicating the home dashboard’s operational role.
