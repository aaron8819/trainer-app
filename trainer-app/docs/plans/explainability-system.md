# Explainability & Coach-Like Communication: Detailed Implementation Spec

**Component:** Transparent Rationale Generation
**Owner:** Engine + UI Team
**Dependencies:** Selection optimization, periodization system
**Target:** Phase 4 (Weeks 11-12)

---

## Overview

Transform the "black box" workout generator into a transparent, coach-like system that explains *why* each exercise was selected, *what* the session is trying to accomplish, and *how* it fits into the broader training plan.

**Evidence Base:**
- KB citations for exercise selection (e.g., "Overhead extensions: Maeo 2023 showed +40% triceps growth")
- Training principles (progressive overload, SRA, volume landmarks)
- User trust increases with transparency (research-backed recommendations)

---

## Rationale Types

### Three Levels of Explainability

```typescript
// src/lib/engine/explainability/types.ts

export interface WorkoutExplanation {
  // Macro-level: "Why this workout today?"
  sessionContext: SessionContextExplanation

  // Meso-level: "Why these exercises?"
  exerciseRationale: Map<ExerciseId, ExerciseRationale>

  // Micro-level: "Why these sets/reps/loads?"
  prescriptionRationale: Map<ExerciseId, PrescriptionRationale>

  // Coaching messages
  coachMessages: CoachMessage[]
}

export interface SessionContextExplanation {
  // Block context
  blockPhase: string                  // "Week 2 of Accumulation"
  blockGoal: string                   // "Building volume capacity at moderate intensity"

  // Volume status
  weeklyProgress: string              // "14/20 chest sets this week (at MAV)"

  // Recovery/readiness
  readinessAssessment: string         // "Whoop recovery 68% - normal intensity maintained"

  // Progression decision
  progressionUpdate: string           // "Squat +5lbs (hit 3x5 @ RPE 8 last session)"

  // Deload/adaptation triggers
  specialConditions?: string[]        // ["Early deload triggered - 3 weeks without progress"]
}

export interface ExerciseRationale {
  exercise: Exercise
  reasons: SelectionReason[]
  alternativesConsidered: Exercise[]
  kbCitations?: KnowledgeBaseCitation[]
}

export interface SelectionReason {
  category: 'volume_deficit' | 'lengthened_bias' | 'sfr' | 'rotation' | 'sra' | 'user_pref'
  weight: number              // Contribution to selection (0-1)
  explanation: string         // Human-readable
  data?: any                  // Supporting data for explainability UI
}

export interface PrescriptionRationale {
  sets: {
    value: number
    reason: string            // "3 sets based on MAV target (12-20 sets/week)"
  }
  reps: {
    range: [number, number]
    reason: string            // "6-12 reps for hypertrophy bias (Week 2 of Accumulation)"
  }
  load: {
    value: number
    reason: string            // "225 lbs = +5 lbs from last session (linear progression)"
  }
  rir: {
    target: number
    reason: string            // "RIR 3 (ramping from 4→1 across this block)"
  }
  rest: {
    seconds: number
    reason: string            // "120s rest (moderate compounds in hypertrophy block)"
  }
}

export interface CoachMessage {
  type: 'encouragement' | 'warning' | 'milestone' | 'adjustment' | 'education'
  message: string
  priority: 'high' | 'medium' | 'low'
}

export interface KnowledgeBaseCitation {
  claim: string
  source: string              // "Maeo et al. 2023"
  context: string             // Brief summary
  url?: string                // Link to paper/article
}
```

---

## Core Algorithms

### 1. Generate Session Context Explanation

```typescript
// src/lib/engine/explainability/session-context.ts

export function explainSessionContext(
  block: TrainingBlock,
  weekInBlock: number,
  volumeContext: VolumeContext,
  readiness: ReadinessSignal | null,
  progressionDecisions: Map<ExerciseId, ProgressionDecision>
): SessionContextExplanation {
  // Block phase
  const blockPhase = `Week ${weekInBlock + 1} of ${formatBlockType(block.blockType)}`

  // Block goal
  const blockGoal = describeBlockGoal(block)

  // Volume status (pick most relevant muscle)
  const weeklyProgress = describeVolumeProgress(volumeContext)

  // Readiness
  const readinessAssessment = readiness
    ? describeReadiness(readiness)
    : 'No readiness data available - proceeding with planned intensity'

  // Progression
  const progressionUpdate = describeProgression(progressionDecisions)

  // Special conditions
  const specialConditions = detectSpecialConditions(block, readiness, progressionDecisions)

  return {
    blockPhase,
    blockGoal,
    weeklyProgress,
    readinessAssessment,
    progressionUpdate,
    specialConditions,
  }
}

function describeBlockGoal(block: TrainingBlock): string {
  const goals: Record<BlockType, string> = {
    accumulation: 'Building volume capacity at moderate intensity to increase work capacity',
    intensification: 'Increasing load while reducing volume to build maximal strength',
    realization: 'Testing peak performance at low volume',
    deload: 'Active recovery - reducing fatigue while maintaining fitness',
    restoration: 'Complete recovery - mobility and light conditioning',
  }

  return goals[block.blockType]
}

function describeVolumeProgress(volumeContext: VolumeContext): string {
  // Find muscle with biggest deficit or most progress
  const muscles = Array.from(volumeContext.weeklyTarget.keys())

  const progress = muscles.map(muscle => {
    const target = volumeContext.weeklyTarget.get(muscle) ?? 0
    const actual = volumeContext.effectiveActual.get(muscle) ?? 0
    const landmark = determineLandmark(target)

    return {
      muscle,
      actual,
      target,
      landmark,
      completion: target > 0 ? actual / target : 0,
    }
  })

  // Pick most interesting (closest to target or biggest deficit)
  const sorted = progress.sort((a, b) => Math.abs(b.completion - 1) - Math.abs(a.completion - 1))
  const primary = sorted[0]

  return `${Math.round(primary.actual)}/${primary.target} ${primary.muscle} sets this week (${primary.landmark})`
}

function determineLandmark(target: number): string {
  // Simplified: would look up actual landmarks
  if (target < 10) return 'approaching MEV'
  if (target < 16) return 'at MAV'
  return 'approaching MRV'
}

function describeReadiness(readiness: ReadinessSignal): string {
  const fatigue = computeFatigueScore(readiness)

  if (fatigue.overall > 0.8) {
    return `Feeling fresh (${Math.round(fatigue.overall * 100)}%) - normal intensity maintained`
  }

  if (fatigue.overall > 0.6) {
    return `Moderate readiness (${Math.round(fatigue.overall * 100)}%) - proceeding as planned`
  }

  if (fatigue.overall > 0.4) {
    return `Fatigued (${Math.round(fatigue.overall * 100)}%) - intensity scaled back 10%`
  }

  return `Very fatigued (${Math.round(fatigue.overall * 100)}%) - deload recommended`
}

function describeProgression(
  decisions: Map<ExerciseId, ProgressionDecision>
): string {
  const progressions = Array.from(decisions.values())
    .filter(d => d.action !== 'maintain')

  if (progressions.length === 0) {
    return 'Maintaining current loads'
  }

  // Describe most significant progression
  const primary = progressions[0]

  if (primary.action === 'increase') {
    return `${primary.exerciseName} +${primary.amount}${primary.unit} (${primary.reason})`
  }

  if (primary.action === 'decrease') {
    return `${primary.exerciseName} -${primary.amount}${primary.unit} (${primary.reason})`
  }

  return 'Loads adjusted based on recent performance'
}

function detectSpecialConditions(
  block: TrainingBlock,
  readiness: ReadinessSignal | null,
  progressionDecisions: Map<ExerciseId, ProgressionDecision>
): string[] | undefined {
  const conditions: string[] = []

  // Early deload
  const stalls = Array.from(progressionDecisions.values())
    .filter(d => d.reason.includes('stall'))

  if (stalls.length >= 2) {
    conditions.push('Multiple exercises stalled - consider deload after this week')
  }

  // Low readiness
  if (readiness && computeFatigueScore(readiness).overall < 0.4) {
    conditions.push('Low readiness detected - workout auto-scaled')
  }

  // Block transition
  if (block.durationWeeks > 0 && /* weekInBlock */ === block.durationWeeks - 1) {
    conditions.push(`Final week of ${formatBlockType(block.blockType)} - next block begins next week`)
  }

  return conditions.length > 0 ? conditions : undefined
}
```

### 2. Generate Exercise Rationale

```typescript
// src/lib/engine/explainability/exercise-rationale.ts

export function explainExerciseSelection(
  candidate: SelectionCandidate,
  rejected: Exercise[],
  objective: SelectionObjective
): ExerciseRationale {
  const reasons: SelectionReason[] = []

  // Top 3 contributing scores
  const topScores = Object.entries(candidate.scores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)

  for (const [category, value] of topScores) {
    if (value > 0.5) {
      reasons.push({
        category: category as any,
        weight: value * objective.weights[category as keyof typeof objective.weights],
        explanation: formatReason(category, value, candidate, objective),
        data: extractReasonData(category, candidate, objective),
      })
    }
  }

  // Alternatives: same primary muscle, not selected
  const alternatives = rejected
    .filter(ex =>
      ex.primaryMuscles[0] === candidate.exercise.primaryMuscles[0] &&
      ex.id !== candidate.exercise.id
    )
    .slice(0, 3)

  // KB citations (if applicable)
  const kbCitations = extractKbCitations(candidate.exercise)

  return {
    exercise: candidate.exercise,
    reasons,
    alternativesConsidered: alternatives,
    kbCitations,
  }
}

function formatReason(
  category: string,
  value: number,
  candidate: SelectionCandidate,
  objective: SelectionObjective
): string {
  switch (category) {
    case 'deficitFill': {
      const contribution = Array.from(candidate.volumeContribution.entries())
        .map(([muscle, { direct, indirect }]) => {
          const effective = direct + (indirect * INDIRECT_SET_MULTIPLIER)
          return `${effective.toFixed(1)} sets ${muscle}`
        })
        .join(', ')

      return `Fills volume deficit: ${contribution}`
    }

    case 'lengthenedScore': {
      const score = candidate.exercise.lengthPositionScore ?? 3
      return `Loads muscle at long length (${score}/5) - research shows superior hypertrophy`
    }

    case 'sfrScore': {
      const score = candidate.exercise.sfrScore ?? 3
      return `High stimulus-to-fatigue ratio (${score}/5) - efficient volume accumulation`
    }

    case 'sraAlignment': {
      const muscles = candidate.exercise.primaryMuscles
        .map(m => `${m} (${Math.round(objective.sraContext.get(m)! * 100)}% recovered)`)
        .join(', ')
      return `Targets recovered muscles: ${muscles}`
    }

    case 'rotationNovelty': {
      const exposure = objective.rotationContext.get(candidate.exercise.id)
      const weeks = exposure?.weeksAgo ?? 'never used'
      return `Last performed ${weeks === 'never used' ? weeks : `${weeks} weeks ago`}`
    }

    case 'userPreference': {
      return 'User marked as favorite'
    }

    case 'movementNovelty': {
      return 'Provides movement pattern diversity'
    }

    default:
      return ''
  }
}

function extractReasonData(
  category: string,
  candidate: SelectionCandidate,
  objective: SelectionObjective
): any {
  switch (category) {
    case 'deficitFill':
      return {
        contribution: Object.fromEntries(candidate.volumeContribution),
        deficit: Object.fromEntries(
          Array.from(objective.volumeContext.weeklyTarget.entries())
            .map(([muscle, target]) => {
              const actual = objective.volumeContext.effectiveActual.get(muscle) ?? 0
              return [muscle, Math.max(0, target - actual)]
            })
        ),
      }

    case 'lengthenedScore':
      return {
        score: candidate.exercise.lengthPositionScore,
        maxScore: 5,
      }

    // ... etc
  }
}

function extractKbCitations(exercise: Exercise): KnowledgeBaseCitation[] | undefined {
  const citations: KnowledgeBaseCitation[] = []

  // Lengthened position exercises
  if (exercise.lengthPositionScore && exercise.lengthPositionScore >= 4) {
    if (exercise.primaryMuscles.includes('triceps')) {
      citations.push({
        claim: 'Overhead extensions produce ~40% more triceps growth than pushdowns',
        source: 'Maeo et al. 2023',
        context: '12-week study comparing overhead vs. pushdown variations',
        url: 'https://pubmed.ncbi.nlm.nih.gov/36943275/',
      })
    }

    if (exercise.primaryMuscles.includes('biceps') && exercise.name.toLowerCase().includes('incline')) {
      citations.push({
        claim: 'Incline curls (shoulder extended) produce greater biceps hypertrophy',
        source: 'Pedrosa et al. 2023',
        context: 'Training in lengthened ROM showed superior growth',
        url: 'https://pubmed.ncbi.nlm.nih.gov/37232166/',
      })
    }

    if (exercise.primaryMuscles.includes('calves')) {
      citations.push({
        claim: 'Lengthened partial calf raises: 15.2% growth vs 6.7% full ROM',
        source: 'Kassiano et al. 2023',
        context: 'Dorsiflexion to neutral (stretched position) most effective',
        url: 'https://pubmed.ncbi.nlm.nih.gov/37119445/',
      })
    }
  }

  // SFR-specific
  if (exercise.sfrScore && exercise.sfrScore >= 4) {
    citations.push({
      claim: 'High-SFR exercises allow greater sustainable volume per muscle per week',
      source: 'Israetel (RP)',
      context: 'Stimulus-to-fatigue ratio guides exercise selection for volume optimization',
    })
  }

  return citations.length > 0 ? citations : undefined
}
```

### 3. Generate Prescription Rationale

```typescript
// src/lib/engine/explainability/prescription-rationale.ts

export function explainPrescription(
  exercise: Exercise,
  prescription: SetPrescription,
  block: TrainingBlock,
  weekInBlock: number,
  progression: ProgressionDecision
): PrescriptionRationale {
  // Sets
  const setsReason = explainSets(prescription.sets, exercise, block)

  // Reps
  const repsReason = explainReps(prescription.reps, block)

  // Load
  const loadReason = explainLoad(prescription.targetLoad, progression)

  // RIR
  const rirReason = explainRir(prescription.targetRir, block, weekInBlock)

  // Rest
  const restReason = explainRest(prescription.restSeconds, block, exercise)

  return {
    sets: { value: prescription.sets, reason: setsReason },
    reps: { range: prescription.reps, reason: repsReason },
    load: { value: prescription.targetLoad, reason: loadReason },
    rir: { target: prescription.targetRir, reason: rirReason },
    rest: { seconds: prescription.restSeconds, reason: restReason },
  }
}

function explainSets(sets: number, exercise: Exercise, block: TrainingBlock): string {
  const landmark = block.volumeTarget
  const muscle = exercise.primaryMuscles[0]

  return `${sets} sets based on ${landmark} target for ${muscle}`
}

function explainReps(reps: [number, number], block: TrainingBlock): string {
  const intensity = block.intensityBias

  const ranges: Record<IntensityBias, string> = {
    strength: '1-5 reps for maximal strength adaptations',
    hypertrophy: '6-12 reps for optimal muscle growth',
    power: '3-6 reps for explosive power',
    muscular_endurance: '12-20 reps for endurance',
  }

  return `${reps[0]}-${reps[1]} reps (${ranges[intensity]})`
}

function explainLoad(load: number | undefined, progression: ProgressionDecision): string {
  if (!load) return 'No load prescribed (bodyweight exercise)'

  return `${load} lbs - ${progression.reason}`
}

function explainRir(rir: number, block: TrainingBlock, weekInBlock: number): string {
  const progress = weekInBlock / (block.durationWeeks - 1)
  const currentRir = lerp(block.rirStart, block.rirEnd, progress)

  return `RIR ${currentRir.toFixed(1)} (ramping ${block.rirStart}→${block.rirEnd} across block)`
}

function explainRest(rest: number, block: TrainingBlock, exercise: Exercise): string {
  if (exercise.isCompound) {
    return `${rest}s rest (compound movements need more recovery)`
  }

  if (block.intensityBias === 'strength') {
    return `${rest}s rest (heavy loads require full CNS recovery)`
  }

  return `${rest}s rest (isolation exercise, moderate recovery)`
}
```

### 4. Generate Coach Messages

```typescript
// src/lib/engine/explainability/coach-messages.ts

export function generateCoachMessages(
  context: SessionContextExplanation,
  exercises: ExerciseRationale[],
  progressionDecisions: Map<ExerciseId, ProgressionDecision>
): CoachMessage[] {
  const messages: CoachMessage[] = []

  // Encouragement for PRs
  const prs = Array.from(progressionDecisions.values())
    .filter(d => d.isPr)

  if (prs.length > 0) {
    messages.push({
      type: 'encouragement',
      message: `💪 Great progress! You hit ${prs.length} PR${prs.length > 1 ? 's' : ''} last session. Keep it up!`,
      priority: 'high',
    })
  }

  // Warning for low readiness
  if (context.readinessAssessment.includes('Very fatigued')) {
    messages.push({
      type: 'warning',
      message: `⚠️ Recovery is low. Consider taking an extra rest day or doing light cardio instead.`,
      priority: 'high',
    })
  }

  // Milestone: block transition
  if (context.specialConditions?.some(c => c.includes('Final week'))) {
    messages.push({
      type: 'milestone',
      message: `🎯 Last week of this block! Next week we transition to a new phase.`,
      priority: 'medium',
    })
  }

  // Education: lengthened position
  const lengthenedExercises = exercises.filter(e =>
    e.kbCitations && e.kbCitations.some(c => c.claim.includes('lengthened'))
  )

  if (lengthenedExercises.length > 0) {
    messages.push({
      type: 'education',
      message: `📚 Today's workout emphasizes lengthened-position exercises (research shows ~2x hypertrophy). Focus on the stretch at the bottom of each rep!`,
      priority: 'low',
    })
  }

  // Adjustment: stall intervention
  if (context.specialConditions?.some(c => c.includes('stalled'))) {
    messages.push({
      type: 'adjustment',
      message: `🔄 We've detected a plateau. This week we're rotating some exercises to break through.`,
      priority: 'medium',
    })
  }

  return messages
}
```

---

## UI Components

### Workout Explainability Panel

```tsx
// src/components/ExplainabilityPanel.tsx

export function ExplainabilityPanel({
  explanation,
}: {
  explanation: WorkoutExplanation
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-white border rounded-lg shadow-sm">
      {/* Header: Session Context */}
      <div className="p-4 border-b">
        <h3 className="font-semibold text-lg mb-2">Today's Training Focus</h3>
        <p className="text-sm text-gray-700">{explanation.sessionContext.blockPhase}</p>
        <p className="text-sm text-gray-600 mt-1">{explanation.sessionContext.blockGoal}</p>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="font-medium">Volume:</span> {explanation.sessionContext.weeklyProgress}
          </div>
          <div>
            <span className="font-medium">Readiness:</span> {explanation.sessionContext.readinessAssessment}
          </div>
        </div>
      </div>

      {/* Coach Messages */}
      {explanation.coachMessages.length > 0 && (
        <div className="p-4 border-b space-y-2">
          {explanation.coachMessages.map((msg, idx) => (
            <CoachMessageCard key={idx} message={msg} />
          ))}
        </div>
      )}

      {/* Per-Exercise Rationale */}
      <div className="p-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between w-full text-left"
        >
          <span className="font-medium">Exercise Breakdown</span>
          <ChevronIcon className={`transform ${expanded ? 'rotate-180' : ''}`} />
        </button>

        {expanded && (
          <div className="mt-4 space-y-4">
            {Array.from(explanation.exerciseRationale.entries()).map(([exId, rationale]) => (
              <ExerciseRationaleCard key={exId} rationale={rationale} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CoachMessageCard({ message }: { message: CoachMessage }) {
  const styles = {
    encouragement: 'bg-green-50 border-green-200 text-green-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    milestone: 'bg-blue-50 border-blue-200 text-blue-800',
    adjustment: 'bg-purple-50 border-purple-200 text-purple-800',
    education: 'bg-gray-50 border-gray-200 text-gray-800',
  }[message.type]

  return (
    <div className={`p-3 border rounded ${styles}`}>
      <p className="text-sm">{message.message}</p>
    </div>
  )
}

function ExerciseRationaleCard({ rationale }: { rationale: ExerciseRationale }) {
  return (
    <div className="border-l-4 border-blue-500 pl-4">
      <h4 className="font-semibold">{rationale.exercise.name}</h4>

      {/* Reasons */}
      <ul className="text-sm text-gray-700 mt-2 space-y-1">
        {rationale.reasons.map((reason, idx) => (
          <li key={idx}>• {reason.explanation}</li>
        ))}
      </ul>

      {/* KB Citations */}
      {rationale.kbCitations && rationale.kbCitations.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-blue-600 cursor-pointer">
            📚 Research backing
          </summary>
          <div className="mt-2 space-y-2">
            {rationale.kbCitations.map((citation, idx) => (
              <div key={idx} className="text-xs bg-blue-50 p-2 rounded">
                <p className="font-medium">{citation.claim}</p>
                <p className="text-gray-600 mt-1">
                  {citation.source} - {citation.context}
                </p>
                {citation.url && (
                  <a
                    href={citation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline"
                  >
                    Read study →
                  </a>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Alternatives */}
      {rationale.alternativesConsidered.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-gray-500 cursor-pointer">
            Alternatives considered
          </summary>
          <ul className="text-xs text-gray-500 ml-4 mt-1">
            {rationale.alternativesConsidered.map(alt => (
              <li key={alt.id}>• {alt.name}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
```

---

## Testing

```typescript
// src/lib/engine/explainability/session-context.test.ts

describe('explainSessionContext', () => {
  it('describes accumulation block correctly', () => {
    const block: TrainingBlock = {
      blockType: 'accumulation',
      intensityBias: 'hypertrophy',
      volumeTarget: 'MAV',
      // ...
    }

    const explanation = explainSessionContext(block, 1, volumeContext, null, new Map())

    expect(explanation.blockPhase).toBe('Week 2 of Accumulation')
    expect(explanation.blockGoal).toContain('Building volume capacity')
  })

  it('warns about low readiness', () => {
    const readiness: ReadinessSignal = {
      whoop: { recovery: 25, strain: 20, hrv: 30, sleepQuality: 35, sleepDuration: 4 },
      subjective: { readiness: 2, motivation: 2, soreness: new Map() },
      performance: { rpeVsExpected: 2, stallCount: 0, volumeComplianceRate: 0.7 },
      // ...
    }

    const explanation = explainSessionContext(block, 1, volumeContext, readiness, new Map())

    expect(explanation.readinessAssessment).toContain('Very fatigued')
  })
})

describe('extractKbCitations', () => {
  it('cites Maeo 2023 for overhead extensions', () => {
    const exercise = createExercise({
      name: 'Overhead Tricep Extension',
      primaryMuscles: ['triceps'],
      lengthPositionScore: 5,
    })

    const citations = extractKbCitations(exercise)

    expect(citations).toBeDefined()
    expect(citations![0].source).toBe('Maeo et al. 2023')
    expect(citations![0].claim).toContain('40% more triceps growth')
  })
})
```

---

## User Education Flow

### Onboarding: "How This Works"

**Screen 1: Periodization Explained**
```
"Your training is structured in blocks:

🏗️ Accumulation (4 weeks)
Build volume and work capacity

💪 Intensification (3 weeks)
Increase weight, build strength

📊 Deload (1 week)
Recover and supercompensate

This structure is proven to maximize long-term progress."
```

**Screen 2: Why Exercises Change**
```
"We rotate exercises every 4-6 weeks to:

✓ Prevent adaptation
✓ Reduce joint stress
✓ Target different muscle fibers
✓ Keep training engaging

Your main lifts stay consistent for tracking progress."
```

**Screen 3: Research-Backed**
```
"Every workout is based on peer-reviewed research.

When you see 📚 next to an exercise, tap to see the science behind why we chose it.

Example: Overhead extensions grow triceps 40% more than pushdowns (Maeo et al. 2023)"
```

---

## Next Steps

1. **Implement explanation generators** - All rationale functions
2. **Build KB citation database** - Map exercises to studies
3. **UI components** - Explainability panel, coach messages
4. **User testing** - Validate comprehension
5. **Iterate on messaging** - Refine coach tone

**Estimated Effort:** 2 weeks (Phase 4)
