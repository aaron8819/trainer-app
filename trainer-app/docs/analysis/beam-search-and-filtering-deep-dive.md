# Beam Search & Filtering: Deep Dive Analysis

**Date:** 2026-02-18
**Scope:** `selection-v2/` module, `timeboxing.ts`, `volume-landmarks.ts`, `template-session.ts` (API layer)
**Purpose:** Challenge all existing assumptions, re-derive from KB first principles, produce actionable recommendations

---

## Executive Summary

The beam search architecture is sound in concept but has three failure-mode issues that reduce session quality — the most significant being **time budget as a hard beam-expansion constraint**. The KB does not recognize time-per-session as a primary training variable; it recognizes **direct hard sets per muscle per session** (≤10–12). Using unreliable time estimates as hard rejection criteria during search causes optimal exercises to be blocked for the wrong reason, leaving sessions under-populated (0 accessories on tight budgets, confirmed in prior E2E tests). The recommended fix is to **deprecate time-budget from the beam's hard-reject loop and promote the per-session per-muscle direct-set ceiling as the primary capacity constraint** — which the engine has already begun implementing (C1b at line 207 of beam-search.ts).

Two secondary issues compound the first: a **weight normalization error** (weights sum to 1.20, not 1.00) and **rotation novelty penalizing main lifts** (which should be trained consistently, not rotated like accessories).

---

## 1. Architecture Map

```
User request (sessionMinutes, intent)
        │
        ▼
API: buildSelectionObjective()
  - timeBudget = sessionMinutes  ← hard constraint
  - volumeCeiling = MRV per muscle
  - minMainLifts, maxMainLifts, minAccessories
        │
        ▼
optimizer.ts: selectExercisesOptimized()
  ① filterHardConstraints()      pain + user avoids
  ② buildCandidate()             score all feasible exercises
  ③ beamSearch()                 expand states, prune top-K
        │ inner loop (per expansion):
        │   - time budget check         ← PROBLEM AREA
        │   - volume ceiling check
        │   - max exercises check
        │   - wouldSatisfyStructure()
        │   - movement pattern cap (≤2)
        │   - triceps isolation cap (C1)
        │   - session direct-set ceiling (C1b) ← RIGHT CONSTRAINT
        │   - isolation duplicate block (W2)
        │   - front delt suppression (W3)
        ▼
  ④ enforceMinExercises()        reactive greedy fix
  ⑤ enforceStructuralConstraints()
        │
        ▼
Engine: generateWorkoutFromTemplate()
  - prescribeSetsReps()          actual set counts (different from proposedSets)
  - enforceTimeBudget()          post-generation safety net ← SECOND TIME CHECK
```

---

## 2. Finding 1 (Critical): Time Budget as Hard Beam Constraint

### What the code does

In `beam-search.ts:134–138`:
```ts
const newTimeUsed = state.timeUsed + candidate.timeContribution;
if (newTimeUsed > objective.constraints.timeBudget) {
  rejectedMap.set(candidate.exercise.id, "time_budget_exceeded");
  continue;
}
```

`candidate.timeContribution` is computed once in `candidate.ts:176` via `estimateExerciseMinutes()`. For a typical main lift (3 working sets + 3 warmup sets, 150s rest):

```
Working: 3 × (60s work + 150s rest) = 630s
Warmup:  3 × (30s + 45s)           = 225s
Total:   855s ÷ 60 = ~14.25 min
```

**With a 30-min session and 2 main lifts ≈ 28 min, the engine leaves 2 min for accessories. Every accessory (≈6.5 min at 3 sets, 90s rest) is rejected by the time-budget check. Result: 0 accessories — confirmed by E2E scenario testing.**

### Why this assumption is wrong

**KB Evidence (§2, Frequency):**
> "RP emphasizes that per-session volume should not exceed ~10–12 hard sets for a single muscle group due to diminishing returns."

The KB does not cite time-per-session as a primary training variable. Session length is a *derivative* of set count × rest periods. The set count is the variable that matters for adaptation.

**Three concrete failure modes of time-as-hard-constraint:**

1. **Estimation error accumulates.** `estimateExerciseMinutes` uses `exercise.timePerSetSec` (a static field, often the DB default of 40–60s), but real gym performance varies ±30%. A 6.5-min estimate for an accessory might be 5 min in practice. The engine treats its estimate as ground truth.

2. **Double-jeopardy.** The beam rejects exercises during search, then `enforceTimeBudget()` runs *again* post-generation with a different estimator (operating on actual prescribed sets). These can diverge: beam used `proposedSets` from `computeProposedSets()`, prescription uses `prescribeSetsReps()`. A 2-set proposed exercise might be prescribed as 3 sets. The two phases are not synchronized.

3. **Optimal exercises blocked before the real constraint fires.** The time check runs at filter position 3 (line 134), *before* the volume ceiling check (line 144), the session direct-set ceiling (C1b, line 207), and the isolation caps (C1, W2, W3). A high-SFR accessory that would fill a deficit gets flat-rejected by the time estimate before the engine has a chance to check whether it actually violates anything evidence-based.

### What should control session length?

The KB provides a clear answer: **the per-session per-muscle direct-set ceiling**.

From KB §2:
> "per-session volume should not exceed ~10–12 hard sets for a single muscle group"

A typical PPL session with this ceiling looks like:
- 2 main lifts (3–5 sets each) = 6–10 sets targeting 1–2 muscles
- 3–5 accessories (2–4 sets each) = 6–15 sets across multiple muscles
- Total direct sets per primary muscle: typically 3–8, well under the 10–12 ceiling

This ceiling naturally bounds session length without needing an explicit time estimate. The engine already implements this as `SESSION_DIRECT_SET_CEILING = 12` (C1b in beam-search.ts), but it's a secondary check after time budget has already rejected exercises. **Making C1b primary and removing time budget from hard rejection is the fix.**

### Impact of the fix

With time budget removed from hard rejection:
- 30-min session: accessories are no longer blocked; the per-muscle ceiling and maxExercises cap limit selection
- 60-min session: behavior is unchanged (plenty of time, time budget rarely fires)
- `enforceTimeBudget()` post-generation becomes the lightweight safety net it was intended to be, rarely needed

---

## 3. Finding 2 (Moderate): Weight Normalization Error

### Current weights

```ts
DEFAULT_SELECTION_WEIGHTS = {
  volumeDeficitFill:  0.40,
  rotationNovelty:    0.25,
  sfrEfficiency:      0.15,
  lengthenedBias:     0.20,  // Added Phase 4 without reducing others
  movementDiversity:  0.15,
  sraReadiness:       0.03,
  userPreference:     0.02,
  // SUM:            1.20    ← NOT 1.00
}
```

The docstring says *"sum to 1.0"* but `lengthenedBias` at 0.20 was added (justified — Maeo 2023 overhead +40%) without reducing any other weight. The maximum possible score is now 1.20.

### Concrete impact

- `BEAM_TIEBREAKER_EPSILON = 0.05` is documented as ~5% of one exercise's maximum contribution. With a 1.20 max, the effective threshold is 4.2%, making the tiebreaker fire slightly more aggressively than intended.
- Scores are still comparable (ranking is preserved), so this isn't a correctness bug — but the stated invariant is wrong.
- The `volumeDeficitFill` weight at 0.40 (effectively 0.33 of total) may be slightly over-weighted relative to the KB evidence. The KB shows volume is the primary hypertrophy variable, but at the selection level, deficit fill is already implicit — you should be selecting exercises that target your split muscles anyway. Over-weighting it can cause the engine to select less efficient exercises just because they slightly better fill a deficit.

### Recommended rebalance (KB-grounded)

| Weight | Current | Proposed | Rationale |
|--------|---------|----------|-----------|
| volumeDeficitFill | 0.40 | 0.35 | Primary objective, but reduce slightly to let SFR and lengthened bias compete |
| rotationNovelty | 0.25 | 0.22 | Reduce to make room; still second-highest |
| sfrEfficiency | 0.15 | 0.12 | KB §3: SFR guides selection but deficit fill already filters candidates |
| lengthenedBias | 0.20 | 0.18 | Strong KB evidence (Maeo 2023, Kassiano 2023); slight reduction for normalization |
| movementDiversity | 0.15 | 0.08 | Dynamic rescoring already handles this; hard cap (ADR-071) provides structural guarantee |
| sraReadiness | 0.03 | 0.03 | Unchanged; advisory |
| userPreference | 0.02 | 0.02 | Unchanged; tiebreaker |
| **SUM** | **1.20** | **1.00** | |

**Note on `movementDiversity` reduction:** The ADR-071 movement-pattern hard cap (max 2 exercises per pattern) makes the soft movementDiversity weight partially redundant. The beam-state dynamic rescoring (ADR-070) already gives the correct signal. Reducing this weight to 0.08 won't meaningfully hurt diversity because the hard cap prevents the worst-case outcome.

---

## 4. Finding 3 (Moderate): Rotation Novelty Penalizes Main Lifts Incorrectly

### The KB position

**KB §2, Exercise selection:**
> "Maintain core movements for 2-3 mesocycles to allow progressive overload tracking while rotating accessories for novel stimuli and joint stress management."

**KB §3, Mesocycle structure:**
> "Maintain core exercises for 2-3 mesocycles; rotate accessories each mesocycle."

The intent is clear: main lifts (bench press, squat, OHP, deadlift, row) should be trained *consistently* for 6–18 weeks. Rotating them defeats progressive overload.

### What the engine does

`scoreRotationNovelty()` in scoring.ts:
```ts
const TARGET_CADENCE = 3; // weeks for ALL exercises
const novelty = Math.min(1.0, exposure.weeksAgo / TARGET_CADENCE);
```

A bench press used every session scores 0.0 (used "yesterday" by weeksAgo=0). An untrained auxiliary movement scores 1.0. The `rotationNovelty` weight of 0.25 means this 1.0 delta (×0.25 = 0.25 score advantage) can override deficitFill and SFR signals.

**The effect:** The engine is systematically penalized for recommending the bench press (correct main lift for a push day), and biased toward novel exercises that the user hasn't tried — the exact opposite of what the KB prescribes for compounds.

### Why this hasn't broken things more

- `minMainLifts` structural constraint ensures at least 1 main lift is always selected
- For pinned template exercises, this code path isn't exercised
- For intent-based generation, beam search usually still selects main lifts due to the structural constraint enforcement post-beam

### Fix: Differentiate cadence by exercise type

```ts
const TARGET_CADENCE = exercise.isMainLiftEligible
  ? 999  // Main lifts: effectively never penalize for recency
  : exercise.isCompound
  ? 6    // Compound accessories: rotate every 6 weeks (1.5 mesocycles)
  : 3;   // Isolations: rotate every 3 weeks (1 mesocycle)
```

Or simpler: skip rotation novelty scoring entirely for main lifts and return 0.75 (slightly above neutral 0.5) as a fixed reward for proven core movements.

---

## 5. Finding 4 (Moderate): Triceps Classification — Data Integrity Issue

### The problem

The KB states clearly (§4, Triceps):
> "MEV 4-6, MAV 10-14, MRV ~18 sets/week — **lower than biceps due to heavy indirect stimulus from pressing**"

This phrasing is critical: the Triceps MRV of 18 is **calibrated assuming pressing volume counts as indirect stimulus** (at the 0.3× multiplier). But in the exercise library, pressing compounds (Bench Press, OHP, Dips) list Triceps as a `primaryMuscles` entry, contributing **direct** sets.

**Impact:**
- Bench Press (3 direct Triceps sets) + OHP (3 direct Triceps sets) + Dips (3 direct Triceps sets) = 9 direct Triceps sets
- This hits more than half of weekly MRV=18 in a single session
- `SESSION_DIRECT_SET_CEILING = 12` then blocks Triceps isolation entirely (9 + 3 = 12)
- ADR-073's C1 triceps isolation cap was added as a workaround, but the root cause is the data classification

The KB's definition of MRV assumes presses generate *indirect* triceps stress, not direct stimulus equivalent to isolation work. The engine treats pressing as direct, so MRV is hit faster than intended.

### Fix (data migration)

Move Triceps from `primaryMuscles` to `secondaryMuscles` on all pressing compounds (Bench Press, Incline DB Press, OHP, Machine Chest Press, Dips, etc.). This means:
- Pressing contributes 0.3× indirect Triceps sets
- MRV ceiling is correctly approached by actual direct isolation work
- C1 (triceps isolation cap) becomes unnecessary and can be removed
- The `SESSION_DIRECT_SET_CEILING` check works correctly

This is a data migration and out of scope for the beam search redesign, but it is the correct long-term fix. The C1 cap should be retained as a safety net until the data is corrected.

---

## 6. Finding 5 (Minor): Proposed Sets / Prescribed Sets Mismatch

### The issue

`computeProposedSets()` uses `Math.ceil(maxDeficit / 2)` clamped 2–5 for time estimation during beam search. This is a heuristic that doesn't match what `prescribeSetsReps()` will actually prescribe.

Example:
- Deficit: 6 sets → proposed = 3 sets → estimated time = 6.5 min
- Prescribed (based on goals, training age, periodization): 4 sets → actual time = 8 min
- Beam accepted it at 6.5 min but post-generation `enforceTimeBudget` recalculates at 8 min

This divergence is minor when `enforceTimeBudget` is a soft safety net, but becomes a problem when it's relied upon for session validity. With the proposed change (remove time from hard beam constraint), this divergence only matters at the post-gen trim stage, which is acceptable.

---

## 7. Finding 6 (Minor): Front Delt Suppression Threshold Mismatch with ADR

ADR-073 states the threshold was set at `MAV/2 = 3.5 effective sets` to suppress front delt isolation. The actual code uses `FRONT_DELT_SUPPRESS_THRESHOLD = 1.0`.

**Which is correct?**

The 1.0 threshold is pragmatically correct:
- OHP: 3.0 direct effective Front Delt sets → exceeds 1.0 → suppression fires ✓
- Bench-only: ~0.9 indirect effective → below 1.0 → suppression doesn't fire
- KB: "Front delts MEV=0; most lifters need zero direct isolation" — the MEV=0 already means deficit fill score = 0, so front delt exercises are naturally not selected anyway

The ADR description is inaccurate (references 3.5 not implemented), but the implementation is correct. The docstring in beam-search.ts should be updated to reflect the actual 1.0 threshold logic.

---

## 8. Volume Landmarks Audit vs KB

| Muscle | KB MEV | Engine MEV | KB MRV | Engine MRV | Status |
|--------|--------|------------|--------|------------|--------|
| Chest | 8–10 | 10 | ~22 | 22 | ✓ |
| Lats | 8–10 | 10 | ~25 | 25 | ✓ |
| Upper Back | 8–10 | 10 | ~25 | 25 | ✓ |
| Front Delts | 0 | 0 | ~12 | 12 | ✓ |
| Side Delts | 8 | 8 | ~26 | 26 | ✓ |
| Rear Delts | 8 | 8 | ~26 | 26 | ✓ |
| Quads | 8 | 8 | ~20 | 20 | ✓ |
| Hamstrings | 6 | 6 | ~20 | 20 | ✓ |
| Glutes | 0 | 0 | ~16 | 16 | ✓ |
| Biceps | 8 | 8 | ~26 | 26 | ✓ |
| Triceps | 4–6 | 6 | ~18 | 18 | ✓ (but classification issue per Finding 4) |
| Calves | 6–8 | 8 | ~20 | 20 | ✓ |

**Verdict:** Volume landmarks are well-calibrated against the KB. No changes needed here.

---

## 9. Scoring Functions KB Audit

| Score | KB Basis | Implementation | Status |
|-------|----------|----------------|--------|
| Deficit fill | KB §1: "volume is the strongest modifiable variable for hypertrophy" | scoreDeficitFill — uses effective volume (direct + 0.3× indirect) | ✓ Sound |
| Rotation novelty | KB §2: "rotate accessories every mesocycle" | scoreRotationNovelty — 3-week cadence for ALL exercises | ⚠️ Misapplied to main lifts (Finding 3) |
| SFR | KB §3: "SFR concept compares adaptive stimulus to fatigue" | scoreSFR — sfrScore/5 | ✓ Sound |
| Lengthened bias | KB §2: Maeo 2023 +40% triceps, Kassiano 2023 +15% calves | scoreLengthened — lengthPositionScore/5 | ✓ Strongly evidence-based |
| Movement diversity | KB §2: "non-uniform hypertrophy — different exercises grow different regions" | scoreMovementNovelty — dynamic delta (ADR-070) | ✓ Sound |
| SRA readiness | KB §7: SRA curves 24–96h by muscle | scoreSRAAlignment — average recovery of primary muscles | ✓ Sound (advisory at 0.03 weight) |
| User preference | UX design decision | scoreUserPreference | ✓ Appropriate as tiebreaker |

---

## 10. Redesign Recommendations

### R1 (Critical): Remove `timeBudget` from beam hard-rejection loop

**Current behavior:** `if (newTimeUsed > timeBudget) { continue; }` — hard reject any exercise that pushes estimated time over budget.

**New behavior:** Remove this check from the beam expansion inner loop entirely. Keep `timeBudget` in `SelectionConstraints` for documentation/UI purposes.

**Evidence:** KB §2 — session capacity is bounded by direct-set ceiling (10–12 per muscle), not by estimated elapsed time. The beam search should select the *best* exercises within volume/structural constraints, then let `enforceTimeBudget` trim if truly needed post-generation.

**Also remove from:**
- `enforceMinExercises()` — the time budget check here causes accessories to be rejected during the greedy fallback
- `canAddCandidate()` — used in `enforceStructuralConstraints()`
- `tryReduceSetsToFitMore()` — entire function can be removed; its purpose was to fit exercises within time budget

**Retain:**
- `enforceTimeBudget()` in `timeboxing.ts` — post-generation safety net; runs on actual prescribed sets, not estimates
- The UI display of `estimatedMinutes` — useful information for the user

### R2 (Critical): Promote per-session per-muscle direct-set ceiling to primary capacity constraint

**Current:** `SESSION_DIRECT_SET_CEILING = 12` is hardcoded inline in beam-search.ts at one check (C1b). It applies uniformly to all muscles.

**Proposed:** Add `sessionDirectSetCeiling: Map<Muscle, number>` to `SelectionConstraints`. Default values derived from `Math.floor(MRV / weeklyFrequency)`:

| Muscle | MRV | Weekly Freq | Session Ceiling |
|--------|-----|-------------|-----------------|
| Chest | 22 | 2 | 11 |
| Lats | 25 | 2 | 12 |
| Upper Back | 25 | 2 | 12 |
| Side Delts | 26 | 2–4 | 7–13 → default 10 |
| Rear Delts | 26 | 2–4 | 7–13 → default 10 |
| Biceps | 26 | 2 | 13 → cap at 12 |
| Triceps | 18 | 2 | 9 |
| Quads | 20 | 2 | 10 |
| Hamstrings | 20 | 2 | 10 |
| Glutes | 16 | 2 | 8 |
| Calves | 20 | 2–4 | 5–10 → default 8 |
| Lower Back | 10 | 1–2 | 5 |

For simplicity, set a global default of 10 (slightly conservative, bottom of the 10–12 range) unless the muscle-specific ceiling is lower.

**KB Evidence:** "per-session volume should not exceed ~10–12 hard sets for a single muscle group" (KB §2). Using 10 as the default is slightly conservative but avoids acute diminishing returns.

### R3 (Moderate): Fix rotation novelty cadence for main lifts

Apply `TARGET_CADENCE` differentially:
- `isMainLiftEligible`: return 0.75 fixed (rewarded for being a proven core movement, but not penalized for recency)
- `isCompound && !isMainLiftEligible`: `TARGET_CADENCE = 6` weeks (rotate compound accessories every 1.5 mesocycles)
- isolations: `TARGET_CADENCE = 3` weeks (rotate every mesocycle — current behavior)

**KB Evidence:** "Maintain core movements for 2-3 mesocycles; rotate accessories each mesocycle." (KB §2, §3)

### R4 (Moderate): Normalize weights to sum to 1.00

Apply rebalanced weights from Finding 2:
```ts
DEFAULT_SELECTION_WEIGHTS = {
  volumeDeficitFill:  0.35,
  rotationNovelty:    0.22,
  sfrEfficiency:      0.12,
  lengthenedBias:     0.18,
  movementDiversity:  0.08,
  sraReadiness:       0.03,
  userPreference:     0.02,
  // SUM: 1.00
}
```

### R5 (Planned, data migration): Reclassify Triceps in pressing compounds

Move Triceps from `primaryMuscles` → `secondaryMuscles` on all pressing compounds. After this migration, remove C1 (triceps isolation cap) from beam-search.ts. The correct data classification makes the workaround unnecessary.

---

## 11. Implementation Priority

| # | Recommendation | Impact | Effort | Priority |
|---|----------------|--------|--------|----------|
| R1 | Remove time-budget from beam hard constraint | High (fixes 0-accessory bug) | Low | **Ship first** |
| R2 | Per-muscle session set ceiling in SelectionConstraints | High (correct primary constraint) | Low | **Ship with R1** |
| R3 | Rotation novelty cadence by exercise type | Medium (better main lift selection) | Low | **Ship with R1** |
| R4 | Weight normalization to 1.00 | Low-medium (correctness) | Trivial | **Ship with R1** |
| R5 | Triceps reclassification (data migration) | Medium (removes C1 workaround) | High | **Deferred** |

R1–R4 can ship as a single PR. R5 requires a schema migration and exercise data update — separate effort.

---

## 12. Things That Are Working Well (Do Not Change)

- **C1b (session direct-set ceiling)** — correct KB grounding, just needs to become the primary capacity constraint
- **W2 (isolation duplicate block)** — correctly prevents redundant stimulus
- **W3 (front delt suppression)** — threshold is pragmatically correct even if ADR description is stale
- **Movement pattern cap (ADR-071)** — correct structural guardrail, hard cap prevents worst-case outcomes
- **Dynamic movement diversity scoring (ADR-070)** — beam-state-aware delta adjustment is architecturally elegant
- **Volume landmarks** — well-aligned with KB
- **Lengthened bias scoring** — strongly evidence-based (Maeo 2023, Kassiano 2023)
- **Deficit fill scoring** — sound; effective volume accounting (direct + 0.3× indirect) is reasonable
- **SRA context** — correct; advisory use at 0.03 weight avoids over-constraining selection

---

## 13. ADR Proposals

### ADR-075: Deprecate Time-Budget from Beam Hard Constraint
Replace time-budget hard rejection with per-session per-muscle direct-set ceiling as primary capacity constraint. `timeBudget` retained in `SelectionConstraints` for UI and post-generation safety net only.

### ADR-076: Rotation Novelty Cadence Differentiated by Exercise Type
`isMainLiftEligible` exercises: fixed score 0.75 (no recency penalty). Compound accessories: 6-week cadence. Isolations: 3-week cadence (current). KB: "Maintain core movements 2-3 mesocycles; rotate accessories each mesocycle."

### ADR-077: Selection Weight Normalization (Weights Sum to 1.00)
Rebalance to: volumeDeficitFill=0.35, rotationNovelty=0.22, sfrEfficiency=0.12, lengthenedBias=0.18, movementDiversity=0.08, sraReadiness=0.03, userPreference=0.02.
