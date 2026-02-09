import type { Exercise, MovementPatternV2, SplitTag, WorkoutHistoryEntry } from "./types";
import { createRng } from "./random";
import {
  buildRecencyIndex,
  getNoveltyMultiplier,
  getPrimaryMuscles,
  getRecencyMultiplier,
  normalizeName,
  weightedPick,
} from "./utils";
import type { VolumeContext } from "./volume";

export type AccessorySlotOptions = {
  dayTag: SplitTag | "upper" | "lower" | "full_body";
  accessoryPool: Exercise[];
  mainLifts: Exercise[];
  favoriteSet?: Set<string>;
  maxAccessories: number;
  history?: WorkoutHistoryEntry[];
  randomSeed?: number;
  volumeContext?: VolumeContext;
  mainLiftSetCount?: number;
  accessorySetCount?: number;
};

type SlotType =
  | "chest_isolation"
  | "side_delt"
  | "triceps_isolation"
  | "rear_delt_or_upper_back"
  | "biceps"
  | "pull_variant"
  | "quad_isolation"
  | "hamstring_isolation"
  | "glute_or_unilateral"
  | "calf"
  | "back_compound"
  | "fill";

export function pickAccessoriesBySlot(options: AccessorySlotOptions): Exercise[] {
  const {
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
  } = options;
  const remaining = [...accessoryPool];
  const selected: Exercise[] = [];
  const mainPatterns = new Set(
    mainLifts.flatMap((exercise) => exercise.movementPatterns ?? [])
  );
  const coveredMuscles = new Set(
    mainLifts.flatMap((exercise) => getPrimaryMuscles(exercise))
  );
  const plannedVolume = buildPlannedVolume(
    volumeContext,
    mainLifts,
    mainLiftSetCount ?? 4
  );
  const recencyIndex = buildRecencyIndex(history ?? []);
  const rng = createRng(randomSeed);
  const accessorySets = accessorySetCount ?? 3;

  const slots = buildSlots(dayTag, maxAccessories);

  for (const slot of slots) {
    if (remaining.length === 0) {
      break;
    }

    const pick = pickForSlot(
      slot,
      remaining,
      mainLifts,
      mainPatterns,
      coveredMuscles,
      favoriteSet,
      recencyIndex,
      rng,
      plannedVolume,
      volumeContext?.previous,
      accessorySets
    );
    if (!pick) {
      continue;
    }

    selected.push(pick);
    const pickMuscles = getPrimaryMuscles(pick);
    for (const muscle of pickMuscles) {
      coveredMuscles.add(muscle);
    }
    applyExerciseToVolume(plannedVolume, pickMuscles, accessorySets);
    const index = remaining.findIndex((exercise) => exercise.id === pick.id);
    if (index >= 0) {
      remaining.splice(index, 1);
    }
  }

  return selected;
}

function buildSlots(
  dayTag: SplitTag | "upper" | "lower" | "full_body",
  maxAccessories: number
): SlotType[] {
  const baseSlots: SlotType[] = (() => {
    switch (dayTag) {
      case "push":
        return ["chest_isolation", "side_delt", "triceps_isolation"];
      case "pull":
        return ["rear_delt_or_upper_back", "biceps", "pull_variant"];
      case "legs":
        return ["quad_isolation", "hamstring_isolation", "glute_or_unilateral", "calf"];
      case "upper":
        return ["chest_isolation", "side_delt", "back_compound", "biceps", "triceps_isolation"];
      case "lower":
        return ["quad_isolation", "hamstring_isolation", "glute_or_unilateral", "calf"];
      case "full_body":
        return ["chest_isolation", "back_compound", "quad_isolation", "hamstring_isolation"];
      default:
        return [];
    }
  })();

  const slots = baseSlots.slice(0, Math.max(0, maxAccessories));
  while (slots.length < maxAccessories) {
    slots.push("fill");
  }
  return slots;
}

function pickForSlot(
  slot: SlotType,
  remaining: Exercise[],
  mainLifts: Exercise[],
  mainPatterns: Set<MovementPatternV2>,
  coveredMuscles: Set<string>,
  favoriteSet: Set<string> | undefined,
  recencyIndex: Map<string, number>,
  rng: () => number,
  plannedVolume: Record<string, number>,
  previousVolume: Record<string, number> | undefined,
  accessorySetCount: number
): Exercise | undefined {
  let candidates = remaining.filter((exercise) => matchesSlot(slot, exercise));
  if ((slot === "quad_isolation" || slot === "hamstring_isolation") && candidates.length > 0) {
    const isolationOnly = candidates.filter((exercise) => !exercise.isCompound);
    if (isolationOnly.length > 0) {
      candidates = isolationOnly;
    }
  }
  if (candidates.length === 0) {
    return undefined;
  }

  const mainSecondaryMuscles = new Set(
    mainLifts.flatMap((e) => (e.secondaryMuscles ?? []).map((m) => m.toLowerCase()))
  );

  const scored = candidates.map((exercise) => {
    const score = scoreSlot(slot, exercise, mainPatterns, coveredMuscles, favoriteSet);
    const recencyMultiplier = getRecencyMultiplier(exercise.id, recencyIndex);
    const noveltyMultiplier = getNoveltyMultiplier(exercise.id, recencyIndex);
    const volumeMultiplier = getVolumeMultiplier(
      exercise,
      plannedVolume,
      previousVolume,
      accessorySetCount
    );
    // Indirect volume penalty: if exercise's primary muscles overlap with main lifts' secondary
    const primaryMuscles = getPrimaryMuscles(exercise).map((m) => m.toLowerCase());
    const indirectOverlap = primaryMuscles.some((m) => mainSecondaryMuscles.has(m));
    const indirectPenalty = indirectOverlap ? 0.7 : 1;
    const weight =
      Math.max(0.1, score) * recencyMultiplier * noveltyMultiplier * volumeMultiplier * indirectPenalty;
    return { exercise, score, weight };
  });

  const ordered = scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.exercise.name.localeCompare(b.exercise.name);
  });

  return weightedPick(ordered, rng);
}

function matchesSlot(slot: SlotType, exercise: Exercise): boolean {
  if (slot === "fill") {
    return true;
  }
  const muscles = getPrimaryMuscles(exercise).map((item) => item.toLowerCase());
  const hasMuscle = (name: string) => muscles.includes(name.toLowerCase());
  const patterns = exercise.movementPatterns ?? [];

  switch (slot) {
    case "chest_isolation":
      return hasMuscle("chest");
    case "side_delt":
      return hasMuscle("side delts");
    case "triceps_isolation":
      return hasMuscle("triceps");
    case "rear_delt_or_upper_back":
      return hasMuscle("rear delts") || hasMuscle("upper back");
    case "biceps":
      return hasMuscle("biceps");
    case "pull_variant":
      return (
        (patterns.includes("vertical_pull") || patterns.includes("horizontal_pull")) &&
        (hasMuscle("back") || hasMuscle("upper back") || hasMuscle("rear delts"))
      );
    case "quad_isolation":
      return hasMuscle("quads");
    case "hamstring_isolation":
      return hasMuscle("hamstrings");
    case "glute_or_unilateral":
      return hasMuscle("glutes") || patterns.includes("lunge") || exercise.movementPatterns?.includes("lunge");
    case "calf":
      return hasMuscle("calves");
    case "back_compound":
      return (
        (patterns.includes("vertical_pull") || patterns.includes("horizontal_pull")) &&
        (hasMuscle("back") || hasMuscle("upper back"))
      );
    default:
      return true;
  }
}

function scoreSlot(
  slot: SlotType,
  exercise: Exercise,
  mainPatterns: Set<MovementPatternV2>,
  coveredMuscles: Set<string>,
  favoriteSet?: Set<string>
): number {
  const muscles = getPrimaryMuscles(exercise);
  const muscleSet = new Set(muscles.map((item) => item.toLowerCase()));
  const hasMuscle = (name: string) => muscleSet.has(name.toLowerCase());
  const stimulus = (exercise.stimulusBias ?? []).map((item) => item.toLowerCase());
  const hasStimulus = (name: string) => stimulus.includes(name.toLowerCase());
  const isCompound = exercise.isCompound ?? false;
  const patterns = new Set(exercise.movementPatterns ?? []);
  const overlap = [...patterns].some((pattern) => mainPatterns.has(pattern));
  const favoriteBonus = favoriteSet?.has(normalizeName(exercise.name)) ? 3 : 0;
  const uncovered = muscles.filter((muscle) => !coveredMuscles.has(muscle));
  const uncoveredBonus = uncovered.length;

  let score = 0;
  switch (slot) {
    case "chest_isolation":
      score += hasMuscle("chest") ? 6 : 0;
      score += !isCompound ? 2 : 0;
      score += hasStimulus("stretch") || hasStimulus("metabolic") ? 2 : 0;
      break;
    case "side_delt":
      score += hasMuscle("side delts") ? 6 : 0;
      score += !isCompound ? 2 : 0;
      score += hasStimulus("metabolic") ? 1 : 0;
      break;
    case "triceps_isolation":
      score += hasMuscle("triceps") ? 6 : 0;
      score += !isCompound ? 2 : 0;
      score += hasStimulus("metabolic") ? 1 : 0;
      break;
    case "rear_delt_or_upper_back":
      score += hasMuscle("rear delts") ? 6 : 0;
      score += hasMuscle("upper back") ? 4 : 0;
      score += hasMuscle("back") ? 2 : 0;
      score += hasStimulus("metabolic") ? 1 : 0;
      break;
    case "biceps":
      score += hasMuscle("biceps") ? 6 : 0;
      score += !isCompound ? 2 : 0;
      break;
    case "pull_variant": {
      const hasPullPattern = patterns.has("vertical_pull") || patterns.has("horizontal_pull");
      if (hasPullPattern) {
        score += 4;
      }
      score += [...patterns].some((pattern) => !mainPatterns.has(pattern)) ? 4 : -1;
      score += hasMuscle("back") || hasMuscle("upper back") ? 2 : 0;
      break;
    }
    case "quad_isolation":
      score += hasMuscle("quads") ? 6 : 0;
      score += !isCompound ? 2 : 0;
      break;
    case "hamstring_isolation":
      score += hasMuscle("hamstrings") ? 6 : 0;
      score += !isCompound ? 2 : 0;
      break;
    case "glute_or_unilateral":
      score += hasMuscle("glutes") ? 6 : 0;
      score += patterns.has("lunge") || exercise.movementPatterns?.includes("lunge") ? 3 : 0;
      score += hasStimulus("stretch") ? 1 : 0;
      break;
    case "calf":
      score += hasMuscle("calves") ? 6 : 0;
      score += !isCompound ? 2 : 0;
      break;
    case "back_compound": {
      const hasPullPattern = patterns.has("vertical_pull") || patterns.has("horizontal_pull");
      score += hasPullPattern ? 4 : 0;
      score += hasMuscle("back") || hasMuscle("upper back") ? 6 : 0;
      score += isCompound ? 2 : 0;
      break;
    }
    case "fill":
      score += uncovered.length * 3;
      break;
    default:
      break;
  }

  if (slot !== "pull_variant" && overlap) {
    score -= 1;
  }

  // SFR bonus: higher SFR exercises are preferred for accessories
  score += (exercise.sfrScore ?? 3) * 0.5;

  // Lengthened-position bonus: exercises loading muscles at long lengths
  score += (exercise.lengthPositionScore ?? 3) * 0.3;

  score += favoriteBonus + uncoveredBonus;
  return score;
}

function buildPlannedVolume(
  volumeContext: VolumeContext | undefined,
  mainLifts: Exercise[],
  mainLiftSetCount: number
) {
  const planned: Record<string, number> = {
    ...(volumeContext?.recent ?? {}),
  };
  for (const exercise of mainLifts) {
    applyExerciseToVolume(planned, getPrimaryMuscles(exercise), mainLiftSetCount);
  }
  return planned;
}

function applyExerciseToVolume(
  planned: Record<string, number>,
  muscles: string[],
  sets: number
) {
  if (muscles.length === 0 || sets <= 0) {
    return;
  }
  for (const muscle of muscles) {
    planned[muscle] = (planned[muscle] ?? 0) + sets;
  }
}

function getVolumeMultiplier(
  exercise: Exercise,
  plannedVolume: Record<string, number>,
  previousVolume: Record<string, number> | undefined,
  accessorySetCount: number
) {
  if (!previousVolume) {
    return 1;
  }
  const muscles = getPrimaryMuscles(exercise);
  if (muscles.length === 0) {
    return 1;
  }
  const exceeds = muscles.some((muscle) => {
    const baseline = previousVolume[muscle];
    if (!baseline || baseline <= 0) {
      return false;
    }
    const current = plannedVolume[muscle] ?? 0;
    return current + accessorySetCount > baseline * 1.2;
  });
  return exceeds ? 0.2 : 1;
}
