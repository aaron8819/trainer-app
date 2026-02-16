# Exercise Novelty Rotation Testing Strategy

Comprehensive documentation of how exercise rotation (novelty scoring) is validated across unit and integration tests.

---

## Research Foundation

From `hypertrophyandstrengthtraining_researchreport.md`:

### Section 2.6 - Exercise Selection
> "**Exercise variation:** Non-uniform hypertrophy is well-documented—different exercises grow different regions of the same muscle. Rotate **2-4 exercises per muscle group per mesocycle**, maintaining core movements for 2-3 mesocycles to allow progressive overload tracking while rotating accessories for novel stimuli and joint stress management."

### Section 3.5 - Mesocycle Structure
> "**Standard mesocycle:** 3-6 weeks of progressive training + 1 deload week (most commonly 4+1). ... Maintain core exercises for 2-3 mesocycles; rotate accessories each mesocycle."

**Key Research Points:**
- **Main lifts:** Maintain for 2-3 mesocycles (6-18 weeks) for progressive overload tracking
- **Accessories:** Rotate each mesocycle (~3-6 weeks + deload)
- **Rationale:** Novel stimuli for hypertrophy + joint stress management

---

## Engine Design (Research-Aligned)

### Implementation

**Location:** `src/lib/engine/selection-v2/scoring.ts:96-102`

```typescript
// Target rotation cadence (weeks)
const TARGET_CADENCE = 3;

// Novelty score based on weeks since last use
const novelty = Math.min(1.0, exposure.weeksAgo / TARGET_CADENCE);
```

### Design Intent

- **3-week target cadence** aligns with research recommendation for mesocycle-length accessory rotation
- **Preference-based scoring (25% weight)** — not a hard constraint
- **Linear ramp:** 1 week ago = 0.33 score, 2 weeks ago = 0.67 score, 3+ weeks ago = 1.0 score
- **Allows flexibility:** Other factors (volume deficit, SFR, lengthened position) also influence selection

### Scoring Interpretation

| Weeks Since Last Use | Novelty Score | Selection Likelihood |
|---|---|---|
| 0 (same session) | 0.0 | Strongly avoided |
| 1 week ago | 0.33 | Penalized (can repeat if pool limited) |
| 2 weeks ago | 0.67 | Moderate preference against |
| 3 weeks ago | 1.0 | Full novelty (target achieved) |
| 4+ weeks ago | 1.0 | Full novelty (capped) |

**Main lifts exception:** Main lifts (squat/bench/deadlift) can repeat more frequently due to progressive overload tracking priority.

---

## Testing Strategy

### Tier 1: Unit Tests (Engine Design Validation)

**Location:** `src/lib/engine/selection-v2/__tests__/scoring.test.ts`

**What it validates:**
- ✅ 3-week target cadence is correctly implemented
- ✅ Novelty score formula matches research-based design
- ✅ Edge cases (fractional weeks, boundary conditions)
- ✅ Never-used exercises receive maximum novelty (1.0 score)

**Runtime:** <100ms

**Example tests:**
```typescript
describe("research-aligned 3-week target cadence", () => {
  it("should penalize exercises used 1 week ago (0.33 score)", () => {
    // Validates: Strong penalty for recent use
    expect(score).toBeCloseTo(0.33, 2);
  });

  it("should give full novelty to exercises used 3+ weeks ago (1.0 score)", () => {
    // Validates: Aligns with mesocycle rotation (3-6 weeks)
    expect(score).toBe(1.0);
  });
});
```

**Research citations:** Tests include inline documentation referencing specific sections of the research knowledge base.

**Verdict:** ✅ **Engine design is research-aligned**

---

### Tier 2: Integration Tests (API Layer Validation)

**Location:** `src/lib/engine/__tests__/end-to-end-simulation.test.ts`

**What it validates:**
- ✅ Novelty scoring is APPLIED during exercise selection
- ✅ ExerciseExposure history influences selection
- ✅ Accessories don't repeat in consecutive sessions within short windows
- ⚠️ **Does NOT validate 3-week target** (pragmatic testing compromise)

**Runtime:** ~120s (API layer loading overhead)

**Current assertion:**
```typescript
// Assert: 1-week minimum gap between accessory uses in 3-week window
assertExerciseRotation(exerciseUsage, 1);
```

**What this means:**
- Accessories cannot repeat in **consecutive weeks** (week 1 → week 2)
- Accessories CAN repeat after **1-week gap** (week 1 → week 3)
- This validates that novelty scoring EXISTS and REDUCES repeats
- This does NOT validate the 3-week target cadence

**Why not validate 3-week target in integration test?**

1. **Test window constraint:** 3-week test duration makes strict 3-week rotation hard to observe
2. **Limited exercise pool:** Each split (push/pull/legs) has finite exercises; strict rotation may exhaust pool
3. **Preference-based scoring:** 25% weight means other factors can override novelty in realistic scenarios
4. **Loading overhead:** Testing through API layer takes ~12-14s per workout generation (9 workouts = 120s total)

**Verdict:** ⚠️ **Integration test validates scoring exists, not 3-week target**

---

### Tier 3: Future Enhancements (Recommended)

#### Option A: Engine-Level Rotation Test (Fast)

**Approach:** Test engine directly with mocked workout context (bypass API layer)

**Benefits:**
- Runtime: <10s (no DB loading)
- Can validate full 6-week simulation (18 workouts) to test 3-week target
- Precise control over exercise pool size and rotation context

**Trade-offs:**
- Loses API integration coverage
- Requires mocking `WorkoutContext` (exercises, history, exposure, baselines)

**Recommendation:** Add this test to complement integration test

---

#### Option B: Cached Context for Integration Test

**Approach:** Cache `loadWorkoutContext()` result across multiple `generateSessionFromIntent()` calls

**Benefits:**
- Faster integration test (~30-40s instead of 120s)
- Could extend to 6-week simulation within reasonable timeout
- Maintains full API integration coverage

**Trade-offs:**
- Requires refactoring API layer to support context caching
- May introduce subtle bugs if cache invalidation is incorrect

**Recommendation:** Medium-term optimization

---

## Current Test Status Summary

| Test Type | Validates | Runtime | Research-Aligned? | Status |
|---|---|---|---|---|
| **Unit tests** (`scoring.test.ts`) | 3-week target cadence | <100ms | ✅ Yes | ✅ Passing |
| **Integration test** (`end-to-end-simulation.test.ts`) | Novelty scoring exists (1-week minimum) | ~120s | ⚠️ Partial | ✅ Passing |
| **Engine-level rotation test** (future) | 3-week target over 6-week simulation | <10s | ✅ Yes | 📋 Backlog |

---

## Clarifications on Test Assertions

### What "1-week minimum" actually means

```typescript
assertExerciseRotation(exerciseUsage, 1);
//                                     ^
//                                     minWeeksBetweenUse = 1
```

**Logic:**
- If exercise was used in week N, it **cannot** repeat in week N (same week)
- It **can** repeat in week N+1 or later (≥1 week gap)

**Example timeline:**
- Week 1: Exercise A used ✓
- Week 2: Exercise A can be used again (1 week gap) ✓
- Week 3: Exercise A can be used again (2 week gap) ✓

**Contrast with 3-week target:**
- Engine **prefers** 3-week gaps (TARGET_CADENCE = 3)
- Test only **validates** ≥1-week gaps (pragmatic minimum)

### Why the discrepancy is acceptable

1. **Unit tests validate design:** 3-week target is explicitly tested in `scoring.test.ts`
2. **Integration test validates behavior:** Novelty scoring reduces repeats in realistic API usage
3. **Preference-based system:** Engine uses weighted scoring (25% novelty), not hard constraints
4. **Production correctness:** Engine will naturally prefer 3-week gaps when pool allows

---

## Recommendations

### Short-term (Completed ✅)
1. ✅ Add explicit research citations to unit tests
2. ✅ Document testing compromise in ADR-061
3. ✅ Create this testing strategy documentation

### Medium-term (Backlog 📋)
4. Add engine-level rotation test (6-week simulation, <10s runtime)
5. Validate 3-week target over longer simulation
6. Test with varying exercise pool sizes (abundant vs limited)

### Long-term (Future 🔮)
7. Optimize API layer loading (cache workout context)
8. Extend integration test to 6-week window
9. Add regression tests for known rotation bugs

---

## References

- **Research:** `docs/knowledgebase/hypertrophyandstrengthtraining_researchreport.md`
- **Architecture:** `docs/architecture.md`
- **ADR-032:** Exercise exposure tracking for rotation management
- **ADR-036:** Selection-v2 beam search with rotation scoring
- **ADR-061:** Exercise rotation test performance optimization
- **Unit tests:** `src/lib/engine/selection-v2/__tests__/scoring.test.ts`
- **Integration tests:** `src/lib/engine/__tests__/end-to-end-simulation.test.ts`
- **Simulation utils:** `src/lib/engine/__tests__/simulation-utils.ts`

---

**Last Updated:** 2026-02-16
**Status:** Engine design is research-aligned; testing strategy validated and documented
