import type { Exercise, MovementPatternV2, SplitTag, WorkoutHistoryEntry } from "./types";
import { createRng } from "./random";

export type AccessorySlotOptions = {
  dayTag: SplitTag;
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

export type VolumeContext = {
  recent: Record<string, number>;
  previous: Record<string, number>;
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
    mainLifts.flatMap((exercise) => exercise.movementPatternsV2 ?? [])
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

function buildSlots(dayTag: SplitTag, maxAccessories: number): SlotType[] {
  const baseSlots: SlotType[] = (() => {
    switch (dayTag) {
      case "push":
        return ["chest_isolation", "side_delt", "triceps_isolation"];
      case "pull":
        return ["rear_delt_or_upper_back", "biceps", "pull_variant"];
      case "legs":
        return ["quad_isolation", "hamstring_isolation", "glute_or_unilateral", "calf"];
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
  mainPatterns: Set<MovementPatternV2>,
  coveredMuscles: Set<string>,
  favoriteSet: Set<string> | undefined,
  recencyIndex: Map<string, number>,
  rng: () => number,
  plannedVolume: Record<string, number>,
  previousVolume: Record<string, number> | undefined,
  accessorySetCount: number
): Exercise | undefined {
  const candidates = remaining.filter((exercise) => matchesSlot(slot, exercise));
  if (candidates.length === 0) {
    return undefined;
  }

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
    const weight =
      Math.max(0.1, score) * recencyMultiplier * noveltyMultiplier * volumeMultiplier;
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
  const patterns = exercise.movementPatternsV2 ?? [];

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
      return hasMuscle("glutes") || patterns.includes("lunge") || exercise.movementPattern === "lunge";
    case "calf":
      return hasMuscle("calves");
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
  const isCompound = exercise.isCompound ?? exercise.isMainLift;
  const patterns = new Set(exercise.movementPatternsV2 ?? []);
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
      score += patterns.has("lunge") || exercise.movementPattern === "lunge" ? 3 : 0;
      score += hasStimulus("stretch") ? 1 : 0;
      break;
    case "calf":
      score += hasMuscle("calves") ? 6 : 0;
      score += !isCompound ? 2 : 0;
      break;
    case "fill":
      score += uncovered.length * 3;
      break;
    default:
      break;
  }

  if (slot !== "pull_variant" && overlap) {
    score -= 1;
  }

  score += favoriteBonus + uncoveredBonus;
  return score;
}

function buildRecencyIndex(history: WorkoutHistoryEntry[]) {
  const sorted = [...history].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const index = new Map<string, number>();
  sorted.forEach((entry, entryIndex) => {
    for (const exercise of entry.exercises) {
      if (!index.has(exercise.exerciseId)) {
        index.set(exercise.exerciseId, entryIndex);
      }
    }
  });
  return index;
}

function getRecencyMultiplier(exerciseId: string, recencyIndex: Map<string, number>) {
  const lastSeen = recencyIndex.get(exerciseId);
  if (lastSeen === undefined) {
    return 1;
  }
  if (lastSeen === 0) {
    return 0.3;
  }
  if (lastSeen === 1) {
    return 0.5;
  }
  if (lastSeen === 2) {
    return 0.7;
  }
  return 1;
}

function getNoveltyMultiplier(exerciseId: string, recencyIndex: Map<string, number>) {
  return recencyIndex.has(exerciseId) ? 1 : 1.5;
}

function weightedPick(
  items: { exercise: Exercise; weight: number }[],
  rng: () => number
): Exercise | undefined {
  if (items.length === 0) {
    return undefined;
  }
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) {
    return items[0].exercise;
  }
  let roll = rng() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) {
      return item.exercise;
    }
  }
  return items[items.length - 1].exercise;
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

function getPrimaryMuscles(exercise: Exercise): string[] {
  if (exercise.primaryMuscles && exercise.primaryMuscles.length > 0) {
    return exercise.primaryMuscles;
  }
  if (exercise.secondaryMuscles && exercise.secondaryMuscles.length > 0) {
    return exercise.secondaryMuscles;
  }
  return [];
}

function normalizeName(name: string) {
  return name.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s()-]/g, "").trim();
}
