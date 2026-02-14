# Data Model Changes: Schema Refactor & Migration

**Component:** Database Schema Evolution
**Owner:** DB + API Team
**Dependencies:** All redesign components
**Target:** Phase 1 (Weeks 1-4) with incremental additions

---

## Overview

Comprehensive schema changes to support periodization-first architecture, exercise rotation, readiness integration, and explainability.

**Migration Strategy:** Additive-only for Phase 1 (no drops), enable dual-mode operation, deprecate old schema in Phase 5.

---

## New Tables

### 1. MacroCycle

```prisma
model MacroCycle {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  startDate       DateTime @default(now())
  endDate         DateTime?  // null = active

  // User context at start
  trainingAge     TrainingAge
  primaryGoal     TrainingGoal
  secondaryGoals  TrainingGoal[]

  // Current state
  isActive        Boolean  @default(true)
  currentMeso     Int      @default(0)  // Index into mesocycles
  completedWeeks  Int      @default(0)

  // Relations
  mesocycles      Mesocycle[]
  adaptations     MacroAdaptation[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([userId, isActive])
  @@index([startDate])
  @@unique([userId, isActive], name: "one_active_macro_per_user")  // Only one active macro
}

model Mesocycle {
  id            String   @id @default(cuid())
  macroCycleId  String
  macroCycle    MacroCycle @relation(fields: [macroCycleId], references: [id], onDelete: Cascade)

  orderIndex    Int      // 0, 1, 2... (position in macro)
  totalWeeks    Int      // Sum of block durations
  currentBlock  Int      @default(0)  // Index into blocks
  currentWeekInBlock Int @default(0)  // 0-indexed

  primaryGoal   TrainingGoal

  blocks        TrainingBlock[]

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([macroCycleId, orderIndex])
  @@index([macroCycleId])
}

model TrainingBlock {
  id              String   @id @default(cuid())
  mesocycleId     String
  mesocycle       Mesocycle @relation(fields: [mesocycleId], references: [id], onDelete: Cascade)

  orderIndex      Int      // 0, 1, 2... (position in meso)
  blockType       BlockType
  durationWeeks   Int

  // Targets
  volumeTarget    VolumeTarget
  intensityBias   IntensityBias

  // Progression parameters
  weeklyVolumeRamp  Float  @default(1.10)  // 1.10 = +10%/week
  rirStart          Float  // e.g., 4.0
  rirEnd            Float  // e.g., 1.0

  // Exercise programming (JSON for flexibility)
  mainLifts       Json   // { squat: "barbell_back_squat", bench: "barbell_bench_press", ... }
  accessoryPool   Json   // { chest: ["incline_db", "cable_fly"], triceps: [...], ... }
  rotationPolicy  Json   // { mainLifts: "maintain", accessories: { cadence: 2, novelty: 0.3 } }

  // Autoregulation
  allowAutoScale  Boolean @default(true)
  deloadTriggers  Json    // { performanceStall: 3, lowRecoveryDays: 5, ... }

  // Relations
  workouts        Workout[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([mesocycleId, orderIndex])
  @@index([mesocycleId])
}

model MacroAdaptation {
  id            String   @id @default(cuid())
  macroCycleId  String
  macroCycle    MacroCycle @relation(fields: [macroCycleId], references: [id], onDelete: Cascade)

  date          DateTime @default(now())
  type          AdaptationType
  reason        String   @db.Text
  blockAffected String?  // TrainingBlock.id
  autoTriggered Boolean

  metadata      Json?    // Additional context (e.g., readiness scores, stall counts)

  @@index([macroCycleId, date])
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
  STALL_INTERVENTION
}
```

### 2. ExerciseExposure

```prisma
model ExerciseExposure {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  exerciseId  String
  exercise    Exercise @relation(fields: [exerciseId], references: [id], onDelete: Cascade)

  lastUsed    DateTime
  usageCount  Int      @default(1)

  // Performance tracking
  performance Json     // { trend: "improving" | "stalled" | "declining", lastPr: "2026-02-14", ... }

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([userId, exerciseId])
  @@index([userId, lastUsed])
}
```

### 3. ReadinessSignal

```prisma
model ReadinessSignal {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  timestamp  DateTime @default(now())

  // Whoop data (nullable - only if connected)
  whoopRecovery     Float?  // 0-100
  whoopStrain       Float?  // 0-21
  whoopHrv          Float?  // ms (RMSSD)
  whoopSleepQuality Float?  // 0-100
  whoopSleepHours   Float?  // hours

  // Subjective (always present)
  subjectiveReadiness  Int  // 1-5
  subjectiveSoreness   Json // Map<MuscleGroup, 1-3>
  subjectiveMotivation Int  // 1-5
  subjectiveStress     Int? // 1-5

  // Performance (computed from history)
  performanceRpe       Float  // Avg(actual - expected RPE)
  performanceStalls    Int    // Count of stalled exercises
  performanceCompliance Float // % sets completed

  // Computed fatigue score
  fatigueScore         Float  // 0-1 (0=exhausted, 1=fresh)

  @@index([userId, timestamp])
}

model UserIntegration {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  provider     String   // "whoop", "oura", "garmin", etc.
  accessToken  String   @db.Text
  refreshToken String?  @db.Text
  expiresAt    DateTime?

  isActive     Boolean  @default(true)

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([userId, provider])
  @@index([userId, isActive])
}
```

---

## Modified Tables

### 4. Workout (Enhanced)

```prisma
model Workout {
  // ... existing fields ...

  // NEW: Block context
  trainingBlockId String?
  trainingBlock   TrainingBlock? @relation(fields: [trainingBlockId], references: [id], onDelete: SetNull)

  weekInBlock     Int?   // 0-indexed week within block
  blockPhase      String? // e.g., "Week 2 of Accumulation" (denormalized for display)

  // NEW: Selection metadata (for explainability)
  selectionRationale Json?  // { sessionContext, exerciseRationale, ... }

  // NEW: Autoregulation tracking
  wasAutoregulated Boolean @default(false)
  autoregulationLog Json?  // { originalLoad, adjustedLoad, reason, ... }

  // ... rest of existing fields ...
}
```

### 5. WorkoutExercise (Enhanced)

```prisma
model WorkoutExercise {
  // ... existing fields ...

  // NEW: Exercise rationale (explainability)
  selectionReason Json?  // { reasons: [...], alternativesConsidered: [...], kbCitations: [...] }

  // NEW: Prescription rationale
  prescriptionRationale Json?  // { sets: {value, reason}, reps: {range, reason}, ... }

  // ... rest of existing fields ...
}
```

### 6. Exercise (Enhanced)

```prisma
model Exercise {
  // ... existing fields ...

  // NEW: Training age suitability
  minTrainingAge  TrainingAge?   // Minimum recommended training age

  // NEW: Performance tracking relation
  exposures       ExerciseExposure[]

  // ... rest of existing fields ...
}
```

---

## Migration Scripts

### Phase 1: Add New Tables (Week 1)

```typescript
// prisma/migrations/20260214_add_periodization/migration.sql

-- Create new enums
CREATE TYPE "BlockType" AS ENUM ('ACCUMULATION', 'INTENSIFICATION', 'REALIZATION', 'DELOAD', 'RESTORATION');
CREATE TYPE "VolumeTarget" AS ENUM ('MEV', 'MAV', 'APPROACHING_MRV', 'DELOAD_VOLUME');
CREATE TYPE "IntensityBias" AS ENUM ('STRENGTH', 'HYPERTROPHY', 'POWER', 'MUSCULAR_ENDURANCE');
CREATE TYPE "AdaptationType" AS ENUM ('EARLY_DELOAD', 'BLOCK_EXTENSION', 'GOAL_SHIFT', 'EXERCISE_SWAP', 'VOLUME_REDUCTION', 'INTENSITY_REDUCTION', 'STALL_INTERVENTION');

-- MacroCycle
CREATE TABLE "MacroCycle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "trainingAge" "TrainingAge" NOT NULL,
    "primaryGoal" "TrainingGoal" NOT NULL,
    "secondaryGoals" "TrainingGoal"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currentMeso" INTEGER NOT NULL DEFAULT 0,
    "completedWeeks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroCycle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MacroCycle_userId_isActive_key" ON "MacroCycle"("userId", "isActive") WHERE "isActive" = true;
CREATE INDEX "MacroCycle_userId_isActive_idx" ON "MacroCycle"("userId", "isActive");
CREATE INDEX "MacroCycle_startDate_idx" ON "MacroCycle"("startDate");

ALTER TABLE "MacroCycle" ADD CONSTRAINT "MacroCycle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mesocycle
CREATE TABLE "Mesocycle" (
    "id" TEXT NOT NULL,
    "macroCycleId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "totalWeeks" INTEGER NOT NULL,
    "currentBlock" INTEGER NOT NULL DEFAULT 0,
    "currentWeekInBlock" INTEGER NOT NULL DEFAULT 0,
    "primaryGoal" "TrainingGoal" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mesocycle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Mesocycle_macroCycleId_orderIndex_key" ON "Mesocycle"("macroCycleId", "orderIndex");
CREATE INDEX "Mesocycle_macroCycleId_idx" ON "Mesocycle"("macroCycleId");

ALTER TABLE "Mesocycle" ADD CONSTRAINT "Mesocycle_macroCycleId_fkey" FOREIGN KEY ("macroCycleId") REFERENCES "MacroCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TrainingBlock
CREATE TABLE "TrainingBlock" (
    "id" TEXT NOT NULL,
    "mesocycleId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "blockType" "BlockType" NOT NULL,
    "durationWeeks" INTEGER NOT NULL,
    "volumeTarget" "VolumeTarget" NOT NULL,
    "intensityBias" "IntensityBias" NOT NULL,
    "weeklyVolumeRamp" DOUBLE PRECISION NOT NULL DEFAULT 1.10,
    "rirStart" DOUBLE PRECISION NOT NULL,
    "rirEnd" DOUBLE PRECISION NOT NULL,
    "mainLifts" JSONB NOT NULL,
    "accessoryPool" JSONB NOT NULL,
    "rotationPolicy" JSONB NOT NULL,
    "allowAutoScale" BOOLEAN NOT NULL DEFAULT true,
    "deloadTriggers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingBlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrainingBlock_mesocycleId_orderIndex_key" ON "TrainingBlock"("mesocycleId", "orderIndex");
CREATE INDEX "TrainingBlock_mesocycleId_idx" ON "TrainingBlock"("mesocycleId");

ALTER TABLE "TrainingBlock" ADD CONSTRAINT "TrainingBlock_mesocycleId_fkey" FOREIGN KEY ("mesocycleId") REFERENCES "Mesocycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- MacroAdaptation
CREATE TABLE "MacroAdaptation" (
    "id" TEXT NOT NULL,
    "macroCycleId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "AdaptationType" NOT NULL,
    "reason" TEXT NOT NULL,
    "blockAffected" TEXT,
    "autoTriggered" BOOLEAN NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "MacroAdaptation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MacroAdaptation_macroCycleId_date_idx" ON "MacroAdaptation"("macroCycleId", "date");

ALTER TABLE "MacroAdaptation" ADD CONSTRAINT "MacroAdaptation_macroCycleId_fkey" FOREIGN KEY ("macroCycleId") REFERENCES "MacroCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ExerciseExposure
CREATE TABLE "ExerciseExposure" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "lastUsed" TIMESTAMP(3) NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "performance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseExposure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExerciseExposure_userId_exerciseId_key" ON "ExerciseExposure"("userId", "exerciseId");
CREATE INDEX "ExerciseExposure_userId_lastUsed_idx" ON "ExerciseExposure"("userId", "lastUsed");

ALTER TABLE "ExerciseExposure" ADD CONSTRAINT "ExerciseExposure_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExerciseExposure" ADD CONSTRAINT "ExerciseExposure_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ReadinessSignal
CREATE TABLE "ReadinessSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "whoopRecovery" DOUBLE PRECISION,
    "whoopStrain" DOUBLE PRECISION,
    "whoopHrv" DOUBLE PRECISION,
    "whoopSleepQuality" DOUBLE PRECISION,
    "whoopSleepHours" DOUBLE PRECISION,
    "subjectiveReadiness" INTEGER NOT NULL,
    "subjectiveSoreness" JSONB NOT NULL,
    "subjectiveMotivation" INTEGER NOT NULL,
    "subjectiveStress" INTEGER,
    "performanceRpe" DOUBLE PRECISION NOT NULL,
    "performanceStalls" INTEGER NOT NULL,
    "performanceCompliance" DOUBLE PRECISION NOT NULL,
    "fatigueScore" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ReadinessSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReadinessSignal_userId_timestamp_idx" ON "ReadinessSignal"("userId", "timestamp");

ALTER TABLE "ReadinessSignal" ADD CONSTRAINT "ReadinessSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- UserIntegration
CREATE TABLE "UserIntegration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserIntegration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserIntegration_userId_provider_key" ON "UserIntegration"("userId", "provider");
CREATE INDEX "UserIntegration_userId_isActive_idx" ON "UserIntegration"("userId", "isActive");

ALTER TABLE "UserIntegration" ADD CONSTRAINT "UserIntegration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

### Phase 1: Extend Existing Tables (Week 1)

```typescript
// prisma/migrations/20260214_extend_workout/migration.sql

-- Add block context to Workout
ALTER TABLE "Workout" ADD COLUMN "trainingBlockId" TEXT;
ALTER TABLE "Workout" ADD COLUMN "weekInBlock" INTEGER;
ALTER TABLE "Workout" ADD COLUMN "blockPhase" TEXT;
ALTER TABLE "Workout" ADD COLUMN "selectionRationale" JSONB;
ALTER TABLE "Workout" ADD COLUMN "wasAutoregulated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workout" ADD COLUMN "autoregulationLog" JSONB;

ALTER TABLE "Workout" ADD CONSTRAINT "Workout_trainingBlockId_fkey"
    FOREIGN KEY ("trainingBlockId") REFERENCES "TrainingBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Workout_trainingBlockId_idx" ON "Workout"("trainingBlockId");

-- Add rationale to WorkoutExercise
ALTER TABLE "WorkoutExercise" ADD COLUMN "selectionReason" JSONB;
ALTER TABLE "WorkoutExercise" ADD COLUMN "prescriptionRationale" JSONB;

-- Add training age to Exercise
ALTER TABLE "Exercise" ADD COLUMN "minTrainingAge" "TrainingAge";
```

---

## Backfill Script

```typescript
// scripts/backfill-periodization.ts

import { PrismaClient } from '@prisma/client'
import { generateMacroCycle } from '../src/lib/engine/periodization/generate-macro'
import { assessTrainingAge } from '../src/lib/api/training-age'

const prisma = new PrismaClient()

async function backfillAllUsers() {
  console.log('🔄 Backfilling periodization data...')

  const users = await prisma.user.findMany({
    include: {
      workouts: {
        where: { status: 'COMPLETED' },
        orderBy: { date: 'desc' },
        take: 50,
        include: { exercises: true },
      },
      goals: true,
      constraints: true,
    },
  })

  console.log(`Found ${users.length} users`)

  for (const user of users) {
    try {
      // Skip if already has active macro
      const existing = await prisma.macroCycle.findFirst({
        where: { userId: user.id, isActive: true },
      })

      if (existing) {
        console.log(`  ✓ User ${user.id} already has macro`)
        continue
      }

      // Assess training age from history
      const trainingAge = await assessTrainingAge(user.id)

      // Generate macro cycle
      const macro = generateMacroCycle({
        userId: user.id,
        trainingAge,
        primaryGoal: user.goals?.primaryGoal ?? 'hypertrophy',
        availableDaysPerWeek: user.constraints?.daysPerWeek ?? 3,
        sessionMinutes: user.constraints?.sessionMinutes ?? 60,
      })

      // Persist
      await prisma.macroCycle.create({
        data: {
          userId: user.id,
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
      })

      // Backfill ExerciseExposure
      await backfillExerciseExposure(user.id, user.workouts)

      console.log(`  ✓ Created macro for user ${user.id} (${trainingAge})`)
    } catch (error) {
      console.error(`  ✗ Failed for user ${user.id}:`, error)
    }
  }

  console.log('✅ Backfill complete!')
}

async function backfillExerciseExposure(userId: string, workouts: Workout[]) {
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
        performance: { trend: 'improving' },
      },
      update: {
        lastUsed: data.lastUsed,
        usageCount: data.count,
      },
    })
  }
}

backfillAllUsers()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
```

---

## Rollback Plan

If migration fails or issues detected:

```sql
-- Rollback Phase 1 (drop new tables only, preserve existing data)
DROP TABLE IF EXISTS "UserIntegration" CASCADE;
DROP TABLE IF EXISTS "ReadinessSignal" CASCADE;
DROP TABLE IF EXISTS "ExerciseExposure" CASCADE;
DROP TABLE IF EXISTS "MacroAdaptation" CASCADE;
DROP TABLE IF EXISTS "TrainingBlock" CASCADE;
DROP TABLE IF EXISTS "Mesocycle" CASCADE;
DROP TABLE IF EXISTS "MacroCycle" CASCADE;

DROP TYPE IF EXISTS "AdaptationType";
DROP TYPE IF EXISTS "IntensityBias";
DROP TYPE IF EXISTS "VolumeTarget";
DROP TYPE IF EXISTS "BlockType";

-- Rollback Workout extensions
ALTER TABLE "Workout" DROP COLUMN IF EXISTS "autoregulationLog";
ALTER TABLE "Workout" DROP COLUMN IF EXISTS "wasAutoregulated";
ALTER TABLE "Workout" DROP COLUMN IF EXISTS "selectionRationale";
ALTER TABLE "Workout" DROP COLUMN IF EXISTS "blockPhase";
ALTER TABLE "Workout" DROP COLUMN IF EXISTS "weekInBlock";
ALTER TABLE "Workout" DROP COLUMN IF EXISTS "trainingBlockId";

ALTER TABLE "WorkoutExercise" DROP COLUMN IF EXISTS "prescriptionRationale";
ALTER TABLE "WorkoutExercise" DROP COLUMN IF EXISTS "selectionReason";

ALTER TABLE "Exercise" DROP COLUMN IF EXISTS "minTrainingAge";
```

---

## Data Validation

Post-migration checks:

```typescript
// scripts/validate-migration.ts

async function validateMigration() {
  const checks = [
    {
      name: 'All users have macro cycles',
      query: async () => {
        const users = await prisma.user.count()
        const macros = await prisma.macroCycle.count({ where: { isActive: true } })
        return users === macros
      },
    },
    {
      name: 'All macros have mesocycles',
      query: async () => {
        const macros = await prisma.macroCycle.findMany({ include: { mesocycles: true } })
        return macros.every(m => m.mesocycles.length > 0)
      },
    },
    {
      name: 'All mesocycles have blocks',
      query: async () => {
        const mesos = await prisma.mesocycle.findMany({ include: { blocks: true } })
        return mesos.every(m => m.blocks.length > 0)
      },
    },
    {
      name: 'ExerciseExposure matches recent workouts',
      query: async () => {
        const recentWorkouts = await prisma.workout.findMany({
          where: { status: 'COMPLETED', date: { gte: new Date('2026-01-01') } },
          include: { exercises: true },
        })

        const exposures = await prisma.exerciseExposure.findMany()

        // Every recent exercise should have exposure
        const exerciseIds = new Set(
          recentWorkouts.flatMap(w => w.exercises.map(e => e.exerciseId))
        )

        const exposureIds = new Set(exposures.map(e => e.exerciseId))

        for (const id of exerciseIds) {
          if (!exposureIds.has(id)) return false
        }

        return true
      },
    },
  ]

  console.log('🔍 Validating migration...\n')

  for (const check of checks) {
    try {
      const passed = await check.query()
      console.log(`${passed ? '✓' : '✗'} ${check.name}`)
    } catch (error) {
      console.log(`✗ ${check.name} - Error: ${error.message}`)
    }
  }

  console.log('\n✅ Validation complete')
}
```

---

## Next Steps

1. **Review schema** with DB team
2. **Dry-run migration** on staging
3. **Validate backfill** script
4. **Monitor performance** (JSONB query speed)
5. **Document rollback** procedure

**Estimated Effort:** 1 week (included in Phase 1)
