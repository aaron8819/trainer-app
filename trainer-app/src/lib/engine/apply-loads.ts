import {
  computeNextLoad,
  estimateWorkoutMinutes,
  getBackOffMultiplier,
  trimAccessoriesByPriority,
} from "./engine";
import {
  REP_RANGES_BY_GOAL,
  TARGET_RPE_BY_GOAL,
  type PeriodizationModifiers,
} from "./rules";
import type {
  Exercise,
  Goals,
  UserProfile,
  WorkoutHistoryEntry,
  WorkoutPlan,
} from "./types";

export type BaselineInput = {
  exerciseId: string;
  context?: string | null;
  workingWeightMin?: number | null;
  workingWeightMax?: number | null;
  topSetWeight?: number | null;
};

export type ApplyLoadsOptions = {
  history?: WorkoutHistoryEntry[];
  baselines?: BaselineInput[];
  exerciseById: Record<string, Exercise>;
  primaryGoal: Goals["primary"];
  profile?: Pick<UserProfile, "weightKg" | "trainingAge">;
  sessionMinutes?: number;
  periodization?: PeriodizationModifiers;
};

type LoadEquipment =
  | "barbell"
  | "dumbbell"
  | "machine"
  | "cable"
  | "kettlebell"
  | "band"
  | "sled"
  | "bodyweight"
  | "other";

const BODYWEIGHT_ONLY_EQUIPMENT = new Set(["bodyweight", "bench", "rack"]);
const DEFAULT_FATIGUE_COST = 3;
const FATIGUE_SCALE_MIN = 0.45;
const FATIGUE_SCALE_MAX = 0.9;

const BASE_BODYWEIGHT_RATIO: Record<LoadEquipment, { compound: number; isolation: number }> = {
  barbell: { compound: 0.65, isolation: 0.35 },
  machine: { compound: 0.55, isolation: 0.3 },
  cable: { compound: 0.4, isolation: 0.2 },
  dumbbell: { compound: 0.28, isolation: 0.1 },
  kettlebell: { compound: 0.3, isolation: 0.1 },
  band: { compound: 0.2, isolation: 0.1 },
  sled: { compound: 0.7, isolation: 0.4 },
  bodyweight: { compound: 0.0, isolation: 0.0 },
  other: { compound: 0.3, isolation: 0.15 },
};

const PATTERN_MULTIPLIER: Partial<Record<Exercise["movementPattern"], number>> = {
  squat: 1.2,
  hinge: 1.15,
  lunge: 1.1,
  carry: 1.1,
  rotate: 0.6,
  push_pull: 0.9,
};

const EQUIPMENT_DEFAULTS: Record<LoadEquipment, number> = {
  barbell: 65,
  dumbbell: 20,
  machine: 60,
  cable: 40,
  kettlebell: 24,
  band: 15,
  sled: 90,
  bodyweight: 0,
  other: 30,
};

export function applyLoads(workout: WorkoutPlan, options: ApplyLoadsOptions): WorkoutPlan {
  const historyIndex = buildHistoryIndex(options.history ?? []);
  const baselineIndex = buildBaselineIndex(options.baselines ?? [], options.primaryGoal);
  const repRanges = REP_RANGES_BY_GOAL[options.primaryGoal];
  const defaultTargetRpe = TARGET_RPE_BY_GOAL[options.primaryGoal];
  const trainingAge = options.profile?.trainingAge ?? "intermediate";
  const periodization = options.periodization;
  const backOffMultiplier =
    periodization?.backOffMultiplier ?? getBackOffMultiplier(options.primaryGoal);

  const applyToExercise = (exerciseEntry: WorkoutPlan["mainLifts"][number]) => {
    const exercise = exerciseEntry.exercise;
    const repRange = exerciseEntry.isMainLift ? repRanges.main : repRanges.accessory;
    const existingTopSetLoad = exerciseEntry.sets.find((set) => set.setIndex === 1)?.targetLoad;
    const targetRpe =
      exerciseEntry.sets.find((set) => set.setIndex === 1)?.targetRpe ?? defaultTargetRpe;
    const load =
      existingTopSetLoad ??
      resolveLoadForExercise(
        exercise,
        historyIndex.get(exercise.id),
        baselineIndex.get(exercise.id),
        baselineIndex,
        options.exerciseById,
        options.profile?.weightKg,
        repRange,
        targetRpe
      );

    if (load === undefined) {
      return exerciseEntry.isMainLift
        ? { ...exerciseEntry, warmupSets: undefined }
        : exerciseEntry;
    }

    if (exerciseEntry.isMainLift) {
      if (periodization?.isDeload) {
        const deloadLoad = roundToHalf(load * backOffMultiplier);
        return {
          ...exerciseEntry,
          sets: exerciseEntry.sets.map((set) =>
            set.targetLoad !== undefined ? set : { ...set, targetLoad: deloadLoad }
          ),
          warmupSets: buildWarmupSets(deloadLoad, trainingAge),
        };
      }

      const updatedSets = exerciseEntry.sets.map((set) => {
        if (set.targetLoad !== undefined) {
          return set;
        }
        if (set.setIndex === 1) {
          return { ...set, targetLoad: load };
        }
        return { ...set, targetLoad: roundToHalf(load * backOffMultiplier) };
      });
      return {
        ...exerciseEntry,
        sets: updatedSets,
        warmupSets: buildWarmupSets(load, trainingAge),
      };
    }

    return {
      ...exerciseEntry,
      sets: exerciseEntry.sets.map((set) =>
        set.targetLoad !== undefined ? set : { ...set, targetLoad: load }
      ),
      warmupSets: undefined,
    };
  };

  let mainLifts = workout.mainLifts.map(applyToExercise);
  let accessories = workout.accessories.map(applyToExercise);
  const budgetMinutes = options.sessionMinutes;
  let estimatedMinutes = estimateWorkoutMinutes([
    ...workout.warmup,
    ...mainLifts,
    ...accessories,
  ]);

  if (budgetMinutes && budgetMinutes > 0 && estimatedMinutes > budgetMinutes) {
    let trimmedAccessories = [...accessories];
    while (trimmedAccessories.length > 0) {
      trimmedAccessories = trimAccessoriesByPriority(trimmedAccessories, mainLifts, 1);
      estimatedMinutes = estimateWorkoutMinutes([
        ...workout.warmup,
        ...mainLifts,
        ...trimmedAccessories,
      ]);
      if (estimatedMinutes <= budgetMinutes) {
        break;
      }
    }
    accessories = trimmedAccessories;
  }

  return {
    ...workout,
    mainLifts,
    accessories,
    estimatedMinutes,
  };
}

function buildHistoryIndex(history: WorkoutHistoryEntry[]) {
  const sorted = [...history].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const index = new Map<string, WorkoutSetHistory>();
  for (const entry of sorted) {
    for (const exercise of entry.exercises) {
      if (!index.has(exercise.exerciseId) && exercise.sets.length > 0) {
        index.set(exercise.exerciseId, exercise.sets);
      }
    }
  }
  return index;
}

type WorkoutSetHistory = { reps: number; rpe?: number; load?: number }[];

function buildBaselineIndex(baselines: BaselineInput[], primaryGoal: Goals["primary"]) {
  const preferredContext = primaryGoal === "strength" ? "strength" : "volume";
  const grouped = new Map<string, BaselineInput[]>();
  for (const baseline of baselines) {
    if (!baseline.exerciseId) {
      continue;
    }
    if (!grouped.has(baseline.exerciseId)) {
      grouped.set(baseline.exerciseId, []);
    }
    grouped.get(baseline.exerciseId)?.push(baseline);
  }

  const index = new Map<string, number>();
  for (const [exerciseId, group] of grouped.entries()) {
    const pick =
      group.find((item) => item.context === preferredContext) ??
      group.find((item) => item.context === "default") ??
      group[0];
    const load = resolveBaselineLoad(pick);
    if (load !== undefined) {
      index.set(exerciseId, load);
    }
  }
  return index;
}

function resolveBaselineLoad(baseline: BaselineInput): number | undefined {
  if (baseline.workingWeightMin != null && baseline.workingWeightMax != null) {
    return roundToHalf((baseline.workingWeightMin + baseline.workingWeightMax) / 2);
  }
  if (baseline.topSetWeight != null) {
    return roundToHalf(baseline.topSetWeight);
  }
  if (baseline.workingWeightMin != null) {
    return roundToHalf(baseline.workingWeightMin);
  }
  if (baseline.workingWeightMax != null) {
    return roundToHalf(baseline.workingWeightMax);
  }
  return undefined;
}

function resolveLoadForExercise(
  exercise: Exercise,
  historySets: WorkoutSetHistory | undefined,
  baselineLoad: number | undefined,
  baselineIndex: Map<string, number>,
  exerciseById: Record<string, Exercise>,
  weightKg: number | undefined,
  repRange: [number, number],
  targetRpe: number
): number | undefined {
  if (historySets && historySets.length > 0) {
    const computed = computeNextLoad(historySets, repRange, targetRpe);
    if (computed !== undefined) {
      return computed;
    }
  }

  if (baselineLoad !== undefined) {
    return baselineLoad;
  }

  return estimateLoad(exercise, baselineIndex, exerciseById, weightKg);
}

function estimateLoad(
  exercise: Exercise,
  baselineIndex: Map<string, number>,
  exerciseById: Record<string, Exercise>,
  weightKg?: number
): number | undefined {
  if (isBodyweightOnly(exercise)) {
    return undefined;
  }

  const donorEstimate = estimateFromDonors(exercise, baselineIndex, exerciseById);
  if (donorEstimate !== undefined) {
    return roundToHalf(donorEstimate);
  }

  if (weightKg !== undefined) {
    const ratio = getBodyweightRatio(exercise);
    if (ratio && ratio > 0) {
      const weightLbs = weightKg * 2.20462;
      return roundToHalf(weightLbs * ratio);
    }
  }

  return roundToHalf(getEquipmentDefault(exercise));
}

function estimateFromDonors(
  target: Exercise,
  baselineIndex: Map<string, number>,
  exerciseById: Record<string, Exercise>
): number | undefined {
  const targetMuscles = getPrimaryMuscles(target);
  if (targetMuscles.length === 0) {
    return undefined;
  }

  const targetEquipment = getLoadEquipment(target);
  const targetCompound = isCompound(target);
  const targetFatigue = target.fatigueCost ?? DEFAULT_FATIGUE_COST;

  const candidates: { score: number; load: number; name: string }[] = [];

  for (const [donorId, donorLoad] of baselineIndex.entries()) {
    const donor = exerciseById[donorId];
    if (!donor) {
      continue;
    }
    const donorMuscles = getPrimaryMuscles(donor);
    const overlap = countOverlap(targetMuscles, donorMuscles);
    if (overlap === 0) {
      continue;
    }

    const donorEquipment = getLoadEquipment(donor);
    const donorCompound = isCompound(donor);
    const donorFatigue = donor.fatigueCost ?? DEFAULT_FATIGUE_COST;

    const equipmentScale = getEquipmentScale(donorEquipment, targetEquipment);
    const compoundScale = getCompoundScale(donorCompound, targetCompound);
    const isolationPenalty = donorCompound && !targetCompound ? 0.5 : 1.0;
    const fatigueScale = clamp(
      targetFatigue / donorFatigue,
      FATIGUE_SCALE_MIN,
      FATIGUE_SCALE_MAX
    );

    const scaledLoad = donorLoad * equipmentScale * compoundScale * isolationPenalty * fatigueScale;
    const score = overlap * 4 + (donorEquipment === targetEquipment ? 2 : 0) + (donorCompound === targetCompound ? 1 : 0);

    candidates.push({ score, load: scaledLoad, name: donor.name });
  }

  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.name.localeCompare(b.name);
  });

  return candidates[0].load;
}

function getPrimaryMuscles(exercise: Exercise): string[] {
  if (exercise.primaryMuscles && exercise.primaryMuscles.length > 0) {
    return exercise.primaryMuscles;
  }
  if (exercise.secondaryMuscles && exercise.secondaryMuscles.length > 0) {
    return exercise.secondaryMuscles;
  }
  return [];
}

function countOverlap(a: string[], b: string[]) {
  const setB = new Set(b.map((item) => item.toLowerCase()));
  return a.reduce((count, item) => count + (setB.has(item.toLowerCase()) ? 1 : 0), 0);
}

function isBodyweightOnly(exercise: Exercise) {
  if (!exercise.equipment || exercise.equipment.length === 0) {
    return false;
  }
  return exercise.equipment.every((item) => BODYWEIGHT_ONLY_EQUIPMENT.has(item));
}

function isCompound(exercise: Exercise) {
  return exercise.isCompound ?? exercise.isMainLift;
}

function getLoadEquipment(exercise: Exercise): LoadEquipment {
  const equipment = exercise.equipment ?? [];
  const priority: LoadEquipment[] = [
    "barbell",
    "machine",
    "cable",
    "dumbbell",
    "kettlebell",
    "sled",
    "band",
    "bodyweight",
  ];

  for (const item of priority) {
    if (equipment.includes(item)) {
      return item;
    }
  }
  return "other";
}

function getEquipmentScale(donor: LoadEquipment, target: LoadEquipment) {
  if (donor === target) {
    return 1.0;
  }

  const pair = `${donor}->${target}`;
  const scales: Record<string, number> = {
    "machine->cable": 0.9,
    "cable->machine": 0.9,
    "barbell->machine": 0.85,
    "machine->barbell": 1.1,
    "barbell->cable": 0.8,
    "cable->barbell": 1.1,
    "barbell->dumbbell": 0.7,
    "dumbbell->barbell": 1.3,
    "dumbbell->cable": 0.85,
    "cable->dumbbell": 0.9,
    "dumbbell->machine": 0.8,
    "machine->dumbbell": 0.9,
    "kettlebell->dumbbell": 0.95,
    "dumbbell->kettlebell": 0.95,
  };

  return scales[pair] ?? 0.8;
}

function getCompoundScale(donorIsCompound: boolean, targetIsCompound: boolean) {
  if (donorIsCompound === targetIsCompound) {
    return 1.0;
  }
  if (donorIsCompound && !targetIsCompound) {
    return 1.0;
  }
  return 1.15;
}

function getBodyweightRatio(exercise: Exercise) {
  const equipment = getLoadEquipment(exercise);
  const compound = isCompound(exercise) ? "compound" : "isolation";
  const base = BASE_BODYWEIGHT_RATIO[equipment]?.[compound];
  if (!base) {
    return undefined;
  }
  const multiplier = PATTERN_MULTIPLIER[exercise.movementPattern] ?? 1;
  return base * multiplier;
}

function getEquipmentDefault(exercise: Exercise) {
  const equipment = getLoadEquipment(exercise);
  return EQUIPMENT_DEFAULTS[equipment] ?? 30;
}

function roundToHalf(value: number) {
  return Math.round(value * 2) / 2;
}

function buildWarmupSets(
  topSetLoad: number,
  trainingAge: UserProfile["trainingAge"]
): WorkoutPlan["mainLifts"][number]["warmupSets"] {
  const scheme =
    trainingAge === "beginner"
      ? [
          { percent: 0.6, reps: 8, restSeconds: 60 },
          { percent: 0.8, reps: 3, restSeconds: 90 },
        ]
      : [
          { percent: 0.5, reps: 8, restSeconds: 60 },
          { percent: 0.7, reps: 5, restSeconds: 60 },
          { percent: 0.85, reps: 3, restSeconds: 90 },
        ];

  return scheme.map((step, index) => ({
    setIndex: index + 1,
    targetReps: step.reps,
    targetLoad: roundToHalf(topSetLoad * step.percent),
    restSeconds: step.restSeconds,
  }));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
