# Engine Architecture

Last verified against code: 2026-02-14

This document describes current runtime behavior for workout generation and load assignment.

For schema details, see `docs/data-model.md`.
For full end-to-end traceability, see `docs/workout-data-flow-traceability.md`.

## Current runtime scope

- Active generation endpoints:
  - `POST /api/workouts/generate-from-template`
  - `POST /api/workouts/generate-from-intent`
- Selection is now shared across template auto-fill and intent generation via `selectExercises(...)`.
- Deprecated auto endpoint `POST /api/workouts/generate` is removed.
- `src/lib/engine/engine.ts` is removed.

## Engine guarantees

### 1. Template orchestration

`generateSessionFromTemplate(...)` in `src/lib/api/template-session.ts`:

1. Loads template and workout context in parallel.
2. Maps Prisma records to engine types.
3. Derives `weekInBlock` and `mesocycleLength`.
4. Applies periodization (training-age-aware RPE offsets when profile age is present) with adaptive deload override (`shouldDeload`).
5. Calls `generateWorkoutFromTemplate(...)` in `template-session.ts`.
6. Calls `applyLoads(...)` for final load assignment and post-load budget safety trim.

### 2. Time budget enforcement

Timeboxing runs in two places:

1. `generateWorkoutFromTemplate(...)` pre-load trim using projected main-lift warmup ramps.
2. `applyLoads(...)` post-load trim when assigned warmups still exceed budget.

Main lifts are preserved during trimming.

### 3. Volume cap behavior

`enforceVolumeCaps(...)` supports:

- Enhanced context: per-muscle MRV cap (direct-only by default, effective direct+indirect when `USE_EFFECTIVE_VOLUME_CAPS=true`).
- Standard context: 20% spike cap versus previous week baseline.

Template API path passes mesocycle context, so enhanced mode is active in production template generation.
`USE_EFFECTIVE_VOLUME_CAPS` defaults to off; when enabled it compares effective sets (`direct + indirect * INDIRECT_SET_MULTIPLIER`) against MRV while preserving spike-cap safety.
Indirect set weighting is now centralized in `src/lib/engine/volume-constants.ts` (`INDIRECT_SET_MULTIPLIER = 0.3`) and shared by runtime effective-set helpers and weekly scoring.

### 4. SRA behavior

SRA warnings are advisory:

- warnings are surfaced in response payload and notes.
- under-recovered muscles are soft-penalized in scoring.
- no hard SRA exclusion is applied.

### 5. Load assignment precedence

`applyLoads(...)` resolves load in this order:

1. progression from completed history (`computeNextLoad`)
2. baseline lookup
3. donor-based baseline estimation
4. bodyweight-ratio estimation
5. equipment default fallback

### 6. Completion-aware history

Completed sessions drive progression/volume recency logic.
Latest check-in is overlaid for readiness and pain flags.

## End-to-end generation flow

### Template mode (`POST /api/workouts/generate-from-template`)

```text
resolveOwner()
-> generateSessionFromTemplate(userId, templateId)
   -> loadTemplateDetail(...) + loadWorkoutContext(...) in parallel
   -> mapProfile/mapGoals/mapConstraints/mapExercises/mapHistory/mapPreferences/mapCheckIn
   -> deriveWeekInBlock(...) + getPeriodizationModifiers(...)
   -> if shouldDeload(history) and not already deload, override periodization to deload
   -> generateWorkoutFromTemplate(..., { sessionMinutes, weekInBlock, mesocycleLength, periodization, ... })
   -> applyLoads(...)
-> return { workout, templateId, sraWarnings, substitutions, volumePlanByMuscle }
```

Notes:

- Template generation is user-directed by default and can auto-fill non-pinned slots when requested.
- Template saves set `advancesSplit: false` for historical split queue isolation.

### Intent mode (`POST /api/workouts/generate-from-intent`)

```text
resolveOwner()
-> loadWorkoutContext(userId)
   -> mapProfile/mapGoals/mapConstraints/mapExercises/mapHistory/mapPreferences/mapCheckIn
-> selectExercises({ mode: "intent", ... })
   -> deterministic scoring + tie-breaks
   -> returns selected exercises + perExerciseSetTargets + metadata
-> generateWorkoutFromTemplate(..., { setCountOverrides, sessionIntent, ... })
-> applyLoads(...)
-> return { workout, sraWarnings, substitutions, volumePlanByMuscle, sessionIntent, selection }
```

Notes:

- Intent generation uses prescriptive set allocation from selector output (`perExerciseSetTargets`).
- Cold-start staged unlock metadata is persisted through save in `Workout.selectionMetadata`.

## Persistence and feedback flow

### Save workout (`POST /api/workouts/save`)

- Upserts `Workout`.
- Rewrites `WorkoutExercise` and `WorkoutSet` rows when exercises are supplied.
- Persists `WorkoutExercise.section` (`WARMUP | MAIN | ACCESSORY`) when provided.
- Runs `updateBaselinesFromWorkout(...)` in-transaction when status is `COMPLETED`.

### Log set (`POST /api/logs/set`)

- Upserts one `SetLog` per `WorkoutSet` (`workoutSetId` unique).
- Logged values feed future generation via `mapHistory(...)`.

## Periodization system (Phase 1 - 2026-02-14)

### Hierarchy

```text
MacroCycle (12-52 weeks)
├── Mesocycle 1 (4-6 weeks)
│   ├── Block 1: Accumulation (2-3 weeks)
│   ├── Block 2: Intensification (2 weeks)
│   ├── Block 3: Realization (1 week) [advanced only]
│   └── Block 4: Deload (1 week)
├── Mesocycle 2 (4-6 weeks)
│   └── ...
└── Mesocycle N
```

### Block types and modifiers

| Block Type | Volume | Intensity (RIR) | Rest | Adaptation |
|------------|--------|-----------------|------|------------|
| **Accumulation** | 1.0 → 1.2 | +2 (easier) | 0.9x | Myofibrillar hypertrophy |
| **Intensification** | 1.0 → 0.8 | +1 | 1.0x | Neural adaptation |
| **Realization** | 0.6 → 0.7 | +0 (max effort) | 1.2x | Peak performance |
| **Deload** | 0.5 | +3 (very easy) | 0.8x | Active recovery |

### Training age templates

- **Beginner**: 3-week accumulation + 1-week deload (4-week meso)
- **Intermediate**: 2-week accumulation + 2-week intensification + 1-week deload (5-week meso)
- **Advanced**: 2-week accumulation + 2-week intensification + 1-week realization + 1-week deload (6-week meso)

### Integration

1. **Macro generation**: `POST /api/periodization/macro` → `generateMacroCycle()` → Nested Prisma create
2. **Context loading**: `loadCurrentBlockContext(userId, date)` → Finds active macro → Derives block context
3. **Prescription**: `prescribeWithBlock({ basePrescription, blockContext })` → Applies modifiers
4. **Load assignment**: `applyLoads({ prescriptionModifiers })` → Applies intensity multiplier

### Backward compatibility

- All new fields nullable (`Workout.trainingBlockId`, `Workout.weekInBlock`, `Workout.blockPhase`)
- `blockContext` parameter optional in session generation
- When no macro cycle exists, system uses base prescriptions (no modifiers)
- Existing periodization logic (`getPeriodizationModifiers()`) continues to work alongside new system

**Reference**: ADR-033, ADR-034, ADR-035. See `src/lib/engine/periodization/` for implementation.

---

## Autoregulation & Readiness System (Phase 3 - 2026-02-15)

### Overview

Phase 3 adds real-time autoregulation that adjusts workout intensity and volume based on multi-signal fatigue tracking. The system integrates Whoop recovery data (stubbed), subjective readiness, and performance history to compute a continuous fatigue score (0-1 scale) and automatically modulate workouts.

### Readiness Signal Collection

**Endpoint**: `POST /api/readiness/submit`

**Input**:
- `subjective.readiness`: 1-5 (rough → great)
- `subjective.motivation`: 1-5 (low → high)
- `subjective.soreness`: Per-muscle (chest, back, shoulders, legs, arms) → 1-3 (none, moderate, very sore)
- `subjective.stress`: 1-5 (optional)

**Output**:
- Stored in `ReadinessSignal` table
- Computes `FatigueScore` with weighted components:
  - Whoop: 50% (stubbed, returns null in Phase 3)
  - Subjective: 30% (readiness, motivation, soreness, stress)
  - Performance: 20% (RPE deviation, stall count, volume compliance from last 3 sessions)

**Formula** (from `computeFatigueScore` in `src/lib/engine/readiness/compute-fatigue.ts`):
```
fatigueScore.overall =
  (weights.whoop * components.whoop) +
  (weights.subjective * components.subjective) +
  (weights.performance * components.performance)
```

### Autoregulation Decision Matrix

**Implemented in**: `autoregulateWorkout()` in `src/lib/engine/readiness/autoregulate.ts`

| Fatigue Score | Action | Effect |
|---|---|---|
| < 0.3 | `trigger_deload` | Cut volume 20%, reduce load 10%, signal critical fatigue |
| 0.3-0.5 | `scale_down` (conservative/moderate) | -10% load, +1 RIR |
| 0.3-0.5 | `reduce_volume` (aggressive policy) | -2 accessory sets |
| 0.5-0.85 | `maintain` | No changes |
| > 0.85 | `scale_up` (if allowed) | +5% load, -1 RIR (capped at 0) |

**Policy Parameters** (`AutoregulationPolicy`):
- `aggressiveness`: conservative / moderate / aggressive
- `allowUpRegulation`: boolean (permit intensity increases when fresh)
- `allowDownRegulation`: boolean (permit intensity decreases when fatigued)

### Stall Detection & Intervention Ladder

**Endpoint**: `GET /api/stalls`

**Detection** (`detectStalls()` in `src/lib/engine/readiness/stall-intervention.ts`):
- Analyzes last 12 weeks of completed workout history
- Groups by exercise, counts sessions without PR (personal record)
- Flags exercises with ≥2 weeks without progress

**Intervention Ladder** (`suggestIntervention()`):

| Weeks Stalled | Intervention | Action |
|---|---|---|
| 2 | `microload` | Use +1-2 lbs increments instead of +5 lbs |
| 3 | `deload` | Drop 10%, rebuild over 2-3 weeks |
| 5 | `variation` | Swap exercise variation (e.g., incline → flat bench) |
| 8 | `volume_reset` | Drop to MEV, rebuild over 4 weeks |
| 12+ | `goal_reassess` | Re-evaluate training goals and approach |

### Integration with Workout Generation

**Both template and intent routes** (`POST /api/workouts/generate-from-template`, `POST /api/workouts/generate-from-intent`) now call `applyAutoregulation()` after workout generation:

```typescript
const autoregulated = await applyAutoregulation(userId, workout);

return {
  workout: autoregulated.adjusted,  // Modified workout
  autoregulation: {
    wasAutoregulated: autoregulated.wasAutoregulated,
    fatigueScore: autoregulated.fatigueScore,
    modifications: autoregulated.modifications,
    rationale: autoregulated.rationale,
  },
};
```

**Stored in DB**:
- `Workout.wasAutoregulated`: boolean
- `Workout.autoregulationLog`: JSON with modifications and rationale

### UI Components

**Phase 3 introduces 3 new components**:

1. **ReadinessCheckInForm** (`src/components/ReadinessCheckInForm.tsx`)
   - Collects readiness, motivation, stress, per-muscle soreness
   - Submits to `/api/readiness/submit`
   - Displays fatigue score result with gauge visualization

2. **AutoregulationDisplay** (`src/components/AutoregulationDisplay.tsx`)
   - Shows fatigue score gauge (0-100%, color-coded)
   - Signal breakdown (stacked bar: Whoop/Subjective/Performance)
   - Modifications list (intensity scale, volume reduction, deload triggers)
   - Rationale text

3. **StallInterventionCard** (`src/components/StallInterventionCard.tsx`)
   - Exercise name, weeks without progress
   - Intervention level badge (microload/deload/variation/volume_reset)
   - Suggested action + rationale
   - Apply/Dismiss buttons

### Whoop Integration (Stubbed)

**Phase 3 Interface** (implementation deferred to future phase):

- `fetchWhoopRecovery(userId, date)` → returns `null` (stubbed)
- `refreshWhoopToken(userId)` → throws error (stubbed)
- `UserIntegration` model exists in schema for future OAuth flow
- When Whoop is unavailable, weights auto-adjust:
  - Whoop: 0%
  - Subjective: 60% (increased from 30%)
  - Performance: 40% (increased from 20%)

**Reference**: ADR-047, ADR-048, ADR-049, ADR-050, ADR-051. See `src/lib/engine/readiness/` for implementation.

---

## Module map (active runtime)

| Module | Responsibility |
|---|---|
| `template-session.ts` | Template workout orchestration |
| `exercise-selection.ts` | Shared deterministic selector for template auto-fill and intent mode |
| `apply-loads.ts` | Load assignment, warmup sets, post-load time trim |
| `volume.ts` | Volume context and cap enforcement |
| `timeboxing.ts` | Duration estimate and accessory trim priority |
| `warmup-ramp.ts` | Warmup ramp projection/assignment helpers |
| `sra.ts` | Recovery map and warnings |
| `substitution.ts` | Template flexible-mode substitute ranking |
| `rules.ts` | Rep ranges and periodization helpers |
| `progression.ts` | Next-load math and adaptive deload signal |
| `types.ts` | Engine contracts |
| **`periodization/`** | **Macro/meso/block generation, context derivation, block-aware prescription** |
| **`readiness/`** | **Fatigue scoring, autoregulation, stall detection and intervention ladder** |

## Module Cleanup History

**Removed 2026-02-15 (ADR-041):**
- `filtering.ts` - Greedy selection algorithm (replaced by selection-v2)
- `pick-accessories-by-slot.ts` - Slot-based accessory selection (replaced by beam search)
- `src/lib/api/split-preview.ts` - Split preview utility (no longer needed)
- `src/lib/engine/legacy/` - Archived legacy selection code (replaced by selection-v2)

All generation flows now use `selection-v2` (multi-objective beam search).

**Still active:**
- `split-queue.ts` - History classification and split day calculation (used by history analysis)

## Known gaps

- Finding 16 only: stall escalation system beyond deload remains backlog scope and is tracked in `docs/plans/engine-audit-remediation-plan.md`.
- Weekly program analysis now supports mixed template + intent rotations by using history-backed intent-session estimation when a scheduled intent has no matching template.
