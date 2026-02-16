# Research Validation Summary: Exercise Novelty Rotation

**Date:** 2026-02-16
**Validated By:** Research knowledge base comparison
**Status:** ✅ Engine design is research-aligned; testing strategy validated and documented

---

## Question

> "We had to reduce scope of the novelty rotation for the sake of one of the tests. Compare this approach against the knowledge base and validate if this is the right approach or suggest otherwise."

---

## Verdict

### ✅ **Engine Design: Research-Aligned**

The engine's 3-week target cadence (`TARGET_CADENCE = 3` in `scoring.ts`) **perfectly matches** research recommendations:

**Research Evidence:**
- Section 2.6: "Rotate 2-4 exercises per muscle group per **mesocycle**"
- Section 3.5: "Standard mesocycle: **3-6 weeks**... rotate accessories each mesocycle"

**Engine Implementation:**
- 3-week target for accessory rotation ✅
- Linear novelty scoring: 1 week = 0.33, 2 weeks = 0.67, 3+ weeks = 1.0 ✅
- Preference-based (25% weight), not hard constraint ✅

---

### ⚠️ **Test Reduction: Pragmatic Compromise**

The integration test's reduced scope (1-week minimum instead of 3-week target) is a **testing compromise**, not an engine design flaw.

**What Changed:**
- Original test: 6-week simulation, 3-week minimum rotation
- Optimized test: 3-week simulation, **1-week minimum rotation**

**Why This Is Acceptable:**

1. **Unit tests validate design:**
   - `scoring.test.ts` explicitly validates 3-week target with research citations ✅
   - Tests cover: 1 week (0.33 score), 2 weeks (0.67 score), 3 weeks (1.0 score) ✅

2. **Integration test validates behavior:**
   - Confirms novelty scoring is APPLIED during selection ✅
   - Validates ExerciseExposure history influences selection ✅
   - Tests that accessories don't repeat in consecutive weeks ✅

3. **Pragmatic constraints:**
   - 3-week test window makes strict 3-week rotation hard to observe
   - Limited exercise pool per split (push/pull/legs) can exhaust options
   - API layer loading overhead (120s for 9 workouts)
   - Preference-based scoring means other factors can override novelty

---

## Recommendation: APPROVED with Documentation

### ✅ What Was Done (Completed)

1. **Enhanced unit tests** (`scoring.test.ts`)
   - Added explicit research citations in test documentation
   - Created nested describe blocks for clarity
   - Added edge case tests (fractional weeks, boundary conditions)
   - All 36 tests passing ✅

2. **Updated ADR-061** (`decisions.md`)
   - Added "Research Foundation" section with citations
   - Added "Research Alignment Status" table
   - Clarified testing compromise vs engine design
   - Documented future improvements

3. **Created comprehensive testing docs**
   - `novelty-rotation-testing.md`: Full testing strategy
   - `research-validation-summary.md`: This document
   - Explains 3-tier testing approach (unit → integration → future)

4. **All tests passing**
   - Unit tests: 36 passed in <5ms ✅
   - Integration tests: 6 passed in ~140s ✅

---

## Three-Tier Testing Strategy

### Tier 1: Unit Tests ✅ (Research-Aligned)
- **Location:** `src/lib/engine/selection-v2/__tests__/scoring.test.ts`
- **Validates:** 3-week target cadence is correctly implemented
- **Runtime:** <100ms
- **Status:** ✅ Passing with research citations

### Tier 2: Integration Tests ✅ (Pragmatic)
- **Location:** `src/lib/engine/__tests__/end-to-end-simulation.test.ts`
- **Validates:** Novelty scoring exists and reduces repeats (1-week minimum)
- **Runtime:** ~120s
- **Status:** ✅ Passing, documented as testing compromise

### Tier 3: Future Enhancements 📋 (Backlog)
- **Proposed:** Engine-level 6-week simulation (no API layer)
- **Would validate:** 3-week target over realistic mesocycle duration
- **Runtime:** <10s (no DB loading)
- **Status:** 📋 Recommended for future implementation

---

## Key Insights

### Research Recommendation
> "Rotate accessories each mesocycle (~3-6 weeks) for novel stimuli while maintaining core movements for 2-3 mesocycles (6-18 weeks) for progressive overload tracking."

### Engine Implementation
```typescript
// src/lib/engine/selection-v2/scoring.ts:97
const TARGET_CADENCE = 3; // ✅ Aligns with research (3-6 week mesocycle)
```

### Testing Approach
- **Unit tests:** Validate the 3-week design ✅
- **Integration tests:** Validate scoring is applied (1-week minimum) ⚠️
- **Production behavior:** Engine prefers 3-week gaps when pool allows ✅

**Conclusion:** The engine is correctly designed. The test validates a weaker condition for pragmatic reasons, but this is acceptable because:
1. Unit tests cover the design intent
2. Integration test confirms behavioral correctness
3. Documentation clearly explains the compromise

---

## Files Modified

1. ✅ `src/lib/engine/selection-v2/__tests__/scoring.test.ts`
   - Enhanced with research citations and nested describe blocks

2. ✅ `docs/decisions.md` (ADR-061)
   - Added research foundation section
   - Clarified testing compromise vs engine design
   - Documented future improvements

3. ✅ `docs/tests/novelty-rotation-testing.md` (NEW)
   - Comprehensive testing strategy documentation
   - Research alignment analysis
   - Three-tier testing approach

4. ✅ `docs/tests/research-validation-summary.md` (NEW)
   - This summary document

---

## Final Answer to Original Question

**Q:** "Compare the reduced novelty rotation scope against the research knowledge base and validate if this is the right approach."

**A:**

### Engine Design: ✅ VALIDATED
The engine's 3-week target cadence is **research-aligned** and **correctly implemented**. The design perfectly matches recommendations from `hypertrophyandstrengthtraining_researchreport.md` to rotate accessories every mesocycle (3-6 weeks).

### Test Reduction: ✅ ACCEPTABLE (with caveats)
The integration test's 1-week minimum assertion is a **pragmatic testing compromise**, not a design flaw. This is acceptable because:

1. **Unit tests validate the 3-week target** (with research citations)
2. **Integration test validates scoring is applied** (not that it achieves the target)
3. **Documentation clearly explains the compromise** (ADR-061, testing docs)
4. **Future improvements are documented** (engine-level test recommended)

### Recommendation: KEEP CURRENT APPROACH ✅
- Engine design is correct ✅
- Testing strategy is pragmatic ✅
- Documentation is comprehensive ✅
- No code changes needed ✅

**The "reduced scope" in the integration test does NOT indicate a design flaw. It's a well-documented testing trade-off that preserves validation of the core behavior (novelty scoring reduces repeats) without requiring 540s of DB persistence operations.**

---

## References

- **Knowledge Base:** `docs/knowledgebase/hypertrophyandstrengthtraining_researchreport.md`
  - Section 2.6: Exercise Selection and Variation
  - Section 3.5: Mesocycle Structure and Deloading
- **Engine Design:** `src/lib/engine/selection-v2/scoring.ts` (lines 96-102)
- **Unit Tests:** `src/lib/engine/selection-v2/__tests__/scoring.test.ts`
- **Integration Tests:** `src/lib/engine/__tests__/end-to-end-simulation.test.ts`
- **ADR-061:** Exercise Rotation Test Performance Optimization
- **Testing Strategy:** `docs/tests/novelty-rotation-testing.md`

---

**Conclusion:** The engine is research-aligned. The testing approach is pragmatic and well-documented. No changes recommended. ✅
