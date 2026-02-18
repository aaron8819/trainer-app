# Beam Search & Filtering: Deep Dive — Post-Phase 4.6 Analysis

**Date:** 2026-02-18
**Scope:** `selection-v2/` module (beam-search.ts, optimizer.ts, candidate.ts, scoring.ts, types.ts)
**Prior art:** `beam-search-and-filtering-deep-dive.md`, `beam-search-filtering-analysis.md`
**Purpose:** Challenge all remaining assumptions after timeBudget removal. Reason from first principles using KB. Surface new architectural findings.

---

## Executive Summary

Phase 4.6 implemented the three high-priority changes from the previous analyses: time budget removed from beam hard-reject (R1), weights renormalized to 1.00 (R4), and beam width widened to 7 (R5-prev). These were the most impactful changes and are correctly implemented.

**This analysis surfaces five new findings** (F-A through F-E), reasserts the two still-outstanding recs from the previous work (R3, R5), and provides a complete updated recommendation set.

The most impactful new finding is **F-B: deficitFill scores are static throughout beam expansion**, meaning the beam can't recognize that a deficit has been partially filled by an earlier selection. The mechanism to fix this already exists in the codebase (the dynamic movementDiversity re-scoring pattern). This is a moderate-impact quality issue.

The second most impactful finding is **F-A: the MRV volume ceiling is a high-threshold net that rarely fires** — the real session capacity work is done by C1b (direct set ceiling), which is correctly positioned. This is an observation, not a bug — but it means the architecture is correct only because C1b exists. If C1b were ever removed, the MRV ceiling would be inadequate on its own.

---

## 1. What Changed in Phase 4.6 (Verified Correct)

| Change | File | Status |
|--------|------|--------|
| timeBudget removed from beam inner loop | beam-search.ts | ✓ Correct |
| timeBudget removed from enforceMinExercises | beam-search.ts | ✓ Correct |
| timeBudget removed from canAddCandidate | beam-search.ts | ✓ Correct |
| tryReduceSetsToFitMore removed | beam-search.ts | ✓ Correct |
| TIGHT_BUDGET_THRESHOLD/CAP removed | candidate.ts | ✓ Correct |
| timeBudget removed from SelectionConstraints | types.ts | ✓ Correct |
| Weights renormalized 1.20 → 1.00 | types.ts | ✓ Correct |
| Beam width 5 → 7 | types.ts | ✓ Correct |
| timeBudget removed from template-session.ts | api/template-session.ts | ✓ Correct |
| timeBudget removed from smart-build.ts | engine/smart-build.ts | ✓ Correct |
| "time_budget_exceeded" case removed from explainability | explainability.ts, FilteredExercisesCard.tsx | ✓ Correct |

**Verified weights post-normalization (sum = 1.00):**
```ts
volumeDeficitFill: 0.35  // Primary — fill volume deficits efficiently
rotationNovelty:   0.22  // High — force variety across sessions
lengthenedBias:    0.20  // KB-confirmed (Maeo 2023, Kassiano 2023)
sfrEfficiency:     0.12  // Moderate — efficiency matters
movementDiversity: 0.07  // Beam state-aware — dynamically re-scored during expansion
sraReadiness:      0.03  // Advisory only
userPreference:    0.01  // Tiebreaker
// Sum:            1.00
```

---

## 2. Outstanding Recs from Previous Analysis (Still Unimplemented)

### R3 (Moderate): Rotation Novelty Misapplied to Main Lifts

**Current behavior:** `scoreRotationNovelty` applies the same 3-week cadence to ALL exercises:
```ts
const TARGET_CADENCE = 3;
const novelty = Math.min(1.0, exposure.weeksAgo / TARGET_CADENCE);
```

A bench press trained every push day scores `0.0` (used this week = 0 weeks ago). An untrained auxiliary movement scores `1.0`. The 0.22 weight means this 1.0 delta (×0.22 = 0.22 score advantage) can override deficit fill and SFR signals for main lift candidates.

**KB Evidence (§2, §3):**
> "Maintain core movements for 2-3 mesocycles to allow progressive overload tracking while rotating accessories for novel stimuli."

The engine systematically penalizes recommending the bench press (the correct main lift for push day), and biases toward novel exercises that the user hasn't tried — the opposite of what the KB prescribes for compounds.

**Why hasn't this broken everything?** The `minMainLifts=1` structural constraint forces main lift inclusion even when novelty penalizes it. But the score degradation means beam states without the bench press rank higher during search, and `enforceStructuralConstraints` adds the bench back as a post-hoc greedy fix — defeating the multi-objective optimization.

**Fix:**
```ts
export function scoreRotationNovelty(
  exercise: Exercise,
  rotationContext: RotationContext
): number {
  const exposure = rotationContext.get(exercise.name);
  if (!exposure) return 1.0;

  // Main lifts: never penalize for recency (KB: train consistently for 2-3 mesocycles)
  if (exercise.isMainLiftEligible) return 0.75; // Slight bonus: proven core movement

  // Compound accessories: 6-week rotation cadence
  const TARGET_CADENCE = exercise.isCompound ? 6 : 3;
  return Math.min(1.0, exposure.weeksAgo / TARGET_CADENCE);
}
```

### R5 (Planned, data migration): Triceps Classification

**Current state:** Pressing compounds (Bench, OHP, Dips, Incline DB) list `Triceps` in `primaryMuscles`. This means each pressing set contributes DIRECT Triceps sets to the beam's C1b ceiling check.

**KB Evidence (§4, Triceps):**
> "MRV ~18 sets/week — lower than biceps due to heavy indirect stimulus from pressing."

The KB's MRV=18 presumes pressing generates *indirect* stimulus, not equivalent to isolation work. In the engine, bench press = 3 direct triceps sets; OHP = 3 direct triceps sets. Two pressing compounds = 6 direct sets. C1b ceiling = 12. Only 6 remain for isolation work.

**Fix:** Move Triceps from `primaryMuscles` → `secondaryMuscles` on all pressing compounds. The 0.3× INDIRECT_SET_MULTIPLIER then correctly models the stimulus. After migration, C1 (triceps isolation cap) can be removed.

**Current workaround:** C1 cap (max 1 triceps isolation after 2+ pressing compounds) is a safe guard. Keep it until data migration completes.

---

## 3. New Findings: Architecture Deep Dive

### F-A: MRV Volume Ceiling Is a High-Threshold Safety Net, Not a Primary Constraint

**Observation (not a bug):**

The `volumeCeiling` in `SelectionConstraints` is set to raw MRV values (`landmarks.mrv`) in `buildSelectionObjective`:
```ts
volumeCeiling.set(muscle as Muscle, landmarks.mrv);  // e.g., Chest = 22
```

The beam's `volumeFilled` starts at 0 and only accumulates volume added *in this session*, not the weekly accumulated `effectiveActual`. The ceiling check therefore means: "this session alone cannot exceed MRV effective sets."

With `maxExercises=8`, a session might contribute at most ~8 exercises × 3 sets × 1 direct effective = 24 effective sets for the most targeted muscle. That can exceed MRV=22 for the most-targeted muscle — so the ceiling does fire for chest-heavy push days in theory.

**But in practice, C1b fires first.** C1b limits direct sets per muscle to 12. For chest (primary muscle of 3-4 exercises), 12 direct sets × 1.0 effective = 12 effective sets — well under MRV=22. The MRV ceiling is never the binding constraint for primary muscles.

**The volume ceiling matters for indirect volume accumulation.** A pull day where triceps accumulates indirect sets: 5 exercises × 0.9 indirect effective triceps (per 3 sets at 0.3×) = 4.5 effective sets. Far under MRV=18. Not a real concern.

**Implication:** The MRV ceiling is a correct but largely redundant constraint given C1b is in place. The architecture is correct. If C1b were ever removed, the MRV ceiling alone would be insufficient at its current calibration. Document this dependency.

**For weekly volume tracking:** The deficit fill scoring correctly uses `effectiveActual` (accumulated weekly volume) to determine what still needs filling. An exercise with `deficit=0` scores 0.0 on deficitFill. The ceiling doesn't need to account for weekly accumulation because scoring already deprioritizes muscles with no deficit.

---

### F-B (Moderate, New): deficitFill Scores Are Static During Beam Expansion

**Finding:** The deficit fill score for each candidate is computed once when building candidates (`buildCandidate`) and never updated during beam expansion. The beam has no awareness that selecting exercise A partially fills a deficit and therefore reduces the marginal value of exercise B targeting the same muscle.

**Contrast with movementDiversity, which IS dynamically re-scored:**
```ts
// beam-search.ts:264–268
const alreadySelected = state.selected.map((c) => c.exercise);
const dynamicNovelty = scoreMovementNovelty(candidate.exercise, objective, alreadySelected);
const noveltyAdjustment =
  objective.weights.movementDiversity *
  (dynamicNovelty - candidate.scores.movementNovelty);
const adjustedScore = candidate.totalScore + noveltyAdjustment;
```

DeficitFill has no equivalent dynamic adjustment.

**Concrete example:** Push day, chest deficit = 8 effective sets.

| Depth | Candidate | Static deficitFill score | Actual remaining deficit |
|-------|-----------|--------------------------|--------------------------|
| 1 | Bench Press (4 direct → 4.0 effective) | 4.0/8 = 0.50 | 8 |
| 2 | Incline DB Press (4 direct → 4.0 effective) | 4.0/8 = 0.50 | 4 (after bench) |
| 3 | Cable Fly (3 direct → 3.0 effective) | 3.0/8 = 0.375 | 0 (after incline) |

At depth 3, the cable fly has a static deficitFill score of 0.375 suggesting it fills 37.5% of the chest deficit. In reality the deficit is 0 and it fills nothing. The fly is over-valued for chest purposes.

**Impact:**
- The beam may select redundant deficit-filling exercises because their scores stay high even after the deficit is met
- For muscles targeted by multiple exercises (chest on push day), the second and third exercises appear more valuable than they are
- This is partially mitigated by:
  - W2 (blocks same isolation pattern + same primary muscle)
  - Movement pattern cap (max 2 exercises per movement pattern)
  - C1b (caps direct sets)
- But for the bench → incline → fly case: bench has HORIZONTAL_PUSH, incline has INCLINE_PUSH (different pattern), fly has HORIZONTAL_PUSH — so movement pattern cap allows all three, C1b might not fire until later, and they all get inflated deficit scores

**Fix — Dynamic Deficit Re-scoring (analogous to dynamic novelty):**
```ts
// In beam expansion loop, alongside movementDiversity re-scoring:
const dynamicDeficitFill = scoreDeficitFillDynamic(
  candidate.volumeContribution,
  objective.volumeContext,
  state.volumeFilled  // Current beam state's accumulated volume
);
const deficitAdjustment =
  objective.weights.volumeDeficitFill *
  (dynamicDeficitFill - candidate.scores.deficitFill);
const adjustedScore = candidate.totalScore + noveltyAdjustment + deficitAdjustment;
```

Where `scoreDeficitFillDynamic` computes deficit relative to `weeklyTarget - effectiveActual - volumeFilled_so_far`.

This would correct the over-valuation of secondary chest exercises and direct the beam toward muscle variety rather than doubling down on already-covered muscles.

---

### F-C (Moderate, New): SRA Context Is Never Populated — Weight Is Dead

**Finding:** In `buildSelectionObjective` (template-session.ts:217–218):
```ts
// Note: SRA scoring has low weight (0.03) and defaults to 1.0 (recovered)
// Future: Populate from actual SRA tracking
const sraContext = new Map<Muscle, number>();
```

The sraContext is always an empty Map. `scoreSRAAlignment` handles this gracefully:
```ts
const readinessScores = primaryMuscles.map((muscle) => sraContext.get(muscle) ?? 1.0);
```

Default is 1.0, so every exercise gets sraAlignment = 1.0. The 0.03 weight contributes a constant `0.03 × 1.0 = 0.03` bonus to *every* exercise equally.

**Impact:**
- The SRA dimension is dead weight — it's a uniform constant that affects no ranking
- The 0.03 effectively becomes +0.03 to all scores (harmless, but wastes weight budget)
- The `SRAContext` type, `sraReadiness` weight, and `scoreSRAAlignment` function are maintained for a feature that isn't running

**KB Evidence (§7):** SRA curves are well-defined per muscle (24-48h for delts/arms, 72-96h for quads/hams). This SHOULD be influential for selection — training quads 24h after a heavy leg day is suboptimal. The 0.03 weight is too low to matter even if SRA were populated.

**Options:**
1. **Keep deferred:** Acceptable given the low weight. The TODO comment is correct.
2. **Remove the weight entirely (0.00) until implemented:** Eliminates confusion. Redistribute 0.03 to other weights.
3. **Actually implement basic SRA:** Derive readiness from last-session-for-this-split date in workout history. A simple "48h since last push session → 1.0, 24h → 0.5, same day → 0.1" heuristic is sufficient for the 0.03 weight.

**Recommendation:** If keeping the weight at 0.03, add a comment that the 0.03 is a placeholder pending SRA implementation, not an active scoring dimension. Alternatively, remove to 0.00 and add 0.01 to userPreference and 0.02 to movementDiversity.

---

### F-D (Minor, New): canAddCandidate in enforceStructuralConstraints Is Incomplete

**Finding:** `canAddCandidate` (beam-search.ts:495–522) is used in `enforceStructuralConstraints` and `trySwapForMainLift` to check whether an exercise can be added post-beam. It only checks two constraints:

```ts
function canAddCandidate(...): boolean {
  // 1. Volume ceiling
  if (exceedsCeiling(newVolumeFilled, objective.constraints.volumeCeiling)) ...
  // 2. Max exercises
  if (beam.selected.length >= objective.constraints.maxExercises) ...
  return true; // Everything else passes
}
```

Missing checks:
- Movement pattern cap (max 2 exercises per pattern)
- C1: Triceps isolation cap
- W2: Isolation duplicate filter (same pattern + same primary muscle)
- W3: Front delt suppression

**Impact:** When `enforceStructuralConstraints` greedily adds exercises to meet `minAccessories=2`, it can add accessories that would have been rejected during beam search. Examples:
- Could add a second triceps isolation after 2+ pressing compounds (violates C1)
- Could add a second lateral raise isolation (violates W2)
- Could add a front delt isolation after OHP (violates W3)

The structural enforcement is a fallback that fires only when beam search failed to meet minimums — an unusual condition. But when it fires, it produces lower quality results than the main beam search.

**Fix:** Refactor the W2/W3/C1 checks in beam-search into a shared `checkQualityConstraints` function called from both the main beam loop and `canAddCandidate`.

---

### F-E (Minor, New): applyStretchUpgrades Has Incorrect volumeFilled Update

**Finding:** In `optimizer.ts:284–292`, when swapping out a displaced exercise and adding the upgrade:
```ts
// Subtract displaced exercise's volume (wrong multiplier):
for (const [muscle, { direct, indirect }] of current.volumeContribution) {
  const prev = newVolumeFilled.get(muscle) ?? 0;
  newVolumeFilled.set(muscle, Math.max(0, prev - (direct + indirect)));  // Bug: indirect not ×0.3
}
// Add upgrade's volume (same wrong multiplier):
for (const [muscle, { direct, indirect }] of bestAlt.volumeContribution) {
  const prev = newVolumeFilled.get(muscle) ?? 0;
  newVolumeFilled.set(muscle, prev + direct + indirect);  // Bug: indirect not ×0.3
}
```

`volumeFilled` stores *effective* volume (via `mergeVolume` which applies `direct + indirect × INDIRECT_SET_MULTIPLIER`). But the upgrade pass removes/adds `direct + indirect` (without the 0.3 multiplier for indirect).

**Impact:** For an isolation exercise with secondary muscles contributing indirect volume (uncommon but valid), the volumeFilled is incorrectly updated. The magnitude of error: if an exercise has 3 indirect sets to a secondary muscle, the wrong update over-subtracts/over-adds by 3 × (1 - 0.3) = 2.1 sets for that muscle.

For most isolations (curls, lateral raises, extensions), secondaryMuscles is empty or minimal, so `indirect=0` and the bug has no effect. But it IS wrong and could affect future exercises added to the library with significant secondary muscle contributions.

**Fix:**
```ts
for (const [muscle, { direct, indirect }] of current.volumeContribution) {
  const effective = direct + indirect * INDIRECT_SET_MULTIPLIER;  // Correct
  newVolumeFilled.set(muscle, Math.max(0, (newVolumeFilled.get(muscle) ?? 0) - effective));
}
```

---

## 4. Scoring System KB Audit (Updated)

| Score | KB Basis | Current Weight | Implementation | Status |
|-------|----------|----------------|----------------|--------|
| Deficit fill | §1: "volume is the strongest modifiable variable" | 0.35 | scoreDeficitFill — static across beam | ⚠️ F-B: not dynamically updated |
| Rotation novelty | §2: "rotate accessories each mesocycle" | 0.22 | scoreRotationNovelty — 3-week cadence ALL exercises | ⚠️ R3: penalizes main lifts (should be fixed) |
| Lengthened bias | §2, §4: Maeo 2023 +40%, Kassiano 2023 +15% | 0.20 | scoreLengthened — lengthPositionScore/5 | ✓ Strongly grounded |
| SFR efficiency | §3: "SFR guides exercise selection" | 0.12 | scoreSFR — sfrScore/5 | ✓ Sound |
| Movement diversity | §2: "non-uniform hypertrophy" | 0.07 | scoreMovementNovelty — dynamic re-scoring ✓ | ✓ Architecturally elegant |
| SRA readiness | §7: SRA curves 24–96h by muscle | 0.03 | Always returns 1.0 (empty context) | ⚠️ F-C: dead weight |
| User preference | UX decision | 0.01 | scoreUserPreference — 1.0/0.5/0.0 | ✓ Appropriate tiebreaker |

**Weight calibration question (lengthenedBias at 0.20):**

The KB evidence for lengthened-position training is strong in untrained subjects but possibly diminishing in trained individuals (Schoenfeld/Nippard 2024: "lengthened partials produced *similar*, not superior, results to full ROM" in trained subjects). At 0.20, lengthenedBias is the third-highest weight and can override SFR signals for exercise selection.

KB uncertainty table (§Areas of Scientific Uncertainty):
> "Lengthened-position training advantage — Emerging/moderate: strong in untrained; may diminish with training experience"

For a training app targeting intermediate lifters, 0.20 may be slightly aggressive. However, the KB's practical rule remains: "prioritize exercises that load muscles at long lengths." The question is whether 0.20 correctly represents the magnitude of benefit vs. 0.12 for SFR.

This is a calibration question, not a correctness bug. The current 0.20 errs on the side of the research finding rather than dismissing it.

---

## 5. Constraint System KB Audit (Updated)

| Constraint | KB Basis | Position | Status |
|-----------|----------|----------|--------|
| Pain conflicts | Medical safety | Pre-beam, hard | ✓ Correct |
| User avoids | User autonomy | Pre-beam, hard | ✓ Correct |
| Volume ceiling (MRV) | §2: MRV thresholds | In-beam, position 2 | ✓ F-A: rarely binding due to C1b |
| Max exercises (8) | Structural | In-beam, position 3 | ✓ Reasonable upper bound |
| Structure (main lifts/accessories) | Session quality | In-beam, position 4 | ✓ Correct |
| Movement pattern cap (2) | §2: "non-uniform hypertrophy" | In-beam, position 5 | ✓ Sound |
| C1: Triceps isolation cap | §4: Triceps MRV=18 (indirect) | In-beam, position 6 | ⚠️ Workaround for R5 data issue |
| **C1b: Per-session direct-set ceiling (12)** | §2: "10-12 hard sets/muscle/session" | In-beam, position 7 | ✓ Correct primary capacity constraint |
| W2: Isolation duplicate | §2: "non-uniform hypertrophy" | In-beam, position 8 | ✓ Sound |
| W3: Front delt suppression | §4: "Front delts MEV=0, most need zero isolation" | In-beam, position 9 | ✓ Correct |

**C1b Ceiling = 12: Correct but universal**

The current `SESSION_DIRECT_SET_CEILING = 12` is a universal hardcoded constant. The KB differentiates recovery by muscle:
- Side/Rear delts: 24-36h SRA, high frequency tolerance → could tolerate up to 12-13 direct sets/session
- Quads/Hamstrings: 72-96h SRA, heavy systemic fatigue → 10 direct sets is ample
- Chest: 48-72h SRA → 10-12 direct sets appropriate

The current 12 is the high end of the recommended range. For legs sessions (quads + hamstrings), 12 direct sets total across both muscles is fine. But 12 direct quad sets alone is above what the KB recommends for high-SRA-demand muscles.

The previous deep dive (R2) proposed per-muscle ceilings. Still unimplemented. The universal 12 is safe but may allow slightly excessive quad/hamstring volume per session.

---

## 6. Beam Search Algorithm Audit

### Beam Width 7 — Sufficient?

With timeBudget removed, the feasible candidate pool at each depth is larger. Previously, ~15 exercises were hard-rejected per depth by time budget; now all ~40 survive. With beam width 7, each depth evaluates 7 × 40 = 280 expansions.

Is width 7 sufficient to find near-optimal combinations? For a push day with ~40 candidates:
- Depth 1: 7 best single-exercise states
- Depth 2: 7 best two-exercise states from 7 × 39 = 273 pairs
- Depth 3-8: increasingly large combinations

Beam search is greedy — width 7 means we keep 7 partial solutions. If the truly optimal combination requires a "sacrifice" at depth 2 (selecting a slightly lower-scoring exercise to unlock a better combination at depth 5), a width-7 beam might miss it.

**KB-grounded assessment:** For typical PPL sessions (3-8 exercises), the search space is manageable. Optimal PPL combinations have clear structural properties (1-3 main lifts, then accessories by deficit). The greedy beam is unlikely to miss optimal combinations because exercise interactions are mostly additive (exercises don't strongly "unlock" each other, except for the dynamic novelty rescoring).

**Empirical observation:** Previous E2E tests with width 5 produced good results except for the timeBudget bug (which has been fixed). Width 7 provides margin without meaningful performance cost (~2-3ms per session). No change needed.

### maxDepth = 8 == maxExercises = 8 — Alignment Is Correct

The beam runs for maxDepth=8 iterations, and maxExercises=8 is the exercise cap. When all beam states hit maxExercises, expansion fails and early-stopping triggers. This is the correct behavior — the beam expands until the session is full. No issue here.

### Structural Enforcement Post-Beam — Greedy Fallback Quality

`enforceStructuralConstraints` is a fallback for when beam search fails to meet `minMainLifts` or `minAccessories`. In a properly functioning beam with correct weights, this should rarely fire — the beam should select the right structure organically.

With R3 (rotation novelty penalizing main lifts) unimplemented, the beam may systematically undervalue main lifts, making `enforceStructuralConstraints` fire more often than intended. **Fixing R3 directly reduces reliance on this fallback.** This is another argument for R3's priority.

---

## 7. Things Working Well — Do Not Change

| Component | KB Grounding | Why Correct |
|-----------|-------------|-------------|
| Volume-deficit-first scoring (0.35) | §1: "volume is the primary hypertrophy variable" | Prioritizing deficit fill is the right primary objective |
| Dynamic movementDiversity re-scoring | §2: "non-uniform hypertrophy" | Beam-state-aware delta adjustment is architecturally correct |
| Lengthened bias scoring (0.20) | §2/§4: Maeo 2023, Kassiano 2023, Pedrosa 2022 | Strong evidence base; practical rule still holds |
| SFR scoring (0.12) | §3: Israetel SFR framework | Sound — exercises that maximize stimulus per fatigue |
| C1b per-session direct-set ceiling (12) | §2: "10-12 hard sets/muscle/session" | Correct primary capacity constraint post-timeBudget removal |
| W2 isolation duplicate filter | §2: "non-uniform hypertrophy" | Correctly prevents redundant stimulus within a session |
| W3 front delt suppression | §4: "Front delts MEV=0" | Pragmatically correct: OHP → suppress direct front delt isolation |
| Movement pattern cap (2) | §2: exercise variation guidance | Structural guardrail against repetitive patterns |
| Indirect volume accounting (×0.30) | §2: "indirect volume already factored in" | Correct scaling of secondary muscle contributions |
| Volume ceiling (MRV-based) | §2: MRV thresholds | Correct; rarely fires due to C1b, which is fine (belt + suspenders) |
| Optimizer pre-sort by lengthPositionScore | §2: lengthened-position advantage | Ensures high-stretch exercises evaluated first in beam |
| applyStretchUpgrades pass | §2: lengthened-position priority | Corrects beam path artifacts for isolation quality |
| Favorites tiebreaker (EPSILON=0.05) | User autonomy | Appropriate — favorites break ties but don't override quality |
| Beam width 7, maxDepth 8 | Algorithmic | Correct for typical PPL session sizes |

---

## 8. Complete Recommendations (All Open Work)

### R3 (Moderate, Outstanding): Fix Rotation Novelty for Main Lifts

**Impact:** Medium-high. Directly affects whether beam search produces correct main lift selection or relies on post-beam greedy enforcement.
**KB:** §2, §3 — "Maintain core movements 2-3 mesocycles; rotate accessories each mesocycle."
**Effort:** Low — 5-line change in scoring.ts.
**ADR:** ADR-076 (drafted in previous analysis).

```ts
// scoring.ts: scoreRotationNovelty
if (exercise.isMainLiftEligible) return 0.75; // Fixed: KB says maintain core movements
const TARGET_CADENCE = exercise.isCompound ? 6 : 3;
return Math.min(1.0, exposure.weeksAgo / TARGET_CADENCE);
```

### R6 (Moderate, New): Dynamic Deficit Fill Re-Scoring

**Impact:** Moderate. Prevents beam from over-selecting exercises that target already-filled muscles.
**KB:** §1 — marginal volume benefit follows a dose-response curve; additional sets after MEV is met have diminishing returns.
**Effort:** Medium — add `scoreDeficitFillDynamic` function, add dynamic adjustment in beam loop alongside existing movementDiversity adjustment.
**ADR:** New — ADR-078.

The fix follows the exact same pattern as the existing dynamic movementDiversity re-scoring (beam-search.ts:264-268):
```ts
// In beam expansion, after dynamicNovelty adjustment:
const dynamicDeficitFill = scoreDeficitFillDynamic(
  candidate.volumeContribution,
  objective.volumeContext,
  state.volumeFilled  // Remaining deficit after current beam state's selections
);
const deficitAdjustment =
  objective.weights.volumeDeficitFill * (dynamicDeficitFill - candidate.scores.deficitFill);
const adjustedScore = candidate.totalScore + noveltyAdjustment + deficitAdjustment;
```

### R7 (Low, New): Resolve SRA Context Placeholder

**Impact:** Low. Currently adds a constant 0.03 to all exercises; not differentiating.
**Options:**
- **Option A (simplest):** Set `sraReadiness: 0` in DEFAULT_SELECTION_WEIGHTS. Redistribute 0.03 to movementDiversity (0.07 → 0.08) and userPreference (0.01 → 0.02). Clean up dead scoring path.
- **Option B (correct fix):** Populate sraContext from workout history. Compute `hoursSinceLastSessionForSplit / recoveryCurveHours[muscle]` clamped 0-1. This makes the 0.03 weight actually do something.
- **Option C (defer, document):** Keep as-is with a clear TODO comment. Accept the constant 0.03 until SRA tracking is built.

**KB:** §7 — SRA recovery curves are well-characterized. Worth implementing eventually; low urgency given 0.03 weight.

### R2 (Low, Outstanding): Per-Muscle Session Direct-Set Ceilings

**Impact:** Low-moderate. Universal 12 is slightly permissive for quads/hamstrings but conservative for delts.
**KB:** §7 — Different SRA recovery times imply different per-session tolerances.
**Effort:** Medium — add `sessionDirectSetCeiling: Map<Muscle, number>` to SelectionConstraints, compute from MRV/frequency in buildSelectionObjective, propagate to beam-search.ts.
**ADR:** ADR-075 (partially drafted).

Proposed defaults:
```ts
Chest:       11  // MRV=22, 2×/wk
Lats:        12  // MRV=25, 2×/wk
Upper Back:  12  // MRV=25, 2×/wk
Side Delts:  10  // MRV=26, high freq — conservative for session quality
Rear Delts:  10  // MRV=26, high freq
Biceps:      12  // MRV=26, 2×/wk (≥cap at 12)
Triceps:      9  // MRV=18, 2×/wk — reflects lower MRV (and data issue until R5)
Quads:       10  // MRV=20, 2×/wk — tighter due to high systemic fatigue
Hamstrings:  10  // MRV=20, 2×/wk
Glutes:       8  // MRV=16, 2×/wk
Calves:       8  // MRV=20, 3-4×/wk — short sessions expected
```

### R8 (Minor, New): Complete canAddCandidate Quality Constraint Checks

**Impact:** Minor. Only fires when beam fails structural constraints, which should be rare with R3 fixed.
**Effort:** Low-medium — refactor W2/W3/C1 checks into shared helper; call from canAddCandidate.
**ADR:** New — ADR-079.

### R9 (Minor, New): Fix applyStretchUpgrades volumeFilled Multiplier Bug

**Impact:** Minor. Only affects isolations with significant indirect muscle contributions.
**Effort:** Trivial — 2-line fix using INDIRECT_SET_MULTIPLIER in the update.
**ADR:** New — ADR-080.

```ts
// optimizer.ts: applyStretchUpgrades — fix both subtract and add
const effective = direct + indirect * INDIRECT_SET_MULTIPLIER;
newVolumeFilled.set(muscle, Math.max(0, (newVolumeFilled.get(muscle) ?? 0) - effective));
```

### R5 (Planned, data migration): Reclassify Triceps in Pressing Compounds

**Impact:** Medium (removes C1 workaround; correctly aligns engine with KB's indirect-stimulus model for triceps).
**Effort:** High — requires data migration on all pressing exercises, seeder update, migration SQL.
**ADR:** R5 from previous analysis.

---

## 9. Implementation Priority

| # | Recommendation | Impact | Effort | Priority |
|---|----------------|--------|--------|----------|
| R3 | Fix rotation novelty cadence for main lifts | Medium-High | Low | **Ship next** |
| R6 | Dynamic deficit fill re-scoring | Moderate | Medium | **Ship with R3** |
| R9 | Fix applyStretchUpgrades volumeFilled multiplier | Minor | Trivial | **Ship with R3 (trivial fix)** |
| R7 | Resolve SRA context placeholder | Low | Trivial | **Ship with R3 (cleanup)** |
| R8 | Complete canAddCandidate constraint checks | Minor | Medium | **Next PR after R3** |
| R2 | Per-muscle session direct-set ceilings | Low-Mod | Medium | **Backlog** |
| R5 | Triceps data reclassification | Medium | High | **Deferred (data migration)** |

**R3 + R6 + R9 + R7 can ship as one PR.** Together they:
1. Fix the main lift recency penalty (R3) — most behaviorally impactful
2. Add dynamic deficit fill scoring (R6) — architecture aligns with existing movementDiversity pattern
3. Fix trivial volumeFilled bug (R9) — 2-line fix
4. Clean up SRA dead weight (R7) — removes dead code path confusion

---

## 10. ADR Proposals

### ADR-078: Dynamic Deficit Fill Re-Scoring in Beam Expansion
Apply deficit fill re-scoring at each beam state (analogous to existing movementDiversity dynamic re-scoring). Prevents systematic over-valuation of exercises targeting muscles already filled by earlier beam selections. KB: §1 dose-response — marginal value of additional sets decreases after deficit is met.

### ADR-079: Complete Quality Constraint Checks in Post-Beam Structural Enforcement
Add movement pattern cap, C1 triceps isolation cap, W2 isolation duplicate, and W3 front delt suppression to `canAddCandidate`. Ensures post-beam greedy enforcement doesn't violate quality constraints that the main beam loop respects.

### ADR-080: Fix Indirect Multiplier in applyStretchUpgrades volumeFilled Update
Use `direct + indirect × INDIRECT_SET_MULTIPLIER` (not `direct + indirect`) when updating volumeFilled during isolation stretch upgrades. Matches the calculation used by `mergeVolume`.

*Note: ADR-075 (R2) and ADR-076 (R3) were drafted in the previous analysis; this document updates their priority and context.*
