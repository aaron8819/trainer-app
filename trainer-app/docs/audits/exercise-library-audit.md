# Exercise Library Audit Report

**Date:** 2026-02-18
**Scope:** Full stack audit of the exercise library as source of truth — JSON data, seeding pipeline, DB schema, API mapping, engine integration, selection scoring, substitution, and contraindication enforcement.

---

## Executive Summary

The exercise library is architecturally sound with strong explicit-data discipline, robust seed validation, and a well-structured pipeline from JSON → DB → API → Engine. However, **two critical bugs** exist in the pain/injury enforcement path, and several medium-severity issues affect data integrity and scoring correctness.

---

## Critical Findings

### C1 — `painConflicts` in Selection-V2 is Completely Non-Functional ✅ RESOLVED (2026-02-18)

**Fix:** Replaced `Object.keys(painFlags)` (body-part strings) with a two-step lookup: extract body parts with severity ≥ 2, then filter `mapped.exerciseLibrary` for exercises where `contraindications[bodyPart]` is truthy, collecting their IDs. Updated test fixture to use body-part keys (`{ shoulder: 3 }`) and added `contraindications: { shoulder: true }` to the bench fixture in `sample-data.ts`.

**Location:** `src/lib/api/template-session.ts:125-144`

The `painConflicts` constraint that should exclude exercises contraindicated for the user's current pain is built incorrectly:

```typescript
// template-session.ts:125-127
const painFlagExerciseIds = fatigueState.painFlags
  ? Object.keys(fatigueState.painFlags).filter((id) => (fatigueState.painFlags?.[id] ?? 0) >= 2)
  : [];

painConflicts: new Set(painFlagExerciseIds),  // ← Set(["knee", "low_back"])
```

`painFlags` has the shape `Record<string, 0|1|2|3>` with body part keys (`"knee"`, `"low_back"`, `"shoulder"`). The code filters those keys and stores them as "exercise IDs." The optimizer then checks:

```typescript
// optimizer.ts:132
if (objective.constraints.painConflicts.has(exercise.id)) { ... }  // exercise.id is a UUID
```

No exercise UUID will ever equal `"knee"` or `"low_back"`. **The selection-v2 pain exclusion is a no-op.** Users with knee pain will still be recommended exercises with `contraindications: { knee: true }`.

Note: the template-based contraindication check (lines 108-112, which reads `exercise.contraindications` directly against the check-in's `painFlags`) does work correctly for the template path. But that path only fires for `isStrict === false` templates, not for intent/auto-generated workouts.

**Impact:** High — safety-relevant. Users with injury flags selecting in the non-template path receive contraindicated exercises without warning.

---

### C2 — `TIME_PER_SET_OVERRIDES` in seed.ts is Dead Code

**Location:** `prisma/seed.ts:170-241`

`resolveTimePerSet()` first checks for a `timePerSetSec` property directly on the JSON exercise object. Virtually every exercise in `exercises_comprehensive.json` already has `timePerSetSec` defined, so the `TIME_PER_SET_OVERRIDES` block is never reached:

```typescript
function resolveTimePerSet(ex: JsonExercise): number {
  if ("timePerSetSec" in ex && typeof ex.timePerSetSec === "number") {
    return ex.timePerSetSec;  // ← always taken for all 133 exercises
  }
  const override = TIME_PER_SET_OVERRIDES[ex.name];  // ← never reached
  ...
}
```

The overrides contain values like `"Barbell Back Squat": 210`, `"Hack Squat": 150`, but the JSON has `"Barbell Back Squat": { "timePerSetSec": 75 }` and `"Hack Squat": { "timePerSetSec": 50 }`. The JSON values win. The `TIME_PER_SET_OVERRIDES` map (72 lines of code) is maintenance overhead with no effect.

**Impact:** Medium — the `timePerSetSec` in the engine represents set work-time (rest is added separately via `getRestSeconds()`), so the engine is internally consistent. However, this creates a confusing dual source-of-truth and the intent of the overrides (to correct short times for heavy compounds) is silently ignored.

---

## High Severity Findings

### H1 — Selection Weights Sum to 1.20, Not 1.0

**Location:** `src/lib/engine/selection-v2/types.ts:392-400`

The `SelectionWeights` interface JSDoc states "sum to 1.0." The `DEFAULT_SELECTION_WEIGHTS` values do not:

| Weight | Value |
|---|---|
| volumeDeficitFill | 0.40 |
| rotationNovelty | 0.25 |
| sfrEfficiency | 0.15 |
| movementDiversity | 0.15 |
| lengthenedBias | 0.20 |
| sraReadiness | 0.03 |
| userPreference | 0.02 |
| **Total** | **1.20** |

`lengthenedBias: 0.20` was added (Phase 4) without removing another weight. The `totalScore` ceiling is now 1.20, which means `BEAM_TIEBREAKER_EPSILON = 0.05` (intended as "5% of max score") is now actually ~4.2% of max — minor precision difference but the code invariant is violated and scores are harder to reason about.

**Impact:** Medium — doesn't break selection but violates stated invariants. The lengthenedBias weight effectively takes precedence over intent because its raw contribution (0.20 × score) exceeds expected.

---

### H2 — `SubstitutionRule` DB Table is Dead Code

**Location:** `prisma/schema.prisma:358-369`, `src/lib/engine/substitution.ts`

The `SubstitutionRule` table exists with `fromExerciseId`, `toExerciseId`, `reason`, `priority`, `constraints`, and `preserves` columns. No code anywhere populates it or reads from it. `suggestSubstitutes()` is purely algorithmic — scoring by movement pattern overlap, muscle overlap, stimulus bias overlap, and fatigue delta. The DB-backed table implies an override/curator capability that was never implemented.

**Impact:** Low code impact, medium confusion impact. The schema suggests a curation workflow that doesn't exist.

---

### H3 — Substitution Ignores Knee, Wrist, and Hip Pain ✅ RESOLVED (2026-02-18)

**Fix:** Added `kneePain`, `wristPain`, and `hipPain` checks to `applyPainConstraints()` following the existing pattern. Added four new tests in `substitution.test.ts` covering knee, wrist, hip filtering and severity-1 non-filtering.

**Location:** `src/lib/engine/substitution.ts:48-79`

`applyPainConstraints()` only filters for three body parts:

```typescript
const elbowPain = painFlags.elbow !== undefined && painFlags.elbow >= 2;
const shoulderPain = painFlags.shoulder !== undefined && painFlags.shoulder >= 2;
const lowBackPain = painFlags.low_back !== undefined && painFlags.low_back >= 2;
```

The exercise database uses **five contraindication keys**: `knee`, `low_back`, `shoulder`, `elbow`, `wrist`, and `hip`. Knee is by far the most common — approximately 30 exercises carry `"knee": true`. Yet when a user reports knee pain (severity ≥ 2) and taps "Find Substitutes" for an exercise, the function will still suggest other knee-contraindicated exercises (squats, leg extensions, Bulgarian split squats, etc.) as valid replacements.

**Impact:** High — safety-relevant for the substitution UX.

---

## Medium Severity Findings

### M1 — V2→V1 Movement Pattern Fallback Uses "push" for Non-Push Patterns

**Location:** `src/lib/api/workout-context.ts:40-64`

```typescript
const V2_TO_V1: Record<string, MovementPattern> = {
  flexion: "push",       // ← bicep curls, leg curls recorded as "push"
  extension: "push",     // ← leg extensions recorded as "push"
  abduction: "push",     // ← hip abductions recorded as "push"
  adduction: "push",
  isolation: "push",
};
```

These fall back to `"push"` which is incorrect for lower-body and arm isolation exercises. V1 patterns in `WorkoutHistoryEntry` feed SRA calculations and any analytics that reads `movementPattern` from history. Bicep curls being tagged as `"push"` corrupts any pattern-based frequency analysis.

**Impact:** Medium — affects historical data quality. V1 is labeled "backward compat" but is still actively written for every workout.

---

### M2 — Nordic Hamstring Curl Misclassified as "isolation" ✅ RESOLVED (2026-02-18)

**Fix:** Changed `"movementPatterns": ["isolation"]` → `["flexion"]` in `exercises_comprehensive.json`. Re-seeded (133 updated).

**Location:** `prisma/exercises_comprehensive.json`, exercise "Nordic Hamstring Curl"

Nordic Hamstring Curl has `"movementPatterns": ["isolation"]`. Per the JSON field guide: isolation is "only for exercises that don't fit other patterns." The Nordic is a classic knee flexion exercise — it should be `"flexion"` like Lying Leg Curl and Seated Leg Curl.

Consequences:
- In substitution scoring, the pattern overlap between Nordic and any leg curl will be 0 (both are hamstring exercises but one says `isolation`, the other says `flexion`). Substitutes will score poorly.
- In the movement diversity scorer, Nordic won't contribute to "flexion pattern covered" diversity tracking.

---

### M3 — `splitTags` Array is Underutilized (Always Single-Element)

**Location:** `prisma/seed.ts:968`, `prisma/schema.prisma:294`

The DB schema stores `splitTags SplitTag[]` (array), and the `Exercise` engine type has `splitTags: SplitTag[]`. The JSON uses a single `splitTag` string, and the seed does `splitTags: [splitTag]`. Every exercise has exactly one tag. This means:

- Pull-Ups can't be tagged as both `pull` and `core`
- Farmer's Walk can't be tagged as both `conditioning` and `legs`
- No engine logic can leverage exercises that span multiple training contexts

The array capability is schema-promised but never realized.

---

### M4 — ExerciseExposure Rotation History Lost on Exercise Rename

**Location:** `src/lib/engine/selection-v2/scoring.ts:89-91`, `prisma/seed.ts:247-267`

The rotation context is keyed by exercise name, not ID (noted as a "CRITICAL" comment in the code). The seed has already executed 19 exercise renames. Any user who had done "Hip Thrust" before the rename to "Barbell Hip Thrust" has their rotation history orphaned — the engine sees zero exposure for the renamed exercise and treats it as brand-new.

---

### M5 — Abs Volume Landmark Is Effectively Unreachable

**Location:** `prisma/seed.ts:163`

`Abs` has `{ mv: 0, mev: 0, mav: 10, mrv: 16, sraHours: 36 }`. Exercises with "Abs" as a primary muscle are core exercises (Plank, Cable Crunch, etc.) which carry `splitTag: "core"`. In the selection engine, `BLOCKED_TAGS = ["core", "mobility", "prehab", "conditioning"]` prevents these from being selected as accessories. The engine will never generate direct ab volume in normal workout generation. The muscle landmark exists but the volume target will never be filled.

---

## Low Severity / Design Observations

### L1 — `ExerciseVariation` Table is Never Populated

`prisma/schema.prisma:320-328`: The `ExerciseVariation` model has `variationType` (enum) and `metadata` (JSON) but no seed data is written. `loadExerciseDetail()` returns `variations: exercise.variations.map(...)` which will always be an empty array.

### L2 — `timePerSetSec` Not in JSON Field Guide

The `_fieldGuide` in `exercises_comprehensive.json` documents 16 fields but omits `timePerSetSec`, which all 133 exercises have explicitly set. New contributors won't know the field exists, its units (seconds), or that it represents only work time (rest is added by the engine separately via `getRestSeconds()`).

### L3 — `Good Morning` fatigueCost/jointStress Inconsistency

Good Morning has `fatigueCost: 3` and `jointStress: "high"`. It is a barbell hinge with the bar on the back — notorious spinal loading. Every other `jointStress: "high"` compound (Back Squat, Front Squat, Conventional Deadlift, Sumo Deadlift) has `fatigueCost: 4-5`. The 3 rating allows Good Morning to appear in selections more readily than its injury profile warrants.

### L4 — Default Score Coalescing Masks Missing Data

In `mapExercises()` and `loadExerciseLibrary()`:
```typescript
sfrScore: exercise.sfrScore ?? 3,
lengthPositionScore: exercise.lengthPositionScore ?? 3,
fatigueCost: exercise.fatigueCost ?? 3,
```

The seed validation ensures all 133 seeded exercises have explicit values, so these defaults should never fire. However, any exercise inserted directly to the DB (bypassing seed) would silently receive average scores — undetectable in scoring output.

### L5 — `isMainLiftEligible: true` for Machine-Only Exercises

Leg Press, Hack Squat, and Belt Squat are all `isMainLiftEligible: true`. For hypertrophy this is defensible, but for users with strength or athleticism goals, having a machine-only leg session as the primary stimulus is a missed opportunity for barbell development. The engine doesn't currently gate `isMainLiftEligible` by goal or training age.

### L6 — `timePerSetSec` is Rep-Range-Blind for Heavy Compounds

Barbell Back Squat has `timePerSetSec: 75`. Heavy strength-focused squat sets (1-3 reps) need only ~15-25s of work time, while the rep-aware fallback in the engine (`Math.max(20, Math.min(90, targetReps * 2 + 10))`) partially compensates. However, the exercise-level `timePerSetSec` value bypasses this calculation entirely (`finalWorkSeconds = repAwareWorkSeconds ?? workSeconds` — rep-aware takes priority), so this is less impactful than it appears.

---

## Structural Strengths (What's Working Well)

- **Explicit field assignment with no derivation** — Every exercise has `movementPatterns`, `splitTags`, `isCompound`, `isMainLiftEligible`, etc. explicitly assigned. No regex, no inference.
- **Seed validation tests** — `seed-validation.test.ts` protects against unknown muscles, invalid enums, missing required fields, and data consistency without a DB connection.
- **Idempotent, safe seeding pipeline** — `pruneStaleExercises()` preserves exercises with user history. Renames are handled with explicit alias preservation. The `EXERCISES_TO_DELETE_BEFORE_RENAME` guard prevents merge conflicts.
- **18 canonical muscles with landmarks** — Volume tracking has a principled foundation. SRA hours per muscle are seeded into the `Muscle` table and propagated to `muscleSraHours` in `mapExercises()`.
- **Multi-layer contraindication data** — `contraindications` is stored as JSON with body-part keys, usable by both the template path and substitution function (when correctly wired — see C1, H3).
- **133 exercises with consistent numeric scores** — The scoring fields (`sfrScore`, `lengthPositionScore`, `fatigueCost`, `timePerSetSec`, `repRangeMin`, `repRangeMax`) are all explicitly assigned and validated at the data layer.
- **Clean separation of concerns** — JSON → seed (Prisma) → `mapExercises()` → engine. The engine never knows about the DB.

---

## Prioritized Recommendations

| Priority | Finding | Action |
|---|---|---|
| **1 — Fix Now** | C1: `painConflicts` broken | Build `painConflicts` by mapping active pain body parts to exercise IDs via `contraindications` lookup before calling `selectExercisesOptimized` |
| **2 — Fix Now** | H3: Substitution ignores knee/wrist/hip pain | Add `knee`, `wrist`, `hip` checks to `applyPainConstraints()` in `substitution.ts` |
| **3 — Fix Soon** | H1: Weights sum to 1.20 | Reduce one weight by 0.20 (e.g. `lengthenedBias: 0.20 → 0.10`, `movementDiversity: 0.15 → 0.05`) to restore the 1.0 invariant |
| **4 — Fix Soon** | M2: Nordic misclassified | Change Nordic Hamstring Curl `movementPatterns` from `["isolation"]` to `["flexion"]` in JSON and re-seed |
| **5 — Clean Up** | C2: Dead `TIME_PER_SET_OVERRIDES` | Delete the `TIME_PER_SET_OVERRIDES` object and simplify `resolveTimePerSet()` to just return `ex.timePerSetSec ?? 120` |
| **6 — Clean Up** | M1: V2→V1 fallback | Fix `flexion → "pull"`, `extension → "push"` for upper body, or deprecate V1 pattern from active write paths |
| **7 — Design** | M3: `splitTags` single-element | Either change JSON field to array and support multi-tag, or change schema to `splitTag String` to match reality |
| **8 — Docs** | L2: `timePerSetSec` not in field guide | Add to `_fieldGuide`: "Set work duration in seconds (rest added by engine separately via getRestSeconds)" |
| **9 — Data** | L3: Good Morning fatigueCost | Raise `fatigueCost` from 3 to 4 to match `jointStress: "high"` profile |
| **10 — Consider** | H2: SubstitutionRule dead table | Implement curator overrides or drop the table from the schema |
