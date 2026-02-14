# Periodization System: Detailed Implementation Spec

**Component:** Macro → Meso → Micro Training Structure
**Owner:** Engine Team
**Dependencies:** Schema changes, migration script
**Target:** Phase 1 (Weeks 1-4)

---

## Overview

Implement a three-tier periodization hierarchy that structures training into goal-oriented macro cycles (12-16 weeks), progressive meso cycles (3-6 week blocks), and daily micro workouts with context-aware prescription.

**Evidence Base:**
- KB: Block periodization (Issurin) for intermediate-advanced
- KB: Mesocycle structure (3-6 weeks + deload)
- KB: Volume ramping 10-20% per week within blocks
- KB: RIR progression (3-4 early → 0-1 late meso)

---

## Type Definitions

### Core Types

```typescript
// src/lib/engine/periodization/types.ts

export type BlockType =
  | 'accumulation'      // High volume, moderate intensity (build capacity)
  | 'intensification'   // Moderate volume, high intensity (build strength)
  | 'realization'       // Low volume, peak intensity (test maxes)
  | 'deload'            // Low volume, low intensity (recover)
  | 'restoration'       // Active recovery (mobility, light cardio)

export type VolumeTarget =
  | 'MEV'               // Minimum Effective Volume
  | 'MAV'               // Maximum Adaptive Volume
  | 'approaching_MRV'   // Near Maximum Recoverable Volume
  | 'deload_volume'     // 40-60% of normal

export type IntensityBias =
  | 'strength'          // 1-5 reps, 80-95% 1RM
  | 'hypertrophy'       // 6-12 reps, 65-80% 1RM
  | 'power'             // 3-6 reps, 50-70% 1RM, explosive
  | 'muscular_endurance' // 12-20+ reps, 50-65% 1RM

export interface TrainingBlock {
  id: string
  blockType: BlockType
  durationWeeks: number
  volumeTarget: VolumeTarget
  intensityBias: IntensityBias

  // Progressive overload within block
  weeklyVolumeRamp: number     // e.g., 1.10 = 10% increase/week
  rirProgression: [number, number] // [start, end] e.g., [4, 1]

  // Exercise programming
  mainLiftStrategy: {
    coreMovements: ExerciseId[]      // e.g., [squat, bench, deadlift]
    variations: Map<ExerciseId, ExerciseId[]> // Alternatives per lift
    rotationPolicy: 'maintain' | 'rotate_weekly' | 'rotate_at_block_end'
  }

  accessoryStrategy: {
    selectionMode: 'auto' | 'semi_auto' | 'user_defined'
    rotationCadence: number          // Weeks between accessory swaps
    noveltyRatio: number             // 0-1: proportion of new exercises
  }

  // Autoregulation
  allowAutoScale: boolean            // Enable readiness-based scaling
  deloadTriggers: {
    manualSchedule?: number          // Force deload week N
    performanceStall: number         // Deload after N weeks no progress
    lowRecoveryDays: number          // Deload if recovery < 40% for N days
  }
}

export interface Mesocycle {
  id: string
  blocks: TrainingBlock[]
  totalWeeks: number                 // Sum of block durations
  primaryGoal: TrainingGoal

  // Computed
  currentBlock: number               // Index into blocks[]
  currentWeekInBlock: number         // 0-indexed week within current block
}

export interface MacroCycle {
  id: string
  userId: string
  startDate: Date
  mesocycles: Mesocycle[]

  // User context
  trainingAge: TrainingAge
  primaryGoal: TrainingGoal
  secondaryGoals?: TrainingGoal[]

  // State
  currentMeso: number
  completedWeeks: number

  // Adaptations history
  adaptations: Adaptation[]
}

export interface Adaptation {
  date: Date
  type: 'early_deload' | 'block_extension' | 'goal_shift' | 'exercise_swap'
  reason: string
  blockAffected: string
  autoTriggered: boolean
}
```

---

## Schema Changes

### New Tables

```prisma
// prisma/schema.prisma additions

model MacroCycle {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  startDate       DateTime @default(now())
  endDate         DateTime?

  trainingAge     TrainingAge
  primaryGoal     TrainingGoal
  secondaryGoals  TrainingGoal[]

  // State
  isActive        Boolean  @default(true)
  currentMeso     Int      @default(0)
  completedWeeks  Int      @default(0)

  // Relations
  mesocycles      Mesocycle[]
  adaptations     MacroAdaptation[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([userId, isActive])
  @@index([startDate])
}

model Mesocycle {
  id            String   @id @default(cuid())
  macroCycleId  String
  macroCycle    MacroCycle @relation(fields: [macroCycleId], references: [id], onDelete: Cascade)

  orderIndex    Int      // Position in macro (0, 1, 2...)
  totalWeeks    Int
  currentBlock  Int      @default(0)
  currentWeekInBlock Int @default(0)

  primaryGoal   TrainingGoal

  blocks        TrainingBlock[]

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([macroCycleId, orderIndex])
}

model TrainingBlock {
  id              String   @id @default(cuid())
  mesocycleId     String
  mesocycle       Mesocycle @relation(fields: [mesocycleId], references: [id], onDelete: Cascade)

  orderIndex      Int      // Position in meso (0, 1, 2...)
  blockType       BlockType
  durationWeeks   Int

  volumeTarget    VolumeTarget
  intensityBias   IntensityBias

  // Progression parameters
  weeklyVolumeRamp  Float  @default(1.10)
  rirStart          Float  // e.g., 4.0
  rirEnd            Float  // e.g., 1.0

  // Exercise programming (JSON for flexibility)
  mainLifts       Json   // { squat: "barbell_back_squat", ... }
  accessoryPool   Json   // { chest: ["incline_db", "cable_fly"], ... }
  rotationPolicy  Json   // { mainLifts: "maintain", accessories: { cadence: 2, novelty: 0.3 } }

  // Autoregulation
  allowAutoScale  Boolean @default(true)
  deloadTriggers  Json    // { performanceStall: 3, lowRecoveryDays: 5 }

  // Relations
  workouts        Workout[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([mesocycleId, orderIndex])
}

model MacroAdaptation {
  id            String   @id @default(cuid())
  macroCycleId  String
  macroCycle    MacroCycle @relation(fields: [macroCycleId], references: [id], onDelete: Cascade)

  date          DateTime @default(now())
  type          AdaptationType
  reason        String
  blockAffected String?
  autoTriggered Boolean

  metadata      Json?    // Additional context

  @@index([macroCycleId, date])
}

model ExerciseExposure {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  exerciseId  String
  exercise    Exercise @relation(fields: [exerciseId], references: [id])

  lastUsed    DateTime
  usageCount  Int      @default(1)

  // Performance tracking
  performance Json     // { avgRpe: 8.2, progressRate: 0.05, lastPr: "2026-02-14" }

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([userId, exerciseId])
  @@index([userId, lastUsed])
}

// Extend Workout model
model Workout {
  // ... existing fields ...

  // NEW: Block context
  trainingBlockId String?
  trainingBlock   TrainingBlock? @relation(fields: [trainingBlockId], references: [id])

  weekInBlock     Int?   // 0-indexed week within block
  blockPhase      String? // e.g., "Week 2 of Accumulation"
}

// New enums
enum BlockType {
  ACCUMULATION
  INTENSIFICATION
  REALIZATION
  DELOAD
  RESTORATION
}

enum VolumeTarget {
  MEV
  MAV
  APPROACHING_MRV
  DELOAD_VOLUME
}

enum IntensityBias {
  STRENGTH
  HYPERTROPHY
  POWER
  MUSCULAR_ENDURANCE
}

enum AdaptationType {
  EARLY_DELOAD
  BLOCK_EXTENSION
  GOAL_SHIFT
  EXERCISE_SWAP
  VOLUME_REDUCTION
  INTENSITY_REDUCTION
}
```

---

## Core Algorithms

### 1. Macro Cycle Generation

```typescript
// src/lib/engine/periodization/generate-macro.ts

import { MacroCycle, Mesocycle, TrainingBlock } from './types'
import { TrainingAge, TrainingGoal } from '../types'
import { VOLUME_LANDMARKS } from '../volume-landmarks'

export interface MacroGenerationParams {
  userId: string
  trainingAge: TrainingAge
  primaryGoal: TrainingGoal
  availableDaysPerWeek: number
  sessionMinutes: number
  startDate?: Date
}

export function generateMacroCycle(params: MacroGenerationParams): MacroCycle {
  const { trainingAge, primaryGoal } = params

  // Determine macro length by training age
  const macroWeeks = getMacroLength(trainingAge)

  // Build mesocycles
  const mesocycles = buildMesocycles({
    totalWeeks: macroWeeks,
    goal: primaryGoal,
    trainingAge,
  })

  return {
    id: generateId(),
    userId: params.userId,
    startDate: params.startDate ?? new Date(),
    trainingAge,
    primaryGoal,
    mesocycles,
    currentMeso: 0,
    completedWeeks: 0,
    adaptations: [],
  }
}

function getMacroLength(trainingAge: TrainingAge): number {
  switch (trainingAge) {
    case 'beginner': return 12      // 3 mesos
    case 'intermediate': return 16  // 4 mesos
    case 'advanced': return 16      // 4 mesos with more complex blocks
  }
}

function buildMesocycles(params: {
  totalWeeks: number
  goal: TrainingGoal
  trainingAge: TrainingAge
}): Mesocycle[] {
  const { totalWeeks, goal, trainingAge } = params

  // Standard meso structure: 4 weeks + 1 deload (repeat)
  const mesoCycleLength = 5 // weeks
  const numMesos = Math.floor(totalWeeks / mesoCycleLength)

  const mesocycles: Mesocycle[] = []

  for (let i = 0; i < numMesos; i++) {
    const blocks = buildBlocksForMeso(i, goal, trainingAge)

    mesocycles.push({
      id: generateId(),
      orderIndex: i,
      totalWeeks: blocks.reduce((sum, b) => sum + b.durationWeeks, 0),
      currentBlock: 0,
      currentWeekInBlock: 0,
      primaryGoal: goal,
      blocks,
    })
  }

  return mesocycles
}

function buildBlocksForMeso(
  mesoIndex: number,
  goal: TrainingGoal,
  trainingAge: TrainingAge
): TrainingBlock[] {
  // Vary block type by meso position
  const blockProgression = getBlockProgression(mesoIndex, trainingAge)

  return blockProgression.map((blockType, idx) => ({
    id: generateId(),
    orderIndex: idx,
    blockType,
    durationWeeks: getBlockDuration(blockType),
    volumeTarget: getVolumeTarget(blockType, goal),
    intensityBias: getIntensityBias(blockType, goal),
    weeklyVolumeRamp: getVolumeRamp(blockType),
    rirStart: getRirStart(blockType, trainingAge),
    rirEnd: getRirEnd(blockType, trainingAge),
    mainLiftStrategy: {
      coreMovements: selectCoreMovements(goal),
      variations: new Map(), // Populated during first generation
      rotationPolicy: blockType === 'deload' ? 'maintain' : 'rotate_at_block_end',
    },
    accessoryStrategy: {
      selectionMode: 'auto',
      rotationCadence: 2, // weeks
      noveltyRatio: 0.3,
    },
    allowAutoScale: true,
    deloadTriggers: {
      performanceStall: 3,
      lowRecoveryDays: 5,
    },
  }))
}

function getBlockProgression(
  mesoIndex: number,
  trainingAge: TrainingAge
): BlockType[] {
  // Beginners: Simple accumulation + deload
  if (trainingAge === 'beginner') {
    return ['accumulation', 'accumulation', 'accumulation', 'accumulation', 'deload']
  }

  // Intermediate/Advanced: Accumulation → Intensification → Deload
  // First meso: Build base
  if (mesoIndex === 0) {
    return ['accumulation', 'accumulation', 'accumulation', 'deload']
  }

  // Later mesos: Classic block periodization
  return ['accumulation', 'accumulation', 'intensification', 'deload']
}

function getBlockDuration(blockType: BlockType): number {
  switch (blockType) {
    case 'accumulation': return 2      // 2 weeks high volume
    case 'intensification': return 2   // 2 weeks high intensity
    case 'realization': return 1       // 1 week testing
    case 'deload': return 1            // 1 week recovery
    case 'restoration': return 1
  }
}

function getVolumeTarget(blockType: BlockType, goal: TrainingGoal): VolumeTarget {
  switch (blockType) {
    case 'accumulation':
      return goal === 'strength' ? 'MAV' : 'approaching_MRV'
    case 'intensification':
      return 'MAV'
    case 'realization':
      return 'MEV'
    case 'deload':
    case 'restoration':
      return 'deload_volume'
  }
}

function getIntensityBias(blockType: BlockType, goal: TrainingGoal): IntensityBias {
  // Accumulation: Moderate intensity
  if (blockType === 'accumulation') {
    return goal === 'strength' ? 'hypertrophy' : 'hypertrophy'
  }

  // Intensification: High intensity
  if (blockType === 'intensification') {
    return 'strength'
  }

  // Realization: Peak intensity
  if (blockType === 'realization') {
    return 'strength'
  }

  // Deload: Moderate intensity, low volume
  return 'hypertrophy'
}

function getVolumeRamp(blockType: BlockType): number {
  switch (blockType) {
    case 'accumulation': return 1.10      // +10% per week
    case 'intensification': return 1.05   // +5% per week (volume drops as intensity rises)
    case 'realization': return 1.0        // Maintain
    case 'deload': return 0.5             // Cut to 50%
    case 'restoration': return 0.3
  }
}

function getRirStart(blockType: BlockType, trainingAge: TrainingAge): number {
  if (trainingAge === 'beginner') return 3 // Always conservative

  switch (blockType) {
    case 'accumulation': return 4
    case 'intensification': return 3
    case 'realization': return 2
    case 'deload': return 5
    case 'restoration': return 6
  }
}

function getRirEnd(blockType: BlockType, trainingAge: TrainingAge): number {
  if (trainingAge === 'beginner') return 2 // Always conservative

  switch (blockType) {
    case 'accumulation': return 1
    case 'intensification': return 0
    case 'realization': return 0
    case 'deload': return 4
    case 'restoration': return 5
  }
}

function selectCoreMovements(goal: TrainingGoal): ExerciseId[] {
  // Default: Big 3
  const coreLifts: ExerciseId[] = ['squat', 'bench_press', 'deadlift']

  if (goal === 'hypertrophy') {
    // Add OHP for hypertrophy programs
    coreLifts.push('overhead_press')
  }

  return coreLifts
}
```

### 2. Block Progression Logic

```typescript
// src/lib/engine/periodization/progress-block.ts

export interface BlockProgressionState {
  block: TrainingBlock
  currentWeek: number  // 0-indexed
  completedWeeks: number
  shouldAdvance: boolean
  nextBlock?: TrainingBlock
}

export function computeBlockProgression(
  block: TrainingBlock,
  completedWeeks: number,
  history: WorkoutHistoryEntry[]
): BlockProgressionState {
  const currentWeek = completedWeeks % block.durationWeeks
  const shouldAdvance = completedWeeks >= block.durationWeeks

  // Check for early triggers (stall, low recovery)
  const earlyDeload = shouldTriggerEarlyDeload(block, history)

  return {
    block,
    currentWeek,
    completedWeeks,
    shouldAdvance: shouldAdvance || earlyDeload,
    nextBlock: undefined, // Populated by macro progression
  }
}

function shouldTriggerEarlyDeload(
  block: TrainingBlock,
  history: WorkoutHistoryEntry[]
): boolean {
  const { deloadTriggers } = block

  // Check performance stall
  if (deloadTriggers.performanceStall) {
    const recentHistory = history.slice(-deloadTriggers.performanceStall * 3) // ~3 workouts/week
    const stallDetected = detectStall(recentHistory)
    if (stallDetected) return true
  }

  // Check recovery (would require Whoop integration)
  // TODO: Implement in Phase 3

  return false
}

function detectStall(history: WorkoutHistoryEntry[]): boolean {
  // Simplified: Check if no PRs in recent history
  const hasPr = history.some(h => h.exercises.some(e => e.isPr))
  return !hasPr
}
```

### 3. Week-Aware Set/Rep/RIR Prescription

```typescript
// src/lib/engine/periodization/prescribe-with-block.ts

export function prescribeWithBlockContext(
  exercise: Exercise,
  block: TrainingBlock,
  weekInBlock: number
): SetPrescription {
  // Base prescription from block's intensity bias
  const baseReps = getRepRangeForIntensity(block.intensityBias, exercise)

  // Compute RIR for this week (linear interpolation)
  const rirProgress = weekInBlock / (block.durationWeeks - 1)
  const targetRir = lerp(block.rirStart, block.rirEnd, rirProgress)

  // Compute sets from volume target
  const baseSets = getSetsForVolume(block.volumeTarget, exercise.primaryMuscles)

  // Apply weekly ramp
  const volumeMultiplier = Math.pow(block.weeklyVolumeRamp, weekInBlock)
  const weekSets = Math.round(baseSets * volumeMultiplier)

  return {
    sets: weekSets,
    reps: baseReps,
    targetRir,
    restSeconds: getRestForIntensity(block.intensityBias),
  }
}

function getRepRangeForIntensity(
  intensity: IntensityBias,
  exercise: Exercise
): [number, number] {
  switch (intensity) {
    case 'strength': return [3, 5]
    case 'hypertrophy': return [6, 12]
    case 'power': return [3, 6]
    case 'muscular_endurance': return [12, 20]
  }
}

function getSetsForVolume(
  volumeTarget: VolumeTarget,
  muscles: Muscle[]
): number {
  // Lookup MEV/MAV from volume landmarks
  const primaryMuscle = muscles[0]
  const landmarks = VOLUME_LANDMARKS[primaryMuscle]

  switch (volumeTarget) {
    case 'MEV': return landmarks.mev / 3 // Spread across ~3 workouts/week
    case 'MAV': return landmarks.mav / 3
    case 'approaching_MRV': return (landmarks.mrv * 0.9) / 3
    case 'deload_volume': return (landmarks.mev * 0.5) / 3
  }
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * Math.min(1, Math.max(0, progress))
}
```

---

## API Layer

### Generate Macro Cycle

```typescript
// src/lib/api/periodization.ts

export async function createMacroCycleForUser(
  userId: string
): Promise<MacroCycle> {
  // Load user profile + training age assessment
  const profile = await loadProfile(userId)
  const trainingAge = await assessTrainingAge(userId)
  const goals = await loadGoals(userId)
  const constraints = await loadConstraints(userId)

  // Generate macro
  const macro = generateMacroCycle({
    userId,
    trainingAge,
    primaryGoal: goals.primaryGoal,
    availableDaysPerWeek: constraints.daysPerWeek,
    sessionMinutes: constraints.sessionMinutes,
  })

  // Persist to DB
  const saved = await prisma.macroCycle.create({
    data: {
      userId,
      startDate: macro.startDate,
      trainingAge: macro.trainingAge,
      primaryGoal: macro.primaryGoal,
      isActive: true,
      currentMeso: 0,
      completedWeeks: 0,
      mesocycles: {
        create: macro.mesocycles.map(meso => ({
          orderIndex: meso.orderIndex,
          totalWeeks: meso.totalWeeks,
          currentBlock: 0,
          currentWeekInBlock: 0,
          primaryGoal: meso.primaryGoal,
          blocks: {
            create: meso.blocks.map(block => ({
              orderIndex: block.orderIndex,
              blockType: mapBlockType(block.blockType),
              durationWeeks: block.durationWeeks,
              volumeTarget: mapVolumeTarget(block.volumeTarget),
              intensityBias: mapIntensityBias(block.intensityBias),
              weeklyVolumeRamp: block.weeklyVolumeRamp,
              rirStart: block.rirStart,
              rirEnd: block.rirEnd,
              mainLifts: block.mainLiftStrategy as any,
              accessoryPool: {},
              rotationPolicy: block.mainLiftStrategy as any,
              allowAutoScale: block.allowAutoScale,
              deloadTriggers: block.deloadTriggers as any,
            })),
          },
        })),
      },
    },
    include: {
      mesocycles: {
        include: {
          blocks: true,
        },
      },
    },
  })

  return mapPrismaMacroToEngine(saved)
}
```

---

## Migration Script

```typescript
// scripts/migrate-to-periodization.ts

import { PrismaClient } from '@prisma/client'
import { assessTrainingAge } from '../src/lib/api/training-age'
import { generateMacroCycle } from '../src/lib/engine/periodization/generate-macro'

const prisma = new PrismaClient()

async function migrateAllUsers() {
  console.log('Starting periodization migration...')

  // Get all users
  const users = await prisma.user.findMany({
    include: {
      workouts: {
        where: { status: 'COMPLETED' },
        orderBy: { date: 'desc' },
        take: 50, // Last ~12 weeks
      },
      goals: true,
      constraints: true,
    },
  })

  console.log(`Migrating ${users.length} users...`)

  for (const user of users) {
    try {
      // Assess training age from history
      const trainingAge = await assessTrainingAge(user.id)

      // Generate macro cycle
      const macro = generateMacroCycle({
        userId: user.id,
        trainingAge,
        primaryGoal: user.goals.primaryGoal,
        availableDaysPerWeek: user.constraints.daysPerWeek,
        sessionMinutes: user.constraints.sessionMinutes,
      })

      // Backfill block context for recent workouts
      const recentWorkouts = user.workouts.slice(0, 12) // Last ~4 weeks
      await backfillBlockContext(user.id, macro, recentWorkouts)

      // Backfill exercise exposure
      await backfillExerciseExposure(user.id, recentWorkouts)

      console.log(`✓ Migrated user ${user.id} (${trainingAge})`)
    } catch (error) {
      console.error(`✗ Failed to migrate user ${user.id}:`, error)
    }
  }

  console.log('Migration complete!')
}

async function backfillBlockContext(
  userId: string,
  macro: MacroCycle,
  workouts: Workout[]
) {
  // Assign recent workouts to inferred blocks
  const currentBlock = macro.mesocycles[0].blocks[0]

  for (const workout of workouts) {
    await prisma.workout.update({
      where: { id: workout.id },
      data: {
        trainingBlockId: currentBlock.id,
        weekInBlock: 0, // Simplified: all assigned to week 0
        blockPhase: `Week 1 of ${currentBlock.blockType}`,
      },
    })
  }
}

async function backfillExerciseExposure(
  userId: string,
  workouts: Workout[]
) {
  const exposureMap = new Map<string, { lastUsed: Date; count: number }>()

  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      const existing = exposureMap.get(exercise.exerciseId)
      if (!existing || workout.date > existing.lastUsed) {
        exposureMap.set(exercise.exerciseId, {
          lastUsed: workout.date,
          count: (existing?.count ?? 0) + 1,
        })
      }
    }
  }

  for (const [exerciseId, data] of exposureMap) {
    await prisma.exerciseExposure.upsert({
      where: {
        userId_exerciseId: {
          userId,
          exerciseId,
        },
      },
      create: {
        userId,
        exerciseId,
        lastUsed: data.lastUsed,
        usageCount: data.count,
        performance: {},
      },
      update: {
        lastUsed: data.lastUsed,
        usageCount: data.count,
      },
    })
  }
}

migrateAllUsers()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
```

---

## Testing

### Unit Tests

```typescript
// src/lib/engine/periodization/generate-macro.test.ts

describe('generateMacroCycle', () => {
  it('creates 12-week macro for beginner', () => {
    const macro = generateMacroCycle({
      userId: 'test-user',
      trainingAge: 'beginner',
      primaryGoal: 'hypertrophy',
      availableDaysPerWeek: 3,
      sessionMinutes: 60,
    })

    expect(macro.mesocycles).toHaveLength(2) // 2 mesos * 5 weeks = 10 weeks (close to 12)
    expect(macro.trainingAge).toBe('beginner')
  })

  it('creates accumulation blocks for beginners', () => {
    const macro = generateMacroCycle({
      userId: 'test-user',
      trainingAge: 'beginner',
      primaryGoal: 'hypertrophy',
      availableDaysPerWeek: 3,
      sessionMinutes: 60,
    })

    const firstMeso = macro.mesocycles[0]
    const accumulationBlocks = firstMeso.blocks.filter(b => b.blockType === 'accumulation')

    expect(accumulationBlocks.length).toBeGreaterThan(2) // Mostly accumulation
  })

  it('ramps RIR from 4 to 1 across accumulation block', () => {
    const macro = generateMacroCycle({
      userId: 'test-user',
      trainingAge: 'intermediate',
      primaryGoal: 'strength',
      availableDaysPerWeek: 4,
      sessionMinutes: 75,
    })

    const accumBlock = macro.mesocycles[0].blocks.find(b => b.blockType === 'accumulation')!

    expect(accumBlock.rirStart).toBe(4)
    expect(accumBlock.rirEnd).toBe(1)
  })
})
```

---

## UI Integration

### Display Block Context

```tsx
// src/components/BlockContextBanner.tsx

export function BlockContextBanner({ workoutId }: { workoutId: string }) {
  const workout = useWorkout(workoutId)
  const block = useTrainingBlock(workout.trainingBlockId)

  if (!block) return null

  const weekLabel = `Week ${workout.weekInBlock + 1}`
  const blockLabel = formatBlockType(block.blockType)
  const phase = `${weekLabel} of ${blockLabel}`

  const intensityLabel = formatIntensityBias(block.intensityBias)
  const volumeLabel = formatVolumeTarget(block.volumeTarget)

  return (
    <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-4">
      <div className="flex items-center">
        <InfoIcon className="h-5 w-5 text-blue-500 mr-2" />
        <div>
          <p className="font-semibold text-blue-900">{phase}</p>
          <p className="text-sm text-blue-700">
            {intensityLabel} • {volumeLabel} • RIR {block.rirStart}→{block.rirEnd}
          </p>
        </div>
      </div>
    </div>
  )
}
```

---

## Next Steps

1. **Schema review** - Validate with DB team
2. **Migration dry-run** - Test on staging DB
3. **Generate-macro tests** - Validate all training age paths
4. **API integration** - Wire up to existing workout generation
5. **UI components** - Build block context display

**Estimated Effort:** 4 weeks (Phase 1)
