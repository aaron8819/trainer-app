# Plan: Full Persistence for Filtered Exercises

**Status:** ✅ COMPLETE (2026-02-17)
**Date:** 2026-02-16

## Context

Phase 2 implemented explainability for filtered exercises. The engine produces `SelectionResult.rejected[]` → `FilteredExerciseSummary[]`, and the generation API returns them (Option B done). But they're ephemeral — the workout detail page loads from DB via `generateWorkoutExplanation()` and has no record of filtered exercises.

**Goal:** Persist to a proper DB table so they appear on workout detail page on every view.

**Scope:** Intent-mode only (PPL + full_body + body_part). Template mode has no rejected exercises.

---

## Implementation (7 steps)

### Step 1: Prisma Schema
**File:** `prisma/schema.prisma`

Add after `WorkoutSet` model:
```prisma
model FilteredExercise {
  id                  String  @id @default(uuid())
  workoutId           String
  workout             Workout @relation(fields: [workoutId], references: [id], onDelete: Cascade)
  exerciseId          String?
  exerciseName        String
  reason              String
  userFriendlyMessage String

  @@index([workoutId])
}
```

Add relation to `Workout` model (after `sessionCheckIns`):
```prisma
filteredExercises FilteredExercise[]
```

Then run:
```bash
cd trainer-app
npx prisma migrate dev --name add_filtered_exercises
npm run prisma:generate
```

---

### Step 2: Validation Schema
**File:** `src/lib/validation.ts` — add to `saveWorkoutSchema`:
```typescript
filteredExercises: z.array(z.object({
  exerciseId: z.string().optional(),
  exerciseName: z.string(),
  reason: z.string(),
  userFriendlyMessage: z.string(),
})).optional(),
```

---

### Step 3: Save Route — Persist in Transaction
**File:** `src/app/api/workouts/save/route.ts`

Inside `prisma.$transaction()`, after the WorkoutSet creation loop:
```typescript
// Phase 2: Persist filtered exercises
await tx.filteredExercise.deleteMany({ where: { workoutId } });
if (parsed.data.filteredExercises?.length) {
  await tx.filteredExercise.createMany({
    data: parsed.data.filteredExercises.map((fe) => ({
      workoutId,
      exerciseId: fe.exerciseId ?? null,
      exerciseName: fe.exerciseName,
      reason: fe.reason,
      userFriendlyMessage: fe.userFriendlyMessage,
    })),
  });
}
```

---

### Step 4: Client — Capture and Forward
**File:** `src/components/IntentRoundTripValidatorCard.tsx`

**4a.** Update `generatedMetadata` state type to add `filteredExercises?: FilteredExerciseSummary[]`

**4b.** In `setGeneratedMetadata` call (~line 383):
```typescript
setGeneratedMetadata({
  selectionMode: body.selectionMode,
  sessionIntent: body.sessionIntent,
  selection: body.selection,
  filteredExercises: body.filteredExercises ?? [],  // ADD
});
```

**4c.** In save payload (~line 400):
```typescript
filteredExercises: generatedMetadata?.filteredExercises,  // ADD
```

Import `FilteredExerciseSummary` from `@/lib/engine/explainability`.

---

### Step 5: generateWorkoutExplanation — Load from DB
**File:** `src/lib/api/explainability.ts`

**5a.** Add to `workout.findUnique` include:
```typescript
filteredExercises: true,
```

**5b.** Before return (~line 197), map DB records:
```typescript
const filteredExercises: FilteredExerciseSummary[] = (workout.filteredExercises ?? []).map((fe) => ({
  exerciseId: fe.exerciseId ?? fe.id,
  exerciseName: fe.exerciseName,
  reason: fe.reason,
  userFriendlyMessage: fe.userFriendlyMessage,
}));
```

**5c.** Add to return:
```typescript
filteredExercises,
```

---

### Step 6: Explanation API Route
**File:** `src/app/api/workouts/[id]/explanation/route.ts`

Add to JSON response:
```typescript
filteredExercises: result.filteredExercises ?? [],
```

---

### Step 7: WorkoutExplanation Component — Fallback Fetch
**File:** `src/components/WorkoutExplanation.tsx`

**7a.** Update `ExplanationResponse` type to add:
```typescript
filteredExercises?: WorkoutExplanation["filteredExercises"];
```

**7b.** In constructed `WorkoutExplanation` (~line 59):
```typescript
filteredExercises: data.filteredExercises,
```

---

## Verification

1. Generate workout with avoided exercises → Save it → Navigate to `/workout/[id]`
2. Verify "Filtered Exercises" card appears in explainability panel
3. Refresh page — filtered exercises persist
4. `npm test` — 863 tests still pass
5. `npm run build` — clean
6. `npm run lint` — clean

---

## Current State (Pre-Implementation)

- ✅ `FilteredExerciseSummary` type exists in `src/lib/engine/explainability/types.ts`
- ✅ `summarizeFilteredExercises()` exists in `src/lib/engine/explainability/session-context.ts`
- ✅ `filteredExercises` already extracted in `generateSessionFromIntent` and returned in API response
- ✅ `FilteredExercisesCard` UI component exists and is wired into `ExplainabilityPanel`
- ✅ `WorkoutExplanation.filteredExercises` field already typed (optional)
- ❌ No DB table yet
- ❌ Save route doesn't persist them
- ❌ Client doesn't forward them to save
- ❌ `generateWorkoutExplanation()` doesn't load them from DB
