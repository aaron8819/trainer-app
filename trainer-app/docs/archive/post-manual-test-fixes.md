# Post-Manual-Test Fixes

**Source:** `docs/plans/post-manual-test-findings.md`
**Date:** 2026-02-17
**Status:** ✅ Implemented (2026-02-17) — 852/852 tests passing, build clean, ADRs 068–072 added

---

## Context

First push workout generated after one completed pull session surfaced 8 actionable issues. This plan implements all actionable items (Bugs 1-7 + Cleanup D1). Design questions D2/D3 remain deferred.

---

## Items In Scope

| # | Description | Priority | Primary File(s) |
|---|-------------|----------|-----------------|
| 1 | Dumbbell load snapping to canonical weights | P1 | `src/lib/ui/load-display.ts` |
| 2 | Machine exercise load floor (min 10 lbs) | P1 | `src/lib/engine/apply-loads.ts` |
| 3a | Beam state-aware movement diversity scoring | P1 | `selection-v2/scoring.ts`, `beam-search.ts` |
| 3b | Hard cap: max 2 exercises per movement pattern | P1 | `selection-v2/beam-search.ts` |
| 4 | Map `time_budget_exceeded` to display label | P2 | `session-context.ts`, `FilteredExercisesCard.tsx` |
| 5 | Hide baseline section until workout completed | P2 | `workout/[id]/page.tsx` |
| 6 | Show today's target muscles first in volume grid | P2 | `session-context.ts`, `explainability.ts` |
| 7 | Hide empty Warmup section | P3 | `workout/[id]/page.tsx` |
| D1 | Remove `split-queue.ts` dead code | cleanup | `split-queue.ts`, `split-queue.test.ts` |

---

## Phase 1 — P1 Bugs (isolated, no shared dependencies)

### Step 1 — Dumbbell load snapping (`src/lib/ui/load-display.ts`)

**Root cause:** `formatLoad` and `formatBaselineRange` divide total lbs by 2 after `roundLoad` snaps to 0.5 lb. The resulting per-dumbbell value (e.g. 24.25) is not a real dumbbell weight.

**Fix:** Add `DUMBBELL_WEIGHTS` constant and `snapToDumbbell(lbs)` helper. Use it in display functions only.

```typescript
const DUMBBELL_WEIGHTS = [
  2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25,
  27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50,
  55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 110
];

function snapToDumbbell(lbs: number): number {
  return DUMBBELL_WEIGHTS.reduce((prev, curr) =>
    Math.abs(curr - lbs) < Math.abs(prev - lbs) ? curr : prev
  );
}
```

- `formatLoad`: change `totalLbs / 2` → `snapToDumbbell(totalLbs / 2)` in dumbbell branch
- `formatBaselineRange`: change `min / 2` → `snapToDumbbell(min / 2)` and `max / 2` → `snapToDumbbell(max / 2)`
- **Do NOT change `toDisplayLoad()`** — used for editable input fields, must remain exact

### Step 2 — Machine load floor (`src/lib/engine/apply-loads.ts`)

**Root cause:** Bodyweight-ratio estimator can produce sub-10 lb estimates for machine isolation exercises.

**Fix:** In `estimateLoad()`, after computing the candidate estimate, apply machine floor:

```typescript
// After computing estimate from donor or ratio, before returning:
if (estimate !== undefined && getLoadEquipment(exercise) === "machine") {
  return Math.max(roundToHalf(estimate), 10);
}
```

### Phase 1 doc updates
After completing Steps 1 & 2:
- No architecture doc changes needed (implementation detail, not behavioral contract)
- Add ADRs in `docs/decisions.md`:
  - ADR for dumbbell canonical weight snapping at display time (storage stays as total lbs)
  - ADR for machine load floor

---

## Phase 2 — P1 Engine: Movement Pattern Diversity

### Step 3a — Beam state-aware movement diversity scoring

**Root cause:** `scoreMovementNovelty` is a known stub that scores based on pattern count (versatility), with no knowledge of what's already selected in the current beam state. `movementDiversity` weight is 0.05 (too low to matter). Result: three chest exercises score identically on movement diversity.

**Fix: Three-file change**

**A. `src/lib/engine/selection-v2/scoring.ts`** — rewrite `scoreMovementNovelty`:

```typescript
export function scoreMovementNovelty(
  exercise: Exercise,
  objective: SelectionObjective,
  alreadySelected: Exercise[]   // NEW parameter
): number {
  const myPatterns = new Set(exercise.movementPatterns ?? []);
  if (myPatterns.size === 0) return 0.5;
  const usedPatterns = new Set(
    alreadySelected.flatMap(e => e.movementPatterns ?? [])
  );
  const overlap = [...myPatterns].filter(p => usedPatterns.has(p)).length;
  const novelPatterns = myPatterns.size - overlap;
  return novelPatterns / myPatterns.size;
}
```

**B. `src/lib/engine/selection-v2/types.ts`** — increase `movementDiversity` weight default:
- Change `movementDiversity: 0.05` → `movementDiversity: 0.15`

**C. `src/lib/engine/selection-v2/optimizer.ts`** — update `buildCandidate()` call to pass `[]`:
- When pre-computing scores: `scoreMovementNovelty(exercise, objective, [])`

**D. `src/lib/engine/selection-v2/beam-search.ts`** — dynamic adjustment during expansion:
- Import `scoreMovementNovelty` from `./scoring`
- When computing state score, adjust for dynamic novelty:

```typescript
const alreadySelected = state.selected.map(c => c.exercise);
const dynamicNovelty = scoreMovementNovelty(candidate.exercise, objective, alreadySelected);
const noveltyAdjustment =
  objective.weights.movementDiversity * (dynamicNovelty - candidate.scores.movementNovelty);
const adjustedScore = candidate.totalScore + noveltyAdjustment;
// Use adjustedScore (not candidate.totalScore) when accumulating state.score
```

### Step 3b — Movement pattern hard cap (`src/lib/engine/selection-v2/beam-search.ts`)

**Fix:** In the constraint check block during beam expansion (alongside time-budget and volume-ceiling checks):

```typescript
// Hard cap: max 2 exercises per movement pattern
const MOVEMENT_PATTERN_CAP = 2;
const candidatePatterns = candidate.exercise.movementPatterns ?? [];
const patternViolation = candidatePatterns.some(pattern => {
  const count = state.selected.filter(s =>
    (s.exercise.movementPatterns ?? []).includes(pattern)
  ).length;
  return count >= MOVEMENT_PATTERN_CAP;
});
if (patternViolation) continue;
```

### Phase 2 doc updates
After completing Steps 3a & 3b:
- Update `docs/architecture.md`: document that `scoreMovementNovelty` is now beam-state-aware and `movementDiversity` weight is 0.15. Note the hard cap guardrail (max 2 per pattern).
- Add ADR in `docs/decisions.md`: beam state-aware movement diversity + hard cap (describe the stub history and the architectural reason for adjusting scores during expansion rather than pre-computation)

---

## Phase 3 — P2/P3 UX Fixes

### Step 4 — Filter reason labels

**A. `src/lib/engine/explainability/session-context.ts`** — add to `summarizeFilteredExercises` switch:
```typescript
case "time_budget_exceeded":
  userFriendlyMessage = "Session time limit reached";
  break;
```

**B. `src/components/explainability/FilteredExercisesCard.tsx`** — in "Other Filters" group:
```typescript
const otherLabel = otherFilters.every(e => e.reason === "time_budget_exceeded")
  ? "TIME LIMIT"
  : "OTHER FILTERS";
```
Use `otherLabel` as the section header text instead of hardcoded "OTHER FILTERS".

Update `FilteredExercisesCard.test.tsx` to cover `time_budget_exceeded` reason.

### Step 5 — Hide baseline section pre-completion (`src/app/workout/[id]/page.tsx`)

Change condition at ~L409:
```typescript
// Before:
{baselineSummary.evaluatedExercises > 0 && (
// After:
{workout.status === "COMPLETED" && baselineSummary.evaluatedExercises > 0 && (
```

### Step 6 — Today's target muscles first in volume grid

**A. `src/lib/engine/explainability/session-context.ts`:**
1. Import `MUSCLE_SPLIT_MAP` from `"../volume-landmarks"` (already exported there)
2. Add optional `sessionIntent?: "push" | "pull" | "legs"` param to `describeVolumeProgress`
3. After building `muscleStatuses` Map, reorder: today's targeted muscles first (include even if 0 sets, as long as they're in `VOLUME_LANDMARKS`), then remaining
4. Propagate `sessionIntent` through `explainSessionContext` params

**B. `src/lib/api/explainability.ts`:** Pass workout session intent:
```typescript
sessionIntent: workout.sessionIntent?.toLowerCase() as "push" | "pull" | "legs" | undefined,
```

Update `session-context.test.ts` to cover session intent muscle ordering.

### Step 7 — Hide empty Warmup section (`src/app/workout/[id]/page.tsx`)

In the section rendering map callback (~L444):
```typescript
if (exercises.length === 0) return null;
```

### Phase 3 doc updates
After completing Phase 3:
- No architecture doc changes needed (UX/display only)
- No ADRs needed (the changes are straightforward enough to not warrant ADRs)

---

## Phase 4 — Cleanup

### Step D1 — Remove `split-queue.ts` dead code

Confirmed not imported anywhere in active code (only its own test file). `MUSCLE_SPLIT_MAP` lives in `volume-landmarks.ts`.

1. Delete `src/lib/engine/split-queue.ts`
2. Delete `src/lib/engine/split-queue.test.ts`
3. Run `npm run build` to confirm clean

### Phase 4 doc updates
After completing D1:
- Update `docs/architecture.md` module map: remove `split-queue.ts` entry
- Add ADR in `docs/decisions.md`: removal of split-queue.ts dead code (reference ADR-014 context)

---

## Verification Checklist

After all phases:
1. `npm test` — all tests pass; new tests for steps 3a, 4, 6
2. `npm run build` — zero TypeScript errors
3. `npm run lint` — zero new lint errors
4. Manual smoke test on a generated Push workout:
   - [ ] Back-off dumbbell loads snap to valid weights (27.5, 30, etc. — not 24.25)
   - [ ] Machine Lateral Raise load ≥ 10 lbs
   - [ ] ≤ 2 exercises per movement pattern (no three-chest push days)
   - [ ] Volume grid shows Push muscles (Chest/Triceps/Front Delts/Side Delts) first
   - [ ] Baseline section absent on unstarted workout
   - [ ] Warmup section absent when empty
   - [ ] Filtered exercises show "Session time limit reached" (not raw code)
   - [ ] "TIME LIMIT" group header when all filtered items are time_budget_exceeded
