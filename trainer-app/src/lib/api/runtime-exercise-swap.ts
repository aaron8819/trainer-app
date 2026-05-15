import {
  DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
  evaluateV2AnchorLaneQuality,
  isV2AnchorLaneQualityChecked,
  matchV2ExerciseClasses,
  normalizeV2MaterializationText,
  resolveV2ExerciseClassIds,
} from "@/lib/engine/planning/v2/materialization/taxonomy";
import type {
  V2ExerciseClassMatch,
  V2MaterializationExercise,
} from "@/lib/engine/planning/v2/materialization/types";
import type { V2AcceptedPlannerIntentDto } from "@/lib/engine/planning/v2/accepted-planner-intent-dto";

export type RuntimeExerciseSwapSourceLaneContext = {
  slotId?: string;
  seedRole?: "CORE_COMPOUND" | "ACCESSORY";
  laneId?: string;
  targetLaneId?: string;
  laneRole?: string;
  primaryMuscles?: string[] | null;
  acceptableExerciseClasses?: string[] | null;
  preferredExerciseClasses?: string[] | null;
};

export type RuntimeExerciseSwapProfile = {
  id: string;
  name: string;
  aliases?: string[] | null;
  fatigueCost?: number | null;
  jointStress?: string | null;
  isMainLift?: boolean | null;
  isMainLiftEligible?: boolean | null;
  isCompound?: boolean | null;
  hasRecentHistory?: boolean | null;
  movementPatterns?: string[] | null;
  primaryMuscles?: string[] | null;
  secondaryMuscles?: string[] | null;
  equipment?: string[] | null;
  stimulusByMusclePerSet?: Record<string, number> | null;
  sourceLane?: RuntimeExerciseSwapSourceLaneContext | null;
};

export type RuntimeExerciseSwapEligibilityBlockCode =
  | "WORKOUT_NOT_OPEN"
  | "PARTIALLY_LOGGED_EXERCISE_BLOCKED"
  | "FULLY_LOGGED_EXERCISE_BLOCKED"
  | "ALREADY_SWAPPED"
  | "INSUFFICIENT_METADATA";

export type RuntimeExerciseSwapWorkoutState = {
  status: string;
  loggedSetCount: number;
  totalSetCount: number;
  isRuntimeAdded: boolean;
  isAlreadySwapped: boolean;
};

export type RuntimeExerciseSwapEligibilityDecision =
  | { eligible: true }
  | { eligible: false; reasonCode: RuntimeExerciseSwapEligibilityBlockCode };

export type RuntimeExerciseSwapEligibility = {
  primaryMuscleOverlap: string[];
  movementPatternOverlap: string[];
  movementFamilyOverlap: string[];
  movementMatch: "exact" | "family";
  roleMatch: boolean;
  equipmentDemandStayedAtOrBelowOriginal: boolean;
  equipmentDemandDelta: number;
  jointStressDelta: number;
  fatigueDelta: number;
  historyMatch: boolean;
  score: number;
};

export type RuntimeExerciseSwapCandidate = {
  exerciseId: string;
  exerciseName: string;
  primaryMuscles: string[];
  equipment: string[];
  compatibility: RuntimeExerciseSwapEligibility;
  reason: string;
  swapLaneFitScore: number;
  swapCandidateReason: string;
  swapFallbackTier:
    | "exact_lane_equivalent"
    | "same_movement_class"
    | "useful_fallback_warning"
    | "broad_same_muscle_fallback";
  sourceLaneRole?: string;
  sourceV2Class?: string;
  movementPatternMatch: RuntimeExerciseSwapEligibility["movementMatch"];
  fatigueDelta: number;
  jointStressDelta: number;
  stabilityTier: "high" | "medium" | "low" | "unknown";
  loadabilityTier: "high" | "medium" | "low" | "unknown";
  weeklyCollisionWarnings: string[];
};

const GUIDED_EQUIPMENT = new Set(["machine", "cable", "band", "sled"]);
const FREE_WEIGHT_EQUIPMENT = new Set(["dumbbell", "kettlebell"]);
const TECHNICAL_EQUIPMENT = new Set(["barbell", "ez_bar", "trap_bar", "rack"]);
const JOINT_STRESS_DEMAND: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const MOVEMENT_FAMILY_BY_PATTERN: Record<string, string> = {
  horizontal_push: "push",
  vertical_push: "push",
  horizontal_pull: "pull",
  vertical_pull: "pull",
  squat: "knee_dominant",
  lunge: "knee_dominant",
  hinge: "hip_dominant",
  carry: "carry",
  rotation: "trunk",
  anti_rotation: "trunk",
  flexion: "trunk",
  extension: "trunk",
  abduction: "frontal_plane",
  adduction: "frontal_plane",
  isolation: "isolation",
  calf_raise_extended: "calf",
  calf_raise_flexed: "calf",
};

function normalizeList(values: string[] | null | undefined): string[] {
  return (values ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function intersect(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function resolveMovementFamilies(patterns: string[]): string[] {
  return unique(
    patterns.flatMap((pattern) => MOVEMENT_FAMILY_BY_PATTERN[pattern] ?? []),
  );
}

function resolveEquipmentDemand(exercise: RuntimeExerciseSwapProfile): number {
  const equipment = normalizeList(exercise.equipment);
  let demand = 0;

  for (const item of equipment) {
    if (TECHNICAL_EQUIPMENT.has(item)) {
      demand = Math.max(demand, 3);
    } else if (FREE_WEIGHT_EQUIPMENT.has(item)) {
      demand = Math.max(demand, 2);
    } else if (GUIDED_EQUIPMENT.has(item)) {
      demand = Math.max(demand, 1);
    }
  }

  return demand;
}

function resolveJointStressDemand(
  exercise: RuntimeExerciseSwapProfile,
): number | null {
  const stress = exercise.jointStress?.trim().toLowerCase();
  if (!stress) {
    return null;
  }

  return JOINT_STRESS_DEMAND[stress] ?? null;
}

function hasSufficientExerciseMetadata(
  exercise: RuntimeExerciseSwapProfile,
): boolean {
  return (
    normalizeList(exercise.primaryMuscles).length > 0 &&
    normalizeList(exercise.movementPatterns).length > 0 &&
    resolveJointStressDemand(exercise) != null
  );
}

function buildReason(input: RuntimeExerciseSwapEligibility): string {
  const muscleText =
    input.primaryMuscleOverlap.length > 0
      ? input.primaryMuscleOverlap.join(", ")
      : "the same primary musculature";
  const patternText =
    input.movementPatternOverlap.length > 0
      ? input.movementPatternOverlap.join(", ")
      : input.movementFamilyOverlap.join(", ");
  const fatigueText =
    input.fatigueDelta === 0
      ? "keeps fatigue flat"
      : input.fatigueDelta < 0
        ? `reduces fatigue by ${Math.abs(input.fatigueDelta)}`
        : `raises fatigue by ${input.fatigueDelta}`;
  const equipmentText = input.equipmentDemandStayedAtOrBelowOriginal
    ? "without raising equipment complexity"
    : "with a different equipment demand";

  return `Keeps ${muscleText}, matches ${patternText}, and ${fatigueText} ${equipmentText}.`;
}

function normalizedSearchText(values: Array<string | undefined | null>): string {
  return values
    .flatMap((value) => (value ? [value] : []))
    .map(normalizeV2MaterializationText)
    .join(" ");
}

function hasText(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(normalizeV2MaterializationText(pattern)));
}

function stimulusByMuscleForProfile(
  exercise: RuntimeExerciseSwapProfile,
): Record<string, number> {
  const explicit = exercise.stimulusByMusclePerSet ?? {};
  const inferred = new Map<string, number>();
  for (const muscle of normalizeList(exercise.primaryMuscles)) {
    inferred.set(muscle, Math.max(inferred.get(muscle) ?? 0, 1));
  }
  for (const muscle of normalizeList(exercise.secondaryMuscles)) {
    inferred.set(muscle, Math.max(inferred.get(muscle) ?? 0, 0.5));
  }
  for (const [muscle, value] of Object.entries(explicit)) {
    if (Number.isFinite(value)) {
      inferred.set(muscle, value);
    }
  }
  return Object.fromEntries(inferred);
}

function toV2MaterializationExercise(
  exercise: RuntimeExerciseSwapProfile,
): V2MaterializationExercise {
  return {
    exerciseId: exercise.id,
    name: exercise.name,
    aliases: normalizeList(exercise.aliases),
    movementPatterns: normalizeList(exercise.movementPatterns),
    primaryMuscles: normalizeList(exercise.primaryMuscles),
    secondaryMuscles: normalizeList(exercise.secondaryMuscles),
    equipment: normalizeList(exercise.equipment),
    isCompound: Boolean(exercise.isCompound),
    isMainLiftEligible: Boolean(exercise.isMainLiftEligible),
    fatigueCost: exercise.fatigueCost ?? undefined,
    stimulusByMusclePerSet: stimulusByMuscleForProfile(exercise),
  };
}

function resolveLaneClassIds(
  lane: RuntimeExerciseSwapSourceLaneContext | null | undefined,
): string[] {
  if (!lane) {
    return [];
  }
  return resolveV2ExerciseClassIds(DEFAULT_V2_EXERCISE_CLASS_TAXONOMY, [
    ...(lane.preferredExerciseClasses ?? []),
    ...(lane.acceptableExerciseClasses ?? []),
  ]);
}

function resolveSourceV2Class(input: {
  currentMatches: V2ExerciseClassMatch[];
  laneClassIds: string[];
}): string | undefined {
  return (
    input.currentMatches.find((match) => input.laneClassIds.includes(match.classId))
      ?.classId ?? input.currentMatches[0]?.classId
  );
}

function resolveCandidateClassMatch(input: {
  candidateMatches: V2ExerciseClassMatch[];
  sourceV2Class?: string;
  laneClassIds: string[];
}): V2ExerciseClassMatch | undefined {
  return (
    input.candidateMatches.find(
      (match) => input.sourceV2Class && match.classId === input.sourceV2Class,
    ) ??
    input.candidateMatches.find((match) => input.laneClassIds.includes(match.classId)) ??
    input.candidateMatches[0]
  );
}

function hasCandidateDirectness(input: {
  lane: RuntimeExerciseSwapSourceLaneContext | null | undefined;
  candidate: RuntimeExerciseSwapProfile;
  candidateMatch?: V2ExerciseClassMatch;
}): boolean {
  const targetMuscles = normalizeList(input.lane?.primaryMuscles);
  if (targetMuscles.length === 0) {
    return true;
  }
  const candidatePrimary = normalizeList(input.candidate.primaryMuscles);
  const matchDirect = normalizeList(input.candidateMatch?.directMuscles);
  return targetMuscles.some(
    (muscle) => candidatePrimary.includes(muscle) || matchDirect.includes(muscle),
  );
}

function resolveLoadabilityTier(
  exercise: RuntimeExerciseSwapProfile,
): RuntimeExerciseSwapCandidate["loadabilityTier"] {
  const text = normalizedSearchText([
    exercise.name,
    ...(exercise.aliases ?? []),
    ...(exercise.movementPatterns ?? []),
    ...(exercise.equipment ?? []),
  ]);
  if (
    hasText(text, [
      "leg press",
      "hack squat",
      "belt squat",
      "pendulum squat",
      "machine squat",
      "barbell",
      "smith",
      "machine",
      "sled",
      "plate loaded",
    ])
  ) {
    return "high";
  }
  if (hasText(text, ["dumbbell", "kettlebell", "cable", "trap bar", "ez bar"])) {
    return "medium";
  }
  if (hasText(text, ["bodyweight", "band", "walking lunge", "goblet squat"])) {
    return "low";
  }
  return "unknown";
}

function resolveStabilityTier(
  exercise: RuntimeExerciseSwapProfile,
): RuntimeExerciseSwapCandidate["stabilityTier"] {
  const text = normalizedSearchText([
    exercise.name,
    ...(exercise.aliases ?? []),
    ...(exercise.movementPatterns ?? []),
    ...(exercise.equipment ?? []),
  ]);
  if (
    hasText(text, [
      "machine",
      "seated",
      "chest supported",
      "leg press",
      "hack squat",
      "belt squat",
      "cable",
      "sled",
    ])
  ) {
    return "high";
  }
  if (hasText(text, ["walking lunge", "bodyweight", "stability ball"])) {
    return "low";
  }
  if (hasText(text, ["dumbbell", "barbell", "kettlebell", "goblet squat", "lunge"])) {
    return "medium";
  }
  return "unknown";
}

function tierRank(
  tier: RuntimeExerciseSwapCandidate["swapFallbackTier"],
): number {
  switch (tier) {
    case "exact_lane_equivalent":
      return 4;
    case "same_movement_class":
      return 3;
    case "useful_fallback_warning":
      return 2;
    case "broad_same_muscle_fallback":
      return 1;
  }
}

function tierBaseScore(
  tier: RuntimeExerciseSwapCandidate["swapFallbackTier"],
): number {
  return tierRank(tier) * 100;
}

function tierValue(
  tier: "high" | "medium" | "low" | "unknown",
): number {
  switch (tier) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    case "unknown":
      return 0;
  }
}

function resolveSwapFallbackTier(input: {
  current: RuntimeExerciseSwapProfile;
  candidate: RuntimeExerciseSwapProfile;
  compatibility: RuntimeExerciseSwapEligibility;
  sourceV2Class?: string;
  candidateMatch?: V2ExerciseClassMatch;
  laneClassIds: string[];
  fatigueDelta: number;
}): RuntimeExerciseSwapCandidate["swapFallbackTier"] {
  const lane = input.current.sourceLane;
  const candidateClass = input.candidateMatch?.classId;
  const sameClass = Boolean(
    input.sourceV2Class && candidateClass === input.sourceV2Class,
  );
  const laneClassMatch = Boolean(
    candidateClass && input.laneClassIds.includes(candidateClass),
  );

  if (sameClass && input.fatigueDelta > 0) {
    return "useful_fallback_warning";
  }

  if (sameClass && lane?.laneId && laneClassMatch) {
    if (!isV2AnchorLaneQualityChecked(lane.laneId)) {
      return "exact_lane_equivalent";
    }
    const quality = evaluateV2AnchorLaneQuality(
      lane.laneId,
      toV2MaterializationExercise(input.candidate),
      input.candidateMatch,
    );
    return quality.tier === "ideal"
      ? "exact_lane_equivalent"
      : quality.tier === "fallback"
        ? "useful_fallback_warning"
        : "broad_same_muscle_fallback";
  }

  if (sameClass) {
    return "same_movement_class";
  }

  if (lane?.laneId && laneClassMatch) {
    if (!isV2AnchorLaneQualityChecked(lane.laneId)) {
      return "same_movement_class";
    }
    const quality = evaluateV2AnchorLaneQuality(
      lane.laneId,
      toV2MaterializationExercise(input.candidate),
      input.candidateMatch,
    );
    return quality.tier === "ideal"
      ? "same_movement_class"
      : "useful_fallback_warning";
  }

  return input.compatibility.movementMatch === "exact"
    ? "same_movement_class"
    : "broad_same_muscle_fallback";
}

function buildSwapCandidateDiagnostics(input: {
  current: RuntimeExerciseSwapProfile;
  candidate: RuntimeExerciseSwapProfile;
  compatibility: RuntimeExerciseSwapEligibility;
}): Omit<
  RuntimeExerciseSwapCandidate,
  | "exerciseId"
  | "exerciseName"
  | "primaryMuscles"
  | "equipment"
  | "compatibility"
  | "reason"
> {
  const lane = input.current.sourceLane;
  const laneClassIds = resolveLaneClassIds(lane);
  const currentExercise = toV2MaterializationExercise(input.current);
  const candidateExercise = toV2MaterializationExercise(input.candidate);
  const currentMatches = matchV2ExerciseClasses(currentExercise);
  const candidateMatches = matchV2ExerciseClasses(candidateExercise);
  const sourceV2Class = resolveSourceV2Class({ currentMatches, laneClassIds });
  const candidateMatch = resolveCandidateClassMatch({
    candidateMatches,
    sourceV2Class,
    laneClassIds,
  });
  const swapFallbackTier = resolveSwapFallbackTier({
    current: input.current,
    candidate: input.candidate,
    compatibility: input.compatibility,
    sourceV2Class,
    candidateMatch,
    laneClassIds,
    fatigueDelta: input.compatibility.fatigueDelta,
  });
  const directness = hasCandidateDirectness({
    lane,
    candidate: input.candidate,
    candidateMatch,
  });
  const loadabilityTier = resolveLoadabilityTier(input.candidate);
  const stabilityTier = resolveStabilityTier(input.candidate);
  const classMatchBonus =
    sourceV2Class && candidateMatch?.classId === sourceV2Class ? 35 : 0;
  const laneClassBonus =
    candidateMatch?.classId && laneClassIds.includes(candidateMatch.classId)
      ? 25
      : 0;
  const laneFitScore =
    tierBaseScore(swapFallbackTier) +
    (input.compatibility.movementMatch === "exact" ? 30 : 10) +
    classMatchBonus +
    laneClassBonus +
    (directness ? 20 : 0) +
    tierValue(loadabilityTier) * 4 +
    tierValue(stabilityTier) * 3 +
    Math.max(0, -input.compatibility.fatigueDelta) * 2 -
    Math.max(0, input.compatibility.fatigueDelta) * 6 +
    Math.max(0, -input.compatibility.jointStressDelta);
  const sourceLaneRole = lane?.laneRole ?? lane?.seedRole;
  const laneText = lane?.laneId ? `${lane.slotId ?? "slot"}:${lane.laneId}` : "planned lane";
  const tierText =
    swapFallbackTier === "exact_lane_equivalent"
      ? "Preserves the planned lane/class."
      : swapFallbackTier === "same_movement_class"
        ? "Matches the source movement class without full lane evidence."
        : swapFallbackTier === "useful_fallback_warning"
          ? "Useful fallback; review lane/load or fatigue tradeoff."
          : "Broad same-muscle fallback; not an equivalent lane swap.";

  return {
    swapLaneFitScore: Math.round(laneFitScore),
    swapCandidateReason: `${tierText} ${laneText}${
      candidateMatch?.classId ? ` candidate class ${candidateMatch.classId}` : ""
    }.`,
    swapFallbackTier,
    ...(sourceLaneRole ? { sourceLaneRole } : {}),
    ...(sourceV2Class ? { sourceV2Class } : {}),
    movementPatternMatch: input.compatibility.movementMatch,
    fatigueDelta: input.compatibility.fatigueDelta,
    jointStressDelta: input.compatibility.jointStressDelta,
    stabilityTier,
    loadabilityTier,
    weeklyCollisionWarnings: [],
  };
}

function isEquivalentCalfIsolationFatigueException(input: {
  current: RuntimeExerciseSwapProfile;
  candidate: RuntimeExerciseSwapProfile;
  fatigueDelta: number;
}): boolean {
  if (input.fatigueDelta <= 0 || input.fatigueDelta > 1) {
    return false;
  }
  const currentClasses = matchV2ExerciseClasses(
    toV2MaterializationExercise(input.current),
  ).map((match) => match.classId);
  const candidateClasses = matchV2ExerciseClasses(
    toV2MaterializationExercise(input.candidate),
  ).map((match) => match.classId);
  return (
    currentClasses.includes("calf_isolation") &&
    candidateClasses.includes("calf_isolation")
  );
}

function isEquivalentLateralRaiseFatigueException(input: {
  current: RuntimeExerciseSwapProfile;
  candidate: RuntimeExerciseSwapProfile;
  fatigueDelta: number;
}): boolean {
  if (input.fatigueDelta <= 0 || input.fatigueDelta > 1) {
    return false;
  }
  const currentClasses = matchV2ExerciseClasses(
    toV2MaterializationExercise(input.current),
  ).map((match) => match.classId);
  const candidateClasses = matchV2ExerciseClasses(
    toV2MaterializationExercise(input.candidate),
  ).map((match) => match.classId);
  return (
    currentClasses.includes("lateral_raise") &&
    candidateClasses.includes("lateral_raise")
  );
}

type SourceLanePolicy =
  V2AcceptedPlannerIntentDto["weekPolicies"][number]["slots"][number]["lanes"][number];

function laneRoleMatchesSeedRole(
  seedRole: RuntimeExerciseSwapSourceLaneContext["seedRole"],
  laneRole: string | undefined,
): boolean {
  if (!seedRole || !laneRole) {
    return false;
  }
  if (seedRole === "CORE_COMPOUND") {
    return laneRole === "anchor";
  }
  return laneRole !== "anchor";
}

function lanePrimaryOverlapScore(
  lane: SourceLanePolicy,
  sourcePrimaryMuscles: string[],
): number {
  const lanePrimary = normalizeList(lane.primaryMuscles);
  return lanePrimary.filter((muscle) => sourcePrimaryMuscles.includes(muscle)).length;
}

function laneClassOverlapScore(
  lane: SourceLanePolicy,
  sourceClassIds: ReadonlySet<string>,
): number {
  const laneClassIds = resolveV2ExerciseClassIds(DEFAULT_V2_EXERCISE_CLASS_TAXONOMY, [
    ...lane.preferredExerciseClasses,
    ...lane.acceptableExerciseClasses,
  ]);
  return laneClassIds.filter((classId) => sourceClassIds.has(classId)).length;
}

export function resolveRuntimeExerciseSwapSourceLaneContext(input: {
  source: RuntimeExerciseSwapProfile;
  slotId?: string | null;
  seedRole?: RuntimeExerciseSwapSourceLaneContext["seedRole"];
  weekInMeso?: number | null;
  acceptedPlannerIntent?: V2AcceptedPlannerIntentDto | null;
}): RuntimeExerciseSwapSourceLaneContext | undefined {
  const base: RuntimeExerciseSwapSourceLaneContext = {
    ...(input.slotId ? { slotId: input.slotId } : {}),
    ...(input.seedRole ? { seedRole: input.seedRole } : {}),
  };
  const acceptedPlannerIntent = input.acceptedPlannerIntent;
  if (!acceptedPlannerIntent || !input.slotId) {
    return Object.keys(base).length > 0 ? base : undefined;
  }

  const requestedWeek = input.weekInMeso ?? 1;
  const weekPolicy =
    acceptedPlannerIntent.weekPolicies.find((policy) => policy.week === requestedWeek) ??
    acceptedPlannerIntent.weekPolicies[0];
  const slotPolicy = weekPolicy?.slots.find((slot) => slot.slotId === input.slotId);
  if (!slotPolicy) {
    return Object.keys(base).length > 0 ? base : undefined;
  }

  const sourceClassIds = new Set(
    matchV2ExerciseClasses(toV2MaterializationExercise(input.source)).map(
      (match) => match.classId,
    ),
  );
  const sourcePrimaryMuscles = normalizeList(input.source.primaryMuscles);
  const bestLane = [...slotPolicy.lanes]
    .map((lane) => ({
      lane,
      classOverlap: laneClassOverlapScore(lane, sourceClassIds),
      primaryOverlap: lanePrimaryOverlapScore(lane, sourcePrimaryMuscles),
      roleMatch: laneRoleMatchesSeedRole(input.seedRole, lane.role) ? 1 : 0,
    }))
    .filter((entry) => entry.classOverlap > 0 && entry.primaryOverlap > 0)
    .sort(
      (left, right) =>
        right.classOverlap - left.classOverlap ||
        right.roleMatch - left.roleMatch ||
        right.primaryOverlap - left.primaryOverlap ||
        left.lane.laneId.localeCompare(right.lane.laneId),
    )[0]?.lane;

  if (!bestLane) {
    return Object.keys(base).length > 0 ? base : undefined;
  }

  return {
    ...base,
    laneId: bestLane.laneId,
    ...(bestLane.targetLaneId ? { targetLaneId: bestLane.targetLaneId } : {}),
    laneRole: bestLane.role,
    primaryMuscles: [...bestLane.primaryMuscles],
    acceptableExerciseClasses: [...bestLane.acceptableExerciseClasses],
    preferredExerciseClasses: [...bestLane.preferredExerciseClasses],
  };
}

export function isSwapEligible(
  sourceExercise: RuntimeExerciseSwapProfile,
  workoutState: RuntimeExerciseSwapWorkoutState,
): RuntimeExerciseSwapEligibilityDecision {
  if (
    workoutState.status !== "PLANNED" &&
    workoutState.status !== "IN_PROGRESS" &&
    workoutState.status !== "PARTIAL"
  ) {
    return { eligible: false, reasonCode: "WORKOUT_NOT_OPEN" };
  }

  if (
    workoutState.totalSetCount > 0 &&
    workoutState.loggedSetCount >= workoutState.totalSetCount
  ) {
    return { eligible: false, reasonCode: "FULLY_LOGGED_EXERCISE_BLOCKED" };
  }

  if (workoutState.loggedSetCount > 0) {
    return { eligible: false, reasonCode: "PARTIALLY_LOGGED_EXERCISE_BLOCKED" };
  }

  if (workoutState.isAlreadySwapped) {
    return { eligible: false, reasonCode: "ALREADY_SWAPPED" };
  }

  if (!hasSufficientExerciseMetadata(sourceExercise)) {
    return { eligible: false, reasonCode: "INSUFFICIENT_METADATA" };
  }

  return { eligible: true };
}

export function evaluateRuntimeExerciseSwapEligibility(input: {
  current: RuntimeExerciseSwapProfile;
  candidate: RuntimeExerciseSwapProfile;
}): RuntimeExerciseSwapEligibility | null {
  if (input.current.id === input.candidate.id) {
    return null;
  }

  if (
    !hasSufficientExerciseMetadata(input.current) ||
    !hasSufficientExerciseMetadata(input.candidate)
  ) {
    return null;
  }

  const currentPrimary = normalizeList(input.current.primaryMuscles);
  const candidatePrimary = normalizeList(input.candidate.primaryMuscles);
  const currentPatterns = normalizeList(input.current.movementPatterns);
  const candidatePatterns = normalizeList(input.candidate.movementPatterns);

  const primaryMuscleOverlap = intersect(currentPrimary, candidatePrimary);
  if (primaryMuscleOverlap.length === 0) {
    return null;
  }

  const movementPatternOverlap = intersect(currentPatterns, candidatePatterns);
  const movementFamilyOverlap = intersect(
    resolveMovementFamilies(currentPatterns),
    resolveMovementFamilies(candidatePatterns),
  );
  const movementMatch = movementPatternOverlap.length > 0 ? "exact" : "family";
  if (movementFamilyOverlap.length === 0) {
    return null;
  }

  if (
    input.current.isMainLift &&
    (!(input.candidate.isMainLiftEligible ?? false) ||
      candidatePatterns.includes("isolation"))
  ) {
    return null;
  }

  const currentJointStress = resolveJointStressDemand(input.current);
  const candidateJointStress = resolveJointStressDemand(input.candidate);
  if (currentJointStress == null || candidateJointStress == null) {
    return null;
  }
  const jointStressDelta = candidateJointStress - currentJointStress;
  if (jointStressDelta > 0) {
    return null;
  }

  const fatigueDelta =
    (input.candidate.fatigueCost ?? 3) - (input.current.fatigueCost ?? 3);
  if (
    fatigueDelta > 0 &&
    !isEquivalentCalfIsolationFatigueException({
      current: input.current,
      candidate: input.candidate,
      fatigueDelta,
    }) &&
    !isEquivalentLateralRaiseFatigueException({
      current: input.current,
      candidate: input.candidate,
      fatigueDelta,
    })
  ) {
    return null;
  }

  const candidateEquipmentDemand = resolveEquipmentDemand(input.candidate);
  const currentEquipmentDemand = resolveEquipmentDemand(input.current);
  const equipmentDemandDelta =
    candidateEquipmentDemand - currentEquipmentDemand;
  const equipmentDemandStayedAtOrBelowOriginal = equipmentDemandDelta <= 0;
  const roleMatch =
    Boolean(input.current.isMainLift) ===
    Boolean(input.candidate.isMainLiftEligible);
  const historyMatch = Boolean(input.candidate.hasRecentHistory);

  return {
    primaryMuscleOverlap,
    movementPatternOverlap,
    movementFamilyOverlap,
    movementMatch,
    roleMatch,
    equipmentDemandStayedAtOrBelowOriginal,
    equipmentDemandDelta,
    jointStressDelta,
    fatigueDelta,
    historyMatch,
    score:
      (movementMatch === "exact" ? 200 : 100) +
      primaryMuscleOverlap.length * 5 +
      movementFamilyOverlap.length * 4 +
      (roleMatch ? 3 : 0) +
      Math.max(0, -equipmentDemandDelta) +
      Math.max(0, -jointStressDelta) +
      Math.max(0, -fatigueDelta) +
      (historyMatch ? 1 : 0),
  };
}

export function buildRuntimeExerciseSwapCandidates(input: {
  current: RuntimeExerciseSwapProfile;
  candidates: RuntimeExerciseSwapProfile[];
  excludedExerciseIds?: Set<string>;
  limit?: number;
}): RuntimeExerciseSwapCandidate[] {
  return input.candidates
    .flatMap((candidate) => {
      if (input.excludedExerciseIds?.has(candidate.id)) {
        return [];
      }

      const compatibility = evaluateRuntimeExerciseSwapEligibility({
        current: input.current,
        candidate,
      });
      if (!compatibility) {
        return [];
      }
      const diagnostics = buildSwapCandidateDiagnostics({
        current: input.current,
        candidate,
        compatibility,
      });

      return [
        {
          exerciseId: candidate.id,
          exerciseName: candidate.name,
          primaryMuscles: normalizeList(candidate.primaryMuscles),
          equipment: normalizeList(candidate.equipment),
          compatibility,
          reason: diagnostics.swapCandidateReason || buildReason(compatibility),
          ...diagnostics,
        } satisfies RuntimeExerciseSwapCandidate,
      ];
    })
    .sort((left, right) => {
      const leftTier = tierRank(left.swapFallbackTier);
      const rightTier = tierRank(right.swapFallbackTier);
      if (rightTier !== leftTier) {
        return rightTier - leftTier;
      }
      if (right.swapLaneFitScore !== left.swapLaneFitScore) {
        return right.swapLaneFitScore - left.swapLaneFitScore;
      }
      const movementRank = (entry: RuntimeExerciseSwapCandidate) =>
        entry.compatibility.movementMatch === "exact" ? 2 : 1;
      if (movementRank(right) !== movementRank(left)) {
        return movementRank(right) - movementRank(left);
      }
      if (
        right.compatibility.primaryMuscleOverlap.length !==
        left.compatibility.primaryMuscleOverlap.length
      ) {
        return (
          right.compatibility.primaryMuscleOverlap.length -
          left.compatibility.primaryMuscleOverlap.length
        );
      }
      if (right.compatibility.roleMatch !== left.compatibility.roleMatch) {
        return right.compatibility.roleMatch ? 1 : -1;
      }
      if (
        left.compatibility.equipmentDemandDelta !==
        right.compatibility.equipmentDemandDelta
      ) {
        return (
          left.compatibility.equipmentDemandDelta -
          right.compatibility.equipmentDemandDelta
        );
      }
      if (
        left.compatibility.jointStressDelta !==
        right.compatibility.jointStressDelta
      ) {
        return (
          left.compatibility.jointStressDelta -
          right.compatibility.jointStressDelta
        );
      }
      if (
        left.compatibility.fatigueDelta !== right.compatibility.fatigueDelta
      ) {
        return (
          left.compatibility.fatigueDelta - right.compatibility.fatigueDelta
        );
      }
      if (right.loadabilityTier !== left.loadabilityTier) {
        return tierValue(right.loadabilityTier) - tierValue(left.loadabilityTier);
      }
      if (right.stabilityTier !== left.stabilityTier) {
        return tierValue(right.stabilityTier) - tierValue(left.stabilityTier);
      }
      if (
        right.compatibility.historyMatch !== left.compatibility.historyMatch
      ) {
        return right.compatibility.historyMatch ? 1 : -1;
      }
      return left.exerciseName.localeCompare(right.exerciseName);
    })
    .slice(0, input.limit ?? 5);
}
