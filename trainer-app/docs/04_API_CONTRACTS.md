# 04 API Contracts

## Frozen load logging

Set logging reads the measurement tuple and `zeroLoadMeaning` only from the already-materialized `WorkoutExercise`. Client input cannot author or override the capability. Blank load normalizes to null or omission, while explicit numeric zero remains zero through transport validation, semantic validation, and persistence.

## Owner lookup and write-pause ordering

- Pages and read handlers use `findOwnerReadOnly()`. A missing owner produces the route's explicit
  empty, redirect, or `404` behavior and never creates a database row.
- Classified mutation handlers call the central production write gate before request parsing or
  Prisma access, then use `provisionOwnerForMutation(operation)`. The provisioning seam repeats
  the same gate before any database access so indirect callers cannot bypass the pause.
- The static write-boundary verifier inventories every route method and registry-classified
  production-capable database command. It requires a directly dominating route gate, protects
  the explicit read-only owner lookup/provisioning split, and rejects mutation work that can
  precede the gate. It does not claim to be a general TypeScript call-graph analyzer.

## `GET|POST /api/workouts/[id]/finisher`

Both methods first evaluate the canonical server-only rollout setting in
`src/lib/operations/finisher-rollout.ts`. Unless
`TRAINER_FINISHERS_ROLLOUT` is exactly `enabled`, both methods return HTTP 503
with code `FINISHERS_NOT_ENABLED` before request parsing, owner resolution,
Prisma access, or any Finisher read/write. Client input cannot change that
decision.

When enabled, GET looks up the canonical owner without provisioning, while POST provisions only
after its production write gate; both require an owner-scoped completed
workout. GET returns the persisted offer's immutable routine details, original
limitation warnings and recommendation context, `serverTime`, the current
display execution, decline state, and retained execution history. With no
offer, GET returns `offer: null`; the client must create it through the
write-gated `offer` action before displaying choices. GET is a pure read: it may project elapsed interval timestamps and step outcomes
in the response so refresh and background recovery land on the current segment,
but it never creates, updates, completes, resolves, or deletes Finisher state.
Projected responses expose `timer.syncRequired` and a stable boundary token.

POST validates a strict discriminated action contract from
`src/lib/validation.ts`: `offer`, `select`, `decline`, `start`, `dismiss`,
`pause`, `resume`, `skip`, `substitute`, `end`, `feedback`, and explicit `sync`.
Selection requires the durable offer identity, expected offer revision, and a
client-stable execution UUID. Decline similarly carries offer identity/revision
and a stable decision UUID. Selection and decline share one permanent decision
ID namespace. The stored canonical fingerprint binds ID, action, owner, workout,
offer, exact offered item/routine when applicable, expected offer revision, and
contraindication acknowledgment. An exact retry returns the original durable
decision even after the offer advances. Reusing the ID with any changed field,
including across selection and decline, returns
`FINISHER_DECISION_ID_CONFLICT`; a new ID with a stale expected offer revision
returns `FINISHER_STALE_OFFER`. Concurrent identical requests converge, while
unique/serialization races are normalized to documented Finisher conflicts and
never expose Prisma `P2002`.
Every action against an existing execution requires
its exact execution UUID and expected monotonic revision. Every POST action is registered as
`finisher_execution` and is blocked by `TRAINER_WRITE_PAUSE=enabled`.
`start`, `sync`, `pause`, `resume`, `skip`, `substitute`, `end`, `feedback`,
and `dismiss` also require a client-generated UUID `commandId`. The server
checks the durable command receipt before OCC: an exact committed retry returns
the original command response even if its expected revision is now stale or a
later command has advanced current state. Existing-execution command POSTs
return that committed `FinisherExecution` DTO directly, including its persisted
`serverTime`; they do not perform a later GET and substitute projected current
state. GET remains the separate current-state projection contract. The request
hash binds workout, execution, action, expected revision, and payload; reusing
the ID with any different binding returns
`FINISHER_COMMAND_ID_CONFLICT`. A distinct stale or out-of-order command keeps
the existing `FINISHER_STALE_TRANSITION` behavior. Concurrent identical
commands serialize to one transition and one receipt. At or after the receipt's
exact 90-day `expiresAt`, retry and command-ID reuse return
`FINISHER_COMMAND_EXPIRED` (`409`), whether or not payload cleanup has run.
The command transaction reads PostgreSQL `clock_timestamp()` and uses that
database value for receipt creation and replay expiration. The action's
client-supplied display time does not establish or extend the receipt lifetime,
so process-clock skew cannot change retry, collision, or cleanup semantics.
Command rows are permanent database-enforced tombstones: application, Prisma,
bulk, and direct SQL update/delete paths cannot rewrite their binding or remove
the ID. Opportunistic cleanup invokes the constrained database function, which
can clear only an already-expired response payload in an oldest-first batch;
the immutable receipt continues to reject every retry or collision as expired.
Active and started-execution uniqueness is protected by partial unique indexes
and serializable selection transactions. Duplicate selection and decline
decision identities are idempotent only when their immutable binding matches;
conflicting, stale, replayed, or out-of-order requests return deterministic
`409` codes. An exact duplicate command for dismissed A can replay only A's
stored response; a distinct stale request for A can address only A and cannot act
on replacement B. Client input never supplies ownership, workout completion,
elapsed duration, routine metadata, step order, or arbitrary substitutions.
Selection persists the exact finalized offer item, and database composite
relationships independently verify the workout, offer, routine version, and
historical owner even if a caller bypasses the API.

Manual selection and recommendation both consume canonical limitation
resolution. Unknown active text blocks recommendation and requires explicit
acknowledgment before manual selection; known routine conflicts require the same
acknowledgment.

## Finisher library management

`GET|POST /api/finishers`, `POST /api/finishers/reorder`,
`GET|PATCH|DELETE /api/finishers/[id]`, and the `duplicate`, `archive`, and
`restore` subroutes expose the owner-scoped management surface. Every method
first evaluates the server-only Finisher rollout. Mutation methods then call
the central production write gate as `application_configuration` before body
parsing or owner provisioning. Routes delegate DB behavior to
`src/lib/api/finisher-library-service.ts`; foreign and missing routine IDs both
return `404 FINISHER_ROUTINE_NOT_FOUND`.

Create/edit payloads are strict and expose only name, description, category,
difficulty, fatigue/impact demand, controlled body regions, canonical
limitation tags, 0–60 seconds of preparation, final-recovery inclusion, and
1–20 ordered timed steps. Each step has movement, work/recovery seconds, up to
three cues, and up to three predefined alternatives. Placement, kind, and
protocol remain `POST_WORKOUT`, `FINISHER`, and `TIMED_INTERVALS` and equipment
requirements are not accepted. The shared duration policy rejects definitions
over 30 minutes.

Edit appends immutable version N+1. Edit/archive/restore/delete require the
current library `expectedRevision`; stale requests return `409
FINISHER_LIBRARY_STALE` and are never merged. Reorder submits the complete
desired active routine ID/revision sequence, which is validated and persisted
atomically. System edit/delete is blocked; duplication is the Customize path
and requires the exact displayed `expectedRoutineVersionId`. A newer source
version returns `409 FINISHER_LIBRARY_STALE`; overlay reorder revisions do not
invalidate duplication.
Deletion also returns `409 FINISHER_ROUTINE_DELETE_BLOCKED` for a user routine
with a selected or in-progress execution.

`POST /api/workouts/delete` rejects a workout with any attached Finisher offer
or lifecycle history with HTTP `409` and code
`WORKOUT_FINISHER_HISTORY_CONFLICT`. The
transaction rolls back its workout revision claim, leaves both records
unchanged, and does not expose Prisma or foreign-key details.
For a compatible non-V4 mesocycle in `AWAITING_HANDOFF`, deletion first derives the post-delete
lifecycle inside the transaction. If an authored obligation would become
unresolved or strict identity would remain blocked/ambiguous, the route returns `409 WORKOUT_DELETE_CLOSED_LIFECYCLE_REGRESSION`
and rolls back the workout revision/deletion together with every closure field
and counter. Excluded or out-of-schedule rows may still be deleted when the
closed lifecycle remains resolved.
Deletion classifies accepted V4 only through exact `resolveV4ScheduleAuthority` proof. Exact
`available` authority keeps the established V4 reconciliation path; raw, malformed, hash-invalid,
or unsupported V4-like authority returns `409 V4_SCHEDULE_RESOLUTION_BLOCKED` and cannot enter
legacy/counter fallback. Only definitive `not_v4` records enter the legacy closed-handoff guard.

Owner: Aaron  
Last reviewed: 2026-03-19
Purpose: Canonical API contract map for App Router endpoints and payload validation boundaries.

This doc covers:
- Current API route surface
- Validation contract source files
- Runtime enum contract source and verification

Invariants:
- Validation schemas in `src/lib/validation.ts` are canonical for request payloads.
- Validation-backed workout enum contract values are canonical in `docs/contracts/runtime-contracts.json` and verified by script.
- API docs should reference schemas and route files, not duplicate large inline contracts.

Sources of truth:
- `trainer-app/src/app/api`
- `trainer-app/src/lib/validation.ts`
- `trainer-app/docs/contracts/runtime-contracts.json`
- `trainer-app/scripts/check-doc-runtime-contracts.ts`

## Canonical runtime contracts
- File: `docs/contracts/runtime-contracts.json`
- Verification command: `npm run verify:contracts`

## Seeded workout provenance contract

- Seeded generation returns `selectionMetadata.sessionDecisionReceipt.sessionProvenance.seedProvenance = { revisionId, revision, hash }` from the immutable revision it actually consumed.
- `POST /api/workouts/save` does not trust caller provenance as authority. `src/lib/api/save-workout/seed-provenance.ts` verifies the tuple against `MesocycleSeedRevision`, persists it on new workouts, rejects mismatches, and preserves the existing tuple on resume/update.
- New seeded workouts fail closed when exact revision provenance is unavailable. Existing legacy workouts with null provenance remain readable and resumable without backfilled guesses.
- Runtime enum sources:
  - `WORKOUT_STATUS_VALUES` in `src/lib/validation.ts`
  - `WORKOUT_SELECTION_MODE_VALUES` in `src/lib/validation.ts`
  - `WORKOUT_SESSION_INTENT_DB_VALUES` in `src/lib/validation.ts`
  - `WORKOUT_EXERCISE_SECTION_VALUES` in `src/lib/validation.ts`
  - Matching Prisma enums in `prisma/schema.prisma`

## API route groups
- Workouts: `src/app/api/workouts/**` (generate-from-intent, generate-from-template, save, `GET /api/workouts/history`, `POST /api/workouts/[id]/dismiss-closeout`)
- Logging: `src/app/api/logs/set/route.ts`
- Logging support reads: `GET /api/workouts/[id]/logging-weekly-volume-check` (`src/app/api/workouts/[id]/logging-weekly-volume-check/route.ts`)
- Mesocycles: `GET /api/mesocycles` (`src/app/api/mesocycles/route.ts`) plus handoff endpoints `POST /api/mesocycles/[id]/finish-deload`, `PATCH /api/mesocycles/[id]/draft`, `POST /api/mesocycles/[id]/refresh-next-seed-draft`, and `POST /api/mesocycles/[id]/accept-next-cycle`
- Plans: `GET|POST /api/plans`, `PATCH /api/plans/[id]`, and explicit `POST /api/plans/[id]/finalize|activate|archive`
- Week-close workflow: `POST /api/mesocycles/week-close/[id]/dismiss` and `POST|GET /api/mesocycles/week-close/[id]/closeout`
- Program/periodization/readiness: `src/app/api/program/route.ts`, `src/app/api/periodization/macro/route.ts`, `src/app/api/readiness/submit/route.ts`, `src/app/api/pre-session-readiness/prepare/route.ts`, `src/app/api/stalls/route.ts`
- Templates: `src/app/api/templates/**`
- Exercises and preferences: `src/app/api/exercises/**`, `src/app/api/preferences/route.ts`
  - `GET /api/exercises/search?q=<query>&limit=<n>` is the bounded typed-search route for discovery surfaces such as Add Exercise. Ranking is server-owned in `src/lib/api/exercise-library.ts` and may combine name, alias, muscle, muscle-group, and equipment signals; it is intentionally separate from full-library hydration reads.
  - `GET /api/exercises/[id]/history?limit=<n>` returns exact-exercise performed history owned by `loadExerciseHistory()`. The workout logger additionally supplies `measurementSnapshot=legacy` or a complete classified profile/convention/basis query so the active workout snapshot—not the newest historical row—selects the derived-record comparison context; malformed partial tuples return `400`. Library-only reads use the newest qualifying performed exposure as that context. Only performed work-set logs from performance-history-eligible `COMPLETED`/`PARTIAL` workouts qualify; warmups, skipped/unlogged sets, scheduled deloads, prescriptions, aliases, and related exercises do not. All qualifying exact-ID exposures remain visible with their own frozen classified tuple or legacy-null state. Computed records use only exposures matching the selected exact frozen tuple, so legacy-null and incompatible classified rows cannot enter a classified record cohort. Bodyweight, displayed-machine, and displayed-assistance exposures remain visible but do not produce computed load records or claim physical units because bodyweight or stable machine context is not persisted.
- Analytics: `src/app/api/analytics/**`
- Profile/readiness support: `src/app/api/profile/setup/route.ts`, `src/app/api/readiness/submit/route.ts`

## Program dashboard response notes
- Route: `GET /api/program` (`src/app/api/program/route.ts`) returns `loadProgramDashboardData()` output directly.
- `GET /api/program` accepts an optional `?week=N` query parameter (`src/app/api/program/route.ts`). When supplied, `loadProgramDashboardData()` returns the selected dashboard payload for that historical week, including week-specific volume, `rirTarget`, `coachingCue`, and `viewedBlockType`. The live `currentWeek` is always present in the response; the requested week is returned as `viewedWeek`.
- `ProgramDashboardData.viewedWeek` is the effective week whose selected dashboard payload is rendered - equals `currentWeek` by default, overridden by `?week=N`. Clamped to `[1, durationWeeks]`.
- `ProgramDashboardData.viewedBlockType` is the effective block type for `viewedWeek`, used by the shared program card to keep historical block chrome coherent with the selected week.
- `ProgramDashboardData.activeMeso.completedSessions` is now sourced from `accumulationSessionsCompleted` (the canonical lifecycle counter), not the `completedSessions` DB column. Clients should treat this field as the lifecycle-derived session count.
- `ProgramDashboardData` is now the shared dashboard-card contract only. Home-page operational helpers (`nextSession`, `latestIncomplete`, `lastSessionSkipped`) are loaded separately through `loadHomeProgramSupport()` in `src/lib/api/program.ts` and are not part of `GET /api/program`.
- `ProgramDashboardData.deloadReadiness` is always computed from the live `currentWeek` state even when `viewedWeek` is historical. Historical week navigation changes the selected week payload, but the current UI intentionally hides live-only deload advisory chrome while browsing history rather than implying historical deload replay or canonical generator output.
- `ProgramDashboardData.volumeThisWeek` rows now expose canonical weighted weekly actuals as `effectiveSets`, with `directSets` and `indirectSets` retained as contextual/debug fields only (`src/lib/api/program.ts`, `src/components/ProgramStatusCard.tsx`).
- `ProgramDashboardData.volumeThisWeek` rows also expose UI-owned volume display strings as `weightedSetsLabel`, `targetLabel`, `deltaLabel`, optional `landmarkContext` (`mevLabel`, `mavLabel`, `mrvLabel`, `rangeSummaryLabel`, `positionLabel`), `statusLabel`, `statusDescription`, and `badges`. Rows carry compatibility `targetKind`, optional `targetRange`, `displayGroup`, and additive tier fields (`targetTier`, `warningSeverity`, `dashboardGroup`) so clients can render primary drivers, support targets, secondary targets, and implicit rows without reclassifying MEV/MAV/MRV or soft-target ranges locally. Front Delts are implicit and omitted from default rows unless actual volume exists.
- `ProgramDashboardData.volumeThisWeek` rows also expose dashboard-only opportunity fields: `opportunityScore`, `opportunityState`, and `opportunityRationale` (`src/lib/api/program.ts`). These are computed from canonical weekly target pressure plus a recent weighted-stimulus adapter in `src/lib/api/recent-muscle-stimulus.ts`, with optional downward-only modulation from fresh readiness signals via `src/lib/api/readiness.ts`.
- Those opportunity and deload-readiness fields are advisory snapshot outputs for the dashboard card. They are intentionally weaker than canonical next-session generation/explainability semantics and should not be presented as authoritative progression decisions.
- `ProgramDashboardData.coachingCue` and `ProgramDashboardData.deloadReadiness` are descriptive dashboard framing only. Canonical deload policy still lives in `src/lib/deload/semantics.ts` and generator/session receipts.
- Historical `GET /api/program?week=N` responses still carry those opportunity fields, but the current UI only renders `opportunityState` for the live current week because opportunity currently uses present recency/readiness context rather than a historical as-of timestamp.
- `ProgramDashboardData.deloadReadiness` saturation logic now keys off weighted `effectiveSets` rather than primary-only direct sets (`src/lib/api/program.ts`, `src/lib/api/weekly-volume.ts`).
- `GET /api/program` and `PATCH /api/program` now return `409` with `{ error: "Mesocycle handoff pending.", handoff }` while any mesocycle is in `AWAITING_HANDOFF`. Program controls are intentionally blocked until the next cycle is explicitly accepted.
- `POST /api/pre-session-readiness/prepare` is the explicit app-owned pre-session readiness snapshot producer action. It provisions the owner only after the production write gate, delegates to `preparePreSessionReadinessSnapshot()` in `src/lib/api/pre-session-readiness-producer.ts`, may write only `PreSessionReadinessSnapshot`, and returns `{ ok: true, status: "prepared", snapshotId, invalidatedSnapshotCount, replacementPolicy, preSessionReadinessContract, preSessionReadinessCard }` on success. `replacementPolicy` is `atomic_replace` for a committed new exact identity or `reuse_equivalent` for an idempotent retry; both return the authoritative snapshot ID. Stale evidence and concurrent target changes return the existing `409` blocked shape with `reason="stale_identity"`; same-identity/different-payload returns `reason="integrity_conflict"`. `preSessionReadinessCard` is the display-safe Home DTO and may include an ordered `workoutPreview` derived from the generated session audit snapshot plus structured optional add-on reason/guardrail copy. Prescription-confidence calibration rows may also carry read-only target/load-source/confidence fields, `adjustmentRangeBasis`, `suggestedAdjustmentRange`, and exact/legacy history evidence copied or derived from generation `prescriptionReadouts`; the formatted state distinguishes exact history, reduced-confidence legacy history, and no calibrated load. These fields are coaching metadata only and must not become seed truth, runtime replay input, planner policy, receipt mirrors, or persistence mutation triggers. Home must not parse raw contract prose or audit artifacts to reconstruct those fields. The route must not create workouts/logs, call the audit CLI, read audit artifacts, mutate seed/runtime replay, or change Home rendering.
- `PreSessionReadinessContract.doseClosure.decisions` is the optional structured compatibility addition for new snapshots. Each row carries the canonical muscle status (`not_needed`, `not_final_opportunity`, `suppressed`, `eligible`, or `no_valid_candidate`), explicit performed/current/later/week/MEV evidence, target-specific later contributing slots and evidence sources, active movement/exercise constraints and candidate filter reasons, and at most one exact recommendation. Only `eligible` decisions may carry a recommendation. Legacy persisted snapshots without `decisions` remain valid; new producers and consumers must prefer the structured rows and must not reconstruct finality, suppression, or candidate policy from prose.

## Analytics response notes
- Shared analytics semantics helpers now live in `src/lib/api/analytics-semantics.ts`. That helper is the canonical source for analytics counting vocabulary (`generated`, `performed`, `completed`) and explicit time-window descriptors (`all_time`, `rolling_days`, `rolling_iso_weeks`, `date_range`).
- `GET /api/analytics/summary` now returns explicit totals for `workoutsGenerated`, `workoutsPerformed`, `workoutsCompleted`, performed set totals, and a `consistency` block (`targetSessionsPerWeek`, `thisWeekPerformed`, `rollingFourWeekAverage`, `currentTrainingStreakWeeks`, `weeksMeetingTarget`, `trackedWeeks`). Workout counts use `scheduledDate` within the selected query range; performed set totals use `setLog.completedAt` within that same query range. The response also returns `semantics` metadata documenting both windows and the generated/performed/completed definitions.
- `GET /api/analytics/templates` now returns template usage rows with `generatedWorkouts`, `performedWorkouts`, `completedWorkouts`, `performedRate`, and `completionRate`, plus `semantics` metadata describing the all-time generated/performed/completed vocabulary.
- `GET /api/analytics/volume` returns `weeklyVolume` and `landmarks` plus `semantics` metadata documenting that:
  - the chart window is rolling ISO weeks by `scheduledDate`
  - only performed workouts (`COMPLETED` + `PARTIAL`) are included
  - only non-skipped logged sets contribute to direct/indirect volume
  - each weekly muscle bucket now also includes canonical weighted `effectiveSets` for analytics views that need lifecycle-aligned volume interpretation
- `GET /api/analytics/muscle-outcomes` returns the active-week `review` model for analytics outcome auditing. Each row includes `muscle`, optional readout-only `targetKind`/`targetRange`, `targetSets`, `actualEffectiveSets`, target-gap `delta`/`percentDelta`, zone-aware `status`, `contributingExerciseCount`, and up to three `topContributors`. Hard-target statuses treat below MEV as the floor issue, above-MEV/below-target as below preferred rather than failure, and MAV/cap rows as caution. Hard targets come from canonical lifecycle volume targeting; soft target ranges are display semantics only. Actuals come from canonical weighted effective stimulus.
- Read-side consumers that expose lifecycle weekly targets (`GET /api/program`, `GET /api/analytics/muscle-outcomes`, week-close deficit snapshots, and explainability volume compliance) now rely on the same `getWeeklyVolumeTarget()` seam as generation. When the mesocycle row includes ordered `TrainingBlock` definitions, those reads are block-aware without requiring a separate API-specific override payload.
- `GET /api/analytics/recovery` now returns `muscles` plus `semantics` metadata documenting that the screen is a rolling 14-day SRA-style stimulus-recency view built from performed workouts only.
- Each recovery row now also carries a 7-day `timeline` of canonical weighted effective stimulus buckets (`date`, `effectiveSets`, `intensityBand`) derived with the shared stimulus engine, not raw direct sets (`src/lib/api/muscle-stimulus-timeline.ts`, `src/lib/engine/stimulus.ts`).
- Dashboard opportunity does not consume `GET /api/analytics/recovery`; analytics stimulus recency remains a separate pattern-review surface and is not the dashboard source of truth.

## Validation-backed contracts (examples)
- Workout generation/save: `generateFromTemplateSchema`, `generateFromIntentSchema`, `saveWorkoutSchema`
- Workout history query: `workoutHistoryQuerySchema` in `src/lib/validation.ts`; consumed by `GET /api/workouts/history`. Supports `intent`, `status` (comma-separated), `mesocycleId`, `from`/`to` date range, and cursor-based pagination (`cursor`, `take`). History items expose the derived workout-list summary contract for badge rendering, including `sessionSnapshot` for week/session/phase chrome and `isDeload` for explicit deload labeling, instead of parallel top-level snapshot fields in the response shape (`src/app/api/workouts/history/route.ts`).
- Logging: `setLogSchema`
- `POST /api/logs/set` accepts optional `setIntent: "WORK" | "WARMUP"` and defaults omitted values to `WORK`. Work-set logs are keyed by `workoutSetId`. Warmup/ramp logs may be submitted with `workoutExerciseId + setIntent="WARMUP"`; the route creates a current-workout-only runtime set and `SetLog` atomically. Classified rows validate reps/load through the frozen `WorkoutExercise` measurement tuple: bodyweight forbids load, external/added/assisted work requires positive load or assistance, and displayed machine/assistance values bypass pound quantization. All-null legacy rows preserve existing validation.
- `GET /api/workouts/[id]/post-session-review` is a read-only completed-workout review contract for immediate post-save UI. The route looks up identity through `findOwnerReadOnly()` without provisioning, delegates to `loadCompletedWorkoutReviewReadModel(userId, workoutId)`, and returns `{ postSessionReview: PostSessionReviewDisplayDto | null }`. Its performed-reality rows and prescription-calibration summary may include completion-vs-prescription labels plus load/reps/RPE coherence facts derived only from persisted `WorkoutSet` targets and `SetLog` actuals. Runtime-added exercise rows remain session-local evidence, but their own logged sets still supply actual performed set count and median reps/load/RPE for review display. The contract may also include bounded exact-exercise prior-exposure calibration summaries and compact performed-reality trend groups from performed-history-eligible workouts for diagnostic recurrence context. Those facts are learning evidence for review copy and must not become progression policy, prescription policy, seed/runtime truth, receipt mirrors, or persistence triggers. It must not change the explanation endpoint, parse raw post-session contract rows in the client, import audit/CLI/artifact paths, mutate workouts/logs/receipts/seeds, or imply automatic plan changes.
- `GET /api/version` is a public read-only deployment identity contract. It returns exactly `{ commitSha: string }`, sourced from Vercel's deployed Git commit metadata with the repository build SHA as a fallback; local development/test returns `"unknown"`. It exposes no user, database, environment dump, dependency, path, token, or provider-credential metadata and uses a revalidating cache policy so production-alias checks do not retain an old deployment identity.
- Prescription-calibration rows retain stable `workoutExerciseId` alongside catalog `exerciseId`, so duplicate same-exercise rows preserve independent measurement and performed-reality identity without positional pairing. They classify `successful_autoregulation` when performed load differs but prescribed reps are achieved at or below target RPE; load delta alone is insufficient for `target_too_high` or `target_too_low`. Compact exact-exercise trend groups describe a supported mismatch as systematic only when it appears in at least two of the latest three comparable exposures.
- The completed-review response also includes `reviewEvidence` provenance/version/hash metadata. Exact snapshots are contract-validated and checked against their payload hash and persisted-evidence fingerprint before display. Integrity failure returns an unavailable review and never falls back to current recomputation. A legacy completed workout without a snapshot is read through current policy as `legacy_derived` and is never persisted by GET; resumable `PARTIAL` reviews have no historical-provenance claim.
- `src/lib/api/weekly-retro-calibration-contract.ts` owns the app-side weekly retro calibration contract. Legacy internal kinds remain compatible, while visible summaries use outcome-oriented language: repeated likely over-prescription, repeated likely under-prescription, repeated successful execution/autoregulation context, missing actuals, or unresolved variability. Row identity is preserved by `workoutId + workoutExerciseId + sourceOrder`, so duplicate same-catalog exercises are not collapsed by `exerciseId`. This contract is read-only evidence only: it does not consume audit weekly-retro artifacts, mutate DB state, alter progression or prescription policy, change seed/runtime replay, change receipts or `selectionMetadata`, feed planner/materializer behavior, or affect acceptance decisions.
- `GET /api/workouts/[id]/logging-weekly-volume-check` is a read-only logging support contract owned by `src/lib/api/logging-weekly-volume-guidance.ts`. It is intentionally narrow:
  - request identity comes from the route param plus non-provisioning `findOwnerReadOnly()` lookup
  - response returns `shouldShow`, active week identity when available, and flagged-muscle rows only
  - `summary.status="no_addons_recommended"` is returned when no rows need attention
  - each row carries session-local projection fields: `performedSoFar`, `plannedRemaining`, `projectedFinish`, `MEV`, `MAV`, `status`, `recommendationKind`, `reasonCopy`, and `optionalOrSuppress`
  - row semantics frame below-MEV as floor risk, exact/thin MEV landings as optional low-fatigue floor buffers, above-MEV/below-preferred rows as productive-zone watches with no add-on recommendation, and near/over-MAV rows as suppress-extra guidance
  - empty rows mean the compact card should render the server-provided `No add-ons recommended` summary
  - projection is server-owned and uses the canonical equation `performed baseline excluding current workout + persisted current-workout actuals so far + projected remaining week`
  - current-workout actuals are recomputed from persisted workout structure and logged non-skipped sets, including runtime-added sets and runtime-added exercises
- `GET /api/workouts/[id]/bonus-suggestions` remains a read-only, non-persistent shortlist endpoint for the Add Exercise sheet.
  - request identity comes from the route param plus non-provisioning `findOwnerReadOnly()` lookup
  - non-closeout workouts preserve the legacy shortlist owner in `src/lib/api/bonus-suggestions.ts`
  - closeout workouts branch on the canonical `closeout_session` receipt marker and delegate to `src/lib/api/closeout-suggestions.ts`
  - closeout ranking is server-owned and deterministic: projected floor gap is `max(0, MEV - projectedLanding)`, floor gaps under `2.0` are ignored, floor gaps `>= 3.5` sort ahead of lower tiers, and the response is capped to the remaining closeout budget (`4` exercises / `8` sets total, `4` sets per muscle)
  - closeout suggestions stay advisory only; they are not persisted and they reuse the runtime-added accessory preview seam for set/rep framing rather than inventing a second prescription owner
- Mesocycle handoff draft editing: `nextCycleSeedDraftUpdateSchema`
- Dumbbell load contract: clients submit dumbbell `actualLoad` in per-hand units and `POST /api/logs/set` persists the provided per-hand value directly. Client read/write helpers must stay aligned with canonical 2.5 lb quantization in `src/lib/units/load-quantization.ts`; the API contract does not define a separate dumbbell snap whitelist.
- Performed-set signal requirement: `POST /api/logs/set` returns 400 when a non-skipped set log supplies neither `actualReps` nor `actualRpe`. Unresolved sets must remain un-logged (missing) rather than being written as empty performed logs. Warmup/ramp logs follow the same validity rule, remain visible in review/history as performed sets, and are excluded from work-set evidence consumers.
- Bodyweight auto-normalization: when `targetLoad=0` and the set is not skipped, `actualLoad` is written as `0` even when the client omits it (`src/app/api/logs/set/route.ts`).
- Templates: `createTemplateSchema`, `updateTemplateSchema`, `addExerciseToTemplateSchema`
- Profile/readiness/analytics: `profileSetupSchema`, `readinessSignalSchema`, `analyticsSummarySchema`
- `profileSetupSchema` no longer accepts `sessionMinutes`; profile setup persists `daysPerWeek` and optional `splitType` through `POST /api/profile/setup` (`src/lib/validation.ts`, `src/app/api/profile/setup/route.ts`).
- Session-decision request/response ownership follows the canonical flow in `docs/01_ARCHITECTURE.md`: save and generation contracts carry `selectionMetadata.sessionDecisionReceipt`, and validation rejects removed top-level session mirrors / top-level autoregulation inputs (`src/lib/validation.ts`, `src/app/api/workouts/save/route.ts`).
- Mutation reconciliation is part of the persisted workout contract, not a read-side convenience. Structural mutation writers persist `selectionMetadata.workoutStructureState`, and the canonical write-side seam in `src/lib/api/runtime-edit-reconciliation.ts` may also append `selectionMetadata.runtimeEditReconciliation` edit facts for supported runtime mutations.

## Plan management route contract
- `GET /api/plans` returns owner-scoped, non-archived supported plans (`HYPERTROPHY` and `STRENGTH`) with server-derived `PREPARING|READY|HANDOFF_PENDING|COMPLETED|INVALID` status, `isActive`, plan type, and exact active/review mesocycle identities. It never falls back by date or creation order.
- A selected plan may remain `isActive=true` after its lifecycle status becomes `COMPLETED`; selection and lifecycle status are separate facts. Clients must present plan selection rather than interpreting it as an executable active mesocycle.
- `POST /api/plans` is a discriminated contract. `{ planType: "HYPERTROPHY", name, startDate, durationWeeks }` preserves existing generation. `{ planType: "STRENGTH", name, startDate, configuration }` requires emphasis, two-to-five training days, a hard 45/60/75/90-minute session budget, equipment profile, and squat/press/hinge preferences; saved training age and active injury limitations are loaded server-side. Controlled ordinary phrasing for low/lower back, knee, shoulder/rotator cuff, hip, elbow, and wrist is canonicalized server-side, including laterality and common history/injury/pain/impingement wording. Exact anatomy tokens are required, and any unclassified token sequence returns `409 code=PLAN_LIMITATION_UNRECOGNIZED` before any plan row is created. When equipment and/or recognized limitation filtering leaves no compatible exercise for required Strength programming, creation returns `409 code=PLAN_CREATION_INFEASIBLE` with configuration-specific recovery guidance before mutation; malformed requests remain `400 code=PLAN_VALIDATION_FAILED`, and unexpected construction failures are not translated to the user-correctable infeasibility code. A missing `planType` remains backward-compatible hypertrophy input. Unknown types, partial configuration, and extra fields fail validation. Creation persists `PREPARING` and never changes `User.activeMacroCycleId`.
- `POST /api/plans/[id]/finalize` accepts `{ expectedUpdatedAt }`, compare-and-swaps the generated plan, and makes its first valid mesocycle current so the plan becomes `READY`. Strength finalization normalizes the generated seed into immutable accepted revision 1 in the same transaction. Finalization does not activate the plan.
- `GET /plans/[id]/review` is backed by `loadPlanReview()`. Strength rows include each exercise's `exerciseId`, display name, role, and positive integer `setCount`; finalized reviews prefer `currentSeedRevision.seedPayload`, while pre-finalization reviews use the compatibility seed. Missing or malformed executable counts fail the Strength weekly-structure read closed instead of inventing defaults.
- `POST /api/plans/[id]/activate` accepts `{ expectedActiveMacroCycleId }`. The serializable selection transaction requires an owner-scoped, non-archived `READY` supported plan, blocks any owner `IN_PROGRESS` workout, and updates only the selected-plan pointer. Stale selection returns `409 code=ACTIVE_PLAN_SELECTION_CONFLICT`; a non-READY target returns `409 code=ACTIVE_PLAN_TARGET_NOT_READY`; an owned archived target returns `409 code=ACTIVE_PLAN_TARGET_ARCHIVED`; an in-progress workout returns `409 code=ACTIVE_WORKOUT_IN_PROGRESS`. Missing, foreign, and unsupported-type targets remain indistinguishable `404 code=PLAN_NOT_FOUND`.
- Strength creation produces one complete four-to-six-week block according to saved training age. After its final deload session, shared lifecycle state closes that plan as `COMPLETED`; the hypertrophy-only next-mesocycle handoff endpoints are not offered for it. Hypertrophy continues to enter handoff except for a transactionally proven final finite accepted-V4 plan, which completes directly without handoff artifacts or successor mutation. Missing, null, malformed, or future `MacroCycle.primaryGoal` values throw `UNSUPPORTED_PLAN_TYPE`, and transaction callers roll back without partial workout or lifecycle mutation.
- `POST /api/plans/[id]/copy` reads only the source plan's unique highest canonically numbered mesocycle and that mesocycle's exact current accepted revision. The highest row must be the sole eligible active mesocycle or an inactive completed terminal row; a later awaiting, inactive non-completed, duplicate, or numbering-ambiguous row fails closed instead of falling back to an earlier completed mesocycle. Revision ownership/pointer/positive-number/provenance/hash validation remains mandatory, and compatibility seed JSON is never a fallback.
- `PATCH /api/plans/[id]` accepts normalized `{ name, expectedUpdatedAt }`; it changes only display metadata. Stale versions return `409 code=PLAN_MUTATION_CONFLICT`.
- `POST /api/plans/[id]/archive` accepts `{ expectedUpdatedAt }`, soft-archives only an inactive plan, and preserves all descendants. The selected plan returns `409 code=ACTIVE_PLAN_ARCHIVE_FORBIDDEN`; stale versions return `409 code=PLAN_MUTATION_CONFLICT`.
- All plan mutations use the central production write gate before parsing or Prisma access, then provision the owner server-side through `provisionOwnerForMutation(operation)`, and return structured deterministic `code` values. Missing and foreign-owned plan IDs share the same `404 PLAN_NOT_FOUND` contract.

## Mesocycle handoff route contract
- Handoff routes remain explicit-mesocycle operations, but acceptance is valid only when the source belongs to `User.activeMacroCycleId`. Pending handoff discovery for Home, next-session, and generation is restricted to the selected macrocycle; an unselected plan's pending handoff is historical state, not a runtime blocker.
- `POST /api/mesocycles/[id]/finish-deload` (`src/app/api/mesocycles/[id]/finish-deload/route.ts`)
  - state gate: target mesocycle must exist for the owner and be in `ACTIVE_DELOAD`
  - success: `{ ok: true, action: "finish_deload_early", mesocycle, skippedWorkoutIds, skippedWorkoutCount, handoffSummaryCreated, nextSeedDraftCreated }`
  - ownership: after the production write gate, the route provisions the owner through `provisionOwnerForMutation(operation)` and delegates lifecycle behavior to `finishDeloadEarly()` in `src/lib/api/mesocycle-lifecycle-state.ts`
  - semantics: this is an explicit user action to end the remaining deload without performing the remaining scheduled deload workouts; it does not create `SetLog` rows, does not create fake completed workouts, does not increment `deloadSessionsCompleted`, does not mutate `slotPlanSeedJson`, and does not change runtime replay
  - incomplete deload workouts: unperformed `PLANNED`/`IN_PROGRESS` workouts in the source mesocycle are marked `SKIPPED` with additive `selectionMetadata.finishDeloadEarly` audit metadata before terminal lifecycle resolution; `PARTIAL` workouts or workouts with performed non-skipped logs are rejected with `409`
  - terminal result: a healthy final finite accepted V4 plan completes directly without handoff or successor creation; blocked or conflicting V4 proof returns a recoverable `409` and rolls back the skips; definitive non-V4 hypertrophy retains legacy handoff, while Strength retains direct completion

- `PATCH /api/program` action `end_early` (`src/app/api/program/route.ts`)
  - purpose: intentionally close the active accumulation mesocycle without fabricating performed work, then resolve its canonical terminal lifecycle
  - ownership: the route resolves the owner and delegates through `applyCycleAnchor()` to canonical `finishMesocycleEarly()` lifecycle behavior
  - incomplete workouts: untouched `PLANNED`/`IN_PROGRESS` workouts are marked `SKIPPED` with additive `selectionMetadata.finishMesocycleEarly`; canonical `sessionDecisionReceipt` data is preserved
  - conflicts: `PARTIAL` workouts, any incomplete workout with performed non-skipped logs, non-`ACTIVE_ACCUMULATION` state, or existing handoff artifacts return `409`
  - invariants: accumulation/deload counters, accepted seed, runtime replay, performed logs, and successor acceptance behavior are unchanged
  - terminal result: a healthy final finite accepted V4 plan completes directly without handoff or successor creation; blocked or conflicting V4 proof returns a recoverable `409` and rolls back the skips; definitive non-V4 hypertrophy retains legacy handoff, while Strength retains direct completion. Successor creation for legacy handoff remains reserved for `POST /api/mesocycles/[id]/accept-next-cycle`
- `POST /api/mesocycles/[id]/setup-preview` (`src/app/api/mesocycles/[id]/setup-preview/route.ts`)
  - state gate: target mesocycle must exist for the owner and be in `AWAITING_HANDOFF`
  - request payload: `nextCycleSeedDraftUpdateSchema`
  - success: `{ ok: true, preview }`
  - preview ownership:
    - server sanitizes the ephemeral draft through the same handoff-draft rules used by persistence
    - preview and accept load projection inputs from the same handoff-owned source seam: `loadHandoffSourceMesocycle()` narrowed through `toHandoffProjectionSource()` in `src/lib/api/mesocycle-handoff.ts`
    - server preview composition flows through `loadMesocycleSetupPreviewFromPrisma()` in `src/lib/api/mesocycle-setup.ts`
    - projected slot session plans come from the canonical handoff-owned slot-plan projection seam in `src/lib/api/mesocycle-handoff-slot-plan-projection.ts`
    - `preview.slotPlanProjection` is the narrow canonical projected slot-plan payload; `preview.display.projectedSlotPlans` is display-only decoration for setup UI labels and exercise names
    - route does not persist `nextSeedDraftJson`
  - conflict behavior:
    - `409` when handoff is not pending
    - `409` when `keep` carry-forward selections no longer match any session intent in the edited split/session structure
  - validation behavior:
    - `400` when the draft payload is structurally invalid
- `PATCH /api/mesocycles/[id]/draft` (`src/app/api/mesocycles/[id]/draft/route.ts`)
  - state gate: target mesocycle must exist for the owner and be in `AWAITING_HANDOFF`
  - request payload: `nextCycleSeedDraftUpdateSchema`
    - optional Stage 1 capacity state is `{ version: 1, productChoice: "efficient" | "balanced" | "full", timePriority, fourDayUpperLowerConfirmed }`; public contracts reject internal profile ids
    - a draft write preserves an existing refreshed candidate only when the refreshable structure, carry-forward state, starting point, and capacity state are unchanged; any capacity change invalidates that candidate
  - success: `{ ok: true, handoff }` with the updated pending handoff payload
  - conflict behavior:
    - `409` when handoff is not pending
    - `409` when `keep` carry-forward selections no longer match any session intent in the edited split/session structure
  - validation behavior:
    - `400` when the draft payload is structurally invalid
- `POST /api/mesocycles/[id]/refresh-next-seed-draft` (`src/app/api/mesocycles/[id]/refresh-next-seed-draft/route.ts`)
  - state gate: target mesocycle must exist for the owner and be in `AWAITING_HANDOFF`
  - ownership: after the production write gate, the route provisions the owner through `provisionOwnerForMutation(operation)` and delegates the guarded refresh to `refreshMesocycleHandoffNextSeedDraftFromV2()` in `src/lib/api/mesocycle-handoff.ts`
  - request payload: `{ productChoice: "efficient" | "balanced" | "full", fourDayUpperLowerConfirmed: true }`; missing confirmation, unknown values, and internal ids such as `minimal`, `moderate`, or `preferred` return `400`
  - capacity behavior: the saved draft choice must match the request and must describe the supported four-day Upper/Lower slot sequence. The handoff owner maps the public choice through the canonical V2 capacity-selection seam and passes the resulting internal profile explicitly to `buildV2PlannerMesocyclePolicy()`. Unsupported topology or stale choice returns `409`; there is no implicit `preferred` fallback.
  - semantics: this is an explicit draft rebuild action only. It refreshes `nextSeedDraftJson.acceptedSeedDraft` from a production-eligible V2 materialized seed and does not accept the successor, create a mesocycle, create workouts/logs/sessions, mutate the source seed/runtime truth, or change runtime replay. Supported pending draft transitions are legacy `handoff_slot_plan_projection` to V2 and existing `v2_materialized_seed` to refreshed V2, so planner/materializer fixes can safely replace stale draft candidate truth before acceptance.
  - V2 gates: refresh fails closed unless base-plan validation is `pass` or `pass_with_warnings` with no blockers, the V2 materializer reports `materialized`, promotion readiness is `eligible_for_guarded_write`, required production gates are present, and the serialized seed is parser-compatible minimal `exerciseId`, `role`, `setCount` data aligned to the projected slot sequence.
  - failure behavior: `409` when handoff is not pending, a successor mesocycle already exists, the stored draft is missing/ambiguous/changed outside the refreshable `acceptedSeedDraft`, keep selections conflict, an existing draft source is unsupported, or V2 materialization is not eligible. Failed refresh leaves the existing draft unchanged.
  - provenance: the stored draft source is recorded as `v2_materialized_seed` with compact gate/provenance facts and `runtimeReplayUnchanged=true`; lane ids, materializer diagnostics, and planner debug payloads remain non-executable evidence and are not consumed by runtime.
- `POST /api/mesocycles/[id]/accept-next-cycle` (`src/app/api/mesocycles/[id]/accept-next-cycle/route.ts`)
  - state gate: target mesocycle must exist for the owner, be in `AWAITING_HANDOFF`, and have a readable stored draft; retries after a completed accept may return the already-active successor when the source is already `COMPLETED`
  - success: `{ ok: true, priorMesocycleId, nextMesocycle }`
  - optional request payload for backward compatibility: `{ productChoice: "efficient" | "balanced" | "full" }`. A draft containing Stage 1 capacity state requires this exact public choice, confirmed supported topology, and a refreshed V2 candidate whose stored selection plus accepted-intent profile match the canonical mapping. Missing or stale capacity candidates fail closed and cannot enter legacy projection. Drafts created before the capacity field existed retain the legacy compatibility path.
  - acceptance semantics are prepare-then-transactional: sanitize the stored draft and build a deterministic successor projection plus aligned minimal executable seed before the Prisma interactive transaction; inside the transaction, re-read/revalidate the source, create or reuse the successor mesocycle, persist `slotSequenceJson`, retain the prepared `slotPlanSeedJson` as the compatibility acceptance snapshot when materialized slot plans are available and no blocking support-floor failure exists, create immutable `MesocycleSeedRevision` revision 1 from that payload and advance `currentSeedRevisionId`, copy allowed carry-forward roles, update `Constraints`, then mark the source mesocycle `COMPLETED`
  - existing-successor retries are fail-closed against stored V2 candidate truth: when `nextSeedDraftJson.acceptedSeedDraft.source = "v2_materialized_seed"` exists, both `AWAITING_HANDOFF` and `COMPLETED` source retry branches require the successor `slotPlanSeedJson` to exactly match the persisted accepted seed draft before returning the successor.
  - V2 materialized-seed acceptance is disabled by default unless the stored `nextSeedDraftJson` already contains an explicit refreshed `acceptedSeedDraft` from `POST /api/mesocycles/[id]/refresh-next-seed-draft`, or acceptance preparation is explicitly passed `enableV2MaterializedSeedWrite: true`. The API-owned helper in `src/lib/api/mesocycle-handoff-v2-materialized-seed.ts` requires V2 dry-run materialization readiness, promotion readiness status `eligible_for_guarded_write`, complete required-lane coverage, seed-shape compatibility, and all production gates set true. Blocked opt-in fails closed instead of falling back to handoff projection, and ready output still flows through `buildMesocycleSlotPlanSeed()` rather than handcrafting persisted seed JSON. Ready V2-authored seeds pass the serializer source label `v2_materialized_seed`; legacy projection callers keep the serializer default `handoff_slot_plan_projection`.
  - V2 acceptance helper/probe results carry compact `V2MaterializedSeedAcceptanceProvenance`. The source is `v2_disabled`, `v2_blocked_fail_closed`, or `v2_materialized_seed`; provenance records dry-run/readiness versions, mapped production gates, blocker categories only, the seed serializer name, `dbWriteOccurred=false`, and the unchanged runtime replay expectation. It must not embed lane ids, blocker/omission bulk, inventory evidence, dry-run debug payloads, or executable seed previews.
  - Accepted-seed persistence has a separate transaction-level provenance contract, `AcceptedSeedPersistenceProvenance`, owned by the handoff API seam. Its source is `legacy_projection_seed`, `v2_disabled`, `v2_blocked_fail_closed`, or `v2_materialized_seed`; it records whether the seed source was selected before the transaction, whether `slotPlanSeedJson` was persisted inside the existing acceptance transaction, the persisted mesocycle id when known, explicit fallback labeling, and `dbWriteOccurred=true` only after the existing transaction write succeeds. Blocked V2 opt-in reports `v2_blocked_fail_closed` with `dbWriteOccurred=false` before any transaction. Default acceptance selects `legacy_projection_seed` and does not report V2 success.
  - `buildV2MaterializedSeedAcceptanceProbe()` is read-only and may be used to inspect live owner/mesocycle evidence without enabling V2 seed writes. It reports the helper result with opt-in disabled, `simulated_opt_in_readiness` for all-gates-provided readiness, grouped blockers, optional omissions, production-gate values, required-lane coverage, seed-preview counts, and disabled-source provenance; it never writes `slotPlanSeedJson` and always reports `safeToPromoteToProductionWrite=false`.
  - `prepareV2AcceptedSeedPreparationProbe()` is the handoff-context probe wrapper. It reads the stored source handoff summary/draft, derives the same successor slot sequence shape that acceptance preparation would use, and then calls the V2 probe without calling legacy slot-plan projection/repair or writing through Prisma. Probe responses explicitly include `readOnly=true`, `affectsScoringOrGeneration=false`, `wouldWriteTransaction=false`, `wouldCallLegacyProjection=false`, `wouldCallLegacyRepair=false`, `seedSerializer="buildMesocycleSlotPlanSeed"`, base-plan validation status when provided, compact gate results, projection/repair bypass facts, serializer-preview counts, separate preparation provenance, and explicit fallback labels (`legacy_projection_seed` or `fallback_existing_projection`) when fallback is represented.
  - `prepareV2AcceptedSeedPreparationCompare()` is the disabled-by-default read-only comparison over the same handoff preparation seam. It can build the legacy accepted-seed preparation as baseline evidence and a V2 preparation preview through the materialization probe/serializer path, then reports availability, seed shape deltas, identity/class/lane coverage deltas, repair-dependency avoidance, and provenance/no-write boundary facts. The V2-selected preparation path still reports `wouldCallLegacyProjection=false`, `wouldCallLegacyRepair=false`, `consumedByProduction=false`, and `wouldWriteTransaction=false`; the comparison never enters the acceptance transaction, never persists a V2 seed, never labels disabled/blocked V2 as persisted success, and never exposes a production `slotPlanSeedJson` write result.
  - persisted `slotSequenceJson` is placement plus authored slot semantics for new accepted mesocycles. The canonical authored fields are `slotArchetype`, `primaryLaneContract`, `supportCoverageContract`, and `continuityScope`, normalized through `src/lib/api/mesocycle-slot-contract.ts`.
  - `currentSeedRevision.seedPayload` is the authoritative accepted executable composition when an immutable revision exists. The accepted-seed dispatcher validates V1–V4; malformed payloads and unknown future versions fail explicitly. V4 runtime resolution is week-aware and preserves ordered placement identity, exact/range reps, RIR-derived target RPE, measurement, and final-deload omission. `slotPlanSeedJson` remains compatibility or historical state, and legacy/no-revision fallback does not create competing runtime truth.
  - unsupported raw slot-plan projection cases such as current `BODY_PART` projection limits do not change accept behavior yet; acceptance still succeeds without persisting `slotPlanSeedJson`
  - `409` when handoff is not pending, the draft is missing, or carry-forward keep selections are no longer compatible with the edited split/session structure

## Workout save terminal transition contract

Successful first transition to `COMPLETED` also creates the immutable exact post-session review snapshot before the transaction commits. Snapshot production or insertion failure rolls back completion and lifecycle effects. `COMPLETED` and `SKIPPED` are immutable; same-terminal and cross-terminal retries return a refresh-required `409` rather than replaying or rewriting workout evidence. `PARTIAL` remains resumable and does not finalize an immutable snapshot; `SKIPPED` remains review-ineligible.
- Route: `POST /api/workouts/save` (`src/app/api/workouts/save/route.ts`).
- Request action enum (validation source): `WORKOUT_SAVE_ACTION_VALUES` in `src/lib/validation.ts`.
- `expectedRevision` is required for every update to an existing workout and omitted only for genuine creation. Persistence compares `{ id, userId, revision: expectedRevision, status: expectedPriorStatus }`, increments revision atomically, and returns the new revision. A stale revision or changed prior status returns `409`; missing and foreign-owned workouts both return the same `404`; omission for an existing workout returns `400`.
- Runtime mutation requests also require `expectedRevision`: add/remove/swap exercise, add set, set log/skip/unskip/delete (including persisted warmup creation), workout delete, and closeout dismissal. Each successful response includes `revision`; stale requests return `409` before child or reconciliation writes. Mesocycle-linked requests must also match the selected plan and claim the selected-plan pointer in the same transaction, so a concurrent switch or a switched-away workout returns `409` with no child mutation. The owner-scoped failed-claim read never reveals whether a foreign workout exists.
- Mesocycle week-close acknowledgement that does not mutate a workout remains outside workout OCC. Dismissing a persisted closeout workout is inside OCC because it changes workout execution metadata.
- Mesocycle-linked saves first claim the selected-plan pointer and, for accepted V4, lock the exact mesocycle/current-revision identity in canonical order. Receipt and transition validation precede the workout compare-and-swap; exercise/set replacement, filtered-exercise replacement, receipt/reconciliation metadata, status/completion changes, and save-owned lifecycle effects roll back together on any later error.
- Terminal transitions are action-based:
  - `mark_completed` => finalize as `COMPLETED` or auto-normalize to `PARTIAL` when unresolved sets remain.
  - `mark_partial` => finalize as `PARTIAL`.
  - `mark_skipped` => finalize as `SKIPPED`.
- `save_plan` cannot finalize terminal statuses (`COMPLETED`, `PARTIAL`, `SKIPPED`); terminal `status` in a plan write is ignored and persisted status remains non-terminal/current.
- Save success responses now require canonical `workoutStatus` through `src/lib/api/workout-save-contract.ts` and `src/components/log-workout/api.ts`. Clients must derive terminal UI state from the returned `workoutStatus`; `mark_completed` is a requested action, not authoritative completion truth by itself.
- Save success responses may also include `weekClose`, with `weekCloseId`, compatibility `resolution`, canonical `workflowState`, canonical `deficitState`, and `remainingDeficitSets`. Consumers that surface week-close state should treat `workflowState` + `deficitState` as truth and use `resolution` only as a backward-compatible mirror.
- `save_plan` on a **new workout** (no existing record) now triggers a mesocycle snapshot lookup and writes `mesocycleWeekSnapshot` / `mesoSessionSnapshot` / `mesocyclePhaseSnapshot` - the same fields written on performed transition - so the week/session badge appears in Recent Workouts immediately upon plan save (`src/app/api/workouts/save/route.ts`). The performed-transition error gate (`ACTIVE_MESOCYCLE_NOT_FOUND`) is skipped for plan saves; missing active mesocycle is tolerated gracefully.
- Those persisted mesocycle snapshot columns are canonical derived metadata for history badges and progression/explainability week context. UI/list contracts should consume only derived summaries (`sessionSnapshot`), while runtime history/progression consumers should use a normalized `mesocycleSnapshot` object rather than raw column mirrors.
- Completion gating: `mark_completed` requires at least one performed non-skipped set log; otherwise route returns `409`.
- Mesocycle snapshots are duration-aware: `mesocycleWeekSnapshot` is derived from `durationWeeks`, `accumulationSessionsCompleted`, and `sessionsPerWeek`, and `mesoSessionSnapshot` during deload is capped by `sessionsPerWeek` rather than a fixed `3`.
- Mesocycle lifecycle counter increment split:
  - Performed-signal readers use `COMPLETED` + `PARTIAL` (`src/lib/workout-status.ts`).
- Lifecycle completion counters (`completedSessions`, `accumulationSessionsCompleted`, `deloadSessionsCompleted`) change only on the first transition to `COMPLETED`, after the workout compare-and-swap and inside the same save-workout transaction (`src/app/api/workouts/save/route.ts`). For strict compatible legacy topology they are written from the full accepted authored-claim universe, not blindly incremented; forward save and later reconciliation therefore use identical evidence. `PARTIAL` remains performed history but is not a completed-session counter event.
- Accepted V4 is the narrow exception: only a newly committed `COMPLETED` increments its phase counter. `PARTIAL` remains performed but schedule-unresolved; `SKIPPED` is schedule-resolved without a counter increment. The route rereads authoritative workout evidence and resolves all frozen required slots. Terminal dispatch completes a fully proven finite V4 plan, enters shared handoff only for a definitive non-V4 legacy record, or returns a recoverable conflict for failed V4 proof so the workout status, counter, and lifecycle changes roll back. Counter thresholds do not close V4 independently.
- Compatible non-V4 lifecycle dispatch uses `STRICT_FROZEN_TOPOLOGY` week-by-slot obligations after either a newly committed `COMPLETED` or `SKIPPED` result. An accepted claim requires a parseable canonical receipt; matching `cycleContext` week/phase/mesocycle length and persisted workout week/session/intent; a present exact persisted workout phase snapshot; exact `sessionProvenance.mesocycleId`; an authoritative phase-compatible `compositionSource` (`runtime_selection`, `persisted_slot_plan_seed`, or `deload_seed_replay` as applicable); and exact `sessionSlot` slot id, zero-based index, sequence length, intent, and `source=mesocycle_slot_sequence`. Null, missing, malformed, or contradictory workout phase identity fails closed. Both terminal statuses resolve an accepted obligation, but only accepted `COMPLETED` claims contribute completion counters. `PARTIAL` does neither. Explicit non-advancing sessions and out-of-schedule rows are excluded; receiptless, malformed, non-authoritative, inconsistent, ambiguous, or duplicate in-schedule claims fail closed. When frozen topology is absent, the separate `HISTORICAL_RECEIPTLESS_COUNTER_COMPATIBILITY` path remains counter-based, does not infer a schedule, and does not guarantee final-skip closure.
- Deload completion now transitions the source mesocycle into `AWAITING_HANDOFF`; it does not auto-create the successor. Successor creation is reserved for `POST /api/mesocycles/[id]/accept-next-cycle`.
- Save route persists session-level cycle context only inside `selectionMetadata.sessionDecisionReceipt`; `POST /api/workouts/save` rejects writes that omit the canonical receipt instead of synthesizing fallback state (`src/app/api/workouts/save/route.ts`).
- For accepted V4 required sessions, save resolves the server-authored `sessionSlot` against the current accepted revision and frozen `Mesocycle.slotSequenceJson`, derives canonical intent, forces advancing meaning, and adds the immutable `scheduledSlotReceipt`; `AUTO` callers need not resubmit intent. Exact released rows missing intent/receipt and carrying false advancement are canonicalized only during their next valid save transaction. Conflicting client metadata, stale/malformed identity, or duplicate claims return recoverable `409` before lifecycle advancement.
- Save-route exercise rewrites also persist canonical `selectionMetadata.workoutStructureState`, may append `selectionMetadata.runtimeEditReconciliation`, and keep the original receipt intact. They do not rewrite `sessionDecisionReceipt` to match the new structure.
- Structural mutation contract:
  - `POST /api/workouts/save` with exercise rewrite updates `selectionMetadata.workoutStructureState` and appends `runtimeEditReconciliation.rewrite_structure` only when the saved structure drifts from the generated snapshot
  - `GET /api/exercises/search?q=<query>&limit=<n>` returns a bounded ranked shortlist for typed exercise discovery and must not be treated as a preview/defaults surface
  - `GET /api/workouts/[id]/swap-exercise?workoutExerciseId=<id>` returns the ranked initial eligible swap shortlist for the current source exercise
  - `GET /api/workouts/[id]/swap-exercise?workoutExerciseId=<id>&q=<query>&limit=<n>` returns a bounded typed-search shortlist. Text relevance bounds the search set, then the final candidate list is re-ranked by canonical runtime swap eligibility and read-only lane-fit diagnostics before it reaches the client. Typed search may additionally include caution-tier candidates that are blocked from the default shortlist but pass same movement-pattern, primary-muscle, stress, and fatigue guardrails; those candidates carry server-provided caution copy and rank below strict candidates unless a top text-search hit must be preserved in the bounded visible list after passing guardrails.
  - Runtime swap candidates may include additive read-only lane-fit diagnostics (`swapLaneFitScore`, `swapCandidateReason`, `swapFallbackTier`, source lane/class fields, movement/fatigue/stress deltas, stability/loadability tiers, and warning arrays). For custom Hypertrophy workouts, current accepted V2/V3 exercise intent is authoritative for semantic eligibility and contextual role matching; catalog `isMainLiftEligible` does not independently veto a candidate that satisfies that intent. Workouts without accepted exercise intent retain the legacy catalog main-lift gate and bounded row-anchor exception. Diagnostics and eligibility reads must not mutate `slotPlanSeedJson`, `slotSequenceJson`, planner/materializer output, workouts, logs, or saved session state.
  - `POST /api/workouts/[id]/add-exercise-preview` returns the canonical runtime-added accessory preview for requested exercise ids using the same server-owned defaults seam as the add-exercise mutation; the Add Exercise sheet consumes this read path and must not invent local default copy
  - `POST /api/workouts/[id]/add-exercise` updates `selectionMetadata.workoutStructureState`, appends `runtimeEditReconciliation.add_exercise`, and returns the new log-row payload with server-shaped per-exercise capabilities. Same-exercise duplicates are guarded at the route: unresolved planned sets return `DUPLICATE_EXERCISE_PLANNED_UNRESOLVED`, an already runtime-added row returns `DUPLICATE_EXERCISE_ALREADY_ADDED`, and resolved planned work requires explicit `allowDuplicate=true` confirmation before extra work is created.
  - `DELETE /api/workouts/[id]/exercises/[exerciseId]` removes only runtime-added workout exercises that belong to the resolved owner and have no logged `SetLog` rows, deletes the child `WorkoutSet` rows plus `WorkoutExercise`, updates `selectionMetadata.workoutStructureState`, appends `runtimeEditReconciliation.remove_exercise`, and increments `Workout.revision`
  - `GET /api/workouts/[id]/swap-exercise-preview?workoutExerciseId=<id>&exerciseId=<candidate>` returns the canonical swap preview payload from the same server-owned swap seam used by mutation; preview and commit must resolve the same replacement prescription, including set ids, rep targets, load hint, target RPE, and rest. Caution-tier preview and commit must include the typed-search context and are revalidated server-side against the same bounded search guardrails.
- `POST /api/workouts/[id]/swap-exercise` preserves `gapFillExerciseSwapState`, updates `selectionMetadata.workoutStructureState`, appends `runtimeEditReconciliation.replace_exercise`, and returns the same resolved swap payload shape used by the preview route, including per-exercise capabilities
- Measurement-aware V3 workouts restrict add/swap to currently classified catalog entries and atomically snapshot the replacement tuple without changing the accepted seed. Legacy workouts retain null snapshots and current add/swap behavior. Recent-load hints are fail-closed for V3 runtime edits.
  - Log page read models pass `LogWorkoutCapabilities` and per-row `LogExerciseCapabilities`; logging controls must be gated by those fields rather than client-side permission inference.
  - Swap route errors include a stable server-owned `code` alongside `error`, including strict logged-state blockers for partially and fully logged source exercises.
  - structural mutations increment `Workout.revision`
- Optional gap-fill enforcement is strictly scoped to the canonical triplet:
  - receipt marker `optional_gap_fill`
  - effective `selectionMode=INTENT`
  - `sessionIntent=BODY_PART`
  When true, save forces `advancesSplit=false`, blocks lifecycle counter updates/state transition, and allows `mesocycleWeekSnapshot` anchor override. Non-triplet payloads use normal lifecycle behavior.
- Closeout enforcement is receipt-scoped, not enum-scoped:
  - receipt marker `closeout_session`
  - additive `selectionMetadata.weekCloseId` may carry the owning closeout/week-close context
  When true, save requires a valid user-owned `weekCloseId` for the canonical mesocycle week context, strips both any top-level `selectionMetadata.sessionSlot` and receipt `sessionDecisionReceipt.sessionSlot`, forces `advancesSplit=false`, skips lifecycle advancement, and keeps the session out of canonical progression/performance-history anchors while still preserving weekly-volume semantics through `deriveSessionSemantics()`.
- Closed-mesocycle fencing:
  - `POST /api/workouts/save` returns `409` for workouts whose parent mesocycle is `AWAITING_HANDOFF` or `COMPLETED`
  - `POST /api/logs/set` and `DELETE /api/logs/set` return `409` for the same closed-mesocycle cases
  - workflow/UI resume logic should treat those workouts as non-resumable rather than retrying writes

## Deload gate contract
- Routes:
  - `POST /api/workouts/generate-from-intent` (`src/app/api/workouts/generate-from-intent/route.ts`)
  - `POST /api/workouts/generate-from-template` (`src/app/api/workouts/generate-from-template/route.ts`)
- Gate condition: when active mesocycle state is `ACTIVE_DELOAD`, both routes dispatch to deload generation and do not execute the normal accumulation generation path.
- Deload generation implementation: `src/lib/api/template-session/deload-session.ts`.
- Deload prescription contract:
  - Exercise list stays continuous with accumulation for the requested intent, with core compounds preserved when possible.
  - Hard sets are reduced roughly 50% with floor safeguards (`1 -> 1`, `2 -> 1`, `3-4 -> 2`, `5-6 -> 3`).
  - Rep targets are maintained for movement continuity.
  - Deload generation does not pre-populate `targetLoad`; canonical load assignment happens later in `src/lib/engine/apply-loads.ts`.
  - The canonical load engine resolves the normal source load first, then applies the lighter deload prescription (currently about 25% down after quantization).
  - Canonical deload effort target is `5-6 RIR` (approximately `RPE 4.5`) via shared deload semantics and lifecycle targeting.
  - Deload sessions remain valid performed work for compliance and weekly-volume context, but they are excluded from progression eligibility, anchor updates, and canonical performance-history/explainability trend reads.
- Default lifecycle hypertrophy RIR bands are duration-aware rather than fixed to a 4+1 template.

## Workout generation receipt contract
- Routes:
  - `POST /api/workouts/generate-from-intent` (`src/app/api/workouts/generate-from-intent/route.ts`)
  - `POST /api/workouts/generate-from-template` (`src/app/api/workouts/generate-from-template/route.ts`)
- Generation responses return canonical selection metadata and server-owned prescription readouts only:
  - intent route returns `selectionMetadata`, carrying canonical `sessionDecisionReceipt`
  - template route returns `selectionMetadata`, carrying canonical `sessionDecisionReceipt`
  - both routes may return optional `prescriptionReadouts` (`PrescriptionConfidenceReadout[]` from `src/lib/api/template-session/types.ts`) after canonical load assignment. When targeted selected-exercise prescription-anchor history backfills an exact anchor, the matching readout row may include compact `selectedAnchorEvidence` with the selected exercise id/name, whether normal history already had usable exact evidence, the backfill reason, ignored skipped/unperformed row count, and aggregate source counts. This is response/read-model metadata only; it must not be persisted as executable seed truth, planner policy, runtime replay input, or a receipt mirror.
- Generation routes canonicalize receipt readiness/autoregulation fields through shared selection metadata helpers rather than returning ad hoc top-level session mirrors (`src/lib/ui/selection-metadata.ts`, `src/lib/api/template-session/types.ts`).
- Generation routes own original plan metadata. Mutation reconciliation is added later by write-side mutation paths when the saved workout structure changes.
- Both generation routes now return `409` with `{ error: "Mesocycle handoff pending.", handoff }` when the prior mesocycle is closed into `AWAITING_HANDOFF` and no successor has been accepted yet.
- For accepted V4, both generation routes also return `409` with `code: "V4_SCHEDULE_RESOLUTION_BLOCKED"` when exact slot evidence is stale, malformed, duplicated, or already fully resolved but the lifecycle read has not refreshed. They do not fall back to counters or current user schedule constraints.
- Both generation routes accept optional `slotId` input and stamp canonical `selectionMetadata.sessionDecisionReceipt.sessionSlot` for seeded advancing sessions from the truthful runtime slot identity, including off-order explicit-intent generation when the requested intent maps to an unresolved runtime slot. That receipt snapshot carries `slotId`, `intent`, `sequenceIndex`, optional `sequenceLength`, and `source`.
- `POST /api/workouts/generate-from-intent` treats an explicit `slotId` as planned-session identity, not a custom-template request. The slot must still be unresolved in the active week and no other incomplete workout may own the current workout lifecycle. A stale, completed, invalid, or otherwise ineligible explicit slot fails closed with `409`; the route does not fall through to generic intent generation.
- Generation/finalization stamps `selectionMetadata.sessionDecisionReceipt.sessionProvenance` with the active mesocycle id and the session-level composition source. Supported values are `persisted_slot_plan_seed`, `runtime_selection`, `deload_seed_replay`, `legacy_fallback`, and `unknown`. This is intentionally narrower than audit `generationPath`; generation path remains audit-only and is not part of the saved receipt contract.
- Advancing generation no longer waits for post-generation route stamping to make slot meaning concrete. When runtime next-session resolution already knows the advancing slot, `generateSessionFromIntent()` receives that canonical slot snapshot up front, and the audit future-week generation path forwards the same slot context for derived advancing runs.
- The non-V4 `ACTIVE_DELOAD` intent path preserves that same advancing-slot snapshot through deload finalization into the canonical `sessionDecisionReceipt.sessionSlot`; `deload_seed_replay` versus `runtime_selection` composition provenance remains unchanged.
- For deload generation, receipt-backed user messaging should describe recovery intent, lighter loads, and reduced volume without hard-coding a fixed percentage promise. The canonical receipt scope is the deload decision payload, especially `selectionMetadata.sessionDecisionReceipt.deloadDecision.appliedTo`.
- Planning semantics behind those routes are centralized in `src/lib/planning/session-opportunities.ts`. Route contracts do not expose planner inventory mode directly; `standard`, `closure`, and `rescue` remain internal generation concepts selected by the orchestration layer.
- `POST /api/workouts/generate-from-intent` request fields include optional gap-fill controls (`src/lib/validation.ts`, `src/lib/api/template-session/types.ts`):
  - `optionalGapFill?: boolean`
  - `anchorWeek?: number` (legacy/manual override path; current week-close flow derives the effective week from pending week-close context)
  - `weekCloseId?: string`
  - `optionalGapFillContext?: { weekCloseId: string; targetWeek: number }` on the internal generation seam used by `src/app/api/workouts/generate-from-intent/route.ts`
  - `maxGeneratedHardSets?: number`
  - `maxGeneratedExercises?: number`
  - `targetMuscles` remains required for `intent=body_part`
- Optional gap-fill generation uses the same planner/selection engine path as standard intent generation. Allowed route-level deltas are:
  - post-generation caps trimming
  - canonical metadata stamping via `attachOptionalGapFillMetadata()` (`src/lib/ui/selection-metadata.ts`)
  - week-close-context injection (`optionalGapFillContext.targetWeek`) before planner context loading (`src/app/api/workouts/generate-from-intent/route.ts`, `src/lib/api/template-session.ts`)
- Week-close ownership remains canonical for legacy/manual optional gap-fill. Normal weekly close no longer creates pending optional work from target deficits. Runtime optional gap-fill generation still requires an existing pending `MesocycleWeekClose` row and links the generated workout back to that row via `selectionMetadata.weekCloseId`; audit and repair tooling may detect or reconcile legacy data that predates that ownership contract, but they do not change the runtime route semantics.
- Within that shared generation path, optional gap-fill currently enters the planner through the explicit `rescue` inventory layer on `SessionOpportunityDefinition` rather than widening standard inventory eligibility for all `body_part` requests.
- Workout-audit artifacts now expose additive normalized canonical semantics alongside snapshots:
  - top-level `canonicalSemantics` when a session snapshot is present
  - per-session `historicalWeek.sessions[*].canonicalSemantics`
  - `progressionAnchor.canonicalSemantics`
  This block is the stable artifact-facing summary for `phase`, `isDeload`, `countsTowardProgressionHistory`, `countsTowardPerformanceHistory`, and `updatesProgressionAnchor`.
- Canonical receipt fields for gap-fill payloads:
  - `selectionMetadata.sessionDecisionReceipt.exceptions` contains `optional_gap_fill`
  - `selectionMetadata.sessionDecisionReceipt.targetMuscles` carries chosen muscles
  - `selectionMetadata.weekCloseId` carries the linked pending week-close id
  - `selectionMetadata.sessionDecisionReceipt.cycleContext.weekInMeso` is pinned from the pending week-close `targetWeek`
  - `selectionMetadata.sessionDecisionReceipt.cycleContext.weekInBlock` is derived from the block containing that anchored mesocycle week when `TrainingBlock` rows exist, with lifecycle fallback only when block data is unavailable
  - `selectionMetadata.sessionDecisionReceipt.cycleContext.blockDurationWeeks` carries the active block horizon when canonical block context exists, so read-side explainability can speak in block-relative terms without re-deriving block length

## Week-close deficit snapshot notes
- Pending and resolved week-close rows in `src/lib/api/mesocycle-week-close.ts` serialize `deficitSnapshot.muscles[]` as `{ muscle, target, actual, deficit }`.
- After the weekly-volume unification, `actual` and `deficit` in that snapshot are based on weighted effective weekly volume from `loadMesocycleWeekMuscleVolume()` in `src/lib/api/weekly-volume.ts`, not primary-only direct-set counts.
- `findRelevantWeekCloseForUser()` is the canonical broad selector for relevant week-close truth, rather than a direct UI-visibility contract. Surfaces with current-week semantics must additionally scope that row to the active/displayed week before rendering. Normal-flow `resolution=AUTO_DISMISSED` rows are review evidence, not active optional closeout work, and must not be surfaced as blocking Home/Program actions.
- Week-close truth model:
  - `workflowState=PENDING_OPTIONAL_GAP_FILL`: optional gap-fill workflow is still actionable
  - `workflowState=COMPLETED`: workflow is handled or no longer actionable
  - `deficitState=OPEN`: deficit remains and workflow is still pending
  - `deficitState=PARTIAL`: workflow is complete but weighted weekly deficit still remains
  - `deficitState=CLOSED`: no qualifying weekly deficit remains
- `resolution=NO_GAP_FILL_NEEDED` is the only resolution that implies deficit closure by itself. `GAP_FILL_COMPLETED`, `GAP_FILL_DISMISSED`, and `AUTO_DISMISSED` must not be interpreted as equivalent to `deficitState=CLOSED`.
- At a required scheduled week boundary, target deficits resolve as `status=RESOLVED`, `workflowState=COMPLETED`, and `resolution=AUTO_DISMISSED`; they are review evidence and do not block rollover into the next accumulation week or deload.
- `POST /api/mesocycles/week-close/[id]/closeout` is the canonical server-owned legacy/manual closeout creation path. The route resolves owner identity and delegates to `createCloseoutSessionForWeek()` in `src/lib/api/mesocycle-week-close.ts`, which validates that the user-owned week-close row is still `PENDING_OPTIONAL_GAP_FILL`, validates it against the current or immediately previous active accumulation week in the same active mesocycle, rejects resolved/deload/duplicate closeouts, and creates a slotless `PLANNED` scaffold workout with `selectionMode=MANUAL`, `advancesSplit=false`, `selectionMetadata.weekCloseId`, and the canonical `closeout_session` receipt marker. `GET /api/mesocycles/week-close/[id]/closeout` uses the same seam for link-based UI creation and redirects to `/log/[workoutId]` after creation.
- `POST /api/workouts/[id]/dismiss-closeout` is the canonical closeout skip path. The route resolves owner identity and delegates to `dismissCloseoutSession()` in `src/lib/api/mesocycle-week-close.ts`, which only marks planned receipt-backed closeout workouts with additive `selectionMetadata.closeoutDismissed=true` and `closeoutDismissedAt`, increments `Workout.revision`, and leaves workout status, week-close resolution, optional workout linkage, slot plan state, and the stored receipt untouched.

## Workout explanation response contract
- Route: `GET /api/workouts/[id]/explanation` (`src/app/api/workouts/[id]/explanation/route.ts`).
- The route looks up the canonical local/authenticated owner through `findOwnerReadOnly()` without provisioning and passes the required owner ID into `generateWorkoutExplanation()`. The application query matches both `Workout.id` and `Workout.userId`; missing and foreign-owned workout IDs therefore return the same `404 { error: "Workout not found" }` response.
- Response includes `progressionReceipts` keyed by `exerciseId` in addition to `exerciseRationales` and `prescriptionRationales`.
- Receipt payload shape is defined by `ProgressionReceipt` in `src/lib/evidence/types.ts` and populated by `generateWorkoutExplanation()` in `src/lib/api/explainability.ts`.
- `ProgressionSetSummary` now supports `performedAt` for historical evidence timestamps (`src/lib/evidence/types.ts`), and receipt history is recency-bounded in `loadLatestPerformedSetSummary()` (`src/lib/api/explainability.ts`).
- Session context payload now carries cycle/readiness contract fields (`sessionContext.cycleSource`, `sessionContext.readinessStatus.availability`, `sessionContext.readinessStatus.label`) defined in `src/lib/engine/explainability/types.ts` and produced by `explainSessionContext()` in `src/lib/engine/explainability/session-context.ts`.
- Route responsibilities are documented canonically in `docs/01_ARCHITECTURE.md`; this section only records payload shape.
- Explanation-layer consumers should treat `deriveSessionSemantics()` plus canonical progression receipts/decision outputs as the source of session behavior. Explanation routes should not independently re-author session-level progression meaning that could drift from generator-owned next-exposure behavior.
- `nextExposureDecisions` is a read-side interpretation layer only. Its progression verdict must be computed through `computeDoubleProgressionDecision()` using the same material confidence-sensitive inputs as canonical generation for that exercise (`workingSetLoad`, `priorSessionCount`, `historyConfidenceScale`; `confidenceReasons` remains log-only).
- `nextExposureDecisions` also depend on preserved prescribed-load evidence. `targetLoad` must survive context/history mapping so explainability can justify overshoot-based increases or overshoot-block reasons against the same canonical inputs used by generation.
- Post-session review calibration rows may use same-exercise `nextExposureDecisions` as read-only alignment evidence when canonical explainability reframes an otherwise clean-looking row as `target_too_high` or `hold_at_recalibrated_anchor`. This keeps the review copy coherent without changing progression, prescription, seed/runtime, receipt, or planner/materializer behavior.
- User-facing review surfaces that consume this route, including immediate completion review and `/workout/[id]`, preserve that same frozen verdict through `PostSessionReviewDisplayDto` and `PostSessionReviewCard`; they do not recompute a parallel explanation or execution summary.
- Those decisions remain supporting evidence: they may identify a genuine target mismatch, but they do not override successful performed reps/RPE evidence merely because performed load differed from prescription.
- User-facing rendering of canonical `nextExposureDecisions[*].action` should route through `src/lib/ui/next-exposure-copy.ts`. Heuristic/advisory surfaces may describe context, but they should not define alternate canonical action wording for the same decision.
- `confidence.missingSignals` now uses user-facing diagnostic labels rather than engine shorthand:
  - `same-day readiness check-in`
  - `receipt-backed cycle context`
  - `stored exercise selection reasons`
  - `recent performance-derived workout stats`
- `confidence.summary` is intentionally diagnostic:
  - high confidence means the audit has enough evidence to explain the session without major guesswork
  - medium confidence means one signal is being approximated
  - low confidence means the audit can only explain part of the session with confidence

## Session-decision receipt accounting evidence

- Receipt version 3 may include `stimulusAccounting.contractVersion=1` and one server-authored entry per initially materialized exercise: order index, source exercise ID, snapshot contract version, hash, and provenance.
- The save route never trusts client-supplied accounting evidence. Exercise rewrites replace it from server-resolved snapshots; non-rewrite saves preserve only already-persisted evidence.
- Runtime add/swap evidence is appended to `runtimeEditReconciliation` and includes the exact snapshot hash/provenance written in the same transaction.
- The receipt and runtime-edit ledger are evidence manifests; `WorkoutExercise.stimulusAccountingSnapshot` remains the canonical accounting payload.
# Production write-pause contract

All classified mutation handlers call the server-owned production write gate before owner
resolution or database access. The server-only environment variable is
`TRAINER_WRITE_PAUSE`; only the exact value `enabled` pauses writes. Missing, empty, or any
other value leaves existing behavior unchanged.

While paused, classified mutation handlers return:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 60
Content-Type: application/json
```

```json
{
  "error": "Trainer writes are temporarily paused for maintenance.",
  "code": "PRODUCTION_WRITE_PAUSED"
}
```

The response never includes the environment value, database or migration status, internal
operation name, request body, user data, workout identifier, or stack trace. GET endpoints and
the read-only POST previews at `/api/mesocycles/[id]/setup-preview` and
`/api/workouts/[id]/add-exercise-preview` remain available.

Canonical ownership:

- exact-value parsing, operation taxonomy, and typed error:
  `src/lib/operations/production-write-gate.ts`
- HTTP mapping and safe blocked-write event:
  `src/lib/operations/production-write-gate-http.ts`
- route and operational ownership inventory:
  `scripts/check-production-write-gate.ts`

## Short-today request and save contract

- `POST /api/workouts/generate-from-intent` accepts only `sessionCapacity: "as_planned" | "short_today"`. The strict request rejects client omission IDs, set indexes, priorities, classes, or claims.
- Generation returns `sessionCapacity.status` plus a server preview or fail-closed reason. The full snapshot and original receipt are captured before any reduction.
- `POST /api/workouts/save` accepts the same mode only as creation intent. For `short_today`, it reloads current owner/mesocycle/revision evidence, recomputes the exact variant from the full snapshot, validates receipt provenance and both fingerprints, and replaces client-carried reduction evidence with a canonical operation.
- An exact duplicate creation fingerprint is idempotent. Changed or post-creation Short requests return `409`. Later ordinary runtime edits use existing contracts.
- Unsupported requests leave the full plan unchanged. No route mutates seeds, future sessions, weekly allocation, planner policy, repair, or readiness activation.
## Custom hypertrophy plan API (default off)

These contracts are available only when `TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT=enabled`; otherwise the existing plan routes keep their legacy behavior and custom-only routes return `503`.

The server editor loader derives structured Plan Health for the exact persisted draft ID/revision using the current catalog, equipment profile, and recognized/unrecognized limitation result. The response carries the domain policy version, all four authoritative tiers, and a server-authored opaque `confirmationScope`; informational volume entries explicitly identify `INFORMATIONAL_ESTIMATE`. Client display freshness and server confirmation authority are separate contracts. The deterministic display-assessment identity covers every visible issue tier, summary, volume estimate, session estimate, policy, and saved draft identity/revision, and is used only to install or label current Health. The server confirmation digest binds only materially presented important-warning semantics plus plan/revision, canonical prescription/settings, preview, policy, equipment, and limitation replay context. Coaching observations, informational volume, and non-gating session estimates can refresh display identity but never change confirmation scope. Blocking safety is recomputed independently and always blocks. Neither identity independently hashes raw catalog aliases, raw precomputed stimulus, V1 measurement, or total catalog size when those inputs do not change its owned semantics; V2 measurement remains protected through prescription and preview identity. The response scope is never persisted, and the client display identity is never sent or accepted as finalization authority.

- `POST /api/plans`: custom hypertrophy creation accepts name, 2–6 sessions, equipment, duration, author method, an optional manual preset, and an optional client-generated `creationId`. The UI bases attempt identity on the canonical creation payload, so names that differ only by leading, trailing, or repeated internal whitespace remain one logical attempt. It retains one `creationId` through network failures, non-success responses, and unreadable or structurally invalid success responses; it clears that token only after a structurally valid plan enters the navigation path, and generates a new one when the canonical payload changes. The server deterministically derives an owner-namespaced unique plan identity from that UUID, derives new draft slot identities from the plan identity, replays only an owner/name/payload-equivalent duplicate, and returns `409 code=PLAN_CREATION_ID_CONFLICT` for conflicting reuse by that owner. The same client UUID remains independent across owners. No time, title, or content-window heuristic is used. V2 generation requires four sessions. `authorMethod="WEEKLY"` creates a strict Draft V2 with generic session structure, four accumulation weeks, and a final deload; it does not create a mesocycle or accepted programming.
- `PATCH /api/plans/[id]/draft`: atomically saves normalized plan name plus the complete strict Draft V1 or Draft V2 using `expectedRevision`; stale writes return the existing plan mutation conflict response. A structurally valid but overall-incomplete Draft V2 can save. Malformed placements fail validation before the CAS write. Preserved measurement snapshots are server-controlled: a save may carry only an exact placement/exercise/measurement tuple already present in the current persisted copy. Introducing, changing, removing, or transferring a trusted snapshot returns `409 code=PLAN_DRAFT_MEASUREMENT_PROVENANCE_INVALID` with no partial write; replacing the exercise must omit the old snapshot and uses current catalog measurement. Every successful save response includes non-persisted structured `health` tied to the exact returned draft ID/revision and current catalog, equipment, recognized limitations, and unrecognized-limitation status. Draft V2 also includes the existing non-persisted `preview` union derived inside the transaction after provenance validation: deterministic ineligibility reasons, or normalized accepted/executable payloads plus SHA-256 hash when eligible. An evaluator failure is returned as explicit unavailable Health rather than “no issues”; the saved draft remains authoritative and editable. Health and preview are never written into the draft payload.
  - Progression-first and current-session bulk controls are client-side authoring commands only. They submit the same complete exact Draft V2 rows through this existing CAS endpoint; no pattern or bulk-operation metadata is persisted, accepted, or exposed by the API.
  - Draft V2 placements may carry optional `recommendationBaseline` metadata only when an exercise was newly recommended or the user explicitly reapplied the recommendation. Legacy and manually authored placements keep it absent unless that explicit action creates it; reading or opening an existing draft never materializes it automatically.
  - `recommendationBaseline` freezes the recommended exercise identity, inferred intent, and five weekly prescriptions for exact reset and customization comparison. Exercise replacement clears it when it belongs to the previous exercise identity.
  - The field is draft-authoring metadata only. Accepted compilation and executable projection strip it, and preview, finalization, activation, workout generation, and historical execution do not require or consume it.
- `POST /api/plans/[id]/regenerate`: replaces a four-session Draft V1 through V2 only when `replaceConfirmed=true` and the expected revision still matches. Because Draft V1 has no durable placement identity, the client synchronously locks every name/draft mutation handler before requesting replacement and never merges local structure into the response. The service CAS-persists and returns the same generated object. Draft V2 returns `409 code=PLAN_VERSION_NOT_EXECUTABLE` before replacement. If the server commits but the response is lost, the client keeps its pre-request revision; a later edit/retry is rejected by CAS and recovery is an explicit refresh of the committed revision, never automatic regeneration replay.
- `POST /api/plans/[id]/finalize`: custom requests supply `expectedDraftRevision`, optional opaque `warningConfirmationScope`, and for Draft V2 the saved preview's `confirmedPreviewHash`; the schema is strict and rejects booleans, display identities, severities, counts, assessment content, or decomposed scope contents as authority. A request containing the retired `warningsConfirmed` field is recognized before generic schema dispatch and returns exactly `409 code=PLAN_FINALIZE_CLIENT_STALE` with `error="This plan editor is out of date. Refresh or reload the page before finalizing."`; this response performs no owner lookup, Health orchestration, finalization, or write, regardless of the boolean value or whether the current plan has warnings. The legacy boolean is never translated into a scope. Make-ready re-reads the exact draft, catalog, equipment, and limitations and independently recomputes preview, Health, and scope inside the serializable transaction. The deterministic scope is `plan-health-confirmation.v1.<sha256>` over the scope-contract version, Health policy version, plan/draft ID, persisted revision, canonical draft prescription hash and settings, eligible preview hash or exact ineligibility identity, the code-unit-ordered important-warning codes, tiers, titles, explanations, suggested actions, affected presentation, and blocking/acknowledgment flags, plus exact resolved equipment and recognized/unrecognized limitation replay context. Plan, session, placement, and exercise identity remain protected by plan/draft identity, the full canonical prescription hash, and preview identity; warning affected session/exercise/muscle presentation is additionally bound. Coaching observations, neutral weekly volume, informational estimates, non-gating session estimates, and other non-warning presentation are excluded. Ordering is ordinal UTF-16 code-unit order and never depends on locale or ICU. Warning count is descriptive only and never defines equality. When important warnings exist, missing or non-equal scope returns `409 code=PLAN_WARNING_CONFIRMATION_REQUIRED`, `confirmationStatus=MISSING|MISMATCH`, and the freshly recomputed `health` including its current scope; no write survives. The client must present that returned warning set and obtain a new explicit confirmation, and it must never auto-confirm or retry a replacement set. A display-only refresh leaves an otherwise valid scope usable. Blocking safety is transactionally recomputed before scope comparison and fails independently, so it cannot be acknowledged away. Finalization rejects stale V4 hash with `PLAN_PREVIEW_HASH_MISMATCH`, rejects non-supported weekly topology with `PLAN_UNSUPPORTED_TOPOLOGY`, returns `409 code=PLAN_LIMITATION_UNRECOGNIZED` when any current active limitation cannot be resolved to canonical safety meaning, and fails closed if Health cannot be evaluated. The response does not echo limitation text. All checks precede creation of immutable accepted revision 1, and the draft is consumed last. Rollout-disabled custom-shaped requests fail explicitly before owner provisioning. Finalization does not activate the plan.
- `POST /api/plans/[id]/copy`: creates a new draft from a source plan's current version 2, 3, or 4 accepted revision. V4 copies preserve weekly prescriptions, placement identity, and measurement semantics losslessly; V2/V3 copies preserve settings, slot names/focus, exercise intent, and bounded `requiredExerciseClass`. The contract never infers semantic intent from exercise identity, and legacy plans without preserved intent are not copyable.

Ready and Active custom plans have no in-place edit API. Activation remains the existing separate `/api/plans/[id]/activate` operation and retains the in-progress-workout guard. An owned Draft V2 is classified `VERSION_NOT_EXECUTABLE` and returns `409 code=PLAN_VERSION_NOT_EXECUTABLE` before active-plan selection.
