# Exercise Execution and Measurement Foundation

Status: proposed implementation design
Scope: bounded catalog semantics and measurement-aware execution
Decision verdict: **READY FOR IMPLEMENTATION**

## 1. Executive recommendation

Trainer should keep `Exercise.id` as the stable executable identity, add a small versioned execution-semantics default to catalog entries, freeze the complete selected semantics into every newly accepted seed row, and copy that snapshot onto each materialized `WorkoutExercise`.

The first implementation should be a bounded rep-based vertical slice. It should support:

- `REPS_EXTERNAL_LOAD`
- `REPS_BODYWEIGHT`
- `REPS_BODYWEIGHT_PLUS_LOAD`
- `REPS_ASSISTED`
- `REPS_ONLY`

It should classify only a reviewed pilot set of exercises, emit a new accepted-seed contract for those exercises, materialize the snapshot, validate and label existing rep/load/RPE controls by profile, and gate history suggestions on compatible identity and semantics. It should not persist a planning specification or change the accepted-seed authority chain.

Two additional profiles are defined now so the model does not dead-end:

- `DURATION`
- `DISTANCE_WITH_OPTIONAL_DURATION`

They should not be implemented in the first slice. The current required `WorkoutSet.targetReps`, rep/load/RPE-only log, and workout UI cannot faithfully represent them. Adding them is a separate, bounded set-contract and UI slice.

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
| Catalog classification | `Exercise`, `ExerciseEquipment`, `ExerciseMuscle`, aliases, variations, substitution rules | Checked-in `prisma/exercises_comprehensive.json` and alias data populate rows | There is no stored normalized name or general exercise category; search normalization is transient and patterns/split tags/muscles/equipment provide classification. No measurement profile, load convention, alternation, body position, catalog status, ownership, or semantics version exists. `isUnilateral` is insufficient to define how a set is logged. |
| Named variations | `ExerciseVariation` stores a label, optional variation type, and loose metadata under a parent exercise | Catalog/display metadata | Seeds, workout exercises, and history do not reference a variation ID. It is not a stable executable identity and cannot carry measurement authority. |
| Seeded versus noncanonical rows | Checked-in JSON defines the canonical seed set | Seed pruning retains noncanonical rows referenced by workout history or templates | There is no first-class user-created-exercise model or creation API. Accepted-seed JSON is not a foreign key, so an exercise referenced only by a seed can currently be pruned. |
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
- `src/app/api/logs/set/route.ts` and `src/lib/getSetValidity.ts`: current performed-log contract.
- `src/components/log-workout/WorkoutActiveSetCard.tsx`: current controls and equipment-derived labels.
- `src/lib/api/exercise-history.ts`, `src/lib/api/workout-context.ts`, `src/lib/engine/apply-loads.ts`, and `src/lib/engine/load-calibration.ts`: history and load interpretation.

Relevant history supports the same boundary: immutable accepted seed revisions were established in `e191102a`, workout stimulus semantics were frozen in `ea8cca54`, exact seed provenance was promoted in `de2a986d`, and the V0 compiler proof merged in `d7fc82d9`.

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
10. **Deletion protection is incomplete.** Workout and template foreign keys protect referenced rows; accepted-seed JSON does not. Runtime fails if an accepted seed's ID is missing.
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
- fixed-path versus free-weight, or a machine/implement change, makes numeric history noncomparable;
- the form has materially different safety, eligibility, or progression direction and is selected deliberately by the user.

Do not split solely because a display label, coaching cue, minor grip/stance, or authoring classification changes.

| Difference | Default classification | Split into a new ID when... |
| --- | --- | --- |
| Movement pattern | Catalog classification | The performed action is materially different, not merely classified differently. |
| Equipment class / implement | Identity-defining execution fact | Load convention or comparison changes. Barbell squat and goblet squat are separate. Dumbbell and kettlebell goblet squat may share only if both use one-implement total load and the product accepts same-ID comparison; otherwise split. |
| Physical machine | Placement/workout context | Its displayed or effective load is not comparable with the machine represented by the existing ID. Create a separate machine-specific/custom ID; never apply a conversion ratio. |
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

Use an explicit discriminated JSON value shared by catalog validation, accepted-seed normalization, workout materialization, logging validation, and history projection:

```ts
type ExecutionSemanticsHeaderV1 = {
  version: 1; // snapshot schema version
  catalogRevision: number; // future-only revision of this ID's semantics
  executionMode:
    | "BILATERAL_SIMULTANEOUS"
    | "UNILATERAL_ALTERNATING"
    | "UNILATERAL_SEQUENTIAL";
};

type ExecutionSemanticsV1 = ExecutionSemanticsHeaderV1 &
  (
    | {
        profile: "REPS_EXTERNAL_LOAD";
        loadConvention:
          | "TOTAL_EXTERNAL_LOAD"
          | "PER_IMPLEMENT"
          | "DISPLAYED_MACHINE_LOAD"
          | "PLATE_LOAD_PER_SIDE";
        repBasis: "TOTAL" | "PER_SIDE";
        massUnit: "LB";
      }
    | {
        profile: "REPS_BODYWEIGHT";
        repBasis: "TOTAL" | "PER_SIDE";
      }
    | {
        profile: "REPS_BODYWEIGHT_PLUS_LOAD";
        loadConvention: "ADDED_EXTERNAL_LOAD";
        repBasis: "TOTAL" | "PER_SIDE";
        massUnit: "LB";
      }
    | {
        profile: "REPS_ASSISTED";
        loadConvention: "DISPLAYED_ASSISTANCE";
        repBasis: "TOTAL" | "PER_SIDE";
        massUnit: "LB";
      }
    | {
        profile: "REPS_ONLY";
        repBasis: "TOTAL" | "PER_SIDE";
      }
    | {
        profile: "DURATION";
        durationUnit: "SECOND";
      }
    | {
        profile: "DISTANCE_WITH_OPTIONAL_DURATION";
        loadConvention?: "TOTAL_EXTERNAL_LOAD" | "PER_IMPLEMENT";
        massUnit?: "LB";
        distanceUnit: "FOOT";
        durationUnit: "SECOND";
      }
  );
```

`PER_SIDE` means one set stores the prescribed/performed reps for each side, not the sum. It does not store independent left and right results. `executionMode` freezes whether the action is bilateral-simultaneous, unilateral-alternating, or unilateral-sequential; a mode change is a new executable identity, not a placement override.

The V1 canonical units are pounds, seconds, and feet because those are the application's current mass convention and the smallest needed additions. Display conversion is out of scope. Unit identifiers are frozen even when the UI currently displays only pounds.

### 5.2 Profile contracts

| Profile | Required performed values | Optional values | Forbidden / nonsensical | Zero and missing handling | Comparable dimensions |
| --- | --- | --- | --- | --- | --- |
| `REPS_EXTERNAL_LOAD` | reps, load | RPE, note | assistance, bodyweight, duration, distance | Load must be greater than zero. Missing reps or load makes an unskipped set incomplete. | Same exercise ID + identical semantics version/convention/rep basis: load, reps, optional RPE. |
| `REPS_BODYWEIGHT` | reps | session bodyweight snapshot, RPE, note | external load, assistance, duration, distance | No load value is stored; do not synthesize zero. Missing reps is incomplete. | Reps and optional RPE. Bodyweight is context, not an automatic normalized-load calculation. |
| `REPS_BODYWEIGHT_PLUS_LOAD` | reps, added load | session bodyweight snapshot, RPE, note | assistance, duration, distance | Added load must be greater than zero. Zero belongs to the bodyweight identity. | Added load, reps, optional RPE; bodyweight may be displayed as context. |
| `REPS_ASSISTED` | reps, displayed assistance | session bodyweight snapshot, RPE, note | added-load interpretation, duration, distance | Assistance must be greater than zero. Larger assistance means easier. | Assistance descending, reps, optional RPE. Never compare with weighted/bodyweight IDs automatically. |
| `REPS_ONLY` | reps | RPE, note | load, assistance, duration, distance | Missing reps is incomplete. No synthetic zero load. | Reps and optional RPE. |
| `DURATION` | duration seconds | RPE, note | reps, load, assistance, distance | Positive duration required. Not implemented in first slice. | Duration and optional RPE. |
| `DISTANCE_WITH_OPTIONAL_DURATION` | distance feet; load only when convention exists | duration, RPE, note | reps, assistance; load when no convention exists | Positive distance required. Duration may be absent; an optional prescribed load must have a matching performed value. Not implemented in first slice. | Distance; optionally duration/pace and load, but only under identical identity and semantics. |

Skipped sets require no measurement values. RPE remains an optional 1–10 effort observation for all profiles. RIR may continue to be derived where useful; this slice does not add a second effort field.

`COMPLETION` is rejected for now. No ordinary catalog exercise currently requires a completion-only contract; finishers already own a separate immutable timed protocol. `DURATION_AND_DISTANCE` is folded into the distance profile because duration is useful but not required for a carry. Generic arbitrary measurement arrays are rejected.

### 5.3 Authority

- The catalog entry owns the latest valid default semantics for future placement and acceptance.
- A plan placement may choose only a catalog-declared execution identity, not override its measurement profile or load convention.
- The accepted seed freezes the complete `ExecutionSemanticsV1` selected at acceptance.
- The workout copies that exact snapshot at materialization. Runtime add/swap copies the replacement catalog snapshot at the mutation boundary and records the edit as today.
- Set prescriptions and performed logs are interpreted only through the workout snapshot.
- Completed and in-progress workout meaning never follows later catalog edits.

## 6. Load-semantics conventions

| Context | V1 convention | Machine-readable? | Comparison rule |
| --- | --- | --- | --- |
| Barbell | Total external load on the bar, including the bar; collars may be ignored consistently | `TOTAL_EXTERNAL_LOAD`, `LB` | Same exercise ID and semantics only. |
| One dumbbell or kettlebell held goblet-style | Weight of the single implement | `TOTAL_EXTERNAL_LOAD`, `LB` | Same identity only. |
| Two dumbbells / farmer implements | Weight of one implement, not combined | `PER_IMPLEMENT`, `LB` | Same identity, number of implements, and semantics only. This preserves Trainer's current dumbbell display convention. |
| Cable stack | Number displayed on the selected stack | `DISPLAYED_MACHINE_LOAD`, `LB` | Same exercise identity/machine context only; do not correct pulley ratios. |
| Selectorized machine | Number displayed by the machine | `DISPLAYED_MACHINE_LOAD`, `LB` | No cross-machine equivalence. A different calibration requires a distinct machine-specific/custom identity for automatic comparison. |
| Plate-loaded bilateral machine | Plates added to one symmetric side, excluding the machine's unmarked carriage | `PLATE_LOAD_PER_SIDE`, `LB` | Same identity and machine context only. UI must say “per side.” |
| Iso-lateral plate-loaded machine | Plates added to the working side | `PLATE_LOAD_PER_SIDE`, `LB` with `PER_SIDE` reps when appropriate | Same identity only. |
| Bodyweight | No numeric load | profile discriminator | Compare reps/RPE; optional bodyweight is context. |
| Bodyweight plus external load | Added external load only; do not add bodyweight into `load` | `ADDED_EXTERNAL_LOAD`, `LB` | Same weighted identity and semantics only. |
| Assisted movement | Displayed assistance/counterweight; larger means easier | `DISPLAYED_ASSISTANCE`, `LB` | Same assisted identity and semantics only; progression direction is decreasing assistance. |
| Sled | Added load excluding unmarked sled tare | `TOTAL_EXTERNAL_LOAD`, `LB`, plus the distance profile | Same sled identity/surface context only. No friction or tare conversion. |
| Unknown/custom equipment | No numeric load until the creator explicitly selects a supported convention | `REPS_ONLY` | Rep history only. Notes may describe the machine. |

The machine-readable part is the profile, load convention, rep basis, and canonical unit. Guidance such as “include the bar,” “record one dumbbell,” or “exclude sled tare” is display copy derived from the convention. Manufacturer model, cable ratio, sled surface, handle selection, and machine seat setting are context/cues, not conversion inputs.

## 7. Catalog-versus-snapshot ownership

| Field | Catalog authority | Accepted-seed snapshot | Workout snapshot | Mutable advisory metadata |
| --- | --- | --- | --- | --- |
| Exercise ID | Stable executable identity | Required | Required existing FK | No |
| Display name | Current display/search label | No | No; live display is acceptable | Yes, safe in place |
| Aliases | Search/display resolution to one ID | No | No | Yes; collisions rejected, never relink history |
| Measurement profile | Latest future default | Full discriminator required | Exact copy required | No |
| Load convention | Latest future default when profile uses load | Required | Exact copy required | No |
| Canonical/display unit | Default derived from profile/convention | Required identifier | Exact copy required | UI formatting only may vary |
| Rep basis | Latest future default | Required for rep profiles | Exact copy required | No |
| Bilateral/unilateral mode | Catalog execution fact | Freeze exact `executionMode` and `repBasis` | Freeze exact values | Display wording may remain live |
| Alternation | Identity-defining execution fact | Freeze in `executionMode` | Freeze in `executionMode` | Cue wording may remain live |
| Equipment | Classification, eligibility, and authoring constraint | Do not copy full list; load convention freezes executable consequence | Do not copy full list | Yes, unless changing it would invalidate identity |
| Body position | Classification / identity description | No | No | Yes unless identity-defining |
| Grip / stance / ROM | Placement attribute or cue by default | Only if a future prescription makes it executable | Workout note/cue when prescribed | Yes |
| Muscle groups | Authoring/Plan Health classification | No | Existing stimulus snapshot separately freezes performed accounting | Yes for future planning |
| Movement pattern | Authoring/Plan Health classification | No | Existing workout snapshot remains | Yes for future planning |
| Safety/limitation tags | Plan Health/eligibility constraint | No | Applied decision may be captured by existing evidence | Yes for future planning |
| Authoring classes / main-lift eligibility | Plan Health/selection constraint | Role is already frozen; classes are not | Existing role/section fields | Yes |
| Default cues | Catalog display guidance | No | Copy only when prescribed as workout notes | Yes |
| Catalog status | Availability for new selection | No | No; archived row remains resolvable | Mutable `ACTIVE`/`ARCHIVED` |
| Semantics version | Latest catalog semantics revision | Required inside snapshot | Required inside snapshot | No |

The seed must not copy advisory classification merely because it was used at authoring time. Plan Health can continue to read current catalog facts before acceptance. Accepted execution meaning is the small snapshot, not a duplicate exercise catalog.

## 8. User-created exercise policy

There is no supported user-created-exercise creation flow in the current application. Noncanonical database rows exist as a compatibility category, but the repository does not prove who created them or with what semantics. The first implementation slice must preserve them, not invent ownership.

When a creation flow is added, require only:

- display name;
- one measurement profile;
- one compatible load convention when the profile uses load;
- execution mode;
- rep basis (`TOTAL` or `PER_SIDE`) for rep profiles.

Equipment, muscle groups, pattern, aliases, and cues may remain optional. The user chooses semantics using plain-language choices and examples; Trainer stores the explicit enum values. If a machine's load meaning is uncertain, the safe choice is `REPS_ONLY`, with a note, until the user intentionally chooses a supported displayed/per-side convention. An unknown numeric load must not masquerade as comparable external load.

After an exercise is referenced:

- display name, aliases, and advisory metadata may change in place;
- correcting a semantics default increments the catalog semantics version and affects future acceptance/additions only;
- changing measurement profile, load direction, or identity-defining execution should create a new exercise ID;
- old accepted seeds and workouts retain their embedded snapshots;
- duplicate detection is advisory; it can suggest an existing canonical ID but cannot merge automatically;
- linking or merging is out of scope. A future link may improve search, but must never rewrite old `exerciseId` values or history.

The rep-based pilot need not expose the creation UI. It must make the data contract safe for a later custom flow and keep unclassified rows on the legacy path.

## 9. Compatibility and migration strategy

Use additive, mixed-version compatibility. Do not rewrite historical sets, workouts, or accepted seeds.

1. Add nullable catalog and workout execution-semantics fields. Existing rows remain valid.
2. Add a new accepted-seed version (anticipated v3) whose executable rows require `ExecutionSemanticsV1`. Existing v1/v2 accepted payloads remain byte-for-byte valid and replay through the existing compatibility path.
3. Classify only a reviewed pilot catalog subset. An unclassified exercise cannot be accepted into a new measurement-aware seed, but existing plans and workouts continue to work.
4. For a new v3 seed, acceptance reads the catalog default once, validates it, and embeds it in the canonical hashed payload. Runtime never re-infers it.
5. Materialization copies v3 semantics to the nullable `WorkoutExercise` execution-snapshot columns. Legacy seeds leave all snapshot columns null and retain existing UI/log/history behavior.
6. Do not infer a historical snapshot from today's catalog. That would silently reinterpret old data after catalog edits.
7. Do not persist inferred defaults onto old accepted seeds or workouts. Label their semantics `legacy` at read time; where current history is ambiguous, suppress automatic comparison and keep the raw values visible with a legacy explanation.
8. Preserve existing dumbbell display behavior for legacy workouts. It is presentation compatibility, not proof that every old dumbbell log is semantically exact.
9. Replace destructive stale catalog pruning with archive-not-delete for any catalog row. This closes the accepted-seed JSON reference gap and keeps historical display resolvable.
10. Existing `slotPlanSeedJson` remains a compatibility source only. It never receives or overrides a v3 execution snapshot.

No automatic backfill is safe across the entire catalog. A future report may identify a narrow set of unambiguous rows, but backfilling still offers little value because it cannot prove which convention the user followed. Prefer legacy labeling over synthetic certainty.

## 10. Seed and runtime boundary

### Chosen representation: frozen execution snapshot

The smallest future accepted row is:

```ts
type AcceptedSeedExerciseV3 = {
  exerciseId: string;
  role: "CORE_COMPOUND" | "ACCESSORY";
  setCount: number;
  execution: ExecutionSemanticsV1;
};
```

The canonical seed payload version must advance because execution semantics become hash-covered accepted truth. The compiler/materializer resolves the catalog once at acceptance and fails closed if the selected exercise is unclassified or the profile/convention combination is invalid.

```text
semantic specification (future; not runtime)
        |
        | compile + resolve catalog defaults
        v
accepted immutable seed v3
  exerciseId + role + setCount + execution snapshot
        |
        | copy, never re-infer
        v
WorkoutExercise execution snapshot
        |
        | interprets prescription and performed log
        v
logged performance
```

| Alternative | Determinism | Historical correctness | Runtime / migration burden | Decision |
| --- | --- | --- | --- | --- |
| ID + profile version only | Catalog version still needs dereference; edits can change meaning | Weak unless catalog rows are immutable | Small payload, hidden second authority | Reject |
| Full execution snapshot | Hash-covered, self-contained | Strong; old meaning survives catalog edits | Small JSON and straightforward copy | Choose |
| Immutable catalog revision reference | Deterministic if every revision is retained | Strong | New revision tables, lookup lifecycle, custom-entry complexity | Reject for this slice |
| Live catalog lookup | Nondeterministic after edit | Weak | Current behavior, smallest code change | Reject |

An accepted v3 seed may display the live catalog name, but it executes and logs through the frozen snapshot. Missing catalog rows remain a hard integrity error because `WorkoutExercise.exerciseId` is a foreign key; archive-not-delete prevents the normal case.

Runtime add/swap is session-local. It obtains the replacement ID and current semantics, freezes them on the workout exercise, and does not correct the accepted seed. Canonical correction remains an explicit new seed revision.

## 11. Progression interface boundary

This slice does not redesign progression. It provides a trustworthy comparison key and dimensions:

```ts
type ComparableExecutionKey = {
  exerciseId: string;
  executionVersion: 1;
  catalogRevision: number;
  executionMode: ExecutionMode;
  profile: MeasurementProfile;
  loadConvention?: LoadConvention;
  repBasis?: RepBasis;
};
```

History is automatically comparable only when the keys are identical and the records are not legacy-ambiguous. Exact exercise ID remains mandatory. A matching profile across different IDs is not enough.

| Profile | Comparable performance dimensions | Direction exposed to future progression |
| --- | --- | --- |
| `REPS_EXTERNAL_LOAD` | load, reps, optional RPE | More load or reps at comparable effort |
| `REPS_BODYWEIGHT` | reps, optional RPE; bodyweight as context | More reps at comparable effort; no automatic total-system-load math |
| `REPS_BODYWEIGHT_PLUS_LOAD` | added load, reps, optional RPE; bodyweight as context | More added load or reps at comparable effort |
| `REPS_ASSISTED` | assistance, reps, optional RPE | Less assistance or more reps at comparable effort |
| `REPS_ONLY` | reps, optional RPE | More reps at comparable effort |
| `DURATION` | duration, optional RPE | Longer duration at comparable effort |
| `DISTANCE_WITH_OPTIONAL_DURATION` | distance; optionally time/pace and load | Profile-specific; no automatic rule in this slice |

Do not auto-compare:

- assisted, bodyweight, and weighted identities with one another;
- per-implement and total-load records;
- different rep bases;
- different machine identities/calibrations;
- legacy records whose convention is not provable;
- distance records when one lacks a dimension required by the comparison;
- warm-up logs or finisher-protocol results as ordinary work-set progression evidence.

The first implementation should gate or suppress current load suggestions when the comparison key is incompatible. It should not add a new progression algorithm.

## 12. Versioning and mutability rules

Use three simple versions, not a registry:

- `Exercise.executionSemanticsVersion`: integer identifying the current catalog default definition; initial reviewed value is `1`.
- `ExecutionSemanticsV1.version`: discriminator frozen in seed and workout snapshots.
- accepted seed `version: 3`: contract requiring execution snapshots on every row.

Workout records need no independent registry version because the embedded snapshot is versioned. The legacy absence of a snapshot is itself the compatibility discriminator.

| Edit | Rule |
| --- | --- |
| Rename, spelling, alias, cue | Safe in place. Does not change execution. |
| Muscle, pattern, authoring tag | Safe for future planning, subject to existing audit/review rules. Does not rewrite performed meaning. |
| Correct display copy for an unchanged convention | Safe in place. |
| Change profile, load direction, rep basis, or load convention | Prefer a new exercise ID when it describes a different action. If correcting erroneous catalog metadata for the same action, increment semantics version; future-only. |
| Change fixed-path/free-weight or execution-distinct implement | New exercise ID. |
| Change a plan after acceptance | New immutable seed revision through the existing correction path. |
| Delete a referenced or potentially seed-referenced exercise | Forbidden. Archive instead. |
| Edit an accepted seed snapshot or workout snapshot | Forbidden. |

## 13. Required examples

| Case | Executable identity | Profile / load convention | Required log | Comparable history | Frozen facts | Variant split? |
| --- | --- | --- | --- | --- | --- | --- |
| Barbell back squat | Existing barbell-specific ID | `REPS_EXTERNAL_LOAD` / `TOTAL_EXTERNAL_LOAD`, total reps | reps + total bar load | Same ID/snapshot load, reps, RPE | profile, convention, `TOTAL`, lb | Goblet, Smith, belt, safety-bar, and machine squat are separate when independently selected. Minor stance is a cue. |
| Goblet squat | One-implement goblet-squat ID | `REPS_EXTERNAL_LOAD` / `TOTAL_EXTERNAL_LOAD` | reps + implement weight | Same ID/snapshot | profile, convention, `TOTAL`, lb | Barbell squat is separate. Split dumbbell/kettlebell only if product wants equipment-specific history; the numeric convention itself is the same. |
| Dumbbell bench press | Bilateral simultaneous DB press ID | `REPS_EXTERNAL_LOAD` / `PER_IMPLEMENT` | reps + weight of one dumbbell | Same ID/snapshot | profile, convention, `TOTAL`, lb | Alternating or single-arm press gets a separate ID; incline is separate when selected as such. |
| Alternating dumbbell curl | Existing alternating ID | `REPS_EXTERNAL_LOAD` / `PER_IMPLEMENT`, `PER_SIDE` reps | reps per side + one-dumbbell load | Same ID/snapshot | profile, convention, `PER_SIDE`, lb | Simultaneous bilateral curl remains a separate ID. Grip cue alone need not split. |
| Bodyweight pull-up | Existing unweighted ID | `REPS_BODYWEIGHT` | reps | Same ID/snapshot reps/RPE | profile, `TOTAL`; optional bodyweight context on session | Weighted and assisted are always separate. Grip may be a cue unless separately prescribed/history-sensitive. |
| Weighted pull-up | Existing weighted ID | `REPS_BODYWEIGHT_PLUS_LOAD` / `ADDED_EXTERNAL_LOAD` | reps + added load | Same ID/snapshot added load/reps | profile, convention, `TOTAL`, lb | Zero-added-load work belongs to bodyweight pull-up. |
| Assisted pull-up | New assisted ID | `REPS_ASSISTED` / `DISPLAYED_ASSISTANCE` | reps + displayed assistance | Same assisted ID/snapshot; less assistance is harder | profile, convention, `TOTAL`, lb | Machine-assisted and band-assisted require separate identities because the recorded number differs; band-assisted may be `REPS_ONLY` until a bounded band convention exists. |
| Cable row | Cable-machine row ID | `REPS_EXTERNAL_LOAD` / `DISPLAYED_MACHINE_LOAD` | reps + displayed stack | Same ID/machine semantics only | profile, convention, `TOTAL`, lb | Chest-supported plate row and free-weight row are separate. Handle is a cue unless deliberately distinct. |
| Plate-loaded leg press | New plate-loaded-specific ID | `REPS_EXTERNAL_LOAD` / `PLATE_LOAD_PER_SIDE` | reps + plates on one side | Same ID/machine semantics only | profile, convention, `TOTAL`, lb | Selectorized leg press and materially different machines are separate; generic legacy `Leg Press` is not silently reclassified. |
| Plank | Timed plank ID | `DURATION` | seconds | Same ID/snapshot duration/RPE | profile, seconds | Dynamic rep plank is separate. Weighted timed plank is deferred. Not in first implementation slice. |
| Farmer carry | Two-implement farmer-carry ID | `DISTANCE_WITH_OPTIONAL_DURATION` / `PER_IMPLEMENT` | feet + one-implement load; seconds optional | Same ID/snapshot distance, optional time/load | profile, convention, feet, seconds, lb | Suitcase carry, trap-bar carry, and single-arm carry are separate. Not in first implementation slice. |
| User-created uncertain machine | User's stable custom ID | `REPS_ONLY` | reps | Same ID/snapshot reps/RPE | profile, rep basis | It may be renamed. Choosing displayed machine load later creates a new identity or future-only semantics version; old logs remain rep-only. |

Every example also freezes `version`, `catalogRevision`, and `executionMode`; the table abbreviates those repeated fields.

## 14. Edge-case matrix

| Edge case | Desired behavior | Authority owner | Compatibility treatment | First slice? |
| --- | --- | --- | --- | --- |
| Catalog display name changes after plan acceptance | Show the current name; execution remains unchanged | Live catalog for display, seed snapshot for meaning | No seed/workout rewrite | Yes |
| Measurement profile changes after logged workouts exist | Old seed/workout retains old snapshot; different action gets new ID, correction gets future semantics version | Catalog future default; frozen historical snapshots | Comparison keys differ; no auto-comparison | Yes |
| Assisted exercise compared with weighted exercise | Never auto-compare; show separate history | Exercise IDs and profiles | Legacy ambiguous bodyweight loads remain noncomparable | Yes |
| Unilateral exercise logged once versus per side | Snapshot label and validation say `TOTAL` or `PER_SIDE`; V1 stores one value, not left/right | Workout snapshot | Legacy remains ambiguous | Yes |
| Dumbbell load recorded per hand versus total | V1 always labels/stores per implement for the corresponding identity | Workout snapshot | Do not convert old numbers; preserve legacy display | Yes |
| Machine swap with different stack calibration | Use a distinct machine-specific/custom ID for comparable tracking, or suppress comparison and note the swap | Exercise identity plus user/context choice | No conversion or history rewrite | Partly: comparison gate; machine-management UI later |
| Custom exercise lacking equipment metadata | Explicit profile is sufficient; uncertain load uses `REPS_ONLY` | Custom catalog entry | Existing unclassified row remains legacy | Contract yes; creation UI later |
| Deleted or archived catalog exercise referenced by history | Never hard-delete; archived row remains resolvable and hidden from new selection | Catalog status | Replace current pruning with archive behavior | Yes |
| Old seed without execution snapshot | Replay through legacy path; do not read today's semantics as accepted truth | Seed version | Null workout snapshot and legacy UI/log behavior | Yes |
| Old workout with ambiguous load | Preserve raw reps/load/RPE; label legacy and suppress semantic comparison where uncertain | Historical workout/log | No inferred backfill | Yes |
| Exercise alias collision | Reject the new alias; never reassign history or silently point it elsewhere | Catalog alias uniqueness and sync validation | Existing ID/history unchanged | Yes |
| Same movement with different measurement mode | Separate IDs, such as timed versus dynamic plank | Exercise identity | Existing overloaded entry stays legacy until curated | Yes as acceptance validation; non-rep UI later |
| Timed versus rep-based use of same movement | Do not allow placement-level mode override; choose the matching ID | Exercise identity and seed snapshot | Legacy note-based use remains legacy | Yes as model rule; duration UI later |
| Bodyweight change affects interpretation | Optionally snapshot session bodyweight for context; do not synthesize a normalized load or rewrite history | Session/workout context | Old history remains reps/RPE only | Optional context can follow later |
| Plan accepted before catalog semantics update but started afterward | Accepted seed snapshot wins exactly | Current accepted seed revision | Old seed without snapshot stays legacy; never upgrade at start | Yes |

## 15. Options considered and rejected

### A. Catalog measurement metadata only

Rejected. Logging, history, and accepted plans would continue interpreting mutable catalog data. This creates a visible field without an executable authority.

### B. Catalog metadata plus freeze it into newly accepted seeds

Rejected as incomplete. The seed would know the meaning, but workout materialization, UI, logs, and history would still use the old generic contract or live equipment. That creates seed-versus-workout dual truth.

### C. Catalog metadata, seed snapshot, and measurement-aware workout materialization/logging

Chosen, bounded to the five rep profiles and a reviewed pilot catalog. It is the smallest slice whose accepted plan, workout, log, and history agree end to end. Duration/distance follow in a separate vertical slice.

### D. Immutable catalog revisions first

Rejected. Revision tables and dereference rules add lifecycle and custom-entry complexity without improving over a complete small snapshot. The catalog remains the authoring default; seed and workout snapshots own accepted/performed meaning.

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

1. Define and centrally validate the five rep-based `ExecutionSemanticsV1` variants.
2. Add nullable, versioned catalog semantics and `ACTIVE`/`ARCHIVED` status.
3. Curate a bounded pilot catalog containing clear examples of external load, bodyweight, added load, assistance, reps-only, per-implement, displayed-machine, and per-side load. Do not classify ambiguous overloaded IDs.
4. Add accepted seed v3 whose every executable row embeds a validated snapshot. Existing seed contracts remain supported.
5. Copy the snapshot onto `WorkoutExercise` at normal materialization and runtime add/swap.
6. Interpret the existing rep/load/RPE prescription and logging UI through the workout snapshot: required/hidden load, precise label, positive-value validation, and assistance direction.
7. Gate history and previous-load suggestions on identical comparison keys. Preserve raw legacy history but mark or suppress ambiguous comparisons.
8. Archive rather than delete catalog entries so accepted seed IDs remain resolvable.

The slice deliberately does not add duration/distance columns or controls. That boundary avoids a larger workout UX and set-model change while delivering coherent end-to-end meaning for Trainer's dominant current behavior.

## 17. Anticipated schema, API, and runtime changes

These are implementation expectations, not changes made by this design.

### Schema

- explicit Prisma enums for `MeasurementProfile`, `LoadConvention`, `RepBasis`, `ExecutionMode`, `MeasurementUnit`, and `ExerciseCatalogStatus`
- nullable `Exercise.measurementProfile`, `loadConvention`, `repBasis`, `executionMode`, `massUnit`, and `executionSemanticsVersion` columns
- `Exercise.catalogStatus` as a small `ACTIVE | ARCHIVED` enum with existing rows initially active
- matching nullable `WorkoutExercise` snapshot columns for schema version, catalog revision, profile, convention, rep basis, execution mode, and mass unit

The code may expose those scalar columns as the discriminated `ExecutionSemanticsV1` value, but the database does not store an unvalidated metadata blob. No profile-specific tables, catalog revision table, polymorphic measurement rows, or rewrite of `WorkoutSet`/`SetLog` is needed for the rep pilot. Duration/distance later requires additive target/actual fields or a separately designed discriminated set payload; it must not overload reps.

### Catalog and validation

- A pure `parseExecutionSemanticsV1()` / canonicalizer with exhaustive discriminator validation.
- Catalog sync validates reviewed JSON semantics and never hard-deletes exercise rows.
- New selection/acceptance filters archived or unclassified entries from the measurement-aware path.
- Alias collision remains an explicit validation error.

### Accepted seed and compiler

- Extend `normalizeAcceptedSeedPayload()` with seed v3 and canonical snapshot hashing.
- Extend `projectExecutableSeedRows()` or a neighboring materializer to resolve catalog semantics at acceptance.
- Keep V0's proven input boundary unchanged unless a later proof explicitly advances it; V0 may compile only to its existing non-persisted result during this slice.
- Existing v1/v2 hashes and payloads remain unchanged.

### Workout APIs and materialization

- Save/materialization DTO carries the accepted execution snapshot and persists it on `WorkoutExercise`.
- Add/swap APIs resolve and freeze the replacement catalog semantics.
- Set-log validation reads the workout snapshot, not live equipment or the request body, to require or forbid `actualLoad`.
- UI DTO exposes the snapshot and compatibility state (`SNAPSHOT_V1` or `LEGACY`).
- Logging controls retain reps/load/RPE but change label, visibility, requiredness, and assistance help text by profile.
- Load quantization becomes convention-aware for snapshot rows; the pilot may retain 2.5 lb increments where valid but must not apply one unexplained rule universally.

### History and progression boundary

- History reads the workout snapshot per performed set and returns a comparison key.
- Previous-load suggestions filter to an identical key; legacy behavior is retained only for legacy workouts.
- Assistance direction comes from `DISPLAYED_ASSISTANCE`, not name matching.
- No new progression policy, e1RM model, or cross-equipment donor scaling is added.

### Plan Health

- Measurement-aware acceptance blocks an unclassified exercise, invalid semantics, archived exercise, and a profile incompatible with the bounded pilot.
- Existing muscle/equipment/limitation checks remain advisory/authoring owners and are not copied wholesale into the seed.

## 18. Focused test plan

| Seam | Required tests |
| --- | --- |
| Pure semantics parser | Accept every valid rep-profile combination; reject forbidden load convention, missing unit/basis, unknown version/profile, and extra ambiguous fields. |
| Identity/catalog fixtures | Pilot IDs have one exact semantics value; overloaded legacy entries are not eligible; alias collisions fail; archived rows are excluded from new selection. |
| Seed normalization/hashing | V3 canonicalization includes every execution field; order/canonical stability; a semantics change changes the hash; v1/v2 fixtures remain unchanged. |
| Acceptance/compiler | Catalog semantics are resolved once; unclassified/missing/archived IDs fail closed; no planning metadata enters executable rows. |
| Runtime authority | Plan accepted before catalog edit materializes the accepted snapshot; runtime never substitutes current catalog semantics; current revision still wins. |
| Workout save/materialization | Snapshot copies exactly and is transactionally stored with the workout; legacy seed produces null compatibility state; failure is atomic. |
| Add/swap | Replacement gets current catalog snapshot and exact ID; accepted seed remains unchanged; archived/unclassified replacement is rejected for snapshot mode. |
| Set log API | Required/forbidden fields per profile; positive load/assistance; skip behavior; quantization by convention; bodyweight does not synthesize zero. |
| UI | Correct controls and copy for total, per-implement, per-side, added load, assistance, bodyweight, and reps-only; legacy UI remains stable. |
| History | Identical comparison keys compare; mismatched version/profile/convention/basis, assisted-vs-weighted, machine IDs, and ambiguous legacy records do not. |
| Previous-load suggestions | Compatible records feed existing logic; incompatible or legacy-ambiguous records are withheld; assistance direction is exposed without changing progression policy. |
| Archive compatibility | Archived ID still renders accepted seeds/workouts/history and is absent from new authoring results. |
| Contract/integration | Existing v1/v2 seed replay, `slotPlanSeedJson` fallback, custom hypertrophy acceptance, template generation, warm-ups, and exact workout provenance remain intact. |

The implementation should use the repository-selected verification plan after the actual diff is known. Database mutation, production audit, and deployment verification are not part of this documentation design.

## 19. Rollout and rollback

Roll out additively:

1. Deploy nullable schema/read compatibility before emitting v3 seeds.
2. Populate only the reviewed pilot semantics and verify catalog integrity in a non-production review workflow.
3. Enable v3 acceptance for the pilot behind one acceptance capability gate; keep legacy seed replay enabled.
4. Observe rejected/unclassified selection counts, legacy-history suppression, and snapshot integrity without mutating plan behavior.
5. Expand the catalog only through reviewed, evidence-backed classification.

Rollback:

- disable new v3 acceptance and new snapshot-mode selection;
- continue reading/logging already-created snapshot workouts with the backward-compatible code;
- retain additive columns and v3 accepted revisions; never downgrade or rewrite them;
- restore previous catalog availability only through forward catalog edits, not history mutation;
- if a catalog semantics value is wrong, create a corrected future version or distinct ID and, when necessary, an explicit accepted seed correction revision.

An application rollback to code that cannot read already-emitted v3 seeds is unsafe. The capability gate must remain off until the read path is deployed and verified first.

## 20. Explicit non-goals

- Persistent semantic plan specifications.
- Progression-policy or load-calibration redesign.
- Universal fitness ontology or all-modality catalog coverage.
- Arbitrary units or a conversion framework.
- Left/right independent set logging.
- Machine equivalence, pulley-ratio, leverage, sled-friction, or bodyweight-normalized calculations.
- Historical workout, set, or seed backfill.
- Automatic canonical/custom merging or duplicate resolution.
- Exercise family, inheritance, plugin, or rules-engine architecture.
- Preparation/closeout, finisher, superset, or warm-up redesign.
- Duration/distance set UX in the first implementation slice.
- Runtime fallback to any planning specification.
- Migration of legacy `slotPlanSeedJson` into a competing authority.

## 21. Open product decisions

No product decision blocks the recommended rep-profile pilot. The design makes these V1 choices explicitly: pounds as the canonical mass unit, per-implement dumbbell logging, per-side plate-loaded-machine logging, no automatic custom merging, and no cross-equipment comparison.

Before the later duration/distance slice, product should decide:

1. whether farmer-carry duration is optional context or a required pace dimension;
2. whether workout session bodyweight should be requested automatically or remain optional context;
3. whether users need machine-instance selection or whether separate custom identities plus notes are sufficient.

Those decisions do not change the snapshot authority or the five-profile rep pilot.

## 22. Final verdict

**READY FOR IMPLEMENTATION**

Exercise identity, rep-based measurement, load direction, seed/workout authority, and mixed-version compatibility are sufficiently resolved for a bounded vertical slice. The current set model is adequate for the five rep profiles without reinterpretation. It is not adequate for duration or distance, so those profiles are designed but intentionally deferred to a separate set-contract/UI slice.

The implementation boundary is coherent only if catalog semantics, accepted seed v3, workout snapshots, profile-aware logging, and comparison gating land together for a reviewed pilot. Catalog-only or seed-only delivery would create dual truth. Historical data remains raw and unchanged, accepted seed revisions remain the sole runtime plan authority, and no comparison is claimed across incompatible equipment, identities, profiles, or legacy ambiguity.
