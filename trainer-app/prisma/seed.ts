import "dotenv/config";
import {
  Difficulty,
  EquipmentType,
  JointStress,
  MovementPatternV2,
  MuscleRole,
  Prisma,
  SplitTag,
  StimulusBias,
  PrismaClient,
} from "@prisma/client";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import exercisesJson from "./exercises_comprehensive.json";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Missing DATABASE_URL for seeding");
}

const disableVerify = process.env.DATABASE_SSL_NO_VERIFY === "true";
const ssl = disableVerify ? { rejectUnauthorized: false } : undefined;

const sanitizedConnectionString = (() => {
  if (!disableVerify) {
    return connectionString;
  }
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");
  return url.toString();
})();

const pool = new Pool({ connectionString: sanitizedConnectionString, ssl });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type JsonExercise = (typeof exercisesJson.exercises)[number];
type ExerciseAliasSeed = { exerciseName: string; alias: string };

// ═══════════════════════════════════════════════════════════════════════════
// Enum mappings (JSON string → Prisma enum)
// ═══════════════════════════════════════════════════════════════════════════

const MOVEMENT_PATTERN_MAP: Record<string, MovementPatternV2> = {
  horizontal_push: MovementPatternV2.HORIZONTAL_PUSH,
  vertical_push: MovementPatternV2.VERTICAL_PUSH,
  horizontal_pull: MovementPatternV2.HORIZONTAL_PULL,
  vertical_pull: MovementPatternV2.VERTICAL_PULL,
  squat: MovementPatternV2.SQUAT,
  hinge: MovementPatternV2.HINGE,
  lunge: MovementPatternV2.LUNGE,
  carry: MovementPatternV2.CARRY,
  rotation: MovementPatternV2.ROTATION,
  anti_rotation: MovementPatternV2.ANTI_ROTATION,
  flexion: MovementPatternV2.FLEXION,
  extension: MovementPatternV2.EXTENSION,
  abduction: MovementPatternV2.ABDUCTION,
  adduction: MovementPatternV2.ADDUCTION,
  isolation: MovementPatternV2.ISOLATION,
};

const SPLIT_TAG_MAP: Record<string, SplitTag> = {
  push: SplitTag.PUSH,
  pull: SplitTag.PULL,
  legs: SplitTag.LEGS,
  core: SplitTag.CORE,
  conditioning: SplitTag.CONDITIONING,
  mobility: SplitTag.MOBILITY,
  prehab: SplitTag.PREHAB,
};

const JOINT_STRESS_MAP: Record<string, JointStress> = {
  low: JointStress.LOW,
  medium: JointStress.MEDIUM,
  high: JointStress.HIGH,
};

const STIMULUS_BIAS_MAP: Record<string, StimulusBias> = {
  mechanical: StimulusBias.MECHANICAL,
  metabolic: StimulusBias.METABOLIC,
  stretch: StimulusBias.STRETCH,
  stability: StimulusBias.STABILITY,
};

const DIFFICULTY_MAP: Record<string, Difficulty> = {
  beginner: Difficulty.BEGINNER,
  intermediate: Difficulty.INTERMEDIATE,
  advanced: Difficulty.ADVANCED,
};

// ═══════════════════════════════════════════════════════════════════════════
// Seed data — Equipment
// ═══════════════════════════════════════════════════════════════════════════

const equipmentSeed = [
  { name: "Barbell", type: EquipmentType.BARBELL },
  { name: "Dumbbell", type: EquipmentType.DUMBBELL },
  { name: "Machine", type: EquipmentType.MACHINE },
  { name: "Cable", type: EquipmentType.CABLE },
  { name: "Bodyweight", type: EquipmentType.BODYWEIGHT },
  { name: "Kettlebell", type: EquipmentType.KETTLEBELL },
  { name: "Band", type: EquipmentType.BAND },
  { name: "Sled", type: EquipmentType.SLED },
  { name: "Bench", type: EquipmentType.BENCH },
  { name: "Rack", type: EquipmentType.RACK },
  { name: "EZ_Bar", type: EquipmentType.EZ_BAR },
  { name: "Trap_Bar", type: EquipmentType.TRAP_BAR },
];

// ═══════════════════════════════════════════════════════════════════════════
// Seed data — Muscles (18 canonical)
// ═══════════════════════════════════════════════════════════════════════════

const muscleSeed = [
  "Chest",
  "Lats",
  "Upper Back",
  "Lower Back",
  "Front Delts",
  "Side Delts",
  "Rear Delts",
  "Biceps",
  "Triceps",
  "Forearms",
  "Quads",
  "Hamstrings",
  "Glutes",
  "Adductors",
  "Abductors",
  "Calves",
  "Core",
  "Abs",
];

// Muscle volume landmarks
const MUSCLE_LANDMARKS: Record<string, { mv: number; mev: number; mav: number; mrv: number; sraHours: number }> = {
  "Chest":       { mv: 6,  mev: 10, mav: 16, mrv: 22, sraHours: 60 },
  "Lats":        { mv: 6,  mev: 10, mav: 18, mrv: 25, sraHours: 60 },
  "Upper Back":  { mv: 6,  mev: 10, mav: 18, mrv: 25, sraHours: 48 },
  "Front Delts": { mv: 0,  mev: 0,  mav: 7,  mrv: 12, sraHours: 48 },
  "Side Delts":  { mv: 6,  mev: 8,  mav: 19, mrv: 26, sraHours: 36 },
  "Rear Delts":  { mv: 6,  mev: 8,  mav: 19, mrv: 26, sraHours: 36 },
  "Quads":       { mv: 6,  mev: 8,  mav: 15, mrv: 20, sraHours: 72 },
  "Hamstrings":  { mv: 6,  mev: 6,  mav: 13, mrv: 20, sraHours: 72 },
  "Glutes":      { mv: 0,  mev: 0,  mav: 8,  mrv: 16, sraHours: 72 },
  "Biceps":      { mv: 6,  mev: 8,  mav: 17, mrv: 26, sraHours: 36 },
  "Triceps":     { mv: 4,  mev: 6,  mav: 12, mrv: 18, sraHours: 36 },
  "Calves":      { mv: 6,  mev: 8,  mav: 14, mrv: 20, sraHours: 36 },
  "Core":        { mv: 0,  mev: 0,  mav: 12, mrv: 20, sraHours: 36 },
  "Lower Back":  { mv: 0,  mev: 0,  mav: 4,  mrv: 10, sraHours: 72 },
  "Forearms":    { mv: 0,  mev: 0,  mav: 6,  mrv: 12, sraHours: 36 },
  "Adductors":   { mv: 0,  mev: 0,  mav: 8,  mrv: 14, sraHours: 48 },
  "Abductors":   { mv: 0,  mev: 0,  mav: 6,  mrv: 12, sraHours: 36 },
  "Abs":         { mv: 0,  mev: 0,  mav: 10, mrv: 16, sraHours: 36 },
};

// ═══════════════════════════════════════════════════════════════════════════
// Time per set overrides (exercises needing non-120s default)
// ═══════════════════════════════════════════════════════════════════════════

const TIME_PER_SET_OVERRIDES: Record<string, number> = {
  // Heavy compounds — long rest
  "Barbell Back Squat": 210,
  "Front Squat": 180,
  "Conventional Deadlift": 210,
  "Sumo Deadlift": 210,
  "Trap Bar Deadlift": 210,
  "Barbell Bench Press": 180,
  "Incline Barbell Bench Press": 180,
  "Decline Barbell Bench Press": 180,
  "Barbell Overhead Press": 180,
  "Seated Barbell Overhead Press": 180,
  "Barbell Row": 150,
  "Pendlay Row": 150,
  "T-Bar Row": 150,

  // Machine compounds — moderate rest
  "Hack Squat": 150,
  "Belt Squat": 150,

  // Quick isolations
  "Leg Extension": 90,
  "Lying Leg Curl": 90,
  "Seated Leg Curl": 90,
  "Cable Triceps Pushdown": 75,
  "Rope Triceps Pushdown": 75,
  "Dumbbell Lateral Raise": 75,
  "Cable Lateral Raise": 75,
  "Machine Lateral Raise": 75,
  "Dumbbell Curl": 75,
  "EZ-Bar Curl": 90,
  "Cable Curl": 75,
  "Bayesian Curl": 75,
  "Preacher Curl": 75,
  "Spider Curl": 75,
  "Concentration Curl": 75,
  "Hammer Curl": 75,
  "Cross-Body Hammer Curl": 75,
  "Incline Dumbbell Curl": 75,
  "Face Pull": 75,
  "Standing Calf Raise": 75,
  "Seated Calf Raise": 75,
  "Leg Press Calf Raise": 75,
  "Cable Fly": 75,
  "Low-to-High Cable Fly": 75,
  "Pec Deck Machine": 75,
  "Reverse Pec Deck": 75,
  "Dumbbell Rear Delt Fly": 75,
  "Cable Rear Delt Fly": 75,
  "Reverse Curl": 75,
  "Wrist Curl": 60,
  "Reverse Wrist Curl": 60,
  "Hip Abduction Machine": 75,
  "Cable Hip Abduction": 75,
  "Hip Adduction Machine": 75,

  // Core — quick
  "Plank": 60,
  "RKC Plank": 60,
  "Side Plank": 60,
  "Cable Crunch": 60,
  "Machine Crunch": 60,
  "Pallof Press": 60,
  "Reverse Crunch": 60,
  "Bicycle Crunch": 60,

  // Conditioning
  "Farmer's Walk": 75,
  "Sled Push": 90,
  "Sled Pull": 90,
  "Sled Drag": 90,
};

// ═══════════════════════════════════════════════════════════════════════════
// Exercise renames (old name → new name in JSON)
// ═══════════════════════════════════════════════════════════════════════════

const EXERCISE_RENAMES: [string, string][] = [
  ["Hip Thrust", "Barbell Hip Thrust"],
  ["Leg Curl", "Lying Leg Curl"],
  ["Incline Barbell Bench", "Incline Barbell Bench Press"],
  ["Smith Machine Incline Press", "Incline Machine Press"],
  ["Dumbbell Incline Press", "Incline Dumbbell Bench Press"],
  ["Pec Deck", "Pec Deck Machine"],
  ["Overhead Press", "Barbell Overhead Press"],
  ["Dumbbell Shoulder Press", "Dumbbell Overhead Press"],
  ["Lateral Raise", "Dumbbell Lateral Raise"],
  ["Triceps Pushdown", "Cable Triceps Pushdown"],
  ["Skull Crusher", "Lying Triceps Extension (Skull Crusher)"],
  ["Dips", "Dip (Chest Emphasis)"],
  ["Overhead Triceps Extension", "Overhead Dumbbell Extension"],
  ["Chest-Supported Row", "Chest-Supported Dumbbell Row"],
  ["Single-Arm Dumbbell Row", "One-Arm Dumbbell Row"],
  ["Machine Rear Delt Fly", "Reverse Pec Deck"],
  ["Reverse Fly", "Dumbbell Rear Delt Fly"],
  ["Cable Preacher Curl", "Preacher Curl"],
  ["Farmer's Carry", "Farmer's Walk"],
];

// Muscle rename (old name → new name)
const MUSCLE_RENAMES: [string, string][] = [
  ["Back", "Lats"],
];

// Exercises to delete before renames (merge conflicts)
const EXERCISES_TO_DELETE_BEFORE_RENAME = [
  "Dumbbell Lateral Raises",
];

// ═══════════════════════════════════════════════════════════════════════════
// Exercise aliases (old names become aliases for searchability)
// ═══════════════════════════════════════════════════════════════════════════

const exerciseAliases: ExerciseAliasSeed[] = [
  // Old names from renames
  { exerciseName: "Barbell Hip Thrust", alias: "Hip Thrust" },
  { exerciseName: "Lying Leg Curl", alias: "Leg Curl" },
  { exerciseName: "Incline Barbell Bench Press", alias: "Incline Barbell Bench" },
  { exerciseName: "Incline Machine Press", alias: "Smith Machine Incline Press" },
  { exerciseName: "Incline Dumbbell Bench Press", alias: "Dumbbell Incline Press" },
  { exerciseName: "Pec Deck Machine", alias: "Pec Deck" },
  { exerciseName: "Barbell Overhead Press", alias: "Overhead Press" },
  { exerciseName: "Dumbbell Overhead Press", alias: "Dumbbell Shoulder Press" },
  { exerciseName: "Dumbbell Lateral Raise", alias: "Lateral Raise" },
  { exerciseName: "Dumbbell Lateral Raise", alias: "Dumbbell Lateral Raises" },
  { exerciseName: "Cable Triceps Pushdown", alias: "Triceps Pushdown" },
  { exerciseName: "Lying Triceps Extension (Skull Crusher)", alias: "Skull Crusher" },
  { exerciseName: "Dip (Chest Emphasis)", alias: "Dips" },
  { exerciseName: "Overhead Dumbbell Extension", alias: "Overhead Triceps Extension" },
  { exerciseName: "Chest-Supported Dumbbell Row", alias: "Chest-Supported Row" },
  { exerciseName: "One-Arm Dumbbell Row", alias: "Single-Arm Dumbbell Row" },
  { exerciseName: "Reverse Pec Deck", alias: "Machine Rear Delt Fly" },
  { exerciseName: "Dumbbell Rear Delt Fly", alias: "Reverse Fly" },
  { exerciseName: "Preacher Curl", alias: "Cable Preacher Curl" },
  { exerciseName: "Farmer's Walk", alias: "Farmer's Carry" },

  // Legacy aliases from old seed
  { exerciseName: "Dumbbell Overhead Press", alias: "DB Shoulder Press" },
  { exerciseName: "Romanian Deadlift", alias: "Romanian Deadlift (BB)" },
  { exerciseName: "Romanian Deadlift", alias: "DB Romanian Deadlift" },
  { exerciseName: "Incline Dumbbell Bench Press", alias: "Incline DB Press" },
  { exerciseName: "One-Arm Dumbbell Row", alias: "One-Arm DB Row" },
  { exerciseName: "Incline Dumbbell Curl", alias: "Incline DB Curls" },
  { exerciseName: "Lying Triceps Extension (Skull Crusher)", alias: "DB Skull Crushers" },
  { exerciseName: "Dumbbell Lateral Raise", alias: "DB Lateral Raise" },
  { exerciseName: "Face Pull", alias: "Face Pulls (Rope)" },
  { exerciseName: "Cable Triceps Pushdown", alias: "Tricep Rope Pushdown" },
  { exerciseName: "Barbell Bench Press", alias: "Flat Barbell Bench Press" },
  { exerciseName: "Barbell Bench Press", alias: "Decline Barbell Bench" },
  { exerciseName: "Dumbbell Bench Press", alias: "Flat DB Press" },
  { exerciseName: "Bulgarian Split Squat", alias: "Front-Foot Elevated Split Squat" },
];

// baselineSeed removed — Baseline model dropped in migration 20260218000000_remove_baseline

// ═══════════════════════════════════════════════════════════════════════════
// Seed functions
// ═══════════════════════════════════════════════════════════════════════════


type WorkoutTemplateSeed = {
  name: string;
  targetMuscles: string[];
  isStrict: boolean;
  exercises: string[];
};

const workoutTemplateSeed: WorkoutTemplateSeed[] = [
  {
    name: "Workout 1 - Push A: Chest Emphasis",
    targetMuscles: ["Chest", "Triceps", "Side Delts"],
    isStrict: false,
    exercises: [
      "Barbell Bench Press",
      "Incline Dumbbell Bench Press",
      "Cable Fly",
      "Overhead Cable Triceps Extension",
      "Cable Lateral Raise",
    ],
  },
  {
    name: "Workout 2 - Push B: Shoulder Emphasis",
    targetMuscles: ["Front Delts", "Side Delts", "Chest", "Triceps"],
    isStrict: false,
    exercises: [
      "Barbell Overhead Press",
      "Machine Chest Press",
      "Dumbbell Lateral Raise",
      "Incline Dumbbell Fly",
      "Rope Triceps Pushdown",
    ],
  },
  {
    name: "Workout 3 - Pull A: Back Width (Vertical Focus)",
    targetMuscles: ["Lats", "Biceps", "Rear Delts"],
    isStrict: false,
    exercises: [
      "Weighted Pull-Up",
      "Lat Pulldown",
      "Cable Pullover",
      "Incline Dumbbell Curl",
      "Face Pull",
    ],
  },
  {
    name: "Workout 4 - Pull B: Back Thickness (Horizontal Focus)",
    targetMuscles: ["Upper Back", "Lats", "Biceps", "Rear Delts"],
    isStrict: false,
    exercises: [
      "Barbell Row",
      "Chest-Supported Dumbbell Row",
      "Seated Cable Row",
      "Bayesian Curl",
      "Reverse Pec Deck",
    ],
  },
  {
    name: "Workout 5 - Legs A: Quad Dominant",
    targetMuscles: ["Quads", "Hamstrings", "Calves", "Glutes"],
    isStrict: false,
    exercises: [
      "Barbell Back Squat",
      "Hack Squat",
      "Leg Extension",
      "Seated Leg Curl",
      "Standing Calf Raise",
    ],
  },
  {
    name: "Workout 6 - Legs B: Posterior Chain Dominant",
    targetMuscles: ["Hamstrings", "Glutes", "Quads", "Calves"],
    isStrict: false,
    exercises: [
      "Romanian Deadlift",
      "Bulgarian Split Squat",
      "Seated Leg Curl",
      "Barbell Hip Thrust",
      "Seated Calf Raise",
    ],
  },
  {
    name: "Workout 7 - Upper Body A: Horizontal Push/Pull",
    targetMuscles: ["Chest", "Upper Back", "Rear Delts", "Biceps", "Triceps"],
    isStrict: false,
    exercises: [
      "Dumbbell Bench Press",
      "Chest-Supported T-Bar Row",
      "Cable Fly",
      "Cable Rear Delt Fly",
      "Overhead Cable Triceps Extension",
      "Incline Dumbbell Curl",
    ],
  },
  {
    name: "Workout 8 - Upper Body B: Vertical Push/Pull",
    targetMuscles: ["Lats", "Front Delts", "Side Delts", "Biceps", "Triceps"],
    isStrict: false,
    exercises: [
      "Chin-Up",
      "Dumbbell Overhead Press",
      "Straight-Arm Pulldown",
      "Dumbbell Lateral Raise",
      "Lying Triceps Extension (Skull Crusher)",
      "Cable Curl",
    ],
  },
  {
    name: "Workout 9 - Full Body A",
    targetMuscles: ["Quads", "Chest", "Lats", "Hamstrings", "Side Delts", "Calves"],
    isStrict: false,
    exercises: [
      "Barbell Back Squat",
      "Incline Dumbbell Bench Press",
      "Seated Cable Row",
      "Seated Leg Curl",
      "Cable Lateral Raise",
      "Standing Calf Raise",
    ],
  },
  {
    name: "Workout 10 - Full Body B",
    targetMuscles: ["Hamstrings", "Quads", "Chest", "Lats", "Triceps", "Biceps"],
    isStrict: false,
    exercises: [
      "Trap Bar Deadlift",
      "Dumbbell Bench Press",
      "Lat Pulldown",
      "Leg Extension",
      "Overhead Dumbbell Extension",
      "Dumbbell Curl",
    ],
  },
  {
    name: "Workout 11 - Full Body C",
    targetMuscles: ["Hamstrings", "Chest", "Lats", "Quads", "Rear Delts", "Calves"],
    isStrict: false,
    exercises: [
      "Romanian Deadlift",
      "Machine Chest Press",
      "Pull-Up",
      "Bulgarian Split Squat",
      "Face Pull",
      "Seated Calf Raise",
    ],
  },
  {
    name: "Workout 12 - Chest + Back (Antagonist Supersets)",
    targetMuscles: ["Chest", "Upper Back", "Lats"],
    isStrict: false,
    exercises: [
      "Barbell Bench Press",
      "Barbell Row",
      "Incline Dumbbell Bench Press",
      "One-Arm Dumbbell Row",
      "Cable Fly",
      "Straight-Arm Pulldown",
    ],
  },
  {
    name: "Workout 13 - Arms: Biceps + Triceps",
    targetMuscles: ["Biceps", "Triceps", "Forearms"],
    isStrict: false,
    exercises: [
      "Close-Grip Bench Press",
      "EZ-Bar Curl",
      "Overhead Cable Triceps Extension",
      "Incline Dumbbell Curl",
      "Rope Triceps Pushdown",
      "Hammer Curl",
      "Cable Curl",
    ],
  },
  {
    name: "Workout 14 - Shoulders + Arms",
    targetMuscles: ["Front Delts", "Side Delts", "Rear Delts", "Biceps", "Triceps"],
    isStrict: false,
    exercises: [
      "Seated Barbell Overhead Press",
      "Machine Lateral Raise",
      "Overhead Dumbbell Extension",
      "Bayesian Curl",
      "Cable Triceps Pushdown",
      "Preacher Curl",
      "Reverse Pec Deck",
    ],
  },
  {
    name: "Workout 15 - Posterior Chain (Hamstrings + Glutes + Back)",
    targetMuscles: ["Hamstrings", "Glutes", "Lower Back", "Lats"],
    isStrict: false,
    exercises: [
      "Conventional Deadlift",
      "Good Morning",
      "Seated Leg Curl",
      "Back Extension (45 Degree)",
      "Reverse Hyperextension",
    ],
  },
  {
    name: "Workout 16 - Quads + Calves",
    targetMuscles: ["Quads", "Calves"],
    isStrict: false,
    exercises: [
      "Front Squat",
      "Leg Press",
      "Leg Extension",
      "Sissy Squat",
      "Standing Calf Raise",
      "Seated Calf Raise",
    ],
  },
  {
    name: "Workout 17 - Push + Pull Supersets (Time-Efficient Upper)",
    targetMuscles: ["Chest", "Upper Back", "Lats", "Front Delts", "Rear Delts", "Biceps", "Triceps"],
    isStrict: false,
    exercises: [
      "Machine Chest Press",
      "Chest-Supported Dumbbell Row",
      "Machine Shoulder Press",
      "Close-Grip Lat Pulldown",
      "Pec Deck Machine",
      "Reverse Pec Deck",
      "Cable Triceps Pushdown",
      "Cable Curl",
    ],
  },
  {
    name: "Workout 18 - Glute Specialization",
    targetMuscles: ["Glutes", "Hamstrings", "Quads", "Abductors", "Adductors"],
    isStrict: false,
    exercises: [
      "Barbell Hip Thrust",
      "Bulgarian Split Squat",
      "Romanian Deadlift",
      "Cable Pull-Through",
      "Hip Abduction Machine",
      "Walking Lunge",
    ],
  },
  {
    name: "Workout 19 - Back + Biceps",
    targetMuscles: ["Upper Back", "Lats", "Biceps", "Forearms"],
    isStrict: false,
    exercises: [
      "T-Bar Row",
      "Lat Pulldown",
      "Meadows Row",
      "Dumbbell Pullover",
      "Incline Dumbbell Curl",
      "Hammer Curl",
    ],
  },
  {
    name: "Workout 20 - Chest + Shoulders + Triceps (Push Volume Day)",
    targetMuscles: ["Chest", "Front Delts", "Side Delts", "Triceps"],
    isStrict: false,
    exercises: [
      "Incline Barbell Bench Press",
      "Dip (Chest Emphasis)",
      "Low-to-High Cable Fly",
      "Arnold Press",
      "Machine Lateral Raise",
      "Overhead Cable Triceps Extension",
    ],
  },
];

async function renameExercises() {
  console.log("Renaming exercises...");

  // First delete exercises that conflict with rename targets
  for (const name of EXERCISES_TO_DELETE_BEFORE_RENAME) {
    const existing = await prisma.exercise.findUnique({ where: { name } });
    if (existing) {
      // Clean up relations first
      await prisma.exerciseMuscle.deleteMany({ where: { exerciseId: existing.id } });
      await prisma.exerciseEquipment.deleteMany({ where: { exerciseId: existing.id } });
      await prisma.exerciseAlias.deleteMany({ where: { exerciseId: existing.id } });
      await prisma.exerciseVariation.deleteMany({ where: { exerciseId: existing.id } });
      await prisma.substitutionRule.deleteMany({
        where: { OR: [{ fromExerciseId: existing.id }, { toExerciseId: existing.id }] },
      });
      // Only delete if no workout history or templates
      const refs = await prisma.workoutExercise.findFirst({ where: { exerciseId: existing.id } });
      const tmpl = await prisma.workoutTemplateExercise.findFirst({ where: { exerciseId: existing.id } });
      if (!refs && !tmpl) {
        await prisma.exercise.delete({ where: { id: existing.id } });
        console.log(`  Deleted conflicting: ${name}`);
      } else {
        console.warn(`  ⚠ Cannot delete ${name} (has history/templates)`);
      }
    }
  }

  let renamed = 0;
  for (const [oldName, newName] of EXERCISE_RENAMES) {
    const existing = await prisma.exercise.findUnique({ where: { name: oldName } });
    if (existing) {
      // Check if target name already exists (from a previous run)
      const target = await prisma.exercise.findUnique({ where: { name: newName } });
      if (target) {
        console.log(`  Skip rename ${oldName} → ${newName} (target exists)`);
        continue;
      }
      await prisma.exercise.update({ where: { id: existing.id }, data: { name: newName } });
      renamed++;
    }
  }
  console.log(`  ${renamed} exercises renamed.`);
}

async function renameMuscles() {
  console.log("Renaming muscles...");
  for (const [oldName, newName] of MUSCLE_RENAMES) {
    const existing = await prisma.muscle.findUnique({ where: { name: oldName } });
    if (existing) {
      const target = await prisma.muscle.findUnique({ where: { name: newName } });
      if (target) {
        console.log(`  Skip rename ${oldName} → ${newName} (target exists)`);
        continue;
      }
      await prisma.muscle.update({ where: { id: existing.id }, data: { name: newName } });
      console.log(`  Renamed: ${oldName} → ${newName}`);
    }
  }
}

async function seedEquipment() {
  console.log("Seeding equipment...");
  for (const item of equipmentSeed) {
    await prisma.equipment.upsert({
      where: { name: item.name },
      update: { type: item.type },
      create: { name: item.name, type: item.type },
    });
  }
}

async function seedMuscles() {
  console.log("Seeding muscles...");
  for (const name of muscleSeed) {
    const landmarks = MUSCLE_LANDMARKS[name];
    const data = landmarks
      ? { mv: landmarks.mv, mev: landmarks.mev, mav: landmarks.mav, mrv: landmarks.mrv, sraHours: landmarks.sraHours }
      : {};
    await prisma.muscle.upsert({
      where: { name },
      update: data,
      create: { name, ...data },
    });
  }
}

function resolveTimePerSet(ex: JsonExercise): number {
  if ("timePerSetSec" in ex && typeof ex.timePerSetSec === "number") {
    return ex.timePerSetSec;
  }
  const override = TIME_PER_SET_OVERRIDES[ex.name];
  if (override) return override;
  if (ex.isMainLiftEligible) return 210;
  if (ex.splitTag === "core") return 60;
  if (ex.splitTag === "conditioning") return 90;
  return 120;
}

async function seedExercisesFromJson() {
  console.log("Seeding exercises from JSON...");

  let created = 0;
  let updated = 0;

  for (const ex of exercisesJson.exercises) {
    const movementPatterns = ex.movementPatterns.map((p) => {
      const mapped = MOVEMENT_PATTERN_MAP[p];
      if (!mapped) throw new Error(`Unknown movement pattern: ${p} in ${ex.name}`);
      return mapped;
    });

    const splitTag = SPLIT_TAG_MAP[ex.splitTag];
    if (!splitTag) throw new Error(`Unknown split tag: ${ex.splitTag} in ${ex.name}`);

    const jointStress = JOINT_STRESS_MAP[ex.jointStress];
    if (!jointStress) throw new Error(`Unknown joint stress: ${ex.jointStress} in ${ex.name}`);

    const stimulusBias = ex.stimulusBias.map((b) => {
      const mapped = STIMULUS_BIAS_MAP[b];
      if (!mapped) throw new Error(`Unknown stimulus bias: ${b} in ${ex.name}`);
      return mapped;
    });

    const difficulty = DIFFICULTY_MAP[ex.difficulty];
    if (!difficulty) throw new Error(`Unknown difficulty: ${ex.difficulty} in ${ex.name}`);

    const timePerSetSec = resolveTimePerSet(ex);

    const data = {
      movementPatterns,
      splitTags: [splitTag],
      jointStress,
      isMainLiftEligible: ex.isMainLiftEligible,
      isCompound: ex.isCompound,
      fatigueCost: ex.fatigueCost,
      stimulusBias,
      // Preserve explicit nulls from JSON so stale DB values are cleared.
      contraindications:
        ex.contraindications === null
          ? Prisma.JsonNull
          : ex.contraindications,
      timePerSetSec,
      sfrScore: ex.sfrScore,
      lengthPositionScore: ex.lengthPositionScore,
      difficulty,
      isUnilateral: ex.unilateral,
      repRangeMin: ex.repRangeRecommendation.min,
      repRangeMax: ex.repRangeRecommendation.max,
    };

    const existing = await prisma.exercise.findUnique({ where: { name: ex.name } });
    if (existing) {
      await prisma.exercise.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.exercise.create({ data: { name: ex.name, ...data } });
      created++;
    }
  }
  console.log(`  ${created} created, ${updated} updated.`);
}

async function seedExerciseMusclesFromJson() {
  console.log("Seeding exercise-muscle mappings from JSON...");

  const exercisesByName = new Map(
    (await prisma.exercise.findMany()).map((e) => [e.name, e])
  );
  const musclesByName = new Map(
    (await prisma.muscle.findMany()).map((m) => [m.name, m])
  );

  let mappingsCreated = 0;
  let exerciseCount = 0;
  const notFound: string[] = [];

  for (const ex of exercisesJson.exercises) {
    const exercise = exercisesByName.get(ex.name);
    if (!exercise) {
      notFound.push(ex.name);
      continue;
    }

    // Clear existing mappings
    await prisma.exerciseMuscle.deleteMany({ where: { exerciseId: exercise.id } });

    for (const muscleName of ex.primaryMuscles) {
      const muscle = musclesByName.get(muscleName);
      if (!muscle) {
        console.warn(`  ⚠ Unknown muscle "${muscleName}" in ${ex.name}`);
        continue;
      }
      await prisma.exerciseMuscle.create({
        data: { exerciseId: exercise.id, muscleId: muscle.id, role: MuscleRole.PRIMARY },
      });
      mappingsCreated++;
    }

    for (const muscleName of ex.secondaryMuscles) {
      const muscle = musclesByName.get(muscleName);
      if (!muscle) {
        console.warn(`  ⚠ Unknown muscle "${muscleName}" in ${ex.name}`);
        continue;
      }
      await prisma.exerciseMuscle.create({
        data: { exerciseId: exercise.id, muscleId: muscle.id, role: MuscleRole.SECONDARY },
      });
      mappingsCreated++;
    }

    exerciseCount++;
  }

  console.log(`  ${mappingsCreated} mappings across ${exerciseCount} exercises.`);
  if (notFound.length > 0) {
    console.warn(`  ⚠ Exercises not found in DB (${notFound.length}): ${notFound.join(", ")}`);
  }
}

async function seedExerciseEquipmentFromJson() {
  console.log("Seeding exercise-equipment mappings from JSON...");

  const exercisesByName = new Map(
    (await prisma.exercise.findMany()).map((e) => [e.name, e])
  );
  const equipmentByName = new Map(
    (await prisma.equipment.findMany()).map((e) => [e.name, e])
  );

  let mappings = 0;

  for (const ex of exercisesJson.exercises) {
    const exercise = exercisesByName.get(ex.name);
    if (!exercise) continue;

    // Clear existing
    await prisma.exerciseEquipment.deleteMany({ where: { exerciseId: exercise.id } });

    for (const equipName of ex.equipment) {
      const equipment = equipmentByName.get(equipName);
      if (!equipment) {
        console.warn(`  ⚠ Unknown equipment "${equipName}" in ${ex.name}`);
        continue;
      }
      await prisma.exerciseEquipment.create({
        data: { exerciseId: exercise.id, equipmentId: equipment.id },
      });
      mappings++;
    }
  }

  console.log(`  ${mappings} equipment mappings created.`);
}

async function seedExerciseAliases() {
  console.log("Seeding exercise aliases...");
  const exercisesByName = new Map(
    (await prisma.exercise.findMany()).map((e) => [e.name, e])
  );

  let created = 0;
  let skipped = 0;
  for (const entry of exerciseAliases) {
    const exercise = exercisesByName.get(entry.exerciseName);
    if (!exercise) {
      skipped++;
      continue;
    }
    // Don't create alias if it matches an existing exercise name
    const conflicting = exercisesByName.get(entry.alias);
    if (conflicting) {
      continue;
    }
    await prisma.exerciseAlias.upsert({
      where: { alias: entry.alias },
      update: { exerciseId: exercise.id },
      create: { alias: entry.alias, exerciseId: exercise.id },
    });
    created++;
  }
  console.log(`  ${created} aliases seeded, ${skipped} skipped (no matching exercise).`);
}

async function seedOwner() {
  const configuredOwnerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (configuredOwnerEmail) {
    return prisma.user.upsert({
      where: { email: configuredOwnerEmail },
      update: {},
      create: { email: configuredOwnerEmail },
    });
  }

  const withProfile = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
    where: {
      profile: { isNot: null },
      goals: { isNot: null },
      constraints: { isNot: null },
    },
  });
  if (withProfile) {
    return withProfile;
  }

  const firstUser = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
    where: { email: { not: { endsWith: "@test.com" } } },
  });
  if (firstUser) {
    return firstUser;
  }

  return prisma.user.create({
    data: { email: "owner@local" },
  });
}

async function buildExerciseNameLookup(): Promise<Map<string, string>> {
  const exercises = await prisma.exercise.findMany({
    include: { aliases: true },
  });

  const nameToId = new Map<string, string>();
  for (const exercise of exercises) {
    nameToId.set(exercise.name.toLowerCase(), exercise.id);
    for (const alias of exercise.aliases) {
      nameToId.set(alias.alias.toLowerCase(), exercise.id);
    }
  }

  return nameToId;
}

async function seedWorkoutTemplates(userId: string) {
  console.log("Seeding workout templates...");
  const nameToId = await buildExerciseNameLookup();

  let created = 0;
  let updated = 0;

  for (const template of workoutTemplateSeed) {
    const exerciseIds = template.exercises.map((exerciseName) => {
      const exerciseId = nameToId.get(exerciseName.toLowerCase());
      if (!exerciseId) {
        throw new Error(
          `Missing exercise mapping for template "${template.name}": "${exerciseName}"`
        );
      }
      return exerciseId;
    });

    await prisma.$transaction(async (tx) => {
      const existing = await tx.workoutTemplate.findFirst({
        where: { userId, name: template.name },
        select: { id: true },
      });

      let templateId: string;

      if (existing) {
        templateId = existing.id;
        await tx.workoutTemplate.update({
          where: { id: templateId },
          data: {
            targetMuscles: template.targetMuscles,
            isStrict: template.isStrict,
          },
        });
        await tx.workoutTemplateExercise.deleteMany({
          where: { templateId },
        });
        updated++;
      } else {
        const createdTemplate = await tx.workoutTemplate.create({
          data: {
            userId,
            name: template.name,
            targetMuscles: template.targetMuscles,
            isStrict: template.isStrict,
          },
          select: { id: true },
        });
        templateId = createdTemplate.id;
        created++;
      }

      await tx.workoutTemplateExercise.createMany({
        data: exerciseIds.map((exerciseId, orderIndex) => ({
          templateId,
          exerciseId,
          orderIndex,
        })),
      });
    });
  }

  console.log(`  ${created} templates created, ${updated} updated.`);
}

async function pruneStaleExercises() {
  const canonicalNames = new Set(exercisesJson.exercises.map((e) => e.name));
  const allExercises = await prisma.exercise.findMany({
    include: {
      workoutExercises: { select: { id: true }, take: 1 },
      templateExercises: { select: { id: true }, take: 1 },
    },
  });

  const stale = allExercises.filter((e) => !canonicalNames.has(e.name));
  if (stale.length === 0) {
    console.log("  No stale exercises to prune.");
    return;
  }

  let pruned = 0;
  const kept: string[] = [];

  for (const exercise of stale) {
    const hasHistory = exercise.workoutExercises.length > 0;
    const hasTemplates = exercise.templateExercises.length > 0;

    if (hasHistory || hasTemplates) {
      const reasons = [
        hasHistory && "workout history",
        hasTemplates && "templates",
      ].filter(Boolean);
      kept.push(`${exercise.name} (${reasons.join(", ")})`);
      continue;
    }

    // Safe to delete — remove related records first (no cascade)
    await prisma.exerciseMuscle.deleteMany({ where: { exerciseId: exercise.id } });
    await prisma.exerciseEquipment.deleteMany({ where: { exerciseId: exercise.id } });
    await prisma.exerciseAlias.deleteMany({ where: { exerciseId: exercise.id } });
    await prisma.exerciseVariation.deleteMany({ where: { exerciseId: exercise.id } });
    await prisma.substitutionRule.deleteMany({
      where: { OR: [{ fromExerciseId: exercise.id }, { toExerciseId: exercise.id }] },
    });
    await prisma.exercise.delete({ where: { id: exercise.id } });
    pruned++;
  }

  console.log(`  Pruned ${pruned} stale exercises.`);
  if (kept.length > 0) {
    console.warn(`  ⚠ Kept ${kept.length} non-canonical exercises (referenced by user data):`);
    for (const k of kept) {
      console.warn(`    - ${k}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  await renameExercises();
  await renameMuscles();
  await seedEquipment();
  await seedMuscles();
  await seedExercisesFromJson();
  await seedExerciseAliases();
  await seedExerciseMusclesFromJson();
  await seedExerciseEquipmentFromJson();
  const user = await seedOwner();
  await seedWorkoutTemplates(user.id);
  console.log("Pruning stale exercises...");
  await pruneStaleExercises();
  console.log("✅ Seed complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

