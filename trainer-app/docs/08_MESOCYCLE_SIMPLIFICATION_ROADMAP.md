# 08 Mesocycle Simplification Roadmap

Owner: Aaron
Last reviewed: 2026-03-04
Purpose: Completion log for the mesocycle/session-decision simplification pass.

This doc covers:
- What Phases 1-7 changed
- What canonical architecture remains in place
- What compatibility guardrails intentionally remain

Sources of truth:
- `trainer-app/src/lib/evidence/types.ts`
- `trainer-app/src/lib/evidence/session-decision-receipt.ts`
- `trainer-app/src/lib/api/template-session.ts`
- `trainer-app/src/lib/api/template-session/finalize-session.ts`
- `trainer-app/src/app/api/workouts/save/route.ts`
- `trainer-app/src/lib/api/explainability.ts`
- `trainer-app/src/lib/ui/selection-metadata.ts`
- `trainer-app/src/lib/ui/explainability.ts`
- `trainer-app/src/lib/validation.ts`

## Audit summary

Phases 1-7 are closed. Runtime session-decision ownership is receipt-first, stale compatibility reads are gone, and the remaining compatibility handling is limited to explicit save validation guardrails plus DB-boundary receipt parsing.

Implemented now:
- Canonical persisted session decision shape exists as `selectionMetadata.sessionDecisionReceipt`.
- Generation/finalization writes the receipt (`src/lib/api/template-session.ts`, `src/lib/api/template-session/finalize-session.ts`).
- Save preserves and normalizes the canonical receipt, and rejects writes that omit it (`src/app/api/workouts/save/route.ts`).
- Explainability reads session-level context from the receipt rather than legacy mirrors (`src/lib/api/explainability.ts`, `src/lib/ui/explainability.ts`).
- Workout detail and log pages read the receipt (`src/app/workout/[id]/page.tsx`, `src/app/log/[id]/page.tsx`).
- Save validation rejects legacy top-level session mirrors inside `selectionMetadata` (`src/lib/validation.ts`).
- Save-time receipt normalization is now receipt-only; top-level readiness compatibility payloads are no longer accepted on the main save route, and save writes without a canonical receipt are rejected.
- UI/explainability runtime reads are receipt-only; they do not read `autoregulationLog`.
- Current app save paths do not send compatibility-only `wasAutoregulated` / `autoregulationLog` fields.
- Save no longer persists compatibility-only workout autoregulation mirrors as active state.

Not a Phase 1 blocker anymore:
- Explainability is already receipt-first.
- UI receipt consumption is already wired.
- Generation/finalization already produces the canonical decision object.
- Compatibility-only save inputs are rejected on the main save route rather than synthesized into active receipt state.

Phase 3 follow-up:
- Re-audit found one remaining regression in the extracted completion owner: `mark_partial` incorrectly drove the client into completed-session UI.
- The completion hook now keeps partial saves in the active logging state, matching the footer contract that "Leave for now" preserves a resumable session.
- Focused tests now cover partial-save behavior at the completion-hook, session-flow, and `LogWorkoutClient` boundaries.
- Phase 5 is no longer blocked by Phase 3 logging-flow ownership/runtime behavior.

## Revised roadmap

### Phase 1 - Canonical Decision Model
Status: COMPLETE

Goal:
- Keep one canonical session decision receipt and make all remaining non-receipt session decision fields explicitly compatibility-only.

Completed focus:
- Removed save-time receipt synthesis from the main save route so canonical receipt metadata must already exist on write.
- Removed `wasAutoregulated` / `autoregulationLog` from the active save contract and kept receipt readiness as the only supported session-decision write shape.
- Tightened runtime reads so new code paths prefer `sessionDecisionReceipt` and do not imply multiple active session-decision sources.
- Tightened save semantics so performed and plan writes without canonical `selectionMetadata.sessionDecisionReceipt` are rejected instead of rebuilt from DB/fallback context.

Exit criteria:
- Canonical receipt remains the only active session-decision source read by explainability/UI/runtime consumers.
- Compatibility reads are either removed or isolated to one narrow normalization layer.
- Runtime types make receipt-first behavior obvious.

### Phase 2 - User-Facing Session Clarity
Status: COMPLETE

Goal:
- Make "why today looks like this" obvious without exposing overlapping engine jargon.

Focus:
- Simplify session header and summary copy.
- Present today goal, target effort, deload context, soreness-held volume, and readiness scaling through one explanation path.
- Remove duplicated explanation surfaces between workout detail, log, and explainability views.

Implemented in this pass:
- Added a shared receipt-first session summary model for workout detail and log surfaces.
- Replaced the log-page cycle/RIR/deload strip with the same user-facing summary used on workout detail.
- Simplified the default explainability card to one summary path and moved richer evidence into a secondary disclosure.
- Reduced duplicated "why" copy on workout exercise cards so session context is explained once at the session level.
- Removed the full explainability panel from the default workout user flow.
- Moved detailed explainability to a dedicated internal audit route (`/workout/[id]/audit`) instead of a user-facing summary surface.

Exit criteria met:
- Workout detail and log pages now share one receipt-first user-facing session summary path.
- Default user surfaces no longer expose the richer explainability/audit UI.
- Detailed explanation remains available for backend auditing without competing with the core training flow.

### Phase 3 - Workout Logging Flow Simplification
Status: COMPLETE

Goal:
- Reduce friction and fragmented state in `LogWorkoutClient` and related logging flows.

Focus:
- Simplify draft state, active set handling, rest timer ownership, footer/save behavior, and recovery behavior.
- Keep progression cues minimal and actionable during training.

Implemented in this pass:
- Collapsed active-set draft buffering to one shared per-set draft map instead of separate reps/load/RPE buffer stores.
- Simplified logged-set chip editing to one active draft object instead of parallel per-set edit buffers.
- Removed duplicate in-panel partial-save action so session-level save/recovery decisions live in the footer only.
- Reduced live-training progression noise by removing baseline qualification badges from the in-workout flow.
- Moved active-set persistence and rest-timer mute persistence behind one dedicated UI-session hook.
- Collapsed completion, partial-save, and skip control state into one session-flow owner instead of parallel booleans.
- Extracted active-set draft, prefill, and restore behavior behind a dedicated draft-state hook instead of keeping that field-level logic in `LogWorkoutClient`.
- Isolated completed-session review rendering behind a dedicated post-workout component so runtime logging state and post-workout analysis no longer live in the same large client file.
- Isolated footer session actions and the completion confirmation dialog behind dedicated components so session-ending UI no longer shares the main logging render path.
- Isolated exercise-set chip rendering and inline chip edit micro-form behind a dedicated exercise queue component so secondary set editing no longer bloats the main logging client.
- Isolated the expandable exercise queue sections and exercise cards behind a dedicated queue view so `LogWorkoutClient` no longer owns the full browse/edit render tree.
- Isolated set logging, undo, completion, chip-edit save coordination, and transient runtime feedback behind `useWorkoutSessionFlow` so one hook now owns the session mutation flow instead of `LogWorkoutClient`.
- Isolated the active-set editor card and its reps/load/RPE form wiring behind `WorkoutActiveSetCard` so the main client no longer owns the full active-set render tree.
- Collapsed the active-set card boundary to grouped draft/view/action props so the extracted editor no longer depends on a wide low-level prop list from `LogWorkoutClient`.
- Deleted stale Phase 3 inline notes, removed queue-only helper residue from `LogWorkoutClient`, and grouped chip-edit/completion hook outputs so the main client stays closer to composition wiring than runtime ownership.
- Moved hook-only chip-edit/session-flow types behind `useWorkoutSessionFlow` instead of keeping those compatibility-free boundary types in the shared logging type file.
- Reused the shared draft buffer shape across draft restore/persist boundaries, reduced duplicate field-state builders in the active-set draft hook, and simplified persisted workout-session UI storage setup so the remaining Phase 3 draft/session cleanup is less scaffold-heavy.
- Moved keyboard viewport handling, active-panel scroll behavior, and queue auto-expansion policy behind one dedicated session-layout hook so `LogWorkoutClient` no longer owns runtime layout coordination.
- Split terminal completion/skip ownership into a dedicated completion hook so footer actions remain the only session-end owner and completion state no longer shares the broader set-logging hook.
- Split logged-set chip editing into a dedicated chip-editor hook so inline edit state no longer bloats the main session mutation owner.
- Moved "same as last" set-history application into a dedicated hook so the main client no longer owns previous-set mutation policy.
- Moved undo/error overlay rendering into a dedicated feedback component so `LogWorkoutClient` stays focused on composing the training flow rather than rendering transient session chrome.

Exit criteria met:
- `LogWorkoutClient` is now primarily composition and wiring; session layout behavior, same-as-last mutation policy, and transient feedback rendering no longer live in the main client.
- `useWorkoutSessionFlow` is narrowed to core set-log mutation, undo, autoreg hinting, and add-exercise coordination; chip edit and terminal completion/skip flows now have tighter dedicated owners.
- Draft state remains single-owner in `useActiveSetDraftState`; no parallel field buffers were reintroduced.
- Footer actions remain the only session-end action owner.
- Focused tests now cover extracted layout, completion, partial-save, and chip-edit boundaries in addition to the remaining client/session-flow integration coverage.

### Phase 4 - API and Persistence Cleanup
Status: COMPLETE

Goal:
- Standardize the contract between generation, save, persistence, history, and UI.

Focus:
- Normalize payloads around receipt-first semantics.
- Reduce duplicate persisted/runtime fields, especially session-level autoregulation mirrors.
- Make naming consistent across generation responses, save payloads, persisted workout metadata, and explainability output.

Implemented in this pass:
- Standardized workout generation responses around canonical `selectionMetadata` instead of mixing `selectionMetadata` and `selection` across intent/template routes.
- Deleted the intent-route debug echo so generation responses expose only one canonical selection metadata payload.
- Tightened client/API typing so current save flows keep treating `selectionMetadata` as the active contract surface.
- Removed the last save-time legacy autoregulation payload from the main route boundary so receipt readiness is the only supported save-time session-decision input.
- Removed the last active save-route receipt synthesis path so persistence no longer fabricates cycle-context receipt data from DB/fallback context when canonical metadata is missing.
- Collapsed history/recent-workout badge data to a derived `sessionSnapshot` summary model instead of exposing parallel top-level snapshot fields across list surfaces.
- Normalized progression history around a derived `mesocycleSnapshot` object so runtime load-selection logic no longer reads raw snapshot column names directly.
- Removed top-level generation autoregulation from intent/template responses so generation preview and save flows now read readiness state only from `selectionMetadata.sessionDecisionReceipt.readiness`.
- Deleted generation-card state that carried a separate autoregulation object across preview/save boundaries; any remaining readiness copy is derived directly from the canonical receipt.

Exit criteria met:
- Generation, save, persistence, history, explainability, and generation preview UI now share one session-decision owner: `selectionMetadata.sessionDecisionReceipt`.
- Top-level generation autoregulation is no longer an active API/UI contract.
- Phase 4 is complete because the remaining blocker was the parallel generation autoregulation payload, and that duplicate contract has been removed.

### Phase 5 - Legacy Compatibility Reduction
Status: COMPLETE

Goal:
- Remove active dependency on old mesocycle/progression pathways.

Focus:
- Categorize fields and branches as canonical, compatibility-only, or removable.
- Remove active reads of compatibility-only session-decision fields after migration.
- Keep repair/migration logic separate from runtime logic.

Implemented in this pass:
- Removed explainability runtime fallback that inferred session readiness recency from live readiness rows when canonical `selectionMetadata.sessionDecisionReceipt.readiness` was absent; session-level readiness context is now receipt-owned.
- Tightened selection-metadata sanitization so only parseable canonical receipts survive generation/save preparation; arbitrary receipt-like objects are no longer treated as active runtime state.
- Removed explainability fallback support for legacy stored rationale component aliases (`volumeDeficitFill`, `sfrEfficiency`, `lengthenedBias`, `movementDiversity`, `sraReadiness`); active runtime reads now use canonical stored keys only.

Remaining compatibility-only paths:
- Save validation still explicitly rejects removed top-level session mirrors (`selectionMetadata.cycleContext`, `lifecycleRirTarget`, `sorenessSuppressedMuscles`, `deloadDecision`, `adaptiveDeloadApplied`, `periodizationWeek`, and top-level `wasAutoregulated` / `autoregulationLog`). These remain as guardrails until stale callers are fully gone; they are not active runtime inputs.
- Receipt parsing/normalization still accepts persisted canonical `sessionDecisionReceipt` objects and strips invalid payloads. This remains because persisted JSON is untyped at the database boundary, but it no longer reconstructs active state from legacy mirrors.

Exit criteria met:
- Runtime save/read/explainability flows use canonical receipt-owned session-decision state only.
- Compatibility-only branches are isolated to validation or normalization boundaries instead of active runtime reads.
- Legacy rationale/progression alias keys are no longer treated as active explainability inputs.

### Phase 6 - Evidence and Rule Audit
Status: COMPLETE

Goal:
- Keep only decision logic that is conservative, explainable, and evidence-aligned.

Focus:
- Audit progression, deload, readiness scaling, soreness suppression, and exercise-selection constraints.
- Remove speculative or weakly defensible behavior.

Implemented in this pass:
- Tightened reactive deload so runtime deloads now require either a sustained low-readiness streak or repeated main-lift plateau evidence; the weak total-session-rep plateau fallback was removed.
- Kept soreness-based lifecycle volume suppression as a conservative hold-at-prior-week rule rather than letting soreness escalate or zero-out work.
- Standardized scheduled deload receipts to a 50% reduction signal instead of mixing 50% and 55% metadata for the same policy.
- Made default readiness autoregulation down-regulation only; fresh readiness no longer escalates load above the planned prescription by default.
- Removed the post-search selection "stretch upgrade" override so final exercise choice stays owned by the optimizer/beam result rather than a speculative after-the-fact swap.
- Removed exact small-muscle per-session set caps from selection candidate set proposals so accessory set counts are now bounded by training-age caps, lifecycle targets, and session-level direct-set ceilings instead of muscle-specific magic numbers.
- Relaxed intent-alignment from a hard `0.7` gate to diagnostics-first behavior, and removed pull-specific hard structure/required-muscle enforcement so selection quality now relies on intent filtering, soft scoring, and conservative session ceilings rather than extra pattern-shape rules.

Exit criteria met:
- Runtime rule paths are narrower and easier to defend from the stored receipt and generated evidence.
- Weakly defended progression/deload/selection heuristics were either removed or tightened without reintroducing compatibility pathways.
- Focused tests cover the changed progression, readiness, and selection behaviors.

### Phase 7 - Documentation and Deletion Pass
Status: COMPLETE

Goal:
- Make docs and code reflect the simplified architecture with stale paths removed.

Implemented in this pass:
- Added one short canonical session-decision flow description to `docs/01_ARCHITECTURE.md` and trimmed duplicated architecture wording from the domain/API/UI docs.
- Updated this roadmap to reflect the fully completed Phase 1-7 state instead of the earlier in-progress audit framing.
- Removed dead `selection-v2` scaffolding that no longer affected runtime behavior.
- Removed compatibility-only residue from test fixtures/comments where those fields no longer participate in active runtime behavior.

Exit criteria met:
- Docs and comments now describe the receipt-first architecture consistently.
- Dead code/tests/comments left behind by Phases 1-6 were removed without reopening compatibility paths.
- Canonical runtime ownership remains centered on `selectionMetadata.sessionDecisionReceipt`.

## Priority buckets

Do now:
- Keep the receipt-first session-decision contract stable.
- Treat this roadmap as complete unless a future change explicitly reopens one of the closed phases.

Do next:
- Deeper analytics/history UX cleanup after contracts settle.
- Any narrow post-Phase-6 tuning only if a remaining rule is clearly weak and user-visible.

Do later:
- Broader product/analytics refinement after Phase 7 cleanup lands.

Delete after migration:
- Any remaining compatibility-only session decision helpers outside the active save/runtime path that still need deletion after migration.
- Duplicate active session-decision typing that treats top-level autoregulation fields as primary.
- Stale docs that still describe multiple session-decision sources.

## Practical sequence for the next passes

1. Keep this roadmap as the completion log for the receipt-first simplification work.
2. Revisit broader analytics/history UX only after those surfaces need new product work.
3. Avoid reopening completed mesocycle/session-decision phases unless a runtime bug forces it.

## Working principle

For each pass, require clear answers to:
- What is the single source of truth?
- What user-facing behavior does this simplify?
- What compatibility path becomes isolated or deleted afterward?
