# 09 Audit Playbook

Owner: Aaron  
Last reviewed: 2026-03-16  
Purpose: Canonical operational playbook for recurring workout-audit CLI use. This doc tells operators and maintainers which audit to run, what to inspect first, what counts as a red flag, and when to escalate into deeper code-level investigation.

This doc covers:
- Recurring operational use of `historical-week`, `future-week`, `deload`, and `progression-anchor`
- Default audit workflows for common review scenarios
- Artifact-reading guidance for the current audit JSON vocabulary
- Red flags, escalation triggers, and legacy-data caveats

Invariants:
- This playbook is operational guidance, not a second source of runtime semantics.
- Runtime truth lives in the canonical audit artifacts plus the owning code seams referenced here.
- When artifact output conflicts with prose, trust the artifact and the code owner it points to.

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
- the next generated session or week path
- a deload preview or live deload routing path
- a suspicious progression / anchor decision for one exercise

This playbook is designed to answer:
- what the audit system generated or reconstructed
- whether a session counted toward progression history or was excluded
- whether a future-week request used the normal path or rerouted through deload
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

### `future-week`

When to use it:
- upcoming session preview
- recurring "what will the system generate next?" checks
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
- anchor source or anchor load looks incompatible with the performed top-set evidence

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

### Upcoming week preview
1. Run `future-week`.
2. Check `generationPath` first.
3. Check `warningSummary`.
4. Read `sessionSnapshot.generated.semantics`.
5. If `isDeload=true`, inspect the deload trace immediately.
6. Escalate if routing, warnings, or semantics are inconsistent with live mesocycle state.

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

Boundary rules:
- do not silently replace canonical artifact truth with coaching interpretation
- do not restate engine behavior locally when the owning code seam already defines it
- use this doc to decide what to run and what to inspect, not to override the runtime

## 8. Quick-Reference Checklist

- Run the narrowest audit mode that matches the question.
- Read `warningSummary` first.
- For generated modes, read `generationPath` before interpreting the rest.
- For historical-week, read `comparabilityCoverage` before trusting drift analysis.
- Use `sessionSnapshot` as the main evidence record.
- Use `progressionEvidence` for quick inclusion/exclusion triage.
- Use `weekClose` for workflow/deficit truth, not just week labels.
- Use `reconciliation.changedFields` for drift triage.
- For deload, read load provenance fields together.
- For progression-anchor, start with `action`, `path`, and `reasonCodes`.
- Escalate when artifact fields contradict each other, omit needed truth because of legacy coverage, or fail to explain a meaningful runtime outcome.
