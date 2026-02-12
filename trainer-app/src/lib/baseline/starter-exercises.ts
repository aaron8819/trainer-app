export type BaselineSplitType = "PPL" | "UPPER_LOWER" | "FULL_BODY" | "CUSTOM";
export type BaselinePrimaryGoal =
  | "HYPERTROPHY"
  | "STRENGTH"
  | "FAT_LOSS"
  | "ATHLETICISM"
  | "GENERAL_HEALTH";

export type StarterExercise = {
  id: string;
  name: string;
  primaryMuscles: string[];
};

export type StarterExerciseCandidate = {
  id: string;
  name: string;
  isMainLiftEligible?: boolean;
  equipment: string[];
  primaryMuscles: string[];
};

const ALL_EQUIPMENT_LOWER = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "bodyweight",
  "kettlebell",
  "band",
  "cardio",
  "sled",
  "bench",
  "rack",
  "ez_bar",
  "trap_bar",
  "other",
] as const;

type Slot = {
  names: string[];
  required: boolean;
};

const SLOT_MAP: Record<BaselineSplitType, Slot[]> = {
  PPL: [
    { names: ["Barbell Bench Press", "Dumbbell Bench Press"], required: true },
    { names: ["Barbell Overhead Press", "Dumbbell Overhead Press"], required: true },
    { names: ["Barbell Back Squat", "Front Squat", "Hack Squat", "Belt Squat"], required: true },
    { names: ["Conventional Deadlift", "Trap Bar Deadlift", "Sumo Deadlift"], required: true },
    { names: ["Barbell Row", "Chest-Supported Dumbbell Row", "Seated Cable Row"], required: true },
    { names: ["Chin-Up", "Lat Pulldown", "Close-Grip Lat Pulldown"], required: true },
    { names: ["Romanian Deadlift", "Stiff-Legged Deadlift"], required: false },
    { names: ["Dip (Chest Emphasis)", "Dip"], required: false },
  ],
  UPPER_LOWER: [
    { names: ["Barbell Bench Press", "Dumbbell Bench Press"], required: true },
    { names: ["Barbell Row", "Chest-Supported Dumbbell Row", "Seated Cable Row"], required: true },
    { names: ["Barbell Overhead Press", "Dumbbell Overhead Press"], required: true },
    { names: ["Barbell Back Squat", "Front Squat", "Hack Squat", "Belt Squat"], required: true },
    { names: ["Conventional Deadlift", "Trap Bar Deadlift", "Sumo Deadlift"], required: true },
    { names: ["Chin-Up", "Lat Pulldown", "Close-Grip Lat Pulldown"], required: true },
    { names: ["Romanian Deadlift", "Stiff-Legged Deadlift"], required: false },
    { names: ["Dip (Chest Emphasis)", "Dip"], required: false },
  ],
  FULL_BODY: [
    { names: ["Barbell Back Squat", "Front Squat", "Hack Squat", "Belt Squat"], required: true },
    { names: ["Barbell Bench Press", "Dumbbell Bench Press"], required: true },
    { names: ["Barbell Row", "Chest-Supported Dumbbell Row", "Seated Cable Row"], required: true },
    { names: ["Conventional Deadlift", "Trap Bar Deadlift", "Sumo Deadlift"], required: true },
    { names: ["Barbell Overhead Press", "Dumbbell Overhead Press"], required: true },
    { names: ["Chin-Up", "Lat Pulldown", "Close-Grip Lat Pulldown"], required: true },
    { names: ["Romanian Deadlift", "Stiff-Legged Deadlift"], required: false },
  ],
  CUSTOM: [
    { names: ["Barbell Bench Press", "Dumbbell Bench Press"], required: true },
    { names: ["Barbell Overhead Press", "Dumbbell Overhead Press"], required: true },
    { names: ["Barbell Back Squat", "Front Squat", "Hack Squat", "Belt Squat"], required: true },
    { names: ["Conventional Deadlift", "Trap Bar Deadlift", "Sumo Deadlift"], required: true },
    { names: ["Barbell Row", "Chest-Supported Dumbbell Row", "Seated Cable Row"], required: true },
    { names: ["Chin-Up", "Lat Pulldown", "Close-Grip Lat Pulldown"], required: true },
    { names: ["Romanian Deadlift", "Stiff-Legged Deadlift"], required: false },
  ],
};

function supportsAvailableEquipment(exercise: StarterExerciseCandidate, availableEquipment: Set<string>): boolean {
  if (availableEquipment.size === 0) {
    return true;
  }

  if (exercise.equipment.some((equipment) => equipment.toLowerCase() === "bodyweight")) {
    return true;
  }

  return exercise.equipment.some((equipment) => availableEquipment.has(equipment.toLowerCase()));
}

export function resolveBaselineContextForGoal(primaryGoal: BaselinePrimaryGoal | undefined): "volume" | "strength" {
  return primaryGoal === "STRENGTH" || primaryGoal === "ATHLETICISM" ? "strength" : "volume";
}

export function selectStarterExercises(
  exercises: StarterExerciseCandidate[],
  splitType: BaselineSplitType | undefined,
  availableEquipment: string[] | undefined
): StarterExercise[] {
  const split = splitType ?? "CUSTOM";
  const slots = SLOT_MAP[split];
  const effectiveEquipment =
    availableEquipment && availableEquipment.length > 0
      ? availableEquipment.map((equipment) => equipment.toLowerCase())
      : [...ALL_EQUIPMENT_LOWER];
  const equipmentSet = new Set(effectiveEquipment);
  const byName = new Map(exercises.map((exercise) => [exercise.name.toLowerCase(), exercise]));
  const picked = new Set<string>();
  const selected: StarterExercise[] = [];

  const pickFromSlot = (slot: Slot) => {
    for (const candidateName of slot.names) {
      const candidate = byName.get(candidateName.toLowerCase());
      if (!candidate || !candidate.isMainLiftEligible || picked.has(candidate.id)) {
        continue;
      }

      if (!supportsAvailableEquipment(candidate, equipmentSet)) {
        continue;
      }

      picked.add(candidate.id);
      selected.push({
        id: candidate.id,
        name: candidate.name,
        primaryMuscles: candidate.primaryMuscles,
      });
      return true;
    }

    return false;
  };

  for (const slot of slots) {
    const found = pickFromSlot(slot);
    if (!found && slot.required) {
      continue;
    }
  }

  if (selected.length < 5) {
    const fallbackPool = exercises
      .filter((exercise) => exercise.isMainLiftEligible && !picked.has(exercise.id))
      .filter((exercise) => supportsAvailableEquipment(exercise, equipmentSet))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const exercise of fallbackPool) {
      selected.push({
        id: exercise.id,
        name: exercise.name,
        primaryMuscles: exercise.primaryMuscles,
      });
      if (selected.length >= 5) {
        break;
      }
    }
  }

  return selected.slice(0, 8);
}
