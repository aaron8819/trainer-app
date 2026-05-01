# Hypertrophy Mesocycle Engine Strategy

Owner: Aaron
Last reviewed: 2026-05-01
Purpose: Define the strategic direction for the V2 hypertrophy planner migration: V2 becomes the future plan author, accepted seed remains minimal executable truth, runtime replay remains stable, and performed reality informs future blocks without silently mutating the current one.

This document is a strategy and migration map, not a claim about current runtime behavior. Current runtime truth remains the code, contract tests, and audit artifacts. The current mapping is grounded in the same live audit evidence previously used for this target doc:

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

V2 is the future plan author. Runtime is the plan executor. That distinction matters because the current production projection path still creates too much normal plan shape through downstream repair and cleanup. Repair can protect the app from impossible, unsafe, or legacy cases; it should not be where the ordinary mesocycle is designed.

Success means:

- A supported user can accept a V2-authored mesocycle whose plan quality is strong before repair.
- The accepted seed remains minimal and deterministic.
- Runtime replay does not become V2-aware.
- User edits stay session-local unless an explicit reseed or replacement path is chosen.
- Logs capture what actually happened.
- Review turns performed reality into future planning evidence.
- Repair drops from normal plan author to bounded safety net.

## 2. North-Star Operating Model

Target loop:

```txt
Training principles + user context
-> V2 planner authors mesocycle intent
-> materializer selects exercises
-> accepted seed stores executable truth
-> runtime executes seed
-> user edits are session-local
-> logs capture performed reality
-> mesocycle review informs future strategy
```

Operating roles:

- Planner = intelligence. It decides the block objective, muscle priorities, movement/class obligations, weekly progression, support floors, continuity stance, and set distribution before exact exercise selection.
- Materializer = exercise choice. It turns planner intent into concrete exercise identities using inventory, class fit, fatigue, continuity, tolerance, and deterministic tie-breaking.
- Seed = contract. It stores the accepted executable plan in the smallest runtime-consumable shape.
- Runtime = execution. Runtime replay should remain boring.
- Logs = reality. Logs record performed sets, skipped work, swaps, pain/tolerance, load, reps, RPE/RIR, adherence, and session duration.
- Review = learning. Review summarizes what worked, what failed, and what should influence the next plan.
- Repair = safety net. Repair is safety net, not program author.

The central source-of-truth boundary is unchanged:

```txt
slotPlanSeedJson.slots[].exercises[{ exerciseId, role, setCount }]
```

Planner metadata is explanatory, not executable. `acceptedPlannerIntent`, provenance, diagnostics, materializer blockers, materializer omissions, lane ids, promotion-readiness evidence, and audit readouts may explain why a plan exists. Runtime must not consume them as a second plan.

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

### Principle 6 - Performed Reality Informs Future Blocks

The learning loop should use what the user actually performed, not old prescribed repair-shaped plans. Performed sets, adherence, fatigue, tolerance, progression, stalls, swaps, pain, and deload execution should become next-block evidence.

That learning should improve the next `MesocycleStrategy`. It should not silently mutate the current accepted seed.

### Principle 7 - Policies Should Be Evidence-Aligned, Not Rigid

Planner policy should be grounded in hypertrophy principles and allow justified exceptions. Avoid arbitrary always/never rules.

Examples: no default 5-set stacking is a quality guard, not a universal law. Duplicate exercises can be justified by productive continuity, inventory limits, specialization, or lack of clean alternatives, but the reason must be explicit.

## 4. Current Migration Position

Current runtime seed replay is valuable and should be preserved. Accepted seeded supported mesocycles already replay deterministic exercise identities and set counts from `slotPlanSeedJson`; the execution layer is not the problem.

Current infrastructure worth preserving:

- `getWeeklyVolumeTarget()` and block-aware lifecycle math for weekly targets and RIR progression
- `slotSequenceJson` and authored `upper_a`, `lower_a`, `upper_b`, `lower_b` slot identity
- `slotPlanSeedJson` deterministic seeded runtime replay
- `planningReality` read-only diagnostics for demand, slot allocation, class alignment, set distribution, duplicate justification, and repair materiality
- audit harnesses that separate promotion candidates from suspicious repairs that must not become policy

Current production projection remains mostly repair-shaped. The audit evidence still reports `mostly_repair_shaped`, material repairs, major repairs, and likely upstream-avoidable repairs. Production projection still does not consume V2 as the authoritative plan author, and repair remains too involved in normal plan shaping.

Current repair-shaped symptoms to keep visible:

- support-floor closure still creates basic support work late
- weekly obligation closure still protects ordinary floors downstream
- late set bumping can create concentration that later needs cleanup
- cap trim still removes overbuilt shape after the fact
- program-quality and duplicate cleanup can change identity after selection
- dirty collateral cleanup can hide that the planner did not own clean class lanes early enough

V2 base planner progress is real:

- static balanced base demand
- explicit slot exposure ownership
- ownership-driven class lanes
- role-sensitive set distribution
- materialized dry-run base plan
- base-plan validation pass
- shadow-consumption compare showing strong diagnostic evidence

What that means strategically:

- V2 can describe a cleaner target than the production repaired projection.
- The pure planner stack is starting to own shape before repair.
- The materializer can produce seed-shaped previews in dry-run.
- The shadow-consumption compare is promising evidence that downstream machinery can be audited against a cleaner V2 base plan.

What it does not mean:

- V2 is not live default.
- Historical personalization is not implemented as production strategy.
- Production acceptance does not yet use V2 as the authoritative plan author.
- Repair has not yet been demoted.
- A clean dry-run does not prove the full factory line will preserve the plan.

The current risk is downstream factory machinery re-authoring or worsening a clean V2 plan. The next strategic focus is the V2 accepted-seed consumption seam and factory-line responsibility audit.

## 5. The Planner Stack

Target hierarchy:

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

Strategic purpose: convert stimulus needs into movement and class lanes before exact exercise identity. Good looks like explicit requirements such as hinge plus knee-flexion curl, distinct upper Chest classes, direct side-delt support, and calf isolation distribution.

Current status: `exerciseClassDistributionBySlot`, selection-v2 helpers, and the V2 taxonomy bridge expose much of this shape. Do not let exact exercise selection pretend to solve class strategy by accident.

### Weekly Progression Model

Strategic purpose: spread the block across entry, accumulation, peak, and deload weeks. Good looks like Weeks 1-4 projected deliberately and Week 5 deload preserving identity while reducing volume and effort.

Current status: weekly targets and RIR progression exist, and V2 has planner-owned accumulation and deload diagnostics. Later weeks remain limited until selection, accepted seed, and runtime replay consume the model safely.

### Slot Architecture

Strategic purpose: allocate weekly demand to `upper_a`, `lower_a`, `upper_b`, and `lower_b` before exercise selection. Good looks like slot-owned obligations and forbidden-slot rules that prevent lower-slot Chest rescue or upper-slot lower-body collateral.

Current status: slot sequencing and authored slot semantics are valuable infrastructure. Do not let compatible-slot averaging or repair closure become the real slot allocation policy.

### Exercise Selection Strategy

Strategic purpose: choose exact exercises that satisfy class lanes and set budgets while balancing continuity, variation, tolerance, equipment, fatigue, and inventory. Good looks like productive anchors preserved, stale/painful/stalled accessories rotated, and duplicate decisions justified.

Current status: selection-v2, materializer dry-run, continuity hints, and audit diagnostics are useful but not yet authoritative production selection from V2 strategy. Do not make repaired projection the target exercise policy.

### Set / Rep / RIR Prescription

Strategic purpose: define set spread, concentration limits, rep/RIR intent, direct support floors, per-exercise caps, and at-limit behavior before selection. Good looks like role-sensitive set distribution, sane session size, no default 5-set stacking, and no single exercise silently owning too much weekly stimulus.

Current status: V2 set-distribution intent has moved the base plan away from flat four-set lanes. Do not let late set bumping or cap trim create ordinary set policy.

### Runtime Adjustment Rules

Strategic purpose: define what runtime may adapt locally without redesigning the mesocycle. Good looks like practical user flexibility with receipts that explain deviations.

Current status: runtime and reseed seams already support the direction. Do not move planner intelligence into runtime.

### Post-Mesocycle Learning Loop

Strategic purpose: turn performed reality into next-block strategy evidence. Good looks like review summaries that can recommend volume hold/increase/reduction, specialization, recovery bias, exercise continuity, rotation, or fatigue-management changes.

Current status: `MesocycleReview`, handoff summaries, strategy-input adapters, and audit diagnostics have pieces of the loop. Do not use old repaired prescribed plans as the training signal.

### Accepted Seed

Strategic purpose: persist the executable plan plus compact runtime-inert provenance. Good looks like seed truth that runtime can replay without selection or repair.

Current status: accepted seed infrastructure is valuable. Do not bloat executable seed truth with planner diagnostics.

### Runtime Replay

Strategic purpose: execute the accepted plan deterministically and log what happened. Good looks like stable replay from `slotSequenceJson` and `slotPlanSeedJson`, with session-local deviations recorded as performed reality.

Current status: keep current runtime. Do not replace it.

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
-> exercise selection/materialization
-> full V2 base-plan validation
-> shadow consumption compare
-> only later production consumption
```

Plain-English meaning:

- Balanced base demand defines reasonable default muscle targets before slot and exercise choice.
- Slot exposure ownership decides which slots are responsible for which muscles.
- Exercise class ownership decides which movement classes should deliver the stimulus.
- Set distribution ownership decides how many sets each lane should carry before any late bump or trim.
- Exercise selection/materialization turns lane intent into actual exercise identities in dry-run.
- Base-plan validation checks whether the materialized base plan is internally clean.
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

## 7. Factory-Line Strategy

The downstream production factory contains valuable infrastructure and old repair-shaped assumptions. The migration should audit responsibility before wiring V2 into production.

The factory should transport, validate, persist, and explain V2 plans. It should not re-author them.

### Keep As Infrastructure

These layers are useful and should be preserved:

- owner resolution
- lifecycle state
- slot sequencing
- seed serializer/parser
- acceptance transaction
- runtime replay
- receipt/provenance infrastructure
- audit harness

### Constrain / Redesign

These layers may be necessary, but their responsibilities need tightening so they do not overwrite V2:

- handoff preparation
- projection transport/preview
- acceptance gates
- metadata/provenance
- debug readouts

The question for each is: does it carry and validate V2 intent, or does it quietly re-author shape?

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

Do not remove safety infrastructure early. First prove that V2 owns the plan, the factory preserves it, runtime replays it, and repair materiality drops.

## 8. Historical Personalization Roadmap Boundary

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

## 9. Migration Strategy

1. Establish clean V2 static base plan.

   Current status: mostly achieved in pure dry-run. Static balanced demand, slot ownership, class ownership, role-sensitive set distribution, materialized dry-run, and base-plan validation provide strong first-slice evidence.

2. Validate V2 base plan against no-repair/repaired production output.

   Current status: shadow compare is promising. Repaired projection remains evidence only, not target policy.

3. Audit factory-line responsibilities and define V2 consumption seam.

   Current next priority. The key risk is that legacy projection/repair machinery re-authors or worsens a clean V2 materialized base plan before acceptance.

4. Add guarded shadow/disabled consumption path.

   No production writes. The path should prove transport, validation, provenance, and serializer compatibility while reporting exactly where consumption would fail.

5. Add bounded behavior trial.

   Only after gates prove safe. Start with the smallest slice that has clear owner, measurable quality improvement, non-regression checks, and rollback criteria.

6. Promote V2 as default author for supported cases.

   Only after V2-authored output passes plan-quality and integration gates. Runtime replay remains unchanged; repair becomes safety net for supported cases.

7. Demote/quarantine obsolete repair-as-planner machinery.

   Do this after V2 ownership is proven. Keep true safety, legacy fallback, impossible-plan handling, and forbidden-slot protection.

8. Add historical personalization / mesocycle-to-mesocycle adaptation.

   Add this after the default V2 planner is strong and the learning loop can consume performed reality without using old repaired prescribed plans as target policy.

## 10. Decision Criteria / Acceptance Criteria

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

### Integration Gate

- V2 can pass through acceptance without being re-authored
- seed serializer remains canonical
- runtime replay unchanged
- `slotPlanSeedJson.slots[].exercises[{ exerciseId, role, setCount }]` remains executable truth
- `acceptedPlannerIntent` and provenance remain explanatory
- V2 blocked opt-in fails closed and is not labeled V2 success
- no production write occurs from diagnostic-only materializer output
- provenance distinguishes preparation, transaction persistence, and runtime replay evidence

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

## 11. What Not To Do

- Do not let diagnostics become behavior.
- Do not copy repaired projection as target policy.
- Do not let runtime consume planner metadata.
- Do not keep adding historical adaptation before base planner quality.
- Do not overfit to Aaron's two historical mesocycles.
- Do not make rigid policies without training justification.
- Do not bloat executable seed truth.
- Do not allow old factory logic to re-author a clean V2 plan.
- Do not claim V2 is live default until production actually uses it as the supported default author.
- Do not claim repair has been demoted while production projection still depends on repair for normal shape.
- Do not claim historical personalization is implemented while it remains diagnostic or roadmap work.
- Do not delete safety repair paths before V2 owns the responsibility they currently protect.

## 12. Immediate Next Strategic Step

Focused V2 accepted-seed consumption seam / factory-line audit.

The next question:

```txt
How can a V2 materialized base plan become accepted seed truth without being re-authored or worsened by legacy projection/repair machinery?
```

That audit should answer:

- Which downstream steps are pure transport, validation, persistence, or explanation?
- Which steps still assume projection or repair owns normal plan shape?
- Where does the plan risk being mutated, repaired, trimmed, cleaned up, or reselected?
- What exact seam should consume a V2 materialized base plan in disabled/shadow mode first?
- What gates prove the factory preserved the plan before any production write?
- What provenance should distinguish V2 disabled, V2 blocked fail-closed, V2 materialized seed, and legacy projection seed?
- What tests or audit artifacts prove runtime replay remains unchanged?

Guardrails for that next slice:

- no generation behavior change
- no selection behavior change
- no repair behavior change
- no seed shape change
- no runtime replay change
- no receipt behavior change
- no V2 live default claim
- repaired projection used only as evidence
