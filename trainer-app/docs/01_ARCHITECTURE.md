# 01 Architecture

Owner: Aaron  
Last reviewed: 2026-03-08  
Purpose: Defines the current runtime architecture for the single-user local-first Trainer app and the boundaries between UI, API routes, orchestration, engine, and persistence.

This doc covers:
- App Router UI and API boundaries
- Orchestration and engine boundaries
- Persistence and runtime identity model

Invariants:
- Runtime identity is owner-scoped via `resolveOwner()`.
- App routes and API routes are the only external app surface.
- Engine logic is pure/domain-focused under `src/lib/engine`; DB access lives in API/orchestration.
- Mesocycle lifecycle ownership is split into math/state modules behind the `src/lib/api/mesocycle-lifecycle.ts` facade.

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
4. Mesocycle lifecycle service layer: `src/lib/api/mesocycle-lifecycle.ts` facade over `src/lib/api/mesocycle-lifecycle-math.ts` (derivation/targets) and `src/lib/api/mesocycle-lifecycle-state.ts` (state transitions).
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
- Generation/finalization build the canonical session decision under `selectionMetadata.sessionDecisionReceipt` in `src/lib/api/template-session.ts`, with planning-critical seams in `src/lib/planning/session-opportunities.ts`, `src/lib/api/template-session/role-budgeting.ts`, and `src/lib/api/template-session/closure-actions.ts`.
- Generation-facing phase/block context is loaded in `src/lib/api/generation-phase-block-context.ts` and attached in `src/lib/api/template-session/context-loader.ts`. That seam is now the canonical bridge from persisted `MacroCycle -> Mesocycle -> TrainingBlock` data into generation/runtime `cycleContext`.
- Save requires that receipt, then only re-parses/re-normalizes the persisted JSON shape at the database boundary in `src/app/api/workouts/save/route.ts`, with action/status resolution isolated in `src/app/api/workouts/save/status-machine.ts` and receipt parsing in `src/lib/evidence/session-decision-receipt.ts`.
- Runtime readers in UI and explainability consume only `selectionMetadata.sessionDecisionReceipt` via `src/lib/ui/selection-metadata.ts`, `src/lib/ui/explainability.ts`, and the explainability facade in `src/lib/api/explainability.ts` (split into `src/lib/api/explainability/query.ts` + `src/lib/api/explainability/assembly.ts`).
- Removed top-level session mirrors (`wasAutoregulated`, `autoregulationLog`, legacy `selectionMetadata.*` session fields) remain guardrail rejects in `src/lib/validation.ts`; they are not active runtime inputs.
- User-facing workout detail and log routes stay on the compact receipt-first `SessionSummaryModel`, while the internal `/workout/[id]/audit` route layers a session-level audit scan plus exercise drill-down on top of the same receipt/explainability inputs. That split is a presentation boundary only; ownership remains receipt-first in `selectionMetadata.sessionDecisionReceipt`.

## Session planning boundaries
- `SessionOpportunityDefinition` in `src/lib/planning/session-opportunities.ts` is the canonical planning layer above the optimizer for session-intent semantics.
- That module owns:
  - session character (`upper`, `lower`, `full_body`, `specialized`)
  - intent alignment rules
  - per-muscle opportunity weights for current-session and future-slot planning
  - inventory eligibility by planning phase (`standard`, `closure`, `rescue`)
  - anchor policy for role fixtures
- `src/lib/api/template-session.ts` orchestrates generation against those opportunity definitions; it should not introduce new split-specific ownership maps outside that boundary.
- Remaining-week planning (`src/lib/api/template-session/remaining-week-planner.ts`), selection targeting (`src/lib/api/template-session/selection-adapter.ts`), and intent filtering (`src/lib/api/template-session/intent-filters.ts`) all consume the same opportunity layer.

## Lifecycle ownership and data entities
- Lifecycle state transitions (`ACTIVE_ACCUMULATION` -> `ACTIVE_DELOAD` -> `COMPLETED`) are executed through `transitionMesocycleState()` via `src/lib/api/mesocycle-lifecycle.ts` (state module: `src/lib/api/mesocycle-lifecycle-state.ts`), invoked from `src/app/api/workouts/save/route.ts` after first transition into a performed status.
- Lifecycle-derived targeting helpers (`getCurrentMesoWeek()`, `getWeeklyVolumeTarget()`, `getRirTarget()`) are consumed through the lifecycle facade (math module: `src/lib/api/mesocycle-lifecycle-math.ts`). For weekly volume targets, the canonical input is now the mesocycle's ordered `blocks` timeline when present; generation may still pass explicit phase/block profile context from `src/lib/api/generation-phase-block-context.ts` when it needs anchored or overridden week semantics.
- Weekly volume interpolation is centralized in `src/lib/engine/volume-targets.ts` and consumed by lifecycle math/engine volume services. The canonical target path is now `Mesocycle.blocks or explicit blockContext -> buildWeeklyVolumeTargetProfile() -> interpolateWeeklyVolumeTarget() -> getWeeklyVolumeTarget() -> generation/planning/read models`, with duration-only interpolation retained only as a fallback when block coverage is missing or incomplete.
- `MesocycleExerciseRole` is a first-class data-layer entity for intent-scoped exercise role continuity (`CORE_COMPOUND` / `ACCESSORY`) across mesocycle lifecycle events.
- `TrainingBlock` is now generation-relevant rather than explainability-only: `cycleContext.blockType` and `cycleContext.weekInBlock` come from the active block when available, with lifecycle fallback only for legacy/missing block data. The same block timeline now shapes both lifecycle weekly volume targets and lifecycle prescription intent.
- Block-aware prescription intent is authored once in `src/lib/engine/periodization/block-prescription-intent.ts`. The canonical effort path is now `GenerationPhaseBlockContext.profile -> buildBlockPrescriptionIntent() -> getRirTarget()/getLifecycleSetTargets()/buildLifecyclePeriodization()`, with `src/lib/engine/periodization/block-config.ts` retained only as a compatibility bridge for legacy modifier consumers.

## Optional sessions / gap-fill
- Optional gap-fill sessions are non-advancing by contract: save route forces `advancesSplit=false` for strict gap-fill sessions and blocks lifecycle mutation for those performed transitions (`src/app/api/workouts/save/route.ts`, `src/app/api/workouts/save/lifecycle-contract.ts`).
- Strict gap-fill classification is canonicalized in one shared predicate (`src/lib/gap-fill/classifier.ts`): receipt marker `optional_gap_fill` AND effective `selectionMode=INTENT` AND `sessionIntent=BODY_PART`.
- Gap-fill generation still uses the normal planner path, but now routes through the explicit `rescue` session inventory in `src/lib/planning/session-opportunities.ts` rather than relying on ad hoc body-part exceptions.
- Anchor-week semantics are dual-stamped:
  - generation pins `selectionMetadata.sessionDecisionReceipt.cycleContext.weekInMeso` to the anchor week
  - generation derives `selectionMetadata.sessionDecisionReceipt.cycleContext.weekInBlock` from the active block containing that anchored meso week when `TrainingBlock` rows exist, with lifecycle fallback only when block data is missing
  - save pins `mesocycleWeekSnapshot=anchorWeek` for strict gap-fill payloads
- Read-side week precedence is snapshot-first for UI/session labels: `mesocycleWeekSnapshot ?? receipt.cycleContext.weekInMeso ?? lifecycle-derived week` (`src/lib/ui/workout-list-items.ts`, `src/app/log/[id]/page.tsx`).
- Program week-volume reads are anchor-safe and week-bounded: query by `mesocycleWeekSnapshot` first, with bounded date fallback for legacy rows lacking snapshot (`src/lib/api/program.ts`).
- Ownership boundaries:
  - next-session derivation and suppression context: `src/lib/api/next-session.ts` + `src/lib/api/program.ts`
  - lifecycle mutation gate and persistence semantics: `src/app/api/workouts/save/route.ts` + `src/app/api/workouts/save/lifecycle-contract.ts`
  - generation path and receipt stamping: `src/app/api/workouts/generate-from-intent/route.ts` + `src/lib/api/template-session.ts`
  - receipt parsing/normalization: `src/lib/evidence/session-decision-receipt.ts`

## Canonical read-side boundaries
- `ProgramDashboardData` in `src/lib/api/program.ts` is the canonical program dashboard read model for the shared `ProgramStatusCard` mounted on `/` and `/program`. It owns mesocycle header/timeline state, current vs viewed week, lifecycle RIR target, deload/readiness cue, and mesocycle-week volume rows. Per-muscle rows now also carry dashboard-only opportunity metadata (`opportunityScore`, `opportunityState`, `opportunityRationale`) derived from canonical weekly weighted volume, recent local weighted stimulus, and optional fresh readiness modulation. It is not the canonical contract for generic workout-history lists.
- Home-page operational helpers that are not part of the shared dashboard card contract live separately in `loadHomeProgramSupport()` in `src/lib/api/program.ts`. `loadHomeProgramSupport()` consumes `loadNextWorkoutContext()` from `src/lib/api/next-session.ts`, which is the canonical next-session derivation service shared with the audit harness.
- `WorkoutListSurfaceSummary` in `src/lib/ui/workout-list-items.ts` is the canonical workout/session summary read model for list surfaces. `/history`, `GET /api/workouts/history`, and the home-page Recent Workouts section should anchor on this shape rather than ad hoc row contracts.
- Shared workout-list display semantics for those list surfaces now live with that contract in `src/lib/ui/workout-list-items.ts`: status labels/classes, intent labels, and exercise/set count copy are centralized there so Recent Workouts and History do not drift.
- Shared route-purpose/navigation metadata now lives in `src/lib/ui/app-surface-map.ts`. That metadata is a UI-navigation aid only; it does not own read-model semantics.
- Persisted workout mesocycle snapshot columns (`mesocycleId`, `mesocycleWeekSnapshot`, `mesoSessionSnapshot`, `mesocyclePhaseSnapshot`) are canonical derived storage, but read-side consumers should normalize them before use:
  - engine/history readers use `mesocycleSnapshot` via `mapHistory()` in `src/lib/api/workout-context.ts`
  - UI list surfaces use `WorkoutSessionSnapshotSummary` via `buildWorkoutSessionSnapshotSummary()` in `src/lib/ui/workout-session-snapshot.ts`
  - explainability week-scoped volume compliance uses `readPersistedWorkoutMesocycleSnapshot()` in `src/lib/api/workout-mesocycle-snapshot.ts`
- Analytics routes under `src/app/api/analytics/**` remain surface-oriented projections rather than one shared read model, but they now share one explicit semantics helper in `src/lib/api/analytics-semantics.ts` for generated/performed/completed counting vocabulary and rolling-window descriptions. The stable shared boundary with the rest of the app is still the performed-workout / mesocycle-week semantics they reuse, not the full route payload shapes.
- Surface-local formatting stays in the consuming UI when it does not change domain semantics: date formatting, compact vs full layouts, chart grouping, and tab/panel composition.

## Internal workout-audit harness boundaries
- Canonical next-session derivation for both dashboard and audit flows is `loadNextWorkoutContext()` in `src/lib/api/next-session.ts`.
- Audit context normalization is owned by `src/lib/audit/workout-audit/context-builder.ts`, and generation dispatch is owned by `src/lib/audit/workout-audit/generation-runner.ts`.
- Audit artifact assembly/serialization is owned by `src/lib/audit/workout-audit/serializer.ts` and persists JSON artifacts to `artifacts/audits/` via `scripts/workout-audit.ts`.
- Audit generation modes currently supported are `next-session` and `intent-preview` (`src/lib/audit/workout-audit/types.ts`).
- Planner diagnostics persistence is mode-gated in the canonical session receipt:
  - canonical storage surface is `selectionMetadata.sessionDecisionReceipt.plannerDiagnostics`
  - the planner emits one layered diagnostics object spanning `opportunity`, `anchor`, `standard`, `supplemental`, `closure`, `rescue`, and `outcome`, alongside the existing `muscles` and `exercises` summaries
  - `standard`: keeps the layered summaries and selected closure actions, strips candidate-heavy traces (`standard.candidates`, `supplemental.candidates`, `rescue.candidates`, `closure.firstIterationCandidates`)
  - `debug`: keeps the full layered diagnostics object, including candidate-heavy traces for audits and regression testing
  - planner diagnostics are built in the main intent-generation path in `src/lib/api/template-session.ts`, then normalized/parsed only at the receipt boundary in `src/lib/evidence/session-decision-receipt.ts`
- Source: `src/lib/evidence/session-decision-receipt.ts`
- Audit artifacts support privacy-aware output modes:
  - `live`: full internal identity context
  - `pii-safe`: redacted identity/request identifiers
  - Source: `src/lib/audit/workout-audit/types.ts`, `src/lib/audit/workout-audit/serializer.ts`, `scripts/workout-audit.ts`
