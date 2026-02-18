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

**Two-phase defense-in-depth approach** (ADR-049):

**Phase 1: Beam search time estimation** (Intent-based workouts)
- Beam search in `selection-v2/candidate.ts` uses `estimateTimeContribution()` with accurate time modeling
- Accounts for warmup sets (2-4 for main lifts), rep-aware rest periods, and exercise-specific work time
- Prevents most time overruns during exercise selection (within 10% accuracy)

**Phase 2: Post-generation safety net** (Both template and intent modes)
- `enforceTimeBudget()` called in `generateWorkoutFromTemplate()` after workout construction
- Guarantees no workout exceeds `sessionMinutes` (or provides explicit warning)
- Trims lowest-priority accessories if over budget (uses existing `trimAccessoriesByPriority()` scoring)
- **Main lifts are NEVER trimmed** - if main lifts alone exceed budget, returns warning instead
- UI-friendly notifications appended to workout notes when accessories trimmed

**Notification examples:**
- Trimming: `"Adjusted workout to 43 min to fit 45-minute budget (removed: Tricep Extensions, Face Pulls)"`
- Warning: `"Main lifts require 52 min (budget: 45 min). Consider reducing volume or increasing time budget."`

**Coverage:** Both template-based (fixed exercises) and intent-based (beam search selected) generation paths enforced via single integration point in engine layer.

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

**Volume landmarks calibration (2026-02-18):**
- Triceps `sraHours` corrected from 36h → 48h. The general small-muscle SRA table (24-48h) is overridden by the KB's triceps-specific section ("SRA ~48-72h") because pressing compounds provide substantial indirect stimulus on push days, extending effective recovery time beyond size alone. `src/lib/engine/volume-landmarks.ts:20`.
- `lengthenedBias` weight in `DEFAULT_SELECTION_WEIGHTS` raised from 0.10 → 0.20. KB-confirmed per Maeo et al. 2023: overhead extensions produced +40% more total triceps growth vs pushdowns over 12 weeks. At 0.10 the 0.6 score gap between overhead extension (4/5) and pushdown (1/5) was buried by SFR differences; at 0.20 it becomes a meaningfully distinct selection factor. `src/lib/engine/selection-v2/types.ts`.

### 5. Movement diversity guarantees

**Beam state-aware scoring** (`selection-v2/scoring.ts`, `selection-v2/beam-search.ts`):

`scoreMovementNovelty()` receives the exercises already selected in the current beam state and penalizes candidates whose movement patterns are already covered. The score is computed dynamically during beam expansion (not pre-computed), so later picks in the beam are increasingly penalized for repeating patterns.

- Weight: `movementDiversity = 0.15` (up from the original 0.05 stub)
- Score: `novelPatterns / totalPatterns` — 1.0 if all patterns are new, taper toward 0 as overlap grows

**Hard cap guardrail** (enforced in beam expansion):

A structural cap of 2 exercises per movement pattern is enforced as a hard constraint independent of scoring. If any movement pattern would appear 3+ times (e.g. three horizontal-push exercises in one Push session), the candidate is rejected during beam expansion. This ensures correct output even if scoring weights drift.

### 6. Load assignment precedence

`applyLoads(...)` resolves load in this order:

1. progression from completed history (`computeNextLoad`)
2. baseline lookup
3. donor-based baseline estimation
4. bodyweight-ratio estimation (machine exercises: floor at 10 lbs)
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
baseScore =
  (weights.whoop * components.whoop) +
  (weights.subjective * components.subjective) +
  (weights.performance * components.performance)

fatigueScore.overall = baseScore * 0.8 + worstMuscleFatigue * 0.2
```

**Per-Muscle Fatigue Integration** (Phase 3.5 - 2026-02-15):

The overall fatigue score applies a 20% penalty based on the worst affected muscle group. This prevents overloading workouts when specific muscles are very sore, even if overall readiness is moderate.

- **Soreness → Fatigue Mapping**: 1 (none) → 1.0 (fresh), 2 (moderate) → 0.5, 3 (very sore) → 0.0 (exhausted)
- **Worst Muscle Penalty**: `worstMuscleFatigue = min(perMuscle values)` if soreness data exists, else 1.0 (fresh)
- **Example**: User with readiness 5/5, motivation 5/5 (base score 90%), but quads very sore (3/3):
  - Without penalty: 90%
  - With penalty: 90% * 0.8 + 0% * 0.2 = **72%** → triggers scale-down autoregulation
- **Rationale**: Localized muscle damage (e.g., quad DOMS from heavy squats) should reduce training readiness more than global subjective scores alone capture

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

## Explainability System (Phase 4.1–4.6)

**Status:** ✅ Complete (Phase 4.1–4.6 shipped 2026-02-16)

**Goal:** Transform the workout generation "black box" into a transparent, coach-like experience with research-backed explanations at three levels:

1. **Session context** - "Why this workout today?" (block phase, volume status, readiness, progression)
2. **Exercise rationale** - "Why these exercises?" (selection factors, KB citations, alternatives)
3. **Prescription rationale** - "Why these sets/reps/loads?" (periodization, progression, training age)

**Architecture:**

```text
src/lib/engine/explainability/     # Pure engine layer (no DB/I/O)
├── types.ts                        # WorkoutExplanation, ExerciseRationale, Citation types
├── knowledge-base.ts               # 16 research citations (Maeo, Pedrosa, Schoenfeld, etc.)
├── session-context.ts              # Block phase, volume, readiness explanation [Phase 4.2]
├── exercise-rationale.ts           # Per-exercise selection factors + KB citations [Phase 4.3]
├── prescription-rationale.ts       # Sets/reps/load/RIR/rest explanation [Phase 4.4]
├── coach-messages.ts               # Encouragement, warnings, milestones [Phase 4.5]
└── utils.ts                        # Formatting helpers (formatBlockPhase, formatCitation, etc.)

src/lib/api/explainability.ts      # API orchestration (DB → engine types) [Phase 4.5]
src/app/api/workouts/[id]/explanation/route.ts  # GET endpoint [Phase 4.5]
src/components/WorkoutExplanation.tsx           # Client wrapper [Phase 4.6]
src/components/explainability/                  # 5 React UI components [Phase 4.6]
├── ExplainabilityPanel.tsx         # Main container with collapsible exercise cards
├── SessionContextCard.tsx          # Block phase, volume, readiness, progression display
├── CoachMessageCard.tsx            # Warning/encouragement/milestone/tip messages
├── ExerciseRationaleCard.tsx       # Per-exercise selection factors + KB citations + alternatives
└── PrescriptionDetails.tsx         # Sets/reps/load/RIR/rest explanation cards
```

**Phase 4.1 Deliverables (✅ Complete):**
- Type system: `WorkoutExplanation`, `SessionContext`, `ExerciseRationale`, `PrescriptionRationale`, `Citation`
- Knowledge base: 16 core research citations organized by topic (lengthened, volume, RIR, rest, periodization, modality)
- Citation matching: `getCitationsByExercise()` matches citations to exercises by name + `lengthPositionScore`
- Utilities: 12 formatting functions (`formatBlockPhase`, `formatCitation`, `pluralize`, `formatLoadChange`, etc.)
- 59 tests passing

**Phase 4.2 Deliverables (✅ Complete):**
- Session context module: `explainSessionContext()` - macro-level "Why this workout today?"
- Block phase description: `describeBlockGoal()` - maps block type to primary training goal
- Volume progress analysis: `describeVolumeProgress()` - MEV/MAV/MRV status across muscles
- Readiness status: `describeReadinessStatus()` - fatigue level + autoregulation adaptations
- Progression context: `describeProgressionContext()` - volume/intensity trends + next milestones
- 25 new tests (84 total)

**Phase 4.3 Deliverables (✅ Complete):**
- Exercise rationale module: `explainExerciseRationale()` - per-exercise selection factor breakdown
- Selection factor breakdown: `buildSelectionFactorBreakdown()` - explains all 7 scoring dimensions
- Alternative suggestions: `suggestAlternatives()` - finds similar exercises with similarity ranking
- KB citation integration: Automatic citation matching for lengthened exercises (score ≥ 4)
- Volume contribution summary: Human-readable breakdown of direct + indirect muscle volume
- 23 new tests (741 total across all modules)

**Session Context Flow:**
```text
Input:
- BlockContext (periodization state)
- volumeByMuscle (Map<string, number>)
- FatigueScore (optional, from autoregulation)
- AutoregulationModification[] (optional)
- signalAge (optional, days since last check-in)

Process:
1. describeBlockGoal() → BlockPhaseContext
   - Block type (accumulation/intensification/realization/deload)
   - Week position (e.g., "Week 2 of 4")
   - Primary goal (e.g., "Build work capacity and muscle mass")

2. describeVolumeProgress() → VolumeStatus
   - Classify each muscle: below_mev | at_mev | optimal | approaching_mrv | at_mrv
   - Generate summary (e.g., "3 of 6 muscle groups near target volume")

3. describeReadinessStatus() → ReadinessStatus
   - Overall readiness: fresh (≥0.75) | moderate (≥0.5) | fatigued (<0.5)
   - Per-muscle fatigue map (0-10 scale for explainability)
   - Summarize adaptations: volume cuts, intensity scaling, deload triggers

4. describeProgressionContext() → ProgressionContext
   - Volume progression: building | maintaining | deloading
   - Intensity progression: ramping | peak | reduced
   - Next milestone (e.g., "Continue accumulation for 2 more weeks")

5. Generate narrative summary (combines all context)

Output:
- SessionContext with narrative: "Accumulation Week 2 of 4: Build work capacity..."
```

**Exercise Rationale Flow:**
```text
Input:
- SelectionCandidate (exercise + scores from beam search)
- SelectionObjective (weights, volume context, rotation context, SRA context)
- Exercise[] (full library for alternative suggestions)

Process:
1. buildSelectionFactorBreakdown() → SelectionFactorBreakdown
   - Deficit fill: "Fills 50% of chest volume deficit"
   - Rotation novelty: "Last used 2 weeks ago" | "Never used before"
   - SFR efficiency: "High stimulus-to-fatigue ratio (4/5)"
   - Lengthened position: "Loads muscle at long length (5/5)"
   - SRA alignment: "Targets fully recovered muscle groups"
   - User preference: "Marked as favorite" | "Neutral"
   - Movement novelty: "Novel movement pattern" | "Similar to others"

2. Extract primary reasons (top 2-3 factors with score > 0.6)
   - Sort factors by score descending
   - Filter for significant scores (> 0.6)
   - Take top 3 explanations

3. Get KB citations via getCitationsByExercise()
   - Match by exercise name + lengthPositionScore
   - Return relevant research citations with findings

4. suggestAlternatives() → AlternativeExercise[]
   - Calculate similarity for each library exercise:
     * Shared primary muscles (0.5 weight)
     * Similar movement patterns (0.2 weight)
     * Similar equipment (0.1 weight)
     * Lower fatigue cost (0.2 weight)
   - Filter for similarity > 0.3
   - Sort by similarity descending
   - Take top 3 alternatives
   - Generate reason string per alternative

5. Build volume contribution summary
   - Format: "3 sets chest, 0.9 indirect front delts, 0.6 indirect triceps"

Output:
- ExerciseRationale with:
  * exerciseName: "Bench Press"
  * primaryReasons: ["Fills 50% of chest deficit", "High SFR (4/5)", "Last used 3 weeks ago"]
  * selectionFactors: Complete 7-factor breakdown with scores + explanations
  * citations: Research backing (Maeo, Pedrosa, etc.)
  * alternatives: ["Dumbbell Bench Press", "Incline Bench Press"]
  * volumeContribution: Human-readable muscle breakdown
```

**Key Research Citations:**
- Maeo et al. 2023 - Overhead triceps extensions (+40% growth vs pushdowns)
- Pedrosa et al. 2022 - Lengthened leg extensions (~2× quad hypertrophy vs shortened)
- Wolf et al. 2023 - Lengthened-position meta-analysis (SME = −0.28 advantage)
- Schoenfeld et al. 2017 - Volume dose-response (0.37%/set)
- Robinson et al. 2024 - Proximity to failure dose-response
- Refalo et al. 2023/2024 - 0 RIR vs 1-2 RIR equivalence
- Schoenfeld et al. 2016 - Rest periods (3 min > 1 min for strength/hypertrophy)
- Rhea & Alderman 2004 - Periodization superiority (ES = 0.84)

**KB Citation Mapping (Phase 4.3):**

Citations are automatically matched to exercises via `getCitationsByExercise(exerciseName, lengthPositionScore)`. Matching logic:

| Exercise Pattern | Length Score | Citations Matched |
|-----------------|--------------|-------------------|
| Overhead extension/triceps | ≥4 | Maeo et al. 2023 (overhead triceps) |
| Incline curl | ≥4 | Pedrosa et al. 2023 (incline curls) |
| Leg extension / Quad extension | ≥4 | Pedrosa et al. 2022 (leg extension) |
| Seated leg curl | ≥4 | Maeo et al. 2021 (seated curls) |
| Calf raise (standing) | ≥4 | Kassiano et al. 2023 + Kinoshita et al. 2023 |
| Calf raise (any) | ≥4 | Kassiano et al. 2023 (lengthened calves) |
| Squat (non-leg) | ≥4 | Plotkin et al. 2023 (squat vs thrust) |
| Any lengthened exercise | ≥4 | Wolf et al. 2023 (meta-analysis fallback) |

**Citation Organization by Topic:**
- **Lengthened position** (7 citations): Maeo 2023, Pedrosa 2022/2023, Wolf 2023, Kassiano 2023, Maeo 2021, Kinoshita 2023
- **Volume dose-response** (2 citations): Schoenfeld 2017, Pelland 2024
- **Proximity to failure** (3 citations): Robinson 2024, Refalo 2023/2024
- **Rest periods** (1 citation): Schoenfeld 2016
- **Periodization** (1 citation): Rhea 2004
- **Exercise modality** (2 citations): Haugen 2023, Plotkin 2023

Total: 16 curated research citations sourced from `docs/knowledgebase/hypertrophyandstrengthtraining_researchreport.md`

**Phase 4.4 Deliverables (✅ Complete):**
- `explainPrescriptionRationale()` - Main entry point, generates complete prescription rationale with KB citations
- `explainSetCount()` - Block phase (accumulation/intensification/deload), training age modifiers (+15% advanced, -15% beginner)
- `explainRepTarget()` - Goal-specific rep ranges (hypertrophy 6-10, strength 3-6, etc.), exercise constraints
- `explainLoadChoice()` - Progression type (linear/double/autoregulated), % change, deload context
- `explainRirTarget()` - Mesocycle week (early conservative → late peak), training age RIR accuracy
- `explainRestPeriod()` - Exercise classification (heavy compound/moderate compound/isolation), rep-aware rest
- 41 comprehensive tests (148 cumulative for explainability system)
- Edge cases: deload, exercise constraints, bodyweight exercises, progression types, block phases

**Phase 4.5 Deliverables (✅ Complete):**
- `coach-messages.ts` - 4 message types (warning/encouragement/milestone/tip) with priority levels
- `generateCoachMessages()` - Detects 8 conditions: high fatigue, overreaching, deload trigger, milestone progression, volume caps, SRA warnings, block transitions, training age guidance
- `src/lib/api/explainability.ts` - Orchestration layer, loads DB context + calls all 4 engine explainability modules
- `GET /api/workouts/[id]/explanation` - REST endpoint, returns complete `WorkoutExplanation` JSON
- 20 new tests (168 cumulative for explainability system)

**Phase 4.6 Deliverables (✅ Complete):**
- 6 React components in `src/components/explainability/`:
  - `ExplainabilityPanel.tsx` - Main container, collapsible exercise cards, state management
  - `SessionContextCard.tsx` - Block phase badge, volume grid, readiness color coding, progression timeline
  - `CoachMessageCard.tsx` - Icon + color theming by message type, high-priority badge
  - `ExerciseRationaleCard.tsx` - Selection factor breakdown, KB citation cards with links, alternative exercises
  - `PrescriptionDetails.tsx` - 2×2 grid (sets/reps/load/RIR) + rest period, block/progression context
  - `FilteredExercisesCard.tsx` - Rejected exercise list grouped by hard constraint (avoided / pain / equipment)
- `WorkoutExplanation.tsx` - Client wrapper, fetches explanation API, loading/error states, Map ↔ Record conversion
- Workout page migration: Replaced legacy "Why this workout" section with `<WorkoutExplanation />` component
- 29 component tests (co-located `.test.tsx` files), 863 total tests passing
- Legacy `src/lib/ui/explainability.ts` retained - still used for inline selection badges on workout page

**Phase 4.7 Deliverables (✅ Complete, 2026-02-17): FilteredExercise DB Persistence**
- New `FilteredExercise` DB table (`prisma/migrations/20260217_add_filtered_exercises/`)
- Save route (`/api/workouts/save`) now persists filtered exercises inside the workout transaction
- `generateWorkoutExplanation()` loads `filteredExercises` from DB and maps to `FilteredExerciseSummary[]`
- Explanation route and `WorkoutExplanation` client both thread the data through to `ExplainabilityPanel`
- Result: `FilteredExercisesCard` is now durable — persists across page refreshes and future visits

**Data Flow (Phase 4.5–4.7):**
```text
Generate intent → /api/workouts/generate-from-intent → filteredExercises[] in response
                → IntentRoundTripValidatorCard captures filteredExercises in generatedMetadata

Save workout → /api/workouts/save
             → tx.filteredExercise.deleteMany + createMany (inside transaction)

Workout page → WorkoutExplanation.tsx (client)
             → GET /api/workouts/[id]/explanation
             → src/lib/api/explainability.ts (generateWorkoutExplanation)
                → workout.findUnique (includes filteredExercises: true)
                → mapProfile/mapGoals/mapHistory → engine types
                → explainSessionContext() [engine]
                → generateCoachMessages() [engine]
                → explainExerciseRationale() per exercise [engine]
                → explainPrescriptionRationale() per exercise [engine]
                → map filteredExercises DB records → FilteredExerciseSummary[]
             ← JSON: WorkoutExplanation (Maps converted to Records, filteredExercises as array)
             → ExplainabilityPanel renders 5 card types (incl. FilteredExercisesCard)
```

**References:** ADR-049, ADR-050, ADR-051, ADR-053, ADR-060, ADR-063, docs/plans/phase4-explainability-execution.md, docs/knowledgebase/hypertrophyandstrengthtraining_researchreport.md

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
| **`explainability/`** | **KB citations, session context, exercise/prescription rationale (Phase 4.1+)** |

## Module Cleanup History

**Removed 2026-02-15 (ADR-041):**
- `filtering.ts` - Greedy selection algorithm (replaced by selection-v2)
- `pick-accessories-by-slot.ts` - Slot-based accessory selection (replaced by beam search)
- `src/lib/api/split-preview.ts` - Split preview utility (no longer needed)
- `src/lib/engine/legacy/` - Archived legacy selection code (replaced by selection-v2)

All generation flows now use `selection-v2` (multi-objective beam search).

**Removed 2026-02-17:**
- `split-queue.ts` - History classification and split day calculation (ADR-072). Confirmed dead code: no active imports. `MUSCLE_SPLIT_MAP` lives in `volume-landmarks.ts`.

## Known gaps

- Finding 16 only: stall escalation system beyond deload remains backlog scope and is tracked in `docs/plans/engine-audit-remediation-plan.md`.
- Weekly program analysis now supports mixed template + intent rotations by using history-backed intent-session estimation when a scheduled intent has no matching template.
