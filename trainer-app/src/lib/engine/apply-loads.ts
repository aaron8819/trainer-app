import { computeNextLoad } from "./progression";
import { estimateWorkoutMinutes } from "./timeboxing";
import { filterCompletedHistory, sortHistoryByDateDesc } from "./history";
import {
  getBaseTargetRpe,
  getBackOffMultiplier,
  getGoalRepRanges,
  type PeriodizationModifiers,
} from "./rules";
import { getPrimaryMuscles } from "./utils";
import {
  buildWarmupSetsFromTopSet,
  canResolveLoadForWarmupRamp,
} from "./warmup-ramp";
import type {
  Exercise,
  Goals,
  MovementPatternV2,
  UserProfile,
  WorkoutHistoryEntry,
  WorkoutPlan,
} from "./types";
import type { PrescriptionModifiers } from "./periodization/types";

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
  prescriptionModifiers?: PrescriptionModifiers | null;
  weekInBlock?: number;
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

const DEFAULT_FATIGUE_COST = 3;
const FATIGUE_SCALE_MIN = 0.45;
const FATIGUE_SCALE_MAX = 0.9;
const BASELINE_SCALE_STRENGTH_TO_VOLUME = 0.78;
const BASELINE_SCALE_VOLUME_TO_STRENGTH = 1.12;

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

const PATTERN_MULTIPLIER: Partial<Record<MovementPatternV2, number>> = {
  squat: 1.2,
  hinge: 1.15,
  lunge: 1.1,
  carry: 1.1,
  rotation: 0.6,
  anti_rotation: 0.6,
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
  const preferredContext = getPreferredBaselineContext(options.primaryGoal);
  const baselineIndex = buildBaselineIndex(options.baselines ?? [], preferredContext);
  const baselineLoadIndex = buildBaselineLoadIndex(baselineIndex);
  const repRanges = getGoalRepRanges(options.primaryGoal);
  const trainingAge = options.profile?.trainingAge ?? "intermediate";
  const periodization = options.periodization;
  const backOffMultiplier =
    periodization?.backOffMultiplier ?? getBackOffMultiplier(options.primaryGoal);

  // Block-aware intensity multiplier (from periodization system v2)
  const intensityMultiplier = options.prescriptionModifiers?.intensityMultiplier ?? 1.0;

  const applyToExercise = (exerciseEntry: WorkoutPlan["mainLifts"][number]) => {
    const exercise = exerciseEntry.exercise;
    const workingRole = exerciseEntry.isMainLift ? "main" : "accessory";
    const setsWithRole = exerciseEntry.sets.map((set) => ({
      ...set,
      role: set.role ?? workingRole,
    }));
    const defaultTargetRpe =
      getBaseTargetRpe(options.primaryGoal, trainingAge) +
      (options.primaryGoal === "hypertrophy" &&
      !exerciseEntry.isMainLift &&
      !(exercise.isCompound ?? false)
        ? 0.5
        : 0);
    const repRange = exerciseEntry.isMainLift ? repRanges.main : repRanges.accessory;
    const existingTopSetLoad = setsWithRole.find((set) => set.setIndex === 1)?.targetLoad;
    const targetRpe =
      setsWithRole.find((set) => set.setIndex === 1)?.targetRpe ?? defaultTargetRpe;
    const load =
      existingTopSetLoad ??
      resolveLoadForExercise(
        exercise,
        historyIndex.get(exercise.id),
        baselineIndex.get(exercise.id),
        baselineLoadIndex,
        options.exerciseById,
        options.profile?.weightKg,
        repRange,
        targetRpe,
        trainingAge,
        isUpperBodyExercise(exercise),
        periodization,
        options.weekInBlock,
        preferredContext
      );

    if (load === undefined) {
      return exerciseEntry.isMainLift
        ? { ...exerciseEntry, role: exerciseEntry.role ?? workingRole, sets: setsWithRole, warmupSets: undefined }
        : { ...exerciseEntry, role: exerciseEntry.role ?? workingRole, sets: setsWithRole };
    }

    if (exerciseEntry.isMainLift) {
      if (periodization?.isDeload) {
        const deloadLoad = roundToHalf(load * backOffMultiplier * intensityMultiplier);
        return {
          ...exerciseEntry,
          role: exerciseEntry.role ?? workingRole,
          sets: setsWithRole.map((set) =>
            set.targetLoad !== undefined ? set : { ...set, targetLoad: deloadLoad }
          ),
          warmupSets: buildWarmupSets(deloadLoad, trainingAge),
        };
      }

      const adjustedTopSetLoad = roundToHalf(load * intensityMultiplier);
      const updatedSets = setsWithRole.map((set) => {
        if (set.targetLoad !== undefined) {
          return set;
        }
        if (set.setIndex === 1) {
          return { ...set, targetLoad: adjustedTopSetLoad };
        }
        return { ...set, targetLoad: roundToHalf(adjustedTopSetLoad * backOffMultiplier) };
      });
      return {
        ...exerciseEntry,
        role: exerciseEntry.role ?? workingRole,
        sets: updatedSets,
        warmupSets: buildWarmupSets(adjustedTopSetLoad, trainingAge),
      };
    }

    const adjustedAccessoryLoad = roundToHalf(load * intensityMultiplier);
    return {
      ...exerciseEntry,
      role: exerciseEntry.role ?? workingRole,
      sets: setsWithRole.map((set) =>
        set.targetLoad !== undefined ? set : { ...set, targetLoad: adjustedAccessoryLoad }
      ),
      warmupSets: undefined,
    };
  };

  const warmup = workout.warmup.map((exercise) => ({
    ...exercise,
    role: exercise.role ?? "warmup",
    sets: exercise.sets.map((set) => ({
      ...set,
      role: set.role ?? "warmup",
    })),
  }));
  const mainLifts = workout.mainLifts.map(applyToExercise);
  const accessories = workout.accessories.map(applyToExercise);

  // Calculate estimated time (metadata only - no trimming)
  // Timeboxing enforcement moved to beam search constraints (future)
  const estimatedMinutes = estimateWorkoutMinutes([
    ...warmup,
    ...mainLifts,
    ...accessories,
  ]);

  return {
    ...workout,
    warmup,
    mainLifts,
    accessories,
    estimatedMinutes,
  };
}

function buildHistoryIndex(history: WorkoutHistoryEntry[]) {
  const sorted = sortHistoryByDateDesc(filterCompletedHistory(history));
  const index = new Map<string, WorkoutSetHistory[]>();
  for (const entry of sorted) {
    for (const exercise of entry.exercises) {
      if (exercise.sets.length === 0) {
        continue;
      }
      if (!index.has(exercise.exerciseId)) {
        index.set(exercise.exerciseId, []);
      }
      index.get(exercise.exerciseId)?.push(exercise.sets);
    }
  }
  return index;
}

type WorkoutSetHistory = { reps: number; rpe?: number; load?: number }[];

type BaselineSelection = {
  load: number;
  selectedContext?: string | null;
};

function buildBaselineIndex(baselines: BaselineInput[], preferredContext: string) {
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

  const index = new Map<string, BaselineSelection>();
  for (const [exerciseId, group] of grouped.entries()) {
    const pick =
      group.find((item) => item.context === preferredContext) ??
      group.find((item) => item.context === "default") ??
      group[0];
    const load = resolveBaselineLoad(pick);
    if (load !== undefined) {
      index.set(exerciseId, { load, selectedContext: pick.context ?? undefined });
    }
  }
  return index;
}

function buildBaselineLoadIndex(baselineIndex: Map<string, BaselineSelection>) {
  const loadIndex = new Map<string, number>();
  for (const [exerciseId, entry] of baselineIndex.entries()) {
    loadIndex.set(exerciseId, entry.load);
  }
  return loadIndex;
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
  historySets: WorkoutSetHistory[] | undefined,
  baselineSelection: BaselineSelection | undefined,
  baselineLoadIndex: Map<string, number>,
  exerciseById: Record<string, Exercise>,
  weightKg: number | undefined,
  repRange: [number, number],
  targetRpe: number,
  trainingAge: UserProfile["trainingAge"],
  isUpperBody: boolean,
  periodization: PeriodizationModifiers | undefined,
  weekInBlock: number | undefined,
  preferredContext: string
): number | undefined {
  const latestSets = historySets?.[0];
  if (latestSets && latestSets.length > 0) {
    const computed = computeNextLoad(latestSets, repRange, targetRpe, undefined, {
      trainingAge,
      isUpperBody,
      weekInBlock,
      backOffMultiplier: periodization?.backOffMultiplier,
      isDeloadWeek: periodization?.isDeload,
      recentSessions: historySets?.slice(1),
    });
    if (computed !== undefined) {
      return computed;
    }
  }

  if (baselineSelection !== undefined) {
    return applyBaselineContextScaling(
      baselineSelection.load,
      baselineSelection.selectedContext,
      preferredContext
    );
  }

  return estimateLoad(exercise, baselineLoadIndex, exerciseById, weightKg);
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

  let estimate: number;

  const donorEstimate = estimateFromDonors(exercise, baselineIndex, exerciseById);
  if (donorEstimate !== undefined) {
    estimate = roundToHalf(donorEstimate);
  } else if (weightKg !== undefined) {
    const ratio = getBodyweightRatio(exercise);
    if (ratio && ratio > 0) {
      estimate = roundToHalf(weightKg * 2.20462 * ratio);
    } else {
      estimate = roundToHalf(getEquipmentDefault(exercise));
    }
  } else {
    estimate = roundToHalf(getEquipmentDefault(exercise));
  }

  // Machine selectorized equipment has a minimum practical load (10 lbs)
  // regardless of bodyweight ratios, which were calibrated for barbell/cable.
  if (getLoadEquipment(exercise) === "machine") {
    return Math.max(estimate, 10);
  }
  return estimate;
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

  const targetPatterns = target.movementPatterns ?? [];
  const candidates: { score: number; load: number; name: string }[] = [];

  for (const [donorId, donorLoad] of baselineIndex.entries()) {
    const donor = exerciseById[donorId];
    if (!donor) {
      continue;
    }
    const donorMuscles = getPrimaryMuscles(donor);
    const muscleOverlap = countOverlap(targetMuscles, donorMuscles);
    if (muscleOverlap === 0) {
      continue;
    }

    const donorEquipment = getLoadEquipment(donor);
    const donorCompound = isCompound(donor);
    const donorFatigue = donor.fatigueCost ?? DEFAULT_FATIGUE_COST;
    const donorPatterns = donor.movementPatterns ?? [];
    const patternOverlap = countOverlap(targetPatterns, donorPatterns);

    const equipmentScale = getEquipmentScale(donorEquipment, targetEquipment);
    const compoundScale = getCompoundScale(donorCompound, targetCompound);
    const isolationPenalty = donorCompound && !targetCompound ? 0.5 : 1.0;
    // Intentionally conservative: estimation always scales down from donor load.
    // Higher target fatigue can push ratio > 1, but clamp caps at 0.9 to avoid
    // overloading unfamiliar exercises when no direct history/baseline exists.
    const fatigueScale = clamp(
      targetFatigue / donorFatigue,
      FATIGUE_SCALE_MIN,
      FATIGUE_SCALE_MAX
    );

    const scaledLoad = donorLoad * equipmentScale * compoundScale * isolationPenalty * fatigueScale;
    const score =
      muscleOverlap * 4 +
      patternOverlap * 3 +
      (donorEquipment === targetEquipment ? 2 : 0) +
      (donorCompound === targetCompound ? 1 : 0);

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

function countOverlap(a: string[], b: string[]) {
  const setB = new Set(b.map((item) => item.toLowerCase()));
  return a.reduce((count, item) => count + (setB.has(item.toLowerCase()) ? 1 : 0), 0);
}

function isBodyweightOnly(exercise: Exercise) {
  return !canResolveLoadForWarmupRamp(exercise);
}

function isUpperBodyExercise(exercise: Exercise) {
  const lowerBodyPatterns: MovementPatternV2[] = ["squat", "hinge", "lunge"];
  return !(exercise.movementPatterns ?? []).some((pattern) =>
    lowerBodyPatterns.includes(pattern)
  );
}

function isCompound(exercise: Exercise) {
  return exercise.isCompound ?? false;
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
  const patterns = exercise.movementPatterns ?? [];
  const multiplier = patterns.length > 0
    ? Math.max(...patterns.map((p) => PATTERN_MULTIPLIER[p] ?? 1))
    : 1;
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
  return buildWarmupSetsFromTopSet(topSetLoad, trainingAge, roundToHalf);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getPreferredBaselineContext(primaryGoal: Goals["primary"]) {
  return primaryGoal === "strength" ? "strength" : "volume";
}

function applyBaselineContextScaling(
  load: number,
  selectedContext: string | null | undefined,
  preferredContext: string
) {
  if (!selectedContext || selectedContext === "default" || selectedContext === preferredContext) {
    return load;
  }

  if (selectedContext === "strength" && preferredContext !== "strength") {
    return roundToHalf(load * BASELINE_SCALE_STRENGTH_TO_VOLUME);
  }

  if (selectedContext === "volume" && preferredContext === "strength") {
    return roundToHalf(load * BASELINE_SCALE_VOLUME_TO_STRENGTH);
  }

  return load;
}
