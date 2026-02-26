import { computeDoubleProgressionDecision, computeNextLoad } from "./progression";
import {
  filterPerformedHistory,
  resolveBaseSelectionModeConfidence,
  sortHistoryByDateDesc,
} from "./history";
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
  SplitDay,
} from "./types";
import type { PrescriptionModifiers } from "./periodization/types";

export type BaselineInput = {
  exerciseId: string;
  context?: string | null;
  workingWeightMin?: number | null;
  workingWeightMax?: number | null;
  topSetWeight?: number | null;
  mesocyclePhaseSnapshot?: string | null;
  mesocycleWeekSnapshot?: number | null;
};

export type ApplyLoadsOptions = {
  history?: WorkoutHistoryEntry[];
  baselines?: BaselineInput[];
  exerciseById: Record<string, Exercise>;
  primaryGoal: Goals["primary"];
  profile?: Pick<UserProfile, "weightKg" | "trainingAge">;
  periodization?: PeriodizationModifiers;
  prescriptionModifiers?: PrescriptionModifiers | null;
  weekInBlock?: number;
  sessionIntent?: SplitDay;
  accumulationSessionsCompleted?: number;
  isFirstSessionInMesocycle?: boolean;
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
const EFFECTIVE_RPE_MIN = 6;

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
  const historyIndex = buildHistoryIndex(options.history ?? [], {
    sessionIntent: options.sessionIntent,
    useNewMesocycleBaselineSource:
      options.isFirstSessionInMesocycle === true ||
      (options.accumulationSessionsCompleted ?? -1) === 0,
  });
  const historyTopLoadIndex = buildHistoryTopLoadIndex(historyIndex);
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
        historyTopLoadIndex,
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

  return {
    ...workout,
    warmup,
    mainLifts,
    accessories,
  };
}

type BuildHistoryIndexOptions = {
  sessionIntent?: SplitDay;
  useNewMesocycleBaselineSource?: boolean;
};

function buildHistoryIndex(history: WorkoutHistoryEntry[], options: BuildHistoryIndexOptions = {}) {
  const sorted = sortHistoryByDateDesc(filterPerformedHistory(history));
  const sourceEntries = options.useNewMesocycleBaselineSource
    ? selectNewMesocycleBaselineHistory(sorted)
    : sorted;
  const index = new Map<string, WorkoutSessionHistory[]>();
  for (const entry of sourceEntries) {
    if (options.sessionIntent && entry.sessionIntent !== options.sessionIntent) {
      continue;
    }
    const entryConfidence =
      typeof entry.confidence === "number" && Number.isFinite(entry.confidence)
        ? entry.confidence
        : resolveBaseSelectionModeConfidence(entry);
    for (const exercise of entry.exercises) {
      if (exercise.sets.length === 0) {
        continue;
      }
      if (!index.has(exercise.exerciseId)) {
        index.set(exercise.exerciseId, []);
      }
      index.get(exercise.exerciseId)?.push({
        sets: exercise.sets,
        confidence: entryConfidence,
        selectionMode: entry.selectionMode,
        confidenceNotes: entry.confidenceNotes ?? [],
      });
    }
  }
  return index;
}

function selectNewMesocycleBaselineHistory(
  sortedPerformedHistory: WorkoutHistoryEntry[]
): WorkoutHistoryEntry[] {
  const nonDeloadHistory = sortedPerformedHistory.filter((entry) => !isDeloadPhaseEntry(entry));
  if (nonDeloadHistory.length === 0) {
    return [];
  }

  const accumulationHistory = nonDeloadHistory.filter((entry) => isAccumulationPhaseEntry(entry));
  if (accumulationHistory.length === 0) {
    return nonDeloadHistory;
  }

  const w4AccumulationHistory = accumulationHistory.filter(
    (entry) => getMesocycleWeekSnapshot(entry) === 4
  );
  if (w4AccumulationHistory.length > 0) {
    return w4AccumulationHistory;
  }

  const highestAccumulationWeek = Math.max(
    ...accumulationHistory
      .map((entry) => getMesocycleWeekSnapshot(entry))
      .filter((week): week is number => Number.isFinite(week))
  );
  if (Number.isFinite(highestAccumulationWeek)) {
    const highestWeekEntries = accumulationHistory.filter(
      (entry) => getMesocycleWeekSnapshot(entry) === highestAccumulationWeek
    );
    if (highestWeekEntries.length > 0) {
      return highestWeekEntries;
    }
  }

  return accumulationHistory;
}

function getMesocyclePhaseSnapshot(entry: WorkoutHistoryEntry): string | undefined {
  const value = (entry as WorkoutHistoryEntry & { mesocyclePhaseSnapshot?: unknown })
    .mesocyclePhaseSnapshot;
  return typeof value === "string" ? value.trim().toUpperCase() : undefined;
}

function getMesocycleWeekSnapshot(entry: WorkoutHistoryEntry): number | undefined {
  const value = (entry as WorkoutHistoryEntry & { mesocycleWeekSnapshot?: unknown })
    .mesocycleWeekSnapshot;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isAccumulationPhaseEntry(entry: WorkoutHistoryEntry): boolean {
  return getMesocyclePhaseSnapshot(entry) === "ACCUMULATION";
}

function isDeloadPhaseEntry(entry: WorkoutHistoryEntry): boolean {
  const phase = getMesocyclePhaseSnapshot(entry);
  return phase === "DELOAD" || phase === "ACTIVE_DELOAD";
}

type WorkoutSetHistory = { setIndex: number; reps: number; rpe?: number; load?: number }[];
type WorkoutSessionHistory = {
  sets: WorkoutSetHistory;
  confidence: number;
  selectionMode?: WorkoutHistoryEntry["selectionMode"];
  confidenceNotes: string[];
};

function buildHistoryTopLoadIndex(historyIndex: Map<string, WorkoutSessionHistory[]>) {
  const topLoadIndex = new Map<string, number>();
  for (const [exerciseId, sessions] of historyIndex.entries()) {
    const modalLoad = resolveWeightedModalLoadAcrossHistory(sessions);
    if (modalLoad !== undefined) {
      topLoadIndex.set(exerciseId, modalLoad);
    }
  }
  return topLoadIndex;
}

function getModalSessionLoad(sets: WorkoutSetHistory): number | undefined {
  const loadFrequency = new Map<number, { count: number; latestSetIndex: number }>();
  for (const set of sets) {
    if (set.rpe != null && set.rpe < EFFECTIVE_RPE_MIN) {
      continue;
    }
    const load = set.load;
    if (!Number.isFinite(load) || (load ?? 0) < 0) {
      continue;
    }
    const current = loadFrequency.get(load as number);
    if (!current) {
      loadFrequency.set(load as number, { count: 1, latestSetIndex: set.setIndex });
      continue;
    }
    current.count += 1;
    current.latestSetIndex = Math.max(current.latestSetIndex, set.setIndex);
  }

  if (loadFrequency.size === 0) {
    return undefined;
  }

  return Array.from(loadFrequency.entries())
    .sort((a, b) => {
      const [, left] = a;
      const [, right] = b;
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      if (right.latestSetIndex !== left.latestSetIndex) {
        return right.latestSetIndex - left.latestSetIndex;
      }
      return b[0] - a[0];
    })[0]?.[0];
}

function getModalSessionRpe(sets: WorkoutSetHistory): number | undefined {
  const rpeFrequency = new Map<number, number>();
  for (const set of sets) {
    if (!Number.isFinite(set.rpe) || (set.rpe as number) < EFFECTIVE_RPE_MIN) {
      continue;
    }
    const rounded = Number((set.rpe as number).toFixed(1));
    rpeFrequency.set(rounded, (rpeFrequency.get(rounded) ?? 0) + 1);
  }
  if (rpeFrequency.size === 0) {
    return undefined;
  }
  const [mode] = Array.from(rpeFrequency.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  })[0];
  return mode;
}

function normalizeSessionLoadsToModal(sets: WorkoutSetHistory): WorkoutSetHistory {
  const modalLoad = getModalSessionLoad(sets);
  if (modalLoad === undefined) {
    return sets;
  }

  return sets.map((set) =>
    Number.isFinite(set.load) && (set.load ?? 0) >= 0 && (set.rpe == null || set.rpe >= EFFECTIVE_RPE_MIN)
      ? { ...set, load: modalLoad }
      : set
  );
}

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
  historySessions: WorkoutSessionHistory[] | undefined,
  baselineSelection: BaselineSelection | undefined,
  baselineLoadIndex: Map<string, number>,
  historyTopLoadIndex: Map<string, number>,
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
  const latestSetsRaw = historySessions?.[0]?.sets;
  const useModalAnchoring = shouldUseModalAnchoring(exercise);
  const latestSets =
    latestSetsRaw && useModalAnchoring ? normalizeSessionLoadsToModal(latestSetsRaw) : latestSetsRaw;
  const weightedHistoryModalLoad = historySessions
    ? resolveWeightedModalLoadAcrossHistory(historySessions)
    : undefined;
  const historyConfidenceScale = historySessions
    ? resolveProgressionHistoryConfidenceScale(historySessions)
    : 1;
  const confidenceNotes = historySessions
    ? collectProgressionConfidenceNotes(historySessions)
    : [];
  if (latestSets && latestSets.length > 0) {
    const latestSetsForDecision =
      useModalAnchoring &&
      weightedHistoryModalLoad !== undefined &&
      (historySessions?.length ?? 0) > 1
        ? latestSets.map((set) =>
            Number.isFinite(set.load) && (set.load ?? 0) >= 0
              ? { ...set, load: weightedHistoryModalLoad }
              : set
          )
        : latestSets;
    const equipment = getPrimaryProgressionEquipment(exercise);
    const decision = computeDoubleProgressionDecision(latestSetsForDecision, repRange, equipment, {
      priorSessionCount: historySessions?.length ?? 1,
      historyConfidenceScale,
      confidenceReasons: confidenceNotes,
    });
    const anchorLoad = useModalAnchoring
      ? (decision?.anchorLoad ?? weightedHistoryModalLoad ?? getModalSessionLoad(latestSets))
      : getTopSessionLoad(latestSets);
    const modalRpe = getModalSessionRpe(latestSetsForDecision);
    if (anchorLoad !== undefined && modalRpe !== undefined && modalRpe >= 9) {
      return anchorLoad;
    }
    if (decision) {
      return decision.nextLoad;
    }
    const recentSessions =
      historySessions?.slice(1).map((session) =>
        useModalAnchoring ? normalizeSessionLoadsToModal(session.sets) : session.sets
      ) ?? [];
    const computed = computeNextLoad(latestSets, repRange, targetRpe, undefined, {
      trainingAge,
      isUpperBody,
      weekInBlock,
      backOffMultiplier: periodization?.backOffMultiplier,
      isDeloadWeek: periodization?.isDeload,
      recentSessions,
      equipment,
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

  return estimateLoad(
    exercise,
    baselineLoadIndex,
    historyTopLoadIndex,
    exerciseById,
    weightKg
  );
}

function getTopSessionLoad(sets: WorkoutSetHistory): number | undefined {
  const sorted = [...sets].sort((a, b) => a.setIndex - b.setIndex);
  for (const set of sorted) {
    if (set.rpe != null && set.rpe < EFFECTIVE_RPE_MIN) {
      continue;
    }
    if (Number.isFinite(set.load) && (set.load ?? 0) >= 0) {
      return set.load as number;
    }
  }
  return undefined;
}

function getPrimaryProgressionEquipment(exercise: Exercise): "barbell" | "dumbbell" | "cable" | "other" {
  const equipment = getLoadEquipment(exercise);
  if (equipment === "barbell" || equipment === "dumbbell" || equipment === "cable") {
    return equipment;
  }
  return "other";
}

function shouldUseModalAnchoring(exercise: Exercise): boolean {
  return !(exercise.isMainLiftEligible ?? false);
}

function estimateLoad(
  exercise: Exercise,
  baselineIndex: Map<string, number>,
  historyTopLoadIndex: Map<string, number>,
  exerciseById: Record<string, Exercise>,
  weightKg?: number
): number | undefined {
  if (isBodyweightOnly(exercise)) {
    return undefined;
  }

  let estimate: number;

  const donorEstimate =
    estimateFromDonors(exercise, baselineIndex, exerciseById) ??
    estimateFromHistoryPatternDonors(exercise, historyTopLoadIndex, exerciseById);
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

function estimateFromHistoryPatternDonors(
  target: Exercise,
  historyTopLoadIndex: Map<string, number>,
  exerciseById: Record<string, Exercise>
): number | undefined {
  const targetPatterns = target.movementPatterns ?? [];
  if (targetPatterns.length === 0) {
    return undefined;
  }

  const targetEquipment = getLoadEquipment(target);
  const targetJointStress = target.jointStress;
  const targetCompound = isCompound(target);
  const candidates: { score: number; load: number }[] = [];

  for (const [donorId, donorLoad] of historyTopLoadIndex.entries()) {
    const donor = exerciseById[donorId];
    if (!donor) {
      continue;
    }
    const donorPatterns = donor.movementPatterns ?? [];
    const patternOverlap = countOverlap(targetPatterns, donorPatterns);
    if (patternOverlap === 0) {
      continue;
    }

    const donorEquipment = getLoadEquipment(donor);
    const donorJointStress = donor.jointStress;
    const donorCompound = isCompound(donor);
    const equipmentScale = getEquipmentScale(donorEquipment, targetEquipment);
    const compoundScale = getCompoundScale(donorCompound, targetCompound);
    const scaledLoad = donorLoad * equipmentScale * compoundScale * 0.65;
    const score =
      patternOverlap * 2 +
      (donorEquipment === targetEquipment ? 1 : 0) +
      (donorJointStress === targetJointStress ? 1 : 0) +
      (donorCompound === targetCompound ? 0.5 : 0);
    candidates.push({ score, load: scaledLoad });
  }

  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((a, b) => b.score - a.score);
  return roundToHalf(candidates[0].load);
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

function resolveWeightedModalLoadAcrossHistory(
  sessions: WorkoutSessionHistory[]
): number | undefined {
  if (sessions.length === 0) {
    return undefined;
  }
  if (sessions.length === 1) {
    return getModalSessionLoad(sessions[0].sets);
  }

  const hasIntentHistory = sessions.some((session) => session.selectionMode === "INTENT");
  const weightedFrequency = new Map<number, number>();
  for (const session of sessions) {
    const modalLoad = getModalSessionLoad(session.sets);
    if (modalLoad === undefined) {
      continue;
    }
    const weight =
      !hasIntentHistory && session.selectionMode === "MANUAL"
        ? 1
        : Math.min(1, Math.max(0, session.confidence));
    weightedFrequency.set(modalLoad, (weightedFrequency.get(modalLoad) ?? 0) + weight);
  }

  if (weightedFrequency.size === 0) {
    return undefined;
  }

  return Array.from(weightedFrequency.entries()).sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return b[0] - a[0];
  })[0]?.[0];
}

function resolveProgressionHistoryConfidenceScale(
  sessions: WorkoutSessionHistory[]
): number {
  if (sessions.length <= 1) {
    return 1;
  }
  const hasIntentHistory = sessions.some((session) => session.selectionMode === "INTENT");
  if (!hasIntentHistory && sessions.every((session) => session.selectionMode === "MANUAL")) {
    return 1;
  }
  const total = sessions.reduce(
    (sum, session) => sum + Math.min(1, Math.max(0, session.confidence)),
    0
  );
  return Number((total / sessions.length).toFixed(2));
}

function collectProgressionConfidenceNotes(
  sessions: WorkoutSessionHistory[]
): string[] {
  return [...new Set(sessions.flatMap((session) => session.confidenceNotes ?? []))];
}
