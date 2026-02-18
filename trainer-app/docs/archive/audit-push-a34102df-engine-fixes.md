# Plan: Address Audit Issues from 2026-02-18 Push Workout (a34102df)

## Context
A workout audit identified 9 actionable engine/explainability issues in the push session. Issues fall into three layers:
- **Engine selection bugs** (C1, W2, W3) — optimizer allows physiology-violating choices
- **Calibration errors** (W1, W6) — scoring weights and SRA hours misaligned with KB research
- **Explainability bugs** (W4, W5, I2, I3, I4) — incorrect rationale text, unit bugs, serialization failures

Fixes are ordered by priority from the audit, then batched by file for execution.

---

## Critical Files

| File | Items |
|------|-------|
| `src/lib/engine/volume-landmarks.ts` | W6 |
| `src/lib/engine/selection-v2/beam-search.ts` | C1, W2, W3 |
| `src/lib/engine/selection-v2/types.ts` | W1 |
| `src/lib/engine/template-session.ts` | W5 (sort) |
| `src/lib/engine/explainability/prescription-rationale.ts` | I2, I4 |
| `src/lib/api/explainability.ts` | W4 |
| `src/app/api/workouts/[id]/explanation/route.ts` | I3 |

---

## Phase 1 — Simple, Low-Risk Fixes (W6, I3)

### W6 — Fix triceps sraHours
**File:** `src/lib/engine/volume-landmarks.ts:20`

Change:
```typescript
"Triceps": { mv: 4, mev: 6, mav: 12, mrv: 18, sraHours: 36 },
```
To:
```typescript
"Triceps": { mv: 4, mev: 6, mav: 12, mrv: 18, sraHours: 48 },
```
**KB basis:** Two KB entries exist with different ranges:
- *SRA table (KB line 315)*: "Small muscles | Biceps, triceps, calves | 24-48h | 3-4×/week" — current 36h is technically within this range
- *Triceps-specific section (KB line 217)*: "Frequency: 2-4×/week (SRA ~48-72h)" — explicitly overrides the general table

**Why the specific section overrides:** Triceps receive heavy pressing indirect stimulus on push days, which extends effective recovery time beyond what small muscle size alone would predict. KB line 82: "Triceps have a lower MRV (~18) because pressing compounds already stress them substantially." The compound loading justifies treating triceps recovery more like a medium-muscle SRA (48-72h) than a pure small muscle (24-48h). Setting 48h uses the explicit triceps section value and corrects the current underestimate.

### I3 — Fix muscleStatuses Map serialization
**File:** `src/app/api/workouts/[id]/explanation/route.ts`

`sessionContext.volumeStatus.muscleStatuses` is a `Map<string, MuscleStatus>` — serializes to `{}` in JSON.

Change the response from:
```typescript
return NextResponse.json({
  sessionContext: result.sessionContext,
  ...
});
```
To:
```typescript
return NextResponse.json({
  sessionContext: {
    ...result.sessionContext,
    volumeStatus: {
      ...result.sessionContext.volumeStatus,
      muscleStatuses: Object.fromEntries(result.sessionContext.volumeStatus.muscleStatuses ?? []),
    },
  },
  ...
});
```

---

## Phase 2 — Scoring Calibration (W1)

### W1 — Increase lengthenedBias weight
**File:** `src/lib/engine/selection-v2/types.ts` — `DEFAULT_SELECTION_WEIGHTS`

Currently `lengthenedBias: 0.1` (comment: "defer to Phase 4"). This is Phase 4.

**KB basis (very strong — strongest in the report):** "Overhead cable/dumbbell extensions (Maeo et al., 2023: produced ~40% more total triceps growth than pushdowns over 12 weeks — and surprisingly also grew the lateral and medial heads more, not just the long head)." Same finding appears in the KB's lengthened-position summary table: "Triceps | Overhead extensions | Maeo 2023: +40% growth". This +40% differential is among the largest documented exercise-specific hypertrophy differences in the KB.

Overhead Extension (lengthenedScore=4/5=0.8) vs Pushdown (lengthenedScore=1/5=0.2) has a 0.6 score gap. At 0.1 weight, beam scores the gap as 0.06 — easily buried by SFR differences. At 0.20, the gap is 0.12, making lengthened position a meaningfully distinct factor.

Change:
```typescript
lengthenedBias: 0.1, // Moderate - lengthened position bias
```
To:
```typescript
lengthenedBias: 0.20, // Phase 4: KB-confirmed per Maeo 2023 (+40% triceps growth overhead vs pushdown)
```
No rebalancing required — existing weights already sum to 1.10 (weighted sum, not a probability distribution). Increasing by 0.10 adds signal without breaking other objectives.

---

## Phase 3 — Beam Search Logic (C1, W2, W3, W5)

All beam-search changes go inside the main expansion loop in `beamSearch()`, after the existing pattern cap check (around line 169).

### C1 — Per-session triceps isolation cap

**Root cause:** Bench Press / Dip / Push-Up all list Triceps as PRIMARY. So 3 compounds × 5 sets = 15 direct effective triceps sets in `volumeFilled`. The existing `exceedsCeiling` check uses strict `>` (not `>=`), so 15+3=18 == MRV ceiling → pushdown is allowed through. This exhausts the weekly MRV in a single session.

**KB basis (strong):**
- Line 67: "measured in **direct working sets per muscle group per week**. Indirect volume (e.g., triceps from bench press) is **already factored into these estimates**." — The MRV of 18 is for DIRECT sets only; pressing indirect stimulus is the background against which that ceiling is calibrated.
- Line 82: "Triceps have a lower MRV (~18) because pressing compounds already stress them substantially."
- Line 86: "RP: per-session volume should not exceed **~10-12 hard sets** for a single muscle group due to diminishing returns."

**Deeper root cause (noted for future data fix):** KB line 67 defines volume landmarks as DIRECT sets, with pressing as INDIRECT background. The correct engine representation is: pressing compounds should have Triceps as SECONDARY (indirect, 0.3× multiplier), not PRIMARY. That data fix is out of scope here; the C1 beam rule is the pragmatic safeguard requested by the audit.

**Fix:** When ≥2 compound exercises with Triceps as a PRIMARY muscle are in the beam state, allow at most 1 direct triceps isolation.

```typescript
// C1: Per-session triceps isolation cap
// KB: MRV=18 for triceps accounts for full pressing stimulus. When ≥2 pressing
// compounds have Triceps as primary, allow only 1 isolation to stay within per-session
// safe zone (~half of weekly MRV per push session).
const isDirectTricepsIsolation =
  !candidate.exercise.isMainLiftEligible &&
  !(candidate.exercise.isCompound ?? false) &&
  (candidate.exercise.primaryMuscles ?? []).includes("Triceps");

if (isDirectTricepsIsolation) {
  const pressingCompoundsInState = state.selected.filter((c) =>
    (c.exercise.isCompound ?? false) &&
    (c.exercise.primaryMuscles ?? []).includes("Triceps")
  ).length;

  if (pressingCompoundsInState >= 2) {
    const tricepsIsolationsInState = state.selected.filter((c) =>
      !c.exercise.isMainLiftEligible &&
      !(c.exercise.isCompound ?? false) &&
      (c.exercise.primaryMuscles ?? []).includes("Triceps")
    ).length;

    if (tricepsIsolationsInState >= 1) {
      // Already have 1 triceps isolation with 2+ pressing compounds — block more
      continue;
    }
  }
}
```

### W2 — Block same-pattern same-primary-muscle isolation duplicates

**Root cause:** `MOVEMENT_PATTERN_CAP = 2` allows two exercises with the same pattern. For isolation exercises targeting the same primary muscle (e.g., Machine Lateral Raise + DB Lateral Raise = both "shoulder_abduction" + both targeting Side Delts), this provides zero movement variety.

**KB note:** The KB does not directly address within-session same-pattern blocking. It recommends rotating 2-4 exercises per muscle group *per mesocycle* for variety. The hard-block here is an engine quality rule: if two isolation exercises share the same movement pattern AND primary muscle, adding both in the same session is redundant — the second exercise provides no additional stimulus the first didn't already provide.

Add after the C1 check:
```typescript
// W2: Hard-block isolation exercises that duplicate pattern AND primary muscle
// Engine quality rule: same isolation pattern + same primary muscle = redundant stimulus
const candidateIsIsolation =
  !candidate.exercise.isMainLiftEligible &&
  !(candidate.exercise.isCompound ?? false);

if (candidateIsIsolation && candidatePatterns.length > 0) {
  const isolationDuplicate = candidatePatterns.some((pattern) =>
    state.selected.some((s) => {
      const sIsIsolation = !s.exercise.isMainLiftEligible && !(s.exercise.isCompound ?? false);
      if (!sIsIsolation) return false;
      const samePattern = (s.exercise.movementPatterns ?? []).includes(pattern);
      const sharedPrimary = (candidate.exercise.primaryMuscles ?? []).some((m) =>
        (s.exercise.primaryMuscles ?? []).includes(m)
      );
      return samePattern && sharedPrimary;
    })
  );
  if (isolationDuplicate) {
    rejectedMap.set(candidate.exercise.id, "dominated_by_better_option");
    continue;
  }
}
```
**Scope:** This only applies to isolation exercises (`!isMainLiftEligible && !isCompound`). Compound variations (flat bench + incline bench) are unaffected.

### W3 — Suppress direct front delt work when pressing covers MEV+

**Root cause:** Front Delts have MEV=0, MAV=7. KB: "Front delts often need zero direct work due to heavy indirect stimulus from pressing movements. Most lifters need zero direct isolation." Each pressing compound adds ~1.5 effective front delt sets (5 sets × 0.3 indirect multiplier). After 3 pressing compounds: 4.5 effective sets, well past the MEV=0 threshold. Front raises remained eligible regardless.

**KB basis (strong):** "Front delts: MEV 0, MAV 4-8, MRV ~12. Get massive indirect volume from all pressing." Threshold of MAV/2=3.5 represents roughly half of the adaptive range — appropriate point to suppress direct work.

```typescript
// W3: Suppress direct front delt work when indirect stimulus ≥ MAV/2
// KB: "Front delts: MEV=0, most lifters need zero direct isolation" (KB Section 4 Shoulders)
// MAV=7 → threshold=3.5 effective sets (~3 pressing compounds × 5 sets × 0.3 indirect)
const FRONT_DELT_SUPPRESS_THRESHOLD = 3.5;
const isDirectFrontDelt =
  !candidate.exercise.isMainLiftEligible &&
  (candidate.exercise.primaryMuscles ?? []).includes("Front Delts");

if (isDirectFrontDelt) {
  const currentFrontDeltVolume = state.volumeFilled.get("Front Delts") ?? 0;
  if (currentFrontDeltVolume >= FRONT_DELT_SUPPRESS_THRESHOLD) {
    rejectedMap.set(candidate.exercise.id, "volume_ceiling_reached");
    continue;
  }
}
```

### W5 — Sort compound accessories before isolation accessories

**File:** `src/lib/engine/template-session.ts`

After `enforceVolumeCaps` returns `finalAccessories`, add a compound-first sort before `applyAccessorySupersetMetadata`:

```typescript
const finalAccessories = enforceVolumeCaps(
  workoutExercises.filter((e) => !e.isMainLift),
  mainLifts,
  volumeContext
).sort((a, b) => {
  const aIsCompound = a.exercise.isCompound ?? false;
  const bIsCompound = b.exercise.isCompound ?? false;
  if (aIsCompound && !bIsCompound) return -1;
  if (!aIsCompound && bIsCompound) return 1;
  return 0;
});
const accessories = applyAccessorySupersetMetadata(finalAccessories);
```
**KB basis (partial):** KB line 110: "exercises performed first yield greater strength gains (ES=0.32, p=0.034), but **hypertrophy is unaffected by order** (ES=0.03, p=0.862)." The sort is a session quality/strength improvement — not a strict hypertrophy requirement.

---

## Phase 4 — Explainability Fixes (W4, I2, I4)

### W4 — Fix rest period rationale using getRestSeconds

**Root cause:** `explainRestPeriod` defaults `seconds ?? 120`. When `restSeconds` from DB is undefined (not persisted per-set), the 120s fallback is wrong for isolations (should be 90s) and too low for main lifts (should be 150-180s).

**File:** `src/lib/api/explainability.ts`

Add import:
```typescript
import { getRestSeconds } from "@/lib/engine/prescription";
```

Change (line ~189):
```typescript
restSeconds: engineSets[0]?.restSeconds,
```
To:
```typescript
restSeconds: engineSets[0]?.restSeconds ??
  getRestSeconds(exercise, workoutExercise.isMainLift, engineSets[0]?.targetReps ?? 10),
```

`getRestSeconds` returns:
- Isolation: 90s ✓ (was: 120s flat)
- Main lift 6-12 reps: 150s ✓ (was: 120s flat)
- Heavy main lift ≤5 reps: 240-300s ✓

### I2 — Fix unit label in overallNarrative

**Root cause:** `prescription-rationale.ts:102` hardcodes `${topSet.targetLoad}kg`. Loads in DB are stored in lbs for this user.

**File:** `src/lib/engine/explainability/prescription-rationale.ts`

1. Add `weightUnit?: "kg" | "lbs"` to `PrescriptionRationaleContext` type:
```typescript
export type PrescriptionRationaleContext = {
  ...
  weightUnit?: "kg" | "lbs"; // defaults to "lbs" (app stores loads in user's native units)
};
```

2. In `explainPrescriptionRationale`, change line ~102:
```typescript
const load = topSet.targetLoad ? `${topSet.targetLoad}kg` : "BW";
```
To:
```typescript
const unit = context.weightUnit ?? "lbs";
const load = topSet.targetLoad ? `${topSet.targetLoad}${unit}` : "BW";
```

No change needed in `explainability.ts` — the default "lbs" handles it.

### I4 — Fix set count text ("4-set protocol" vs actual 5 sets)

**Root cause:** `explainSetCount` at line ~157 generates `"(standard 4-set protocol for main lift)"` even when count=5, because it uses `baseSetCount = isMainLift ? 4 : 3` as text without comparing to actual count.

**File:** `src/lib/engine/explainability/prescription-rationale.ts`, function `explainSetCount`

Change the else branch (standard progression):
```typescript
} else {
  reason += ` (standard ${baseSetCount}-set protocol for ${exerciseType})`;
}
```
To:
```typescript
} else {
  if (count === baseSetCount) {
    reason += ` (standard ${count}-set protocol for ${exerciseType})`;
  } else {
    const pct = Math.round(((count / baseSetCount) - 1) * 100);
    const sign = pct >= 0 ? `+${pct}` : `${pct}`;
    reason += ` (base ${baseSetCount}, ${sign}% for ${trainingAge} ${exerciseType})`;
  }
}
```

---

## Documentation Updates

After completing each phase:
- **Phase 1+2 complete:** Update `docs/architecture.md` volume-landmarks section noting triceps sraHours correction
- **Phase 3 complete:** Add ADR entry to `docs/decisions.md` documenting the three new beam search rules (C1/W2/W3) as behavioral constraints, not architectural changes
- **Phase 4 complete:** No architecture doc change needed (explainability bug fixes)

---

## Verification

After each phase, run:
```bash
cd trainer-app
npx vitest run src/lib/engine/selection-v2/
npx vitest run src/lib/engine/explainability/
npx vitest run src/lib/api/
npm run lint
npx tsc --noEmit
```

After all phases:
```bash
npm run build
```

End-to-end check: Re-run `/workout-audit a34102df` after implementation to confirm:
- No front raise in push sessions with ≥3 pressing compounds
- ≤1 triceps isolation when ≥2 pressing compounds present
- No same-pattern isolation duplicate (one lateral raise variant per session)
- Overhead extension selected over pushdown when both fit in time budget
- Rest period rationale shows 90s for isolation, 150s for main lift (not flat 120s)
- `muscleStatuses` serializes as a non-empty object in explanation API
- `overallNarrative` shows "lbs" not "kg"
- Set count text does not say "4-set protocol" when 5 sets are prescribed
