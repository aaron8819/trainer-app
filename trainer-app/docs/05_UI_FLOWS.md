# 05 UI Flows

Owner: Aaron
Last reviewed: 2026-03-11
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
- `mark_completed` is intent only. Save responses return canonical `workoutStatus`, and the logging flow must derive terminal UI state from that returned status.
- `mark_completed` can return `workoutStatus: PARTIAL` when unresolved sets remain; UI must treat this as a performed session result, not a hard error, and must not render the completed review path for that downgraded outcome.
- `mark_partial` is surfaced as a single footer-level "Leave for now" action once at least one set has been logged (`loggedCount > 0`). It persists a `PARTIAL` status without requiring all sets to be resolved first (`src/components/LogWorkoutClient.tsx`).
- Plan writes remain non-terminal (`save_plan`) and do not finalize `COMPLETED|PARTIAL|SKIPPED`.
- Log page now renders the same receipt-first session summary card used on workout detail by building a `SessionSummaryModel` from explainability context plus `selectionMetadata.sessionDecisionReceipt` (`src/app/log/[id]/page.tsx`, `src/lib/ui/session-summary.ts`, `src/components/explainability/SessionContextCard.tsx`).

4. Review workout rationale
- UI: `/workout/[id]` for the default user-facing session summary, `/workout/[id]/audit` for detailed explainability
- API: `GET /api/workouts/[id]/explanation`
- The route boundary is canonical in `docs/01_ARCHITECTURE.md`; this flow doc only records the implemented UX.
- Workout detail now renders the receipt-first session summary directly and no longer mounts the full explainability panel in the default flow (`src/app/workout/[id]/page.tsx`, `src/lib/ui/session-summary.ts`, `src/components/explainability/SessionContextCard.tsx`).
- `/workout/[id]` stays compact, but now leads with a post-workout hierarchy for performed sessions: `Session outcome` -> `Key lift takeaways` -> dedicated `Program impact` -> detailed set review, with `Next time` guidance emphasized in the summary and lift cards rather than repeated as a separate top-level program tile. This is the main user path and should answer "how it went / what it means / what happens next" before raw set-level trace.
- Immediate completed-workout review follows the same hierarchy after save, then links into the full workout review page for the original workout structure, deeper exercise detail, and fuller session context.
- Completion review and `/workout/[id]` both render their user-facing post-workout call through the same `PostWorkoutInsights` read model (`src/lib/ui/post-workout-insights.ts`). Completed-workout wording should stay aligned with canonical next-exposure behavior across both surfaces rather than letting the two review entry points drift independently.
- Canonical next-exposure action wording on those review surfaces now flows through `src/lib/ui/next-exposure-copy.ts`. If a surface is presenting canonical `increase | hold | decrease` next-session meaning, it should consume that formatter instead of inventing local action copy.
- Detailed explainability is intentionally separated into `/workout/[id]/audit`, which loads `WorkoutExplanation` and exposes the richer evidence panels for internal auditing (`src/app/workout/[id]/audit/page.tsx`, `src/components/WorkoutExplanation.tsx`, `src/components/explainability/ExplainabilityPanel.tsx`).
- The audit page uses the same summary card at the top, then splits into a session-level scan and an exercise drill-down (`src/components/explainability/ExplainabilityPanel.tsx`, `src/components/explainability/ExerciseRationaleCard.tsx`).
- Workout detail copy for prescription/load provenance now treats `PARTIAL` and `COMPLETED` as performed states through `src/lib/ui/session-overview.ts` and usage in `src/app/workout/[id]/page.tsx`.
- Workout detail and log pages both read session-level context through `parseExplainabilitySelectionMetadata()`, which is canonical-receipt only for `sessionDecisionReceipt` (`src/app/workout/[id]/page.tsx`, `src/app/log/[id]/page.tsx`, `src/lib/ui/explainability.ts`).

5. Program and readiness loop
- UI: `/program`, readiness components
- APIs: `/api/program`, `/api/readiness/submit`, `/api/stalls`, `/api/periodization/macro`
- Dashboard training status is rendered by `ProgramStatusCard` (`src/components/ProgramStatusCard.tsx`), a client component that replaces the former `TrainingStatusCard`. It supports historical week navigation: clicking a week pill fetches `GET /api/program?week=N` and re-renders the selected dashboard payload for that week without a full-page reload.
- `ProgramDashboardData` is now scoped to the shared dashboard card: `activeMeso`, `currentWeek`, `viewedWeek`, `viewedBlockType`, `sessionsUntilDeload`, `volumeThisWeek`, `deloadReadiness`, `rirTarget`, and `coachingCue` (`src/lib/api/program.ts`, `src/components/ProgramStatusCard.tsx`). `volumeThisWeek` rows also carry dashboard-only opportunity metadata.
- Dashboard `Target RIR this week` and phase coaching copy are read from the canonical block-aware lifecycle seam used by generation (`resolvePhaseBlockProfile() -> getRirTarget()`), not from UI-local week heuristics or hardcoded phase-to-RIR mappings.
- `ProgramStatusCard` renders weighted weekly `effectiveSets` as the primary per-muscle number (`12 weighted sets`, `target 16 weighted sets`) and treats raw `directSets` / `indirectSets` as contextual structural copy only (`Raw sets: 13 direct, 4 indirect`). The per-muscle bar is scaled to weekly target completion, while MEV / MAV / MRV remain visible as landmark context (`src/components/ProgramStatusCard.tsx`, `src/components/ProgramStatusCard.render.test.tsx`).
- `ProgramStatusCard` separates weekly volume status from live current-week opportunity copy. Each card shows a primary weekly-status chip derived from weighted volume position (`Below MEV`, `In range`, `Near target`, `On target`, `Near MRV`, `At MRV`) plus a lighter current-week-only `Today:` advisory derived from `opportunityState` (`Today: room for more`, `Today: optional`, `Today: covered`, `Today: go lighter`). Historical week views still hide the live-only `Today:` advisory because the current server model uses present recency/readiness context rather than historical replay.
- Program-card `Today:` copy and deload copy are intentionally advisory snapshot framing, not canonical next-session guidance. The UI should preserve that weaker tone unless those surfaces are later rewired to canonical decision seams.
- The per-muscle breakdown sheet explains weighted accounting explicitly: weighted sets count toward the weekly target, raw direct/indirect sets remain structural context, and each contributor row renders `raw sets x exercise weighting = weighted contribution` using the shared weekly-volume read model.
- Historical `ProgramStatusCard` browsing now renders block badge, week/progress chrome, `rirTarget`, coaching cue, and volume rows from the same selected payload. Live-only deload countdown/banner chrome is intentionally hidden while browsing history because deload readiness remains a current-week signal.
- The home page loads next-session / resume-workout helpers separately through `loadHomeProgramSupport()` (`src/lib/api/program.ts`) instead of treating them as part of the shared dashboard-card contract.
- `currentWeek`, `viewedWeek`, lifecycle RIR, and weekly volume targets are duration-aware: accumulation spans `durationWeeks - 1`, and the final week is deload instead of assuming a fixed 4+1 structure.
- `ProgramStatusCard` is mounted on both the home dashboard (`src/app/page.tsx`) and the `/program` page (`src/app/program/page.tsx`), replacing the prior inline server-rendered volume table on `/program`.
- `/program` session history is no longer carried inside `ProgramDashboardData`; it is loaded independently from the canonical workout-list summary builder in `src/lib/ui/workout-list-items.ts`.
- Recent Workouts (`src/components/RecentWorkouts.tsx`) and History (`src/components/HistoryClient.tsx`) now share the same workout-list summary contract and display helpers from `src/lib/ui/workout-list-items.ts` for status labels, intent labels, and exercise/set count copy. Both still render the same derived week/session badge from `sessionSnapshot` via `src/lib/ui/workout-session-snapshot.ts`. Planned workouts show this badge immediately upon plan-save because the save route now snapshots mesocycle context for new plan writes.
- `/library` exercise detail keeps raw recent sessions and bests visible through `PersonalHistorySection`, but its trend copy is explicitly descriptive logged-history framing rather than authoritative improvement-status labeling. That surface is for local history context, not canonical progression interpretation (`src/components/library/PersonalHistorySection.tsx`).

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

## Supplemental deficit flow
1. User invokes supplemental generation from `IntentWorkoutCard` using the existing BODY_PART intent path (`src/components/IntentWorkoutCard.tsx`).
2. Generate action calls `POST /api/workouts/generate-from-intent` with:
  - `intent=body_part`
  - `supplementalDeficitSession=true`
  - `targetMuscles`
  The route owns canonical receipt stamping through `attachSupplementalSessionMetadata()` and enables `supplementalPlannerProfile` before returning `selectionMetadata` to the client unchanged (`src/app/api/workouts/generate-from-intent/route.ts`, `src/lib/ui/selection-metadata.ts`).
3. Planner behavior stays inside the normal BODY_PART pipeline but narrows to small accessory-first patch sessions:
  - single target -> `1-3` exercises
  - multi target -> `2-4` exercises
  - uncapped requests default to `maxGeneratedExercises=4` and `maxGeneratedHardSets=8`
  - selection prefers target-primary, non-main-lift, lower-fatigue work
  - remaining-deficit-aware set caps reduce small patches to `1-2` sets when little weekly deficit remains
4. Save action calls `POST /api/workouts/save`, where strict supplemental classification forces `advancesSplit=false` even if the payload requests otherwise.
5. User-facing meaning:
  - use this to patch a weekly deficit
  - use this to add weak-point work
  - use this to add extra stimulus when recovery allows
  - the session counts for weekly volume and recovery
  - the session does not advance the split
  - the session does not affect load progression or progression anchors
6. Labels:
  - workout lists and history surfaces render the session as `Supplemental`
  - the normal intent/session summary still reflects the BODY_PART intent, but optional-session labeling comes from the strict supplemental classifier (`src/components/RecentWorkouts.tsx`, `src/components/HistoryClient.tsx`, `src/lib/ui/workout-list-items.ts`)

6. Analytics review
- UI: `/analytics`
- APIs: `GET /api/analytics/summary`, `GET /api/analytics/volume`, `GET /api/analytics/muscle-outcomes`, `GET /api/analytics/recovery`, `GET /api/analytics/templates`
- The analytics overview now consumes `GET /api/analytics/summary` directly to show training-consistency metrics first (`this week`, `4-week average`, `training streak`, `weeks at target`), with workout totals and selection-mode telemetry demoted to secondary context (`src/app/analytics/page.tsx`, `src/components/analytics/AnalyticsSummaryPanel.tsx`).
- Analytics routes now expose explicit `semantics` metadata describing their counting vocabulary and time windows (`src/lib/api/analytics-semantics.ts`, `src/app/api/analytics/**/route.ts`).
- Volume analytics remains intentionally separate from the program dashboard:
  - `/program` volume is mesocycle-week scoped for decision support
  - `/analytics` volume is rolling ISO-week charting for trend review
- The Volume tab now defaults to weighted effective-set interpretation for landmark comparisons. Direct and combined set-count modes remain available as structural context, but MEV/MAV/MRV references are only shown in effective-set mode to avoid conflating raw set counts with weighted lifecycle targets (`src/components/analytics/MuscleVolumeChart.tsx`).
- `/analytics` also includes `Muscle Outcome Review`, a current-week table that compares canonical weekly target volume versus actual weighted effective stimulus per muscle and classifies the result as `on target`, `slightly low`, `meaningfully low`, `slightly high`, or `meaningfully high` (`src/components/analytics/MuscleOutcomeReviewPanel.tsx`, `src/lib/api/muscle-outcome-review.ts`).
- The Recovery tab is framed as `Muscle Stimulus Recency`, not a recommendation surface. It explains how recently each muscle was meaningfully stimulated and includes a compact 7-day weighted-stimulus timeline for pattern review (`src/app/analytics/page.tsx`, `src/components/analytics/MuscleRecoveryPanel.tsx`).
- Analytics recovery remains a rolling 14-day SRA-style recency view from performed sessions rather than a training prescription or dashboard score.
- Dashboard opportunity is a separate abstraction from analytics stimulus recency: it is driven by weekly target pressure, recent local weighted stimulus, and optional fresh readiness modulation rather than raw recovery percent.
- Template analytics now distinguishes generated, performed, and completed template workouts instead of treating one completion percentage as the only usage signal.

7. Cross-surface navigation simplification
- Primary navigation now includes `/program` in addition to `/`, `/history`, and `/analytics` (`src/components/navigation/AppNavigation.tsx`).
- Shared surface-purpose metadata lives in `src/lib/ui/app-surface-map.ts`, and `SurfaceGuideCard` uses it to show adjacent surfaces without duplicating route-purpose copy in multiple page-local implementations (`src/components/SurfaceGuideCard.tsx`).
- Home keeps the operational actions for “what should I do now?”, while `/program`, `/history`, and `/analytics` each include a short cross-linking guide to reinforce “where should I go next?” without duplicating the home dashboard’s operational role.
