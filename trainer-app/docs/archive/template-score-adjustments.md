# Template Scoring Logic — Analysis & Recommended Adjustments

**Date:** 2026-02-10
**Context:** Review of template scoring system against evidence-based hypertrophy/strength training principles. Scoring rules evaluated against the knowledge base and exercise database.

---

## Core Problem

**The scorer implicitly assumes every template should be a full-body workout.** Three of six dimensions (Muscle Coverage, Push/Pull Balance, Movement Pattern Diversity) comprising 60% of total weight systematically penalize split-based training. This is how most intermediate+ trainees structure programs.

Evidence: Schoenfeld et al. (2019) showed frequency doesn't independently affect hypertrophy when volume is equated. A PPL split where push muscles are trained 2×/week is equally effective to full-body 3×/week. The scorer can't see this because it evaluates templates in isolation.

**Result:** The best possible push, pull, leg, or arm day will never score above ~55. Full-body templates (Workouts 9–11) scored 77–79 while equally well-designed split sessions scored 49–54. That gap doesn't reflect training quality — it reflects a measurement flaw.

---

## Dimension-by-Dimension Analysis

### 1. Muscle Coverage (weight: 0.30) — Fundamentally broken for splits

**Problem:** A "Push A: Chest Emphasis" template scores 27/100 because it misses biceps, lats, quads, hamstrings, calves, rear delts, and upper back. It's *supposed to* miss those — that's the entire point of a push day. This dimension alone accounts for 30% of the overall score and guarantees any non-full-body template lands in "Needs Work" or "Poor."

**Verdict:** ❌ Broken for split templates. Sound for full-body only.

**Fix options:**
- **(a) Intent-scoped evaluation.** Introduce a `splitTag`/`intent` field on the template. Only evaluate muscle coverage within the relevant scope (push template → grade push muscles only).
- **(b) Move to weekly level.** Remove or heavily downweight this dimension at the template level. Shift evaluation to a weekly program scorer that checks coverage across all templates in a rotation.
- **(c) Expected muscle sets per split type.** Define which muscles are expected for each split type and grade against those expectations instead of all 18 muscles.

---

### 2. Push/Pull Balance (weight: 0.15) — Same structural problem

**Problem:** A push day scores 0/100. A pull day scores 0/100. A legs day gets a neutral 75. The 75 workaround for legs shows the scorer already knows this dimension doesn't apply to all templates — but it doesn't extend that logic to push or pull days. This dimension is meaningful only for full-body and upper-body sessions.

The knowledge base prescribes 1:1 or 2:1 pull:push as the ideal ratio — but this is a *weekly* prescription, not a per-session one.

**Verdict:** ❌ Broken for push-only and pull-only templates.

**Fix:** Gate this dimension behind template intent. For push-only or pull-only templates, either skip this dimension entirely (redistribute its weight to other dimensions) or apply the same neutral 75 that legs currently receive.

---

### 3. Compound/Isolation Ratio (weight: 0.15) — Sweet spot too narrow

**Problem:** The 40–60% compound range scoring 100 with linear dropoff to 0 at extremes is too aggressive.
- Arm day (Workout 13): 14% compound → scores 35. But arm days *should* be isolation-heavy — that's the nature of biceps/triceps training.
- Posterior chain day (Workout 15): 80% compound → scores 50. But hip hinges, back extensions, and good mornings are the *correct* exercise choices for that goal.

The literature doesn't support a single ideal compound:isolation ratio. RP's SFR framework argues for more isolation work at higher training experience. The knowledge base says "compounds as foundation, isolations to fill gaps" — the ratio naturally shifts by what you're training.

**Verdict:** ⚠️ Partially sound logic, but too rigid.

**Fix options:**
- **(a) Widen sweet spot.** 25–75% compound → 100, with gentler linear falloff outside that range.
- **(b) Context-dependent.** Leg/posterior chain templates tolerate higher compound ratios; arm/delt specialization templates tolerate higher isolation ratios. Map expected ranges per template intent.

---

### 4. Movement Pattern Diversity (weight: 0.15) — Expects 8 patterns per session

**Problem:** The scorer measures coverage against 8 core patterns (horizontal push/pull, vertical push/pull, squat, hinge, lunge, carry). An arm day covers 1/8 → scores 13. A quad day covers 1/8 → scores 13. An arm day *cannot* include squats, hinges, or carries and still be an arm day.

Even for full-body sessions, expecting all 8 patterns in a single 60-minute session is unrealistic. Workout 9 (a well-designed full-body session) hits 3/8 → scores 38/100.

**Verdict:** ❌ Broken for split templates; unrealistic even for full-body.

**Fix options:**
- **(a) Reduce denominator by template type.** For a push template, relevant patterns = horizontal_push, vertical_push. Hitting both = high score.
- **(b) Lower expectation for single sessions.** 3–4 patterns is excellent for a focused session. Score 100 at 4+ for focused templates, 5+ for full-body.
- **(c) Move to weekly program level.** Pattern diversity across a rotation is what matters, not per session.

---

### 5. Lengthened-Position Coverage (weight: 0.10) — Sound, minor calibration issue

**Verdict:** ✅ Best-designed dimension. Evidence strongly supports prioritizing lengthened-position training (Pedrosa 2022, Maeo 2023, Kassiano 2023). Mapping avg scores 1–5 → 0–100 is clean.

**Minor issue:** The +10 per exercise with score ≥4 and −5 per exercise with score ≤2 creates exercise-count inflation. A 6-exercise template with all 4s gets +60 bonus vs. a 4-exercise template with all 5s getting +40. The base average correctly favors the 5s, but the bonus inflates the 6-exercise version.

**Fix:** Normalize the bonus by exercise count (e.g., `+10 × (proportion of exercises ≥4)`) or cap the total bonus at a fixed value (e.g., +25 max).

---

### 6. SFR Efficiency (weight: 0.15) — Sound, minor calibration issue

**Verdict:** ✅ Logically sound — higher SFR exercises allow more sustainable volume (Israetel's SFR framework).

**Issues:**
1. Same per-exercise bonus problem as lengthened-position: exercise count inflates scores.
2. Heavy compounds like back squats (SFR: 2) and deadlifts (SFR: 2) are irreplaceable foundational movements. A template that includes them correctly should not be penalized. The ≤2 penalty effectively punishes templates for including the most important strength-building exercises.

**Fix options:**
- Normalize bonuses by exercise count (same as lengthened-position fix).
- Remove the ≤2 penalty entirely (low-SFR compounds are a feature, not a bug), OR only apply the penalty to isolation exercises with SFR ≤2 (which would genuinely indicate a poor choice).

---

## Summary Table

| Dimension | Weight | Verdict | Issue | Severity |
|---|---|---|---|---|
| Muscle Coverage | 0.30 | ❌ Broken | Penalizes all non-full-body templates | Critical |
| Push/Pull Balance | 0.15 | ❌ Broken | Push-only and pull-only always score 0 | Critical |
| Compound/Isolation Ratio | 0.15 | ⚠️ Too rigid | 40–60% sweet spot too narrow for varied template types | Moderate |
| Movement Pattern Diversity | 0.15 | ❌ Broken | Expects 8 patterns per session; impossible for splits | Critical |
| Lengthened-Position Coverage | 0.10 | ✅ Sound | Exercise-count bonus inflation | Minor |
| SFR Efficiency | 0.15 | ✅ Sound | Exercise-count bonus inflation; penalizes heavy compounds | Minor |

---

## Recommended Architecture Change

The most impactful fix is introducing **template intent** and shifting certain evaluations to the **weekly program level**.

### Template-Level Changes

1. **Add a `category`/`intent` field** to each template: `full_body`, `push`, `pull`, `legs`, `upper`, `lower`, `arms`, `posterior_chain`, `glute_specialization`, etc.
2. **Scope dimensions by intent:**
   - Muscle Coverage → only evaluate muscles relevant to the template's intent.
   - Push/Pull Balance → skip or neutralize for single-direction templates.
   - Movement Pattern Diversity → reduce the expected pattern set per intent type.
   - Compound/Isolation Ratio → adjust expected range per intent type.
3. **Normalize bonuses** in Lengthened-Position and SFR by exercise count or cap them.
4. **Remove the SFR ≤2 penalty for compound exercises** (or gate it to isolations only).

### Add a Weekly Program Scorer

Evaluate the following across all templates in a weekly rotation:
- **Weekly muscle coverage:** Every critical muscle hit ≥2×/week with adequate set counts.
- **Weekly push/pull balance:** 1:1 or 2:1 pull:push across the full week.
- **Weekly movement pattern diversity:** All 8 core patterns covered across the rotation.
- **Weekly volume per muscle group:** Check against MEV/MAV/MRV landmarks from the knowledge base.

This separation lets the template scorer evaluate *session quality* (exercise selection, SFR, lengthened bias, appropriate compound/isolation mix for the session's purpose) while the program scorer evaluates *weekly programming quality* (coverage, balance, volume distribution).

---

## Addendum: Implications from Template Generation Engine Review

The generation engine (see `template-generation-analysis.md`) reveals that templates store **only ordered exercise IDs** — sets, reps, rest, loads, and superset pairing are all generated at runtime. This has direct implications for what the template scorer should and should not evaluate.

### What the template controls (and the scorer should evaluate)

- **Exercise selection quality** — already covered by Lengthened-Position, SFR, and Compound/Isolation dimensions.
- **Exercise ordering** — the template's `orderIndex` determines which exercises the engine classifies as main lifts (first) vs. accessories (later). High-fatigue compounds placed first is a best practice (Israetel's SFR framework: front-load high-fatigue compounds when fresh). **Consider adding an Exercise Order dimension** that checks whether `fatigueCost` generally decreases across the ordered list.
- **Exercise count relative to time budget** — since timeboxing is currently disabled in the template path, a template with 8 exercises will generate a longer session than one with 5. The scorer could flag templates where estimated duration (based on exercise count × average set time) exceeds a target.

### What the template does NOT control (scorer should not penalize)

- **Set counts** — generated at runtime based on training age and readiness. The Compound/Isolation Ratio dimension is fine because it evaluates exercise *selection*, but the scorer should not try to infer volume.
- **Rep ranges** — determined by user goal at runtime.
- **Rest periods** — determined by exercise properties and goal at runtime.
- **Superset pairing** — not yet supported in the engine. Once superset grouping is added to the template model, the scorer could add a **Superset Efficiency** dimension evaluating whether antagonist pairs are correctly grouped.

### Compound/Isolation Ratio interacts with the engine

The engine treats `isMainLiftEligible` exercises differently: more sets (4 base vs. 3), top-set + back-off structure, warmup sets. This means the Compound/Isolation Ratio doesn't just reflect exercise selection quality — it directly affects the runtime prescription. A template with 80% compounds will generate more total sets and longer sessions than one with 40% compounds, even with the same exercise count. This reinforces the recommendation to make the ratio's sweet spot context-dependent rather than a fixed 40–60%.
