# Phase 3.5: Per-Muscle Autoregulation

**Status:** Planned
**Created:** 2026-02-15
**Dependencies:** Phase 3 (Readiness & Autoregulation)
**Estimated Effort:** 1 week

---

## Problem Statement

**Current State (Phase 3):**
- ✅ Muscle soreness data is collected via readiness check-in
- ✅ Per-muscle fatigue scores are calculated (`perMuscle: Record<string, number>`)
- ❌ **Soreness does NOT affect overall fatigue score**
- ❌ **Autoregulation scales ALL exercises uniformly** based on overall score only

**Issue Identified (2026-02-15):**
During Scenario 3 testing, user set chest=3 (very sore), shoulders=1 (none), and expected chest exercises to be scaled more aggressively than shoulder exercises. Instead:
- Overall fatigue: 60% (maintain zone)
- All exercises treated equally
- Sore chest did not trigger selective scaling

**User Impact:**
- Users with localized muscle soreness don't get targeted recovery
- High injury risk if a sore muscle is pushed at full intensity
- Suboptimal volume distribution (healthy muscles undertrained, sore muscles overtrained)

---

## Goals

**Primary Goal:**
Enable selective exercise scaling based on per-muscle fatigue scores.

**Success Criteria:**
1. Chest soreness=3 → chest exercises scaled down (-10% load, +1 RIR)
2. Shoulder soreness=1 → shoulder exercises proceed normally
3. Overall fatigue score incorporates worst-case muscle soreness
4. Per-exercise rationale explains muscle-specific scaling

---

## Design Options

### Option A: Global Score Penalty (Simpler, MVP)

**Approach:**
Include worst-case muscle soreness in overall fatigue calculation.

**Algorithm:**
```typescript
function computeSubjectiveScore(subjective: SubjectiveReadiness): number {
  const readiness = (subjective.readiness - 1) / 4;
  const motivation = (subjective.motivation - 1) / 4;

  // Compute worst-case muscle fatigue from soreness
  const sorenessValues = Object.values(subjective.soreness);
  const worstMuscleFatigue = sorenessValues.length > 0
    ? Math.min(...sorenessValues.map(s => 1 - (s - 1) / 2)) // 1→1.0, 2→0.5, 3→0.0
    : 1.0; // Default to fresh if no soreness data

  // Weighted combination (include worst muscle penalty)
  const subjectiveScore =
    readiness * 0.5 +          // 50%
    motivation * 0.3 +         // 30%
    worstMuscleFatigue * 0.2;  // 20% (caps overall if any muscle very sore)

  return Math.max(0, Math.min(1, subjectiveScore));
}
```

**Example:**
- Readiness: 3 → 0.5
- Motivation: 3 → 0.5
- Chest soreness: 3 → worstMuscleFatigue = 0.0
- **Overall = 0.5×0.5 + 0.5×0.3 + 0.0×0.2 = 0.40 (40%)**
- **Action: Scale down (< 50% threshold)**

**Pros:**
- Simple to implement (~15 minutes)
- Conservative (protects injured muscles)
- Works with existing autoregulation logic

**Cons:**
- Scales ALL exercises, not just sore muscles
- May unnecessarily reduce volume on healthy muscles

---

### Option B: Per-Exercise Targeted Scaling (More Sophisticated)

**Approach:**
Map exercises to primary muscles, apply per-muscle fatigue scores selectively.

**Requirements:**
1. **Exercise-to-muscle mapping:**
   ```typescript
   const EXERCISE_MUSCLES: Record<string, string[]> = {
     "Barbell Bench Press": ["chest", "shoulders"],
     "Dumbbell Lateral Raise": ["shoulders"],
     "Lying Triceps Extension": ["arms"],
     // etc.
   };
   ```

2. **Per-exercise fatigue lookup:**
   ```typescript
   function getExerciseFatigue(
     exerciseName: string,
     perMuscle: Record<string, number>
   ): number {
     const muscles = EXERCISE_MUSCLES[exerciseName] || [];
     if (muscles.length === 0) return 1.0; // Default to fresh

     // Use worst-case muscle involved
     return Math.min(...muscles.map(m => perMuscle[m] ?? 1.0));
   }
   ```

3. **Modified autoregulation:**
   ```typescript
   function autoregulateWorkout(
     workout: WorkoutPlan,
     fatigueScore: FatigueScore,
     policy: AutoregulationPolicy
   ): AutoregulatedWorkout {
     const modifications: AutoregulationModification[] = [];

     const adjustedExercises = workout.exercises.map(ex => {
       // Get muscle-specific fatigue for this exercise
       const exerciseFatigue = getExerciseFatigue(ex.name, fatigueScore.perMuscle);

       // Determine action based on per-exercise fatigue
       const action = selectAction(exerciseFatigue, policy, config);

       if (action === 'scale_down') {
         // Apply selective scaling
         return scaleExerciseDown(ex, exerciseFatigue, modifications);
       }

       return ex; // No modification
     });

     return { adjustedWorkout: { ...workout, exercises: adjustedExercises }, modifications };
   }
   ```

**Example:**
- Chest soreness: 3 → chest fatigue = 0.0
- Shoulders soreness: 1 → shoulder fatigue = 1.0
- **Bench Press** (chest + shoulders) → fatigue = min(0.0, 1.0) = **0.0** → **scale down**
- **Lateral Raise** (shoulders only) → fatigue = **1.0** → **maintain**

**Pros:**
- Surgical precision (only scales affected exercises)
- Optimal volume distribution
- Evidence-based (targets compromised muscles)

**Cons:**
- Requires exercise-to-muscle mapping metadata
- More complex logic
- Need to handle multi-muscle exercises (worst-case or average?)

---

### Option C: Hybrid Approach (Recommended)

**Phase 3.5 (Week 1):** Implement Option A (global penalty)
- Quick win, conservative protection
- Test and validate with users

**Phase 4 (if needed):** Upgrade to Option B (per-exercise scaling)
- Add exercise-to-muscle metadata
- Refine autoregulation logic
- A/B test against Option A

---

## Implementation Plan (Option A - MVP)

### 1. Update `computeSubjectiveScore()` (5 min)
**File:** `src/lib/engine/readiness/compute-fatigue.ts`

```typescript
function computeSubjectiveScore(subjective: SubjectiveReadiness): number {
  const readiness = (subjective.readiness - 1) / 4;
  const motivation = (subjective.motivation - 1) / 4;

  // Compute worst-case muscle fatigue from soreness
  const sorenessValues = Object.values(subjective.soreness);
  const worstMuscleFatigue = sorenessValues.length > 0
    ? Math.min(...sorenessValues.map(s => 1 - (s - 1) / 2))
    : 1.0;

  // Weighted combination
  const subjectiveScore =
    readiness * 0.5 +
    motivation * 0.3 +
    worstMuscleFatigue * 0.2;

  return Math.max(0, Math.min(1, subjectiveScore));
}
```

### 2. Update Tests (10 min)
**File:** `src/lib/engine/readiness/compute-fatigue.test.ts`

```typescript
it('should penalize overall score for worst-case muscle soreness', () => {
  const signal: ReadinessSignal = {
    timestamp: new Date(),
    userId: 'user-1',
    subjective: {
      readiness: 5,
      motivation: 5,
      soreness: {
        chest: 3, // Very sore
        shoulders: 1, // Fresh
      },
    },
    performance: { rpeDeviation: 0, stallCount: 0, volumeComplianceRate: 1.0 },
  };

  const result = computeFatigueScore(signal);

  // readiness=1.0, motivation=1.0, worstMuscle=0.0
  // subjective = 1.0×0.5 + 1.0×0.3 + 0.0×0.2 = 0.8
  // overall = 0.8×0.6 + 0.75×0.4 = 0.78
  expect(result.overall).toBeCloseTo(0.78, 2);

  // Chest very sore → should lower overall enough to stay out of scale-up zone
  expect(result.overall).toBeLessThan(0.85); // No scale-up
});
```

### 3. Update Documentation (5 min)
**File:** `docs/architecture.md`

Add to Autoregulation section:
> **Muscle Soreness Integration (Phase 3.5):**
> Worst-case muscle soreness is included in subjective score (20% weight). If any muscle is very sore (soreness=3), overall fatigue is capped at ~80%, preventing upward regulation and triggering scale-down if combined with moderate readiness.

### 4. Re-test Scenario 3 (5 min)
**Expected Results:**
- Readiness: 3, Motivation: 3, Chest: 3
- New overall score: ~40% (vs old 60%)
- **Action: Scale down** (all exercises, -10% load)
- Rationale: "Chest very sore (0% fatigue) → global scale-down"

---

## Testing Checklist

**Scenario 3 (Updated):**
- [ ] Chest=3 → overall fatigue < 50% → triggers scale-down
- [ ] All exercises scaled uniformly (-10% load)
- [ ] Rationale mentions worst-case muscle soreness

**Scenario 3b (New):**
- [ ] Chest=2 (moderate) → overall ~55-60% → maintain
- [ ] No scaling applied
- [ ] System tolerates moderate soreness

**Scenario 3c (Edge Case):**
- [ ] All muscles=3 (very sore) → overall ~30% → trigger deload
- [ ] Deload applied (50% volume, 60% intensity)

---

## Future Work (Phase 4 - Per-Exercise Scaling)

**If Option A proves insufficient:**

1. **Exercise metadata addition:**
   - Add `primaryMuscles: string[]` to exercise seed data
   - Map all 133 exercises to muscle groups

2. **Autoregulation refactor:**
   - Replace `selectAction(overall)` with `selectActionPerExercise(exerciseFatigue)`
   - Apply targeted scaling in `autoregulateWorkout()`

3. **UI enhancement:**
   - Show per-exercise rationale: "Bench press scaled (chest sore)"
   - Highlight which exercises were selectively modified

---

## Success Metrics

**Phase 3.5 (Option A):**
- ✅ Muscle soreness affects overall fatigue score
- ✅ Very sore muscles trigger protective scaling
- ✅ User survey: 80%+ feel system respects soreness

**Phase 4 (Option B, if implemented):**
- ✅ Per-exercise scaling working correctly
- ✅ Users report faster recovery on targeted scaling
- ✅ A/B test: Option B reduces injury reports vs Option A

---

## ADR Summary

**Decision:** Implement Option A (global penalty) for Phase 3.5, defer Option B (per-exercise) to Phase 4 if needed.

**Rationale:**
- Option A is conservative, evidence-based, and low-risk
- 80% solution in 20% of the time
- User feedback will inform whether Option B complexity is justified

**Reversibility:** Low risk - if Option A proves insufficient, upgrading to Option B is straightforward (additive change, not breaking).
