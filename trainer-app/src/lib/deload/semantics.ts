import type {
  CycleContextSnapshot,
  DeloadDecision,
  DeloadDecisionMode,
  SessionDecisionReceipt,
} from "@/lib/evidence/types";
import type { JointStress, MovementPatternV2 } from "@/lib/engine/types";

export const CANONICAL_DELOAD_PHASES = ["DELOAD", "ACTIVE_DELOAD"] as const;

export const CANONICAL_DELOAD_RIR_TARGET = {
  min: 5,
  max: 6,
} as const;

export const CANONICAL_DELOAD_SET_TARGETS = {
  main: 2,
  accessory: 1,
} as const;

export const CANONICAL_DELOAD_SET_MULTIPLIER = 0.5;
export const CANONICAL_DELOAD_VOLUME_FRACTION = 0.45;
export const CANONICAL_DELOAD_BACKOFF_MULTIPLIER = 0.75;
export const CANONICAL_DELOAD_INTENSITY_MULTIPLIER = 0.7;
export const CANONICAL_DELOAD_RPE_CAP = 6.0;
export const CANONICAL_DELOAD_DECISION_REDUCTION_PERCENT = 50;
export const CANONICAL_DELOAD_ACCESSORY_SIMPLIFICATION_FACTOR = 0.5;
export const CANONICAL_DELOAD_MAX_ACCESSORY_EXERCISES = 3;

export type CanonicalDeloadStructureReasonCode =
  | "preserved_main_lift"
  | "kept_unique_accessory_coverage"
  | "trimmed_redundant_main_pattern"
  | "trimmed_duplicate_bucket"
  | "trimmed_density_cap";

export type CanonicalDeloadStructureExercise = {
  exerciseId: string;
  exerciseName: string;
  orderIndex: number;
  isMainLift: boolean;
  mesocycleRole?: "CORE_COMPOUND" | "ACCESSORY";
  isCompound?: boolean;
  movementPatterns: MovementPatternV2[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  fatigueCost?: number;
  jointStress?: JointStress;
  baselineSetCount: number;
  baselineRepAnchor: number;
};

export type CanonicalDeloadStructureKeptExercise = CanonicalDeloadStructureExercise & {
  redundancyBucket: string;
  reasonCode: CanonicalDeloadStructureReasonCode;
  reason: string;
};

export type CanonicalDeloadStructureDroppedExercise = CanonicalDeloadStructureExercise & {
  redundancyBucket: string;
  reasonCode: Exclude<CanonicalDeloadStructureReasonCode, "preserved_main_lift" | "kept_unique_accessory_coverage">;
  reason: string;
};

export type CanonicalDeloadStructurePolicy = {
  baselineExerciseCount: number;
  keptExerciseCount: number;
  baselineMainLiftCount: number;
  keptMainLiftCount: number;
  baselineAccessoryCount: number;
  keptAccessoryCount: number;
  baselineHardSetCount: number;
  keptHardSetCount: number;
  maxAccessoryCount: number;
};

export type CanonicalDeloadStructureResult = {
  keptExercises: CanonicalDeloadStructureKeptExercise[];
  droppedExercises: CanonicalDeloadStructureDroppedExercise[];
  policy: CanonicalDeloadStructurePolicy;
};

export const CANONICAL_DELOAD_HISTORY_POLICY = {
  countsTowardCompliance: true,
  countsTowardRecentStimulus: true,
  countsTowardWeeklyVolume: true,
  countsTowardProgressionHistory: false,
  countsTowardPerformanceHistory: false,
  updatesProgressionAnchor: false,
  reanchorNextBlockFromAccumulation: true,
} as const;

const CANONICAL_DELOAD_PATTERN_PRIORITY: readonly MovementPatternV2[] = [
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "squat",
  "hinge",
  "lunge",
  "abduction",
  "adduction",
  "flexion",
  "extension",
  "rotation",
  "anti_rotation",
  "carry",
  "isolation",
  "calf_raise_extended",
  "calf_raise_flexed",
] as const;

const CANONICAL_DELOAD_COMPOUND_PATTERN_FAMILIES = new Set([
  "press",
  "pull",
  "knee_dominant",
  "hinge",
]);

const CANONICAL_DELOAD_JOINT_STRESS_PENALTY: Record<JointStress, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function normalizeDeloadPhaseValue(value: string | null | undefined): string | undefined {
  return typeof value === "string" ? value.trim().toUpperCase() : undefined;
}

function normalizeTextToken(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeMuscleFamily(value: string | null | undefined): string | undefined {
  const normalized = normalizeTextToken(value);
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("front delt")) return "front_delts";
  if (normalized.includes("side delt") || normalized.includes("lateral delt")) return "side_delts";
  if (normalized.includes("rear delt")) return "rear_delts";
  if (normalized.includes("delt") || normalized.includes("shoulder")) return "shoulders";
  if (normalized.includes("tricep")) return "triceps";
  if (normalized.includes("bicep")) return "biceps";
  if (normalized.includes("chest") || normalized.includes("pec")) return "chest";
  if (normalized.includes("lat")) return "lats";
  if (normalized.includes("upper back") || normalized.includes("mid back")) return "upper_back";
  if (normalized.includes("back")) return "back";
  if (normalized.includes("quad")) return "quads";
  if (normalized.includes("ham")) return "hamstrings";
  if (normalized.includes("glute")) return "glutes";
  if (normalized.includes("calf")) return "calves";
  if (normalized.includes("core") || normalized.includes("ab")) return "core";
  if (normalized.includes("adductor")) return "adductors";
  if (normalized.includes("abductor")) return "abductors";
  if (normalized.includes("forearm")) return "forearms";
  if (normalized.includes("lower back") || normalized.includes("erector")) return "lower_back";
  return normalized.replace(/\s+/g, "_");
}

function getPrimaryMovementPattern(movementPatterns: MovementPatternV2[]): MovementPatternV2 | undefined {
  return [...movementPatterns]
    .sort((left, right) => {
      return (
        CANONICAL_DELOAD_PATTERN_PRIORITY.indexOf(left) -
        CANONICAL_DELOAD_PATTERN_PRIORITY.indexOf(right)
      );
    })
    .find((pattern) => CANONICAL_DELOAD_PATTERN_PRIORITY.includes(pattern));
}

function resolveMovementFamily(exercise: Pick<CanonicalDeloadStructureExercise, "movementPatterns" | "primaryMuscles">): string {
  const primaryPattern = getPrimaryMovementPattern(exercise.movementPatterns);
  switch (primaryPattern) {
    case "horizontal_push":
    case "vertical_push":
      return "press";
    case "horizontal_pull":
    case "vertical_pull":
      return "pull";
    case "squat":
    case "lunge":
      return "knee_dominant";
    case "hinge":
      return "hinge";
    case "abduction":
      return "abduction";
    case "adduction":
      return "adduction";
    case "flexion":
      return "flexion";
    case "extension":
      return "extension";
    case "rotation":
      return "rotation";
    case "anti_rotation":
      return "anti_rotation";
    case "carry":
      return "carry";
    case "calf_raise_extended":
    case "calf_raise_flexed":
      return "calves";
    case "isolation":
      return normalizeMuscleFamily(exercise.primaryMuscles[0]) ?? "isolation";
    default:
      return normalizeMuscleFamily(exercise.primaryMuscles[0]) ?? "general";
  }
}

function resolveDominantMuscleFamily(
  exercise: Pick<CanonicalDeloadStructureExercise, "primaryMuscles" | "secondaryMuscles">
): string {
  return (
    normalizeMuscleFamily(exercise.primaryMuscles[0]) ??
    normalizeMuscleFamily(exercise.secondaryMuscles[0]) ??
    "general"
  );
}

function resolveRedundancyBucket(exercise: CanonicalDeloadStructureExercise): string {
  return `${resolveMovementFamily(exercise)}:${resolveDominantMuscleFamily(exercise)}`;
}

function getCanonicalDeloadStructureClause(): string {
  return "Keep main lifts for crisp technique, trim redundant accessory overlap, cut hard sets, and use lighter loads.";
}

function compareAccessoryPriority(
  left: CanonicalDeloadStructureExercise,
  right: CanonicalDeloadStructureExercise,
  mainMuscleFamilies: Set<string>
): number {
  const leftDominant = resolveDominantMuscleFamily(left);
  const rightDominant = resolveDominantMuscleFamily(right);
  const leftNovelty = mainMuscleFamilies.has(leftDominant) ? 0 : 1;
  const rightNovelty = mainMuscleFamilies.has(rightDominant) ? 0 : 1;
  if (leftNovelty !== rightNovelty) {
    return rightNovelty - leftNovelty;
  }

  const leftStress = CANONICAL_DELOAD_JOINT_STRESS_PENALTY[left.jointStress ?? "medium"];
  const rightStress = CANONICAL_DELOAD_JOINT_STRESS_PENALTY[right.jointStress ?? "medium"];
  if ((left.fatigueCost ?? 3) !== (right.fatigueCost ?? 3)) {
    return (left.fatigueCost ?? 3) - (right.fatigueCost ?? 3);
  }
  if (leftStress !== rightStress) {
    return leftStress - rightStress;
  }
  return left.orderIndex - right.orderIndex;
}

function shouldTrimForMainPatternOverlap(
  exercise: CanonicalDeloadStructureExercise,
  mainFamilies: Set<string>
): boolean {
  if (mainFamilies.size === 0) {
    return false;
  }
  const movementFamily = resolveMovementFamily(exercise);
  if (!CANONICAL_DELOAD_COMPOUND_PATTERN_FAMILIES.has(movementFamily)) {
    return false;
  }
  return (
    mainFamilies.has(movementFamily) &&
    ((exercise.isCompound ?? false) || exercise.movementPatterns.length > 0)
  );
}

export function isCanonicalDeloadPhase(value: string | null | undefined): boolean {
  const normalized = normalizeDeloadPhaseValue(value);
  return normalized != null && CANONICAL_DELOAD_PHASES.includes(
    normalized as (typeof CANONICAL_DELOAD_PHASES)[number]
  );
}

export function isCanonicalDeloadDecision(
  decision: Pick<DeloadDecision, "mode"> | null | undefined
): boolean {
  return decision != null && decision.mode !== "none";
}

export function isCanonicalDeloadCycleContext(
  cycleContext: Pick<CycleContextSnapshot, "isDeload" | "phase" | "blockType"> | null | undefined
): boolean {
  return (
    cycleContext?.isDeload === true ||
    isCanonicalDeloadPhase(cycleContext?.phase) ||
    isCanonicalDeloadPhase(cycleContext?.blockType)
  );
}

export function isCanonicalDeloadReceipt(
  receipt:
    | Pick<SessionDecisionReceipt, "cycleContext" | "deloadDecision">
    | null
    | undefined
): boolean {
  return (
    isCanonicalDeloadDecision(receipt?.deloadDecision) ||
    isCanonicalDeloadCycleContext(receipt?.cycleContext)
  );
}

export function getCanonicalDeloadTargetRpe(): number {
  const midpoint =
    (CANONICAL_DELOAD_RIR_TARGET.min + CANONICAL_DELOAD_RIR_TARGET.max) / 2;
  return Number((10 - midpoint).toFixed(1));
}

export function resolveCanonicalDeloadAccessoryCount(baselineAccessoryCount: number): number {
  if (baselineAccessoryCount <= 0) {
    return 0;
  }

  return Math.min(
    CANONICAL_DELOAD_MAX_ACCESSORY_EXERCISES,
    Math.max(
      1,
      Math.ceil(baselineAccessoryCount * CANONICAL_DELOAD_ACCESSORY_SIMPLIFICATION_FACTOR)
    )
  );
}

export function applyCanonicalDeloadStructurePolicy(
  exercises: CanonicalDeloadStructureExercise[]
): CanonicalDeloadStructureResult {
  const orderedExercises = [...exercises].sort((left, right) => left.orderIndex - right.orderIndex);
  const mainLifts = orderedExercises.filter(
    (exercise) => exercise.isMainLift || exercise.mesocycleRole === "CORE_COMPOUND"
  );
  const accessories = orderedExercises.filter((exercise) => !mainLifts.includes(exercise));
  const mainFamilies = new Set(mainLifts.map(resolveMovementFamily));
  const mainMuscleFamilies = new Set(
    mainLifts.flatMap((exercise) =>
      [...exercise.primaryMuscles, ...exercise.secondaryMuscles]
        .map(normalizeMuscleFamily)
        .filter((entry): entry is string => Boolean(entry))
    )
  );

  const keptExercises: CanonicalDeloadStructureKeptExercise[] = mainLifts.map((exercise) => ({
    ...exercise,
    redundancyBucket: resolveRedundancyBucket(exercise),
    reasonCode: "preserved_main_lift",
    reason: "Main lifts stay in during deload so technique and primary movement patterns remain practiced.",
  }));
  const droppedExercises: CanonicalDeloadStructureDroppedExercise[] = [];

  const overlapEligibleAccessories: CanonicalDeloadStructureExercise[] = [];
  for (const accessory of accessories) {
    const redundancyBucket = resolveRedundancyBucket(accessory);
    if (shouldTrimForMainPatternOverlap(accessory, mainFamilies)) {
      droppedExercises.push({
        ...accessory,
        redundancyBucket,
        reasonCode: "trimmed_redundant_main_pattern",
        reason:
          "Trimmed redundant compound accessory overlap because the preserved main lifts already cover that movement family during deload.",
      });
      continue;
    }
    overlapEligibleAccessories.push(accessory);
  }

  const representativesByBucket = new Map<string, CanonicalDeloadStructureExercise>();
  for (const accessory of overlapEligibleAccessories) {
    const redundancyBucket = resolveRedundancyBucket(accessory);
    const existing = representativesByBucket.get(redundancyBucket);
    if (
      !existing ||
      compareAccessoryPriority(accessory, existing, mainMuscleFamilies) < 0
    ) {
      if (existing) {
        droppedExercises.push({
          ...existing,
          redundancyBucket,
          reasonCode: "trimmed_duplicate_bucket",
          reason:
            "Trimmed duplicate accessory overlap and kept one representative lift for that movement bucket during deload.",
        });
      }
      representativesByBucket.set(redundancyBucket, accessory);
      continue;
    }

    droppedExercises.push({
      ...accessory,
      redundancyBucket,
      reasonCode: "trimmed_duplicate_bucket",
      reason:
        "Trimmed duplicate accessory overlap and kept one representative lift for that movement bucket during deload.",
    });
  }

  const accessoryRepresentatives = [...representativesByBucket.values()].sort((left, right) =>
    compareAccessoryPriority(left, right, mainMuscleFamilies)
  );
  const maxAccessoryCount = resolveCanonicalDeloadAccessoryCount(accessories.length);
  const keptAccessories = accessoryRepresentatives
    .slice(0, maxAccessoryCount)
    .map((exercise) => ({
      ...exercise,
      redundancyBucket: resolveRedundancyBucket(exercise),
      reasonCode: "kept_unique_accessory_coverage" as const,
      reason:
        "Kept as the lowest-fatigue representative for accessory coverage that still adds value during deload.",
    }))
    .sort((left, right) => left.orderIndex - right.orderIndex);
  const trimmedForDensity = accessoryRepresentatives.slice(maxAccessoryCount);
  for (const exercise of trimmedForDensity) {
    droppedExercises.push({
      ...exercise,
      redundancyBucket: resolveRedundancyBucket(exercise),
      reasonCode: "trimmed_density_cap",
      reason:
        "Trimmed by the deload session density cap so the session stays materially simpler than accumulation work.",
    });
  }

  const allKept = [...keptExercises, ...keptAccessories].sort((left, right) => left.orderIndex - right.orderIndex);

  return {
    keptExercises: allKept,
    droppedExercises: droppedExercises.sort((left, right) => left.orderIndex - right.orderIndex),
    policy: {
      baselineExerciseCount: orderedExercises.length,
      keptExerciseCount: allKept.length,
      baselineMainLiftCount: mainLifts.length,
      keptMainLiftCount: keptExercises.length,
      baselineAccessoryCount: accessories.length,
      keptAccessoryCount: keptAccessories.length,
      baselineHardSetCount: orderedExercises.reduce((sum, exercise) => sum + exercise.baselineSetCount, 0),
      keptHardSetCount: allKept.reduce((sum, exercise) => sum + exercise.baselineSetCount, 0),
      maxAccessoryCount,
    },
  };
}

export function resolveCanonicalDeloadSetCount(baselineSetCount: number): number {
  if (baselineSetCount <= 1) {
    return 1;
  }
  if (baselineSetCount === 2) {
    return 1;
  }
  return Math.max(2, Math.ceil(baselineSetCount * CANONICAL_DELOAD_SET_MULTIPLIER));
}

export function buildCanonicalDeloadDecision(
  mode: Exclude<DeloadDecisionMode, "none">,
  reason: string[]
): DeloadDecision {
  return {
    mode,
    reason,
    reductionPercent: CANONICAL_DELOAD_DECISION_REDUCTION_PERCENT,
    appliedTo: "both",
  };
}

export function getCanonicalDeloadReason(
  mode: Exclude<DeloadDecisionMode, "none">
): string {
  switch (mode) {
    case "reactive":
      return `Reactive deload triggered by fatigue or plateau evidence. ${getCanonicalDeloadStructureClause()}`;
    case "readiness":
      return `Readiness-triggered deload. ${getCanonicalDeloadStructureClause()}`;
    case "scheduled":
    default:
      return `Scheduled deload week. ${getCanonicalDeloadStructureClause()}`;
  }
}

export function getCanonicalDeloadWorkoutNote(): string {
  return `Deload session: ${getCanonicalDeloadStructureClause()} Loads stay lighter through the canonical load engine.`;
}

export function getCanonicalDeloadSummaryText(): string {
  return "This session is a deload: main lifts stay in for crisp practice, redundant accessory overlap is trimmed, loads are lighter, and total work is held down so you leave fresher than you started.";
}

export function getCanonicalDeloadGoalText(): string {
  return "Move cleanly, stay far from failure, keep the main lifts crisp, and leave fresher than you came in.";
}

export function getCanonicalDeloadEffortText(input?: {
  lifecycleRirTarget?: { min: number; max: number } | null;
}): string {
  if (input?.lifecycleRirTarget) {
    return `Keep reps crisp, leave ${input.lifecycleRirTarget.min}-${input.lifecycleRirTarget.max} reps in reserve, and reduce the weight if needed to stay there.`;
  }

  return "Keep technique clean, stay well shy of failure, and reduce the weight if needed so the session still feels like recovery.";
}

export function getCanonicalDeloadContractText(): string {
  return "Main lifts stay in, redundant accessory overlap is trimmed, hard sets are reduced, and lighter loads are prescribed on purpose for recovery.";
}

export function getCanonicalDeloadStructureText(): string {
  return "Main lifts stay in, overlapping accessory variants are trimmed first, and session complexity is capped so the day actually feels like a deload.";
}

export function getCanonicalDeloadProgressionTriggerText(): string {
  return "Today's written target was reduced for deload work: main lifts stay in, redundant accessories are trimmed, and loads stay lighter on purpose.";
}

export function buildNoDeloadDecision(): DeloadDecision {
  return {
    mode: "none",
    reason: [],
    reductionPercent: 0,
    appliedTo: "none",
  };
}
