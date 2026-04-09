# 02 Domain Engine

Owner: Aaron
Last reviewed: 2026-03-19
Purpose: Canonical reference for workout-generation domain logic, including selection, progression, periodization, readiness, and explainability.

This doc covers:
- Selection and session construction
- Progression/load assignment
- Periodization and readiness/autoregulation
- Explainability generation

Invariants:
- Selection and generation logic live in `src/lib/engine` and are invoked by `src/lib/api`.
- Persisted session enums must stay aligned with `docs/contracts/runtime-contracts.json`.
- Logged set data is the primary progression feedback input.
- Live workout coaching cues are non-canonical UI feedback; they must not change generator-owned next-session progression decisions.

Sources of truth:
- `trainer-app/src/lib/engine/selection-v2`
- `trainer-app/src/lib/engine/progression.ts`
- `trainer-app/src/lib/progression/load-coaching.ts`
- `trainer-app/src/lib/engine/template-session.ts`
- `trainer-app/src/lib/engine/periodization`
- `trainer-app/src/lib/engine/readiness`
- `trainer-app/src/lib/engine/explainability`
- `trainer-app/src/lib/planning/session-opportunities.ts`
- `trainer-app/src/lib/api/template-session.ts`
- `trainer-app/src/lib/api/workout-context.ts`
- `trainer-app/src/components/log-workout/useWorkoutSessionFlow.ts`

## Selection and generation
- Intent and template generation both rely on engine-level session construction and selection primitives.
- Selection-v2 beam search implementation is under `src/lib/engine/selection-v2`.
- Template session orchestration bridges API data to engine inputs in `src/lib/api/template-session.ts`, with planning semantics centralized in `src/lib/planning/session-opportunities.ts` and dedicated seams in `src/lib/api/template-session/role-budgeting.ts` and `src/lib/api/template-session/closure-actions.ts`.
- Repeated-slot planning policy is now split intentionally across the slot contract and resolver seams. `src/lib/api/mesocycle-slot-contract.ts` is the canonical authored-semantics source for accepted slot placement (`slotArchetype`, `primaryLaneContract`, `supportCoverageContract`, `continuityScope`), while `resolveSessionSlotPolicy()` in `src/lib/planning/session-slot-profile.ts` resolves that authored contract into current-session and future-slot policy for generation. Legacy repeated-slot heuristics remain only as an explicit compatibility fallback for persisted slot sequences that predate authored semantics. For repeated `upper` slots, the resolved contract enforces both `press` and `pull` lanes when viable; for repeated `lower` slots, it governs one dominant `primary` lane. The session-shape layer stays soft and additive for support work, but its required movement-pattern coverage is now honored during selection when viable instead of depending on closure-only replacement. Required coverage uses the existing compound/accessory distinction: compound matches can satisfy required slot coverage, while supportive non-compound pattern matches remain useful for scoring and support work but do not close the requirement on their own. Repeated `upper` slots must therefore keep at least one compound `horizontal_pull` each when viable, while `upper_a` still preserves complementary compound `vertical_pull` coverage and the existing duplicate/over-budget support penalties remain soft. Repeated `lower` slots keep the same primary split of `lower_a` squat-led and `lower_b` hinge-led, but `lower_b` now also requires one viable squat-pattern support contribution so the second lower slot carries meaningful quad-adjacent weekly stimulus without becoming a second squat-primary day. The same seam also exposes the intentionally minimal future-slot bias used by remaining-week planning before closure/diversification.
- The canonical advancing pre-load composition seam now lives in `composeIntentSessionFromMappedContext()` within `src/lib/api/template-session.ts`. That helper reuses the normal intent-generation stack through `buildSelectionObjective()` and `runSessionGeneration()` but intentionally stops before load assignment, receipt building, and response-only metadata so handoff slot-plan projection can reuse the same selection logic without forking it.
- Projection-driven upper/lower repair for handoff slot-plan projection must stay inside the normal session exercise-cap envelope. `projectionRepairMuscles` may rebalance exercise choice and closure outcomes toward protected coverage, but it must not unlock a larger max-exercise budget than the standard session-cap contract.
- `MANUAL` selection mode bypasses mesocycle continuity enforcement by design; continuity pinning only applies to auto/intention-generated sessions.
- Continuity sourcing for intent generation is owned by `buildSelectionObjective()` in `src/lib/api/template-session/selection-adapter.ts`: it now reads continuity scope from the resolved slot contract rather than inferring repeated-slot meaning locally. When the resolved current session is slot-scoped and has a persisted runtime `slotId`, continuity prefers the most recent performed workout for that same slot; otherwise it falls back to same-intent history. For repeated same-intent slots, current-week same-intent workouts must not become fallback continuity favorites for a later slot in that same week, and Phase 2 narrows compound continuity carryover to compounds that are still allowed by the canonical slot-policy lane contract.
- Final composition cleanup for intent generation remains in `composeIntentSessionFromMappedContext()` in `src/lib/api/template-session.ts` after selection and closure. That post-closure pass may trim redundant accessory overlap, suppress front-delt isolation already covered by pressing, cap accessory hinge stacking, and keep a conservative slot-aware directional backstop for repeated same-intent slots when doing so does not break session minimum structure. Phase 2 keeps `template-session.ts` in a closure/guardrail role only: slot-policy lane ownership is canonical upstream, core-role subordination is owned in the role-budgeting seam, and closure must not reintroduce out-of-lane compounds while viable in-lane options exist.
- For `INTENT` generation, active mesocycle roles are continuity anchors, not full workout cages. Role fixtures are budgeted first, but complete role-list sessions may still supplement from opportunity-compatible inventory when deficits or minimum composition constraints remain unresolved.
- When a mesocycle role exists, section/main-accessory mapping is role-driven:
  - `CORE_COMPOUND -> MAIN`
  - `ACCESSORY -> ACCESSORY`
  - Exercise metadata defaults are only used when no mesocycle role exists.
- Intent role-list completeness is server-owned: a role list is complete iff the current mesocycle has at least one `CORE_COMPOUND` and at least one `ACCESSORY` role for that intent; client `roleListIncomplete=false` is ignored, while `roleListIncomplete=true` can force incomplete-mode reselection.
- Role continuity set floors are lifecycle-budget constrained in accumulation weeks: continuity progression cannot exceed lifecycle weekly muscle targets or the peak-accumulation MAV cap for the configured mesocycle length unless prior-week continuity floors already exceed those caps (no mid-mesocycle reduction in that case).
- `CORE_COMPOUND` role exercises are hard-capped at `MAIN_LIFT_MAX_WORKING_SETS = 5` working sets in role-budgeting logic (`src/lib/api/template-session/role-budgeting.ts`). This cap fires after the continuity ramp, preventing main-lift working-set accumulation from exceeding prescription.
- `MANUAL` sessions are ingested into progression with confidence discounting and anomaly-aware downgrades (see MANUAL Session Contract below) rather than treated as equal-signal to `INTENT` by default.

## Session opportunity and inventory model
- `SessionOpportunityDefinition` in `src/lib/planning/session-opportunities.ts` is the canonical source for current intent/session semantics.
- Each supported session intent (`push`, `pull`, `legs`, `upper`, `lower`, `full_body`, `body_part`) defines:
  - alignment and structural character
  - current-session muscle opportunity weights
  - future-slot opportunity weights for remaining-week planning
  - inventory eligibility for `standard`, `closure`, and `rescue`
  - anchor policy for role fixtures
- This replaces the older pattern where intent alignment, muscle ownership, and future-slot opportunity lived in separate hard-coded maps across filtering and planning modules.
- `body_part` is the first intent with materially different inventory layers:
  - `standard` inventory prefers direct target-muscle matches
  - `closure` and `rescue` inventory allow controlled stimulus-based top-up candidates for the chosen target muscles

## Stimulus accounting boundaries
- Exercise taxonomy (`primaryMuscles`, `secondaryMuscles`, split/pattern metadata) remains classification/filtering input and explainability language input; it is not the canonical hypertrophy contribution math source.
- Canonical hypertrophy contribution math is the weighted `stimulusProfile` model on engine exercises (`src/lib/engine/types.ts`) and must flow through shared helpers in `src/lib/engine/stimulus.ts`:
  - `resolveStimulusProfile()`
  - `getEffectiveStimulusByMuscleId()`
  - `getEffectiveStimulusByMuscle()`
- Effective-set accounting surfaces (`effectiveActual`, planning deficits, session planning contributions, volume compliance) are expected to consume that shared stimulus helper path rather than re-deriving contribution ad hoc.
- Weekly performed-volume read models now share one canonical mesocycle-week adapter in `src/lib/api/weekly-volume.ts` (`loadMesocycleWeekMuscleVolume()`), which returns weighted `effectiveSets` plus raw `directSets`/`indirectSets` as contextual fields. Dashboard rows (`src/lib/api/program.ts`), week-close deficits (`src/lib/api/mesocycle-week-close.ts`), explainability compliance (`src/lib/api/explainability.ts`), and analytics outcome review (`src/lib/api/muscle-outcome-review.ts`) all consume that adapter.
- Outward-facing weekly-volume consumers also share one exposed muscle scope from `src/lib/engine/volume-landmarks.ts`. That exposed scope includes the broader supported muscles (`Forearms`, `Adductors`, `Abductors`, `Lower Back`) and folds internal `Abs` stimulus into external `Core` instead of emitting a separate `Abs` row.
- Transitional fallback policy for missing explicit profiles is centralized in `src/lib/engine/stimulus.ts` and coverage-checked in `src/lib/api/template-session/context-loader.ts` via `validateStimulusProfileCoverage()`.
- Strict fallback enforcement is controlled by `STRICT_STIMULUS_PROFILE_COVERAGE` in `src/lib/api/template-session/context-loader.ts`.
- Coverage reporting command is `npm run report:stimulus-coverage` (`scripts/report-stimulus-profile-coverage.ts`).

## Role and closure guardrails
- Mesocycle exercise roles are anchors for continuity and structure; role-list presence is not a session sufficiency stop condition.
- Session sufficiency remains deficit/constraint outcome-based and now has three explicit planning layers:
  - `standard` inventory for normal session construction
  - anchor supplementation from opportunity-compatible inventory when role fixtures alone are insufficient
  - `closure` inventory for same-session add/expand top-ups when material unresolved deficits remain
- Week-close optional gap-fill is the first explicit `rescue` inventory consumer. Rescue is not globally open; it is a controlled inventory phase selected by the generation path.
- Closure candidate and action diagnostics are persisted in planner diagnostics to keep ranking/filtering decisions auditable from receipts (`src/lib/planner-diagnostics/types.ts`, `src/lib/evidence/session-decision-receipt.ts`).
- Deterministic tie-breaking is required for equivalent-score closure candidates to keep audits/regressions stable (`src/lib/api/template-session/closure-actions.ts`).

## Progression and load assignment
- Progression math is implemented in `src/lib/engine/progression.ts`.
- Load assignment and fallback logic are implemented in `src/lib/engine/apply-loads.ts`.
- Exact cross-intent same-exercise fallback remains intentionally conservative in `src/lib/engine/apply-loads.ts`, but the calibration is now targeted instead of global: barbell squat-dominant lower-body lifts, dumbbell pressing, and machine lower-body compounds get a less-discounted translation/cap than the default fallback path, while rows, pulldowns, and calibrated SLDL/RDL-style hinges stay on the prior conservative policy.
- Canonical load quantization lives in `src/lib/units/load-quantization.ts`. Dumbbell display/storage flows must use that same 2.5 lb quantization rule through shared UI helpers in `src/lib/ui/load-display.ts`; UI formatting is not allowed to maintain a separate dumbbell snap policy.
- Canonical progression-input assembly is centralized in `src/lib/progression/canonical-progression-input.ts` via `buildCanonicalProgressionEvaluationInput()`. That seam assembles the materially relevant `computeDoubleProgressionDecision()` payload (`workingSetLoad`, `priorSessionCount`, `historyConfidenceScale`, and decision-log `confidenceReasons`) without owning progression math or UI formatting.
- Canonical read-side next-exposure wording is centralized separately in `src/lib/ui/next-exposure-copy.ts`. Surfaces rendering canonical `NextExposureDecision.action` outcomes should consume that formatter instead of inventing local progression-action ladders.
- The live in-session autoreg hint is implemented separately in `src/lib/progression/load-coaching.ts` and called from `src/components/log-workout/useWorkoutSessionFlow.ts`. It is a current-session coaching/explainability seam only.
- Historical training signals are mapped from persisted workouts/logs in `mapHistory()` within `src/lib/api/workout-context.ts`.
- Performed-history filtering (not completed-only filtering) is canonical for load progression and plateau/deload checks via `filterPerformedHistory()` and `isPerformedHistoryEntry()` in `src/lib/engine/history.ts`.
- Effective-reps filtering is enforced at signal derivation: sets logged below `RPE 6` are excluded from modal-load and progression anchoring (data is still persisted).
- Intermediate double-progression decision tree is enforced for load updates (hold at high fatigue; progress load only when reps/RPE thresholds are met; use conservative anchoring under high intra-session load variance).
- Earned progression also has a controlled overshoot lane in `computeDoubleProgressionDecision()` when performed load materially beats prescribed `targetLoad` across enough target-bearing sets. The engine still owns anchor selection; the normal overshoot path stays single-increment, while a bounded catch-up lane can add one extra increment only when exact same-exercise evidence is broad, stable, and still at valid RPE.
- Overshoot gating is tiered:
  - standard lane: `modalRpe <= 8.0` with the normal overshoot evidence minimum
  - controlled-hard lane: `modalRpe <= 8.5` only when overshoot coverage is stronger (`>= 75%` of target-bearing sets, minimum `3` when available) and no high-variance trim was required
  - `modalRpe > 8.5` still holds on the overshoot path
- Canonical progression inputs must therefore preserve prescribed `targetLoad` through history/context mapping (`src/lib/api/workout-context.ts`, `src/lib/session-semantics/performed-exercise-semantics.ts`, `src/lib/engine/apply-loads.ts`).
- Hypertrophy main lifts now author uniform working sets in `src/lib/engine/prescription.ts` and receive one resolved working load across those sets in `src/lib/engine/apply-loads.ts`. `computeDoubleProgressionDecision()` in `src/lib/engine/progression.ts` accepts an optional `workingSetLoad` parameter so progression, reps, and effort can describe the same representative working-set object when the caller has already resolved it.
- Progression outlier thresholds and sample-size confidence scaling are centralized in `PROGRESSION_CONFIG` (`src/lib/engine/progression.ts`) and emitted into progression decision logs.
- Bodyweight working sets are canonicalized at write-time to `actualLoad=0` when `targetLoad=0`; `null` is not treated as canonical bodyweight load.
- Scheduled deload load reduction is canonicalized in `src/lib/engine/apply-loads.ts`, not in deload generation. `src/lib/api/template-session/deload-session.ts` leaves `targetLoad` unset, and `applyLoads()` anchors deload load-down to the most recent performed accumulation load for that exercise, then applies the lighter deload prescription with the existing multiplier and canonical quantization. If no accumulation-phase history exists, it falls back to the normal canonical source-load resolver.
- Shared deload defaults are centralized in `src/lib/deload/semantics.ts`. That module is the canonical source for deload phase detection, deload target effort (`RPE 4.5` from `5-6 RIR`), hard-set reduction defaults, decision reduction percent, and progression-history exclusion policy.
- `estimateLoad()` in `src/lib/engine/apply-loads.ts` returns `undefined` (no estimate) for exercises whose equipment list includes `"bodyweight"` when no non-zero load history exists. This prevents phantom load assignments on hybrid bodyweight/machine exercises (e.g., Dip) on their first weighted use.
- Donor-based first-time load estimation must reject invalid donors before scaling. In `src/lib/engine/apply-loads.ts`, donor paths exclude non-finite / `<= 0` donor loads, and they also exclude bodyweight or bodyweight-hybrid donors when the target exercise expects external load. This is a donor-validation guardrail, not a broader estimator retune.
- Bodyweight progression is rep-driven only at `anchorLoad=0` in `computeDoubleProgressionDecision()`; the engine never auto-increments external load from `0` and logs `bodyweight exercise — rep progression only`.
- Empty performed logs are invalid (`LOGGED_EMPTY` is rejected on write); unresolved sets should remain `MISSING` and are treated as unresolved during completion status resolution.
- On first session of a new mesocycle (`accumulationSessionsCompleted=0` or explicit first-session flag), load anchoring history is sourced from accumulation history only: prefer week-4 accumulation, else highest available accumulation week, else any non-deload performed history; deload (`DELOAD`/`ACTIVE_DELOAD`) snapshots are excluded as baseline sources.
- Live cue contract: `getLoadRecommendation()` keeps the `increase | hold | decrease` action shape and evaluates only the current logged set against the next set target. Load-aware copy may use `actualLoad` and `targetLoad` for explanation, but it does not read history, rep-band progression gates, or mesocycle state and must not be treated as canonical next-exposure progression.

## Post-workout data flow
```text
SetLog / logged performance
-> workout save / status resolution
-> deriveSessionSemantics
-> session decision receipt + session semantics consumers
-> post-workout explanation layer
-> next workout generation / canonical progression
```
- `SetLog` is the raw authoritative performed-work source. Set-level facts such as reps, logged RPE, logged load, skipped state, and completion timestamps come from persisted set logs, not from explanation-layer inference.
- Workout save and status resolution are the authoritative completion/state boundary. Performed status, unresolved-set handling, and lifecycle mutation are owned there, not by read-side explanation (`src/app/api/workouts/save/route.ts`, `src/app/api/workouts/save/status-machine.ts`).
- Save-route success payloads now include canonical `workoutStatus`. `mark_completed` remains a requested terminal intent, but the persisted `workoutStatus` returned by save is the authoritative completion truth that clients must render against.
- `deriveSessionSemantics()` is the canonical session-level interpretation bridge. It owns session-level meaning derived from persisted workout fields, including advancing/non-advancing interpretation, weekly-slot consumption, and progression-history eligibility.
- `deriveSessionSemantics()` does not own set-level progression computations such as modal load, anchor load, rep summaries, or effort-classification math. Those remain in canonical progression/history/explainability seams such as `src/lib/engine/progression.ts`, `src/lib/engine/history.ts`, and `src/lib/api/explainability.ts`.
- `selectionMetadata.sessionDecisionReceipt` is the canonical stored generation/evidence context. Read-side consumers should combine that receipt with derived session semantics rather than recreating missing session policy locally.
- `selectionMetadata.workoutStructureState` is the canonical persisted mutation-reconciliation context. It stores the current saved structure summary plus generated-vs-saved reconciliation, and mutation writers own keeping it current.
- Original generation receipt truth and current saved-structure truth are intentionally distinct. Mutation reconciliation must not overwrite `sessionDecisionReceipt` to mimic the mutated workout.
- Post-workout explanation is a read-side interpretation surface. It may explain canonical behavior, but it should not redefine the behavior that generator/progression seams will use for the next exposure.
- Canonical next-exposure progression remains server-side in `src/lib/engine/apply-loads.ts` and `src/lib/engine/progression.ts`.

## Rep target interpretation
- Canonical read-side rep-target interpretation lives in `src/lib/session-semantics/target-evaluation.ts`.
- `resolveTargetRepRange()` is range-first by contract:
  - prefer `targetRepRange`
  - else fall back to `targetRepMin` + `targetRepMax`
  - else fall back to point target `targetReps`
- `evaluateTargetReps()` is the shared read-side helper for comparing actual reps against the effective target. Read-side review/explainability surfaces should not re-derive range vs point-target semantics locally.

## Set-state classification
- Canonical read-side set-state interpretation lives in `classifySetLog()` in `src/lib/session-semantics/set-classification.ts`.
- The helper exists to prevent read-side drift around skipped, performed, resolved, and signal-bearing sets.
- Canonical meanings:
  - `isSkipped`: the set was explicitly skipped.
  - `isResolved`: the set is no longer missing; it is either skipped or has any actual logged field.
  - `isPerformed`: the set was actually performed and has meaningful performance evidence (`actualReps` or `actualRpe`) rather than just load-only metadata.
  - `isSignal`: the performed set is eligible as progression signal under the configured RPE floor.
  - `countsTowardVolume`: the set contributes to performed-volume accounting; today this is aligned with `isPerformed`.
- Read-side consumers that need set interpretation should prefer `classifySetLog()` instead of open-coding skip/performed/resolved predicates.

## Periodization and readiness
- Macro/meso/block logic lives in `src/lib/engine/periodization`.
- Readiness, fatigue scoring, and autoregulation logic lives in `src/lib/engine/readiness`.
- API orchestration for readiness and periodization endpoints lives in `src/lib/api/readiness.ts` and `src/lib/api/periodization.ts`.
- Generation-facing phase/block resolution now lives in `src/lib/api/generation-phase-block-context.ts` and is loaded by `src/lib/api/template-session/context-loader.ts`. This is the canonical seam where persisted block definitions become generation/runtime `cycleContext`, including optional `blockDurationWeeks` for receipt-backed read-side consumers.
- Session-decision ownership is receipt-first. The canonical flow is defined once in `docs/01_ARCHITECTURE.md`; domain logic here assumes session-level cycle/readiness context is carried only by `selectionMetadata.sessionDecisionReceipt` and parsed by `src/lib/evidence/session-decision-receipt.ts`.
- Mutation truth alignment is persisted-first, not heuristic-first. Read-side summary/explainability surfaces should use `selectionMetadata.workoutStructureState` when deciding whether generated receipt context is still current or must be labeled as original-plan context.
- Default readiness autoregulation policy is conservative down-regulation only (`allowUpRegulation=false`) unless explicitly overridden by policy input (`src/lib/engine/readiness/types.ts`, `src/lib/engine/readiness/autoregulate.ts`).

## Evidence and rule guardrails
- Reactive deload logic in `shouldDeload()` is evidence-gated and requires stronger signals (sustained low-readiness streak or repeated main-lift plateau evidence) rather than flat total-session-rep plateaus alone (`src/lib/engine/progression.ts`, `src/lib/engine/progression.correctness.test.ts`).
- Intent alignment enforcement is diagnostics-first by default (`minRatio=0` unless explicitly requested), with explicit intent diagnostics returned on selection output (`src/lib/api/template-session/intent-filters.ts`).
- Post-hoc optimizer stretch swapping is removed; final selection remains optimizer-owned (`src/lib/engine/selection-v2/optimizer.evidence.test.ts`).

## Workout status semantics
- The split exists to separate adaptation signals from advancement control: partially performed work should inform future load/selection, while schedule/phase advancement remains a stricter completion event.
- Performed-signal consumers use `COMPLETED` + `PARTIAL` via `PERFORMED_WORKOUT_STATUSES` in `src/lib/workout-status.ts`.
- Program advancement remains `COMPLETED` only via `ADVANCEMENT_WORKOUT_STATUSES` in `src/lib/workout-status.ts`.
- Mesocycle lifecycle progression is driven by first transition into performed status (`COMPLETED` or `PARTIAL`). Lifecycle counters (`accumulationSessionsCompleted`, `deloadSessionsCompleted`) are incremented atomically inside the save-workout transaction in `src/app/api/workouts/save/route.ts`; status/action resolution is isolated in `src/app/api/workouts/save/status-machine.ts`; `transitionMesocycleState()` in the lifecycle facade (`src/lib/api/mesocycle-lifecycle.ts`) applies state transitions when thresholds are reached.
- Canonical mesocycle progression counters are `accumulationSessionsCompleted` and `deloadSessionsCompleted` (not `completedSessions`) and drive lifecycle week/phase derivation.

## Session semantics model
- Session semantics are split intentionally between write-side lifecycle contract and read-side interpretation.
- Write-side lifecycle contract remains `Workout.advancesSplit`. Save/lifecycle mutation code should continue treating `advancesSplit !== false` as the only advancement gate (`src/app/api/workouts/save/lifecycle-contract.ts`, `src/app/api/workouts/save/route.ts`).
- Structural mutation writers are also responsible for canonical reconciliation bookkeeping: when the saved workout structure changes, they must update `selectionMetadata.workoutStructureState` and bump `Workout.revision`.
- Read-side policy is now centralized in `deriveSessionSemantics()` (`src/lib/session-semantics/derive-session-semantics.ts`). Readers should derive behavior from persisted fields rather than re-authoring ad hoc checks across progression, next-session, and planning paths.
- Current derived kinds are `advancing`, `gap_fill`, `supplemental`, and `non_advancing_generic`.
- The helper derives those semantics from existing persisted/runtime fields: `advancesSplit`, `selectionMode`, `sessionIntent`, `selectionMetadata`, and optional `templateId`.
- Current read-side policies centralized there are:
  - lifecycle-advancement interpretation for compatibility reads (`advancesLifecycle`)
  - weekly required-slot consumption (`consumesWeeklyScheduleIntent`)
  - progression anchor / progression explainability eligibility (`countsTowardProgressionHistory`)
  - canonical performance-history eligibility (`countsTowardPerformanceHistory`)
  - progression-anchor update eligibility (`updatesProgressionAnchor`)
  - unique-intent subtraction eligibility for remaining-week and next-session reads (`eligibleForUniqueIntentSubtraction`)
- Current derived policy intentionally preserves existing behavior:
  - strict supplemental sessions are non-advancing and progression-ineligible
  - strict gap-fill sessions are non-advancing but progression-eligible
  - scheduled deload sessions still count for compliance, recovery/recent stimulus, and weekly volume, but they are excluded from progression history, progression anchors, and canonical performance-history reads
  - generic non-advancing sessions remain progression-eligible unless a stricter classifier excludes them
  - `null` / `undefined` `advancesSplit` still default to advancing for backward compatibility
- A persisted `sessionKind` enum was intentionally not added. The current system still has more semantic cases than a stable enum captures, including non-advancing but progression-eligible sessions. Adding an enum now would freeze an incomplete taxonomy into schema and migration contracts before runtime policy has settled.

## Explainability guardrails
- Explainability/read-side layers should consume derived session semantics or canonical decision outputs. They should not independently recompute progression-relevant session meaning unless there is a strong reason and the new seam is documented as canonical first.
- Common drift risk: read-side explanation can accidentally describe prior prescription logic or inferred progression in a way that does not match canonical next-exposure behavior.
- Guardrail: when explanation needs to talk about session-level behavior, it should prefer:
  - persisted `SetLog` performance data for raw facts
  - save/status outputs for performed-state truth
  - `deriveSessionSemantics()` for session-level interpretation
  - canonical progression outputs/decision logs for next-exposure load behavior
- When explanation needs to phrase canonical next-exposure action, it should route that wording through `src/lib/ui/next-exposure-copy.ts`. Heuristic or advisory surfaces must not invent stronger progression wording for the same decision shape.
- Avoid local fallbacks that reinterpret session policy inside explainability copy or UI helpers. If a new explanation concept truly requires new canonical semantics, add that seam first rather than encoding it only in read-side copy.
- Future seam rule: if the app ever needs a new canonical set-level post-workout interpretation layer, document and introduce it as a seam separate from `deriveSessionSemantics()`. Do not silently expand `deriveSessionSemantics()` from session-level policy into set-level progression math ownership.

## Optional session policy
- Optional sessions reuse canonical INTENT generation (`intent=body_part`) and do not introduce a separate optimizer path (`src/lib/api/template-session.ts`).
- Pending week-close context is canonical for gap-fill week anchoring. `generateSessionFromIntent()` now passes `optionalGapFillContext.targetWeek` into `loadMappedGenerationContext()` so generation resolves the anchored `weekInMeso` from the pending week-close row, then derives block-relative `weekInBlock` from the active `TrainingBlock` when available (`src/lib/api/template-session.ts`, `src/lib/api/template-session/context-loader.ts`, `src/lib/api/generation-phase-block-context.ts`).
- Optional gap-fill now uses the explicit `rescue` inventory layer from `SessionOpportunityDefinition`. This is the current bridge between week-close deficit snapshots and controlled rescue access without rewriting the planner into a long-horizon system.
- Week-close truth is dual-state rather than single-resolution: `workflowState` says whether the optional gap-fill workflow is still pending, and `deficitState` says whether the weekly deficit is `OPEN`, `PARTIAL`, or `CLOSED`. Optional gap-fill completion can therefore leave `workflowState=COMPLETED` while `deficitState=PARTIAL`.
- Supplemental deficit sessions reuse the same BODY_PART INTENT generation route, but they are user-invoked rather than week-close-driven. The allowed UI path is `IntentWorkoutCard -> POST /api/workouts/generate-from-intent -> POST /api/workouts/save`, with backend-owned receipt stamping (`src/components/IntentWorkoutCard.tsx`, `src/app/api/workouts/generate-from-intent/route.ts`).
- Gap-fill policy read model is surfaced by `loadHomeProgramSupport()` (`src/lib/api/program.ts`) with fields:
  - `requiredSessionsPerWeek`
  - `maxOptionalGapFillSessionsPerWeek`
  - `maxGeneratedHardSets`
  - `maxGeneratedExercises`
- Current default policy: required sessions = active mesocycle `sessionsPerWeek` (min 1), max optional sessions/week = 1, max hard sets = 12, max exercises = 4.
- Override precedence is policy-first and split-agnostic: policy values are resolved centrally in `program.ts`; generation/save do not fork by split type.
- Strict classification for optional sessions uses the shared triplet predicate in `src/lib/gap-fill/classifier.ts`.
- Strict classification for supplemental deficit sessions uses the shared triplet predicate in `src/lib/session-semantics/supplemental-classifier.ts`.
- Read-side interpretation for those strict classifiers is centralized in `deriveSessionSemantics()` rather than scattered boolean checks in each consumer.
- Canonical optional-session receipt/metadata stamping is shared in `src/lib/ui/selection-metadata.ts`; generation and UI callers attach `weekCloseId`, `targetMuscles`, and the `optional_gap_fill` exception through `attachOptionalGapFillMetadata()` instead of duplicating route/component-local mutation logic.
- Canonical supplemental receipt/metadata stamping is also shared in `src/lib/ui/selection-metadata.ts`; generation attaches `targetMuscles` and the `supplemental_deficit_session` exception through `attachSupplementalSessionMetadata()`, and the client persists the returned canonical metadata unchanged.
- Canonical closeout receipt/metadata stamping is shared in `src/lib/ui/selection-metadata.ts`; closeout writers attach `weekCloseId` and the `closeout_session` exception through `attachCloseoutSessionMetadata()`, which also strips any receipt `sessionSlot` so closeout sessions stay outside canonical slot identity.
- Supplemental deficit sessions count toward weekly volume and recovery/recent stimulus, but they are excluded from progression anchors and progression explainability evidence through the derived session-semantics policy (`src/lib/session-semantics/derive-session-semantics.ts`, `src/lib/api/workout-context.ts`, `src/lib/progression/progression-eligibility.ts`, `src/lib/api/explainability.ts`).
- Supplemental deficit sessions are non-advancing by contract: save forces `advancesSplit=false` for strict supplemental classification and blocks split advancement even if the incoming payload requests otherwise (`src/app/api/workouts/save/route.ts`).
- Closeout sessions are also receipt-first and non-advancing by contract: `deriveSessionSemantics()` classifies the `closeout_session` marker as weekly-volume-valid but excluded from progression and performance-history anchoring, and save strips both legacy/top-level and receipt slot identity plus forces `advancesSplit=false` even if the incoming payload requests otherwise (`src/lib/session-semantics/closeout-classifier.ts`, `src/lib/session-semantics/derive-session-semantics.ts`, `src/app/api/workouts/save/route.ts`).

## Supplemental Deficit Sessions
- Purpose: add a small targeted stimulus patch mid-mesocycle without mutating split advancement or corrupting progression-anchor history.
- User intent: the user invokes a `BODY_PART` intent session to patch a weekly deficit, add weak-point work, or add extra recoverable stimulus outside the advancing split schedule.
- Strict classification rules:
  - `selectionMode=INTENT`
  - `sessionIntent=BODY_PART`
  - receipt exception marker `supplemental_deficit_session`
  - persisted `advancesSplit=false`
- Lifecycle semantics:
  - counts toward weekly volume
  - counts toward recovery and recent-stimulus accounting
  - does not advance split lifecycle
  - does not consume a required weekly schedule slot
- Progression isolation:
  - the session remains part of performed history for volume/recovery/readiness consumers
  - the session is excluded from progression history and explainability progression evidence through `isProgressionEligibleWorkout()` and `filterProgressionHistory()`
  - performed history and progression history are intentionally different views over the same persisted workouts
- Generation profile:
  - generation still uses the normal BODY_PART planner pipeline, but route orchestration enables `supplementalPlannerProfile`
  - single-target supplemental sessions narrow to `1-3` exercises
  - multi-target supplemental sessions narrow to `2-4` exercises
  - route defaults clamp uncapped requests to `maxGeneratedExercises=4` and `maxGeneratedHardSets=8`
  - selection prefers target-primary, non-main-lift, lower-fatigue exercises
  - fallback reopens the broader BODY_PART pool only when the accessory-first preferred pool cannot cover the requested targets or cannot satisfy the supplemental minimum session floor
  - continuity carryover and continuity minimum set floors are disabled for this profile
  - multi-target sessions apply a soft per-target floor so each requested target gets one primary-target coverage slot when feasible
  - main-lift slotting is suppressed by default (`maxMainLifts=0`)
  - deficit-aware supplemental set caps narrow the dose:
    - remaining deficit `<= 1.5` -> `1` set
    - remaining deficit `<= 3.5` -> `2` sets
    - remaining deficit `> 3.5` -> `3` sets
  - main-lift-typed fallback work remains capped below normal BODY_PART prescription even when fallback is necessary

## Gap-fill decision order
1. Compute anchor gate from lifecycle boundary: active accumulation + `accumulationSessionsCompleted % requiredSessionsPerWeek === 0`.
2. Apply next-week suppression: `PLANNED` does not suppress; `IN_PROGRESS`/`PARTIAL` suppress.
3. Enforce weekly optional cap using strict classification (`optional_gap_fill` + `INTENT` + `BODY_PART`) when counting is enabled; missing marker never counts as gap-fill.
4. Resolve deficits and target muscles for the pending week-close `targetWeek` only.
5. Fail closed when canonical week-bounded data is insufficient.

## Mesocycle lifecycle service
- Facade: `src/lib/api/mesocycle-lifecycle.ts`.
- Math module: `src/lib/api/mesocycle-lifecycle-math.ts` (week derivation, RIR targets, lifecycle volume targets).
- State module: `src/lib/api/mesocycle-lifecycle-state.ts` (state transitions + next-mesocycle initialization).
- `transitionMesocycleState(mesocycleId)`: transitions state (`ACTIVE_ACCUMULATION` -> `ACTIVE_DELOAD` -> `AWAITING_HANDOFF`) and freezes handoff artifacts when deload is complete. It no longer creates the successor mesocycle automatically.
- `getCurrentMesoWeek(mesocycle)`: derives effective lifecycle week from `state`, `durationWeeks`, `accumulationSessionsCompleted`, and `sessionsPerWeek`. Accumulation weeks are `durationWeeks - 1`; the final week is deload.
- `getWeeklyVolumeTarget(mesocycle, muscleGroup, week, options?)`: returns lifecycle week-specific target sets from landmarks plus the canonical weekly target profile. Landmark values (MEV/MAV/MRV) are sourced from `VOLUME_LANDMARKS` in `src/lib/engine/volume-landmarks.ts`. The default canonical block-aware path is `mesocycle.blocks` when ordered block coverage is present; `options.blockContext` remains the higher-precedence seam for generation when week anchoring or forced context must override the raw mesocycle row. When block data is unavailable or incomplete, it falls back to duration-only lifecycle interpolation.
- Analytics outcome review for the active mesocycle week is a read-only comparison layer built from `getWeeklyVolumeTarget(...)` + `loadMesocycleWeekMuscleVolume(...)`. It does not own alternate stimulus math or alternate target interpolation (`src/lib/api/muscle-outcome-review.ts`).
- Weekly target placement is centralized in `src/lib/engine/volume-targets.ts` via `buildWeeklyVolumeTargetProfile()` + `interpolateWeeklyVolumeTarget()`. Default 4/5-week behavior is preserved under the default block layouts, but non-default block types can now materially shape target placement:
  - `accumulation`: rising weekly targets toward peak productive volume
  - `intensification`: continued but moderated rise/plateau based on block config
  - `realization`: intentional reduction from prior peak volume while intensity rises
  - `deload`: explicit recovery-oriented reduction from peak accumulation weekly volume target; the scheduled deload session transform separately keeps exercises/reps stable, cuts hard sets roughly in half, and lets the canonical load engine apply the lighter load prescription
- Realization reduction is explicit policy in `src/lib/engine/volume-targets.ts`, not a hidden post-hoc override. The current taper step is `-0.5` base realization reduction plus `volumeTarget` and `intensityBias` weights; for the default low-volume, strength-biased realization week that yields a `-1.15` progress step and therefore a `0.6167` week fraction relative to the prior productive peak.
- When phase/block context is supplied, lifecycle prescription helpers now consume real block type and block-relative week:
  - `getRirTarget(..., phaseBlockContext?)`
  - `getLifecycleSetTargets(..., phaseBlockContext?)`
  - `buildLifecyclePeriodization({ ..., phaseBlockContext })`
  This preserves current default 4/5/6-week behavior under the existing default block definitions while making generation materially block-aware.
- Handoff semantics are now explicit and split across dedicated seams:
  - `enterMesocycleHandoffInTransaction()` freezes `handoffSummaryJson` and seeds editable `nextSeedDraftJson`
  - `loadMesocycleReview()` reads frozen handoff facts plus live derived closeout metrics
  - `loadMesocycleSetupFromPrisma()` reads the mutable setup draft against the frozen recommendation
  - `acceptMesocycleHandoffInTransaction()` is the only canonical path that creates the successor mesocycle
- Mesocycle genesis recommendation ownership remains in `src/lib/api/mesocycle-genesis-policy.ts`, but live evidence normalization now happens once in `enterMesocycleHandoffInTransaction()` through a single `GenesisPolicyContext`. That context carries policy-relevant source profile, constraints, normalized split/frequency preferences, source slot topology, mesocycle closeout/adherence evidence, latest readiness, and receipt-backed carry-forward candidate evidence rather than raw Prisma rows.
- Phase 1 genesis explainability is branch-accurate by contract:
  - structure recommendation reason codes now reflect the actual preferred-vs-default branch that fired
  - preferred split/frequency signals from current handoff constraints are honored when present and still capped by hard availability constraints
  - when current handoff constraints provide an explicit compatible `weeklySchedule`, genesis uses that authored order for the recommended ordered-flexible slot sequence and records `explicit_weekly_schedule_order_honored`
  - carry-forward branch outputs now persist `reasonCodes` plus `signalQuality`, where `high` is reserved for concrete evidence-driven branches and `medium` marks fallback/default behavior
  - accessory continuity keeps are intentionally capped by authored slot capacity during genesis recommendation so seed drafts and slot-plan projection do not preserve every eligible accessory by default; overflow accessories rotate with `accessory_rotation_slot_capacity_cap`
- Acceptance semantics are transactionally strict:
  - sanitize the draft against the frozen recommendation envelope
  - reject `keep` carry-forward selections whose original `sessionIntent` no longer exists after split/session edits
  - create the successor mesocycle with reset lifecycle counters
  - persist canonical `slotSequenceJson` from the accepted ordered-flexible slot sequence
  - persist `slotPlanSeedJson` from the shared raw handoff slot-plan projection when that projection succeeds
  - carry forward only `keep` selections
  - update `Constraints.daysPerWeek`, `splitType`, and `weeklySchedule`
  - mark the source mesocycle `COMPLETED`
- `slotSequenceJson` is now the canonical runtime session-order contract for accepted mesocycles. Runtime sequencing, remaining-week planning, UI labeling, and explainability should prefer `slotId + intent`; `weeklySchedule` subtraction remains compatibility-only for legacy mesocycles without persisted slot identity.
- `slotPlanSeedJson` is now the canonical runtime composition source for seeded mesocycles. `generateSessionFromMappedContext()` and `generateDeloadSessionFromIntentContext()` resolve the current slot from persisted runtime slot sequencing, then compose only from `slotPlanSeedJson` for seeded supported intents; legacy intent/role reselection remains fallback-only for unseeded mesocycles and unsupported paths such as `body_part`.
- Block-aware prescription semantics are now authored in one shared seam: `src/lib/engine/periodization/block-prescription-intent.ts`.
  - Inputs: `blockType`, `weekInBlock`, `blockDurationWeeks`, `isDeload`
  - Outputs: canonical `rirTarget`, `setTargets`, `setMultiplier`, plus compatibility `modifiers`
  - Lifecycle math consumes that seam for `getRirTarget(...)`, `getLifecycleSetTargets(...)`, and `buildLifecyclePeriodization(...)`
  - Legacy bridge code in `src/lib/engine/periodization/block-config.ts` now reads the same intent instead of re-authoring separate block RIR/intensity/rest policy
- Weekly volume targeting now uses the same canonical seam across generation and read models. `src/lib/api/template-session/context-loader.ts` resolves `phaseBlockContext`, then materializes `lifecycleVolumeTargets` through `getWeeklyVolumeTarget(..., { blockContext })` before remaining-week planning, selection, closure, and rescue. Read-side consumers such as dashboard rows, muscle-outcome review, week-close deficits, and explainability compliance route through that same helper using `mesocycle.blocks` directly.
- Current landmark table includes the weighted-model Biceps retune in `src/lib/engine/volume-landmarks.ts` (`Biceps: MV 6, MEV 6, MAV 14, MRV 22, SRA 36`) and is consumed unchanged by planner targeting, dashboard rows, week-close deficits, and explainability compliance.
- Pull musculature landmarks are split (`lats`, `upper_back`) and rear-delt landmarks are reduced to evidence-aligned defaults (`rear_delts: MEV 4, MAV 12`; `lats: MEV 8, MAV 16`; `upper_back: MEV 6, MAV 14`).
- `getRirTarget(mesocycle, week, phaseBlockContext?)`: returns lifecycle week/state-specific RIR bands, including deload targets. Without block context, default hypertrophy bands remain duration-aware: 4-week total = `3-4 -> 2-3 -> 1-2 -> deload`; 5-week total = `3-4 -> 2-3 -> 1-2 -> 0-1 -> deload`; 6-week total = `3-4 -> 2-3 -> 2 -> 1-2 -> 0-1 -> deload`.
- Prescription ownership is therefore split intentionally, not accidentally:
  - Weekly volume target shape remains owned by `src/lib/engine/volume-targets.ts`
  - Weekly effort/set intent remains owned by `src/lib/engine/periodization/block-prescription-intent.ts`
  - Generator/prescription consumers should read those seams, not reinterpret block policy locally
- Direct next-mesocycle initialization is intentionally fenced behind the explicit handoff contract. Callers must not bypass acceptance by creating successors directly from lifecycle state helpers.

## Deload generation path
- Deload generation has a separate pipeline in `src/lib/api/template-session/deload-session.ts`.
- Route hard gate:
  - `POST /api/workouts/generate-from-intent` (`src/app/api/workouts/generate-from-intent/route.ts`) routes to `generateDeloadSessionFromIntent()` when active mesocycle state is `ACTIVE_DELOAD`.
  - `POST /api/workouts/generate-from-template` (`src/app/api/workouts/generate-from-template/route.ts`) routes to `generateDeloadSessionFromTemplate()` when active mesocycle state is `ACTIVE_DELOAD`.
- During `ACTIVE_DELOAD`, normal accumulation generation paths are unreachable from these routes.
- Canonical scheduled deload contract:
  - for seeded mesocycles, take the exercise list from persisted `slotPlanSeedJson`; for unseeded mesocycles, keep the existing accumulation-history continuity fallback
  - reduce hard sets roughly 50% with floor safeguards (`1 -> 1`, `2 -> 1`, `3-4 -> 2`, `5-6 -> 3`)
  - keep reps stable for movement continuity
  - leave `targetLoad` unset in generation, then let `src/lib/engine/apply-loads.ts` apply the canonical lighter deload load
  - target low-fatigue effort through canonical deload targeting (`5-6 RIR`, approximately `RPE 4.5`)
  - user-facing receipts/explanations should describe lighter loads plus reduced volume for recovery, not promise a fixed percentage reduction
  - deload does not count toward progression history and does not reset progress; next block re-anchors from accumulation work rather than deload performance
  - count toward compliance, recent stimulus, and weekly volume, while remaining excluded from progression anchors and canonical performance-history reads

## Explainability
- Explainability domain modules are in `src/lib/engine/explainability`.
- API explainability facade is `src/lib/api/explainability.ts`, split into `src/lib/api/explainability/query.ts` (read/query) and `src/lib/api/explainability/assembly.ts` (response assembly/scoring).
- Explanation endpoint is `src/app/api/workouts/[id]/explanation/route.ts`.
- Explainability seam ownership is intentionally split:
  - `query.ts`: persisted workout/history/evidence loading
  - `assembly.ts`: response assembly, confidence framing, and presentation-ready summarization
  - `deriveSessionSemantics()`: canonical session-level interpretation for read-side consumers
  - `src/lib/engine/history.ts` + `src/lib/engine/progression.ts`: canonical set-level progression and anchoring behavior
  - `selectionMetadata.sessionDecisionReceipt`: stored generation/evidence context
- `src/lib/api/explainability.ts` should remain a facade over those seams. It should not become an alternate owner of session semantics or next-exposure progression policy.
- Workout explanations include per-exercise progression receipts (`WorkoutExplanation.progressionReceipts` in `src/lib/engine/explainability/types.ts`), derived from performed history and current prescription in `src/lib/api/explainability.ts`.
- Workout explanations also expose per-exercise `nextExposureDecisions` as a read model. These must consume performed semantics from `src/lib/session-semantics/performed-exercise-semantics.ts` and route canonical decision-input assembly through `buildCanonicalProgressionEvaluationInput()` before calling `computeDoubleProgressionDecision()`, so post-workout interpretation cannot drift from the next canonical load decision.
- Session context now includes cycle provenance and readiness availability labels (`SessionContext.cycleSource`, `ReadinessStatus.availability`, `ReadinessStatus.label`) in `src/lib/engine/explainability/types.ts`, produced in `src/lib/engine/explainability/session-context.ts`.
- Explainability is strictly receipt-first: it reads session-level cycle/readiness context only from `selectionMetadata.sessionDecisionReceipt`, and missing canonical receipt means missing session-level evidence (`src/lib/evidence/session-decision-receipt.ts`, `src/lib/api/explainability.ts`, `src/lib/ui/explainability.ts`). When canonical receipt cycle context includes `weekInBlock` and `blockDurationWeeks`, read-side summary/explainability copy should prefer block-relative semantics over mesocycle-relative wording.
- Progression receipts only use recent performed evidence (42-day recency window) when loading `lastPerformed` in `loadLatestPerformedSetSummary()` within `src/lib/api/explainability.ts`.
- Progression receipts include a decision log summarizing which load-progression rule path fired and why.
- Overshoot-based receipts must surface whether `path_5_overshoot` earned the increase or why it was blocked (`effort`, `coverage`, or `variance`) so read-side explanation stays aligned with canonical progression.
- Explainability renders per-exercise progression decision logs in the Evidence tab under `Progression Logic` when logs are available.
- Workout explanations include per-muscle weekly volume compliance (`WorkoutExplanation.volumeCompliance` in `src/lib/engine/explainability/types.ts`), computed by `computeVolumeCompliance()` in `src/lib/api/explainability.ts`. Per-muscle compliance is annotated with `VolumeComplianceStatus` — one of `OVER_MAV | AT_MAV | APPROACHING_MAV | OVER_TARGET | ON_TARGET | APPROACHING_TARGET | UNDER_MEV` — and carries projected weekly totals against week-specific targets.

## Session Composition Constraints
- Canonical session composition caps:
  - `minExercises=3`
  - `maxExercises=6`
  - `maxDirectSetsPerMuscle=12`
- These caps are represented by `SESSION_CAPS` in `src/lib/api/template-session/selection-adapter.ts` and must remain aligned with selection-v2 enforcement comments/rules.

## MANUAL Session Contract
- MANUAL bypasses:
  - Mesocycle role continuity enforcement
  - Lifecycle RIR band prescription
  - Intent/beam exercise-selection logic
- MANUAL still enforces:
  - Lifecycle counter advancement when workout enters performed status
  - Performed-history inclusion for progression (with confidence scaling/discounting)
  - Set-log persistence and audit trail semantics
- MANUAL anomaly handling during progression-context ingestion:
  - Uniform-RPE sessions (`variance=0`) flagged as synthetic
  - Modal load below 50% of most recent INTENT modal load for same exercise flagged as implausible regression
  - `RPE=10` on >50% of sets flagged as unsustainable effort
  - Anomalous MANUAL entries remain included but are downgraded to confidence `0.3`
