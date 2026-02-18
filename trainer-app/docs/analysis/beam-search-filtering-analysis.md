# Beam Search & Filtering: Deep-Dive Analysis
**Date:** 2026-02-18
**Scope:** `selection-v2/` module — beam-search.ts, optimizer.ts, candidate.ts, scoring.ts, types.ts

---

## Executive Summary

The current beam search implementation has one foundational architectural problem: **time budget is used as a hard constraint during exercise selection instead of as a display-only metric**. This causes optimal exercises to be silently rejected mid-search, produces confusing set-reduction heuristics, and adds unreliable estimation noise to what should be a quality-driven optimization. The proposal to replace time-budget filtering with a **per-session per-muscle direct-set ceiling** is correct, well-grounded in the KB research, and would simplify the architecture significantly. This document provides the evidence-based case for that change and surfaces four additional findings.

---

## 1. Current Architecture Overview

The optimizer pipeline has three stages:

```
Pool → filterHardConstraints() → buildCandidates() → beamSearch()
```

**Phase 1** (optimizer.ts:113–158) filters pain conflicts and user-avoided exercises — correctly done as a pre-beam hard filter.

**Phase 2** (candidate.ts) scores each exercise on 7 dimensions and estimates `proposedSets` and `timeContribution` for each. Both are fixed at this point and do not change during beam search.

**Phase 3** (beam-search.ts) expands beam states depth-by-depth, enforcing hard constraints at each step. The constraints checked inside the inner loop, in order, are:

| Constraint | Check |
|---|---|
| Already selected | `exercise.id in state.selected` |
| **Time budget** | `state.timeUsed + candidate.timeContribution > timeBudget` |
| Volume ceiling (MRV) | `exceedsCeiling(newVolumeFilled, volumeCeiling)` |
| Max exercises | `state.selected.length >= maxExercises` |
| Structural (main lifts/accessories) | `wouldSatisfyStructure(...)` |
| Movement pattern cap | max 2 exercises per pattern |
| C1: Triceps isolation cap | 1 isolation after 2+ pressing compounds |
| **C1b: Per-session direct-set ceiling** | `12` direct sets per muscle per session |
| W2: Isolation duplicate | same pattern + same primary muscle = blocked |
| W3: Front delt suppression | after OHP, block additional front delt isolations |

There are currently **two** overlapping mechanisms that cap session volume: time budget (position 2) and C1b direct-set ceiling (position 8). The problem is that the time budget check fires first and is far less reliable.

---

## 2. Finding 1 — Time Budget as a Hard Beam Constraint Is Architecturally Wrong

### What the code does

In `beam-search.ts` lines 133–138:

```typescript
const newTimeUsed = state.timeUsed + candidate.timeContribution;
if (newTimeUsed > objective.constraints.timeBudget) {
  rejectedMap.set(candidate.exercise.id, "time_budget_exceeded");
  continue;
}
```

This **permanently rejects** any candidate whose `timeContribution` would push `timeUsed` past the budget — regardless of score, volume deficit, or whether fewer sets would fit. The exercise is gone from that beam branch.

### Why this is wrong

**Problem 1: proposedSets are frozen at candidate-build time.**
In `candidate.ts:189–226`, `computeProposedSets` determines set count once based on volume deficit. During beam expansion, the engine never asks: "what if this exercise used 2 sets instead of 4?" It just rejects.

A high-quality overhead cable extension with 4 proposed sets and 12-minute contribution gets rejected when `timeBudget - timeUsed = 10`. The engine never discovers that 2 sets = 7 minutes would have fit comfortably.

**Problem 2: Time estimation is inherently noisy.**
`estimateExerciseMinutes` (timeboxing.ts) computes:
```
time = (work_per_set + rest_between_sets) × setCount + warmupSets × warmupTime
```
This model assumes fixed rest periods, mid-range target reps, and zero transition time. Real session duration varies by ±10–20 minutes based on rest adherence, equipment availability, warmup approach, and fatigue. Rejecting exercises based on ±10-minute noise violates the principle of not optimizing for things you can't measure accurately.

**Problem 3: First-selected exercises consume most of the budget.**
Main lifts are scored higher on `deficitFill` and go first. They consume ~30–40 minutes (2 main lifts × 4 sets × ~4–5 min/set). This leaves accessories competing for the residual budget, where a good exercise with a slightly-too-high time estimate is rejected while a lower-quality option that fits gets selected. This undermines the multi-objective scoring entirely.

**Problem 4: The bandaid (tryReduceSetsToFitMore) runs too late.**
`tryReduceSetsToFitMore` in `enforceMinExercises` (beam-search.ts:358–421) reduces sets on already-selected accessories to fit new candidates. But this only runs after beam search completes, for the `minExercises` enforcement pass. The main beam loop — which does the actual optimization — never benefits from this mechanism.

**Problem 5: Time budget is enforced in three separate places, inconsistently.**
- Main beam loop: hard reject, no set reduction
- `enforceMinExercises`: hard reject + set reduction fallback
- `canAddCandidate` (used by `enforceStructuralConstraints`): hard reject, no set reduction

Each pass has different behavior. This is fragmented logic with no single clear policy.

### KB grounding

The knowledge base has no evidence that an exercise should be **permanently excluded** because its estimated time contribution exceeds a budget. The KB's time-relevant guidance is:

> *Section 2: "per-session volume should not exceed ~10-12 hard sets for a single muscle group due to diminishing returns."* (Schoenfeld/RP framework)

> *Section 5: "Agonist-antagonist supersets save ~50% time with comparable hypertrophy."* (Zhang et al., 2025)

The KB frames time efficiency as a consequence of exercise selection and structure, not as an input filter that pre-eliminates exercises. Volume (sets per muscle) is the controllable variable — time follows from it.

---

## 3. Finding 2 — Tight Budget Heuristics Create Discontinuous Behavior

In `candidate.ts:196–223`:

```typescript
const TIGHT_BUDGET_THRESHOLD = 40; // Minutes
const TIGHT_BUDGET_ACCESSORY_CAP = 3;

if (isTightBudget && !isMainLift) {
  proposedSets = Math.min(proposedSets, TIGHT_BUDGET_ACCESSORY_CAP);
}
```

Sessions under 40 minutes get all accessories capped at 3 sets. Sessions at 40+ minutes do not. This creates a cliff: a user who sets 40 minutes gets volume-deficit-driven `proposedSets`, while a user who sets 39 minutes gets hard-capped accessories.

**There is no KB evidence for a 40-minute threshold or a 3-set accessory cap as time-reduction strategies.** The KB discusses reducing volume during a caloric deficit (by ~20–33%), not as a function of session length.

More fundamentally, set count should be determined by volume deficit alone. If a muscle is deeply deficient, 4 sets are appropriate regardless of whether the planned session is 39 or 41 minutes. The C1b direct-set ceiling handles the natural upper bound.

---

## 4. Finding 3 — C1b Direct-Set Ceiling Is the Right Primary Constraint, but Needs Tuning

The current C1b constraint (beam-search.ts:204–224) is:

```typescript
const SESSION_DIRECT_SET_CEILING = 12;
```

This is research-backed. KB Section 2:

> *"per-session volume should not exceed ~10-12 hard sets for a single muscle group due to diminishing returns."*

However, the value `12` represents the high end of the recommended range. Evidence-based considerations for tuning:

**Option A: Universal ceiling of 10 (conservative)**
At 10 direct sets, you accommodate: 2 main lifts × 4 sets = 8 sets + 1 accessory × 2 sets = 10. This is appropriate for most intermediate trainees doing PPL.

**Option B: Universal ceiling of 12 (current, permissive)**
Allows: 2 main lifts × 4 sets = 8 + 1 accessory × 4 sets = 12. Or 2 main lifts × 3 sets = 6 + 2 accessories × 3 sets = 12. Fine for advanced trainees.

**Option C: Per-muscle ceiling based on SRA and MRV**
The KB shows different per-session tolerances:
- Side/Rear delts: recover in 24–36h, high MRV (~26/week) → could tolerate more per session
- Quads/Hamstrings: 72–96h recovery, high systemic fatigue → 10 direct sets is ample
- Chest: MEV 8–10, MAV 12–20 → 10–12 per session appropriate

Given the current architecture, **Option B (12) is reasonable as a universal default**, with Option C as a future improvement. The current implementation is correct in concept.

**What C1b naturally provides as a time proxy:**
A push day with chest capped at 12 direct sets typically yields:
- 2 main lifts × 4 sets = 8 direct chest sets (taking ~30–35 min including rests)
- 1 chest accessory × 3–4 sets = 3–4 sets (taking ~8–12 min)
- Shoulder/triceps isolations: not counted toward chest ceiling

Total session time: ~50–65 minutes for a properly structured push day. This is physiologically appropriate and doesn't need an external time-budget enforcer.

---

## 5. Finding 4 — Scoring Weight Normalization Bug

`DEFAULT_SELECTION_WEIGHTS` in `types.ts:392–400`:

```typescript
volumeDeficitFill: 0.40
rotationNovelty: 0.25
sfrEfficiency: 0.15
movementDiversity: 0.15
lengthenedBias: 0.20   // Added in Phase 4
sraReadiness: 0.03
userPreference: 0.02
```

**Sum: 1.20, not 1.0.**

When `lengthenedBias` was added at `0.20`, the weights were not renormalized. Maximum `totalScore` is now 1.2 instead of 1.0. This does not break relative ranking (beam search only compares, never uses absolute thresholds on score), but it does affect:

1. **`BEAM_TIEBREAKER_EPSILON = 0.05`**: At a max score of 1.2, epsilon = 4.2% of max score. At a renormalized max of 1.0, epsilon = 5.0%. The tiebreaker activates less often than intended.
2. **Documentation and reasoning**: Comments throughout the codebase discuss scores as if they're in [0, 1], which is now only true for individual dimension scores, not the weighted total.
3. **Future weight changes**: Anyone adding a new dimension would need to know the implicit "budget" is already over 1.0.

**The lengthenedBias weight is well-justified by KB evidence** (Maeo 2023: +40% triceps growth from overhead extensions; Kassiano 2023: 15.2% vs 3.4% calf growth from lengthened partials; Pedrosa 2022: ~2× quad hypertrophy from lengthened-position leg extensions). The issue is simply renormalization.

**If the intent is `lengthenedBias: 0.20`, then reduce other weights to compensate.** Suggested renormalization:
```
volumeDeficitFill: 0.35  (-0.05)
rotationNovelty:   0.22  (-0.03)
lengthenedBias:    0.20  (keep)
sfrEfficiency:     0.12  (-0.03)
movementDiversity: 0.07  (-0.08)
sraReadiness:      0.03  (keep)
userPreference:    0.01  (-0.01)
Sum: 1.00 ✓
```

Or accept weights > 1.0 as a design choice, but document it explicitly.

---

## 6. Finding 5 — Beam Width May Be Too Narrow After Time Budget Removal

Current `DEFAULT_BEAM_CONFIG = { beamWidth: 5, maxDepth: 8 }`.

With time budget as a hard constraint, many branches terminate early, keeping the search space small. Remove the time budget filter and the branching factor increases — at each depth, more candidates survive the constraint checks. The existing beam width of 5 may not adequately explore this larger space, potentially missing quality combinations.

**Concretely:** If 40 exercises survive to the beam search (after pain/avoid filtering) and the time budget previously rejected ~15 of them at each step, the effective branching factor was ~25. Remove time budget and it's ~40. With 5 beam states, you're now exploring 5 × 40 = 200 expansions per depth vs previous 5 × 25 = 125. This is a 60% increase in candidates, which is still very fast (~3–5ms), so **widening beam to 7–10 is feasible and recommended** for better quality.

---

## 7. KB Evidence Summary for Recommended Changes

| Claim | KB Citation | Status |
|---|---|---|
| Per-session volume should not exceed 10–12 hard sets per muscle | Section 2: Frequency (Schoenfeld/RP framework) | **Strong consensus** |
| Volume (sets) is the primary hypertrophy variable, not time | Section 1: Progressive overload (Pelland 2024, Schoenfeld 2017) | **Strong consensus** |
| 10+ sets/week significantly outperforms fewer sets | Section 1: Dose-response (Schoenfeld et al. 2017) | **Strong consensus** |
| Overhead extensions superior to pushdowns for triceps growth | Section 4: Triceps (Maeo 2023: +40%) | **Strong evidence** |
| Lengthened-position training advantage exists | Section 2: Exercise selection; Section 4: all muscles | **Emerging/moderate** |
| Rest periods >90 seconds preserve hypertrophy; longer = better | Section 2: Rest periods (Singer 2024, Schoenfeld 2016) | **Strong consensus** |
| Exercise rotation every 2–4 exercises per mesocycle | Section 2: Exercise variation | **Standard practice** |
| SFR: high-SFR exercises allow more sustainable volume | Section 3: SFR concept (Israetel) | **Framework-based** |

The proposed replacement — per-session per-muscle direct-set ceiling as the primary constraint — maps directly onto *Section 2: Frequency*'s "~10-12 hard sets per muscle per session" guideline. Time budget doesn't map onto any KB evidence as a selection filter.

---

## 8. What Breaks If Time Budget Is Removed

Before recommending removal, the downstream effects:

| Code Site | Current Role | Post-Removal |
|---|---|---|
| `beam-search.ts:134–138` | Hard reject in beam loop | **Remove** |
| `beam-search.ts:466–490` | Hard reject in enforceMinExercises | **Remove** |
| `beam-search.ts:607–619` | Hard reject in canAddCandidate | **Remove** |
| `beam-search.ts:358–421` | `tryReduceSetsToFitMore` (bandaid) | **Remove entire function** |
| `candidate.ts:196–223` | Tight budget heuristic in computeProposedSets | **Remove TIGHT_BUDGET_THRESHOLD/CAP logic** |
| `beam-search.ts:766` | `withinTimeBudget` in constraintsSatisfied | **Remove from constraint check** |
| `types.ts:SelectionConstraints` | `timeBudget` field | **Keep as input** (used for display) |
| `timeboxing.ts` | `estimateWorkoutMinutes`, `estimateExerciseMinutes` | **Keep for display/UI** |
| `candidate.ts:44,158–177` | `estimateTimeContribution` → `timeContribution` | **Keep on candidate** (for display, not beam constraint) |
| `BeamState.timeUsed` | Accumulated for constraint check | **Keep for display** (just don't enforce) |
| `SelectionResult.timeUsed` | Returned for display | **Keep** |

The `timeBudget` field on `SelectionConstraints` should stay as input because the UI uses it to display estimated session duration. `BeamState.timeUsed` should continue to accumulate — it just shouldn't enforce a hard reject. The final `SelectionResult.timeUsed` remains useful for display.

**The main lifting session UX** — showing the user "estimated 58 minutes" — is not affected. Time estimation continues to run; it just no longer gates exercise selection.

---

## 9. Proposed Constraint Architecture (Post-Refactor)

### Pre-beam hard filters (optimizer.ts)
1. Pain conflicts
2. User avoids

### In-beam hard constraints (beam-search.ts, in priority order)
1. Already selected (skip, no reject entry)
2. **C1b: Per-session per-muscle direct-set ceiling** ← Promoted to primary session constraint
3. Volume ceiling (MRV-based, per muscle, weekly)
4. Max exercises (structural ceiling)
5. Structural: main lifts/accessories balance (wouldSatisfyStructure)
6. Movement pattern cap (max 2 per pattern)
7. C1: Triceps isolation cap
8. W2: Isolation duplicate filter
9. W3: Front delt suppression

### Retained as display-only (no beam enforcement)
- `timeContribution` on candidates → sum to `BeamState.timeUsed`
- `timeUsed` on `SelectionResult` → shown in UI

### Removed entirely
- `timeBudget` enforcement in beam loop
- `tryReduceSetsToFitMore`
- `TIGHT_BUDGET_THRESHOLD` / `TIGHT_BUDGET_ACCESSORY_CAP` in computeProposedSets
- `withinTimeBudget` from `constraintsSatisfied`

---

## 10. Recommendations (Priority Order)

### P1 — Remove time budget as a beam constraint
**Impact:** High. Directly addresses the core issue of optimal exercises being rejected.
**KB backing:** Strong. Volume landmarks (10–12 sets/session per muscle) replace time as the primary per-session control.
**Risk:** Low. The C1b ceiling and MRV ceiling are already in place; removing time budget doesn't open the door to infinite exercises.

### P2 — Remove tight budget heuristics from computeProposedSets
**Impact:** Medium. Eliminates discontinuous behavior at the 40-minute cliff.
**KB backing:** No evidence for time-gated set count reduction.
**Risk:** Low. Set count should be deficit-driven only; C1b handles the ceiling.

### P3 — Remove tryReduceSetsToFitMore
**Impact:** Low-medium. Simplification; this function exists only to compensate for the time budget constraint.
**KB backing:** N/A.
**Risk:** None if P1 is done first.

### P4 — Normalize scoring weights to sum to 1.0
**Impact:** Low-medium. Restores intended epsilon semantics for tiebreaking; makes weight documentation accurate.
**KB backing:** N/A (math bug, not evidence issue).
**Risk:** Low. Relative ordering of most candidates won't change; only tight-score cases near the epsilon boundary may behave differently.

### P5 — Widen beam to 7–10 states
**Impact:** Medium. Better search quality with larger feasible space post-time-budget removal.
**KB backing:** N/A (algorithmic).
**Risk:** Negligible. Already ~2–3ms; 7–10 beam width adds ~1–2ms at most.

### P6 (Future) — Per-muscle direct-set ceilings instead of universal 12
**Impact:** Medium. Would allow delts (high frequency tolerance, 24–36h SRA) to accumulate more per session than quads (72–96h SRA, high systemic fatigue).
**KB backing:** Strong. KB Section 2 (SRA curves) and Section 7 (recovery timecourses) clearly differentiate per-muscle recovery.
**Risk:** Moderate (requires tuning each muscle; regression risk in existing tests).

---

## 11. What to Keep Without Change

The following parts of the beam search and scoring design are correct and evidence-grounded:

| Component | Why It's Correct |
|---|---|
| **Volume-deficit-first scoring (0.40 weight)** | Volume is the primary hypertrophy variable (KB §1, §2). Prioritizing deficit fill is the right primary objective. |
| **Rotation novelty scoring (0.25 weight)** | KB §2: "Rotate 2-4 exercises per mesocycle." The 3-week TARGET_CADENCE matches the research recommendation exactly. |
| **Lengthened bias scoring (0.20 weight)** | KB §2, §4: Maeo 2023, Kassiano 2023, Pedrosa 2022/2023 all confirm lengthened-position advantage. |
| **SFR scoring (0.15 weight)** | KB §3: Israetel's SFR framework — select exercises that maximize stimulus per unit fatigue. |
| **C1 triceps isolation cap** | KB §4: Triceps MRV ~18/week, pressing compounds already provide substantial indirect stimulus. 1 isolation after 2+ pressing compounds is physiologically justified. |
| **W3 front delt suppression** | KB §4: "Front delts: MEV=0, most lifters need zero direct isolation." Confirmed strong. |
| **W2 isolation duplicate filter** | Sound quality rule. Same pattern + same primary muscle = redundant stimulus per KB §2 exercise selection guidance. |
| **Movement pattern cap (2)** | KB §2: "Rotate 2-4 exercises per muscle group per mesocycle." Limiting pattern repetition within a single session is appropriate. |
| **Indirect volume accounting (×0.30)** | KB §2 volume landmarks note: "Indirect volume (e.g., triceps from bench press) is already factored into these estimates." The 0.30 multiplier implements this correctly. |
| **Volume ceiling (MRV-based)** | KB §2: MRV is the hard cap for each muscle. `exceedsCeiling` correctly enforces this. |
| **Dynamic movement novelty re-scoring** | Correct engineering solution — re-scoring based on beam state ensures diversity without pre-scoring bias. |
| **Beam tiebreaker for user favorites** | Appropriate tiebreaker at epsilon threshold. User preference matters but shouldn't dominate quality. |
| **SRA readiness (advisory, 0.03 weight)** | KB §7: SRA curves differ by muscle. Kept at low weight correctly because SRA is advisory, not determinative. |

---

## Conclusion

The architecture of beam search is fundamentally sound. The scoring model is evidence-grounded and the constraint hierarchy is well-reasoned. The single structural flaw is using time budget as a hard gate during exercise selection — a mechanism that substitutes an unreliable proxy (estimated minutes) for the actual physiology-backed constraint (direct sets per muscle per session). The C1b ceiling already implements the correct evidence-based constraint; it just needs to be promoted to the primary role and the time-budget enforcement removed. The result will be a cleaner, more predictable optimizer that selects based on quality metrics rather than discarding good exercises based on estimation noise.
