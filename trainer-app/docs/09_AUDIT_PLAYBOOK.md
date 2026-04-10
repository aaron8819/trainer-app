# 09 Audit Playbook

Owner: Aaron  
Last reviewed: 2026-03-16  
Purpose: Canonical operational playbook for recurring workout-audit CLI use. This doc tells operators and maintainers which audit to run, what to inspect first, what counts as a red flag, and when to escalate into deeper code-level investigation.

This doc covers:
- Recurring operational use of `historical-week`, `weekly-retro`, `future-week`, `projected-week-volume`, `current-week-audit`, `deload`, and `progression-anchor`
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

Fast operator loop:

```powershell
npm run audit:week:retro -- --user-id <user-id> --week <week> --mesocycle-id <mesocycle-id>
```

Inspect first:
- `weeklyRetro.executiveSummary`
- `weeklyRetro.loadCalibration`
- `weeklyRetro.sessionExecution`
- `weeklyRetro.slotBalance`
- `weeklyRetro.volumeTargeting`
- `weeklyRetro.recommendedPriorities`

Common red flags:
- `loadCalibration.status !== "aligned"` when you expected clean comparable modern coverage
- `slotBalance.missingSlotIdentityCount > 0` or `slotBalance.duplicateSlotCount > 0`
- `volumeTargeting.belowMev.length > 0`
- `rootCauses[*].code` points at reconciliation drift or legacy coverage gaps you did not expect

Escalate when:
- slot identity receipts are missing or duplicated for advancing sessions
- reconciliation drift changes the meaning of the week enough that actual-vs-target conclusions are suspect
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

### `active-mesocycle-slot-reseed`

When to use it:
- dry-run review of a bounded active-cycle slot-seed repair
- compare persisted seeded upper-slot composition against a fresh reprojection
- answer whether a bounded reseed is safe before any mutation is approved

Primary questions it answers:
- what would change in `upper_a` / `upper_b` if current projection logic rebuilt the seed today
- whether chest / triceps support improves materially
- whether row / vertical-pull support and slot identity stay intact
- whether the result is `safe_to_apply_bounded_reseed`, `not_safe_to_apply`, or `needs_projection_fix_first`

Command pattern:

```powershell
npm run audit:workout -- --env-file .env.local --mode active-mesocycle-slot-reseed --owner <owner-email>
```

Bounded apply variant:

```powershell
npm run audit:workout -- --env-file .env.local --mode active-mesocycle-slot-reseed --owner <owner-email> --apply-bounded-reseed
```

Apply guardrails:
- the command writes only the current active mesocycle
- only `upper_a` / `upper_b` are eligible
- the persisted diff artifact is still emitted before mutation
- apply is allowed only when `recommendation.verdict="safe_to_apply_bounded_reseed"`
- `needs_projection_fix_first` and `not_safe_to_apply` are hard stops
- lower-slot seeds, runtime hot patching, and non-active mesocycles stay out of scope

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
4. Read `weeklyRetro.loadCalibration` before trusting actual-vs-target conclusions.
5. Read `weeklyRetro.sessionExecution` for compact completed/skipped status, slot identity, progression eligibility, week-close visibility, and reconciliation context before drilling into historical-week.
6. Read `weeklyRetro.slotBalance` and resolve any missing or duplicate slot identity first.
7. Read `weeklyRetro.volumeTargeting` for actual weekly target / MEV / MAV comparisons and contributor context.
8. Follow `weeklyRetro.recommendedPriorities` in order.
9. Escalate if slot integrity, reconciliation drift, or legacy coverage limitations make the retrospective answer unreliable.

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
3. Confirm the artifact is scoped to the intended active mesocycle and `upper_a` / `upper_b`.
4. Read `flags` before trusting the candidate diff.
5. Read `aggregateMuscleDiff` for chest / triceps / side-delt movement.
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
- This is the top-line dry-run verdict for bounded reseed safety.
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
