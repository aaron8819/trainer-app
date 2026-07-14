# 09 Audit Playbook

Owner: Aaron  
Last reviewed: 2026-03-16  
Purpose: Canonical operational playbook for recurring workout-audit CLI use. This doc tells operators and maintainers which audit to run, what to inspect first, what counts as a red flag, and when to escalate into deeper code-level investigation.

Current V2 readout note, 2026-06-13: when reading `mesocycle-explain` with V2 debug artifacts, treat the promoted Weeks 2-4 Calves 3/5 allocation as baseline evidence. `repairPromotionScoreboard.interpretation.gapInventory` should show `concentration_quality` as `measured_promoted_baseline_idempotent`, the benchmark fatigue/concentration warning should remain a bounded-owner watch, and row proof belongs in the `v2-materialization` shard/index rather than the main artifact. For support-floor/readout evidence, read the compact readout bucket beside the raw source label: `direct_floor_below` explains what was observed, while `measured_no_impact` or `stale_noise` prevents that row from becoming a false owner-policy candidate. For taxonomy mismatch evidence, selected identities that resolve through the pure V2 materializer taxonomy should stay visible as raw rows but count as `audit_readout_cleanup` stale/noise rather than active `class_taxonomy_mismatch` pressure. For strategy-to-demand inventory, the latest owner-scoped Biceps projection reports `SlotDemandAllocationByWeek:Biceps:protect_floor` as diagnostic no-impact: the `+1` `week_1:upper_b:biceps` trial materializes `Barbell Curl:2 -> Barbell Curl:2` and preserves selected identity, total sets, target-lane sets, materializer blockers, protected coverage, concentration, and support-floor set-budget basis. The earlier Side Delts protect-floor row is also measured no-impact. Do not treat either row as materializer ranking, taxonomy, or production slot-allocation evidence.

Current V2 candidate-selection note, 2026-06-15: after reading the V2 plan-quality benchmark, read `plannerOnlyNoRepair.v2PromotionCandidateEvaluator` before picking a next planner slice. The evaluator is the compact work queue: it merges strategy-to-demand inventory, clean preselection feasibility, benchmark watches, repair-scoreboard gap inventory, selected proof rows, and materializer projections into ranked candidates with explicit stop reasons. `candidate_ready` means a row has measured owner-specific positive impact with the required bounded proof. `blocked_actionable_missing_proof` means a plausible bounded positive-impact row exists but still lacks projection/materializer delta, acceptance/watch clearance, or seed/runtime/receipt/DB non-consumption proof. `no_action_roi_cutoff` means the remaining rows are already-promoted baseline, measured no-impact, stale/readout, safety-net repair, diagnostic-only, materializer regression, combined shadow evidence, or too broad/low ROI, and the summary should say `nextProjectionRecommendation=no_next_projection_recommended`. `watch_only_benchmark_item` means benchmark warnings remain watch items, not a projection queue. The Biceps protect-floor projection measures baseline `Barbell Curl:2` versus trial `Barbell Curl:2` with identity/set/lane/blocker deltas `0`, protected coverage preserved, concentration preserved, acceptance proof missing, and next `pivot_to_higher_roi_track`; treat that row as measured no-impact, not fresh missing-evidence work. The lower-b Hamstrings clean-preselection row is the same class of stopped evidence (`Seated Leg Curl:3 -> Seated Leg Curl:3`). Open the `v2-promotion-readiness` debug shard only for row detail and source attribution. Do not use the evaluator as planner policy, acceptance scoring, materializer input, seed/runtime metadata, or repair behavior.

Current V2 default-author readiness note, 2026-06-15: read `plannerOnlyNoRepair.v2DefaultAuthorReadinessMap` as the compact concept-level map before chasing any diagnostic row. It reports exactly eight authoring concepts: `MesocycleDemand`, `WeeklyDemandCurve`, `SlotDemandAllocationByWeek`, `SetDistributionIntent`, `ExerciseClassDistributionBySlot`, `ExerciseSelectionPlan / selection capacity`, `V2 materializer`, and `Acceptance / promotion readiness`. Each row names the owner seam, evidence source, readiness, blocker category, and next safe action. `repair_safety_net` evidence is a quarantined symptom bucket unless the evaluator has already mapped it to a concept-level owner/proof blocker; it is never target policy. Main artifacts keep only compact concept rows and counts; detailed proof remains in benchmark/evaluator fields and V2 debug shards.

Current mesocycle-explain artifact-size note, 2026-06-15: the main `mesocycle-explain` artifact is intentionally compact even when `--no-artifact` only estimates the in-memory serialized payload. `preview.projectionDiagnostics.planningReality` keeps operator summaries, required counts, top findings, and `detailFieldSummaries`; row-heavy planning-reality sections such as weekly demand curves, slot prescriptions, distribution policy, repair materiality, class alignment, and projected delivery belong in the `v2-planning-reality` shard when `--v2-debug-artifact` is enabled. `plannerOnlyNoRepair.v2Summary.repairPromotionScoreboard.interpretation` keeps compact counts, top rows, selected proof summaries, and a pointer to `v2-repair-evidence`; full inventory rows remain debug-shard detail. Preserve diagnostic meaning in the main artifact through benchmark counts, promotion evaluator status, repair quarantine counts, `planningShape`, `materialRepairCount`, `majorRepairCount`, suspicious repair counts, and V2 shard/index summaries rather than re-expanding row arrays.

Current V2 lane-intent benchmark note, 2026-06-13: the plan-quality benchmark includes `lane_intent_explicitness`, sourced from `V2LaneSelectionIntentAudit` and the pure `buildV2LaneSelectionIntentBenchmark()` expectation model. Read it as candidate-quality evidence for high-risk jobs: calf direct, hamstring curl, side/rear delt direct, chest-biased press support, vertical-pull anchor, and low-axial hip-extension support. The low-axial job is now an explicit consumed v0 intent for `lower_b:hinge_anchor`: support coverage, `low_axial_hip_extension`, `low_axial_hip_extension_anchor`, meaningful Glutes stimulus, low axial fatigue, moderate-or-high loadability, clean variation preference, and explicit exclusion of true hinge overload, knee-flexion curl substitution, back-extension closure, and generic glute accessory work. The gate remains read-only audit evidence and must not feed demand, seed/runtime/receipts, acceptance thresholds, repair behavior, DB writes, or persistence.

Current V2 candidate-quality lab fixture note, 2026-06-13: the pure `buildV2CandidateQualityLabFixtures()` helper is the operator-facing lab model behind the next benchmark track. It reuses the lane-intent benchmark instead of re-authoring policy, then reports named scenarios for the low-axial golden case plus vertical-pull anchor, hamstring curl direct, side/rear delt direct, calf direct, and chest-biased press support. `plannerOnlyNoRepair.v2PlanQualityBenchmark.candidateQualityLab` keeps the main artifact compact with total fixture count, pass/warn/fail/watch counts, low-axial golden count, non-consuming fixture count, materializer-delta scenario/measured counts, top attention fixture, and next safe action. With `--v2-debug-artifact`, the debug index mirrors those compact counts as `v2CandidateQualityLab*` fields, while bounded row detail stays under `v2-materialization` through `candidateQualityLab.scenarioDetailTop`. Each scenario carries equipment/inventory constraints, expected and actual pass/warn/fail/watch outcome, owner seam, evidence source, observed gap kind, and next safe action. The selected materializer-delta rows are low-axial golden, vertical-pull anchor, hamstring curl direct floor, and calf direct floor; they report baseline/trial identities, set and blocker deltas, protected coverage, non-consumption, and delta-specific next safe action separately from the semantic pass result. Side/rear delt and chest-biased press stay semantic-only until they show a stronger bounded baseline/trial story than the direct-floor rows. Treat no-impact architecture review rows as useful only when they improve semantic correctness, ownership, benchmark fidelity, or boundary safety; do not promote behavior from them without a separate bounded materializer/acceptance/non-consumption proof.

Current low-axial projection note, 2026-06-13: `plannerOnlyNoRepair.v2LaneIntentMaterializerProjection` now compares a legacy/no-intent baseline with the current production consumed low-axial intent for `lower_b:hinge_anchor`. Use it to confirm the same non-regression properties: low-axial support closes through the materializer, knee-flexion curl support is preserved, total sets and blockers do not regress, and true hinge overload / hamstring curl / back-extension / generic glute accessory substitutions stay excluded. This is still a read-only audit comparison. It does not write seeds, change runtime replay, mutate receipts or DB state, promote repair behavior, or change acceptance thresholds.

This doc covers:
- Recurring operational use of `historical-week`, `weekly-retro`, `future-week`, `projected-week-volume`, `current-week-audit`, `mesocycle-explain`, `v2-accepted-seed-prepare-compare`, `next-mesocycle-handoff-dry-run`, `next-mesocycle-acceptance-gate`, `next-mesocycle-post-accept-verification`, `replace-empty-mesocycle-with-v2`, `deload`, and `progression-anchor`
- Active-mesocycle dry-run reseed review for bounded slot-seed repair
- Default audit workflows for common review scenarios
- Artifact-reading guidance for the current audit JSON vocabulary
- Red flags, escalation triggers, and legacy-data caveats

Invariants:
- This playbook is operational guidance, not a second source of runtime semantics.
- Runtime truth lives in the canonical audit artifacts plus the owning code seams referenced here.
- When artifact output conflicts with prose, trust the artifact and the code owner it points to.
- Environment setup, DB preflight, and direct CLI validation commands live in `docs/08_AUDIT_CLI_DB_VALIDATION.md`.
- Seed provenance readouts distinguish exact revision truth from `legacy_unknown`. Never infer a historical workout's seed from the mesocycle's current revision. Read receipt agreement against the workout's referenced immutable revision; an older revision is expected after a correction.

Sources of truth:
- `trainer-app/scripts/workout-audit.ts`
- `trainer-app/src/lib/audit/workout-audit/types.ts`
- `trainer-app/src/lib/audit/workout-audit/context-builder.ts`
- `trainer-app/src/lib/audit/workout-audit/generation-runner.ts`
- `trainer-app/src/lib/audit/workout-audit/serializer.ts`
- `trainer-app/src/lib/api/replace-empty-mesocycle-with-v2.ts`
- `trainer-app/src/lib/api/replace-empty-successor-from-accepted-seed-draft.ts`
- `trainer-app/src/lib/evidence/session-audit-snapshot.ts`
- `trainer-app/src/lib/evidence/session-audit-types.ts`
- `trainer-app/docs/01_ARCHITECTURE.md`
- `trainer-app/docs/02_DOMAIN_ENGINE.md`
- `trainer-app/docs/08_AUDIT_CLI_DB_VALIDATION.md`

## 1. Purpose

Use this playbook when you need a fast, repeatable audit of:
- a completed training week
- a retrospective actual-vs-target week audit
- the next generated session or week path
- the next mesocycle structure, accepted seed, and runtime drift in one artifact
- a deload preview or live deload routing path
- a suspicious progression / anchor decision for one exercise

This playbook is designed to answer:
- what the audit system generated or reconstructed
- whether a session counted toward progression history or was excluded
- whether a completed week's actual slot usage, reconciliation drift, and weekly volume landed where expected
- whether a future-week request used the normal path or rerouted through deload
- whether the full current week is projected to hit weekly muscle volume targets
- whether the current week needs small pre-execution adjustment guidance before any sessions start
- why a progression decision increased, held, or decreased
- whether warnings, week-close state, or generated-vs-saved drift require follow-up

This playbook does not try to answer:
- subjective coaching quality or whether a plan is "good" in the abstract
- UI rendering bugs outside the artifact/runtime contract
- hidden generation-time truth for legacy workouts that never persisted generated snapshots
- architectural semantics beyond what the artifact surfaces; use the owning docs and code for that

## 2. Audit Types

### `historical-week`

When to use it:
- completed week review
- week-close / gap-fill review
- legacy workout coverage check
- generated-vs-saved drift review when snapshots exist

Primary questions it answers:
- what workouts happened in the audited week
- which sessions were advancing, gap-fill, supplemental, or deload
- which sessions counted toward progression history
- whether week-close state was relevant or unresolved
- whether the week is fully comparable or limited by legacy reconstruction

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode historical-week --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id>
```

Inspect first:
- `historicalWeek.summary`
- `historicalWeek.comparabilityCoverage`
- `historicalWeek.sessions[*].progressionEvidence`
- `historicalWeek.sessions[*].weekClose`
- `historicalWeek.sessions[*].reconciliation`
- `historicalWeek.sessions[*].sessionSnapshot`

Common red flags:
- `comparabilityCoverage.generatedLayerCoverage !== "full"` when you expected modern persisted coverage
- `progressionEvidence.countsTowardProgressionHistory=false` without an obvious semantic reason
- `weekClose.workflowState="PENDING_OPTIONAL_GAP_FILL"` with linked actionable optional work that should have been resolved
- `reconciliation.hasDrift=true` with unexplained prescription or exercise changes
- heavy `warningSummary.semanticWarnings`

Escalate when:
- excluded progression eligibility is not explained by artifact semantics/reason codes
- week-close state looks wrong relative to the actual completed week
- drift exists but the saved workout should have matched the generated plan
- legacy reconstruction is masking the exact question you need answered

### `weekly-retro`

When to use it:
- retrospective weekly review after the week is complete or materially settled
- actual-vs-target weekly volume review using performed volume instead of projection
- slot-balance and receipt-integrity review for advancing sessions
- compact follow-up prioritization when historical-week alone is too session-by-session

Primary questions it answers:
- whether saved-vs-generated reconciliation drift weakens load-calibration confidence
- whether advancing sessions carried usable canonical slot identity
- how actual weekly effective volume landed against weekly target, MEV, and MAV
- which read-side follow-ups deserve attention first

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode weekly-retro --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id>
```

Optional projection-delivery comparison:

```powershell
npm run audit:workout -- --env-file .env.local --mode weekly-retro --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id> --projection-artifact <projected-week-volume-artifact-path>
```

Strict stdout-only operator review:

```powershell
npm run audit:workout -- --env-file .env.local --mode weekly-retro --owner <owner-email> --mesocycle-id <mesocycle-id> --week <week> --no-artifact --operator-debug
```

- `--operator-debug` prints an `Exercise Reconciliation` table from `weeklyRetro.exerciseLoadCalibrationRows`.
- `--operator-debug` also prints compact stdout-only `Weekly Set Summary` and `Weekly Muscle Volume` tables from the existing `weeklyRetro.planAdherence`, `weeklyRetro.exerciseLoadCalibrationRows`, and `weeklyRetro.volumeTargeting.muscles` payload. These tables do not change weekly volume math, contribution weights, saved workouts, or artifact writing behavior.
- The table is read-only stdout over existing audit rows: planned, saved, performed, skipped, added, classification, and short notes for additions, skipped work, substitutions when already classified, duplicate evidence when present, and load target mismatch.
- `weeklyRetro.postSessionReview.calibrationRows` and the `Post-Session Calibration Deltas` operator-debug table compare target load/reps/RPE against representative completed set logs, split main-lift versus accessory roles, and classify likely prescription-quality failures such as stale main anchors or accessory equipment scaling. This is audit/readout-only; it does not change prescription generation, seed shape, runtime replay, planner/materializer behavior, workouts, logs, sessions, or DB state.
- For mid-week post-session review, `weeklyRetro.postSessionReview` and `--operator-debug` separate completed-session reconciliation from future planned/incomplete workouts. Future scheduled sessions after the latest performed session remain visible as next work, but they are not counted as missed planned work in the completed-session reconciliation.
- Replacement-like rows may be labeled `replacement_like` when a planned exercise has low/no performed coverage and a same-session performed addition conservatively matches both movement pattern and target, such as vertical-pull lat-pulldown variants. This is readout-only session-local reconciliation and does not mutate the seed, runtime replay, planner, materializer, workouts, logs, or sessions.
- `--no-artifact` still suppresses the main artifact and debug sidecar writes.

Fast operator loop:

```powershell
npm run audit:week:retro -- --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id>
```

Inspect first:
- `weeklyRetro.executiveSummary`
- `weeklyRetro.planAdherence`
- `weeklyRetro.loadCalibration`
- `weeklyRetro.exerciseLoadCalibrationRows`
- `weeklyRetro.sessionExecution`
- `weeklyRetro.slotBalance`
- `weeklyRetro.volumeTargeting`
- `weeklyRetro.projectionDeliveryDrift` when a prior projected-week-volume artifact was provided
- `weeklyRetro.recommendedPriorities`

Common red flags:
- `loadCalibration.status !== "aligned"` when you expected clean comparable modern coverage
- `planAdherence.engineConfidenceImpact` is `medium` or `high`
- `planAdherence.plannedWorkMissedSets > 0` when the week should have preserved the original plan
- `planAdherence.unclassifiedDrift > 0`
- `slotBalance.missingSlotIdentityCount > 0` or `slotBalance.duplicateSlotCount > 0`
- `volumeTargeting.belowMev.length > 0`
- `rootCauses[*].code` points at reconciliation drift or legacy coverage gaps you did not expect

Escalate when:
- slot identity receipts are missing or duplicated for advancing sessions
- unclassified runtime drift, missed planned work, or selection/semantic drift changes the meaning of the week enough that actual-vs-target conclusions are suspect
- actual completed volume still lands below MEV or above MAV after reading the top contributors
- legacy saved-only reconstruction prevents a trustworthy retrospective answer

### `future-week`

When to use it:
- upcoming session preview
- recurring "what will the system generate next?" checks
- explicit intent checks through the same canonical mode plus `--intent`
- confirming whether an upcoming session is standard or deload-rerouted

Primary questions it answers:
- what the next generated session looks like
- whether the generation path was standard or active-deload reroute
- what semantics the generated session carries
- whether warnings are present before the workout is saved

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode future-week --user-id <user-id>
```

Explicit-intent variant:

```powershell
npm run audit:workout -- --env-file .env.local --mode future-week --user-id <user-id> --intent <intent>
```

Strict stdout-only operator preview:

```powershell
npm run audit:workout -- --env-file .env.local --mode future-week --owner <owner-email> --no-artifact --operator-debug
```

- `--operator-debug` prints stdout-only `Generation Summary` and `Generated Preview` sections from existing artifact data: `generationPath`, `generationProvenance.receiptProvenance`, `nextSession`, warning blockers, and `sessionSnapshot.generated.exercises`.
- Deload reroutes are labeled with the active deload path and generator; closeout-blocked states print the blocker instead of a generated preview table.
- This is readout-only and must not be interpreted as a change to generation, lifecycle, deload policy, seed replay, receipts, or saved workout behavior.

Inspect first:
- `generationPath`
- `warningSummary`
- `sessionSnapshot.generated.semantics`
- `sessionSnapshot.generated.traces.progression`
- `sessionSnapshot.generated.traces.deload`

Common red flags:
- `generationPath.executionMode="active_deload_reroute"` when the mesocycle should still be in accumulation
- `sessionSnapshot.generated.semantics.isDeload=true` unexpectedly
- warning counts are high or warning messages suggest planner/classification mismatches
- generated semantics exclude progression when the session should be advancing

Escalate when:
- the path or semantics contradict the live mesocycle state
- the artifact does not explain a meaningful session exclusion or forced deload path
- warnings suggest structural planner issues rather than isolated library noise

### `pre-session-readiness`

When to use it:
- strict read-only pre-training check for the next active-mesocycle session
- one-command replacement for manually combining `future-week`, `current-week-audit`, generated exercise/load probes, and prior-week fatigue context
- active mesocycle checks where stdout is enough and local artifact writes are undesired

Primary questions it answers:
- what the next generated session prescribes, including exercise order, set count, load, rep target/range, and RPE
- whether the current app state has blockers such as an incomplete workout or mesocycle-id mismatch
- which relevant current-week dose rows suggest holding the seed, optional session-local add-ons, or caution
- what recent prior-week/fatigue context should limit add-ons
- whether the operator should treat the session as safe to train

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode pre-session-readiness --owner <owner-email> --mesocycle-id <active-mesocycle-id> --no-artifact --operator-debug
```

Inspect first:
- `Pre-Session Readiness`
- `Generated Preview`
- `Current-Week Dose Guidance`
- `Dose Closure Guidance`
- `Session-Local Add-On Recommendation`
- `Safe to train`

Important interpretation rule:
- this mode composes existing read-only generation, projected-week, current-week dose guidance, and prior-week retrospective readouts
- recommendations are session-local operator guidance only
- the typed readiness contract is owned by `src/lib/api/pre-session-readiness-contract.ts`; this audit mode is only one producer (`audit_readout`), and Home/future persisted snapshots should consume the shared app-safe contract/validator rather than CLI prose or audit-only artifact metadata
- `Dose Closure Guidance` formats `weekly-volume-closure` decisions; it does not recalculate finality, suppression, guardrails, candidates, or set count. A later slot is another opportunity only when it is available, reliable, and contributes at least `0.5` canonical effective sets to that exact target. Generic upper/lower labels do not defer closure.
- Read `doseClosure.decisions[*]` in order: performed/current/later/week/MEV evidence, later contributing slots and evidence source, status, hard-suppression reasons, forbidden movement/exercise constraints, candidate filter reasons, and the exact selected candidate when status is `eligible`. `no_valid_candidate` is the expected result when every current candidate is filtered.
- `Session-Local Add-On Recommendation` and Home/logging consumers reuse the exact eligible recommendation. They must not synthesize alternatives such as “or Pec Deck,” recommend a suppressed target, or emit a row/pulldown candidate while the pull-density restriction forbids rows/pulldowns. Pressing remains filtered for Chest/Triceps closure while a valid isolation alternative may remain eligible.
- The consistency checks `closure_recommendation_satisfies_constraints`, `closure_recommendation_requires_eligible_final_opportunity`, and `closure_deficit_matches_projected_week` must pass. A failure means the audit contract is internally inconsistent even if its prose appears plausible.
- Closure set sizing is session-local, read-only, and bounded to the canonical maximum. At or above MEV returns `not_needed`; there is no default floor-buffer closure recommendation to chase a cushion.
- Planned incomplete workouts are not all blockers. A planned workout is startable/resumable when it matches the active mesocycle's next expected week/session or slot, is backed by `persisted_slot_plan_seed`, its exercise order and set counts match the active `slotPlanSeedJson`, and it has no set logs. In that case the readout reports `matching_next_planned_workout` and preserves the existing workout id so the UI/logging flow can resume without creating a duplicate.
- Stale or mismatched planned workouts still block readiness when they point at a different mesocycle, week/session, slot, seed exercise plan, or already have logged set state. In-progress workouts are resumable rather than treated as unsafe blockers.
- it does not mutate `slotPlanSeedJson`, runtime replay, receipts, progression anchors, workouts, logs, sessions, analytics semantics, planner/materializer policy, or DB state
- `--no-artifact` keeps the check stdout-only; without it, the normal audit artifact behavior still applies

Common red flags:
- `Safe to train: no`
- stale/mismatched incomplete workout blocker is present
- final accumulation lifecycle/data blocker is present; target deficits alone should be review evidence, not a reason to expect another accumulation session before deload generation
- requested mesocycle id does not match the active mesocycle
- generated preview is missing or generation failed
- dose guidance suggests add-ons for muscles already high or fatigue-dense

Escalate when:
- the generated preview contradicts the expected active slot
- safe-to-train is blocked by audit inconsistency rather than an expected incomplete workout
- the one-command readout lacks a signal needed for the operator decision; add that signal to the read-only audit seam before changing generation behavior

### `projected-week-volume`

When to use it:
- full current-week volume coverage review
- "will this week hit target / MEV / MAV?" checks
- remaining-slot planning review when a next-session snapshot is not enough

Primary questions it answers:
- how much weighted volume is already completed this week
- what each remaining advancing slot is projected to add
- what the projected full-week total is for each muscle
- how projected full-week totals compare against weekly target, MEV, and MAV
- whether a row is a hard target or readout-only soft target; soft rows should be interpreted against their range rather than as high solely because the hard lifecycle target is zero

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode projected-week-volume --user-id <user-id>
```

Fast operator loop:

```powershell
npm run audit:week
```

- Uses `.env.local`
- Uses the same app-default owner resolution path as the rest of the audit CLI when no owner flags are supplied
- Prints a compact verdict before the artifact path so routine current-week checks do not require opening JSON first

Debug operator loop:

```powershell
npm run audit:week:debug
```

- Uses the same canonical `projected-week-volume` path as `npm run audit:week`
- Keeps the same owner resolution and artifact write path
- Expands the CLI with full below-MEV and below-target-only detail, warning text, projection notes, and projected session order before you open JSON

Inspect first:
- `projectedWeekVolume.currentWeek`
- `projectedWeekVolume.projectionNotes`
- `projectedWeekVolume.projectedSessions`
- `projectedWeekVolume.fullWeekByMuscle`

Important interpretation rule:
- this mode is intentionally generation-centric
- if a persisted incomplete workout exists, the artifact documents that it was ignored and the report projects remaining advancing slots from canonical performed runtime state rather than trying to reuse incomplete saved-state structure

Common red flags:
- projected session order does not match runtime slot order
- `projectedSessions[0].isNext` does not align with the expected next advancing slot
- `fullWeekByMuscle` suggests major under-target or over-MAV outcomes that contradict the chained projected sessions
- support, secondary, or implicit rows are interpreted as hard blocking target failures rather than tiered readout context; hard warning buckets should come from Tier A primary-driver rows only
- projection notes indicate an ignored incomplete workout when you expected saved-state continuation

Escalate when:
- runtime slot order looks wrong for ordered-flexible repeated intents
- projected later sessions appear to ignore earlier projected-slot contributions
- a saved incomplete workout is the real source of truth you need, since this mode intentionally does not redesign around that case

### `current-week-audit`

When to use it:
- pre-execution current-week decision support before any planned sessions have started
- "if I run this week as-is, what happens?" checks
- bounded adjustment review when the full-week projection already answers the volume landing question but needs operator guidance

Primary questions it answers:
- which projected muscles are below MEV
- which below-MEV floor-closure clusters are at least 3 effective sets short
- which above-MEV rows are merely below preferred/stretch targets and should be monitored rather than treated as default add-on triggers
- which muscles are over MAV, with fatigue risks limited to glutes, lower back, and high systemic-fatigue patterns
- whether any audit-only 2-3 set intervention hints are warranted
- whether projected sessions carry long-duration, redundant-pattern, or upper/full-body pull-vs-push imbalance risks

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode current-week-audit --owner <owner-email>
```

Inspect first:
- `projectedWeekVolume.currentWeek`
- `projectedWeekVolume.fullWeekByMuscle`
- `projectedWeekVolume.currentWeekAudit`
- `projectedWeekVolume.interventionHints`
- `projectedWeekVolume.runtimeDoseAdjustmentDiagnostics`
- `projectedWeekVolume.sessionRisks`

Important interpretation rule:
- this mode reuses the canonical `projected-week-volume` pipeline
- `currentWeekAudit`, `interventionHints`, and `sessionRisks` are audit-only guidance fields; they do not mutate mesocycles, modify slot plans, or feed generation/runtime policy
- `runtimeDoseAdjustmentDiagnostics` is the read-only session-local dose-guidance layer; it can name optional add/reduce candidates, but it does not mutate `slotPlanSeedJson`, runtime replay, planner/materializer output, receipts, UI, or performed logs
- use it before session execution; if sessions are already in progress or completed, read the projection notes and consider `projected-week-volume` or `weekly-retro` depending on the question

Common red flags:
- `currentWeekAudit.belowMEV.length > 0`
- `currentWeekAudit.underTargetClusters[*].deficit >= 3` means a below-MEV floor gap, not a target-chasing gap
- `currentWeekAudit.belowPreferred[*]` means productive floor achieved but below preferred/stretch target; monitor by default
- `currentWeekAudit.overMAV` includes fatigue-sensitive muscles
- `sessionRisks` reports long sessions, redundant pattern stacking, or pull-vs-push imbalance in an upper/full-body slot

Escalate when:
- the guidance contradicts `fullWeekByMuscle`
- hints suggest additions for muscles already near MAV
- session risks point at a repeated slot-shape issue across the week rather than an isolated audit readout

### `mesocycle-explain`

When to use it:
- explain what the next mesocycle would look like if generated now
- compare that preview against a current or previous mesocycle's accepted seed
- inspect where runtime execution drifted from the canonical seed
- keep preview, accepted seed, and lived reality aligned without inventing historical ranking rationale

Primary questions it answers:
- what next-mesocycle slot plans the canonical handoff path would produce now
- which exercise-level explanations are persisted truth, deterministic reconstruction, or unavailable
- how preview slot plans differ from a target mesocycle's accepted seed
- where generated-vs-saved and seed-vs-reality drift occurred during execution

Maintainer note:
- For read-only audit diagnostic refactors, especially `planningReality` modularization, follow the `Read-Only Diagnostic Refactor Checklist` in `.codex/skills/audit-workflow/SKILL.md`: baseline artifact, serialized diagnostic equality, summary equality, section byte-size equality, CLI summary equality, then focused/broad verification as warranted. Do not accept TypeScript/tests alone as proof because artifact shape or meaning can drift while tests still pass.

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com
```

Compact planning-reality readout:

```powershell
npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com --operator-debug
```

- Prints `Planning Reality Summary` from `mesocycleExplain.preview.projectionDiagnostics.planningReality`.
- Prints a CLI-only `planningReality size breakdown` when the artifact exceeds or approaches the configured audit artifact-size limit, or whenever `--operator-debug` asks for the extra readout. Use the largest-section list to identify which top-level diagnostic fields are driving payload growth before adding more read-only diagnostics.
- Use this first for architecture audits before opening the full JSON.

Planner-only dry-run comparison:

```powershell
npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com --operator-debug --planner-only-dry-run --compare-repaired
```

- This first implementation requires both `--planner-only-dry-run` and `--compare-repaired`.
- Adds `mesocycleExplain.plannerOnlyDryRun` only for flagged runs.
- Compares the current repaired projection against the pre-final planner-owned shape already captured in `planningReality.initialSlotComposition`.
- The comparison is read-only, non-generative, and does not mutate `slotPlanSeedJson`, accepted mesocycles, receipts, runtime replay, planned workouts, or performed workouts.
- Disabled downstream repair paths are reported as repair dependencies instead of being treated as planner success.
- When `plannerOnlyDryRun.policyOverride.status="active"` for `calves_4_4_lower_slot_allocation`, the flagged path performs a second read-only projection rerun with Lower A and Lower B Calves lane/preselection intent adjusted to one calf-raise identity and 4 effective sets per lower slot. That rerun is comparison input only; it must not leak into unflagged output, standard projection, accepted handoff/setup/reseed, `slotPlanSeedJson`, receipts, runtime replay, routes, UI, planned workouts, or performed workouts.
- `plannerOnlyDryRun.projectionComparisons` is the compact comparison block for this rerun. Read `baselineRepaired`, `plannerOnlyBase`, `plannerOnlyWithOverride`, `deltas.overrideVsBaselineRepaired`, and `deltas.overrideVsPlannerOnlyBase` for the actual material/major/suspicious, concentration, cap-trim, duplicate, support-floor, set-bump, weak-preselection, forbidden-primary, and key-acceptance impact.
- The flagged comparison also includes a compact read-only `calvesFourFourCandidate` diagnostic backed by the override rerun. Its `lowerASafety`, `materialityEstimate`, and `policyReadiness` fields separate Week 1 slot safety from actual repair-materiality deltas and accumulation-week projection gaps. Treat `weeks_2_to_4_unprojected`, worsened material/major/suspicious/cap/concentration metrics, lower_a safety failures, or Hamstrings-route risk as blockers; this field must not be read as behavior approval unless it reports `recommendation="safe_to_trial_behavior"` and no remaining blockers.

Experimental planner-only no-repair comparison:

```powershell
npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com --operator-debug --planner-only-no-repair --compare-repaired
```

- Adds `mesocycleExplain.plannerOnlyNoRepair` only for flagged runs.
- The main `mesocycle-explain` JSON is the operator artifact. It keeps only read-only no-repair summary, replacement readiness, V2 summary, top operator findings, and `debugArtifact` manifest metadata.
- Additional V2 planner diagnostics are written only when the explicit debug-artifact flag is present:

```powershell
npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com --operator-debug --planner-only-no-repair --compare-repaired --v2-debug-artifact
```

- `--v2-debug-artifact` requires `--mode mesocycle-explain` and `--planner-only-no-repair`. It writes a sibling `*-v2-debug-index.json` artifact plus focused shard files, prints the index path/size/sha256 and written shard path/size/sha256 values, links the main artifact to the index through `plannerOnlyNoRepair.debugArtifact`, links compacted main `planningReality` detail through `planningReality.detailArtifact`, and links the index back through `parent.fileName` / `parent.relativePath`. The old `debugArtifact` field is preserved for compatibility, but its `kind` is now `v2_debug_index`.
- The V2 debug index is compact and operator-facing. It contains summary, budgets, shard metadata, relative paths, byte sizes, hashes, detail levels, and statuses. Default shard detail is `compact`; full-detail shards are reserved for explicit future opt-in and are not emitted by the current CLI flag.
- Focused shards currently split V2 diagnostics into `v2-planning-reality`, `v2-strategy`, `v2-promotion-readiness`, `v2-promotion-diffs`, `v2-repair-evidence`, `v2-materialization`, `v2-cross-week-projection`, and `v2-selection-alignment`. Summary fields stay in the main artifact and index; large arrays are omitted or summarized in compact shards, and repeated repair evidence is cataloged once and referenced by ID where possible. The V2 base-plan compare and shadow-consumption trial are summarized in the main artifact/CLI, but detailed slot shape, muscle/class coverage, repair dependency, exercise identity, deload-readiness, and identity/materializer categorization rows belong in `v2-materialization`; detailed planning-reality demand/allocation/repair-burden evidence belongs in `v2-planning-reality`.
- Artifact budgets are explicit: main artifact 1 MiB, V2 index 128 KiB, default shard 512 KiB, full-detail shard 1 MiB, and per-artifact limit 1 MiB. Default shards are kept below the compact budget individually; `v2-planning-reality` may use the 1 MiB per-artifact budget because it preserves detailed evidence displaced from the main operator artifact.
- Runs a second read-only projection pass from the first-principles upper/lower lane plan with downstream repair/shaping disabled.
- Read `plannerOnlyNoRepair.repairPromotionScoreboard` as a classification readout over existing repaired-planning repair evidence, not as behavior approval. Raw counts and suspicious rows stay intact; promotion candidates are limited to positive slot-owned likely-avoidable rows that still have V2 no-repair target ownership. Rows are demoted when pure V2 no-repair already solves the target differently, has no matching non-diagnostic lane ownership, or points first to readout cleanup, collateral accounting, taxonomy bridge, support-floor, set-distribution, or legacy repaired-artifact work. Cap trim/removal, forbidden cleanup, collateral, and materiality-none rows stay in safety/diagnostic buckets. Use `repairPromotionScoreboard.interpretation` for the compact split between legacy repair pressure, current V2 policy gaps, safety/non-regression rows, stale repaired-projection artifacts, quarantine groups, ranked gap inventory, taxonomy mismatch inventory, selected measured proof, repair deprecation roles, and missing proof gates; do not read `likelyAvoidableMaterialRepairCount` as behavior-promotion pressure by itself. `taxonomyMismatchInventory` is row-level evidence only: it can rank selected-identity class mismatches and name owner/proof gaps, but it must not drive generation, seed/runtime replay, receipts, persistence, acceptance thresholds, or production materializer policy. `quarantineGroups.upstreamOwnedCandidate` is the only group that can contain behavior candidates; `safetyRepairOnly`, `collateralAmbiguous`, `staleArtifact`, and `missingEvidenceOrUnmeasuredGate` rows require their named proof before behavior. `repairDeprecationReadiness` classifies repair paths as `safety_net`, `plan_authoring_leftover`, `obsolete_no_impact`, or `still_unproven`; this is non-executable review guidance, not removal. If `selectedGapProof.proofResult="measured_no_candidate_impact"` or `"measured_no_drift"`, treat that selected slice as measured but not useful for behavior promotion and pivot to the next ranked gap.
- Disabled in this experimental pass: support-floor closure, weekly obligation closure, program-quality identity changes, late set bumping, isolation injection/accessory-lane rescue, clean-curl repair preference, duplicate/program-quality repair shaping, cap trim, MAV trim, forbidden cleanup mutation, and seed/runtime persistence.
- Kept as validation/reporting only: forbidden-slot checks, cap/concentration checks, duplicate checks, unresolved demand reporting, lane satisfaction, weekly muscle totals, and acceptance checks.
- The payload reports unresolved demand and validation failures instead of fixing them. It must not update accepted mesocycles, `slotPlanSeedJson`, receipts, runtime replay, planned workouts, or performed workouts.
- The payload and CLI also report compact planner-owned set-allocation changes plus before/after weekly total changes for the flagged no-repair pass. These fields are diagnostic readouts only and must not imply downstream repair was enabled.
- No-repair acceptance is reported through `plannerOnlyNoRepair.acceptanceClassification`. `basicMesocycleShapeStatus` evaluates the Week 1 no-repair shape, while `replacementReadinessStatus` answers whether the no-repair path can replace the repaired projection. Raw unresolved demand, raw missing lane counts, raw validation counts, and repair materiality scoreboards do not hard-fail basic shape by themselves.
- `plannerOnlyNoRepair.v2MesocyclePlan` is the compact 5-week bridge object for the experimental V2 planner target. It records the stable upper/lower 4x skeleton, Week 1 lane status from flagged no-repair evidence, Weeks 1-5 progression modifiers, deload transform intent, validation-rule statuses, and explicit replacement-readiness blockers. It is flagged-only, read-only, non-generative, and must not be treated as accepted seed, repaired projection, runtime replay, receipt, or UI truth.
- `plannerOnlyNoRepair.v2MesocycleStrategyDiagnostic` is the compact read-only strategy-layer diagnostic above current V2 `MesocycleDemand`. It can consume the pure `V2MesocycleStrategyInput` DTO assembled by the API/read-model adapter from available handoff/profile/review/readiness evidence, reports present and missing input groups, normalized block response signals, exercise response/tolerance signals, continuity/variation evidence readiness, and volume/fatigue evidence readiness, keeps phase/objective classification unknown until strategy reasoning exists, and still reports current fixed-skeleton demand derivation, target strategy-derived demand ownership, and current-state vs north-star gaps. It also includes `strategyHypothesisPromotionReadiness`, which states the owner, bounded scope, required evidence, missing evidence, non-regression gates, risks, rollback criteria, and next safe action required before each non-binding strategy hypothesis could influence behavior. The main artifact keeps compact readiness counts, owner counts, next actions, global blockers, and top missing evidence; the V2 debug index points to focused strategy and promotion-readiness shards. It is diagnostic evidence only and must not feed generation, selection, repair, seed serialization, runtime replay, receipts, accepted mesocycle behavior, UI, or persistence.
- `plannerOnlyNoRepair.v2MesocycleStrategyDiagnostic.demandZoneLearning` is the demand-zone learning readout. It labels performed evidence as floor protection, productive monitoring, stretch monitoring, or cap/redistribution pressure and prints compact counts plus a next safe action. Floor evidence can justify a future read-only strategy-to-demand diff; productive and stretch signals stay monitoring evidence until recurrence/non-regression gates are explicit. This field is read-only and must not feed demand, weekly curves, slot allocation, materializer ranking, repair, accepted seed serialization, runtime replay, receipts, UI, API writes, or the current candidate.
- `plannerOnlyNoRepair.v2MesocycleStrategyDiagnostic.strategyToDemandDiff` is that read-only bridge when demand-zone evidence exists. It prints compact row/readiness counts and owner labels for future floor protection, productive monitoring, stretch non-promotion, and cap redistribution/capping. `plannerOnlyNoRepair.strategyToDemandProjection` is the next compact readout: it joins those rows to current static `MesocycleDemand`, reports base-demand matches, confirms current no-mutation projection counts, and measures the current no-mutation projection against static demand with zero expected range/net-volume deltas. Its `candidateInventory` is the operator work queue for the next true planner-intelligence seam: each row preserves source attribution, classifies evidence as performed reality, benchmark watch, no-repair projection, or repair-only, names the affected muscle/slot/lane/week where known, proposes the future owner seam and action type, labels readiness as blocked/diagnostic-only/candidate-for-read-only-projection, and names proof required before behavior. Main artifacts keep inventory counts and the top candidate compact; V2 strategy debug shard/index carries row detail. Its bounded behavior trial is a read-only row-level static demand delta check, not a behavior promotion; it may label compact slot-owned redistribution context from `V2SlotOwnedDemandAdjustmentPlan` and print a downstream context inventory showing whether current `WeeklyDemandCurve`, `SlotDemandAllocationByWeek`, and `V2SetDistributionIntent` can observe trial candidates. That availability is only prerequisite evidence: a one-set floor-buffer candidate remains blocked when donor-offset math, net-new-volume preservation, or materializer non-regression is unmeasured. The measured redistribution blocker summary includes `unmeasuredGateCounts`, including `materializerNonRegression`, so unknown downstream behavior evidence remains visible in compact artifacts. Neither field mutates `MesocycleDemand`, weekly curves, slot allocation, materializer ranking, repair, seed serialization, runtime replay, receipts, UI, API writes, acceptance thresholds, or the current candidate; blocked rows are evidence gaps, not repair instructions.
- `plannerOnlyNoRepair.v2StrategyRowMaterializerProjection` is the stronger read-only materializer proof for the current Side Delts `protect_floor` owner row. Read the CLI fields `setBudgetBasis` and `basisChanged` before interpreting protected-coverage deltas: a diagnostic marker must not change the set-budget basis from `support_direct_floor` to `class_ownership_allocation`. The 2026-06-13 corrected live trial preserves `support_direct_floor -> support_direct_floor`, selected budget `4 -> 4`, materialized target-lane sets `4 -> 4`, no collateral lane transfer, protected coverage `preserved`, concentration `preserved`, readiness `diagnostic_no_impact`, and next safe slice `pivot_to_higher_roi_track`. Treat this as faithful no-impact evidence, not a Side Delts policy promotion or materializer-ranking failure. The compact main artifact/index carry status and basis-change flags; target-lane and collateral details belong in the `v2-materialization` shard. This projection must not feed demand, weekly curves, slot allocation, set distribution, materializer ranking, generation, repair, accepted seed serialization, runtime replay, receipts, UI, persistence, DB, or live V2 writes.
- `strategyHypothesisPromotionDiff` is the read-only gate after promotion readiness. It currently evaluates `protect_lagging_muscles_earlier` and `cap_late_block_volume` only when ready for read-only diff, uses target-tier under-hit evidence for lagging-muscle protection, uses skipped-set plus hard-week effort evidence for late-block caps, and surfaces the tension between protection and total-volume caps. Its nested `projectionDiff` runs as a flagged combined-pair shadow diagnostic without changing behavior: it prefers redistribution from supported over-concentration/fatigue-driver muscles before net-new late-block volume, lists candidate protected/donor counts, and computes non-regression gates as `pass` / `fail` / `unknown` from measured before/after deltas when the second planner-only no-repair shadow projection is available. Before the second projection is constructed, `preShadowCandidateFilter` checks base no-repair floor coverage and slot compatibility so protected target-tier muscles cannot act as donors without safe surplus margin, unknown floor margin excludes donors, target-tier donors need stricter evidence, overloaded receiving slots are blocked, net-new volume remains false, max slot increase remains zero, and concentration-risk donors are excluded. The projection diff also reports `conflictAwareRefinement`: protected/donor overlap, target-floor preservation conflicts, missing slot owners, session-size cap conflicts, and blocked net-new volume. `donorSurplusEvidence` is the normalized donor-evidence layer beside that frame: it records candidate reason, measured baseline coverage, floor/preferred landmarks when available, surplus above floor, required safety margin, protected overlap, slot ownership compatibility, eligibility confidence, and compact counts/top reasons. `slotOwnedDemandAdjustmentPlan` is the upstream policy diagnostic that consumes that evidence only diagnostically: protected demand is target-tier under-hit only, donors are over-concentration/fatigue only, donor surplus must be measurable, net-new volume is false, max slot increase is zero, slot ownership/floor/priority preservation are required, and blocked is a valid result rather than a repair prompt. A blocked unsafe candidate or a filter with no retained safe donor/protected material is a valid diagnostic result and should keep readiness at `needs_better_projection`. The comparison target is base planner-only no-repair versus filtered candidate planner-only no-repair; repaired projection and old prescribed plan shape are not targets. If a metric is not measured, do not treat hypothesis presence or positive evidence quality as a passing gate; unknown gates should remain unknown. The operator summary prints evaluated hypotheses, target-tier examples, hard-week skipped-set signal, interaction risk, legacy gate reporting, projection status/mode, candidate protected/donor counts, donor surplus evidence status/counts/measured-margin count/top reasons, pre-shadow filter status/counts, computed gate counts, conflict counts, slot-owned plan status/counts/next safe action, readiness, limitations, next safe action, and `consumedByDemandOrMaterializer=false`; detailed arrays, including full donor surplus evidence and full slot-owned protected/donor rows, stay in `v2-promotion-diffs`, not the main artifact.
- `plannerOnlyNoRepair.crossWeekProjectionGate` is the read-only readiness gate for the no-repair V2 debug index/shards. Read `week1Status`, `accumulationWeeksStatus`, `deloadStatus`, `replacementReadinessStatus`, `blockers`, `warnings`, and `missingInputs` before treating a clean Week 1 shape as migration evidence. Weeks 2-4 can move to `projected_with_limitations` when `plannerOwnedAccumulationProjection` exists, and deload can move to `projected_with_limitations` when `v2DeloadProjectionDiagnostic` preserves enough Week 1 identities without introducing movements. Both projections remain read-only and not planner-ready behavior until selection, accepted seed, and runtime replay consume them. `safeToPromoteBehavior` must remain `false` until those prerequisites and repair non-regression are all true.
- The pure V2 planner policy home is `src/lib/engine/planning/v2/*`. Audit code should consume that policy through planning-reality or mesocycle-explain adapters, then serialize/read out diagnostics here; do not move `v2TargetVsNoRepairDiff`, `crossWeekProjectionGate`, `v2ExerciseSelectionPlanDiagnostic`, `v2SelectionCapacityPlanDiagnostic`, `v2DeloadProjectionDiagnostic`, repair materiality, warnings/blockers, debug-artifact catalogs/manifests, or migration-slice readouts into the engine policy modules.
- `plannerOnlyNoRepair.v2SetDistributionIntent` is the flagged-only V2 set-distribution policy diagnostic. It records lane-level min/preferred/max set budgets from the V2 target skeleton and weekly progression multipliers, with cap/concentration policy kept as separate validation metadata. It is read-only, non-generative, and must not be treated as repaired projection parity, accepted seed truth, selection input, repair input, runtime replay input, receipt truth, or UI truth.
- `plannerOnlyNoRepair.plannerOwnedAccumulationProjection` is a flagged read-only Weeks 2-4 planner-owned projection. The cross-week projection shard carries its compact projection status and week counts by default. It derives from weekly demand, the V2 weekly progression model, V2 set-distribution intent, the upper/lower slot skeleton, and slot/lane roles; it does not derive from repaired projection, accepted seed, runtime replay, repair output, program-quality cleanup, or post-hoc set bumps.
- `plannerOnlyNoRepair.v2ExerciseSelectionPlanDiagnostic` is a flagged read-only identity/class-lane diagnostic. The selection-alignment shard carries its compact status, summary, and counts by default. Read its `status`, summary counts, `blockers`, `warnings`, `missingInputs`, and per-lane identity/class/set/duplicate/concentration/inventory/fatigue/capacity statuses before treating Week 1 no-repair identities as viable across accumulation. For Lower B, `hinge_compound` remains the narrow RDL/SLDL/deadlift-like hinge class; Glute Bridge / hip-thrust-like anchors may appear only as the explicit `low_axial_hip_extension_anchor` policy class, while generic `hinge` remains a mismatch against `hinge_compound` and knee-flexion curl remains its own required lane. Read `plannerOnlyNoRepair.lowAxialHipExtensionLimitation` with that lane diagnostic: it reports curl-vs-hip-extension Hamstrings contribution, true-hinge exposure count, low-axial limitation status, and Week 3-4 guidance to prefer curl expansion first, consider true hinge only when curl capacity/monotony or target pressure requires it and fatigue budget allows, and avoid adding Glute Bridge sets for hamstring delivery alone. Candidate alternatives and limitation guidance in these fields are evidence only; they are not replacement selections and must not feed selection, repair, seed, runtime replay, UI, receipts, or persistence.
- `plannerOnlyNoRepair.v2SelectionCapacityPlanDiagnostic` is a flagged read-only capacity/headroom diagnostic. The selection-alignment shard carries its compact status, summary, counts, per-lane inspection taxonomy, projection-only capacity trial design, and cap-delta behavior projection by default. Read its summary counts, blockers/warnings/missing inputs, and per-week lane classifications to separate target-met upper-pull session-cap pressure, optional suppressed lanes, and true below-min target-unmet blockers. A `capacityPolicyTrialDesign` is design input only; `capacityBehaviorProjection` may measure direct cap-delta effects from existing evidence, but materializer validity and acceptance remain unknown until a stronger read-only candidate projection reruns those seams. Neither field may promote behavior or feed selection, repair, seed, runtime replay, UI, receipts, or persistence.
- `plannerOnlyNoRepair.v2CapacityMaterializerProjection` is the stronger read-only candidate projection for a capacity trial. The materialization shard carries its detailed baseline-versus-trial dry-run comparison; the main/index output keeps compact status, identity/set deltas, gate counts, and next safe action. `candidateImpact.changedSlots` is compact row-level evidence from the engine-owned materialized-plan comparison helper; it is useful for inspection, not a behavior instruction. Read `targetSlot`, `candidateImpact`, `materializer`, `gates`, `blockersBeforeBehavior`, and `nextSafeAction` before considering implementation. Unknown acceptance or over-MAV gates, new duplicate/five-set/session-size failures, floor-critical lane loss, invalid materialization, incompatible seed shape, or `capacity_trial_no_candidate_impact` block behavior promotion. When the next safe action is `pivot_to_higher_roi_track`, leave capacity behavior untouched and move to candidate evaluator consolidation, materializer ranking/capacity cleanup, demand-zone projection, architecture-debt/readout cleanup, or acceptance/post-accept verification. This projection is evidence only and must not feed selection, repair, accepted seed serialization, runtime replay, UI, receipts, persistence, DB, or live V2 writes.
- `repairPromotionScoreboard.interpretation.setBudgetGapInventory` is the compact set-budget ladder inventory. Read it after capacity and taxonomy proofs: it lists representative set-budget rows with slot/lane/muscle, current budget, suspected needed budget, likely owner, evidence quality, training importance, and next measurement. `plannerOnlyNoRepair.v2SetBudgetMaterializerProjection` is the paired read-only measured proof. A no-impact result means the selected representative is diagnostic/no-impact for behavior promotion; a materializer delta is still only evidence until cross-week, acceptance, seed/runtime, and production non-consumption gates pass. This projection is evidence only and must not feed demand, weekly curves, slot allocation, canonical set policy, materializer ranking, selection, repair, accepted seed serialization, runtime replay, UI, receipts, persistence, DB, or live V2 writes.
- `repairPromotionScoreboard.interpretation.supportFloorGapInventory` is the compact support-direct-floor ladder inventory. Read it after capacity, taxonomy, and set-budget proofs: it lists support-floor rows with week/slot/lane/muscle, direct floor expected versus delivered, current and suspected budgets, likely owner seam, evidence quality, training importance, classification, and selected row. `plannerOnlyNoRepair.v2SupportFloorMaterializerProjection` is the paired read-only shadow proof. A no-impact result means the selected representative is diagnostic/no-impact for behavior promotion; if the selected row is owned by `audit_readout_cleanup`, fix readout evidence before changing `SetDistributionIntent` or support policy. This projection is evidence only and must not feed demand, weekly curves, slot allocation, support-lane policy, canonical set policy, materializer ranking, selection, repair, accepted seed serialization, runtime replay, UI, receipts, persistence, DB, or live V2 writes.
- `plannerOnlyNoRepair.v2LaneIntentMaterializerProjection` is the adjacent read-only materializer comparison harness for lane-intent trials. It currently defaults to a projection-only `upper_b:chest_second_exposure` shadow rerun that forces lane-intent consumption only inside the dry-run materializer call, reports baseline/trial materializer status, target-lane identity/set deltas, compact changed-slot rows, blockers before behavior, and a next safe action. The V2 debug index carries compact status/identity/set deltas, and the `v2-materialization` shard carries the detailed readout. It is not attached to production materializer policy or main artifact behavior. Treat `production_materializer_allowlist_unchanged`, `diagnostic_lane_intent_override_not_consumed_by_runtime`, `acceptance_gate_not_rerun`, and `lane_intent_trial_no_candidate_impact` as behavior-promotion blockers, not instructions to patch runtime or seed state.

Reusable V2 lane-intent promotion checklist:

1. Prove ontology correctness first. The exercise taxonomy must distinguish the intended training job from same-muscle or name-near substitutions before lane intent can mean anything.
2. Define the lane contract. Name required, preferred, and disallowed movement/class semantics; directness; stability/fatigue/loadability; duplicate/substitution policy; fallback behavior; and failure meaning.
3. Run audit-only projection. Compare baseline versus scoped trial or current consumed intent with explicit `readOnly`, `dryRunOnly`, non-consumption, and source-attribution guards.
4. Require acceptance/non-regression evidence. Positive identity or set deltas are not enough; total sets, target lane sets, protected coverage, blockers, materializer validity, acceptance/watch classification, and known regressions must be visible.
5. Promote only tiny owner-seam behavior. Production behavior, when justified, belongs in `V2LaneSelectionIntent -> ExerciseSelectionPlan -> V2 materializer consumption`; do not patch repair, runtime, receipts, UI, persistence, or acceptance thresholds.
6. Review the seed/runtime boundary after promotion. The executable seed must remain `slotPlanSeedJson.slots[].exercises[{ exerciseId, role, setCount }]`; runtime must not consume lane ids, lane intent, accepted planner metadata, diagnostics, or audit fields.
7. Apply the no-impact architecture rule. A no-materialized-change slice can still have architecture value only when it improves semantic correctness, ownership, benchmark fidelity, or safety; otherwise classify it as measured no-impact and pivot.
8. Stop the local lane thread after the seed/runtime boundary review unless concrete user-facing or read-model evidence appears. Do not keep iterating low-axial or any lane solely because the diagnostics are nearby.

- `plannerOnlyNoRepair.v2SupportLaneProjectionDiagnostic.laneBoundaryRows` is the support-lane boundary readout. It separates `supportPolicyAuthored`, `setDistributionBudgeted`, and `exerciseSelectionPreserved` so `status="authored_support_lane_dropped"` means the planner/set-distribution authored the lane but exercise selection/materializer capacity did not preserve it. The acceptance gate may treat a below-MEV dropped row as high-risk for a real persisted candidate, while non-floor drops remain watch items; these rows must not feed generation, selection, repair, seed, runtime replay, UI, receipts, or persistence.
- `plannerOnlyNoRepair.v2DeloadProjectionDiagnostic` is a flagged read-only Week 5 deload diagnostic. The cross-week projection shard carries its compact status, summary, and counts by default. Read its `status`, identity/projection basis, per-slot/lane preserved identities, `week1Sets`, `deloadProjectedSets`, `setReductionPercent`, `targetRir`, no-new-movement marker, warnings, blockers, and missing inputs before treating deload as projected. Integer set rounding can warn outside the 40-60% target band, and the diagnostic must not feed runtime deload generation, selection, repair, seed serialization, replay, UI, receipts, or persistence.
- `plannerOnlyNoRepair.v2BasePlanCompare` compares the clean materialized V2 base plan with planner-only no-repair output and repaired projection evidence. Use it to answer what the V2 base plan already solves, what production still relies on repair for, and what remains before bounded behavior promotion. Treat repaired projection as evidence only, not as target policy. The compare is `readOnly=true`, `affectsScoringOrGeneration=false`, and must not feed generation, selection-v2, repair, seed serialization, runtime replay, receipts, UI, persistence, or live writes.
- `plannerOnlyNoRepair.v2PlanQualityBenchmark` is the first compact first-principles benchmark for the V2 candidate itself. Read the gates in order: support floors, direct work, lane preservation, session size, fatigue distribution, duplicate/concentration risk, materializer omissions, and Week 1 trainability. Every gate reports an `evidenceSource` so pure V2 base-plan, shadow diagnostic, no-repair projection, materializer projection, acceptance-classification, and missing-evidence rows are not conflated. The support-floor, direct-work, lane-preservation, session-size, duplicate/concentration, and materializer-omissions gates prefer read-only pure V2 base-plan validation/compare evidence when present; legacy no-repair projection failures are fallback evidence about the old path, not the target policy. The session-size gate treats comparison-only weekly-set ambiguity as non-blocking when pure V2 slot-shape checks show no session-size risk; duplicate/concentration warnings should name the exact duplicate or class-family reuse and be read as watch items unless the owner evidence shows a regression or missing variant policy. Pure V2 optional direct top-up lanes that activate only with a clean alternative should not reuse the same weekly exercise identity; class-family-only reuse can be explicitly bounded when exact duplicate reuse is zero and base-plan regressions are zero. The fatigue-distribution gate is no-repair projection evidence unless a pure V2 projection is explicitly present, and its evidence should separate concentration-derived warnings, fatigue/collateral evidence, measured concentration deltas, `crossWeekReadiness`, donor-offset status/readiness, slot-week allocation readiness, blocker counts, alternate donor counts, regression causes, and missing acceptance gates before assigning policy ownership. As of the 2026-06-13 live audit, the slot/week allocation policy trial is measured and proves exact donor absorption before materialization for Calves in Weeks 2-4 (`lower_a:calves` 4 to 3, `lower_b:calves` 4 to 5, `netWeeklySetDelta=0`), with protected coverage preserved, no materializer regression, and no over/under-absorption rows. That exact bounded shape is now implemented in pure `SlotDemandAllocationByWeek`; the read-only audit projection is idempotent for the promoted 3/5 allocation and continues to prove non-regression instead of reapplying the move. As of the 2026-06-15 live audit after the low-axial/base-plan fix, the readout remains `slotWeekAllocationReadiness=candidate_for_acceptance_projection`, `blockedRows=0`, `slotWeekAllocationNextSafeSlice=run_acceptance_non_regression_projection`, and `slotWeekAllocationAcceptanceProjection.decision=accepted_with_watch_items` with benchmark `pass=5 warn=4 fail=0 missing=0 mustFixW1=0`; `materializer_omissions` is now a `pure_v2_base_plan` pass rather than unresolved evidence. Its watch classification is `accepted=6 boundedOwner=2 ownerFix=0 staleNoise=1 blockers=0`: accepted watches are bounded Week 1 trainability/readout warnings, bounded-owner watches are duplicate/class-family distinctness and fatigue/concentration projection rows with measured acceptance criteria, and stale/noise is the diagnostic-only lane-preservation shadow ambiguity. The stale standalone `base-plan-validation.test.ts` fixture is reconciled to the current V2 base shape (`63` sets, `20` exercises, no optional triceps materialization, one flat-allocation quality warning) and is not a blocker. Read `concentrationReadinessDecision`: `diagnostic_only` means keep measuring, `candidate_for_bounded_policy_design` means design a separate measured slice, `blocked_by_evidence` means inspect the named non-regression blocker before policy design, and `not_worth_pursuing` means pivot. After the bounded Calves slice, remaining concentration rows are readout/materializer cleanup unless a new measured owner-specific gate proves otherwise. A failed gate blocks deprecation recommendations; a missing gate stays missing instead of being inferred from repaired projection. The benchmark can say a repair path is ready for deprecation review only when the candidate evidence supports that review and non-consumption guardrails remain false for seed/runtime, production materializer, acceptance thresholds, and persistence.
- Implementation interpretation for the Calves slice: the only valid owner remains pure V2 `SlotDemandAllocationByWeek` in `src/lib/engine/planning/v2/slot-demand-allocation.ts`. The bounded helper/config lives there, and existing downstream pure V2 builders consume the adjusted allocation normally. Audit code may continue to prove the gates, but it must not become the production policy source and must not pass diagnostic fields into runtime. The change remains blocked/rollback-worthy if any gate differs from the proven shape: same muscle/lane only, source/donor `lower_a:calves -> lower_b:calves`, source `-1`, donor `+1`, net weekly delta `0`, protected coverage preserved, materializer non-regression, exact duplicate count clean, no must-fix Week 1 rows, no production materializer consumption, and no seed/runtime/receipt/DB consumption. Rollback criteria are any live read-only post-change regression in benchmark counts, watch classification counts, donor absorption, protected coverage, materializer identity/set/blockers, duplicate/concentration, or non-consumption boundaries.
- `plannerOnlyNoRepair.v2BasePlanShadowConsumptionTrial` is the read-only trial for the question "what would change if production projection consumed the clean V2 base plan?" It adapts the clean V2 base plan into the projection-comparison view, reports shadow/V2/no-repair/repaired set totals, diagnostic repair dependency delta, explicit classifications, and identity/materializer categories such as same identity, same class family, same slot/lane role, different acceptable clean alternative, true regression, unclear, and not comparable. It always reports `consumedByProduction=false`, `readOnly=true`, and `affectsScoringOrGeneration=false`; repaired projection remains evidence, not target policy, and the trial must not feed generation, selection-v2, repair, seed serialization, runtime replay, receipts, UI, persistence, or live writes.
- `plannerOnlyNoRepair.v2TargetVsNoRepairDiff` is the compact target-alignment scoreboard. It compares the V2 target skeleton to the experimental no-repair output; repaired projection is only a secondary reference for `repair_dependent` lanes or legacy rescue evidence, not the optimization target. Lane classifications use `v2SetDistributionIntent` as read-only set-policy evidence and surface only compact `setPolicy:*`, `setBudget:*`, `justification:*`, `selectionFeasibility:*`, `capacityPressure:*`, `capAwareExpansion:*`, and `expansionStatus:*` diagnostics rather than repeated policy objects. Read `setDistributionCapacityGapCount` as true active set-budget/capacity blockers; session-cap pressure, stale Week 1 calf readouts, and Week 4 cap-aware preferred-budget expansion are split into their own diagnostic counts.
- The serialized artifact may further compact these V2 sections with local catalogs, target-descriptor sources, set-budget grids, selected-exercise strings, omitted counts, and bounded evidence arrays. This does not change the in-memory diagnostic consumed by the CLI summary and does not affect generation, scoring, repair, seed serialization, runtime replay, receipts, UI, or persistence.
- No-repair concentration rows remain severity-bucketed as `acceptanceFailures`, `qualityWarnings`, `diagnosticRows`, and `ignoredRows`, then roll up into `acceptanceClassification.hardBlockers`, `qualityWarnings`, `diagnosticOnly`, and `sessionShaping`. Acceptance failures are true blockers only. For intentionally trained primary hard targets, `<50%` single-exercise share is not reported, `50-60%` is a quality warning when the target is met and required lanes are present, and `>60%` remains an acceptance blocker unless explicitly justified; 50-60% also blocks when the primary target is below minimum, the row was repair/set-bump created, a fatigue/cap or required-lane defect exists, a clean alternative was ignored while the target remains under-distributed, or a compound/hinge/heavy press exceeds 5 sets. Clean support/direct-work concentration is a non-blocking quality warning, secondary or implicit collateral is diagnostic-only, and tiny denominator artifacts such as Forearms/Core/Adductors collateral are diagnostic/session-shaping readout unless a fatigue cap or explicit target policy is exceeded.
- `acceptanceClassification.migrationScoreboard` carries `materialRepairCount`, `majorRepairCount`, suspicious repairs, repaired-vs-no-repair readiness, and the reason replacement is not ready. It gates replacement/promotion review, not basic no-repair Week 1 shape validity.

Artifact-only before/after comparison:

```powershell
npm run audit:mesocycle-explain:compare -- --before <before-artifact.json> --after <after-artifact.json>
```

- Reads existing `mesocycle-explain` JSON files only; it does not run live audits, import DB/Prisma, mutate state, or alter artifact serialization.
- Auto-detects a linked V2 debug artifact from `mesocycleExplain.plannerOnlyNoRepair.debugArtifact.relativePath`. Old single sidecars and new `v2_debug_index` artifacts are both supported; the compare helper reads focused shards when an index links them and continues with main-only metrics if the linked artifact is absent.
- Use `--json` for machine-readable output, or `--include-sidecar false` to force main-artifact-only comparison.

Optional targeting:

```powershell
npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com --source-mesocycle-id <source-mesocycle-id> --retrospective-mesocycle-id <retrospective-mesocycle-id>
```

Inspect first:
- CLI `Planning Reality Summary` when present
- CLI `Architecture Signal` inside `Planning Reality Summary` when present
- `mesocycleExplain.preview.designBasis`
- `mesocycleExplain.preview.slotPlans`
- `mesocycleExplain.preview.projectionDiagnostics`
- `mesocycleExplain.preview.projectionDiagnostics.planningReality`
- `mesocycleExplain.seed.slotPlans`
- `mesocycleExplain.seed.provenanceConsistency`
- `mesocycleExplain.reality.runtimeDrift`
- `mesocycleExplain.reality.runtimeDrift[*].runtimeDriftLabels`
- `mesocycleExplain.comparison.previewVsSeed`
- `mesocycleExplain.comparison.seedVsReality`
- `mesocycleExplain.limitations`

Important interpretation rule:
- preview-side slot obligation and carry-forward continuity can be reconstructed truthfully from canonical handoff seams
- `preview.projectionDiagnostics` is a read-only projection diagnostics block, not an error list; use it to inspect set stacking pressure, duplicate exercise pressure, diversity penalties, hinge/squat balance, isolation injection triggers, and soft-cap overrides by P0 weekly obligations / slot identity
- `preview.projectionDiagnostics.preselectionDemands` shows the bounded slot-owned demand promoted before slot-local selection and whether selected exercise composition consumed it before final repair. For this first behavior step, consumed soft Side Delts preselection demand is allowed to satisfy the meaningful projection floor and is reported through `preselection_demand_consumed` rather than forcing extra late support identities.
- `preview.projectionDiagnostics.planningReality` is also read-only; use it to inspect weekly muscle demand ownership, shadow upstream demand/allocation, pre-final vs final projected delivery, repair materiality, per-exercise concentration, slot prescription intent, set distribution intent, and warnings such as `SLOT_ALLOCATION_NOT_EXPLICIT`, `SUPPORT_FLOOR_CLOSED_LATE`, `FINAL_CAP_TRIM_REQUIRED`, and `EXERCISE_CONCENTRATION_HIGH`. The shadow fields compare `shadowWeeklyDemand` and `shadowSlotDemandAllocation` against `initialSlotComposition` and `finalSlotPlan`, then mark repair rows in `repairMaterialityAfterShadowAllocation` that likely represent demand which should move upstream before exercise selection. `weakPreselectionConsumption` flags consumed preselection demand with `targetMet=false`; treat that as a failed or weak promotion signal, even when selected effective sets are nonzero. `slotPrescriptionIntents` summarizes what each slot owns before future selection work consumes it: demand types (`direct_required`, `overlap_preferred`, `direct_if_under_floor`, `soft_direct_allowed`, `diagnostic_only`, `do_not_train_here`), allowed/forbidden patterns and exercise classes, collateral caps, movement-lane intent, set/diversity/fatigue budgets, and compact repair buckets. `setDistributionIntents` summarizes how that owned demand should be distributed: preferred spread, single-exercise and single-pattern shares, per-exercise/direct-exercise limits, at-limit action, and compact concentration/cap-cleanup/repair-owned evidence. `preselectionDistributionPolicyByWeek` turns those same rows into an explicit read-only shadow policy: Week 1 is populated from current projection evidence; Weeks 2-4 are explicitly unprojected when weekly demand curves, accumulation progression policy, per-week slot distribution, or fatigue carryover are missing; deload is explicitly unprojected when identity preservation and set-reduction projection are missing. `weeklyDemandCurve` is the companion full-mesocycle readout: Week 1 carries current demand evidence, Weeks 2-4 are limited by missing per-week slot distribution, fatigue carryover, and exercise-continuity policy, and deload explicitly reports missing demand/identity/set-reduction projection. Read its cross-week warnings before promoting behavior: Chest under-target, Hamstrings overdelivery, Side Delts under-target, duplicate/concentration fatigue, collateral risk, missing deload preservation, and missing weekly policy are diagnostic blockers, not active generation behavior. Its candidate gate keeps Chest upper-slot distinct exercise distribution blocked until the artifact can answer whether the change improves Weeks 1-4, preserves deload quality, and avoids increasing fatigue concentration. Its candidate behavior slices should be read as future behavior triage, not active generation policy; Chest upper-slot distinct exercise distribution is the best future behavior after week-by-week projection exists, while Hamstrings, Side Delts, duplicate main-lift, and calf slices remain diagnostic/not-first/later cleanup according to their risk and prerequisites. `preselectionFeasibility` currently evaluates only `lower_b` Hamstrings and should be read before promoting that demand: `clean_candidate` requires explicit clean-route evidence, while Back Extension closure, Glutes/Lower Back collateral, Stiff-Legged Deadlift concentration, cap cleanup, suspicious repair, or weak-preselection risk keeps the recommendation out of promotion. Its `candidateInventory` answers whether clean lower-compatible Hamstrings curl inventory exists even when those curls are absent from `lower_b`; read each row's `candidateClass`, `lowerSlotCompatible`, `lowerBCompatible`, `alreadySelectedSlotIds`, `availability`, and `reasons` to distinguish available curl inventory, prior lower-slot use, duplicate pressure visibility, lower_b capacity, dirty Back Extension closure, and classification bridge mismatches between inventory `flexion` patterns and slot prescription `isolation`/`knee_flexion_curl` intent. `distributionGuardActions` records the bounded late-repair trial that blocks set bumps into exercises already over the single-exercise share limit, including whether the bump was rerouted to a clean existing alternative or left unresolved. When present, `forbiddenCleanupReroute` identifies exercises removed by forbidden cleanup, the affected hard muscles, any clean compatible reroute target, and unresolved demand left intentionally instead of adding bad collateral. Read `shadowRepairSummary`, `promotionCandidates`, `suspiciousRepairsNotEligibleForPromotion`, `weakPreselectionConsumption`, `preselectionFeasibility`, `preselectionDistributionPolicyByWeek`, `weeklyDemandCurve`, `forbiddenCleanupReroute`, `distributionGuardActions`, `slotPrescriptionIntents[*].diagnostic`, and `setDistributionIntents[*].evidence` together so promote-ready upstream demand is not confused with remaining cleanup, blocked forbidden cleanup, weak consumption, set-bumping concentration, unprojected future weeks, or bad downstream repair artifacts. When `rearDeltCollateralSummary` appears, treat it as the Rear Delts promotion guard: consumed preselection demand alone is not success if Upper Back collateral, pull concentration, cap trim/removal, or suspicious repairs worsen.
- In `preselectionDistributionPolicyByWeek`, Week 1 row-level evidence, limitations, and affects are compacted through section-local `evidenceCatalog`, `limitationCatalog`, and `affectsCatalog` refs. Resolve refs locally when inspecting a row; the compact shape is artifact/readout-only and does not change operator conclusions or runtime behavior.
- In `weeklyDemandCurve`, muscle rows are compacted through section-local `sourceCatalog`, `limitationCatalog`, and `muscleCatalog` refs. Resolve refs locally when inspecting a row; week-level limitations are hoisted and still apply to each row in that week. The compact shape is artifact/readout-only and does not change operator conclusions or runtime behavior.
- The written `mesocycle-explain` artifact may additionally compact large `planningReality` sections through serializer-only catalogs, representative rows, and omitted counts. `accumulationWeekProjection` stores repeated Week 1 shape once as representative projected muscles/slot risks; repair/materiality, prescription, distribution, and class sections keep summaries plus resolvable refs; `preselectionFeasibility` keeps the clean/dirty candidate rows with an inventory summary for omitted tail rows; flagged `plannerOnlyDryRun` keeps failed/partial checks, top unresolved demand, active repair dependencies, and calves blockers while summarizing passing/within/inactive rows. Flagged `plannerOnlyNoRepair` now keeps V2 details and full cross-week gate detail out of the main artifact and exposes compact domain shards through the optional debug index. The CLI operator summary still reads the full in-memory diagnostic, so artifact splitting is output-size control only, not changed diagnostic meaning.
- `slotDemandAllocationByWeek` is the read-only bridge between `weeklyDemandCurve` and future per-week preselection distribution. Read it to answer which slots own Week 1 Chest, Lats, Quads, Hamstrings, Side Delts, and Calves demand, and to confirm whether Weeks 2-4 or deload are explicitly unallocated because per-week slot composition, fatigue carryover, progression-adjusted targets, duplicate justification, weekly exercise identity policy, deload identity preservation, or deload set-reduction projection are missing. Its warnings are promotion gates only; they do not alter generation, repair, accepted seeds, or runtime replay.
- `exerciseClassDistributionBySlot` is the read-only bridge from slot-owned demand to future class-level selection intent. Read it for diagnostic class intent only: distinct upper-slot Chest classes, lower_b Hamstrings hinge plus knee-flexion curl, low-collateral Side Delt options, Rear Delts/Triceps collateral cautions, Calves duplicate-isolation caution, and repeated exercise justification requirements. It does not select exercises or alter generation, repair, accepted seeds, receipts, UI, or runtime replay.
- `exerciseClassAlignment` is the compact read-only comparison of planner class intent, initial slot-selected exercise classes, and final repaired exercise classes. Read it to answer whether slot-local selection satisfied class intent, whether repair improved or worsened that alignment, whether identity churn occurred, and whether duplicates such as Incline DB Bench, Lat Pulldown, SLDL, Barbell Back Squat, or same-session calf isolation variants are class-aligned but duplicate-policy risky. Read the sibling `exerciseClassUnresolvedCauses` before proposing behavior: it classifies notable unresolved rows by likely owner so selection blind spots, inventory/classification gaps, duplicate/continuity conflicts, support-floor late repair, cap cleanup/final shaping, repair identity churn, true unresolved demand, and diagnostic-only rows do not get the same fix. Then read `duplicateContinuityJustification` for the duplicate-specific explanation: which exercise or same-session variant repeated, why it may have been allowed, whether a clean alternative was visible, and whether future planner policy should allow, discourage, block, or require an explicit planner decision. These fields are diagnostic-only and must not be used as active selection, repair, seed, receipt, UI, or runtime replay policy.
- `seed.provenanceConsistency` is a compact read-only label for accepted-seed provenance only. Use `status` and warning codes to distinguish authorship from replay/readout paths: `slotPlanSeedJson.source` is the persisted seed author/source label, `acceptedPlannerIntent.source` is planner metadata, `compositionSource` is runtime replay provenance, `exerciseSource` is Program read-model provenance, and `generationPath` is audit execution provenance. This field must not be used to change accepted seed shape, materialization, runtime replay, Program/Home/UI rows, scoring, or generation.
- Read `cleanupCandidateFeasibility` before proposing duplicate-cleanup behavior. For `lower_b_calf_duplicate_cleanup`, `not_feasible_under_current_caps` means one retained lower_b calf isolation cannot preserve the Calves support floor under the current per-exercise/direct-exercise/slot caps; block the cleanup trial and treat the next decision as support-floor distribution, lower_a allocation, or calf specialization policy. Only `recommendation="safe_to_trial"` should unblock a future duplicate-cleanup trial.
- `accumulationWeekProjection` is the next read-only bridge after slot allocation. Read it as a conservative repeated-Week-1 diagnostic, not a true progression forecast: it projects the current final slot-plan shape across later accumulation/peak weeks, flags persistent Chest under-target, Hamstrings overdelivery, Side Delts under-target, duplicate main-lift reuse, collateral fatigue, and still-unprojected deload preservation, and emits candidate readiness. Treat `ready_for_bounded_trial` for Chest upper-slot distinct exercise distribution as a diagnostic promotion signal only when Chest shortfall and Chest concentration/duplicate evidence are both present across the repeated-shape projection.
- When `planningReality` exists, classify the architecture signal from its own fields: `summary.planningShape`, `summary.materialRepairCount`, `summary.majorRepairCount`, warnings, repair materiality, repair rows after shadow allocation, exercise concentration, set-distribution intents, and slot-demand allocation. The operator readout should include planning shape, repair counts, likely upstream-avoidable material repairs, remaining repairs, suspicious rows, promotion candidates, set-distribution evidence, quarantine groups, ranked gap inventory, selected measured proof, benchmark status, repair deprecation roles, missing proof before behavior, and the highest-leverage next move. When `plannerOnlyNoRepair.repairPromotionScoreboard.interpretation.legacyRepairQuarantine` exists, treat it as the compact quarantine verdict: repaired projection is legacy evidence, behavior candidates are only the scoreboard's positive slot-owned rows, and quarantined/stale/safety rows must not become target policy.
- When the CLI prints `planningReality size breakdown`, treat it as readout-only budget telemetry. It does not add an artifact field or change diagnostic semantics; the byte counts come from stable serialized JSON size for each top-level `planningReality` field.
- When `repairMaterialityAfterShadowAllocation` exists, classify material repairs into three buckets:
  - promote-ready upstream demand: `likelyAvoidableWithShadowAllocation=true`, meaning bounded slot-owned demand may move into pre-selection planning
  - remaining repair/cap cleanup: not likely avoidable and not owned elsewhere, meaning set distribution / concentration / cap policy is the likely next surface
  - suspicious downstream repair that must not be promoted: `shadowAllocationBasis="weekly_demand_owned_elsewhere"`, meaning the repair is in a slot that shadow allocation says does not own that muscle
- Mostly repair-shaped output points toward upstream WeeklyMuscleDemand -> SlotDemandAllocation ownership before selection. Likely avoidable repairs should promote only bounded, slot-owned, non-suspicious demand. Suspicious repairs are blockers before promotion; for example, `lower_b Chest via Cable Crossover` is not eligible for upstream promotion when Chest is owned by upper slots / elsewhere in shadow allocation. If remaining repairs are mostly cap cleanup, tune set distribution or concentration policy rather than demand allocation.
- Safe Promotion Trial Protocol for shadow-owned demand promotion:
  1. Establish a baseline with `npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com --operator-debug`.
  2. Record `materialRepairCount`, `majorRepairCount`, `likelyAvoidableMaterialRepairCount`, `remainingMaterialRepairCount`, `suspiciousRepairsNotEligibleForPromotion` count, `promotionCandidates` count, and the specific suspicious repair list.
  3. Promote exactly one bounded candidate class at a time, such as `upper_b Side Delts support demand`, `upper_a Rear Delts support demand`, `upper_b Triceps support demand`, or `lower_b Hamstrings primary/support demand`. Do not promote all candidates together.
  4. Re-run the same `mesocycle-explain --operator-debug` command and compare before/after deltas.
  5. Keep the change only when `materialRepairCount` decreases, `majorRepairCount` decreases or does not worsen, suspicious repair count does not increase, known blocked smells remain blocked, slot/body-region compatibility remains valid, and runtime replay plus seed persistence are unchanged.
  6. Revert when `materialRepairCount`, `majorRepairCount`, or suspicious repair count increases; when `weakPreselectionConsumption` appears for the promoted demand; when `lower_b Chest via Cable Crossover` or a similar bad repair becomes planned policy; when set concentration worsens materially; or when new cross-region demand appears. For Rear Delts trials, also revert any `rearDeltCollateralSummary.verdict` of `mixed_collateral` or `worse_collateral`; direct Rear Delts closure is only clean when the total program avoids new suspicious repair, pull-concentration, cap-trim, and Upper Back collateral burden.
  7. Every attempt must answer: Did repair burden drop? Did new suspicious repairs appear? Did repair shift into another slot or muscle? Did concentration/cap cleanup worsen? Did runtime seeded replay change? Did `slotPlanSeedJson` persistence change?
  8. Lessons from prior promotion trials: use the meaningful projection floor before full soft support landmarks; do not assume slot-owned candidates are safe without checking collateral set distribution; do not promote hard primary demand by bumping existing sets without concentration review; never promote suspicious cross-region artifacts.
- Behavior Trial Gate: a local target improvement is not sufficient. A dry-run candidate is keepable only when the intended metric or structural issue improves and `materialRepairCount`, `majorRepairCount`, suspicious repairs, high exercise concentration, weak preselection consumption, and forbidden final-primary violations do not regress versus baseline.
- accepted historical per-exercise ranking rationale is not recoverable unless it was explicitly persisted
- the artifact must therefore keep `persisted`, `reconstructed`, and `unavailable` explanation sources distinct
- runtime-added exercises are labeled as runtime edits when evidence exists; they should not be read as accepted-seed quality failures unless seed-vs-reality also supports that conclusion

Common red flags:
- `seed.available=false` when the retrospective mesocycle should have a canonical accepted seed
- `comparison.previewVsSeed.slotDiffs[*].comparable=false` for slots you expected to align
- `reality.runtimeDrift[*].seedDrift.addedExerciseIds.length > 0` without a corresponding mutation explanation
- any consumer treating unavailable historical ranking as persisted truth

Escalate when:
- preview slot plans disagree with the canonical handoff/slot-plan projection seams
- `planningReality.summary.planningShape` is mostly repair-shaped with material or major repairs and the next proposed fix would add more downstream repair instead of upstream demand/allocation ownership
- `planningReality.exerciseConcentration` shows an exercise over 5 sets or supplying more than half of a muscle's weekly projected stimulus, especially when produced or increased by repair
- `planningReality.slotDemandAllocation` shows explicit weekly demand not being satisfied locally in the slot that owns it
- accepted seed normalization fails for a mesocycle that should have `slotPlanSeedJson`
- runtime drift appears without corresponding generated-vs-saved or slot-identity evidence
- someone is relying on unavailable historical ranking rationale as if it were persisted truth

### `v2-accepted-seed-prepare-compare`

When to use it:
- inspect a live `AWAITING_HANDOFF` candidate at the handoff acceptance seam
- compare legacy accepted-seed preparation with the disabled V2 preparation preview
- verify the V2 path stays preview-only before any production write slice is considered

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode v2-accepted-seed-prepare-compare --owner <owner-email>
```

Optional explicit candidate:

```powershell
npm run audit:workout -- --env-file .env.local --mode v2-accepted-seed-prepare-compare --owner <owner-email> --mesocycle-id <handoff-mesocycle-id>
```

Inspect first:
- `v2AcceptedSeedPrepareCompare.boundaryFacts`
- `v2AcceptedSeedPrepareCompare.availability`
- `v2AcceptedSeedPrepareCompare.seedShapeComparison`
- `v2AcceptedSeedPrepareCompare.identityCoverageComparison.identitySummary`
- `v2AcceptedSeedPrepareCompare.provenance`

Guardrails:
- the mode resolves the latest pending handoff candidate when no explicit mesocycle id is supplied
- it calls `prepareV2AcceptedSeedPreparationCompare()` with real handoff context
- it is read-only, writes no transaction, mutates no DB rows, and is not consumed by production
- V2 preview availability and production-write eligibility are separate fields; production-write eligibility remains false here
- V2 preview preparation does not call legacy projection or repair, and seed serialization identity must remain `buildMesocycleSlotPlanSeed`
- detailed compare rows live in the mode's compact artifact section, not in `mesocycle-explain`

### `ops:refresh-next-seed-draft`

When to use it:
- repeat the V2 next-seed draft refresh ceremony with fewer manual steps
- guard against calling the Trainer refresh route on the wrong localhost app
- pair the refresh route with the handoff dry-run and acceptance gate every time

Command pattern:

```powershell
npm run ops:refresh-next-seed-draft -- --origin http://localhost:<TRAINER_PORT> --owner <owner-email> --source-mesocycle-id <source-mesocycle-id>
```

Interpretation rules:
- this is the only operator script that performs the refresh; it keeps mutation limited to `POST /api/mesocycles/[id]/refresh-next-seed-draft`
- it does not accept the next cycle and does not create workouts, logs, sessions, migrations, repair rows, backfills, or direct SQL changes
- it requires explicit `--origin`, `--owner`, and `--source-mesocycle-id`; never assume `localhost:3000`
- because no reliable app identity endpoint exists, it checks the home page for `Personal AI Trainer` before calling the route and documents that limitation in stdout
- it reads source state, visible draft source, and before/after safety counts through read-only Prisma
- it fails unless the source is `AWAITING_HANDOFF` and the visible draft source is `v2_materialized_seed`; `--allow-non-v2-draft-source` is available only for an explicitly reviewed starting point
- after refresh it runs `next-mesocycle-handoff-dry-run --no-artifact --operator-debug` and `next-mesocycle-acceptance-gate --no-artifact --operator-debug`
- it exits nonzero for wrong app origin, non-handoff source state, refresh failure, unexpected successor/workout/log/session count changes, or acceptance-gate `rejected` / `not_runnable`

### `next-mesocycle-handoff-dry-run`

When to use it:
- rehearse the real next-mesocycle handoff preparation path without accepting the successor
- inspect what the accept flow would prepare before the transaction boundary
- distinguish persisted draft truth, prepared projection evidence, and diagnostic previews before running the acceptance gate

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode next-mesocycle-handoff-dry-run --owner <owner-email> --source-mesocycle-id <source-mesocycle-id> --no-artifact --operator-debug
```

Inspect first:
- `nextMesocycleHandoffDryRun.summary`
- `nextMesocycleHandoffDryRun.persistedDraftTruth`
- `nextMesocycleHandoffDryRun.wouldPrepareWriteSummary`
- `nextMesocycleHandoffDryRun.candidateIdentity`
- `nextMesocycleHandoffDryRun.seedShapeSummary`
- `nextMesocycleHandoffDryRun.acceptanceGatePayloadSummary`
- `nextMesocycleHandoffDryRun.weekOneRuntimeReplayPreview`
- `nextMesocycleHandoffDryRun.safety`

Interpretation rules:
- `writes` must always be `no`; this mode never calls the acceptance transaction and never creates a successor mesocycle
- if the source is not `AWAITING_HANDOFF`, preparation is not called and `blockingReason=source_not_awaiting_handoff`
- when the source is `AWAITING_HANDOFF`, the mode calls `prepareMesocycleHandoffAcceptance()` and stops before `acceptPreparedMesocycleHandoffInTransaction()`
- when `nextSeedDraftJson.acceptedSeedDraft.source = "v2_materialized_seed"` exists, `persistedDraftTruth` is the candidate truth; prepared legacy projection fields are compatibility/diagnostic evidence only and must not be accepted as equal truth
- candidate identity comes from persisted accepted-draft rows when present, otherwise from prepared `slotPlanSeedJson` rows; it never comes from `mesocycle-explain` repaired/no-repair diagnostic previews
- seed compatibility is reported against the existing `buildMesocycleSlotPlanSeed` serializer and runtime seed parser; executable seed rows remain only `exerciseId`, `role`, and `setCount`
- Week 1 preview is a seed-order expectation preview unless a persisted successor exists; full runtime replay still requires post-accept active mesocycle context
- use `next-mesocycle-acceptance-gate` after this mode when you need the final readiness decision

### `next-mesocycle-acceptance-gate`

When to use it:
- final read-only checklist before accepting a pending next-mesocycle candidate
- deload/handoff boundary checks where a manual operator review would otherwise combine `mesocycle-explain`, `v2-accepted-seed-prepare-compare`, weekly volume, and recent retro evidence by hand
- confirming that a diagnostic preview is not being mistaken for an accepted or draft candidate

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode next-mesocycle-acceptance-gate --owner <owner-email> --source-mesocycle-id <source-mesocycle-id> --no-artifact --operator-debug
```

Inspect first:
- `nextMesocycleAcceptanceGate.candidateIdentity`
- `nextMesocycleAcceptanceGate.gateResult`
- `nextMesocycleAcceptanceGate.decisionSummary`
- `nextMesocycleAcceptanceGate.gates`
- `nextMesocycleAcceptanceGate.weeklyMuscleTable`
- `nextMesocycleAcceptanceGate.watchItems`
- `nextMesocycleAcceptanceGate.findings`
- `nextMesocycleAcceptanceGate.completedBlockEvidence`
- `nextMesocycleAcceptanceGate.priorBlockRecurringRisks`
- `nextMesocycleAcceptanceGate.doNotFixNotes`
- `nextMesocycleAcceptanceGate.diagnosticPreview`

Interpretation rules:
- `gateResult` is the final read-only decision: `not_runnable`, `rejected`, `accepted_with_watch_items`, or `accepted`
- `candidateFound=false` means the gate is `not_runnable`; rerun after the source reaches `AWAITING_HANDOFF` and a persisted handoff candidate exists
- source state, missing persisted candidate, active deload incompletion, and incomplete workouts are blockers, not acceptance failures to override
- `mesocycle-explain` preview evidence is labeled `diagnostic_preview_not_candidate`; it can inform the gate but cannot satisfy candidate identity by itself
- gate rows and remediation rows use severity values `blocker`, `high_risk`, `warning`, `info`, and `pass`; every blocker/high-risk/warning finding names the owner seam, smallest safe fix, and whether it must be fixed before Week 1
- reusable candidate-quality computation is owned by `src/lib/audit/workout-audit/next-mesocycle-candidate-evaluator.ts`; `next-mesocycle-acceptance-gate.ts` remains the read-only decision wrapper that turns those assessments into gate rows, findings, watch items, and the final `gateResult`
- `/mesocycles/[id]/setup` may display a compact persisted-candidate presentation of this gate immediately before its acceptance controls. The adapter is read-only and informational: unsaved or newly refreshed drafts require a rerun, and the UI must not plan, repair, reseed, accept, or use audit diagnostics as executable policy.
- `decisionSummary` separates `trainability`, `plannerMaterializerQuality`, and `repairBurden`; a trainable candidate can still carry planner/materializer quality warnings. `repairBurdenSource` and `repairBurdenClassification` label whether repair burden is candidate truth, legacy diagnostic context, architecture debt, or a noisy watch item; high raw repaired-projection counts are not automatically acceptance failures. `materializerGuardrailClassification` compactly labels existing planning-reality and V2 materializer diagnostics as exercise metadata, selection/ranking, capacity, diagnostic/legacy context, none, or unavailable; when exercise metadata gaps exist, `materializerGuardrailEvidence` may include compact `metadataGapExamples` from read-only unresolved-cause and V2 selection diagnostic rows. It is a readout for the next architecture slice, not acceptance scoring or materializer policy. `shadowConsumptionClassification` labels the V2 base-plan shadow-consumption trial as diagnostic evidence only, and must not be read as production consumption, accepted-seed readiness, or acceptance-threshold policy.
- `watchItems` are not blockers; they are risks to monitor through pre-session checks when a candidate is otherwise trainable
- `Week 1 trainability` should fail for missing/failed base validation or incompatible seed shape; `base=pass_with_warnings` with compatible seed shape is a watch item requiring post-accept verification, not an automatic rejection
- `completedBlockEvidence` summarizes read-only weekly-retro evidence from the completed accumulation block, including MEV fragility, runtime add-ons, load calibration drift, target-semantics noise, and optional gap-fill dependency risk; it separates evidence, hypothesis, acceptance implication, and required fix, still prints when no candidate exists, and does not force implementation unless the persisted candidate repeats a real failure
- volume rows use the current target semantics: below MEV is the floor issue, above MEV but below target is informational, target near MAV is cap caution rather than a quota, and over MAV is a cap warning
- `doNotFixNotes` explicitly lists readout states that should not trigger planner/materializer work by themselves, including below-target/above-MEV rows and diagnostic-preview failures before a candidate exists
- this mode writes no DB rows, creates no workouts/logs/sessions, mutates no seed, and changes no planner/materializer/runtime/generation behavior

### `next-mesocycle-post-accept-verification`

When to use it:
- immediately after the explicit accept-next-cycle flow creates the successor mesocycle
- before training Week 1 of the successor
- when the handoff dry-run and acceptance gate were clean but you still need proof that persisted runtime replay is safe

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode next-mesocycle-post-accept-verification --owner <owner-email> --source-mesocycle-id <completed-source-mesocycle-id> --mesocycle-id <accepted-successor-mesocycle-id> --no-artifact --operator-debug
```

`--mesocycle-id` is optional, but should be supplied when the accepted successor id is known. The mode verifies that the resolved successor is the requested id.

Inspect first:
- `nextMesocyclePostAcceptVerification.verificationResult`
- `nextMesocyclePostAcceptVerification.sourceMesocycle`
- `nextMesocyclePostAcceptVerification.successorMesocycle`
- `nextMesocyclePostAcceptVerification.seedContract`
- `nextMesocyclePostAcceptVerification.slotSequence`
- `nextMesocyclePostAcceptVerification.futureWeekReplay`
- `nextMesocyclePostAcceptVerification.prescriptionConfidence`
- `nextMesocyclePostAcceptVerification.projectedWeekVolume`
- `nextMesocyclePostAcceptVerification.readModels`
- `nextMesocyclePostAcceptVerification.provenance`
- `nextMesocyclePostAcceptVerification.checks`
- `nextMesocyclePostAcceptVerification.safety`

Required checks:
- source mesocycle is completed and inactive
- successor mesocycle is active, `ACTIVE_ACCUMULATION`, linked to the same macrocycle as source, and `mesoNumber = source.mesoNumber + 1`
- optional requested successor id matches the linked active successor
- when a pre-accept persisted V2 accepted seed draft exists, the successor seed source, hash, anchor rows, row count, and slot order match that exact draft
- `slotPlanSeedJson` exists, parses, and has set-aware executable exercise rows
- executable seed exercise rows contain only `exerciseId`, `role`, and `setCount`
- persisted slot sequence exists and matches seed slot order
- Week 1 future-week generation uses `compositionSource="persisted_slot_plan_seed"`
- generated Week 1 exercise order and set counts match the accepted seed for the next slot
- projected-week-volume runs against the successor and every projected session matches the accepted seed for its slot
- Program/Home read models are seed-backed (`persisted_slot_plan_seed` / `mesocycle_slot_sequence`)
- no legacy fallback, reselection, or order drift appears in future-week or projection output
- successor Week 1 standard generation is not deload-rerouted
- receipt/provenance/read-model composition source are coherent
- Week 1 prescriptions expose usable exercise, progression, confidence, source classification, and caution readouts

Interpretation rules:
- `safe_to_train` means the persisted successor is ready for Week 1 training.
- `watch_items` means the successor is trainable only after reading the warning/unknown checks.
- `blocked` means at least one must-fix check failed before Week 1.
- `not_runnable` means the accepted successor context is missing or not inspectable yet.
- `prescriptionConfidence` is a readout over existing generated prescription evidence. It can classify rows as `exact_history`, `recent_history`, `stale_history`, `estimated`, `missing`, `load_calibration_drift`, `exercise_new_to_user`, or `runtime_only`; it does not recompute loads, change progression policy, or mutate prescriptions.
- This mode is post-accept only. It does not replace `next-mesocycle-handoff-dry-run` or `next-mesocycle-acceptance-gate`.
- This mode writes no DB rows, creates no mesocycles, creates no workouts/logs/sessions, mutates no seed shape, and changes no planner/materializer/runtime/generation behavior.

Common red flags:
- successor id is missing, not active, not `ACTIVE_ACCUMULATION`, or not the active mesocycle
- source is not `COMPLETED` and inactive
- successor seed source/hash/anchors differ from the pre-accept persisted V2 accepted seed draft
- seed rows include extra executable fields beyond `exerciseId`, `role`, and `setCount`
- slot order differs between `slotSequenceJson` and `slotPlanSeedJson`
- future-week or projected-week-volume does not report `persisted_slot_plan_seed`
- projected sessions mismatch the accepted seed by exercise id, set count, or order
- read models fall back to linked workout structure, projected-week rows, or legacy weekly schedule
- provenance reports invalid/suspicious seed or receipt composition source
- `prescriptionConfidence` is missing, `runtime_only`, dominated by estimated/missing loads, or reports load-calibration drift that should be reviewed before Week 1 execution

### `replace-empty-mesocycle-with-v2`

When to use it:
- one explicitly identified active accumulation mesocycle was just created and has no performed reality
- the operator wants to dry-run replacement of that empty seed with a V2-authored accepted seed
- the target mesocycle id and owner email are known and must both be supplied

Dry-run command:

```powershell
npm run audit:workout -- --env-file .env.local --mode replace-empty-mesocycle-with-v2 --owner <owner-email> --mesocycle-id <active-empty-mesocycle-id> --replace-empty-active-mesocycle-with-v2 --dry-run
```

Guarded write command:

```powershell
npm run audit:workout -- --env-file .env.local --mode replace-empty-mesocycle-with-v2 --owner <owner-email> --mesocycle-id <active-empty-mesocycle-id> --replace-empty-active-mesocycle-with-v2 --write --confirm-empty-mesocycle-replacement
```

Replacement semantics:
- preserves the existing mesocycle id and `slotSequenceJson`
- updates only `Mesocycle.slotPlanSeedJson`
- uses `buildMesocycleSlotPlanSeed()` through the V2 accepted-seed preparation helper
- writes no workouts, workout exercises, workout sets, set logs, receipts, or runtime replay data
- does not change the default handoff accept route

Inspect first:
- `replaceEmptyMesocycleWithV2.candidateSafety`
- `replaceEmptyMesocycleWithV2.v2Preparation`
- `replaceEmptyMesocycleWithV2.v2Preparation.candidateIdentitySummary`
- `replaceEmptyMesocycleWithV2.seedComparison`
- `replaceEmptyMesocycleWithV2.seedRuntimeBoundary`
- `replaceEmptyMesocycleWithV2.provenance`

Candidate identity summary:
- compact selected-identity rows show `slotId`, `laneId`, lane role, seed role, selected exercise id/name, and `setCount`
- top alternatives, score tuple, and selected-reason ranking details are marked unavailable until the materializer emits ranking diagnostics
- the summary is audit-only and must not be consumed by seed serialization, runtime replay, receipts, or persistence

Hard stops:
- missing explicit owner, mesocycle id, replacement flag, or write confirmation
- target owner mismatch, non-active state, non-`ACTIVE_ACCUMULATION` state, closed mesocycle, or non-new lifecycle counters
- any workout rows, completed/partial sessions, workout exercise rows, workout set rows, set logs, performed set logs, or runtime deviations
- V2 base-plan validation blockers, non-materialized materializer status, incompatible seed shape, blocked promotion readiness, or blocked V2 accepted-seed helper status
- any fallback path trying to label legacy output as V2 success

### `replace-empty-successor-from-accepted-seed-draft`

When to use it:
- a completed source mesocycle has a persisted `nextSeedDraftJson.acceptedSeedDraft.slotPlanSeedJson`
- the accepted successor already exists, is active accumulation, and has no workouts/logs/session state
- the operator needs to recover from an accept-path bug by replacing the successor seed from the persisted draft exactly, not by regenerating V2

Dry-run command:

```powershell
npm run audit:workout -- --env-file .env.local --mode replace-empty-successor-from-accepted-seed-draft --owner <owner-email> --source-mesocycle-id <completed-source-mesocycle-id> --mesocycle-id <active-empty-successor-id> --replace-empty-successor-from-accepted-seed-draft --dry-run
```

Guarded write command:

```powershell
npm run audit:workout -- --env-file .env.local --mode replace-empty-successor-from-accepted-seed-draft --owner <owner-email> --source-mesocycle-id <completed-source-mesocycle-id> --mesocycle-id <active-empty-successor-id> --replace-empty-successor-from-accepted-seed-draft --write --confirm-accepted-seed-draft-successor-recovery
```

Replacement semantics:
- replacement source is exactly `source.nextSeedDraftJson.acceptedSeedDraft.slotPlanSeedJson`
- fresh V2 generation is not run and is reported as `freshV2Generated=false`
- preserves the existing successor id and `slotSequenceJson`
- updates only `Mesocycle.slotPlanSeedJson`
- writes no successor mesocycles, workouts, workout exercises, workout sets, set logs, session check-ins, receipts, or runtime replay data

Hard stops:
- source missing, not `COMPLETED`, still active, or owner mismatch
- persisted accepted seed draft missing, malformed, or not `v2_materialized_seed`
- target missing, not active accumulation, not the expected next mesocycle in the same macrocycle, or not empty
- target slot order is incompatible with the replacement seed
- current target seed already matches the persisted draft
- replacement seed rows are not minimal `exerciseId`, `role`, `setCount`
- replacement exercise ids do not exist, set counts are missing, or expected anchors are absent (`upper_a` Barbell Bench Press 4 sets, `lower_a` Barbell Back Squat 4 sets)

### `active-mesocycle-slot-reseed`

When to use it:
- dry-run review of an active-cycle accepted seed upgrade
- compare persisted seeded slot composition against a fresh reprojection
- answer whether an explicit seed upgrade is safe before any mutation is approved

Primary questions it answers:
- what would change across the accepted slot sequence if current projection logic rebuilt the seed today
- whether set stacking is removed, lower fatigue pressure improves, and Tier B support coverage improves
- whether required movement support and slot identity stay intact
- whether the result is `safe_to_accept_upgrade`, `not_safe_to_apply`, or `needs_projection_fix_first`

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode active-mesocycle-slot-reseed --owner <owner-email>
```

Explicit accept variant:

```powershell
npm run audit:workout -- --env-file .env.local --mode active-mesocycle-slot-reseed --owner <owner-email> --accept-slot-plan-upgrade
```

Apply guardrails:
- the command writes only the current active mesocycle
- the full accept path replaces only `Mesocycle.slotPlanSeedJson`
- the persisted diff artifact is still emitted before mutation
- accept is allowed only when `recommendation.verdict="safe_to_accept_upgrade"`
- slot ids and slot order must match the currently accepted seed exactly
- candidate exercises must remain resolvable and carry explicit `setCount` values for deterministic replay
- `needs_projection_fix_first` and `not_safe_to_apply` are hard stops
- runtime hot patching, workout/log mutation, receipt rewriting, and non-active mesocycles stay out of scope

Inspect first:
- `activeMesocycleSlotReseed.executiveSummary`
- `activeMesocycleSlotReseed.recommendation`
- `activeMesocycleSlotReseed.flags`
- `activeMesocycleSlotReseed.aggregateMuscleDiff`
- `activeMesocycleSlotReseed.slotDiffs[*].exerciseDiff`
- `activeMesocycleSlotReseed.slotDiffs[*].setDiffByExercise`
- `activeMesocycleSlotReseed.slotDiffs[*].warnings`

Common red flags:
- `recommendation.verdict="needs_projection_fix_first"`
- `flags.improvesChestSupport=false` and `flags.improvesTricepsSupport=false`
- `flags.preservesSlotIdentity=false`
- `flags.preservesRowAndVerticalPullWhereAppropriate=false`
- `flags.avoidsNewObviousOvershoot=false`

Escalate when:
- the candidate projection still cannot satisfy protected chest / triceps coverage
- push-support muscles do not improve or side-delt support regresses materially
- the candidate changes exercises but keeps the same or worse push support
- row / vertical-pull support survives only by breaking slot-policy identity

### `deload`

When to use it:
- explicit deload preview for one intent
- verifying deload transformation truthfulness
- checking load provenance and progression exclusion during deload

Primary questions it answers:
- what the deload session would prescribe
- whether the deload trace captured final resolved runtime loads
- whether deload sessions are excluded from progression anchors/history as expected
- whether load provenance is internally consistent

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode deload --user-id <user-id> --intent <intent>
```

Inspect first:
- `warningSummary`
- `sessionSnapshot.generated.semantics`
- `sessionSnapshot.generated.traces.deload`
- per-exercise deload provenance fields:
  - `anchoredLoad`
  - `anchoredLoadSource`
  - `canonicalSourceLoad`
  - `canonicalSourceLoadSource`
  - `resolvedLoadSource`
  - `resolvedTopSetLoad`
  - `resolvedSetLoads`

Common red flags:
- provenance fields disagree in a way that implies impossible load ancestry
- deload semantics still count toward progression history or progression anchors
- no resolved runtime loads appear in the deload trace
- warnings indicate structural selection issues rather than just known background coverage noise

Escalate when:
- provenance fields are internally inconsistent
- deload sessions appear to contaminate progression history or anchor updates
- the explicit deload preview differs materially from the same intent routed through active deload

### `progression-anchor`

When to use it:
- one exercise progressed unexpectedly
- one exercise held unexpectedly
- you need the canonical reason/path for a next-load decision

Primary questions it answers:
- why the decision increased, held, or decreased
- which decision path fired
- what anchor load and confidence scaling were used
- whether the audited workout has persisted or reconstructed session context

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode progression-anchor --user-id <user-id> --exercise-id <exercise-id> --workout-id <workout-id>
```

Inspect first:
- `progressionAnchor.trace.outcome`
- `progressionAnchor.trace.metrics`
- `progressionAnchor.trace.anchor`
- `progressionAnchor.trace.confidence`
- `progressionAnchor.trace.decisionLog`
- `progressionAnchor.sessionSnapshotSource`
- `progressionAnchor.sessionSnapshot`

Common red flags:
- `outcome.reasonCodes` do not match the observed performed session
- `sessionSnapshotSource="reconstructed_saved_only"` when you expected a persisted modern snapshot
- confidence is heavily discounted without an obvious reason
- anchor source or anchor load looks incompatible with the representative performed working-set evidence

Escalate when:
- the decision path still looks wrong after reading `reasonCodes` and `decisionLog`
- the session context is legacy-reconstructed and the missing generated layer blocks a real answer
- progression behavior contradicts the canonical progression rules in `docs/02_DOMAIN_ENGINE.md`

## 3. Standard Workflow

### Completed week review
1. Run `historical-week`.
2. Check `warningSummary` for non-trivial warning volume.
3. Read `historicalWeek.summary` and `historicalWeek.comparabilityCoverage`.
4. Scan each `sessions[*].progressionEvidence`.
5. Scan each `sessions[*].weekClose` for unresolved or surprising state. Target deficits with `workflowState=COMPLETED` and `deficitState=PARTIAL` are review evidence, not lifecycle blockers.
6. Scan `sessions[*].reconciliation` for drift.
7. Escalate if exclusions, deficits, drift, or legacy limitations prevent a confident answer.

### Retrospective week audit
1. Run `weekly-retro`, or `npm run audit:week:retro -- --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id>` for the common operator shortcut.
2. Read the CLI summary first:
   - `load_calibration`
   - `volume below_mev=... below_preferred=... near_cap=... over_cap=...`
   - `interventions`
   - `recommendation`
3. Open `weeklyRetro.executiveSummary` and confirm the artifact is scoped to the intended week and mesocycle.
4. Read `weeklyRetro.planAdherence` to separate planned work completion from runtime-added work. Explained additions such as `target_gap_closure` should not hide missed planned sets, and unclassified drift should still reduce confidence.
5. Read `weeklyRetro.loadCalibration` before trusting actual-vs-target conclusions.
6. Scan `weeklyRetro.exerciseLoadCalibrationRows` for compact exercise-level planned/saved/performed load-calibration evidence before drilling into historical-week.
7. Read `weeklyRetro.sessionExecution` for compact completed/skipped status, slot identity, progression eligibility, week-close visibility, and reconciliation context before drilling into historical-week.
8. Read `weeklyRetro.slotBalance` and resolve any missing or duplicate slot identity first.
9. Read `weeklyRetro.volumeTargeting` for actual weekly target / MEV / MAV comparisons and contributor context.
10. Follow `weeklyRetro.recommendedPriorities` in order.
11. Escalate if slot integrity, unclassified runtime drift, missed planned work, or legacy coverage limitations make the retrospective answer unreliable.

### Upcoming week preview
1. Run `future-week`.
2. Check `generationPath` first.
3. Check `warningSummary`.
4. Read `sessionSnapshot.generated.semantics`.
5. If `isDeload=true`, inspect the deload trace immediately.
6. Escalate if routing, warnings, or semantics are inconsistent with live mesocycle state.

### Current-week volume coverage review
1. Run `npm run audit:week` for the common operator path, or run `projected-week-volume` directly when you need custom flags.
2. Read the CLI summary first:
   - `below_mev`
   - `below_target_only`
   - `over_mav`
   - `over_target_only`
   - `recommendation`
3. If the summary recommends inspection, run `npm run audit:week:debug` before opening the artifact.
4. In debug output, read:
   - full `below_mev` rows
   - full `below_target_only` rows
   - `projection_note[*]`
   - warning detail lines
   - `projected_session_order`
5. Then confirm `currentWeek` matches the intended active week and phase.
6. Read `projectionNotes` before interpreting the rest.
7. Scan `projectedSessions` in order and confirm slot ids/intents look right.
8. Read `fullWeekByMuscle` for projected full-week target / MEV / MAV comparisons.
9. Escalate if slot order, chaining, or the generation-centric incomplete-workout note makes the answer insufficient.

### Current-week pre-execution guidance
1. Run `npm run audit:workout -- --env-file .env.local --mode current-week-audit --owner <owner-email>`.
2. Confirm `projectedWeekVolume.currentWeek` matches the intended active week and phase.
3. Read `projectedWeekVolume.currentWeekAudit` for below-MEV floor gaps, below-preferred/stretch misses, over-MAV rows, and fatigue risks.
4. Read `projectedWeekVolume.interventionHints`; suggestions are bounded audit guidance only and should stay at 2-3 sets.
5. Read `projectedWeekVolume.sessionRisks` for long sessions, redundant pattern stacking, and upper/full-body pull-vs-push imbalance.
6. Confirm the unchanged projection landing in `projectedWeekVolume.fullWeekByMuscle` before acting on guidance. Do not add work solely because a row is above MEV but below a preferred or stretch target.

### Strict read-only pre-training checks
Use this when the operator explicitly needs no edited files, no DB mutation, no workout/log/session creation, and no local artifact files during an active mesocycle.

Important distinction:
- No DB mutation and no artifact write are separate guarantees.
- A normal read-only DB audit can still write local JSON files under `artifacts/audits/`.
- Add `--no-artifact` or its alias `--stdout-only` when local artifact files must not be created.
- Help/no-op commands are stricter: `npm run audit:workout -- --help` and `npm run audit:workout -- -h` print usage and exit before env loading, owner resolution, DB preflight, audit execution, artifact directory creation, or artifact writing.

Upcoming-session preview without artifact writes:

```powershell
npm run audit:workout -- --env-file .env.local --mode future-week --owner <owner-email> --no-artifact
```

One-command pre-session readiness without artifact writes:

```powershell
npm run audit:workout -- --env-file .env.local --mode pre-session-readiness --owner <owner-email> --mesocycle-id <active-mesocycle-id> --no-artifact --operator-debug
```

Current-week dose guidance without artifact writes:

```powershell
npm run audit:workout -- --env-file .env.local --mode current-week-audit --owner <owner-email> --operator-debug --no-artifact
```

Weekly-retro exercise reconciliation without artifact writes:

```powershell
npm run audit:workout -- --env-file .env.local --mode weekly-retro --owner <owner-email> --mesocycle-id <mesocycle-id> --week <week> --operator-debug --no-artifact
```

Full current-week projection without artifact writes:

```powershell
npm run audit:workout -- --env-file .env.local --mode projected-week-volume --owner <owner-email> --operator-debug --no-artifact
```

Expected stdout markers:
- `[workout-audit] artifact_write=skipped reason=no-artifact`
- `[workout-audit:read-only] db_mutation=no artifact_write=no workout_log_session_creation=no`

Do not run these in strict no-file-write situations:

```powershell
npm run audit:week
npm run audit:week:debug
npm run audit:workout -- --env-file .env.local --mode current-week-audit --owner <owner-email>
```

Those standard paths are DB read-only for the audit modes above, but they write audit artifacts by default. Also avoid `--write`, `--apply-bounded-reseed`, `--accept-slot-plan-upgrade`, and `--v2-debug-artifact`; the CLI rejects those flags when combined with `--no-artifact` / `--stdout-only`.

### Active seeded-slot reseed review
1. Run `active-mesocycle-slot-reseed`.
2. Read `executiveSummary` and `recommendation` first.
3. Confirm the artifact is scoped to the intended active mesocycle and accepted slot sequence.
4. Read `flags` before trusting the candidate diff.
5. Read `aggregateMuscleDiff` for set redistribution, support coverage, and fatigue-sensitive muscle movement.
6. Inspect each `slotDiffs[*]` row for exercise swaps, set-count changes, and warnings.
7. Escalate immediately if the verdict is `needs_projection_fix_first` or if slot-identity / pull-support guards fail.

### Deload week review
1. Run `deload` for the target intent.
2. Confirm `sessionSnapshot.generated.semantics.isDeload=true`.
3. Confirm progression exclusions from semantics reason codes.
4. Inspect `sessionSnapshot.generated.traces.deload.exercises[*]` for provenance and resolved runtime loads.
5. Escalate on provenance mismatch or progression contamination.

### Suspicious progression behavior
1. Run `progression-anchor` for the exact workout/exercise.
2. Read `outcome.action`, `outcome.path`, and `outcome.reasonCodes`.
3. Confirm `metrics.nextLoad`, `metrics.medianReps`, and `metrics.modalRpe`.
4. Read `anchor` and `confidence`.
5. Read `decisionLog`.
6. If session context is needed, inspect `sessionSnapshot` and note whether it is persisted or reconstructed.
7. Escalate if the artifact still does not explain the decision.

## 4. Artifact Reading Guide

Read these fields in this order unless the audit type says otherwise.

### `warningSummary`
- First triage field for every audit.
- `counts` tells you whether the artifact is noisy before you read details.
- `semanticWarnings` matter more than `backgroundWarnings`.
- Heavy warning volume is not automatically a runtime bug, but it raises the bar for trusting the audit without follow-up.

### `generationPath`
- Present for generated-session modes.
- Tells you whether the request used:
  - `standard_generation`
  - `explicit_deload_preview`
  - `active_deload_reroute`
- Use this before interpreting the rest of a `future-week` or `deload` artifact.

### `generationProvenance`
- Present for generated-session artifacts when generation output or `generationPath` is available.
- `receiptProvenance.mesocycleId` and `receiptProvenance.compositionSource` are copied from `generation.selection.sessionDecisionReceipt.sessionProvenance`.
- `auditOnly.generationPath` mirrors the audit execution path beside the receipt fields for quick comparison. It remains audit-only and must not be treated as part of the saved receipt contract.
- `seed.provenanceConsistency` may appear for future-week artifacts when an accepted mesocycle seed is available. It is the same compact read-only provenance diagnostic used by `mesocycle-explain`; runtime replay via `persisted_slot_plan_seed` is not proof of seed authorship.

### `projectionNotes`
- Present for `projected-week-volume` and `current-week-audit`.
- Read this before trusting a full-week projection when runtime state contains incomplete workouts.
- The key question is whether the report is answering the generation-centric runtime-slot question you intended to ask.

### `currentWeekAudit`
- Present for `current-week-audit`.
- Read it after confirming `currentWeek` and `projectionNotes`.
- It is an audit-only evaluation layer over `fullWeekByMuscle` and `projectedSessions`, not generation policy.
- `runtimeDoseAdjustmentDiagnostics` is the companion read-only dose-guidance diagnostic. Treat `recommendedAction` as session-local coaching evidence only; `readOnly=true` and `affectsAcceptedSeed=false` are mandatory boundary facts.

### `activeMesocycleSlotReseed.recommendation`
- Present for `active-mesocycle-slot-reseed`.
- This is the top-line dry-run verdict for explicit accepted-seed upgrade safety.
- `safe_to_accept_upgrade` means the candidate can replace the active mesocycle seed through the explicit accept path.
- `needs_projection_fix_first` means the current canonical projection path still fails a gating coverage condition even before mutation is considered.

### `comparabilityCoverage`
- Historical-week-only summary for persisted vs reconstructed coverage.
- Read this before trusting generated-vs-saved comparisons.
- `generatedLayerCoverage="none"` means you are mostly auditing saved-state semantics, not original generation truth.

### `sessionSnapshot` / `sessionSnapshotSource`
- `generated` is original generation-layer truth when persisted or when the session is generated live in the audit.
- `saved` is saved-workout truth.
- `sessionSnapshotSource="reconstructed_saved_only"` means saved context was rebuilt from persisted workout fields because no persisted snapshot was available.

### `progressionEvidence`
- Historical-week shortcut for progression inclusion/exclusion.
- Use it before drilling into full session semantics.
- If this looks wrong, then inspect the underlying `sessionSnapshot.*.semantics.reasons`.

### `weekClose`
- Relevant for audits touching completed weeks, weekly review evidence, or legacy optional gap-fill state.
- `workflowState` answers whether the workflow is still actionable.
- `deficitState` answers whether the weekly deficit is actually closed.
- Treat `remainingDeficitSets` as the quick severity signal.
- `resolution=AUTO_DISMISSED` with `deficitState=PARTIAL` means normal week close completed while targets remained unmet. Treat that as weekly-review evidence; it should not be reported as an active closeout blocker.

### `reconciliation`
- Generated-vs-saved mutation summary.
- `comparisonState="missing_generated_snapshot"` means no real generated-vs-saved comparison was possible.
- `hasDrift=true` means the saved workout diverged materially from the generated layer.
- `changedFields` is the first field to read.
- In `weekly-retro`, read `planAdherence.interpretations` before treating drift as engine instability. Runtime additions can be classified as `final_weekly_opportunity_mev_closure`, `target_gap_closure`, `opportunistic_extra`, substitutions, pain/fatigue deviations, or unclassified drift without rewriting the original generated plan.

### Deload trace provenance fields
- Use these together:
  - `anchoredLoad` / `anchoredLoadSource`: accumulation anchor used for deload continuity context
  - `canonicalSourceLoad` / `canonicalSourceLoadSource`: canonical load source resolved by the runtime load engine
  - `resolvedLoadSource`, `resolvedTopSetLoad`, `resolvedSetLoads`: actual final runtime prescription
- The main question is whether these fields tell one coherent story.

### Progression-anchor `reasonCodes` and `path`
- `outcome.path` tells you which rule lane fired.
- `outcome.reasonCodes` tells you why.
- `decisionLog` is the detailed supporting trace.
- Start with `action`, `path`, and `reasonCodes`; read the rest only if the decision is still surprising.

## 5. Red Flags And Escalation Triggers

Escalate beyond a normal audit when any of these appear:
- provenance fields imply contradictory load ancestry
- progression is excluded without an obvious semantic reason
- deload sessions appear to update progression anchors or progression history
- unresolved `weekClose` deficits remain when the week should be closed
- `warningSummary.counts.semanticWarnings` is non-trivial and the messages point to planner/classification issues
- `comparabilityCoverage` shows legacy reconstruction where the audit question depends on original generated truth
- `reconciliation.hasDrift=true` and the drift is not expected
- `progression-anchor` reason codes/path do not plausibly match the performed session
- `future-week` takes an active-deload route unexpectedly

Escalation means:
- inspect the owning code seam named in the artifact or canonical docs
- run a deeper Codex/code-level investigation
- do not "correct" the interpretation by coaching intuition alone

## 6. Legacy-Data Caveats

Older workouts may not have persisted generated snapshots.

Effects:
- no true generated-vs-saved comparison
- no persisted generation-time trace payloads
- historical review is limited to reconstructed saved context plus current canonical semantics

How artifacts surface this:
- `sessionSnapshotSource="reconstructed_saved_only"`
- `reconciliation.comparisonState="missing_generated_snapshot"`
- `historicalWeek.comparabilityCoverage.generatedLayerCoverage`
- `historicalWeek.comparabilityCoverage.limitations`

Interpretation rule:
- legacy artifacts are still useful for saved-state semantics, week-close state, and progression eligibility
- they are not enough to prove what the original generated session looked like if that layer was never persisted

## 7. Canonical Ownership / Boundaries

This playbook is operational guidance only.

Canonical runtime truth remains in:
- audit artifact output from `scripts/workout-audit.ts`
- audit artifact schemas in `src/lib/audit/workout-audit/types.ts`
- session snapshot / trace schemas in `src/lib/evidence/session-audit-types.ts`
- architecture boundaries in `docs/01_ARCHITECTURE.md`
- engine semantics in `docs/02_DOMAIN_ENGINE.md`
- internal serialization/diff helpers remain code-only maintenance utilities and are not part of the user-facing CLI contract

Boundary rules:
- do not silently replace canonical artifact truth with coaching interpretation
- do not restate engine behavior locally when the owning code seam already defines it
- use this doc to decide what to run and what to inspect, not to override the runtime

## 8. Quick-Reference Checklist

- Run the narrowest audit mode that matches the question.
- Read `warningSummary` first.
- For generated modes, read `generationPath` before interpreting the rest.
- For `projected-week-volume` and `current-week-audit`, read `projectionNotes` before trusting the full-week answer.
- For `current-week-audit`, confirm `currentWeekAudit`, `interventionHints`, and `sessionRisks` agree with `fullWeekByMuscle` and `projectedSessions`.
- For historical-week, read `comparabilityCoverage` before trusting drift analysis.
- Use `sessionSnapshot` as the main evidence record.
- Use `progressionEvidence` for quick inclusion/exclusion triage.
- Use `weekClose` for workflow/deficit truth, not just week labels.
- Use `reconciliation.changedFields` for drift triage.
- For deload, read load provenance fields together.
- For progression-anchor, start with `action`, `path`, and `reasonCodes`.
- Escalate when artifact fields contradict each other, omit needed truth because of legacy coverage, or fail to explain a meaningful runtime outcome.

## Stimulus-accounting integrity in `weekly-retro`

- Read `weeklyRetro.stimulusAccountingIntegrity` as persisted candidate truth, not planner or generation policy.
- `exactVerifiedCount` confirms valid stored hashes. `legacyDerivedCount` is explicitly lower-fidelity reconstruction.
- Escalate `invalidSnapshotCount` as corruption, `missingExactSnapshotCount` as a modern write-contract failure, and `evidenceMismatchCount` as receipt/runtime-edit evidence drift.
- `legacyUnknownCount` means the historical contribution cannot be reconstructed safely. Do not silently substitute current policy for a present-but-invalid snapshot.
- This readout is audit-only: it must not mutate rows, author plans, repair sessions, change acceptance, or feed runtime replay.
