# Hypertrophy Mesocycle Engine Strategy

Owner: Aaron
Last reviewed: 2026-05-02
Purpose: Define the strategic direction for the V2 hypertrophy planner migration: V2 becomes the future plan author, accepted seed remains minimal executable truth, runtime replay remains stable, and performed reality informs future blocks without silently mutating the current one.

This document is a strategy and migration map, not a claim about current runtime behavior. Current runtime truth remains the code, contract tests, and audit artifacts. The current mapping is grounded in the same live audit evidence previously used for this target doc plus the latest V2 factory-line, materializer, taxonomy, candidate-identity, and lane-selection-intent audit findings:

- `artifacts/audits/2026-04-27T13-46-09-620Z-mesocycle-explain.json`
- Owner: `aaron8819@gmail.com`
- Source mesocycle: `ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4`
- Architecture signal: `mostly_repair_shaped`
- Material repairs: `20`
- Major repairs: `10`
- Likely upstream-avoidable material repairs: `10`
- Suspicious repairs not eligible for promotion: `6`

## 1. Strategic Executive Summary

The Trainer app should generate high-quality hypertrophy mesocycles from explicit training principles, persist the accepted plan as minimal executable seed truth, execute it reliably while allowing session-local flexibility, capture performed reality, and use that reality to improve future mesocycles without silently mutating the current one.

The shorter architecture thesis:

```txt
Planner authors the plan.
Seed stores executable truth.
Runtime executes the plan.
Logs capture performed reality.
Review learns from reality.
Next planner iteration improves.
```

The target is not merely:

```txt
V2 can write seeds.
```

The target is:

```txt
The app creates excellent, explainable, adaptable hypertrophy training blocks,
then executes them reliably without hidden mutation.
```

The migration question has moved. The most useful question is no longer only whether V2 can write accepted seed. The latest factory-line work showed that the accepted-seed replacement path can preserve V2 materialized rows, runtime replay faithfully executes persisted seed, and downstream Program/runtime/persistence suspicion was not the core issue.

The migration is now expanding beyond:

```txt
Can V2 create a high-quality accepted seed?
```

The next strategic layer is:

```txt
Can the app turn that seed into high-quality hypertrophy sessions
through reliable prescriptions, coaching, session-local flexibility,
and accurate performed-reality capture?
```

V2 is the future plan author. Runtime is the plan executor. The materializer is the narrow translator between those layers. That distinction matters because production projection still has legacy repair-shaped behavior, while the latest mismatch evidence points to materialized exercise identity quality and under-specified lane intent rather than failed persistence or runtime replay.

The planner/materializer question still matters:

```txt
Can V2 author elite lane intent and materialize it cleanly
without hidden re-authoring?
```

But once the app has a high-quality seed, runtime must answer the execution question without becoming a second planner.

Success means:

- A supported user can accept a V2-authored mesocycle whose plan quality is strong before repair.
- Planner-owned lane intent is explicit enough that materializer ranking does not infer core training meaning from coarse taxonomy aliases.
- The accepted seed remains minimal and deterministic.
- Runtime replay does not become V2-aware.
- Runtime prescriptions are coherent with performance evidence, lifecycle week, rep target, and effort target.
- Runtime coaching helps the user execute today's planned intent with appropriate load, reps, RIR/RPE, rest, swaps, and adjustments.
- User edits stay session-local unless an explicit reseed or replacement path is chosen.
- Logs capture what actually happened.
- Review turns performed reality into future planning evidence.
- Repair drops from normal plan author to bounded safety net.

## 2. North-Star Operating Model

Target loop:

```txt
Training principles + user context
-> V2 planner authors mesocycle intent
-> materializer translates lane intent into exercises
-> accepted seed stores executable truth
-> runtime executes seed
-> user edits are session-local
-> logs capture performed reality
-> mesocycle review informs future strategy
```

Operating roles:

- Planner = intelligence. It decides the block objective, muscle priorities, movement/class obligations, weekly progression, support floors, continuity stance, lane-selection intent, and set distribution before exact exercise selection.
- Materializer = lane-intent-to-exercise translator. It converts planner lane intent into concrete exercise identities while preserving planner intent, optimizing stimulus-to-fatigue, respecting constraints, honoring stability and fatigue preferences, and staying explainable.
- Seed = contract. It stores the accepted executable plan in the smallest runtime-consumable shape.
- Runtime = execution. Runtime replay remains boring with respect to seed truth, but runtime prescription and coaching can be intelligent with respect to today's execution. It should help the user perform the planned intent with appropriate loads, reps, RIR/RPE, rest, swaps, and bounded adjustments without re-authoring the plan.
- Logs = reality. Logs record performed sets, skipped work, swaps, pain/tolerance, load, reps, RPE/RIR, adherence, and session duration.
- Review = learning. Review summarizes what worked, what failed, and what should influence the next plan.
- Repair = safety net. Repair is safety net, not program author.

The materializer must not become a second planner. Planner owns lane intent. Materializer filters and ranks candidate exercises inside that intent. If a lane needs a true vertical pull, a quad isolation movement, a hamstring-biased hinge, or a low-axial support option, that meaning should be planner-owned and explicit rather than guessed from broad class names after the fact.

The central source-of-truth boundary is unchanged:

```txt
slotPlanSeedJson.slots[].exercises[{ exerciseId, role, setCount }]
```

Planner metadata is explanatory, not executable. `acceptedPlannerIntent`, provenance, diagnostics, materializer blockers, materializer omissions, lane ids, promotion-readiness evidence, audit readouts, and future `laneSelectionIntent` fields may explain why a plan exists. Runtime must not consume them as a second plan.

## 3. Strategic Principles

### Principle 1 - Plan Quality Before Personalization

The first priority is an excellent default V2 mesocycle. Historical personalization matters, but it should not arrive before the base planner can produce a clean, balanced, explainable block from training principles alone.

A personalized bad plan is still a bad plan. Build the default planner until its ordinary output has sane session sizes, balanced coverage, direct support work where required, reasonable fatigue distribution, deload compatibility, and minimal repair dependency.

### Principle 2 - Strategy Before Muscle Targets

Muscle targets are necessary, but they are not the strategy. They should be derived from strategy: phase, goal, recovery context, split/frequency, continuity stance, and eventually performed history.

Static base demand is a useful first slice because it stops demand from being inferred from the skeleton or repair output. It is not the final strategy layer. Full strategy still needs phase intent, objective, recovery bias, specialization or maintenance state, and evidence from prior performed blocks.

### Principle 3 - Planner Intent Before Repair

Repair should not create normal plan shape. It should handle exceptional safety, capacity failure, impossible plans, inventory gaps, legacy fallback, forbidden-slot protection, and final guardrails.

If a good plan always requires support-floor closure, weekly obligation closure, late set bumping, cap trim, duplicate cleanup, or repair-added exercises, the planner has not yet authored the plan.

### Principle 4 - Minimal Executable Seed Truth

`slotPlanSeedJson.slots[].exercises[{ exerciseId, role, setCount }]` remains the runtime-consumed truth.

That shape is enough for deterministic runtime execution. Keep it small. Store explanatory planner/provenance metadata around it only when the metadata is seed-safe and runtime-inert.

### Principle 5 - Runtime Remains Boring

Runtime should replay the accepted seed and log performed reality. Runtime should not become V2-aware.

Swaps, added work, removed work, reduced sets, skipped sessions, partial sessions, load changes, rep changes, and effort changes are session-local deviations unless the user explicitly accepts a reseed or replacement.

### Principle 6 - Elite Runtime Execution Without Seed Mutation

Runtime should be execution-intelligent but seed-inert. It should prescribe load, reps, effort, rest, and coaching cues from evidence; support session-local swaps, additions, skips, and set-level adjustments; and save performed reality accurately. It must not silently mutate the accepted seed or convert runtime edits into a new plan.

This is the key distinction:

```txt
Intelligent execution is allowed.
Hidden plan re-authoring is not.
```

### Principle 7 - Prescriptions Must Be Coherent With Performance Evidence

Target load, target reps, and target RIR/RPE must agree with each other and with recent performance evidence.

If prior exact performance was hard and below the new target reps, the next easier target should not increase load. A prescription like "more weight, more reps, easier effort" is a risk signal unless there is explicit evidence explaining why it is reasonable.

Load targets should be suggestions with source and confidence, not false precision. Estimated or low-confidence prescriptions should be labeled. Progression logic should consider exercise type, equipment increments, dumbbell/per-hand conventions, rep range, target RIR/RPE, lifecycle week, exact-exercise history, substituted-exercise history, and confidence.

### Principle 8 - Swaps Preserve Lane Intent

Runtime swaps should preserve the planned lane/job, not merely the same primary muscle.

Same primary muscle is not enough. Swap suggestions should match movement pattern, role, directness, fatigue/stability profile, loadability/progression characteristics, session context, and relevant collateral effects. Fallback swaps should be labeled as fallbacks, not silently presented as equivalent. Runtime swaps remain session-local unless explicit reseed or replacement occurs.

### Principle 9 - Performed Reality Informs Future Blocks

The learning loop should use what the user actually performed, not old prescribed repair-shaped plans. Performed sets, adherence, fatigue, tolerance, progression, stalls, swaps, pain, and deload execution should become next-block evidence.

That learning should improve the next `MesocycleStrategy`. It should not silently mutate the current accepted seed.

### Principle 10 - Planner-Owned Lane Intent Before Materializer Guesswork

Lane intent must become explicit enough that taxonomy and ranking do not infer core training meaning.

The planner should say whether a lane requires, prefers, allows, or disallows specific movement patterns and exercise classes; how strict substitution should be; how much stability, axial fatigue, directness, collateral, progression/loadability, continuity, duplication, and ranking priority matter; and what failure should look like when no candidate satisfies the lane.

The materializer should consume those semantics. It should not invent them.

### Principle 11 - Policies Should Be Evidence-Aligned, Not Rigid

Planner policy should be grounded in hypertrophy principles and allow justified exceptions. Avoid arbitrary always/never rules.

Examples: no default 5-set stacking is a quality guard, not a universal law. Duplicate exercises can be justified by productive continuity, inventory limits, specialization, or lack of clean alternatives, but the reason must be explicit.

## 4. Current Migration Position

Current runtime seed replay is valuable and should be preserved. Accepted seeded supported mesocycles replay deterministic exercise identities and set counts from `slotPlanSeedJson`; the execution layer is not the problem.

Current infrastructure worth preserving:

- `getWeeklyVolumeTarget()` and block-aware lifecycle math for weekly targets and RIR progression
- `slotSequenceJson` and authored `upper_a`, `lower_a`, `upper_b`, `lower_b` slot identity
- `slotPlanSeedJson` deterministic seeded runtime replay
- `planningReality` read-only diagnostics for demand, slot allocation, class alignment, set distribution, duplicate justification, and repair materiality
- audit harnesses that separate promotion candidates from suspicious repairs that must not become policy
- guarded replacement and comparison paths that can prove V2 materialized seed compatibility without making V2 the live default

The latest factory-line finding resolved the downstream suspicion:

- Program had a masking bug: when a set-aware seed existed but display resolution failed, it could fall through to linked workout or projection rows.
- That has been hardened. Set-aware seeded Program rows should come from `slotPlanSeedJson` plus catalog names only, labeled `exerciseSource: "persisted_slot_plan_seed"`.
- Runtime replay was not the problem. Runtime faithfully replayed the persisted seed.
- The active seed mismatch was not a failed persistence or acceptance bug.
- The V2 replacement path was connected to V2 materialization.
- The persisted seed matched the V2 materialized candidate, accepted-seed preview, final seed-builder input, and runtime replay.

The actual issue was materializer identity selection. V2 materialization selected legacy-looking exercise identities. That means the upstream gap is not primarily "can the seed be stored?" but "does the materializer select the right concrete exercise for the planner's intended lane?"

The latest runtime/session audit adds a second quality signal. Week 1 session 4 correctly derived `lower_b` from the persisted seed and slot sequence, and generated a stable Lower B structure:

- Stiff-Legged Deadlift: 3 sets
- Seated Leg Curl: 3 sets
- Bulgarian Split Squat: 3 sets
- Seated Calf Raise: 3 sets

Runtime replay was correct. The main issue was prescription quality: Stiff-Legged Deadlift generated `140 x 10 @ RPE 6.5` despite prior exact history of `135 x 6 @ RPE 8.5`. That was a load/RIR mismatch: more load, more reps, and easier target effort than the evidence supported.

The narrow root cause was that overshoot progression treated "performed above prescribed targetLoad" as enough to increase load, even though prior reps and effort contradicted the new easier target. The narrow fix now holds the quantized anchor when the current target asks for materially more reps at materially easier effort than prior performance supports. After that fix, the SLDL target became `135 x 10 @ RPE 6.5`. The remaining warning still correctly fires because even holding load can remain ambitious when the target jumps from `135 x 6 @ RPE 8.5` to `135 x 10 @ RPE 6.5`.

The strategic conclusion is not "runtime should re-author the seed"; it is that runtime prescription needs its own quality gate over load, reps, effort, confidence, source, caution warnings, and adjustment range.

The latest tactical materializer and taxonomy fix materially improves the V2 base-plan path:

```txt
Old fresh ranking:
class match -> directness -> continuity -> favorites -> fatigue -> name -> id

New fresh V2 ranking:
class/directness -> explicit identity preservation -> lane intent/stability
-> stimulus-to-fatigue -> fatigue -> favorite -> name -> id
```

Important guardrails from that fix:

- Continuity only affects identity ranking when `identityPreservationMode: "preserve_exact_lane_identity"` is explicitly passed.
- `quad_isolation` is separate from `squat_pattern`.
- Direct `vertical_pull` requires pulldown, pull-up, chin-up, or equivalent vertical-pull identity text.
- Rows and pullovers no longer satisfy direct vertical-pull lanes.
- Goblet Squat no longer satisfies `quad_isolation`.
- Favorites still win only among otherwise equivalent candidates.

Strategically relevant verification passed for this slice: focused materializer, taxonomy, base-plan, and architecture tests; `npx tsc --noEmit`; `npm run verify:contracts`; and `npm run verify`.

The deeper strategic finding remains unresolved:

- The planner does not yet provide a rich enough lane-selection contract.
- The materializer still infers too much from coarse classes and taxonomy aliases.
- Materializer/taxonomy fixes improve the V2 base-plan path, but they do not replace the need for richer planner-owned lane intent.

Read-only diagnostic progress now makes that gap explicit. `V2LaneSelectionIntentAudit` was added with this diagnostic contract:

```txt
source: "v2_lane_selection_intent_audit"
readOnly: true
affectsScoringOrGeneration: false
consumedByDemandOrMaterializer: false
```

Current summary:

- `totalLanes: 23`
- `lanesWithCorrectnessRisk: 5`
- `lanesWithQualityRisk: 10`
- `lanesWithExtensibilityRisk: 19`

Strategic interpretation:

- Current V2 lanes carry useful class, muscle, set-budget, duplicate, and continuity intent.
- High-risk lanes still rely on materializer/taxonomy inference for movement pattern, substitution strictness, directness, fatigue, stability, loadability, collateral policy, and ranking priority.
- Vertical pull lanes have class intent but lack planner-owned movement, directness, and substitution strictness.
- `quad_isolation` is now correctly separate from `squat_pattern`, but still needs explicit movement and substitution policy.
- Hinge anchor exposes managed collateral muscles but lacks consumable collateral caps and axial fatigue preference.
- Chest anchor and second exposure lack explicit stability and press-vs-fly priority.
- Row lanes lack explicit horizontal-pull movement and substitution policy.
- Calves lack cross-lower-slot duplicate and variant policy.
- `upper_a:chest_secondary` exists in the target skeleton but is absent from the final materializer-facing `ExerciseSelectionPlan`; treat it as skeleton-only ghost intent until it is intentionally restored, retired, or mapped into materializer-facing policy.

Current production projection remains legacy/repair-shaped. V2 is not live default. Historical personalization is not implemented as production strategy. Repair has not yet been demoted. The latest work mostly proves that seed transport and runtime replay can be boring when given a seed; it does not prove that V2 has fully authored elite exercise lanes yet.

Provenance also needs cleanup. `slotPlanSeedJson.source = "handoff_slot_plan_projection"` is currently serializer-owned and hard-coded enough that it is not sufficient proof of legacy authorship by itself. Stronger V2 signals include `acceptedPlannerIntent.source = "v2_planner_policy"` and replacement artifacts that report V2 materialized seed provenance. `slotPlanSeedJson.source`, `acceptedPlannerIntent.source`, runtime `compositionSource`, and UI `exerciseSource` can describe different layers and must not be collapsed into one authorship claim.

## 5. The Planner Stack

Target hierarchy:

```txt
User Training Profile
-> Macrocycle / Phase Strategy
-> Mesocycle Strategy
-> Muscle Priority / Volume Model
-> Movement Pattern / Exercise-Class Model
-> Lane Selection Intent
-> Weekly Progression Model
-> Slot Architecture
-> Exercise Selection Strategy
-> Set / Rep / RIR Prescription
-> Accepted Seed
-> Runtime Replay
-> Runtime Prescription Engine
-> Runtime Coaching / Autoregulation
-> Runtime Edit Layer
-> Save / Reconciliation Layer
-> Post-Mesocycle Learning Loop
```

### User Training Profile

Strategic purpose: summarize stable user context that should constrain all planning: goal, training age, frequency, equipment, constraints, preferences, pain history, and adherence tendencies. Good looks like a compact planner input with known evidence and known limitations.

Current status: pieces exist across constraints, setup/handoff drafts, workout context, and review read models. Do not let profile data mutate accepted seeds or runtime replay directly.

### Macrocycle / Phase Strategy

Strategic purpose: decide why this block exists. The first version can be lightweight: balanced hypertrophy, accumulation, specialization, maintenance, recovery-biased, return-to-training, or similar.

Current status: handoff and genesis policy have partial recommendation structure, but V2 does not yet use a full phase strategy as the upstream source of demand. Do not build a rigid annual periodization system before the app has enough performed evidence to justify it.

### Mesocycle Strategy

Strategic purpose: translate phase context into the objective for this block. Good looks like an explicit block objective, recovery bias, specialization or maintenance stance, continuity/variation stance, and risk notes.

Current status: V2 has a read-only strategy diagnostic and recommendation layer, but behavior remains disabled. Do not treat muscle targets as if they somehow become strategy by themselves.

### Muscle Priority / Volume Model

Strategic purpose: derive per-muscle demand from strategy: min/preferred/max effective sets, exposure count, priority tier, direct floors, collateral credit limits, and managed-collateral cautions. Good looks like demand that exists before slot selection, exercise selection, or repair.

Current status: V2 static balanced base demand is a strong first slice. It is not yet adjusted from phase, full user history, or performed-response strategy.

### Movement Pattern / Exercise-Class Model

Strategic purpose: convert stimulus needs into movement and class lanes before exact exercise identity. Good looks like explicit requirements such as hinge plus knee-flexion curl, distinct upper Chest classes, direct side-delt support, direct vertical-pull anchors, quad isolation, calf isolation distribution, and known disallowed substitutes.

Current status: `exerciseClassDistributionBySlot`, `ExerciseSelectionPlan`, materialization taxonomy, and the V2 taxonomy bridge expose much of this shape. The recent split between `quad_isolation` and `squat_pattern`, plus stricter direct `vertical_pull` matching, is the right direction. It is still not enough. Do not let exact exercise selection pretend to solve class strategy by accident.

### Lane Selection Intent

Strategic purpose: make lane semantics explicit enough that the materializer can select exercises without guessing core training meaning from broad classes or names.

Future planner-owned object:

```txt
laneSelectionIntent
```

Likely fields:

- required, preferred, and disallowed movement patterns
- preferred, allowed, and disallowed exercise classes
- substitution strictness
- stability preference
- axial/systemic fatigue preference
- directness requirement
- managed collateral policy
- progression/loadability preference
- continuity/duplicate policy
- ranking priority

High-risk lane families that need this contract first:

- vertical pull anchor/support
- squat anchor, quad isolation, and quad support
- hinge anchor
- chest anchor and chest second exposure
- row anchor/support
- calves

Current status: not implemented as a planner-owned contract. A read-only `V2LaneSelectionIntentAudit` now exposes where current materializer/taxonomy inference is still standing in for explicit planner intent. That diagnostic should guide contract design, but it must not feed materializer ranking until the planner-owned `laneSelectionIntent` contract exists.

### Weekly Progression Model

Strategic purpose: spread the block across entry, accumulation, peak, and deload weeks. Good looks like Weeks 1-4 projected deliberately and Week 5 deload preserving identity while reducing volume and effort.

Current status: weekly targets and RIR progression exist, and V2 has planner-owned accumulation and deload diagnostics. Later weeks remain limited until selection, accepted seed, and runtime replay consume the model safely.

### Slot Architecture

Strategic purpose: allocate weekly demand to `upper_a`, `lower_a`, `upper_b`, and `lower_b` before exercise selection. Good looks like slot-owned obligations and forbidden-slot rules that prevent lower-slot Chest rescue or upper-slot lower-body collateral.

Current status: slot sequencing and authored slot semantics are valuable infrastructure. Do not let compatible-slot averaging or repair closure become the real slot allocation policy.

### Exercise Selection Strategy

Strategic purpose: choose exact exercises that satisfy lane-specific movement/class intent and set budgets while balancing stimulus-to-fatigue, stability, continuity, variation, tolerance, equipment, fatigue, favorites, and inventory. Good looks like productive anchors preserved when explicitly requested, stale/painful/stalled accessories rotated, and duplicate decisions justified.

Current status: selection-v2, materializer dry-run, continuity hints, candidate identity artifacts, and audit diagnostics are useful but not yet authoritative production selection from V2 strategy. The materializer should consume planner-owned `laneSelectionIntent`; it should not invent lane semantics, use favorites as a fresh-base-plan override, or let continuity dominate unless exact identity preservation is explicitly requested.

### Set / Rep / RIR Prescription

Strategic purpose: define set spread, concentration limits, rep/RIR intent, direct support floors, per-exercise caps, and at-limit behavior before selection. Good looks like role-sensitive set distribution, sane session size, no default 5-set stacking, and no single exercise silently owning too much weekly stimulus.

Current status: V2 set-distribution intent has moved the base plan away from flat four-set lanes. Do not let late set bumping or cap trim create ordinary set policy.

### Accepted Seed

Strategic purpose: persist the executable plan plus compact runtime-inert provenance. Good looks like seed truth that runtime can replay without selection or repair.

Current status: accepted seed infrastructure is valuable. Do not bloat executable seed truth with planner diagnostics.

### Runtime Replay

Strategic purpose: execute the accepted plan deterministically and log what happened. Good looks like stable replay from `slotSequenceJson` and `slotPlanSeedJson`, with session-local deviations recorded as performed reality.

Current status: keep current runtime. Do not replace it.

### Runtime Adjustment Rules

Strategic purpose: define what runtime may adapt locally without redesigning the mesocycle. Good looks like practical user flexibility with receipts that explain deviations and read models that distinguish planned truth from performed reality.

Current status: runtime and reseed seams already support the direction. Do not move planner intelligence into runtime.

### Runtime Prescription Engine

Strategic purpose: transform seed exercise rows into session prescriptions: set rows, rep ranges, target reps, target load, target RIR/RPE, confidence, and source/basis.

Good looks like prescription output that respects lifecycle week, exercise class, equipment increments, exact performance history, substitution history, cold-start uncertainty, and the difference between load suggestion and load truth.

Current status: target architecture only. Do not infer from this doc that production prescription logic already passes the quality gate.

### Runtime Coaching / Autoregulation

Strategic purpose: help the user adjust today based on readiness, pain, actual set performance, missed reps, unexpectedly high RPE, soreness/fatigue, and exercise-specific confidence.

Good looks like bounded coaching that explains when to add a set, repeat load, reduce load, lower reps, extend rest, skip a set, swap an exercise, or stop the exercise while preserving the planned session intent.

Current status: target architecture only. Autoregulation must remain session-local unless an explicit reseed/replacement flow is chosen.

### Runtime Edit Layer

Strategic purpose: support swap, add set, skip set, add exercise, remove unlogged added exercise, and other session-local deviations while preserving seed truth.

Good looks like edits that are easy for the user, explicit in provenance, bounded by fatigue/session context, and never silently converted into future plan policy.

Current status: runtime edit seams exist, but this section defines the north-star quality bar rather than claiming complete behavior.

### Save / Reconciliation Layer

Strategic purpose: persist performed reality, runtime edit ops, skipped work, substitutions, additions, and receipts so Program/Home/Analytics can distinguish planned truth from performed reality.

Good looks like save behavior that preserves the original planned seed receipt, records deviations separately, treats skipped sets as valid logs but not performed work, and gives review/analytics enough evidence to learn from reality without mutating the accepted seed.

Current status: target architecture only for the full runtime execution quality bar.

### Post-Mesocycle Learning Loop

Strategic purpose: turn performed reality into next-block strategy evidence. Good looks like review summaries that can recommend volume hold/increase/reduction, specialization, recovery bias, exercise continuity, rotation, or fatigue-management changes.

Current status: `MesocycleReview`, handoff summaries, strategy-input adapters, and audit diagnostics have pieces of the loop. Do not use old repaired prescribed plans as the training signal.

## 6. Static Base Plan Strategy

The highest-ROI path is:

```txt
Make the default V2 mesocycle excellent before historical personalization.
```

Current static base plan chain:

```txt
balanced base demand
-> slot exposure ownership
-> exercise class ownership
-> set distribution ownership
-> lane-intent-aware materialization
-> full V2 base-plan validation
-> candidate identity verification
-> shadow consumption compare
-> only later production consumption
```

Plain-English meaning:

- Balanced base demand defines reasonable default muscle targets before slot and exercise choice.
- Slot exposure ownership decides which slots are responsible for which muscles.
- Exercise class ownership decides which movement classes should deliver the stimulus.
- Set distribution ownership decides how many sets each lane should carry before any late bump or trim.
- Materialization turns planner lane intent into actual exercise identities in dry-run.
- Base-plan validation checks whether the materialized base plan is internally clean.
- Candidate identity verification checks whether selected exercises are actually good representatives of the lanes.
- Shadow consumption compare asks what production projection would do if it consumed the cleaner V2 base shape.
- Production consumption waits until the factory-line audit proves the plan can pass through acceptance without being re-authored or worsened.

Base slot shape to preserve:

- Upper A: horizontal push/pull, Chest plus row emphasis, vertical-pull support, rear-delt support, and triceps support. Chest should have an anchor plus secondary exposure, pulling should not become four redundant pull patterns unless back priority is explicit, and rear-delt variants should not duplicate without a reason.
- Lower A: squat-dominant, quad isolation, knee-flexion hamstring curl, calves, and optional low-dose hinge only when recoverable. Lower A can include hinge support, but hinge should not dominate the day or overload lower-back exposure.
- Upper B: vertical pull, distinct second Chest exposure, row support, direct side-delt isolation, biceps, and optional triceps only when under target. Vertical press is managed collateral in the static base plan, not a required owned lane, and OHP collateral does not replace side-delt isolation by itself.
- Lower B: hinge compound plus knee-flexion curl split, quad support, calves, and optional glute/core only when recoverable. Hamstrings should not be hinge-only, Back Extension is not clean hamstring closure, duplicate SLDL needs justification, and two same-session calf variants should require explicit specialization or inventory rationale.

The current base plan direction should keep these details from the prior target doc:

- Vertical press is managed collateral in the static balanced base plan, not a default materialized lane. Side delts need direct low-collateral work.
- Glutes are managed collateral from squat and hinge patterns; optional direct glute/core work should be explicit and recoverable.
- Standalone one-set hypertrophy exercises are disallowed by default unless a future lane is tagged as activation, technique, or prehab.
- Reusing the same calf exercise across lower days is acceptable for the simple base plan when no clean variant exists; variant diversity is preferred when a clean alternate is visible.
- Side delts, rear delts, biceps, and triceps meet direct floors in the static base; preferred support volume belongs to full-block strategy or specialization.
- Static base set distribution is role-sensitive, not flat. Chest can remain 4+4 to preserve balanced exposure; Upper A row can be 3 when Upper B row and vertical-pull lanes preserve pull balance; Lower B calves can be 3 while Lower A calves stay 4; optional lanes stay 0; managed collateral remains 0 direct sets.

### Materializer Quality

The materializer quality bar is higher than "valid exercise id found." It should choose exercises that make sense for the lane.

Quality expectations:

- Stable hypertrophy anchors should generally beat high-fatigue favorites when lane fit and stimulus-to-fatigue are better.
- Vertical pull lanes require true pulldown, pull-up, chin-up, or equivalent vertical-pull patterns; rows and pullovers are not direct vertical-pull substitutes.
- Quad isolation is not squat-pattern support; Goblet Squat does not satisfy `quad_isolation`.
- Hinge anchor should respect hamstring bias, loadability, stability, and axial/systemic fatigue.
- Calf lanes should prefer direct calf work, with variant diversity when clean variants exist.
- Favorites and continuity are useful signals, but they are not dominant fresh-base-plan policy.
- Continuity should dominate only when the planner or replacement path explicitly requests exact lane identity preservation.

Materializer/taxonomy fixes make this path better. They do not remove the need for planner-owned `laneSelectionIntent`.

## 7. Runtime Session Execution Strategy

Once the accepted seed exists, the runtime layer has two jobs:

- faithfully instantiate the accepted seed
- coach the user through today's session in a way that produces high-quality hypertrophy data

Runtime remains seed-inert. It does not select the mesocycle's exercises, rewrite slot set counts, consume V2 diagnostics as plan policy, or mutate `slotPlanSeedJson` during ordinary logging. But runtime can still be excellent at execution: prescriptions, cues, set-level decisions, swaps, additions, skips, confidence labels, and save reconciliation.

### Prescription Quality

Prescription quality means the app's set rows make sense for hypertrophy training and for the user's evidence.

Target behavior:

- exercise-specific rep ranges instead of one flat default
- compound and isolation movements treated differently
- target effort consistent with lifecycle week, including Week 1 RIR 3-4 and deload reductions in volume, effort, and load where appropriate
- target load exposed as an adjustable suggestion with source/basis, confidence, and, when useful, a recommended adjustment range
- conservative cold starts when exact history is missing
- no unrealistic jumps from prior performance
- estimates labeled as estimates
- low-confidence prescriptions labeled instead of hidden behind precise numbers

The Stiff-Legged Deadlift mismatch is the motivating example. `140 x 10 @ RPE 6.5` after `135 x 6 @ RPE 8.5` should be treated as a prescription-quality warning unless evidence explains the jump. The fixed target of `135 x 10 @ RPE 6.5` is better because it does not increase load, but it should still be "allowed but cautioned" because holding load can remain too aggressive when reps and target effort change substantially.

Strategic interpretation: runtime prescription quality needs more than a single target number. The UI/operator surface should distinguish target load, source/basis, confidence, caution state, and recommended adjustment range. Future behavior may reduce load automatically, but the first strategic requirement is visible mismatch detection and honest confidence labeling.

### Load Progression / Prescription Gate

Acceptance criteria:

- target load does not increase when prior reps were below target and prior RPE was materially harder than the current target
- target load, target reps, and target RIR/RPE agree with one another
- a target can be allowed but cautioned when evidence is plausible but weak
- holding load can still warn when target reps and target RPE change substantially
- estimates are labeled
- low-confidence prescriptions are labeled
- source/basis and confidence are visible beside the target
- recommended adjustment range is visible when the point target is uncertain
- dumbbell/per-hand conventions are clear
- equipment increments are respected
- recent history is used but not overtrusted
- substituted exercise history is used carefully
- exact exercise history wins when appropriate
- load targets remain adjustable suggestions rather than false exact truth

### Runtime Swap Quality

Swap quality means the replacement preserves the lane's training job.

Acceptance criteria:

- lane-preserving swaps are suggested first
- same movement/class is preferred before broad primary-muscle fallback
- movement pattern, role, directness, fatigue/stability profile, loadability/progression, collateral effects, and session context are checked
- already-present exercises are excluded unless explicitly allowed
- logged exercise restrictions are clear
- fallback tier is shown
- swap reason is shown
- fallback swaps are labeled as fallbacks
- runtime swaps stay session-local unless explicit reseed or replacement occurs

### Add Set / Back Off Guidance

Add-set suggestions should be earned by today's evidence.

Suggest adding a set when:

- performance is within target RIR/RPE
- reps remain in range
- technique quality is good
- fatigue budget is available
- the muscle/slot is not near its planned ceiling

Suggest backing off when:

- RPE overshoots target materially
- pain appears
- form breaks down
- load or reps drop sharply
- recovery signals warn against more work
- misses repeat across sets
- recent related sessions show high fatigue

### Add Exercise Guidance

Add exercise should not be random. It should be optional, session-local, and tied to a visible reason: a deficit, pump/accessory need, equipment reality, time availability, or explicit user intent.

The add-exercise layer should be bounded by fatigue and session budget, explain why the exercise is suggested, and clearly exclude the added exercise from canonical seed truth unless the user later accepts an explicit reseed/replacement.

### Save / Receipts / Analytics

Save should preserve the original planned seed receipt and persist deviations as performed-reality metadata.

Target behavior:

- runtime edit operations, swaps, additions, skipped sets, and substitutions are captured as what happened today
- skipped sets are valid logs but not performed work
- Program/Home do not confuse edited runtime structure with canonical seed truth
- Analytics separates planned, skipped, and performed sets
- Review learns from performed reality
- receipts/provenance explain deviations without becoming a second executable plan

## 8. Factory-Line Strategy

The downstream production factory contains valuable infrastructure and old repair-shaped assumptions. The migration should audit responsibility before wiring V2 into production default behavior.

The factory should transport, validate, persist, and explain V2 plans. It should not re-author them.

The latest factory-line audit changed the risk model. The accepted-seed path can preserve V2 materialized rows, Program seed display has been hardened against fallback masking, and runtime replay is vindicated. The remaining risk is less about runtime/persistence corruption and more about whether the materialized candidate identities are good enough to become canonical seed truth.

### Keep As Infrastructure

These layers are useful and should be preserved:

- owner resolution
- lifecycle state
- slot sequencing
- seed serializer/parser
- acceptance transaction
- guarded empty-mesocycle replacement path
- runtime replay
- receipt/provenance infrastructure
- audit harness
- Program/Home read models that display persisted seed truth without re-authoring it

### Constrain / Redesign

These layers may be necessary, but their responsibilities need tightening so they do not overwrite V2:

- handoff preparation
- projection transport/preview
- acceptance gates
- materializer candidate ranking
- metadata/provenance
- debug readouts

The question for each is: does it carry and validate V2 intent, or does it quietly re-author shape?

### Provenance / Source Label Cleanup

Provenance language needs sharper layer boundaries:

- Seed authoring provenance: who authored the plan intent and materialized candidate.
- Seed serialization source: which serializer path wrote `slotPlanSeedJson.source`.
- Runtime composition source: which runtime path generated a session, such as `compositionSource: "persisted_slot_plan_seed"`.
- UI exercise source: which read model source populated display rows, such as `exerciseSource: "persisted_slot_plan_seed"`.

Do not infer authoring truth from `slotPlanSeedJson.source` alone while it remains serializer-owned or hard-coded. A seed can carry `source: "handoff_slot_plan_projection"` and still need stronger adjacent evidence before being classified as legacy-authored or V2-authored. Prefer layered evidence: `acceptedPlannerIntent.source = "v2_planner_policy"`, replacement artifacts that report V2 materialized seed provenance, transaction context, and runtime `compositionSource`.

### Candidate Identity Artifact Visibility

Replacement dry-run artifact visibility is now better. `replaceEmptyMesocycleWithV2.v2Preparation.candidateIdentitySummary` exposes compact selected exercise identities before write:

```txt
{ slotId, laneId, laneRole, seedRole, selectedExercise, setCount }
```

This is read-only artifact/reporting visibility, not behavior. It prevents operators from inferring candidate identity from set totals or provenance alone. Ranking details remain explicitly unavailable until the materializer emits real ranking diagnostics.

### Demote To Safety Net

These should stop creating ordinary plan shape:

- support-floor closure
- weekly obligation closure
- late set bumping
- cap trim as normal shaping
- repair-added exercises
- duplicate cleanup as normal behavior
- dirty collateral cleanup as normal behavior

They may remain as guardrails for impossible, unsafe, unsupported, or legacy cases. They should not be the path that makes a normal mesocycle good.

### Legacy Fallback Only

These should remain available only for unsupported or old paths until V2 is proven:

- old projection path
- legacy repaired seed path
- compatibility flows for old mesocycles

Do not remove safety infrastructure early. First prove that V2 owns the plan, the materializer selects high-quality candidate identities, the factory preserves the seed, runtime replays it, and repair materiality drops.

## 9. Historical Personalization Roadmap Boundary

Historical personalization is important. It should happen after the base V2 planner is excellent.

The personalization loop should use performed reality, not old prescribed repair-shaped plans. A user skipped, swapped, regressed, tolerated, progressed, or overreached in actual logged sessions; that evidence can inform future strategy. The fact that legacy repair prescribed something is not, by itself, a training principle.

Future loop:

```txt
MesocycleReview
-> StrategyEvidence
-> StrategyRecommendation
-> MesocycleStrategy
-> Next accepted seed
```

This should be a learning loop, not a permanent one-time rule. Recommendations need confidence, expiry/review after each block, and non-regression checks before they influence behavior.

Examples of useful future evidence:

- actual performed sets versus target
- skipped sets and partial sessions
- load, reps, RPE/RIR, and progression trends
- fatigue and pain/tolerance signals
- swaps and exercise avoidance
- adherence and session duration
- deload execution quality
- muscles that were under-hit, over-concentrated, or easy to recover from

## 10. Migration Strategy

1. Establish clean V2 static base plan.

   Current status: materially improved in pure dry-run. Static balanced demand, slot ownership, class ownership, role-sensitive set distribution, stricter taxonomy, materializer ranking guardrails, and base-plan validation provide stronger first-slice evidence.

2. Verify materialized candidate identities through dry-run artifacts.

   Current next priority. Inspect `candidateIdentitySummary` before write and confirm selected exercises satisfy the intended lanes. Do not infer identities from set totals, totals by muscle, or provenance labels.

3. Decide whether the current empty mesocycle should be guarded-replaced.

   Replace only if the mesocycle remains empty, the candidate is materially better, gates remain fail-closed, and the seed decision is canonical. This is an explicit guarded replacement decision, not a live-default V2 promotion.

4. Resume backfill only after canonical seed decision.

   Backfill should use the seed decision as settled truth. Do not backfill from an ambiguous candidate, a legacy-looking materializer output, or a provenance-only inference.

5. Use read-only `V2LaneSelectionIntentAudit` to design the contract.

   Current status: added as a diagnostic. It exposes where current lane intent is explicit, where materializer/taxonomy inference is still doing too much, and which high-risk lane families need a richer planner contract. It should remain read-only and not be consumed by demand, materialization, generation, seed serialization, runtime replay, receipts, UI, DB writes, or persistence.

6. Design planner-owned `laneSelectionIntent`.

   Promote only after the read-only audit proves the shape. The contract should be planner-owned and materializer-consumed, with explicit movement/class intent, substitution strictness, stability, fatigue, directness, collateral, loadability, continuity, duplicate, and ranking policy. Start with vertical pull, quad isolation/support, hinge, chest exposures, rows, and calves.

7. Resolve skeleton-only / ghost lane cleanup.

   `upper_a:chest_secondary` exists in the target skeleton but is absent from the final materializer-facing `ExerciseSelectionPlan`. Decide whether it should be restored as a real lane, intentionally retired, or represented through another explicit lane before using it as evidence of materialized V2 intent.

8. Add guarded shadow/disabled consumption path for the richer lane contract.

   No production writes. The path should prove transport, validation, provenance, materializer consumption, and serializer compatibility while reporting exactly where consumption would fail.

9. Add bounded behavior trial.

   Only after gates prove safe. Start with the smallest slice that has clear owner, measurable quality improvement, non-regression checks, and rollback criteria.

10. Promote V2 as default author for supported cases.

   Only after V2-authored output passes plan-quality, materialization-quality, and integration gates. Runtime replay remains unchanged; repair becomes safety net for supported cases.

11. Demote/quarantine obsolete repair-as-planner machinery.

   Do this after V2 ownership is proven. Keep true safety, legacy fallback, impossible-plan handling, and forbidden-slot protection.

12. Add historical personalization / mesocycle-to-mesocycle adaptation.

   Add this after the default V2 planner is strong and the learning loop can consume performed reality without using old repaired prescribed plans as target policy.

## 11. Decision Criteria / Acceptance Criteria

These are strategic decision gates, not claims that current production already passes.

### Plan Quality Gate

- balanced coverage across target muscles
- sane session size
- direct support work where required
- slot-owned primary and support obligations before selection
- class lanes before exact exercise identity
- no unmanaged collateral runaway
- no 5-set default stacking
- no single exercise silently carrying too much weekly stimulus
- no primary muscle solved by forbidden slot
- duplicate main lifts justified when clean alternatives exist
- deload compatibility with identity preservation and volume/effort reduction

### Materialization Quality Gate

- candidate satisfies lane-specific movement/class intent
- no invalid substitutes for direct vertical pull, quad isolation, hinge anchor, calves, or other high-risk lanes
- favorites do not beat materially better lane-fit or stimulus-to-fatigue candidates
- continuity only dominates when explicitly requested through exact lane identity preservation
- stable, loadable hypertrophy anchors beat unstable or high-fatigue candidates when lane fit is better
- blocked lanes fail diagnostically rather than silently filling with bad matches
- dry-run artifact exposes candidate identities before write through `candidateIdentitySummary`
- ranking details are not inferred until materializer emits real ranking diagnostics

### Integration Gate

- V2 can pass through acceptance without being re-authored
- seed serializer remains canonical
- runtime replay unchanged
- `slotPlanSeedJson.slots[].exercises[{ exerciseId, role, setCount }]` remains executable truth
- `acceptedPlannerIntent` and provenance remain explanatory
- V2 blocked opt-in fails closed and is not labeled V2 success
- no production write occurs from diagnostic-only materializer output
- provenance distinguishes seed authoring, seed serialization, transaction persistence, runtime composition, and UI display source

### Runtime Execution Quality Gate

- next-session generation replays persisted seed exactly
- rep ranges match exercise class and hypertrophy goal
- RIR/RPE target matches lifecycle week
- load target is coherent with recent performance
- target source and confidence are visible
- recommended adjustment range is visible when confidence is low or mismatch risk is present
- risky load/RIR mismatch is warned
- allowed-but-cautioned prescriptions are distinguished from clean prescriptions
- estimates and low-confidence targets are labeled
- swaps preserve lane intent
- add-set and add-exercise behavior is bounded and session-local
- save preserves seed and logs reality
- Program/Home/Analytics distinguish planned, skipped, and performed work

### Repair Demotion Gate

- material, major, and suspicious repairs drop materially
- no normal plan shape is authored by repair
- support-floor closure, weekly obligation closure, late set bumping, cap trim, and repair-added exercises are exceptional
- repair still handles safety, capacity, forbidden-slot, impossible-plan, and legacy fallback cases
- repaired projection remains evidence, not target policy

### Learning Loop Gate

- performed history is summarized from logs
- strategy success/failure is evaluated after the block
- recommendations have confidence and known limitations
- recommendations expire or are reviewed after each block
- historical evidence influences next strategy, not current accepted seed mutation
- old repair-shaped prescribed plans are not treated as performed truth

## 12. What Not To Do

- Do not let diagnostics become behavior.
- Do not copy repaired projection as target policy.
- Do not make the materializer a second planner.
- Do not let runtime consume planner metadata.
- Do not let runtime edits mutate canonical seed.
- Do not treat target loads as exact truth when confidence is low.
- Do not increase load into an easier RIR target when prior reps/effort contradict it.
- Do not hide prescription source/confidence from the user/operator.
- Do not suggest swaps that preserve only primary muscle while changing the lane's training effect.
- Do not let added exercises silently become future plan policy.
- Do not let analytics confuse skipped, planned, and performed sets.
- Do not let favorites or continuity override lane intent in fresh base plans.
- Do not infer authoring truth from a single provenance/source field.
- Do not infer candidate identity from set totals.
- Do not keep adding historical adaptation before base planner quality.
- Do not overfit to Aaron's two historical mesocycles.
- Do not make rigid policies without training justification.
- Do not bloat executable seed truth.
- Do not allow old factory logic to re-author a clean V2 plan.
- Do not claim V2 is live default until production actually uses it as the supported default author.
- Do not claim `laneSelectionIntent` is implemented while it remains roadmap or diagnostic work.
- Do not feed `V2LaneSelectionIntentAudit` into materializer ranking before a planner-owned contract exists.
- Do not claim repair has been demoted while production projection still depends on repair for normal shape.
- Do not claim historical personalization is implemented while it remains diagnostic or roadmap work.
- Do not delete safety repair paths before V2 owns the responsibility they currently protect.

## 13. Immediate Next Strategic Step: Candidate Identity Verification + Lane Intent Contract

The next question:

```txt
Are the V2 materialized candidate identities good enough to become canonical seed truth,
and what planner-owned lane intent is missing when they are not?
```

Immediate sequence:

1. Run the read-only replacement/materialization dry-run.
2. Inspect `replaceEmptyMesocycleWithV2.v2Preparation.candidateIdentitySummary`.
3. Verify that each selected identity satisfies the lane's intended movement/class role, directness, stability, fatigue, and stimulus-to-fatigue needs.
4. Decide whether the current empty mesocycle should be guarded-replaced only if it remains empty and the candidate is materially better.
5. Resume backfill only after the canonical seed decision is made.
6. Use read-only `V2LaneSelectionIntentAudit` to design the `laneSelectionIntent` contract.
7. Start the contract with vertical pull, quad isolation/support, hinge, chest exposures, rows, and calves.
8. Resolve `upper_a:chest_secondary` as skeleton-only ghost intent: restore, retire, or explicitly map it before treating it as materializer-facing policy.
9. Keep the diagnostic read-only until the planner-owned contract is implemented.
10. Continue provenance/source cleanup so seed authoring provenance, seed serialization source, runtime composition source, and UI exercise source are not conflated.

### Runtime Execution Audit Track

The immediate runtime question:

```txt
Does the app turn the accepted seed into a safe, evidence-aligned,
hypertrophy-focused training session, and does it save deviations
as reality without mutating the plan?
```

Active audit tracks:

- load/RIR mismatch warning
- lane-preserving swap audit
- runtime edit plus save contract audit
- seed provenance helper
- next-session UI/read-model confirmation if needed

Guardrails for that next slice:

- no generation behavior change from diagnostics
- no repair behavior change from diagnostics
- no seed shape change
- no runtime replay change
- no receipt behavior change
- no claim that runtime execution gates are implemented until code/tests/audits prove them
- no V2 live default claim
- no `laneSelectionIntent` implementation claim until a planner-owned contract exists
- no `V2LaneSelectionIntentAudit` consumption by materializer ranking
- repaired projection used only as evidence
- materializer remains a translator, not a planner
