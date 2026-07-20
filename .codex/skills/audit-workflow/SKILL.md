---
name: audit-workflow
description: Standardize Trainer audit-harness routing and artifact interpretation. Use when running or reading workout-audit artifacts, choosing between audit modes, interpreting V2 plan-quality benchmark gates, checking audit CLI runtime targeting or owner resolution, or improving audit/reporting workflows without changing generation policy.
---

# Audit Workflow

Route audit questions to the correct harness mode before proposing fixes. Preserve the difference between next-session projection, full current-week projection, runtime targeting, and real engine defects.

## Read only what you need

1. Read `AGENTS.md`.
2. Read `trainer-app/docs/09_AUDIT_PLAYBOOK.md` for mode semantics and artifact fields.
3. Read `trainer-app/docs/07_OPERATIONS.md` only when runtime targeting or owner resolution matters.

## Repository orchestration

Begin read-only audit work with `.\scripts\codex\Start-TrainerTask.ps1 -Name <task-name> -Classification audit -BaseBranch <authorized-base>`. Use `shared-seam-write` instead when the authorized task changes audit tooling or reporting. Stop on blockers, separate warnings, and respect the reported paths and database policy; audit classification does not authorize database access by itself.

Before executing an audit command that depends on local tools or dependencies, run the default local-only `.\scripts\codex\Invoke-TrainerDoctor.ps1`. Optional-tool gaps warn; required-prerequisite gaps block the affected command. The doctor does not install, authenticate, repair, connect, migrate, or deploy. Database or remote audit targeting requires an explicit need and the authorization required by repository policy.

After audit-tooling changes, generate and review `.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef <authorized-base>`. Route interpretation to `test-impact-triage`; use `-Run` only for registry-approved local implementation checks and report release-only or authorization-gated checks separately.

## Hard rules

- Do not use `future-week` to answer full-week coverage questions.
- Do not use `projected-week-volume` to explain a single next-session routing anomaly.
- Do not infer structural underdosing from a mid-week `future-week` snapshot.
- Do not change generation logic when the issue is only audit CLI, serializer, reporting, or interpretation.
- Do not use manual workout edits as the fix for an audit or reporting problem.
- Do not expand into architecture redesign when the issue is readout or tooling only.

## Choose the mode

Start by restating the exact audit question.

- Use `future-week` for next-session preview, midstream projection, explicit-intent preview, warning review, or standard-vs-deload routing checks.
- Use `projected-week-volume` for full current-week projected muscle volume, completed-plus-remaining slot coverage, and weekly target / MEV / MAV attainment.
- If the task mixes both questions, run or interpret both modes separately and keep the conclusions separate.

## Check runtime targeting first

Before trusting the artifact, confirm the runtime target.

- If the task names a concrete owner, pass `--user-id` or `--owner`.
- If neither flag is provided, remember the audit CLI follows app-default owner resolution: `OWNER_EMAIL` when present, otherwise `owner@local`.
- If the artifact owner, week, or phase is not the intended runtime, stop and correct targeting before interpreting semantics.

## Interpret truthfully

For `future-week`, read these first:

- `generationPath`
- `warningSummary`
- `sessionSnapshot.generated.semantics`
- relevant progression or deload traces

Interpretation frame:

- This is next-session truth, not full-week truth.
- It can show routing, warnings, and generated session semantics.
- It cannot prove weekly underdosing by itself.

For `projected-week-volume`, read these first:

- `projectedWeekVolume.currentWeek`
- `projectedWeekVolume.projectionNotes`
- `projectedWeekVolume.projectedSessions`
- `projectedWeekVolume.fullWeekByMuscle`

Interpretation frame:

- This is full current-week projection from completed plus remaining advancing slots.
- Read `projectionNotes` before trusting the totals.
- Mid-week deficits are not structural failures if remaining projected slots close the gap.

For `mesocycle-explain`, read the compact CLI summary first when present:

- Run the registered `mesocycle-explain` audit command for the explicitly authorized runtime target.
- Read `Planning Reality Summary` before opening the full JSON.
- Then inspect `mesocycleExplain.preview.projectionDiagnostics.planningReality.summary.planningShape`, `materialRepairCount`, `majorRepairCount`, `warnings`, `repairMateriality`, `repairMaterialityAfterShadowAllocation`, `exerciseConcentration`, and `slotDemandAllocation`.

Interpretation frame:

- `mostly_repair_shaped`: recommend upstream WeeklyMuscleDemand -> SlotDemandAllocation ownership before selection, not more downstream repair.
- `mixed_upstream_plus_repair_shaped`: identify the repaired muscles and slots that should be promoted upstream.
- `mostly_upstream_planned`: focus on validators, concentration, and set distribution quality.
- Missing `planningReality`: call out insufficient instrumentation instead of inferring the architecture signal.
- When `repairMaterialityAfterShadowAllocation` exists, always report:
  - `planningShape`
  - `materialRepairCount`
  - `majorRepairCount`
  - likely upstream-avoidable material repairs
  - remaining material repairs
  - suspicious repairs not eligible for promotion
  - promotion candidates
  - highest-leverage next move
- Classify shadow repair rows into exactly these buckets:
  - promote-ready upstream demand: material repairs with `likelyAvoidableWithShadowAllocation=true`; only these are candidates for bounded, slot-owned pre-selection planning.
  - remaining repair/cap cleanup: material repairs not likely avoidable and not owned elsewhere; these point toward set distribution, concentration, or cap policy.
  - suspicious downstream repair that must not be promoted: material repairs with `shadowAllocationBasis="weekly_demand_owned_elsewhere"`.
- If suspicious repairs exist, call them out as blockers before behavior promotion. Example: `lower_b Chest via Cable Crossover` is not eligible for upstream promotion because Chest is owned by upper slots / elsewhere in shadow allocation.
- If likely avoidable repairs exist, recommend promoting only bounded, slot-owned, non-suspicious demand into pre-selection planning.
- Before implementing any shadow-demand promotion, follow the `Safe Promotion Trial Protocol` in `trainer-app/docs/09_AUDIT_PLAYBOOK.md`: baseline `mesocycle-explain --operator-debug`, change one candidate class, re-run the same audit, keep only improving/non-regressing deltas, and revert if material/major/suspicious repairs or cross-region smells worsen. Never promote candidates wholesale.
- If remaining repairs are mostly cap cleanup, recommend set distribution / concentration policy rather than demand allocation.

## Interpret V2 plan-quality benchmark gates

When the artifact includes a V2 plan-quality benchmark, treat it as the primary first-principles work queue before repair-row probes.

Read each gate with its source attribution:

- `pure_v2_base_plan` / V2 compare evidence: candidate-quality truth for V2-authored plan shape.
- `v2_shadow` / projection diagnostics: high-fidelity preview or stress evidence, not accepted candidate truth by itself.
- `planner_only_no_repair`: legacy/no-repair projection evidence; useful for handoff risk, not proof that pure V2 failed.
- `repaired_projection`: safety-net evidence only; never a target policy.
- acceptance/no-repair readouts: candidate trainability watch items, not planner authorship.

Rules:

- Do not infer a pure V2 failure from a no-repair projection failure when pure V2 base-plan evidence exists.
- Gates should report status, owner seam, evidence source, and smallest safe next move.
- Use failing benchmark gates as the work queue. Use warning gates as watch items unless they expose a must-fix-before-Week-1 risk.
- Repair quarantine/readouts are useful for cleanup and deprecation decisions, but should not be the default V2 planner improvement loop once plan-quality benchmark coverage exists.
- Deprecate repair behavior only after source-attributed benchmark evidence and non-regression checks show it is not needed for accepted candidate quality or safety.

## Classify the issue

- `tooling/readout`: wrong mode, misleading labels, missing caveat, serializer/report mismatch, or targeting confusion
- `runtime correctness`: wrong owner/week/phase, stale runtime assumptions, or artifact aimed at the wrong state
- `real engine allocation/policy issue`: correctly targeted artifact from the correct mode still shows a real generation or volume problem

## Recommend the next step

- `no action` when the artifact answers the question once interpreted correctly
- `design-only` when wording, workflow, docs, or output framing should improve without code
- `implementation` when audit harness or reporting behavior must change, or when correctly targeted artifacts prove a real engine/policy defect

If the issue is tooling or readout only, keep the change in the audit/reporting seam. Escalate into generation or policy only when the correct artifact supports that conclusion.

## Verification

- For read-only audit interpretation tasks, make no code changes.
- For audit harness or reporting changes, run focused tests for the changed audit files plus one targeted live audit command for the affected mode before broader verification.
- Preserve existing audit mode semantics unless the task explicitly changes them.
- Reach for broader verification only when shared CLI parsing, contracts, or reused audit seams changed.

## Read-Only Diagnostic Refactor Checklist

For mechanical refactors of audit/diagnostic code, especially `planningReality`, artifact equality is the fastest no-drift proof.

- Capture a live baseline artifact before the refactor when feasible.
- Keep large mechanical splits explicit: export/import through a stable facade, and prefer direct named imports over hidden behavior changes.
- Compare serialized diagnostic subobject equality after the refactor, for example `planningRealityJsonEqual: true`.
- Compare key summary values: `planningShape`, `materialRepairCount`, `majorRepairCount`, `likelyAvoidableMaterialRepairCount`, `remainingMaterialRepairCount`, and `suspiciousRepairsNotEligibleForPromotion`.
- Compare important diagnostic summaries when present: `exerciseClassAlignment`, `exerciseClassUnresolvedCauses`, `duplicateContinuityJustification`, and `preselectionDistributionPolicyByWeek`.
- Compare artifact and section byte sizes: full artifact bytes, `planningReality` bytes, and any touched section bytes.
- Confirm CLI/operator summary text is semantically unchanged.
- Use the repository verification plan for local checks, then run the matching live `mesocycle-explain` audit only when its runtime and database access are explicitly in scope.

Do not accept a read-only diagnostic refactor based only on TypeScript/tests if serialized diagnostic equality was not checked. Tests may pass while artifact shape or meaning drifts.

## Required output

Return:

- the clarified audit question
- the chosen audit mode
- the runtime-targeting check
- the truthful interpretation frame
- the issue classification: `tooling/readout`, `runtime correctness`, or `real engine allocation/policy issue`
- the recommended next step
