# 01 Architecture

Owner: Aaron  
Last reviewed: 2026-03-16  
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

## Live workout cue boundary
- The in-session autoreg/load hint shown while logging is a UI-only coaching seam owned by `src/components/log-workout/useWorkoutSessionFlow.ts` and `src/lib/progression/load-coaching.ts`.
- That hint is derived from the just-logged set plus the next unlogged set in the same exercise. It is not persisted and it is not a canonical progression artifact.
- Canonical next-exposure load progression remains server-side in `src/lib/engine/apply-loads.ts` + `src/lib/engine/progression.ts`; the live cue must not redefine or override that logic.
- Load-aware live cue copy may acknowledge `actualLoad` vs `targetLoad`, but it remains an explainability aid for the current session rather than a generator input.
- Dumbbell load display/storage semantics must stay aligned with canonical `quantizeLoad()` in `src/lib/units/load-quantization.ts`. UI helpers in `src/lib/ui/load-display.ts` may format or convert per-hand values, but they must not maintain a separate dumbbell snap whitelist or alternate rounding policy.

## Canonical session-decision flow
- Generation/finalization build the canonical session decision under `selectionMetadata.sessionDecisionReceipt` in `src/lib/api/template-session.ts`, with planning-critical seams in `src/lib/planning/session-opportunities.ts`, `src/lib/api/template-session/role-budgeting.ts`, and `src/lib/api/template-session/closure-actions.ts`.
- Generation-facing phase/block context is loaded in `src/lib/api/generation-phase-block-context.ts` and attached in `src/lib/api/template-session/context-loader.ts`. That seam is now the canonical bridge from persisted `MacroCycle -> Mesocycle -> TrainingBlock` data into generation/runtime `cycleContext`.
- Save requires that receipt, then only re-parses/re-normalizes the persisted JSON shape at the database boundary in `src/app/api/workouts/save/route.ts`, with action/status resolution isolated in `src/app/api/workouts/save/status-machine.ts` and receipt parsing in `src/lib/evidence/session-decision-receipt.ts`.
- Structural mutation reconciliation is persisted separately from the receipt under `selectionMetadata.workoutStructureState`. That record stores the current saved structure summary plus generated-vs-saved reconciliation for mutation paths such as workout rewrites and `POST /api/workouts/[id]/add-exercise`.
- Post-save session-level interpretation is centralized in `src/lib/session-semantics/derive-session-semantics.ts`. That helper is the canonical read-side bridge from persisted workout fields (`advancesSplit`, `selectionMode`, `sessionIntent`, `selectionMetadata`) into downstream session behavior such as progression eligibility, weekly-slot consumption, and next-session subtraction.
- Runtime readers in UI and explainability consume canonical selection metadata via `src/lib/ui/selection-metadata.ts` and `src/lib/ui/explainability.ts`: `sessionDecisionReceipt` remains original generated/evidence truth, while `workoutStructureState` is the canonical mutation-reconciliation truth for current saved structure.
- Removed top-level session mirrors (`wasAutoregulated`, `autoregulationLog`, legacy `selectionMetadata.*` session fields) remain guardrail rejects in `src/lib/validation.ts`; they are not active runtime inputs.
- User-facing workout detail and log routes stay on the compact receipt-first `SessionSummaryModel`, while the internal `/workout/[id]/audit` route layers a session-level audit scan plus exercise drill-down on top of the same receipt/explainability inputs. That split is a presentation boundary only; ownership remains receipt-first in `selectionMetadata.sessionDecisionReceipt`.
- When `workoutStructureState.reconciliation.hasDrift === true`, receipt/planner copy is intentionally relabeled as original-plan context instead of being presented as current saved-workout truth.

## Post-workout canonical flow
```text
SetLog / logged performance
-> workout save / status resolution
-> deriveSessionSemantics
-> session decision receipt + canonical semantics consumers
-> post-workout explanation layer
-> next workout generation / canonical progression
```
- `SetLog` is the raw authoritative performed-work source. Logged reps, load, RPE, and skip state remain the only authoritative set-level performance data (`src/app/api/logs/set/route.ts`, `src/lib/api/workout-context.ts`).
- Workout save and status resolution are the authoritative performed-status and lifecycle-mutation boundary (`src/app/api/workouts/save/route.ts`, `src/app/api/workouts/save/status-machine.ts`, `src/app/api/workouts/save/lifecycle-contract.ts`).
- `POST /api/workouts/save` now returns canonical `workoutStatus` on every success response via `src/lib/api/workout-save-contract.ts`. Client completion flows must treat `mark_completed` as intent only and derive terminal review state from the returned `workoutStatus`, not from the requested action.
- `deriveSessionSemantics()` is the canonical session-level interpretation bridge. It does not own set-level progression math like modal load or anchor-load computation; it owns session-level meaning such as whether a workout is advancing, supplemental, or progression-eligible.
- Deload defaults are centralized in `src/lib/deload/semantics.ts`. That seam owns canonical deload detection, target effort defaults, hard-set reduction defaults, progression-history exclusion policy, and the shared "next block re-anchors from accumulation work" contract.
- That same semantic layer also owns deload isolation: scheduled deload stays visible to performed-history, compliance, recovery, and weekly-volume reads, but it is excluded from progression anchors and performance-history consumers.
- `selectionMetadata.sessionDecisionReceipt` remains the canonical stored generation/evidence context for read-side consumers.
- Post-workout explanation is a read-side interpretation layer. It should consume canonical receipts, derived session semantics, and canonical progression outputs rather than independently re-authoring progression-relevant session behavior.
- Shared next-exposure progression-input assembly now lives in `src/lib/progression/canonical-progression-input.ts`. Generation (`src/lib/engine/apply-loads.ts`) and explainability (`src/lib/api/explainability.ts`) both consume that seam before calling `computeDoubleProgressionDecision()`.
- Shared canonical next-exposure wording now lives in `src/lib/ui/next-exposure-copy.ts`. Read-side surfaces that present canonical `NextExposureDecision.action` outcomes should format those actions through that seam rather than maintaining local wording ladders.
- The completed-workout review path is also a shared read-side seam: live load coaching remains session-local, but explanation plus the `PostWorkoutInsights` model must stay semantically aligned with canonical progression for the same performed workout. Immediate completion review and `/workout/[id]` are separate presentation entries over the same read model, not separate progression interpreters.
- The normal post-workout UX is a presentation layer over that same read-side data. The default completion/review path should lead with session outcome, key-lift takeaways, and prominent next-exposure guidance, with program-impact signals kept compact in their dedicated section, while `/workout/[id]/audit` remains the deeper verification surface over the same canonical explanation inputs.
- Next workout generation and load progression remain canonical in generator/engine seams (`src/lib/engine/apply-loads.ts`, `src/lib/engine/progression.ts`, `src/lib/api/next-session.ts`).

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
- `TrainingBlock` is now generation-relevant rather than explainability-only: `cycleContext.blockType`, `cycleContext.weekInBlock`, and optional `cycleContext.blockDurationWeeks` come from the active block when available, with lifecycle fallback only for legacy/missing block data. The same block timeline now shapes both lifecycle weekly volume targets and lifecycle prescription intent.
- Block-aware prescription intent is authored once in `src/lib/engine/periodization/block-prescription-intent.ts`. The canonical effort path is now `GenerationPhaseBlockContext.profile -> buildBlockPrescriptionIntent() -> getRirTarget()/getLifecycleSetTargets()/buildLifecyclePeriodization()`, with `src/lib/engine/periodization/block-config.ts` retained only as a compatibility bridge for legacy modifier consumers.

## Optional sessions / gap-fill
- Optional gap-fill sessions are non-advancing by contract: save route forces `advancesSplit=false` for strict gap-fill sessions and blocks lifecycle mutation for those performed transitions (`src/app/api/workouts/save/route.ts`, `src/app/api/workouts/save/lifecycle-contract.ts`).
- Strict gap-fill classification is canonicalized in one shared predicate (`src/lib/gap-fill/classifier.ts`): receipt marker `optional_gap_fill` AND effective `selectionMode=INTENT` AND `sessionIntent=BODY_PART`.
- Week-close truth is explicitly dual-state in `src/lib/api/mesocycle-week-close.ts`: `workflowState` tracks whether the optional gap-fill workflow is still pending, while `deficitState` tracks whether the weighted weekly deficit is `OPEN`, `PARTIAL`, or `CLOSED`.
- Resolved week-close rows remain read-side visible when `deficitState !== CLOSED` through `findRelevantWeekCloseForUser()` and `loadHomeProgramSupport()` (`src/lib/api/mesocycle-week-close.ts`, `src/lib/api/program.ts`). `resolution` remains a compatibility field and must not be overread as deficit truth.
- Supplemental deficit sessions are also non-advancing by contract: save route forces `advancesSplit=false` for strict supplemental sessions and keeps them out of lifecycle mutation on performed transitions (`src/app/api/workouts/save/route.ts`, `src/lib/session-semantics/supplemental-classifier.ts`).
- Strict supplemental classification is canonicalized in one shared predicate (`src/lib/session-semantics/supplemental-classifier.ts`): receipt marker `supplemental_deficit_session` AND effective `selectionMode=INTENT` AND `sessionIntent=BODY_PART`.
- Receipt exception markers are used instead of new workout enums because supplemental/gap-fill semantics are overlays on the existing workout contract, not new persisted workout kinds. The canonical storage shape stays `selectionMode`, `sessionIntent`, `advancesSplit`, and receipt metadata, with strict classifiers reconstructing behavior at read/write boundaries (`src/lib/ui/selection-metadata.ts`, `src/lib/evidence/session-decision-receipt.ts`, `docs/03_DATA_SCHEMA.md`).
- Read-side session interpretation is centralized in `src/lib/session-semantics/derive-session-semantics.ts`. `advancesSplit` remains the write-side lifecycle contract, while read-side consumers derive session meaning (`advancing`, `gap_fill`, `supplemental`, `non_advancing_generic`) from persisted fields instead of scattering policy booleans.
- Gap-fill generation still uses the normal planner path, but now routes through the explicit `rescue` session inventory in `src/lib/planning/session-opportunities.ts` rather than relying on ad hoc body-part exceptions.
- Supplemental deficit generation uses the normal BODY_PART intent route through `src/app/api/workouts/generate-from-intent/route.ts`; backend stamps canonical receipt metadata and the client persists the returned `selectionMetadata` unchanged (`src/components/IntentWorkoutCard.tsx`).
- Supplemental deficit generation narrows that BODY_PART path with `supplementalPlannerProfile` rather than introducing a second optimizer. The profile keeps the same planner pipeline but applies smaller session caps, accessory-first selection bias, deficit-aware supplemental set caps, and a soft multi-target coverage floor (`src/app/api/workouts/generate-from-intent/route.ts`, `src/lib/api/template-session.ts`, `src/lib/api/template-session/selection-adapter.ts`, `src/lib/engine/selection-v2/candidate.ts`).
- Gap-fill and other non-advancing sessions do not participate in next advancing intent derivation because read-side slot-consumption policy now flows through `deriveSessionSemantics()`. They remain visible to history/volume/recovery read paths, but they do not consume required weekly schedule slots.
- Supplemental deficit sessions remain visible to history/volume/recovery read paths, but the same derived helper keeps them out of progression anchors and progression explainability history (`src/lib/session-semantics/derive-session-semantics.ts`, `src/lib/progression/progression-eligibility.ts`, `src/lib/api/explainability.ts`).
- Progression isolation is enforced through a separate progression-history boundary, not by hiding performed work globally. `isProgressionEligibleWorkout()` derives the canonical `progressionEligible` flag from session semantics, and `filterProgressionHistory()` removes only `progressionEligible === false` rows from anchor/evidence consumers while `filterPerformedHistory()` still keeps the session visible to volume/recovery/stimulus reads (`src/lib/progression/progression-eligibility.ts`, `src/lib/engine/history.ts`, `src/lib/api/workout-context.ts`).
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
- `ProgramDashboardData` in `src/lib/api/program.ts` is the canonical program dashboard read model for the shared `ProgramStatusCard` mounted on `/` and `/program`. It owns mesocycle header/timeline state, current vs viewed week, viewed block chrome (`viewedBlockType`), lifecycle RIR target, deload/readiness cue, and mesocycle-week volume rows. Historical browsing should render from the full selected payload rather than mixing current-week chrome with past-week volume rows. Dashboard `rirTarget` and phase coaching copy now resolve through the same block-aware prescription seam used by generation (`resolvePhaseBlockProfile() -> getRirTarget()`), so the dashboard does not maintain an independent week-to-RIR mapping. Per-muscle rows now also carry dashboard-only opportunity metadata (`opportunityScore`, `opportunityState`, `opportunityRationale`) derived from canonical weekly weighted volume, recent local weighted stimulus, and optional fresh readiness modulation. That metadata is advisory dashboard framing only, not canonical next-session guidance or a generator-owned decision contract. It is not the canonical contract for generic workout-history lists.
- Home-page operational helpers that are not part of the shared dashboard card contract live separately in `loadHomeProgramSupport()` in `src/lib/api/program.ts`. `loadHomeProgramSupport()` consumes `loadNextWorkoutContext()` from `src/lib/api/next-session.ts`, which is the canonical next-session derivation service shared with the audit harness.
- `loadNextWorkoutContext()` is receipt-agnostic and remains lifecycle-safe: lifecycle counters still derive canonical `week/session`, while next advancing `intent` now derives from `constraints.weeklySchedule minus performed intents whose derived session semantics still consume a weekly schedule slot`. That subtraction path is only authoritative for unique-intent weekly schedules; repeated-intent schedules still fall back to canonical slot math until the data model exposes slot identity beyond raw intent.
- Read-side explanation and summary layers must consume derived semantics or canonical decision outputs. They should not independently recompute progression-relevant session meaning unless there is a strong reason and the new seam is documented as canonical first.
- `src/lib/api/explainability.ts` remains a facade, not a free-form policy layer. Within explainability, canonical seam ownership is:
  - `query.ts`: load persisted workout/history/evidence inputs
  - `assembly.ts`: assemble response structure and confidence framing
  - `deriveSessionSemantics()`: session-level interpretation
  - engine progression/history helpers: set-level progression and anchor logic
  Future explainability changes should attach to one of those seams rather than adding new local policy forks inside the facade.
- Canonical next-exposure progression can now advance through a controlled overshoot path in `src/lib/engine/progression.ts` when performed load materially exceeds prescribed `targetLoad`. That decision remains engine-owned and explainability should surface the engine reason rather than inventing a UI-local promotion rule.
- `WorkoutListSurfaceSummary` in `src/lib/ui/workout-list-items.ts` is the canonical workout/session summary read model for list surfaces. `/history`, `GET /api/workouts/history`, and the home-page Recent Workouts section should anchor on this shape rather than ad hoc row contracts.
- Shared workout-list display semantics for those list surfaces now live with that contract in `src/lib/ui/workout-list-items.ts`: status labels/classes, intent labels, exercise/set count copy, explicit deload labeling, and optional-session labeling are centralized there so Recent Workouts and History do not drift.
- Mobile bottom-fixed surfaces use one shared visual-viewport seam in `src/lib/ui/use-visual-viewport-metrics.ts`. Global navigation and workout logging surfaces may consume its non-keyboard `bottomOffset` to track Safari visual-viewport drift, but they should not reintroduce one-off `visualViewport` listeners or separate drift heuristics.
- Shared route-purpose/navigation metadata now lives in `src/lib/ui/app-surface-map.ts`. That metadata is a UI-navigation aid only; it does not own read-model semantics.
- Persisted workout mesocycle snapshot columns (`mesocycleId`, `mesocycleWeekSnapshot`, `mesoSessionSnapshot`, `mesocyclePhaseSnapshot`) are canonical derived storage, but read-side consumers should normalize them before use:
  - engine/history readers use `mesocycleSnapshot` via `mapHistory()` in `src/lib/api/workout-context.ts`
  - UI list surfaces use `WorkoutSessionSnapshotSummary` via `buildWorkoutSessionSnapshotSummary()` in `src/lib/ui/workout-session-snapshot.ts`
  - explainability week-scoped volume compliance uses `readPersistedWorkoutMesocycleSnapshot()` in `src/lib/api/workout-mesocycle-snapshot.ts`
- Analytics routes under `src/app/api/analytics/**` remain surface-oriented projections rather than one shared read model, but they now share one explicit semantics helper in `src/lib/api/analytics-semantics.ts` for generated/performed/completed counting vocabulary and rolling-window descriptions. The stable shared boundary with the rest of the app is still the performed-workout / mesocycle-week semantics they reuse, not the full route payload shapes.
- Surface-local formatting stays in the consuming UI when it does not change domain semantics: date formatting, compact vs full layouts, chart grouping, and tab/panel composition.
- Exercise-library personal history is a descriptive read-side surface. Its recent-trend presentation should stay explicitly non-authoritative and must not claim canonical progression status unless it is rewired onto a canonical progression/read-review seam first (`src/components/library/PersonalHistorySection.tsx`, `src/lib/api/exercise-history.ts`).
- Program timing/readiness chrome, dashboard opportunity tiles, and intra-session load coaching are also descriptive/advisory read-side surfaces. They may summarize current context, but they must not be presented as canonical next-session progression truth unless they are explicitly rewired onto canonical progression outputs first (`src/lib/api/program.ts`, `src/lib/api/opportunity.ts`, `src/lib/progression/load-coaching.ts`).

## Internal workout-audit harness boundaries
- Canonical next-session derivation for both dashboard and audit flows is `loadNextWorkoutContext()` in `src/lib/api/next-session.ts`.
- Audit context normalization is owned by `src/lib/audit/workout-audit/context-builder.ts`, and generation dispatch is owned by `src/lib/audit/workout-audit/generation-runner.ts`.
- Audit artifact assembly/serialization is owned by `src/lib/audit/workout-audit/serializer.ts` and persists JSON artifacts to `artifacts/audits/` via `scripts/workout-audit.ts`.
- Bundled split/week sanity audit orchestration is owned by `src/lib/audit/workout-audit/bundle.ts` and persists compact summary artifacts to `artifacts/audits/split-sanity/` via `scripts/audit-split-sanity.ts`.
- Canonical recurring workout-audit modes are `historical-week`, `future-week`, `deload`, and `progression-anchor` (`src/lib/audit/workout-audit/types.ts`).
- Audit artifacts now expose an additive `canonicalSemantics` block derived from persisted/generated session snapshots. That field is the stable audit-facing summary for `phase`, `isDeload`, `countsTowardProgressionHistory`, `countsTowardPerformanceHistory`, and `updatesProgressionAnchor` (`src/lib/audit/workout-audit/canonical-semantics.ts`, `src/lib/audit/workout-audit/types.ts`).
- Legacy request aliases `next-session` and `intent-preview` normalize into `future-week` in `src/lib/audit/workout-audit/context-builder.ts`.
- Operational use of those modes belongs in `docs/09_AUDIT_PLAYBOOK.md`; direct DB-backed CLI validation belongs in `docs/08_AUDIT_CLI_DB_VALIDATION.md`.
- The compact split-sanity layer is intentionally extraction-only over canonical session receipts: it reuses live intent-preview generation, summarizes `sessionDecisionReceipt` / planner diagnostics fields, and preserves optional rich per-intent artifacts for deep debugging.
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
