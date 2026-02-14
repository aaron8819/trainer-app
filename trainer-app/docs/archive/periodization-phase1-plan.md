# Phase 1: Periodization Foundation - Implementation Plan

## Context

The Trainer app currently generates workouts using a template-centric approach with basic 4-week periodization blocks. This redesign transforms it into a **periodization-first training system** with structured macro → meso → block hierarchy that matches evidence-based training research.

**Problem:** The current system lacks:
- True multi-week periodization structure (only 4-week rolling blocks)
- Block-based training phases (accumulation, intensification, realization, deload)
- Exercise rotation tracking across mesocycles
- Transparent progression through training phases

**Solution (Phase 1):** Establish foundational periodization infrastructure:
- Database schema for MacroCycle → Mesocycle → TrainingBlock hierarchy
- Engine modules to generate periodized training blocks
- Block-aware prescription that modifies volume/intensity by training phase
- Migration to assign all users to periodized macrocycles

This sets the foundation for future phases (multi-objective selection, autoregulation, explainability).

---

## Architecture Overview

**Existing Patterns to Preserve:**
- Engine is pure (no DB imports in `src/lib/engine/`)
- Type mapping at API boundary (Prisma UPPER_CASE → engine lowercase)
- Seeded PRNG for deterministic tests (`random.ts`)
- Barrel exports in `src/lib/engine/index.ts`
- Zod validation in `src/lib/validation.ts`
- Thin route handlers in `src/app/api/`

**New Modules:**
```
src/lib/engine/periodization/
  ├── types.ts              # BlockType, VolumeTarget, IntensityBias, BlockContext
  ├── generate-macro.ts     # Core macro generation logic
  ├── block-context.ts      # Derive current block from macro + date
  └── prescribe-with-block.ts  # Apply block modifiers to prescriptions

src/lib/api/
  └── periodization-mappers.ts  # Prisma ↔ engine type mapping
```

**Database Changes:**
- New tables: MacroCycle, Mesocycle, TrainingBlock, ExerciseExposure
- Extended Workout: trainingBlockId, weekInBlock, blockPhase
- New enums: BlockType, VolumeTarget, IntensityBias, AdaptationType

---

## Week 1: Schema Design & Migration

### Task 1.1: Define Prisma Schema (Day 1-2)

**File:** `trainer-app/prisma/schema.prisma`

**Add new enums:**
```prisma
enum BlockType {
  ACCUMULATION      // High volume, moderate intensity
  INTENSIFICATION   // Moderate volume, high intensity
  REALIZATION       // Low volume, peak intensity (testing)
  DELOAD           // Low volume, low intensity (recovery)
}

enum VolumeTarget {
  LOW              // ~50% of normal
  MODERATE         // ~70-80% of normal
  HIGH             // ~90-100% of normal
  PEAK             // ~100-110% of normal (approaching MRV)
}

enum IntensityBias {
  STRENGTH         // 1-6 reps, heavy loads
  HYPERTROPHY      // 6-12 reps, moderate loads
  ENDURANCE        // 12-20+ reps, lighter loads
}

enum AdaptationType {
  NEURAL_ADAPTATION           // Strength gains via CNS efficiency
  MYOFIBRILLAR_HYPERTROPHY   // Muscle fiber growth
  SARCOPLASMIC_HYPERTROPHY   // Metabolic adaptations
  WORK_CAPACITY              // Conditioning
  RECOVERY                   // Active recovery
}
```

**Add new models:**
```prisma
model MacroCycle {
  id              String      @id @default(cuid())
  userId          String
  user            User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  startDate       DateTime
  endDate         DateTime
  durationWeeks   Int

  trainingAge     TrainingAge
  primaryGoal     PrimaryGoal

  mesocycles      Mesocycle[]

  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@index([userId, startDate])
}

model Mesocycle {
  id              String        @id @default(cuid())
  macroCycleId    String
  macroCycle      MacroCycle    @relation(fields: [macroCycleId], references: [id], onDelete: Cascade)

  mesoNumber      Int           // 1, 2, 3... within macro
  startWeek       Int           // Week offset from macro start (0-indexed)
  durationWeeks   Int

  focus           String        // "Upper Body Hypertrophy", "Lower Strength", etc.
  volumeTarget    VolumeTarget
  intensityBias   IntensityBias

  blocks          TrainingBlock[]

  @@unique([macroCycleId, mesoNumber])
  @@index([macroCycleId])
}

model TrainingBlock {
  id              String          @id @default(cuid())
  mesocycleId     String
  mesocycle       Mesocycle       @relation(fields: [mesocycleId], references: [id], onDelete: Cascade)

  blockNumber     Int             // 1, 2, 3... within meso
  blockType       BlockType

  startWeek       Int             // Week offset from macro start
  durationWeeks   Int

  volumeTarget    VolumeTarget
  intensityBias   IntensityBias
  adaptationType  AdaptationType

  workouts        Workout[]

  @@unique([mesocycleId, blockNumber])
  @@index([mesocycleId])
}

model ExerciseExposure {
  id              String      @id @default(cuid())
  userId          String
  user            User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  exerciseName    String
  lastUsedAt      DateTime
  timesUsedL4W    Int         @default(0)  // Last 4 weeks
  timesUsedL8W    Int         @default(0)  // Last 8 weeks
  timesUsedL12W   Int         @default(0)  // Last 12 weeks

  avgSetsPerWeek  Float       @default(0)
  avgVolumePerWeek Float      @default(0)

  updatedAt       DateTime    @updatedAt

  @@unique([userId, exerciseName])
  @@index([userId, lastUsedAt])
}
```

**Extend Workout:**
```prisma
model Workout {
  // ... existing fields ...

  // Periodization context (nullable for backward compat)
  trainingBlockId    String?
  trainingBlock      TrainingBlock? @relation(fields: [trainingBlockId], references: [id])

  weekInBlock        Int?           // 1, 2, 3 within block
  blockPhase         BlockType?     // Denormalized for display

  @@index([trainingBlockId])
}
```

**Migration:** `prisma/migrations/YYYYMMDDHHMMSS_add_periodization_schema/migration.sql`
- Use idempotent DDL: `CREATE TABLE IF NOT EXISTS`, `DO $$ BEGIN...EXCEPTION WHEN duplicate_object THEN null; END $$`
- All new columns nullable for backward compatibility

**Commands:**
```bash
cd trainer-app
npx prisma migrate dev --name add_periodization_schema
npm run prisma:generate
```

### Task 1.2: Define Engine Types (Day 2)

**File:** `trainer-app/src/lib/engine/periodization/types.ts`

```typescript
// Engine types use lowercase unions (not Prisma UPPER_CASE)
export type BlockType = 'accumulation' | 'intensification' | 'realization' | 'deload';
export type VolumeTarget = 'low' | 'moderate' | 'high' | 'peak';
export type IntensityBias = 'strength' | 'hypertrophy' | 'endurance';
export type AdaptationType =
  | 'neural_adaptation'
  | 'myofibrillar_hypertrophy'
  | 'sarcoplasmic_hypertrophy'
  | 'work_capacity'
  | 'recovery';

export type TrainingBlock = {
  id: string;
  mesocycleId: string;
  blockNumber: number;
  blockType: BlockType;
  startWeek: number;
  durationWeeks: number;
  volumeTarget: VolumeTarget;
  intensityBias: IntensityBias;
  adaptationType: AdaptationType;
};

export type Mesocycle = {
  id: string;
  macroCycleId: string;
  mesoNumber: number;
  startWeek: number;
  durationWeeks: number;
  focus: string;
  volumeTarget: VolumeTarget;
  intensityBias: IntensityBias;
  blocks: TrainingBlock[];
};

export type MacroCycle = {
  id: string;
  userId: string;
  startDate: Date;
  endDate: Date;
  durationWeeks: number;
  trainingAge: 'beginner' | 'intermediate' | 'advanced';
  primaryGoal: 'strength' | 'hypertrophy' | 'fat_loss' | 'general_fitness';
  mesocycles: Mesocycle[];
};

export type BlockContext = {
  block: TrainingBlock;
  weekInBlock: number;        // 1-indexed
  weekInMeso: number;
  weekInMacro: number;
  mesocycle: Mesocycle;
  macroCycle: MacroCycle;
};

export type PrescriptionModifiers = {
  volumeMultiplier: number;    // 0.5 (deload) to 1.2 (peak)
  intensityMultiplier: number; // 0.7 (accumulation) to 1.0 (realization)
  rirAdjustment: number;       // -1 to +3 (closer to failure in realization)
  restMultiplier: number;      // 0.8 to 1.2
};
```

### Task 1.3: Type Mappers (Day 2-3)

**File:** `trainer-app/src/lib/api/periodization-mappers.ts`

Create bidirectional mappers (Prisma UPPER_CASE ↔ engine lowercase) for:
- BlockType, VolumeTarget, IntensityBias, AdaptationType
- TrainingBlock, Mesocycle, MacroCycle models

**Pattern (follows existing mappers in workout-context.ts):**
```typescript
import type { BlockType as PrismaBlockType } from '@prisma/client';
import type { BlockType } from '@/lib/engine/periodization/types';

export function mapBlockType(prisma: PrismaBlockType): BlockType {
  const map: Record<PrismaBlockType, BlockType> = {
    ACCUMULATION: 'accumulation',
    INTENSIFICATION: 'intensification',
    REALIZATION: 'realization',
    DELOAD: 'deload',
  };
  return map[prisma];
}

export function toPrismaBlockType(engine: BlockType): PrismaBlockType {
  const map: Record<BlockType, PrismaBlockType> = {
    accumulation: 'ACCUMULATION',
    intensification: 'INTENSIFICATION',
    realization: 'REALIZATION',
    deload: 'DELOAD',
  };
  return map[engine];
}
```

### Task 1.4: Validation Schemas (Day 3)

**File:** `trainer-app/src/lib/validation.ts`

Add Zod schemas for API input validation:
```typescript
export const generateMacroSchema = z.object({
  userId: z.string().cuid(),
  startDate: z.coerce.date(),
  durationWeeks: z.number().int().min(4).max(52),
  trainingAge: trainingAgeSchema,
  primaryGoal: goalSchema,
});
```

---

## Week 2: Macro Cycle Generation Engine

### Task 2.1: Block Configuration Rules (Day 1-2)

**File:** `trainer-app/src/lib/engine/periodization/block-config.ts`

Define evidence-based block templates by training age:

```typescript
export function getMesoTemplateForAge(
  trainingAge: TrainingAge,
  goal: Goal
): BlockTemplate[] {
  if (trainingAge === 'beginner') {
    // Simpler: 3 weeks accumulation + 1 week deload
    return [
      { blockType: 'accumulation', durationWeeks: 3, volumeTarget: 'moderate', ... },
      { blockType: 'deload', durationWeeks: 1, volumeTarget: 'low', ... },
    ];
  }
  if (trainingAge === 'intermediate') {
    // 3-block wave: 2 acc + 2 int + 1 deload
    return [
      { blockType: 'accumulation', durationWeeks: 2, volumeTarget: 'high', ... },
      { blockType: 'intensification', durationWeeks: 2, volumeTarget: 'moderate', ... },
      { blockType: 'deload', durationWeeks: 1, volumeTarget: 'low', ... },
    ];
  }
  // Advanced: 4-block conjugate (acc + int + real + deload)
  return [...];
}

export function getPrescriptionModifiers(
  blockType: BlockType,
  weekInBlock: number,
  durationWeeks: number
): PrescriptionModifiers {
  const progress = weekInBlock / durationWeeks; // 0.0 to 1.0

  switch (blockType) {
    case 'accumulation':
      return {
        volumeMultiplier: 1.0 + progress * 0.2,  // 1.0 → 1.2
        intensityMultiplier: 0.7 + progress * 0.1, // 0.7 → 0.8
        rirAdjustment: 2,  // Further from failure
        restMultiplier: 0.9,
      };
    case 'deload':
      return { volumeMultiplier: 0.5, intensityMultiplier: 0.7, rirAdjustment: 3, restMultiplier: 0.8 };
    // ... other block types
  }
}
```

### Task 2.2: Macro Generation Core (Day 2-3)

**File:** `trainer-app/src/lib/engine/periodization/generate-macro.ts`

```typescript
export function generateMacroCycle(input: GenerateMacroInput): MacroCycle {
  const { userId, startDate, durationWeeks, trainingAge, primaryGoal } = input;

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + durationWeeks * 7);

  const mesocycles = buildMesocycles({ trainingAge, primaryGoal, totalWeeks: durationWeeks });

  return {
    id: createId(),
    userId,
    startDate,
    endDate,
    durationWeeks,
    trainingAge,
    primaryGoal,
    mesocycles,
  };
}
```

**Reuses:** `createId()` from `src/lib/engine/utils.ts`

### Task 2.3: Unit Tests (Day 3-4)

**File:** `trainer-app/src/lib/engine/periodization/generate-macro.test.ts`

**Coverage targets (95%):**
- Beginner: 12 weeks → 3 mesos (4 weeks each: 3 acc + 1 deload)
- Intermediate: 15 weeks → 3 mesos (5 weeks each: 2 acc + 2 int + 1 deload)
- Advanced: 18 weeks → 3 mesos (6 weeks each: 2 acc + 2 int + 1 real + 1 deload)
- Week offset calculations
- EndDate calculation

**Pattern (follows existing tests):**
```typescript
import { describe, it, expect } from 'vitest';
import { generateMacroCycle } from './generate-macro';

describe('generateMacroCycle', () => {
  it('should generate 3 mesos for beginner with 12 weeks', () => {
    const macro = generateMacroCycle({
      userId: 'user-123',
      startDate: new Date('2026-03-01'),
      durationWeeks: 12,
      trainingAge: 'beginner',
      primaryGoal: 'hypertrophy',
    });

    expect(macro.mesocycles).toHaveLength(3);
    expect(macro.mesocycles[0].blocks[0].blockType).toBe('accumulation');
  });
});
```

### Task 2.4: Block Context Derivation (Day 4)

**File:** `trainer-app/src/lib/engine/periodization/block-context.ts`

```typescript
export function deriveBlockContext(
  macro: MacroCycle,
  workoutDate: Date
): BlockContext | null {
  const weekInMacro = Math.floor(
    (workoutDate.getTime() - macro.startDate.getTime()) / (1000 * 60 * 60 * 24 * 7)
  ) + 1; // 1-indexed

  if (weekInMacro < 1 || weekInMacro > macro.durationWeeks) {
    return null;
  }

  // Find matching meso → block → derive context
  // ...
}
```

**Tests:** Week 1 → meso 1 block 1, Week 4 → deload, out-of-range → null

### Task 2.5: Update Barrel Exports (Day 5)

**File:** `trainer-app/src/lib/engine/index.ts`

```typescript
// Periodization
export type { BlockType, VolumeTarget, IntensityBias, MacroCycle, Mesocycle, TrainingBlock, BlockContext, PrescriptionModifiers } from './periodization/types';
export { generateMacroCycle } from './periodization/generate-macro';
export { deriveBlockContext } from './periodization/block-context';
export { getPrescriptionModifiers } from './periodization/block-config';
```

---

## Week 3: Block-Aware Prescription

### Task 3.1: Prescription with Block Context (Day 1-2)

**File:** `trainer-app/src/lib/engine/periodization/prescribe-with-block.ts`

```typescript
export function prescribeWithBlock(input: PrescribeWithBlockInput): ExercisePrescription {
  const { basePrescription, blockContext } = input;

  if (!blockContext) {
    return basePrescription; // Backward compat: no block → use base
  }

  const modifiers = getPrescriptionModifiers(
    blockContext.block.blockType,
    blockContext.weekInBlock,
    blockContext.block.durationWeeks
  );

  return {
    ...basePrescription,
    sets: Math.max(1, Math.round(basePrescription.sets * modifiers.volumeMultiplier)),
    rir: clamp(basePrescription.rir + modifiers.rirAdjustment, 0, 4),
    restSec: Math.round(basePrescription.restSec * modifiers.restMultiplier),
  };
}
```

**Reuses:** Existing `clamp()` utility

### Task 3.2: Integrate into Session Generation (Day 2-3)

**Files to modify:**
- `trainer-app/src/lib/engine/template-session.ts` (or equivalent session generator)

**Changes:**
- Add optional `blockContext?: BlockContext | null` parameter
- Call `prescribeWithBlock()` after base prescription
- Existing tests pass with `blockContext: null`

### Task 3.3: Integration Tests (Day 3-4)

**File:** `trainer-app/src/lib/engine/periodization/prescribe-with-block.test.ts`

Test all 4 block types:
- Accumulation → higher volume, lower intensity, RIR +2
- Intensification → moderate volume, higher intensity, RIR +1
- Realization → low volume, max intensity, RIR 0
- Deload → 50% volume, 70% intensity, RIR +3
- Null blockContext → returns base unchanged

### Task 3.4: Load Assignment with Block Context (Day 4-5)

**Files to modify:**
- `trainer-app/src/lib/engine/apply-loads.ts`

**Changes:**
- Add optional `prescriptionModifiers?: PrescriptionModifiers | null`
- Apply `intensityMultiplier` to calculated loads
- Preserve existing rounding to nearest 0.5

---

## Week 4: Migration & Alpha Launch

### Task 4.1: Backfill Script - MacroCycle (Day 1)

**File:** `trainer-app/scripts/backfill-macro-cycles.ts`

```typescript
async function backfillMacroCycles() {
  const users = await prisma.user.findMany({ include: { profile: true, goals: true } });

  for (const user of users) {
    const existingMacro = await prisma.macroCycle.findFirst({ where: { userId: user.id } });
    if (existingMacro) continue;

    const macro = generateMacroCycle({
      userId: user.id,
      startDate: new Date(),
      durationWeeks: 12,
      trainingAge: user.profile.trainingAge.toLowerCase() as any,
      primaryGoal: user.goals.primaryGoal.toLowerCase() as any,
    });

    await prisma.macroCycle.create({
      data: {
        // ... nested create for mesos + blocks
      },
    });
  }
}
```

**Run:** `npx tsx scripts/backfill-macro-cycles.ts`

### Task 4.2: Backfill Script - ExerciseExposure (Day 1)

**File:** `trainer-app/scripts/backfill-exercise-exposure.ts`

Aggregate workout history from last 12 weeks:
- Count exercise usage in L4W/L8W/L12W windows
- Calculate avg sets/volume per week
- Use `upsert` for idempotency

### Task 4.3: API Route - Generate Macro (Day 2)

**File:** `trainer-app/src/app/api/periodization/macro/route.ts`

```typescript
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const validation = generateMacroSchema.safeParse(body);
  if (!validation.success) return NextResponse.json({ error: validation.error.message }, { status: 400 });

  const macro = generateMacroCycle({ ...validation.data, userId: session.user.id });

  const created = await prisma.macroCycle.create({
    data: { /* nested create */ },
    include: { mesocycles: { include: { blocks: true } } },
  });

  return NextResponse.json({ macro: created });
}
```

**Pattern:** Thin handler (follows existing route patterns in `src/app/api/workouts/`)

### Task 4.4: API Helper - Load Current Block Context (Day 2)

**File:** `trainer-app/src/lib/api/periodization.ts`

```typescript
export async function loadCurrentBlockContext(
  userId: string,
  date: Date = new Date()
): Promise<BlockContext | null> {
  const macro = await prisma.macroCycle.findFirst({
    where: { userId, startDate: { lte: date }, endDate: { gte: date } },
    include: { mesocycles: { include: { blocks: true } } },
  });

  if (!macro) return null;

  const engineMacro = mapMacroCycle(macro);
  return deriveBlockContext(engineMacro, date);
}
```

### Task 4.5: UI Component - Block Context Banner (Day 3)

**File:** `trainer-app/src/components/BlockContextBanner.tsx`

```typescript
'use client';

export function BlockContextBanner({ blockContext }: { blockContext: BlockContext | null }) {
  if (!blockContext) return null;

  return (
    <div className="rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 p-4 text-white">
      <div className="text-sm">{blockContext.mesocycle.focus}</div>
      <div className="text-lg font-bold">
        {blockContext.block.blockType.toUpperCase()} Block • Week {blockContext.weekInBlock}/{blockContext.block.durationWeeks}
      </div>
    </div>
  );
}
```

### Task 4.6: Wire Block Context into Workout Generation (Day 3-4)

**Files to modify:**
- `trainer-app/src/app/api/workouts/generate-from-template/route.ts` (or equivalent)

**Changes:**
```typescript
const blockContext = await loadCurrentBlockContext(session.user.id);

const sessionResult = generateSessionFromTemplate({
  // ... existing params
  blockContext,
});

const prescriptionModifiers = blockContext
  ? getPrescriptionModifiers(blockContext.block.blockType, blockContext.weekInBlock, blockContext.block.durationWeeks)
  : null;

const finalSession = applyLoads({
  session: sessionResult,
  prescriptionModifiers,
  // ... other params
});

// Save to DB with trainingBlockId, weekInBlock, blockPhase
```

### Task 4.7: Testing & Validation (Day 4-5)

**Checklist:**
- [ ] All unit tests pass (95%+ coverage)
- [ ] Integration tests pass
- [ ] Migration applies cleanly in staging
- [ ] Backfill scripts run successfully
- [ ] API route works end-to-end
- [ ] BlockContextBanner renders correctly
- [ ] Generated workouts include block context

---

## Critical Files Reference

**Schema & Migrations:**
- `trainer-app/prisma/schema.prisma` - Add MacroCycle, Mesocycle, TrainingBlock, ExerciseExposure models
- `trainer-app/prisma/migrations/YYYYMMDDHHMMSS_add_periodization_schema/migration.sql` - Idempotent DDL

**Engine (Pure Logic):**
- `trainer-app/src/lib/engine/periodization/types.ts` - Type definitions
- `trainer-app/src/lib/engine/periodization/generate-macro.ts` - **Core macro generation** (most critical)
- `trainer-app/src/lib/engine/periodization/block-context.ts` - Date → block context derivation
- `trainer-app/src/lib/engine/periodization/block-config.ts` - Block templates & modifiers
- `trainer-app/src/lib/engine/periodization/prescribe-with-block.ts` - Block-aware prescription
- `trainer-app/src/lib/engine/index.ts` - Barrel exports (add periodization exports)

**API Layer (DB ↔ Engine):**
- `trainer-app/src/lib/api/periodization-mappers.ts` - Prisma ↔ engine type mapping
- `trainer-app/src/lib/api/periodization.ts` - loadCurrentBlockContext()

**Routes (HTTP Handlers):**
- `trainer-app/src/app/api/periodization/macro/route.ts` - POST /api/periodization/macro

**UI Components:**
- `trainer-app/src/components/BlockContextBanner.tsx` - Block context display

**Scripts:**
- `trainer-app/scripts/backfill-macro-cycles.ts` - Create macros for all users
- `trainer-app/scripts/backfill-exercise-exposure.ts` - Populate exposure from history

**Tests:**
- `trainer-app/src/lib/engine/periodization/*.test.ts` - Unit tests (95% coverage target)

**Validation:**
- `trainer-app/src/lib/validation.ts` - Add generateMacroSchema

**Existing Patterns to Reuse:**
- `trainer-app/src/lib/engine/utils.ts` - createId(), clamp(), roundLoad()
- `trainer-app/src/lib/engine/rules.ts` - Existing PeriodizationModifiers pattern
- `trainer-app/src/lib/api/workout-context.ts` - Type mapping pattern (Prisma → engine)
- `trainer-app/src/lib/engine/sample-data.ts` - Test fixture patterns

---

## Success Criteria

**Week 1 Gate:**
- [ ] Migration applies cleanly (`npx prisma migrate status` shows applied)
- [ ] `npx prisma db pull --print` matches schema.prisma
- [ ] Type mappers pass TypeScript strict mode
- [ ] No lint/tsc errors

**Week 2 Gate:**
- [ ] `generate-macro.test.ts` passes with 95%+ coverage
- [ ] All training ages generate correct block structures
- [ ] Week offset calculations verified
- [ ] `deriveBlockContext()` handles edge cases (out-of-range dates)

**Week 3 Gate:**
- [ ] `prescribe-with-block.test.ts` passes with 95%+ coverage
- [ ] All 4 block types tested
- [ ] Integration tests verify modifiers applied
- [ ] Existing template-mode tests still pass (backward compat)

**Week 4 Gate:**
- [ ] Backfill scripts run successfully in staging
- [ ] All users have MacroCycle assigned
- [ ] ExerciseExposure populated for users with workouts
- [ ] API route `/api/periodization/macro` works end-to-end
- [ ] BlockContextBanner renders correctly
- [ ] Generated workouts include trainingBlockId + weekInBlock
- [ ] Zero production errors for 48h after deployment

---

## Rollback Plan

**Scenario: Migration breaks production**

1. Revert migration:
   ```bash
   npx prisma migrate resolve --rolled-back <migration-name>
   ```
2. Drop new tables:
   ```sql
   DROP TABLE IF EXISTS "ExerciseExposure" CASCADE;
   DROP TABLE IF EXISTS "TrainingBlock" CASCADE;
   DROP TABLE IF EXISTS "Mesocycle" CASCADE;
   DROP TABLE IF EXISTS "MacroCycle" CASCADE;
   ```
3. Regenerate client: `npm run prisma:generate`
4. Restart app

**Scenario: Backfill fails**
- Identify failed users via logs
- Delete partial data: `DELETE FROM "MacroCycle" WHERE "userId" IN (...)`
- Fix script, re-run (idempotent via upsert)

**Scenario: Engine logic issues**
- Feature flag: Add `useBlockPrescription` to user settings (default false)
- Conditional logic: `const blockContext = user.settings.useBlockPrescription ? await loadCurrentBlockContext(userId) : null`
- Monitor for 48h, toggle per user if issues

---

## Verification (Manual QA)

1. Generate macro via API:
   ```bash
   POST /api/periodization/macro
   { "userId": "...", "startDate": "2026-03-01", "durationWeeks": 12, "trainingAge": "INTERMEDIATE", "primaryGoal": "HYPERTROPHY" }
   ```
2. Verify DB:
   ```sql
   SELECT * FROM "MacroCycle" WHERE "userId" = '...';
   SELECT * FROM "Mesocycle" WHERE "macroCycleId" = '...';
   SELECT * FROM "TrainingBlock" WHERE "mesocycleId" = '...';
   ```
3. Generate workout in accumulation → verify higher volume sets
4. Generate workout in deload → verify reduced volume/intensity
5. Check BlockContextBanner displays "ACCUMULATION Block • Week 1/2"

---

## Dependencies & Constraints

**Must preserve:**
- Engine purity (no DB imports in `src/lib/engine/`)
- Backward compatibility (all new fields nullable, blockContext optional)
- Existing test suite (no regressions)
- Type safety (strict mode, exhaustive enum mapping)

**External dependencies:**
- Prisma 7.x (already installed)
- Zod 4.x (already installed)
- Next.js 16 (already configured)

**Timeline:**
- Week 1: 5 days (schema + types + mappers)
- Week 2: 5 days (macro generation + tests)
- Week 3: 5 days (prescription integration + tests)
- Week 4: 5 days (migration + backfill + API + UI)
- **Total: 20 working days (4 weeks)**
