# Exercise Execution and Measurement Foundation

Status: proposed implementation design
Scope: bounded catalog semantics and measurement-aware execution
Decision verdict: **READY FOR IMPLEMENTATION**

## 1. Executive recommendation

Trainer should keep `Exercise.id` as the stable executable identity, add three nullable execution-default fields to reviewed catalog entries, freeze those values into every measurement-aware accepted seed row, and copy them exactly onto each materialized `WorkoutExercise`.

The first implementation should be a bounded rep-based vertical slice. It should support:

- `REPS_EXTERNAL_LOAD`
- `REPS_BODYWEIGHT`
- `REPS_BODYWEIGHT_PLUS_LOAD`
- `REPS_ASSISTED`

It should classify only a reviewed pilot set of exercises, emit a new accepted-seed contract for those exercises, materialize the snapshot, validate and label existing rep/load/RPE controls by profile, and gate history suggestions on compatible identity and semantics. It should not persist a planning specification or change the accepted-seed authority chain.

These profiles remain deferred until a concrete set contract or catalog/custom-exercise need exists:

- `REPS_ONLY`
- `DURATION`
- `DISTANCE_WITH_OPTIONAL_DURATION`

`REPS_ONLY` is structurally possible, but the current canonical catalog and product have no proven first-slice exercise that needs it outside bodyweight work, and there is no user-facing custom-exercise creation flow. Duration and distance cannot be represented faithfully by the current required `WorkoutSet.targetReps`, rep/load/RPE-only log, and workout UI.

Do not introduce immutable catalog revisions. A full execution snapshot is smaller, works for canonical and custom exercises, and preserves historical meaning without making runtime dereference a second authority.

The governing rule is:

> Create a separate executable exercise identity when combining two forms would make the prescribed action, required logging fields or units, safety/eligibility, exact history comparison, or progression direction materially ambiguous. Otherwise represent the difference as classification, a placement attribute, a cue, or an alias.

## 2. Current-state authority map

```text
checked-in exercise JSON --name-keyed sync--> Exercise rows --ID lookup--> planning
                                                            |
template / generator / custom draft / V0 -------------------+
                         |
                         v
accepted MesocycleSeedRevision.seedPayload
  current executable row = exerciseId + role + setCount
                         |
                         | resolves live Exercise by ID
                         v
session generation --> WorkoutExercise + WorkoutSet --> SetLog
                            |                   |
                    live catalog facts     reps/load/RPE

Exact performed history is grouped by Exercise.id.
Accepted seed revisions remain the sole canonical runtime plan authority.
```

| Area | Authoritative owner today | Derived representation / fallback | Ambiguity or risk |
| --- | --- | --- | --- |
| Exercise identity | `Exercise.id` in Prisma; workout/template foreign keys and accepted seed rows carry the ID | `Exercise.name` is unique and drives checked-in catalog synchronization; aliases support lookup/display | IDs are stable inside an environment but new seed-created IDs are UUIDs, not deterministic across rebuilt databases. Names are operational catalog keys, not executable authority. |
| Catalog classification | `Exercise`, `ExerciseEquipment`, `ExerciseMuscle`, aliases, variations, substitution rules | Checked-in `prisma/exercises_comprehensive.json` and alias data populate rows | There is no stored normalized name or general exercise category; search normalization is transient and patterns/split tags/muscles/equipment provide classification. No measurement profile, load convention, body position, catalog status, or ownership exists. `isUnilateral` is insufficient to define whether the stored rep count is total or per side. |
| Named variations | `ExerciseVariation` stores a label, optional variation type, and loose metadata under a parent exercise | Catalog/display metadata | Seeds, workout exercises, and history do not reference a variation ID. It is not a stable executable identity and cannot carry measurement authority. |
| Seeded versus noncanonical rows | Checked-in JSON defines the canonical seed set | Seed pruning explicitly retains rows referenced by workout history or templates; other relational references still rely on foreign keys | There is no first-class user-created-exercise model or creation API. Accepted-seed JSON is not a foreign key, so an exercise referenced only by a seed can currently be pruned. |
| Templates | `WorkoutTemplateExercise.exerciseId` | Live catalog row supplies the remaining facts at generation | Template placement cannot select or freeze execution semantics. |
| Generated plans | Engine exercise objects selected from the live catalog; output retains IDs | Names and catalog classifications appear in explanations and DTOs | Equipment and rep-range metadata can affect generation, but are not accepted execution truth. |
| Custom hypertrophy authoring | Draft uses `exerciseId`, working sets, role/intent; accepted V2 retains explanatory detail | `projectExecutableSeedRows()` reduces runtime rows to v1 `exerciseId`, `role`, `setCount` | Acceptance cannot distinguish an overloaded catalog entry's execution forms. |
| `PlanSpecificationPreviewV0` | Pure V0 specification validates catalog IDs | Uses the same executable projection to v1 seed rows | Correctly proves only ID/role/set-count compilation; measurement was intentionally deferred. |
| Accepted plan | Current `Mesocycle.currentSeedRevision.seedPayload` | `slotPlanSeedJson` is a compatibility source when no accepted revision owns the runtime plan | Seed v1/v2 executable projection does not freeze execution meaning. |
| Runtime replay | Accepted seed row selects the exercise ID and set count | Live `mapped.exerciseLibrary` resolves the ID; missing IDs block replay; legacy rows without `setCount` use a documented fallback | Live name, equipment, rep range, and other catalog edits can affect generation after acceptance. |
| Workout exercise | `WorkoutExercise.exerciseId`, section, role-like fields, movement-pattern and stimulus-accounting snapshots | Live exercise relation supplies name/equipment | Stimulus meaning is frozen, but execution and measurement meaning are not. |
| Prescription | `WorkoutSet.targetReps` plus optional rep range, RPE, load, rest | Warm-ups clone the same rep/load structure with `SetIntent.WARMUP` | `targetReps` is required; there is no duration, distance, assistance, bodyweight, or per-side target. |
| Performed log | `SetLog.actualReps`, `actualLoad`, `actualRpe`, skip, note | Target load of zero can normalize missing performed load to zero; all loads quantize to 2.5 lb | The numeric load has no stored convention. Load-only work is invalid. RIR is not stored; it is derived where used. |
| Logging UI | Active-set card always exposes reps, load, and RPE | Live equipment changes labels: bodyweight note or dumbbell "per dumbbell" | Weighted bodyweight entries still contain bodyweight equipment; generic and hybrid equipment can be mislabeled. |
| History | Exact `Exercise.id` and performed work sets | Live current equipment chooses `per_dumbbell`, `recorded_external_load`, or `not_comparable` | A later equipment edit can reinterpret old logs. Any bodyweight equipment hides load records, including weighted forms. |
| Progression/load suggestions | Exact-ID history feeds load/reps/RPE logic | Equipment buckets and name regexes infer behavior; assisted direction is recognized from names such as "assisted" | Assistance direction, bodyweight-plus-load, machine calibration, and overloaded equipment identities are not represented explicitly. |
| Runtime add/swap/remove | Add and swap resolve the replacement from the live catalog, reuse exact-ID recent load, and write the workout row; swap is blocked after logs. Remove is limited to unlogged runtime-added rows | Stimulus accounting and movement patterns are replaced/snapshotted; accepted seed truth is not changed | There is no execution snapshot. For a measurement-aware workout, add/swap must create a complete replacement snapshot at the mutation boundary; removal deletes that workout-local snapshot with the row. |
| Plan Health | Live catalog facts: ID, name/aliases, muscles, patterns, equipment, limitations, compound/main-lift eligibility, timing, preferences | Blocking checks and warnings evaluate authoring constraints | These are authoring evidence. They do not become executable seed meaning, and measurement compatibility is not checked. |
| Supersets, warm-ups, finishers | Superset grouping is composition; warm-up is set intent; finishers use their own immutable timed protocol | Presentation and session orchestration | None should redefine exercise identity. Finishers are not evidence that ordinary exercise sets already support duration. |

Repository evidence:

- `prisma/schema.prisma`: `Exercise`, `WorkoutExercise`, `WorkoutSet`, `SetLog`, and `MesocycleSeedRevision`.
- `prisma/seed.ts`: name-keyed updates and `pruneStaleExercises()`.
- `scripts/sync-exercise-library.ts`: additive/update sync with no catalog deletions.
- `src/lib/engine/hypertrophy-plan-authoring.ts`: executable accepted-seed projection.
- `src/lib/api/plan-specification-preview-v0.ts`: non-persisted compiler proof.
- `src/lib/api/mesocycle-seed-revision.ts`: accepted revision normalization, hashing, and append-only correction.
- `src/lib/api/template-session/slot-plan-seed.ts`: accepted/legacy row replay through the live exercise library.
- `src/lib/api/save-workout/persistence.ts`: current workout and stimulus snapshot materialization.
- `src/app/api/logs/set/route.ts` and `src/lib/logging/setValidity.ts`: current performed-log contract.
- `src/components/log-workout/WorkoutActiveSetCard.tsx`: current controls and equipment-derived labels.
- `src/lib/api/exercise-history.ts`, `src/lib/api/workout-context.ts`, `src/lib/engine/apply-loads.ts`, and `src/lib/engine/load-calibration.ts`: history and load interpretation.

Relevant history supports the same boundary: immutable accepted seed revisions were established in `e191102a`, workout stimulus semantics were frozen in `ea8cca54`, exact seed provenance was promoted in `de2a986d`, and the V0 compiler proof merged in `d7fc82d9`.

`normalizeAcceptedSeedPayload()` treats current versions differently: V1 canonicalizes the executable slot rows and hashes their serialized projection; V2 strictly parses and hashes the full source-specific accepted hypertrophy object, then projects a V1 executable payload. `createEditableHypertrophyPlanCopy()` also reads V2 settings, slot names/focus, and exercise intent back from the accepted payload. A custom-hypertrophy V3 must therefore preserve that existing canonical envelope, add measurement only to its exercise rows, and project a new source-neutral executable shape. Dropping the envelope would break plan copy; adding optional fields to V2 would make one version ambiguous.

Independent review disposition:

| Claim | Disposition | Consequence |
| --- | --- | --- |
| Exact exercise ID, accepted-revision authority, live-catalog replay, generic rep/load logging, and exact-ID history claims | Confirmed | Retained. |
| User-created exercise support | Confirmed absent as a user-facing feature; noncanonical rows can still exist through seed/import/history paths | Custom management remains out of scope. |
| Five-profile pilot | Partially confirmed | Reduced to four profiles; `REPS_ONLY` has no concrete first-slice owner. |
| Source-neutral canonical V3 | Contradicted by accepted-plan copy behavior | V3 retains the current custom-hypertrophy envelope and adds no new planning fields; runtime consumes its source-neutral executable projection. |
| Catalog revision, snapshot version, unit, and execution-mode fields | Unsupported for the rep pilot | Removed; their effects are already represented by payload shape, the bounded load conventions, exercise ID, and `repBasis`. |
| Every physical machine needs a separate exercise ID | Contradicted by the minimality goal | Machine context is not identity by default; automatic load suggestions fail closed where context is unknown. |
| Archive status is required now | Partially confirmed as a broader integrity concern, not as a measurement prerequisite | Deferred; the pilot removes no IDs and must not broaden into catalog lifecycle. |

## 3. Current ambiguities and concrete risks

1. **A catalog ID can cover incompatible implements.** `Romanian Deadlift` includes barbell and dumbbell equipment; `Pallof Press` includes cable and band; `Goblet Squat` includes dumbbell and kettlebell. The stored load number therefore lacks a single convention.
2. **Some execution-distinct forms are already separate, but the rule is implicit.** `Dumbbell Curl` and `Alternating Dumbbell Curl`, and `Pull-Up` and `Weighted Pull-Up`, have separate IDs. The schema does not say why or enforce the separation.
3. **Machine meaning is under-specified.** Generic `Leg Press` does not distinguish plate-loaded from selectorized machines or how plates are counted.
4. **Duration and distance are represented as fake reps or not logged.** Catalog examples such as plank and farmer's walk have rep ranges even though faithful work is time or distance. The ordinary set contract has no corresponding fields.
5. **Bodyweight and assisted work collapse.** Live history treats any exercise with bodyweight equipment as load-not-comparable. Assistance direction is inferred from a name regex rather than stored semantics.
6. **Catalog edits can rewrite history presentation.** History load convention and the workout logging label are derived from the current equipment relation, not a workout snapshot.
7. **The seed does not contain enough executable meaning.** A plan accepted before a catalog equipment edit can execute differently after the edit.
8. **All numeric loads share one quantization.** The set-log route snaps to 2.5 lb regardless of displayed machine increments, assistance, or unknown equipment.
9. **Unilateral data has no basis.** `isUnilateral` does not say whether reps or load are per side, alternating total, or recorded once for both sides.
10. **Deletion protection is incomplete.** Relational references protect their rows, while accepted-seed JSON does not. Runtime fails if an accepted seed's ID is missing.
11. **Aliases can imply false equivalence.** Alias uniqueness prevents duplicate alias strings, but aliases such as equipment-specific names can point to an overloaded identity. Alias changes must never relink performed history.
12. **Exact-ID history overstates comparability.** Exact ID is necessary, but not sufficient when semantics change or a generic machine ID is used on differently calibrated equipment.

## 4. Executable-identity decision rule

An executable exercise identity is the stable `Exercise.id` for one independently selectable action whose prescription, logging dimensions, load interpretation, and comparison direction are internally consistent.

Use a separate ID when at least one of these is true:

- the measurement profile differs;
- the resistance mode differs among bodyweight, added load, or assistance;
- the required logged values or unit basis differs;
- the load number changes meaning, such as total barbell load versus per-dumbbell load;
- bilateral, unilateral-simultaneous, or alternating execution changes the logged rep/load basis or materially changes history;
- fixed-path versus free-weight, or an implement change, changes the prescribed action or recorded load convention;
- the form has materially different safety, eligibility, or progression direction and is selected deliberately by the user.

Do not split solely because a display label, coaching cue, minor grip/stance, or authoring classification changes.

| Difference | Default classification | Split into a new ID when... |
| --- | --- | --- |
| Movement pattern | Catalog classification | The performed action is materially different, not merely classified differently. |
| Equipment class / implement | Identity-defining execution fact | Load convention or comparison changes. Barbell squat and goblet squat are separate. Dumbbell and kettlebell goblet squat may share only if both use one-implement total load and the product accepts same-ID comparison; otherwise split. |
| Physical machine | Placement/workout context | It changes the independently selected action or recording convention. Different calibration alone does not force catalog fragmentation; without a machine-context field, automatic load suggestions fail closed. |
| Bilateral vs unilateral | Identity-defining when logged basis changes | Reps/load would be ambiguous or progression history differs. |
| Simultaneous vs alternating | Identity-defining when independently selected | Rep counting or fatigue/history differs. Existing alternating curl correctly has its own ID. |
| Standing, seated, prone, supported | Catalog execution attribute | Support materially changes safety, load history, or selection. |
| Grip or stance | Placement attribute or cue | It is a deliberately selected named form with materially distinct safety/history. |
| Range of motion | Placement attribute or cue | The range is prescribed as a distinct exercise and old loads should not be compared. |
| Bodyweight / weighted / assisted | Separate identity | Always for this slice. Profiles and load direction differ. |
| Fixed path vs free weight | Separate identity | Normally, because load meaning and progression history differ. |
| Measurement mode | Separate identity | Always. A timed plank and rep-based dynamic plank are different executable identities. |
| Tempo, pause, technique cue | Placement attribute or note | Only split when Trainer exposes it as a stable independently selected exercise and comparison must remain separate. |
| Alias / spelling | Display alias | Never. Alias resolution returns an existing ID. |
| Muscles, pattern, safety tags | Catalog classification / authoring constraint | Never by themselves; a distinct action may have different values as a consequence. |

No family/variant hierarchy is required in this slice. A future optional `comparisonFamilyId` may group related identities for discovery, but must not authorize automatic load comparison.

## 5. Proposed bounded measurement profiles

### 5.1 Snapshot shape

Expose one small discriminated value in code and accepted-seed JSON. Persist its three facts as explicit nullable columns on `Exercise` and `WorkoutExercise`:

```ts
type MeasurementSemantics =
  | {
      profile: "REPS_EXTERNAL_LOAD";
      loadConvention:
        | "BARBELL_TOTAL"
        | "IMPLEMENT_WEIGHT"
        | "MACHINE_DISPLAYED";
      repBasis: "TOTAL" | "PER_SIDE";
    }
  | {
      profile: "REPS_BODYWEIGHT";
      loadConvention?: never;
      repBasis: "TOTAL" | "PER_SIDE";
    }
  | {
      profile: "REPS_BODYWEIGHT_PLUS_LOAD";
      loadConvention: "ADDED_EXTERNAL_LOAD";
      repBasis: "TOTAL" | "PER_SIDE";
    }
  | {
      profile: "REPS_ASSISTED";
      loadConvention: "DISPLAYED_ASSISTANCE";
      repBasis: "TOTAL" | "PER_SIDE";
    };
```

`PER_SIDE` means one set stores the prescribed/performed reps for each side, not their sum. The first slice does not store independent left/right results. Alternating versus simultaneous execution remains part of the stable exercise identity and display/cue; it needs no separate machine-readable field because only `repBasis` changes numeric interpretation.

`BARBELL_TOTAL`, `IMPLEMENT_WEIGHT`, and `ADDED_EXTERNAL_LOAD` retain the application's pounds contract. `MACHINE_DISPLAYED` and `DISPLAYED_ASSISTANCE` mean the exact number shown by the equipment and deliberately claim no physical unit. The convention therefore determines the UI wording and storage behavior; a separate unit column is unnecessary.

### 5.2 Profile contracts

| Profile | Prescription | Performed log | Forbidden / nonsensical | Zero and missing handling | Comparable dimensions |
| --- | --- | --- | --- | --- | --- |
| `REPS_EXTERNAL_LOAD` | target reps greater than zero; target load optional and positive | performed reps and load required; RPE/note optional | assistance, bodyweight, duration, distance | Performed reps may be zero for a failed attempt; load must be greater than zero. Missing either makes an unskipped snapshot set incomplete. | Load, reps, optional RPE under the exact identity/convention/basis gate. |
| `REPS_BODYWEIGHT` | target reps greater than zero; no target load | performed reps required; RPE/note optional | external load, assistance, duration, distance | Performed reps may be zero. Store no load and never synthesize zero. | Reps and optional RPE. Bodyweight is not captured or normalized in this slice. |
| `REPS_BODYWEIGHT_PLUS_LOAD` | target reps greater than zero; target added load optional and positive | performed reps and added load required; RPE/note optional | assistance, duration, distance | Performed reps may be zero; added load must be greater than zero. Zero-added-load work uses the bodyweight identity. | Added load, reps, optional RPE. |
| `REPS_ASSISTED` | target reps greater than zero; target assistance optional and positive | performed reps and displayed assistance required; RPE/note optional | added-load interpretation, duration, distance | Performed reps may be zero; assistance must be greater than zero. Larger assistance means easier. | Assistance, reps, optional RPE; direction is decreasing assistance. |

Skipped sets require no measurement values. New snapshot rows require reps even though the legacy validator currently accepts RPE-only logs. RPE remains an optional 1–10 effort observation; RIR is not added. Warm-ups use the owning `WorkoutExercise` profile. Legacy rows retain current validation, including zero-load normalization where it already applies.

First-slice UI labels are derived without catalog rereads: `BARBELL_TOTAL` → “Total barbell load (lb),” `IMPLEMENT_WEIGHT` → “Weight per implement (lb),” `MACHINE_DISPLAYED` → “Machine displayed value,” `REPS_BODYWEIGHT_PLUS_LOAD` → “Added load (lb),” and `REPS_ASSISTED` → “Displayed assistance (less is harder).” `REPS_BODYWEIGHT` hides the load control and says “Bodyweight — reps only.”

`REPS_BODYWEIGHT` remains distinct from a future `REPS_ONLY` because it changes the user-facing label, forbids external load, protects bodyweight history from unknown-resistance work, and freezes useful future-compatible meaning. `REPS_ONLY`, duration, distance, completion, generic metric arrays, and unit conversion remain outside the pilot.

### 5.3 Authority

- The catalog entry owns the latest valid default semantics for future placement and acceptance.
- A plan placement may choose only a catalog-declared execution identity, not override its measurement profile or load convention.
- The accepted seed freezes the complete three-field `MeasurementSemantics` selected at acceptance.
- The workout copies that exact snapshot at materialization. Runtime add/swap copies the replacement catalog snapshot at the mutation boundary and records the edit as today.
- Set prescriptions and performed logs are interpreted only through the workout snapshot.
- Completed and in-progress workout meaning never follows later catalog edits.

## 6. Load-semantics conventions

| Context | First-slice convention | Machine-readable? | Comparison rule |
| --- | --- | --- | --- |
| Barbell | Total external load on the bar, including the bar; collars may be ignored consistently | `BARBELL_TOTAL` | Same exercise ID, convention, and rep basis only. |
| One or more equal dumbbells/kettlebells | Weight of one implement; for bilateral work this is still one implement, not the sum | `IMPLEMENT_WEIGHT` | Same exercise ID, convention, and rep basis only. This preserves Trainer's current per-dumbbell convention and also covers unilateral work. |
| Cable or selectorized machine | Exact number displayed by that machine; no unit, pulley, or leverage claim | `MACHINE_DISPLAYED` | Raw history may be shown, but automatic load records/suggestions are disabled until stable unit/context meaning exists. Different calibration alone does not require a new exercise ID. |
| Plate-loaded machine | Either total added plates or plates per side, excluding unmarked machine mass | Deferred `PLATE_LOADED_TOTAL` or `PLATE_LOADED_PER_SIDE` | Do not assign one global convention. Not in the first pilot; the catalog entry must choose explicitly before classification. |
| Bodyweight | No numeric load | profile discriminator | Compare reps/RPE; optional bodyweight is context. |
| Bodyweight plus external load | Added external load only; do not add bodyweight into `load` | `ADDED_EXTERNAL_LOAD` | Same weighted identity/convention/basis only. |
| Assisted movement | Exact number displayed as assistance/counterweight; larger means easier; no physical unit claim | `DISPLAYED_ASSISTANCE` | Use only for a reviewed machine whose display is verified to increase with assistance. Other assistance mechanisms remain unclassified. Raw history may be shown; automatic suggestions are disabled without stable context and never compare with bodyweight or weighted IDs. |
| Sled | Added load excluding unmarked tare plus distance | Deferred with distance profile | No friction/tare conversion and no first-slice support. |
| Unknown/noncanonical equipment | Remains unclassified | None | Legacy behavior only; do not invent `REPS_ONLY` or numeric equivalence. |

The machine-readable part is only profile, load convention, and rep basis. Guidance such as “include the bar” or “record one dumbbell” is deterministic copy derived from the convention. Pounds apply only to the three physical-load conventions; displayed-machine conventions store the shown number. Manufacturer model, cable ratio, seat setting, and calibration are not conversion inputs.

## 7. Catalog-versus-snapshot ownership

| Field | Catalog authority | Accepted-seed snapshot | Workout snapshot | Mutable advisory metadata |
| --- | --- | --- | --- | --- |
| Exercise ID | Stable executable identity | Required | Required existing FK | No |
| Display name | Current display/search label | No | No; live display is acceptable | Yes, safe in place |
| Aliases | Search/display resolution to one ID | No | No | Yes; collisions rejected, never relink history |
| Measurement profile | Latest future default | Full discriminator required | Exact copy required | No |
| Load convention | Latest future default when profile uses load | Required only for load-bearing profiles | Exact copy; null only for bodyweight | No |
| Rep basis | Latest future default | Required for rep profiles | Exact copy required | No |
| Bilateral/unilateral mode | Existing identity/classification fact | Freeze only its numeric consequence, `repBasis` | Exact `repBasis` copy | `isUnilateral` and wording remain catalog/display data |
| Alternation | Identity-defining when independently selected | No separate first-slice field; the exercise ID and `repBasis` are sufficient | No separate field | Display name/cue may remain live; changing the action requires a new ID |
| Equipment | Classification, eligibility, and authoring constraint | Do not copy full list; load convention freezes executable consequence | Do not copy full list | Yes, unless changing it would invalidate identity |
| Body position | Classification / identity description | No | No | Yes unless identity-defining |
| Grip / stance / ROM | Placement attribute or cue by default | Only if a future prescription makes it executable | Workout note/cue when prescribed | Yes |
| Muscle groups | Authoring/Plan Health classification | No | Existing stimulus snapshot separately freezes performed accounting | Yes for future planning |
| Movement pattern | Authoring/Plan Health classification | No | Existing workout snapshot remains | Yes for future planning |
| Safety/limitation tags | Plan Health/eligibility constraint | No | Applied decision may be captured by existing evidence | Yes for future planning |
| Authoring classes / main-lift eligibility | Plan Health/selection constraint | Role is already frozen; classes are not | Existing role/section fields | Yes |
| Default cues | Catalog display guidance | No | Copy only when prescribed as workout notes | Yes |

The seed must not copy advisory classification merely because it was used at authoring time. Plan Health can continue to read current catalog facts before acceptance. Accepted execution meaning is the small snapshot, not a duplicate exercise catalog.

## 8. User-created exercise policy

There is no supported user-created-exercise creation flow in the current application. Noncanonical database rows exist as a compatibility category, but the repository does not prove who created them or with what semantics. The first implementation slice must preserve them, not invent ownership.

When a creation flow is added, require only:

- display name;
- one measurement profile;
- one compatible load convention when the profile uses load;
- rep basis (`TOTAL` or `PER_SIDE`) for rep profiles.

Equipment, muscle groups, pattern, aliases, and cues may remain optional. If a future custom flow cannot establish a supported convention, it must leave the exercise unclassified rather than invent `REPS_ONLY` or comparable numeric load.

After an exercise is referenced:

- display name, aliases, and advisory metadata may change in place;
- correcting a default changes future seed/add snapshots only; existing snapshot values remain unchanged;
- changing measurement profile, load direction, or identity-defining execution should create a new exercise ID;
- old accepted seeds and workouts retain their embedded snapshots;
- duplicate detection is advisory; it can suggest an existing canonical ID but cannot merge automatically;
- linking or merging is out of scope. A future link may improve search, but must never rewrite old `exerciseId` values or history.

The rep-based pilot need not expose the creation UI. It must make the data contract safe for a later custom flow and keep unclassified rows on the legacy path.

## 9. Compatibility and migration strategy

Use additive, mixed-version compatibility. Do not rewrite historical sets, workouts, or accepted seeds.

1. Add nullable catalog and workout execution-semantics fields. Existing rows remain valid.
2. Add a custom-hypertrophy accepted-seed V3 whose canonical exercise rows require `MeasurementSemantics` and whose runtime projection is executable V2. Existing accepted V1/V2 payloads and executable V1 projections remain byte-for-byte valid.
3. Classify only a reviewed pilot catalog subset. Initially, only an all-classified custom-hypertrophy plan is eligible for accepted V3. Mixed or unclassified custom plans continue explicit accepted V2 and legacy runtime behavior; other accepting sources remain V1 until deliberately migrated.
4. For a new v3 seed, acceptance reads the catalog default once, validates it, and embeds it in the canonical hashed payload. Runtime never re-infers it.
5. Materialization copies v3 semantics to the nullable `WorkoutExercise` execution-snapshot columns. Legacy seeds leave all snapshot columns null and retain existing UI/log/history behavior.
6. Do not infer a historical snapshot from today's catalog. That would silently reinterpret old data after catalog edits.
7. Do not persist inferred defaults onto old accepted seeds or workouts. `measurementProfile == null` selects the existing legacy behavior. Legacy records may continue their current exact-ID history and suggestion path for compatibility, but never satisfy a classified snapshot comparison and are never presented as having a proven load convention.
8. Preserve existing dumbbell display behavior for legacy workouts. It is presentation compatibility, not proof that every old dumbbell log is semantically exact.
9. Existing `slotPlanSeedJson` remains a compatibility source only. It never receives or overrides a v3 measurement snapshot.
10. Do not remove or rename pilot IDs during this slice. Archive status and general catalog retirement are deferred; accepted-seed JSON's missing-FK risk remains a separately owned catalog-lifecycle issue.

No automatic backfill is safe across the entire catalog. A future report may identify a narrow set of unambiguous rows, but backfilling still offers little value because it cannot prove which convention the user followed. Prefer legacy labeling over synthetic certainty.

## 10. Seed and runtime boundary

### Chosen representation: frozen execution snapshot

The minimum new runtime projection is source-neutral:

```ts
type ExecutableSeedProjectionV2 = {
  version: 2;
  slots: Array<{
    slotId: string;
    exercises: Array<{
      exerciseId: string;
      role: "CORE_COMPOUND" | "ACCESSORY";
      setCount: number;
      measurement: MeasurementSemantics;
    }>;
  }>;
};
```

The first emitting source needs this exact canonical contract:

```ts
type AcceptedHypertrophySeedV3 = {
  version: 3;
  source: "custom_hypertrophy_plan_v1";
  settings: AcceptedHypertrophySeedV2["settings"];
  slots: Array<{
    slotId: string;
    name: string;
    focus: AcceptedHypertrophySeedV2["slots"][number]["focus"];
    exercises: Array<{
      exerciseId: string;
      role: "CORE_COMPOUND" | "ACCESSORY";
      setCount: number;
      intent: AcceptedExerciseIntentV2;
      measurement: MeasurementSemantics;
    }>;
  }>;
};
```

The accepted payload version must advance because measurement semantics become required, hash-covered executable truth. Existing V2 is strict and lacks measurement: optional V2 fields would permit ambiguous mixed rows, while required fields would invalidate old payloads. V3 retains only the already-required V2 authoring fields because the current editable-copy flow reads them; it adds no new planning fields. `normalizeAcceptedSeedPayload()` strictly parses and hashes the full canonical V3, then projects only `exerciseId`, `role`, `setCount`, and `measurement` into executable V2. Runtime materialization consumes that projection, never the authoring fields. Other acceptance sources can define a V3 canonical envelope only when migrated, but must project this same executable V2 contract.

```text
catalog execution default
        |
        | compile/accept once
        v
accepted immutable seed v3
  exerciseId + role + setCount + measurement snapshot
        |
        | copy, never re-infer
        v
WorkoutExercise execution snapshot
        |
        | interprets prescription and performed log
        v
logged performance
```

Planning specifications, candidates, and diagnostics may feed the compiler in the future but are never runtime fallback or workout authority.

| Alternative | Determinism | Historical correctness | Runtime / migration burden | Decision |
| --- | --- | --- | --- | --- |
| Extend V2 additively | Optional measurement permits ambiguous mixed V2; required measurement breaks existing V2 parsing | Weak mixed-version boundary | Breaks strict parsing or old rows | Reject |
| Accepted V3 plus executable V2 projection | Full canonical V3 is hash-covered; runtime projection is source-neutral | Strong; old meaning survives catalog edits | Retains the existing custom-plan envelope and adds three fields per row | Choose |
| Workout-only snapshot | Uses catalog at materialization | A plan accepted before a catalog edit can change before its workout exists | Small seed, nondeterministic future workout | Reject |
| Immutable catalog revision reference | Deterministic if every revision is retained | Strong | New revision tables, lookup lifecycle, custom-entry complexity | Reject for this slice |

An accepted v3 seed may display the live catalog name, but it executes and logs through the frozen snapshot. Missing catalog rows remain the current hard integrity error because `WorkoutExercise.exerciseId` is a foreign key; the pilot does not delete catalog IDs.

Runtime add/swap is session-local. For a v3 workout, the mutation reads and validates the replacement's current catalog default at commit time and persists the three workout columns atomically; preview data is advisory. Unclassified replacements are excluded/blocked. A swap is already limited to rows with no logs and replaces the old workout snapshot. Legacy workouts retain current add/swap behavior. Neither operation corrects the accepted seed; canonical correction remains an explicit new seed revision.

## 11. Progression interface boundary

This slice does not store a comparison key or redesign progression. Compatibility is derived from existing `exerciseId` plus the three frozen workout fields:

```ts
type ComparableExecutionKey = {
  exerciseId: string;
  profile: MeasurementProfile;
  loadConvention?: LoadConvention;
  repBasis: RepBasis;
};
```

Classified history is automatically comparable only when the keys are identical. Exact exercise ID remains mandatory; a matching profile across different IDs is not enough. A null-snapshot record has no derived key: legacy-to-legacy reads retain today's exact-ID behavior, while legacy and classified records never feed the same record, prior-load suggestion, or progression comparison.

| Profile | Comparable performance dimensions | Direction exposed to future progression |
| --- | --- | --- |
| `REPS_EXTERNAL_LOAD` | load, reps, optional RPE | More load or reps at comparable effort |
| `REPS_BODYWEIGHT` | reps, optional RPE | More reps at comparable effort; no bodyweight normalization |
| `REPS_BODYWEIGHT_PLUS_LOAD` | added load, reps, optional RPE | More added load or reps at comparable effort |
| `REPS_ASSISTED` | assistance, reps, optional RPE | Less assistance or more reps at comparable effort |

Do not auto-compare:

- assisted, bodyweight, and weighted identities with one another;
- per-implement and total-load records;
- different rep bases;
- `MACHINE_DISPLAYED` or `DISPLAYED_ASSISTANCE` records when no stable machine-context discriminator exists;
- any legacy record when evaluating a classified workout (and any classified record when evaluating a legacy workout);
- warm-up logs or finisher-protocol results as ordinary work-set progression evidence.

Raw exact-ID exposures may still be displayed. Classified computed load records and previous-load suggestions require an exact derived-key match and a convention approved for automatic comparison. Machine-context-unknown classified records fail closed. The separate legacy cohort retains current behavior without acquiring inferred semantics. No generalized equivalence or stored key is added.

## 12. Versioning and mutability rules

Use accepted seed `version: 3` as the only new accepted-payload version and executable `version: 2` as the only new runtime projection. On workout rows, `measurementProfile IS NULL` is the legacy discriminator. The explicit enum columns and payload/projection versions define the shapes; catalog revisions, snapshot schema versions, and per-exercise unit versions are unnecessary.

| Edit | Rule |
| --- | --- |
| Rename, spelling, alias, cue | Safe in place. Does not change execution. |
| Muscle, pattern, authoring tag | Safe for future planning, subject to existing audit/review rules. Does not rewrite performed meaning. |
| Correct display copy for an unchanged convention | Safe in place. |
| Change profile, load direction, rep basis, or load convention | Use a new exercise ID when it describes a different action. A correction to the same ID affects only future acceptance/add snapshots; frozen seeds/workouts retain their values and no revision number is needed to compare the actual fields. |
| Change fixed-path/free-weight or execution-distinct implement | New exercise ID. |
| Change a plan after acceptance | New immutable seed revision through the existing correction path. |
| Delete a pilot or referenced exercise | Forbidden in this slice. General archive/retirement behavior is deferred. |
| Edit an accepted seed snapshot or workout snapshot | Forbidden. |

## 13. Required examples

| Case | Executable identity | Profile / load convention | Required log | Comparable history | Frozen facts | Variant split? |
| --- | --- | --- | --- | --- | --- | --- |
| Barbell back squat | Existing barbell-specific ID | `REPS_EXTERNAL_LOAD` / `BARBELL_TOTAL` | reps + total bar load | Exact derived key: load/reps/RPE | profile, convention, `TOTAL` | Goblet, Smith, belt, safety-bar, and machine squat are separate when independently selected. Minor stance is a cue. |
| Goblet squat | Existing one-implement ID | `REPS_EXTERNAL_LOAD` / `IMPLEMENT_WEIGHT` | reps + implement weight | Exact derived key: load/reps/RPE | profile, convention, `TOTAL` | Barbell squat is separate. Dumbbell/kettlebell may share because both use one implement; no physical equivalence is claimed outside the exact ID. |
| Dumbbell bench press | Existing bilateral DB-press ID | `REPS_EXTERNAL_LOAD` / `IMPLEMENT_WEIGHT` | reps + weight of one dumbbell | Exact derived key: load/reps/RPE | profile, convention, `TOTAL` | Alternating or single-arm press gets a separate ID when independently selected. |
| Alternating dumbbell curl | Existing alternating ID | `REPS_EXTERNAL_LOAD` / `IMPLEMENT_WEIGHT` | reps per side + one-dumbbell weight | Exact derived key: load/reps/RPE | profile, convention, `PER_SIDE` | Simultaneous bilateral curl remains a separate ID. Grip cue alone need not split. |
| Bodyweight pull-up | Existing unweighted ID | `REPS_BODYWEIGHT` | reps | Exact derived key: reps/RPE | profile, null convention, `TOTAL` | Weighted and assisted are separate. Bodyweight is not captured in the first slice. |
| Weighted pull-up | Existing weighted ID | `REPS_BODYWEIGHT_PLUS_LOAD` / `ADDED_EXTERNAL_LOAD` | reps + added load | Exact derived key: added load/reps/RPE | profile, convention, `TOTAL` | Zero-added-load work belongs to bodyweight pull-up. |
| Assisted pull-up | New machine-assisted ID | `REPS_ASSISTED` / `DISPLAYED_ASSISTANCE` | reps + displayed assistance | Raw exact-ID history only until machine context exists | profile, convention, `TOTAL` | Band-assisted pull-up is distinct and remains unclassified until a bounded recording convention is justified. |
| Cable row | Existing cable-row ID | `REPS_EXTERNAL_LOAD` / `MACHINE_DISPLAYED` | reps + displayed stack | Raw exact-ID history only until machine context exists | profile, convention, `TOTAL` | Plate-loaded and free-weight rows are separate actions. Handle is a cue unless independently prescribed. |
| Plate-loaded leg press | Separate plate-loaded ID after catalog review | Deferred `REPS_EXTERNAL_LOAD` with either total or per-side plate convention | reps + explicitly labeled plate value | No automatic load comparison without machine context | Future profile/convention/basis | Generic legacy `Leg Press` is not silently reclassified; calibration alone need not create more IDs. Not in the pilot. |
| Plank | Timed plank ID | `DURATION` | seconds | Same ID/snapshot duration/RPE | profile, seconds | Dynamic rep plank is separate. Weighted timed plank is deferred. Not in first implementation slice. |
| Farmer carry | Two-implement farmer-carry ID | Deferred distance profile / implement weight | distance + one-implement weight; time optional | Deferred | Future profile/convention/basis | Suitcase, trap-bar, and single-arm carry are separate when execution/logging changes. |
| User-created uncertain machine | Existing noncanonical ID, if any | Unclassified legacy | Current legacy reps/load/RPE behavior | Excluded from classified automatic comparison | No new snapshot | A future creation flow must require explicit semantics; this slice neither creates nor merges custom exercises. |

## 14. Edge-case matrix

| Edge case | Desired behavior | Authority owner | Compatibility treatment | First slice? |
| --- | --- | --- | --- | --- |
| Catalog display name changes after plan acceptance | Show the current name; execution remains unchanged | Live catalog for display, seed snapshot for meaning | No seed/workout rewrite | Yes |
| Measurement profile changes after logged workouts exist | Old seed/workout retains old values; a different action gets a new ID; a same-ID correction is future-only | Catalog future default; frozen historical snapshots | Derived keys differ; no auto-comparison | Yes |
| Assisted exercise compared with weighted exercise | Never auto-compare; show separate history | Exercise IDs and profiles | Legacy ambiguous bodyweight loads remain noncomparable | Yes |
| Unilateral exercise logged once versus per side | Snapshot label and validation say `TOTAL` or `PER_SIDE`; the first slice stores one value, not left/right | Workout snapshot | Legacy remains ambiguous | Yes |
| Dumbbell load recorded per hand versus total | The first slice always labels/stores per implement for the corresponding identity | Workout snapshot | Do not convert old numbers; preserve legacy display | Yes |
| Machine swap with different stack calibration | Keep the exercise ID when the action/convention is unchanged, show raw history, and suppress automatic load comparison without context | Workout snapshot plus comparison gate | No conversion or history rewrite | Gate yes; machine context later |
| Custom exercise lacking equipment metadata | Leave unclassified; do not infer from name/equipment | Future custom catalog owner | Existing noncanonical row remains legacy | No creation flow in this slice |
| Deleted or archived catalog exercise referenced by history | Existing workout/template FKs still protect rows, while seed JSON does not; pilot IDs are not removed | Existing catalog lifecycle and runtime missing-ID failure | Archive schema deferred; no history rewrite | No |
| Old seed without execution snapshot | Replay through legacy path; do not read today's semantics as accepted truth | Seed version | Null workout snapshot and legacy UI/log behavior | Yes |
| Old workout with ambiguous load | Preserve raw reps/load/RPE and current legacy exact-ID behavior; do not let it feed classified records or claim a proven convention | Historical workout/log | No inferred backfill; null snapshot selects legacy cohort | Yes |
| Exercise alias collision | Reject the new alias; never reassign history or silently point it elsewhere | Catalog alias uniqueness and sync validation | Existing ID/history unchanged | Yes |
| Same movement with different measurement mode | Separate IDs, such as timed versus dynamic plank | Exercise identity | Existing overloaded entry stays legacy until curated | Yes as acceptance validation; non-rep UI later |
| Timed versus rep-based use of same movement | Do not allow placement-level mode override; choose the matching ID | Exercise identity and seed snapshot | Legacy note-based use remains legacy | Yes as model rule; duration UI later |
| Bodyweight change affects interpretation | Do not capture or normalize it in the first slice; compare reps/RPE only and disclose the limitation | Workout snapshot profile | Old and new bodyweight history remain reps/RPE only within their separate cohorts | Yes |
| Plan accepted before catalog semantics update but started afterward | Accepted seed snapshot wins exactly | Current accepted seed revision | Old seed without snapshot stays legacy; never upgrade at start | Yes |

## 15. Options considered and rejected

### A. Catalog measurement metadata only

Rejected. Logging, history, and accepted plans would continue interpreting mutable catalog data. This creates a visible field without an executable authority.

### B. Catalog metadata plus freeze it into newly accepted seeds

Rejected as incomplete. The seed would know the meaning, but workout materialization, UI, logs, and history would still use the old generic contract or live equipment. That creates seed-versus-workout dual truth.

### C. Catalog metadata, seed snapshot, and measurement-aware workout materialization/logging

Chosen, bounded to four proven rep profiles and a reviewed pilot catalog. It is the smallest slice whose accepted plan, workout, log, and history agree end to end.

### D. Immutable catalog revisions first

Rejected. Revision tables and dereference rules add lifecycle and custom-entry complexity without improving over a complete small snapshot. The catalog remains the authoring default; seed and workout snapshots own accepted/performed meaning.

### E. Workout snapshot without accepted-seed snapshot

Rejected. A plan accepted before a catalog edit and materialized afterward would acquire the later catalog meaning. The seed snapshot is required to preserve future-workout determinism; the workout copy is required to preserve the created workout.

Also rejected:

- exercise names as executable keys;
- an exercise family/variant inheritance hierarchy;
- placement-level arbitrary profile overrides;
- generic `metrics[]` or unit-conversion registries;
- silent inference/backfill from equipment or names;
- cross-equipment load ratios;
- encoding time/distance as reps;
- merging canonical and custom history.

## 16. Recommended smallest implementation slice

Implement option C as a **rep-profile pilot**:

1. Define and centrally validate the four `MeasurementSemantics` variants.
2. Add only nullable profile, load-convention, and rep-basis fields to catalog and workout-exercise rows.
3. Curate a bounded pilot containing barbell total, implement weight, displayed machine load, bodyweight, added load, and displayed assistance. Do not classify ambiguous overloaded or plate-loaded IDs.
4. Add custom-hypertrophy accepted V3 whose every exercise row embeds a validated snapshot and whose executable V2 projection carries the same snapshot. Existing seed contracts remain supported.
5. Copy the snapshot onto `WorkoutExercise` at normal materialization and runtime add/swap.
6. Interpret the existing rep/load/RPE prescription and logging UI through the workout snapshot: required/hidden load, precise label, positive-value validation, and assistance direction.
7. Derive classified comparison compatibility from exact ID plus the three snapshot fields. Keep legacy-to-legacy behavior isolated for compatibility, and suppress unsafe machine-context-unknown classified records and suggestions.

Pilot inclusion requires: an existing stable ID (except the new machine-assisted pull-up identity), one unambiguous rep-based action, one exact supported convention, no overloaded measurement mode, and reviewable UI copy. The initial pilot is:

| Exercise | Profile | Convention | Basis |
| --- | --- | --- | --- |
| Barbell Back Squat | `REPS_EXTERNAL_LOAD` | `BARBELL_TOTAL` | `TOTAL` |
| Goblet Squat | `REPS_EXTERNAL_LOAD` | `IMPLEMENT_WEIGHT` | `TOTAL` |
| Dumbbell Bench Press | `REPS_EXTERNAL_LOAD` | `IMPLEMENT_WEIGHT` | `TOTAL` |
| Alternating Dumbbell Curl | `REPS_EXTERNAL_LOAD` | `IMPLEMENT_WEIGHT` | `PER_SIDE` |
| Pull-Up | `REPS_BODYWEIGHT` | null | `TOTAL` |
| Weighted Pull-Up | `REPS_BODYWEIGHT_PLUS_LOAD` | `ADDED_EXTERNAL_LOAD` | `TOTAL` |
| Machine-Assisted Pull-Up (new identity) | `REPS_ASSISTED` | `DISPLAYED_ASSISTANCE` | `TOTAL` |
| Seated Cable Row | `REPS_EXTERNAL_LOAD` | `MACHINE_DISPLAYED` | `TOTAL` |

Only all-classified custom-hypertrophy plans can opt into V3. For a V3 workout, add/swap choices are limited to classified entries; legacy workout choices are unchanged. Catalog expansion is a reviewed follow-on, not equipment/name inference.

The slice deliberately does not add duration/distance columns or controls. That boundary avoids a larger workout UX and set-model change while delivering coherent end-to-end meaning for Trainer's dominant current behavior.

## 17. Anticipated schema, API, and runtime changes

These are implementation expectations, not changes made by this design.

### Schema

- Prisma enums `MeasurementProfile`, `LoadConvention`, and `RepBasis`
- nullable `Exercise.measurementProfile`, `loadConvention`, and `repBasis` columns
- matching nullable `WorkoutExercise.measurementProfile`, `loadConvention`, and `repBasis` snapshot columns

The code exposes those scalar columns as `MeasurementSemantics`; the database stores no metadata blob. No set/log column, snapshot version, catalog revision, execution mode, unit, comparison key, equipment context, profile table, or catalog-status field is needed. Duration/distance later requires additive target/actual fields and must not overload reps.

Catalog and workout writes enforce one all-or-valid invariant: all three columns null means unclassified/legacy; otherwise `measurementProfile` and `repBasis` are present and `loadConvention` is present or null exactly as the discriminated profile requires. A partial or incompatible tuple is an integrity error, not a legacy fallback. Enforce the same bounded profile/convention combinations in the migration's check constraint and in the shared parser at every write/read boundary; no generic rules table is needed.

### Catalog and validation

- A pure `parseMeasurementSemantics()` validator with exhaustive profile/convention/basis compatibility.
- Catalog sync validates only reviewed pilot JSON semantics; no equipment/name inference and no pilot-ID deletion.
- Accepted V3 eligibility requires every selected exercise to be classified; custom plans with unclassified exercises remain on accepted V2, and other acceptance sources remain unchanged.
- Alias collision remains an explicit validation error.

### Accepted seed and compiler

- Add a strict `AcceptedHypertrophySeedV3` parser/compiler that preserves the existing V2 envelope, resolves catalog defaults into its exercise rows, and continues to support editable-plan copy and compatibility projections.
- Extend `normalizeAcceptedSeedPayload()` with canonical V3 hashing and executable V2 projection. Runtime consumes only the projection, so the accepted authoring envelope does not become a runtime dependency.
- Update accepted-revision readers and corrective-topology checks to accept V3 through the shared normalizer/projection; custom-plan copy accepts either V2 or V3. Do not add a fallback to draft or planning data.
- Keep V0's proven input boundary unchanged unless a later proof explicitly advances it; V0 may compile only to its existing non-persisted result during this slice.
- Existing v1/v2 hashes and payloads remain unchanged.

### Workout APIs and materialization

- Save/materialization DTO carries the accepted measurement snapshot and persists the same three values on `WorkoutExercise`.
- Add/swap mutations on v3 workouts resolve and freeze a complete classified replacement at commit; legacy workouts remain unchanged.
- Set-log validation reads the workout snapshot, not live equipment or the request body, to require or forbid `actualLoad`.
- UI DTO exposes the three fields; `measurementProfile == null` means legacy.
- Logging controls retain reps/load/RPE but change label, visibility, requiredness, and assistance help text by profile.
- For snapshot rows, existing 2.5-lb quantization remains for barbell, implement, and added-load conventions. Machine-displayed and assistance values are persisted exactly as entered (bounded decimal precision) so logging does not rewrite the equipment's number. Legacy quantization remains unchanged; no per-exercise increment or unit framework is introduced.

### History and progression boundary

- History reads the workout fields per performed set and derives classified compatibility; no key is persisted. Null-snapshot records stay in the isolated legacy path.
- Classified previous-load suggestions require an identical derived key and a convention approved for comparison. Machine/assistance conventions fail closed without context; legacy suggestions remain legacy-only.
- Assistance direction comes from `DISPLAYED_ASSISTANCE`, not name matching.
- No new progression policy, e1RM model, or cross-equipment donor scaling is added.

### Plan Health

- V3 eligibility reports unclassified or invalid semantics. Existing v1/v2 acceptance is not disabled.
- Existing muscle/equipment/limitation checks remain advisory/authoring owners and are not copied wholesale into the seed.

## 18. Focused test plan

| Seam | Required tests |
| --- | --- |
| Pure semantics parser | Accept every valid four-profile combination; accept the all-null legacy tuple; reject partial tuples, missing/forbidden convention, missing basis, and unknown profile/convention. |
| Identity/catalog fixtures | Pilot IDs have one exact three-field default; overloaded and plate-loaded legacy entries remain unclassified; no equipment/name inference. |
| Seed normalization/hashing | Full accepted V3 canonicalization covers the retained V2 envelope plus profile, convention, and basis; a measurement change changes the hash; V1/V2 fixtures and executable V1 projections remain unchanged; executable V2 contains no authoring fields. |
| Acceptance/compiler and plan copy | Catalog defaults are resolved once; all-classified custom plans emit V3; mixed plans remain accepted V2; existing settings/name/focus/intent survive V3 plan copy; no new planning metadata is added. |
| Runtime authority | Plan accepted before catalog edit materializes the accepted snapshot; runtime never substitutes current catalog semantics; current revision still wins. |
| Workout save/materialization | Snapshot copies exactly and is transactionally stored with the workout; legacy seed produces null compatibility state; failure is atomic. |
| Add/swap/remove | V3 add/swap atomically freezes a complete classified replacement; unclassified replacement is blocked; swap remains blocked after logs; remove deletes only the runtime-added row. |
| Set log API | Snapshot rows require reps and profile-required load, reject forbidden/zero load, preserve skip behavior, never synthesize bodyweight zero, and preserve displayed machine/assistance numbers while retaining existing free-weight quantization; legacy validation remains unchanged. |
| UI | Correct labels/visibility for barbell total, implement weight, displayed machine load, added load, assistance, bodyweight, and per-side reps; legacy UI remains stable. |
| History | Identical classified keys compare; mismatched profile/convention/basis, assisted-vs-weighted, and machine-context-unknown records do not aggregate automatically; legacy records remain in a separate exact-ID cohort. |
| Previous-load suggestions | Compatible classified records feed existing logic; classified and legacy cohorts never mix; legacy-to-legacy behavior remains unchanged; assistance direction is exposed without changing progression policy. |
| Catalog-ID integrity | Pilot implementation removes no IDs; a missing accepted ID continues to fail closed. Archive lifecycle is not asserted by this slice. |
| Contract/integration | Existing v1/v2 seed replay, `slotPlanSeedJson` fallback, custom hypertrophy acceptance, template generation, warm-ups, and exact workout provenance remain intact. |

The implementation should use the repository-selected verification plan after the actual diff is known. Database mutation, production audit, and deployment verification are not part of this documentation design.

## 19. Rollout and rollback

Roll out additively:

1. Deploy nullable schema/read compatibility before emitting v3 seeds.
2. Populate only the reviewed pilot semantics and verify catalog integrity in a non-production review workflow.
3. Enable v3 acceptance for the pilot behind one acceptance capability gate; keep legacy seed replay enabled.
4. Observe rejected/unclassified selection counts, classified/legacy cohort isolation, and snapshot integrity without mutating plan behavior.
5. Expand the catalog only through reviewed, evidence-backed classification.

Rollback:

- disable new v3 acceptance and new snapshot-mode selection;
- continue reading/logging already-created snapshot workouts with the backward-compatible code;
- retain additive columns and v3 accepted revisions; never downgrade or rewrite them;
- correct catalog defaults only for future acceptance/additions, never by rewriting snapshots;
- if a catalog value describes a different action, create a distinct ID and, when necessary, an explicit accepted seed correction revision.

An application rollback to code that cannot read already-emitted v3 seeds is unsafe. The capability gate must remain off until the read path is deployed and verified first.

## 20. Explicit non-goals

- Persistent semantic plan specifications.
- Progression-policy or load-calibration redesign.
- Universal fitness ontology or all-modality catalog coverage.
- Arbitrary units or a conversion framework.
- Left/right independent set logging.
- Machine equivalence, pulley-ratio, leverage, sled-friction, or bodyweight-normalized calculations.
- Machine-instance/context storage and automatic machine-load comparison.
- Catalog archive/status or general retirement workflow.
- Historical workout, set, or seed backfill.
- Automatic canonical/custom merging or duplicate resolution.
- Exercise family, inheritance, plugin, or rules-engine architecture.
- Preparation/closeout, finisher, superset, or warm-up redesign.
- Duration/distance set UX in the first implementation slice.
- Runtime fallback to any planning specification.
- Migration of legacy `slotPlanSeedJson` into a competing authority.

## 21. Open product decisions

No product decision blocks the recommended rep-profile pilot. It retains the current pounds contract, records one implement for dumbbell/kettlebell work, disables machine-context-unknown automatic load comparison, and does not add custom merging.

Before the later duration/distance slice, product should decide:

1. whether farmer-carry duration is optional context or a required pace dimension;
2. whether a later bodyweight profile should capture session bodyweight;
3. whether users need machine-instance selection or whether raw machine history without automatic suggestions is sufficient;
4. whether a future plate-loaded entry records total added plates or plates per side.

Those decisions do not change the snapshot authority or the four-profile rep pilot.

## 22. Final verdict

**READY FOR IMPLEMENTATION**

Exercise identity, rep-based measurement, load direction, seed/workout authority, and mixed-version compatibility are sufficiently resolved for a bounded vertical slice. The current set model is adequate for the four retained profiles by reinterpreting no existing rows and adding no set/log columns. `REPS_ONLY`, duration, distance, and plate-loaded conventions remain deferred until a concrete owner and contract exist.

The implementation boundary is coherent only if catalog semantics, accepted V3 plus executable V2 projection, workout snapshots, profile-aware logging, and comparison gating land together for a reviewed pilot. Catalog-only or seed-only delivery would create dual truth. Historical data remains raw and unchanged, accepted seed revisions remain the sole runtime plan authority, and classified comparison is never claimed across incompatible equipment, identities, profiles, or legacy records.
