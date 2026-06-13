# Hypertrophy Mesocycle Engine Strategy

Owner: Aaron
Last reviewed: 2026-06-12
Purpose: Define the strategic direction for the V2 hypertrophy planner migration: V2 becomes the future plan author, accepted seed remains minimal executable truth, runtime replay remains stable, and performed reality informs future blocks without silently mutating the current one.

This document is a strategy and migration map, not a claim about current runtime behavior. Current runtime truth remains the code, contract tests, and audit artifacts. The current mapping is grounded in live audit evidence, V2 factory-line/materializer diagnostics, candidate-evaluator readouts, runtime execution work, and the latest legacy repair quarantine findings:

- Owner: `aaron8819@gmail.com`
- Active mesocycle: `9b861675-c98f-42f7-bc8c-64a7de411b77`
- Current bounded Calves readout, 2026-06-13: Weeks 2-4 `lower_a:calves` 4 -> 3 and `lower_b:calves` 4 -> 5 are promoted baseline planner policy. Remaining materializer/readout diagnostics should report that exact shape as idempotent bounded-owner evidence, not a new slot-allocation target or no-impact pressure.
- Architecture signal: `mostly_repair_shaped`
- Material repairs: `21`
- Major repairs: `12`
- Likely upstream-avoidable material repairs: `13`
- Remaining material repairs after current V2 diagnostics: `8`
- Suspicious repairs not eligible for promotion: `3`
- Legacy repair quarantine: `evidence_only`, `behaviorCandidates=0`, `quarantined=42`, `staleArtifacts=13`

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
Completed block evidence
-> Strategy
-> Demand / volume model
-> Slot + lane intent
-> Set distribution
-> Materializer
-> Candidate evaluator
-> Acceptance gate
-> Minimal accepted seed
-> Runtime execution
-> Performed reality
-> Review / learning loop
```

Operating roles:

- Strategy = why. It chooses the block objective, phase stance, priorities, recovery bias, continuity/variation posture, and how completed-block evidence should matter.
- Demand / volume model = how much. It translates strategy into muscle landmarks, direct/support floors, target zones, caps, progression shape, and deload expectations.
- Slot + lane intent = where. It assigns the work to sessions and lanes with explicit movement/class obligations, directness, stability, axial-fatigue, collateral, substitution, continuity, and duplicate policy.
- Set distribution = how many sets per lane. It budgets lane set counts before exercise identity selection so ordinary volume shape is not created by late repair.
- Materializer = which exercise. It converts lane intent into concrete exercise identities while preserving planner intent, optimizing stimulus-to-fatigue, respecting constraints, and staying explainable.
- Candidate evaluator = quality computation. It evaluates the materialized candidate for coverage, floors/caps, lane preservation, repair burden, materializer omissions, prior-block risk, trainability, and runtime-readiness evidence.
- Acceptance gate = decision. It decides `not_runnable`, `rejected`, `accepted_with_watch_items`, or `accepted`; it judges and explains, but does not plan, repair, reseed, accept, or mutate.
- Accepted seed = contract. It stores the accepted executable plan in the smallest runtime-consumable shape.
- Runtime execution = seed-inert execution. Runtime replays only the accepted seed, while prescriptions, swaps, add-ons, skips, and coaching remain session-local unless an explicit reseed/update path promotes them.
- Performed reality = evidence. Logs record performed sets, skipped work, swaps, pain/tolerance, load, reps, RPE/RIR, adherence, and session duration.
- Review / learning = future strategy input. Review summarizes what worked, what failed, and what should influence the next plan without mutating the accepted one.
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

Current live validation is in an active-mesocycle consolidation phase. The priority ladder from runtime execution quality through legacy repair quarantine has been completed without changing the seed/runtime source-of-truth boundary.

The durable checkpoint:

- the active mesocycle is `9b861675-c98f-42f7-bc8c-64a7de411b77`
- the latest mesocycle-explain architecture signal remains `mostly_repair_shaped`
- material repair pressure is still real: `materialRepairCount=21`, `majorRepairCount=12`
- current V2 diagnostics classify `likelyUpstreamAvoidableMaterialRepairs=13` while leaving `remainingMaterialRepairs=8`
- suspicious downstream repairs are explicitly not promotion material: `suspiciousRepairsNotEligibleForPromotion=3`
- legacy repaired projection is quarantined as evidence only: `behaviorCandidates=0`, `quarantined=42`, `staleArtifacts=13`
- the repair-quarantine ladder has now measured four representative slices without finding promotion-ready behavior: `selection_capacity_pressure` measured no candidate impact, `class_taxonomy_mismatch` measured no drift, selected `set_distribution_budget` measured no candidate impact, and selected `support_direct_floor` also measured no candidate impact
- the selected support-floor proof is `week_1:upper_a:side_delt_isolation:side_delts`, direct floor `0/4`, likely owner `audit_readout_cleanup`, classification `diagnostic_only_no_impact`, with `consumedByProduction=false` and `safeForBehaviorPromotion=false`; the next safe slice should clean or disprove support-floor readout evidence before changing SetDistributionIntent or support policy
- runtime execution quality, performed-reality readouts, post-session calibration evidence, candidate evaluation, materializer comparison, and repair-readout quarantine are now coherent enough to guide the next architecture slice
- no DB mutation, Prisma migration, reseed, seed/slot sequence mutation, active plan-shape change, runtime planner-metadata consumption, or receipt mirror was part of this milestone

The completed milestone is not "V2 is now the default author." It is: the audit stack can now separate candidate truth, V2 diagnostic evidence, performed-reality evidence, remaining material repair pressure, and legacy repair artifacts without letting repaired projection become target policy.

The remaining architecture signal must stay visible:

- production projection is still mostly repair-shaped
- the current V2 path explains more of the desired upstream ownership, but it has not replaced production authoring
- likely upstream-avoidable rows are hypotheses for planner-owned work, not behavior by themselves
- `behaviorCandidates=0` is currently correct because every repaired row is classified as safety/repair-only, collateral/ambiguous, stale repaired-projection artifact, or missing an owner-specific measured gate before behavior
- remaining repairs point at set distribution, concentration, capacity, and materializer-quality cleanup
- after the no-impact capacity proof, the next safer upstream proof target is a higher-ranked non-measured gap such as class/taxonomy bridge no-drift evidence or bounded set-distribution projection, not a capacity cap-delta promotion
- suspicious/quarantined legacy repair rows must not be promoted
- runtime replay remains correct only because it stays boring and consumes the persisted executable seed shape

The latest factory-line finding resolved the downstream suspicion:

- Program had a masking bug: when a set-aware seed existed but display resolution failed, it could fall through to linked workout or projection rows.
- That has been hardened. Set-aware seeded Program rows should come from `slotPlanSeedJson` plus catalog names only, labeled `exerciseSource: "persisted_slot_plan_seed"`.
- Runtime replay was not the problem. Runtime faithfully replayed the persisted seed.
- The active seed mismatch was not a failed persistence or acceptance bug.
- The V2 replacement path was connected to V2 materialization.
- The persisted seed matched the V2 materialized candidate, accepted-seed preview, final seed-builder input, and runtime replay.

The actual issue was materializer identity selection. V2 materialization selected legacy-looking exercise identities. That means the upstream gap is not primarily "can the seed be stored?" but "does the materializer select the right concrete exercise for the planner's intended lane?"

The latest completed-block validation adds a second quality signal: the user can complete and save seeded accumulation sessions through normal UI while seed truth and read models remain coherent. The source block also reached deload and then `AWAITING_HANDOFF` through supported lifecycle routes, which means the immediate risk has shifted away from lifecycle mechanics and toward next-candidate quality.

Runtime order fidelity has also been fixed. Seeded generated workouts preserve `WorkoutExercise.orderIndex`, and Next Workout, Program, and generated workout rows agree on seed order. The strategic rule remains: seeded sessions should have one visible planned order unless an explicit, labeled runtime ordering policy exists.

Week 2 and early Week 3 prescription evidence moved the coaching problem from "can seeded sessions be executed?" to "can the app interpret performed anchors honestly?" The strategic conclusion is not "runtime should re-author the seed"; it is that runtime prescription and review need their own quality gate over load, reps, effort, confidence, source, caution warnings, adjustment range, and recalibration evidence.

Prescription confidence readouts now exist on generated session responses as `prescriptionReadouts`. They are server-owned read-model/coaching metadata only. They are not seed truth, receipt truth, runtime replay input, planner policy, or executable truth.

Runtime edit route hardening adds a third quality signal: normal UI runtime edits remain seed-safe, and add-exercise/add-set now reject terminal or closed states at the API level. Add set, skip set, add exercise, remove unlogged runtime-added exercise, and save reconciliation mutate the current `Workout`/log structure only, append runtime edit/reconciliation metadata, and do not mutate `slotPlanSeedJson` or `slotSequenceJson`.

The important model:

- `selectionMetadata.sessionDecisionReceipt` remains original session-decision truth.
- `selectionMetadata.workoutStructureState` reflects current workout structure.
- `selectionMetadata.runtimeEditReconciliation.ops[]` records session-local mutations.

Strategic interpretation: runtime can support flexible training without mutating the plan. The runtime/save layer should be judged by whether it preserves seed truth, records reality accurately, and keeps Program/Home/Analytics clear about planned versus performed.

The runtime swap audit adds a fourth quality signal: current swap behavior is seed-safe and now more lane-preserving after lane-fit diagnostics and ranking fixes. It still lacks first-class weekly/session collision warnings and still needs planner-owned lane intent before it can be treated as an elite substitution engine.

Improved examples:

- Stiff-Legged Deadlift now returns Romanian Deadlift as an exact-lane swap.
- Leg Curl fallbacks are tiered correctly instead of treating hip-extension patterns as clean curl equivalents.
- Bulgarian Split Squat now prefers loadable quad-support alternatives before broad fallbacks.
- Calf equivalent swaps can surface as warning-tier candidates instead of disappearing behind hard fatigue/stress deltas.

Strategic interpretation: runtime swaps are allowed to be session-local and seed-inert, but their coaching value depends on preserving the lane/job. Same primary muscle and broad family compatibility are necessary but not sufficient, and collision-aware coaching remains future work.

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

Current legacy production projection remains repair-shaped and should not stay as an equal parallel planner indefinitely. V2 is not live default. Historical personalization is not implemented as production strategy. Repair has not been removed as a safety net. The latest work proves that legacy repair readouts can be quarantined as evidence, that suspicious repairs can be excluded from promotion, and that current V2 gaps can be read from V2-owned diagnostics instead of copied from repaired projection. It does not prove that V2 is the supported default author, that repaired projection is obsolete, or that any diagnostic row may feed seed/runtime behavior.

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

Current status: `exerciseClassDistributionBySlot`, `ExerciseSelectionPlan`, materialization taxonomy, and the V2 taxonomy bridge expose much of this shape. The recent split between `quad_isolation` and `squat_pattern`, stricter direct `vertical_pull` matching, and bounded Stage C `laneSelectionIntent` consumption for vertical pull anchor, chest-biased press support, hamstring curl, calf direct support, side-delt direct, triceps direct, rear-delt direct, row support, and quad isolation are the right direction. It is still not enough. Do not let exact exercise selection pretend to solve class strategy by accident.

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

Current status: Stage A exists as planner-owned `laneSelectionIntent v0` on high-risk `ExerciseSelectionPlan` lanes, with read-only `V2LaneSelectionIntentAudit` visibility. Stage C now has guarded pure-materializer consumption paths for `vertical_pull_anchor`, chest-biased press support, `hamstring_curl`, calf direct support, side-delt direct, triceps direct, rear-delt direct, `row_support`, and `quad_isolation`; other lane intents remain diagnostic-only until separately promoted. Intent metadata remains read-only explanatory truth and must not feed accepted seed shape, runtime replay, receipts, DB writes, or non-V2 paths.

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

Runtime order fidelity: for seeded generated workouts, `WorkoutExercise.orderIndex` is the executable flattening contract. UI, audit, projected summary, and generated workout views must not infer planned order from `mainLifts + accessories` section grouping. Section labels can explain role, but they must not reorder persisted seed truth unless an explicit, surfaced runtime ordering policy exists.

Current status: keep current runtime. Do not replace it.

### Runtime Adjustment Rules

Strategic purpose: define what runtime may adapt locally without redesigning the mesocycle. Good looks like practical user flexibility with receipts that explain deviations and read models that distinguish planned truth from performed reality.

Current status: runtime and reseed seams already support the direction. Do not move planner intelligence into runtime.

### Runtime Prescription Engine

Strategic purpose: transform seed exercise rows into session prescriptions: set rows, rep ranges, target reps, target load, target RIR/RPE, confidence, and source/basis.

Good looks like prescription output that respects lifecycle week, exercise class, equipment increments, exact performance history, substitution history, cold-start uncertainty, and the difference between load suggestion and load truth.

Future prescription/coaching should also use exercise-specific coaching profiles. High-skill axial compounds, stable machine compounds, unilateral compounds, isolations, lengthened-biased isolations, and calf/forearm/high-rep-tolerant isolations should not share one generic progression model. The profile should influence rep range, load confidence, progression aggressiveness, caution labels, and add/back-off guidance.

Current status: generated session responses expose server-owned `prescriptionReadouts` as coaching/read-model metadata. Runtime dose-guidance diagnostics exist as audit/readout evidence, not behavior. UI consumption, concise row-level presentation, and production dose-adjustment behavior remain future work. Do not infer from this doc that production prescription logic already passes the full quality gate.

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

Current status: runtime edit seams exist and the read-only audit found normal UI runtime edits are seed-safe. Recent runtime hardening added direct API route mutability guards for add-exercise and add-set: `PLANNED`, `IN_PROGRESS`, and `PARTIAL` workouts can accept session-local edits when open, while `COMPLETED`, `SKIPPED`, and closed/inactive mesocycle states reject structural edits. Seed truth and runtime replay remain unchanged. This section still defines the broader north-star quality bar rather than claiming every hardening item is complete.

### Save / Reconciliation Layer

Strategic purpose: persist performed reality, runtime edit ops, skipped work, substitutions, additions, and receipts so Program/Home/Analytics can distinguish planned truth from performed reality.

Good looks like save behavior that preserves the original planned seed receipt, records deviations separately, treats skipped sets as valid logs but not performed work, and gives review/analytics enough evidence to learn from reality without mutating the accepted seed.

Current status: normal UI runtime edit/save reconciliation is seed-safe in the read-only audit: Program should keep canonical seed structure, workout detail/log views should show current workout reality, and analytics/weekly volume should count performed non-skipped logs. The full runtime execution quality bar remains target architecture.

### Post-Mesocycle Learning Loop

Strategic purpose: turn performed reality into next-block strategy evidence. Good looks like review summaries that can recommend volume hold/increase/reduction, specialization, recovery bias, exercise continuity, rotation, or fatigue-management changes.

Current status: `MesocycleReview`, handoff summaries, strategy-input adapters, and audit diagnostics have pieces of the loop. Do not use old repaired prescribed plans as the training signal.

### Next-Mesocycle Acceptance Gate North Star

The next-mesocycle acceptance gate is a read-only decision system whose job is to decide whether a candidate mesocycle should be trained from as-is. It is not the planner, materializer, repair engine, or runtime source of truth.

The gate should answer:

```txt
Should this next mesocycle be trained from as-is?

Is the candidate executable, safe, hypertrophy-effective, recoverable, responsive to prior-block evidence, and trainable in Week 1?
```

This is a layered, evidence-aware quality gate, not a checklist that passes because a few fields exist. It judges and explains. It must not silently fix, repair, reseed, re-author, or mutate the plan.

Decision outcomes:

```txt
not_runnable:
  no real candidate exists, wrong lifecycle state, unresolved blocker, or diagnostic preview only.

rejected:
  candidate has blocker/high-risk failures that must be fixed before Week 1.

accepted_with_watch_items:
  trainable, but has known risks to monitor through pre-session checks.

accepted:
  seed/runtime/lifecycle/volume/materialization/trainability gates pass with no material concerns.
```

Layered model:

- Layer 0 — Candidate identity: a real persisted or draft candidate exists, it belongs to the correct owner/source block, and a diagnostic preview is not mistaken for a candidate.
- Layer 1 — Lifecycle/source-of-truth safety: handoff state is correct, seed remains executable truth, runtime consumes only `{ exerciseId, role, setCount }`, and diagnostic metadata does not become runtime truth.
- Layer 2 — Structural executability: all slots exist, order is stable, Week 1 and deload generate, and runtime does not need fallback or reselection to make the plan trainable.
- Layer 3 — Hypertrophy floor/cap quality: priority muscles are above MEV with margin where appropriate, no muscle is over MAV, target/stretch semantics are respected, and below-target/above-MEV is not treated as failure.
- Layer 4 — Distribution and stimulus-to-fatigue: the right muscles are in the right sessions, compound/isolation balance is sane, hinge/curl, press/fly, and row/pulldown balances are coherent, calves and delts get enough directness, and floor-closing work prefers low-fatigue choices.
- Layer 5 — Prior-block evidence: recurring MEV misses, thin-margin muscles, repeated runtime add-ons, load calibration drift, and target-semantics friction are surfaced as evidence without automatically becoming policy.
- Layer 6 — Week 1 trainability: generated sessions are coherent, loads/reps/RPE/confidence are usable, severe stale-target issues are surfaced, and the user can train without manual interpretation.
- Layer 7 — Final decision: accept, accept with watch items, reject, or mark not runnable.

Gate findings should use severity, not only binary pass/fail:

```txt
blocker
high risk
warning
info
pass
```

Examples:

- no candidate = blocker / not runnable
- priority muscle below MEV = high risk or blocker
- recurring fragile muscle exactly at MEV = warning
- below target but above MEV = info or watch item, not failure
- over MAV = high risk/blocker
- high repair burden = planner ownership warning or failure depending severity

Evidence is not automatically a required fix. The gate must distinguish:

- evidence
- hypothesis
- required fix

Do not overfit to the last block. Do not treat MEV as the only goal. Do not over-trust decimal weighted-set precision. Do not pass bad exercise identity just because muscle volumes pass. Do not accept a repair-heavy plan as if it were clean planner authorship. Do not let the gate silently repair or mutate the plan.

For muscles with repeated prior-block MEV fragility, exact-MEV coverage should not be a clean pass. It should at least create a watch item, and preferably the candidate should include a small planned buffer if recoverable.

Examples:

- chest exact MEV after prior misses = warning
- calves exact MEV after prior misses = warning
- side/rear delts exact MEV after thin-margin behavior = watch item

A candidate may be trainable while still showing planner ownership debt.

Output should separate:

- trainability
- planner/materializer quality
- repair burden
- watch items

Example:

```txt
Trainability: pass
Planner ownership: warning
Repair burden: high
```

Every failure should include:

```txt
severity
owner seam
smallest safe fix
must-fix-before-Week-1 yes/no
```

If the owner seam is unclear, the recommendation should be investigation, not implementation.

The acceptance gate must not become:

- a hidden planner
- a repair engine
- a source of truth
- a noisy report nobody can act on
- a rigid decimal-based scoring system
- a reason to reject usable plans endlessly

After deload, use the acceptance gate against the real refreshed draft before accepting the next cycle. The gate now has a real candidate and has identified the immediate failing seams: support-floor coverage for Rear Delts, Side Delts, and Triceps, plus materializer support-lane preservation. The next work is candidate quality, not lifecycle.

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

Recent prescription-confidence progress: generated session responses now expose server-owned `prescriptionReadouts` containing prescription/coaching metadata such as target load, target reps/range, target RPE/RIR, load source, confidence, caution level, caution reason, and suggested adjustment range.

This readout should be generated after load assignment in the server read model. It should not live in React, planner/materializer, seed replay, or executable seed truth.

UI consumption and concise coaching presentation remain future work. The workout screen should surface the smallest actionable version of this readout:

- confidence
- caution
- source
- suggested adjustment range

Detailed traces, reason codes, provenance, and debugging evidence belong in audit/operator surfaces.

Main-lift rep prescription now distinguishes the prescribed boundary from the aim inside the boundary. `targetRepMin` / `targetRepMax` or `targetRepRange` is the prescription boundary; `targetReps` is the aim inside the range. UI and review copy should be range-first, for example `6–10 reps (aim 7)`, and should not present a hypertrophy main lift as a synthetic exact `9-9 band` when a true range exists.

### Runtime Dose Guidance

Runtime dose-guidance diagnostics now exist in audit/readout form as `runtimeDoseAdjustmentDiagnostics`.

Current status:

- read-only
- `affectsAcceptedSeed=false`
- reports planned remaining volume
- reports performed week-to-date volume
- reports projected end-of-week target status
- reports fatigue-density concern
- reports readiness caveat
- reports recommended session-local action

This is not runtime behavior and must not mutate seed. Add/reduce recommendations require an actionable exercise candidate. No-candidate deficit rows must remain `hold_seed`.

#### Weekly Volume Target Semantics

Weekly volume guidance should distinguish floors, useful adaptive zones, stretch targets, and ceilings. A single target number is too easy to misread as a must-hit quota, especially when it equals or sits close to MAV.

Target semantics:

- below MEV: problem state; fix when practical, especially for priority muscles
- at/above MEV: productive floor achieved; additional work depends on recovery, session fit, and stimulus-to-fatigue
- productive target zone: preferred adaptive range above MEV when recoverable
- stretch target: optional; pursue only when recovery/performance are strong and add-ons are low-fatigue
- MAV/MRV ceiling: caution zone; do not chase automatically

Runtime coaching should not blindly chase every weekly target. It should prioritize MEV floor closure, useful low-fatigue volume, and recovery-aware decisions. A muscle below target but above MEV is not automatically a problem.

Early and mid-week behavior:

- do not panic-top-up just because projected target status is low
- run the accepted seed first
- use conservative, session-aligned add-ons only when recovery, fatigue cost, and upcoming overlap justify them

Final practical opportunity behavior:

- if a target-tier muscle is below MEV, use bounded low-fatigue isolation top-ups to close the floor when practical
- do not chase the full target deficit
- do not add high-fatigue compound work solely to satisfy a volume target

If the app repeatedly shows large target gaps while correct coaching says "do not chase," the target semantics need refinement rather than runtime pressure to force volume. A future model should represent the policy as a floor/range/ceiling structure:

```txt
MEV floor
productive zone
stretch zone
MAV/MRV cap
```

Illustrative framing only, not hardcoded policy:

```txt
Chest:
  MEV floor: 10
  productive zone: 10-14
  stretch: 14-16
  cap: 16
```

Runtime add-on coaching should combine:

- weekly target gap
- expected weighted contribution of the candidate exercise
- low systemic fatigue option
- upcoming session overlap
- recovery/readiness
- user feeling good

Feeling good is a green light to consider more work; it is not sufficient by itself. The app should prefer the lowest-fatigue set that closes a real weekly gap and avoids compromising the next slot.

Raw sets are not always weighted sets. A runtime add-on recommendation must account for the expected weighted contribution of the candidate exercise. One raw set of an isolation movement may not equal one full weighted set for the target muscle, depending on the app's muscle contribution model.

Examples:

- hamstrings low while Lower B already includes SLDL plus curl: prefer curl volume before extra hinge volume
- calves low: add a calf set
- quads low: add Leg Extension
- side/rear delts low: add lateral or rear-delt isolation
- avoid extra lower-back or hinge volume unless specifically needed and recoverable

#### Final Weekly Opportunity MEV Closure

When a target-tier muscle is below MEV and the current session is the final practical weekly opportunity, prefer a small low-fatigue isolation top-up that counts as session-local performed reality. Do not mutate accepted seed truth for this; preserve the distinction between weekly dose correction and mesocycle structure.

This is execution-time coaching, not automatic plan mutation. If recovery, time, and session context allow, the app should prefer a small isolation top-up that closes the weekly floor with minimal systemic cost. Examples:

- chest: prefer Pec Deck Machine or Cable Fly over extra heavy pressing for a small top-up
- triceps: prefer Cable Triceps Pushdown over more pressing
- hamstrings: prefer Seated Leg Curl over extra SLDL or other high-fatigue hinge volume
- calves: prefer Calf Raise work before adding broader lower-body fatigue

Final-opportunity MEV closure should be weighted-set-aware. When a muscle is below MEV at the final practical weekly opportunity, the app should estimate how many raw sets are needed to close the weighted-set floor, then apply recovery and session-fit guardrails. The goal is to close the MEV floor when practical, not chase the full target deficit.

Week 4 Upper B exposed the durable lesson. If chest is 3 weighted sets below MEV, recommending +1-2 raw chest-isolation sets may still leave chest below MEV when those exercises contribute partial weighted volume. The coaching direction can be right while the sizing is underpowered.

These top-ups are performed reality for the current workout. They do not mutate the accepted seed, change planner intent, imply automatic reseeding, or become future plan policy without later review and an explicit reseed/replacement path.

Audits and readouts should distinguish generic `opportunistic_extra` from deliberate `final_weekly_opportunity_mev_closure` when the context is known. A final-session MEV-floor correction should not be labeled as random extra work just because it was runtime-added.

Guardrails:

- do not chase every remaining target deficit in the final session
- MEV floor closure is more important than forcing target volume
- do not treat below-target/above-MEV as failure by default
- prefer low-fatigue isolation top-ups
- do not add high-fatigue compound work just to close the arithmetic gap
- avoid exceeding MAV/MRV
- avoid high-fatigue additions when recovery is compromised
- if closing the floor would require too much volume, say so and accept the miss
- require user confirmation or explicit session-local action
- do not automatically mutate the active mesocycle plan

#### Week Close And Gap-Fill Product Direction

Optional week-close/gap-fill workouts should not be part of the normal training flow. A completed scheduled week should close automatically unless there is a real lifecycle or data blocker, such as an incomplete required advancing workout, invalid state, missing required data, an unresolved save/receipt integrity issue, invalid session sequencing, a pending user-confirmed correction flow, or an explicit user decision to add non-standard work before closing.

Broad below-target deficits are not blockers. Below-target/above-MEV muscles should be treated as coaching evidence, not lifecycle blockers. Large deficit summaries based on stretch targets or MAV-adjacent targets should not create disruptive make-up workout prompts or block rollover into deload or the next week.

If a muscle is at risk of missing MEV, the preferred intervention is bounded session-local coaching during normal pre-session readiness, not an end-of-week optional make-up workout. Examples:

- add low-fatigue chest isolation during the final practical upper session
- add calf raise during the final practical lower session
- do not create a separate deficit-chasing workout after the week is otherwise complete

Week close should become a review/checkpoint, not a workout generator. It should summarize:

- muscles below MEV
- muscles in the productive zone
- target/stretch misses
- MAV/MRV risks
- useful evidence for the next planning cycle

Week close should not normally generate extra workouts or block deload/week rollover. Target deficits alone are not real blockers.

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

### Session Review / Recommendations

Session review must distinguish clean progression from recalibration in both directions. If actual performed load is materially below the written target, the target may be too high and the recommendation should be recalibration/caution rather than a clean win. If actual performed load is materially above the written target, the target may be too low and an upward `recalibrated_increase` is more honest than a plain clean increase. Near-target performance with strong evidence can still earn a clean increase. Skipped planned sets or too few/noisy signal sets should also block a plain "increase next time."

Post-workout review must also surface recalibration when the next action is hold. If actual performed load materially exceeds the written target and the next target is anchored upward, the app should explain that the written target or estimate was too low, even if the progression action is hold rather than increase.

Recent recommendation-quality progress sharpened this separation:

- clean progression is distinct from target recalibration
- upward recalibration applies when the performed anchor is materially above the written target, and may appear as `recalibrated_increase` or `hold_at_recalibrated_anchor`
- downward recalibration applies when the performed anchor is materially below the written target, and may appear as `target_too_high`
- recalibration can happen even when the base progression action is `hold`
- runtime-added sets count as performed reality, but must not hide missed planned work or inflate clean planned-set coverage

Review copy should make the next working load explicit when it differs from the written target. Examples: "Hold around 115, not 140" or "Treat 140 as too high."

Durable principles:

- progression math and coaching interpretation are separate layers
- a mechanically valid progression trace is not automatically good coaching copy
- post-workout review should prioritize severe prescription-quality misses over routine progression wins
- runtime-added work counts as performed reality, but must not hide missed planned work

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
- main-lift `targetRepRange` / `targetRepMin` / `targetRepMax` defines the prescribed range, while `targetReps` is the aim inside that range
- display/review uses range-first copy such as `6–10 reps (aim 9)` when a true hypertrophy range exists
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

Recent lane-fit diagnostics and ranking fixes improved swap quality. Runtime swap suggestions now carry lane-fit metadata such as `swapLaneFitScore`, `swapCandidateReason`, `swapFallbackTier`, `sourceLaneRole`, `sourceV2Class`, `movementPatternMatch`, `fatigueDelta`, `jointStressDelta`, `stabilityTier`, and `loadabilityTier`.

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

### Rest Timer Direction

The workout UI should not add a visible elapsed session timer by default. The useful timer is the intelligent rest timer after logged sets.

Current product direction:

- no visible elapsed session timer
- keep the intelligent rest timer after logged sets
- accessory default rest should be 2:00
- main lift default rest can stay 3:00
- warmups remain shorter
- rest timer state is UI/session-local and not training-plan truth

Future rest-timer coaching should adapt based on:

- exercise type
- target and actual RPE
- missed reps
- performance dropoff
- compound versus isolation context
- next-set risk

### Future Low-Priority Execution Layers: Warmups and Core Work

Warmups and core work are useful execution layers, but they are not near-term blockers for the current V2 planner/runtime migration. They should remain future, optional, and separate from accepted seed working-set truth unless explicit contracts are introduced.

Warmups:

- should prepare the user for quality working sets
- should not count toward hypertrophy volume targets unless explicitly marked otherwise
- should be generated or runtime-guided from exercise type, target load, session position, compound versus isolation context, skill/joint demand, and readiness/pain when available
- should remain separate from accepted seed working-set truth unless a future explicit warmup contract is introduced
- may give Belt Squat ramp-up sets while a lateral raise may only need a light acclimation set

Core:

- should be optional secondary/support work by default
- can include trunk flexion, anti-extension, anti-rotation, rotation, loaded carries, or bracing-support patterns
- should be tracked when performed
- may be suggested when time and recovery allow, but should not crowd out primary hypertrophy work
- should not silently become required block structure unless strategy explicitly prioritizes trunk development
- should remain session-local unless future planner strategy elevates core

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

- save rewrite with nonempty `exercises` payload is powerful and should remain tightly guarded and tested
- add-exercise preview/discovery set count should align with canonical add behavior or explain the difference

### Weekly Retro Load Calibration

Recent weekly-retro progress adds `weeklyRetro.exerciseLoadCalibrationRows[]`.

This readout compares planned, saved, performed, skipped, and runtime-added work, plus target and performed load summaries at exercise/session level. It classifies rows as:

- `clean`
- `target_too_low`
- `target_too_high`
- `recalibrated_hold`
- `insufficient_evidence`
- `runtime_added`
- `skipped_or_low_coverage`

These rows are audit/readout heuristics only. They do not feed runtime behavior, mutate seed, or become progression policy.

Week 2 examples:

- Belt Squat -> `recalibrated_hold`
- SLDL and Cable Fly -> `target_too_high`
- Machine Shoulder Press, Barbell Curl, Leg Extension, and Lying Leg Curl -> `target_too_low`

Strategic principle: weekly retros should make load calibration visible without becoming progression policy.

### User-Facing Training Cockpit

Program should make the next training action obvious first while preserving access to weekly volume review in-page. Analytics can own deeper trends, but Program should still support mesocycle-week review and prior-week target comparison.

Recent Program page progress moved toward an action-first hierarchy:

- Train Next card
- This Week's Training Plan
- Projected Week Finish
- Weekly Volume Snapshot
- expandable full weekly volume dashboard

Completed slots are compact by default. The full weekly volume dashboard remains available in Program, not only Analytics. The compact snapshot avoids alarming early-week zero-volume watch lists while preserving progressive disclosure for deeper review.

Program source labels should remain user-facing:

- From your accepted plan
- From your active workout
- From saved workout
- Projected from remaining plan

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

Deprecation criteria:

- V2 refresh produces the persisted next-seed draft for a supported handoff candidate.
- The real refreshed draft passes `next-mesocycle-acceptance-gate` as `accepted` or `accepted_with_watch_items`.
- `accept-next-cycle` persists the successor from that accepted candidate without re-authoring it through legacy projection.
- `next-mesocycle-post-accept-verification` proves runtime replay/read-model readiness for the successor.
- Week 1 can be trained through the normal pre-session/post-session loop from persisted seed truth.
- At least one V2-authored mesocycle has been trained far enough to prove normal Week 1 runtime behavior, if live confidence still depends on trained-cycle evidence.

Once `nextSeedDraftJson.acceptedSeedDraft.source = "v2_materialized_seed"` exists, that persisted seed draft is canonical candidate truth. Legacy `handoff_slot_plan_projection` remains compatibility/diagnostic evidence only; accept, recovery, and post-accept verification must use the exact persisted V2 draft or fail closed. After the criteria above pass, legacy projection should become a removal candidate instead of an equal parallel planner. Keep compatibility fallback only where no V2 acceptedSeedDraft exists, old data, unsupported split types, or genuinely impossible/safety cases require it.

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

After each mesocycle, evaluate whether weekly targets acted as useful coaching targets or aspirational ceilings. If muscles consistently reach MEV but remain far below target despite good execution and recovery, consider lowering default targets, relabeling the target as a stretch target, using target ranges instead of single target numbers, tiering muscles by priority, or increasing seed volume only for repeatedly underdosed priority muscles in the next plan.

Also review repeated cases where final-opportunity top-ups were directionally correct but failed to close weighted MEV floors. Use those cases to calibrate exercise contribution weights, top-up sizing, and target-zone semantics.

Policy changes belong between mesocycles unless they fix a blocker. Do not mutate accepted seed during an active mesocycle just to chase targets; runtime add-ons remain session-local performed reality.

Roadmap note: remove or deprecate optional gap-fill workout generation from normal weekly close. Replace it with automatic week close plus a weekly review/readout. Use repeated below-MEV misses and target gaps as evidence for future planner/volume-policy changes between mesocycles.

## 10. Migration Strategy

1. Establish clean V2 static base plan.

   Current status: materially improved in pure dry-run. Static balanced demand, slot ownership, class ownership, role-sensitive set distribution, stricter taxonomy, materializer ranking guardrails, and base-plan validation provide stronger first-slice evidence.

2. Keep V2 eligibility separate from V2 consumption.

   `v2-accepted-seed-prepare-compare` can prove whether a V2 materialized seed would be production-write eligible in a read-only compare. That is not the same as making production consume V2 output, accepting the next cycle, or proving runtime execution.

3. Refresh the persisted draft explicitly when V2 is eligible.

   The `refresh-next-seed-draft` route is the explicit opt-in path that can turn the pending handoff draft into a persisted `v2_materialized_seed` candidate. Once refreshed, that draft is real candidate truth for the handoff. It is still not accepted seed truth.
   Legacy handoff projection may still be prepared for comparison or compatibility readout, but it is no longer an alternate production-write candidate for that source.

4. Judge the refreshed real draft through the acceptance gate.

   `next-mesocycle-acceptance-gate` must judge the refreshed persisted draft, not a diagnostic preview. The current refreshed V2 candidate is rejected because Rear Delts, Side Delts, and Triceps are below MEV and materializer/support-lane preservation is not good enough. That rejection is useful signal, not a lifecycle failure.

5. Accept only after the gate returns `accepted` or `accepted_with_watch_items`.

   `accept-next-cycle` should happen only when the real candidate is trainable. If the result is `rejected` or `not_runnable`, fix the owning planner/materializer candidate-quality seam first, refresh the draft again, and rerun the handoff dry-run and acceptance gate. When a persisted V2 acceptedSeedDraft exists, accept/retry/recovery must not silently fall back to legacy projection.

6. Prove runtime readiness after acceptance.

   `next-mesocycle-post-accept-verification` is the post-accept proof that the persisted successor can replay through the canonical runtime/read-model path. It does not replace handoff dry-run or acceptance-gate review.

7. Use read-only `V2LaneSelectionIntentAudit` to design the contract.

   Current status: added as a diagnostic and partially consumed by the pure V2 materializer for only `vertical_pull_anchor`, chest-biased press support, and `hamstring_curl`. It still exposes where current lane intent is explicit, where materializer/taxonomy inference is doing too much, and which high-risk lane families need a richer planner contract. Non-promoted lanes should remain read-only and not be consumed by demand, materialization, generation, seed serialization, runtime replay, receipts, UI, DB writes, or persistence.

8. Promote planner-owned `laneSelectionIntent` into guarded materializer consumption.

   Stage A defines `laneSelectionIntent v0` as planner-owned diagnostic truth. Stage C now consumes it only through guarded materializer paths for vertical pull anchor, chest-biased press support, hamstring curl, calf direct support, side-delt direct, triceps direct, rear-delt direct, row support, and quad isolation, with explicit movement/class intent, substitution strictness, stability, fatigue, directness, loadability, duplicate, and ranking policy. Future expansion should stay lane-by-lane; biceps and other high-risk lanes remain separate promotion slices.

9. Resolve skeleton-only / ghost lane cleanup.

   `upper_a:chest_secondary` exists in the target skeleton but is absent from the final materializer-facing `ExerciseSelectionPlan`. Decide whether it should be restored as a real lane, intentionally retired, or represented through another explicit lane before using it as evidence of materialized V2 intent.

10. Add guarded shadow/disabled consumption path for the richer lane contract.

   No production writes. The path should prove transport, validation, provenance, materializer consumption, and serializer compatibility while reporting exactly where consumption would fail.

11. Add bounded behavior trial.

   Only after gates prove safe. Start with the smallest slice that has clear owner, measurable quality improvement, non-regression checks, and rollback criteria.

12. Promote V2 as default author for supported cases.

   Only after V2-authored output passes plan-quality, materialization-quality, and integration gates. Runtime replay remains unchanged; repair becomes safety net for supported cases.

13. Demote/quarantine obsolete repair-as-planner machinery.

   Do this after V2 ownership is proven. Keep true safety, legacy fallback, impossible-plan handling, and forbidden-slot protection.

14. Add historical personalization / mesocycle-to-mesocycle adaptation.

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
- generated seeded workouts preserve `WorkoutExercise.orderIndex` across main/accessory section boundaries
- consumers must not flatten by section order when presenting executable planned workout order
- recent regression coverage protects seeded-runtime truth across parser/replay, Program current-week plan, projected summary, generated workout order, and session-audit snapshots
- rep ranges match exercise class and hypertrophy goal
- RIR/RPE target matches lifecycle week
- load target is coherent with recent performance
- target source and confidence are visible
- recommended adjustment range is visible when confidence is low or mismatch risk is present
- risky load/RIR mismatch is warned
- allowed-but-cautioned prescriptions are distinguished from clean prescriptions
- estimates and low-confidence targets are labeled
- prescription readouts expose concise confidence, caution, source, and suggested adjustment range in workout UI
- swaps preserve lane intent
- swap candidates are tiered by lane/class equivalence before broad same-muscle fallback
- wrong-lane swaps are blocked or clearly labeled as fallbacks
- equivalent swaps are not suppressed by trivial fatigue/stress deltas without explanation
- runtime dose guidance distinguishes target-volume deficit from fatigue-density concern
- runtime dose guidance distinguishes MEV floor, productive target zone, stretch target, and MAV/MRV ceiling
- below-target/above-MEV is not treated as failure by default
- final practical opportunity coaching closes MEV floors when practical without chasing full target deficits
- final practical opportunity top-up sizing accounts for expected weighted contribution, not just raw set count
- readiness and dose guidance explain whether a recommended add-on is expected to close the weighted MEV floor or only reduce the deficit
- example target readout direction: `Chest is projected 7 / MEV 10. Candidate Cable Fly contributes ~X weighted chest sets per raw set. Recommended +N raw sets is expected to close / partially close the MEV floor.`
- readouts distinguish generic `opportunistic_extra` from deliberate `final_weekly_opportunity_mev_closure`
- add/reduce recommendations require actionable exercise candidates
- add-on recommendations prefer low-fatigue movements that close real weekly gaps and avoid compromising the next slot
- completed scheduled weeks close automatically unless a real lifecycle/data blocker exists
- target deficits alone do not block week rollover, deload transition, or next-week flow
- week close acts as a review/checkpoint rather than a normal extra-workout generator
- add-set and add-exercise behavior is bounded and session-local
- add set clones target prescription rather than actual logged performance
- added exercises are removable until logged and excluded from canonical seed
- runtime-added sets do not inflate planned-set adherence
- skipped sets are valid logs but not performed work
- save preserves seed and logs reality
- runtime edit/reconciliation metadata records session-local mutations
- swaps, skips, added exercises, stopped exercises, and major load reductions can capture user reason when useful
- reason capture distinguishes pain, equipment issue, time pressure, preference, fatigue, target-muscle feel, and form breakdown
- post-workout review exposes target-too-high, target-too-low, recalibrated hold, and runtime-added coverage correctly
- weekly-retro exposes exercise-level load calibration evidence
- Program/Home/Analytics distinguish planned, skipped, and performed work
- Program keeps next action prominent while preserving full weekly volume detail behind progressive disclosure
- workout detail/log views distinguish current workout reality from original planned receipt truth
- rest timer supports execution quality without becoming persistence truth

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
- weekly targets are reviewed after the block to decide whether they behaved as useful coaching targets, stretch targets, or aspirational ceilings
- target ranges, priority tiers, or next-block seed volume changes are considered between mesocycles, not by mutating an active accepted seed
- old repair-shaped prescribed plans are not treated as performed truth

## 12. What Not To Do

- Do not let diagnostics become behavior.
- Do not copy repaired projection as target policy.
- Do not make the materializer a second planner.
- Do not let runtime consume planner metadata.
- Do not let runtime edits mutate canonical seed.
- Do not reorder seeded exercises in runtime preview/generation unless the ordering policy is explicit, intentional, and surfaced.
- Do not infer seeded runtime order from `mainLifts` / `accessories` array position.
- Do not treat target loads as exact truth when confidence is low.
- Do not present a main-lift rep aim as an exact hypertrophy requirement when a true rep range exists.
- Do not increase load into an easier RIR target when prior reps/effort contradict it.
- Do not frame an increase from a reduced performed anchor as a clean progression win when the written target was materially missed.
- Do not hide target recalibration just because the base action or next action is hold.
- Do not treat "user feels good" as sufficient reason to add volume without checking weekly need, fatigue cost, and upcoming overlap.
- Do not let runtime-added sets inflate planned-set adherence.
- Do not force every Week 3/Week 4 target with high-fatigue work.
- Do not treat a weekly target as a must-hit quota when the muscle is already at or above MEV.
- Do not chase targets near MAV as default coaching requirements; treat them as stretch or upper-bound targets unless recovery and session fit are strong.
- Do not block week rollover or deload transition because many muscles are below target, then offer a broad make-up workout; that turns target semantics into lifecycle friction and risks extra fatigue at the worst time.
- Do not mutate accepted seed during an active mesocycle just to close target gaps.
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
- Do not turn Program into an audit dashboard by default.
- Do not remove useful weekly-volume review from Program entirely; use progressive disclosure instead.
- Do not add a visible elapsed workout timer by default.
- Do not let rest timer state become plan truth or training evidence without a separate contract.
- Do not count warmup sets as hypertrophy working volume.
- Do not let optional core work crowd out primary/support hypertrophy targets.
- Do not mix warmup execution guidance into accepted seed working-set truth without an explicit contract.
- Do not keep adding historical adaptation before base planner quality.
- Do not overfit to Aaron's two historical mesocycles.
- Do not make rigid policies without training justification.
- Do not bloat executable seed truth.
- Do not allow old factory logic to re-author a clean V2 plan.
- Do not claim V2 is live default until production actually uses it as the supported default author.
- Do not claim `laneSelectionIntent` changes production exercise selection outside the guarded Stage C materializer lanes.
- Do not feed `V2LaneSelectionIntentAudit` or `laneSelectionIntent v0` into materializer ranking outside the guarded Stage C consumption path.
- Do not claim repair has been demoted while production projection still depends on repair for normal shape.
- Do not claim historical personalization is implemented while it remains diagnostic or roadmap work.
- Do not delete safety repair paths before V2 owns the responsibility they currently protect.

## 13. Immediate Next Strategic Step: Benchmark V2 Candidate Quality Before Repair Deprecation

The next question:

```txt
Does the V2 candidate itself satisfy first-principles plan quality well enough
to classify legacy repair paths as safety nets, obsolete readouts, or still
unproven leftovers without changing seed/runtime truth?
```

Current near-term roadmap:

1. Evaluate `plannerOnlyNoRepair.v2PlanQualityBenchmark` first. Its gates are support floors, direct work, lane preservation, session size, fatigue distribution, duplicate/concentration risk, materializer omissions, and Week 1 trainability. For support floors, direct work, lane preservation, session size, and duplicate/concentration risk, read-only pure V2 base-plan evidence is the candidate-quality source when present; legacy no-repair projection remains fallback evidence about the old path. Session-size warnings should reflect pure slot-shape risk, while duplicate/concentration warnings should name exact reuse as a watch item unless regression evidence exists. Class-family-only reuse can be explicitly bounded when exact duplicate reuse is zero and base-plan regressions are zero. For concentration materializer trials, read `concentrationReadinessDecision`, `donorOffsetRedistributionProjection.summary`, and `slotWeekAllocationProjection.summary` before proposing policy: a single positive warning delta is not enough; representative Weeks 2-4 materializer rows, donor-offset redistribution, donor absorption, protected coverage, acceptance/non-regression, and seed/runtime/receipt/DB non-consumption decide whether the next move is bounded design, blocker investigation, diagnostic-only measurement, or pivot. The 2026-06-13 live slot/week allocation policy trial proved exact donor absorption before materialization: Calves Weeks 2-4 move `lower_a:calves` 4 to 3 and `lower_b:calves` 4 to 5 with zero net weekly delta, preserved protected coverage, no materializer regression, and no over/under-absorption rows. That bounded redistribution is now implemented in pure `SlotDemandAllocationByWeek`, after base per-week slot exposure allocation and before class/set/capacity/selection planning. The first-principles design rule remains explicit: `SlotDemandAllocationByWeek` may relieve concentration pressure only when a same-muscle slot-owned donor measurably absorbs the required protected set without net weekly volume loss, protected coverage regression, materializer regression, or seed/runtime consumption. The current post-change readout remains `slotWeekAllocationReadiness=candidate_for_acceptance_projection`, `blockedRows=0`, `slotWeekAllocationNextSafeSlice=run_acceptance_non_regression_projection`, and `slotWeekAllocationAcceptanceProjection.decision=accepted_with_watch_items` with benchmark `pass=4 warn=4 fail=0 missing=0`. Current watch classification is `accepted=6 boundedOwner=2 ownerFix=0 staleNoise=1 blockers=0`. The stale standalone `base-plan-validation.test.ts` fixture has been reconciled to the current clean V2 base shape (`64` sets, `20` exercises, no optional triceps materialization), so it is not cleanup. Remaining concentration rows after this slice are readout/materializer cleanup unless a new measured owner-specific gate proves otherwise.
   - Implemented bounded slice: promote only this Calves redistribution in pure `SlotDemandAllocationByWeek`, after base per-week slot exposure allocation and before class/set/capacity/selection planning. The policy is explicit, not generalized concentration relief: accumulation Weeks 2-4, `lower_a:calves` source drops from 4 to 3, `lower_b:calves` donor rises from 4 to 5, same muscle/lane only, slot-owned donor required, and net weekly Calves sets remain unchanged. The production helper is small enough to delete as rollback and does not read audit diagnostics, repaired projection, materializer lane IDs, acceptedPlannerIntent, seed JSON, receipts, runtime state, UI, or DB.
   - Promotion gates: all bounded readiness evidence must still pass immediately before and after implementation: donor `+1`, source `-1`, `netWeeklySetDelta=0`, protected coverage preserved, materializer identity/set/blocker non-regression, exact duplicate count clean, `mustFixW1=0`, benchmark `pass=4 warn=4 fail=0 missing=0`, watch classification `accepted=6 boundedOwner=2 ownerFix=0 staleNoise=1 blockers=0`, and seed/runtime/receipt/DB/materializer production non-consumption. Failure of any gate is a final blocker for the code slice and requires returning to read-only diagnostics.
   - Verification and rollout: run focused pure V2 slot allocation tests, downstream class/set/materializer/benchmark tests, the V2 architecture-boundary non-consumption test, `npx tsc --noEmit`, `npm run verify`, and the read-only live mesocycle-explain audit with `--planner-only-no-repair --compare-repaired --no-artifact`. Roll out as a single bounded code review with no DB writes, migrations, reseeds, repair/backfill, acceptance-threshold edits, seed-shape edits, runtime replay edits, or production materializer diagnostic consumption. Roll back by deleting the bounded Calves policy helper/config and returning to the prior balanced Calves 4/4 allocation.
2. Treat missing benchmark evidence as missing, not as pass-by-absence. Do not use repaired projection as target policy.
3. Read `repairPromotionScoreboard.interpretation.repairDeprecationReadiness` after the benchmark. Its roles are `safety_net`, `plan_authoring_leftover`, `obsolete_no_impact`, and `still_unproven`.
4. Keep `safety_net` paths until the V2 owner seam proves equivalent safety/non-regression.
5. Treat `obsolete_no_impact` as ready for deprecation review only, not removal. Removal still requires non-regression proof and a separate explicit cleanup slice.
6. Treat `plan_authoring_leftover` as evidence that some repair responsibility may belong upstream, but promote behavior only through the rightful pure V2 owner seam with measured projection proof.
7. Treat `still_unproven` as blocked until the named benchmark gate, materializer, cross-week, acceptance, and seed/runtime non-consumption evidence exists.
8. Re-run mesocycle-explain and acceptance-style diagnostics after any future behavior trial, then prove seed/runtime invariants remained unchanged.
9. Keep V2 default-author promotion as a later gate after V2-authored output passes plan-quality, materialization-quality, integration, and runtime-readiness checks.

### Future Architecture Tracks For Engine Intelligence

The planner/materializer stack should not merely generate valid workouts. It should create elite, explainable, recoverable, progression-friendly mesocycles from first principles, then let runtime execute and learn without silently re-authoring the accepted seed.

Durable target flow:

```txt
Completed block evidence
-> Strategy
-> Demand / volume model
-> Slot + lane intent
-> Set distribution
-> Materializer
-> Candidate evaluator
-> Acceptance gate
-> Minimal accepted seed
-> Runtime execution
-> Performed reality
-> Review / learning loop
```

Every layer owns the right decision:

```txt
Strategy decides why.
Demand decides how much.
Slot/lane planner decides where.
Set distribution decides how many sets.
Materializer decides which exercise.
Candidate evaluator judges quality.
Acceptance gate decides accept/reject/watch.
Runtime executes today.
Review learns for the next block.
```

Architecture design/refinement can happen before a full V2 mesocycle is completed. Production removal/promotion should wait for proof through V2 refresh, accept, post-accept verification, Week 1 runtime proof, and real training use.

Future engine intelligence tracks:

1. `laneSelectionIntent v0`: planner defines the lane's actual training job so materializer no longer guesses core meaning from broad taxonomy, names, or class aliases. Start with high-risk lanes: chest-biased press support, vertical pull anchor, hamstring curl, quad isolation, calf direct, side/rear delt direct, rows, and arms.
2. Candidate evaluator core: separate reusable candidate-quality computation from the acceptance-gate decision wrapper so dry-run, acceptance, post-accept verification, and audit readouts can share coherent quality logic where appropriate.
3. Exercise inventory / metadata quality system: treat inventory metadata as downstream engine input, not labels. Track movement pattern, class, weighted stimulus, directness, fatigue, stability, loadability, joint/axial stress, duplicate family, substitution family, and forbidden lanes.
4. Materializer ranking and capacity framework: rank by lane job, weighted stimulus, stimulus-to-fatigue, stability/loadability, capacity priority, duplicate policy, and variation policy. Capacity should be training-principled, not arbitrary lane dropping.
5. Demand model as floor / productive / stretch / cap ranges: keep moving away from single target-as-quota. Planner, runtime coaching, analytics, and acceptance should reason in zones.
6. Prior-block evidence learning loop: use performed reality, not repair-shaped prescribed plans. Evidence includes missed MEV, repeated add-ons, swaps, pain/tolerance, load calibration, fatigue, adherence, and progression.
7. Prescription confidence / Week 1 trainability: a good seed is not enough; Week 1 prescriptions must be coherent, trainable, and confidence-labeled. Low-confidence prescriptions should be surfaced, not hidden.
8. Variation / continuity policy: preserve anchors when continuity helps progression, vary accessories when clean alternatives improve stimulus, joint tolerance, or monotony, and do not chase novelty for its own sake.
9. Swap equivalence engine: swaps must preserve lane job, not just primary muscle. Movement, directness, fatigue, loadability, and collision context matter.
10. Runtime coaching loop: runtime stays seed-inert but becomes execution-smart through load adjustments, rest, set-level coaching, skips, swaps, session-local add-ons, and pain/fatigue responses.

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
