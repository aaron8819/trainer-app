# Logging & Post-Workout Analysis Improvements Plan

**Status:** ✅ Implemented (2026-02-17)
**Phases shipped:** Phase 1 + Phase 2 (one commit), Phase 3 (second commit)

---

## Phase 1 — Logging UX ✅

### 1A. Smart completion detection + panel repositioning ✅
**File:** `src/components/LogWorkoutClient.tsx`
- `allSetsLogged = loggedCount === totalSets && totalSets > 0` added
- Green "All sets logged — great work!" banner shown; "Complete Workout" CTA inside banner
- Footer `fixed` positioning removed — always inline. `pb-28` replaced with `pb-8`.

### 1B. Edit logged sets — visual polish ✅
**File:** `src/components/LogWorkoutClient.tsx`
- "Editing set (previously logged)" label appears when `loggedSetIds.has(resolvedActiveSetId)`
- `handleLogSet`: when `wasLoggedBefore === true`, does NOT auto-advance; button shows "Update set"

### 1C. Better set chip visibility ✅
**File:** `src/components/LogWorkoutClient.tsx`
- `buildSetChipLabel()` helper: logged chips show `"Set 1 · 185×8 · RPE 8"`, skipped show `"Set 1 · Skipped"`
- ✓ icon added next to exercise X/Y counter when all sets for that exercise are logged

### 1D. Advisory autoregulation hints ✅
**File:** `src/components/LogWorkoutClient.tsx`
- `autoregHint: string | null` state added; `AutoregHint` type defined
- After `handleLogSet`: `actualRpe - targetRpe <= -1.5` → suggest +load; `>= 1.0` → suggest -load
- Amber info box below active set prescription; clears when exercise changes
- Advisory only — no auto-adjustment of target values

### 1E. Workout detail — actual vs prescribed ✅
**File:** `src/app/workout/[id]/page.tsx`
- When `workout.status === 'COMPLETED'` and `set.logs[0]` exists, renders actual row below target
- Color coding: emerald (repDiff ≥ 0), amber (repDiff === -1), rose (repDiff ≤ -2)
- ✓ shown on sets where target reps were met

---

## Phase 2 — Inline Post-Workout Analysis ✅

**File:** `src/components/LogWorkoutClient.tsx`

When `completed === true`, exercise queue replaced with completion summary (all client-side from `data` + `loggedSetIds`):
1. **Session Score**: completion rate (`loggedSetIds.size / totalSets`); RPE adherence (`|actualRpe - targetRpe| <= 1.0`)
2. **Performance Comparison Table**: per exercise, target vs actual, grouped by section
3. **Enhanced Baseline Summary**: existing `baselineSummary` styled with green PR highlights, arrow notation `220 → 225 lbs × 5`
4. **What's Next**: static guidance — allow 48-72h recovery + link to generate next workout

---

## Phase 3 — Bonus Exercise Flow ✅

### New files
- `src/app/api/workouts/[id]/bonus-suggestions/route.ts` — GET ✅
- `src/app/api/workouts/[id]/add-exercise/route.ts` — POST ✅
- `src/lib/api/bonus-suggestions.ts` — suggestion logic ✅
- `src/components/BonusExerciseSheet.tsx` — UI (uses `SlideUpSheet`) ✅

### bonus-suggestions.ts — implemented as planned with notes
1. Loads workout via `forcedSplit` field → cast to `"push" | "pull" | "legs"`
2. Counts last 7 days sets per muscle via `workoutSet.findMany` with nested includes through `workoutExercise.exercise.exerciseMuscles` (filtered by `role === "PRIMARY"`)
3. Uses `VOLUME_LANDMARKS` + `MUSCLE_SPLIT_MAP` → finds muscles below MEV or furthest from MAV
4. Filters: split-compatible, not in current workout, not in last 48h (`ExerciseExposure.lastUsedAt`)
5. Returns top 5 sorted by `sfrScore desc`; suggested load from `Baseline.workingWeightMin ?? topSetWeight`

**Implementation note:** Prisma relation on Exercise is `exerciseMuscles: ExerciseMuscle[]` (not `primaryMuscles`). Filter by `role === "PRIMARY"`. `Baseline` uses `createdAt` (no `updatedAt`).

### add-exercise route — implemented as planned
- Zod schema: `{ exerciseId: z.string().min(1) }`
- Creates `WorkoutExercise` (section: ACCESSORY, isMainLift: false) + 3 `WorkoutSet` records
- Target reps: `Math.round((repRangeMin + repRangeMax) / 2)`; target rep range preserved
- Load from `Baseline.workingWeightMin ?? topSetWeight`; RPE target 8
- Returns `LogExerciseInput` format for immediate client-side append

### BonusExerciseSheet — minor deviation from plan
- `SlideUpSheet` with two sections: recommendations + search ✅
- Search uses **client-side filtering** (not `GET /api/exercises?q=...`): fetches all exercises once on first open via `GET /api/exercises`, then filters locally with `useMemo` — avoids round-trips and respects React Compiler (no `useState` mutation during render)
- `displayResults` computed via `useMemo(fn, [searchQuery, allExercises])`, not state

### LogWorkoutClient changes ✅
- "Add Exercise" button at bottom of exercise queue (visible before completion)
- `handleAddExercise`: appends to `data.accessory`, opens accessory section, activates first set of new exercise
- `allSetsLogged` recomputes automatically (includes new exercise sets)
- `showBonusSheet` state drives `BonusExerciseSheet` open/close

---

## Verification Checklist

1. ✅ Log all sets → green completion banner appears, active set card gone
2. ✅ Tap logged set → "Editing set" label; after save, stays on set (no advance)
3. ✅ Log set RPE 6 vs target 8 → amber hint "consider +5 lbs" for next set
4. ✅ Complete workout → inline summary shows score, comparison table, enhanced baselines
5. ✅ Add Exercise → sheet shows up to 5 recommendations + search; tap one → appears in queue
6. ✅ `/workout/[id]` for completed workout → each set row shows target AND actual
7. ✅ `npm test` passes (863 tests); `npm run build` clean
