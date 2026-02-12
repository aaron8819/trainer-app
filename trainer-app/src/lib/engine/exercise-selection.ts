import { filterCompletedHistory, sortHistoryByDateDesc } from "./history";
import { getRestSeconds } from "./prescription";
import { getGoalRepRanges } from "./rules";
import type { Exercise, Goals, MovementPatternV2, WorkoutExercise, WorkoutHistoryEntry } from "./types";
import { estimateWorkoutMinutes, trimAccessoriesByPriority } from "./timeboxing";
import { INDIRECT_SET_MULTIPLIER } from "./volume-constants";
import { MUSCLE_SPLIT_MAP, VOLUME_LANDMARKS } from "./volume-landmarks";
import {
  buildVolumeContext,
  buildVolumePlanByMuscle,
  enforceVolumeCaps,
  getTargetVolume,
  type EnhancedVolumeContext,
  type VolumePlanByMuscle,
} from "./volume";

export type SessionIntent = "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "body_part";
type SelectionStep = "pin" | "anchor" | "main_pick" | "accessory_pick";
type SelectionPhase = "main" | "accessory";
type SelectedRole = "main" | "accessory";
export type ColdStartStage = 0 | 1 | 2;

export type SelectionInput = {
  mode: "template" | "intent";
  intent: SessionIntent;
  targetMuscles?: string[];
  pinnedExerciseIds?: string[];
  templateExerciseIds?: string[];
  weekInBlock: number;
  mesocycleLength: number;
  sessionMinutes: number;
  trainingAge: "beginner" | "intermediate" | "advanced";
  goals: Goals;
  constraints: {
    availableEquipment: string[];
    daysPerWeek: number;
  };
  program?: { id: string; weeklySchedule?: string[] };
  coldStart?: {
    stage: ColdStartStage;
  };
  preferences?: {
    favoriteExerciseIds?: string[];
    avoidExerciseIds?: string[];
    favoriteExercises?: string[];
    avoidExercises?: string[];
  };
  fatigueState: {
    readinessScore: 1 | 2 | 3 | 4 | 5;
    painFlags?: Record<string, 0 | 1 | 2 | 3>;
  };
  history: WorkoutHistoryEntry[];
  exerciseLibrary: Exercise[];
};

export type SelectionOutput = {
  selectedExerciseIds: string[];
  mainLiftIds: string[];
  accessoryIds: string[];
  perExerciseSetTargets: Record<string, number>;
  volumePlanByMuscle: VolumePlanByMuscle;
  rationale: Record<
    string,
    {
      score: number;
      components: Record<string, number>;
      hardFilterPass: boolean;
      selectedStep: SelectionStep;
    }
  >;
};

export type CandidateRanking = {
  exerciseId: string;
  name: string;
  score: number;
  fatigueCost: number;
  components: Record<string, number>;
};

export type HardFilterFailureReason =
  | "already_selected"
  | "equipment"
  | "avoid"
  | "pain_conflict"
  | "sfr_below_threshold"
  | "critical_muscle_overlap"
  | "body_part_primary_overlap"
  | "intent_scope_primary_overlap"
  | "same_primary_pattern_duplicate"
  | "main_lift_eligibility"
  | "main_rep_range";

type RankingSeedPick = {
  exerciseId: string;
  role: SelectedRole;
};

type SelectedExercise = {
  exercise: Exercise;
  role: SelectedRole;
  selectedStep: SelectionStep;
  orderIndex: number;
};

type SelectionState = {
  input: SelectionInput;
  volumeContext: EnhancedVolumeContext;
  targetByMuscle: Record<string, number>;
  basePlannedEffectiveByMuscle: Record<string, number>;
  plannedEffectiveByMuscle: Record<string, number>;
  selected: SelectedExercise[];
  selectedIds: Set<string>;
  selectedPatterns: Set<MovementPatternV2>;
  coveredPrimaryMuscles: Set<string>;
  primaryPatternOverlapCount: Record<string, number>;
  recencyHoursByExercise: Map<string, number>;
  continuityCountByExercise: Map<string, number>;
  favoritesById: Set<string>;
  favoritesByName: Set<string>;
  avoidById: Set<string>;
  avoidByName: Set<string>;
  criticalMuscles: Set<string>;
  rationale: SelectionOutput["rationale"];
  mainSlotsRemaining: number;
  accessorySlotsRemaining: number;
  totalAccessorySlots: number;
  runningEstimateMinutes: number;
};

type ScoredCandidate = {
  exercise: Exercise;
  score: number;
  components: Record<string, number>;
};

type SlotTarget = {
  targetSlotCount: number;
  targetMainSlots: number;
  targetAccessorySlots: number;
};

const PROVISIONAL_MAIN_SETS = 4;
const PROVISIONAL_ACCESSORY_SETS = 3;
const FALLBACK_TARGET_VOLUME = 6;
const CORE_PATTERNS = new Set<MovementPatternV2>([
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "squat",
  "hinge",
  "lunge",
  "carry",
]);

const LARGE_MUSCLES = new Set(
  ["Chest", "Lats", "Upper Back", "Quads", "Hamstrings", "Glutes"].map(normalizeKey)
);

const LANDMARKS_BY_NORMALIZED_KEY = new Map(
  Object.keys(VOLUME_LANDMARKS).map((muscle) => [normalizeKey(muscle), muscle])
);

const CRITICAL_MUSCLES_BY_INTENT: Record<Exclude<SessionIntent, "body_part" | "full_body">, string[]> = {
  push: ["Chest", "Front Delts", "Side Delts", "Triceps"],
  pull: ["Lats", "Upper Back", "Rear Delts", "Biceps", "Forearms"],
  legs: ["Quads", "Hamstrings", "Glutes", "Calves", "Adductors", "Abductors", "Core", "Abs"],
  upper: [
    "Chest",
    "Front Delts",
    "Side Delts",
    "Triceps",
    "Lats",
    "Upper Back",
    "Rear Delts",
    "Biceps",
    "Forearms",
  ],
  lower: ["Quads", "Hamstrings", "Glutes", "Calves", "Adductors", "Abductors", "Core", "Lower Back"],
};

const SLOT_RANGES: Record<
  SessionIntent,
  {
    main: [number, number];
    accessory: [number, number];
  }
> = {
  push: { main: [1, 2], accessory: [3, 5] },
  pull: { main: [1, 2], accessory: [3, 5] },
  legs: { main: [1, 2], accessory: [3, 5] },
  upper: { main: [1, 2], accessory: [4, 6] },
  lower: { main: [1, 2], accessory: [3, 5] },
  full_body: { main: [1, 2], accessory: [4, 6] },
  body_part: { main: [0, 2], accessory: [4, 6] },
};

const SCORING_WEIGHTS = {
  muscleDeficitScore: 3.0,
  targetednessScore: 0.9,
  sfrScore: 1.2,
  lengthenedScore: 0.8,
  preferenceScore: 1.0,
  movementDiversityScore: 0.9,
  continuityScore: 1.1,
  timeFitScore: 0.6,
  recencyPenalty: 1.2,
  redundancyPenalty: 1.0,
  fatigueCostPenalty: 1.3,
} as const;

type ScoringWeights = {
  [K in keyof typeof SCORING_WEIGHTS]: number;
};

function interpolateLinear(start: number, end: number, progress: number) {
  return start + (end - start) * clamp(progress, 0, 1);
}

function resolveScoringWeights(phase: SelectionPhase, slotProgress: number): ScoringWeights {
  if (phase !== "accessory") {
    return SCORING_WEIGHTS;
  }
  return {
    ...SCORING_WEIGHTS,
    muscleDeficitScore: interpolateLinear(3.0, 2.0, slotProgress),
    fatigueCostPenalty: interpolateLinear(1.3, 2.0, slotProgress),
    sfrScore: interpolateLinear(1.2, 1.8, slotProgress),
    redundancyPenalty: interpolateLinear(1.0, 1.5, slotProgress),
  };
}

export function rankCandidatesForCalibration(input: SelectionInput, phase: SelectionPhase, seedPicks: RankingSeedPick[] = []) {
  const mesocycleLength = Math.max(1, input.mesocycleLength);
  const weekInBlock = Math.max(0, input.weekInBlock);
  const volumeContext = buildVolumeContext(input.history, input.exerciseLibrary, {
    week: weekInBlock,
    length: mesocycleLength,
  });
  if (!("muscleVolume" in volumeContext)) {
    throw new Error("Selection requires enhanced volume context");
  }

  const slotTarget = resolveSlotTarget(input);
  const targetByMuscle = buildTargetByMuscle(input, volumeContext);
  const criticalMuscles = resolveCriticalMuscles(input, slotTarget);
  const recencyHoursByExercise = buildRecencyHoursByExercise(input.history, Date.now());
  const continuityCountByExercise = buildContinuityCountByExercise(input.history, input);
  const favoritesById = new Set(input.preferences?.favoriteExerciseIds ?? []);
  const favoritesByName = new Set((input.preferences?.favoriteExercises ?? []).map(normalizeKey));
  const avoidById = new Set(input.preferences?.avoidExerciseIds ?? []);
  const avoidByName = new Set((input.preferences?.avoidExercises ?? []).map(normalizeKey));
  const basePlannedEffectiveByMuscle = buildBasePlannedEffectiveByMuscle(volumeContext);

  const state: SelectionState = {
    input: {
      ...input,
      weekInBlock,
      mesocycleLength,
    },
    volumeContext,
    targetByMuscle,
    basePlannedEffectiveByMuscle,
    plannedEffectiveByMuscle: { ...basePlannedEffectiveByMuscle },
    selected: [],
    selectedIds: new Set<string>(),
    selectedPatterns: new Set<MovementPatternV2>(),
    coveredPrimaryMuscles: new Set<string>(),
    primaryPatternOverlapCount: {},
    recencyHoursByExercise,
    continuityCountByExercise,
    favoritesById,
    favoritesByName,
    avoidById,
    avoidByName,
    criticalMuscles,
    rationale: {},
    mainSlotsRemaining: slotTarget.targetMainSlots,
    accessorySlotsRemaining: slotTarget.targetAccessorySlots,
    totalAccessorySlots: slotTarget.targetAccessorySlots,
    runningEstimateMinutes: 0,
  };

  const byId = new Map(input.exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  for (const pick of seedPicks) {
    const exercise = byId.get(pick.exerciseId);
    if (!exercise || state.selectedIds.has(exercise.id)) {
      continue;
    }
    addSelectedExercise(
      state,
      {
        exercise,
        score: 0,
        components: {},
      },
      pick.role,
      pick.role === "main" ? "main_pick" : "accessory_pick"
    );
  }

  const filledSlots =
    phase === "accessory"
      ? Math.max(0, state.totalAccessorySlots - state.accessorySlotsRemaining)
      : 0;
  const totalSlots = phase === "accessory" ? state.totalAccessorySlots : 1;
  const scored = scoreCandidates(state, phase, filledSlots, totalSlots);
  const ordered = [...scored].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const fatigueA = a.exercise.fatigueCost ?? 3;
    const fatigueB = b.exercise.fatigueCost ?? 3;
    if (fatigueA !== fatigueB) {
      return fatigueA - fatigueB;
    }
    return a.exercise.name.localeCompare(b.exercise.name);
  });

  return ordered.map((entry) => ({
    exerciseId: entry.exercise.id,
    name: entry.exercise.name,
    score: roundValue(entry.score),
    fatigueCost: entry.exercise.fatigueCost ?? 3,
    components: entry.components,
  })) satisfies CandidateRanking[];
}

export function getHardFilterFailureReasonForCalibration(
  input: SelectionInput,
  phase: SelectionPhase,
  exerciseId: string,
  seedPicks: RankingSeedPick[] = []
): HardFilterFailureReason | "not_found" | undefined {
  const mesocycleLength = Math.max(1, input.mesocycleLength);
  const weekInBlock = Math.max(0, input.weekInBlock);
  const volumeContext = buildVolumeContext(input.history, input.exerciseLibrary, {
    week: weekInBlock,
    length: mesocycleLength,
  });
  if (!("muscleVolume" in volumeContext)) {
    throw new Error("Selection requires enhanced volume context");
  }

  const slotTarget = resolveSlotTarget(input);
  const targetByMuscle = buildTargetByMuscle(input, volumeContext);
  const criticalMuscles = resolveCriticalMuscles(input, slotTarget);
  const recencyHoursByExercise = buildRecencyHoursByExercise(input.history, Date.now());
  const continuityCountByExercise = buildContinuityCountByExercise(input.history, input);
  const favoritesById = new Set(input.preferences?.favoriteExerciseIds ?? []);
  const favoritesByName = new Set((input.preferences?.favoriteExercises ?? []).map(normalizeKey));
  const avoidById = new Set(input.preferences?.avoidExerciseIds ?? []);
  const avoidByName = new Set((input.preferences?.avoidExercises ?? []).map(normalizeKey));
  const basePlannedEffectiveByMuscle = buildBasePlannedEffectiveByMuscle(volumeContext);

  const state: SelectionState = {
    input: {
      ...input,
      weekInBlock,
      mesocycleLength,
    },
    volumeContext,
    targetByMuscle,
    basePlannedEffectiveByMuscle,
    plannedEffectiveByMuscle: { ...basePlannedEffectiveByMuscle },
    selected: [],
    selectedIds: new Set<string>(),
    selectedPatterns: new Set<MovementPatternV2>(),
    coveredPrimaryMuscles: new Set<string>(),
    primaryPatternOverlapCount: {},
    recencyHoursByExercise,
    continuityCountByExercise,
    favoritesById,
    favoritesByName,
    avoidById,
    avoidByName,
    criticalMuscles,
    rationale: {},
    mainSlotsRemaining: slotTarget.targetMainSlots,
    accessorySlotsRemaining: slotTarget.targetAccessorySlots,
    totalAccessorySlots: slotTarget.targetAccessorySlots,
    runningEstimateMinutes: 0,
  };

  const byId = new Map(input.exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  for (const pick of seedPicks) {
    const exercise = byId.get(pick.exerciseId);
    if (!exercise || state.selectedIds.has(exercise.id)) {
      continue;
    }
    addSelectedExercise(
      state,
      {
        exercise,
        score: 0,
        components: {},
      },
      pick.role,
      pick.role === "main" ? "main_pick" : "accessory_pick"
    );
  }

  const candidate = byId.get(exerciseId);
  if (!candidate) {
    return "not_found";
  }
  return resolveHardFilterFailureReason(state, candidate, phase);
}

export function selectExercises(input: SelectionInput): SelectionOutput {
  const mesocycleLength = Math.max(1, input.mesocycleLength);
  const weekInBlock = Math.max(0, input.weekInBlock);
  const volumeContext = buildVolumeContext(input.history, input.exerciseLibrary, {
    week: weekInBlock,
    length: mesocycleLength,
  });
  if (!("muscleVolume" in volumeContext)) {
    throw new Error("Selection requires enhanced volume context");
  }

  const slotTarget = resolveSlotTarget(input);
  const targetByMuscle = buildTargetByMuscle(input, volumeContext);
  const criticalMuscles = resolveCriticalMuscles(input, slotTarget);
  const recencyHoursByExercise = buildRecencyHoursByExercise(input.history, Date.now());
  const continuityCountByExercise = buildContinuityCountByExercise(input.history, input);
  const favoritesById = new Set(input.preferences?.favoriteExerciseIds ?? []);
  const favoritesByName = new Set((input.preferences?.favoriteExercises ?? []).map(normalizeKey));
  const avoidById = new Set(input.preferences?.avoidExerciseIds ?? []);
  const avoidByName = new Set((input.preferences?.avoidExercises ?? []).map(normalizeKey));
  const basePlannedEffectiveByMuscle = buildBasePlannedEffectiveByMuscle(volumeContext);

  const state: SelectionState = {
    input: {
      ...input,
      weekInBlock,
      mesocycleLength,
    },
    volumeContext,
    targetByMuscle,
    basePlannedEffectiveByMuscle,
    plannedEffectiveByMuscle: { ...basePlannedEffectiveByMuscle },
    selected: [],
    selectedIds: new Set<string>(),
    selectedPatterns: new Set<MovementPatternV2>(),
    coveredPrimaryMuscles: new Set<string>(),
    primaryPatternOverlapCount: {},
    recencyHoursByExercise,
    continuityCountByExercise,
    favoritesById,
    favoritesByName,
    avoidById,
    avoidByName,
    criticalMuscles,
    rationale: {},
    mainSlotsRemaining: slotTarget.targetMainSlots,
    accessorySlotsRemaining: slotTarget.targetAccessorySlots,
    totalAccessorySlots: slotTarget.targetAccessorySlots,
    runningEstimateMinutes: 0,
  };
  const coldStartStage: ColdStartStage =
    input.mode === "intent" ? (input.coldStart?.stage ?? 2) : 2;

  applyPins(state, slotTarget.targetSlotCount);
  applyAutoAnchors(state);

  if (coldStartStage >= 2) {
    while (state.mainSlotsRemaining > 0) {
      const filledMainSlots = Math.max(0, slotTarget.targetMainSlots - state.mainSlotsRemaining);
      const scored = scoreCandidates(state, "main", filledMainSlots, slotTarget.targetMainSlots);
      const pick = pickBestDeterministic(scored);
      if (!pick) {
        break;
      }
      addSelectedExercise(state, pick, "main", "main_pick");
    }
  }

  enforceFullBodyCompoundCoverageFloor(state, slotTarget, coldStartStage);

  if (coldStartStage >= 1) {
    while (state.accessorySlotsRemaining > 0) {
      const filledAccessorySlots = Math.max(0, state.totalAccessorySlots - state.accessorySlotsRemaining);
      const scored = scoreCandidates(
        state,
        "accessory",
        filledAccessorySlots,
        state.totalAccessorySlots
      );
      const pick = pickBestDeterministic(scored);
      if (!pick) {
        break;
      }
      addSelectedExercise(state, pick, "accessory", "accessory_pick");
    }
  } else {
    applyStarterSessionFallback(state);
  }

  if (state.input.mode === "intent" && state.selected.length < Math.min(3, slotTarget.targetSlotCount)) {
    applyStarterSessionFallback(state);
  }

  applyPostFillSafety(state, buildProvisionalSetTargets(state));

  const perExerciseSetTargets =
    state.input.mode === "intent"
      ? allocateIntentSets(state)
      : {};

  if (state.input.mode === "intent") {
    applyFinalIntentSafety(state, perExerciseSetTargets);
  }

  const normalizedSetTargets =
    state.input.mode === "intent"
      ? ensureSetTargetsForSelected(state, perExerciseSetTargets)
      : {};
  const volumePlanByMuscle = buildOutputVolumePlanByMuscle(state, normalizedSetTargets);

  const selectedExerciseIds = state.selected.map((entry) => entry.exercise.id);
  const mainLiftIds = state.selected
    .filter((entry) => entry.role === "main")
    .map((entry) => entry.exercise.id);
  const accessoryIds = state.selected
    .filter((entry) => entry.role === "accessory")
    .map((entry) => entry.exercise.id);
  const selectedIdSet = new Set(selectedExerciseIds);
  const filteredRationale = Object.fromEntries(
    Object.entries(state.rationale).filter(([exerciseId]) => selectedIdSet.has(exerciseId))
  );

  return {
    selectedExerciseIds,
    mainLiftIds,
    accessoryIds,
    perExerciseSetTargets: normalizedSetTargets,
    volumePlanByMuscle,
    rationale: filteredRationale,
  };
}

function applyPins(state: SelectionState, targetSlotCount: number) {
  const pinnedInput = dedupeExerciseIds(state.input.pinnedExerciseIds ?? []);
  if (pinnedInput.length === 0) {
    return;
  }
  const maxPinned = Math.max(1, targetSlotCount - 2);
  const pinned = pinnedInput.slice(0, maxPinned);
  const byId = new Map(state.input.exerciseLibrary.map((exercise) => [exercise.id, exercise]));

  for (const pinnedId of pinned) {
    const exercise = byId.get(pinnedId);
    if (!exercise || state.selectedIds.has(exercise.id)) {
      continue;
    }
    const preferredRole = resolvePreferredRoleForExercise(state, exercise);
    if (!preferredRole) {
      continue;
    }
    const phase = preferredRole === "main" ? "main" : "accessory";
    if (!passesHardFilters(state, exercise, phase)) {
      continue;
    }
    addSelectedExercise(
      state,
      {
        exercise,
        score: 0,
        components: { pinned: 1 },
      },
      preferredRole,
      "pin"
    );
  }
}

function applyAutoAnchors(state: SelectionState) {
  if (state.input.weekInBlock === 0) {
    return;
  }
  const anchorCandidates = Array.from(state.continuityCountByExercise.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      const exerciseA = state.input.exerciseLibrary.find((exercise) => exercise.id === a[0]);
      const exerciseB = state.input.exerciseLibrary.find((exercise) => exercise.id === b[0]);
      if (!exerciseA || !exerciseB) {
        return a[0].localeCompare(b[0]);
      }
      const fatigueA = exerciseA.fatigueCost ?? 3;
      const fatigueB = exerciseB.fatigueCost ?? 3;
      if (fatigueA !== fatigueB) {
        return fatigueA - fatigueB;
      }
      return exerciseA.name.localeCompare(exerciseB.name);
    });

  const byId = new Map(state.input.exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  for (const [exerciseId] of anchorCandidates) {
    if (state.mainSlotsRemaining <= 0 && state.accessorySlotsRemaining <= 0) {
      break;
    }
    const exercise = byId.get(exerciseId);
    if (!exercise || state.selectedIds.has(exerciseId)) {
      continue;
    }
    const preferredRole = resolvePreferredRoleForExercise(state, exercise);
    if (!preferredRole) {
      continue;
    }
    const phase = preferredRole === "main" ? "main" : "accessory";
    if (!passesHardFilters(state, exercise, phase)) {
      continue;
    }
    addSelectedExercise(
      state,
      {
        exercise,
        score: 0,
        components: { continuityScore: 1 },
      },
      preferredRole,
      "anchor"
    );
  }
}

function scoreCandidates(
  state: SelectionState,
  phase: SelectionPhase,
  currentSlotIndex: number,
  totalSlots: number
): ScoredCandidate[] {
  const candidates = state.input.exerciseLibrary.filter((exercise) =>
    passesHardFilters(state, exercise, phase)
  );
  const slotProgress = totalSlots > 0 ? clamp(currentSlotIndex / totalSlots, 0, 1) : 0;
  const weights = resolveScoringWeights(phase, slotProgress);
  return candidates.map((exercise) => {
    const components = buildScoringComponents(state, exercise, phase);
    const score =
      weights.muscleDeficitScore * components.muscleDeficitScore +
      weights.targetednessScore * components.targetednessScore +
      weights.sfrScore * components.sfrScore +
      weights.lengthenedScore * components.lengthenedScore +
      weights.preferenceScore * components.preferenceScore +
      weights.movementDiversityScore * components.movementDiversityScore +
      weights.continuityScore * components.continuityScore +
      weights.timeFitScore * components.timeFitScore -
      weights.recencyPenalty * components.recencyPenalty -
      weights.redundancyPenalty * components.redundancyPenalty -
      weights.fatigueCostPenalty * components.fatigueCostPenalty;

    return {
      exercise,
      score,
      components,
    };
  });
}

function buildScoringComponents(
  state: SelectionState,
  exercise: Exercise,
  phase: SelectionPhase
): Record<string, number> {
  const provisionalSets = phase === "main" ? PROVISIONAL_MAIN_SETS : PROVISIONAL_ACCESSORY_SETS;
  const primaryMuscles = (exercise.primaryMuscles ?? []).map(resolveCanonicalMuscleName);
  const secondaryMuscles = (exercise.secondaryMuscles ?? []).map(resolveCanonicalMuscleName);
  const highestDeficitMuscle = resolveHighestDeficitMuscle(state);
  const targetednessScore =
    highestDeficitMuscle && primaryMuscles.some((muscle) => normalizeKey(muscle) === highestDeficitMuscle)
      ? 0.3
      : 0;

  const muscleDeficitScore = clamp(
    computeMuscleDeficitContribution(state, primaryMuscles, secondaryMuscles, provisionalSets) / 4,
    -1,
    1
  );

  const recencyPenalty = resolveRecencyPenalty(state.recencyHoursByExercise.get(exercise.id));
  const preferenceScore =
    state.favoritesById.has(exercise.id) || state.favoritesByName.has(normalizeKey(exercise.name))
      ? 1
      : 0;

  const movementDiversityScore = resolveMovementDiversityScore(state, exercise, primaryMuscles);
  const continuityScore =
    state.input.weekInBlock === 0
      ? 0
      : resolveContinuityScore(state.continuityCountByExercise.get(exercise.id) ?? 0);
  const timeFitScore = resolveTimeFitScore(state, exercise, phase, provisionalSets);
  const fatigueCostPenalty = resolveFatigueCostPenalty(exercise, state.input.fatigueState.readinessScore);
  const redundancyPenalty = resolveRedundancyPenalty(state, exercise, primaryMuscles);

  return {
    muscleDeficitScore,
    targetednessScore,
    sfrScore: normalizeCentered(exercise.sfrScore ?? 3, 3, 2),
    lengthenedScore: normalizeCentered(exercise.lengthPositionScore ?? 3, 3, 2),
    recencyPenalty,
    preferenceScore,
    movementDiversityScore,
    continuityScore,
    timeFitScore,
    fatigueCostPenalty,
    redundancyPenalty,
  };
}

function pickBestDeterministic(candidates: ScoredCandidate[]): ScoredCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  const ordered = [...candidates].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const fatigueA = a.exercise.fatigueCost ?? 3;
    const fatigueB = b.exercise.fatigueCost ?? 3;
    if (fatigueA !== fatigueB) {
      return fatigueA - fatigueB;
    }
    return a.exercise.name.localeCompare(b.exercise.name);
  });
  return ordered[0];
}

function addSelectedExercise(
  state: SelectionState,
  candidate: Pick<ScoredCandidate, "exercise" | "score" | "components">,
  role: SelectedRole,
  selectedStep: SelectionStep
) {
  const exercise = candidate.exercise;
  const selected: SelectedExercise = {
    exercise,
    role,
    selectedStep,
    orderIndex: state.selected.length,
  };
  state.selected.push(selected);
  state.selectedIds.add(exercise.id);
  for (const pattern of exercise.movementPatterns ?? []) {
    state.selectedPatterns.add(pattern);
  }
  for (const muscle of exercise.primaryMuscles ?? []) {
    const canonical = resolveCanonicalMuscleName(muscle);
    const normalized = normalizeKey(canonical);
    state.coveredPrimaryMuscles.add(normalized);
    const patternKeys = resolveExercisePatternKeys(exercise);
    for (const patternKey of patternKeys) {
      const key = `${normalized}|${patternKey}`;
      state.primaryPatternOverlapCount[key] = (state.primaryPatternOverlapCount[key] ?? 0) + 1;
    }
  }

  const provisionalSets = role === "main" ? PROVISIONAL_MAIN_SETS : PROVISIONAL_ACCESSORY_SETS;
  applyEffectiveSetContribution(state.plannedEffectiveByMuscle, exercise, provisionalSets);
  state.runningEstimateMinutes += estimateExerciseMinutes(
    state,
    exercise,
    provisionalSets,
    role === "main"
  );

  if (role === "main") {
    state.mainSlotsRemaining = Math.max(0, state.mainSlotsRemaining - 1);
  } else {
    state.accessorySlotsRemaining = Math.max(0, state.accessorySlotsRemaining - 1);
  }

  state.rationale[exercise.id] = {
    score: roundValue(candidate.score),
    components: candidate.components,
    hardFilterPass: true,
    selectedStep,
  };
}

function applyPostFillSafety(state: SelectionState, setTargets: Record<string, number>) {
  if (state.selected.length === 0) {
    return;
  }

  const workoutExercises = buildWorkoutExercisesFromSelection(state, setTargets);
  const mainLifts = workoutExercises.filter((exercise) => exercise.isMainLift);
  let accessories = workoutExercises.filter((exercise) => !exercise.isMainLift);

  accessories = enforceVolumeCaps(accessories, mainLifts, state.volumeContext);

  if (state.input.sessionMinutes > 0) {
    let estimated = estimateWorkoutMinutes([...mainLifts, ...accessories]);
    while (estimated > state.input.sessionMinutes && accessories.length > 0) {
      accessories = trimAccessoriesByPriority(accessories, mainLifts, 1);
      estimated = estimateWorkoutMinutes([...mainLifts, ...accessories]);
    }
  }

  const keptAccessoryIds = new Set(accessories.map((exercise) => exercise.exercise.id));
  state.selected = state.selected.filter(
    (entry) => entry.role === "main" || keptAccessoryIds.has(entry.exercise.id)
  );
  state.selectedIds = new Set(state.selected.map((entry) => entry.exercise.id));
  recomputeDerivedStateAfterSelectionPrune(state, setTargets);
}

function allocateIntentSets(state: SelectionState): Record<string, number> {
  const selected = [...state.selected];
  const setTargets: Record<string, number> = {};
  for (const entry of selected) {
    setTargets[entry.exercise.id] = 2;
  }

  const plannedEffective = { ...state.basePlannedEffectiveByMuscle };
  const sessionDirectSets: Record<string, number> = {};
  for (const entry of selected) {
    applyEffectiveSetContribution(plannedEffective, entry.exercise, 2);
    for (const muscle of entry.exercise.primaryMuscles ?? []) {
      const canonical = resolveCanonicalMuscleName(muscle);
      const key = normalizeKey(canonical);
      sessionDirectSets[key] = (sessionDirectSets[key] ?? 0) + 2;
    }
  }

  const maxSets = maxSetsByTrainingAge(state.input.trainingAge);
  let runningMinutes = selected.reduce(
    (sum, entry) => sum + estimateExerciseMinutes(state, entry.exercise, 2, entry.role === "main"),
    0
  );

  while (deficitsRemain(state, plannedEffective, 1.0)) {
    const ranked = selected
      .filter((entry) => (setTargets[entry.exercise.id] ?? 0) < maxSets)
      .map((entry) => {
        const addedSetMinutes = estimateExerciseMinutes(
          state,
          entry.exercise,
          1,
          entry.role === "main"
        );
        if (state.input.sessionMinutes > 0 && runningMinutes + addedSetMinutes > state.input.sessionMinutes) {
          return undefined;
        }
        if (
          state.input.intent === "body_part" &&
          exceedsBodyPartDirectSetCaps(entry.exercise, sessionDirectSets, state.criticalMuscles)
        ) {
          return undefined;
        }
        const gain = marginalDeficitClosure(state, plannedEffective, entry.exercise);
        return {
          entry,
          gain,
          addedSetMinutes,
        };
      })
      .filter((candidate): candidate is { entry: SelectedExercise; gain: number; addedSetMinutes: number } =>
        Boolean(candidate)
      )
      .filter((candidate) => candidate.gain > 0)
      .sort((a, b) => {
        if (b.gain !== a.gain) {
          return b.gain - a.gain;
        }
        if (a.entry.orderIndex !== b.entry.orderIndex) {
          return a.entry.orderIndex - b.entry.orderIndex;
        }
        return a.entry.exercise.name.localeCompare(b.entry.exercise.name);
      });

    if (ranked.length === 0) {
      break;
    }

    const picked = ranked[0];
    setTargets[picked.entry.exercise.id] = (setTargets[picked.entry.exercise.id] ?? 0) + 1;
    applyEffectiveSetContribution(plannedEffective, picked.entry.exercise, 1);
    runningMinutes += picked.addedSetMinutes;
    for (const muscle of picked.entry.exercise.primaryMuscles ?? []) {
      const canonical = resolveCanonicalMuscleName(muscle);
      const key = normalizeKey(canonical);
      sessionDirectSets[key] = (sessionDirectSets[key] ?? 0) + 1;
    }
  }

  if (state.input.intent === "full_body") {
    rebalanceFullBodyCategorySets(state, setTargets);
  }

  return setTargets;
}

function applyFinalIntentSafety(state: SelectionState, setTargets: Record<string, number>) {
  applyPostFillSafety(state, setTargets);
  enforceIntentMinimumExerciseFloor(state, setTargets);
}

function ensureSetTargetsForSelected(
  state: SelectionState,
  setTargets: Record<string, number>
): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const entry of state.selected) {
    normalized[entry.exercise.id] = Math.max(2, Math.round(setTargets[entry.exercise.id] ?? 2));
  }
  return normalized;
}

function buildOutputVolumePlanByMuscle(
  state: SelectionState,
  setTargets: Record<string, number>
): VolumePlanByMuscle {
  const fallbackTargets = buildProvisionalSetTargets(state);
  const effectiveTargets =
    state.input.mode === "intent" && Object.keys(setTargets).length > 0 ? setTargets : fallbackTargets;
  const workoutExercises = buildWorkoutExercisesFromSelection(state, effectiveTargets);
  const mainLifts = workoutExercises.filter((exercise) => exercise.isMainLift);
  const accessories = workoutExercises.filter((exercise) => !exercise.isMainLift);
  return buildVolumePlanByMuscle(mainLifts, accessories, state.volumeContext, {
    mesocycleWeek: state.input.weekInBlock,
    mesocycleLength: state.input.mesocycleLength,
  });
}

function buildProvisionalSetTargets(state: SelectionState): Record<string, number> {
  const targets: Record<string, number> = {};
  for (const entry of state.selected) {
    targets[entry.exercise.id] = entry.role === "main" ? PROVISIONAL_MAIN_SETS : PROVISIONAL_ACCESSORY_SETS;
  }
  return targets;
}

function recomputeDerivedStateAfterSelectionPrune(
  state: SelectionState,
  setTargets: Record<string, number>
) {
  state.plannedEffectiveByMuscle = { ...state.basePlannedEffectiveByMuscle };
  state.selectedPatterns = new Set<MovementPatternV2>();
  state.coveredPrimaryMuscles = new Set<string>();
  state.primaryPatternOverlapCount = {};
  state.runningEstimateMinutes = 0;

  for (const [index, entry] of state.selected.entries()) {
    entry.orderIndex = index;
    const sets = Math.max(
      1,
      Math.round(
        setTargets[entry.exercise.id] ??
          (entry.role === "main" ? PROVISIONAL_MAIN_SETS : PROVISIONAL_ACCESSORY_SETS)
      )
    );
    applyEffectiveSetContribution(state.plannedEffectiveByMuscle, entry.exercise, sets);
    state.runningEstimateMinutes += estimateExerciseMinutes(
      state,
      entry.exercise,
      sets,
      entry.role === "main"
    );
    for (const pattern of entry.exercise.movementPatterns ?? []) {
      state.selectedPatterns.add(pattern);
    }
    for (const muscle of entry.exercise.primaryMuscles ?? []) {
      const canonical = resolveCanonicalMuscleName(muscle);
      const normalized = normalizeKey(canonical);
      state.coveredPrimaryMuscles.add(normalized);
      const patternKeys = resolveExercisePatternKeys(entry.exercise);
      for (const patternKey of patternKeys) {
        const key = `${normalized}|${patternKey}`;
        state.primaryPatternOverlapCount[key] = (state.primaryPatternOverlapCount[key] ?? 0) + 1;
      }
    }
  }
}

function buildWorkoutExercisesFromSelection(
  state: SelectionState,
  setTargets: Record<string, number>
): WorkoutExercise[] {
  const goalRanges = getGoalRepRanges(state.input.goals.primary);
  return state.selected.map((entry, index) => {
    const setCount = Math.max(1, Math.round(setTargets[entry.exercise.id] ?? 2));
    const targetReps = entry.role === "main" ? goalRanges.main[0] : goalRanges.accessory[0];
    return {
      id: `selection-${entry.exercise.id}-${index}`,
      exercise: entry.exercise,
      orderIndex: index,
      isMainLift: entry.role === "main",
      role: entry.role,
      sets: Array.from({ length: setCount }, (_, setIndex) => ({
        setIndex: setIndex + 1,
        targetReps,
      })),
    };
  });
}

function applyStarterSessionFallback(state: SelectionState) {
  while (state.mainSlotsRemaining > 0) {
    const pick = pickStarterCandidate(state, "main");
    if (!pick) {
      break;
    }
    addSelectedExercise(state, pick, "main", "main_pick");
  }

  while (state.accessorySlotsRemaining > 0) {
    const pick = pickStarterCandidate(state, "accessory");
    if (!pick) {
      break;
    }
    addSelectedExercise(state, pick, "accessory", "accessory_pick");
  }
}

function pickStarterCandidate(
  state: SelectionState,
  phase: SelectionPhase
): ScoredCandidate | undefined {
  const intentTargets = resolveStarterTargetMuscles(state.input);
  const candidates = state.input.exerciseLibrary
    .filter((exercise) => passesHardFilters(state, exercise, phase))
    .map((exercise) => {
      const primary = (exercise.primaryMuscles ?? []).map((muscle) =>
        normalizeKey(resolveCanonicalMuscleName(muscle))
      );
      const targetHits = primary.filter((muscle) => intentTargets.has(muscle)).length;
      const fatigue = exercise.fatigueCost ?? 3;
      const safety = resolveJointStressSafety(exercise.jointStress);
      const score = targetHits * 3 + safety * 2 - fatigue * 0.5;
      return {
        exercise,
        score,
        components: {
          starterTargetHits: targetHits,
          starterSafety: safety,
          starterFatiguePenalty: fatigue,
        },
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const fatigueA = a.exercise.fatigueCost ?? 3;
      const fatigueB = b.exercise.fatigueCost ?? 3;
      if (fatigueA !== fatigueB) {
        return fatigueA - fatigueB;
      }
      return a.exercise.name.localeCompare(b.exercise.name);
    });
  return candidates[0];
}

function resolveStarterTargetMuscles(input: SelectionInput): Set<string> {
  if (input.intent === "body_part") {
    return new Set((input.targetMuscles ?? []).map((muscle) => normalizeKey(resolveCanonicalMuscleName(muscle))));
  }
  if (input.intent === "full_body") {
    return new Set(
      Object.keys(VOLUME_LANDMARKS)
        .filter((muscle) => (VOLUME_LANDMARKS[muscle]?.mev ?? 0) > 0)
        .map(normalizeKey)
    );
  }
  return new Set(
    (CRITICAL_MUSCLES_BY_INTENT[input.intent as keyof typeof CRITICAL_MUSCLES_BY_INTENT] ?? []).map((muscle) =>
      normalizeKey(resolveCanonicalMuscleName(muscle))
    )
  );
}

function resolveJointStressSafety(stress?: Exercise["jointStress"]): number {
  if (stress === "low") {
    return 3;
  }
  if (stress === "medium") {
    return 2;
  }
  return 1;
}

function passesHardFilters(
  state: SelectionState,
  exercise: Exercise,
  phase: SelectionPhase
): boolean {
  return resolveHardFilterFailureReason(state, exercise, phase) === undefined;
}

function resolveHardFilterFailureReason(
  state: SelectionState,
  exercise: Exercise,
  phase: SelectionPhase
): HardFilterFailureReason | undefined {
  if (state.selectedIds.has(exercise.id)) {
    return "already_selected";
  }

  if (!passesEquipmentFilter(state, exercise)) {
    return "equipment";
  }
  if (
    state.avoidById.has(exercise.id) ||
    state.avoidByName.has(normalizeKey(exercise.name))
  ) {
    return "avoid";
  }
  if (hasPainConflict(exercise, state.input.fatigueState.painFlags)) {
    return "pain_conflict";
  }
  if (phase === "accessory" && shouldFilterLowSfrAccessory(state.input.goals.primary, exercise)) {
    return "sfr_below_threshold";
  }
  if (state.criticalMuscles.size > 0 && !exerciseHitsCriticalMuscles(exercise, state.criticalMuscles)) {
    return "critical_muscle_overlap";
  }
  if (
    state.input.intent === "body_part" &&
    !exerciseHasBodyPartPrimaryOverlap(exercise, state.criticalMuscles)
  ) {
    return "body_part_primary_overlap";
  }
  if (state.input.mode === "intent" && phase === "accessory") {
    const scope = resolveIntentAccessoryPrimaryScope(state.input);
    if (scope && !exerciseHasPrimaryMuscleOverlap(exercise, scope)) {
      return "intent_scope_primary_overlap";
    }
    if (isPrimaryPatternDuplicateWithoutNewCoverage(state, exercise)) {
      return "same_primary_pattern_duplicate";
    }
  }
  if (phase === "main") {
    if (!exercise.isMainLiftEligible) {
      return "main_lift_eligibility";
    }
    if (shouldDemoteMainLiftForRepRange(state.input.goals, resolveExerciseRepRange(exercise))) {
      return "main_rep_range";
    }
  }
  return undefined;
}

function shouldFilterLowSfrAccessory(primaryGoal: Goals["primary"], exercise: Exercise): boolean {
  if (primaryGoal !== "hypertrophy" && primaryGoal !== "fat_loss") {
    return false;
  }
  return (exercise.sfrScore ?? 3) <= 1;
}

function resolvePreferredRoleForExercise(
  state: SelectionState,
  exercise: Exercise
): SelectedRole | undefined {
  const canBeMain =
    state.mainSlotsRemaining > 0 &&
    exercise.isMainLiftEligible &&
    !shouldDemoteMainLiftForRepRange(state.input.goals, resolveExerciseRepRange(exercise));
  if (canBeMain) {
    return "main";
  }
  if (state.accessorySlotsRemaining > 0) {
    return "accessory";
  }
  if (state.mainSlotsRemaining > 0) {
    return "main";
  }
  return undefined;
}

function resolveSlotTarget(input: SelectionInput): SlotTarget {
  if (input.mode === "template" && (input.templateExerciseIds?.length ?? 0) > 0) {
    const templateExerciseIds = input.templateExerciseIds ?? [];
    const targetSlotCount = Math.max(1, templateExerciseIds.length);
    const byId = new Map(input.exerciseLibrary.map((exercise) => [exercise.id, exercise]));
    const mainEligibleCount = templateExerciseIds.reduce((count, exerciseId) => {
      const exercise = byId.get(exerciseId);
      if (!exercise) {
        return count;
      }
      if (!exercise.isMainLiftEligible) {
        return count;
      }
      if (shouldDemoteMainLiftForRepRange(input.goals, resolveExerciseRepRange(exercise))) {
        return count;
      }
      return count + 1;
    }, 0);
    const targetMainSlots = clamp(mainEligibleCount, 0, Math.min(2, targetSlotCount));
    const targetAccessorySlots = Math.max(0, targetSlotCount - targetMainSlots);
    return {
      targetSlotCount,
      targetMainSlots,
      targetAccessorySlots,
    };
  }

  const range = SLOT_RANGES[input.intent];
  const targetMainSlots = resolveRangedSlotCount(range.main, input.sessionMinutes);
  const targetAccessorySlots = resolveRangedSlotCount(range.accessory, input.sessionMinutes);
  return {
    targetSlotCount: targetMainSlots + targetAccessorySlots,
    targetMainSlots,
    targetAccessorySlots,
  };
}

function resolveRangedSlotCount(range: [number, number], sessionMinutes: number): number {
  const [min, max] = range;
  if (min === max) {
    return min;
  }
  const normalizedMinutes = clamp(sessionMinutes, 35, 80);
  const ratio = (normalizedMinutes - 35) / (80 - 35);
  return clamp(Math.round(min + (max - min) * ratio), min, max);
}

function resolveCriticalMuscles(
  input: SelectionInput,
  slotTarget: SlotTarget
): Set<string> {
  const critical = new Set<string>();
  if (input.intent === "full_body") {
    for (const muscle of Object.keys(VOLUME_LANDMARKS)) {
      if ((VOLUME_LANDMARKS[muscle]?.mev ?? 0) > 0) {
        critical.add(normalizeKey(muscle));
      }
    }
    return critical;
  }

  if (input.intent === "body_part") {
    for (const muscle of input.targetMuscles ?? []) {
      critical.add(normalizeKey(resolveCanonicalMuscleName(muscle)));
    }
    return critical;
  }

  for (const muscle of CRITICAL_MUSCLES_BY_INTENT[input.intent]) {
    critical.add(normalizeKey(resolveCanonicalMuscleName(muscle)));
  }

  if (input.mode === "template" && critical.size === 0 && slotTarget.targetSlotCount > 0) {
    for (const exerciseId of input.templateExerciseIds ?? []) {
      const exercise = input.exerciseLibrary.find((entry) => entry.id === exerciseId);
      if (!exercise) {
        continue;
      }
      for (const muscle of exercise.primaryMuscles ?? []) {
        critical.add(normalizeKey(resolveCanonicalMuscleName(muscle)));
      }
    }
  }

  return critical;
}

function buildTargetByMuscle(
  input: SelectionInput,
  volumeContext: EnhancedVolumeContext
): Record<string, number> {
  const targets: Record<string, number> = {};
  for (const [muscle, landmark] of Object.entries(VOLUME_LANDMARKS)) {
    targets[normalizeKey(muscle)] = getTargetVolume(
      landmark,
      input.weekInBlock,
      input.mesocycleLength
    );
  }
  if (input.intent === "body_part") {
    for (const muscle of input.targetMuscles ?? []) {
      const canonical = resolveCanonicalMuscleName(muscle);
      const key = normalizeKey(canonical);
      if (targets[key] === undefined) {
        targets[key] = FALLBACK_TARGET_VOLUME;
      }
    }
  }
  for (const [muscle, state] of Object.entries(volumeContext.muscleVolume)) {
    const key = normalizeKey(muscle);
    if (targets[key] === undefined) {
      targets[key] = getTargetVolume(state.landmark, input.weekInBlock, input.mesocycleLength);
    }
  }
  return targets;
}

function buildBasePlannedEffectiveByMuscle(
  volumeContext: EnhancedVolumeContext
): Record<string, number> {
  const planned: Record<string, number> = {};
  for (const [muscle, state] of Object.entries(volumeContext.muscleVolume)) {
    planned[normalizeKey(muscle)] =
      state.weeklyDirectSets + state.weeklyIndirectSets * INDIRECT_SET_MULTIPLIER;
  }
  for (const [muscle, sets] of Object.entries(volumeContext.recent)) {
    const key = normalizeKey(muscle);
    if (planned[key] === undefined) {
      planned[key] = sets;
    }
  }
  return planned;
}

function buildRecencyHoursByExercise(
  history: WorkoutHistoryEntry[],
  nowMs: number
): Map<string, number> {
  const recency = new Map<string, number>();
  const completed = filterCompletedHistory(history);
  for (const entry of completed) {
    const hoursAgo = (nowMs - new Date(entry.date).getTime()) / (1000 * 60 * 60);
    for (const exercise of entry.exercises) {
      const prev = recency.get(exercise.exerciseId);
      if (prev === undefined || hoursAgo < prev) {
        recency.set(exercise.exerciseId, hoursAgo);
      }
    }
  }
  return recency;
}

function buildContinuityCountByExercise(
  history: WorkoutHistoryEntry[],
  input: SelectionInput
): Map<string, number> {
  const recentByIntent = sortHistoryByDateDesc(filterCompletedHistory(history))
    .filter((entry) => matchesIntent(entry, input))
    .slice(0, 3);
  const counts = new Map<string, number>();
  for (const entry of recentByIntent) {
    const uniqueExerciseIds = new Set(entry.exercises.map((exercise) => exercise.exerciseId));
    for (const exerciseId of uniqueExerciseIds) {
      counts.set(exerciseId, (counts.get(exerciseId) ?? 0) + 1);
    }
  }
  return counts;
}

function matchesIntent(entry: WorkoutHistoryEntry, input: SelectionInput): boolean {
  const entryIntent = entry.sessionIntent ?? entry.forcedSplit;
  if (input.intent !== "body_part") {
    if (entryIntent) {
      return entryIntent === input.intent;
    }
    if (input.intent === "full_body") {
      return true;
    }
  }

  const entryMuscles = new Set(
    entry.exercises.flatMap((exercise) =>
      (exercise.primaryMuscles ?? []).map((muscle) => normalizeKey(resolveCanonicalMuscleName(muscle)))
    )
  );
  const intentMuscles =
    input.intent === "body_part"
      ? new Set((input.targetMuscles ?? []).map((muscle) => normalizeKey(resolveCanonicalMuscleName(muscle))))
      : new Set(
          (CRITICAL_MUSCLES_BY_INTENT[input.intent as keyof typeof CRITICAL_MUSCLES_BY_INTENT] ?? []).map(
            (muscle) => normalizeKey(resolveCanonicalMuscleName(muscle))
          )
        );
  if (intentMuscles.size === 0) {
    return false;
  }
  for (const muscle of intentMuscles) {
    if (entryMuscles.has(muscle)) {
      return true;
    }
  }
  return false;
}

function computeMuscleDeficitContribution(
  state: SelectionState,
  primaryMuscles: string[],
  secondaryMuscles: string[],
  provisionalSets: number
): number {
  let score = 0;
  for (const muscle of primaryMuscles) {
    score += deficitContributionForMuscle(state, muscle, provisionalSets, 1);
  }
  for (const muscle of secondaryMuscles) {
    score += deficitContributionForMuscle(state, muscle, provisionalSets, INDIRECT_SET_MULTIPLIER);
  }
  return score;
}

function deficitContributionForMuscle(
  state: SelectionState,
  muscle: string,
  provisionalSets: number,
  contributionMultiplier: number
) {
  const key = normalizeKey(muscle);
  if (state.criticalMuscles.size > 0 && !state.criticalMuscles.has(key)) {
    return 0;
  }
  const target = state.targetByMuscle[key] ?? 0;
  const planned = state.plannedEffectiveByMuscle[key] ?? 0;
  const remaining = Math.max(0, target - planned);
  if (remaining <= 0) {
    return 0;
  }
  const need = clamp(remaining / Math.max(1, target), 0, 1);
  const dose = contributionMultiplier * provisionalSets;
  return need * dose;
}

function resolveHighestDeficitMuscle(state: SelectionState): string | undefined {
  let bestMuscle: string | undefined;
  let bestRemaining = 0;
  for (const [muscle, target] of Object.entries(state.targetByMuscle)) {
    if (state.criticalMuscles.size > 0 && !state.criticalMuscles.has(muscle)) {
      continue;
    }
    const planned = state.plannedEffectiveByMuscle[muscle] ?? 0;
    const remaining = Math.max(0, target - planned);
    if (remaining > bestRemaining) {
      bestRemaining = remaining;
      bestMuscle = muscle;
    }
  }
  return bestMuscle;
}

function resolveRecencyPenalty(recencyHours?: number): number {
  if (recencyHours === undefined) {
    return 0;
  }
  if (recencyHours <= 48) {
    return 1;
  }
  if (recencyHours <= 96) {
    return 0.7;
  }
  if (recencyHours <= 168) {
    return 0.4;
  }
  return 0;
}

function resolveMovementDiversityScore(
  state: SelectionState,
  exercise: Exercise,
  primaryMuscles: string[]
): number {
  const patterns = exercise.movementPatterns ?? [];
  const addsUncoveredCorePattern = patterns.some(
    (pattern) => CORE_PATTERNS.has(pattern) && !state.selectedPatterns.has(pattern)
  );
  if (addsUncoveredCorePattern) {
    return 1;
  }
  const addsUncoveredNonCorePattern = patterns.some(
    (pattern) => !CORE_PATTERNS.has(pattern) && !state.selectedPatterns.has(pattern)
  );
  if (addsUncoveredNonCorePattern) {
    return 0.5;
  }
  const addsNewPrimaryCoverage = primaryMuscles.some(
    (muscle) => !state.coveredPrimaryMuscles.has(normalizeKey(muscle))
  );
  if (!addsNewPrimaryCoverage) {
    return -0.5;
  }
  return 0;
}

function resolveContinuityScore(continuityCount: number): number {
  if (continuityCount >= 2) {
    return 1;
  }
  if (continuityCount >= 1) {
    return 0.4;
  }
  return 0;
}

function resolveTimeFitScore(
  state: SelectionState,
  exercise: Exercise,
  phase: SelectionPhase,
  provisionalSets: number
): number {
  if (state.input.sessionMinutes <= 0) {
    return 0;
  }
  const projected = state.runningEstimateMinutes + estimateExerciseMinutes(
    state,
    exercise,
    provisionalSets,
    phase === "main"
  );
  const cushion = state.input.sessionMinutes - 5;
  if (projected <= cushion) {
    return 1;
  }
  if (projected <= state.input.sessionMinutes) {
    return 0;
  }
  return -1;
}

function resolveFatigueCostPenalty(
  exercise: Exercise,
  readinessScore: 1 | 2 | 3 | 4 | 5
): number {
  const fatigue = exercise.fatigueCost ?? 3;
  // Map full 1-5 fatigue scale to [0,1] so moderate-cost compounds are penalized when readiness is low.
  const base = clamp((fatigue - 1) / 4, 0, 1);
  const readinessFactor = readinessScore <= 2 ? 1 : readinessScore === 3 ? 0.5 : 0.2;
  return base * readinessFactor;
}

function resolveRedundancyPenalty(
  state: SelectionState,
  exercise: Exercise,
  primaryMuscles: string[]
): number {
  const candidatePatterns = resolveExercisePatternKeys(exercise);
  let overlap = 0;
  for (const muscle of primaryMuscles) {
    const muscleKey = normalizeKey(muscle);
    for (const patternKey of candidatePatterns) {
      const key = `${muscleKey}|${patternKey}`;
      overlap = Math.max(overlap, state.primaryPatternOverlapCount[key] ?? 0);
    }
  }
  if (overlap >= 2) {
    return 1;
  }
  if (overlap === 1) {
    return 0.5;
  }
  return 0;
}

function marginalDeficitClosure(
  state: SelectionState,
  plannedEffective: Record<string, number>,
  exercise: Exercise
): number {
  let gain = 0;
  for (const muscle of exercise.primaryMuscles ?? []) {
    const key = normalizeKey(resolveCanonicalMuscleName(muscle));
    if (state.criticalMuscles.size > 0 && !state.criticalMuscles.has(key)) {
      continue;
    }
    const remaining = Math.max(0, (state.targetByMuscle[key] ?? 0) - (plannedEffective[key] ?? 0));
    gain += Math.min(remaining, 1);
  }
  for (const muscle of exercise.secondaryMuscles ?? []) {
    const key = normalizeKey(resolveCanonicalMuscleName(muscle));
    if (state.criticalMuscles.size > 0 && !state.criticalMuscles.has(key)) {
      continue;
    }
    const remaining = Math.max(0, (state.targetByMuscle[key] ?? 0) - (plannedEffective[key] ?? 0));
    gain += Math.min(remaining, INDIRECT_SET_MULTIPLIER);
  }
  return gain;
}

function deficitsRemain(
  state: SelectionState,
  plannedEffective: Record<string, number>,
  minEffectiveSetGap: number
): boolean {
  for (const [muscle, target] of Object.entries(state.targetByMuscle)) {
    if (state.criticalMuscles.size > 0 && !state.criticalMuscles.has(muscle)) {
      continue;
    }
    const remaining = target - (plannedEffective[muscle] ?? 0);
    if (remaining >= minEffectiveSetGap) {
      return true;
    }
  }
  return false;
}

function exceedsBodyPartDirectSetCaps(
  exercise: Exercise,
  sessionDirectSets: Record<string, number>,
  criticalMuscles: Set<string>
): boolean {
  for (const muscle of exercise.primaryMuscles ?? []) {
    const key = normalizeKey(resolveCanonicalMuscleName(muscle));
    if (!criticalMuscles.has(key)) {
      continue;
    }
    const cap = LARGE_MUSCLES.has(key) ? 10 : 8;
    if ((sessionDirectSets[key] ?? 0) + 1 > cap) {
      return true;
    }
  }
  return false;
}

function maxSetsByTrainingAge(trainingAge: SelectionInput["trainingAge"]): number {
  if (trainingAge === "beginner") {
    return 4;
  }
  if (trainingAge === "advanced") {
    return 6;
  }
  return 5;
}

function estimateExerciseMinutes(
  state: SelectionState,
  exercise: Exercise,
  sets: number,
  isMainLift: boolean
): number {
  if (sets <= 0) {
    return 0;
  }
  const goalRanges = getGoalRepRanges(state.input.goals.primary);
  const reps = isMainLift ? goalRanges.main[0] : goalRanges.accessory[0];
  const restSeconds = getRestSeconds(exercise, isMainLift, reps);
  const workSeconds = exercise.timePerSetSec ?? (isMainLift ? 60 : 40);
  return ((workSeconds + restSeconds) * sets) / 60;
}

function applyEffectiveSetContribution(
  planned: Record<string, number>,
  exercise: Exercise,
  addedSets: number
) {
  for (const muscle of exercise.primaryMuscles ?? []) {
    const key = normalizeKey(resolveCanonicalMuscleName(muscle));
    planned[key] = (planned[key] ?? 0) + addedSets;
  }
  for (const muscle of exercise.secondaryMuscles ?? []) {
    const key = normalizeKey(resolveCanonicalMuscleName(muscle));
    planned[key] = (planned[key] ?? 0) + addedSets * INDIRECT_SET_MULTIPLIER;
  }
}

function hasPainConflict(
  exercise: Exercise,
  painFlags?: Record<string, 0 | 1 | 2 | 3>
): boolean {
  if (!painFlags || !exercise.contraindications) {
    return false;
  }
  const contraindications = exercise.contraindications;
  const contraindicationKeys = Object.keys(contraindications).map((key) => normalizeKey(key));
  for (const [bodyPart, severity] of Object.entries(painFlags)) {
    if (severity <= 0) {
      continue;
    }
    const normalizedBodyPart = normalizeKey(bodyPart);
    if (contraindicationKeys.includes(normalizedBodyPart)) {
      return true;
    }
  }
  return false;
}

function passesEquipmentFilter(state: SelectionState, exercise: Exercise): boolean {
  const available = new Set(state.input.constraints.availableEquipment.map(normalizeKey));
  const equipment = (exercise.equipment ?? []).map(normalizeKey);
  if (equipment.length === 0) {
    return true;
  }
  if (equipment.includes("bodyweight")) {
    return true;
  }
  return equipment.some((item) => available.has(item));
}

function exerciseHitsCriticalMuscles(exercise: Exercise, criticalMuscles: Set<string>): boolean {
  if (criticalMuscles.size === 0) {
    return true;
  }
  const muscles = [...(exercise.primaryMuscles ?? []), ...(exercise.secondaryMuscles ?? [])].map(
    (muscle) => normalizeKey(resolveCanonicalMuscleName(muscle))
  );
  return muscles.some((muscle) => criticalMuscles.has(muscle));
}

function exerciseHasBodyPartPrimaryOverlap(
  exercise: Exercise,
  targetMuscles: Set<string>
): boolean {
  if (targetMuscles.size === 0) {
    return false;
  }
  const primary = (exercise.primaryMuscles ?? []).map((muscle) =>
    normalizeKey(resolveCanonicalMuscleName(muscle))
  );
  return primary.some((muscle) => targetMuscles.has(muscle));
}

function resolveIntentAccessoryPrimaryScope(input: SelectionInput): Set<string> | undefined {
  if (input.intent === "full_body") {
    return undefined;
  }
  if (input.intent === "body_part") {
    return new Set((input.targetMuscles ?? []).map((muscle) => normalizeKey(resolveCanonicalMuscleName(muscle))));
  }

  const splitGroups =
    input.intent === "upper"
      ? new Set<"push" | "pull" | "legs">(["push", "pull"])
      : input.intent === "lower"
        ? new Set<"push" | "pull" | "legs">(["legs"])
        : new Set<"push" | "pull" | "legs">([input.intent]);

  const scopedMuscles = new Set<string>();
  for (const [muscle, split] of Object.entries(MUSCLE_SPLIT_MAP)) {
    if (splitGroups.has(split)) {
      scopedMuscles.add(normalizeKey(muscle));
    }
  }
  return scopedMuscles;
}

function exerciseHasPrimaryMuscleOverlap(exercise: Exercise, targetMuscles: Set<string>): boolean {
  if (targetMuscles.size === 0) {
    return false;
  }
  const primary = (exercise.primaryMuscles ?? []).map((muscle) =>
    normalizeKey(resolveCanonicalMuscleName(muscle))
  );
  return primary.some((muscle) => targetMuscles.has(muscle));
}

function resolveExercisePatternKeys(exercise: Exercise): string[] {
  const patterns = exercise.movementPatterns ?? [];
  if (patterns.length === 0) {
    return ["none"];
  }
  return Array.from(new Set(patterns.map((pattern) => normalizeKey(pattern))));
}

function isPrimaryPatternDuplicateWithoutNewCoverage(
  state: SelectionState,
  exercise: Exercise
): boolean {
  const primary = (exercise.primaryMuscles ?? []).map((muscle) =>
    normalizeKey(resolveCanonicalMuscleName(muscle))
  );
  const patternKeys = resolveExercisePatternKeys(exercise);
  for (const muscle of primary) {
    for (const patternKey of patternKeys) {
      const overlap = state.primaryPatternOverlapCount[`${muscle}|${patternKey}`] ?? 0;
      if (overlap >= 1) {
        return true;
      }
    }
  }
  return false;
}

function enforceIntentMinimumExerciseFloor(
  state: SelectionState,
  setTargets: Record<string, number>
) {
  if (state.input.mode !== "intent") {
    return;
  }
  const minExercises = 3;
  if (state.selected.length >= minExercises) {
    return;
  }

  while (state.selected.length < minExercises) {
    const filledAccessorySlots = Math.max(0, state.totalAccessorySlots - state.accessorySlotsRemaining);
    const scored = scoreCandidates(state, "accessory", filledAccessorySlots, state.totalAccessorySlots);
    const pick = pickBestDeterministic(scored);
    if (!pick) {
      break;
    }

    addSelectedExercise(state, pick, "accessory", "accessory_pick");
    setTargets[pick.exercise.id] = Math.max(2, Math.round(setTargets[pick.exercise.id] ?? 2));
    if (state.input.sessionMinutes > 0) {
      reduceSetTargetsToFitTimeBudget(state, setTargets);
      if (estimateSelectedMinutes(state, setTargets) > state.input.sessionMinutes) {
        removeLastSelectedById(state, pick.exercise.id, setTargets);
        break;
      }
    }
  }
}

function reduceSetTargetsToFitTimeBudget(
  state: SelectionState,
  setTargets: Record<string, number>
) {
  if (state.input.sessionMinutes <= 0) {
    return;
  }
  let guard = 0;
  while (estimateSelectedMinutes(state, setTargets) > state.input.sessionMinutes && guard < 120) {
    guard += 1;
    const reducible = state.selected
      .map((entry) => ({
        entry,
        sets: Math.max(2, Math.round(setTargets[entry.exercise.id] ?? 2)),
      }))
      .filter((item) => item.sets > 2)
      .sort((a, b) => {
        if (b.sets !== a.sets) {
          return b.sets - a.sets;
        }
        if (a.entry.role !== b.entry.role) {
          return a.entry.role === "main" ? -1 : 1;
        }
        return a.entry.orderIndex - b.entry.orderIndex;
      });
    if (reducible.length === 0) {
      break;
    }
    const target = reducible[0];
    setTargets[target.entry.exercise.id] = target.sets - 1;
  }
}

function estimateSelectedMinutes(
  state: SelectionState,
  setTargets: Record<string, number>
): number {
  const workoutExercises = buildWorkoutExercisesFromSelection(state, setTargets);
  return estimateWorkoutMinutes(workoutExercises);
}

function removeLastSelectedById(
  state: SelectionState,
  exerciseId: string,
  setTargets: Record<string, number>
) {
  const index = state.selected.findIndex((entry) => entry.exercise.id === exerciseId);
  if (index < 0) {
    return;
  }
  state.selected.splice(index, 1);
  delete setTargets[exerciseId];
  state.selectedIds = new Set(state.selected.map((entry) => entry.exercise.id));
  recomputeDerivedStateAfterSelectionPrune(state, setTargets);
}

const LOWER_BODY_COMPOUND_PATTERNS = new Set<MovementPatternV2>([
  "squat",
  "hinge",
  "lunge",
]);
const UPPER_BODY_COMPOUND_PATTERNS = new Set<MovementPatternV2>([
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
]);
type FullBodyMovementCategory = "push" | "pull" | "lower";
const FULL_BODY_CATEGORIES: FullBodyMovementCategory[] = ["push", "pull", "lower"];

function enforceFullBodyCompoundCoverageFloor(
  state: SelectionState,
  slotTarget: SlotTarget,
  coldStartStage: ColdStartStage
) {
  if (state.input.intent !== "full_body" || state.input.mode !== "intent" || coldStartStage < 1) {
    return;
  }

  for (const category of FULL_BODY_CATEGORIES) {
    if (hasFullBodyCategoryCovered(state, category)) {
      continue;
    }
    forcePickMissingCompoundCategory(state, category, slotTarget);
  }
}

function forcePickMissingCompoundCategory(
  state: SelectionState,
  category: FullBodyMovementCategory,
  slotTarget: SlotTarget
) {
  if (state.mainSlotsRemaining <= 0 && state.accessorySlotsRemaining <= 0) {
    return;
  }

  const scoredMain = scoreMissingCategoryCandidates(state, slotTarget, category, "main");
  const mainPick = pickBestDeterministic(scoredMain);
  if (mainPick) {
    addSelectedExercise(state, mainPick, "main", "main_pick");
    return;
  }

  const scoredAccessory = scoreMissingCategoryCandidates(
    state,
    slotTarget,
    category,
    "accessory"
  );
  const accessoryPick = pickBestDeterministic(scoredAccessory);
  if (accessoryPick) {
    addSelectedExercise(state, accessoryPick, "accessory", "accessory_pick");
  }
}

function scoreMissingCategoryCandidates(
  state: SelectionState,
  slotTarget: SlotTarget,
  category: FullBodyMovementCategory,
  phase: SelectionPhase
): ScoredCandidate[] {
  const currentSlotIndex =
    phase === "main"
      ? Math.max(0, slotTarget.targetMainSlots - state.mainSlotsRemaining)
      : Math.max(0, state.totalAccessorySlots - state.accessorySlotsRemaining);
  const totalSlots = phase === "main" ? Math.max(1, slotTarget.targetMainSlots) : state.totalAccessorySlots;
  return scoreCandidates(state, phase, currentSlotIndex, totalSlots).filter((candidate) =>
    isCompoundInFullBodyCategory(candidate.exercise, category)
  );
}

function isCompoundForPatternBucket(
  exercise: Exercise,
  bucket: Set<MovementPatternV2>
): boolean {
  if (!exercise.isCompound) {
    return false;
  }
  return (exercise.movementPatterns ?? []).some((pattern) => bucket.has(pattern));
}

function resolveFullBodyCategory(exercise: Exercise): FullBodyMovementCategory | undefined {
  const patterns = exercise.movementPatterns ?? [];
  if (patterns.some((pattern) => LOWER_BODY_COMPOUND_PATTERNS.has(pattern))) {
    return "lower";
  }
  if (patterns.some((pattern) => pattern === "horizontal_push" || pattern === "vertical_push")) {
    return "push";
  }
  if (patterns.some((pattern) => pattern === "horizontal_pull" || pattern === "vertical_pull")) {
    return "pull";
  }
  return undefined;
}

function isCompoundInFullBodyCategory(
  exercise: Exercise,
  category: FullBodyMovementCategory
): boolean {
  if (!exercise.isCompound) {
    return false;
  }
  if (category === "lower") {
    return isCompoundForPatternBucket(exercise, LOWER_BODY_COMPOUND_PATTERNS);
  }
  if (category === "push") {
    return (exercise.movementPatterns ?? []).some(
      (pattern) => pattern === "horizontal_push" || pattern === "vertical_push"
    );
  }
  return (exercise.movementPatterns ?? []).some(
    (pattern) => pattern === "horizontal_pull" || pattern === "vertical_pull"
  );
}

function hasFullBodyCategoryCovered(
  state: SelectionState,
  category: FullBodyMovementCategory
): boolean {
  return state.selected.some((entry) => isCompoundInFullBodyCategory(entry.exercise, category));
}

function rebalanceFullBodyCategorySets(
  state: SelectionState,
  setTargets: Record<string, number>
) {
  const categorized = state.selected
    .map((entry) => ({
      entry,
      category: resolveFullBodyCategory(entry.exercise),
    }))
    .filter(
      (item): item is { entry: SelectedExercise; category: FullBodyMovementCategory } =>
        Boolean(item.category)
    );
  if (categorized.length === 0) {
    return;
  }

  const categorySets = (): Record<FullBodyMovementCategory, number> => ({
    push: 0,
    pull: 0,
    lower: 0,
  });
  const totals = categorySets();
  for (const item of categorized) {
    totals[item.category] += setTargets[item.entry.exercise.id] ?? 2;
  }

  const maxSets = maxSetsByTrainingAge(state.input.trainingAge);
  let guard = 0;
  while (guard < 60) {
    guard += 1;
    const ordered = [...FULL_BODY_CATEGORIES].sort((a, b) => totals[b] - totals[a]);
    const over = ordered[0];
    const under = ordered[ordered.length - 1];
    const overTotal = totals[over];
    const underTotal = totals[under];
    if (underTotal <= 0 || overTotal <= underTotal * 3) {
      break;
    }

    const donor = categorized
      .filter(
        (item) => item.category === over && (setTargets[item.entry.exercise.id] ?? 2) > 2
      )
      .sort((a, b) => {
        const setsA = setTargets[a.entry.exercise.id] ?? 2;
        const setsB = setTargets[b.entry.exercise.id] ?? 2;
        if (setsB !== setsA) {
          return setsB - setsA;
        }
        return a.entry.orderIndex - b.entry.orderIndex;
      })[0];
    const receiver = categorized
      .filter(
        (item) => item.category === under && (setTargets[item.entry.exercise.id] ?? 2) < maxSets
      )
      .sort((a, b) => {
        const setsA = setTargets[a.entry.exercise.id] ?? 2;
        const setsB = setTargets[b.entry.exercise.id] ?? 2;
        if (setsA !== setsB) {
          return setsA - setsB;
        }
        return a.entry.orderIndex - b.entry.orderIndex;
      })[0];

    if (!donor || !receiver) {
      break;
    }

    setTargets[donor.entry.exercise.id] = (setTargets[donor.entry.exercise.id] ?? 2) - 1;
    setTargets[receiver.entry.exercise.id] = (setTargets[receiver.entry.exercise.id] ?? 2) + 1;
    totals[over] -= 1;
    totals[under] += 1;
  }
}

function shouldDemoteMainLiftForRepRange(
  goals: Goals,
  exerciseRepRange?: { min: number; max: number }
): boolean {
  if (!exerciseRepRange) {
    return false;
  }
  const goalMainRange = getGoalRepRanges(goals.primary).main;
  return !hasRepRangeOverlap(goalMainRange, exerciseRepRange);
}

function hasRepRangeOverlap(
  goalRange: [number, number],
  exerciseRange: { min: number; max: number }
): boolean {
  return exerciseRange.min <= goalRange[1] && exerciseRange.max >= goalRange[0];
}

function resolveExerciseRepRange(exercise: Exercise) {
  return exercise.repRangeMin != null && exercise.repRangeMax != null
    ? { min: exercise.repRangeMin, max: exercise.repRangeMax }
    : undefined;
}

function resolveCanonicalMuscleName(muscle: string): string {
  const normalized = normalizeKey(muscle);
  return LANDMARKS_BY_NORMALIZED_KEY.get(normalized) ?? muscle.trim();
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeCentered(value: number, center: number, range: number): number {
  if (range <= 0) {
    return 0;
  }
  return clamp((value - center) / range, -1, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dedupeExerciseIds(exerciseIds: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const id of exerciseIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push(id);
  }
  return deduped;
}

function roundValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}
