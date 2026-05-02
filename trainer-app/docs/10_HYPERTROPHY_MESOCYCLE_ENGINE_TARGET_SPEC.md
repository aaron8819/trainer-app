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

Same primary muscle is not enough. Swap suggestions should match movement pattern, role, directness, fatigue/stability profile, loadability/progression characteristics, session context, duplicate/collision context, and relevant collateral effects. Fallback swaps should be labeled as fallbacks, not silently presented as equivalent. Runtime swaps remain session-local and seed-inert unless explicit reseed or replacement occurs, but the coaching quality bar is higher: the user should be offered alternatives with similar training effect.

### Principle 9 - Performed Reality Informs Future Blocks

The learning loop should use what the user actually performed, not old prescribed repair-shaped plans. Performed sets, adherence, fatigue, tolerance, progression, stalls, swaps, pain, and deload execution should become next-block evidence.

That learning should improve the next `MesocycleStrategy`. It should not silently mutate the current accepted seed.

Do not turn one bad day, one skipped set, or one swap into durable future plan policy without confidence, recurrence, or user reason. Single-session evidence can be a caution flag; durable strategy needs a stronger signal.

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

### Current Live Checkpoint

The latest live checkpoint is:

- a persisted 58-set V2 seed exists for the active mesocycle
- Week 1 Upper A, Lower A, and Upper B have been backfilled as performed reality
- Lower B is the next seeded session
- `slotPlanSeedJson` and `slotSequenceJson` were unchanged by backfill
- current remaining runtime concerns are SLDL prescription caution, swap quality, and a Next Workout exercise-order mismatch relative to persisted seed/Program order

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

Runtime replay was correct, and the next-session path pointed to Lower B from persisted seed truth. The current read-model/UI concern is order fidelity: Next Workout preview reordered Seated Leg Curl and Bulgarian Split Squat relative to persisted seed/Program order. That is not a seed mutation, but it is a runtime execution quality issue because seeded sessions should have one visible planned order unless an explicit, labeled runtime ordering policy exists.

The main prescription issue was Stiff-Legged Deadlift generating `140 x 10 @ RPE 6.5` despite prior exact history of `135 x 6 @ RPE 8.5`. That was a load/RIR mismatch: more load, more reps, and easier target effort than the evidence supported.

The narrow root cause was that overshoot progression treated "performed above prescribed targetLoad" as enough to increase load, even though prior reps and effort contradicted the new easier target. The narrow fix now holds the quantized anchor when the current target asks for materially more reps at materially easier effort than prior performance supports. After that fix, the SLDL target became `135 x 10 @ RPE 6.5`. The remaining warning still correctly fires because even holding load can remain ambitious when the target jumps from `135 x 6 @ RPE 8.5` to `135 x 10 @ RPE 6.5`.

The strategic conclusion is not "runtime should re-author the seed"; it is that runtime prescription needs its own quality gate over load, reps, effort, confidence, source, caution warnings, and adjustment range.

A read-only runtime edit/save contract audit adds a third quality signal: normal UI runtime edits are seed-safe. Add set, skip set, add exercise, remove unlogged runtime-added exercise, and save reconciliation mutate the current `Workout`/log structure only, append runtime edit/reconciliation metadata, and do not mutate `slotPlanSeedJson` or `slotSequenceJson`.

The important model:

- `selectionMetadata.sessionDecisionReceipt` remains original session-decision truth.
- `selectionMetadata.workoutStructureState` reflects current workout structure.
- `selectionMetadata.runtimeEditReconciliation.ops[]` records session-local mutations.

Strategic interpretation: runtime can support flexible training without mutating the plan. The runtime/save layer should be judged by whether it preserves seed truth, records reality accurately, and keeps Program/Home/Analytics clear about planned versus performed.

The runtime swap audit adds a fourth quality signal: current swap behavior is seed-safe but not yet lane-preserving enough for elite hypertrophy training. It preserves primary muscle and broad movement family, and it applies hard fatigue/stress ceilings. It does not yet use V2 lane intent, materializer taxonomy, anchor-quality checks, slot role, directness, loadability/stability tiers, or weekly/session collision rules.

Observed examples:

- Stiff-Legged Deadlift correctly returned Romanian Deadlift.
- Seated Leg Curl also allowed Back Extension / Reverse Hyperextension, which are wrong-lane replacements for a knee-flexion curl.
- Bulgarian Split Squat ranked Goblet Squat above more loadable quad-support options like Belt Squat, Leg Press, and Hack Squat.
- Seated Calf Raise returned no swaps because equivalent calf raises were blocked by a small fatigue delta.

Strategic interpretation: runtime swaps are allowed to be session-local and seed-inert, but their coaching value depends on preserving the lane/job. Same primary muscle and broad family compatibility are necessary but not sufficient.

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

Provenance also needs careful layer boundaries. `slotPlanSeedJson.source` is explanatory seed provenance, not executable truth. It can now distinguish legacy projection-authored seeds from guarded V2 materialized-seed writes, but it still must not be collapsed with planner metadata, transaction evidence, runtime composition, or UI read-model source. `slotPlanSeedJson.source`, `acceptedPlannerIntent.source`, runtime `compositionSource`, and UI `exerciseSource` can describe different layers and must not be collapsed into one authorship claim.

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

Future prescription/coaching should also use exercise-specific coaching profiles. High-skill axial compounds, stable machine compounds, unilateral compounds, isolations, lengthened-biased isolations, and calf/forearm/high-rep-tolerant isolations should not share one generic progression model. The profile should influence rep range, load confidence, progression aggressiveness, caution labels, and add/back-off guidance.

Current status: target architecture only. Do not infer from this doc that production prescription logic already passes the quality gate.

### Runtime Coaching / Autoregulation

Strategic purpose: help the user adjust today based on readiness, pain, actual set performance, missed reps, unexpectedly high RPE, soreness/fatigue, and exercise-specific confidence.

Good looks like bounded coaching that explains when to add a set, repeat load, reduce load, lower reps, extend rest, skip a set, swap an exercise, or stop the exercise while preserving the planned session intent.

Current status: target architecture only. Autoregulation must remain session-local unless an explicit reseed/replacement flow is chosen.

### Runtime Edit Layer

Strategic purpose: support swap, add set, skip set, add exercise, remove unlogged added exercise, and other session-local deviations while preserving seed truth.

Good looks like edits that are easy for the user, explicit in provenance, bounded by fatigue/session context, and never silently converted into future plan policy.

Runtime edit principles:

- add set should clone the target prescription, not actual logged performance
- skipped sets are valid logs but not performed work
- added exercises should be session-local, conservative, removable until logged, and excluded from canonical seed
- save should preserve planned truth while recording performed reality

Current status: runtime edit seams exist and the read-only audit found normal UI runtime edits are seed-safe, but this section still defines the broader north-star quality bar rather than claiming every hardening item is complete.

### Save / Reconciliation Layer

Strategic purpose: persist performed reality, runtime edit ops, skipped work, substitutions, additions, and receipts so Program/Home/Analytics can distinguish planned truth from performed reality.

Good looks like save behavior that preserves the original planned seed receipt, records deviations separately, treats skipped sets as valid logs but not performed work, and gives review/analytics enough evidence to learn from reality without mutating the accepted seed.

Current status: normal UI runtime edit/save reconciliation is seed-safe in the read-only audit: Program should keep canonical seed structure, workout detail/log views should show current workout reality, and analytics/weekly volume should count performed non-skipped logs. The full runtime execution quality bar remains target architecture.

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
- Upper B: vertical pull, distinct second Chest exposure, row support, direct side-delt isolation, biceps, and optional triceps only when under target. Vertical press began as managed collateral in the simple static base plan; expert-review direction now supports minimal recoverable vertical-press or high-incline exposure when it improves pattern completeness without crowding direct side-delt work.
- Lower B: hinge compound plus knee-flexion curl split, quad support, calves, and optional glute/core only when recoverable. Hamstrings should not be hinge-only, Back Extension is not clean hamstring closure, duplicate SLDL needs justification, and two same-session calf variants should require explicit specialization or inventory rationale.

The current base plan direction should keep these details from the prior target doc:

- Vertical press began as managed collateral in the simple static balanced base plan. The refined direction allows minimal recoverable vertical-press or high-incline exposure when it improves shoulder/upper-pressing pattern completeness, but it must not replace direct low-collateral side-delt work or crowd the session.
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

### Coach The User, Not Just The Workout

Elite runtime coaching should help the user choose the next best action, not merely display the planned workout. The app should help the user decide whether to stay the course, repeat load, increase load, reduce load, extend rest, add a set, skip a set, swap an exercise, or stop an exercise.

That coaching remains session-local and seed-inert. It can shape today's execution and the saved performed-reality record, but it must not silently re-author the accepted mesocycle.

### Coaching UX Contract

The workout UI should give simple, actionable guidance without turning the workout screen into an audit report. For each seeded row, the user should see the target reps, target load, target RIR/RPE, and the most important confidence or caution label.

Target behavior:

- concise workout rows show what to do now: load, reps, effort, and the next adjustment
- confidence labels distinguish exact history, substitute history, estimate, and low-confidence sources
- caution labels explain mismatch risks, pain/form concerns, stale history, or weak evidence in plain language
- adjustment ranges give practical options such as repeat load, reduce 5-10%, aim for the lower rep bound, or extend rest
- swap guidance shows equivalence tiers: lane-equivalent, close fallback, broad same-muscle fallback, or not recommended
- session-local labels identify added work, skipped work, swaps, substitutions, and user-driven deviations
- the main workout UI stays concise while operator, audit, and debug surfaces carry detailed evidence and provenance

Good coaching should make the next action obvious. It should not require the user to read internal policy, but it should be honest when the app is estimating or asking for caution.

Every significant warning should have two surfaces:

- user-facing concise action guidance
- operator/audit-facing evidence, source, trace, confidence, and reason codes

The user should see the actionable choice. Operators and audit surfaces should preserve the evidence trail.

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

### Data Quality Is Part Of Coaching

Prescription quality depends on evidence quality. Runtime should not hide weak evidence behind precise-looking targets.

Data-quality labels should distinguish:

- exact exercise history
- substitute or related-exercise history
- estimated targets with no strong history
- missing RPE/RIR
- skipped, partial, or stale history
- low-confidence load source
- recent pain, form, fatigue, or adherence issues

When evidence is weak, targets should become conservative, visibly low-confidence, or accompanied by an adjustment range. A low-confidence target can still be useful if the user knows how to adjust it.

Future performed-reality signals should include:

- pain or discomfort
- form breakdown
- pump and target-muscle feel
- soreness or fatigue
- equipment availability
- time pressure
- reason for swap, skip, addition, stopped exercise, or major load reduction

These signals should inform coaching and future planning evidence. They should not silently mutate the current accepted seed.

### Exercise-Specific Coaching Profiles

Future runtime prescription and coaching should distinguish exercise profiles instead of applying one generic hypertrophy rule to every movement.

Profiles:

- high-skill axial compounds
- stable machine compounds
- unilateral compounds
- isolations
- lengthened-biased isolations
- calf, forearm, and other high-rep-tolerant isolations

Profile should influence:

- rep range
- load confidence
- progression aggressiveness
- caution labels
- add-set guidance
- back-off, rest, skip, or stop guidance

Examples: high-skill axial compounds should usually progress more cautiously and warn sooner on form, pain, or RPE mismatch. Stable machine compounds may tolerate more confident load progression when history is clean. Unilateral compounds need side-to-side and balance/tolerance awareness. Lengthened-biased isolations may deserve more caution around soreness, pain, and aggressive load jumps. Calf/forearm/high-rep-tolerant isolations can often use wider rep targets and different add/back-off heuristics than heavy hinges or squats.

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
- V2 lane intent, materializer taxonomy, anchor quality, source slot role, and weekly/session collision context are used when available
- already-present exercises are excluded unless explicitly allowed
- logged exercise restrictions are clear
- fallback tier is shown
- swap reason is shown
- fallback swaps are labeled as fallbacks
- runtime swaps stay session-local unless explicit reseed or replacement occurs

Future swap contract inputs:

- `sourceLaneId`
- `sourceSeedRole`
- source V2 class
- movement pattern
- directness
- fatigue/stability/loadability tier
- collateral effects
- duplicate/collision context
- fallback tier

Candidate tiers:

1. exact lane/class equivalent
2. same movement/equivalent class
3. useful fallback with warning
4. broad same-muscle fallback

Prior audit interpretation: runtime swap behavior was seed-safe, but not yet lane-preserving enough. Romanian Deadlift for Stiff-Legged Deadlift was a good same-lane example. Back Extension / Reverse Hyperextension for Seated Leg Curl were wrong-lane for knee-flexion curl. Goblet Squat over Belt Squat / Leg Press / Hack Squat for Bulgarian Split Squat showed loadability and quad-support quality gaps. No calf swap for Seated Calf Raise showed hard fatigue deltas could suppress useful equivalent alternatives.

Recent swap-quality progress: runtime swap suggestions now carry lane-fit diagnostics such as `swapLaneFitScore`, `swapCandidateReason`, `swapFallbackTier`, `sourceLaneRole`, `sourceV2Class`, `movementPatternMatch`, `fatigueDelta`, `jointStressDelta`, `stabilityTier`, `loadabilityTier`, and `weeklyCollisionWarnings`.

Narrow ranking fixes improved Lower B swap quality:

- SLDL now prefers Romanian Deadlift as exact-lane and treats Cable Pull-Through as warning fallback.
- Seated Leg Curl now prefers Lying Leg Curl as exact-lane and demotes Back Extension / Reverse Hyperextension to broad fallback.
- Bulgarian Split Squat now ranks Belt Squat / Leg Press / Hack Squat above Goblet/Lunge fallbacks for loadable quad support.
- Seated Calf Raise now surfaces Standing Calf Raise / Leg Press Calf Raise as warning-tier candidates rather than returning no swaps.

Remaining gap: `weeklyCollisionWarnings` exists but is not yet populated. True weekly/session collision-aware swap coaching remains future work.

Runtime interpretation:

- swaps are session-local
- swaps do not mutate `slotPlanSeedJson`
- swaps can become performed reality for this workout
- repeated swaps/avoidance can become future planning evidence only through review/strategy, not silent seed mutation

### Set-Level Autoregulation Loop

After each logged set, runtime should evaluate what actually happened against the planned target.

Inputs:

- reps
- load
- RPE/RIR
- form quality
- pain/discomfort
- performance dropoff
- rest duration where available
- prior sets in the current exercise/session

Possible recommendations:

- repeat the same target
- increase load
- reduce load
- extend rest
- aim for a lower rep target
- skip the next set
- stop the exercise
- optionally add a set when performance is strong, fatigue is low, and the session budget allows it

These recommendations remain session-local. They may shape today's workout and the saved performed-reality record, but they must not change the accepted seed unless the user later chooses an explicit reseed or replacement path.

### Add Set / Back Off Guidance

Add-set suggestions should be earned by today's evidence.

When the user adds a set, the new row should clone the target prescription rather than actual logged performance from the prior set. Actual performance belongs in the log; target cloning keeps the added set from turning one performed outlier into a new prescription.

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

Added exercises should be conservative runtime deviations. They should remain removable until logged, and once logged they should become performed reality for this workout rather than hidden future plan policy.

### Save / Receipts / Analytics

Save should preserve the original planned seed receipt and persist deviations as performed-reality metadata.

Runtime metadata model:

- `selectionMetadata.sessionDecisionReceipt` remains original planned/session-decision truth.
- `selectionMetadata.workoutStructureState` reflects current saved workout structure.
- `selectionMetadata.runtimeEditReconciliation.ops[]` records session-local mutations.

Target behavior:

- runtime edit operations, swaps, additions, skipped sets, and substitutions are captured as what happened today
- skipped sets are valid logs but not performed work
- Program/Home do not confuse edited runtime structure with canonical seed truth
- workout detail/log views show current workout reality
- Analytics separates planned, skipped, and performed sets
- Review learns from performed reality
- receipts/provenance explain deviations without becoming a second executable plan

Known hardening items:

- add-exercise should explicitly reject terminal or closed workouts at the API level
- add-set should explicitly reject terminal workouts
- save rewrite with nonempty `exercises` payload is powerful and should remain tightly guarded and tested
- add-exercise preview/discovery set count should align with canonical add behavior or explain the difference

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

Recent provenance cleanup: `buildMesocycleSlotPlanSeed()` no longer has to serialize every accepted seed as `source: "handoff_slot_plan_projection"`. Legacy callers still omit the optional source and keep the legacy label. The guarded V2 materialized-seed ready path now passes `source: "v2_materialized_seed"` through the same serializer.

This improves future accepted-seed provenance without changing executable seed shape, parser compatibility, runtime replay, receipts, Program/Home/UI behavior, or existing persisted seeds.

Important boundary: `slotPlanSeedJson.source` is explanatory provenance, not executable truth. Runtime must continue to consume only `slots[].exercises[{ exerciseId, role, setCount }]`.

Do not infer complete authoring truth from `slotPlanSeedJson.source` alone. Prefer layered evidence: `acceptedPlannerIntent.source = "v2_planner_policy"`, replacement artifacts that report V2 materialized seed provenance, transaction context, and runtime `compositionSource`.

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

   This remains a gate for future V2-authored seeds and replacements. Inspect `candidateIdentitySummary` before write and confirm selected exercises satisfy the intended lanes. Do not infer identities from set totals, totals by muscle, or provenance labels.

3. Use guarded replacement only for eligible empty or unsupported cases.

   Replace only when the target mesocycle is eligible, the candidate is materially better, gates remain fail-closed, and the seed decision is canonical. This is an explicit guarded replacement decision, not a live-default V2 promotion.

4. Backfill performed reality only after canonical seed decision.

   Backfill should use the seed decision as settled truth. The active live checkpoint has Week 1 Upper A, Lower A, and Upper B backfilled without changing `slotPlanSeedJson` or `slotSequenceJson`. Do not backfill from an ambiguous candidate, a legacy-looking materializer output, or a provenance-only inference.

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
- next-session generation preserves persisted seed exercise order unless an explicit, labeled runtime ordering policy exists
- Program, Home, Next Workout, and generated workout rows agree on slot, identity, set count, role, and order for seeded sessions
- rep ranges match exercise class and hypertrophy goal
- RIR/RPE target matches lifecycle week
- load target is coherent with recent performance
- target source and confidence are visible
- recommended adjustment range is visible when confidence is low or mismatch risk is present
- risky load/RIR mismatch is warned
- allowed-but-cautioned prescriptions are distinguished from clean prescriptions
- estimates and low-confidence targets are labeled
- swaps preserve lane intent
- swap candidates are tiered by lane/class equivalence before broad same-muscle fallback
- wrong-lane swaps are blocked or clearly labeled as fallbacks
- equivalent swaps are not suppressed by trivial fatigue/stress deltas without explanation
- add-set and add-exercise behavior is bounded and session-local
- add set clones target prescription rather than actual logged performance
- added exercises are removable until logged and excluded from canonical seed
- skipped sets are valid logs but not performed work
- save preserves seed and logs reality
- runtime edit/reconciliation metadata records session-local mutations
- swaps, skips, added exercises, stopped exercises, and major load reductions can capture user reason when useful
- reason capture distinguishes pain, equipment issue, time pressure, preference, fatigue, target-muscle feel, and form breakdown
- Program/Home/Analytics distinguish planned, skipped, and performed work
- workout detail/log views distinguish current workout reality from original planned receipt truth

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
- one bad day, one skipped set, or one swap does not become durable future plan policy without confidence, recurrence, or user reason
- old repair-shaped prescribed plans are not treated as performed truth

## 12. What Not To Do

- Do not let diagnostics become behavior.
- Do not copy repaired projection as target policy.
- Do not make the materializer a second planner.
- Do not let runtime consume planner metadata.
- Do not let runtime edits mutate canonical seed.
- Do not reorder seeded exercises in runtime preview/generation unless the ordering policy is explicit, intentional, and surfaced.
- Do not treat target loads as exact truth when confidence is low.
- Do not increase load into an easier RIR target when prior reps/effort contradict it.
- Do not hide prescription source/confidence from the user/operator.
- Do not suggest swaps that preserve only primary muscle while changing the lane's training effect.
- Do not present broad same-muscle fallbacks as equivalent lane-preserving swaps.
- Do not allow hard fatigue/stress deltas to hide clearly equivalent low-risk alternatives without explanation.
- Do not let added exercises silently become future plan policy.
- Do not let analytics confuse skipped, planned, and performed sets.
- Do not let `workoutStructureState` or `runtimeEditReconciliation` replace `sessionDecisionReceipt` as original session-decision truth.
- Do not clone actual logged performance into newly added set targets.
- Do not leave terminal/closed workout edit routes relying only on UI gating.
- Do not let powerful save rewrites bypass reconciliation and receipt-preservation guardrails.
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

## 13. Immediate Next Strategic Step: Runtime Execution Quality + Save/Read-Model Validation

The next question:

```txt
Can the user train the next seeded session safely and clearly,
with runtime preview/generation/save/read models preserving planned truth
while capturing performed reality?
```

Immediate sequence:

1. Confirm Lower B is the next slot from `slotSequenceJson` and persisted seed truth.
2. Confirm Program, Home, Next Workout, and generated workout rows agree on seeded slot, exercise identity, set count, role, and order.
3. Resolve the Seated Leg Curl / Bulgarian Split Squat order mismatch unless an explicit runtime ordering policy is intentionally added and surfaced.
4. Validate that SLDL prescription is allowed-but-cautioned, does not increase load into contradictory evidence, and exposes source/confidence/adjustment guidance.
5. Validate normal runtime edits remain seed-safe: swap, add set, skip set, add exercise, remove unlogged added exercise, and save reconciliation.
6. Validate save/read-model behavior after edits: seed truth remains planned truth, performed reality is reflected in workout detail/log views, and Program/Home/Analytics do not collapse planned/skipped/performed work.
7. Classify remaining coaching gaps as critical blocker or roadmap improvement before blocking the user from training.

### Parallel Architecture Track: `laneSelectionIntent`

Keep planner-owned `laneSelectionIntent` as a parallel architecture track. The read-only `V2LaneSelectionIntentAudit` should continue to guide the contract, but it must not feed materializer ranking, runtime replay, seed serialization, receipts, UI, DB writes, or persistence until the planner-owned contract exists and is explicitly promoted through guarded tests/audits.

Near-term architecture work:

1. Use read-only `V2LaneSelectionIntentAudit` to design the `laneSelectionIntent` contract.
2. Start the contract with vertical pull, quad isolation/support, hinge, chest exposures, rows, and calves.
3. Resolve `upper_a:chest_secondary` as skeleton-only ghost intent: restore, retire, or explicitly map it before treating it as materializer-facing policy.
4. Keep the diagnostic read-only until the planner-owned contract is implemented.
5. Continue provenance/source cleanup so seed authoring provenance, seed serialization source, runtime composition source, and UI exercise source are not conflated.

### Runtime Execution Audit Track

Active audit tracks:

- load/RIR mismatch warning
- exercise-order fidelity across Program, Home, Next Workout, and generated workout rows
- lane-preserving swap audit
- swap candidate tiering audit
- wrong-lane fallback labeling audit
- equivalent-swap fatigue/stress ceiling audit
- runtime edit plus save contract audit
- add-set/add-exercise terminal-workout hardening audit
- save rewrite guardrail audit
- add-exercise preview/discovery set-count alignment audit
- seed provenance helper
- next-session UI/read-model confirmation if needed

### Training Continuity Guardrail

Do not block real training indefinitely for non-critical coaching improvements.

Critical blockers:

- seed mutation risk
- unsafe prescription
- wrong slot/session
- wrong exercise identity, set count, or materially meaningful order for seeded sessions
- save/read-model corruption

Non-critical improvements can be logged as roadmap items when the user can train safely with manual guidance. Examples: better swap ranking, richer caution copy, more nuanced adjustment ranges, additional operator detail, or future performed-reality feedback fields.

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
