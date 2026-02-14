// Periodization types for engine (lowercase unions, not Prisma UPPER_CASE)

export type BlockType = "accumulation" | "intensification" | "realization" | "deload";

export type VolumeTarget = "low" | "moderate" | "high" | "peak";

export type IntensityBias = "strength" | "hypertrophy" | "endurance";

export type AdaptationType =
  | "neural_adaptation"
  | "myofibrillar_hypertrophy"
  | "sarcoplasmic_hypertrophy"
  | "work_capacity"
  | "recovery";

export type TrainingBlock = {
  id: string;
  mesocycleId: string;
  blockNumber: number;
  blockType: BlockType;
  startWeek: number; // Week offset from macro start (0-indexed)
  durationWeeks: number;
  volumeTarget: VolumeTarget;
  intensityBias: IntensityBias;
  adaptationType: AdaptationType;
};

export type Mesocycle = {
  id: string;
  macroCycleId: string;
  mesoNumber: number;
  startWeek: number; // Week offset from macro start (0-indexed)
  durationWeeks: number;
  focus: string; // e.g., "Upper Body Hypertrophy", "Lower Strength"
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
  trainingAge: "beginner" | "intermediate" | "advanced";
  primaryGoal: "strength" | "hypertrophy" | "fat_loss" | "general_fitness";
  mesocycles: Mesocycle[];
};

export type ExerciseExposure = {
  exerciseName: string;
  lastUsedAt: Date;
  timesUsedL4W: number; // Last 4 weeks
  timesUsedL8W: number; // Last 8 weeks
  timesUsedL12W: number; // Last 12 weeks
  avgSetsPerWeek: number;
  avgVolumePerWeek: number; // Total reps per week
};

export type BlockContext = {
  block: TrainingBlock;
  weekInBlock: number; // 1-indexed for display
  weekInMeso: number; // 1-indexed within mesocycle
  weekInMacro: number; // 1-indexed within macro
  mesocycle: Mesocycle;
  macroCycle: MacroCycle;
};

export type PrescriptionModifiers = {
  volumeMultiplier: number; // 0.5 (deload) to 1.2 (peak)
  intensityMultiplier: number; // 0.7 (accumulation) to 1.0 (realization)
  rirAdjustment: number; // -1 to +3 (closer to failure in realization)
  restMultiplier: number; // 0.8 to 1.2
};
