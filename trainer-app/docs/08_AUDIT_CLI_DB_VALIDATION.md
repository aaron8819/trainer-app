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
- The main `mesocycle-explain` artifact is the operator artifact: it keeps read-only markers, no-repair summary, replacement readiness, compact V2 summary, compact cross-week gate summary, top operator findings, and a debug-artifact manifest. It does not carry the full V2 diagnostic payload.
- The payload includes `plannerOnlyNoRepair.acceptanceClassification`, which separates basic Week 1 no-repair shape validity from replacement readiness. Diagnostic/collateral concentration and migration scoreboards are readout unless promoted into explicit hard blockers by target, cap, forbidden-slot, set-count, or seed-replay policy.
- The payload includes `plannerOnlyNoRepair.crossWeekProjectionGate`, which separates Week 1 basic shape, Weeks 2-4 accumulation projection, deload diagnostic projection, and broad replacement readiness. The main artifact keeps only compact gate statuses/counts; the V2 sidecar carries the full gate. Weeks 2-4 and deload may report `projected_with_limitations` when planner-owned/read-only diagnostics exist, but `safeToPromoteBehavior` remains `false` while those projections are not consumed by selection/seed/runtime, accepted seed/runtime consumption is undefined, or repair dependency could worsen.
- `plannerOnlyNoRepair.v2MesocyclePlan` summarizes the stable upper/lower 4x skeleton, Weeks 1-5 progression modifiers, deload transform intent, validation-rule statuses, and replacement-readiness blockers. It is flagged-only, read-only, and non-generative.
- `plannerOnlyNoRepair.v2SetDistributionIntent` summarizes lane-level min/preferred/max set budgets from the V2 target skeleton and weekly progression multipliers. Cap and concentration policy are validation metadata, not set-budget source truth, and the field is flagged-only, read-only, and non-generative.
- `plannerOnlyNoRepair.plannerOwnedAccumulationProjection` is the flagged-sidecar-only Weeks 2-4 read-only projection. It derives weekly muscle demand and lane budgets from planner policy sources, keeps those concepts separate, and does not use repaired output, accepted seed, runtime replay, repair output, cleanup, or post-hoc set bumps as its target.
- `plannerOnlyNoRepair.v2ExerciseSelectionPlanDiagnostic` is the flagged-sidecar-only read-only identity/class-lane diagnostic. It evaluates Week 1 no-repair selected identities against the planner-owned Weeks 2-4 projection using existing candidate, class, duplicate, concentration, inventory, fatigue, and capacity evidence; candidate alternatives are evidence only and missing generic inventory is reported as `not_evaluated` or `classification_gap`.
- `plannerOnlyNoRepair.v2DeloadProjectionDiagnostic` is the flagged-sidecar-only read-only Week 5 deload diagnostic. It consumes the V2 skeleton, Week 1 identity evidence, V2 deload transform, V2 set-distribution intent, and exercise-selection identity evidence to preserve identities where possible, project simple set reductions, target RIR 4-5, and introduce no movements. It is diagnostic-only and not consumed by runtime deload generation, selection, repair, seed serialization, replay, UI, receipts, or persistence.
- `plannerOnlyNoRepair.v2TargetVsNoRepairDiff` summarizes V2 target-skeleton alignment against the experimental no-repair output. Repaired projection is used only to mark repair-dependent lanes or legacy rescue evidence.
- To write the full V2 evidence payload, add `--v2-debug-artifact`:

```powershell
npm run audit:workout -- --env-file .env.local --mode mesocycle-explain --owner aaron8819@gmail.com --operator-debug --planner-only-no-repair --compare-repaired --v2-debug-artifact
```

- `--v2-debug-artifact` is valid only with `--mode mesocycle-explain` and `--planner-only-no-repair`.
- When enabled, the CLI writes a sibling `*-v2-no-repair-debug.json` sidecar and prints its path, size, and sha256.
- The main artifact links to the sidecar through `mesocycleExplain.plannerOnlyNoRepair.debugArtifact`; the sidecar links back to the parent artifact through `parent.fileName` and `parent.relativePath`.
- The sidecar contains the full `summary`, `acceptanceClassification`, `crossWeekProjectionGate`, `v2MesocyclePlan`, `v2SetDistributionIntent`, `plannerOwnedAccumulationProjection`, `v2ExerciseSelectionPlanDiagnostic`, `v2DeloadProjectionDiagnostic`, `v2TargetVsNoRepairDiff`, slot plans, weekly totals, allocation changes, acceptance checks/failures, repaired comparison, lane evidence, diagnostic catalogs, and classification details. Both main and sidecar remain read-only and `affectsScoringOrGeneration=false`.
- `plannerOnlyNoRepair.repairPromotionScoreboard` is readout-only. The main artifact keeps compact raw/safety/candidate counts; the V2 sidecar keeps the full classified rows. Raw repaired-planning repair rows remain the evidence source, suspicious and safety rows remain visible, and only positive slot-owned likely-avoidable rows are counted as promotion candidates.
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
