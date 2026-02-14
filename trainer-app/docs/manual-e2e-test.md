# Manual E2E Test - Phase 2 Selection System

## Test Objective
Verify the complete flow: selection → workout generation → completion → exposure update → rotation

## Prerequisites
1. Dev server running: `npm run dev`
2. Database seeded with exercises
3. User account created with onboarding complete

## Test Steps

### 1. Generate Initial Workout (Intent Mode)

**Request:**
```bash
POST http://localhost:3000/api/generate/intent
Content-Type: application/json

{
  "intent": "push",
  "targetMuscles": [],
  "pinnedExerciseIds": []
}
```

**Expected:**
- Status 200
- Response contains `workout` object with exercises
- Response contains `selection` object with `selectedExerciseIds`
- Check `selection.rationale` - should have per-exercise justifications

**Verify:**
```json
{
  "workout": {
    "mainLifts": [...],
    "accessories": [...]
  },
  "selection": {
    "selectedExerciseIds": ["bench_press", "incline_press", ...],
    "rationale": {
      "bench_press": {
        "score": 0.85,
        "components": {
          "deficitFill": 0.9,
          "rotationNovelty": 1.0,  // Should be 1.0 (never used)
          ...
        }
      }
    }
  }
}
```

**Manual Check:**
- Open browser DevTools → Network tab
- Navigate to workout generation page
- Click "Generate Push Workout"
- Inspect the response JSON
- Note which exercises were selected

---

### 2. Complete the Workout

**Request:**
```bash
POST http://localhost:3000/api/workouts/save
Content-Type: application/json

{
  "workoutId": "<workout-id-from-step-1>",
  "status": "COMPLETED",
  "exercises": [
    {
      "exerciseId": "bench_press_id",
      "sets": [
        { "setIndex": 0, "targetReps": 8, "targetLoad": 185 },
        { "setIndex": 1, "targetReps": 8, "targetLoad": 185 },
        { "setIndex": 2, "targetReps": 8, "targetLoad": 185 }
      ]
    },
    ...
  ]
}
```

**Expected:**
- Status 200
- Response: `{ "status": "saved", "workoutId": "...", "baselineSummary": {...} }`
- Console log (check terminal): No errors from `updateExerciseExposure`

**Verify in Database:**
```sql
-- Check ExerciseExposure table
SELECT * FROM "ExerciseExposure" WHERE "userId" = '<your-user-id>';
```

**Expected:**
- Rows exist for each exercise in the workout
- `lastUsedAt` is recent (now)
- `timesUsedL4W`, `timesUsedL8W`, `timesUsedL12W` all = 1

---

### 3. Generate Second Workout (Same Intent)

**Request:**
```bash
POST http://localhost:3000/api/generate/intent
Content-Type: application/json

{
  "intent": "push",
  "targetMuscles": [],
  "pinnedExerciseIds": []
}
```

**Expected:**
- Status 200
- Response contains different exercises OR same exercises with lower rotation novelty scores

**Verify Rotation Working:**
```json
{
  "selection": {
    "rationale": {
      "bench_press": {
        "components": {
          "rotationNovelty": 0.0,  // Should be 0.0 (just used, weeksAgo = 0)
          ...
        }
      },
      "new_exercise": {
        "components": {
          "rotationNovelty": 1.0,  // Should be 1.0 (never used)
          ...
        }
      }
    }
  }
}
```

**Manual Check:**
- Exercises that were in workout #1 should have `rotationNovelty` near 0
- New exercises (not in workout #1) should have `rotationNovelty` near 1.0
- If time budget/volume allows, new exercises should be preferred

---

### 4. Verify Indirect Volume (Optional)

**Test Scenario:** Generate a full push workout, complete it, then generate another push workout immediately.

**Expected Behavior:**
- First workout: Bench Press selected (primary: Chest, secondary: Front Delts)
- Second workout: If Front Delts have deficit, should NOT prioritize OHP (front delts primary) because bench already gave indirect volume
- Second workout: Should prioritize side delts or other muscles with full deficit

**How to Verify:**
1. Look at first workout's `volumePlanByMuscle`:
   ```json
   {
     "Chest": { "target": 12, "planned": 8, "delta": 4 },
     "Front Delts": { "target": 8, "planned": 2.4, "delta": 5.6 }
     // 2.4 = indirect from bench (8 sets × 0.3)
   }
   ```
2. Generate second workout
3. Check if lateral raise (side delts) selected over OHP (front delts)

---

## Success Criteria

✅ **Selection Working:** New beam search selects exercises (non-empty workout)
✅ **Rationale Generated:** Each exercise has justification with score breakdown
✅ **Exposure Tracked:** Completing workout updates ExerciseExposure table
✅ **Rotation Working:** Second generation penalizes recently-used exercises
✅ **Performance:** Selection completes in < 1 second (visual check)
✅ **No Errors:** Console shows no TypeScript or runtime errors

## Troubleshooting

**If workout generation fails:**
1. Check console for errors
2. Verify user has completed onboarding
3. Check database has seeded exercises
4. Verify `loadExerciseExposure` returns valid data (may be empty Map for new user)

**If exposure update fails:**
1. Check terminal logs for error message
2. Verify ExerciseExposure table exists in DB
3. Check Prisma schema matches DB schema
4. Try: `npx prisma migrate deploy && npx prisma generate`

**If rotation not working:**
1. Verify ExerciseExposure rows have `lastUsedAt` populated
2. Check `rotationContext` is loaded in `buildSelectionObjective`
3. Verify `scoreRotationNovelty` is called (add console.log if needed)

---

## Quick Manual Test (Browser)

1. Open app: `http://localhost:3000`
2. Log in / complete onboarding
3. Go to home dashboard
4. Click "Generate Push Workout"
5. Complete the workout (mark as done)
6. Generate another push workout
7. Compare exercises - should see some rotation

**Visual Check:**
- First workout: Bench, Incline Press, Lateral Raise
- Second workout: Bench (main lift stays), Cable Fly (rotated from Incline), Lateral Raise

---

## Next Steps After Manual Test

- ✅ If test passes → Document and deploy
- ❌ If test fails → Debug, fix, re-test
