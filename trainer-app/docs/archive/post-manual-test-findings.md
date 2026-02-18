# Post-Manual-Test Findings & Recommendations

**Test context:** First push workout (`6369e29c`) generated after one completed pull session (`f58334e2`).
**Date:** 2026-02-17
**Status:** ✅ Implemented (2026-02-17) — 852/852 tests passing, build clean

---

## Part 1 — Session Review Page (Phase 4.6 Improvements)

All 10 items from `docs/plans/session-review-page-improvements.md` were verified as correctly implemented:
- Load note correctly distinguishes estimated vs baseline-seeded vs history-derived loads
- Dumbbell per-weight display working ("27.5 lbs each")
- "Start Logging" hidden on completed/skipped workouts
- Back-off sets explained inline in exercise header
- Baseline skip reasons show actual numbers
- TIP cards deduplicated (1 encouragement + 1 tip)
- "KB-backed" badge removed
- Load-miss color coding (amber when reps hit but load >10% below target)
- Negative framing ("no active volume deficits") removed
- Page title switches "Session Overview" → "Session Review" on completion

---

## Part 2 — Bugs to Fix

### Bug 1 — Dumbbell back-off loads snap to impractical weights (P1)

**Location:** `src/lib/ui/load-display.ts`

**Root cause:** `roundLoad` is applied to the total bilateral weight (e.g., 48.5 lbs), then `formatLoad` divides by 2 (24.25 lbs each). The result is not a real dumbbell weight.

**Fix:** Replace `totalLbs / 2` with a `snapToDumbbell()` helper that snaps the per-dumbbell value to the nearest weight in the canonical set.

**Canonical dumbbell set:**
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

**Affected surfaces (all go through `formatLoad`):**
- `src/lib/ui/load-display.ts` — `formatLoad()` and `formatBaselineRange()`
- `src/app/workout/[id]/page.tsx` — calls `formatLoad` for header, set rows, load notes
- `src/components/LogWorkoutClient.tsx` — prescription display during logging
- `src/components/library/ExerciseDetailSheet.tsx` — any load preview

**Decision: snap at display time only** (Option A from the plan). Storage stays in total lbs. No migration.

---

### Bug 2 — Machine Lateral Raise estimated at 4.5 lbs (P1)

**Location:** `src/lib/engine/apply-loads.ts` — `estimateLoad()` fallback

**Root cause:** The bodyweight-ratio estimator uses coefficients tuned for cable and barbell exercises. Machine selectorized exercises have different weight conventions (stack weight ≠ actual resistance, and minimums typically start at 10–20 lbs regardless of bodyweight).

**Fix options:**
- A (minimal): Add a `MACHINE` equipment type floor in `estimateLoad()`: `max(estimatedLoad, 10)` for machines
- B (better): Add a dedicated `machineRatio` coefficient per exercise category (isolation machines vs compound machines), separate from cable/barbell ratios
- **Recommendation: Option A first** — the floor prevents embarrassing estimates immediately; Option B can follow when you have enough logged machine data to calibrate realistic ratios

---

## Part 3 — Engine Selection Quality

### Issue 3 — Three chest exercises, no overhead compound on Push day (P1)

**Root cause (confirmed by code inspection):**

`scoreMovementNovelty` in `src/lib/engine/selection-v2/scoring.ts` is a known stub. It receives no beam state (already-selected exercises), scores based only on how many movement patterns an exercise has, and carries 0.05 weight — explicitly acknowledged in the codebase as "ineffective without beam state tracking (Phase 3)."

Result: Barbell Bench Press, Incline DB Bench, and Push-Up all score identically on movement diversity (0.5 each, single horizontal-push pattern). The dominant `volumeDeficitFill` weight (0.40) drives selection, and three exercises filling the same chest deficit beat any shoulder compound.

**Two-part fix:**

**Part A — Beam state-aware movement diversity (scoring fix):**

Rewrite `scoreMovementNovelty` to receive `state.selected` (exercises already picked in the current beam) and compute a penalty for pattern overlap:

```typescript
// Conceptually:
function scoreMovementNovelty(
  exercise: Exercise,
  objective: SelectionObjective,
  alreadySelected: Exercise[]  // new parameter
): number {
  const myPatterns = new Set(exercise.movementPatterns ?? []);
  const usedPatterns = new Set(
    alreadySelected.flatMap(e => e.movementPatterns ?? [])
  );
  const overlap = [...myPatterns].filter(p => usedPatterns.has(p)).length;
  const novelPatterns = myPatterns.size - overlap;
  // Score 1.0 if all patterns are new, taper toward 0 as overlap increases
  return myPatterns.size === 0 ? 0.5 : novelPatterns / myPatterns.size;
}
```

Increase `movementDiversity` weight from 0.05 → ~0.15 once beam state is tracked.

**Part B — Hard cap as guardrail:**

Add a post-selection constraint `maxExercisesPerMovementPattern: 2` to prevent any single pattern (horizontal_push, vertical_pull, etc.) from appearing more than twice in a session. This is a hard structural rule independent of scoring and ensures the outcome is robust even if scoring weights drift.

**Files affected:**
- `src/lib/engine/selection-v2/scoring.ts` — `scoreMovementNovelty`
- `src/lib/engine/selection-v2/beam-search.ts` — pass `state.selected` into scoring call
- `src/lib/engine/selection-v2/types.ts` — increase `movementDiversity` weight, add `maxPerMovementPattern` constraint
- `src/lib/engine/selection-v2/optimizer.ts` — enforce cap in post-selection filter

---

## Part 4 — UX Issues

### Issue 4 — "time_budget_exceeded" displayed as raw filter code (P2)

**Location:** `src/components/explainability/FilteredExercisesCard.tsx`

The Filtered Exercises card shows `Filtered (time_budget_exceeded)` and groups exercises under "OTHER FILTERS". Both are internal strings.

**Fix:**
- Map filter reason codes to user-facing labels:

| Code | Display label |
|------|--------------|
| `time_budget_exceeded` | Session time limit reached |
| `avoided` | Excluded by your preferences |
| `pain_flag` | Excluded due to pain/injury flag |
| `equipment_unavailable` | Equipment not available |

- Rename group header: when all exercises in a group are `time_budget_exceeded`, header → "TIME LIMIT" (or "Removed to fit session length")

---

### Issue 5 — Baseline section visible before workout is logged (P2)

**Location:** `src/app/workout/[id]/page.tsx` ~L409

The baseline summary block (showing "Evaluated: 5 · Updated: 0 · Skipped: 5 / No logged sets") renders on unstarted workouts. This is pre-workout noise.

**Fix:** Wrap the section in `workout.status === "COMPLETED"` guard. The section is only meaningful post-workout.

---

### Issue 6 — Volume status shows Pull muscles for Push day context (P2)

**Location:** `src/components/explainability/SessionContextCard.tsx` and `src/lib/engine/explainability/session-context.ts`

The volume grid shows only muscles with non-zero accumulated sets. On the first Push day after a Pull session, the grid shows Lats/Upper Back/Biceps (yesterday's Pull muscles) and omits all Push muscles (Chest/Triceps/Front Delts/Side Delts) because they're at 0 sets.

This creates a confusing mismatch: the user is looking at a Push workout but the volume card reads like a Pull day recap.

**Fix options:**
- A: Always include muscles targeted by today's session intent (even if 0 sets), placed first in the grid
- B: Add a "This session targets" section above the accumulated volume grid
- **Recommendation: Option A** — reorder grid to show today's target muscles first (populated from `MUSCLE_SPLIT_MAP[sessionIntent]`), then remainder

---

### Issue 7 — Warmup section renders when empty (P3)

**Location:** `src/app/workout/[id]/page.tsx` ~L444

"No exercises in this section" is shown for Warmup when the section is empty. For Push workouts that start directly with main lifts, this is noise.

**Fix:** Hide sections entirely if `items.length === 0`.

---

## Part 5 — Design Questions for Future Sessions

### D1 — PPL split: auto-suggest the next day

The intent path is user-provided only (no auto-rotation). `split-queue.ts` is dead code.

**Immediate action:** Remove `split-queue.ts` (cleanup).

**Future design question:** Should the app suggest the next split day based on history? E.g., "You did Pull yesterday — Push is next" shown on the dashboard before the user picks. This doesn't remove user agency but reduces friction. Design needed before implementing.

---

### D2 — Week-in-block: schedule drift problem

**Current behavior:** Week is calculated from date arithmetic against the first workout in the block (or last 28 days of history). This drifts when users take unplanned rest weeks, travel, or change weekly frequency.

**Problem scenarios:**
- User takes a week off → system thinks they're in week 2 when they want to restart week 1
- User shifts from 4-day to 3-day weeks → week calculation still uses calendar weeks, not training weeks
- No way to manually say "I'm starting a new block today"

**Design questions to resolve before implementing:**
1. Should `weekInBlock` be training-week-based (count of workouts) or calendar-week-based (current approach)?
2. Should users be able to manually anchor their position ("Start week 1 today")?
3. What triggers a block reset? Only explicit user action, or also auto-detect (e.g., 10+ days without training)?

---

### D3 — Cycle and progress presentation for the user

Users currently have no high-level view of where they are in their training cycle or where they're going.

**What would be useful:**
- Dashboard widget: "Week 2 of 4 — Accumulation · 2 weeks until intensification"
- Visual mesocycle timeline (past blocks completed, current block position, upcoming phases)
- Per-muscle volume trend over the current block (are you building toward MAV as designed?)
- Block completion summary: what got stronger, what volume increased

**This is a roadmap item** — requires the macro cycle system to be used in practice (users need to actually create and track blocks) and sufficient history to show trends. Design before building.

---

## Summary Table

| # | Item | Type | Priority | Status | ADR |
|---|------|------|----------|--------|-----|
| 1 | Dumbbell load snapping to canonical weights | Bug | P1 | ✅ Done | ADR-068 |
| 2 | Machine exercise load floor (min 10 lbs) | Engine calibration | P1 | ✅ Done | ADR-069 |
| 3a | Beam state-aware movement diversity scoring | Engine selection | P1 | ✅ Done | ADR-070 |
| 3b | Hard cap: max 2 exercises per movement pattern | Engine guardrail | P1 | ✅ Done | ADR-071 |
| 4 | Map filter reason codes to display labels | UX | P2 | ✅ Done | — |
| 5 | Hide baseline section until workout completed | UX | P2 | ✅ Done | — |
| 6 | Show today's target muscles first in volume grid | UX | P2 | ✅ Done | — |
| 7 | Hide empty Warmup section | UX | P3 | ✅ Done | — |
| D1 | Remove `split-queue.ts` dead code | Cleanup | — | ✅ Done | ADR-072 |
| D2 | Week-in-block schedule drift design | Future design | — | ⏳ Deferred | — |
| D3 | Cycle/progress presentation for users | Future feature | — | ⏳ Deferred | — |
