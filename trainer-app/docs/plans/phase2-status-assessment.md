# Phase 2: Selection Intelligence - Status Assessment

**Date:** 2026-02-14
**Status:** BLOCKED - Critical structural issues discovered

---

## Executive Summary

Phase 2 implementation has **critical bugs** that prevent deployment. The beam search optimizer produces **structurally invalid workouts** (all accessories OR only main lift) due to missing constraints. Volume context population is working, but selection logic needs fundamental fixes before rotation can be tested.

**Recommendation:** **PAUSE deployment**. Fix structural constraints, then resume testing.

---

## What's Working ✅

### Core Infrastructure (Completed)

1. **Selection-v2 Modules Created**
   - `optimizer.ts` - Entry point for beam search
   - `beam-search.ts` - Multi-objective optimization algorithm
   - `candidate.ts` - Exercise scoring with indirect volume
   - `scoring.ts` - Modular scoring functions (7 objectives)
   - `rationale.ts` - Explainability generation
   - `types.ts` - Complete type system
   - **118 unit tests passing** (95%+ coverage)

2. **Indirect Volume Accounting** ✅
   - Formula: `effective = direct + (indirect × 0.3)`
   - Implemented in `computeVolumeContribution()`
   - Integration test passes: "should NOT select front delt accessories after heavy pressing"

3. **Exercise Rotation Tracking** ✅
   - `ExerciseExposure` table tracking (from Phase 1)
   - `loadExerciseExposure()` API working
   - `updateExerciseExposure()` hook wired into workout completion
   - Rotation novelty scoring: `min(1.0, weeksAgo / 3)`
   - Performance trend analysis (linear regression on 1RM estimates)

4. **Volume Context Population** ✅ (Fixed today)
   - `weeklyTarget` populated with MEV values for session muscles
   - `weeklyActual` populated from history
   - `effectiveActual` populated with direct + (indirect × 0.3)
   - Volume ceiling (MRV) constraints added
   - **This was the rotation blocker we just fixed**

5. **Integration Tests** ✅
   - 11 comprehensive tests covering:
     - Indirect volume prevents redundant selections
     - Rotation enforces variety
     - 12-week macro cycle simulation
     - Constraint satisfaction (MRV, time, equipment, contraindications)
     - Performance correctness (< 100ms, deterministic)
   - **All 11 tests passing**

6. **Performance** ✅
   - Selection completes in < 100ms (p95) for 50-exercise pool
   - Deterministic results (same input → same output)
   - 559 total tests passing

---

## What's Broken ❌

### Critical Issue: Unstable Workout Structure

**Problem:** Beam search produces **structurally invalid workouts** that oscillate between extremes:

1. **First generation:** 8 accessories, **NO main lifts**
   - Pec Deck Machine, Cable Fly variants, Dumbbell Fly variants, Pullover, Triceps Extension
   - Estimated time: 35 minutes
   - **Missing bench press, overhead press, or any compound movement**

2. **Second generation:** 1 main lift, **NO accessories**
   - Dumbbell Bench Press only
   - Estimated time: 12 minutes
   - **Missing all accessory work**

**Root Cause:**

The beam search is purely optimizing for **total score** without **structural constraints**:

```typescript
// Current constraints (from buildSelectionObjective)
const constraints: SelectionObjective["constraints"] = {
  volumeFloor: new Map(),         // Empty (no floor)
  volumeCeiling,                   // MRV caps (working)
  timeBudget,                      // Time limit (working)
  equipment,                       // Available equipment (working)
  contraindications,               // Pain flags (working)
  minExercises: 2,                 // ✅ Enforced
  maxExercises: 8,                 // ✅ Enforced
};
```

**Missing constraints:**
- ❌ No minimum main lifts (should be 1-2 for push/pull/legs)
- ❌ No minimum accessories (should be 2-3 to fill deficits)
- ❌ No balance between compound and isolation work

**Why this happens:**

1. **Accessories score high on SFR** (low fatigue, moderate stimulus)
   - Cable Fly: sfrScore 4/5, fatigueCost 2/5
   - Pec Deck: sfrScore 4/5, fatigueCost 2/5
   - Beam search picks all accessories to maximize total score

2. **OR main lifts score high on volume contribution**
   - Bench Press: 8 sets × (Chest + 0.3×Front Delts + 0.3×Triceps)
   - Fills multiple deficits efficiently
   - Beam search picks only main lift to maximize deficit fill

**Impact:**
- **Cannot test rotation** until structural issues fixed
- **Cannot deploy** (workouts are invalid for training)
- Phase 2 delivery blocked

---

## Comparison to Original Plan

### Original Phase 2 Plan (selection-optimization.md)

**Deliverables:**
- ✅ Multi-objective scoring function (7 objectives weighted)
- ✅ Indirect volume accounting in selection
- ✅ Lengthened-position bias weighting (implemented, weight = 0.10)
- ✅ Exercise rotation memory (ExerciseExposure + scoring)
- ❌ **Constraint-satisfying selection** (BROKEN - missing structural constraints)

**Success Metrics:**
- ✅ Selection fills volume deficits efficiently (deficit fill working)
- ✅ No front delt accessories after heavy press days (indirect volume working)
- ❌ Exercise rotation < 3 weeks between repeats (**CANNOT TEST** - structural issues block testing)
- ❌ Tests: Selection satisfies all hard constraints (**FAILING** - produces invalid workouts)

### Original Weights (from spec)

**Planned:**
```typescript
weights: {
  volumeDeficitFill: 0.30,
  sfrEfficiency: 0.20,
  lengthenedBias: 0.15,
  movementDiversity: 0.10,
  sraReadiness: 0.10,
  rotationNovelty: 0.10,
  userPreference: 0.05,
}
```

**Implemented (DEFAULT_SELECTION_WEIGHTS):**
```typescript
weights: {
  volumeDeficitFill: 0.40,   // ⬆ Increased (primary objective)
  rotationNovelty: 0.25,     // ⬆ Increased (force variety)
  sfrEfficiency: 0.15,       // ⬇ Decreased
  lengthenedBias: 0.10,      // ⬇ Decreased
  movementDiversity: 0.05,   // ⬇ Decreased
  sraReadiness: 0.03,        // ⬇ Decreased
  userPreference: 0.02,      // ⬇ Decreased
}
```

**Analysis:** Weights prioritize deficit fill and rotation (correct for Phase 2 focus), but **no amount of weight tuning fixes structural constraint gaps**.

---

## Required Fixes

### Priority 1: Add Structural Constraints (CRITICAL)

**Option A: Hard Constraints (Recommended)**

Add to `SelectionConstraints` interface:

```typescript
export interface SelectionConstraints {
  // ... existing constraints

  // NEW: Workout structure constraints
  minMainLifts?: number;      // Default 1 for push/pull/legs, 0 for body_part
  maxMainLifts?: number;      // Default 3 (prevent over-fatigue)
  minAccessories?: number;    // Default 2 (fill remaining deficits)
}
```

Enforce in beam search expansion:
```typescript
// In beam-search.ts, add validation:
function isStructureValid(state: BeamState, objective: SelectionObjective): boolean {
  const mainLiftCount = state.selected.filter(c => c.exercise.isMainLiftEligible).length;
  const accessoryCount = state.selected.filter(c => !c.exercise.isMainLiftEligible).length;

  const { minMainLifts = 0, maxMainLifts = 99, minAccessories = 0 } = objective.constraints;

  // At final depth, enforce minimums
  if (state.selected.length >= objective.constraints.minExercises) {
    if (mainLiftCount < minMainLifts) return false;
    if (accessoryCount < minAccessories) return false;
  }

  // Always enforce maximums
  if (mainLiftCount > maxMainLifts) return false;

  return true;
}
```

**Option B: Two-Phase Selection (Alternative)**

1. **Phase 1:** Select main lifts first (beam search over `isMainLiftEligible === true`)
2. **Phase 2:** Select accessories to fill remaining deficits (beam search over `isMainLiftEligible === false`)

**Recommendation:** Use Option A (simpler, more flexible).

### Priority 2: Set Defaults in buildSelectionObjective

```typescript
// In template-session.ts
const constraints: SelectionObjective["constraints"] = {
  volumeFloor: new Map(),
  volumeCeiling,
  timeBudget: mapped.mappedConstraints.sessionMinutes,
  equipment: new Set(mapped.mappedConstraints.availableEquipment),
  contraindications: new Set(painFlagExerciseIds),
  minExercises: 2,
  maxExercises: 8,

  // NEW: Structural constraints
  minMainLifts: sessionIntent === "body_part" ? 0 : 1,  // 1 for PPL, 0 for custom
  maxMainLifts: 3,                                       // Prevent over-fatigue
  minAccessories: 2,                                     // Ensure variety
};
```

### Priority 3: Update Tests

Add integration test to prevent regression:

```typescript
it("should enforce workout structure (main lifts + accessories)", () => {
  const exercises = [
    createMockExercise("bench_press", ["Chest"], [], { isMainLiftEligible: true }),
    createMockExercise("ohp", ["Front Delts"], [], { isMainLiftEligible: true }),
    createMockExercise("cable_fly", ["Chest"], []),
    createMockExercise("lateral_raise", ["Side Delts"], []),
    createMockExercise("triceps_ext", ["Triceps"], []),
  ];

  const objective = createMockObjective(new Map([
    ["Chest", 12],
    ["Front Delts", 0], // KB: MEV = 0
    ["Side Delts", 8],
    ["Triceps", 6],
  ]));

  const result = selectExercisesOptimized(exercises, objective);

  // Should have at least 1 main lift
  const mainLiftCount = result.selected.filter(c => c.exercise.isMainLiftEligible).length;
  expect(mainLiftCount).toBeGreaterThanOrEqual(1);
  expect(mainLiftCount).toBeLessThanOrEqual(3);

  // Should have at least 2 accessories
  const accessoryCount = result.selected.filter(c => !c.exercise.isMainLiftEligible).length;
  expect(accessoryCount).toBeGreaterThanOrEqual(2);

  // Total should be balanced
  expect(result.selected.length).toBeGreaterThanOrEqual(3);
  expect(result.selected.length).toBeLessThanOrEqual(8);
});
```

---

## Implementation Plan

### Step 1: Add Structural Constraint Fields (30 min)

1. Update `SelectionConstraints` interface in `types.ts`
2. Add defaults in `buildSelectionObjective()` in `template-session.ts`
3. Update `createMockObjective()` in `test-utils.ts` with defaults

### Step 2: Enforce in Beam Search (45 min)

1. Create `isStructureValid()` helper in `beam-search.ts`
2. Call during beam expansion to filter invalid states
3. Add rejection reason: `"structure_constraint_violated"`

### Step 3: Test & Validate (30 min)

1. Add integration test (above)
2. Run all 559 tests → should still pass
3. Manual test: Generate push workout → should have 1-2 main lifts + 2-3 accessories

### Step 4: Test Rotation (30 min)

1. Generate push workout
2. Complete it (mark as done)
3. Generate another push workout
4. **Verify exercises rotate** (different accessories, possibly different main lift)

**Total Estimated Time:** 2-3 hours

---

## Deployment Blockers

**Before deploying Phase 2:**

1. ❌ Fix structural constraints (Priority 1)
2. ❌ Validate rotation working with real data
3. ❌ Update documentation (ADR-036, architecture.md, decisions.md)
4. ✅ Performance validated (< 100ms)
5. ✅ Exposure tracking working
6. ✅ Volume context working

**Current blocker:** Structural constraints must be added before any manual testing can resume.

---

## Recommendations

### Immediate Actions (Today)

1. **Implement structural constraints** (Option A from Priority 1)
2. **Add integration test** to prevent regression
3. **Run full test suite** to verify no breakage
4. **Manual test** to verify workouts are now valid
5. **Test rotation** with fixed structure

### Short-term (This Week)

1. Document ADR-036: "Multi-objective selection with structural constraints"
2. Update architecture.md with selection-v2 architecture
3. Monitor production for 48h after deploy
4. Tune weights if needed based on user feedback

### Long-term (Phase 3+)

1. Consider two-phase selection for more control (main lifts first, then accessories)
2. Add configurable structural constraints in user settings
3. Build UI to visualize selection tradeoffs (Pareto frontier)

---

## Lessons Learned

1. **Beam search without structure constraints produces edge cases** - Pure score optimization can lead to all-accessories or all-main-lifts
2. **Integration tests caught indirect volume issues** - Unit tests passed, but integration revealed gaps
3. **Manual testing essential** - Automated tests didn't catch structural invalidity
4. **Volume context was red herring** - Rotation wasn't working because workouts were structurally invalid, not because volume context was empty

---

## Next Steps

**User decision required:**

A. **Fix structural constraints now** (recommended) - 2-3 hours, then resume testing
B. **Rollback to old selector** - Defer Phase 2, focus on other phases
C. **Two-phase selection approach** - More work, but cleaner separation

**If A (recommended):** I can implement the fix immediately and we can resume testing rotation within 2-3 hours.

**If B:** We preserve Phase 1 (periodization) and defer selection improvements to later.

**If C:** Cleaner architecture but requires more refactoring (estimate: 1-2 days).

---

**Status:** Awaiting user decision on fix approach.
