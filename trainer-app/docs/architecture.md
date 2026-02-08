# Engine Architecture

How the workout engine works. This is the single source of truth for engine behavior.

For database schema details, see [data-model.md](data-model.md). For exercise catalog, see [seeded-data.md](seeded-data.md).

---

## Engine Guarantees

These are hard constraints the engine enforces.

### 1. Strict Split Purity

PPL days are filtered by `Exercise.splitTags`. Push day only selects exercises tagged `PUSH`, pull only `PULL`, legs only `LEGS`. Exercises tagged with both `PUSH` and `PULL` are silently filtered out with a warning.

### 2. Template-Only Special Blocks

`CORE`, `MOBILITY`, `PREHAB`, and `CONDITIONING` exercises are only selectable in explicit warmup or finisher blocks. They are never chosen as general accessories.

- `MOBILITY` and `PREHAB` are warmup options.
- `CORE` can be appended as an optional finisher.
- `CONDITIONING` can be appended on legs day when optional conditioning is enabled.

### 3. Movement Intelligence

The engine pairs main lifts by `movementPatternsV2`:

- **Push**: 1 horizontal press + 1 vertical press
- **Pull**: 1 vertical pull + 1 horizontal row (prefers chest-supported when low-back pain)
- **Legs**: 1 squat + 1 hinge

Main lifts use recency weighting and seeded randomness for variety. Recent main lifts are deprioritized.

### 4. Timeboxing

The session time budget (`sessionMinutes`) is enforced by dropping accessories first. Accessories are trimmed by lowest priority (scored by fatigue cost and unique muscle contribution), not by position order.

### 5. Load Progression Guardrails

- **Beginner**: Linear progression — always increase. Upper body +2.5-5 lbs, lower body +5-10 lbs per session. Skips RPE-based rules.
- **Intermediate**: Double progression — hit top of rep range at target RIR, increase weight and reset to bottom of range.
- **Advanced**: Autoregulated RPE-based progression with wider ranges.
- RPE guardrails adjust load up or down by **4%**.
- Any load change is capped at **7% per step**.
- If all sets hit the top of the rep range at or below target RPE, load increases.
- If early sets exceed target RPE by +1, load decreases next session.

### 6. Volume Caps (Per-Muscle MRV)

Weekly volume is enforced using per-muscle **Maximum Recoverable Volume (MRV)** caps from the volume landmarks system. Each muscle has evidence-based MV/MEV/MAV/MRV thresholds. When enhanced volume context is available (with mesocycle position), target volume ramps from MEV (week 1) to MAV (final week). Accessories are removed if they would push any muscle past MRV.

Falls back to a **20% spike cap** (rolling 7-day window) when enhanced volume context is not available.

### 6a. SRA Tracking

The engine tracks Stimulus-Recovery-Adaptation windows per muscle group. Each muscle has an `sraHours` value (36-72 hours). Under-recovered muscles (trained within their SRA window) receive a scoring penalty during accessory selection — they are deprioritized but not hard-filtered. SRA warnings are included in workout notes.

### 7. Readiness and Pain Check-Ins

The most recent `SessionCheckIn` drives readiness and pain filtering. Injuries reduce high joint-stress exercises. Pain filtering uses exercise `contraindications` as the primary filter, with regex heuristics as fallback for untagged exercises.

### 8. Deterministic Randomization

All randomized selection uses a seeded PRNG (`createRng` from `random.ts`). Tests always provide `randomSeed` for reproducibility. Production uses `Math.random` when no seed is provided.

---

## End-to-End Generation Flow

```
POST /api/workouts/generate
  1. Load data
     resolveUser() -> loadWorkoutContext()
     Fetches: profile, goals, constraints, injuries, baselines, exercises,
              workouts, preferences, most recent SessionCheckIn

  2. Map DB models to engine types
     mapProfile, mapGoals, mapConstraints, mapExercises, mapHistory, mapCheckIn

  3. Generate workout (pure engine)
     generateWorkout()
       -> select split day (history-based for PPL, position-based for others)
       -> derive fatigue state from history + check-in
       -> build volume context (per-muscle weekly sets from history)
       -> choose main lifts (movement pairing + recency weighting)
       -> choose accessories (slot-based selection with SFR/length scoring)
       -> timebox the plan
       -> enforce per-muscle volume caps (MRV)
       -> generate SRA warnings

  4. Apply loads (pure engine)
     applyLoads()
       -> Tier 1: history via computeNextLoad
       -> Tier 2: baselines by exerciseId
       -> Tier 3: estimation (muscle donor -> bodyweight ratios -> equipment defaults)
       -> Apply periodization modifiers
       -> Generate warmup ramp-up sets for main lifts

  5. Return WorkoutPlan JSON
```

---

## PPL Accessory Selection (Slot-Based)

Accessories are chosen via slot-based selection. Each slot targets specific muscles/stimulus:

**Push day**: chest isolation (stretch/metabolic bias), side delt, triceps isolation, fill
**Pull day**: rear delt or upper back, biceps, row or vertical pull variant, fill
**Legs day**: quad isolation, hamstring isolation, glute/unilateral, calf, fill

**Non-PPL splits** also use slot-based selection:

**Upper**: chest isolation, side delt, back compound, biceps, triceps isolation
**Lower**: quad isolation, hamstring isolation, glute/unilateral, calf
**Full body**: chest isolation, back compound, quad isolation, hamstring isolation

Selection scoring uses: primary muscles, stimulus bias, recency weighting, novelty bonus, favorites, volume awareness, **SFR score** (stimulus-to-fatigue ratio, 1-5), and **length-position score** (lengthened-position loading, 1-5). Exercises with higher SFR and length-position scores are preferred for accessories. An **indirect volume penalty** (0.7x) applies when an accessory's primary muscles overlap with main lifts' secondary muscles (e.g., front delts after pressing). Fill slots favor uncovered muscles relative to main lifts and prior accessories.

---

## Top Set / Back-Off Structure

Main lifts use a top set + back-off structure:

- `setIndex == 1` is the **top set** (load from history/baseline/estimation)
- `setIndex > 1` are **back-off sets** (load = topSetLoad * backOffMultiplier)
- Non-main-lift exercises use **uniform sets**

There is no explicit `setType` field — role is inferred from `setIndex`.

**Back-off multipliers by goal:**

| Goal | Multiplier |
|------|-----------|
| Strength | 0.90 |
| Hypertrophy | 0.85 |
| Fat loss | 0.85 |
| General health | 0.85 |

---

## Periodization (Flexible Mesocycles)

The engine supports flexible mesocycle lengths (3-6 weeks, not counting deload) via `getMesocyclePeriodization()`. A backward-compatible `getPeriodizationModifiers()` wraps this with a fixed 4-week cycle (3 training + 1 deload).

### RIR Ramp (across mesocycle position `t = currentWeek / (totalWeeks - 1)`)

| Position | t range | RPE Offset | RIR | Sets Multiplier |
|----------|---------|-----------|-----|-----------------|
| Early | 0 - 0.25 | -1.5 | 3-4 | 1.0x |
| Middle | 0.25 - 0.5 | -0.5 | 2-3 | ~1.15x |
| Late | 0.5 - 0.75 | +0.5 | 1-2 | ~1.22x |
| Final | 0.75 - 1.0 | +1.0 | 0-1 | 1.3x |
| Deload | — | -2.0 | 4-6 | 0.5x |

### Default 4-Week Cycle (via `getPeriodizationModifiers`)

| Week | Phase | RPE Offset | Sets Mult | Back-off |
|------|-------|-----------|-----------|----------|
| 0 | Early | -1.5 | 1.0x | goal-based |
| 1 | Middle | -0.5 | 1.15x | goal-based |
| 2 | Final | +1.0 | 1.3x | goal-based |
| 3 | Deload | -2.0 | 0.5x | 0.75x |

**Week derivation:**

- With `ProgramBlock`: `weekInBlock = floor((scheduledDate - blockStartDate) / 7) % blockWeeks`
- Without `ProgramBlock`: rolling 4-week window from oldest recent workout
- Sparse history (< 2 weeks): forces `weekInBlock = 0` (Early)

**Deload thresholds:** `consecutiveLowReadiness: 4`, `plateauSessions: 5`, `proactiveMaxWeeks: 6`

**Deload behavior:** Main-lift top-set structure is skipped; all sets are uniform at deload RPE (capped at 6.0). Deload loads use the 0.75 back-off scale.

**Touchpoints:** `deriveWeekInBlock` in `src/lib/api/periodization.ts`, `getPeriodizationModifiers` and `getMesocyclePeriodization` in `src/lib/engine/rules.ts`.

---

## Load Estimation (Hybrid Strategy)

When no history exists for an exercise, the engine estimates load:

1. **Same-muscle donor inheritance**: Find baselined exercises sharing primary muscles. Scale by equipment compatibility, compound status, and fatigue cost ratio (`clamp(targetFatigue / donorFatigue, 0.45, 0.80)`). Donors with movement pattern overlap are preferred.
2. **Bodyweight ratios**: When no donors exist, use bodyweight-based ratios by movement pattern and equipment.
3. **Equipment defaults**: Conservative fallback when bodyweight is unknown.

Donor scoring: `muscleOverlap * 4 + patternOverlap * 3 + equipMatch * 2 + compoundMatch * 1`

---

## Rep Ranges

Rep ranges are role-specific (main lift vs accessory) and goal-dependent. Defined in `rules.ts` via `REP_RANGES_BY_GOAL`. Strength accessories target higher reps (6-10) than main lifts (3-6). Hypertrophy accessories target 10-15 while main lifts target 6-10.

## Rest Periods

Rest scales by exercise type and rep range via `getRestSeconds()`. Accepts optional `targetReps` for rep-aware rest.

| Category | Rep Range | Rest |
|----------|-----------|------|
| Main lift (heavy) | 1-5 reps | 240-300s |
| Main lift (moderate) | 6-12 reps | 150-180s |
| Compound accessory | ≤8 reps | 150s |
| Compound accessory | 9+ reps | 120s |
| Isolation (high fatigue) | any | 90s |
| Isolation (low fatigue) | any | 60s |

Defined in `prescription.ts`.

---

## Engine Module Map

| Module | Responsibility |
|--------|---------------|
| `engine.ts` | Orchestrator: `generateWorkout`, `buildWorkoutExercise` |
| `apply-loads.ts` | Load assignment: history -> baseline -> estimation; periodization modifiers |
| `split-queue.ts` | Split patterns, day index, history-based PPL split, target pattern resolution |
| `filtering.ts` | Exercise filtering (equipment, pain, injury, stall), `selectExercises` |
| `main-lift-picker.ts` | PPL main lift pairing with recency weighting |
| `pick-accessories-by-slot.ts` | Slot-based accessory selection (PPL, upper_lower, full_body) |
| `prescription.ts` | Set/rep prescription, rest seconds |
| `volume.ts` | Volume context (per-muscle MRV), caps enforcement, fatigue state derivation |
| `timeboxing.ts` | Time estimation, priority-based accessory trimming |
| `substitution.ts` | Exercise substitution suggestions |
| `progression.ts` | Load progression (`computeNextLoad`, `shouldDeload`) |
| `utils.ts` | Shared helpers (`normalizeName`, `weightedPick`, `buildRecencyIndex`, etc.) |
| `volume-landmarks.ts` | Volume landmarks (MV/MEV/MAV/MRV), muscle-to-split mapping |
| `sra.ts` | SRA recovery tracking, warning generation |
| `rules.ts` | Constants, rep ranges, mesocycle periodization |
| `random.ts` | Seeded PRNG (`createRng`) |
| `types.ts` | All engine type definitions |
| `sample-data.ts` | Test fixture builders |

---

## Schema Fields Used by Engine

**Exercise** (extended): `splitTags`, `movementPatternsV2`, `isMainLiftEligible`, `isCompound`, `fatigueCost`, `stimulusBias`, `contraindications`, `timePerSetSec`, `sfrScore`, `lengthPositionScore`

**ExerciseAlias**: `exerciseId` -> `Exercise.id`, `alias` (unique)

**Baseline**: `exerciseId` (non-nullable FK, unique: `userId, exerciseId, context`)

**Constraints**: `availableEquipment` (EquipmentType[]), `sessionMinutes`

**SessionCheckIn**: `readiness` (1-5), `painFlags` (jsonb)

**Profile**: `trainingAge` (non-nullable, default INTERMEDIATE), `heightIn`, `weightLb` (converted to metric via `mapProfile`)

---

## Known Gaps

- `suggestSubstitutes` is implemented and tested but not surfaced in the UI.
- Double timeboxing (engine trims, then `applyLoads` may trim again after adding warmup sets) is acceptable but could be unified if short workouts become an issue.
- Field renames (`movementPatternsV2` → `movementPatterns`, `isMainLift` → derive from `isMainLiftEligible`) are planned for a future migration after all code is updated.

---

## UI Flow (Workout Generation)

1. Dashboard (`/`) renders `GenerateWorkoutCard`
2. Tapping "Generate Workout" expands inline `SessionCheckInForm`
3. Submit: `POST /api/session-checkins` then `POST /api/workouts/generate`
4. Skip: `POST /api/workouts/generate` directly (no check-in saved)
5. After generation: preview + "Save Workout" button
6. Save: `POST /api/workouts/save` -> links to `/workout/[id]` and `/log/[id]`

**Workout detail** (`/workout/[id]`): session overview with estimated minutes, exercises grouped into Warmup/Main Lifts/Accessories, each card shows sets/reps/load/RPE and a "Why" note.
