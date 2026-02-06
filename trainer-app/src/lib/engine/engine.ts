import { randomUUID } from "crypto";
import {
  DELOAD_THRESHOLDS,
  DELOAD_RPE_CAP,
  getPeriodizationModifiers,
  PLATEAU_CRITERIA,
  type PeriodizationModifiers,
  REP_RANGES_BY_GOAL,
  TARGET_RPE_BY_GOAL,
} from "./rules";
import type {
  Constraints,
  Exercise,
  FatigueState,
  Goals,
  MovementPattern,
  MovementPatternV2,
  ProgressionRule,
  SessionCheckIn,
  SplitTag,
  SplitDay,
  UserPreferences,
  UserProfile,
  WorkoutExercise,
  WorkoutHistoryEntry,
  WorkoutPlan,
  WorkoutSet,
} from "./types";
import { pickAccessoriesBySlot } from "./pick-accessories-by-slot";

export const SPLIT_PATTERNS: Record<string, MovementPattern[][]> = {
  ppl: [
    ["push"],
    ["pull"],
    ["squat", "hinge"],
    ["push"],
    ["pull"],
  ],
  upper_lower: [
    ["push", "pull"],
    ["squat", "hinge"],
    ["push", "pull"],
    ["squat", "hinge"],
  ],
  full_body: [
    ["push", "pull", "squat", "hinge", "rotate"],
    ["push", "pull", "lunge", "hinge", "rotate"],
    ["push", "pull", "squat", "hinge", "carry"],
  ],
  custom: [
    ["push", "pull", "squat", "hinge"],
  ],
};

const REST_SECONDS = {
  main: 150,
  accessory: 75,
  warmup: 45,
};

const BLOCKED_TAGS: SplitTag[] = ["core", "mobility", "prehab", "conditioning"];
const WARMUP_TAGS: SplitTag[] = ["mobility", "prehab"];
const CORE_TAGS: SplitTag[] = ["core"];
const CONDITIONING_TAGS: SplitTag[] = ["conditioning"];

export function generateWorkout(
  profile: UserProfile,
  goals: Goals,
  constraints: Constraints,
  history: WorkoutHistoryEntry[],
  exerciseLibrary: Exercise[],
  progressionRule?: ProgressionRule,
  options?: {
    forcedSplit?: SplitDay;
    advancesSplit?: boolean;
    preferences?: UserPreferences;
    checkIn?: SessionCheckIn;
    randomSeed?: number;
    weekInBlock?: number;
    periodization?: PeriodizationModifiers;
  }
): WorkoutPlan {
  const patternOptions = SPLIT_PATTERNS[constraints.splitType] ?? SPLIT_PATTERNS.full_body;
  const dayIndex = getSplitDayIndex(history, patternOptions.length);
  const targetPatterns = resolveTargetPatterns(
    constraints.splitType,
    dayIndex,
    options?.forcedSplit
  );

  const fatigueState = deriveFatigueState(history, options?.checkIn);
  const periodization =
    options?.periodization ??
    (options?.weekInBlock !== undefined
      ? getPeriodizationModifiers(options.weekInBlock, goals.primary)
      : undefined);
  const volumeContext = buildVolumeContext(history, exerciseLibrary);
  const selected = selectExercises(
    exerciseLibrary,
    constraints,
    targetPatterns,
    fatigueState,
    profile.trainingAge,
    profile.injuries,
    options?.preferences,
    history,
    options?.randomSeed,
    volumeContext
  );

  const mainLifts = selected.mainLifts.map((exercise, index) =>
    buildWorkoutExercise(
      exercise,
      index,
      true,
      profile,
      goals,
      progressionRule,
      fatigueState,
      options?.preferences,
      periodization
    )
  );

  const accessories = selected.accessories.map((exercise, index) =>
    buildWorkoutExercise(
      exercise,
      index,
      false,
      profile,
      goals,
      progressionRule,
      fatigueState,
      options?.preferences,
      periodization
    )
  );

  const warmup = selected.warmup.map((exercise, index) =>
    buildWarmupExercise(exercise, index)
  );
  let finalAccessories = accessories;
  let allExercises = [...warmup, ...mainLifts, ...finalAccessories];
  let estimatedMinutes = estimateWorkoutMinutes(allExercises);
  const budgetMinutes = constraints.sessionMinutes;

  if (budgetMinutes > 0 && estimatedMinutes > budgetMinutes) {
    let trimmedAccessories = [...finalAccessories];
    while (trimmedAccessories.length > 0) {
      trimmedAccessories = trimAccessoriesByPriority(trimmedAccessories, mainLifts, 1);
      allExercises = [...warmup, ...mainLifts, ...trimmedAccessories];
      estimatedMinutes = estimateWorkoutMinutes(allExercises);
      if (estimatedMinutes <= budgetMinutes) {
        break;
      }
    }
    finalAccessories = trimmedAccessories;
  }

  finalAccessories = enforceVolumeCaps(
    finalAccessories,
    mainLifts,
    volumeContext
  );
  allExercises = [...warmup, ...mainLifts, ...finalAccessories];
  estimatedMinutes = estimateWorkoutMinutes(allExercises);

  return {
    id: createId(),
    scheduledDate: new Date().toISOString(),
    warmup,
    mainLifts,
    accessories: finalAccessories,
    estimatedMinutes,
    notes: fatigueState.readinessScore <= 2 ? "Autoregulated for recovery" : undefined,
  };
}

function resolveTargetPatterns(
  splitType: Constraints["splitType"],
  dayIndex: number,
  forcedSplit?: SplitDay
): MovementPattern[] {
  if (forcedSplit) {
    const forced = forcedSplit.toLowerCase();
    if (forced === "push") {
      return ["push"];
    }
    if (forced === "pull") {
      return ["pull"];
    }
    if (forced === "legs") {
      return ["squat", "hinge"];
    }
    if (forced === "upper") {
      return ["push", "pull"];
    }
    if (forced === "lower") {
      return ["squat", "hinge"];
    }
    if (forced === "full_body") {
      return ["push", "pull", "squat", "hinge", "rotate"];
    }
  }

  const patternOptions = SPLIT_PATTERNS[splitType] ?? SPLIT_PATTERNS.full_body;
  return patternOptions[dayIndex % patternOptions.length];
}

function resolveAllowedPatterns(
  splitType: Constraints["splitType"],
  targetPatterns: MovementPattern[]
): MovementPattern[] {
  if (splitType !== "ppl") {
    return targetPatterns;
  }

  if (targetPatterns.includes("push")) {
    return ["push", "push_pull"];
  }
  if (targetPatterns.includes("pull")) {
    return ["pull"];
  }
  if (targetPatterns.includes("squat") || targetPatterns.includes("hinge")) {
    return ["squat", "hinge", "lunge", "carry", "rotate"];
  }
  return targetPatterns;
}

function getSplitDayIndex(history: WorkoutHistoryEntry[], patternLength: number): number {
  const advancingCompleted = history.filter(
    (entry) => entry.advancesSplit !== false && entry.status === "COMPLETED"
  );
  const completedCount = advancingCompleted.length;
  return completedCount % Math.max(1, patternLength);
}

export function selectExercises(
  exerciseLibrary: Exercise[],
  constraints: Constraints,
  targetPatterns: MovementPattern[],
  fatigueState: FatigueState,
  trainingAge: UserProfile["trainingAge"],
  injuries: UserProfile["injuries"] = [],
  preferences?: UserPreferences,
  history: WorkoutHistoryEntry[] = [],
  randomSeed?: number,
  volumeContext?: VolumeContext
) {
  const allowedPatterns = resolveAllowedPatterns(constraints.splitType, targetPatterns);
  const isStrictPpl = constraints.splitType === "ppl";
  const avoidSet = buildNameSet(preferences?.avoidExercises);
  const favoriteSet = buildNameSet(preferences?.favoriteExercises);

  const available = exerciseLibrary.filter((exercise) =>
    exercise.equipment.some((item) => constraints.availableEquipment.includes(item))
  );

  const preferenceFiltered = available.filter(
    (exercise) => !avoidSet.has(normalizeName(exercise.name))
  );

  const hasActiveInjury = injuries.some((injury) => injury.isActive && injury.severity >= 3);
  const injuryFiltered = hasActiveInjury
    ? preferenceFiltered.filter((exercise) => exercise.jointStress !== "high")
    : preferenceFiltered;

  const painFiltered = applyPainConstraints(injuryFiltered, fatigueState.painFlags);

  const fatigueFiltered =
    fatigueState.readinessScore <= 2
      ? painFiltered.filter((exercise) => exercise.jointStress !== "high")
      : painFiltered;

  const pickFavoriteFirst = (items: Exercise[]) =>
    items.sort((a, b) => {
      const aFav = favoriteSet.has(normalizeName(a.name)) ? 1 : 0;
      const bFav = favoriteSet.has(normalizeName(b.name)) ? 1 : 0;
      return bFav - aFav;
    });

  validateSplitTagIntegrity(fatigueFiltered);
  const stalledSet = findStalledExercises(history);

  const mainLifts: Exercise[] = [];
  const accessories: Exercise[] = [];
  const warmup: Exercise[] = [];

  const minMainLifts = 2;
  const minAccessories = 3;
  const maxAccessories = 5;
  const mainLiftSetCount = resolveSetCount(true, trainingAge, fatigueState);
  const accessorySetCount = resolveSetCount(false, trainingAge, fatigueState);

  if (isStrictPpl) {
    const dayTag = resolvePplSplitTag(targetPatterns);
    const splitFiltered = fatigueFiltered.filter((exercise) =>
      exercise.splitTags?.includes(dayTag)
    );

    const blockFiltered = splitFiltered.filter(
      (exercise) => !hasBlockedTag(exercise)
    );

    const mainPoolBase = blockFiltered.filter((exercise) =>
      isMainLiftEligible(exercise)
    );
    const accessoryPoolBase = blockFiltered.filter((exercise) => !isMainLiftEligible(exercise));
    const mainPool = applyStallFilter(mainPoolBase, stalledSet);
    const accessoryPool = applyStallFilter(accessoryPoolBase, stalledSet);

    const dayMain = pickMainLiftsForPpl(
      dayTag,
      mainPool,
      favoriteSet,
      fatigueState.painFlags,
      accessoryPool
    );
    mainLifts.push(...dayMain);

    if (mainLifts.length < minMainLifts) {
      const mainFallback = pickFavoriteFirst(
        mainPool.filter((exercise) => !mainLifts.includes(exercise))
      );
      mainLifts.push(...mainFallback.slice(0, minMainLifts - mainLifts.length));
    }

    const accessoryTargets = pickAccessoriesBySlot({
      dayTag,
      accessoryPool,
      mainLifts,
      favoriteSet,
      maxAccessories,
      history,
      randomSeed,
      volumeContext,
      mainLiftSetCount,
      accessorySetCount,
    });
    accessories.push(...accessoryTargets);

    if (accessories.length < minAccessories) {
      const filler = pickFavoriteFirst(
        accessoryPool.filter(
          (exercise) => !accessories.includes(exercise) && !mainLifts.includes(exercise)
        )
      );
      accessories.push(...filler.slice(0, minAccessories - accessories.length));
    }

    while (accessories.length < maxAccessories) {
      const candidate = pickFavoriteFirst(
        accessoryPool.filter(
          (exercise) => !accessories.includes(exercise) && !mainLifts.includes(exercise)
        )
      )[0];
      if (!candidate) {
        break;
      }
      accessories.push(candidate);
    }

    const warmupPool = fatigueFiltered.filter((exercise) =>
      exercise.splitTags?.some((tag) => WARMUP_TAGS.includes(tag))
    );
    warmup.push(...pickFavoriteFirst(warmupPool).slice(0, 2));

    const includeExtras = preferences?.optionalConditioning ?? true;
    if (includeExtras) {
      const corePool = fatigueFiltered.filter((exercise) =>
        exercise.splitTags?.some((tag) => CORE_TAGS.includes(tag))
      );
      if (corePool[0]) {
        warmup.push(corePool[0]);
      }
    }

    if (includeExtras && dayTag === "legs") {
      const conditioningPool = fatigueFiltered.filter((exercise) =>
        exercise.splitTags?.some((tag) => CONDITIONING_TAGS.includes(tag))
      );
      if (conditioningPool[0]) {
        warmup.push(conditioningPool[0]);
      }
    }
  } else {
    const patternFilteredBase = fatigueFiltered.filter((exercise) =>
      allowedPatterns.includes(exercise.movementPattern)
    );
    const patternFiltered = applyStallFilter(patternFilteredBase, stalledSet);

    const patternMatches = (pattern: MovementPattern) => {
      const matches = patternFiltered.filter((exercise) => exercise.movementPattern === pattern);
      return matches.sort((a, b) => {
        const aFav = favoriteSet.has(normalizeName(a.name)) ? 1 : 0;
        const bFav = favoriteSet.has(normalizeName(b.name)) ? 1 : 0;
        return bFav - aFav;
      });
    };

    for (const pattern of targetPatterns) {
      const matches = patternMatches(pattern);
      const main = matches.find((exercise) => isMainLiftEligible(exercise));
      const accessory = matches.find((exercise) => !isMainLiftEligible(exercise));

      if (main && mainLifts.length < 3) {
        mainLifts.push(main);
      } else if (accessory && accessories.length < 5) {
        accessories.push(accessory);
      }
    }

    if (mainLifts.length < minMainLifts) {
      const candidates = patternFiltered
        .filter((exercise) => isMainLiftEligible(exercise))
        .sort((a, b) => {
          const aFav = favoriteSet.has(normalizeName(a.name)) ? 1 : 0;
          const bFav = favoriteSet.has(normalizeName(b.name)) ? 1 : 0;
          return bFav - aFav;
        });
      mainLifts.push(...candidates.slice(0, minMainLifts - mainLifts.length));
    }

    while (accessories.length < maxAccessories) {
      const candidate = patternFiltered.find(
        (exercise) => !isMainLiftEligible(exercise) && !accessories.includes(exercise)
      );
      if (!candidate) {
        break;
      }
      accessories.push(candidate);
    }

    if (accessories.length < minAccessories) {
      const filler = pickFavoriteFirst(
        patternFiltered.filter(
          (exercise) => !accessories.includes(exercise) && !mainLifts.includes(exercise)
        )
      );
      accessories.push(...filler.slice(0, minAccessories - accessories.length));
    }

    warmup.push(
      ...patternFiltered.filter((exercise) => ["rotate", "carry"].includes(exercise.movementPattern)).slice(0, 2)
    );
  }

  return { mainLifts, accessories, warmup };
}

function isMainLiftEligible(exercise: Exercise) {
  return exercise.isMainLiftEligible ?? exercise.isMainLift;
}

function hasBlockedTag(exercise: Exercise) {
  return (exercise.splitTags ?? []).some((tag) => BLOCKED_TAGS.includes(tag));
}

function resolvePplSplitTag(targetPatterns: MovementPattern[]): SplitTag {
  if (targetPatterns.includes("push")) {
    return "push";
  }
  if (targetPatterns.includes("pull")) {
    return "pull";
  }
  return "legs";
}

function validateSplitTagIntegrity(exercises: Exercise[]) {
  const invalid = exercises.filter(
    (exercise) =>
      exercise.splitTags?.includes("push") && exercise.splitTags?.includes("pull")
  );
  if (invalid.length > 0) {
    const names = invalid.map((exercise) => exercise.name).join(", ");
    throw new Error(`Exercises must not be dual-tagged PUSH/PULL: ${names}`);
  }
}

function applyStallFilter(exercises: Exercise[], stalledSet: Set<string>) {
  if (stalledSet.size === 0) {
    return exercises;
  }
  const filtered = exercises.filter((exercise) => !stalledSet.has(exercise.id));
  return filtered.length > 0 ? filtered : exercises;
}

function findStalledExercises(history: WorkoutHistoryEntry[]) {
  const byExercise: Record<string, { date: number; volume: number }[]> = {};

  for (const entry of history) {
    const entryTime = new Date(entry.date).getTime();
    for (const exercise of entry.exercises) {
      const totalVolume = exercise.sets.reduce((sum, set) => {
        const load = set.load ?? 0;
        return sum + set.reps * (load || 1);
      }, 0);
      if (!byExercise[exercise.exerciseId]) {
        byExercise[exercise.exerciseId] = [];
      }
      byExercise[exercise.exerciseId].push({ date: entryTime, volume: totalVolume });
    }
  }

  const stalled = new Set<string>();
  for (const [exerciseId, entries] of Object.entries(byExercise)) {
    const recent = entries.sort((a, b) => b.date - a.date).slice(0, 3);
    if (recent.length < 3) {
      continue;
    }
    const [latest, mid, oldest] = recent;
    const hasImprovement = latest.volume > mid.volume || mid.volume > oldest.volume;
    if (!hasImprovement) {
      stalled.add(exerciseId);
    }
  }

  return stalled;
}

function applyPainConstraints(exercises: Exercise[], painFlags?: Record<string, 0 | 1 | 2 | 3>) {
  if (!painFlags) {
    return exercises;
  }

  return exercises.filter((exercise) => {
    const contraindications = exercise.contraindications ?? {};
    const elbowPain = painFlags.elbow !== undefined && painFlags.elbow >= 2;
    const shoulderPain = painFlags.shoulder !== undefined && painFlags.shoulder >= 2;
    const lowBackPain = painFlags.low_back !== undefined && painFlags.low_back >= 2;

    if (elbowPain) {
      if (contraindications["elbow"]) {
        return false;
      }
    }

    if (shoulderPain) {
      if (contraindications["shoulder"]) {
        return false;
      }
    }

    if (lowBackPain) {
      if (contraindications["low_back"]) {
        return false;
      }
      if (exercise.movementPatternsV2?.includes("hinge")) {
        return false;
      }
    }

    return true;
  });
}

function pickMainLiftsForPpl(
  dayTag: SplitTag,
  mainPool: Exercise[],
  favoriteSet: Set<string>,
  painFlags?: Record<string, 0 | 1 | 2 | 3>,
  fallbackPool?: Exercise[]
) {
  const pickFavoriteFirst = (items: Exercise[]) =>
    items.sort((a, b) => {
      const aFav = favoriteSet.has(normalizeName(a.name)) ? 1 : 0;
      const bFav = favoriteSet.has(normalizeName(b.name)) ? 1 : 0;
      return bFav - aFav;
    });

  const mainLifts: Exercise[] = [];
  const hasPattern = (exercise: Exercise, pattern: MovementPatternV2) =>
    exercise.movementPatternsV2?.includes(pattern);

  if (dayTag === "push") {
    const horizontal = pickFavoriteFirst(
      mainPool.filter((exercise) => hasPattern(exercise, "horizontal_push"))
    );
    const vertical = pickFavoriteFirst(
      mainPool.filter((exercise) => hasPattern(exercise, "vertical_push"))
    );
    if (horizontal[0]) {
      mainLifts.push(horizontal[0]);
    }
    let verticalPick = vertical.find((exercise) => !mainLifts.includes(exercise));
    if (!verticalPick && fallbackPool) {
      const fallbackVertical = fallbackPool
        .filter((exercise) => hasPattern(exercise, "vertical_push"))
        .sort((a, b) => {
          const fatigueDiff = (b.fatigueCost ?? 0) - (a.fatigueCost ?? 0);
          if (fatigueDiff !== 0) {
            return fatigueDiff;
          }
          const aFav = favoriteSet.has(normalizeName(a.name)) ? 1 : 0;
          const bFav = favoriteSet.has(normalizeName(b.name)) ? 1 : 0;
          return bFav - aFav;
        });
      verticalPick = fallbackVertical.find((exercise) => !mainLifts.includes(exercise));
    }
    if (verticalPick) {
      mainLifts.push(verticalPick);
    }
  } else if (dayTag === "pull") {
    const vertical = pickFavoriteFirst(
      mainPool.filter((exercise) => hasPattern(exercise, "vertical_pull"))
    );
    let horizontal = pickFavoriteFirst(
      mainPool.filter((exercise) => hasPattern(exercise, "horizontal_pull"))
    );
    if (painFlags?.low_back && painFlags.low_back >= 2) {
      horizontal = horizontal.sort((a, b) => {
        const aPref = /chest[- ]?supported/i.test(a.name) ? 1 : 0;
        const bPref = /chest[- ]?supported/i.test(b.name) ? 1 : 0;
        return bPref - aPref;
      });
    }
    if (vertical[0]) {
      mainLifts.push(vertical[0]);
    }
    if (mainLifts.length === 0 && fallbackPool) {
      const fallbackVertical = fallbackPool
        .filter((exercise) => hasPattern(exercise, "vertical_pull"))
        .sort((a, b) => {
          const fatigueDiff = (b.fatigueCost ?? 0) - (a.fatigueCost ?? 0);
          if (fatigueDiff !== 0) {
            return fatigueDiff;
          }
          const aFav = favoriteSet.has(normalizeName(a.name)) ? 1 : 0;
          const bFav = favoriteSet.has(normalizeName(b.name)) ? 1 : 0;
          return bFav - aFav;
        });
      const fallbackPick = fallbackVertical.find((exercise) => !mainLifts.includes(exercise));
      if (fallbackPick) {
        mainLifts.push(fallbackPick);
      }
    }
    const horizontalPick = horizontal.find((exercise) => !mainLifts.includes(exercise));
    if (horizontalPick) {
      mainLifts.push(horizontalPick);
    }
  } else {
    const squat = pickFavoriteFirst(
      mainPool.filter((exercise) => hasPattern(exercise, "squat") || hasPattern(exercise, "lunge"))
    );
    const hinge = pickFavoriteFirst(
      mainPool.filter((exercise) => hasPattern(exercise, "hinge"))
    );
    if (squat[0]) {
      mainLifts.push(squat[0]);
    }
    const hingePick = hinge.find((exercise) => !mainLifts.includes(exercise));
    if (hingePick) {
      mainLifts.push(hingePick);
    }
  }

  return mainLifts;
}

export function prescribeSetsReps(
  isMainLift: boolean,
  trainingAge: UserProfile["trainingAge"],
  goals: Goals,
  fatigueState: FatigueState,
  preferences?: UserPreferences,
  periodization?: PeriodizationModifiers
): WorkoutSet[] {
  if (isMainLift) {
    return prescribeMainLiftSets(trainingAge, goals, fatigueState, preferences, periodization);
  }
  return prescribeAccessorySets(trainingAge, goals, fatigueState, preferences, periodization);
}

function prescribeMainLiftSets(
  trainingAge: UserProfile["trainingAge"],
  goals: Goals,
  fatigueState: FatigueState,
  preferences?: UserPreferences,
  periodization?: PeriodizationModifiers
): WorkoutSet[] {
  const repRange = REP_RANGES_BY_GOAL[goals.primary];
  const setCount = resolveSetCount(
    true,
    trainingAge,
    fatigueState,
    periodization?.setMultiplier
  );
  const topSetReps = repRange.main[0];
  const backOffMultiplier = getBackOffMultiplier(goals.primary);
  const backOffReps =
    backOffMultiplier >= 0.9
      ? repRange.main[0]
      : Math.min(repRange.main[1], repRange.main[0] + 2);
  const targetRpe = resolveTargetRpe(
    topSetReps,
    goals,
    fatigueState,
    preferences,
    periodization
  );

  if (periodization?.isDeload) {
    return Array.from({ length: setCount }, (_, index) => ({
      setIndex: index + 1,
      targetReps: topSetReps,
      targetRpe,
      targetLoad: undefined,
    }));
  }

  return Array.from({ length: setCount }, (_, index) => ({
    setIndex: index + 1,
    targetReps: index === 0 ? topSetReps : backOffReps,
    targetRpe,
    targetLoad: undefined,
  }));
}

function prescribeAccessorySets(
  trainingAge: UserProfile["trainingAge"],
  goals: Goals,
  fatigueState: FatigueState,
  preferences?: UserPreferences,
  periodization?: PeriodizationModifiers
): WorkoutSet[] {
  const repRange = REP_RANGES_BY_GOAL[goals.primary];
  const setCount = resolveSetCount(
    false,
    trainingAge,
    fatigueState,
    periodization?.setMultiplier
  );
  const targetReps = repRange.accessory[0];
  const targetRpe = resolveTargetRpe(
    targetReps,
    goals,
    fatigueState,
    preferences,
    periodization
  );

  return Array.from({ length: setCount }, (_, index) => ({
    setIndex: index + 1,
    targetReps,
    targetRpe,
    targetLoad: undefined,
  }));
}

function resolveSetCount(
  isMainLift: boolean,
  trainingAge: UserProfile["trainingAge"],
  fatigueState: FatigueState,
  setMultiplier = 1
) {
  const baseSets = isMainLift ? 4 : 3;
  const ageModifier = trainingAge === "advanced" ? 1.15 : trainingAge === "beginner" ? 0.85 : 1;
  const baselineSets = Math.max(2, Math.round(baseSets * ageModifier));
  const fatigueAdjusted = fatigueState.readinessScore <= 2 ? Math.max(2, baselineSets - 1) : baselineSets;
  const missedAdjusted = fatigueState.missedLastSession ? Math.max(2, fatigueAdjusted - 1) : fatigueAdjusted;
  return Math.max(2, Math.round(missedAdjusted * setMultiplier));
}

function resolveTargetRpe(
  targetReps: number,
  goals: Goals,
  fatigueState: FatigueState,
  preferences?: UserPreferences,
  periodization?: PeriodizationModifiers
) {
  let targetRpe = TARGET_RPE_BY_GOAL[goals.primary] - (fatigueState.readinessScore <= 2 ? 0.5 : 0);
  const preferredRpe = preferences?.rpeTargets?.find(
    (range) => targetReps >= range.min && targetReps <= range.max
  );
  if (preferredRpe) {
    targetRpe = preferredRpe.targetRpe;
  }
  if (periodization?.rpeOffset) {
    targetRpe += periodization.rpeOffset;
  }
  if (periodization?.isDeload) {
    targetRpe = Math.min(targetRpe, DELOAD_RPE_CAP);
  }
  return targetRpe;
}

export function getBackOffMultiplier(primaryGoal: Goals["primary"]) {
  return primaryGoal === "strength" ? 0.9 : 0.85;
}

export function getRestSeconds(exercise: Exercise, isMainLift: boolean) {
  const fatigueCost = exercise.fatigueCost ?? 3;
  const isCompound = exercise.isCompound ?? exercise.isMainLift;

  if (isMainLift) {
    return fatigueCost >= 4 ? 180 : REST_SECONDS.main;
  }
  if (isCompound) {
    return 120;
  }
  if (fatigueCost >= 3) {
    return 90;
  }
  return 60;
}

export function adjustForFatigue(workout: WorkoutPlan, fatigueState: FatigueState): WorkoutPlan {
  if (fatigueState.readinessScore > 2) {
    return workout;
  }

  const reduceSets = (exercise: WorkoutExercise) => ({
    ...exercise,
    sets: exercise.sets.slice(0, Math.max(2, exercise.sets.length - 1)).map((set) => ({
      ...set,
      targetRpe: set.targetRpe ? Math.max(6, set.targetRpe - 0.5) : set.targetRpe,
    })),
    warmupSets: exercise.warmupSets,
  });

  return {
    ...workout,
    mainLifts: workout.mainLifts.map(reduceSets),
    accessories: workout.accessories.map(reduceSets),
    notes: "Reduced volume for recovery",
  };
}

export function computeNextLoad(
  lastSets: { reps: number; rpe?: number; load?: number }[],
  repRange: [number, number],
  targetRpe: number,
  maxLoadIncreasePct = 0.07
): number | undefined {
  const lastLoad = lastSets.find((set) => set.load !== undefined)?.load;
  if (!lastLoad) {
    return undefined;
  }

  const clampPct = (pct: number) => {
    const abs = Math.min(Math.abs(pct), maxLoadIncreasePct);
    return pct < 0 ? -abs : abs;
  };

  const applyChange = (pct: number) => roundLoad(lastLoad * (1 + clampPct(pct)));

  const earlySets = lastSets.slice(0, 2);
  const rpeHighEarly = earlySets.some((set) => set.rpe !== undefined && set.rpe >= targetRpe + 1);
  if (rpeHighEarly) {
    return applyChange(-0.03);
  }

  const rpeLowAll = lastSets.every((set) => set.rpe !== undefined && set.rpe <= targetRpe - 2);
  if (rpeLowAll) {
    return applyChange(0.03);
  }

  const allAtTop = lastSets.every((set) => set.reps >= repRange[1]);
  const rpeOk = lastSets.every((set) => set.rpe === undefined || set.rpe <= targetRpe);

  if (allAtTop && rpeOk) {
    return applyChange(0.025);
  }

  const anyLow = lastSets.some((set) => set.reps < repRange[0]);
  if (anyLow) {
    return applyChange(-0.03);
  }

  return roundLoad(lastLoad);
}

export function shouldDeload(history: WorkoutHistoryEntry[]): boolean {
  if (history.length < 2) {
    return false;
  }

  const lowReadinessStreak = history
    .slice(-DELOAD_THRESHOLDS.consecutiveLowReadiness)
    .every((entry) => (entry.readinessScore ?? 3) <= DELOAD_THRESHOLDS.lowReadinessScore);

  if (lowReadinessStreak) {
    return true;
  }

  const recent = history.slice(-PLATEAU_CRITERIA.noProgressSessions);
  if (recent.length < PLATEAU_CRITERIA.noProgressSessions) {
    return false;
  }

  const allCompleted = recent.every((entry) => entry.completed);
  if (!allCompleted) {
    return false;
  }

  const totalVolume = recent.map((entry) =>
    entry.exercises.reduce(
      (sum, exercise) => sum + exercise.sets.reduce((setSum, set) => setSum + set.reps, 0),
      0
    )
  );

  const hasImprovement = totalVolume.some((volume, index) => index > 0 && volume > totalVolume[index - 1]);
  return !hasImprovement;
}

function buildWorkoutExercise(
  exercise: Exercise,
  orderIndex: number,
  isMainLift: boolean,
  profile: UserProfile,
  goals: Goals,
  progressionRule: ProgressionRule | undefined,
  fatigueState: FatigueState,
  preferences?: UserPreferences,
  periodization?: PeriodizationModifiers
): WorkoutExercise {
  const restSeconds = getRestSeconds(exercise, isMainLift);
  const sets = prescribeSetsReps(
    isMainLift,
    profile.trainingAge,
    goals,
    fatigueState,
    preferences,
    periodization
  ).map((set) => ({
    ...set,
    targetRpe: progressionRule?.targetRpe ?? set.targetRpe,
    restSeconds,
  }));

  return {
    id: createId(),
    exercise,
    orderIndex,
    isMainLift,
    notes: isMainLift ? "Primary movement" : undefined,
    sets,
  };
}

function buildWarmupExercise(exercise: Exercise, orderIndex: number): WorkoutExercise {
  return {
    id: createId(),
    exercise,
    orderIndex,
    isMainLift: false,
    notes: "Warmup / prep / finisher",
    sets: [
      {
        setIndex: 1,
        targetReps: 10,
        restSeconds: REST_SECONDS.warmup,
      },
    ],
  };
}

export function estimateWorkoutMinutes(exercises: WorkoutExercise[]): number {
  const estimateWorkSeconds = (reps?: number, fallback?: number) => {
    if (reps === undefined || Number.isNaN(reps)) {
      return fallback ?? 30;
    }
    const seconds = reps * 2 + 10;
    return Math.max(20, Math.min(90, seconds));
  };

  const estimateSetSeconds = (
    set: WorkoutSet,
    exercise: WorkoutExercise,
    isWarmupSet: boolean
  ) => {
    const restSeconds =
      set.restSeconds ??
      (isWarmupSet
        ? REST_SECONDS.warmup
        : getRestSeconds(exercise.exercise, exercise.isMainLift));
    const fallbackWork =
      exercise.exercise.timePerSetSec ??
      (exercise.isMainLift ? 60 : 40);
    const workSeconds = estimateWorkSeconds(set.targetReps, fallbackWork);
    const cappedWorkSeconds = isWarmupSet ? Math.min(30, workSeconds) : workSeconds;
    return restSeconds + cappedWorkSeconds;
  };

  const totalSeconds = exercises.reduce((total, exercise) => {
    const workSeconds = exercise.sets.reduce(
      (sum, set) => sum + estimateSetSeconds(set, exercise, false),
      0
    );
    const warmupSeconds = (exercise.warmupSets ?? []).reduce(
      (sum, set) => sum + estimateSetSeconds(set, exercise, true),
      0
    );
    return total + workSeconds + warmupSeconds;
  }, 0);

  return Math.round(totalSeconds / 60);
}

type VolumeContext = {
  recent: Record<string, number>;
  previous: Record<string, number>;
};

function buildVolumeContext(
  history: WorkoutHistoryEntry[],
  exerciseLibrary: Exercise[]
): VolumeContext {
  const byId = new Map(exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  const now = Date.now();
  const windowMs = 7 * 24 * 60 * 60 * 1000;

  const recent: Record<string, number> = {};
  const previous: Record<string, number> = {};

  for (const entry of history) {
    const entryTime = new Date(entry.date).getTime();
    const delta = now - entryTime;
    const target = delta <= windowMs ? recent : delta <= windowMs * 2 ? previous : undefined;
    if (!target) {
      continue;
    }
    for (const exerciseEntry of entry.exercises) {
      const exercise = byId.get(exerciseEntry.exerciseId);
      if (!exercise) {
        continue;
      }
      const muscles = exercise.primaryMuscles ?? [];
      const setsCount = exerciseEntry.sets.length;
      for (const muscle of muscles) {
        target[muscle] = (target[muscle] ?? 0) + setsCount;
      }
    }
  }

  return { recent, previous };
}

function enforceVolumeCaps(
  accessories: WorkoutExercise[],
  mainLifts: WorkoutExercise[],
  volumeContext: VolumeContext
) {
  if (accessories.length === 0) {
    return accessories;
  }

  const buildPlannedVolume = (currentAccessories: WorkoutExercise[]) => {
    const planned: Record<string, number> = { ...volumeContext.recent };
    const addExercise = (exercise: WorkoutExercise) => {
      const muscles = exercise.exercise.primaryMuscles ?? [];
      if (muscles.length === 0) {
        return;
      }
      for (const muscle of muscles) {
        planned[muscle] = (planned[muscle] ?? 0) + exercise.sets.length;
      }
    };
    [...mainLifts, ...currentAccessories].forEach(addExercise);
    return planned;
  };

  const exceedsCap = (planned: Record<string, number>) => {
    return Object.entries(planned).some(([muscle, sets]) => {
      const baseline = volumeContext.previous[muscle];
      if (!baseline || baseline <= 0) {
        return false;
      }
      return sets > baseline * 1.2;
    });
  };

  const adjusted = [...accessories];
  while (adjusted.length > 0) {
    const planned = buildPlannedVolume(adjusted);
    if (!exceedsCap(planned)) {
      break;
    }
    adjusted.pop();
  }

  return adjusted;
}

export function trimAccessoriesByPriority(
  accessories: WorkoutExercise[],
  mainLifts: WorkoutExercise[],
  count: number
) {
  if (accessories.length === 0 || count <= 0) {
    return accessories;
  }
  const trimmed = [...accessories];
  const coveredMuscles = new Set(
    mainLifts.flatMap((exercise) => exercise.exercise.primaryMuscles ?? [])
  );
  const muscleCounts = buildAccessoryMuscleCounts(trimmed);
  const scored = trimmed
    .map((exercise) => ({
      exercise,
      score: scoreAccessoryRetention(exercise, coveredMuscles, muscleCounts),
    }))
    .sort((a, b) => a.score - b.score);

  for (let i = 0; i < count && scored.length > 0; i += 1) {
    const remove = scored.shift();
    if (!remove) {
      break;
    }
    const index = trimmed.findIndex((item) => item.id === remove.exercise.id);
    if (index >= 0) {
      trimmed.splice(index, 1);
    }
  }

  return trimmed;
}

function scoreAccessoryRetention(
  accessory: WorkoutExercise,
  coveredMuscles: Set<string>,
  muscleCounts: Record<string, number>
) {
  const fatigueCost = accessory.exercise.fatigueCost ?? 3;
  const primary = accessory.exercise.primaryMuscles ?? [];
  const uncovered = primary.filter((muscle) => !coveredMuscles.has(muscle));
  const noveltyBonus = uncovered.length * 2;
  const redundancyPenalty = primary.reduce((sum, muscle) => {
    const count = muscleCounts[muscle] ?? 0;
    return sum + Math.max(0, count - 1);
  }, 0);
  return fatigueCost + noveltyBonus - redundancyPenalty;
}

function buildAccessoryMuscleCounts(accessories: WorkoutExercise[]) {
  const counts: Record<string, number> = {};
  for (const accessory of accessories) {
    const primary = accessory.exercise.primaryMuscles ?? [];
    for (const muscle of primary) {
      counts[muscle] = (counts[muscle] ?? 0) + 1;
    }
  }
  return counts;
}

function deriveFatigueState(history: WorkoutHistoryEntry[], checkIn?: SessionCheckIn): FatigueState {
  const last = history[history.length - 1];
  return {
    readinessScore: (checkIn?.readiness ?? last?.readinessScore ?? 3) as 1 | 2 | 3 | 4 | 5,
    sorenessNotes: last?.sorenessNotes,
    missedLastSession: last ? last.status === "SKIPPED" : false,
    painFlags: checkIn?.painFlags ?? last?.painFlags,
  };
}

function createId() {
  return typeof randomUUID === "function" ? randomUUID() : `${Date.now()}-${Math.random()}`;
}

function roundLoad(value: number) {
  return Math.round(value * 2) / 2;
}

function normalizeName(name: string) {
  return name.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s()-]/g, "").trim();
}

function buildNameSet(items?: string[]) {
  if (!items || items.length === 0) {
    return new Set<string>();
  }
  return new Set(items.map((item) => normalizeName(item)));
}

export function suggestSubstitutes(
  target: Exercise,
  exerciseLibrary: Exercise[],
  constraints: Constraints,
  painFlags?: Record<string, 0 | 1 | 2 | 3>
) {
  const allowedEquipment = constraints.availableEquipment;
  const candidates = applyPainConstraints(
    exerciseLibrary.filter((exercise) => exercise.id !== target.id),
    painFlags
  )
    .filter((exercise) =>
      exercise.equipment.some((item) => allowedEquipment.includes(item))
    )
    .filter((exercise) =>
      exercise.splitTags?.some((tag) => target.splitTags?.includes(tag))
    )
    .filter((exercise) => !hasBlockedTag(exercise));

  const scoreCandidate = (exercise: Exercise) => {
    const patternOverlap = (exercise.movementPatternsV2 ?? []).filter((pattern) =>
      target.movementPatternsV2?.includes(pattern)
    ).length;
    const muscleOverlap = (exercise.primaryMuscles ?? []).filter((muscle) =>
      target.primaryMuscles?.includes(muscle)
    ).length;
    const stimulusOverlap = (exercise.stimulusBias ?? []).filter((bias) =>
      target.stimulusBias?.includes(bias)
    ).length;
    const fatigueDelta = Math.max(
      0,
      (target.fatigueCost ?? 3) - (exercise.fatigueCost ?? 3)
    );

    return patternOverlap * 4 + muscleOverlap * 3 + stimulusOverlap * 2 + fatigueDelta;
  };

  return candidates
    .map((exercise) => ({ exercise, score: scoreCandidate(exercise) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.exercise);
}

