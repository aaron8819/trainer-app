# Trainer2 catalog coverage

Trainer2 adds 17 bounded program variants in `src/lib/engine/trainer2/program-catalog.json`, for 108 selectable definitions across 167 identities (59 exclusions remain). The shared 150-entry library and all 48 frozen Trainer2 definitions are unchanged. Definition provenance and distinct plate-only conventions are recorded in [PROGRAM_SUPPORT](PROGRAM_SUPPORT.md).

Common gym names and abbreviations are search-only aliases in
`catalog-search-aliases.json`, applied by the same matcher for Builder and Swap.
They never alter qualified entries, stable IDs, incoming snapshot equality or
historical captures. Explicit stack/plates/per-arm searches retain those distinctions;
aliases do not qualify excluded exercises. Display titles and logger weight tips
retain their existing presentation and recording definitions.

The canonical exercise library is `prisma/exercises_comprehensive.json`. Trainer2 qualification is owned by `src/lib/engine/trainer2/catalog-adapter.ts`: it reads reviewed measurement columns through the shared measurement parser and zero-load policy, then translates the supported tuple into Trainer2 recording fields. Identity is exclusively `t2:<catalogKey>`. Names are display/search text.

The released source was verified at commit `3a2e057d3a205241849827a1f7e7ca580787acaf`, tree `7d91f6edeb30100faced10359e5334ecc2e609cf`, against the clean release checkout and `artifacts/review/SWAP_UI_RELEASE.md`. Coverage was 48 of 150. The shared library remains 91 of 150: all 43 additional entries with reviewed compatible tuples are included. There are 48 exclusions needing authoritative metadata review and 11 excluded under the current hold/carry/traverse capability classification. That classification is qualified by execution ambiguity; it is not proof that every possible variant requires duration/distance.

The [generated inventory](CATALOG_COVERAGE_INVENTORY.json) lists every stable ID, before/after status, exact source measurement columns, zero capability, equipment, muscles, movement patterns, prescription defaults, normalized definition, missing fields, reason and recommendation. Regenerate it with the repository-local tsx runner and `scripts/trainer2/catalog-inventory.ts`. It is evidence, never runtime input.

## Qualification and compatibility

The adapter accepts only complete valid profile/convention/rep-basis tuples, valid reviewed rep defaults, equipment and movement definitions. It never derives recording meaning from names, equipment or unilateral flags. BARBELL_TOTAL → barbellTotal, IMPLEMENT_WEIGHT → perImplement, MACHINE_DISPLAYED → machineDisplayed, ADDED_EXTERNAL_LOAD → addedExternal, DISPLAYED_ASSISTANCE → displayedAssistance. TOTAL and PER_SIDE stay distinct. Bodyweight has no numeric load. New external-load definitions require positive load unless the shared zero-load policy explicitly permits zero; unspecified load remains allowed. Added-load zero and assistance zero remain separate.

`qualified-catalog-v1.json` is the frozen 48-entry released compatibility contract. It preserves prior purpose groups, narrower equipment, aliases, defaults and recording meaning; it does not determine catalog membership. No additional identities should be appended to it. All 48 reviewed measurement tuples and rep defaults agree with the shared source, checked independently by tests. Their previous valid-zero behavior remains unchanged, including Hack Squat and Bulgarian Split Squat. The expansion does not retroactively substitute V1 zero-capability meaning into those Trainer2 records.

For new entries, purpose is the explicit canonical movement-pattern sequence; no exercise-name heuristic refines it into a muscle or variation group. Rep defaults are exactly `repRangeRecommendation`. Set count, effort, role, requiredness and rest remain plan-owned. Compatible swaps retain the prescribed ranges; incompatible purpose/basis swaps use the reviewed candidate defaults. Exercise-specific numeric loads always clear.

Builder search/equipment preferences and execution Swap use the same normalized library and qualification. Both show accurate exclusion reasons. Server plan acceptance and swap previews select from that same catalog. New snapshots carry immutable `catalogFacts` for movement, primary/secondary muscles, rep defaults and external zero policy. Logger defaults, client/server result checks, history and prefill use the captured snapshot. The logger preserves existing free-evidence behavior for legacy snapshots and custom descriptions; new definitions require their recorded rep/load basis. Blank measurement and result clearing remain available. Explicit prescribed loads retain exact authored measurements when logged untouched; only history-based starting suggestions round to five pounds. See PROGRAM_SUPPORT.md.

## Snapshots and history

Saved plans, START, substitutions and performed assignment bindings retain immutable captured meaning. Reading a saved draft validates its stored structure and builder consistency without requalifying or replacing its exercise snapshots against today's catalog. CreateDraft, EditDraft and activation review use `planning.ts:validateWorkoutDefaults` to compare the complete incoming snapshot with the qualified catalog using canonical JSON equality, including optional-field presence and nested facts. Added, omitted or modified facts are rejected rather than stripped. Swap preview and commit accept only strict catalog-ID intents and construct replacement snapshots from the same qualified catalog; Return to original restores START without requalifying historical meaning. Legacy muscle tags retain the frozen display projection; new tags use captured facts.

No historical record is rewritten. History retains completed-before-start cutoff, duplicate-position ambiguity barriers and custom-identity abstention. Compatibility distinguishes assistance from added load, per-implement from total mass, and total from per-side reps. Builder expansion uses captured rep defaults (the frozen released contract for legacy entries), so later catalog recommendations cannot change historical consistency checks. New zero policy participates in logging identity and load compatibility. Historical kg values and decimal spelling stay intact; pounds rounding affects suggestions only. Return to original restores captured START targets and prescribed measurement, without consulting the catalog.

## Remaining exclusions

Every exclusion lacks a reviewed recording tuple. Exact keys and fields are in the inventory. Of the 48 metadata exclusions, 37 are reviewed ambiguous executions and 11 have reviewed unsupported semantics (seven machine definitions, three angled-bar definitions and Dragon Flag). These entries lack reviewed measurement columns; conflicting means execution ambiguity, not contradictory populated measurement columns. Intended timed holds, loaded carries and sled traversals require new target, evidence, history and prefill contracts. The 11 capability exclusions lack per-ID reviewed duration/distance tuples. Copenhagen Plank has unilateral adduction and an 8–15 rep recommendation but no static/dynamic discriminator: keep it excluded pending variant review; a separately qualified dynamic variant may fit the rep model. Rep ranges and timePerSetSec do not settle execution meaning. Broad or unsupported-load entries require a concrete executable variant and an authoritative profile/load convention/rep basis before admission. Review zero capability explicitly if zero is permitted; split conflicting variants into separate stable IDs. In particular, landmine and Meadows variants need a reviewed angled-bar load convention; iso-lateral and unsupported machine variants need explicit displayed/plate and per-arm recording conventions. Dragon Flag needs an authoritative rep/load definition. These reviews are separate work; existing rep-range recommendations alone do not qualify an exercise.

## Verification and release

`catalog-coverage.test.ts` verifies every compatible definition against source, all 48 frozen definitions, missing/conflicting metadata, a future compatible identity, bench coverage, filtering, read preservation and measurement barriers. Retained builder/logger/history/swap tests protect prescriptions and ambiguity rules.

`scripts/test-trainer2-exercise-swap.ts --confirm-disposable` now also calls `scripts/trainer2/verify-catalog-coverage.ts`. It provisions only its own PostgreSQL 17 container and synthetic owner/session, applies existing migrations/grants, verifies desktop/mobile builder → save/activate → start/log → finish/history → subsequent prefill, new bench swaps and Return to original, then round-trips every currently selectable definition through acceptance, START, results and subsequent history/prefill. The existing races, lost-response recovery and populated pre-swap upgrade checks remain included.

No Prisma/schema/grant migration or shared-catalog synchronization is required. Hosted release is separately authorized: independently review the exact candidate, qualify hosted protections/environment/roles and release the reviewed application source. Do not enable owner admission or modify existing sessions. Older application binaries do not understand newly authored catalogFacts; account for that contract in any rollback plan. No push, merge, deployment, hosted writes, V1 changes, Add set or execution Add exercise are part of this slice.

## Common gym completeness batch (October 2026)

Full coverage means selectable, searchable, explicitly recordable common gym executions, with equipment, muscles, movement and rep defaults; it does not mean qualifying every ambiguous library label. Existing movement families and major muscle groups already have selectable exercises. The remaining gap is often execution specificity, not an absent muscle group.

Four Trainer2-only variants fill common accessory gaps without changing parent identities:

| New key | Source metadata | Execution and recording |
| --- | --- | --- |
| straight-bar-curl | barbell-curl | Standing straight bar, both arms together; total reps, barbell total including bar |
| simultaneous-incline-dumbbell-curl | incline-dumbbell-curl | Incline bench, both arms together; total bilateral reps, weight of each dumbbell |
| two-hand-single-dumbbell-overhead-extension | overhead-dumbbell-extension | Both hands hold one dumbbell; total reps, that single dumbbell's weight |
| ez-bar-skull-crusher | lying-triceps-extension-skull-crusher | Lying on bench, EZ bar, both arms together; total reps, bar total including bar |

These are explicit authored recording definitions using existing contracts. Movement, muscle and rep recommendations are copied from the named canonical parents; no new stimulus claim is made. All require positive external load when supplied; blank remains unspecified. Existing logger convention labels explain weight entry. New titles contain execution/implement distinctions without weight-entry instructions. Generic parents remain excluded, preserving ambiguity rather than assigning them guessed load or rep meaning.

Roles remain plan-owned and optional. The existing starter uses compound lat pulldowns as accessories, and does not infer position role from compound status or V1 main-lift eligibility. No starter or active plan is changed. The architecture reference's incline-curl example supports prioritizing that gap; reference proposals are not active-plan evidence.

Normalized search aliases are unique and reference selectable IDs. The redundant assisted-pull-up alias was removed without changing search behavior. New aliases include incline DB curl, BB curl, overhead DB triceps extension and EZ skullcrusher; the already selectable adductor machine gains inner-thigh search terms.

The 59 original exclusions remain: holds/carries/traversals need capability work or a separately reviewed dynamic execution; angled-bar and ambiguous machines need concrete recording conventions. The existing exercise-title.ts presentation layer already removes plate-recording instructions from reviewed visible titles while preserving captured names. Logger load labels retain those recording tips. That layer and frozen names are unchanged. No migration, database synchronization or production mutation is part of this batch.

## Remaining 59 identities: useful-coverage audit

This partition covers every excluded key exactly once. Exclusion count is not missing-movement count: 13 broad identities already have usable alternatives. The existing inventory classification calls Copenhagen a capability exclusion; this audit keeps it ambiguous because a dynamic rep variant may be possible. None of these classifications grant qualification.

**Covered broad identities (13)** — Concrete supported alternatives exist. Preserve generic IDs; expose alternatives rather than inventing duplicates. Other executions under these broad labels still need separate definitions.

`reverse-lunge`, `romanian-deadlift`, `standing-calf-raise`, `cable-lateral-raise`, `overhead-dumbbell-extension`, `lying-triceps-extension-skull-crusher`, `dumbbell-row`, `iso-lateral-high-row`, `iso-lateral-low-row`, `barbell-curl`, `incline-dumbbell-curl`, `preacher-curl`, `pallof-press`.

**Rep-definition work (16)** — Specify implement, bodyweight versus added load, bilateral/per-side counting, and zero policy. Explicit dynamic rep executions fit current contracts; static Dragon Flag needs duration. No automatic qualification from names.

`walking-lunge`, `stiff-legged-deadlift`, `single-leg-hip-thrust`, `glute-bridge`, `back-extension-45-degree`, `45-degree-back-extension-hamstring-bias`, `dumbbell-front-raise`, `cable-front-raise`, `bayesian-curl`, `spider-curl`, `wrist-curl`, `reverse-wrist-curl`, `bicycle-crunch`, `russian-twist`, `wood-chop`, `dragon-flag`.

**Machine-definition work (11)** — Specify stack versus added plates, total versus per-arm loading, bilateral versus independent-arm execution, rep basis and zero. Existing Trainer2 machine conventions can represent explicit variants; do not infer starting resistance.

`belt-squat`, `machine-hip-thrust`, `reverse-hyperextension`, `leg-press-calf-raise`, `incline-machine-press`, `iso-lateral-incline-press`, `iso-lateral-decline-press`, `iso-lateral-front-lat-pulldown`, `chest-supported-t-bar-row`, `seated-machine-shrug`, `torso-rotation-machine`.

**Execution ambiguity / mixed capability (6)** — Separate bodyweight, added load, machine/band assistance, angled versus machine row, and dynamic versus static Copenhagen. Dynamic/bodyweight variants can fit today; band resistance/assistance is not a measured stack, and held Copenhagen needs duration.

`sissy-squat`, `nordic-hamstring-curl`, `dip-chest-emphasis`, `dip-triceps-emphasis`, `t-bar-row`, `copenhagen-plank`.

**Angled-bar load capability (3)** — Need a reviewed angled-bar load convention (plates or assembly basis) and matching logger/history validation. Existing barbell-total or machine-plate meaning must not be reused silently.

`landmine-press`, `meadows-row`, `landmine-rotation`.

**Duration / distance capability (10)** — Intended holds/carries/traversals require duration/distance targets and results, history and prefill semantics; sled load and unilateral carry basis also need review. Do not invent rep equivalents.

`dead-hang`, `plank`, `rkc-plank`, `side-plank`, `farmers-walk`, `suitcase-carry`, `overhead-carry`, `sled-push`, `sled-pull`, `sled-drag`.

**Highest-value next bounded batch:** explicit dumbbell walking lunge, bodyweight Nordic curl, bodyweight 45-degree back extension, bodyweight glute bridge, one-arm cable Bayesian curl, and cable wood chop. This improves unilateral leg, knee-flexion, posterior-chain, long-position curl and rotational-core choices instead of adding more nearly identical machine rows. Reuse parent muscle/movement/default metadata; capture per-side reps for unilateral executions and existing implement/stack/bodyweight conventions. Confirm any loaded/assisted execution separately; leave generic sources and active plans untouched. Dynamic Dragon Flag/Copenhagen, machine configuration variants, and angled-bar or duration/distance features follow after their own definition reviews.
