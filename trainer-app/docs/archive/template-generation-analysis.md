# Template Session Generation — Domain Analysis & Recommendations

**Date:** 2026-02-10
**Context:** Review of runtime session generation logic (sets, reps, rest, loads, supersets) against the evidence-based hypertrophy/strength knowledge base and exercise database.

---

## Overall Assessment

The generation pipeline is structurally sound — main lift / accessory split, goal-based rep ranges, load progression from history, readiness adjustments. The core issues are calibration (RPE too conservative for hypertrophy, rest floors too low for isolations), missing features (no superset support, no mesocycle periodization in template path), and some rigidity in the back-off and accessory prescription logic.

---

## Dimension-by-Dimension Analysis

### 1. Set Counts — Mostly sound

**Current:** Main lift base 4, accessory base 3. Training age modifiers: advanced ×1.15, intermediate ×1.0, beginner ×0.85. Low readiness and missed-session modifiers of −1 (floor 2).

**Assessment:** ✅ Directionally correct.

- Advanced getting ~5 main / ~3–4 accessory aligns with higher volume needs (16–25+ sets/muscle/week per the knowledge base).
- Beginner getting ~3 main / ~2–3 accessory aligns with 6–10 sets/muscle/week being sufficient.
- Readiness-based reduction is good fatigue management.

**Recommendation:** Consider making the accessory base set count goal-dependent. For hypertrophy, 3 sets per accessory is fine. For strength, 2 sets per accessory may suffice since the priority is heavy compound work. For fat_loss, higher accessory sets (3–4) with shorter rest could increase density.

---

### 2. Rep Ranges — Good, but accessory prescription is too rigid

**Current rep ranges by goal:**

| Goal | Main | Accessory |
|---|---|---|
| Hypertrophy | 6–10 | 10–15 |
| Strength | 3–6 | 6–10 |
| Fat loss | 8–12 | 12–20 |
| Athleticism | 4–8 | 8–12 |
| General health | 8–12 | 10–15 |

**Assessment:** ✅ Ranges themselves are well-calibrated against the literature.

- Hypertrophy mains at 6–10 fall squarely in the time-efficient moderate zone (65–80% 1RM). Accessories at 10–15 align with the light zone for isolations.
- Strength mains at 3–6 align with HL > ML > LL for 1RM gains (Carvalho, 2022).
- The knowledge base recommends ~50% moderate (6–12), ~25% heavy (1–5), ~25% light (12–30+) for combined strength + hypertrophy. The current ranges don't explicitly enable this distribution, but the main/accessory split approximates it.

**Issue:** "All accessory sets use the lower bound of accessory range." For hypertrophy, every accessory set is prescribed at 10 reps. This creates two problems:

1. **No rep spectrum within a session.** The knowledge base says 30–85%+ 1RM all produce similar hypertrophy when taken close to failure. Prescribing some accessories at 12–15+ reps would reduce joint stress and provide variety.
2. **Incompatible with double progression.** Double progression — the recommended intermediate progression method — works by training within a rep range and increasing weight when hitting the top. If you always prescribe the lower bound (10), the user never has a target to progress toward within the range. They should be prescribed the full range (10–15) and progress load when they hit 15 on all sets.

**Recommendation:**
- Prescribe accessories as a **range** (e.g., "10–15") rather than a single number. Display the range to the user so they can apply double progression.
- Alternatively, use the exercise's `repRangeRecommendation` from the database when available, since those are exercise-specific and evidence-calibrated (e.g., leg extensions: 10–20, seated leg curl: 10–20, barbell curl: 8–15).

---

### 3. Back-Off Set Structure — Functional but could be sharper

**Current:** Set 1 (top set) = lower bound of main range. Sets 2+ = top reps + 2, capped by range max. Load: top set gets computed load, back-off sets use `topLoad × backOffMultiplier` (typically 0.85, strength 0.9).

**Assessment:** ⚠️ Works but the +2 rep increment is arbitrary.

- The concept is correct: top set at peak intensity, back-off sets at reduced load / higher reps.
- The load multipliers are reasonable (0.85 = ~85% of top set).
- However, the +2 rep bump is disconnected from the load reduction. If you drop 15% of the load, the actual reps achievable depend on the exercise and the lifter. A fixed +2 may undershoot (leaving reps in reserve) or overshoot (failing before target).

**Recommendation:** Either:
- **(a)** Keep +2 reps as a simple heuristic but make the back-off multiplier slightly more aggressive (0.82–0.85 for hypertrophy, 0.87–0.90 for strength) to ensure those extra reps are achievable at the target RPE.
- **(b)** Prescribe back-off sets as the same rep target as the top set at the reduced load, and let the lifter auto-regulate reps (RPE-based termination). This aligns better with the APRE / RPE-based autoregulation the knowledge base ranks highest for strength development.

---

### 4. Target RPE — Too conservative for hypertrophy

**Current:** Hypertrophy base RPE 7.5 (= ~2.5 RIR). Strength 8.0. Fat loss 7.0. Then adjusted by readiness (−0.5), user overrides, periodization offsets, deload cap (6.0).

**Assessment:** ❌ Hypertrophy RPE is too low.

Robinson et al. (2024) meta-regression: hypertrophy significantly increases as sets approach failure (clear dose-response). Refalo et al. (2024) showed 0 RIR and 1–2 RIR produce similar quad hypertrophy. The knowledge base prescribes:

| Level | Target RIR |
|---|---|
| Beginner | 2–4 RIR (RPE 6–8) |
| Intermediate | 1–3 RIR (RPE 7–9) |
| Advanced | 0–2 RIR (RPE 8–10) |

RPE 7.5 as the base for *all* hypertrophy users means intermediates and advanced trainees are chronically under-stimulated. Most sets should be at RPE 8–9 (1–2 RIR) for experienced lifters.

**Additionally:** The knowledge base prescribes RIR ramping across a mesocycle (Week 1: 3–4 RIR → Final week: 0–1 RIR). A flat RPE 7.5 every session eliminates this progression signal.

**Recommendation:**
- Make base RPE training-age-dependent:
  - Beginner: 7.0 (3 RIR)
  - Intermediate: 8.0 (2 RIR)
  - Advanced: 8.5 (1–2 RIR)
- Differentiate main lifts vs. accessories: accessories (especially isolations) can be pushed harder (RPE +0.5) since form breakdown is less risky and the knowledge base says strategic failure is acceptable on isolation exercises.
- Layer mesocycle RPE ramping on top (if/when periodization is wired into the template path).

---

### 5. Rest Periods — Mostly correct, one problematic floor

**Current rules:**

| Condition | Rest |
|---|---|
| Main lift, reps ≤5, fatigue ≥4 | 300s |
| Main lift, reps ≤5, fatigue <4 | 240s |
| Main lift, reps >5, fatigue ≥4 | 180s |
| Main lift, reps >5, fatigue <4 | 150s |
| Accessory compound, reps ≤8 | 150s |
| Accessory compound, reps >8 | 120s |
| Isolation, fatigue ≥3 | 90s |
| Isolation, fatigue <3 | 60s |

**Assessment:** ⚠️ One issue.

- Heavy main lifts (≤5 reps): 240–300s = 4–5 min. Knowledge base says 3–5 min. ✅
- Moderate main lifts (>5 reps): 150–180s = 2.5–3 min. Knowledge base says 2–3 min. ✅
- Accessory compounds: 120–150s = 2–2.5 min. Reasonable. ✅
- Isolation, fatigue ≥3: 90s. Knowledge base says 1–2 min. ✅
- **Isolation, fatigue <3: 60s.** Singer et al. (2024): resting <60 seconds may compromise hypertrophy. No appreciable differences when resting >90 seconds. 60s is the exact threshold of concern.

**Recommendation:** Raise the isolation floor to 75s (or ideally 90s). The knowledge base is clear: never sacrifice set quality for shorter rest. The time savings of 60s vs. 90s is negligible (~2 min across a workout) but the hypertrophy cost is real.

---

### 6. Load Assignment — Well-designed

**Current:** History-first → baseline → estimated fallback. Main lift top set gets computed load, back-off sets use multiplier. Accessories get uniform load. Warmup sets added to main lifts only.

**Assessment:** ✅ Solid priority chain.

- History-first is the right approach — actual performance data beats estimation.
- Baseline context-awareness (strength prefers `strength` baseline, others prefer `volume`) is a smart distinction.
- Donor baseline inheritance and bodyweight heuristics as fallbacks are reasonable when no direct data exists.

**Recommendation:** No major changes. One minor enhancement: when `computeNextLoad` returns a value from history, consider whether it should apply a small increment (+2.5–5 lbs upper, +5–10 lbs lower for beginners) to implement session-to-session linear progression automatically. The knowledge base prescribes this as "the beginner's engine" and it's sustainable for 6–20 weeks.

---

### 7. Superset Support — Missing, significant gap

**Current:** No `supersetId`, `pairWith`, or `sequenceGroup` in template or workout models. Generated sessions are an ordered list partitioned into mainLifts and accessories.

**Assessment:** ❌ Major missing feature.

Zhang et al. (2025) meta-analysis: agonist-antagonist supersets produce comparable hypertrophy in ~50% of the time. For 60-minute sessions, this is the single biggest lever for fitting more volume. Many of the 20 templates we designed rely on supersets to stay under 60 minutes (Workouts 7, 8, 12, 13, 14, 17).

Without superset support:
- Time estimates will overestimate duration (each exercise gets full rest instead of shared rest).
- Templates designed around supersets will generate suboptimal session structures.
- The time-efficiency advantage of antagonist pairing is completely lost.

**Recommendation:** Add superset grouping to the template model and generation engine. Minimum viable implementation:
- Template model: add `supersetGroup` (nullable integer) to `WorkoutTemplateExercise`.
- Generation: exercises sharing a `supersetGroup` get interleaved sets with reduced between-pair rest (60–90s instead of full rest).
- Duration estimation: superset pairs count as `(sets × set_time × 2) + (sets × superset_rest)` instead of `(sets × set_time + rest) × 2`.

---

### 8. Periodization in Template Path — Missing

**Current:** "Optional periodization `setMultiplier` (not currently passed in template API path)." RPE periodization offsets are available but not wired in.

**Assessment:** ❌ Significant gap for intermediate+ users.

The knowledge base is unambiguous: the standard mesocycle structure ramps volume (+1–2 sets/muscle/week) and intensity (RIR from 3–4 → 0–1) across 4–6 weeks, followed by a deload. Without this, template sessions generate the same prescription every time — no progressive overload signal beyond load increases.

**Recommendation:** Wire `setMultiplier` and RPE offsets into the template generation path. Even a simple implementation helps:
- Week 1: setMultiplier 0.85, RPE offset −1.0
- Week 2–3: setMultiplier 1.0, RPE offset −0.5
- Week 4–5: setMultiplier 1.1, RPE offset 0
- Deload: setMultiplier 0.6, RPE cap 6.0

This directly encodes the mesocycle structure from the knowledge base.

---

### 9. isStrict Flag — Dead code in template path

**Current:** Stored on templates but not passed into the generation function. Flexible substitution is inactive.

**Assessment:** ⚠️ Not a training-science issue per se, but it means templates can't signal whether exercise substitution is allowed. The knowledge base recommends rotating 2–4 exercises per muscle group per mesocycle while maintaining core movements for 2–3 mesocycles. `isStrict` could govern this: strict templates keep all exercises fixed; flexible templates allow accessory rotation.

**Recommendation:** Wire it through. Low effort, meaningful UX improvement.

---

### 10. Timeboxing — Disabled for templates

**Current:** Template path passes `sessionMinutes = undefined`, preserving the full exercise list.

**Assessment:** ⚠️ If a template generates a 75-minute session, it outputs 75 minutes. For users who set up ≤60 min templates, this is a problem.

**Recommendation:** Pass the template's target duration (or a user preference default) as `sessionMinutes`. When the estimated duration exceeds the target, trim the lowest-priority accessories (lowest SFR, or last in order). This is better than silently exceeding the time budget.

---

## Summary Table

| Component | Verdict | Severity | Key Issue |
|---|---|---|---|
| Set counts | ✅ Sound | — | Minor: could be goal-dependent for accessories |
| Rep ranges | ⚠️ Rigid | Moderate | Accessories use lower-bound only; breaks double progression |
| Back-off structure | ⚠️ OK | Low | +2 rep increment is arbitrary |
| Target RPE | ❌ Too low | High | 7.5 base under-stimulates intermediates/advanced for hypertrophy |
| Rest periods | ⚠️ One issue | Moderate | 60s isolation floor is at the threshold of compromising hypertrophy |
| Load assignment | ✅ Solid | — | Minor: could auto-increment for beginners |
| Superset support | ❌ Missing | High | Biggest time-efficiency lever; many templates rely on it |
| Periodization | ❌ Missing | High | No mesocycle RIR/volume ramping in template path |
| isStrict | ⚠️ Dead code | Low | Easy win to wire through |
| Timeboxing | ⚠️ Disabled | Moderate | Sessions can exceed intended duration |

---

## Priority Recommendations (ordered by impact)

1. **Raise hypertrophy RPE to 8.0+ base** and make it training-age-dependent. Highest-impact single change — directly increases per-set stimulus.
2. **Add superset grouping to the template model.** Unlocks ~40–50% time savings on applicable templates.
3. **Wire periodization into the template path.** Enables mesocycle-level progressive overload (the core driver of long-term progress).
4. **Prescribe accessory reps as a range** (or use the exercise database's `repRangeRecommendation`). Enables double progression.
5. **Raise isolation rest floor to 75–90s.** Small change, directly supported by Singer et al. (2024).
6. **Enable timeboxing for templates.** Pass target duration and trim low-priority accessories when exceeded.
7. **Wire isStrict through.** Quick win.
