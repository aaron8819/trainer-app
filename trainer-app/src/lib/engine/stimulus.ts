import type { Exercise, Muscle, MuscleId, StimulusProfile } from "./types";

type StimulusBearingExercise = Pick<
  Exercise,
  "id" | "name" | "primaryMuscles" | "secondaryMuscles" | "stimulusProfile"
> & {
  aliases?: string[];
};

export type StimulusFallbackExercise = {
  id: string;
  name: string;
};

const MAX_STIMULUS_WEIGHT = 1.2;
const FALLBACK_STIMULUS_LOG_PREFIX = "[stimulus-profile:fallback]";

export const MUSCLE_ID_TO_LABEL: Record<MuscleId, Muscle> = {
  chest: "Chest",
  front_delts: "Front Delts",
  side_delts: "Side Delts",
  rear_delts: "Rear Delts",
  triceps: "Triceps",
  biceps: "Biceps",
  lats: "Lats",
  upper_back: "Upper Back",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  core: "Core",
  lower_back: "Lower Back",
  forearms: "Forearms",
  adductors: "Adductors",
  abductors: "Abductors",
  abs: "Abs",
};

export const MUSCLE_LABEL_TO_ID: Record<Muscle, MuscleId> = Object.fromEntries(
  Object.entries(MUSCLE_ID_TO_LABEL).map(([id, label]) => [label, id as MuscleId])
) as Record<Muscle, MuscleId>;

const loggedFallbackExerciseKeys = new Set<string>();

function normalizeNameKey(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildStimulusProfile(entries: Array<[MuscleId, number]>): StimulusProfile {
  return Object.fromEntries(entries) as StimulusProfile;
}

// Phase 1 seed table for initial accounting review. Anything not listed here falls back
// through the centralized temporary mapper below.
export const INITIAL_STIMULUS_PROFILE_BY_NAME: Record<string, StimulusProfile> = (() => {
  const registry: Record<string, StimulusProfile> = {};
  const register = (names: string[], profile: StimulusProfile) => {
    for (const name of names) {
      registry[normalizeNameKey(name)] = profile;
    }
  };

  const flatPress = buildStimulusProfile([
    ["chest", 1.0],
    ["triceps", 0.45],
    ["front_delts", 0.3],
  ]);
  const inclinePress = buildStimulusProfile([
    ["chest", 1.0],
    ["triceps", 0.4],
    ["front_delts", 0.45],
  ]);
  const declinePress = buildStimulusProfile([
    ["chest", 1.0],
    ["triceps", 0.3],
    ["front_delts", 0.25],
  ]);
  const chestDip = buildStimulusProfile([
    ["chest", 1.0],
    ["triceps", 0.5],
    ["front_delts", 0.25],
  ]);
  const tricepsDip = buildStimulusProfile([
    ["triceps", 1.0],
    ["chest", 0.4],
    ["front_delts", 0.25],
  ]);
  const pushUpPress = buildStimulusProfile([
    ["chest", 1.0],
    ["triceps", 0.3],
    ["front_delts", 0.3],
  ]);
  const closeGripPress = buildStimulusProfile([
    ["triceps", 1.0],
    ["chest", 0.35],
    ["front_delts", 0.25],
  ]);
  const fly = buildStimulusProfile([["chest", 1.0]]);
  const lowToHighFly = buildStimulusProfile([
    ["chest", 1.0],
    ["front_delts", 0.15],
  ]);
  const verticalPress = buildStimulusProfile([
    ["side_delts", 1.0],
    ["front_delts", 0.7],
    ["triceps", 0.5],
  ]);
  const arnoldPress = buildStimulusProfile([
    ["side_delts", 1.0],
    ["front_delts", 0.75],
    ["triceps", 0.35],
  ]);
  const landminePress = buildStimulusProfile([
    ["front_delts", 1.0],
    ["chest", 0.35],
    ["triceps", 0.35],
  ]);
  const lateralRaise = buildStimulusProfile([["side_delts", 1.0]]);
  const frontRaise = buildStimulusProfile([["front_delts", 1.0]]);
  const rearDeltFly = buildStimulusProfile([
    ["rear_delts", 1.0],
    ["upper_back", 0.2],
  ]);
  const facePull = buildStimulusProfile([
    ["rear_delts", 1.0],
    ["upper_back", 0.45],
  ]);
  const tricepsIsolation = buildStimulusProfile([["triceps", 1.0]]);
  const chestSupportedRow = buildStimulusProfile([
    ["upper_back", 1.0],
    ["lats", 0.75],
    ["biceps", 0.35],
    ["rear_delts", 0.2],
  ]);
  const horizontalRow = buildStimulusProfile([
    ["upper_back", 1.0],
    ["lats", 0.8],
    ["biceps", 0.4],
    ["rear_delts", 0.25],
    ["lower_back", 0.2],
  ]);
  const supportedHorizontalRow = buildStimulusProfile([
    ["upper_back", 1.0],
    ["lats", 0.8],
    ["biceps", 0.4],
    ["rear_delts", 0.25],
  ]);
  const verticalPull = buildStimulusProfile([
    ["lats", 1.0],
    ["biceps", 0.45],
    ["upper_back", 0.35],
  ]);
  const pullover = buildStimulusProfile([
    ["lats", 1.0],
    ["upper_back", 0.2],
  ]);
  const shrug = buildStimulusProfile([
    ["upper_back", 1.0],
    ["forearms", 0.25],
  ]);
  const deadHang = buildStimulusProfile([
    ["lats", 0.35],
    ["forearms", 0.8],
    ["upper_back", 0.15],
  ]);
  const bicepsCurl = buildStimulusProfile([
    ["biceps", 1.0],
    ["forearms", 0.25],
  ]);
  const hammerCurl = buildStimulusProfile([
    ["biceps", 0.8],
    ["forearms", 0.45],
  ]);
  const reverseCurl = buildStimulusProfile([
    ["forearms", 1.0],
    ["biceps", 0.25],
  ]);
  const wristCurl = buildStimulusProfile([["forearms", 1.0]]);
  const squat = buildStimulusProfile([
    ["quads", 1.0],
    ["glutes", 0.5],
    ["adductors", 0.25],
    ["core", 0.2],
  ]);
  const frontSquat = buildStimulusProfile([
    ["quads", 1.0],
    ["glutes", 0.35],
    ["core", 0.25],
  ]);
  const hackSquat = buildStimulusProfile([
    ["quads", 1.0],
    ["glutes", 0.4],
    ["adductors", 0.15],
  ]);
  const legPress = buildStimulusProfile([
    ["quads", 1.0],
    ["glutes", 0.45],
    ["adductors", 0.2],
  ]);
  const beltSquat = buildStimulusProfile([
    ["quads", 1.0],
    ["glutes", 0.35],
    ["adductors", 0.2],
  ]);
  const splitSquat = buildStimulusProfile([
    ["quads", 1.0],
    ["glutes", 0.55],
    ["adductors", 0.25],
  ]);
  const lunge = buildStimulusProfile([
    ["quads", 0.9],
    ["glutes", 0.8],
    ["hamstrings", 0.15],
    ["adductors", 0.25],
  ]);
  const hipThrust = buildStimulusProfile([
    ["glutes", 1.0],
    ["hamstrings", 0.2],
  ]);
  const gluteBridge = buildStimulusProfile([
    ["glutes", 1.0],
    ["hamstrings", 0.25],
  ]);
  const hinge = buildStimulusProfile([
    ["hamstrings", 1.0],
    ["glutes", 0.75],
    ["lower_back", 0.45],
  ]);
  const axialHinge = buildStimulusProfile([
    ["hamstrings", 0.85],
    ["glutes", 0.7],
    ["lower_back", 0.7],
    ["upper_back", 0.25],
  ]);
  const conventionalDeadlift = buildStimulusProfile([
    ["glutes", 0.85],
    ["hamstrings", 0.65],
    ["lower_back", 0.85],
    ["upper_back", 0.4],
    ["quads", 0.35],
  ]);
  const sumoDeadlift = buildStimulusProfile([
    ["glutes", 0.85],
    ["hamstrings", 0.5],
    ["lower_back", 0.7],
    ["upper_back", 0.35],
    ["quads", 0.45],
    ["adductors", 0.35],
  ]);
  const trapBarDeadlift = buildStimulusProfile([
    ["glutes", 0.75],
    ["hamstrings", 0.45],
    ["lower_back", 0.65],
    ["upper_back", 0.3],
    ["quads", 0.6],
  ]);
  const legCurl = buildStimulusProfile([["hamstrings", 1.0]]);
  const legExtension = buildStimulusProfile([["quads", 1.0]]);
  const calfRaise = buildStimulusProfile([["calves", 1.0]]);
  const hipAbduction = buildStimulusProfile([
    ["abductors", 1.0],
    ["glutes", 0.3],
  ]);
  const hipAdduction = buildStimulusProfile([["adductors", 1.0]]);
  const backExtension = buildStimulusProfile([
    ["lower_back", 0.9],
    ["glutes", 0.65],
    ["hamstrings", 0.45],
  ]);
  const plank = buildStimulusProfile([
    ["core", 1.0],
    ["abs", 0.8],
  ]);
  const coreOnly = buildStimulusProfile([["core", 1.0]]);
  const sidePlank = buildStimulusProfile([
    ["core", 1.0],
    ["abductors", 0.25],
  ]);
  const copenhagenPlank = buildStimulusProfile([
    ["adductors", 1.0],
    ["core", 0.4],
  ]);
  const hangingRaise = buildStimulusProfile([
    ["core", 1.0],
    ["forearms", 0.2],
  ]);
  const suitcaseCarry = buildStimulusProfile([
    ["core", 1.0],
    ["forearms", 0.6],
    ["upper_back", 0.25],
  ]);
  const overheadCarry = buildStimulusProfile([
    ["core", 0.8],
    ["front_delts", 0.35],
    ["upper_back", 0.25],
  ]);
  const farmersCarry = buildStimulusProfile([
    ["forearms", 1.0],
    ["core", 0.6],
    ["upper_back", 0.35],
  ]);
  const sledPush = buildStimulusProfile([
    ["quads", 0.8],
    ["glutes", 0.6],
    ["calves", 0.25],
    ["core", 0.2],
  ]);
  const sledPull = buildStimulusProfile([
    ["hamstrings", 0.75],
    ["glutes", 0.65],
    ["upper_back", 0.25],
    ["core", 0.2],
  ]);
  const sledDrag = buildStimulusProfile([
    ["hamstrings", 0.75],
    ["glutes", 0.65],
    ["calves", 0.25],
    ["core", 0.2],
  ]);

  register(
    [
      "Bench Press",
      "Barbell Bench Press",
      "Dumbbell Bench Press",
      "Machine Chest Press",
      "Deficit Push-Up",
      "Push-Up",
    ],
    flatPress
  );
  register(["Incline Barbell Bench Press", "Incline Dumbbell Bench Press", "Incline Machine Press"], inclinePress);
  register(["Decline Barbell Bench Press", "Decline Dumbbell Bench Press"], declinePress);
  register(["Dip (Chest Emphasis)"], chestDip);
  register(["Dip (Triceps Emphasis)", "Diamond Push-Up"], tricepsDip);
  register(["Push-Up", "Deficit Push-Up"], pushUpPress);
  register(["Close-Grip Bench Press"], closeGripPress);
  register(["Cable Fly", "Pec Deck Machine", "Cable Crossover", "Dumbbell Fly", "Incline Dumbbell Fly"], fly);
  register(["Low-to-High Cable Fly"], lowToHighFly);
  register(
    [
      "Barbell Overhead Press",
      "Seated Barbell Overhead Press",
      "Dumbbell Overhead Press",
      "Machine Shoulder Press",
    ],
    verticalPress
  );
  register(["Arnold Press"], arnoldPress);
  register(["Landmine Press"], landminePress);
  register(["Dumbbell Lateral Raise", "Lateral Raise", "Cable Lateral Raise", "Machine Lateral Raise"], lateralRaise);
  register(["Cable Front Raise", "Dumbbell Front Raise"], frontRaise);
  register(["Reverse Pec Deck", "Dumbbell Rear Delt Fly", "Cable Rear Delt Fly", "Rear Delt Fly"], rearDeltFly);
  register(["Face Pull"], facePull);
  register(
    [
      "Cable Triceps Pushdown",
      "Triceps Pushdown",
      "Pushdown",
      "Rope Triceps Pushdown",
      "Overhead Cable Triceps Extension",
      "Overhead Dumbbell Extension",
      "Overhead Triceps Extension",
      "Lying Triceps Extension (Skull Crusher)",
    ],
    tricepsIsolation
  );
  register(["Chest-Supported Dumbbell Row", "Chest-Supported T-Bar Row"], chestSupportedRow);
  register(
    ["Barbell Row", "T-Bar Row", "Pendlay Row", "Meadows Row", "Dumbbell Row", "One-Arm Dumbbell Row", "Seated Cable Row", "Close-Grip Seated Cable Row"],
    horizontalRow
  );
  register(["Inverted Row"], supportedHorizontalRow);
  register(["Pull-Up", "Weighted Pull-Up", "Neutral Grip Pull-Up"], verticalPull);
  register(["Chin-Up"], buildStimulusProfile([
    ["lats", 1.0],
    ["biceps", 0.55],
    ["upper_back", 0.35],
  ]));
  register(["Lat Pulldown", "Close-Grip Lat Pulldown"], verticalPull);
  register(["Cable Pullover", "Dumbbell Pullover", "Straight-Arm Pulldown"], pullover);
  register(["Barbell Shrug", "Dumbbell Shrug"], shrug);
  register(["Dead Hang"], deadHang);
  register(
    [
      "Alternating Dumbbell Curl",
      "Barbell Curl",
      "Bayesian Curl",
      "Cable Curl",
      "Concentration Curl",
      "Dumbbell Curl",
      "EZ-Bar Curl",
      "Incline Curl",
      "Incline Dumbbell Curl",
      "Preacher Curl",
      "Spider Curl",
    ],
    bicepsCurl
  );
  register(["Hammer Curl", "Cross-Body Hammer Curl"], hammerCurl);
  register(["Reverse Curl"], reverseCurl);
  register(["Wrist Curl", "Reverse Wrist Curl"], wristCurl);
  register(["Back Squat", "Barbell Back Squat", "Goblet Squat", "Sissy Squat"], squat);
  register(["Front Squat"], frontSquat);
  register(["Hack Squat"], hackSquat);
  register(["Leg Press"], legPress);
  register(["Belt Squat"], beltSquat);
  register(["Bulgarian Split Squat", "Reverse Lunge"], splitSquat);
  register(["Walking Lunge"], lunge);
  register(["Barbell Hip Thrust", "Single-Leg Hip Thrust"], hipThrust);
  register(["Glute Bridge"], gluteBridge);
  register(["Romanian Deadlift", "Stiff-Legged Deadlift", "Cable Pull-Through"], hinge);
  register(["Good Morning"], axialHinge);
  register(["Conventional Deadlift"], conventionalDeadlift);
  register(["Sumo Deadlift"], sumoDeadlift);
  register(["Trap Bar Deadlift"], trapBarDeadlift);
  register(["Lying Leg Curl", "Seated Leg Curl", "Nordic Hamstring Curl"], legCurl);
  register(["Leg Extension"], legExtension);
  register(["Standing Calf Raise", "Seated Calf Raise", "Leg Press Calf Raise"], calfRaise);
  register(["Hip Abduction Machine", "Cable Hip Abduction"], hipAbduction);
  register(["Hip Adduction Machine"], hipAdduction);
  register(["Back Extension (45 Degree)", "Reverse Hyperextension"], backExtension);
  register(["Plank"], plank);
  register(
    [
      "Ab Wheel Rollout",
      "Bicycle Crunch",
      "Cable Crunch",
      "Decline Sit-Up",
      "Dragon Flag",
      "Landmine Rotation",
      "Machine Crunch",
      "Pallof Press",
      "Reverse Crunch",
      "RKC Plank",
      "Russian Twist",
      "Wood Chop",
    ],
    coreOnly
  );
  register(["Copenhagen Plank"], copenhagenPlank);
  register(["Hanging Knee Raise", "Hanging Leg Raise"], hangingRaise);
  register(["Side Plank"], sidePlank);
  register(["Farmer's Carry"], farmersCarry);
  register(["Overhead Carry"], overheadCarry);
  register(["Sled Drag"], sledDrag);
  register(["Sled Pull"], sledPull);
  register(["Sled Push"], sledPush);
  register(["Suitcase Carry"], suitcaseCarry);

  return registry;
})();

export function getExplicitStimulusProfileForExercise(
  exercise: Pick<StimulusBearingExercise, "name"> & { aliases?: string[] }
): StimulusProfile | undefined {
  const candidateNames = [exercise.name, ...(exercise.aliases ?? [])];
  for (const candidate of candidateNames) {
    const normalizedName = normalizeNameKey(candidate);
    if (!normalizedName) {
      continue;
    }
    const profile = INITIAL_STIMULUS_PROFILE_BY_NAME[normalizedName];
    if (profile) {
      return profile;
    }
  }
  return undefined;
}

export function hasExplicitStimulusProfile(exercise: StimulusBearingExercise): boolean {
  return Boolean(
    sanitizeStimulusProfile(exercise.stimulusProfile) ??
      sanitizeStimulusProfile(getExplicitStimulusProfileForExercise(exercise))
  );
}

export function toMuscleId(muscle: string): MuscleId | undefined {
  const normalized = muscle.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "front_deltoids") return "front_delts";
  if (normalized === "side_deltoids") return "side_delts";
  if (normalized === "rear_deltoids") return "rear_delts";
  return normalized in MUSCLE_ID_TO_LABEL ? (normalized as MuscleId) : undefined;
}

export function toMuscleLabel(muscleId: MuscleId): Muscle {
  return MUSCLE_ID_TO_LABEL[muscleId];
}

function sanitizeStimulusProfile(profile: StimulusProfile | undefined): StimulusProfile | undefined {
  if (!profile) {
    return undefined;
  }

  const sanitizedEntries = Object.entries(profile).flatMap(([rawMuscleId, rawWeight]) => {
    if (typeof rawWeight !== "number" || !Number.isFinite(rawWeight) || rawWeight <= 0) {
      return [];
    }
    if (!(rawMuscleId in MUSCLE_ID_TO_LABEL)) {
      return [];
    }
    return [[rawMuscleId as MuscleId, Math.min(rawWeight, MAX_STIMULUS_WEIGHT)] as const];
  });

  if (sanitizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(sanitizedEntries) as StimulusProfile;
}

function buildFallbackStimulusProfile(exercise: StimulusBearingExercise): StimulusProfile | undefined {
  const fallbackEntries: Array<[MuscleId, number]> = [];

  for (const muscle of exercise.primaryMuscles ?? []) {
    const muscleId = toMuscleId(muscle);
    if (muscleId) {
      fallbackEntries.push([muscleId, 1.0]);
    }
  }

  for (const muscle of exercise.secondaryMuscles ?? []) {
    const muscleId = toMuscleId(muscle);
    if (muscleId && !fallbackEntries.some(([existingId]) => existingId === muscleId)) {
      fallbackEntries.push([muscleId, 0.3]);
    }
  }

  if (fallbackEntries.length === 0) {
    return undefined;
  }

  return buildStimulusProfile(fallbackEntries);
}

function logFallbackUse(exercise: StimulusBearingExercise): void {
  const exerciseKey = exercise.id || exercise.name;
  if (!exerciseKey || loggedFallbackExerciseKeys.has(exerciseKey)) {
    return;
  }
  loggedFallbackExerciseKeys.add(exerciseKey);
  const exerciseLabel = exercise.name ?? exercise.id;
  console.warn(
    `${FALLBACK_STIMULUS_LOG_PREFIX} ${exerciseLabel} (${exercise.id}) is missing an explicit stimulusProfile; using centralized fallback mapper.`
  );
}

export function resolveStimulusProfile(
  exercise: StimulusBearingExercise,
  options?: { logFallback?: boolean }
): StimulusProfile {
  const explicitProfile =
    sanitizeStimulusProfile(exercise.stimulusProfile) ??
    sanitizeStimulusProfile(getExplicitStimulusProfileForExercise(exercise));
  if (explicitProfile) {
    return explicitProfile;
  }

  const fallbackProfile = sanitizeStimulusProfile(buildFallbackStimulusProfile(exercise)) ?? {};
  if ((options?.logFallback ?? true) && Object.keys(fallbackProfile).length > 0) {
    logFallbackUse(exercise);
  }
  return fallbackProfile;
}

export function getEffectiveStimulusByMuscleId(
  exercise: StimulusBearingExercise,
  setCount: number,
  options?: { logFallback?: boolean }
): Map<MuscleId, number> {
  const normalizedSetCount = Number.isFinite(setCount) ? Math.max(0, setCount) : 0;
  const profile = resolveStimulusProfile(exercise, options);
  const contribution = new Map<MuscleId, number>();

  for (const [muscleId, weight] of Object.entries(profile) as Array<[MuscleId, number]>) {
    contribution.set(muscleId, normalizedSetCount * weight);
  }

  return contribution;
}

export function getEffectiveStimulusByMuscle(
  exercise: StimulusBearingExercise,
  setCount: number,
  options?: { logFallback?: boolean }
): Map<Muscle, number> {
  const byMuscle = new Map<Muscle, number>();
  for (const [muscleId, effectiveSets] of getEffectiveStimulusByMuscleId(exercise, setCount, options)) {
    byMuscle.set(toMuscleLabel(muscleId), effectiveSets);
  }
  return byMuscle;
}

export function collectStimulusFallbackExercises(
  exercises: StimulusBearingExercise[],
  options?: {
    allowExerciseIds?: Iterable<string>;
    allowExerciseNames?: Iterable<string>;
  }
): StimulusFallbackExercise[] {
  const allowedIds = new Set(options?.allowExerciseIds ?? []);
  const allowedNames = new Set(
    Array.from(options?.allowExerciseNames ?? []).map((name) => normalizeNameKey(name))
  );

  return exercises
    .filter((exercise) => !hasExplicitStimulusProfile(exercise))
    .filter((exercise) => !allowedIds.has(exercise.id))
    .filter((exercise) => !allowedNames.has(normalizeNameKey(exercise.name)))
    .map((exercise) => ({
      id: exercise.id,
      name: exercise.name ?? exercise.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function validateStimulusProfileCoverage(
  exercises: StimulusBearingExercise[],
  options?: {
    allowExerciseIds?: Iterable<string>;
    allowExerciseNames?: Iterable<string>;
    strict?: boolean;
    context?: string;
  }
): StimulusFallbackExercise[] {
  const fallbackExercises = collectStimulusFallbackExercises(exercises, options);
  if (fallbackExercises.length === 0) {
    return [];
  }

  const context = options?.context ?? "planner";
  const summary = fallbackExercises
    .map((exercise) => `${exercise.name} (${exercise.id})`)
    .join(", ");
  const message =
    `[stimulus-profile:coverage] ${context} has ${fallbackExercises.length} exercise(s) ` +
    `without explicit stimulusProfile coverage: ${summary}`;

  if (options?.strict) {
    throw new Error(message);
  }

  console.warn(message);
  return fallbackExercises;
}
