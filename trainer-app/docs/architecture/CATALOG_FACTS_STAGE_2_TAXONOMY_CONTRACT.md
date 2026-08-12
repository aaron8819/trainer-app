# Catalog Facts Stage 2 Taxonomy Contract

Status: proposed implementation-ready design; taxonomy is not implemented or runtime-consumed

Decision baseline: `96c722d503708c3bad4d3f9c9ba259afe561de54`

Machine-reviewable evidence: `docs/architecture/catalog-facts-stage-2-taxonomy-matrix.json`

## 1. Decision and scope

Catalog Facts Stage 2 is a taxonomy-only authoring increment over all 149
canonical exercise identities. It will add strict, versioned, deterministic
taxonomy facts to the existing canonical facts owner. It will not activate a
consumer or change production behavior.

Taxonomy V1 describes four stable identity properties that are already reviewed
for every canonical identity:

1. movement patterns;
2. compoundness;
3. laterality;
4. associated equipment categories.

The schema is intentionally small. Each selected dimension is identity-owned,
plan-independent, has a bounded vocabulary, has complete committed repository
evidence, and supports known future catalog filtering, authoring validation, or
planning analysis after a separately reviewed consumer cutover.

### Non-goals

Stage 2 does not define or duplicate:

- stimulus weights or stimulus inheritance;
- measurement profiles, work metrics, load basis, rep basis, assistance
  direction, or history comparability;
- exercise family membership, substitution classes, grip, body position,
  support/stability demand, joint action, regional emphasis, or resistance
  mechanics;
- plan priority, placement role, session layer, continuity, prescription,
  progression, phase, availability, preference, fatigue state, or runtime
  eligibility;
- V2 materializer classes or aliases;
- PlanSpecificationPreviewV0 input;
- database schema, persistence, seed execution, synchronization, UI, API,
  accepted-seed, workout, or production behavior.

The former 47-identity working set is not a scope boundary. The four-day custom
plan is a regression fixture only and cannot author global facts.

## 2. Canonical schema

The future implementation adds the following exact object at
`facts.taxonomy` for every canonical entry in
`prisma/exercises_comprehensive.json`:

```ts
type KnownScalar<T extends string> = {
  status: "KNOWN";
  value: T;
};

type KnownSet<T extends string> = {
  status: "KNOWN";
  values: T[];
};

type UnresolvedField = {
  status: "UNRESOLVED";
  reason: "INSUFFICIENT_REPOSITORY_EVIDENCE";
  evidenceNeeded: string;
};

type CanonicalTaxonomyFactsV1 = {
  version: 1;
  movementPatterns:
    | KnownSet<CanonicalTaxonomyMovementPatternV1>
    | UnresolvedField;
  compoundness:
    | KnownScalar<CanonicalTaxonomyCompoundnessV1>
    | UnresolvedField;
  laterality:
    | KnownScalar<CanonicalTaxonomyLateralityV1>
    | UnresolvedField;
  equipment:
    | KnownSet<CanonicalTaxonomyEquipmentV1>
    | UnresolvedField;
};
```

Every property is required. Objects are strict. `version` selects this exact
contract and is not defaulted. The semantic object contains no provenance;
provenance is required in the evidence matrix so runtime-independent semantics
are not polluted with review metadata.

### Field meanings

| Field | Shape | Meaning | Known future use | Why it is not duplicated elsewhere |
| --- | --- | --- | --- | --- |
| `movementPatterns` | ordered set | Stable gross movement patterns associated with the canonical identity. Multiple values mean each pattern is intrinsic to the reviewed identity. | Catalog filtering and future authoring/analysis constraints. | It succeeds the overlapping legacy `movementPatterns` authoring field. V2 exercise classes remain a separate materializer policy. |
| `compoundness` | scalar | Whether the identity is cataloged as multi-joint/compound or non-compound. `NON_COMPOUND` does not mean the movement pattern must be `ISOLATION`. | Authoring validation and coarse exercise morphology. | It succeeds `isCompound`; contextual primary/accessory roles remain plan-owned. |
| `laterality` | scalar | Whether the reviewed identity is intrinsically unilateral under the current catalog contract. `NON_UNILATERAL` does not assert bilateral symmetry. | Variant filtering and laterality-aware future authoring checks. | It succeeds `unilateral`; rep aggregation and per-side logging remain measurement-owned. |
| `equipment` | ordered set | Equipment categories associated with the current canonical identity. The set does not infer AND/OR requirements, a primary implement, physical-machine identity, load basis, or resistance equivalence. | Existing-style equipment filtering after a separate cutover and variant review. | It succeeds the overlapping legacy `equipment` list but does not replace measurement semantics or user availability. |

## 3. Controlled vocabularies and order

The declaration order below is also canonical serialization order for set
values.

### Movement pattern

```text
HORIZONTAL_PUSH
VERTICAL_PUSH
HORIZONTAL_PULL
VERTICAL_PULL
SQUAT
HINGE
LUNGE
CARRY
ROTATION
ANTI_ROTATION
FLEXION
EXTENSION
ABDUCTION
ADDUCTION
ISOLATION
```

Legacy `calf_raise_extended` and `calf_raise_flexed` tokens normalize to
`ISOLATION` under `LEGACY_CALF_PATTERN_TO_ISOLATION_V1`. This is the same
compatibility meaning already used by catalog parsing; the aliases do not enter
the Taxonomy V1 vocabulary.

### Compoundness

```text
COMPOUND
NON_COMPOUND
```

### Laterality

```text
UNILATERAL
NON_UNILATERAL
```

`NON_UNILATERAL` is deliberately not named `BILATERAL`. It includes identities
for which left/right execution is not the defining distinction.

### Equipment

```text
BARBELL
DUMBBELL
MACHINE
CABLE
BODYWEIGHT
KETTLEBELL
BAND
SLED
BENCH
RACK
EZ_BAR
TRAP_BAR
OTHER
```

`EZ_Bar` and `Trap_Bar` source tokens normalize to `EZ_BAR` and `TRAP_BAR`.
Case, spaces, and hyphens do not create additional vocabulary.

## 4. Required fields and missing-state policy

All four fields and `version` are required for every one of the 149 identities.
Omission never means unknown, not applicable, or deferred.

`UNRESOLVED` is the only V1 field-level missing state. It means the field applies
but committed repository evidence is insufficient. It must serialize both the
fixed reason and a nonblank, reviewable `evidenceNeeded` string. It contributes
to identity coverage but not known-value completeness.

`NOT_APPLICABLE` is not a V1 missing state. The selected fields apply to all
identities; semantic values such as `NON_COMPOUND` and `NON_UNILATERAL` express
their exact reviewed meanings without pretending the field is absent.

Intentionally deferred dimensions are omitted from the schema itself and listed
in Section 7. They must not be represented by an omitted property or an
`UNRESOLVED` V1 field.

The approved matrix has zero unresolved values. The unresolved representation
exists so a later identity addition or evidence withdrawal fails explicitly
rather than receiving a default.

Resolution requires a reviewed change to both the canonical taxonomy fact and
its matrix provenance. An identity name, alias, UI label, plan, historical seed,
or nearby exercise is not sufficient evidence.

## 5. Cross-field validity

In addition to strict object and vocabulary validation:

1. A `KNOWN` set must contain at least one value, contain no duplicates, and be
   serialized in vocabulary order.
2. `ISOLATION` is mutually exclusive with every other movement-pattern value.
3. A `KNOWN` movement-pattern set containing `ISOLATION` requires
   `compoundness={status:"KNOWN",value:"NON_COMPOUND"}`.
4. `COMPOUND` does not require a particular movement pattern. Core, carries,
   and other identities must not be inferred from compoundness.
5. Equipment combinations have no inferred logical relationship. In
   particular, `BODYWEIGHT` may coexist with `MACHINE`, `BENCH`, or an external
   implement when that exact set is established by the matrix.
6. A `KNOWN` field may contain only its value member (`value` or `values`). An
   `UNRESOLVED` field may contain only `status`, `reason`, and `evidenceNeeded`.
7. Cross-field rules never infer or repair a value. A contradiction is rejected.

No name-based, alias-based, muscle-based, or neighbor-identity inference is
permitted.

## 6. Authority and legacy-field transition

The contract branch changes no current authority. During the future Stage 2
implementation, the reviewed evidence matrix performs one import from committed
legacy fields. Once that implementation is approved, `facts.taxonomy` becomes
the only writable authoring authority for the four overlapping concepts.
Legacy fields remain unchanged compatibility projections for current consumers
until a separate consumer-cutover stage.

The transition is one-directional:

```text
committed legacy fields at baseline
        | one reviewed import
        v
facts.taxonomy (authoring authority)
        | deterministic compatibility projection
        v
legacy fields for unchanged current consumers
```

There is no reverse synchronization after import. A future edit to an
overlapping legacy field is invalid unless it is the deterministic projection
of the canonical taxonomy change. Stage 2 itself does not authorize such a
semantic change. The future implementation must validate the projection but
must not migrate a consumer.

### Exact overlap inventory

| Semantic concept/current column | Current owner | Stage 2 authority | Mapping direction | Stage 2 behavior | Future disposition |
| --- | --- | --- | --- | --- | --- |
| `catalogKey` | canonical catalog identity | unchanged identity owner | none | Exact key joins facts and matrix. | Retain. |
| `name` | canonical display identity | unchanged display owner | none | Evidence only; never derives taxonomy. | Retain. |
| `facts.stimulus` | canonical stimulus authoring facts | unchanged stimulus owner | none | Preserve 148 vectors and one `MISSING`. | Retain independently. |
| `movementPatterns` | legacy catalog field | `facts.taxonomy.movementPatterns` | one-time legacy import, then taxonomy -> compatibility field | Exact token normalization; no consumer migration. | Remove legacy authoring authority at later cutover. |
| `isCompound` | legacy catalog field | `facts.taxonomy.compoundness` | one-time legacy import, then taxonomy -> compatibility field | `true -> COMPOUND`, `false -> NON_COMPOUND`. | Remove legacy authoring authority at later cutover. |
| `unilateral` | legacy catalog field | `facts.taxonomy.laterality` | one-time legacy import, then taxonomy -> compatibility field | `true -> UNILATERAL`, `false -> NON_UNILATERAL`. | Remove legacy authoring authority at later cutover. |
| `equipment` | legacy catalog field | `facts.taxonomy.equipment` | one-time legacy import, then taxonomy -> compatibility field | Exact normalized set; no modality/load inference. | Remove legacy authoring authority at later cutover. |
| `measurementProfile`, `loadConvention`, `repBasis` | exercise-measurement semantics | unchanged measurement owner | none | Explicitly excluded from taxonomy. | Retain independently. |
| `primaryMuscles`, `secondaryMuscles` | catalog muscle relations | unchanged structural relation owner | none | Explicitly excluded; stimulus coefficients are separate. | Retain independently. |
| `splitTag` | legacy browsing/session grouping | unchanged compatibility owner | none | Excluded because it mixes presentation and plan grouping. | Review separately before any retirement. |
| `jointStress`, `contraindications` | governed training/limitation policy | unchanged policy owner | none | Excluded; user/context interaction is not stable taxonomy V1. | Retain independently pending separate policy review. |
| `fatigueCost`, `sfrScore`, `lengthPositionScore`, `stimulusBias` | governed training/scoring policy | unchanged policy owner | none | Excluded; scores and training judgments are not identity morphology. | Retain independently pending separate policy review. |
| `difficulty`, `timePerSetSec`, `repRangeRecommendation` | legacy coaching/UI/prescription metadata | unchanged legacy owner | none | Excluded from taxonomy. | Review separately. |
| `isMainLiftEligible` | legacy general runtime eligibility | unchanged legacy owner | none | Explicitly excluded because plan prominence is contextual. | Review in a separate consumer stage. |

## 7. Evidence and derivation policy

Each matrix field provenance is exactly one of:

- `EXISTING_CANONICAL_FIELD`: the semantic value is directly established by a
  committed baseline field; token normalization does not alter meaning;
- `DETERMINISTIC_RULE`: a named, contract-approved rule maps committed source
  evidence to the value;
- `EXPLICIT_AUTHORED_FACT`: a separately reviewed identity-level fact not
  derivable from a current field;
- `UNRESOLVED`: applicable meaning lacks sufficient repository evidence.

Allowed V1 derivation rules are:

| Rule ID | Input | Output |
| --- | --- | --- |
| `MOVEMENT_TOKEN_NORMALIZATION_V1` | canonical movement token | uppercase Taxonomy V1 token |
| `LEGACY_CALF_PATTERN_TO_ISOLATION_V1` | `calf_raise_extended` or `calf_raise_flexed` | `ISOLATION` |
| `COMPOUNDNESS_BOOLEAN_V1` | `isCompound` boolean | `COMPOUND` or `NON_COMPOUND` |
| `LATERALITY_BOOLEAN_V1` | `unilateral` boolean | `UNILATERAL` or `NON_UNILATERAL` |
| `EQUIPMENT_TOKEN_NORMALIZATION_V1` | reviewed equipment token | uppercase underscore Taxonomy V1 token |

No Stage 2 matrix row uses `EXPLICIT_AUTHORED_FACT` or `UNRESOLVED` because the
selected schema is completely supported by baseline evidence. A later use of
either requires a separately reviewed matrix change.

### Rejected or deferred dimensions

| Dimension | Decision | Reason |
| --- | --- | --- |
| Exercise family | Defer | No governed all-149 family membership exists; name proximity is forbidden. |
| Movement direction | Reject in V1 | It would duplicate or incompletely derive movement pattern. |
| Body position/support | Defer | Current names and equipment do not provide a complete controlled source. |
| Grip/orientation | Defer | Some identities encode grip in their names, but no all-catalog evidence rule exists. |
| Resistance/loading/assistance relationship | Exclude | Measurement semantics own load and assistance meaning; unclassified identities must remain fail-closed there. |
| Stability/support demand | Reject in V1 | Current scores are governed training judgments, not stable categorical identity facts. |
| Joint action/regional classification | Defer | Current movement and muscle relations are insufficient for a complete non-inferred ontology. |
| Joint stress, SFR, fatigue, length position, difficulty | Exclude | These are training-policy scores or judgments and would create competing authorities. |

## 8. All-149 evidence matrix contract

`catalog-facts-stage-2-taxonomy-matrix.json` is the committed, deterministic,
machine-reviewable design input for the later implementation. It is not imported
by production code.

Each row contains:

- exact canonical key and current display name;
- the proposed complete Taxonomy V1 object;
- per-field provenance kind, source field, and derivation rule IDs;
- ambiguity and variant-preservation notes;
- validation status.

Rows are ordered by Unicode code-point ordering of `catalogKey`. Every canonical
key appears exactly once; aliases never appear as keys. The matrix header records
the baseline SHA, counts, vocabularies, value counts, unresolved counts, and
source paths.

The matrix has 149 valid rows and zero unresolved fields. Multi-equipment rows
retain an explicit note that the category set does not infer conjunction,
alternatives, load basis, or physical-equipment equivalence. Every row states
that taxonomy similarity cannot merge canonical identities.

## 9. Variant preservation and adversarial pairs

Taxonomy is descriptive, not identity-defining. Equal taxonomy values never
authorize aliasing, merging, substitution, history comparison, or stimulus
inheritance. The canonical key remains the semantic owner.

The following pairs/groups were checked against the matrix:

| # | Identities | Preserved distinction |
| --- | --- | --- |
| 1 | Barbell Bench Press / Dumbbell Bench Press | Equipment sets differ; keys remain distinct. |
| 2 | Incline Barbell Bench Press / Incline Dumbbell Bench Press | Equipment differs without inferring identical loading. |
| 3 | Cable Fly / Dumbbell Fly | Cable versus dumbbell categories remain explicit. |
| 4 | Cable Lateral Raise / Dumbbell Lateral Raise | Same morphology may coexist with distinct equipment and identities. |
| 5 | Machine Lateral Raise / Cable Lateral Raise | Machine versus cable remains distinct. |
| 6 | Barbell Overhead Press / Seated Barbell Overhead Press | Taxonomy may match; body position remains identity-owned and unmodeled rather than guessed. |
| 7 | Barbell Row / Chest-Supported Dumbbell Row | Equipment differs; support/body position remains in identity, not inferred. |
| 8 | Chest-Supported Dumbbell Row / Chest-Supported T-Bar Row | Equipment differs; support similarity does not merge identity. |
| 9 | Seated Cable Row / Close-Grip Seated Cable Row | Taxonomy may match; identity-defining grip remains preserved by key. |
| 10 | Pull-Up / Weighted Pull-Up | Equipment set differs; measurement owner retains load relationship. |
| 11 | Pull-Up / Machine-Assisted Pull-Up | Bodyweight versus machine category; assistance and stimulus are not inferred. |
| 12 | Weighted Pull-Up / Machine-Assisted Pull-Up | Added load and assistance are not treated as equivalent. |
| 13 | Pull-Up / Neutral Grip Pull-Up | Taxonomy may match; grip-specific identity remains distinct. |
| 14 | Chin-Up / Pull-Up | Taxonomy may match; supinated/pronated meaning remains identity-owned. |
| 15 | Lat Pulldown / Iso-Lateral Front Lat Pulldown | Catalog keys and equipment sets remain distinct; no family inheritance. |
| 16 | Lat Pulldown / Straight-Arm Pulldown | Current movement may overlap, while compoundness preserves morphology difference. |
| 17 | Romanian Deadlift / Barbell Romanian Deadlift | The overloaded legacy identity remains distinct from the barbell-specific identity. |
| 18 | Barbell Romanian Deadlift / Dumbbell Romanian Deadlift | Equipment distinguishes exact implementations. |
| 19 | Walking Lunge / Dumbbell Reverse Lunge | Laterality/compoundness can match; execution identity remains separate. |
| 20 | Single-Leg Hip Thrust / Barbell Hip Thrust | Laterality and equipment differ. |
| 21 | Standing Calf Raise / Seated Calf Raise | Both normalize to `ISOLATION`; identity retains knee-position distinction. |
| 22 | Dip (Chest Emphasis) / Dip (Triceps Emphasis) | Taxonomy may match; emphasis and stimulus remain independently authored. |
| 23 | One-Arm Dumbbell Row / Dumbbell Row | Laterality distinguishes current reviewed identities. |
| 24 | Machine Chest Press / Barbell Bench Press | Machine/free-weight equipment differs without comparison inference. |

The selected four-day custom-plan identities all appear in the matrix, but no
field or vocabulary was derived from that fixture.

## 10. Machine-Assisted Pull-Up

`machine-assisted-pull-up` receives the same four taxonomy dimensions as every
other canonical identity, from its committed movement, compoundness,
laterality, and equipment fields. Its measurement tuple remains owned by the
measurement contract.

Its stimulus remains exactly:

```json
{"disposition":"MISSING"}
```

Stage 2 does not copy the Pull-Up, Weighted Pull-Up, Neutral Grip Pull-Up, or
pulldown stimulus vector; define family inheritance; treat assistance as
external loading; or resolve the missing profile. Stimulus completion requires
a separate reviewed decision.

## 11. Validation contract

Validation returns stable diagnostics in canonical sort order:

```ts
type CanonicalTaxonomyDiagnosticV1 = {
  code: CanonicalTaxonomyErrorCodeV1;
  catalogKey?: string;
  path: string;
  detail?: string;
};
```

Diagnostics never include inferred replacements. The future implementation
must use these exact codes:

| Code | Condition |
| --- | --- |
| `CANONICAL_TAXONOMY_MISSING` | Canonical identity omits `taxonomy`. |
| `CANONICAL_TAXONOMY_NOT_OBJECT` | Taxonomy is null, scalar, or array. |
| `CANONICAL_TAXONOMY_EMPTY` | Taxonomy is `{}`. |
| `CANONICAL_TAXONOMY_VERSION_INVALID` | Version is absent or not exactly `1`. |
| `CANONICAL_TAXONOMY_UNKNOWN_FIELD` | Object contains an undeclared property. `detail` is the field. |
| `CANONICAL_TAXONOMY_FIELD_MISSING` | Required field absent. `path` names it. |
| `CANONICAL_TAXONOMY_FIELD_SHAPE_INVALID` | Field status/value members do not match the discriminated shape. |
| `CANONICAL_TAXONOMY_STATUS_INVALID` | Status is not `KNOWN` or `UNRESOLVED`. |
| `CANONICAL_TAXONOMY_ENUM_UNKNOWN` | Scalar or set contains an unknown enum token. |
| `CANONICAL_TAXONOMY_SET_EMPTY` | A known set has zero values. |
| `CANONICAL_TAXONOMY_SET_DUPLICATE` | A known set repeats a value. |
| `CANONICAL_TAXONOMY_SET_ORDER_INVALID` | A known set is not in declared vocabulary order. |
| `CANONICAL_TAXONOMY_SET_COMBINATION_INVALID` | `ISOLATION` is combined with another movement pattern. |
| `CANONICAL_TAXONOMY_CROSS_FIELD_INVALID` | Known `ISOLATION` conflicts with known `COMPOUND`. |
| `CANONICAL_TAXONOMY_UNRESOLVED_INVALID` | Unresolved reason is wrong or `evidenceNeeded` is blank/extra value members exist. |
| `CANONICAL_TAXONOMY_ALIAS_OWNER_FORBIDDEN` | Alias record supplies taxonomy or facts. |
| `CANONICAL_TAXONOMY_MATRIX_IDENTITY_MISSING` | Canonical key is absent from matrix. |
| `CANONICAL_TAXONOMY_MATRIX_IDENTITY_EXTRA` | Matrix contains a noncanonical or alias key. |
| `CANONICAL_TAXONOMY_MATRIX_IDENTITY_DUPLICATE` | Matrix repeats a canonical key. |
| `CANONICAL_TAXONOMY_MATRIX_PROVENANCE_INVALID` | Field lacks an allowed provenance kind/source/rule. |
| `CANONICAL_TAXONOMY_LEGACY_MISMATCH` | Deterministic compatibility projection disagrees with an overlapping legacy field. |
| `CANONICAL_TAXONOMY_SERIALIZATION_NONCANONICAL` | Identity, field, or set order or JSON formatting differs from canonical form. |

A partial object reports all deterministically discoverable missing/invalid
fields. An explicit valid `UNRESOLVED` field passes shape validation and is
counted separately; it is never converted to a known value.

## 12. Deterministic serialization

The semantic field order is exactly:

```text
version
movementPatterns
compoundness
laterality
equipment
```

Within a known field, order is `status` then `value` or `values`. Within an
unresolved field, order is `status`, `reason`, `evidenceNeeded`. Sets use the
vocabulary order in Section 3. Matrix identities use catalog-key code-point
order, not display-name or locale order.

Canonical JSON is UTF-8 without BOM, two-space indentation, LF line endings,
no trailing whitespace, and one final newline. Numeric version is emitted as
`1`. The evidence matrix is committed because it is reviewed identity-level
evidence, not generated production output. Tests may rederive it from the
baseline inputs and must prove byte equality; they must not rewrite it.

The eventual semantic source of truth is each identity's
`facts.taxonomy` object in `prisma/exercises_comprehensive.json`. The matrix is
the approved import/provenance artifact and must agree exactly, but production
code must not import it.

## 13. Implementation ownership and boundaries

Canonical owner: `src/lib/exercise-library/canonical-exercise-facts.ts`, composed
per identity in `prisma/exercises_comprehensive.json`. This extends the Stage 1
owner and does not create a second registry.

The smallest later implementation surface is expected to be:

1. `canonical-exercise-facts.ts`: replace the deferred placeholder with exact
   Taxonomy V1 types, parser, diagnostics, and canonical serializer;
2. `exercises_comprehensive.json`: add one reviewed taxonomy object to each of
   the exact 149 identities without changing identity, stimulus, measurement,
   or unrelated legacy facts;
3. `catalog-invariants.ts`: enforce full membership, matrix provenance,
   alias separation, compatibility projection, and determinism;
4. focused canonical-facts and invariant tests;
5. this contract and matrix only if implementation evidence discovers a
   contract defect requiring separate review.

No schema, migration, generated database artifact, seed execution, or
synchronization is required. `src/lib/engine/stimulus.ts`, measurement owners,
V2 materializer taxonomy, PlanSpecificationPreviewV0, planner/runtime/API/UI,
accepted seed, and database code are read-only regression boundaries.

## 14. Eventual implementation acceptance criteria

Implementation is acceptable only when all of the following hold:

1. Canonical membership remains exactly 149 identities and 54 aliases.
2. Every canonical identity has one valid Taxonomy V1 object and one exact
   matrix row; no alias has either ownership.
3. Known field coverage is 149/149 for all four fields, or a future approved
   matrix revision explicitly accounts for each unresolved field.
4. Empty, partial, malformed, unknown, duplicate, unordered, contradictory,
   and extra-field taxonomy is rejected with the stable diagnostics above.
5. No default, display-name rule, alias rule, muscle inference, neighboring
   identity inference, or runtime fallback synthesizes taxonomy.
6. Every value has valid matrix provenance and an allowed source/rule.
7. The four legacy overlaps have one-way mappings and exact compatibility
   agreement; direct legacy authoring is rejected.
8. Measurement membership remains exactly `88/39/22`.
9. All existing 148 stimulus vectors remain byte-equivalent and
   `machine-assisted-pull-up` remains stimulus `MISSING`.
10. Taxonomy serialization and the all-149 matrix are byte-deterministic on
    Windows and CI.
11. Variant-pair assertions preserve distinct keys and prohibit alias-owned
    semantics or family/stimulus inheritance.
12. Current consumers remain behaviorally unchanged; no application,
    materializer, planner, runtime, UI, seed, sync, persistence, migration,
    database, or production behavior consumes taxonomy.
13. Focused catalog facts, catalog invariants, measurement, stimulus, consumer
    compatibility, architecture, command-registry, TypeScript/ESLint as
    selected by repository policy, `git diff --check`, and one credential-free
    inventory pass.

## 15. Future consumer boundary

Stage 2 ends after authoring, validation, serialization, evidence, and
invariants. Any consumer must be proposed as a separate stage that names the
owning use case, proves compatibility, selects an explicit cutover from legacy
projection to taxonomy, and verifies no reinterpretation of accepted seeds,
workouts, history, stimulus, or measurement.

Until then:

- taxonomy is inert;
- current consumers read their existing fields;
- the V2 materializer taxonomy remains independent;
- the accepted seed and runtime remain unaware of Taxonomy V1;
- a taxonomy correction cannot silently change runtime behavior.

## 16. Design verification record

The committed matrix validation for this design must prove:

- 149 rows and 149 unique canonical keys;
- exact equality with current canonical key/display-name membership;
- zero alias keys;
- four required fields per identity;
- vocabulary counts equal the matrix header;
- zero unresolved fields;
- no empty, duplicate, unknown, unordered, or contradictory sets;
- exact one-way derivation from the four baseline fields;
- no measurement or stimulus fields in taxonomy;
- the 24 adversarial pairs remain distinct;
- all selected four-day test identities are present;
- Machine-Assisted Pull-Up taxonomy is valid while its stimulus decision stays
  outside the matrix.

This record proves the design artifacts, not production activation.
