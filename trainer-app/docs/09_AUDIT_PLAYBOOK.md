# 09 Audit Playbook

Owner: Aaron  
Last reviewed: 2026-03-16  
Purpose: Canonical operational playbook for recurring workout-audit CLI use. This doc tells operators and maintainers which audit to run, what to inspect first, what counts as a red flag, and when to escalate into deeper code-level investigation.

This doc covers:
- Recurring operational use of `historical-week`, `weekly-retro`, `future-week`, `projected-week-volume`, `current-week-audit`, `mesocycle-explain`, `deload`, and `progression-anchor`
- Active-mesocycle dry-run reseed review for bounded slot-seed repair
- Default audit workflows for common review scenarios
- Artifact-reading guidance for the current audit JSON vocabulary
- Red flags, escalation triggers, and legacy-data caveats

Invariants:
- This playbook is operational guidance, not a second source of runtime semantics.
- Runtime truth lives in the canonical audit artifacts plus the owning code seams referenced here.
- When artifact output conflicts with prose, trust the artifact and the code owner it points to.
- Environment setup, DB preflight, and direct CLI validation commands live in `docs/08_AUDIT_CLI_DB_VALIDATION.md`.

Sources of truth:
- `trainer-app/scripts/workout-audit.ts`
- `trainer-app/src/lib/audit/workout-audit/types.ts`
- `trainer-app/src/lib/audit/workout-audit/context-builder.ts`
- `trainer-app/src/lib/audit/workout-audit/generation-runner.ts`
- `trainer-app/src/lib/audit/workout-audit/serializer.ts`
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
- `weekClose.workflowState="PENDING_OPTIONAL_GAP_FILL"` with meaningful remaining deficits
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

Fast operator loop:

```powershell
npm run audit:week:retro -- --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id>
```

Inspect first:
- `weeklyRetro.executiveSummary`
- `weeklyRetro.planAdherence`
- `weeklyRetro.loadCalibration`
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
- which meaningful under-target clusters are at least 3 effective sets short
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
- `projectedWeekVolume.sessionRisks`

Important interpretation rule:
- this mode reuses the canonical `projected-week-volume` pipeline
- `currentWeekAudit`, `interventionHints`, and `sessionRisks` are audit-only guidance fields; they do not mutate mesocycles, modify slot plans, or feed generation/runtime policy
- use it before session execution; if sessions are already in progress or completed, read the projection notes and consider `projected-week-volume` or `weekly-retro` depending on the question

Common red flags:
- `currentWeekAudit.belowMEV.length > 0`
- `currentWeekAudit.underTargetClusters[*].deficit >= 3`
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
- Full V2 planner evidence is written only when the explicit sidecar flag is present:

```powershell
npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com --operator-debug --planner-only-no-repair --compare-repaired --v2-debug-artifact
```

- `--v2-debug-artifact` requires `--mode mesocycle-explain` and `--planner-only-no-repair`. It writes a sibling `*-v2-no-repair-debug.json` artifact, prints sidecar path/size/sha256, links the main artifact to the sidecar through `plannerOnlyNoRepair.debugArtifact`, and links the sidecar back through `parent.fileName` / `parent.relativePath`.
- Runs a second read-only projection pass from the first-principles upper/lower lane plan with downstream repair/shaping disabled.
- Disabled in this experimental pass: support-floor closure, weekly obligation closure, program-quality identity changes, late set bumping, isolation injection/accessory-lane rescue, clean-curl repair preference, duplicate/program-quality repair shaping, cap trim, MAV trim, forbidden cleanup mutation, and seed/runtime persistence.
- Kept as validation/reporting only: forbidden-slot checks, cap/concentration checks, duplicate checks, unresolved demand reporting, lane satisfaction, weekly muscle totals, and acceptance checks.
- The payload reports unresolved demand and validation failures instead of fixing them. It must not update accepted mesocycles, `slotPlanSeedJson`, receipts, runtime replay, planned workouts, or performed workouts.
- The payload and CLI also report compact planner-owned set-allocation changes plus before/after weekly total changes for the flagged no-repair pass. These fields are diagnostic readouts only and must not imply downstream repair was enabled.
- No-repair acceptance is reported through `plannerOnlyNoRepair.acceptanceClassification`. `basicMesocycleShapeStatus` evaluates the Week 1 no-repair shape, while `replacementReadinessStatus` answers whether the no-repair path can replace the repaired projection. Raw unresolved demand, raw missing lane counts, raw validation counts, and repair materiality scoreboards do not hard-fail basic shape by themselves.
- `plannerOnlyNoRepair.v2MesocyclePlan` is the compact 5-week bridge object for the experimental V2 planner target. It records the stable upper/lower 4x skeleton, Week 1 lane status from flagged no-repair evidence, Weeks 1-5 progression modifiers, deload transform intent, validation-rule statuses, and explicit replacement-readiness blockers. It is flagged-only, read-only, non-generative, and must not be treated as accepted seed, repaired projection, runtime replay, receipt, or UI truth.
- `plannerOnlyNoRepair.crossWeekProjectionGate` is the read-only readiness gate for the no-repair V2 sidecar. Read `week1Status`, `accumulationWeeksStatus`, `deloadStatus`, `replacementReadinessStatus`, `blockers`, `warnings`, and `missingInputs` before treating a clean Week 1 shape as migration evidence. Weeks 2-4 can move to `projected_with_limitations` when `plannerOwnedAccumulationProjection` exists, but the projection is read-only and not planner-ready behavior until selection, accepted seed, and runtime replay consume it. Deload transform evidence is diagnostic-only until accepted seed identity/set reductions and runtime replay consumption are projected. `safeToPromoteBehavior` must remain `false` until those prerequisites and repair non-regression are all true.
- `plannerOnlyNoRepair.v2SetDistributionIntent` is the flagged-only V2 set-distribution policy diagnostic. It records lane-level min/preferred/max set budgets from the V2 target skeleton and weekly progression multipliers, with cap/concentration policy kept as separate validation metadata. It is read-only, non-generative, and must not be treated as repaired projection parity, accepted seed truth, selection input, repair input, runtime replay input, receipt truth, or UI truth.
- `plannerOnlyNoRepair.plannerOwnedAccumulationProjection` is the flagged-sidecar-only Weeks 2-4 planner-owned projection. It derives from weekly demand, the V2 weekly progression model, V2 set-distribution intent, the upper/lower slot skeleton, and slot/lane roles; it does not derive from repaired projection, accepted seed, runtime replay, repair output, program-quality cleanup, or post-hoc set bumps.
- `plannerOnlyNoRepair.v2ExerciseSelectionPlanDiagnostic` is the flagged-sidecar-only identity/class-lane diagnostic. Read its `status`, summary counts, `blockers`, `warnings`, `missingInputs`, and per-lane identity/class/set/duplicate/concentration/inventory/fatigue/capacity statuses before treating Week 1 no-repair identities as viable across accumulation. Candidate alternatives in this field are evidence only; they are not replacement selections and must not feed selection, repair, seed, runtime replay, UI, receipts, or persistence.
- `plannerOnlyNoRepair.v2TargetVsNoRepairDiff` is the compact target-alignment scoreboard. It compares the V2 target skeleton to the experimental no-repair output; repaired projection is only a secondary reference for `repair_dependent` lanes or legacy rescue evidence, not the optimization target. Lane classifications use `v2SetDistributionIntent` as read-only set-policy evidence and surface only compact `setPolicy:*`, `setBudget:*`, and `justification:*` diagnostics rather than repeated policy objects.
- The serialized artifact may further compact these V2 sections with local catalogs, target-descriptor sources, set-budget grids, selected-exercise strings, omitted counts, and bounded evidence arrays. This does not change the in-memory diagnostic consumed by the CLI summary and does not affect generation, scoring, repair, seed serialization, runtime replay, receipts, UI, or persistence.
- No-repair concentration rows remain severity-bucketed as `acceptanceFailures`, `qualityWarnings`, `diagnosticRows`, and `ignoredRows`, then roll up into `acceptanceClassification.hardBlockers`, `qualityWarnings`, `diagnosticOnly`, and `sessionShaping`. Acceptance failures are true blockers only. For intentionally trained primary hard targets, `<50%` single-exercise share is not reported, `50-60%` is a quality warning when the target is met and required lanes are present, and `>60%` remains an acceptance blocker unless explicitly justified; 50-60% also blocks when the primary target is below minimum, the row was repair/set-bump created, a fatigue/cap or required-lane defect exists, a clean alternative was ignored while the target remains under-distributed, or a compound/hinge/heavy press exceeds 5 sets. Clean support/direct-work concentration is a non-blocking quality warning, secondary or implicit collateral is diagnostic-only, and tiny denominator artifacts such as Forearms/Core/Adductors collateral are diagnostic/session-shaping readout unless a fatigue cap or explicit target policy is exceeded.
- `acceptanceClassification.migrationScoreboard` carries `materialRepairCount`, `majorRepairCount`, suspicious repairs, repaired-vs-no-repair readiness, and the reason replacement is not ready. It gates replacement/promotion review, not basic no-repair Week 1 shape validity.

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
- The written `mesocycle-explain` artifact may additionally compact large `planningReality` sections through serializer-only catalogs, representative rows, and omitted counts. `accumulationWeekProjection` stores repeated Week 1 shape once as representative projected muscles/slot risks; repair/materiality, prescription, distribution, and class sections keep summaries plus resolvable refs; `preselectionFeasibility` keeps the clean/dirty candidate rows with an inventory summary for omitted tail rows; flagged `plannerOnlyDryRun` keeps failed/partial checks, top unresolved demand, active repair dependencies, and calves blockers while summarizing passing/within/inactive rows. Flagged `plannerOnlyNoRepair` now keeps full V2 details and full cross-week gate detail out of the main artifact and exposes them through the optional debug sidecar. The CLI operator summary still reads the full in-memory diagnostic, so artifact splitting is output-size control only, not changed diagnostic meaning.
- `slotDemandAllocationByWeek` is the read-only bridge between `weeklyDemandCurve` and future per-week preselection distribution. Read it to answer which slots own Week 1 Chest, Lats, Quads, Hamstrings, Side Delts, and Calves demand, and to confirm whether Weeks 2-4 or deload are explicitly unallocated because per-week slot composition, fatigue carryover, progression-adjusted targets, duplicate justification, weekly exercise identity policy, deload identity preservation, or deload set-reduction projection are missing. Its warnings are promotion gates only; they do not alter generation, repair, accepted seeds, or runtime replay.
- `exerciseClassDistributionBySlot` is the read-only bridge from slot-owned demand to future class-level selection intent. Read it for diagnostic class intent only: distinct upper-slot Chest classes, lower_b Hamstrings hinge plus knee-flexion curl, low-collateral Side Delt options, Rear Delts/Triceps collateral cautions, Calves duplicate-isolation caution, and repeated exercise justification requirements. It does not select exercises or alter generation, repair, accepted seeds, receipts, UI, or runtime replay.
- `exerciseClassAlignment` is the compact read-only comparison of planner class intent, initial slot-selected exercise classes, and final repaired exercise classes. Read it to answer whether slot-local selection satisfied class intent, whether repair improved or worsened that alignment, whether identity churn occurred, and whether duplicates such as Incline DB Bench, Lat Pulldown, SLDL, Barbell Back Squat, or same-session calf isolation variants are class-aligned but duplicate-policy risky. Read the sibling `exerciseClassUnresolvedCauses` before proposing behavior: it classifies notable unresolved rows by likely owner so selection blind spots, inventory/classification gaps, duplicate/continuity conflicts, support-floor late repair, cap cleanup/final shaping, repair identity churn, true unresolved demand, and diagnostic-only rows do not get the same fix. Then read `duplicateContinuityJustification` for the duplicate-specific explanation: which exercise or same-session variant repeated, why it may have been allowed, whether a clean alternative was visible, and whether future planner policy should allow, discourage, block, or require an explicit planner decision. These fields are diagnostic-only and must not be used as active selection, repair, seed, receipt, UI, or runtime replay policy.
- Read `cleanupCandidateFeasibility` before proposing duplicate-cleanup behavior. For `lower_b_calf_duplicate_cleanup`, `not_feasible_under_current_caps` means one retained lower_b calf isolation cannot preserve the Calves support floor under the current per-exercise/direct-exercise/slot caps; block the cleanup trial and treat the next decision as support-floor distribution, lower_a allocation, or calf specialization policy. Only `recommendation="safe_to_trial"` should unblock a future duplicate-cleanup trial.
- `accumulationWeekProjection` is the next read-only bridge after slot allocation. Read it as a conservative repeated-Week-1 diagnostic, not a true progression forecast: it projects the current final slot-plan shape across later accumulation/peak weeks, flags persistent Chest under-target, Hamstrings overdelivery, Side Delts under-target, duplicate main-lift reuse, collateral fatigue, and still-unprojected deload preservation, and emits candidate readiness. Treat `ready_for_bounded_trial` for Chest upper-slot distinct exercise distribution as a diagnostic promotion signal only when Chest shortfall and Chest concentration/duplicate evidence are both present across the repeated-shape projection.
- When `planningReality` exists, classify the architecture signal from its own fields: `summary.planningShape`, `summary.materialRepairCount`, `summary.majorRepairCount`, `warnings`, `repairMateriality`, `repairMaterialityAfterShadowAllocation`, `exerciseConcentration`, `setDistributionIntents`, and `slotDemandAllocation`. The operator readout should include `planningShape`, `materialRepairCount`, `majorRepairCount`, likely upstream-avoidable material repairs, remaining material repairs, suspicious repairs not eligible for promotion, promotion candidates, set-distribution evidence, and the highest-leverage next move.
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
5. Scan `sessions[*].weekClose` for unresolved or surprising state.
6. Scan `sessions[*].reconciliation` for drift.
7. Escalate if exclusions, deficits, drift, or legacy limitations prevent a confident answer.

### Retrospective week audit
1. Run `weekly-retro`, or `npm run audit:week:retro -- --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id>` for the common operator shortcut.
2. Read the CLI summary first:
   - `load_calibration`
   - `under_target`
   - `interventions`
   - `recommendation`
3. Open `weeklyRetro.executiveSummary` and confirm the artifact is scoped to the intended week and mesocycle.
4. Read `weeklyRetro.planAdherence` to separate planned work completion from runtime-added work. Explained additions such as `target_gap_closure` should not hide missed planned sets, and unclassified drift should still reduce confidence.
5. Read `weeklyRetro.loadCalibration` before trusting actual-vs-target conclusions.
6. Read `weeklyRetro.sessionExecution` for compact completed/skipped status, slot identity, progression eligibility, week-close visibility, and reconciliation context before drilling into historical-week.
7. Read `weeklyRetro.slotBalance` and resolve any missing or duplicate slot identity first.
8. Read `weeklyRetro.volumeTargeting` for actual weekly target / MEV / MAV comparisons and contributor context.
9. Follow `weeklyRetro.recommendedPriorities` in order.
10. Escalate if slot integrity, unclassified runtime drift, missed planned work, or legacy coverage limitations make the retrospective answer unreliable.

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
3. Read `projectedWeekVolume.currentWeekAudit` for below-MEV, over-MAV, meaningful under-target clusters, and fatigue risks.
4. Read `projectedWeekVolume.interventionHints`; suggestions are bounded audit guidance only and should stay at 2-3 sets.
5. Read `projectedWeekVolume.sessionRisks` for long sessions, redundant pattern stacking, and upper/full-body pull-vs-push imbalance.
6. Confirm the unchanged projection landing in `projectedWeekVolume.fullWeekByMuscle` before acting on guidance.

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

### `projectionNotes`
- Present for `projected-week-volume` and `current-week-audit`.
- Read this before trusting a full-week projection when runtime state contains incomplete workouts.
- The key question is whether the report is answering the generation-centric runtime-slot question you intended to ask.

### `currentWeekAudit`
- Present for `current-week-audit`.
- Read it after confirming `currentWeek` and `projectionNotes`.
- It is an audit-only evaluation layer over `fullWeekByMuscle` and `projectedSessions`, not generation policy.

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
- Only relevant for audits touching completed weeks / optional gap-fill state.
- `workflowState` answers whether the workflow is still actionable.
- `deficitState` answers whether the weekly deficit is actually closed.
- Treat `remainingDeficitSets` as the quick severity signal.

### `reconciliation`
- Generated-vs-saved mutation summary.
- `comparisonState="missing_generated_snapshot"` means no real generated-vs-saved comparison was possible.
- `hasDrift=true` means the saved workout diverged materially from the generated layer.
- `changedFields` is the first field to read.
- In `weekly-retro`, read `planAdherence.interpretations` before treating drift as engine instability. Runtime additions can be classified as `target_gap_closure`, `opportunistic_extra`, substitutions, pain/fatigue deviations, or unclassified drift without rewriting the original generated plan.

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
