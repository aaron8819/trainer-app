# Hypertrophy Mesocycle Engine Target Spec

Owner: Aaron
Last reviewed: 2026-04-27
Purpose: Convert the first-principles 5-week upper/lower hypertrophy mesocycle design into a concrete target engine spec and migration map.

This report is a target architecture map, not current runtime behavior. Current runtime truth remains code plus audit artifacts. The live reference artifact used for this mapping was:

- `artifacts/audits/2026-04-27T13-46-09-620Z-mesocycle-explain.json`
- Owner: `aaron8819@gmail.com`
- Source mesocycle: `ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4`
- Architecture signal: `mostly_repair_shaped`
- Material repairs: `20`
- Major repairs: `10`
- Likely upstream-avoidable material repairs: `10`
- Suspicious repairs not eligible for promotion: `6`

## 1. Executive Summary

Yes, the target design aligns with the current diagnostics direction. The current diagnostics are already pointing toward the same top-down flow:

```txt
weekly muscle demand
-> slot allocation
-> exercise class intent
-> set distribution
-> exercise selection
-> repair as safety net
```

The current engine has good pieces already:

- `getWeeklyVolumeTarget()` and block-aware lifecycle math already describe weekly volume targets and 5-week RIR progression.
- `Mesocycle.slotSequenceJson` plus authored slot semantics already encode `upper_a`, `upper_b`, `lower_a`, and `lower_b` identity.
- `Mesocycle.slotPlanSeedJson` already gives accepted seeded mesocycles deterministic runtime replay.
- `planningReality.weeklyDemandCurve`, `slotDemandAllocationByWeek`, `exerciseClassDistributionBySlot`, `setDistributionIntents`, `exerciseClassAlignment`, and `duplicateContinuityJustification` already model the target layers as read-only shadows.
- The audit harness already distinguishes promotion candidates from suspicious repairs that must not become planner policy.

The current engine is fighting the target in the handoff projection path. It still creates too much basic shape through downstream shaping:

- support-floor closure
- weekly obligation closure
- set bumping
- cap trim
- program-quality identity changes
- isolation injection
- forbidden cleanup
- distribution guard after repair has already attempted damage

Bluntly: the current direction is right, but the current implementation is still repair-shaped. The live audit says `mostly_repair_shaped`, not "almost planned."

The next implementation artifact should be a compact read-only `TopDownMesocyclePlan` diagnostic that encodes the full 5-week target design before any behavior migration. Do not start by changing Chest, Hamstrings, or repair. The target has to exist as one explicit, replayable planner object first.

Migrate incrementally. Do not rewrite from scratch. The current runtime infrastructure that must be preserved is valuable: receipt-first evidence, accepted seed replay, slot sequencing, lifecycle math, audit modes, and regression coverage. The right path is a hybrid planner replacement: build a new top-down planner slice beside the current projection stack, diff it against current output, then gradually let selection consume one slice at a time.

## 2. Target Engine Spec

| Layer | Purpose | Inputs | Outputs | Hard invariants | Soft preferences | Failure modes | Current approximate owner | Recommended owner |
|---|---|---|---|---|---|---|---|---|
| `MesocycleDemand` | Define the whole block's muscle priorities, target tiers, exposure counts, and specialization status. | User goal, focus, volume target, split, frequency, landmarks, constraints, prior mesocycle evidence. | Canonical per-muscle block demand: min/preferred/max effective sets, exposure count, priority, specialization flags. | Demand exists before slot or exercise choice. Primary/support/secondary meaning is explicit. No forbidden-slot rescue can create demand. | Prefer two exposures for major upper/lower drivers and low-collateral direct work for support muscles. | Demand inferred from repair, collateral mistaken for intent, support muscles missing until late repair. | `getWeeklyVolumeTarget()`, `MUSCLE_TARGET_TIER_BY_MUSCLE`, `planningReality.shadowWeeklyDemand`. | New compact planner seam under `src/lib/api` or `src/lib/engine/planning`, consumed first as read-only. |
| `WeeklyDemandCurve` | Spread demand across Weeks 1-5: entry, accumulation, hard accumulation, peak, deload. | `MesocycleDemand`, block timeline, lifecycle week, RIR/set multipliers. | Per-week per-muscle min/preferred/max effective sets and progression intent. | Week 5 deload is explicit 40-60 percent volume with high RIR. Weeks 1-4 are projected, not copied blindly from Week 1. | Week 1 85-90 percent, Week 2 100 percent, Week 3 105-110 percent, Week 4 110-115 percent. | Week 2-4 unprojected, deload identity/set reduction missing, behavior judged only by Week 1. | `getWeeklyVolumeTarget()`, `buildWeeklyDemandCurve()` diagnostic. | Planner-owned `WeeklyDemandCurve` v2, still cross-checked by lifecycle math. |
| `SlotDemandAllocationByWeek` | Allocate each week's muscle demand into `upper_a`, `lower_a`, `upper_b`, `lower_b`. | Weekly demand, slot sequence, slot authored semantics, fatigue budgets. | Per-week slot-owned muscle obligations and forbidden muscles. | Allocation exists before exercise selection. A slot cannot solve a primary muscle marked forbidden. | Chest in both uppers, quads squat-led in Lower A plus support in Lower B, hamstrings hinge plus curl, calves distributed. | Compatible-slot averaging that ignores class intent, lower-slot Chest repair, upper-slot lower-body collateral. | `buildWeeklyMuscleObligationPlan()`, `buildSlotDemandAllocationByWeek()` diagnostic. | Planner-owned allocation object persisted into accepted plan receipt/seed intent later. |
| `ExerciseClassDistributionBySlot` | Convert slot muscle demand into exercise-class lanes. | Slot allocation, movement lane contracts, inventory class taxonomy, fatigue constraints. | Required/preferred/forbidden class lanes by slot. | Class intent exists before exact exercise selection. Distinct upper Chest exposure is class-level, not exact-exercise-level. | Prefer clean class diversity and minimize redundant pull/hinge/calf variants unless specialized. | Duplicate Incline DB Bench, SLDL duplication, Back Extension closing hamstrings, same-session calf duplicates. | `buildExerciseClassDistributionBySlot()` diagnostic. | Planner-owned class distribution v2. |
| `SetDistributionIntent` | Decide how many sets each lane receives and cap concentration before exercise selection. | Class distribution, weekly demand, slot budgets, concentration policy. | Lane and muscle set budgets, max per exercise, max share, at-limit behavior. | No exercise above 5 sets unless justified. No single exercise should provide more than 50-60 percent of weekly primary stimulus unless intentional. | Anchor plus accessory where appropriate; direct isolation for side delts/calves; two-exercise split for high-priority muscles. | Late set bumping creates concentration, cap trim removes planned identity, repair adds exercise shape. | `setDistributionIntents`, `distributionGuardActions`, program-quality caps. | Planner-owned distribution policy with repair guard as safety net only. |
| `ExerciseSelectionPlan` | Choose exact exercises that satisfy class and set intent. | Class lanes, set distribution, inventory, continuity, user preferences, equipment, fatigue. | Slot exercise identities with planned sets and rationale. | Selection consumes planner intent, not raw repair deficits. Clean alternatives must be visible before allowing duplicates. | Preserve lane identity over exact exercise repetition. Use low-collateral support where available. | Selection blind spot, classification gap, duplicate continuity conflict, role/cap blocked inventory. | `composeIntentSessionFromMappedContext()`, selection-v2, projection candidate selection. | Existing selection-v2 should remain optimizer, but consume planner slices instead of repair targets. |
| `ProgressionPlan` | Define week-to-week set/RIR progression while preserving class identity. | Weekly curve, accepted exercise plan, performance history, block prescription. | Week-specific sets/RIR/load intent by slot/exercise. | Progression must be planned for Weeks 1-4 and deload. Runtime load decisions stay canonical. | Increase volume/intensity gradually; avoid changing exercise identity just to progress. | Week 1 seed repeated without policy, fatigue/concentration escalates silently. | `block-prescription-intent.ts`, `getRirTarget()`, load/progression engine. | Existing periodization/progression seams, plus planner-owned per-week set intent. |
| `DeloadPlan` | Preserve exercise identity while cutting volume and effort for recovery. | Accepted plan, Week 4 peak shape, deload policy, runtime seed. | Week 5 slot plans with reduced sets, high RIR, stable movement skill. | Deload is not normal selection. It preserves accepted identity where possible and excludes progression anchors. | 40-60 percent volume, RIR 4-5 per target design or current canonical deload effort if retained. | Deload unprojected, deload reselection, deload not comparable to accumulation. | `deload-session.ts`, `block-prescription-intent.ts`, `getRirTarget()`. | Existing deload seam, fed by accepted planner intent. |
| `AcceptedPlanReceipt` | Persist the planner intent that made the accepted seed. | Planner objects, selected exercises, set distribution, diagnostics. | Receipt/seed metadata that can explain why a plan exists and replay it. | Receipt-first truth. No parallel top-level mirrors. Accepted seed replay must not reselect. | Store compact intent references, not huge diagnostics. | Runtime cannot distinguish planned shape from repair-shaped output. | `slotPlanSeedJson`, `selectionMetadata.sessionDecisionReceipt`, handoff acceptance. | `slotPlanSeedJson` plus compact accepted planner intent in receipt/seed metadata. |
| `RuntimeExecution` | Execute accepted plan deterministically and log performed truth. | `slotSequenceJson`, `slotPlanSeedJson`, lifecycle state, performed history. | Generated session, receipt, saved workout/logs, explainability, audit replay. | Seeded runtime replays accepted identities and set counts without reselection. | Runtime can adapt loads, not silently redesign the plan. | Legacy reselection, runtime drift, receipt/output mismatch. | `mesocycle-slot-runtime.ts`, `slot-plan-seed.ts`, `template-session.ts`, save route. | Keep current runtime. Do not replace it. |

## 3. Target Slot Contracts

### Upper A

Intent: horizontal push/pull, Chest plus row emphasis, rear delt and triceps support.

Required class lanes:

| Lane | Classes | Sets |
|---|---|---|
| Chest anchor | horizontal press or slight incline press | 3-4 |
| Row anchor | chest-supported row, cable row, or T-bar row | 3-4 |
| Vertical pull support | vertical pull | 2-3 |
| Chest secondary | fly, machine press, or cable press | 2-3 |
| Rear delt | rear-delt isolation | 2-3 |
| Triceps | triceps isolation or low-collateral pressdown class | 2-3 |

Engine contract:

- Chest receives about 5-6 effective sets.
- Lats/upper back receives about 5-7 effective sets.
- Avoid 4 pull-pattern exercises unless back priority is explicit.
- Do not duplicate rear-delt fly variants unless specialization is explicit.
- Distinctness is at lane/class level, not forced exact-exercise novelty.

### Lower A

Intent: squat-dominant, enough hamstring exposure, not a second hinge day.

Required class lanes:

| Lane | Classes | Sets |
|---|---|---|
| Squat anchor | squat pattern | 3-4 |
| Quad isolation | leg extension or similar | 2-3 |
| Hamstring curl | knee-flexion curl | 2-3 |
| Secondary hinge | low-dose hinge | 2 |
| Calves | calf isolation | 3-4 |

Engine contract:

- Quads receive about 5-7 effective sets.
- Hamstrings receive about 3-5 effective sets from curl plus small hinge.
- Avoid SLDL plus multiple curls unless specialization is explicit.
- Watch lower-back exposure.
- Lower A can include hinge support, but hinge must not dominate.

### Upper B

Intent: vertical push/pull, side delt emphasis, second Chest exposure with distinct class.

Required class lanes:

| Lane | Classes | Sets |
|---|---|---|
| Vertical press | vertical press | 2-3 |
| Vertical pull anchor | vertical pull | 3-4 |
| Chest second exposure | distinct class from Upper A | 3-4 |
| Row support | horizontal pull support | 2-3 |
| Side delt isolation | lateral raise or low-collateral side-delt class | 3-4 |
| Biceps | biceps isolation | 2-3 |
| Optional triceps | only if under target | 0-2 |

Engine contract:

- Do not repeat Incline DB Bench by default.
- Preserve Chest lane, not exact exercise.
- Side delts require direct low-collateral work.
- Pulling should not duplicate Upper A unless back priority is explicit.
- OHP collateral does not replace side-delt isolation by itself.

### Lower B

Intent: hinge-dominant, clean hinge plus knee-flexion split, quad support, calves.

Required class lanes:

| Lane | Classes | Sets |
|---|---|---|
| Hinge anchor | hinge compound | 3 |
| Knee-flexion curl | hamstring curl | 2-3 |
| Quad support | squat, leg press, lunge, or quad isolation | 2-3 |
| Calves | calf isolation | 3-4 |
| Optional glute/core | only if recoverable | 0-2 |

Engine contract:

- Hamstrings equal hinge plus curl, not hinge-only.
- Back Extension is not clean hamstring closure.
- Avoid duplicate SLDL from Lower A unless justified.
- Avoid two calf variants in one session unless specialization is explicit.
- Hinge identity must survive, but lower-back and glute collateral are capped.

## 4. Current Engine Compared Against Target

| Target principle | Current evidence | Gap | Current owner | Recommended owner | Priority |
|---|---|---|---|---|---|
| Chest distinct upper exposure | `exerciseClassDistributionBySlot` says upper slots need distinct Chest class intent. Live audit flags duplicate Incline DB Bench with clean alternative visible and Chest under-target risk. | Diagnostic sees the issue, but behavior is blocked because week-by-week projection and deload preservation are missing. | `planningReality`, `selection-alignment.ts`, projection repair/program-quality. | Planner-owned class distribution plus set distribution before selection. | P0 diagnostic artifact, P1 behavior later. |
| Hamstrings hinge plus curl | Diagnostic says Lower B needs hinge anchor plus knee-flexion curl. Live audit says Lower B class is satisfied but clean preselection requires distribution policy first because cap cleanup and dirty candidates remain. | Current repair can still use or duplicate SLDL and classify dirty collateral. | `repair-engine.ts`, `preselectionFeasibility`, `exerciseClassDistributionBySlot`. | Planner-owned Lower B class lanes and set split, with repair only as safety net. | P1 after planner spec. |
| Side delt direct support | Upper B consumed Side Delts preselection demand and target was met in live audit, but Side Delts still show under-target risk across accumulation. | Week 1 support can work, but full block projection is missing. OHP concentration risk remains. | Bounded `SlotPreselectionDemand`, support-floor closure, `weeklyDemandCurve`. | Planner-owned support lane for Upper B, possibly Upper A depending full-block demand. | P1/P2. |
| Calf distributed support | Current diagnostics mention one calf isolation per lower slot and avoid same-session duplicate variants. Live audit flags calf duplicate isolation policy. | Calf distribution is mostly cleanup/duplicate policy, not canonical slot allocation. | support-floor repair, `duplicateContinuityJustification`, program-quality. | Planner-owned lower-slot calf lanes. | P2 cleanup. |
| Duplicate main-lift justification | Live audit: 5 duplicates, 3 unknown/unjustified, 4 with clean alternatives, 1 high risk. Incline DB Bench, Lat Pulldown, SLDL, Back Squat require justification. | Duplicate handling is diagnostic/penalty-driven, not an explicit planner decision before selection. | `evaluateDuplicateExerciseReuse()`, `duplicateContinuityJustification`, program-quality P4. | Planner-owned continuity and duplicate policy per class lane. | P0 diagnostic, P1 behavior guard. |
| Support-floor closure | Live audit: `SUPPORT_FLOOR_CLOSED_LATE` for Biceps, Rear Delts, Triceps. | Support work is still being created late. Basic slot shape should not depend on this. | `applyFinalSupportFloorClosure()`, role budgeting. | Planner support allocation and class lanes. | P0 migration target. |
| Cap trim | Live audit: `FINAL_CAP_TRIM_REQUIRED`, including SLDL and Cable Pullover trims. | Selection/repair overbuilds, then trims. Set distribution should prevent this before selection. | `applyFinalMavTrim()`, `applyFinalSetDistributionCaps()`, program-quality. | Planner-owned set distribution. | P0 diagnostic, P1 distribution plan. |
| Material repair count | Live audit: 20 material, 10 major, 10 likely avoidable. | Current output is repair-shaped. | `planningReality.repairMaterialityAfterShadowAllocation`. | Planner-owned demand/allocation/class/set intent. | P0 blocker. |
| Runtime seed replay | Current docs say `slotPlanSeedJson` is canonical runtime composition for seeded supported intents and runtime uses set-count overrides. | Runtime seed replay is not the problem. The accepted seed may encode repair-shaped output. | `slotPlanSeedJson`, `mesocycle-slot-runtime.ts`, `slot-plan-seed.ts`. | Keep current runtime; feed it better accepted planner output. | Preserve. |

## 5. Acceptance Criteria Mapping

| Acceptance criterion | Current diagnostic source | Current pass/fail status | Missing diagnostic | Future enforcement location |
|---|---|---|---|---|
| Primary muscles above minimum | `projectedDelivery`, `weeklyDemandCurve`, audit summary. | Fails/limited: Chest under-target across accumulation; Week 2-4 projection missing. | Full week-by-week primary target enforcement from planned curve. | `WeeklyDemandCurve` plus planner acceptance gate. |
| No primary muscle solved by forbidden slot | `slotPrescriptionIntents`, `forbiddenCleanupReroute`, forbidden cleanup. | Partially passes as cleanup/diagnostic. It is too late in the pipeline. | Pre-selection forbidden-slot enforcement by planner allocation. | `SlotDemandAllocationByWeek` and class distribution before selection. |
| No exercise above 5 sets unless justified | `exerciseConcentration`, program-quality caps. | Partially passes for hard cap, but concentration remains high. | Justification tied to planner intent, not repair aftermath. | `SetDistributionIntent` and accepted plan receipt. |
| No material repair required to create basic shape | `summary.materialRepairCount`, `repairMaterialityAfterShadowAllocation`. | Fails: 20 material repairs, 10 major. | None. This is already visible. | Accepted-plan gate after planner diff. |
| No duplicate main lift if clean alternative exists | `duplicateContinuityJustification`, duplicate exercise reuse. | Fails/partial: clean alternatives visible for several duplicates. | Planner-level duplicate decision before selection. | `ExerciseClassDistributionBySlot` and `ExerciseSelectionPlan`. |
| No excessive axial-fatigue stacking | `setDistributionIntents`, `exerciseConcentration`, class/fatigue budgets. | Partial/limited: SLDL duplication and lower-back collateral remain visible. | Week-by-week axial budget and cumulative fatigue projection. | `SlotDemandAllocationByWeek`, `SetDistributionIntent`, `ProgressionPlan`. |
| No single exercise provides more than 50-60 percent of primary weekly stimulus unless intentional | `exerciseConcentration`. | Fails/partial: Back Squat, OHP, Incline DB Bench, Barbell Curl concentration flags. | Intentional concentration justification in accepted planner receipt. | `SetDistributionIntent` and accepted plan receipt. |
| Slot demand allocation exists before exercise selection | `slotDemandAllocationByWeek`. | Fails as behavior: exists read-only only. | Behavior-consuming planner allocation object. | New `TopDownMesocyclePlan`; later selection adapter. |
| Exercise class intent exists before exact exercise selection | `exerciseClassDistributionBySlot`. | Fails as behavior: exists read-only only. | Behavior-consuming class distribution slice. | Planner-owned class distribution v2. |
| Runtime seed can replay without reselection | `slotPlanSeedJson`, seed parser/runtime tests, audit `seed`/`reality`. | Pass for accepted seeded supported intents. | Compact planner-intent receipt for why the seed exists. | Keep runtime; extend accepted receipt/seed metadata later. |

## 6. Legacy Policy Assessment

Do not delete these layers until the planner owns their responsibility. Today several are doing real safety work.

| Layer | Assessment | Decision |
|---|---|---|
| support-floor closure | Currently creates basic support shape late. Useful as a guard, wrong as a planner. | Replace with planner ownership, then demote to safety net. |
| weekly obligation closure | Protects primary muscles but is Week 1 and repair-shaped. | Constrain now; replace with planner-owned weekly allocation. |
| program-quality identity changes | Catches bad concentration/duplicates, but can change identity after selection. | Constrain to cleanup; later demote after planner class/set intent owns shape. |
| set bumping | Necessary fallback but creates concentration and cap cleanup. | Demote to safety net after set distribution intent exists. |
| cap trim | Needed to prevent overbuilt output, but it proves distribution happened too late. | Keep as safety net; replace responsibility with set distribution. |
| duplicate penalties | Directionally correct, too soft and late for main-lift policy. | Promote duplicate decisions into planner; keep penalties diagnostic/safety. |
| isolation injection | Sometimes closes support floors, but it can create identity churn. | Replace with planned support lanes; keep rescue-only. |
| forbidden cleanup | Essential guardrail. It should not be where forbidden policy is first enforced. | Keep forever as safety net; planner should prevent most cases. |
| distribution guard | Correct concept, wrong layer when used only after repair tries set bumps. | Promote concept into planner set policy; keep guard for repair. |
| repair materiality diagnostics | High-value architecture signal. | Keep. This is the migration scoreboard. |

## 7. Migration Strategy

### Phase 0: Target Spec And Audit Mapping

Goal: Land this target report and agree that planner-owned behavior precedes repair demotion.

Likely files:

- `docs/10_HYPERTROPHY_MESOCYCLE_ENGINE_TARGET_SPEC.md`
- `docs/09_AUDIT_PLAYBOOK.md` only if operator wording needs update

Verification:

- Read-only review.
- `mesocycle-explain --operator-debug` baseline captured.

Risk:

- Mistaking target spec for current behavior.

Rollback criteria:

- Report contradicts code/audit truth or overstates readiness.

### Phase 1: Read-Only `TopDownMesocyclePlan` Or `ExerciseClassDistributionBySlot` v2

Goal: Add one compact diagnostic object that represents the target top-down plan for all 5 weeks and all 4 slots.

Likely files:

- `src/lib/api/planning-reality/*` or a new adjacent planner diagnostic module
- `src/lib/api/mesocycle-handoff-slot-plan-projection.ts`
- `src/lib/api/planning-reality/types.ts`
- `src/lib/audit/workout-audit/mesocycle-explain.test.ts`
- `src/lib/audit/workout-audit/workout-audit-cli.test.ts`

Verification:

- Focused projection/audit tests.
- Artifact-size check, because current artifact is already approaching the limit.
- Live `mesocycle-explain --operator-debug`.

Risk:

- Diagnostic bloat.
- Adding another shadow that does not become migration-ready.

Rollback criteria:

- Artifact exceeds size budget, diagnostic duplicates existing rows without sharper migration decisions, or standard/debug audit parity drifts.

### Phase 2: Planner-Vs-Current Diff Against First-Principles Target

Goal: Compare target planner lanes/sets against current initial and final projections without changing behavior.

Likely files:

- `src/lib/api/planning-reality/selection-alignment.ts`
- `src/lib/api/planning-reality/repair-materiality.ts`
- audit serializer/CLI summary tests

Verification:

- Diff rows for Chest distinct exposure, Hamstrings hinge plus curl, Side Delts direct work, calves distribution, duplicates, cap trim, material repair.
- Live artifact comparison.

Risk:

- False positives from inventory classification gaps.

Rollback criteria:

- Diff cannot separate selection gap, inventory gap, capacity gap, and repair cleanup.

### Phase 3: Selection Consumes One Class-Distribution Slice

Goal: Run one bounded behavior trial where selection consumes a planner class lane for one slot/muscle, with no seed/runtime schema change.

Likely first slice:

- Chest distinct upper exposure only after Phase 1-2 can answer Weeks 1-4 and deload questions.

Likely files:

- `selection-adapter.ts`
- `selection-v2` objective/scoring inputs
- `mesocycle-handoff-slot-plan-projection.ts`
- focused tests in `mesocycle-handoff-slot-plan-projection.test.ts`

Verification:

- Baseline and post-change `mesocycle-explain --operator-debug`.
- Material/major/suspicious repairs must not worsen.
- Chest improves without Hamstrings, Side Delts, duplicates, or concentration regressions.

Risk:

- Local improvement creates cross-week or deload regression.

Rollback criteria:

- Any increase in material/major/suspicious repairs, concentration, or dirty collateral.

### Phase 4: Accepted Plan Receipt Stores Planner Intent

Goal: Persist compact accepted planner intent alongside `slotPlanSeedJson` so accepted output can explain planned shape versus safety-net repair.

Likely files:

- seed serialization/parser
- handoff acceptance
- receipt/evidence parsing only if stored in receipt metadata
- contract tests

Verification:

- Seed replay unchanged.
- Receipt-first explainability can read planner intent without parallel mirrors.
- `npm run verify:contracts` if schema/contract values change.

Risk:

- Bloated receipt or second source of truth.

Rollback criteria:

- Runtime begins reading diagnostics as policy or receipt duplicates seed truth.

### Phase 5: Repair Paths Demoted To Safety Nets

Goal: Make repair materiality near-zero for basic shape and keep repair for unresolved capacity, inventory, or safety cleanup.

Likely files:

- `repair-engine.ts`
- `program-quality.ts`
- coverage evaluation
- audit diagnostics

Verification:

- Material repair count drops.
- Suspicious repairs drop.
- No forbidden-slot primary closure.
- Seed/runtime replay unchanged.

Risk:

- Removing a guard before planner fully owns it.

Rollback criteria:

- Primary/support coverage regresses, or planner cannot explain unresolved demand.

### Phase 6: Legacy Cleanup

Goal: Remove or simplify obsolete repair scaffolding only after planner-owned behavior is proven.

Likely files:

- repair engine
- program-quality cleanup paths
- obsolete diagnostics
- docs

Verification:

- Full focused generation/audit suite.
- `npm run verify`.
- Live mesocycle audit comparison.

Risk:

- Deleting compatibility needed for legacy mesocycles.

Rollback criteria:

- Legacy seeded/unseeded fallback behavior regresses.

## 8. Rewrite Vs Migration Decision

Would a from-scratch engine be easier to reason about? Yes, conceptually. The target planner is cleaner than the current projection plus repair stack.

Would a from-scratch rewrite be safer? No. It would throw away the parts that are already hard-won and correct:

- receipt-first runtime truth
- `slotSequenceJson` slot identity
- `slotPlanSeedJson` deterministic replay
- lifecycle/block-aware weekly targets and RIRs
- deload routing and progression isolation
- audit harnesses and regression tests
- owner-scoped runtime loading
- historical/legacy fallback boundaries

Which current infrastructure must be retained:

- `resolveOwner()` and API/orchestration boundaries
- lifecycle math/state and block prescription seams
- slot sequence and slot runtime seams
- seed parser/serializer and runtime replay
- receipt-first evidence and explainability
- audit CLI and `planningReality` materiality diagnostics
- selection-v2 as optimizer, provided it consumes planner intent instead of repair signals

Which core should be replaced or migrated:

- Replace repair-shaped handoff projection responsibility with a top-down planner.
- Migrate weekly obligation closure into planner demand/allocation.
- Migrate support-floor closure into planner support lanes.
- Migrate cap/set bump policy into planner set distribution.
- Migrate duplicate penalties into explicit duplicate/continuity planner decisions.
- Keep repair as safety net, not as program designer.

Recommended path: hybrid planner replacement.

Not full rewrite. Not incremental patching of individual Chest/Hamstrings symptoms. Use a strangler-style planner alongside the current projection stack, but the thing being strangled is the repair-shaped planner responsibility, not the runtime infrastructure.

## 9. Recommended Next Implementation Prompt

Use this prompt next:

```txt
Add a compact read-only TopDownMesocyclePlan diagnostic for the 5-week, 4-day upper/lower hypertrophy target design.

Do not change generation, selection, repair, seed serialization, runtime replay, receipts, or accepted mesocycle behavior.

The diagnostic should encode:
- MesocycleDemand
- WeeklyDemandCurve for Weeks 1-5
- SlotDemandAllocationByWeek for Upper A, Lower A, Upper B, Lower B
- ExerciseClassDistributionBySlot for the target class lanes
- SetDistributionIntent with concentration and duplicate limits
- DeloadPlan identity/set-reduction expectations

Compare it read-only against current planningReality:
- weeklyDemandCurve
- slotDemandAllocationByWeek
- exerciseClassDistributionBySlot
- exerciseClassAlignment
- exerciseClassUnresolvedCauses
- duplicateContinuityJustification
- repairMaterialityAfterShadowAllocation
- suspiciousRepairsNotEligibleForPromotion

Output a compact planner-vs-current summary in mesocycle-explain operator debug:
- target satisfied
- target partially satisfied
- target missing
- blocked by inventory/classification/capacity/duplicate policy
- currently created by repair
- suspicious and not eligible for promotion

Guardrails:
- artifact size must not exceed the current audit budget
- standard/debug generation parity must remain unchanged
- all new fields must be readOnly=true and affectsScoringOrGeneration=false
- runtime seed replay must be unchanged
```

## Seam Locator Output

Request surface:

- Docs/spec only. No API route, UI page, generation behavior, selection behavior, repair behavior, seed behavior, or runtime behavior changed.

Canonical owner:

- Current diagnostics owner: `src/lib/api/planning-reality/index.ts` via `buildWeeklyDemandSlotAllocationDiagnostic()`.
- Current handoff projection owner: `src/lib/api/mesocycle-handoff-slot-plan-projection.ts`.
- Current accepted slot semantics owner: `src/lib/api/mesocycle-slot-contract.ts`.
- Current runtime replay owner: `src/lib/api/mesocycle-slot-runtime.ts` plus `src/lib/api/template-session/slot-plan-seed.ts`.

Supporting seams:

- `src/lib/api/mesocycle-handoff-slot-plan-projection.weekly-obligations.ts`
- `src/lib/api/mesocycle-handoff-slot-plan-projection.repair-engine.ts`
- `src/lib/api/mesocycle-handoff-slot-plan-projection.program-quality.ts`
- `src/lib/api/planning-reality/planner-intent.ts`
- `src/lib/api/planning-reality/selection-alignment.ts`
- `src/lib/api/planning-reality/repair-materiality.ts`
- `src/lib/engine/periodization/block-prescription-intent.ts`
- `src/lib/api/mesocycle-lifecycle-math.ts`

Inputs:

- first-principles target design
- accepted upper/lower slot sequence
- lifecycle target/RIR policy
- live `mesocycle-explain` planningReality artifact

Consumers:

- audit operator readout
- future planner diagnostic
- future behavior migration prompts

Tests to update for future implementation:

- `src/lib/api/mesocycle-handoff-slot-plan-projection.test.ts`
- `src/lib/audit/workout-audit/mesocycle-explain.test.ts`
- `src/lib/audit/workout-audit/workout-audit-cli.test.ts`
- `src/lib/audit/workout-audit/planning-reality-invariants.test.ts`

Docs to update later:

- `docs/02_DOMAIN_ENGINE.md` when behavior changes.
- `docs/09_AUDIT_PLAYBOOK.md` when audit artifact interpretation changes.
- `docs/04_API_CONTRACTS.md` only if accepted receipt/seed contract changes.

Do NOT implement in:

- UI pages/components
- route handlers
- save/log flows
- runtime seed replay
- explainability read models
- local repair exceptions

Recommended change shape:

- Add a compact read-only diagnostic first.
- Add a diff second.
- Only then allow one bounded class-distribution selection slice to consume planner intent.
