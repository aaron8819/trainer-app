import "dotenv/config";
import {
  BaselineCategory,
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

// ═══════════════════════════════════════════════════════════════════════════
// Seed data — Baselines
// ═══════════════════════════════════════════════════════════════════════════

const baselineSeed = [
  {
    exerciseName: "Barbell Back Squat",
    category: BaselineCategory.MAIN_LIFT,
    context: "heavy",
    topSetWeight: 185,
    topSetReps: 5,
    workingWeightMin: 180,
    workingWeightMax: 185,
    workingRepsMin: 3,
    workingRepsMax: 5,
    projected1RMMin: 205,
    projected1RMMax: 215,
    notes: "Heavy days",
  },
  {
    exerciseName: "Barbell Back Squat",
    category: BaselineCategory.MAIN_LIFT,
    context: "volume",
    workingWeightMin: 165,
    workingWeightMax: 175,
    workingRepsMin: 5,
    workingRepsMax: 8,
    notes: "Volume days",
  },
  {
    exerciseName: "Flat Barbell Bench Press",
    category: BaselineCategory.MAIN_LIFT,
    context: "strength",
    topSetWeight: 175,
    topSetReps: 5,
    workingWeightMin: 175,
    workingWeightMax: 180,
    workingRepsMin: 4,
    workingRepsMax: 6,
    projected1RMMin: 195,
    projected1RMMax: 205,
    notes: "Strength",
  },
  {
    exerciseName: "Flat Barbell Bench Press",
    category: BaselineCategory.MAIN_LIFT,
    context: "volume",
    workingWeightMin: 155,
    workingWeightMax: 165,
    workingRepsMin: 8,
    workingRepsMax: 10,
    notes: "Volume",
  },
  {
    exerciseName: "Conventional Deadlift",
    category: BaselineCategory.MAIN_LIFT,
    context: "strength",
    topSetWeight: 185,
    topSetReps: 5,
    workingWeightMin: 180,
    workingWeightMax: 190,
    workingRepsMin: 3,
    workingRepsMax: 5,
    projected1RMMin: 215,
    projected1RMMax: 225,
    notes: "Strength",
  },
  {
    exerciseName: "Conventional Deadlift",
    category: BaselineCategory.MAIN_LIFT,
    context: "volume",
    workingWeightMin: 155,
    workingWeightMax: 170,
    workingRepsMin: 6,
    workingRepsMax: 10,
    notes: "Volume",
  },
  {
    exerciseName: "Overhead Press",
    category: BaselineCategory.MAIN_LIFT,
    topSetWeight: 85,
    topSetReps: 5,
  },
  {
    exerciseName: "DB Shoulder Press",
    category: BaselineCategory.DUMBBELL,
    workingWeightMin: 45,
    workingWeightMax: 45,
  },
  {
    exerciseName: "Incline Barbell Bench",
    category: BaselineCategory.BARBELL_ACCESSORY,
    topSetWeight: 155,
    topSetReps: 3,
  },
  {
    exerciseName: "Romanian Deadlift (BB)",
    category: BaselineCategory.BARBELL_ACCESSORY,
    topSetWeight: 165,
    topSetReps: 4,
  },
  {
    exerciseName: "Incline DB Press",
    category: BaselineCategory.DUMBBELL,
    workingWeightMin: 55,
    workingWeightMax: 55,
  },
  {
    exerciseName: "Flat DB Press",
    category: BaselineCategory.DUMBBELL,
    workingWeightMin: 50,
    workingWeightMax: 50,
  },
  {
    exerciseName: "One-Arm DB Row",
    category: BaselineCategory.DUMBBELL,
    workingWeightMin: 60,
    workingWeightMax: 60,
  },
  {
    exerciseName: "DB Romanian Deadlift",
    category: BaselineCategory.DUMBBELL,
    workingWeightMin: 35,
    workingWeightMax: 45,
  },
  {
    exerciseName: "Incline DB Curls",
    category: BaselineCategory.DUMBBELL,
    workingWeightMin: 20,
    workingWeightMax: 20,
  },
  {
    exerciseName: "DB Skull Crushers",
    category: BaselineCategory.DUMBBELL,
    workingWeightMin: 17.5,
    workingWeightMax: 17.5,
  },
  {
    exerciseName: "DB Lateral Raise",
    category: BaselineCategory.DUMBBELL,
    workingWeightMin: 12.5,
    workingWeightMax: 12.5,
  },
  {
    exerciseName: "Front-Foot Elevated Split Squat",
    category: BaselineCategory.DUMBBELL,
    workingWeightMin: 20,
    workingWeightMax: 20,
  },
  {
    exerciseName: "Chest-Supported Row",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 100,
    workingWeightMax: 125,
  },
  {
    exerciseName: "Seated Cable Row",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 50,
    workingWeightMax: 60,
    notes: "Per side",
  },
  {
    exerciseName: "Lat Pulldown",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 115,
    workingWeightMax: 130,
  },
  {
    exerciseName: "Lat Pulldown",
    category: BaselineCategory.MACHINE_CABLE,
    context: "light",
    workingWeightMin: 45,
    workingWeightMax: 50,
    notes: "Straight-arm variation",
  },
  {
    exerciseName: "Face Pulls (Rope)",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 40,
    workingWeightMax: 40,
  },
  {
    exerciseName: "Barbell Row",
    category: BaselineCategory.MACHINE_CABLE,
    context: "shrug",
    workingWeightMin: 160,
    workingWeightMax: 160,
    notes: "Machine shrug equivalent",
  },
  {
    exerciseName: "Machine Shoulder Press",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 55,
    workingWeightMax: 55,
  },
  {
    exerciseName: "Hammer Curl",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 35,
    workingWeightMax: 40,
    notes: "Rope variation",
  },
  {
    exerciseName: "Tricep Rope Pushdown",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 35,
    workingWeightMax: 35,
  },
  {
    exerciseName: "Machine Rear Delt Fly",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 80,
    workingWeightMax: 80,
  },
  {
    exerciseName: "Dips",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 105.5,
    workingWeightMax: 105.5,
    notes: "Assisted — weight is assistance level",
  },
  {
    exerciseName: "Leg Press",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 180,
    workingWeightMax: 180,
    notes: "Total weight",
  },
  {
    exerciseName: "Decline Barbell Bench",
    category: BaselineCategory.BENCH_VARIATION,
    workingWeightMin: 155,
    workingWeightMax: 160,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Seed functions
// ═══════════════════════════════════════════════════════════════════════════

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
      await prisma.baseline.deleteMany({ where: { exerciseId: existing.id } });
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
      // Also update baseline denormalized name
      await prisma.baseline.updateMany({
        where: { exerciseId: existing.id },
        data: { exerciseName: newName },
      });
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
  return prisma.user.upsert({
    where: { email: "owner@local" },
    update: {},
    create: { email: "owner@local" },
  });
}

async function seedBaselines(userId: string) {
  // Build name → exercise ID lookup (includes aliases)
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

  let seeded = 0;
  let skipped = 0;
  for (const baseline of baselineSeed) {
    const exerciseId = nameToId.get(baseline.exerciseName.toLowerCase());
    if (!exerciseId) {
      skipped++;
      continue;
    }

    const context = baseline.context ?? "default";
    await prisma.baseline.upsert({
      where: {
        userId_exerciseId_context: {
          userId,
          exerciseId,
          context,
        },
      },
      update: {
        ...baseline,
        exerciseId,
        context,
        userId,
      },
      create: {
        ...baseline,
        exerciseId,
        context,
        userId,
      },
    });
    seeded++;
  }
  console.log(`  ${seeded} baselines seeded, ${skipped} skipped (no matching exercise).`);
}

async function pruneStaleExercises() {
  const canonicalNames = new Set(exercisesJson.exercises.map((e) => e.name));
  const allExercises = await prisma.exercise.findMany({
    include: {
      workoutExercises: { select: { id: true }, take: 1 },
      templateExercises: { select: { id: true }, take: 1 },
      baselines: { select: { id: true }, take: 1 },
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
    await prisma.baseline.deleteMany({ where: { exerciseId: exercise.id } });
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
  await seedBaselines(user.id);
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
