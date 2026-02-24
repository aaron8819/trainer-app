// Type mappers: Prisma (UPPER_CASE) ↔ Engine (lowercase)
// Follows pattern from workout-context.ts

import type {
  MacroCycle as PrismaMacro,
  Mesocycle as PrismaMeso,
  TrainingBlock as PrismaBlock,
  ExerciseExposure as PrismaExposure,
  BlockType as PrismaBlockType,
  VolumeTarget as PrismaVolumeTarget,
  IntensityBias as PrismaIntensityBias,
  AdaptationType as PrismaAdaptationType,
  TrainingAge as PrismaTrainingAge,
  PrimaryGoal as PrismaPrimaryGoal,
} from "@prisma/client";
import type {
  MacroCycle,
  Mesocycle,
  TrainingBlock,
  ExerciseExposure,
  BlockType,
  VolumeTarget,
  IntensityBias,
  AdaptationType,
} from "@/lib/engine/periodization/types";
import type { TrainingAge } from "@/lib/engine/types";

// ========================================
// Enum Mappers (Prisma → Engine)
// ========================================

export function mapBlockType(prisma: PrismaBlockType): BlockType {
  const map: Record<PrismaBlockType, BlockType> = {
    ACCUMULATION: "accumulation",
    INTENSIFICATION: "intensification",
    REALIZATION: "realization",
    DELOAD: "deload",
  };
  return map[prisma];
}

export function mapVolumeTarget(prisma: PrismaVolumeTarget): VolumeTarget {
  const map: Record<PrismaVolumeTarget, VolumeTarget> = {
    LOW: "low",
    MODERATE: "moderate",
    HIGH: "high",
    PEAK: "peak",
  };
  return map[prisma];
}

export function mapIntensityBias(prisma: PrismaIntensityBias): IntensityBias {
  const map: Record<PrismaIntensityBias, IntensityBias> = {
    STRENGTH: "strength",
    HYPERTROPHY: "hypertrophy",
    ENDURANCE: "endurance",
  };
  return map[prisma];
}

export function mapAdaptationType(prisma: PrismaAdaptationType): AdaptationType {
  const map: Record<PrismaAdaptationType, AdaptationType> = {
    NEURAL_ADAPTATION: "neural_adaptation",
    MYOFIBRILLAR_HYPERTROPHY: "myofibrillar_hypertrophy",
    SARCOPLASMIC_HYPERTROPHY: "sarcoplasmic_hypertrophy",
    WORK_CAPACITY: "work_capacity",
    RECOVERY: "recovery",
  };
  return map[prisma];
}

// ========================================
// Reverse Mappers (Engine → Prisma)
// ========================================

export function toPrismaBlockType(engine: BlockType): PrismaBlockType {
  const map: Record<BlockType, PrismaBlockType> = {
    accumulation: "ACCUMULATION",
    intensification: "INTENSIFICATION",
    realization: "REALIZATION",
    deload: "DELOAD",
  };
  return map[engine];
}

export function toPrismaVolumeTarget(engine: VolumeTarget): PrismaVolumeTarget {
  const map: Record<VolumeTarget, PrismaVolumeTarget> = {
    low: "LOW",
    moderate: "MODERATE",
    high: "HIGH",
    peak: "PEAK",
  };
  return map[engine];
}

export function toPrismaIntensityBias(engine: IntensityBias): PrismaIntensityBias {
  const map: Record<IntensityBias, PrismaIntensityBias> = {
    strength: "STRENGTH",
    hypertrophy: "HYPERTROPHY",
    endurance: "ENDURANCE",
  };
  return map[engine];
}

export function toPrismaAdaptationType(engine: AdaptationType): PrismaAdaptationType {
  const map: Record<AdaptationType, PrismaAdaptationType> = {
    neural_adaptation: "NEURAL_ADAPTATION",
    myofibrillar_hypertrophy: "MYOFIBRILLAR_HYPERTROPHY",
    sarcoplasmic_hypertrophy: "SARCOPLASMIC_HYPERTROPHY",
    work_capacity: "WORK_CAPACITY",
    recovery: "RECOVERY",
  };
  return map[engine];
}

export function toPrismaTrainingAge(engine: TrainingAge): PrismaTrainingAge {
  const map: Record<TrainingAge, PrismaTrainingAge> = {
    beginner: "BEGINNER",
    intermediate: "INTERMEDIATE",
    advanced: "ADVANCED",
  };
  return map[engine];
}

export function toPrismaPrimaryGoal(
  engine: "strength" | "hypertrophy" | "fat_loss" | "general_fitness"
): PrismaPrimaryGoal {
  const map: Record<
    "strength" | "hypertrophy" | "fat_loss" | "general_fitness",
    PrismaPrimaryGoal
  > = {
    strength: "STRENGTH",
    hypertrophy: "HYPERTROPHY",
    fat_loss: "FAT_LOSS",
    general_fitness: "GENERAL_HEALTH",
  };
  return map[engine];
}

// ========================================
// Model Mappers (Prisma → Engine)
// ========================================

export function mapTrainingBlock(prisma: PrismaBlock): TrainingBlock {
  return {
    id: prisma.id,
    mesocycleId: prisma.mesocycleId,
    blockNumber: prisma.blockNumber,
    blockType: mapBlockType(prisma.blockType),
    startWeek: prisma.startWeek,
    durationWeeks: prisma.durationWeeks,
    volumeTarget: mapVolumeTarget(prisma.volumeTarget),
    intensityBias: mapIntensityBias(prisma.intensityBias),
    adaptationType: mapAdaptationType(prisma.adaptationType),
  };
}

export function mapMesocycle(
  prisma: PrismaMeso & { blocks: PrismaBlock[] }
): Mesocycle {
  return {
    id: prisma.id,
    macroCycleId: prisma.macroCycleId,
    mesoNumber: prisma.mesoNumber,
    startWeek: prisma.startWeek,
    durationWeeks: prisma.durationWeeks,
    focus: prisma.focus,
    volumeTarget: mapVolumeTarget(prisma.volumeTarget),
    intensityBias: mapIntensityBias(prisma.intensityBias),
    blocks: prisma.blocks.map(mapTrainingBlock),
  };
}

export function mapMacroCycle(
  prisma: PrismaMacro & {
    mesocycles: (PrismaMeso & { blocks: PrismaBlock[] })[];
  }
): MacroCycle {
  const trainingAgeMap: Record<PrismaTrainingAge, TrainingAge> = {
    BEGINNER: "beginner",
    INTERMEDIATE: "intermediate",
    ADVANCED: "advanced",
  };

  const goalMap: Record<
    PrismaPrimaryGoal,
    "strength" | "hypertrophy" | "fat_loss" | "general_fitness"
  > = {
    STRENGTH: "strength",
    STRENGTH_HYPERTROPHY: "strength",
    HYPERTROPHY: "hypertrophy",
    FAT_LOSS: "fat_loss",
    ATHLETICISM: "general_fitness",
    GENERAL_HEALTH: "general_fitness",
  };

  return {
    id: prisma.id,
    userId: prisma.userId,
    startDate: prisma.startDate,
    endDate: prisma.endDate,
    durationWeeks: prisma.durationWeeks,
    trainingAge: trainingAgeMap[prisma.trainingAge],
    primaryGoal: goalMap[prisma.primaryGoal],
    mesocycles: prisma.mesocycles.map(mapMesocycle),
  };
}

export function mapExerciseExposure(prisma: PrismaExposure): ExerciseExposure {
  return {
    exerciseName: prisma.exerciseName,
    lastUsedAt: prisma.lastUsedAt,
    timesUsedL4W: prisma.timesUsedL4W,
    timesUsedL8W: prisma.timesUsedL8W,
    timesUsedL12W: prisma.timesUsedL12W,
    avgSetsPerWeek: prisma.avgSetsPerWeek,
    avgVolumePerWeek: prisma.avgVolumePerWeek,
  };
}
