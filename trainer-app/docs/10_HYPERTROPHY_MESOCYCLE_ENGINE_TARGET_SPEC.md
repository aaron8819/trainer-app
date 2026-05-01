# Hypertrophy Mesocycle Engine Target Spec

Owner: Aaron
Last reviewed: 2026-04-30
Purpose: Define the north-star V2 hypertrophy planner as the future authoritative intelligence layer for an elite, evolving, explainable training app while preserving accepted-seed execution and runtime replay.

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

V2 is not merely a safer seed-writing or materialization migration.

The target is not simply:

```txt
V2 can write seeds.
```

The target is:

```txt
V2 writes intelligent, evolving, explainable training blocks that get better as the user trains.
```

V2 should replace the plan author, not the plan executor. Runtime replay should stay boring:

```txt
Read accepted seed.
Build workout.
Let user train.
Log performed reality.
```

Planner intelligence should move upstream:

- What phase is the user in?
- What is this mesocycle trying to accomplish?
- Which muscles need more, less, or maintenance work?
- Which movement patterns/classes should deliver that stimulus?
- Which exercises should persist, rotate, or be avoided?
- How should the next block evolve based on performed history?

The north-star hierarchy is:

```txt
User Training Profile
-> Macrocycle / Phase Strategy
-> Mesocycle Strategy
-> Muscle Priority / Volume Model
-> Movement Pattern / Exercise-Class Model
-> Weekly Progression Model
-> Slot Architecture
-> Exercise Selection Strategy
-> Set / Rep / RIR Prescription
-> Runtime Adjustment Rules
-> Post-Mesocycle Learning Loop
-> Accepted Seed
-> Runtime Replay
```

The current V2 chain is directionally correct but incomplete unless higher-level strategy and feedback loops sit above `MesocycleDemand`. The existing pure chain can model demand, weekly curve, slot allocation, class lanes, set distribution, capacity, selection policy, materialization, and seed-shaped previews. That is necessary infrastructure. It is not yet the full intelligence layer.

Current migration status is explicit below: the migration has proven important architecture and safety mechanics, but V2 is not live default and does not yet own elite planner intelligence.

The current diagnostics are already pointing toward a top-down flow:

```txt
strategy
-> muscle demand
-> slot allocation
-> exercise class intent
-> set distribution
-> exercise selection
-> accepted seed
-> runtime replay
-> performed-history learning
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

Bluntly: the current direction is right, but the current implementation is still repair-shaped. The live audit says `mostly_repair_shaped`, not "almost planned." The current V2 implementation proves important migration mechanics; it does not prove elite planner intelligence yet.

The next implementation artifact should be a compact read-only `TopDownMesocyclePlan` / `MesocycleStrategy` diagnostic that encodes the full strategy-to-seed target before any behavior migration. Do not start by changing Chest, Hamstrings, or repair. The target has to exist as one explicit, replayable planner object first.

Migrate incrementally. Do not rewrite from scratch. The current runtime infrastructure that must be preserved is valuable: receipt-first evidence, accepted seed replay, slot sequencing, lifecycle math, audit modes, and regression coverage. The right path is a hybrid planner replacement: build a new top-down planner slice beside the current projection stack, diff it against current output, then gradually let selection consume one slice at a time.

## 2. Current Migration Status

Current proven state:

- Pure V2 planner/materializer exists under `src/lib/engine/planning/v2/*`.
- V2 can produce seed-shaped preview from live context through the read-only materialization bridge.
- Promotion-readiness gates exist and default production gates are false.
- A disabled production-side acceptance helper exists and fails closed unless explicitly opted in.
- A read-only acceptance probe exists.
- Accepted-seed provenance exists for legacy projection, disabled V2, blocked V2, and future V2 materialized seed paths.
- Default production behavior remains unchanged.
- V2 is not live default.
- Current seed/runtime replay remains the correct execution layer.

What this proves:

- The migration has a safe route from pure planner policy to seed-shaped preview.
- Production acceptance has explicit fail-closed gates.
- Seed serialization and runtime replay remain the right execution layer.

What this does not prove:

- V2 is not yet the default plan author.
- V2 has not yet learned from performed history as its primary strategy input.
- Current V2 demand has a first static balanced base-policy slice, but it is not yet derived from full phase strategy, user history, or performed-response adjustment.
- Repaired projection is still the production seed author by default.

## 3. Target Engine Spec

| Layer | Purpose | Inputs | Outputs | Hard invariants | Soft preferences | Failure modes | Current approximate owner | Recommended owner |
|---|---|---|---|---|---|---|---|---|
| `UserTrainingProfile` | Summarize stable user context that should constrain all future planning. | Goal, training age, frequency, equipment, constraints, preferences, pain history, adherence history. | Planner-ready user profile with confidence and known limitations. | Profile informs strategy; it does not directly mutate accepted seeds or runtime replay. | Keep the first version practical and evidence-backed. | Generic plans repeat because the planner has no memory of the user. | `Constraints`, setup/handoff drafts, workout context, review read models. | API read-model seam feeding pure planner strategy inputs. |
| `MacrocyclePhaseStrategy` | Decide the broad phase context for the next block. | User profile, prior mesocycle review, training block context, recovery/performance trends. | Phase label and rationale such as balanced hypertrophy, specialization, maintenance, recovery-biased, return-to-training. | Every future mesocycle has a reason. Phase strategy precedes muscle targets. | Lightweight phase sequencing before any rigid macrocycle system. | Same generic block repeats forever, or phase is inferred from repair output. | `TrainingBlock`, `mesocycle-genesis-policy`, handoff summary. | New planner strategy seam above `MesocycleDemand`. |
| `MesocycleStrategy` | Translate phase context into the objective for this block. | Phase strategy, user goal, adherence/recovery, performed history, split/frequency constraints. | Block objective, specialization status, recovery bias, continuity/variation stance, risk notes. | Mesocycle strategy -> muscle priorities, not muscle targets -> somehow strategy. | Be explicit about why volume is increasing, holding, reducing, or specializing. | Muscle targets become the whole strategy. | `nextSeedDraftJson`, `recommendedDesign`, genesis policy. | Pure V2 strategy object, initially read-only. |
| `MesocycleDemand` / `MusclePriorityVolumeModel` | Define the whole block's muscle priorities, target tiers, exposure counts, and specialization/maintenance status. | Mesocycle strategy, user goal, volume target, split, frequency, landmarks, constraints, prior mesocycle evidence. | Canonical per-muscle block demand: min/preferred/max effective sets, exposure count, priority, specialization flags. | Demand exists before slot or exercise choice. Primary/support/secondary meaning is explicit. No forbidden-slot rescue can create demand. | Prefer two exposures for major upper/lower drivers and low-collateral direct work for support muscles. | Demand inferred from repair, collateral mistaken for intent, support muscles missing until late repair. | `getWeeklyVolumeTarget()`, `MUSCLE_TARGET_TIER_BY_MUSCLE`, `planningReality.shadowWeeklyDemand`, current V2 `MesocycleDemand`. | Planner-owned demand derived from strategy on top of the static base policy. |
| `MovementPatternExerciseClassModel` | Convert stimulus needs into movement patterns and exercise-class obligations. | Muscle demand, phase, fatigue budget, prior movement stress, inventory taxonomy. | Required/preferred/forbidden movement patterns and class lanes. | Movement/class intent exists before exact exercise identity. | Preserve useful movement skill while rotating stale exact exercises. | Exact exercise selection pretends to solve class strategy. | `ExerciseClassDistributionBySlot`, selection-v2 class helpers, taxonomy bridge. | Planner-owned class model before materialization. |
| `WeeklyDemandCurve` / `WeeklyProgressionModel` | Spread demand across Weeks 1-5: entry, accumulation, hard accumulation, peak, deload. | `MesocycleDemand`, block timeline, lifecycle week, RIR/set multipliers, recovery bias. | Per-week per-muscle min/preferred/max effective sets and progression intent. | Week 5 deload is explicit 40-60 percent volume with high RIR. Weeks 1-4 are projected, not copied blindly from Week 1. | Week 1 85-90 percent, Week 2 100 percent, Week 3 105-110 percent, Week 4 110-115 percent unless strategy says otherwise. | Week 2-4 unprojected, deload identity/set reduction missing, behavior judged only by Week 1. | `getWeeklyVolumeTarget()`, `buildWeeklyDemandCurve()` diagnostic, V2 weekly progression model. | Planner-owned `WeeklyDemandCurve` v2, still cross-checked by lifecycle math. |
| `SlotArchitecture` / `SlotDemandAllocationByWeek` | Allocate each week's muscle demand into `upper_a`, `lower_a`, `upper_b`, `lower_b`. | Weekly demand, slot sequence, authored slot semantics, fatigue budgets, strategy. | Per-week slot-owned muscle obligations and forbidden muscles. | Allocation exists before exercise selection. A slot cannot solve a primary muscle marked forbidden. | Chest in both uppers, quads squat-led in Lower A plus support in Lower B, hamstrings hinge plus curl, calves distributed unless strategy says otherwise. | Compatible-slot averaging that ignores class intent, lower-slot Chest repair, upper-slot lower-body collateral. | `buildWeeklyMuscleObligationPlan()`, `buildSlotDemandAllocationByWeek()` diagnostic, V2 slot allocation. | Planner-owned allocation object persisted into accepted planner intent later. |
| `SetRepRirPrescription` / `SetDistributionIntent` | Decide sets, set spread, concentration limits, rep/RIR intent, and cap behavior before exact exercise selection. | Class distribution, weekly demand, slot budgets, phase, progression model. | Lane and muscle set budgets, rep/RIR intent, max per exercise, max share, at-limit behavior. | No exercise above 5 sets unless justified. No single exercise should provide more than 50-60 percent of weekly primary stimulus unless intentional. | Anchor plus accessory where appropriate; direct isolation for side delts/calves; two-exercise split for high-priority muscles. | Late set bumping creates concentration, cap trim removes planned identity, repair adds exercise shape. | `setDistributionIntents`, V2 `SetDistributionIntent`, distribution guards, program-quality caps. | Planner-owned distribution/prescription policy with repair guard as safety net only. |
| `ExerciseSelectionStrategy` | Decide what exact exercises should deliver each lane's stimulus. | Class lanes, set distribution, inventory, continuity, user preferences, equipment, fatigue, performance response. | Slot exercise identities with planned sets and rationale. | Selection consumes planner intent, not raw repair deficits. Clean alternatives must be visible before allowing duplicates. | Preserve productive anchors; rotate stale/painful/stalled accessories; preserve class when rotating exact identity. | Selection blind spot, classification gap, duplicate continuity conflict, role/cap blocked inventory. | `composeIntentSessionFromMappedContext()`, selection-v2, V2 materializer, projection candidate selection. | Existing selection-v2/materializer as optimizer, fed by planner strategy rather than repair targets. |
| `RuntimeAdjustmentRules` | Define what runtime may adapt locally without redesigning the block. | Accepted seed, current check-in, session-local edits, pain/readiness, load progression. | Local adjustment boundaries and receipt semantics. | Runtime edits are local unless explicitly reseeded. Runtime does not silently author a new mesocycle. | Allow practical swaps/adds/removes/reductions while preserving explainability. | Runtime edits drift into hidden plan mutation. | Save/log flows, session receipts, seeded runtime, active reseed workflow. | Existing runtime/reseed seams, kept separate from planner authoring. |
| `PostMesocycleLearningLoop` | Learn from performed reality and feed the next strategy. | Actual sets, skipped sets, partial sessions, load/reps/RPE/RIR trends, pain/fatigue notes, swaps, adherence, duration, target achievement. | Next-block recommendations for volume, phase, specialization, continuity, rotation, recovery. | Performed history influences the next block through planner strategy, not repair projection. | Prefer simple rules first; expose confidence. | App repeats generic blocks despite clear user response. | `MesocycleReview`, handoff summary, genesis policy, workout context. | API review/read model feeding V2 strategy inputs. |
| `AcceptedSeed` / `AcceptedPlanProvenance` | Persist the executable seed plus compact planner provenance. | Planner objects, selected exercises, set distribution, production gates. | `slotPlanSeedJson` plus runtime-inert accepted planner intent/provenance. | Executable seed truth remains minimal. Metadata explains why the seed exists but runtime ignores it. | Store compact intent references, not huge diagnostics. | Runtime cannot distinguish planned shape from repair-shaped output, or metadata becomes a second source of truth. | `slotPlanSeedJson`, `acceptedPlannerIntent`, handoff acceptance. | `slotPlanSeedJson` plus compact accepted planner intent/provenance. |
| `RuntimeReplay` | Execute accepted plan deterministically and log performed truth. | `slotSequenceJson`, `slotPlanSeedJson`, lifecycle state, performed history. | Generated session, receipt, saved workout/logs, explainability, audit replay. | Seeded runtime replays accepted identities and set counts without reselection. Runtime does not need lane ids or diagnostics. | Runtime can adapt loads and local edits, not silently redesign the plan. | Legacy reselection, runtime drift, receipt/output mismatch. | `mesocycle-slot-runtime.ts`, `slot-plan-seed.ts`, `template-session.ts`, save route. | Keep current runtime. Do not replace it. |

## 4. Muscle Targets: Necessary But Not Sufficient

Muscle targets are essential for hypertrophy planning. A serious hypertrophy planner needs explicit muscle priorities, target tiers, weekly set ranges, exposure counts, and recovery constraints.

But muscle targets are not the entire strategy. They should be derived from higher-level training strategy rather than treated as the strategy itself.

The planner should understand these questions first:

- What phase is the user in?
- What goal is this block serving?
- What recovery constraints are visible?
- What does prior performed history show?
- Is any muscle specializing, maintaining, resensitizing, or recovering?
- What is this mesocycle trying to accomplish?

Then it should derive muscle priority and volume targets.

The target direction is:

```txt
Mesocycle Strategy -> Muscle Priorities
```

not:

```txt
Muscle Targets -> somehow this becomes strategy
```

The current V2 `MesocycleDemand` object is a valuable pure-policy slice. It now starts from a static balanced upper/lower base policy instead of summing every skeleton lane into muscle demand: target ranges, exposure counts, direct floors, collateral credit limits, and managed-collateral cautions exist before slot allocation. Before V2 becomes authoritative, demand still needs a strategy object that can explain why Chest, Quads, Hamstrings, Side Delts, Calves, or any support muscle should receive more, less, maintenance, or recovery-biased work.

## 5. Macrocycle / Phase Strategy

The target does not require an overbuilt rigid macrocycle system first. A practical first version can be:

```txt
MesocycleReview
-> NextMesocycleRecommendation
-> MesocycleStrategy
```

Each future mesocycle should have a reason, not just repeat the same generic block.

Possible phase labels:

- balanced hypertrophy
- accumulation
- specialization
- maintenance
- resensitization / low-volume phase
- recovery-biased block
- strength-biased hypertrophy
- return-to-training

The phase layer should decide the broad intent before muscle demand is built. Examples:

- If adherence was poor and sessions were long, choose a recovery-biased or lower-complexity block.
- If Chest progressed and fatigue was low but Side Delts under-delivered, keep Chest productive and specialize Side Delts.
- If hinge performance regressed and lower-back fatigue accumulated, reduce high-fatigue hinge exposure and preserve hamstrings through cleaner curls or low-axial options.
- If the user returns after a gap, choose conservative entry volume and simpler continuity.

This layer should start simple, evidence-backed, and explainable. It should not become a speculative rigid annual plan before the app has enough performed history.

## 6. Mesocycle-To-Mesocycle Evolution

V2 should evolve plans across blocks from performed history. The post-mesocycle loop should consume:

- actual performed sets
- skipped sets
- partial sessions
- load progression
- rep progression
- RPE/RIR trends
- fatigue notes
- pain notes
- swaps
- adherence
- session duration
- exercise response
- muscle target achievement

Possible next-block decisions:

- increase volume
- hold volume
- reduce volume
- specialize a muscle
- move a muscle to maintenance
- rotate exercises
- preserve productive anchors
- reduce high-fatigue patterns
- change split/slot emphasis
- recommend deload/recovery

The rule is not "always progress volume." The rule is "respond to evidence." A high-quality hypertrophy app should be able to say:

- "This block worked; repeat the productive anchors and only rotate stale accessories."
- "This block under-delivered because adherence was low; reduce session density before adding volume."
- "This muscle hit targets with low fatigue; keep it at maintenance while specializing another muscle."
- "This pattern created too much fatigue; preserve the stimulus through a lower-fatigue class."

Performed reality should feed the next `MesocycleStrategy`, not downstream repair.

## 7. Continuity Vs Variation Policy

Mesocycles should neither be identical forever nor randomly different.

Exercise continuity classifications:

- `keep`: preserve the exact exercise because it is productive, pain-free, and strategically useful.
- `rotate_optional`: rotation is allowed but not required.
- `rotate_recommended`: rotation is preferred because staleness, redundancy, or response suggests a better option.
- `rotate_required`: rotation is required because of pain, poor tolerance, repeated stall, forbidden context, or incompatible next-block strategy.

Suggested rules:

- Keep productive anchors that are progressing and pain-free.
- Keep exercises that the user performs consistently and responds to well.
- Rotate stale accessories.
- Rotate painful or poorly tolerated movements.
- Rotate exercises that repeatedly stall.
- Rotate if the same movement stress has accumulated across multiple blocks.
- Preserve movement class when rotating exact exercise identity.
- Do not rotate everything at once unless the block objective requires it.

The planner should preserve continuity at the right level: sometimes exact exercise identity, sometimes lane identity, sometimes movement class, and sometimes only the muscle/stimulus objective.

## 8. Materializer North Star

Plain-English role:

```txt
Planner decides what stimulus is needed.
Materializer chooses the exact exercise that best delivers it.
```

The materializer should rank candidates by:

- required class/lane fit
- directness of target stimulus
- stimulus-to-fatigue ratio
- equipment availability
- user preference
- prior successful performance
- pain/joint tolerance
- continuity value
- recent exposure/staleness
- novelty need
- redundancy avoidance
- deterministic tie-breaker

The materializer should not define training strategy. It should not always pick the same exercise blindly. It should preserve productive continuity but allow controlled rotation. It should not make repaired projection behavior the target.

Current V2 materialization is a useful dry-run bridge because it can turn planner lanes into seed-shaped slots. The north-star materializer needs richer ranking inputs before it becomes authoritative: performed response, staleness, tolerance, explicit continuity classification, and strategy-derived novelty pressure.

## 9. Seed Shape Assessment

The current executable seed truth is good because it is minimal:

```txt
{ exerciseId, role, setCount }
```

This is sufficient for runtime execution. It should remain boring.

Runtime should not need:

- lane IDs
- blockers
- omissions
- inventory evidence
- dry-run reports
- planner diagnostics
- repair materiality rows
- class-match debug payloads

Intelligence/provenance should live around the seed, not inside executable truth. `acceptedPlannerIntent` or similar metadata is explanatory only and must stay runtime-inert. It can explain the plan, audit the plan, and support future learning, but runtime replay must keep consuming the minimal seed fields.

## 10. Runtime Flexibility

Accepted seed is foundation, not prison.

The user can:

- swap exercises
- add exercises
- remove exercises
- reduce sets
- skip sessions
- complete partial sessions
- adjust load
- adjust reps
- log RPE/RIR

Runtime edits are session-local deviations unless the user explicitly reseeds or accepts a replacement. Performed reality should feed the post-mesocycle learning loop.

## 11. Target Slot Contracts

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
| Optional secondary hinge | low-dose hinge only if recoverable | 0-2 |
| Calves | calf isolation | 3-4 |

Engine contract:

- Quads receive about 5-7 effective sets.
- Hamstrings receive about 3-5 effective sets from curl plus the hinge-dominant lower slot; Lower A hinge support is optional, not a default one-set standalone exercise.
- Avoid SLDL plus multiple curls unless specialization is explicit.
- Watch lower-back exposure.
- Lower A can include hinge support, but hinge must not dominate.

### Upper B

Intent: vertical push/pull, side delt emphasis, second Chest exposure with distinct class.

Required class lanes:

| Lane | Classes | Sets |
|---|---|---|
| Vertical press marker | vertical press collateral only | 0 |
| Vertical pull anchor | vertical pull | 3-4 |
| Chest second exposure | distinct class from Upper A | 3-4 |
| Row support | horizontal pull support | 2-3 |
| Side delt isolation | lateral raise or low-collateral side-delt class | 3-4 |
| Biceps | biceps isolation | 2-3 |
| Optional triceps | only if under target | 0-2 |

Engine contract:

- Do not repeat Incline DB Bench by default.
- Preserve Chest lane, not exact exercise.
- Side delts require direct low-collateral work; vertical press is managed collateral in the static balanced base plan, not a required owned lane.
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

### Static Base-Policy Alignment

- Vertical press is a managed-collateral marker in the static balanced base plan. It is not materialized by default; side delts are served by direct low-collateral isolation.
- Glutes are managed collateral from squat and hinge patterns, with optional direct glute/core work only when recoverable. The base plan should not materialize standalone one-set hip-extension/glute work.
- Standalone one-set hypertrophy exercises are disallowed by default unless a future lane is explicitly tagged as activation, technique, or prehab.
- Reusing the same calf exercise across both lower days is acceptable for the simple base plan when no clean variant exists; variant diversity is preferred when a clean alternate is visible.
- Side delts, rear delts, biceps, and triceps meet direct floors in the static base; preferred support volume is reserved for full-block strategy or specialization.
- Flat four-set allocation is a warning-only base-plan quality smell until set-distribution rules become more nuanced.

## 12. Current Engine Compared Against Target

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

## 13. North-Star Acceptance Criteria

These are ultimate planner criteria, not claims about current implementation.

| Acceptance criterion | Current diagnostic/source | Current state | Future enforcement location |
|---|---|---|---|
| Each mesocycle has an explicit strategy. | `recommendedDesign`, handoff summary, future V2 strategy. | Partial: handoff has recommendation structure, but V2 strategy is not yet authoritative. | `MesocycleStrategy` above demand. |
| Muscle targets derive from strategy and user history. | `MesocycleDemand`, `weeklyDemandCurve`, mesocycle review. | Partial: current V2 demand has a static balanced base policy, but not phase/user-history strategy adjustment. | `MesocycleStrategy -> MesocycleDemand`. |
| Movement classes satisfy stimulus needs before exact exercises are chosen. | `exerciseClassDistributionBySlot`, V2 `ExerciseSelectionPlan`. | Read-only / dry-run only. | Planner class model consumed by selection/materializer. |
| Exercise selection balances continuity and variation. | `duplicateContinuityJustification`, genesis carry-forward, materializer continuity hints. | Partial: continuity exists, but no full keep/rotate policy tied to strategy. | `ExerciseSelectionStrategy` plus continuity classification. |
| Productive exercises can persist across blocks. | Carry-forward recommendations, prior slot evidence. | Partial. | Post-mesocycle learning loop and materializer continuity scoring. |
| Stale, painful, stalled, or poorly tolerated exercises can rotate. | Pain conflicts, anomaly flags, swaps, history, selection-v2 constraints. | Partial; not yet a V2 block-level rotation policy. | Strategy/materializer ranking inputs. |
| Performed history influences the next block. | `MesocycleReview`, workout context history, handoff genesis policy. | Partial; not yet the primary V2 strategy input. | `PostMesocycleLearningLoop -> MesocycleStrategy`. |
| V2-authored seed remains minimal and runtime replayable. | `slotPlanSeedJson`, seed parser/runtime tests, audit `seed`/`reality`. | Pass for current seeded runtime; V2 live writes disabled. | `AcceptedSeed` contract and runtime replay. |
| Runtime edits remain local unless explicitly reseeded. | Save/log flows, active reseed workflow, receipt semantics. | Current runtime architecture supports this direction. | Runtime adjustment rules and reseed workflow. |
| Planner decisions are explainable. | `acceptedPlannerIntent`, V2 provenance, audit diagnostics. | Partial/future; metadata exists but live V2 plan authoring is disabled. | Accepted planner intent/provenance, audit readouts. |
| Repair is safety net, not program author. | `repairMaterialityAfterShadowAllocation`, no-repair comparison, repair scoreboard. | Fails today: live artifact is `mostly_repair_shaped`. | V2 planner acceptance gate and repair demotion. |
| Legacy repair-shaped planning is eventually deprecated. | Legacy projection and repair diagnostics. | Future cleanup only. | Migration phases after V2-authored plans prove stable. |

Existing target-quality criteria still apply:

- Primary muscles above minimum.
- No primary muscle solved by forbidden slot.
- No exercise above 5 sets unless justified.
- No material repair required to create basic shape.
- No duplicate main lift when a clean alternative exists unless explicitly justified.
- No excessive axial-fatigue stacking.
- No single exercise provides more than 50-60 percent of primary weekly stimulus unless intentional.
- Slot demand allocation exists before exercise selection.
- Exercise class intent exists before exact exercise selection.
- Runtime seed can replay without reselection.

## 14. Cleanup / Deprecation Plan

Do not delete these layers until the planner owns their responsibility. Today several are doing real safety work.

Eventually demote/remove old repair-shaped responsibilities as normal plan authors:

- support-floor closure as program author
- weekly obligation closure as program author
- late set bumping as normal shaping
- cap trim as normal shaping
- program-quality identity changes as normal shaping
- isolation injection as normal shaping
- legacy projection as default seed author
- repair promotion diagnostics as migration machinery

Preserve repair as a safety net for:

- capacity failure
- inventory gaps
- forbidden-slot protection
- legacy compatibility
- impossible plans
- explicit fallback

Cleanup sequence:

1. V2 writes seed behind explicit gate.
2. Runtime replay proves stable.
3. V2-authored plans compare favorably.
4. Repair materiality drops.
5. Legacy projection becomes fallback only.
6. Repair paths become safety nets.
7. Obsolete repair-as-planner code is removed or quarantined.

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
| repair materiality diagnostics | High-value architecture signal during migration. | Keep until V2 is authoritative; then quarantine/remove migration-only readouts that no longer answer an active question. |

## 15. Migration Strategy

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

### Phase 1: Read-Only `MesocycleStrategy` / `TopDownMesocyclePlan`

Goal: Add one compact diagnostic object that represents the target strategy-to-seed plan for all 5 weeks and all 4 slots.

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
- Treating the current static balanced V2 base policy as elite strategy before user profile, phase, performed-history, and continuity inputs exist.

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

### Phase 4: Accepted Plan Provenance Stores Planner Intent

Goal: Persist compact accepted planner intent/provenance alongside `slotPlanSeedJson` so accepted output can explain strategy, planned shape, and any safety-net repair without changing executable seed truth.

Likely files:

- seed serialization/parser
- handoff acceptance
- receipt/evidence parsing only if stored in receipt metadata
- contract tests

Verification:

- Seed replay unchanged.
- Receipt-first explainability can read planner intent without parallel mirrors.
- `acceptedPlannerIntent` remains explanatory and runtime-inert.
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

## 16. Rewrite Vs Migration Decision

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

## 17. Recommended Next Implementation Prompt

Use this prompt next:

```txt
Add a compact read-only MesocycleStrategy / TopDownMesocyclePlan diagnostic for the V2 hypertrophy planner north star.

Do not change generation, selection, repair, seed serialization, runtime replay, receipts, or accepted mesocycle behavior.
Do not enable V2 live writes.
Do not make repaired projection the target.
Do not bloat executable seed truth.

The diagnostic should encode:
- UserTrainingProfile inputs that are available today, with explicit missing-input limitations
- Macrocycle / Phase Strategy
- MesocycleStrategy
- MesocycleDemand derived from strategy on top of the static balanced base policy
- WeeklyDemandCurve for Weeks 1-5
- SlotDemandAllocationByWeek for Upper A, Lower A, Upper B, Lower B
- ExerciseClassDistributionBySlot for the target class lanes
- Set / Rep / RIR Prescription with concentration and duplicate limits
- ExerciseSelectionStrategy, including continuity vs variation policy
- Materializer intent/ranking requirements without selecting production exercises
- RuntimeAdjustmentRules boundaries
- PostMesocycleLearningLoop signals and next-block decision hooks
- DeloadPlan identity/set-reduction expectations
- AcceptedSeed contract summary showing executable truth remains { exerciseId, role, setCount }
- RuntimeReplay contract summary showing runtime ignores planner metadata

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
- current-state vs north-star gap
- next required upstream owner

Guardrails:
- artifact size must not exceed the current audit budget
- standard/debug generation parity must remain unchanged
- all new fields must be readOnly=true and affectsScoringOrGeneration=false
- runtime seed replay must be unchanged
- acceptedPlannerIntent or similar metadata must be explanatory only and runtime-inert
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
