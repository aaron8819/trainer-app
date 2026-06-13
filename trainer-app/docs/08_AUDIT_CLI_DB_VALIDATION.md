# Audit CLI DB Validation

Use this together with `docs/09_AUDIT_PLAYBOOK.md`.
- This file is the narrow DB-backed validation runbook for the unified `npm run audit:workout` entrypoint.
- It covers environment prerequisites, preflight, and exact commands against a real database.
- The recurring operational workflow, field-reading order, red flags, and escalation rules live in `docs/09_AUDIT_PLAYBOOK.md`.

Use this when validating the audit foundation against a real database instead of mocked unit inputs.

## Prerequisites

- Set `DATABASE_URL` for the target environment.
- Prefer a disposable or read-only environment first.
- Pick a user that already has:
  - at least one saved workout week
  - at least one performed exercise with progression history
  - an active or recently completed mesocycle

## Preflight

```powershell
npm run audit:workout -- --mode historical-week --user-id <user-id> --week <week>
```

The command should print the audit preflight block and write an artifact under `artifacts/audits/`.

## Recommended Validation Runs

Historical week:

```powershell
npm run audit:workout -- --mode historical-week --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id>
```

Future week:

```powershell
npm run audit:workout -- --mode future-week --user-id <user-id>
```

Mesocycle explainability preview vs seed vs reality:

```powershell
npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com
```

Read-only planner-only dry-run comparison for mesocycle explain:

```powershell
npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com --operator-debug --planner-only-dry-run --compare-repaired
```

- `--planner-only-dry-run` currently requires `--compare-repaired`.
- The artifact adds `mesocycleExplain.plannerOnlyDryRun` only for flagged runs.
- This path is diagnostic-only and must not write accepted seeds, planned workouts, receipts, replay data, or performed workouts.
- The flagged payload may include `plannerOnlyDryRun.policyOverride.status="active"` for `calves_4_4_lower_slot_allocation`. That override reruns projection for comparison only; it must not be persisted, emitted by unflagged output, written into `slotPlanSeedJson`, receipts, runtime replay, routes, UI, setup, handoff, or reseed paths.
- Read `plannerOnlyDryRun.projectionComparisons` before recommending behavior. It compares `baselineRepaired`, `plannerOnlyBase`, and `plannerOnlyWithOverride`, then reports override deltas for repair counters, suspicious/concentration/cap/duplicate rows, forbidden-primary violations, weak preselection consumption, support-floor rows, set-bump rows, and key acceptance failures.
- The flagged payload may include `plannerOnlyDryRun.calvesFourFourCandidate`, a read-only Calves 4+4 lower-slot classifier backed by that override rerun. It is evidence for future implementation planning only; worsened materiality, major, suspicious, concentration, cap, cross-week, lower_a safety, or Hamstrings-route checks must keep behavior unapproved. Read `lowerASafety`, `materialityEstimate.expected*Delta`, `materialityEstimate.evidence`, `materialityEstimate.stillUnknown`, and `policyReadiness.remainingBlockers` before treating a Week 1 shape as trial-ready.

Experimental planner-only no-repair comparison for mesocycle explain:

```powershell
npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com --operator-debug --planner-only-no-repair --compare-repaired
```

- The artifact adds `mesocycleExplain.plannerOnlyNoRepair` only for flagged runs.
- This path is read-only and disables downstream repair/shaping instead of patching planner gaps.
- The main `mesocycle-explain` artifact is the operator artifact: it keeps read-only markers, no-repair summary, replacement readiness, compact V2 summary, compact cross-week gate summary, top operator findings, and a debug-artifact manifest. It links to a compact V2 debug index when requested; it does not carry the full V2 diagnostic payload.
- The payload includes `plannerOnlyNoRepair.acceptanceClassification`, which separates basic Week 1 no-repair shape validity from replacement readiness. Diagnostic/collateral concentration and migration scoreboards are readout unless promoted into explicit hard blockers by target, cap, forbidden-slot, set-count, or seed-replay policy.
- The payload includes `plannerOnlyNoRepair.v2MesocycleStrategyDiagnostic`, a read-only strategy-layer diagnostic above current V2 demand. It can consume the pure `V2MesocycleStrategyInput` DTO assembled by the API/read-model adapter from available handoff/profile/review/readiness evidence, then reports present and missing input groups, normalized block response signals, exercise response/tolerance signals, continuity/variation evidence readiness, volume/fatigue evidence readiness, phase/objective classification status, current fixed-skeleton demand derivation, target strategy-derived demand ownership, and current-state vs north-star gaps without feeding generation, selection, repair, seed serialization, runtime replay, receipts, accepted mesocycle behavior, UI, or persistence.
- The same diagnostic includes `strategyHypothesisPromotionReadiness`, a read-only promotion-readiness layer for each strategy hypothesis. It defines required evidence, proposed owner, bounded behavior scope, known risks, non-regression gates, rollback criteria, missing evidence, and next safe action before any hypothesis can become planner behavior. The main artifact keeps only compact counts and top missing evidence; the V2 debug index points to focused strategy and promotion-readiness shards. Readiness is not consumed by demand, materializer ranking, generation, selection, repair, seed serialization, runtime replay, receipts, accepted mesocycles, UI, or persistence.
- The same diagnostic also includes `strategyHypothesisPromotionDiff`, a read-only audit gate for the first ready read-only-diff hypotheses currently limited to `protect_lagging_muscles_earlier` and `cap_late_block_volume`. It reports target-tier under-hit examples, skipped-set plus hard-week evidence, interaction risk, and the next safe action. Its nested `projectionDiff` is a conservative combined-pair shadow frame: candidate protected muscles come from target-tier lagging evidence, candidate donors come from over-concentration or fatigue-driver evidence, redistribution is preferred before net-new late-block volume, and computed non-regression gates are `pass` / `fail` / `unknown` only from measured before/after deltas. Before constructing the flagged shadow override, `preShadowCandidateFilter` uses base planner-only no-repair coverage to exclude unsafe donor/protected exchanges with missing or insufficient floor margin, protected overlap without surplus, target-tier donor caution, missing slot compatibility, overloaded receiving slots, net-new volume needs, max-slot-increase pressure, or concentration risk. `donorSurplusEvidence` normalizes the same donor-side evidence into candidate reason, measured baseline coverage, floor/preferred landmarks, surplus above floor, required safety margin, protected overlap, slot ownership compatibility, eligibility counts, measured-margin count, and top reason counts before the slot-owned plan reads it diagnostically. If no safe material remains, the candidate is still a valid diagnostic result and should stay `needs_better_projection`. The same projection diff carries `conflictAwareRefinement`, a read-only/non-binding conflict summary that can exclude unsafe donor muscles, require slot owners for protected work, block net-new volume, and report floor/session-size conflicts without changing planner behavior. In flagged planner-only no-repair V2 debug runs, the audit performs a second planner-only no-repair shadow projection for the filtered combined candidate and compares it against the base planner-only no-repair projection. Repaired projection and old prescribed plan shape are not targets. Unmeasured fields remain `unknown`, and `ready_for_bounded_behavior_trial` requires every necessary computed gate to be measured and pass with no measured conflict-aware conflicts. The main artifact keeps only compact status/count/mode/readiness/gate-count/conflict-count/filter-count/donor-surplus count/measured-margin/top-reason fields; full donor rows belong in the `v2-promotion-diffs` shard. The diff remains diagnostic-only and is not consumed by demand, weekly curve, materializer ranking, generation, selection, repair, seed serialization, runtime replay, receipts, accepted mesocycle behavior, UI, or persistence.
- `plannerOnlyNoRepair.strategyToDemandProjection.boundedBehaviorTrial.measuredRedistributionProjection` is the read-only bridge from downstream context inventory to a measured behavior-projection decision. It reuses the existing strategy shadow projection and reports compact per-candidate muscle owner, slot owners, donor offsets, protected coverage, weekly/slot/materializer/concentration deltas, gate statuses, row blocker reasons, projection-scope/blocker summary, alternate-donor availability, readiness, and next safe action. A blocked result means resolve measured regressions or prove a non-current eligible donor/slot-owner projection before designing a behavior-projection trial; when no safe alternate donor exists, the CLI also surfaces the existing capacity-policy inspection summary as the next fallback track. It must not feed demand, weekly curve, slot allocation, set distribution, materializer ranking, generation, repair, seed serialization, runtime replay, receipts, accepted mesocycle behavior, UI, API writes, DB, or persistence.
- The payload includes `plannerOnlyNoRepair.crossWeekProjectionGate`, which separates Week 1 basic shape, Weeks 2-4 accumulation projection, deload diagnostic projection, and broad replacement readiness. The main artifact keeps only compact gate statuses/counts; the V2 debug index points to a focused cross-week projection shard. Weeks 2-4 and deload may report `projected_with_limitations` when planner-owned/read-only diagnostics exist, but `safeToPromoteBehavior` remains `false` while those projections are not consumed by selection/seed/runtime, accepted seed/runtime consumption is undefined, or repair dependency could worsen.
- `plannerOnlyNoRepair.v2MesocyclePlan` summarizes the stable upper/lower 4x skeleton, Weeks 1-5 progression modifiers, deload transform intent, validation-rule statuses, and replacement-readiness blockers. It is flagged-only, read-only, and non-generative.
- `plannerOnlyNoRepair.v2SetDistributionIntent` summarizes lane-level min/preferred/max set budgets from the V2 target skeleton and weekly progression multipliers. Cap and concentration policy are validation metadata, not set-budget source truth, and the field is flagged-only, read-only, and non-generative.
- `plannerOnlyNoRepair.plannerOwnedAccumulationProjection` is a flagged read-only Weeks 2-4 projection. It is summarized in the main/index output and placed in the cross-week projection shard when `--v2-debug-artifact` is used. It derives weekly muscle demand and lane budgets from planner policy sources, keeps those concepts separate, and does not use repaired output, accepted seed, runtime replay, repair output, cleanup, or post-hoc set bumps as its target.
- `plannerOnlyNoRepair.v2ExerciseSelectionPlanDiagnostic` is a flagged read-only identity/class-lane diagnostic. It is summarized in the main/index output and placed in the selection-alignment shard when `--v2-debug-artifact` is used. It evaluates Week 1 no-repair selected identities against the planner-owned Weeks 2-4 projection using existing candidate, class, duplicate, concentration, inventory, fatigue, and capacity evidence; candidate alternatives are evidence only and missing generic inventory is reported as `not_evaluated` or `classification_gap`.
- `plannerOnlyNoRepair.v2SelectionCapacityPlanDiagnostic` is a flagged read-only capacity/headroom diagnostic. It is summarized in the main/index output and placed in the selection-alignment shard when `--v2-debug-artifact` is used. It consumes V2 set-distribution intent, no-repair Week 1 identity evidence, weekly muscle totals, existing selection diagnostics, and cap/concentration metadata to classify per-week lanes as target-met/no-action, capacity pressure, cap-aware expansion needed, optional suppressed, blocker, or not evaluated. It may also expose a projection-only `capacityPolicyTrialDesign` with a candidate slot-cap delta and a `capacityBehaviorProjection` that measures only direct cap-delta effects from existing evidence: headroom relief, unresolved floor rows, session-size status, unchanged selected identities/volume, and still-unknown materializer/acceptance gates. These fields must not feed scoring, generation, repair, seed serialization, replay, UI, receipts, or persistence.
- `plannerOnlyNoRepair.v2CapacityMaterializerProjection` is the flagged read-only materializer projection for the current capacity trial design. It rebuilds projection-only capacity and exercise-selection plans for the candidate slot-cap delta, reruns the V2 dry-run materializer for baseline versus trial, and reports target-slot identity/set deltas, floor-critical lane survival, materializer validity, seed-shape compatibility, compact candidate impact, and pass/fail/unknown gates. The materialization shard carries the detailed projection when `--v2-debug-artifact` is used; the main/index output keeps compact status, candidate-impact deltas, gate counts, and next safe action. Unknown over-MAV or acceptance gates mean the trial is not clean for behavior promotion. A zero-impact trial reports `capacity_trial_no_candidate_impact` and should pivot to a higher-ROI track instead of spending production behavior on a no-op. This projection must not feed scoring, generation, selection-v2, repair, seed serialization, runtime replay, receipts, UI, persistence, DB, or live V2 writes.
- `plannerOnlyNoRepair.v2SetBudgetMaterializerProjection` is the flagged read-only materializer projection for the selected `set_distribution_budget` representative. It applies the suspected lane budget only to an in-memory set-distribution policy copy, rebuilds projection-only selection capacity and exercise-selection plans, reruns the V2 dry-run materializer for baseline versus trial, and reports target-lane identity/set/blocker/regression deltas plus compact changed-slot rows. The materialization shard carries the detailed projection when `--v2-debug-artifact` is used; the main/index output keeps compact status and deltas. A zero-impact result classifies the selected representative as diagnostic/no-impact for behavior promotion. A positive delta is still blocked until cross-week, acceptance, seed/runtime, and non-consumption gates are measured. This projection must not feed demand, weekly curve, slot allocation, canonical set policy, scoring, generation, selection-v2, repair, seed serialization, runtime replay, receipts, UI, persistence, DB, or live V2 writes.
- `plannerOnlyNoRepair.v2ConcentrationMaterializerProjection` is the flagged read-only materializer projection for a selected concentration warning. It applies a one-step lane set-cap trial only to an in-memory exercise-selection plan copy across representative accumulation weeks, reruns the V2 dry-run materializer for baseline versus trial, and reports identity/set/blocker deltas plus concentration warning/share/fatigue proxy deltas. Its nested `donorOffsetRedistributionProjection` is the bounded read-only follow-up: it reads `SlotDemandAllocationByWeek` to pick same-muscle slot-owned donor-offset lanes, applies a bounded source -1 / donor +1 allocation policy trial to an in-memory `SlotDemandAllocationByWeek` copy before materialization, rebuilds projection-only class distribution, set distribution, selection capacity, and exercise-selection plans, and reports source/donor rows, donor capacity before/after, protected coverage impact, materializer deltas, concentration warning delta, regression causes, alternate donor candidates, acceptance/trainability status, readiness, blockers, and `nextSafeSlice`. The nested `slotWeekAllocationProjection` summarizes the pure donor-capacity rule: source pressure may be relieved only when a slot-owned donor absorbs the required sets, net weekly volume is unchanged, protected coverage is preserved, and the materializer does not regress. The materialization shard carries row detail when `--v2-debug-artifact` is used; the main/index output keeps compact status, deltas, cross-week readiness decision, blocker count, donor-offset status/readiness, slot-week allocation readiness, alternate counts, regression-cause counts, acceptance-projection decision, and next safe slice. Current 2026-06-12 live evidence proves exact donor absorption across representative weeks: Weeks 2-4 Calves move `lower_a:calves` 4 to 3 and `lower_b:calves` 4 to 5 with zero net weekly delta, preserved protected coverage, no materializer regression, and no over/under-absorption rows. Week 4 previously over-absorbed because fractional allocation `3.5/5.5` rounded to `4/6` after set distribution; the read-only trial now carries exact downstream baseline set targets before rebuild. The readout is `slotWeekAllocationReadiness=candidate_for_acceptance_projection`, `blockedRows=0`, and `slotWeekAllocationNextSafeSlice=run_acceptance_non_regression_projection`; `slotWeekAllocationAcceptanceProjection.decision=accepted_with_watch_items` because protected coverage, materializer safety, cross-week evidence, and non-consumption pass while benchmark warning gates remain. `crossWeekReadiness` separates coverage, redistribution/donor-offset proof, no-repair acceptance/Week 1 trainability, materializer non-regression, duplicate/concentration non-regression, production materializer non-consumption, and seed/runtime/receipt/DB non-consumption. Donor-offset success advances only to watch-item resolution or bounded behavior review; it does not make the candidate behavior-ready. This projection must not feed demand, weekly curve, canonical slot allocation, canonical set policy, scoring, generation, selection-v2, repair, seed serialization, runtime replay, receipts, UI, persistence, DB, or live V2 writes.
- `plannerOnlyNoRepair.v2SupportFloorMaterializerProjection` is the flagged read-only materializer projection for the selected `support_direct_floor` representative. It applies the suspected support-floor lane budget only to an in-memory projection copy, rebuilds projection-only selection capacity and exercise-selection plans, reruns the V2 dry-run materializer for baseline versus trial, and reports target-lane identity/set/blocker/regression deltas plus non-consumption flags. Pair it with `repairPromotionScoreboard.interpretation.supportFloorGapInventory` to read the selected week/slot/lane/muscle and direct floor expected versus delivered. A zero-impact result classifies the selected representative as diagnostic/no-impact for behavior promotion. A positive delta is still blocked until cross-week, acceptance, seed/runtime, and non-consumption gates are measured. This projection must not feed demand, weekly curve, slot allocation, support-lane policy, canonical set policy, scoring, generation, selection-v2, repair, seed serialization, runtime replay, receipts, UI, persistence, DB, or live V2 writes.
- `plannerOnlyNoRepair.v2SupportLaneProjectionDiagnostic` is a flagged read-only support-lane policy diagnostic. It is summarized in the main/index output and placed in the selection-alignment shard when `--v2-debug-artifact` is used. It applies the pure V2 support-lane policy to the planner-owned Weeks 1-4 no-repair projection, reports direct-floor status separately from capped collateral credit, labels optional/provisional second exposures as diagnostic-only, and does not feed scoring, generation, repair, seed serialization, replay, UI, receipts, or persistence.
- `plannerOnlyNoRepair.v2DeloadProjectionDiagnostic` is a flagged read-only Week 5 deload diagnostic. It is summarized in the main/index output and placed in the cross-week projection shard when `--v2-debug-artifact` is used. It consumes the V2 skeleton, Week 1 identity evidence, V2 deload transform, V2 set-distribution intent, and exercise-selection identity evidence to preserve identities where possible, project simple set reductions, target RIR 4-5, and introduce no movements. It is diagnostic-only and not consumed by runtime deload generation, selection, repair, seed serialization, replay, UI, receipts, or persistence.
- `plannerOnlyNoRepair.v2BasePlanCompare` is the read-only comparison of the clean materialized V2 base plan, the planner-only no-repair projection, and repaired projection evidence. It reports compact status, plan availability, V2/no-repair/repaired set totals, repair dependency count, classification counts, and next safe action in the main artifact and CLI. Detailed slot shape, muscle/class coverage, repair dependency, exercise identity, and deload-readiness rows stay in the `v2-materialization` shard when `--v2-debug-artifact` is enabled. Repaired projection is evidence, not target policy, and this compare must not feed scoring, generation, selection-v2, repair, seed serialization, runtime replay, receipts, UI, persistence, or live V2 writes.
- `plannerOnlyNoRepair.v2BasePlanShadowConsumptionTrial` is the read-only shadow consumption trial for the clean V2 base plan. It reports compact status, plan availability, shadow/V2/no-repair/repaired set totals, diagnostic repair dependency delta, classification counts, identity/materializer categorization, `consumedByProduction=false`, and next safe action in the main artifact and CLI. Detailed rows stay in the `v2-materialization` shard when `--v2-debug-artifact` is enabled. The trial must not feed scoring, generation, selection-v2, repair, seed serialization, runtime replay, receipts, UI, persistence, or live V2 writes.
- `plannerOnlyNoRepair.v2PlanQualityBenchmark` is the first read-only V2 candidate-quality benchmark. It evaluates the V2 candidate from first principles: support floors, direct work, lane preservation, session size, fatigue distribution, duplicate/concentration risk, materializer omissions, and Week 1 trainability. When pure V2 base-plan validation/compare evidence is available, the support-floor, direct-work, lane-preservation, session-size, and duplicate/concentration gates use that candidate evidence before falling back to legacy no-repair projection readouts. Legacy no-repair projection failures remain evidence about the old path, not proof that the pure V2 candidate failed. Session-size should warn only for pure slot-shape risk, not comparison-only weekly-set ambiguity; duplicate/concentration warnings should report exact reuse or class-family evidence as owner-specific watch items unless regression evidence exists. Optional direct top-up lanes that require a clean alternative should not reuse the same weekly exercise identity in pure V2 dry runs; remaining class-family reuse should stay a distinctness watch item until measured policy proof exists. Fatigue-distribution warnings are no-repair projection evidence unless explicitly sourced from a pure V2 projection, and should report concentration-derived counts, fatigue/collateral evidence counts, and example lanes. Missing evidence stays `missing_evidence`; do not infer readiness from absent data. The benchmark reports deprecation readiness only as review guidance and keeps guardrails explicit: no seed/runtime change, no production materializer change, no acceptance-threshold change, and no persistence change. Repaired projection is evidence only, not target policy.
- `plannerOnlyNoRepair.v2TargetVsNoRepairDiff` summarizes V2 target-skeleton alignment against the experimental no-repair output. Repaired projection is used only to mark repair-dependent lanes or legacy rescue evidence.
- To write the V2 debug index and default compact shards, add `--v2-debug-artifact`:

```powershell
npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com --operator-debug --planner-only-no-repair --compare-repaired --v2-debug-artifact
```

- `--v2-debug-artifact` is valid only with `--mode mesocycle-explain` and `--planner-only-no-repair`.
- When enabled, the CLI writes a sibling `*-v2-debug-index.json` artifact plus focused shard files such as `*-v2-strategy.json`, `*-v2-promotion-readiness.json`, `*-v2-promotion-diffs.json`, `*-v2-repair-evidence.json`, `*-v2-materialization.json`, `*-v2-cross-week-projection.json`, and `*-v2-selection-alignment.json`. The CLI prints the index path/size/sha256 and each written shard path/size/sha256.
- The main artifact keeps the old `mesocycleExplain.plannerOnlyNoRepair.debugArtifact` link field for compatibility, but that field now points to `kind="v2_debug_index"`. The index links back to the parent artifact through `parent.fileName` / `parent.relativePath` and lists every shard with `id`, `relativePath`, `hash`, `bytes`, `detailLevel`, and `status`.
- Default shard detail is `compact`. Summary fields stay in the main artifact and index; focused shards carry domain diagnostics without serializing large repeated arrays by default. Full detail is an internal serializer detail level reserved for explicit future opt-in and is not emitted by the current CLI flag.
- The index records budgets for the main artifact, index, default shard, full-detail shard, and the per-artifact size limit. Default shards are budgeted individually below the 1 MiB artifact limit.
- `plannerOnlyNoRepair.repairPromotionScoreboard` is readout-only. The main artifact keeps compact raw/safety/candidate counts plus an `interpretation` split; the repair-evidence shard keeps compact top rows with repeated evidence stored once and referenced by ID. Raw repaired-planning repair rows remain the evidence source, suspicious and safety rows remain visible, and only positive slot-owned likely-avoidable rows with V2 no-repair target ownership are counted as promotion candidates. Repaired rows are demoted when V2 already solves the target differently or the evidence is diagnostic, collateral, taxonomy, support-floor, set-distribution, or legacy repaired-artifact cleanup. The `interpretation.legacyRepairQuarantine` block labels repaired projection as `legacy_evidence_not_target_policy`, reports behavior candidates versus quarantined rows, and remains `readOnly=true` / `affectsScoringOrGeneration=false`. The companion `interpretation.quarantineGroups` block makes the denominator actionable: `upstreamOwnedCandidate` can identify owner-specific candidates, while `safetyRepairOnly`, `collateralAmbiguous`, `staleArtifact`, and `missingEvidenceOrUnmeasuredGate` remain evidence-only until their required proof is produced. `interpretation.repairDeprecationReadiness` classifies legacy repair paths as `safety_net`, `plan_authoring_leftover`, `obsolete_no_impact`, or `still_unproven`; `ready_for_deprecation_review` is non-executable and still requires benchmark/non-regression proof before removal. `interpretation.missingProofBeforeBehaviorPromotion` names the owner-specific candidate, current V2 policy gap, measured behavior projection, and seed/runtime non-consumption gates before any behavior promotion. `interpretation.gapInventory` ranks current V2 gaps by owner seam, evidence quality, training importance, missing proof, and measurable next step; `interpretation.selectedGapProof` records the current measured read-only proof result without approving behavior. A selected capacity/materializer row with `measured_no_candidate_impact` means pivot to a higher-ROI gap rather than promote a no-op. The wider `interpretation` split labels likely-avoidable raw rows as legacy repair evidence, then derives current V2 policy gaps from `v2TargetVsNoRepairDiff`, `v2SupportLaneProjectionDiagnostic`, `v2ExerciseSelectionPlanDiagnostic`, and materializer comparison diagnostics.
- It must not write accepted seeds, `slotPlanSeedJson`, receipts, planned workouts, runtime replay data, or performed workouts.
- `--operator-debug` also prints CLI-only `[workout-audit:timing]` spans for preflight, context build, audit generation, serialization, writes, summary formatting, total measured work, and teardown. These lines are not written into the JSON artifacts. The audit CLI explicitly closes its Prisma adapter pool at process end so the command does not wait for the Postgres pool idle timeout.

Projected current week volume:

```powershell
npm run audit:workout -- --mode projected-week-volume --user-id <user-id>
```

Current-week pre-execution guidance:

```powershell
npm run audit:workout -- --mode current-week-audit --user-id <user-id>
```

Active mesocycle dry-run slot-plan reseed audit:

```powershell
npm run audit:workout -- --mode active-mesocycle-slot-reseed --owner <owner-email>
```

Active mesocycle full slot-plan upgrade accept:

```powershell
npm run audit:workout -- --mode active-mesocycle-slot-reseed --owner <owner-email> --accept-slot-plan-upgrade
```

Legacy bounded upper-slot reseed apply:

```powershell
npm run audit:workout -- --mode active-mesocycle-slot-reseed --owner <owner-email> --apply-bounded-reseed
```

- The full accept path is server-side only and replaces only the active mesocycle's `slotPlanSeedJson`.
- The command still emits the dry-run diff artifact first, then accepts only when the live verdict is exactly `safe_to_accept_upgrade`.
- Structural guards reject candidate seeds that change slot order, omit explicit `setCount`, or reference missing exercises.
- `needs_projection_fix_first` and `not_safe_to_apply` remain hard stop verdicts.

Empty active mesocycle V2 replacement dry-run:

```powershell
npm run audit:workout -- --env-file .env.local --mode replace-empty-mesocycle-with-v2 --owner <owner-email> --mesocycle-id <active-empty-mesocycle-id> --replace-empty-active-mesocycle-with-v2 --dry-run
```

Guarded write, only after the dry-run artifact is clean:

```powershell
npm run audit:workout -- --env-file .env.local --mode replace-empty-mesocycle-with-v2 --owner <owner-email> --mesocycle-id <active-empty-mesocycle-id> --replace-empty-active-mesocycle-with-v2 --write --confirm-empty-mesocycle-replacement
```

- This path is owner-scoped, mesocycle-id-scoped, and fail-closed.
- Dry-run is the default; write requires the explicit replacement flag plus confirmation.
- The write path updates only `Mesocycle.slotPlanSeedJson`, preserves the mesocycle id and `slotSequenceJson`, and uses `buildMesocycleSlotPlanSeed()` through the V2 accepted-seed preparation helper.
- Any logged workout, performed set, runtime deviation, historical/closed state, V2 validation blocker, blocked materializer, or incompatible seed shape is a hard stop.

Empty active successor recovery from persisted accepted seed draft:

```powershell
npm run audit:workout -- --env-file .env.local --mode replace-empty-successor-from-accepted-seed-draft --owner <owner-email> --source-mesocycle-id <completed-source-mesocycle-id> --mesocycle-id <active-empty-successor-id> --replace-empty-successor-from-accepted-seed-draft --dry-run
```

Guarded write, only after dry-run returns `safe_to_accept_upgrade`:

```powershell
npm run audit:workout -- --env-file .env.local --mode replace-empty-successor-from-accepted-seed-draft --owner <owner-email> --source-mesocycle-id <completed-source-mesocycle-id> --mesocycle-id <active-empty-successor-id> --replace-empty-successor-from-accepted-seed-draft --write --confirm-accepted-seed-draft-successor-recovery
```

- This path consumes exactly `source.nextSeedDraftJson.acceptedSeedDraft.slotPlanSeedJson`; it does not regenerate V2 and does not fall back to legacy projection.
- The write path updates only the active successor `Mesocycle.slotPlanSeedJson` and preserves `slotSequenceJson`, workouts, logs, sessions, and runtime replay.
- Source/target lifecycle, expected successor linkage, empty target state, minimal seed rows, exercise existence, explicit set counts, slot order, and expected anchor rows are all hard guards.

Retrospective completed-week volume and slot review:

```powershell
npm run audit:workout -- --mode weekly-retro --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id>
```

Retrospective projection-delivery drift review from a prior projected-week-volume artifact:

```powershell
npm run audit:workout -- --mode weekly-retro --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id> --projection-artifact <projected-week-volume-artifact-path>
```

Future week for one explicit intent:

```powershell
npm run audit:workout -- --mode future-week --user-id <user-id> --intent pull
```

Forced deload preview:

```powershell
npm run audit:workout -- --mode deload --user-id <user-id> --intent pull
```

Progression / anchor trace:

```powershell
npm run audit:workout -- --mode progression-anchor --user-id <user-id> --exercise-id <exercise-id> --workout-id <workout-id>
```

## What To Inspect

Use this section as a quick validation smoke-check only. Full artifact interpretation order belongs in `docs/09_AUDIT_PLAYBOOK.md`.

- `historicalWeek.sessions[*].sessionSnapshot`
- `historicalWeek.sessions[*].progressionEvidence`
- `historicalWeek.sessions[*].weekClose`
- `historicalWeek.sessions[*].reconciliation`
- `sessionSnapshot.generated.traces.progression`
- `sessionSnapshot.generated.traces.deload`
- `projectedWeekVolume.projectedSessions[*].projectedContributionByMuscle`
- `projectedWeekVolume.currentWeekAudit`
- `projectedWeekVolume.interventionHints`
- `projectedWeekVolume.sessionRisks`
- `projectedWeekVolume.fullWeekByMuscle[*]`
- `weeklyRetro.projectionDeliveryDrift` when `--projection-artifact` is provided

## Expected Hardening Checks

- Deload traces include `resolvedTopSetLoad`, `resolvedSetLoads`, and `resolvedLoadSource`.
- Historical week entries expose whether a session counted toward progression history without reading code.
- Historical week entries surface linked or target-week-close state when relevant.
- Reconciliation reports generated-vs-saved drift without flattening the generated/saved layers.
- Weekly-retro exposes `planAdherence` so planned-work completion, explained runtime additions, substitutions, and unclassified drift remain separate.
- Projected-week-volume separates completed weighted volume from projected next-session, projected remaining-week, and projected full-week totals.
