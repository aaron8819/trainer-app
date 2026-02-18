# Phase 2: Avoid Preferences Explainability - Implementation Complete

**Status:** ✅ READY FOR TESTING
**Date:** 2026-02-16

---

## What Was Implemented (Option B: API Response)

The filtered exercises feature is now **live in the generation API response**. When you generate a workout via the `/api/workouts/generate-from-intent` endpoint, the response now includes a `filteredExercises` array showing which exercises were filtered during selection and why.

---

## Changes Made

### 1. Backend Integration

**File:** `src/lib/api/template-session.ts`

- Added import for `summarizeFilteredExercises` and `FilteredExerciseSummary`
- Updated `SessionGenerationResult` type to include optional `filteredExercises` field
- Modified `generateSessionFromIntent` to:
  - Extract rejected exercises from `SelectionResult`
  - Pass them through `summarizeFilteredExercises()` to get user-friendly summaries
  - Include them in the result passed to `finalizePostLoadResult`
- Updated `finalizePostLoadResult` signature to accept optional `filteredExercises` parameter
- Returns `filteredExercises` in final result

**File:** `src/app/api/workouts/generate-from-intent/route.ts`

- Added `filteredExercises` to the JSON response returned to client

---

## How to Test

### 1. Generate a Workout via API

Make a POST request to `/api/workouts/generate-from-intent`:

```json
{
  "intent": "push",
  "pinnedExerciseIds": []
}
```

### 2. Check the Response

The response will now include a `filteredExercises` array:

```json
{
  "workout": { ... },
  "sraWarnings": [ ... ],
  "substitutions": [ ... ],
  "volumePlanByMuscle": { ... },
  "selectionMode": "INTENT",
  "sessionIntent": "push",
  "selection": { ... },
  "autoregulation": { ... },
  "filteredExercises": [
    {
      "exerciseId": "ex_123",
      "exerciseName": "Incline Dumbbell Press",
      "reason": "user_avoided",
      "userFriendlyMessage": "Avoided per your preferences"
    },
    {
      "exerciseId": "ex_456",
      "exerciseName": "Cable Flyes",
      "reason": "pain_conflict",
      "userFriendlyMessage": "Excluded due to recent pain signals"
    }
  ]
}
```

### 3. Expected Behavior

**If you have avoided exercises:**
- You should see entries with `reason: "user_avoided"` in the `filteredExercises` array
- Each entry shows the exercise name and a user-friendly explanation

**If you have pain flags:**
- You should see entries with `reason: "pain_conflict"` for exercises excluded due to pain

**If no exercises were filtered:**
- `filteredExercises` will be an empty array `[]`

---

## Current Limitation

⚠️ **Filtered exercises are NOT persisted to the database.**

This means:
- ✅ You can see them immediately in the generation API response
- ❌ They do NOT appear when viewing a saved workout detail page
- ❌ They are lost if you refresh the page after generating

**Why?** This is "Option B" (quick fix). The filtered exercises exist during generation but are never saved to the database. When you navigate to the workout detail page (`/workout/[id]`), the page loads the workout from the database via `generateWorkoutExplanation()`, which doesn't have access to the rejected exercises.

---

## Next Step: Full Persistence (Option A)

To show filtered exercises on saved workout detail pages, we need to:

1. **Add DB Schema:**
   - Create `FilteredExercise` model
   - Fields: `id`, `workoutId`, `exerciseId`, `exerciseName`, `reason`, `userFriendlyMessage`
   - Relation: `FilteredExercise` belongs to `Workout`

2. **Persist on Save:**
   - When saving workout via `/api/workouts/save`, include filtered exercises
   - Store them in the database alongside the workout

3. **Load on Detail Page:**
   - Update `generateWorkoutExplanation()` to load filtered exercises from DB
   - Include them in the `WorkoutExplanation` returned to the UI

4. **Migration:**
   - Run `npx prisma migrate dev --name add_filtered_exercises`
   - Commit schema and migration file

---

## Validation

✅ **Tests:** All 863 tests passing
✅ **Build:** Production build succeeds
✅ **TypeScript:** No type errors
✅ **Lint:** 1 error fixed (`prefer-const` in save/route.ts)

---

## Files Modified

**Backend (3 files):**
- `src/lib/api/template-session.ts` - Extract and summarize filtered exercises
- `src/app/api/workouts/generate-from-intent/route.ts` - Return filtered exercises in response
- `src/app/api/workouts/save/route.ts` - Lint fix (`let` → `const`)

**Total:** 3 files modified

---

## Testing Checklist

- [ ] Generate workout with avoided exercises → check API response includes `filteredExercises`
- [ ] Generate workout with pain flags → check `pain_conflict` entries appear
- [ ] Generate workout with no filters → check `filteredExercises` is empty array
- [ ] Verify UI displays filtered exercises (if WorkoutExplanation component consumes them)
- [ ] Confirm filtered exercises disappear when viewing saved workout detail page (expected limitation)

---

## Related Documents

- [Phase 2 Completion Summary](./phase2-completion-summary.md) - Full backend/UI implementation
- [ADR-063: Split Contraindications for Enhanced Explainability](../decisions.md#adr-063)
- [User Settings Integration Analysis](../analysis/user-settings-integration-analysis.md)

---

**Implementation Status:** Option B (API Response) complete ✅
**Next Milestone:** Option A (Full Persistence) - requires schema migration + save/load logic
