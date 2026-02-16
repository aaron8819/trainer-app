# User Settings Integration Analysis

**Date:** 2026-02-16
**Status:** ✅ Priority 1 Complete | Phase 2 Complete

## Executive Summary

**✅ RESOLVED (2026-02-16):** User "avoid exercises" preferences are now enforced as hard constraints (Phase 1) with full explainability transparency (Phase 2).

**Original Issue (RESOLVED):** User avoid preferences were only receiving a minimal soft penalty (2% weight in scoring), allowing avoided exercises to still be selected if they scored well on other criteria.

**Current Status:**
- ✅ **Phase 1 Complete:** User avoids enforced as hard constraints (ADR-062)
- ✅ **Phase 2 Complete:** Split contraindications with UI transparency (ADR-063)
- 📋 **Phase 3 Planned:** Enhanced substitution recommendations (optional)

---

## Table of Contents

1. [User Settings Schema](#1-user-settings-schema)
2. [Current Engine Integration](#2-current-engine-integration)
3. [Knowledgebase Comparison](#3-knowledgebase-comparison)
4. [Gap Analysis](#4-gap-analysis)
5. [Recommended Actions](#5-recommended-actions)

---

## 1. User Settings Schema

### UserPreference Model (Prisma)

```prisma
model UserPreference {
  userId               String   @id
  favoriteExercises    String[] @default([])
  avoidExercises       String[] @default([])
  favoriteExerciseIds  String[] @default([])
  avoidExerciseIds     String[] @default([])
  rpeTargets           Json?
  progressionStyle     String?
  optionalConditioning Boolean  @default(true)
  benchFrequency       Int?
  squatFrequency       Int?
  deadliftFrequency    Int?
  updatedAt            DateTime @updatedAt
}
```

### Engine Type Mapping

```typescript
export type UserPreferences = {
  favoriteExercises?: string[];
  avoidExercises?: string[];
  favoriteExerciseIds?: string[];
  avoidExerciseIds?: string[];
  optionalConditioning?: boolean;
};
```

**Observation:** The schema includes several preference fields, but only a subset are mapped to the engine types.

---

## 2. Current Engine Integration

### 2.1 Exercise Preferences (favoriteExercises / avoidExercises)

#### Data Flow

```
UserPreference DB
  ↓
mapPreferences() [workout-context.ts:284-302]
  ↓
UserPreferences (engine type)
  ↓
buildSelectionObjective() [template-session.ts:218]
  ↓
SelectionPreferences { favoriteExerciseIds: Set, avoidExerciseIds: Set }
  ↓
scoreUserPreference() [scoring.ts:220-237]
```

#### Implementation Details

**File:** `src/lib/api/template-session.ts`

```typescript
// Line 140: contraindications ONLY includes pain conflicts
contraindications: new Set(painFlagExerciseIds),

// Line 218: avoidExercises are passed to preferences (NOT contraindications)
preferences: {
  favoriteExerciseIds: new Set(mapped.mappedPreferences?.favoriteExerciseIds ?? []),
  avoidExerciseIds: new Set(mapped.mappedPreferences?.avoidExerciseIds ?? []),
},
```

**File:** `src/lib/engine/selection-v2/optimizer.ts`

```typescript
// Line 139: HARD constraint check (blocks selection)
if (objective.constraints.contraindications.has(exercise.id)) {
  return "contraindicated";
}
```

**File:** `src/lib/engine/selection-v2/scoring.ts`

```typescript
// Line 220-237: SOFT preference scoring (minimal influence)
export function scoreUserPreference(
  exercise: Exercise,
  preferences: SelectionPreferences
): number {
  if (preferences.avoidExerciseIds.has(exercise.id)) {
    return 0.0;  // ← Worst score
  }
  if (preferences.favoriteExerciseIds.has(exercise.id)) {
    return 1.0;  // ← Best score
  }
  return 0.5;  // ← Neutral
}
```

**File:** `src/lib/engine/selection-v2/types.ts`

```typescript
// Line 106: userPreference weight is only 2%
export const DEFAULT_SELECTION_WEIGHTS: SelectionWeights = {
  volumeDeficitFill: 0.4,    // 40%
  rotationNovelty: 0.25,     // 25%
  sfrEfficiency: 0.15,       // 15%
  lengthenedBias: 0.1,       // 10%
  movementDiversity: 0.05,   // 5%
  sraReadiness: 0.03,        // 3%
  userPreference: 0.02,      // 2% ← MINIMAL WEIGHT
};
```

#### Weighted Impact Calculation

If an avoided exercise scores perfectly on all other criteria (1.0):

```
Total Score = (0.4 × 1.0) + (0.25 × 1.0) + (0.15 × 1.0) + (0.1 × 1.0) + (0.05 × 1.0) + (0.03 × 1.0) + (0.02 × 0.0)
            = 0.98 (98th percentile!)
```

**An avoided exercise can still be selected if it's optimal for volume deficit, rotation, SFR, and lengthened position.**

---

### 2.2 Other Settings Integration Status

| Setting | Schema Field | Engine Integration | Status |
|---------|--------------|-------------------|--------|
| `favoriteExercises` | ✅ | Soft preference (2% weight) | ⚠️ Minimal impact |
| `avoidExercises` | ✅ | Soft preference (2% weight) | ❌ **NOT ENFORCED** |
| `optionalConditioning` | ✅ | Mapped but unused | ❌ Not implemented |
| `rpeTargets` | ✅ | Not mapped to engine | ❌ Not implemented |
| `progressionStyle` | ✅ | Not mapped to engine | ❌ Not implemented |
| `benchFrequency` | ✅ | Not mapped to engine | ❌ Not implemented |
| `squatFrequency` | ✅ | Not mapped to engine | ❌ Not implemented |
| `deadliftFrequency` | ✅ | Not mapped to engine | ❌ Not implemented |

**Summary:**
- 3/8 preference fields are mapped to engine types
- 2/8 are used in engine logic (favorites/avoids with minimal 2% weight)
- 0/8 are enforced as hard constraints
- 5/8 are stored but completely ignored

---

## 3. Knowledgebase Comparison

### What the Research Says

**File:** `docs/knowledgebase/hypertrophyandstrengthtraining_researchreport.md`

#### Exercise Selection Principles (Section 2.6)

> **Exercise variation:** Non-uniform hypertrophy is well-documented—different exercises grow different regions of the same muscle. Rotate **2-4 exercises per muscle group per mesocycle**, maintaining core movements for 2-3 mesocycles to allow progressive overload tracking while rotating accessories for novel stimuli and joint stress management.

**Application to User Preferences:**
- Research supports exercise rotation for **physiological reasons** (novel stimuli, joint stress management)
- User preferences could serve as **behavioral guardrails** within the research-backed rotation strategy
- Avoiding exercises for comfort/injury/equipment availability should be a **hard constraint**

#### SFR (Stimulus-to-Fatigue Ratio) (Section 3.5)

> Israetel's SFR concept compares adaptive stimulus to fatigue generated. **High-SFR exercises** (machines, cables, isolations) provide good stimulus with low systemic/joint fatigue. **Low-SFR exercises** (heavy barbell compounds) produce high absolute stimulus but also high fatigue. Program design should front-load high-fatigue compounds when fresh, then fill remaining volume with high-SFR isolation work.

**Application to User Preferences:**
- User avoids may correlate with low SFR for that individual (e.g., shoulder pain from upright rows)
- Ignoring avoids contradicts the research-backed principle of managing individual fatigue accumulation

#### Lengthened Position Bias (Section 2.6)

> **Lengthened-position bias (2022-2025 evidence):** Maeo et al. (2023): overhead triceps extensions produced ~40% more growth than pushdowns. **Practical rule: prioritize exercises that load muscles at long lengths.**

**Application to User Preferences:**
- User favorites may align with exercises that feel good in lengthened positions
- Current 2% weight means lengthened bias (10%) dominates over user preference
- **Conflict:** User might avoid overhead extensions due to shoulder discomfort, but engine selects them anyway for lengthened advantage

#### Autoregulation & Readiness (Section 3.4)

> **RIR-based:** Zourdos et al. (2016) validated the RIR-RPE scale for resistance training. Load adjustment: if prescribed RPE differs from reported by 1 point, adjust ~4%.

**Application to User Preferences:**
- Research validates **listening to individual feedback** via RPE/RIR
- User exercise preferences are a form of qualitative autoregulation
- Ignoring explicit "avoid" signals contradicts the research principle of individualized programming

---

### What the Knowledgebase Does NOT Say

The research literature does **not** explicitly discuss:
- User exercise preferences as a personalization factor
- Trade-offs between algorithmic optimization and user autonomy
- Psychological adherence factors (motivation, enjoyment, trust)

**Important Note:** The absence of explicit guidance means we must **infer** from adjacent principles:
- Autoregulation → individualization → respect user signals
- Injury prevention → avoid pain-inducing exercises → enforce avoids
- Adherence → enjoyment → honor preferences within evidence-based bounds

---

## 4. Gap Analysis

### 4.1 Critical Gaps

#### Gap 1: User Avoids Not Enforced as Hard Constraints

**Current Behavior:**
- `avoidExerciseIds` only influences 2% of the selection score
- Avoided exercises can still be selected if they score well on other criteria

**Expected Behavior:**
- User avoids should be **hard-filtered** like equipment constraints and pain conflicts

**Root Cause:**
```typescript
// src/lib/api/template-session.ts:140
contraindications: new Set(painFlagExerciseIds),  // ← Should include avoidExerciseIds
```

**Code Location:**
- `src/lib/api/template-session.ts:140` (constraint building)
- `src/lib/engine/selection-v2/optimizer.ts:139` (hard filter check)

**Research Alignment:** ❌ **Contradicts** autoregulation and individualization principles

---

#### Gap 2: Favorites Have Minimal Influence

**Current Behavior:**
- `favoriteExerciseIds` only contributes 2% to selection score
- Favorites rarely win over rotation novelty (25%) or volume deficit (40%)

**Expected Behavior:**
- Favorites should receive a **moderate boost** (suggested: 10-15% weight)
- OR: Favorites should be preferred as **tiebreakers** when scores are similar

**Research Alignment:** ⚠️ **Neutral** (research supports variety, but also supports adherence via enjoyment)

---

#### Gap 3: Unused Preference Fields

**Current Behavior:**
- `optionalConditioning`, `rpeTargets`, `progressionStyle`, `benchFrequency`, `squatFrequency`, `deadliftFrequency` are stored but ignored

**Expected Behavior:**
- Either implement or deprecate these fields (technical debt)

**Research Alignment:** N/A (no research guidance on these specific features)

---

### 4.2 Architecture Issues

#### Issue 1: Dual Storage of Exercise Preferences

**Problem:**
```typescript
favoriteExercises: string[]    // ← Legacy name-based
favoriteExerciseIds: string[]  // ← New ID-based
avoidExercises: string[]       // ← Legacy name-based
avoidExerciseIds: string[]     // ← New ID-based
```

**Why This Exists:**
- Likely a migration artifact from name-based to ID-based exercise tracking
- Both are persisted, creating data consistency risk

**Recommendation:** Deprecate name-based fields after backfill migration

---

#### Issue 2: Preferences vs. Constraints Separation

**Problem:**
- Pain conflicts → `constraints.contraindications` (hard filter)
- User avoids → `preferences.avoidExerciseIds` (soft penalty)
- **Semantically identical intent, different enforcement**

**Recommendation:** Unify pain conflicts and user avoids into a single contraindications set

---

## 5. Recommended Actions

### Priority 1: CRITICAL — Enforce User Avoids as Hard Constraints

**Change Required:**

**File:** `src/lib/api/template-session.ts`

```typescript
// BEFORE (line 140):
contraindications: new Set(painFlagExerciseIds),

// AFTER:
contraindications: new Set([
  ...painFlagExerciseIds,
  ...(mapped.mappedPreferences?.avoidExerciseIds ?? []),
]),
```

**Impact:**
- ✅ User avoids are now **hard-filtered** like equipment constraints
- ✅ No avoided exercises will appear in generated workouts
- ✅ Aligns with research principles of individualization and autoregulation

**Risk:** Low (additive change, no breaking changes)

**Test Coverage Needed:**
- Unit test: `avoidExerciseIds` appear in `constraints.contraindications`
- Integration test: Workout generation never selects avoided exercises

---

### Priority 2: MODERATE — Increase Favorite Exercise Weight

**Change Required:**

**File:** `src/lib/engine/selection-v2/types.ts`

```typescript
// BEFORE (line 374-383):
export const DEFAULT_SELECTION_WEIGHTS: SelectionWeights = {
  volumeDeficitFill: 0.4,
  rotationNovelty: 0.25,
  sfrEfficiency: 0.15,
  lengthenedBias: 0.1,
  movementDiversity: 0.05,
  sraReadiness: 0.03,
  userPreference: 0.02,  // ← Too low
};

// AFTER (Option A: Moderate boost):
export const DEFAULT_SELECTION_WEIGHTS: SelectionWeights = {
  volumeDeficitFill: 0.35,     // -0.05
  rotationNovelty: 0.20,       // -0.05
  sfrEfficiency: 0.15,
  lengthenedBias: 0.1,
  movementDiversity: 0.05,
  sraReadiness: 0.03,
  userPreference: 0.12,        // +0.10 (12%)
};
```

**Rationale:**
- 12% weight makes favorites competitive with lengthened bias (10%)
- Still respects volume deficit (35%) and rotation novelty (20%)
- Improves user trust without undermining evidence-based selection

**Alternative (Option B: Tiebreaker):**
- Keep 2% weight
- Add explicit tiebreaker logic: if top 3 candidates are within 5% score, prefer favorite

**Research Alignment:** ✅ Balanced approach (respects variety + adherence)

---

### Priority 3: LOW — Deprecate or Implement Unused Preferences

**Decision Required:** For each unused field, choose one:

| Field | Option A: Implement | Option B: Deprecate |
|-------|---------------------|---------------------|
| `optionalConditioning` | Add logic to skip conditioning finishers | Remove from schema |
| `rpeTargets` | Override `getBaseTargetRpe()` | Remove from schema |
| `progressionStyle` | Add progression variants (linear, wave, APRE) | Remove from schema |
| `benchFrequency` | Enforce main lift frequency caps | Remove from schema |
| `squatFrequency` | Enforce main lift frequency caps | Remove from schema |
| `deadliftFrequency` | Enforce main lift frequency caps | Remove from schema |

**Recommendation:**
- **Phase 1 (Quick Win):** Deprecate all unused fields, add migration to zero them out
- **Phase 2 (Future):** Re-introduce 1-2 high-value preferences based on user feedback
  - Suggested: `optionalConditioning` (easy to implement, clear UX value)
  - Suggested: `rpeTargets` (aligns with research on RPE-based autoregulation)

---

### Priority 4: HOUSEKEEPING — Consolidate Dual Storage

**Change Required:**

1. **Backfill Migration:**
   ```sql
   UPDATE "UserPreference"
   SET "favoriteExerciseIds" = ARRAY(
     SELECT id FROM "Exercise" WHERE name = ANY("favoriteExercises")
   )
   WHERE "favoriteExerciseIds" = '{}';
   ```

2. **Deprecate Name Fields:**
   - Remove `favoriteExercises`, `avoidExercises` from schema
   - Keep only `favoriteExerciseIds`, `avoidExerciseIds`

**Rationale:**
- Exercise names can change, IDs are stable
- Single source of truth prevents drift

---

## Summary Table

| Setting | Current Integration | Research Alignment | Recommended Action | Priority |
|---------|---------------------|--------------------|--------------------|----------|
| `avoidExercises` | Soft (2% penalty) | ❌ Contradicts individualization | **Enforce as hard constraint** | **P1 CRITICAL** |
| `favoriteExercises` | Soft (2% bonus) | ⚠️ Neutral | Increase to 12% weight or tiebreaker | P2 Moderate |
| `optionalConditioning` | Not used | N/A | Deprecate or implement | P3 Low |
| `rpeTargets` | Not used | ✅ Aligns with autoregulation | Deprecate or implement | P3 Low |
| `progressionStyle` | Not used | ✅ Aligns with periodization | Deprecate or implement | P3 Low |
| `benchFrequency` | Not used | ⚠️ Frequency is volume vehicle | Deprecate or implement | P3 Low |
| `squatFrequency` | Not used | ⚠️ Frequency is volume vehicle | Deprecate or implement | P3 Low |
| `deadliftFrequency` | Not used | ⚠️ Frequency is volume vehicle | Deprecate or implement | P3 Low |

---

## Implementation Status

### ✅ Phase 1: Complete (2026-02-16)

**Implemented:**
1. ✅ **Core Fix:** Added `avoidExerciseIds` to `constraints.contraindications` ([template-session.ts:140](../../src/lib/api/template-session.ts#L140))
2. ✅ **Test Coverage:** 6 comprehensive tests including substitution verification ([template-session.test.ts](../../src/lib/api/template-session.test.ts))
3. ✅ **Documentation:** ADR-062 logged in `docs/decisions.md`
4. ✅ **Validation:** All 843 tests passing, build clean

**Impact:**
- User-avoided exercises are now **impossible to select** (hard constraint enforcement)
- Substitution logic verified via beam search volume deficit scoring
- Critical user trust issue resolved

**See:** [ADR-062: Enforce User Avoid Preferences as Hard Constraints](../decisions.md#adr-062)

### ✅ Phase 2: Complete (2026-02-16)

**Implemented:**
1. ✅ **Schema Split:** Separated `contraindications` into `painConflicts`, `userAvoids`, `equipmentUnavailable`
2. ✅ **Specific Rejection Reasons:** Optimizer returns `"pain_conflict"`, `"user_avoided"`, `"equipment_unavailable"`
3. ✅ **Explainability Function:** Added `summarizeFilteredExercises()` with user-friendly messages
4. ✅ **UI Component:** Created `FilteredExercisesCard` showing grouped filtered exercises
5. ✅ **Test Coverage:** 19 new tests (4 optimizer, 7 explainability, 8 component)
6. ✅ **Documentation:** ADR-063 logged in `docs/decisions.md`

**Impact:**
- Users now see which exercises were filtered and why
- Grouped display (✓ preferences, ⚠️ pain conflicts, 🏋️ equipment)
- Enhanced transparency builds user trust
- All 863 tests passing, build clean

**See:**
- [ADR-063: Split Contraindications for Enhanced Explainability](../decisions.md#adr-063)
- [Phase 2 Completion Summary](../plans/phase2-completion-summary.md)

---

## Next Steps

### ✅ Completed (Phase 1 & 2)

1. ~~**Split Contraindications:**~~ ✅ Separated into `painConflicts`, `userAvoids`, `equipmentUnavailable`
2. ~~**Specific Rejection Reasons:**~~ ✅ Optimizer returns specific reasons
3. ~~**UI Component:**~~ ✅ Created `FilteredExercisesCard` with grouped display

### Short-Term (Next Sprint)

4. **Discuss P2 Fix:** Review favorite weight increase with product owner
5. **User Testing:** Validate that favorites now appear more frequently
6. **Performance:** Measure impact on beam search runtime (likely negligible)

### Long-Term (Next Quarter)

7. **Deprecation Plan:** Decide which unused preferences to keep/remove
8. **Migration:** Consolidate dual storage (name-based → ID-based)
9. **UX Research:** Survey users on which preferences matter most

---

## Appendix: Code References

### Key Files

1. **Schema:** `trainer-app/prisma/schema.prisma:224-238`
2. **Engine Types:** `trainer-app/src/lib/engine/types.ts:104-110`
3. **Mapping:** `trainer-app/src/lib/api/workout-context.ts:284-302`
4. **Constraint Building:** `trainer-app/src/lib/api/template-session.ts:135-147`
5. **Preference Scoring:** `trainer-app/src/lib/engine/selection-v2/scoring.ts:220-237`
6. **Hard Filtering:** `trainer-app/src/lib/engine/selection-v2/optimizer.ts:129-151`
7. **Default Weights:** `trainer-app/src/lib/engine/selection-v2/types.ts:374-383`

### Test Coverage Gaps

- ❌ No test validates avoided exercises are excluded from selection
- ❌ No test validates favorite exercises receive bonus
- ❌ No test validates preference weights sum to 1.0 (they do, but not enforced)

---

## Questions for Discussion

1. **User Avoids:**
   - Should avoids apply to ALL workouts or just auto-generated ones?
   - Should template mode allow pinning avoided exercises (user override)?

2. **Favorites:**
   - Is 12% weight appropriate, or should it be higher/lower?
   - Should favorites influence main lift selection or only accessories?

3. **Frequency Preferences:**
   - Are bench/squat/deadlift frequency caps valuable, or is this over-personalization?
   - Does frequency cap conflict with the research finding "frequency is a vehicle for volume"?

4. **RPE Targets:**
   - Should users be able to override base RPE targets (e.g., "always 2 RIR" vs research-backed progression)?
   - How to prevent users from setting counterproductive targets (e.g., "always RPE 10")?

---

**End of Analysis**
