# Session Review Page Improvements

Identified from manual review of workout `f58334e2` (first completed workout, Pull day).
Last updated: 2026-02-17

---

## Status

| Item | Priority | Status |
|------|----------|--------|
| "Load seeded from baseline" display text is misleading — load was estimated | P0 Bug | ✅ Done |
| Dumbbell exercises show total weight — should show per-dumbbell weight everywhere | P0 UX | ✅ Done |
| "Start Logging" visible on completed workouts | P1 UX | ✅ Done |
| Exercise header shows top set only, back-off sets unexplained | P1 UX | ✅ Done |
| "Not above baseline top set" — shows no actual numbers | P1 UX | ✅ Done |
| Three identical TIP cards — noisy | P2 UX | ✅ Done |
| "KB-backed" badge unexplained | P2 UX | ✅ Done |
| Load accuracy not reflected in color coding (reps-only) | P2 UX | ✅ Done |
| Negative framing on "no volume deficits targeted" | P3 UX | ✅ Done |
| Block phase stated twice, page title stale on completion | P3 UX | ✅ Done |

---

## P0 Bugs / Changes

### 1. "Load seeded from baseline" display is misleading — loads were estimated

**Root cause (confirmed by code trace):** The `loadNote` text in the workout detail page fires whenever `targetLoad !== null` AND any current baseline exists. It does **not** verify that the baseline actually drove the load prescription. The engine's `resolveLoadForExercise` has three tiers:
1. History → compute progression
2. Baseline → use directly
3. `estimateLoad` → body weight ratio or donor exercise scaling (fallback)

For this user's **first workout**, no history existed. Whether baselines existed at generation time is uncertain (they may have been set manually after generation). The engine fell back to tier 3 estimation for all/most exercises. The page then found current baselines and incorrectly claimed they were the source.

**Evidence:**
- Chest-Supported Row: estimated via donor scaling (T-Bar Row barbell baseline × equipment scale × fatigue scale ≈ 112.5)
- Cable Pullover (38 lbs) and Cable Curl (28.5 lbs): consistent with `weightLbs × 0.2` (cable isolation ratio) at ~190 lb body weight — not from baselines
- After the first workout, logged history now exists → next generation will use tier 1 and produce accurate loads

**Calibration note:** This is a **first-workout-only** problem. The prescription engine self-corrects once history exists. The 112.5 lb prescription for Chest-Supported Row will not repeat.

**Fixes needed:**
1. **Display fix (required):** Change the `loadNote` logic to distinguish between estimated and baseline-seeded loads. Store load source (`estimated` | `baseline` | `history`) when the workout is saved, or compare `targetLoad` vs resolved baseline load at display time.
   - Current (wrong): shows "Load seeded from baseline (X–X lbs)" whenever both exist
   - Correct: "Load estimated (no baseline at time of generation)" vs "Load from your baseline (X lbs)" vs "Load from your recent history"
2. **No engine change needed** — load tiers are correct; the estimation produced reasonable first-workout values

**Files:** [workout/[id]/page.tsx](../src/app/workout/[id]/page.tsx) ~L449-465, [apply-loads.ts](../src/lib/engine/apply-loads.ts)

---

### 2. Dumbbell exercises show total weight — should show per-dumbbell weight everywhere

**Context (from user):** User logged "55 lbs" for Chest-Supported Dumbbell Row, but this was two 27.5 lb dumbbells. The app is storing/displaying total combined weight. **User preference: all DB exercises should consistently show per-dumbbell weight.**

**Scope of change:**
- `DUMBBELL` equipment type already exists in both the Prisma schema and engine types
- `isUnilateral` field exists on `Exercise` but is NOT used in any load calc — stays that way
- The change is **display-only**: store total weight, display as `weight / 2` with "lbs each" label

**Affected surfaces:**
1. **Workout detail page** ([workout/[id]/page.tsx](../src/app/workout/[id]/page.tsx)):
   - `formatLoadDisplay()` at L82 — add `isDumbbell` param, divide by 2 + append "each"
   - `loadNote` baseline display — divide baseline range values by 2 for DB exercises
   - Actual vs target display for each set — both target and actual loads

2. **Logging UI** ([LogWorkoutClient.tsx](../src/components/LogWorkoutClient.tsx)):
   - Set chip labels: `${set.actualLoad}×${set.actualReps}` → `${set.actualLoad / 2} lbs each`
   - Target prescription line shown during logging — divide by 2
   - Actual load INPUT: user should enter per-dumbbell value; multiply by 2 before storing (or accept total and display half)
   - Post-workout summary performance table

3. **BaselineEditor** ([BaselineEditor.tsx](../src/components/BaselineEditor.tsx)):
   - Input label: "Weight (lbs)" → "Weight per dumbbell (lbs)"
   - Display of saved baseline: show per-dumbbell value
   - Store: multiply entered value × 2 before saving, OR store as-is (per-dumbbell) — decide on storage convention

4. **Bonus exercise sheet + exercise detail** — any load preview

**Storage convention decision (pick before implementing):**
- **Option A — Store total, display half:** No migration needed, convert at display only. All existing baselines stay valid. Input label says "per dumbbell" but value is divided by 2 internally. Simpler.
- **Option B — Store per-dumbbell, display as-is:** Requires migrating existing dumbbell baselines (divide by 2). Input and storage match display. Cleaner long-term.
- **Recommendation: Option A** — no data migration, conversion in one utility function

**Implementation plan (Option A):**
```typescript
// New utility (shared across pages)
function formatDumbbellLoad(totalLbs: number): string {
  return `${totalLbs / 2} lbs each`;
}

// Helper to detect DB exercise
function isDumbbellExercise(equipment: EquipmentType[]): boolean {
  return equipment.includes("dumbbell");
}
```

**Files:** [workout/[id]/page.tsx](../src/app/workout/[id]/page.tsx), [LogWorkoutClient.tsx](../src/components/LogWorkoutClient.tsx), [BaselineEditor.tsx](../src/components/BaselineEditor.tsx)

---

## P1 UX

### 3. "Start Logging" Button Visible on Completed Workouts

**Observed:** The "Start Logging" button is always rendered on the workout detail page regardless of `workout.status`. A completed workout should not invite re-logging.

**Fix:** Conditionally hide the button (or replace with "Review" / no-op) when `workout.status === "COMPLETED"` or `"SKIPPED"`.

**File:** [workout/[id]/page.tsx](../src/app/workout/[id]/page.tsx) ~L397

---

### 4. Exercise Header Shows Top Set Only — Back-Off Sets Unexplained

**Observed:** T-Bar Row header: "5 sets – 6 reps | 131.5 lbs | RPE 7" — but Sets 2–5 are back-off sets at 7 reps / 115.5 lbs. The header uses `sets[0]` parameters only, so the majority of sets appear to contradict the header with no explanation.

**Fix options (pick one):**
- A: Show top set and back-off inline: "Top set: 6 reps @ 131.5 lbs · Back-off: 7 reps @ 115.5 lbs"
- B: Show the back-off parameters in the header since they represent most of the volume (4 of 5 sets)
- C: Label Set 1 as "Top set" in the set list so the visual difference is explained there

**File:** [workout/[id]/page.tsx](../src/app/workout/[id]/page.tsx) ~L485

---

### 5. Baseline Skip Reason Shows No Actual Numbers

**Observed:** 5 exercises all show "Not above current baseline top set." — identical text with no numbers. The user has no idea what their baseline top set actually is, or how close they came.

**Fix:** Surface the actual numbers in the reason text. E.g.:
- Current: "Not above current baseline top set."
- Better: "Best set: 120 lbs × 6 reps. Baseline top set: 120 lbs × 8 reps. No improvement."

**File:** [workout/[id]/page.tsx](../src/app/workout/[id]/page.tsx) ~L156-206 (baseline qualification section)

---

## P2 UX

### 6. Three Identical TIP Cards Stack Visually

**Observed:** Three amber TIP cards in a row with identical styling — accumulation technique, fatigue recovery, and volume building. All valid, none stands out. Reads as noise after the first.

**Fix:** Consolidate into a single card with bullet points, or rank by relevance and show only the top 1–2. Consider promoting one as "primary" (different visual weight) if multiple must be shown.

**File:** Tip/encouragement card rendering in [workout/[id]/page.tsx](../src/app/workout/[id]/page.tsx) or [explainability.ts](../src/lib/api/explainability.ts)

---

### 7. "KB-backed" Badge Is Unexplained Jargon

**Observed:** A blue "KB-backed" badge appears top-right of every exercise card. The average user has no idea what this means.

**Fix options:**
- Add a tooltip: "This exercise was selected using knowledge-base reasoning"
- Rename to something user-facing: "AI-selected" or "Smart pick"
- Remove entirely if it adds no actionable information for the user

**File:** [workout/[id]/page.tsx](../src/app/workout/[id]/page.tsx) ~L476-499

---

### 8. Color Coding Is Reps-Only — Large Load Misses Go Unnoticed

**Observed:** T-Bar Row Set 1: target 131.5 lbs, actual 120 lbs (8.7% miss) — but shows ✓ green because reps matched. A user significantly undershooting the prescribed load gets the same positive feedback as one who hit it perfectly.

**Fix:** Add a secondary indicator for load accuracy. Options:
- A: Small gray note beneath the actual line: "Load: 120 / 131.5 lbs (–8.7%)"
- B: Adjust the ✓ logic: only show ✓ if both reps AND load are within ~10% of target
- C: Amber color if reps hit but load was >10% below target

**File:** [workout/[id]/page.tsx](../src/app/workout/[id]/page.tsx) ~L516-526

---

## P3 UX

### 9. "No Active Volume Deficits Targeted" — Negative Framing

**Observed:** The "Why included" line reads "No active volume deficits targeted • High SFR..." — leading with a negation. Sounds like an apology for the selection, not a reason for it.

**Fix:** Reframe or drop this clause. If the engine didn't target a volume deficit, just don't mention it. Let the positive reasons (SFR, length position) speak for themselves.

**File:** [explainability.ts](../src/lib/api/explainability.ts) or wherever `primaryReasons` are assembled

---

### 10. Block Phase Stated Twice + Page Title Stale

**Observed:**
- "Accumulation Week 1 of 4" appears in both the introductory paragraph and the chip directly below it
- The page header says "Session Overview" on a workout that's already completed

**Fix:**
- Remove the chip or the inline mention — keep one
- Change page title to "Session Review" (or show workout date) when `workout.status === "COMPLETED"`

**File:** [workout/[id]/page.tsx](../src/app/workout/[id]/page.tsx) ~top of page

---

## Notes

- Load color coding currently only uses rep diff: `repDiff >= 0` → green, `=== -1` → amber, `< -1` → red
- "Load seeded from baseline" bug: display logic fires whenever `targetLoad !== null && baseline exists` — no causation check. Must store load source or compare at display time.
- Back-off multipliers: hypertrophy = 0.88, strength = 0.90 (confirmed correct in `apply-loads.ts`)
- `findBaseline()` on the detail page looks up by exercise name — if name doesn't match exactly, falls back to "no baseline match"
- `isUnilateral` field on Exercise is metadata-only — never used in load calculations. Good; don't change that.
- Load tiers in `resolveLoadForExercise`: (1) history → progression, (2) baseline → direct, (3) estimateLoad → bodyweight ratio or donor scaling. First-workout estimation is expected behavior, display is the bug.
- First-workout load estimation self-corrects: once history exists, tier 1 drives subsequent prescriptions accurately.
- Baseline update logic (`baseline-updater.ts`): only updates when `actualWeight > current topSetWeight`. Stores actual logged weight as both `workingWeightMin/Max` and `topSetWeight`. "Skipped: 5" on first workout is expected — user matched but didn't exceed initial baselines.
- Dumbbell convention: storing total weight (current behavior) is fine; conversion to per-dumbbell is display-only (Option A). No migration needed.
