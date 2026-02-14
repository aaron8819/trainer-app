# Multi-Objective Exercise Selection: Detailed Implementation Spec

**Component:** Exercise Selection Optimization Engine
**Owner:** Engine Team
**Dependencies:** Periodization system, indirect volume accounting
**Target:** Phase 2 (Weeks 5-7)

---

## Overview

Replace greedy selection with multi-objective optimization that balances:
- Volume deficits (effective = direct + 0.3×indirect)
- SRA readiness per muscle
- Lengthened-position bias
- Exercise rotation policy
- SFR efficiency
- Movement diversity
- User preferences

**Evidence Base:**
- KB: Lengthened position (Maeo 2023, Kassiano 2023, Pedrosa 2022/2023)
- KB: SFR ratio guides exercise selection
- KB: Rotate 2-4 exercises per muscle per mesocycle
- KB: Front delts MEV = 0 (indirect volume suffices)

---

## Problem Statement

### Current Selection Logic

```typescript
// Simplified current approach (from exercise-selection.ts)
function selectExercises(pool: Exercise[], context: WorkoutContext): Exercise[] {
  const scored = pool.map(ex => ({
    exercise: ex,
    score: computeScore(ex, context),
  }))

  // Greedy: Pick highest scores until time budget exhausted
  const sorted = scored.sort((a, b) => b.score - a.score)
  return sorted.slice(0, maxExercises)
}
```

**Issues:**
1. **Greedy = suboptimal** - Picking best individual exercises may not produce best *combination*
2. **No indirect volume** - After bench (high front delt indirect), might still pick OHP
3. **No rotation memory** - Same accessories repeat too often
4. **Single score** - Can't balance competing objectives transparently

### Desired Behavior

**Example Scenario:**
- User needs 12 sets chest, 8 sets triceps this week
- Has already done bench press (8 sets chest, 4 sets triceps indirect)
- Remaining deficit: 4 sets chest direct, 8 sets triceps direct
- Pool: [Incline DB Press, Cable Fly, Overhead Extension, Pushdowns]

**Optimal Selection:**
- Incline DB Press (3 sets) → fills 3 chest direct, 1 triceps indirect
- Cable Fly (2 sets) → fills 2 chest direct, lengthened bias
- Overhead Extension (4 sets) → fills 4 triceps direct, lengthened bias (Maeo 2023: +40% growth)
- Pushdowns (3 sets) → fills 3 triceps direct, rotation variety

**Result:** Volume filled efficiently, lengthened bias prioritized, rotation balanced

---

## Type Definitions

```typescript
// src/lib/engine/selection/types.ts

export interface SelectionObjective {
  // Hard constraints (MUST satisfy)
  constraints: {
    volumeFloor: Map<Muscle, number>       // MEV per muscle
    volumeCeiling: Map<Muscle, number>     // MRV per muscle (effective volume)
    timeBudget: number                     // Minutes
    equipment: Set<EquipmentType>
    contraindications: Set<ExerciseId>
    minExercises: number                   // Floor (e.g., 3 for intent mode)
    maxExercises: number                   // Ceiling
  }

  // Soft objectives (weighted optimization)
  weights: {
    volumeDeficitFill: number     // 0.30 - Fill gaps in weekly volume
    sfrEfficiency: number         // 0.20 - Higher SFR = more stimulus per fatigue
    lengthenedBias: number        // 0.15 - Exercises loading at long muscle lengths
    movementDiversity: number     // 0.10 - Avoid pattern redundancy
    sraReadiness: number          // 0.10 - Prefer recovered muscles
    rotationNovelty: number       // 0.10 - Penalize recently used
    userPreference: number        // 0.05 - Favorite > neutral > avoid
  }

  // Context modifiers
  blockContext: {
    blockType: BlockType
    intensityBias: IntensityBias
    weekInBlock: number
  }

  volumeContext: {
    weeklyTarget: Map<Muscle, number>      // Sets per muscle this week
    weeklyActual: Map<Muscle, number>      // Sets already done
    effectiveActual: Map<Muscle, number>   // Including indirect (direct + 0.3*indirect)
  }

  sraContext: Map<Muscle, number>          // 0-1, where 1 = fully recovered

  rotationContext: Map<ExerciseId, {
    lastUsed: Date
    weeksAgo: number
    usageCount: number
  }>
}

export interface SelectionCandidate {
  exercise: Exercise
  proposedSets: number

  // Contributions
  volumeContribution: Map<Muscle, { direct: number; indirect: number }>
  timeContribution: number  // Minutes

  // Scores (0-1 normalized)
  scores: {
    deficitFill: number      // How much this fills volume gaps
    sfrScore: number         // Exercise.sfrScore / 5
    lengthenedScore: number  // Exercise.lengthPositionScore / 5
    movementNovelty: number  // Based on recent movement patterns
    sraAlignment: number     // Targets recovered muscles
    rotationNovelty: number  // Weeks since last use / target cadence
    userPreference: number   // 1.0 favorite, 0.5 neutral, 0.0 avoid
  }

  totalScore: number         // Weighted sum
}

export interface SelectionResult {
  selected: SelectionCandidate[]
  rejected: {
    exercise: Exercise
    reason: RejectionReason
  }[]

  // Metrics
  volumeFilled: Map<Muscle, number>        // Effective volume
  volumeDeficit: Map<Muscle, number>       // Remaining gap
  timeUsed: number
  constraintsSatisfied: boolean

  // Explainability
  rationale: {
    overallStrategy: string
    perExercise: Map<ExerciseId, string>
    alternativesConsidered: Map<ExerciseId, Exercise[]>
  }
}

export type RejectionReason =
  | 'equipment_unavailable'
  | 'contraindicated'
  | 'time_budget_exceeded'
  | 'volume_ceiling_reached'
  | 'sra_not_ready'
  | 'dominated_by_better_option'   // Pareto-dominated
  | 'user_avoided'
```

---

## Core Algorithm

### 1. Constraint Satisfaction + Weighted Scoring

```typescript
// src/lib/engine/selection/optimizer.ts

export function selectExercisesOptimized(
  pool: Exercise[],
  objective: SelectionObjective,
  strategy: 'greedy' | 'beam_search' | 'genetic' = 'beam_search'
): SelectionResult {
  // Phase 1: Filter hard constraints
  const feasible = pool.filter(ex => isFeasible(ex, objective.constraints))

  // Phase 2: Build candidates with proposed sets
  const candidates = feasible.map(ex =>
    buildCandidate(ex, objective)
  )

  // Phase 3: Optimize
  switch (strategy) {
    case 'greedy':
      return greedySelection(candidates, objective)
    case 'beam_search':
      return beamSearchSelection(candidates, objective)
    case 'genetic':
      return geneticSelection(candidates, objective)
  }
}

function isFeasible(
  exercise: Exercise,
  constraints: SelectionObjective['constraints']
): boolean {
  // Equipment available
  if (!constraints.equipment.has(exercise.equipment[0])) {
    return false
  }

  // Not contraindicated
  if (constraints.contraindications.has(exercise.id)) {
    return false
  }

  // SRA ready (at least one primary muscle recovered)
  // Checked later in scoring

  return true
}
```

### 2. Candidate Building with Indirect Volume

```typescript
// src/lib/engine/selection/candidate.ts

function buildCandidate(
  exercise: Exercise,
  objective: SelectionObjective
): SelectionCandidate {
  // Propose sets based on volume deficit + block context
  const proposedSets = computeProposedSets(exercise, objective)

  // Compute volume contribution (direct + indirect)
  const volumeContribution = computeVolumeContribution(
    exercise,
    proposedSets
  )

  // Estimate time
  const timeContribution = estimateTime(exercise, proposedSets, objective.blockContext)

  // Score each objective
  const scores = {
    deficitFill: scoreDeficitFill(volumeContribution, objective.volumeContext),
    sfrScore: (exercise.sfrScore ?? 3) / 5,
    lengthenedScore: (exercise.lengthPositionScore ?? 3) / 5,
    movementNovelty: scoreMovementNovelty(exercise, objective),
    sraAlignment: scoreSraAlignment(exercise, objective.sraContext),
    rotationNovelty: scoreRotationNovelty(exercise, objective.rotationContext),
    userPreference: scoreUserPreference(exercise, objective),
  }

  // Weighted total
  const totalScore =
    scores.deficitFill * objective.weights.volumeDeficitFill +
    scores.sfrScore * objective.weights.sfrEfficiency +
    scores.lengthenedScore * objective.weights.lengthenedBias +
    scores.movementNovelty * objective.weights.movementDiversity +
    scores.sraAlignment * objective.weights.sraReadiness +
    scores.rotationNovelty * objective.weights.rotationNovelty +
    scores.userPreference * objective.weights.userPreference

  return {
    exercise,
    proposedSets,
    volumeContribution,
    timeContribution,
    scores,
    totalScore,
  }
}

function computeVolumeContribution(
  exercise: Exercise,
  sets: number
): Map<Muscle, { direct: number; indirect: number }> {
  const contribution = new Map<Muscle, { direct: number; indirect: number }>()

  // Direct volume (primary muscles)
  for (const muscle of exercise.primaryMuscles) {
    contribution.set(muscle, {
      direct: sets,
      indirect: 0,
    })
  }

  // Indirect volume (secondary muscles)
  for (const muscle of exercise.secondaryMuscles ?? []) {
    const existing = contribution.get(muscle) ?? { direct: 0, indirect: 0 }
    contribution.set(muscle, {
      ...existing,
      indirect: existing.indirect + sets,
    })
  }

  return contribution
}

function scoreDeficitFill(
  contribution: Map<Muscle, { direct: number; indirect: number }>,
  volumeContext: SelectionObjective['volumeContext']
): number {
  let totalDeficitFilled = 0
  let totalDeficit = 0

  for (const [muscle, { direct, indirect }] of contribution) {
    const target = volumeContext.weeklyTarget.get(muscle) ?? 0
    const actual = volumeContext.effectiveActual.get(muscle) ?? 0
    const deficit = Math.max(0, target - actual)

    if (deficit === 0) continue

    // Effective contribution (direct + 0.3*indirect)
    const effectiveContribution = direct + (indirect * INDIRECT_SET_MULTIPLIER)

    totalDeficitFilled += Math.min(effectiveContribution, deficit)
    totalDeficit += deficit
  }

  return totalDeficit > 0 ? totalDeficitFilled / totalDeficit : 0
}

function scoreSraAlignment(
  exercise: Exercise,
  sraContext: Map<Muscle, number>
): number {
  // Average SRA readiness across primary muscles
  const readiness = exercise.primaryMuscles.map(m => sraContext.get(m) ?? 1.0)
  return readiness.reduce((sum, r) => sum + r, 0) / readiness.length
}

function scoreRotationNovelty(
  exercise: Exercise,
  rotationContext: SelectionObjective['rotationContext']
): number {
  const exposure = rotationContext.get(exercise.id)
  if (!exposure) return 1.0 // Never used = maximum novelty

  const targetCadence = 3 // weeks
  const novelty = Math.min(1.0, exposure.weeksAgo / targetCadence)

  return novelty
}
```

### 3. Beam Search Selection

```typescript
// src/lib/engine/selection/beam-search.ts

interface BeamState {
  selected: SelectionCandidate[]
  volumeFilled: Map<Muscle, number>  // Effective volume
  timeUsed: number
  score: number
}

function beamSearchSelection(
  candidates: SelectionCandidate[],
  objective: SelectionObjective,
  beamWidth: number = 5,
  maxDepth: number = 10
): SelectionResult {
  // Initial beam: empty state
  let beam: BeamState[] = [{
    selected: [],
    volumeFilled: new Map(),
    timeUsed: 0,
    score: 0,
  }]

  // Iteratively expand beam
  for (let depth = 0; depth < maxDepth; depth++) {
    const nextBeam: BeamState[] = []

    for (const state of beam) {
      // Try adding each candidate
      for (const candidate of candidates) {
        // Skip if already selected
        if (state.selected.some(s => s.exercise.id === candidate.exercise.id)) {
          continue
        }

        // Check constraints
        const newTimeUsed = state.timeUsed + candidate.timeContribution
        if (newTimeUsed > objective.constraints.timeBudget) {
          continue
        }

        const newVolumeFilled = mergeVolume(state.volumeFilled, candidate.volumeContribution)

        // Check volume ceiling
        if (exceedsCeiling(newVolumeFilled, objective.constraints.volumeCeiling)) {
          continue
        }

        // Check min exercises constraint
        if (state.selected.length >= objective.constraints.maxExercises) {
          continue
        }

        // Valid expansion
        const newScore = state.score + candidate.totalScore
        nextBeam.push({
          selected: [...state.selected, candidate],
          volumeFilled: newVolumeFilled,
          timeUsed: newTimeUsed,
          score: newScore,
        })
      }
    }

    // Prune beam: keep top beamWidth states
    beam = nextBeam
      .sort((a, b) => b.score - a.score)
      .slice(0, beamWidth)

    // Early stopping if no improvements
    if (beam.length === 0) break
  }

  // Return best state
  const best = beam[0]

  // Check min exercises constraint
  if (best.selected.length < objective.constraints.minExercises) {
    // Force-add more exercises (greedy fallback)
    const remaining = candidates.filter(c =>
      !best.selected.some(s => s.exercise.id === c.exercise.id)
    )
    while (best.selected.length < objective.constraints.minExercises && remaining.length > 0) {
      const next = remaining.shift()!
      best.selected.push(next)
      best.volumeFilled = mergeVolume(best.volumeFilled, next.volumeContribution)
      best.timeUsed += next.timeContribution
    }
  }

  return buildResult(best, candidates, objective)
}

function mergeVolume(
  existing: Map<Muscle, number>,
  contribution: Map<Muscle, { direct: number; indirect: number }>
): Map<Muscle, number> {
  const merged = new Map(existing)

  for (const [muscle, { direct, indirect }] of contribution) {
    const current = merged.get(muscle) ?? 0
    const effective = direct + (indirect * INDIRECT_SET_MULTIPLIER)
    merged.set(muscle, current + effective)
  }

  return merged
}

function exceedsCeiling(
  volumeFilled: Map<Muscle, number>,
  ceiling: Map<Muscle, number>
): boolean {
  for (const [muscle, filled] of volumeFilled) {
    const limit = ceiling.get(muscle) ?? Infinity
    if (filled > limit) return true
  }
  return false
}
```

### 4. Explainability Generation

```typescript
// src/lib/engine/selection/explainability.ts

function buildResult(
  finalState: BeamState,
  allCandidates: SelectionCandidate[],
  objective: SelectionObjective
): SelectionResult {
  const selected = finalState.selected
  const rejected = allCandidates
    .filter(c => !selected.some(s => s.exercise.id === c.exercise.id))
    .map(c => ({
      exercise: c.exercise,
      reason: inferRejectionReason(c, finalState, objective),
    }))

  // Compute remaining deficits
  const volumeDeficit = new Map<Muscle, number>()
  for (const [muscle, target] of objective.volumeContext.weeklyTarget) {
    const filled = finalState.volumeFilled.get(muscle) ?? 0
    const deficit = Math.max(0, target - filled)
    if (deficit > 0) {
      volumeDeficit.set(muscle, deficit)
    }
  }

  // Check constraint satisfaction
  const meetsMinExercises = selected.length >= objective.constraints.minExercises
  const meetsVolumeFloor = Array.from(objective.constraints.volumeFloor).every(
    ([muscle, floor]) => (finalState.volumeFilled.get(muscle) ?? 0) >= floor
  )
  const withinTimeBudget = finalState.timeUsed <= objective.constraints.timeBudget

  const constraintsSatisfied = meetsMinExercises && meetsVolumeFloor && withinTimeBudget

  // Generate rationale
  const rationale = generateRationale(selected, rejected, objective)

  return {
    selected,
    rejected,
    volumeFilled: finalState.volumeFilled,
    volumeDeficit,
    timeUsed: finalState.timeUsed,
    constraintsSatisfied,
    rationale,
  }
}

function generateRationale(
  selected: SelectionCandidate[],
  rejected: { exercise: Exercise; reason: RejectionReason }[],
  objective: SelectionObjective
): SelectionResult['rationale'] {
  const blockPhase = formatBlockType(objective.blockContext.blockType)
  const weekInBlock = objective.blockContext.weekInBlock + 1

  const overallStrategy = `
    ${blockPhase} (Week ${weekInBlock}): ${formatIntensityBias(objective.blockContext.intensityBias)} focus.
    Prioritizing: volume deficit fill (${objective.weights.volumeDeficitFill}),
    SFR efficiency (${objective.weights.sfrEfficiency}),
    lengthened position (${objective.weights.lengthenedBias}).
  `.trim()

  const perExercise = new Map<ExerciseId, string>()
  const alternativesConsidered = new Map<ExerciseId, Exercise[]>()

  for (const candidate of selected) {
    const reasons: string[] = []

    // Top contributing factor
    const topScore = Object.entries(candidate.scores)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2)

    for (const [key, value] of topScore) {
      if (value > 0.7) {
        reasons.push(formatScoreReason(key, value, candidate.exercise))
      }
    }

    // Volume contribution
    const volumeStr = formatVolumeContribution(candidate.volumeContribution)
    reasons.push(volumeStr)

    perExercise.set(candidate.exercise.id, reasons.join('. '))

    // Find alternatives (same primary muscle, not selected)
    const alternatives = rejected
      .filter(r =>
        r.exercise.primaryMuscles[0] === candidate.exercise.primaryMuscles[0] &&
        r.reason !== 'user_avoided'
      )
      .map(r => r.exercise)
      .slice(0, 3)

    alternativesConsidered.set(candidate.exercise.id, alternatives)
  }

  return {
    overallStrategy,
    perExercise,
    alternativesConsidered,
  }
}

function formatScoreReason(key: string, value: number, exercise: Exercise): string {
  switch (key) {
    case 'deficitFill':
      return `Fills volume gap (${Math.round(value * 100)}% of deficit)`
    case 'lengthenedScore':
      return `Loads muscle at long length (score ${exercise.lengthPositionScore}/5)`
    case 'sfrScore':
      return `High stimulus-to-fatigue ratio (${exercise.sfrScore}/5)`
    case 'rotationNovelty':
      return `Haven't done this exercise recently`
    case 'sraAlignment':
      return `Targets recovered muscle groups`
    case 'userPreference':
      return `User marked as favorite`
    default:
      return ''
  }
}

function formatVolumeContribution(
  contribution: Map<Muscle, { direct: number; indirect: number }>
): string {
  const parts: string[] = []

  for (const [muscle, { direct, indirect }] of contribution) {
    if (direct > 0) {
      parts.push(`${direct} sets ${muscle}`)
    }
    if (indirect > 0) {
      parts.push(`${indirect} indirect ${muscle}`)
    }
  }

  return `Contributes: ${parts.join(', ')}`
}
```

---

## Integration with Existing System

### Replace Current Selection Call

```typescript
// src/lib/api/template-session.ts (modified)

export async function generateSessionFromTemplate(...) {
  // ... existing code ...

  // OLD:
  // const selected = selectExercises({ mode: 'intent', ... })

  // NEW:
  const selectionResult = selectExercisesOptimized(
    exercisePool,
    buildSelectionObjective(context, blockContext),
    'beam_search'
  )

  // Use selectionResult.selected
  const workout = prescribeWorkout(selectionResult.selected, ...)

  // Attach explainability
  workout.selectionRationale = selectionResult.rationale

  return workout
}

function buildSelectionObjective(
  context: WorkoutContext,
  block: TrainingBlock
): SelectionObjective {
  // Compute volume deficits
  const weeklyTarget = computeWeeklyVolumeTarget(context.goals, block)
  const weeklyActual = computeWeeklyActual(context.history)
  const effectiveActual = computeEffectiveVolume(weeklyActual, context.history)

  // Compute SRA readiness
  const sraContext = buildMuscleRecoveryMap(context.history, context.checkIn)

  // Load rotation context
  const rotationContext = await loadExerciseExposure(context.userId)

  return {
    constraints: {
      volumeFloor: getVolumeFloor(context.goals),
      volumeCeiling: getVolumeCeiling(block.volumeTarget),
      timeBudget: context.sessionMinutes,
      equipment: new Set(context.constraints.equipment),
      contraindications: new Set(context.preferences.avoidExerciseIds),
      minExercises: 3,
      maxExercises: 8,
    },
    weights: DEFAULT_SELECTION_WEIGHTS,
    blockContext: {
      blockType: block.blockType,
      intensityBias: block.intensityBias,
      weekInBlock: block.currentWeekInBlock,
    },
    volumeContext: {
      weeklyTarget,
      weeklyActual,
      effectiveActual,
    },
    sraContext,
    rotationContext,
  }
}
```

---

## Testing

### Unit Tests

```typescript
// src/lib/engine/selection/optimizer.test.ts

describe('selectExercisesOptimized', () => {
  it('respects indirect volume in deficit calculation', () => {
    const pool = [
      createExercise({
        id: 'bench_press',
        primaryMuscles: ['chest'],
        secondaryMuscles: ['front_delts', 'triceps'],
      }),
      createExercise({
        id: 'overhead_press',
        primaryMuscles: ['front_delts'],
        secondaryMuscles: ['triceps'],
      }),
    ]

    const objective = {
      constraints: { ...defaultConstraints },
      weights: DEFAULT_SELECTION_WEIGHTS,
      volumeContext: {
        weeklyTarget: new Map([
          ['chest', 12],
          ['front_delts', 8],
        ]),
        weeklyActual: new Map([
          ['chest', 8], // From bench press
        ]),
        effectiveActual: new Map([
          ['chest', 8],
          ['front_delts', 2.4], // 8 sets × 0.3 indirect from bench
        ]),
      },
      sraContext: new Map([
        ['chest', 1.0],
        ['front_delts', 0.6], // Partially recovered
      ]),
      rotationContext: new Map(),
      blockContext: defaultBlockContext,
    }

    const result = selectExercisesOptimized(pool, objective, 'greedy')

    // Should NOT select OHP because front delts have 2.4 effective sets already
    // and SRA is only 0.6
    const selectedIds = result.selected.map(c => c.exercise.id)
    expect(selectedIds).not.toContain('overhead_press')
  })

  it('prioritizes lengthened-position exercises', () => {
    const pool = [
      createExercise({
        id: 'overhead_extension',
        primaryMuscles: ['triceps'],
        lengthPositionScore: 5, // Maeo 2023: +40% growth
      }),
      createExercise({
        id: 'pushdown',
        primaryMuscles: ['triceps'],
        lengthPositionScore: 2,
      }),
    ]

    const objective = {
      ...defaultObjective,
      weights: {
        ...DEFAULT_SELECTION_WEIGHTS,
        lengthenedBias: 0.5, // High weight
      },
    }

    const result = selectExercisesOptimized(pool, objective, 'greedy')

    expect(result.selected[0].exercise.id).toBe('overhead_extension')
  })

  it('enforces rotation novelty', () => {
    const pool = [
      createExercise({ id: 'incline_db', primaryMuscles: ['chest'] }),
      createExercise({ id: 'cable_fly', primaryMuscles: ['chest'] }),
    ]

    const objective = {
      ...defaultObjective,
      rotationContext: new Map([
        ['incline_db', { lastUsed: new Date('2026-02-07'), weeksAgo: 1, usageCount: 5 }],
        ['cable_fly', { lastUsed: new Date('2026-01-24'), weeksAgo: 3, usageCount: 2 }],
      ]),
    }

    const result = selectExercisesOptimized(pool, objective, 'greedy')

    // Should prefer cable_fly (3 weeks ago) over incline_db (1 week ago)
    expect(result.selected[0].exercise.id).toBe('cable_fly')
  })
})
```

---

## Performance Considerations

### Beam Search Complexity

- **Beam width = 5, Max depth = 10:**
  - Worst case: 5 × 10 × |candidates| = ~500 state evaluations
  - With |candidates| ≈ 50, this is ~25,000 operations
  - Each operation is O(M) where M = number of muscles (~18)
  - Total: ~450,000 ops → **< 10ms** on modern CPU

### Caching Strategy

```typescript
// Cache expensive computations
const volumeCache = new Map<string, Map<Muscle, number>>()

function computeEffectiveVolumeCached(
  workouts: Workout[],
  cacheKey: string
): Map<Muscle, number> {
  if (volumeCache.has(cacheKey)) {
    return volumeCache.get(cacheKey)!
  }

  const result = computeEffectiveVolume(workouts)
  volumeCache.set(cacheKey, result)
  return result
}
```

---

## UI Integration

### Display Selection Rationale

```tsx
// src/components/SelectionRationalePanel.tsx

export function SelectionRationalePanel({
  rationale,
  selected,
}: {
  rationale: SelectionResult['rationale']
  selected: SelectionCandidate[]
}) {
  return (
    <div className="bg-gray-50 p-4 rounded-lg">
      <h3 className="font-semibold mb-2">Why These Exercises?</h3>
      <p className="text-sm text-gray-700 mb-4">{rationale.overallStrategy}</p>

      <div className="space-y-3">
        {selected.map(candidate => (
          <div key={candidate.exercise.id} className="border-l-2 border-blue-500 pl-3">
            <p className="font-medium">{candidate.exercise.name}</p>
            <p className="text-sm text-gray-600">
              {rationale.perExercise.get(candidate.exercise.id)}
            </p>

            {/* Alternatives */}
            {rationale.alternativesConsidered.get(candidate.exercise.id)?.length > 0 && (
              <details className="mt-1">
                <summary className="text-xs text-gray-500 cursor-pointer">
                  Alternatives considered
                </summary>
                <ul className="text-xs text-gray-500 ml-4 mt-1">
                  {rationale.alternativesConsidered.get(candidate.exercise.id)!.map(alt => (
                    <li key={alt.id}>• {alt.name}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## Migration Path

### Phase 2A: Build optimizer (Week 5)

1. Implement `buildCandidate` with indirect volume
2. Implement scoring functions
3. Implement beam search

### Phase 2B: Integration (Week 6)

4. Wire into `generateSessionFromTemplate`
5. Build `SelectionObjective` from context
6. Generate rationale

### Phase 2C: Testing + Tuning (Week 7)

7. Validate against real user data
8. Tune weights based on outcomes
9. A/B test vs. current selection

---

## Next Steps

1. **Prototype beam search** - Validate performance
2. **Define weight tuning strategy** - How to adjust post-launch
3. **Build rationale UI** - Design review
4. **Load testing** - Ensure < 100ms selection time

**Estimated Effort:** 3 weeks (Phase 2)
