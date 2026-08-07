# Planning and Execution Foundation Design

- Status: proposed target architecture; not current runtime behavior
- Decision date: 2026-08-07
- Evidence baseline: `4b39dfcf88316fbf4f26760f51fcfca12c1adbab`
- Scope: plan meaning, exercise ontology, execution measurement, continuity, history, and Plan Health
- Non-scope: implementation, schema migration, data repair, production mutation, and automatic plan recommendation

## Executive summary

Trainer should represent accepted plan meaning as an immutable **plan specification revision** whose semantic payload is independent of how it was authored. Authoring source and derivation belong to revision provenance, not to the semantic payload or its content hash. The specification owns goal, ranked priorities, schedule, ordered session layers, exercise placements, placement prominence, progression intent, and continuity. Every field that can change materialization must compile into a versioned `MesocycleSeedRevision` runtime contract before that plan can activate; runtime continues to execute only the accepted seed. This preserves the strongest current boundary instead of introducing a second executable truth.

Execution should use versioned **measurement profiles**. A materialized `WorkoutExercise` snapshots the profile that defines what a set means; prescriptions and performed results use typed, discriminated payloads for reps, duration, distance, steps, external load, bodyweight, assistance, bands, laterality, and equipment context. History compares records only when those snapshots are compatible. It must not reinterpret an old set through today's exercise catalog.

The central model is:

```text
authoring provenance
      │ creates a candidate
      ▼
Plan container (current `MacroCycle`) ── PlanSpecificationRevision
                       │ accepted and compiled
                       ▼
               MesocycleSeedRevision
                       │ exact revision materialized
                       ▼
         Workout + WorkoutExercise snapshots
                       │ performed
                       ▼
            SetLog + review snapshots

diagnostics, audits, and previews observe these boundaries;
they do not become executable truth unless an explicit acceptance seam promotes them.
```

This design keeps accepted seed authority, exact workout provenance, performed logs, session-decision receipts, runtime-edit ledgers, stimulus snapshots, stable exercise IDs, and immutable review evidence. It replaces overloaded plan types, inferred “custom” semantics, name-keyed stimulus policy, coarse exercise identities that mix incomparable implementations, and the universal reps/load set shape for future writes. It does not require new `TrainingPlan` and `PlanRun` tables in the first version: the current `MacroCycle` can host the stable plan identity and scheduled run until repeated runs of one plan become a real product need.

The recommended first implementation slice is a read-only specification/compiler proof over the existing custom-plan path. It introduces no persistence and freezes no public `PlanSpecificationV1`; it proves canonical serialization, deterministic executable projection, and runtime isolation before catalog and measurement decisions are locked into a durable schema.

### Independent review decisions incorporated

- Defer separate `TrainingPlan` and `PlanRun` persistence; use `MacroCycle` as the V1 plan container/run host.
- Move authoring source out of semantic plan content and into revision provenance.
- Reject the five-role taxonomy; use three placement-prominence roles with separate continuity, progression, and catalog facts.
- Scope placement identity to one plan, give copies new IDs with derivation links, and defer durable cross-revision lineage until block review.
- Treat physical machine/gym identity as snapshotted execution context, not a reason to create one exercise row per machine.
- Require every runtime-affecting semantic field to compile into a versioned accepted seed contract before activation; the current seed shape cannot truthfully carry layers, measurement, or progression.
- Replace persisted V1 as the first slice with a read-only compiler/preview proof over the existing custom draft.
- Correct the current-state immutability claim: seed revisions and post-session review snapshots have database guards; terminal workout rewrites are application-fenced rather than universally database-immutable.

## 1. Problem statement

Trainer has reliable execution provenance but no single durable owner for plan meaning.

Today:

- `PrimaryGoal`, supported `planType`, authoring source, lifecycle behavior, and planner implementation overlap.
- “Custom” is inferred from the presence or source of a hypertrophy draft rather than modeled independently.
- `HypertrophyPlanDraftV1` owns only sessions, exercise IDs, working sets, and a small intent vocabulary.
- accepted custom intent is richer than the executable seed, but the accepted seed is intentionally the runtime authority.
- exercise properties live across JSON seed data, relational rows, name-keyed TypeScript stimulus policy, pure muscle policy, materializer classification, and historical snapshots.
- a single exercise identity can span multiple equipment or resistance implementations whose loads are not comparable.
- `WorkoutSet` and `SetLog` assume reps plus one undifferentiated numeric load, even when the work is duration, distance, steps, assistance, bodyweight, per-hand load, per-side load, or a machine display.
- history decides comparability partly from the current exercise catalog, allowing catalog changes to reinterpret old performance.
- current Plan Health has useful deterministic checks, but priorities, layers, continuity, measurement validity, and evidence confidence are not first-class.

The next-plan requirements—lower-body emphasis, squat strength, upper-back/scapular retraction, core, biceps, stable anchors, explicit progression, preparation, optional closeout, mixed equipment, and trustworthy history—cannot be represented faithfully by adding more values to the existing draft JSON or more booleans to `Exercise`.

## 2. Evidence and current ownership

This design is grounded in current code, schema, tests, and historical audit artifacts. North-star documents inform direction but are not treated as implemented behavior.

| Concern | Current evidence | Finding |
| --- | --- | --- |
| Accepted executable truth | `prisma/schema.prisma`, `src/lib/api/mesocycle-seed-revision.ts`, `src/lib/api/next-session.ts` | An immutable current `MesocycleSeedRevision.seedPayload` is authoritative when present; `slotPlanSeedJson` is compatibility data. |
| Custom plan authoring | `src/lib/engine/hypertrophy-plan-authoring.ts`, `src/lib/api/hypertrophy-plan-drafts.ts` | The draft and accepted custom payload carry session and placement intent, then compile to exercise ID, executable role, and set count. |
| Plan creation | `src/lib/api/plan-management.ts`, `src/lib/plan-types.ts` | Hypertrophy and strength creation are separate paths; plan type and primary goal are coupled. |
| Exercise catalog | `prisma/exercises_comprehensive.json`, `prisma/seed.ts`, `prisma/schema.prisma` | JSON seeds relational catalog data, but it does not define measurement semantics or all execution-distinct variants. |
| Stimulus policy | `src/lib/engine/stimulus.ts`, `src/lib/api/hypertrophy-plan-drafts.ts` | Explicit name-keyed profiles and the draft's primary/secondary fallback use different contribution weights. |
| Historical stimulus | `src/lib/stimulus-accounting/snapshot.ts` | Materialized workout exercises already freeze a versioned stimulus policy; this is the correct historical pattern. |
| Performance entry | `src/components/log-workout/WorkoutActiveSetCard.tsx`, `src/lib/validation.ts` | The UI and API accept reps, load, and RPE only; load is quantized to 2.5 lb. |
| Load meaning | `src/lib/ui/load-display.ts`, `src/lib/api/exercise-history.ts` | Dumbbell loads are displayed per implement, bodyweight suppresses load, and other equipment is generic; history reads current catalog equipment. |
| Session provenance | `src/lib/evidence/types.ts`, `src/lib/ui/selection-metadata.ts`, `src/lib/api/runtime-exercise-swap-service.ts` | The original receipt/audit evidence and append-only replacement facts preserve prescribed identity while the mutable `WorkoutExercise.exerciseId` records the current/performed exercise. The workout row itself is not a database-immutable prescription snapshot. |
| Plan Health | `src/lib/engine/hypertrophy-plan-authoring.ts`, `docs/02_DOMAIN_ENGINE.md` | Deterministic blockers and warnings exist for structure, availability, constraints, coverage, volume, frequency, redundancy, and duration. |
| Repository history | `a1d79e50`, `dd645da4`, `3f5232a8`, `ea8cca54`, `e191102a`, `90512cef`, `f70cf309`, `4b39dfcf` | Repeated fixes established name-keyed stimulus fragility, catalog expansion pressure, ID-based performed history, frozen stimulus snapshots, immutable accepted seeds, session-local swap ledgers, the current custom-plan boundary, and shared semantic eligibility for custom authoring/runtime swaps. These commits support the concrete seams in this document; they do not by themselves prove every proposed ontology. |

The current inventory contains useful movements, including barbell squat, hack squat, leg press, Romanian deadlift, walking lunge, Bulgarian split squat, pull-up variants, chest-supported and cable rows, reverse pec deck, face pull, hip machines, Copenhagen plank, ab wheel, Pallof press, machine/cable crunch, dead hang, dumbbell/machine presses, and sled work. Its representational limits are visible in the data:

- Romanian deadlift and Pallof press each span more than one equipment implementation under one ID.
- bodyweight, weighted pull-up, and potential assisted pull-up are not modeled as one family with distinct trackable executions.
- selectorized and plate-loaded machines have no load-basis or physical-machine identity.
- walking lunges and unilateral work have no stored per-side versus total convention.
- dead hangs and Copenhagen planks inherit rep ranges despite being duration work.
- sled work inherits reps despite being naturally measured by distance, load, and optionally time.
- band resistance cannot be represented honestly by a generic pound value.
- there is no explicit assisted pull-up, hip-flexor exercise, or band pull-apart identity; nearby movements do not supply those missing semantics.

### 2.1 Current end-to-end map

| Area | Current representation and flow | Architectural consequence |
| --- | --- | --- |
| Plan semantics | `src/lib/plan-types.ts` supports hypertrophy and strength plan types and couples them to `PrimaryGoal`. `createPlan` branches to separate hypertrophy and strength builders. A custom hypertrophy plan is identified by a draft/accepted-seed source. | Goal, generator, source, and lifecycle policy are not independent. There is no durable generic semantic plan revision. |
| Structure and lifecycle | `MacroCycle` contains goal and schedule dates; `Mesocycle` contains focus, split, sessions, days, blocks, compatibility seed JSON, and the current accepted seed pointer. Lifecycle is derived from mesocycle state, activation is separate, and the active plan cannot be archived. | Transaction and safety behavior are sound, but the hierarchy conflates plan lineage, accepted version, and scheduled run. |
| Progression and deload | Strength generation has a policy path; hypertrophy generation/materialization supplies prescription and current progression logic adjusts reps/load/RPE. Custom acceptance currently creates a five-week mesocycle with four accumulation weeks plus one deload week. | Progression is not a first-class plan dimension, and future work types cannot use the numeric progression path honestly. |
| Templates and generation | `WorkoutTemplate` is a session template, not a plan template. Generated hypertrophy, generated strength, and user-authored hypertrophy use different creation routes. `TemplateIntent.CUSTOM` is another unrelated use of “custom.” | Template, generated, and user-authored are operational sources, not plan goals or types. |
| Draft and acceptance | `HypertrophyPlanDraftV1` stores settings, sessions, exercise IDs, working sets, and intent. Accepted V2 custom payload adds accepted targets/classes, then projects to exercise ID, `CORE_COMPOUND`/`ACCESSORY`, and set count. | The existing pure authoring/acceptance separation is valuable, but the payload is hypertrophy-specific and too small to own the target model. |
| Catalog | Comprehensive JSON seeds relational `Exercise`, muscle, equipment, and alias rows. Muscle policy lives in the engine. Stimulus policy is partly a TypeScript name registry and partly inferred from primary/secondary relations. | There are multiple competing semantic sources and name-coupled policy. |
| Materialization | Runtime overlays the current immutable seed payload where necessary, selects/prescribes, creates the workout and sets, and freezes stimulus accounting on each workout exercise. | The accepted-seed and snapshot pattern is sound and should be extended, not bypassed. Planned workouts remain editable with optimistic concurrency; terminal rewrites are application-fenced, while accepted seeds and post-session review snapshots have database immutability triggers. |
| Execution | Active workout UI records reps, load, and RPE. Dumbbell display means per implement; bodyweight commonly records zero/optional load; every actual load is quantized to 2.5 lb. Warm-ups and skips share the same numeric set shape. | The same fields mean different things across resistance models and cannot represent time, distance, steps, assistance, or bands. |
| Substitution | Runtime selection is algorithmic. A session swap changes the performed workout exercise and appends a replacement ledger while preserving the original decision receipt. The relational substitution-rule surface is inactive. | Prescribed versus performed identity is preserved well, but the replacement has no immutable measurement snapshot. |
| History and reporting | History is scoped to stable `Exercise.id` and calculates rep/load/RPE, estimated 1RM, heaviest load, and load×reps. It infers bodyweight/dumbbell meaning from today's catalog relation. | Stable-ID history fixed prior rename fragility, but current-catalog interpretation can still change old meaning and machine context is absent. |
| Plan Health | Custom authoring calculates direct/effective sets, frequency, coverage, redundancy, constraints, and duration, with blockers and warnings. | The deterministic approach is sound; facts need priorities, roles, layers, continuity, measurement validity, and confidence. |

### 2.2 Current execution semantics by case

| Case | Current behavior | Missing or ambiguous meaning |
| --- | --- | --- |
| Barbell | Generic load in pounds plus reps/RPE. | Whether bar is included is convention, not snapshotted. |
| Dumbbell | UI labels load as “each” when equipment inference selects dumbbell. | Mixed-equipment rows can defeat inference; laterality and implement count are absent. |
| Plate-loaded machine | Generic machine load. | Per-side versus total and machine identity are absent. |
| Selectorized machine | Generic machine load. | Stack units/configuration and physical machine identity are absent. |
| Bodyweight | Load may be absent/zero; history suppresses load-oriented records. | Bodyweight context and whether zero means unweighted are not explicit. |
| Assisted pull-up/dip | No dedicated assistance representation. | Assistance direction, method, and bodyweight are absent. |
| Weighted bodyweight | Separate exercise identities may exist, but the same load field carries added weight. | Added versus total-system load is not snapshotted. |
| Unilateral exercise | Integer reps and generic load. | Per-side versus total/alternating convention is absent. |
| Walking lunge | Rep-shaped set. | Reps, steps, distance, and side basis cannot be distinguished. |
| Duration/isometric | Rep-shaped set. | Seconds cannot be recorded canonically. |
| Distance or sled work | Rep-shaped set plus generic load. | Distance, surface/context, and load-plus-time are absent. |
| Resistance band | Generic equipment and numeric set shape. | Band descriptor, anchor/configuration, and non-pound resistance are absent. |
| Warm-up | A set with index zero and warm-up intent uses the same numeric fields. | Its layer/profile meaning is not explicit, though intent permits exclusion. |
| Skip | `wasSkipped` preserves skip truth. | The model still permits a numeric shape that is irrelevant to a skip. |
| Session swap | Executed exercise ID changes; original decision receipt and replacement ledger remain. | The replacement's measurement semantics are not frozen. |
| Effort | RPE is entered; UI derives RIR as `10 - RPE`. | Entered scale is not explicit; storing both independently would create conflict. |
| History/progression | Exact exercise ID plus reps/load/RPE; derived 1RM and load×reps; coarse equipment categories drive progression. | Compatibility, basis, context, and non-rep progression are not represented. |

### 2.3 Audit and consolidation status

Historical catalog work corrected concrete metadata and stimulus mappings, but repository history is uneven evidence for the full list of SFR, length-position, fatigue, compoundness, main-lift, timing, difficulty, and unilateral corrections. The directly verified durable changes are narrower: `a1d79e50` repaired canonical stimulus mappings; `dd645da4` expanded machine inventory and taxonomy tests; `3f5232a8` moved rotation/freshness to performed `Exercise.id` history; `ea8cca54` froze historical stimulus accounting; and `f70cf309`/`eb686c7c` established the custom-plan intent and accepted-seed path. `4b39dfcf` then consolidated custom authoring and runtime-swap eligibility around accepted exercise intent: required class, target, and compoundness are semantic constraints, while catalog `isMainLiftEligible` is not an independent veto for accepted custom Hypertrophy meaning.

Those efforts resolved individual metadata defects, ID-based history, and a known eligibility mismatch. They did not resolve the deeper fragmentation: stimulus still has competing sources, exercise identity still mixes equipment implementations, measurement meaning is not snapshotted, plan role is still partially encoded as global eligibility, and dormant variation/substitution models have no active workflow.

## 3. First-principles answers

### 3.1 What is a plan?

A plan is a durable lineage of accepted, immutable specifications for intended training. It is not a generator invocation, a runtime seed, a calendar instance, or a collection of completed workouts.

Each accepted revision describes:

- why the plan exists: primary goal and ranked priorities;
- what is scheduled: ordered session slots and phases;
- what each placement means: exercise, layer, role, target, progression, and continuity;
- how the work is prescribed: measurement profile and target ranges;
- how the revision relates to prior revisions: lineage and replacement decisions.

A mutable draft is an authoring workspace. An accepted revision is durable plan meaning. A run schedules an accepted revision. A seed is its executable compilation for a bounded mesocycle. A workout snapshot is the exact materialized prescription. A log is performed reality.

### 3.2 Is “custom” a plan type?

No. “Custom” is an authoring source and editing capability.

Plan dimensions must have separate owners. They are not freely combinable: acceptance validates goal, progression, measurement, schedule, and placement combinations together.

| Dimension | Initial values | Meaning |
| --- | --- | --- |
| Authoring provenance | `SYSTEM_GENERATED`, `SYSTEM_TEMPLATE`, `USER_AUTHORED` | How the candidate originated. Store this on revision metadata with derivation links, outside the canonical semantic payload/hash. A copied-and-edited plan is user-authored and retains derivation provenance. |
| Primary goal | `HYPERTROPHY`, `STRENGTH`, `GENERAL_FITNESS` | The dominant adaptation objective. Conditioning can be added when its programming and measurement semantics exist. |
| Ranked priorities | target + objective + rank | User-declared emphasis within the goal. |
| Progression policy | plan default plus placement override | How prescriptions change after evidence. |
| Schedule | ordered slots and optional weekdays | What repeats and in what order. |
| Lifecycle | `DRAFT`, `ACCEPTED`, `ACTIVE`, `COMPLETED`, `ARCHIVED` | State of a revision/run, not a property inferred from goal. |

`SplitType.CUSTOM` may remain a legacy display projection, but it must not drive authoring, acceptance, or runtime behavior.

### 3.3 Where do goals and priorities live?

Goal and priorities live in the accepted plan specification, not on exercises and not only on the macrocycle run.

Initial priority kinds:

- `LIFT_SKILL`: a stable trackable execution such as barbell back squat;
- `MUSCLE_OR_REGION`: a governed target such as quads, lower body, upper back, core, or biceps;
- `MOVEMENT_PATTERN`: an explicit canonical pattern when technique or coverage matters;
- `EMPHASIS`: a governed qualitative tag such as scapular retraction or rear-delt emphasis when current movement/muscle IDs do not express the intent.

Each priority has a unique rank, an objective (`MAINTAIN`, `DEVELOP`, `SPECIALIZE`), a stable target ID from a small governed registry, and optional user rationale. The initial registry must contain only targets needed by the next plan and mappings used by visible Plan Health rules. The application must not infer or silently reorder priorities.

Priorities influence construction through visible rules: allocation ranges, exposure targets, anchor selection, continuity expectations, and Plan Health checks. They do not feed an opaque optimization score.

### 3.4 How should plans be versioned?

Keep four concepts distinct, but do not require four new tables:

- plan container: stable user-owned display identity and revision collection; use the current `MacroCycle` in V1.
- `PlanSpecificationDraft`: mutable authoring workspace.
- `PlanSpecificationRevision`: immutable accepted semantic specification with a content hash and optional `derivedFromRevisionId`.
- plan run: scheduling and lifecycle instance that executes a revision; the current `MacroCycle` also owns this responsibility in V1.

The current `MacroCycle` conflates portions of stable plan identity, goal, scheduling, and run lifecycle, but that is not yet harmful enough to justify separate `TrainingPlan` and `PlanRun` persistence. In V1 it hosts the revision collection and run lifecycle while future semantic writes live only in `PlanSpecificationRevision`; existing `MacroCycle` semantic fields become legacy/read projections. Split the container from runs only when one accepted plan is actually executed more than once. Current `Mesocycle` remains the bounded execution container, `TrainingBlock` remains phase scheduling, and `MesocycleSeedRevision` remains accepted executable truth.

Editing an accepted plan creates a new draft and then a new revision. It never mutates an accepted revision or existing seed. During an active mesocycle, ordinary edits are session-local; a semantic revision activates only for a new mesocycle/block boundary unless a separately reviewed active-plan correction path proves that no already materialized workout is relabeled.

### 3.5 What should a planned exercise placement own?

A placement owns contextual meaning:

- stable placement ID within the plan lineage;
- exercise execution ID;
- session slot and order;
- layer;
- one placement-prominence role (`PRIMARY`, `SECONDARY`, or `ACCESSORY`);
- target or accepted exercise-class constraint;
- measurement profile selection;
- prescription and progression override;
- continuity expectation (`ANCHOR` or `FLEXIBLE`), separate from role;
- explicit relationship to relevant priorities;
- user-facing rationale or instructions.

The exercise catalog must not own these plan-specific decisions.

### 3.6 What is an exercise identity?

A user-visible `Exercise` is a stable, trackable execution identity. Records should be separate when resistance model, equipment implementation, load basis, or work metric makes performance materially incomparable. A physical machine or gym configuration is execution context snapshotted with the workout; it is not normally another exercise identity.

An `ExerciseFamily` groups related executions for intent, browsing, and substitution. Family membership does not make performance automatically comparable.

Examples:

| Family | Separate trackable exercise identities |
| --- | --- |
| Romanian deadlift | Barbell RDL; dumbbell RDL |
| Pull-up | Bodyweight pull-up; weighted pull-up; assisted pull-up |
| Pallof press | Cable Pallof press; band Pallof press |
| Chest-supported row | Dumbbell row; selectorized machine row; plate-loaded row |
| Press | Dumbbell press; selectorized machine press; plate-loaded press |

Minor cues, tempo, grip width, or stance notes can remain placement instructions when the user does not intend separate history. A variant that users select independently or whose results are not comparable receives its own stable exercise ID linked to the family.

IDs never change with a rename. Aliases preserve search. Retired exercises remain readable. Splitting a legacy identity creates new IDs; it does not reassign old records.

### 3.7 Which facts belong where?

| Owner | Examples |
| --- | --- |
| Catalog fact | family, movement patterns, compoundness, equipment/resistance implementation, laterality capability, permitted measurement profiles |
| Governed training policy | region relationships, emphasis tags, stimulus estimates and confidence, allowed layers, substitution class |
| Placement context | role, layer, priority relation, continuity, prescription, progression, rationale |
| Materialized snapshot | exact exercise identity, catalog-policy version, stimulus policy, measurement profile, prescription |
| Performed log | status, actual work, actual resistance, effort, notes, timestamp |

The current supported muscle IDs and region policy remain stable. Fine-grained emphasis should use honest tags such as `SCAPULAR_RETRACTION`, `REAR_DELT`, `QUAD_BIAS`, or `LENGTHENED_BICEPS`, with an evidence/confidence level. Trainer should not manufacture a precise rhomboid set count or fractional stabilizer score when the source data cannot support it.

The name-keyed stimulus registry and the custom-draft primary/secondary weighting must converge into one versioned catalog policy. Materialization snapshots that policy, preserving history when catalog policy changes.

### 3.8 What does a set measure?

A set is a prescribed or performed unit of work interpreted by a versioned measurement profile. It is not universally “reps plus pounds.”

Use a hybrid representation:

- indexed scalar `measurementProfileKey` for routing and queries;
- a versioned, validated JSON prescription on `WorkoutSet`;
- a versioned, validated JSON performance result on `SetLog`;
- an immutable measurement-profile snapshot on `WorkoutExercise`.

This is preferable to fixed columns because the combinations evolve, and preferable to an EAV metric table because the supported shapes are finite, typeable, and validated as a unit.

Conceptual envelope:

```ts
type Work =
  | { kind: "reps"; value: number; basis: "total" | "each_side" }
  | { kind: "duration"; value: number; unit: "seconds"; basis: "total" | "each_side" }
  | { kind: "distance"; value: number; unit: "meters" | "feet" }
  | { kind: "steps"; value: number; basis: "total" | "each_side" };

type Resistance =
  | { kind: "external_load"; value: number; unit: "lb" | "kg"; basis: ExternalLoadBasis }
  | { kind: "bodyweight"; bodyweight?: Mass }
  | { kind: "bodyweight_plus"; added: Mass; bodyweight?: Mass }
  | { kind: "assisted_bodyweight"; assistance: Mass; bodyweight?: Mass }
  | { kind: "band"; descriptor: string }
  | { kind: "none" };

type ExternalLoadBasis =
  | "external_total"
  | "per_implement"
  | "per_side"
  | "stack_displayed";
```

The profile also freezes laterality, units, optional equipment-context fingerprint, and the entered effort scale. Trainer can derive RIR from entered RPE for display, but must not store independently editable RPE and RIR as competing truths.

### 3.9 When is history comparable?

Numeric comparison requires:

1. the same trackable exercise identity, unless a reviewed compatibility rule explicitly permits otherwise;
2. compatible measurement profile and version;
3. the same work kind, basis, laterality, and normalized unit;
4. the same resistance kind and load basis;
5. a compatible equipment context when machine or band configuration affects the number.

History returns `EXACT`, `NORMALIZED`, or `NOT_COMPARABLE`, plus a reason. Exercise-family history can be shown for context but does not automatically drive progression.

Future history reads the materialized snapshot, never the current catalog row. A catalog rename, equipment edit, or policy update cannot reinterpret a completed set.

### 3.10 How should roles work?

The proposed five-role taxonomy is rejected because it mixes anchor continuity, exercise morphology, and placement prominence. A curl can be a stable hypertrophy anchor, and a compound can be support work, so those labels are not mutually exclusive.

Each programmed placement instead has one small prominence role:

- `PRIMARY`: a central session driver;
- `SECONDARY`: substantial supporting programmed work;
- `ACCESSORY`: lower-prominence local or support work.

`ANCHOR`/`FLEXIBLE` is a separate continuity field. Strength versus hypertrophy behavior comes from the priority link and progression policy. Compoundness, isolation, resistance model, and measurement capability are catalog facts. The same exercise can therefore serve different roles without forcing several meanings into one enum.

The current accepted intent vocabulary should be refined into this model. `PRIMARY` compiles to current `CORE_COMPOUND`; `SECONDARY` and `ACCESSORY` compile to current `ACCESSORY`. Acceptance must separately validate target, required exercise class, and compoundness. Catalog `isMainLiftEligible` remains legacy/general capability rather than accepted custom-plan meaning and cannot represent contextual eligibility by itself.

Avoid the label “corrective.” Trainer does not diagnose or prescribe clinical treatment.

### 3.11 How should session layers work?

Every loggable exercise placement belongs to one ordered layer:

- `PREPARATION`: ramp sets, mobility, activation, and rehearsal. Loggable and skippable; excluded from hard-set volume and progression by default.
- `PROGRAMMED_WORK`: required goal-directed work. Counts toward volume, Plan Health, and progression.
- `OPTIONAL_CLOSEOUT`: genuinely optional finishers, conditioning, or recovery. A session can complete without it; excluded from hard-set volume and progression by default.

Progressive core, biceps, conditioning, or accessory work tied to a priority belongs in `PROGRAMMED_WORK`, not closeout. Non-trackable mobility or rehearsal cues remain ordered session instructions rather than fake catalog exercises. Optional closeout may reference the existing immutable finisher routine/version/offer flow; the plan must not duplicate that definition as ordinary seed rows.

Current `WARMUP` sections and warm-up set intent can map to preparation. Current main/accessory sections map to programmed work. The existing immutable finisher routine, version, offer, and execution models can implement optional closeout through an adapter; they do not need a rewrite. Because the current accepted seed stores only `exerciseId`, two-role `role`, and `setCount`, preparation and closeout cannot be accepted through the first compiler without a new versioned seed/materialization contract.

### 3.12 How do stable anchors survive change?

Stable placement identity is scoped to one plan container. It persists across revisions and blocks when the session purpose, priority relationship, and placement meaning remain the same. A copied plan receives new placement IDs and records `derivedFromPlacementId`; IDs do not cross plan containers.

Session reordering, prescription changes, and retaining the same exercise preserve placement identity. Replacing an exercise preserves placement identity only when the purpose, role, and priority relationship remain; otherwise a new placement begins. Every replacement records old exercise ID, new exercise ID, reason, effective revision/block, and whether performance continuity is `NOT_COMPARABLE`, `EXACT`, or explicitly normalized. Numeric progression transfers only when the measurement compatibility contract permits it; otherwise the new exercise starts a new performance baseline.

The first block-review workflow should ask the user to retain, replace, add, or reduce. It should explain evidence and consequences, not automatically redesign the plan. Persisted cross-revision lineage is deferred until that workflow; the first compiler proof needs only stable candidate placement IDs for deterministic diffs.

### 3.13 What belongs in Plan Health?

Plan Health is a deterministic explanation surface, not an “optimality” score.

Each result contains rule ID/version, severity (`BLOCKER`, `WARNING`, `INFO`), visible facts, threshold, explanation, remediation, and confidence (`EXACT`, `ESTIMATED`). Rules operate on accepted plan meaning and catalog-policy snapshots.

Initial rule families:

- structural validity: catalog identity, measurement profile, nonempty programmed layer, legal role/layer/profile combinations, unique placement lineage;
- constraints: equipment availability and explicit user limitations;
- priority alignment: required anchors and visible exposure/allocation targets;
- pattern coverage: squat, hinge, unilateral lower work, horizontal/vertical pulling, and declared core patterns;
- region and emphasis coverage: direct/effective programmed sets, frequency, scapular-retraction/rear-delt exposure, direct biceps work;
- continuity: top-priority anchor stability and unexplained replacement;
- distribution: excessive priority work in one session, session duration, repeated exercise family in one session;
- measurement readiness: a prescribed metric that the selected execution cannot log honestly.

Estimated stimulus or emphasis may warn but should not block acceptance by itself. Preparation and optional closeout do not inflate hard-set volume.

Goal-specific thresholds are versioned constants owned by the domain engine and displayed in the result; do not build a rule DSL. V1 should first reuse verified structural, frequency, and current stimulus-policy facts. Proposed maintenance/development/specialization ranges remain research inputs until the unified catalog policy exists and fixtures demonstrate their effect. Estimated stimulus can warn, but it cannot block acceptance or claim biological precision.

### 3.14 What must remain historical truth?

- an accepted plan revision and its content hash;
- the exact accepted seed revision used by a workout;
- the original session-decision receipt;
- the materialized exercise, stimulus, measurement, and prescription snapshots;
- the runtime structure/edit ledger;
- raw performed results, skips, warm-up intent, notes, and timestamps;
- immutable post-session review snapshots;
- stable exercise IDs and catalog retirement/alias history.

No audit, preview, catalog edit, plan copy, block review, or session-local swap may mutate those facts.

### 3.15 Which concepts remain human-authored?

The user or an explicit system template/generator authors goal, ranked priorities, priority rationale, schedule, placement prominence, layer, continuity, measurement choice when multiple valid choices exist, and acceptance/replacement decisions. A generator may propose these values, but they remain visible candidate data until acceptance.

The engine may derive deterministic facts: weekly sets, exposure counts, duration estimates, compatibility, progression eligibility, and Plan Health findings. It must not silently infer a user's priority, promote an exercise to an anchor, choose a machine/load convention, transfer progression across variants, or mutate a plan in response to a recommendation.

### 3.16 What remains uncertain?

Trainer should preserve uncertainty rather than encode false precision:

- exact stimulus fractions for secondary or stabilizing muscles;
- individual recovery and hypertrophy response;
- transfer between exercise variants;
- machine-stack comparability across gyms;
- band tension without measured force curves;
- whether a limitation is medical or temporary;
- which plan is “optimal.”

Use bounded estimates, confidence labels, transparent rules, and user decisions. Do not build a general recommendation engine or clinical classifier into this foundation.

## 4. Target domain model

The names below describe ownership. Exact schema names can change during implementation, but the boundaries may not.

```text
MacroCycle (V1 plan container + run)
  └── PlanSpecificationRevision (immutable accepted meaning)
        ├── ranked priorities
        ├── progression policies
        └── ordered session slots
              └── placements
                    ├── exercise execution identity → ExerciseFamily
                    ├── layer + role + target intent
                    ├── measurement profile selection
                    └── placement lineage + continuity

Mesocycle (bounded activation and schedule)
        ├── TrainingBlock
        └── MesocycleSeedRevision (accepted executable truth)
              └── Workout (exact materialized seed revision)
                    └── WorkoutExercise (policy/profile snapshots)
                          └── WorkoutSet prescription
                                └── SetLog performance
```

### 4.1 Plan specification contract

Do not freeze or persist `PlanSpecificationV1` in the first proof slice. After the next-plan catalog and measurement subset is defined, V1 should be a versioned pure-domain schema with explicit IDs and no database objects embedded in it. Its minimum semantic payload is:

```ts
interface PlanSpecificationV1 {
  version: 1;
  primaryGoal: "HYPERTROPHY";
  priorities: PlanPriorityV1[];
  schedule: SessionSlotV1[];
  progressionPolicy: ProgressionPolicyV1;
  phasePolicy: PhasePolicyV1;
}
```

Each session owns ordered layer groups. Loggable placements include a stable placement ID, exercise ID, `PRIMARY`/`SECONDARY`/`ACCESSORY` prominence, `ANCHOR`/`FLEXIBLE` continuity, priority links, measurement-profile key, bounded prescription, and progression-policy reference/override. Preparation may also include ordered text instructions. Optional closeout references the existing finisher definition/offer policy rather than copying it into exercise placements.

Authoring source, accepted-by actor, copied-from plan/revision, timestamps, compiler version, and derivation provenance are revision metadata outside the semantic payload/hash. V1 explicitly excludes generated diagnostics, Plan Health results, audit sidecars, mutable catalog objects, full exercise metadata, performed values, current bodyweight, physical-machine instances, arbitrary metric bags, and future conditioning-primary-goal policy.

Acceptance validates references and policy, records an immutable semantic revision, and calls a single compiler/acceptance boundary. The accepted seed must carry every compiled field that can affect runtime composition, section/layer materialization, measurement interpretation, or progression. The current seed shape can prove ordered programmed-work composition only; later runtime features require a reviewed new seed version before activation. The seed revision stores source specification revision ID/hash and compiler version, but runtime never reads the specification as fallback. Only the reviewed seed-acceptance seam may promote executable truth.

V2 planner output, diagnostics, draft previews, Plan Health results, provenance detail, and audit sidecars remain evidence. They cannot be read by runtime as substitute exercise IDs, roles, set counts, layer, measurement, or progression directives.

### 4.2 Terminology and invariants

| Term | Definition |
| --- | --- |
| Plan | Stable user-owned revision collection; hosted by `MacroCycle` in V1. |
| Draft | Mutable candidate meaning. |
| Plan specification revision | Immutable accepted semantic meaning. |
| Plan run | Scheduled/lifecycle execution of one accepted revision; not a separate V1 table. |
| Seed revision | Immutable accepted executable composition for a mesocycle. |
| Session slot | Ordered recurring session intent in a plan. |
| Placement | An exercise execution used in a slot with contextual meaning. |
| Exercise family | Related executions for discovery and substitution context. |
| Exercise | Stable trackable execution identity. |
| Measurement profile | Versioned contract defining prescription, performance, and comparison. |
| Snapshot | Immutable historical copy of policy/meaning used at materialization. |

Invariants:

1. One semantic owner: accepted plan meaning exists in exactly one specification revision.
2. One executable owner: every runtime-affecting field comes from the accepted seed revision when one exists. The current version owns exercise IDs, executable roles, and set counts; future layer, measurement, or progression execution requires a versioned seed extension before use.
3. Acceptance is the only promotion boundary; diagnostics and previews cannot self-promote.
4. Accepted specification revisions, seed revisions, and post-session review snapshots are database-immutable. Terminal workout rewrites are application-fenced and optimistic-concurrency protected; do not overstate them as database-immutable rows.
5. Session edits are local unless a later explicit plan acceptance promotes a new revision.
6. Historical interpretation uses recorded snapshots and stable IDs, never mutable current catalog policy.
7. Unknown historical meaning stays unknown; migration does not invent facts.
8. Role and layer belong to a placement; family and capability belong to the catalog.
9. Plan Health is pure evidence and has no mutation side effects.
10. Explanatory semantics may remain only in the specification, but any field that changes execution must compile losslessly into the seed contract. Runtime cannot reverse-infer missing meaning from a narrower projection.
11. The seed revision records the source specification revision/hash and compiler version. A semantic edit creates a new specification revision and a newly compiled seed at a safe boundary; a seed-only defect correction may append N+1 against the same specification without rewriting it.

### 4.3 Independent plan dimensions by example

| Example | Origin provenance | Goal | Priorities/progression | Schedule/lifecycle |
| --- | --- | --- | --- | --- |
| Generated hypertrophy plan | `SYSTEM_GENERATED` | `HYPERTROPHY` | Generator-proposed, visible, accepted | Accepted revision executed by a run. |
| System strength template | `SYSTEM_TEMPLATE` | `STRENGTH` | Template-authored strength anchors/policy | Copied into an accepted revision; template itself is not active. |
| User hypertrophy plan with squat priority | `USER_AUTHORED` | `HYPERTROPHY` | Ranked squat `LIFT_SKILL` specialization plus lower-body priorities; squat override | Four-day upper/lower run in the worked example. |
| User general-fitness plan | `USER_AUTHORED` | `GENERAL_FITNESS` | User-selected balanced priorities/policy | Any validated schedule; no “custom” goal branch. |
| Future conditioning plan | any source | future `CONDITIONING` | Conditioning-specific visible policy | Added only when work metrics and Plan Health rules exist. |
| Copied then edited plan | `USER_AUTHORED`, with copied-from metadata | copied or changed explicitly | New accepted values | New plan container/revision with derivation links; original remains immutable and placement IDs are newly scoped. |

### 4.4 Exercise ontology

The catalog should have one governed source for future writes, materialized to relational data for runtime reads. The existing comprehensive JSON can evolve into that source initially; a database authoring UI is unnecessary.

Minimum owned concepts; these do not imply one table per bullet:

- `ExerciseFamily`: stable grouping for search, intent, and substitutions;
- `Exercise`: stable execution identity and retirement status;
- exercise capability fields: patterns, compoundness, laterality, equipment/resistance, measurement profiles;
- a versioned governed training-policy payload: muscle/region relationships, emphasis tags, stimulus estimates/confidence, allowed layers, substitution class;
- aliases: names only, never semantic identity.

`src/lib/engine/stimulus.ts` must stop being an independent name-keyed catalog. The primary/secondary `.5` custom-draft mapper must stop being another policy. A checked-in versioned policy in the comprehensive catalog is sufficient initially; a relational policy-revision model or catalog administration UI is premature. The tiny `src/lib/data/exercises.ts` should be explicitly fixtures/sample data or retired as a catalog source.

The currently inactive `ExerciseVariation` and `SubstitutionRule` models should not be expanded merely because they exist. Retire them after confirming data usage, or give them a real owner and workflow. Runtime substitution can use family, target, capabilities, and a small reviewed exception set.

### 4.5 Measurement profile snapshots

A profile snapshot contains:

- key and schema version;
- work kind and basis;
- resistance kind and load basis;
- laterality convention;
- permitted units and display defaults;
- equipment-context requirement (the actual gym/machine fingerprint is captured at workout execution, not baked into the catalog profile);
- comparison rules;
- optional derivations such as volume load or total-system load.

The catalog declares permitted profiles. A plan placement selects a profile and default unit/convention. `WorkoutExercise` snapshots that selection and any known execution context; `WorkoutSet` stores the typed prescription; `SetLog` stores typed performed work, resistance, optional contemporaneous bodyweight, effort, and status. A session-local exercise replacement materializes a fresh profile snapshot for the replacement while the edit ledger preserves the decision.

Representative profiles:

| Execution | Work | Resistance/load meaning | Comparability notes |
| --- | --- | --- | --- |
| Barbell back squat | reps total | total external load including bar | Same execution/profile and normalized unit. |
| One-arm dumbbell row | reps each side | per-implement load | Do not multiply for display; volume derivation may account for sides. |
| Plate-loaded row | reps total | explicitly total or per-side plates | Requires basis and physical-machine context; do not create one exercise ID per physical machine. |
| Selectorized machine row | reps total | displayed stack value and unit | Requires physical-machine/stack context; compare only within a compatible context. |
| Assisted pull-up | reps total | assistance load; lower is harder | Optional bodyweight snapshot; not comparable to weighted pull-up. |
| Weighted pull-up | reps total | added load | Optional bodyweight permits derived total-system load. |
| Walking lunge | steps total by default | per-implement or total external load | A reps-each-side mode is a different profile, not an implicit conversion. |
| Copenhagen plank | seconds each side | bodyweight/none | Duration history only. |
| Dead hang | seconds total | bodyweight plus optional added load | Do not store seconds in reps. |
| Pallof press | reps each side | cable stack or band descriptor | Cable and band are separate executions/profiles. |
| Sled push/drag | distance | total sled load, optional duration | Compare only with compatible surface/equipment context if known. |
| Band pull-apart | reps total | band descriptor | No invented pound value. |

Skipped sets store an explicit status and no fabricated measurements. Warm-ups use the same exercise measurement profile but retain preparation/set intent and are excluded from work progression by default.

### 4.6 Measurement-storage decision

| Option | Validation | Query/reporting | Migration/UI cost | Decision |
| --- | --- | --- | --- | --- |
| More nullable relational columns | Cross-field validity becomes difficult as combinations grow. | Familiar scalar queries, but many nulls and conditional meanings. | High schema churn; UI still needs profile routing. | Reject as the complete model. Keep only stable indexed discriminators. |
| Generic metric/EAV rows | Weak without a second schema system; invalid combinations are easy. | Flexible but cumbersome for common history and analytics. | High query/UI complexity and hard migrations. | Reject. |
| Unstructured JSON | Easy to write, hard to govern. | Poor without stable keys/version and typed accessors. | Low initial cost, high long-term ambiguity. | Reject. |
| Versioned typed JSON + indexed profile key + immutable snapshot | Strong discriminated validation and evolution. | Common routing/query uses the key; typed accessors and deliberate JSON indexes support reports. | Moderate one-time UI/profile work; no guessed historical backfill. | Recommend. |
| Dedicated table per measurement family | Strong local typing. | Good within a family, awkward across workouts. | Too many persistence/UI branches for current scope. | Defer unless scale proves typed JSON insufficient. |

## 5. Concrete next-plan representation

The following is an illustrative representation, not an accepted prescription. Exact volume, days, available equipment, and starting targets require user confirmation and Plan Health evaluation.

### 5.1 Intent

- authoring provenance: `USER_AUTHORED` revision metadata;
- primary goal: `HYPERTROPHY`;
- ranked priorities:
  1. squat lift skill — specialize;
  2. lower body — specialize;
  3. upper back with scapular-retraction emphasis — develop;
  4. core — develop;
  5. biceps — develop;
- four weekly slots: Lower A, Upper A, Lower B, Upper B;
- phase: four accumulation weeks plus one deload week;
- plan default: double progression within rep ranges;
- squat strength anchor override: lower rep range and load progression with stable technique;
- continuity anchors: barbell squat, bodyweight/weighted pull-up as selected, supported row, and two stable core placements.

### 5.2 Session skeleton

| Session | Preparation | Programmed work | Optional closeout |
| --- | --- | --- | --- |
| Lower A | squat mobility; barbell ramp sets | Barbell back squat `PRIMARY` + `ANCHOR` 4×4–6; barbell RDL `SECONDARY` 3×6–10; leg press `SECONDARY` + `ANCHOR` 3×8–12; leg curl `ACCESSORY` 3×10–15; machine/cable crunch `ACCESSORY` + `ANCHOR` 3×10–15 | sled drag 2–3 distance intervals |
| Upper A | dead hang by duration; scapular rehearsal | pull-up execution `PRIMARY` + `ANCHOR` 4×5–8; chest-supported row execution `PRIMARY` + `ANCHOR` 4×8–12; dumbbell press `SECONDARY` 3×6–10; face pull `ACCESSORY` 3×12–20; incline curl `ACCESSORY` 3×8–12; Pallof press 3×8–12 each side | none required |
| Lower B | lunge rehearsal; exercise-specific ramps | hack squat `PRIMARY` 3×8–12; Bulgarian split squat `SECONDARY` 3×8–12 each side; hip thrust `SECONDARY` 3×8–12; hip abduction/adduction `ACCESSORY` 2×12–20 each; Copenhagen plank `ACCESSORY` + `ANCHOR` 2×20–30 seconds each side | easy sled work if recovery permits |
| Upper B | shoulder/scapular preparation | cable or machine row `PRIMARY` 3×8–12; dumbbell overhead press `SECONDARY` 3×6–10; lat pulldown `SECONDARY` 3×8–12; reverse pec deck `ACCESSORY` 3×12–20; hammer curl `ACCESSORY` 3×8–12; cable curl `ACCESSORY` 2×12–15; ab wheel `ACCESSORY` 3×8–15 | none required |

This example deliberately exposes ontology decisions rather than hiding them:

- barbell and dumbbell RDL are separate execution identities;
- pull-up mode is selected explicitly rather than mixing bodyweight, added load, and assistance;
- the supported row declares dumbbell, selectorized, or plate-loaded implementation;
- cable and band Pallof press are separate;
- walking lunge would declare steps-total or reps-each-side;
- dead hang and Copenhagen plank use duration;
- sled work uses distance, load basis, and optional duration;
- scapular-retraction coverage uses an emphasis tag and confidence, not a fictional rhomboid volume score.

### 5.3 Progression and deload

The plan specification stores policy, not guessed future loads. A reasonable initial policy is:

- accumulation: progress within the accepted rep range while respecting the effort target; add load only after all required sets reach the upper bound with acceptable effort and form;
- squat anchor: preserve exercise and placement lineage; progress load in smaller explicit increments after rep/effort success;
- assisted pull-up: progress by reducing assistance, not increasing it;
- duration/distance work: progress one declared dimension at a time;
- bands and machines: require stable descriptor/context before numerical comparison;
- deload: reduce programmed hard sets roughly 40–50%, lower effort to approximately RPE 6–7, preserve anchor technique, and exclude deload results from ordinary progression triggers.

Exact thresholds are versioned, visible policy and can be overridden per placement. They are not inferred from names.

## 6. Plan Health for the next plan

The first useful rules for this plan are:

| Rule | Evidence | Severity behavior |
| --- | --- | --- |
| Squat priority has a stable strength anchor | `PRIMARY` role, `ANCHOR` continuity, lift-skill priority, strength progression policy | Block if absent; warn on unexplained replacement. |
| Lower-body priority is distributed | programmed sets and session exposure | Warn if fewer than two weekly exposures or highly concentrated. |
| Squat, hinge, and unilateral lower work exist | movement patterns/capabilities | Warn when a required declared pattern is absent. |
| Upper-back/scapular emphasis is visible | region relationships and emphasis tags | Warn when fewer than two combined exposures; label estimated evidence. |
| Core is programmed, not hidden in closeout | layers and core pattern tags | Warn if priority work exists only in optional closeout or has narrow coverage. |
| Biceps has direct work | direct relationship and programmed exposures | Warn if the declared priority has inadequate direct exposure. |
| Measurement is honest | exercise capability and placement profile | Block duration/distance/assistance work prescribed with a reps/load-only shape. |
| Priority sessions remain feasible | time estimates and ordered work | Warn on estimated duration over the selected limit. |
| Redundancy is visible | exercise family and pattern | Warn on three or more same-family placements in one session. |
| Constraints are satisfied | equipment and explicit limitations | Block unavailable equipment, contraindicated movements, or invalid accepted class. |

The result UI should expose the counted placements and threshold. There is no aggregate score and no automatic “fix my plan” mutation.

## 7. Runtime and migration boundaries

### 7.1 Canonical write path

```text
draft candidate
  → pure specification validation
  → Plan Health evidence
  → explicit user/system acceptance
  → immutable PlanSpecificationRevision
  → deterministic compiler candidate with source specification id/hash/version
  → existing seed acceptance
  → immutable MesocycleSeedRevision/current pointer
  → runtime materialization from that exact seed
  → workout-level semantic snapshots with terminal rewrite fences
  → performed logs
```

The read-only proof compiler projects only ordered programmed-work exercise IDs, current executable roles, and set counts into the current version-1 seed shape. It must reject or explicitly omit unsupported preview-only preparation, closeout, measurement, and progression fields; it must not claim those fields are executable. Before persisted V1 activation, a reviewed newer seed contract must carry every supported runtime-affecting field. A new spec-linked seed version contains compiled executable values plus exact source/compiler provenance, not a second copy of semantic-only commentary, priorities, or rationale. Legacy accepted V2 payloads remain readable under their current contract. This derived execution contract is not dual authority: the specification owns editable semantic intent, the linked seed owns execution, and runtime never reads the specification directly.

### 7.2 Historical compatibility

- Existing accepted seeds, active mesocycles, and materialized workouts continue unchanged. Current terminal rewrite fences are application-owned; do not claim database immutability for all workout/set/log rows.
- No in-place rewrite or guessed backfill of completed performance is allowed.
- Existing numeric set rows use a `LEGACY_REPS_LOAD_V1` interpretation with documented limitations.
- The existing dumbbell per-implement UI convention can be identified as known legacy behavior where evidence is unambiguous.
- Historical machine basis, unilateral basis, duration, distance, assistance, and band tension remain unknown when not recorded.
- Future execution history reads its measurement snapshot. Legacy history may return `NOT_COMPARABLE` instead of pretending precision.
- Existing custom drafts remain on the legacy path until the user explicitly copies/converts them; conversion reports any loss and requires acceptance.
- A new plan revision creates a new seed revision through acceptance. Already materialized workouts retain their exact prior revision.
- Session-local swaps remain local deviations and never edit accepted plan or seed meaning.

### 7.3 Catalog migration

When splitting an overloaded exercise:

1. preserve the legacy ID and its historical records;
2. create new execution IDs under a shared family;
3. retire the legacy ID for new selection when appropriate;
4. do not relabel old records as one of the new executions without recorded evidence;
5. keep aliases for search and display;
6. make new plans select an explicit execution and measurement profile.

Do not create exercise IDs for individual physical machines or gyms. Store that context in the materialized measurement snapshot/log and mark comparisons incompatible when the context differs or is unknown.

Catalog policy revisions affect future materialization only. Existing stimulus and measurement snapshots remain authoritative for completed workouts.

## 8. Retain, refine, replace, and retire

| Disposition | Current concept | Decision |
| --- | --- | --- |
| Retain | `MesocycleSeedRevision` current pointer, hash, provenance, exact workout reference | Canonical accepted executable truth. |
| Retain | session-decision receipt and runtime structure/edit ledger | Preserves original generation truth and session-local deviations. |
| Retain | `WorkoutExercise.exerciseId` and stimulus accounting snapshot | Stable performed identity and historical policy snapshot. |
| Retain | raw `SetLog`, skip state, set intent, notes, timestamps | Performed truth; extend rather than reinterpret. |
| Retain | immutable post-session review snapshot | Historical evidence. |
| Retain | stable exercise UUIDs, aliases, muscle IDs/policy | Durable identity; evolve policy through versions. |
| Retain | active-plan transaction semantics, optimistic concurrency, archive safety | Sound lifecycle mechanics. |
| Retain | immutable finisher routine/version/offer/execution models | Adapt as optional closeout. |
| Refine | `MacroCycle`/`Mesocycle`/`TrainingBlock` hierarchy | Bridge plan run and phases while a clean plan lineage/revision owner is introduced. |
| Refine | custom editor pure-domain logic | Generalize it to edit a plan specification without making the editor the runtime owner. |
| Refine | algorithmic substitution | Use family, target, capabilities, measurement, and small explicit exceptions. |
| Refine | main-lift eligibility | Replace the global gate with placement prominence plus capability/class policy; preserve current accepted-class exception during migration. |
| Refine | workout sections | Project them from preparation/programmed/closeout layers until runtime natively supports layers. |
| Replace for future writes | `planType`/`PrimaryGoal` coupling | Separate provenance, goal, priorities, progression, and lifecycle owners. |
| Replace for future writes | inferred custom source and `HypertrophyPlanDraftV1` as the only editable plan form | Explicit revision provenance and a versioned generic specification draft after the proof slice. |
| Replace for future writes | `PRIMARY_LIFT`/`SECONDARY_LIFT` and executable two-role model as full plan semantics | Three prominence roles plus separate continuity/progression/catalog facts; compile supported programmed work to legacy runtime roles initially. |
| Replace for future writes | reps/load-only prescriptions and results | Typed measurement profiles and snapshots. |
| Replace for future writes | multi-implementation exercise identities | Families plus execution-specific stable IDs. |
| Replace | name-keyed stimulus registry and draft-specific weighting | One governed, versioned catalog policy with snapshots. |
| Replace | history interpretation from current catalog equipment | Interpretation from materialized measurement snapshot. |
| Retire after evidence check | inactive `ExerciseVariation` and `SubstitutionRule` surfaces | Do not preserve unused abstractions without a workflow. |
| Retire as behavioral concepts | generic “custom plan type,” behavioral `SplitType.CUSTOM` | Keep only temporary display compatibility. |
| Retire as catalog authority | `src/lib/data/exercises.ts` | Keep as explicitly named fixtures or remove in an authorized cleanup. |
| Never promote | V2 diagnostics, audits, previews, review evidence | Evidence only until a reviewed acceptance seam promotes a candidate. |
| Defer | Separate `TrainingPlan` and `PlanRun` tables | Revisit only when one accepted plan must have multiple independently scheduled runs. |
| Defer | Relational `ExerciseTrainingPolicyRevision` hierarchy | Start with one governed checked-in policy version and immutable workout snapshots. |
| Unresolved pending evidence | Actual legacy machine/load conventions in user data | Repository code cannot establish what users meant by every prior number; inspect only when an authorized migration is being scoped. |
| Unresolved pending evidence | Whether inactive variation/substitution rows exist in configured environments | Confirm read-only before removal; model presence alone is not evidence of use. |
| Unresolved pending evidence | Obsolete autoregulation mirrors | Trace production reads before retirement; do not fold them into the new plan owner. |

### 8.1 Replacement rationale and smallest safe transition

| Replacement | Conceptual defect and evidence | Clean target; why another additive patch fails | Compatibility and smallest safe slice |
| --- | --- | --- | --- |
| Plan type/source/goal | `src/lib/plan-types.ts` couples supported plan types to goals; `createPlan` branches by type; custom source is inferred from custom draft/seed source. | Independent source, goal, priorities, progression, schedule, and lifecycle in `PlanSpecificationRevision`. More enum values would preserve contradictory branching and still omit versioned meaning. | Add the V1 semantic revision and compiler; keep current fields as read projections for legacy plans. |
| Hypertrophy-specific editable meaning | `HypertrophyPlanDraftV1` cannot own general goals, ranked priorities, layers, continuity, or measurement. | A generic versioned draft/specification contract. Expanding the old JSON would make hypertrophy terminology the permanent universal schema. | Keep old drafts on their path; add explicit copy/conversion; accept new drafts through the existing seed boundary. |
| Exercise identity | `ExerciseEquipment` allows one ID to span multiple implementations, as in RDL and Pallof press; machine basis and pull-up assistance are absent. | Family plus stable execution-specific exercise IDs. More equipment flags on one ID still leave historical loads incomparable. | Split only next-plan exercises first; preserve/retire legacy IDs without rewriting history. |
| Stimulus ownership | `stimulus.ts` uses name-keyed explicit profiles while custom draft mapping uses primary `1`/secondary `.5`. | One versioned catalog training-policy source, snapshotted at materialization. Adding a third mapper or more aliases compounds disagreement. | Move a bounded next-plan subset to governed IDs/policy; compare snapshots and health facts in tests. |
| Placement semantics | Current user roles and executable roles are too coarse; global main-lift eligibility required a contextual accepted-class exception. | Placement-owned `PRIMARY`/`SECONDARY`/`ACCESSORY` prominence plus separate continuity, progression, and accepted target/class capability. More global flags cannot encode why the exercise is used in this plan. | Prove the mapping read-only first; persist only when unsupported layer/progression semantics have an executable seed contract. |
| Session semantics | `WARMUP`, `MAIN`, `ACCESSORY`, set intent, and separate finisher models only partly express required versus optional work. | Three placement layers with explicit counting/progression rules. More section values would keep optionality and volume meaning implicit. | Add layers in the spec; project prep/programmed to current sections and adapt existing finisher provenance to closeout. |
| Set measurement | `WorkoutSet`/`SetLog` expose reps/load/RPE for all work; UI, validation, and history give the same numbers context-dependent meanings. | Versioned measurement profile snapshot and typed prescription/performance payload. Extra nullable duration/distance/assistance columns would still omit combination and comparison rules. | Implement profiles only for next-plan executions, give older rows a limited legacy interpretation, and fail closed on unknown comparison. |
| Historical comparison | `exercise-history.ts` uses current catalog equipment to interpret completed numeric rows. | Snapshot-based `EXACT`/`NORMALIZED`/`NOT_COMPARABLE` comparison. Adding more current catalog metadata increases the chance of retrospective reinterpretation. | Read new snapshots first; retain a documented legacy adapter; never guess machine/laterality basis. |
| Plan Health | Existing facts/rules are useful but have no accepted priorities, layers, prominence, continuity, measurement readiness, or confidence. | Deterministic versioned facts and explained findings. Adding a total score or one-off UI warnings would hide assumptions and split policy. | Reuse current pure checks behind a unified fact model after persisted V1 exists; add only rules needed to accept the next plan. |

## 9. Options considered

### 9.1 Extend the current custom hypertrophy payload

Rejected. It would keep authoring source, goal, semantic plan meaning, and runtime compatibility tangled. Adding priorities, layers, measurement, and lifecycle to a hypertrophy-specific draft would create another broad JSON owner without resolving plan identity.

### 9.2 Let runtime consume the plan specification directly

Rejected. It would create a competing authority beside the accepted seed and weaken exact replay, auditability, and historical provenance.

### 9.3 Put every execution field in relational columns

Rejected as the only representation. Work/resistance combinations evolve and would produce sparse, coupled columns and validation combinations. Stable identity and indexed routing belong in columns; versioned typed payloads hold bounded measurement unions.

### 9.4 Use a generic metric/EAV table for every set value

Rejected. It permits invalid combinations, makes validation and common queries harder, and hides semantic contracts in string keys.

### 9.5 Keep one exercise row and attach arbitrary equipment at logging time

Rejected. It erases what was planned, makes progression ambiguous, and lets current catalog edits reinterpret history. Exercise family handles discovery; execution identity handles tracking.

### 9.6 Add more global exercise flags and scores

Rejected. Role, priority, layer, and eligibility are contextual. More catalog booleans recreate the existing main-lift ambiguity. Opaque quality or optimality scores would conceal assumptions.

## 10. Staged implementation roadmap

Each slice has one canonical owner, a concrete result, focused verification, and a safe stopping point. Later slices must not create alternate paths around earlier boundaries.

### Slice 1 — Read-only specification/compiler proof

Value: prove the semantic-to-executable boundary cheaply before adding a second persisted planning system.

- Schema impact: none. Do not create `TrainingPlan`, `PlanRun`, `PlanSpecificationRevision`, or a feature flag.
- Application areas: a pure internal `PlanSpecificationPreviewV0` parser/canonical serializer, an adapter from the existing `HypertrophyPlanDraftV1`, an executable-only version-1 seed projection, and a read-only preview in the existing review seam.
- Preview fields: hypertrophy goal; ranked next-plan priorities; four-plus-one phase intent; ordered slots; and ordered `PROGRAMMED_WORK` placements with candidate placement ID, exercise ID, `PRIMARY`/`SECONDARY`/`ACCESSORY`, continuity, priority links, and set count.
- Explicit omissions: persistence, public `PlanSpecificationV1`, preparation/closeout compilation, measurement payloads, progression execution, copies, generalized strength/generated adapters, and activation.
- Verification: the same fixture serializes/compiles byte-for-byte identically; the executable projection equals the existing custom seed for the same programmed work; changing preview-only priorities does not change seed rows; changing executable rows does; and runtime tests pass with the preview absent or deliberately altered because runtime consumes only the accepted seed.
- Safe stop: the current custom draft/acceptance/runtime remains the only write path.
- Must precede next plan: yes as an architecture proof, but it does not make the next plan executable by itself.

### Slice 2 — Execution-distinct catalog subset

User value: the next plan selects honest variants for its anchors and priority exercises.

- Schema impact: minimal family linkage, retirement/alias semantics, measurement capabilities, and a checked-in versioned training-policy/emphasis payload; no catalog administration or policy-revision hierarchy.
- Application areas: catalog seed/validation, exercise read models, selection and substitution predicates.
- Compatibility: preserve legacy IDs; create new IDs for RDL implementations, pull-up modes, row/machine types, Pallof implementations, timed core, lunges, and sleds. Physical machines remain context, not exercise identities.
- Backfill: no guessed reassignment. Only deterministic aliases/relations.
- Feature flag: selection of new variants can be gated to new-spec plans.
- Verification: catalog invariants, unique IDs, allowed profiles, no dangling plan references, substitution class tests.
- Non-goals: normalize the entire library or create an exhaustive equipment database.
- Must precede next plan: yes for every exercise used by that plan; the rest can follow incrementally.

### Slice 3 — Measurement-aware logging vertical slice

User value: the next plan records squat, dumbbell/machine work, pull-up modes, unilateral work, timed core, bands, and sleds without semantic ambiguity.

- Schema impact: measurement profile key/snapshot plus versioned prescription/performance payloads; keep legacy numeric fields readable.
- Application areas: materialization, validation, active-workout controls, persistence, history, progression, and display.
- Compatibility: legacy adapter; controlled temporary dual-write only if one direction is canonical and equality is tested.
- Backfill: none for unknown historical meaning. Assign only a documented legacy profile.
- Feature flag: yes, by profile/new-spec workout.
- Verification: a contract matrix for each work/resistance/laterality combination; swap snapshot behavior; API/UI round trips; exact/normalized/not-comparable history; progression direction for assistance; legacy regression tests.
- Non-goals: cross-exercise PR comparison, inferred machine calibration, wearable integration.
- Must precede next plan: yes if that plan will be executed rather than previewed only.

### Slice 4 — Freeze V1 and persist accepted plan meaning

User value: a user can author and accept the next plan with explicit priorities, phases, layers, progression, measurement, and continuity without changing runtime authority.

- Schema impact: immutable `PlanSpecificationRevision` hosted by the current `MacroCycle`, current-revision linkage as needed, and exact source-specification provenance on the compiled seed. Do not add separate `TrainingPlan`/`PlanRun` tables.
- Application areas: pure final V1 parser/serializer/compiler, DB-backed transactional acceptance, thin routes, and the existing custom editor evolved for the next plan.
- Runtime contract: add a reviewed seed version that carries every execution-affecting supported field—programmed composition, materialized layer/section, measurement-profile key/version, and progression-policy reference/version. Runtime must not read the specification.
- Compatibility: legacy custom drafts remain on their path or enter an explicit, loss-reporting conversion. Generated hypertrophy and strength adapters are deferred until a real user flow needs them.
- Backfill: none.
- Feature flag: yes, around new-spec authoring/acceptance.
- Verification: DB immutability, atomic spec+seed acceptance, source revision/hash/compiler provenance, role/profile/layer compatibility, concurrent acceptance, runtime-only-seed consumption, and exact old-workout provenance.
- Non-goals: drag-and-drop framework rewrite, generic workflow engine.
- Must precede next plan: yes.

### Slice 5 — Preparation and optional-closeout UX

User value: the user can execute ordered preparation and optional closeout without distorting hard-set volume or replacing finisher provenance.

- Schema impact: only the V1/seed fields already justified by Slice 4; closeout references existing immutable finisher definitions/offers.
- Application areas: editor, materialization, active workout, and finisher adapter.
- Compatibility: current warm-up intent/sections and finisher flows remain canonical adapters.
- Verification: preparation exclusion from hard-set progression, programmed core inclusion, optional completion semantics, and unchanged finisher history.
- Must precede next plan: yes if these layers are part of the accepted plan rather than notes.

### Slice 6 — Transparent Plan Health v1

User value: the user can see whether the next plan represents declared priorities, remains executable, and has obvious distribution or measurement gaps before acceptance.

- Schema impact: none for results. If acceptance evidence is retained, store only rule-set version and immutable result provenance; it remains non-executable.
- Application areas: pure engine facts/rules, acceptance preview, read model.
- Compatibility: reuse current structural, constraint, volume, frequency, redundancy, and duration checks through one fact model.
- Backfill: none.
- Feature flag: the new-plan rollout flag; rule versions are ordinary constants, not a generalized rule engine.
- Verification: golden fact fixtures, blocker/warning boundaries, confidence labels, no contribution from prep/closeout, no mutation side effects.
- Non-goals: aggregate score, individualized outcome prediction, automatic plan rewriting.
- Must precede next plan: structural, measurement-readiness, and explicit-priority rules yes; speculative stimulus thresholds may follow.

### Slice 7 — Block review and placement lineage

User value: the user can evolve the plan after a block without losing intended anchors or fabricating progression continuity.

- Schema impact: cross-revision placement derivation/replacement decisions. Copies get new placement IDs plus derivation links.
- Application areas: block-review UI, plan draft creation, history/context read models.
- Compatibility: current post-session review remains immutable evidence; existing plans can use the old handoff path.
- Backfill: none.
- Feature flag: yes.
- Verification: retain/replace lineage, incompatible baseline reset, prior revision immutability, new seed acceptance, exact old-workout provenance.
- Non-goals: autonomous coach or model-generated recommendation loop.
- Must precede next plan: no; must precede the first revision/block handoff.

## 11. Decisions to make now

1. Adopt the plan specification revision as the sole future owner of accepted semantic plan meaning, hosted by `MacroCycle` in V1.
2. Preserve `MesocycleSeedRevision` as the sole accepted executable truth.
3. Store authoring source as revision provenance; remove “custom” from plan-type semantics.
4. Use one prominence role per placement, separate continuity/progression/catalog facts, three session layers, and ranked explicit priorities.
5. Treat exercise family and trackable exercise identity as distinct.
6. Split execution identities when measurement or comparability changes materially.
7. Use versioned measurement snapshots plus typed JSON prescription/performance payloads.
8. Make historical comparison snapshot-based and fail closed when meaning is unknown.
9. Converge stimulus policy into one governed source and preserve materialized snapshots.
10. Keep Plan Health deterministic, transparent, confidence-labeled, and non-mutating.
11. Prove the compiler read-only before persisting a public V1 contract.

## 12. Intentionally deferred decisions

- conditioning as a full primary-goal planner;
- wearable/sensor data and automatic bodyweight capture;
- population-specific recovery models;
- precise secondary/stabilizer stimulus science;
- cross-exercise performance transfer;
- automated plan redesign or recommendation ranking;
- a catalog administration UI;
- full legacy data normalization;
- generalized rule engines, workflow engines, or plugin architectures;
- clinical injury, rehabilitation, or “corrective” semantics;
- whether every current enum/table should be renamed once migration is complete.
- separate `TrainingPlan` and `PlanRun` tables;
- a relational exercise-policy revision hierarchy;
- persisted placement lineage until block review is implemented;
- generated-hypertrophy and strength adapters to the new specification path.

## 13. Decisions requiring user input before materializing the next plan

| Decision | Options and concrete consequence | Recommendation |
| --- | --- | --- |
| Weekly schedule and duration | Four fixed weekdays improves distribution checks and calendar predictability; four ordered slots without fixed days tolerates changing weeks but provides weaker recovery-spacing evidence. Session-duration limit changes allowable exercise count and supersets. | Use four ordered upper/lower slots, add preferred weekdays if the schedule is stable, and state a real duration limit. |
| Equipment implementations | Selectorized, plate-loaded, dumbbell, and cable versions become different trackable identities. Per-side versus total machine entry changes every displayed load and comparison. Pull-up assistance method changes progression direction and context. | Inventory only equipment used by the next plan and select an explicit load convention before catalog normalization. |
| Priority order and starting tolerance | Changing rank changes allocation and anchor protection. Conservative starting volume reduces early fatigue but may undershoot desired work; a higher start uses more recovery budget. Squat/pull-up baselines set initial targets. | Confirm the proposed rank order and begin conservatively, then use block review rather than speculative recovery prediction. |
| Walking-lunge tracking if included | Total steps is easy during alternating walking; reps each side aligns with other unilateral lifts but requires side accounting. Switching later breaks direct comparison. | Use total steps and state load basis explicitly. |

These inputs are not required to accept this architecture. They are required to instantiate a trustworthy real plan.

## 14. Risks and seductive abstractions to avoid

- **A second truth:** letting plan specs, audits, or diagnostics override an accepted seed at runtime.
- **A universal exercise object:** one row with every possible equipment option and an ambiguous load history.
- **Metric EAV:** arbitrary metric names that make invalid sets easy and normal queries hard.
- **Column explosion:** dozens of nullable fields without a discriminated profile contract.
- **False precision:** exact rhomboid/stabilizer volume, machine equivalence, band pounds, or predicted recovery without evidence.
- **Opaque scoring:** a single Plan Health or exercise-quality number that hides priorities and thresholds.
- **Global contextual flags:** encoding plan role, layer, or eligibility as permanent exercise traits.
- **Automatic lineage transfer:** carrying progression through a replacement merely because exercises share a family.
- **Premature catalog normalization:** blocking the next-plan vertical slice on perfect metadata for every exercise.
- **Generic recommendation infrastructure:** building a rule DSL or agent loop before deterministic user-visible rules prove necessary.
- **Finisher rewrite:** discarding sound immutable closeout provenance merely to standardize names.
- **Silent backfill:** guessing historical measurement meaning to make dashboards look complete.

## 15. Acceptance criteria for this design

The design is ready for implementation planning when reviewers agree that:

- plan meaning, executable truth, materialized prescription, and performed reality have exactly one owner each;
- authoring provenance, goal, priority, progression, schedule, and lifecycle have separate owners and explicit compatibility validation;
- the next plan can represent ranked lower-body, squat-strength, upper-back/scapular, core, and biceps priorities;
- preparation, programmed work, and optional closeout are explicit and volume semantics are unambiguous;
- placement prominence and stable lineage survive block-to-block changes without claiming false performance comparability;
- the catalog distinguishes families from trackable execution identities;
- all next-plan exercise modes have honest measurement profiles;
- completed history is never reinterpreted from mutable catalog data;
- legacy plans and logs remain readable without guessed migrations;
- current accepted seed authority, receipts, runtime edit ledger, stimulus snapshots, and review evidence remain intact;
- Plan Health exposes rules, inputs, thresholds, severity, and confidence without an aggregate score;
- the first slice proves deterministic projection and runtime isolation without introducing persistence or a runtime rewrite.

## 16. Recommended first implementation slice

Implement a **read-only specification/compiler proof over the existing custom hypertrophy draft**.

The bounded deliverable is:

1. a pure internal `PlanSpecificationPreviewV0` parser and canonical serializer;
2. an adapter from `HypertrophyPlanDraftV1` for the next-plan fixture;
3. the minimum preview fields: hypertrophy goal, ranked priorities, four-plus-one phase intent, ordered slots, and ordered programmed-work placements with candidate ID, exercise ID, prominence role, continuity, priority links, and set count;
4. a deterministic executable-only compiler that emits the current version-1 seed shape and rejects unsupported executable claims;
5. a read-only review showing semantic preview, explicit omissions, and executable projection;
6. the smallest end-to-end test: compile the same fixture twice to identical canonical bytes/hash, verify its executable rows equal the existing custom accepted projection, alter preview-only priority text without changing rows, alter an executable set count and observe a deterministic row/hash change, then prove generation still consumes only the accepted seed when preview data is absent or contradictory;
7. no database schema, persistence, migration, feature flag, activation path, or production write.

Do not name or persist public `PlanSpecificationV1` until the concrete next-plan exercise identities, measurement profiles, layer materialization, and progression seed contract are defined. Immediately after this proof, normalize the bounded next-plan catalog subset and implement measurement-aware execution. Freeze/persist V1 only in the later atomic spec-plus-seed acceptance slice.

This ordering tests the proposed owner boundary without creating a second planning system beside the already useful custom draft. It preserves accepted-seed runtime authority, makes unsupported semantics visible instead of decorative, and leaves a safe stopping point after every slice.
