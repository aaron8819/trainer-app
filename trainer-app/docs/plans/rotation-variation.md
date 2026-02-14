# Exercise Rotation & Variation Strategy: Detailed Implementation Spec

**Component:** Systematic Exercise Rotation
**Owner:** Engine Team
**Dependencies:** ExerciseExposure table, periodization system
**Target:** Phase 2 (Weeks 5-7)

---

## Overview

Implement systematic exercise rotation that balances **consistency** (track progress) with **variety** (novel stimuli, joint health, adherence).

**Evidence Base:**
- KB: "Rotate 2-4 exercises per muscle group per mesocycle"
- KB: "Maintain core movements for 2-3 mesocycles to allow progressive overload tracking"
- KB: "Non-uniform hypertrophy - different exercises grow different regions of same muscle"
- KB: Rotating exercises manages joint stress and prevents adaptation

---

## Rotation Philosophy

### Three-Tier Exercise Classification

```typescript
// src/lib/engine/rotation/types.ts

export type ExerciseClassification =
  | 'core_movement'         // Track long-term (6-12 weeks)
  | 'primary_accessory'     // Rotate every meso (4-6 weeks)
  | 'secondary_accessory'   // Rotate frequently (2-3 weeks)

export interface ExerciseRotationPolicy {
  coreMovements: {
    exercises: ExerciseId[]        // e.g., Squat, Bench, Deadlift
    retentionDuration: number      // Weeks to maintain (8-12)
    variationStrategy: 'maintain' | 'rotate_variation'
    variations?: Map<ExerciseId, ExerciseId[]>
  }

  primaryAccessories: {
    poolPerMuscle: Map<Muscle, ExerciseId[]>
    rotationCadence: number        // Weeks (default: 4)
    exposureTarget: number         // Unique exercises per macro cycle
  }

  secondaryAccessories: {
    poolPerMuscle: Map<Muscle, ExerciseId[]>
    rotationCadence: number        // Weeks (default: 2)
    noveltyRatio: number           // 0-1: proportion of new vs. repeated
  }
}
```

---

## Core Algorithms

### 1. Classify Exercises

```typescript
// src/lib/engine/rotation/classify.ts

export function classifyExercise(
  exercise: Exercise,
  blockContext: TrainingBlock,
  userProfile: TrainingProfile
): ExerciseClassification {
  // Main lifts are always core movements
  if (exercise.isMainLiftEligible && blockContext.mainLifts.includes(exercise.id)) {
    return 'core_movement'
  }

  // Compounds for primary muscle groups → primary accessories
  if (
    exercise.isCompound &&
    isPrimaryMuscleForGoal(exercise.primaryMuscles[0], userProfile.goal)
  ) {
    return 'primary_accessory'
  }

  // Everything else → secondary accessories
  return 'secondary_accessory'
}

function isPrimaryMuscleForGoal(muscle: Muscle, goal: TrainingGoal): boolean {
  const primaryMuscles: Record<TrainingGoal, Muscle[]> = {
    strength: ['quads', 'chest', 'lats'],
    hypertrophy: ['quads', 'chest', 'lats', 'shoulders', 'hamstrings'],
    fat_loss: ['quads', 'chest', 'lats'], // Compounds for calorie burn
    general_health: [],
  }

  return primaryMuscles[goal]?.includes(muscle) ?? false
}
```

### 2. Select Exercises with Rotation Memory

```typescript
// src/lib/engine/rotation/select-with-rotation.ts

export interface RotationContext {
  exposure: Map<ExerciseId, {
    lastUsed: Date
    weeksAgo: number
    usageCount: number
    performanceTrend: 'improving' | 'stalled' | 'declining'
  }>

  currentBlock: TrainingBlock
  weekInBlock: number
  mesocycleStart: Date
}

export function selectExercisesWithRotation(
  pool: Exercise[],
  targetMuscle: Muscle,
  classification: ExerciseClassification,
  context: RotationContext
): Exercise[] {
  switch (classification) {
    case 'core_movement':
      return selectCoreMovements(pool, targetMuscle, context)

    case 'primary_accessory':
      return selectPrimaryAccessories(pool, targetMuscle, context)

    case 'secondary_accessory':
      return selectSecondaryAccessories(pool, targetMuscle, context)
  }
}

function selectCoreMovements(
  pool: Exercise[],
  targetMuscle: Muscle,
  context: RotationContext
): Exercise[] {
  // Core movements: maintain unless explicitly rotated
  const current = context.currentBlock.mainLifts

  // Check if it's time to rotate (end of retention period)
  const shouldRotate = context.currentBlock.rotationPolicy.mainLifts === 'rotate_variation'

  if (!shouldRotate) {
    return pool.filter(ex => current.includes(ex.id))
  }

  // Rotate to variation
  const rotated = current.map(coreId => {
    const variations = context.currentBlock.rotationPolicy.variations?.get(coreId) ?? []
    const exposure = context.exposure.get(coreId)

    // If performance stalled, rotate to variation
    if (exposure?.performanceTrend === 'stalled' && variations.length > 0) {
      // Pick least-recently-used variation
      const sorted = variations
        .map(varId => ({
          id: varId,
          weeksAgo: context.exposure.get(varId)?.weeksAgo ?? Infinity,
        }))
        .sort((a, b) => b.weeksAgo - a.weeksAgo)

      return sorted[0].id
    }

    return coreId
  })

  return pool.filter(ex => rotated.includes(ex.id))
}

function selectPrimaryAccessories(
  pool: Exercise[],
  targetMuscle: Muscle,
  context: RotationContext
): Exercise[] {
  const poolForMuscle = pool.filter(ex => ex.primaryMuscles.includes(targetMuscle))

  const rotationCadence = 4 // weeks
  const exposureTarget = 3  // exercises per muscle per macro

  // Score each exercise
  const scored = poolForMuscle.map(ex => {
    const exposure = context.exposure.get(ex.id)

    // Novelty score (prefer not recently used)
    const novelty = exposure
      ? Math.min(1, exposure.weeksAgo / rotationCadence)
      : 1.0

    // Performance score (keep exercises where we're progressing)
    const performance = exposure?.performanceTrend === 'improving' ? 1.2 : 1.0

    // Diversity score (prefer different movement patterns)
    const diversity = computeMovementDiversity(ex, context)

    return {
      exercise: ex,
      score: novelty * 0.5 + performance * 0.3 + diversity * 0.2,
    }
  })

  // Return top N
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, exposureTarget)
    .map(s => s.exercise)
}

function selectSecondaryAccessories(
  pool: Exercise[],
  targetMuscle: Muscle,
  context: RotationContext
): Exercise[] {
  const poolForMuscle = pool.filter(ex => ex.primaryMuscles.includes(targetMuscle))

  const rotationCadence = 2 // weeks
  const noveltyRatio = 0.3  // 30% new each time

  // Split into "familiar" and "novel"
  const familiar = poolForMuscle.filter(ex => {
    const exposure = context.exposure.get(ex.id)
    return exposure && exposure.weeksAgo < rotationCadence
  })

  const novel = poolForMuscle.filter(ex => {
    const exposure = context.exposure.get(ex.id)
    return !exposure || exposure.weeksAgo >= rotationCadence
  })

  // Sample from both pools
  const numNovel = Math.floor(2 * noveltyRatio)
  const numFamiliar = 2 - numNovel

  const selected = [
    ...sampleRandom(novel, numNovel),
    ...sampleRandom(familiar, numFamiliar),
  ]

  return selected
}

function computeMovementDiversity(
  exercise: Exercise,
  context: RotationContext
): number {
  // Check if this movement pattern was recently used
  const recentPatterns = Array.from(context.exposure.values())
    .filter(exp => exp.weeksAgo < 2)
    .map(exp => {
      // Look up exercise to get its patterns
      // (would need exercise lookup here)
      return [] // placeholder
    })
    .flat()

  // Penalize if exercise's patterns overlap with recent
  const overlap = exercise.movementPatterns.filter(p =>
    recentPatterns.includes(p)
  ).length

  return Math.max(0, 1 - (overlap / exercise.movementPatterns.length))
}
```

### 3. Variation Substitution

```typescript
// src/lib/engine/rotation/variations.ts

export interface ExerciseVariation {
  baseExercise: ExerciseId
  variation: ExerciseId
  variationType: 'tempo' | 'rom' | 'loading' | 'stability' | 'angle'
  description: string
}

export const EXERCISE_VARIATIONS: ExerciseVariation[] = [
  // Squat variations
  {
    baseExercise: 'barbell_back_squat',
    variation: 'front_squat',
    variationType: 'angle',
    description: 'Upright torso, quad-dominant',
  },
  {
    baseExercise: 'barbell_back_squat',
    variation: 'pause_squat',
    variationType: 'tempo',
    description: '2s pause at bottom, builds strength in hole',
  },
  {
    baseExercise: 'barbell_back_squat',
    variation: 'box_squat',
    variationType: 'rom',
    description: 'Sit on box, teaches hip hinge',
  },
  {
    baseExercise: 'barbell_back_squat',
    variation: 'goblet_squat',
    variationType: 'loading',
    description: 'Front-loaded, beginner-friendly',
  },

  // Bench variations
  {
    baseExercise: 'barbell_bench_press',
    variation: 'close_grip_bench',
    variationType: 'angle',
    description: 'Triceps emphasis',
  },
  {
    baseExercise: 'barbell_bench_press',
    variation: 'dumbbell_bench_press',
    variationType: 'stability',
    description: 'Greater ROM, unilateral demand',
  },
  {
    baseExercise: 'barbell_bench_press',
    variation: 'pause_bench',
    variationType: 'tempo',
    description: 'Paused on chest, builds explosiveness',
  },
  {
    baseExercise: 'barbell_bench_press',
    variation: 'incline_barbell_bench',
    variationType: 'angle',
    description: 'Upper chest emphasis',
  },

  // Deadlift variations
  {
    baseExercise: 'conventional_deadlift',
    variation: 'sumo_deadlift',
    variationType: 'angle',
    description: 'Wide stance, quad-dominant',
  },
  {
    baseExercise: 'conventional_deadlift',
    variation: 'romanian_deadlift',
    variationType: 'rom',
    description: 'Partial ROM, hamstring emphasis',
  },
  {
    baseExercise: 'conventional_deadlift',
    variation: 'trap_bar_deadlift',
    variationType: 'loading',
    description: 'Neutral grip, less spinal stress',
  },
  {
    baseExercise: 'conventional_deadlift',
    variation: 'deficit_deadlift',
    variationType: 'rom',
    description: 'Standing on platform, greater ROM',
  },
]

export function suggestVariation(
  baseExercise: ExerciseId,
  reason: 'stall' | 'joint_pain' | 'novelty',
  context: RotationContext
): ExerciseVariation | null {
  const variations = EXERCISE_VARIATIONS.filter(v => v.baseExercise === baseExercise)

  if (variations.length === 0) return null

  // Filter by reason
  let filtered = variations

  if (reason === 'stall') {
    // For stalls, prefer different loading or ROM
    filtered = variations.filter(v =>
      v.variationType === 'loading' || v.variationType === 'rom'
    )
  }

  if (reason === 'joint_pain') {
    // For pain, prefer different angle or stability
    filtered = variations.filter(v =>
      v.variationType === 'angle' || v.variationType === 'stability'
    )
  }

  // Pick least-recently-used
  const sorted = filtered
    .map(v => ({
      variation: v,
      weeksAgo: context.exposure.get(v.variation)?.weeksAgo ?? Infinity,
    }))
    .sort((a, b) => b.weeksAgo - a.weeksAgo)

  return sorted[0]?.variation ?? null
}
```

---

## Performance Tracking

### 4. Assess Performance Trend

```typescript
// src/lib/engine/rotation/performance.ts

export type PerformanceTrend = 'improving' | 'stalled' | 'declining'

export function assessPerformanceTrend(
  exerciseId: ExerciseId,
  history: WorkoutHistoryEntry[]
): PerformanceTrend {
  const exerciseHistory = history
    .filter(h => h.exercises.some(e => e.exerciseId === exerciseId))
    .slice(-6) // Last 6 sessions

  if (exerciseHistory.length < 3) return 'improving' // Assume improving if insufficient data

  // Extract estimated 1RMs
  const oneRMs = exerciseHistory.map(h => {
    const ex = h.exercises.find(e => e.exerciseId === exerciseId)!
    return estimate1RM(ex.sets[0].weight, ex.sets[0].reps)
  })

  // Compute trend (linear regression)
  const slope = linearRegressionSlope(oneRMs)

  if (slope > 0.01) return 'improving'      // +1% per session
  if (slope < -0.01) return 'declining'     // -1% per session
  return 'stalled'
}

function linearRegressionSlope(values: number[]): number {
  const n = values.length
  const x = Array.from({ length: n }, (_, i) => i)
  const y = values

  const sumX = x.reduce((a, b) => a + b, 0)
  const sumY = y.reduce((a, b) => a + b, 0)
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0)
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0)

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)

  return slope
}

function estimate1RM(weight: number, reps: number): number {
  // Brzycki formula
  return weight * (36 / (37 - reps))
}
```

---

## API Integration

### Update ExerciseExposure

```typescript
// src/lib/api/exercise-exposure.ts

export async function updateExerciseExposure(
  userId: string,
  workoutId: string
) {
  const workout = await prisma.workout.findUnique({
    where: { id: workoutId },
    include: { exercises: true },
  })

  if (!workout) return

  for (const exercise of workout.exercises) {
    const history = await prisma.workout.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        exercises: {
          some: { exerciseId: exercise.exerciseId },
        },
      },
      include: { exercises: true },
      orderBy: { date: 'desc' },
      take: 10,
    })

    const trend = assessPerformanceTrend(exercise.exerciseId, mapHistory(history))

    await prisma.exerciseExposure.upsert({
      where: {
        userId_exerciseId: {
          userId,
          exerciseId: exercise.exerciseId,
        },
      },
      create: {
        userId,
        exerciseId: exercise.exerciseId,
        lastUsed: workout.date,
        usageCount: 1,
        performance: { trend },
      },
      update: {
        lastUsed: workout.date,
        usageCount: { increment: 1 },
        performance: { trend },
      },
    })
  }
}
```

---

## UI Components

### Rotation Notification

```tsx
// src/components/RotationNotification.tsx

export function RotationNotification({
  oldExercise,
  newExercise,
  reason,
}: {
  oldExercise: Exercise
  newExercise: Exercise
  reason: string
}) {
  return (
    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
      <div className="flex items-start">
        <RefreshIcon className="h-5 w-5 text-yellow-400 mt-0.5 mr-3" />
        <div>
          <h4 className="font-semibold text-yellow-900">Exercise Rotated</h4>
          <p className="text-sm text-yellow-800 mt-1">
            Swapped <strong>{oldExercise.name}</strong> for{' '}
            <strong>{newExercise.name}</strong>
          </p>
          <p className="text-xs text-yellow-700 mt-1">
            {reason}
          </p>
        </div>
      </div>
    </div>
  )
}
```

### Exercise Performance Badge

```tsx
// src/components/ExercisePerformanceBadge.tsx

export function ExercisePerformanceBadge({
  trend,
}: {
  trend: PerformanceTrend
}) {
  const config = {
    improving: {
      icon: TrendingUpIcon,
      color: 'text-green-600',
      bg: 'bg-green-50',
      label: 'Improving',
    },
    stalled: {
      icon: MinusIcon,
      color: 'text-yellow-600',
      bg: 'bg-yellow-50',
      label: 'Plateau',
    },
    declining: {
      icon: TrendingDownIcon,
      color: 'text-red-600',
      bg: 'bg-red-50',
      label: 'Declining',
    },
  }[trend]

  const Icon = config.icon

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${config.bg} ${config.color}`}>
      <Icon className="h-3 w-3 mr-1" />
      {config.label}
    </span>
  )
}
```

---

## Testing

```typescript
// src/lib/engine/rotation/select-with-rotation.test.ts

describe('selectPrimaryAccessories', () => {
  it('rotates accessories every 4 weeks', () => {
    const pool = [
      createExercise({ id: 'incline_db', primaryMuscles: ['chest'] }),
      createExercise({ id: 'cable_fly', primaryMuscles: ['chest'] }),
      createExercise({ id: 'machine_press', primaryMuscles: ['chest'] }),
    ]

    const context: RotationContext = {
      exposure: new Map([
        ['incline_db', { lastUsed: new Date('2026-01-01'), weeksAgo: 6, usageCount: 10, performanceTrend: 'stalled' }],
        ['cable_fly', { lastUsed: new Date('2026-02-01'), weeksAgo: 2, usageCount: 3, performanceTrend: 'improving' }],
        // machine_press never used
      ]),
      currentBlock: mockBlock,
      weekInBlock: 0,
      mesocycleStart: new Date('2026-02-01'),
    }

    const selected = selectPrimaryAccessories(pool, 'chest', context)

    // Should prefer machine_press (novel) and cable_fly (improving)
    // Should avoid incline_db (stalled)
    const selectedIds = selected.map(ex => ex.id)
    expect(selectedIds).toContain('machine_press')
    expect(selectedIds).toContain('cable_fly')
    expect(selectedIds).not.toContain('incline_db')
  })
})

describe('assessPerformanceTrend', () => {
  it('detects improving trend', () => {
    const history = [
      createHistory({ exerciseId: 'bench', weight: 200, reps: 5 }),
      createHistory({ exerciseId: 'bench', weight: 205, reps: 5 }),
      createHistory({ exerciseId: 'bench', weight: 210, reps: 5 }),
    ]

    const trend = assessPerformanceTrend('bench', history)

    expect(trend).toBe('improving')
  })

  it('detects stall', () => {
    const history = [
      createHistory({ exerciseId: 'bench', weight: 200, reps: 5 }),
      createHistory({ exerciseId: 'bench', weight: 200, reps: 5 }),
      createHistory({ exerciseId: 'bench', weight: 200, reps: 5 }),
    ]

    const trend = assessPerformanceTrend('bench', history)

    expect(trend).toBe('stalled')
  })
})
```

---

## Rotation Schedule Example

### Beginner Hypertrophy (12 weeks)

| Week | Core Movements | Primary Accessories | Secondary Accessories |
|------|---------------|--------------------|-----------------------|
| 1-4  | Back Squat, Bench, Deadlift | Incline DB, Cable Fly, Leg Curl | Lateral Raise, Tricep Pushdown |
| 5-8  | Back Squat, Bench, Deadlift | Machine Press, Pec Deck, RDL | Rear Delt Fly, Overhead Extension |
| 9-12 | Front Squat, DB Bench, Trap Bar DL | Incline DB, Cable Fly, Leg Curl | Face Pull, Cable Curl |

**Rotation Logic:**
- **Core:** Maintain Weeks 1-8, rotate to variations Week 9
- **Primary:** Rotate at each mesocycle boundary (Week 5, 9)
- **Secondary:** Rotate every 2-3 weeks

---

## User Communication

### Explain Rotation to User

```
"We're rotating some of your exercises this week to:

1. **Prevent adaptation** - Your muscles adapt to the same stimulus over time
2. **Manage joint stress** - Varying exercises reduces repetitive strain
3. **Target different muscle regions** - Different exercises hit different fibers
4. **Keep training fresh** - Variety improves adherence

You'll keep your main lifts (Squat, Bench, Deadlift) consistent for tracking progress,
but accessories will rotate every 4 weeks. We're swapping:

- ✕ Incline Dumbbell Press → ✓ Machine Chest Press (stalled for 3 weeks)
- ✕ Leg Curl → ✓ Romanian Deadlift (better hamstring stretch)

Your new exercises have similar muscle targets but different movement patterns."
```

---

## Next Steps

1. **Implement `selectWithRotation`** - Core rotation logic
2. **Build variation database** - Map all exercise variations
3. **Wire into selection** - Replace static selection
4. **Update ExposureExposure** - Track performance trends
5. **UI components** - Rotation notifications

**Estimated Effort:** Included in Phase 2 (3 weeks)
