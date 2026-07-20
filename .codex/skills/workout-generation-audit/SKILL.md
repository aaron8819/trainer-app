---
name: workout-generation-audit
description: Deterministic QA gate for Trainer workout generation and projected session outputs. Use when changes affect generation, session assembly, progression, deload behavior, slot-plan or slot-runtime composition, explainability tied to generated output, or workout-audit logic across `trainer-app/src/lib/api`, `trainer-app/src/lib/engine`, `trainer-app/src/lib/audit/workout-audit`, and related routes/tests. Force validation through canonical seams, focused tests, and existing audit tooling instead of ad hoc reasoning.
---

# Workout Generation Audit

Use this skill as a hard QA gate for generation-facing changes.

## HARD RULE

Do not mark the task complete, and do not claim generation behavior is correct, until a matching canonical audit path has been run and reviewed.

## Pre-audit workflow

1. Run `.\scripts\codex\Start-TrainerTask.ps1` from the repository root with `shared-seam-write` for an authorized generation change or `audit` for read-only QA, using the authorized base. Stop on blockers and respect the reported path and database policies; Phase 1 is inspect-only and classification grants no database or production authorization.
2. Read `trainer-app/docs/00_START_HERE.md`.
3. Read `trainer-app/docs/02_DOMAIN_ENGINE.md`.
4. Read `trainer-app/docs/06_TESTING.md`.
5. Read `trainer-app/docs/09_AUDIT_PLAYBOOK.md`.
6. Read `trainer-app/docs/08_AUDIT_CLI_DB_VALIDATION.md` when you need direct CLI validation details.
7. Read the owning seam before editing:
   - orchestration and session assembly: `trainer-app/src/lib/api/template-session.ts` and `trainer-app/src/lib/api/template-session/*`
   - progression and load decisions: `trainer-app/src/lib/engine/progression.ts`, `trainer-app/src/lib/engine/apply-loads.ts`, `trainer-app/src/lib/progression/canonical-progression-input.ts`
   - deload and lifecycle coupling: `trainer-app/src/lib/api/template-session/deload-session.ts`, `trainer-app/src/lib/api/mesocycle-lifecycle*`
   - slot-plan and slot-runtime composition: `trainer-app/src/lib/api/mesocycle-slot-runtime.ts`, `trainer-app/src/lib/api/template-session/slot-plan-seed.ts`, `trainer-app/src/lib/api/mesocycle-handoff-slot-plan-projection.ts`
   - audit harness: `trainer-app/src/lib/audit/workout-audit/*`, especially `context-builder.ts`, `generation-runner.ts`, `serializer.ts`, `types.ts`, and `bundle.ts`
8. Read the nearby tests before changing behavior.
9. Run the default local-only `.\scripts\codex\Invoke-TrainerDoctor.ps1` before checks that depend on local tools or dependencies. Optional-tool gaps warn and required-prerequisite gaps block affected execution. The doctor does not install, authenticate, repair, connect, migrate, or deploy; do not enable remote/database scopes without explicit need and authorization.

## Non-negotiable rules

- Do not validate generated output by eyeballing code paths alone.
- Do not treat UI cues or `/workout/[id]/audit` as the recurring canonical audit gate.
- Do not invent one-off debug fields, local reasoning ladders, or alternate audit logic when the harness already exposes the answer.
- Do not bypass receipt-first truth. Generated and projected output must reconcile through `selectionMetadata.sessionDecisionReceipt`, canonical semantics, and the owning audit artifact.
- Treat disagreement between focused tests and the matching audit mode as a blocking failure until resolved.
- Do not treat explainability, dashboard summaries, preview cards, or other read-side consumers as proof of generator correctness unless the canonical audit artifact supports the same conclusion.

## Required verification flow

1. Generate and review `.\scripts\codex\Invoke-TrainerVerification.ps1 -BaseRef <authorized-base>` and route the plan through `test-impact-triage`.
2. Use `-Run` only for registry-approved local implementation checks whose prerequisites are present. Keep release-only and authorization-gated checks visible but skipped.
3. Run the canonical audit mode that matches the behavior you changed when its runtime/database scope is explicitly authorized:
   - next generated session or explicit intent path: `npm run audit:workout -- --env-file .env.local --mode future-week --owner owner@local`
   - explicit intent preview: add `--intent <intent>`
   - deload behavior or deload reroute: `npm run audit:workout -- --env-file .env.local --mode deload --owner owner@local --intent <intent>`
   - next-mesocycle projection, slot allocation, or repair diagnostics: use the registered `mesocycle-explain` command with `--operator-debug` and the authorized owner target
   - suspicious next-load decision: `npm run audit:workout -- --env-file .env.local --mode progression-anchor --owner owner@local --exercise-id <exercise-id> --workout-id <workout-id>`
   - week-close or optional-gap-fill ownership: `npm run audit:week-close-handoff -- --env-file .env.local --owner owner@local --target-week <n>`
   - cross-intent generation stability or planner diagnostics gating: `npm run test:audit:matrix`
4. Treat any selected but unexecuted release check as remaining release work, not as a passed gate.

## What to inspect

For `future-week` and `deload` audits, inspect these first:

- `generationPath`
- `warningSummary`
- `sessionSnapshot.generated.semantics`
- `sessionSnapshot.generated.traces.progression`
- `sessionSnapshot.generated.traces.deload`
- `selection.sessionDecisionReceipt.plannerDiagnostics` when diagnostics are relevant

For `progression-anchor`, inspect:

- `trace.outcome`
- `trace.metrics`
- `trace.anchor`
- `trace.confidence`
- `trace.decisionLog`
- `canonicalSemantics`

For historical or ownership-sensitive questions, inspect:

- `historicalWeek.sessions[*].canonicalSemantics`
- `historicalWeek.sessions[*].progressionEvidence`
- `historicalWeek.sessions[*].reconciliation`
- `historicalWeek.sessions[*].weekClose`

For `mesocycle-explain` projection and repair audits, inspect:

- CLI `Architecture Signal` from `Planning Reality Summary`
- `mesocycleExplain.preview.projectionDiagnostics.planningReality.summary.planningShape`
- `materialRepairCount` and `majorRepairCount`
- `repairMaterialityAfterShadowAllocation[*].likelyAvoidableWithShadowAllocation`
- `repairMaterialityAfterShadowAllocation[*].shadowAllocationBasis`
- promotion candidates, remaining repair/cap cleanup, and suspicious downstream repairs not eligible for promotion

Interpretation:

- `mostly_repair_shaped` means upstream WeeklyMuscleDemand -> SlotDemandAllocation work should come before tuning repair.
- Likely avoidable repairs may be promoted only when bounded, slot-owned, and non-suspicious.
- `shadowAllocationBasis="weekly_demand_owned_elsewhere"` is a promotion blocker; name the offending slot/muscle/exercise.
- Remaining repairs that are mostly cap cleanup point toward set distribution and concentration policy, not demand allocation.

## Determinism checks

- Treat `standard` vs `debug` planner diagnostics as a gating contract: candidate-heavy closure traces may differ in visibility, but generated selection and artifact conclusions must stay aligned.
- If a change touches closure, rescue, or planner diagnostics persistence, confirm diagnostics gating through the existing matrix coverage instead of adding ad hoc assertions.
- If a change touches deload routing, confirm whether the artifact reports `standard_generation` or `active_deload_reroute` before interpreting the rest.
- If a change touches progression explainability, confirm the read-side explanation still matches canonical progression output rather than a UI-local interpretation.

## REQUIRED OUTPUT

Before concluding, output:

- **Owning generation seam**
- **Changed behavior**
- **Audit mode used**
- **Tests run**
- **Artifact fields inspected**
- **Observed output impact**
- **Pass/fail verdict**
- **Open concerns**

Keep it concrete. Do not substitute code-structure commentary for output validation.

## Pass/fail rule

Fail the QA gate when any of these are true:

- focused tests fail
- the matching audit mode fails or contradicts the intended behavior
- artifact semantics disagree with the owning seam
- generated output depends on UI-local or explainability-local policy
- the change requires a prose explanation to justify behavior that the canonical audit artifact cannot support
