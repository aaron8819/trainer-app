# Intent Workout Generation — KB Consistency Audit

**Date:** 2026-02-18
**Auditor:** Claude (Sonnet 4.6)
**Scope:** `POST /api/workouts/generate-from-intent` full pipeline
**KB source:** `docs/knowledgebase/hypertrophyandstrengthtraining_researchreport.md`
**Spec source:** `docs/template/exercise-selection-algorithm-spec.md`

---

## Pipeline traced

```
generate-from-intent/route.ts
  → generateSessionFromIntent (src/lib/api/template-session.ts)
    → loadMappedGenerationContext
    → buildSelectionObjective          ← volume targets set here
    → selectExercisesOptimized         ← beam search + scoring
       → filterHardConstraints
       → buildCandidate (computeProposedSets + scoring)
       → beamSearch                    ← hard caps enforced here
       → applyStretchUpgrades
    → generateWorkoutFromTemplate      ← prescription applied
    → applyLoads
  → applyAutoregulation
```

---

## ✅ Aligned with KB

| Topic | KB Citation | Implementation | Location |
|---|---|---|---|
| Volume landmarks (MEV/MAV/MRV) | §2 tables | Values match KB within documented ranges | `volume-landmarks.ts` |
| Session per-muscle cap ≤12 sets | §2 "~10–12 hard sets per session" | `SESSION_DIRECT_SET_CEILING = 12` | `beam-search.ts:198` |
| Triceps MRV = 18 | §4 "lower due to pressing compounds" | `VOLUME_LANDMARKS.Triceps.mrv = 18` | `volume-landmarks.ts:20` |
| Triceps SRA = 48h | §7 "SRA ~48–72h" — pressing extends recovery | `sraHours: 48` (was 36h, corrected) | `volume-landmarks.ts:20` |
| Front delt suppression | §4 "most lifters need zero direct isolation" | W3 rule blocks front delt work when OHP present | `beam-search.ts:243` |
| RIR progression across mesocycle | §1 Week 1 3–4 RIR → final week 0–1 RIR | `TRAINING_AGE_RPE_OFFSETS` + base RPE by training age | `rules.ts:33–40` |
| Beginner 2–4 RIR, intermediate 1–3, advanced 0–2 | §1 table | Base RPE: beginner 7.0 / intermediate 8.0 / advanced 8.5 | `rules.ts:27–31` |
| Deload volume = 50% | §3 "40–60% volume reduction" | `setMultiplier: 0.5` | `rules.ts:117` |
| Deload RPE cap (4–6 RIR) | §3 deload week | `DELOAD_RPE_CAP = 6.0` | `rules.ts:42` |
| Reactive deload triggers | §3 "5+ consecutive without progress" | `plateauSessions: 5`, `consecutiveLowReadiness: 4` | `rules.ts:156` |
| Lengthened-position bias | §4 Maeo 2023: +40% overhead triceps | `lengthenedBias: 0.20` + `applyStretchUpgrades` | `types.ts:381`, `optimizer.ts:93` |
| Rotation cadence | §2 "maintain core 2–3 mesocycles; rotate accessories" | Main lifts: fixed 0.75; compounds: 6-wk; isolations: 3-wk | `scoring.ts:88` |
| Max 2 exercises per movement pattern | §2 variation + anti-redundancy | Hard cap in beam expansion | `beam-search.ts:152` |
| Hypertrophy rep range 6–12 | §2 "moderate loads" | `hypertrophy: { main: [6,10], accessory: [10,15] }` | `rules.ts:12` |
| Strength rep range 3–6 | §2 §6 | `strength: { main: [3,6], accessory: [6,10] }` | `rules.ts:13` |
| Accessory rest 90s (1.5 min) | §2 "isolation 1–2 min" | `REST_SECONDS.accessory = 90` | `prescription.ts:18` |
| SFR framework | §3 Israetel SFR | `sfrEfficiency` weight + `scoreSFR` | `scoring.ts:127` |
| Indirect volume at 0.3× | §2 indirect effects | `INDIRECT_SET_MULTIPLIER = 0.3` | `volume-constants.ts` |
| Per-triceps isolation cap | §4 triceps indirect from pressing | C1: max 1 isolation when ≥2 pressing compounds | `beam-search.ts:165` |

---

## ❌ Gaps and Inconsistencies

### G1 — 🔴 HIGH — Volume target is always MEV; no mesocycle progression ramp

**KB (§3):** "Volume ramps ~10–20% per week, adding 1–2 sets/muscle/week across a mesocycle."
**Conclusion:** "Start at MEV, progress volume by 1–2 sets/muscle/week across a mesocycle."
**Spec (§8.2):** `target = getTargetVolume(landmark, weekInBlock, mesocycleLength)` — a progressive function.

**Code (`template-session.ts:174–178`):**
```ts
weeklyTarget.set(muscle as Muscle, landmarks.mev);  // always MEV, no ramp
```

`weekInBlock` and `mesocycleLength` are available in `mapped` but not passed into volume target computation. Selection optimizer's deficit-fill score never drives volume above MEV. In Week 3 of accumulation where KB targets MAV (~16 sets for chest), the engine still only targets MEV (10 sets). Volume progressive overload is absent in intent mode.

**Fix:** Implement `getTargetVolume(landmark, weekInBlock, mesocycleLength)` that interpolates from MEV toward MAV across accumulation weeks, plateaus at MAV during intensification, and drops to ~MEV×0.6 for deload. Pass `weekInBlock` and `mesocycleLength` into `buildSelectionObjective`.

---

### G2 — 🟡 MEDIUM — Set count max not adjusted by training age

**KB (§8):** Volume needs differ substantially: beginner 6–10 sets/week, advanced 16–25+ sets/week. Per-session set maxes should reflect this.
**Spec (§8.2):** "Clamp per-exercise sets by training age: beginner max 4, intermediate max 5, advanced max 6."

**Code (`candidate.ts:153–154`):**
```ts
const MAX_SETS = 5;  // flat — training age not consulted
```

`buildSelectionObjective` doesn't pass `trainingAge` into `SelectionObjective` at all. A beginner can receive 5-set accessory prescriptions; KB caps beginners lower to build tissue tolerance progressively.

**Fix:** Add `trainingAge` to `SelectionObjective` (or `SelectionConstraints`). In `computeProposedSets`, apply: `const MAX_SETS = trainingAge === "beginner" ? 4 : trainingAge === "advanced" ? 6 : 5`.

---

### G3 — 🟡 MEDIUM — Fat loss volume reduction (0.75×) bypassed in intent mode

**KB (§8):** "During a caloric deficit: Reduce volume by ~20–33%."
**Template mode:** `resolveSetCount` calls `getGoalSetMultiplier(fat_loss)` → 0.75.
**Intent mode (`template-session.ts:423`):**
```ts
setCountOverrides: selection.perExerciseSetTargets,
// bypasses resolveSetCount → getGoalSetMultiplier never called
```

`computeProposedSets` doesn't receive the user's goal. Fat loss users get identical set counts to hypertrophy users in intent mode.

**Fix:** Pass `primaryGoal` into `buildSelectionObjective`; apply `getGoalSetMultiplier(goal)` as a multiplier to `computeProposedSets` max before returning.

---

### G4 — 🟡 MEDIUM — Main lift rest period below KB recommendation for strength goal

**KB (§2 table):** Heavy compounds (1–5 reps): **3–5 minutes** rest. Moderate compounds (6–12 reps): 2–3 minutes.

**Code (`prescription.ts:17–20`):**
```ts
REST_SECONDS = {
  main: 150,      // 2.5 min — below 3–5 min KB target for heavy strength compounds
  accessory: 90,  // ✅ matches KB for isolations
};
```

For `strength` goal (main lift range 3–6), 2.5 min rest is below KB's phosphocreatine recovery threshold. No goal- or rep-range-based rest adjustment is implemented.

**Fix:** In `prescribeMainLiftSets`, increase rest to 180–210s when goal is `strength` and rep range max ≤ 6. Alternatively, key `REST_SECONDS.main` on `isHeavy = goalRepRange.max <= 6`.

---

### G5 — 🟡 MEDIUM — Indirect volume double-counted against KB landmarks

**KB (§2, note after table):** *"Indirect volume (e.g., triceps from bench press) is already factored into these estimates."* Landmarks are calibrated as direct-set thresholds.

**Code:** `effectiveActual = weeklyDirect + weeklyIndirect × 0.3`, compared against MEV/MRV. The `scoreDeficitFill` always uses effective volume (`scoring.ts:58`), regardless of `USE_EFFECTIVE_VOLUME_CAPS`.

If KB landmarks already bake in indirect stimulus, adding 0.3× indirect on top inflates effective volume, making MRV ceilings fire earlier than intended and making deficits appear smaller than they are.

**Example:** Triceps MRV = 18 (calibrated assuming bench press indirect). If 3 bench sets contribute 0.9 indirect effective sets to triceps tracking, the engine thinks triceps has 0.9 "sets" before any direct work — slightly shrinking the window for direct triceps work.

**Fix / Investigation needed:** Decide whether landmarks are direct-only (then effective volume scoring is correct) or include indirect (then scoring should use direct-only for deficit/ceiling checks). Add a comment in `volume-landmarks.ts` documenting the chosen interpretation. Israetel's published tables appear to be direct-only thresholds that assume some baseline indirect stimulus — the 0.3× indirect in scoring is likely a reasonable approximation that doesn't need to change, but this should be explicitly documented.

---

### G6 — 🟢 LOW — SRA context always empty; sraReadiness weight = 0.00

**KB (§7):** Extensive SRA curves: small muscles 24–48h, medium 48–72h, large 72–96h+. Targeting under-recovered muscles wastes stimulus and risks overuse.

**Code:** `sraContext = new Map()` always; `sraReadiness: 0.00` in weights. `volume-landmarks.ts` has correct `sraHours` per muscle but they only feed SRA warning generation, not selection scoring.

**Status:** Acknowledged as pending in `architecture.md` and `template-session.ts:207–210`. No fix warranted until recovery tracking data is available.

---

### G7 — 🟢 LOW — Cold start Stage 0 uses reduced beam, not curated sessions

**Spec (§9):** "Stage 0 (new user): use curated starter sessions from `docs/knowledgebase/workouts.md` mapped by intent."
**Code:** `COLD_START_BEAM_CONFIGS[0] = { beamWidth: 2, maxDepth: 2 }` — reduces search depth but still selects from full exercise pool. `docs/archive/workouts.md` exists but is not loaded.

---

## Priority summary

| ID | Severity | Gap | Effort |
|---|---|---|---|
| G1 | 🔴 High | Volume target always MEV — no mesocycle ramp | Medium (new helper + thread weekInBlock into objective) |
| G2 | 🟡 Medium | `MAX_SETS=5` flat — training age not applied | Small (pass trainingAge into objective, branch in computeProposedSets) |
| G3 | 🟡 Medium | Fat loss 0.75× multiplier missing in intent mode | Small (pass goal into buildSelectionObjective, apply in computeProposedSets) |
| G4 | 🟡 Medium | Main lift rest 150s — below 3–5 min for strength | Small (add goal/rep-range branch in REST_SECONDS or prescribeMainLiftSets) |
| G5 | 🟡 Medium | Indirect volume may double-count vs KB landmarks | Documentation + decision; no code change likely needed |
| G6 | 🟢 Low | SRA context empty / weight zeroed | Backlog — needs recovery tracking infra first |
| G7 | 🟢 Low | Cold start Stage 0 doesn't load curated sessions | Low priority; reduced beam is a functional fallback |
