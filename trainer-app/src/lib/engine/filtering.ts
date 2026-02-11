import type {
  Constraints,
  Exercise,
  FatigueState,
  Goals,
  MovementPattern,
  MovementPatternV2,
  SplitTag,
  UserPreferences,
  UserProfile,
  WorkoutHistoryEntry,
} from "./types";
import { buildNameSet, normalizeName } from "./utils";
import { createRng } from "./random";
import { resolveAllowedPatterns } from "./split-queue";
import { filterCompletedHistory } from "./history";
import { pickMainLiftsForPpl } from "./main-lift-picker";
import { pickAccessoriesBySlot, type AccessorySlotOptions } from "./pick-accessories-by-slot";
import { resolveSetCount } from "./prescription";
import type { VolumeContext } from "./volume";

const V1_TO_V2_MAP: Record<string, MovementPatternV2[]> = {
  push: ["horizontal_push", "vertical_push"],
  pull: ["horizontal_pull", "vertical_pull"],
  squat: ["squat"],
  hinge: ["hinge"],
  lunge: ["lunge"],
  carry: ["carry"],
  rotate: ["rotation", "anti_rotation"],
  push_pull: ["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull"],
};

function matchesV1Pattern(exercise: Exercise, v1Pattern: string): boolean {
  const v2Patterns = V1_TO_V2_MAP[v1Pattern];
  if (!v2Patterns) {
    return false;
  }
  return (exercise.movementPatterns ?? []).some((p) => v2Patterns.includes(p));
}

const BLOCKED_TAGS: SplitTag[] = ["core", "mobility", "prehab", "conditioning"];
const WARMUP_TAGS: SplitTag[] = ["mobility", "prehab"];
const CORE_TAGS: SplitTag[] = ["core"];
const CONDITIONING_TAGS: SplitTag[] = ["conditioning"];

export function selectExercises(
  exerciseLibrary: Exercise[],
  constraints: Constraints,
  targetPatterns: MovementPattern[],
  fatigueState: FatigueState,
  trainingAge: UserProfile["trainingAge"],
  secondaryGoal: Goals["secondary"] = "none",
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
  const avoidIdSet = new Set(preferences?.avoidExerciseIds ?? []);
  const favoriteIdSet = new Set(preferences?.favoriteExerciseIds ?? []);
  const includeExtras = preferences?.optionalConditioning ?? true;

  for (const exercise of exerciseLibrary) {
    if (avoidIdSet.has(exercise.id)) {
      avoidSet.add(normalizeName(exercise.name));
    }
    if (favoriteIdSet.has(exercise.id)) {
      favoriteSet.add(normalizeName(exercise.name));
    }
  }

  const rng = createRng(randomSeed);

  const available = exerciseLibrary.filter((exercise) =>
    exercise.equipment.some((item) => constraints.availableEquipment.includes(item))
  );

  const preferenceFiltered = available.filter((exercise) => {
    const avoidedByName = avoidSet.has(normalizeName(exercise.name));
    const avoidedById = avoidIdSet.has(exercise.id);
    return !avoidedByName && !avoidedById;
  });

  const hasActiveInjury = injuries.some((injury) => injury.isActive && injury.severity >= 3);
  const injuryFiltered = hasActiveInjury
    ? preferenceFiltered.filter((exercise) => exercise.jointStress !== "high")
    : preferenceFiltered;

  const painFiltered = applyPainConstraints(injuryFiltered, fatigueState.painFlags);

  const fatigueFiltered =
    fatigueState.readinessScore <= 2
      ? painFiltered.filter((exercise) => exercise.jointStress !== "high")
      : painFiltered;

  const preferenceSet = buildSecondaryGoalPreferenceSet(
    fatigueFiltered,
    favoriteSet,
    secondaryGoal
  );

  const pickFavoriteFirst = (items: Exercise[]) =>
    items.sort((a, b) => {
      const aFav =
        preferenceSet.has(normalizeName(a.name)) || favoriteIdSet.has(a.id) ? 1 : 0;
      const bFav =
        preferenceSet.has(normalizeName(b.name)) || favoriteIdSet.has(b.id) ? 1 : 0;
      return bFav - aFav;
    });

  const sanitized = validateSplitTagIntegrity(fatigueFiltered);
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
    const splitFiltered = sanitized.filter((exercise) =>
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
      preferenceSet,
      fatigueState.painFlags,
      accessoryPool,
      history,
      rng
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
      favoriteSet: preferenceSet,
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

    const warmupPool = sanitized.filter((exercise) =>
      exercise.splitTags?.some((tag) => WARMUP_TAGS.includes(tag))
    );
    warmup.push(...pickFavoriteFirst(warmupPool).slice(0, 2));

    if (includeExtras) {
      const corePool = sanitized.filter((exercise) =>
        exercise.splitTags?.some((tag) => CORE_TAGS.includes(tag))
      );
      if (corePool[0]) {
        warmup.push(corePool[0]);
      }
    }

    if (includeExtras && (dayTag === "legs" || secondaryGoal === "conditioning")) {
      const conditioningPool = buildConditioningPool(
        sanitized,
        constraints,
        secondaryGoal
      );
      if (conditioningPool[0]) {
        warmup.push(conditioningPool[0]);
      }
    }
  } else {
    const patternFilteredBase = sanitized.filter((exercise) =>
      allowedPatterns.some((pattern) => matchesV1Pattern(exercise, pattern))
    );
    const patternFiltered = applyStallFilter(patternFilteredBase, stalledSet);

    const patternMatches = (pattern: MovementPattern) => {
      const matches = patternFiltered.filter((exercise) => matchesV1Pattern(exercise, pattern));
      return matches.sort((a, b) => {
        const aFav =
          preferenceSet.has(normalizeName(a.name)) || favoriteIdSet.has(a.id) ? 1 : 0;
        const bFav =
          preferenceSet.has(normalizeName(b.name)) || favoriteIdSet.has(b.id) ? 1 : 0;
        return bFav - aFav;
      });
    };

    for (const pattern of targetPatterns) {
      const matches = patternMatches(pattern);
      const main = matches.find((exercise) => isMainLiftEligible(exercise));

      if (main && mainLifts.length < 3) {
        mainLifts.push(main);
      }
    }

    if (mainLifts.length < minMainLifts) {
      const candidates = patternFiltered
        .filter((exercise) => isMainLiftEligible(exercise))
        .sort((a, b) => {
          const aFav =
            preferenceSet.has(normalizeName(a.name)) || favoriteIdSet.has(a.id) ? 1 : 0;
          const bFav =
            preferenceSet.has(normalizeName(b.name)) || favoriteIdSet.has(b.id) ? 1 : 0;
          return bFav - aFav;
        });
      mainLifts.push(...candidates.slice(0, minMainLifts - mainLifts.length));
    }

    const nonPplDayTag = resolveNonPplDayTag(constraints.splitType, targetPatterns);
    const accessoryPool = patternFiltered.filter(
      (exercise) => !isMainLiftEligible(exercise) && !mainLifts.includes(exercise)
    );
    const accessoryTargets = pickAccessoriesBySlot({
      dayTag: nonPplDayTag,
      accessoryPool,
      mainLifts,
      favoriteSet: preferenceSet,
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
          (exercise) => !accessories.includes(exercise)
        )
      );
      accessories.push(...filler.slice(0, minAccessories - accessories.length));
    }

    warmup.push(
      ...patternFiltered.filter((exercise) =>
        (exercise.movementPatterns ?? []).some((p) =>
          (["rotation", "anti_rotation", "carry"] as MovementPatternV2[]).includes(p)
        )
      ).slice(0, 2)
    );

    if (includeExtras && secondaryGoal === "conditioning") {
      const conditioningPool = buildConditioningPool(
        sanitized,
        constraints,
        secondaryGoal
      );
      if (conditioningPool[0] && !warmup.includes(conditioningPool[0])) {
        warmup.push(conditioningPool[0]);
      }
    }
  }

  return { mainLifts, accessories, warmup };
}

function buildSecondaryGoalPreferenceSet(
  exercises: Exercise[],
  favoriteSet: Set<string>,
  secondaryGoal: Goals["secondary"]
) {
  const biasedSet = new Set(favoriteSet);

  if (secondaryGoal === "conditioning") {
    for (const exercise of exercises) {
      if (exercise.splitTags?.some((tag) => CONDITIONING_TAGS.includes(tag))) {
        biasedSet.add(normalizeName(exercise.name));
      }
    }
  }

  if (secondaryGoal === "strength") {
    for (const exercise of exercises) {
      if ((exercise.isMainLiftEligible ?? false) && (exercise.isCompound ?? false)) {
        biasedSet.add(normalizeName(exercise.name));
      }
    }
  }

  return biasedSet;
}

function buildConditioningPool(
  exercises: Exercise[],
  constraints: Constraints,
  secondaryGoal: Goals["secondary"]
) {
  const conditioningPool = exercises.filter((exercise) =>
    exercise.splitTags?.some((tag) => CONDITIONING_TAGS.includes(tag))
  );

  if (secondaryGoal !== "conditioning") {
    return conditioningPool;
  }

  const carryVariants = exercises.filter((exercise) => {
    const hasCarryPattern = exercise.movementPatterns?.includes("carry");
    const isCarryVariant = /farmer|suitcase/i.test(exercise.name);
    const hasAvailableEquipment = exercise.equipment.some((item) =>
      constraints.availableEquipment.includes(item)
    );
    return hasCarryPattern && isCarryVariant && hasAvailableEquipment;
  });

  if (carryVariants.length === 0) {
    return conditioningPool;
  }

  const carry = carryVariants[0];
  if (conditioningPool.some((exercise) => exercise.id === carry.id)) {
    return conditioningPool;
  }

  return [carry, ...conditioningPool];
}

export function isMainLiftEligible(exercise: Exercise) {
  return exercise.isMainLiftEligible ?? false;
}

export function hasBlockedTag(exercise: Exercise) {
  return (exercise.splitTags ?? []).some((tag) => BLOCKED_TAGS.includes(tag));
}

export function resolvePplSplitTag(targetPatterns: MovementPattern[]): SplitTag {
  if (targetPatterns.includes("push")) {
    return "push";
  }
  if (targetPatterns.includes("pull")) {
    return "pull";
  }
  return "legs";
}

export function validateSplitTagIntegrity(exercises: Exercise[]): Exercise[] {
  return exercises.filter((exercise) => {
    const isDualTagged =
      exercise.splitTags?.includes("push") && exercise.splitTags?.includes("pull");
    if (isDualTagged) {
      console.warn(
        `[engine] Filtering dual-tagged PUSH/PULL exercise from pool: ${exercise.name}`
      );
      return false;
    }
    return true;
  });
}

export function applyStallFilter(exercises: Exercise[], stalledSet: Set<string>) {
  if (stalledSet.size === 0) {
    return exercises;
  }
  const filtered = exercises.filter((exercise) => !stalledSet.has(exercise.id));
  return filtered.length > 0 ? filtered : exercises;
}

export function findStalledExercises(history: WorkoutHistoryEntry[]) {
  const byExercise: Record<string, { date: number; volume: number }[]> = {};

  for (const entry of filterCompletedHistory(history)) {
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

export function resolveNonPplDayTag(
  splitType: Constraints["splitType"],
  targetPatterns: MovementPattern[]
): AccessorySlotOptions["dayTag"] {
  if (splitType === "upper_lower") {
    return targetPatterns.includes("push") || targetPatterns.includes("pull")
      ? "upper"
      : "lower";
  }
  return "full_body";
}

export function applyPainConstraints(exercises: Exercise[], painFlags?: Record<string, 0 | 1 | 2 | 3>) {
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
      if (exercise.movementPatterns?.includes("hinge")) {
        return false;
      }
    }

    return true;
  });
}
