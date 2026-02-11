# Post-Refactor Analysis: Template Generation, Scoring & Prescription

**Date:** 2026-02-10
**Scope:** Review of three updated system documents against the evidence-based hypertrophy/strength knowledge base:
1. `template-generation.md` — runtime session generation pipeline
2. `template-score-report.md` — template-level and weekly program scoring
3. `template-prescription-assignment.md` — sets, reps, RPE, rest, and load assignment

**Status note (2026-02-10, later):** Follow-up Phase 1 implementation has resolved issue `#1` (exercise-specific rep ranges in template path, including non-overlap demotion to accessory treatment) and issue `#7` (`targetRepRange` persistence via workout-set rep-range columns). Remaining items below are historical findings from the original post-refactor snapshot.

---

## What Was Fixed (from previous recommendations)

All priority items from `template-generation-analysis.md` and `template-score-adjustments.md` landed correctly:

1. **RPE is now training-age-dependent** — beginner 7.0, intermediate 8.0, advanced 8.5, with +0.5 on hypertrophy isolation accessories (Option B). ✅
2. **Superset grouping exists** — `supersetGroup` on template exercise rows, accessory-only, pair timing uses `work(A) + work(B) + max(restA, restB)`. ✅
3. **Periodization is wired in** — `weekInBlock`, `rpeOffset`, `setMultiplier`, `backOffMultiplier`, `isDeload` all flow through the template path. ✅
4. **Accessory rep ranges** — `targetRepRange { min, max }` now included on each accessory set for double progression. ✅
5. **Isolation rest floor raised to 75s.** ✅
6. **Timeboxing enabled** — trims accessories by priority when over budget, preserves main lifts. ✅
7. **isStrict wired through** — substitution logic active when `isStrict === false`. ✅
8. **Template scorer v2** — intent-scoped muscle coverage, intent-specific compound/isolation ranges, exercise order dimension, push/pull gating, normalized lengthened/SFR bonuses. ✅
9. **Weekly program scorer** — muscle coverage (2×/week target), push/pull balance (1:1–2:1 range), movement diversity, volume checks against MEV/MAV/MRV landmarks. ✅

---

## Remaining Issues and Recommendations

### 1. Exercise database rep ranges are ignored in template path

**Severity:** Moderate

**Current behavior:** Template generation passes `exerciseRepRange = undefined`, so sessions use goal ranges directly with no clamp to the exercise's `repRangeRecommendation`.

**Problem:** An exercise like Barbell Back Squat (database rec: 3–8 reps) assigned as an accessory in a fat_loss template would receive 12–20 reps. Heavy barbell squats at 20 reps is a bad prescription — excessive metabolic distress, form breakdown risk, and the knowledge base notes that light loads (20–30+ reps) "require substantially more time and cause greater metabolic discomfort." Conversely, Standing Calf Raise (database rec: 10–20) could get prescribed at 6 reps if classified as a main lift in a strength template, which conflicts with calves' physiology (high slow-twitch proportion, respond best to higher reps).

The exercise database's `repRangeRecommendation` was built with per-exercise biomechanics in mind. Ignoring it wastes that data.

**Recommendation:** Clamp the goal-derived range to the exercise's `repRangeRecommendation` when available. Use the intersection of the two ranges to preserve goal intent while respecting exercise suitability. When ranges don't overlap (e.g., strength goal 3–6 for an exercise with min 10), use the exercise's range and adjust load expectations accordingly. This is especially important for accessories where the database range is often more specific than the broad goal range.

---

### 2. Main lift classification is binary and has no cap

**Severity:** Low-moderate

**Current behavior:** Every exercise with `isMainLiftEligible === true` gets main-lift treatment (4 base sets, top-set + back-off structure, warmup sets). No cap on how many exercises receive this classification per template.

**Problem:** Templates with multiple eligible exercises can produce 3–4 main lifts in a single session. Workout 15 (Posterior Chain) has Conventional Deadlift and Good Morning — both `isMainLiftEligible`. That's 8+ working sets of heavy hinge compounds plus warmups before any accessories. With periodization pushing advanced trainees to ~5 sets per main lift, two main lifts is 10 working sets plus 4–6 warmup sets — potentially 30+ minutes on main lifts alone.

The knowledge base is clear: per-session volume should not exceed ~10–12 hard sets for a single muscle group due to diminishing returns (Schoenfeld et al., 2016 on frequency). Two heavy hinge main lifts in one session may push past this for hamstrings/glutes/lower back.

**Recommendation:** Cap main lift slots at 1–2 per template. If a template has 3+ eligible exercises, classify only the first 1–2 by `orderIndex` as main lifts and demote the rest to accessory prescription. Alternatively, add a `mainLiftSlots` field to the template model (default 1–2) so the template creator controls this explicitly.

---

### 3. Back-off logic has a discontinuity at the 0.9 multiplier threshold

**Severity:** Low

**Current behavior:** If `backOffMultiplier >= 0.9`, back-off reps equal top-set reps. If `< 0.9`, back-off reps equal `topSet + 2`, capped by range max.

**Problem:** This creates a cliff: at multiplier 0.90, the lifter gets the same reps at 90% load (hard). At 0.89, they get +2 reps at 89% load (significantly easier). A 1% load difference shouldn't flip the rep prescription.

**Recommendation:** Either smooth the transition (interpolate the rep bump based on multiplier distance from 1.0) or always use top-set reps for back-off sets and let RPE auto-regulate the actual reps achieved. The latter is simpler and aligns with the APRE/RPE autoregulation philosophy the knowledge base ranks highest for strength development.

---

### 4. Readiness adjustments stack aggressively

**Severity:** Low-moderate

**Current behavior:** Low readiness (≤2) subtracts 1 set. Missed last session subtracts 1 set. Both apply independently with a floor of 2. Low readiness also subtracts −0.5 RPE.

**Problem:** When both conditions are true, a beginner on hypertrophy (base 3 sets after age modifier rounding) drops to 3 → 2 → floor 2 sets at RPE 6.5 (~3.5 RIR). Two sets at RPE 6.5 is below MEV for most muscle groups — it's functionally a deload but isn't flagged as one.

Missed last session and low readiness are also correlated (people who miss sessions often report low readiness the next time), so the double penalty fires frequently on the users who need volume management most.

**Recommendation:** Make these adjustments non-stacking. Apply `max(readinessReduction, missedReduction)` instead of summing them. Total reduction capped at −1 set. If both conditions are true simultaneously, that's a signal to suggest a deload rather than silently gutting the session.

---

### 5. Weekly volume scorer indirect set multiplier may double-count

**Severity:** Moderate

**Current behavior:** Weekly volume calculation uses `effectiveSets = directSets + 0.5 × indirectSets`.

**Problem:** The knowledge base states that RP's volume landmarks (MEV, MAV, MRV) already factor in indirect volume. For example, triceps MRV of ~18 already accounts for pressing compound contributions. If a user does 10 direct triceps sets + 12 bench/OHP sets (which hit triceps as secondary), the scorer sees `10 + 6 = 16 effective sets`. But the landmarks already assumed those 12 pressing sets were contributing — so the indirect volume is partially double-counted.

The knowledge base specifically notes: front delts MEV is 0 because they get "massive indirect volume from all pressing," and triceps MRV is lower than biceps "because pressing compounds already stress them substantially." The landmarks priced this in.

**Recommendation:** Two options:
- **(a)** Reduce the indirect multiplier globally to 0.3 to partially account for the overlap.
- **(b)** Use muscle-specific multipliers — muscles that RP explicitly says get heavy indirect work (triceps from pressing, front delts from pressing, biceps from pulling) should use a lower indirect multiplier (~0.25), while muscles with less indirect overlap (quads, hamstrings, calves) can stay at 0.5.

---

### 6. Superset rest model could be tighter

**Severity:** Minor

**Current behavior:** Pair round timing uses `work(A) + work(B) + max(restA, restB)`. If exercise A is an accessory compound (120s rest) and exercise B is an isolation (75s rest), the pair gets 120s shared rest.

**Problem:** The entire point of supersetting is that exercise A recovers while exercise B works. The shared rest period should be shorter than either exercise's standalone rest because recovery happens during the partner exercise's work time. The knowledge base prescribes 45–120 sec between superset exercises.

**Recommendation:** Use `max(restA, restB) × 0.6` or a flat 60–90s for superset inter-pair rest. Zhang et al. (2025) showed comparable hypertrophy with the reduced rest inherent to supersets — the recovery during the antagonist's set is sufficient.

---

### 7. `targetRepRange` not persisted to DB

**Severity:** Moderate

**Current behavior:** The generation payload includes `targetRepRange { min, max }` on accessory sets, but the save path drops it because `WorkoutSet` has no rep-range columns.

**Problem:** Double progression requires the user to know the range ceiling. If a user reopens a saved workout to review or log against it, they see only `targetReps = 10` instead of `10–15`. They don't know "15" is the target to progress toward. The feature exists in the generation payload but is lost on save, breaking the feedback loop.

**Recommendation:** Prioritize the schema migration to add `targetRepMin` and `targetRepMax` columns to `WorkoutSet`. Without this, double progression is invisible to the user after the initial generation.

---

### 8. Template scorer: Exercise Order dimension needs nuance

**Severity:** Minor

**Current behavior:** The order dimension penalizes upward `fatigueCost` transitions. Best score when fatigue cost trends downward through the session.

**Issues:**
1. **Goal sensitivity:** Nunes et al. (2021) found exercises performed first yield greater *strength* gains (ES = 0.32), while *hypertrophy is unaffected by order* (ES = 0.03). Exercise order matters more for strength-focused templates than hypertrophy.
2. **Main-lift priority not checked:** A template that puts lateral raises (fatigue: 2) before bench press (fatigue: 4) would score well on descending-fatigue but poorly from a training-priority standpoint. The principle is "compounds first when fresh," not just "high fatigue first."

**Recommendation:**
- Weight the Exercise Order dimension higher for strength-intent templates and lower for hypertrophy-intent.
- Add a secondary soft check: `isMainLiftEligible` exercises should appear before non-eligible ones in the order. This captures the "compounds first when fresh" principle. Some templates intentionally pre-exhaust, so this should be a partial penalty rather than a hard failure.

---

### 9. Weekly scorer: frequency target of 2× is flat across all muscles

**Severity:** Minor

**Current behavior:** Weekly muscle coverage gives full credit (1.0) at ≥2 sessions/week per critical muscle.

**Problem:** The knowledge base shows different optimal frequencies by muscle size:

| Muscle Category | Examples | SRA Recovery | Optimal Frequency |
|---|---|---|---|
| Small muscles | Biceps, triceps, calves, side/rear delts | 24–48h | 3–4×/week |
| Medium muscles | Chest, front delts, upper back/lats | 48–72h | 2–3×/week |
| Large muscles (heavy compounds) | Quads, hamstrings, glutes | 72–96h+ | 1.5–2×/week |

A flat 2× target means hitting calves 2×/week scores perfectly, but the evidence suggests 3–4× is meaningfully better for small muscles. Conversely, 2×/week with heavy squats is already at the practical ceiling for quads in most intermediates.

**Recommendation:** Not critical for current version. Future enhancement: use muscle-specific frequency targets from the SRA table. For now, 2× is a safe floor — it's never wrong, just not maximally precise for small muscles.

---

## Summary Table

| # | Issue | Severity | Key Recommendation |
|---|---|---|---|
| 1 | Exercise rep ranges ignored in template path | Moderate | Clamp goal range to exercise `repRangeRecommendation` |
| 2 | No main lift slot cap | Low-moderate | Limit to 1–2 main lifts; demote extras to accessory |
| 3 | Back-off rep discontinuity at 0.9 multiplier | Low | Smooth threshold or always use top-set reps |
| 4 | Readiness + missed session penalties stack | Low-moderate | Non-stacking: `max()` not sum; cap at −1 set |
| 5 | Weekly indirect volume 0.5× may double-count | Moderate | Lower to 0.3 or use muscle-specific multipliers |
| 6 | Superset rest uses `max()` instead of reduced | Minor | Use `max() × 0.6` or flat 60–90s |
| 7 | `targetRepRange` not persisted | Moderate | Prioritize schema migration for double progression |
| 8 | Exercise Order lacks goal weighting | Minor | Weight higher for strength; soft-check main-eligible-first |
| 9 | Weekly frequency target flat at 2× | Minor | Future: muscle-specific targets from SRA data |

---

## Overall Assessment

The refactored system is substantially improved. The template scorer's intent-scoping, the weekly program scorer, periodization wiring, training-age RPE model, superset support, and double-progression range metadata all represent meaningful advances grounded in the evidence base. The remaining items above are calibration refinements and edge cases — not structural problems. Issues #1, #5, and #7 are the highest-priority next actions.
