# Autoregulation & Readiness Integration: Detailed Implementation Spec

**Component:** Readiness Assessment & Auto-Scaling
**Owner:** Engine + API Team
**Dependencies:** Whoop API, periodization system
**Target:** Phase 3 (Weeks 8-10)

---

## Overview

Integrate multiple readiness signals (Whoop recovery, subjective feedback, performance trends) to automatically scale workout intensity and trigger interventions (deloads, exercise swaps, volume reductions).

**Evidence Base:**
- KB: RPE/RIR-based autoregulation > percentage-based (Mann 2010, APRE ranked #1)
- KB: Recovery metrics (HRV, resting HR, sleep) predict readiness
- KB: Deload every 4-6 weeks proactively, or reactively on stall/fatigue
- KB: Accumulated fatigue increases injury risk and impairs adaptation

---

## Readiness Signal Architecture

### Multi-Modal Readiness

```typescript
// src/lib/engine/readiness/types.ts

export interface ReadinessSignal {
  timestamp: Date
  userId: string

  // Objective wearable data (optional)
  whoop?: {
    recovery: number           // 0-100 (%)
    strain: number             // 0-21
    hrv: number                // ms (RMSSD)
    sleepQuality: number       // 0-100 (%)
    sleepDuration: number      // hours
  }

  // Subjective user input (always available)
  subjective: {
    readiness: 1 | 2 | 3 | 4 | 5      // 1=exhausted, 5=great
    soreness: Map<MuscleGroup, 1 | 2 | 3>  // Per-muscle soreness (1=none, 3=very sore)
    motivation: 1 | 2 | 3 | 4 | 5     // 1=no motivation, 5=eager
    stressLevel?: 1 | 2 | 3 | 4 | 5   // Life stress (1=low, 5=high)
    sleepQuality?: 1 | 2 | 3 | 4 | 5  // Self-reported (if no Whoop)
  }

  // Performance-derived (computed from history)
  performance: {
    rpeVsExpected: number      // Avg(actual RPE - target RPE) last 3 sessions
    repVelocityTrend?: number  // VBT trend (future)
    stallCount: number         // Consecutive sessions without PR
    volumeComplianceRate: number // % of prescribed sets completed
  }
}

export interface FatigueScore {
  overall: number              // 0-1 (0=exhausted, 1=fully fresh)
  perMuscle: Map<Muscle, number> // Muscle-specific fatigue

  // Signal weights (how much we trust each)
  weights: {
    whoop: number
    subjective: number
    performance: number
  }

  // Breakdown for explainability
  components: {
    whoopContribution: number
    subjectiveContribution: number
    performanceContribution: number
  }
}
```

---

## Core Algorithms

### 1. Compute Fatigue Score

```typescript
// src/lib/engine/readiness/compute-fatigue.ts

export function computeFatigueScore(
  signal: ReadinessSignal,
  config: FatigueConfig = DEFAULT_CONFIG
): FatigueScore {
  const { whoop, subjective, performance } = signal

  // Whoop component (if available)
  const whoopScore = whoop ? computeWhoopScore(whoop) : null

  // Subjective component (always available)
  const subjectiveScore = computeSubjectiveScore(subjective)

  // Performance component (if history exists)
  const performanceScore = computePerformanceScore(performance)

  // Weighted average (adjust weights if whoop unavailable)
  const weights = determineWeights(config, whoopScore !== null)

  const overall =
    (whoopScore ?? 0) * weights.whoop +
    subjectiveScore * weights.subjective +
    performanceScore * weights.performance

  // Per-muscle fatigue (from subjective soreness)
  const perMuscle = new Map<Muscle, number>()
  for (const [muscleGroup, soreness] of subjective.soreness) {
    const muscles = MUSCLE_GROUP_MAP[muscleGroup]
    const fatigue = 1 - (soreness - 1) / 2 // 1=none→1.0, 3=very→0.0
    for (const muscle of muscles) {
      perMuscle.set(muscle, fatigue)
    }
  }

  return {
    overall,
    perMuscle,
    weights,
    components: {
      whoopContribution: (whoopScore ?? 0) * weights.whoop,
      subjectiveContribution: subjectiveScore * weights.subjective,
      performanceContribution: performanceScore * weights.performance,
    },
  }
}

function computeWhoopScore(whoop: NonNullable<ReadinessSignal['whoop']>): number {
  // Whoop recovery is already 0-100, normalize to 0-1
  const recoveryScore = whoop.recovery / 100

  // Penalize if strain is very high (>18 = overreaching)
  const strainPenalty = whoop.strain > 18 ? 0.2 : 0

  // Penalize if HRV is low (assume baseline ~50ms, red flag <30ms)
  const hrvScore = Math.min(1, whoop.hrv / 50)

  // Penalize poor sleep
  const sleepScore = whoop.sleepQuality / 100

  // Weighted composite
  return (
    recoveryScore * 0.4 +
    (1 - strainPenalty) * 0.2 +
    hrvScore * 0.2 +
    sleepScore * 0.2
  )
}

function computeSubjectiveScore(subjective: ReadinessSignal['subjective']): number {
  // Normalize 1-5 scales to 0-1
  const readiness = (subjective.readiness - 1) / 4
  const motivation = (subjective.motivation - 1) / 4

  // Stress is inverse (high stress = low readiness)
  const stress = subjective.stressLevel
    ? 1 - (subjective.stressLevel - 1) / 4
    : 0.75 // Assume moderate if not provided

  const sleepQuality = subjective.sleepQuality
    ? (subjective.sleepQuality - 1) / 4
    : null // Use Whoop if available

  return (
    readiness * 0.4 +
    motivation * 0.3 +
    stress * 0.2 +
    (sleepQuality ?? 0.75) * 0.1
  )
}

function computePerformanceScore(performance: ReadinessSignal['performance']): number {
  // RPE deviation: negative = easier than expected (fresh), positive = harder (fatigued)
  const rpeDeviation = -performance.rpeVsExpected // Invert: negative deviation = fresher
  const rpeScore = Math.max(0, Math.min(1, 0.5 + rpeDeviation / 4))

  // Stall count: penalize if stalling
  const stallPenalty = Math.min(0.3, performance.stallCount * 0.1)

  // Volume compliance: low = fatigued
  const complianceScore = performance.volumeComplianceRate

  return (
    rpeScore * 0.5 +
    (1 - stallPenalty) * 0.3 +
    complianceScore * 0.2
  )
}

function determineWeights(
  config: FatigueConfig,
  hasWhoop: boolean
): FatigueScore['weights'] {
  if (hasWhoop) {
    // Trust Whoop heavily
    return {
      whoop: 0.5,
      subjective: 0.3,
      performance: 0.2,
    }
  } else {
    // No Whoop: rely on subjective + performance
    return {
      whoop: 0,
      subjective: 0.6,
      performance: 0.4,
    }
  }
}
```

### 2. Autoregulate Workout Intensity

```typescript
// src/lib/engine/readiness/autoregulate.ts

export interface AutoregulationPolicy {
  aggressiveness: 'conservative' | 'moderate' | 'aggressive'
  allowUpRegulation: boolean  // Can we increase intensity if feeling great?
  allowDownRegulation: boolean // Can we decrease if fatigued?
}

export interface AutoregulatedWorkout {
  original: Workout
  adjusted: Workout
  modifications: AutoregulationModification[]
  rationale: string
}

export interface AutoregulationModification {
  type: 'intensity_scale' | 'volume_reduction' | 'exercise_swap' | 'deload_trigger'
  exerciseId?: string
  original: any
  adjusted: any
  reason: string
}

export function autoregulateWorkout(
  plannedWorkout: Workout,
  fatigueScore: FatigueScore,
  policy: AutoregulationPolicy = DEFAULT_POLICY
): AutoregulatedWorkout {
  const modifications: AutoregulationModification[] = []
  let adjustedWorkout = { ...plannedWorkout }

  // Determine action based on fatigue
  const action = determineAction(fatigueScore.overall, policy)

  switch (action) {
    case 'scale_down':
      adjustedWorkout = scaleIntensity(adjustedWorkout, fatigueScore, 'down', modifications)
      break

    case 'reduce_volume':
      adjustedWorkout = reduceVolume(adjustedWorkout, fatigueScore, modifications)
      break

    case 'trigger_deload':
      adjustedWorkout = convertToDeload(adjustedWorkout, modifications)
      break

    case 'scale_up':
      if (policy.allowUpRegulation) {
        adjustedWorkout = scaleIntensity(adjustedWorkout, fatigueScore, 'up', modifications)
      }
      break

    case 'maintain':
      // No change
      break
  }

  const rationale = generateAutoregulationRationale(fatigueScore, action, modifications)

  return {
    original: plannedWorkout,
    adjusted: adjustedWorkout,
    modifications,
    rationale,
  }
}

function determineAction(
  overallFatigue: number,
  policy: AutoregulationPolicy
): 'scale_down' | 'reduce_volume' | 'trigger_deload' | 'scale_up' | 'maintain' {
  // Thresholds (configurable)
  const DELOAD_THRESHOLD = 0.3
  const SCALE_DOWN_THRESHOLD = 0.5
  const SCALE_UP_THRESHOLD = 0.85

  if (policy.aggressiveness === 'conservative') {
    // Conservative: deload earlier, scale down more readily
    if (overallFatigue < 0.4) return 'trigger_deload'
    if (overallFatigue < 0.6) return 'scale_down'
    if (overallFatigue > 0.9) return 'scale_up'
    return 'maintain'
  }

  if (policy.aggressiveness === 'aggressive') {
    // Aggressive: tolerate more fatigue
    if (overallFatigue < 0.2) return 'trigger_deload'
    if (overallFatigue < 0.4) return 'reduce_volume'
    if (overallFatigue > 0.95) return 'scale_up'
    return 'maintain'
  }

  // Moderate (default)
  if (overallFatigue < DELOAD_THRESHOLD) return 'trigger_deload'
  if (overallFatigue < SCALE_DOWN_THRESHOLD) return 'scale_down'
  if (overallFatigue > SCALE_UP_THRESHOLD && policy.allowUpRegulation) return 'scale_up'
  return 'maintain'
}

function scaleIntensity(
  workout: Workout,
  fatigueScore: FatigueScore,
  direction: 'up' | 'down',
  modifications: AutoregulationModification[]
): Workout {
  const scalar = direction === 'down' ? 0.9 : 1.05 // ±10% / +5%

  const adjustedExercises = workout.exercises.map(ex => {
    // Scale load
    const adjustedSets = ex.sets.map(set => ({
      ...set,
      targetLoad: set.targetLoad ? set.targetLoad * scalar : undefined,
    }))

    // Optionally adjust RIR (down = easier)
    const rirAdjustment = direction === 'down' ? 1 : -0.5
    const adjustedRir = ex.targetRir !== undefined
      ? Math.max(0, Math.min(5, ex.targetRir + rirAdjustment))
      : undefined

    modifications.push({
      type: 'intensity_scale',
      exerciseId: ex.exerciseId,
      original: { load: ex.sets[0].targetLoad, rir: ex.targetRir },
      adjusted: { load: adjustedSets[0].targetLoad, rir: adjustedRir },
      reason: direction === 'down'
        ? `Fatigue score ${fatigueScore.overall.toFixed(2)} → reduce intensity`
        : `Fatigue score ${fatigueScore.overall.toFixed(2)} → increase intensity`,
    })

    return {
      ...ex,
      sets: adjustedSets,
      targetRir: adjustedRir,
    }
  })

  return {
    ...workout,
    exercises: adjustedExercises,
  }
}

function reduceVolume(
  workout: Workout,
  fatigueScore: FatigueScore,
  modifications: AutoregulationModification[]
): Workout {
  // Drop 1-2 sets per exercise, prioritize accessories
  const adjustedExercises = workout.exercises.map(ex => {
    const isMainLift = ex.isMainLift ?? false
    const setsToDrop = isMainLift ? 0 : Math.min(2, ex.sets.length - 2)

    if (setsToDrop === 0) return ex

    const newSets = ex.sets.slice(0, -setsToDrop)

    modifications.push({
      type: 'volume_reduction',
      exerciseId: ex.exerciseId,
      original: ex.sets.length,
      adjusted: newSets.length,
      reason: `Dropped ${setsToDrop} sets due to fatigue`,
    })

    return {
      ...ex,
      sets: newSets,
    }
  })

  return {
    ...workout,
    exercises: adjustedExercises,
  }
}

function convertToDeload(
  workout: Workout,
  modifications: AutoregulationModification[]
): Workout {
  // Deload: 50% volume, 60% intensity
  const adjustedExercises = workout.exercises.map(ex => {
    const keepSets = Math.max(1, Math.floor(ex.sets.length / 2))
    const newSets = ex.sets.slice(0, keepSets).map(set => ({
      ...set,
      targetLoad: set.targetLoad ? set.targetLoad * 0.6 : undefined,
    }))

    modifications.push({
      type: 'deload_trigger',
      exerciseId: ex.exerciseId,
      original: { sets: ex.sets.length, load: ex.sets[0].targetLoad },
      adjusted: { sets: newSets.length, load: newSets[0].targetLoad },
      reason: 'Triggered deload due to accumulated fatigue',
    })

    return {
      ...ex,
      sets: newSets,
      targetRir: 4, // Easy RIR
    }
  })

  return {
    ...workout,
    exercises: adjustedExercises,
    notes: (workout.notes ?? '') + '\n[AUTO-DELOAD TRIGGERED]',
  }
}

function generateAutoregulationRationale(
  fatigueScore: FatigueScore,
  action: string,
  modifications: AutoregulationModification[]
): string {
  const parts: string[] = []

  // Overall assessment
  const fatigueLevel =
    fatigueScore.overall > 0.8 ? 'very fresh' :
    fatigueScore.overall > 0.6 ? 'recovered' :
    fatigueScore.overall > 0.4 ? 'moderately fatigued' :
    'significantly fatigued'

  parts.push(`Fatigue score: ${(fatigueScore.overall * 100).toFixed(0)}% (${fatigueLevel})`)

  // Signal breakdown
  const signals: string[] = []
  if (fatigueScore.weights.whoop > 0) {
    signals.push(`Whoop ${(fatigueScore.components.whoopContribution * 100).toFixed(0)}%`)
  }
  signals.push(`Subjective ${(fatigueScore.components.subjectiveContribution * 100).toFixed(0)}%`)
  signals.push(`Performance ${(fatigueScore.components.performanceContribution * 100).toFixed(0)}%`)

  parts.push(`Based on: ${signals.join(', ')}`)

  // Action taken
  parts.push(`Action: ${action.replace('_', ' ')}`)

  // Modifications
  if (modifications.length > 0) {
    parts.push(`Adjustments: ${modifications.length} changes made`)
  }

  return parts.join('. ')
}
```

---

## Stall Detection & Intervention

### 3. Stall Escalation Ladder

```typescript
// src/lib/engine/readiness/stall-intervention.ts

export interface StallState {
  exerciseId: string
  weeksWithoutProgress: number
  lastPr?: Date
  currentLevel: InterventionLevel
}

export type InterventionLevel =
  | 'none'
  | 'microload'           // 1-2 weeks stall → +1-2 lbs instead of +5
  | 'deload'              // 3 weeks stall → -10% load, rebuild
  | 'variation'           // 5 weeks stall → swap exercise variation
  | 'volume_reset'        // 8 weeks stall → drop to MEV, rebuild
  | 'goal_reassess'       // Persistent → suggest user pivot

export function detectStalls(
  history: WorkoutHistoryEntry[],
  exercises: Exercise[]
): StallState[] {
  const stalls: StallState[] = []

  for (const exercise of exercises) {
    const exerciseHistory = history.filter(h =>
      h.exercises.some(e => e.exerciseId === exercise.id)
    )

    if (exerciseHistory.length < 3) continue // Need history

    const weeksWithoutProgress = countWeeksWithoutProgress(exerciseHistory, exercise.id)

    if (weeksWithoutProgress >= 2) {
      stalls.push({
        exerciseId: exercise.id,
        weeksWithoutProgress,
        lastPr: findLastPr(exerciseHistory, exercise.id),
        currentLevel: 'none',
      })
    }
  }

  return stalls
}

export function suggestIntervention(stall: StallState): {
  level: InterventionLevel
  action: string
  rationale: string
} {
  const weeks = stall.weeksWithoutProgress

  if (weeks >= 8) {
    return {
      level: 'goal_reassess',
      action: 'Consider shifting training focus or consulting coach',
      rationale: `No progress in ${weeks} weeks despite interventions`,
    }
  }

  if (weeks >= 5) {
    return {
      level: 'volume_reset',
      action: 'Drop volume to MEV and rebuild over 4 weeks',
      rationale: 'Accumulated fatigue may be masking strength gains',
    }
  }

  if (weeks >= 4) {
    return {
      level: 'variation',
      action: 'Swap to exercise variation (e.g., front squat → back squat)',
      rationale: 'Break monotony, address weak points with different ROM',
    }
  }

  if (weeks >= 3) {
    return {
      level: 'deload',
      action: 'Deload: reduce load by 10%, rebuild over 2-3 weeks',
      rationale: 'Classic deload to dissipate fatigue',
    }
  }

  if (weeks >= 2) {
    return {
      level: 'microload',
      action: 'Use smaller increments: +1-2 lbs instead of +5 lbs',
      rationale: 'Finer progression to break through plateau',
    }
  }

  return {
    level: 'none',
    action: 'Continue current progression',
    rationale: 'Normal variation, no intervention needed yet',
  }
}

function countWeeksWithoutProgress(
  history: WorkoutHistoryEntry[],
  exerciseId: string
): number {
  // Simplified: count sessions without PR
  let count = 0
  for (const entry of history.slice().reverse()) {
    const ex = entry.exercises.find(e => e.exerciseId === exerciseId)
    if (!ex) continue

    if (ex.isPr) break
    count++
  }

  // Convert sessions to weeks (assume 3 sessions/week)
  return Math.floor(count / 3)
}
```

---

## Whoop API Integration

### 4. Fetch Daily Recovery

```typescript
// src/lib/integrations/whoop.ts

export interface WhoopRecovery {
  date: string         // YYYY-MM-DD
  recovery: number     // 0-100
  strain: number       // 0-21
  hrv: number          // ms
  sleepDuration: number // hours
  sleepQuality: number // 0-100
}

export async function fetchWhoopRecovery(
  userId: string,
  date: Date
): Promise<WhoopRecovery | null> {
  const userIntegration = await prisma.userIntegration.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: 'whoop',
      },
    },
  })

  if (!userIntegration || !userIntegration.accessToken) {
    return null // Not connected
  }

  try {
    // Refresh token if expired
    if (isTokenExpired(userIntegration.expiresAt)) {
      await refreshWhoopToken(userIntegration)
    }

    // Fetch recovery for date
    const response = await fetch(
      `https://api.whoop.com/v1/recovery?date=${formatDate(date)}`,
      {
        headers: {
          Authorization: `Bearer ${userIntegration.accessToken}`,
        },
      }
    )

    if (!response.ok) {
      console.error('Whoop API error:', response.status)
      return null
    }

    const data = await response.json()

    return {
      date: formatDate(date),
      recovery: data.recovery.score,
      strain: data.strain,
      hrv: data.hrv.rmssd,
      sleepDuration: data.sleep.total_hours,
      sleepQuality: data.sleep.quality_score,
    }
  } catch (error) {
    console.error('Whoop integration error:', error)
    return null
  }
}

async function refreshWhoopToken(integration: UserIntegration) {
  const response = await fetch('https://api.whoop.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: integration.refreshToken,
      client_id: process.env.WHOOP_CLIENT_ID,
      client_secret: process.env.WHOOP_CLIENT_SECRET,
    }),
  })

  const data = await response.json()

  await prisma.userIntegration.update({
    where: { id: integration.id },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
  })
}
```

---

## API Routes

### Collect Readiness Signal

```typescript
// src/app/api/readiness/submit/route.ts

export async function POST(request: Request) {
  const userId = await resolveOwner()
  const body = await request.json()

  const parsed = readinessSignalSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const { subjective } = parsed.data

  // Fetch Whoop if connected
  const whoopRecovery = await fetchWhoopRecovery(userId, new Date())

  // Compute performance signals from history
  const history = await loadHistory(userId, { limit: 10 })
  const performance = computePerformanceSignals(history)

  const signal: ReadinessSignal = {
    timestamp: new Date(),
    userId,
    whoop: whoopRecovery ?? undefined,
    subjective,
    performance,
  }

  // Persist
  await prisma.readinessSignal.create({
    data: {
      userId,
      timestamp: signal.timestamp,
      whoopRecovery: signal.whoop as any,
      subjectiveReadiness: subjective.readiness,
      subjectiveSoreness: subjective.soreness as any,
      subjectiveMotivation: subjective.motivation,
      subjectiveStress: subjective.stressLevel,
      performanceRpe: performance.rpeVsExpected,
      performanceStalls: performance.stallCount,
    },
  })

  // Compute fatigue score
  const fatigueScore = computeFatigueScore(signal)

  return NextResponse.json({
    signal,
    fatigueScore,
  })
}
```

---

## UI Components

### Readiness Check-In

```tsx
// src/components/ReadinessCheckIn.tsx

export function ReadinessCheckIn() {
  const [readiness, setReadiness] = useState(3)
  const [motivation, setMotivation] = useState(3)
  const [soreness, setSoreness] = useState<Map<MuscleGroup, number>>(new Map())

  const handleSubmit = async () => {
    await fetch('/api/readiness/submit', {
      method: 'POST',
      body: JSON.stringify({
        subjective: {
          readiness,
          motivation,
          soreness: Object.fromEntries(soreness),
        },
      }),
    })

    // Navigate to workout
  }

  return (
    <div className="max-w-md mx-auto p-6">
      <h2 className="text-2xl font-bold mb-4">How are you feeling today?</h2>

      {/* Readiness slider */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">
          Overall Readiness
        </label>
        <input
          type="range"
          min="1"
          max="5"
          value={readiness}
          onChange={e => setReadiness(Number(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-600">
          <span>Exhausted</span>
          <span>Great</span>
        </div>
      </div>

      {/* Motivation */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">
          Motivation to Train
        </label>
        <input
          type="range"
          min="1"
          max="5"
          value={motivation}
          onChange={e => setMotivation(Number(e.target.value))}
          className="w-full"
        />
      </div>

      {/* Muscle soreness */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">
          Muscle Soreness (optional)
        </label>
        <MuscleSorenessMap soreness={soreness} onChange={setSoreness} />
      </div>

      <button
        onClick={handleSubmit}
        className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold"
      >
        Start Workout
      </button>
    </div>
  )
}
```

---

## Testing

```typescript
// src/lib/engine/readiness/compute-fatigue.test.ts

describe('computeFatigueScore', () => {
  it('heavily weights Whoop when available', () => {
    const signal: ReadinessSignal = {
      timestamp: new Date(),
      userId: 'test',
      whoop: {
        recovery: 30, // Low recovery
        strain: 19,
        hrv: 35,
        sleepQuality: 40,
        sleepDuration: 5,
      },
      subjective: {
        readiness: 5, // Feels great (contradicts Whoop)
        motivation: 5,
        soreness: new Map(),
      },
      performance: {
        rpeVsExpected: 0,
        stallCount: 0,
        volumeComplianceRate: 1.0,
      },
    }

    const score = computeFatigueScore(signal)

    // Should trust Whoop more → low score
    expect(score.overall).toBeLessThan(0.5)
  })

  it('uses subjective when Whoop unavailable', () => {
    const signal: ReadinessSignal = {
      timestamp: new Date(),
      userId: 'test',
      whoop: undefined,
      subjective: {
        readiness: 5,
        motivation: 5,
        soreness: new Map(),
      },
      performance: {
        rpeVsExpected: 0,
        stallCount: 0,
        volumeComplianceRate: 1.0,
      },
    }

    const score = computeFatigueScore(signal)

    expect(score.overall).toBeGreaterThan(0.8) // High readiness
    expect(score.weights.whoop).toBe(0)
    expect(score.weights.subjective).toBeGreaterThan(0.5)
  })
})

describe('autoregulateWorkout', () => {
  it('scales down intensity when fatigued', () => {
    const workout = createMockWorkout({ load: 200 })
    const fatigueScore = { overall: 0.3, perMuscle: new Map(), ... }

    const result = autoregulateWorkout(workout, fatigueScore)

    expect(result.adjusted.exercises[0].sets[0].targetLoad).toBe(180) // 90%
    expect(result.modifications[0].type).toBe('intensity_scale')
  })

  it('triggers deload when very fatigued', () => {
    const workout = createMockWorkout({ sets: 5, load: 200 })
    const fatigueScore = { overall: 0.2, perMuscle: new Map(), ... }

    const result = autoregulateWorkout(workout, fatigueScore)

    expect(result.adjusted.exercises[0].sets.length).toBe(2) // 50% volume
    expect(result.adjusted.exercises[0].sets[0].targetLoad).toBe(120) // 60% intensity
  })
})
```

---

## Migration

### Add ReadinessSignal table

```prisma
model ReadinessSignal {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])

  timestamp  DateTime @default(now())

  // Whoop data (nullable)
  whoopRecovery     Float?
  whoopStrain       Float?
  whoopHrv          Float?
  whoopSleepQuality Float?

  // Subjective (always present)
  subjectiveReadiness  Int  // 1-5
  subjectiveSoreness   Json // Map<MuscleGroup, 1-3>
  subjectiveMotivation Int  // 1-5
  subjectiveStress     Int? // 1-5

  // Performance (computed)
  performanceRpe       Float
  performanceStalls    Int

  @@index([userId, timestamp])
}
```

---

## Next Steps

1. **Whoop OAuth setup** - Register app, test flow
2. **Readiness UI** - Design check-in flow
3. **Autoregulation testing** - Validate scaling logic
4. **Stall detection** - Tune intervention thresholds

**Estimated Effort:** 3 weeks (Phase 3)
