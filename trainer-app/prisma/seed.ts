import "dotenv/config";
import {
  BaselineCategory,
  EquipmentType,
  JointStress,
  MovementPattern,
  MovementPatternV2,
  MuscleRole,
  SplitTag,
  StimulusBias,
  PrismaClient,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

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

type SeedExercise = {
  name: string;
  movementPattern: MovementPattern;
  jointStress: JointStress;
  isMainLift: boolean;
  equipment: string[];
};

type MuscleMappingEntry = { muscle: string; role: MuscleRole };

type ExerciseAliasSeed = { exerciseName: string; alias: string };

// ═══════════════════════════════════════════════════════════════════════════
// Regex helpers
// ═══════════════════════════════════════════════════════════════════════════

const HORIZONTAL_PUSH_REGEX = /(bench|chest|incline|decline|dip|push[- ]?up)/i;
const VERTICAL_PUSH_REGEX = /(overhead|shoulder|arnold|military|strict press)/i;
const HORIZONTAL_PULL_REGEX = /(row|t-bar|chest-supported)/i;
const VERTICAL_PULL_REGEX = /(pull[- ]?up|pulldown|lat|chin)/i;
const CORE_REGEX = /(plank|dead bug|pallof|leg raise|knee raise|cable crunch|ab wheel|core)/i;
const MOBILITY_REGEX = /(stretch|mobility|soft tissue|pose|hip flexor|arm circles)/i;
const PREHAB_REGEX = /(band pull-aparts|scapular|prone y-t|prehab)/i;
const CONDITIONING_REGEX = /(sled|carry)/i;

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
];

// ═══════════════════════════════════════════════════════════════════════════
// Seed data — Muscles (17 canonical)
// ═══════════════════════════════════════════════════════════════════════════

const muscleSeed = [
  "Chest",
  "Back",
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
  "Calves",
  "Core",
  "Hip Flexors",
];

// ═══════════════════════════════════════════════════════════════════════════
// Seed data — Exercises
// ═══════════════════════════════════════════════════════════════════════════

const exercises: SeedExercise[] = [
  { name: "Barbell Back Squat", movementPattern: MovementPattern.SQUAT, jointStress: JointStress.HIGH, isMainLift: true, equipment: ["Barbell", "Rack"] },
  { name: "Front Squat", movementPattern: MovementPattern.SQUAT, jointStress: JointStress.HIGH, isMainLift: true, equipment: ["Barbell", "Rack"] },
  { name: "Hack Squat", movementPattern: MovementPattern.SQUAT, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Machine"] },
  { name: "Reverse Hack Squat", movementPattern: MovementPattern.SQUAT, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Machine"] },
  { name: "Leg Press", movementPattern: MovementPattern.SQUAT, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Machine"] },
  { name: "Belt Squat", movementPattern: MovementPattern.SQUAT, jointStress: JointStress.MEDIUM, isMainLift: true, equipment: ["Machine"] },
  { name: "Romanian Deadlift", movementPattern: MovementPattern.HINGE, jointStress: JointStress.MEDIUM, isMainLift: true, equipment: ["Barbell"] },
  { name: "Conventional Deadlift", movementPattern: MovementPattern.HINGE, jointStress: JointStress.HIGH, isMainLift: true, equipment: ["Barbell"] },
  { name: "Trap Bar Deadlift", movementPattern: MovementPattern.HINGE, jointStress: JointStress.HIGH, isMainLift: true, equipment: ["Barbell"] },
  { name: "Hip Thrust", movementPattern: MovementPattern.HINGE, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Barbell", "Bench"] },
  { name: "Barbell Bench Press", movementPattern: MovementPattern.PUSH, jointStress: JointStress.HIGH, isMainLift: true, equipment: ["Barbell", "Bench", "Rack"] },
  { name: "Incline Barbell Bench", movementPattern: MovementPattern.PUSH, jointStress: JointStress.HIGH, isMainLift: true, equipment: ["Barbell", "Bench"] },
  { name: "Smith Machine Incline Press", movementPattern: MovementPattern.PUSH, jointStress: JointStress.MEDIUM, isMainLift: true, equipment: ["Machine"] },
  { name: "Dumbbell Bench Press", movementPattern: MovementPattern.PUSH, jointStress: JointStress.MEDIUM, isMainLift: true, equipment: ["Dumbbell", "Bench"] },
  { name: "Dumbbell Incline Press", movementPattern: MovementPattern.PUSH, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Dumbbell", "Bench"] },
  { name: "Low-Incline Dumbbell Press", movementPattern: MovementPattern.PUSH, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Dumbbell", "Bench"] },
  { name: "Push-Up", movementPattern: MovementPattern.PUSH, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Bodyweight"] },
  { name: "Overhead Press", movementPattern: MovementPattern.PUSH, jointStress: JointStress.HIGH, isMainLift: true, equipment: ["Barbell"] },
  { name: "Dumbbell Shoulder Press", movementPattern: MovementPattern.PUSH, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Dumbbell", "Bench"] },
  { name: "Lateral Raise", movementPattern: MovementPattern.PUSH_PULL, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Dumbbell"] },
  { name: "Dumbbell Lateral Raises", movementPattern: MovementPattern.PUSH_PULL, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Dumbbell"] },
  { name: "Cable Lateral Raise", movementPattern: MovementPattern.PUSH_PULL, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Cable"] },
  { name: "Face Pull", movementPattern: MovementPattern.PULL, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Cable"] },
  { name: "Machine Rear Delt Fly", movementPattern: MovementPattern.PULL, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Machine"] },
  { name: "Pull-Up", movementPattern: MovementPattern.PULL, jointStress: JointStress.HIGH, isMainLift: true, equipment: ["Bodyweight"] },
  { name: "Lat Pulldown", movementPattern: MovementPattern.PULL, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Cable", "Machine"] },
  { name: "Barbell Row", movementPattern: MovementPattern.PULL, jointStress: JointStress.MEDIUM, isMainLift: true, equipment: ["Barbell"] },
  { name: "Seated Cable Row", movementPattern: MovementPattern.PULL, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Cable"] },
  { name: "Chest-Supported Row", movementPattern: MovementPattern.PULL, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Dumbbell", "Bench"] },
  { name: "Chest-Supported T-Bar Row", movementPattern: MovementPattern.PULL, jointStress: JointStress.MEDIUM, isMainLift: true, equipment: ["Machine"] },
  { name: "Single-Arm Dumbbell Row", movementPattern: MovementPattern.PULL, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Dumbbell", "Bench"] },
  { name: "Dumbbell Curl", movementPattern: MovementPattern.PULL, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Dumbbell"] },
  { name: "Barbell Curl", movementPattern: MovementPattern.PULL, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Barbell"] },
  { name: "Hammer Curl", movementPattern: MovementPattern.PULL, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Dumbbell"] },
  { name: "Incline Dumbbell Curl", movementPattern: MovementPattern.PULL, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Dumbbell", "Bench"] },
  { name: "Bayesian Curl", movementPattern: MovementPattern.PULL, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Cable"] },
  { name: "Cable Preacher Curl", movementPattern: MovementPattern.PULL, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Cable"] },
  { name: "Triceps Pushdown", movementPattern: MovementPattern.PUSH, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Cable"] },
  { name: "JM Press", movementPattern: MovementPattern.PUSH, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Barbell", "Bench"] },
  { name: "Skull Crusher", movementPattern: MovementPattern.PUSH, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Barbell", "Bench"] },
  { name: "Dips", movementPattern: MovementPattern.PUSH, jointStress: JointStress.HIGH, isMainLift: false, equipment: ["Bodyweight"] },
  { name: "Overhead Triceps Extension", movementPattern: MovementPattern.PUSH, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Dumbbell"] },
  { name: "Leg Extension", movementPattern: MovementPattern.SQUAT, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Machine"] },
  { name: "Leg Curl", movementPattern: MovementPattern.HINGE, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Machine"] },
  { name: "Standing Calf Raise", movementPattern: MovementPattern.CARRY, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Machine"] },
  { name: "Seated Calf Raise", movementPattern: MovementPattern.CARRY, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Machine"] },
  { name: "Hip Abduction Machine", movementPattern: MovementPattern.HINGE, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Machine"] },
  { name: "Plank", movementPattern: MovementPattern.ROTATE, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Bodyweight"] },
  { name: "Hanging Leg Raise", movementPattern: MovementPattern.ROTATE, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Bodyweight"] },
  { name: "Cable Crunch", movementPattern: MovementPattern.ROTATE, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Cable"] },
  { name: "Pallof Press", movementPattern: MovementPattern.ROTATE, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Cable"] },
  { name: "Farmer's Carry", movementPattern: MovementPattern.CARRY, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Dumbbell"] },
  { name: "Sled Push", movementPattern: MovementPattern.CARRY, jointStress: JointStress.HIGH, isMainLift: false, equipment: ["Sled"] },
  { name: "Sled Pull", movementPattern: MovementPattern.CARRY, jointStress: JointStress.HIGH, isMainLift: false, equipment: ["Sled"] },
  { name: "Sled Drag", movementPattern: MovementPattern.CARRY, jointStress: JointStress.HIGH, isMainLift: false, equipment: ["Sled"] },
  { name: "Walking Lunge", movementPattern: MovementPattern.LUNGE, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Dumbbell"] },
  { name: "Split Squat", movementPattern: MovementPattern.LUNGE, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Dumbbell"] },
  { name: "Bulgarian Split Squat", movementPattern: MovementPattern.LUNGE, jointStress: JointStress.HIGH, isMainLift: false, equipment: ["Dumbbell", "Bench"] },
  { name: "Glute Bridge", movementPattern: MovementPattern.HINGE, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Bodyweight"] },
  { name: "Cable Fly", movementPattern: MovementPattern.PUSH, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Cable"] },
  { name: "Machine Chest Press", movementPattern: MovementPattern.PUSH, jointStress: JointStress.MEDIUM, isMainLift: true, equipment: ["Machine"] },
  { name: "Pec Deck", movementPattern: MovementPattern.PUSH, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Machine"] },
  { name: "Machine Shoulder Press", movementPattern: MovementPattern.PUSH, jointStress: JointStress.MEDIUM, isMainLift: false, equipment: ["Machine"] },
  { name: "T-Bar Row", movementPattern: MovementPattern.PULL, jointStress: JointStress.MEDIUM, isMainLift: true, equipment: ["Machine"] },
  { name: "Reverse Fly", movementPattern: MovementPattern.PULL, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Dumbbell"] },
  { name: "Dead Bug", movementPattern: MovementPattern.ROTATE, jointStress: JointStress.LOW, isMainLift: false, equipment: ["Bodyweight"] },
];

// ═══════════════════════════════════════════════════════════════════════════
// Unified exercise field tuning — all 66 exercises
// fatigueCost (1-5), timePerSetSec, sfrScore (1-5), lengthPositionScore (1-5),
// stimulusBias, contraindications
// ═══════════════════════════════════════════════════════════════════════════

type ExerciseTuning = {
  fatigueCost: number;
  timePerSetSec: number;
  sfrScore: number;
  lengthPositionScore: number;
  stimulusBias: StimulusBias[];
  contraindications?: Record<string, boolean>;
};

const EXERCISE_FIELD_TUNING: Record<string, ExerciseTuning> = {
  // ── Squat Pattern ──────────────────────────────────────────────────────
  "Barbell Back Squat":      { fatigueCost: 5, timePerSetSec: 210, sfrScore: 1, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL], contraindications: { knee: true, low_back: true } },
  "Front Squat":             { fatigueCost: 4, timePerSetSec: 180, sfrScore: 2, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL], contraindications: { knee: true } },
  "Hack Squat":              { fatigueCost: 3, timePerSetSec: 150, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "Reverse Hack Squat":      { fatigueCost: 3, timePerSetSec: 150, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "Leg Press":               { fatigueCost: 3, timePerSetSec: 120, sfrScore: 4, lengthPositionScore: 2, stimulusBias: [StimulusBias.MECHANICAL], contraindications: { knee: true } },
  "Belt Squat":              { fatigueCost: 3, timePerSetSec: 150, sfrScore: 3, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "Leg Extension":           { fatigueCost: 2, timePerSetSec: 90, sfrScore: 5, lengthPositionScore: 2, stimulusBias: [StimulusBias.METABOLIC] },

  // ── Hinge Pattern ──────────────────────────────────────────────────────
  "Romanian Deadlift":       { fatigueCost: 3, timePerSetSec: 150, sfrScore: 2, lengthPositionScore: 4, stimulusBias: [StimulusBias.STRETCH], contraindications: { low_back: true } },
  "Conventional Deadlift":   { fatigueCost: 5, timePerSetSec: 210, sfrScore: 1, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL], contraindications: { low_back: true } },
  "Trap Bar Deadlift":       { fatigueCost: 5, timePerSetSec: 210, sfrScore: 1, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL], contraindications: { low_back: true } },
  "Hip Thrust":              { fatigueCost: 3, timePerSetSec: 120, sfrScore: 3, lengthPositionScore: 2, stimulusBias: [StimulusBias.MECHANICAL] },
  "Leg Curl":                { fatigueCost: 2, timePerSetSec: 90, sfrScore: 5, lengthPositionScore: 3, stimulusBias: [StimulusBias.METABOLIC] },
  "Hip Abduction Machine":   { fatigueCost: 1, timePerSetSec: 75, sfrScore: 5, lengthPositionScore: 3, stimulusBias: [StimulusBias.METABOLIC] },
  "Glute Bridge":            { fatigueCost: 1, timePerSetSec: 60, sfrScore: 4, lengthPositionScore: 1, stimulusBias: [StimulusBias.STABILITY] },

  // ── Lunge Pattern ──────────────────────────────────────────────────────
  "Walking Lunge":           { fatigueCost: 3, timePerSetSec: 120, sfrScore: 3, lengthPositionScore: 4, stimulusBias: [StimulusBias.MECHANICAL], contraindications: { knee: true } },
  "Split Squat":             { fatigueCost: 2, timePerSetSec: 120, sfrScore: 3, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "Bulgarian Split Squat":   { fatigueCost: 3, timePerSetSec: 120, sfrScore: 3, lengthPositionScore: 4, stimulusBias: [StimulusBias.STRETCH], contraindications: { knee: true } },

  // ── Calves ─────────────────────────────────────────────────────────────
  "Standing Calf Raise":     { fatigueCost: 2, timePerSetSec: 75, sfrScore: 4, lengthPositionScore: 5, stimulusBias: [StimulusBias.METABOLIC] },
  "Seated Calf Raise":       { fatigueCost: 2, timePerSetSec: 75, sfrScore: 4, lengthPositionScore: 4, stimulusBias: [StimulusBias.METABOLIC] },

  // ── Push — Pressing ────────────────────────────────────────────────────
  "Barbell Bench Press":     { fatigueCost: 4, timePerSetSec: 180, sfrScore: 2, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "Incline Barbell Bench":   { fatigueCost: 4, timePerSetSec: 180, sfrScore: 2, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "Smith Machine Incline Press": { fatigueCost: 3, timePerSetSec: 150, sfrScore: 3, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "Dumbbell Bench Press":    { fatigueCost: 3, timePerSetSec: 150, sfrScore: 3, lengthPositionScore: 4, stimulusBias: [StimulusBias.MECHANICAL, StimulusBias.STRETCH] },
  "Dumbbell Incline Press":  { fatigueCost: 3, timePerSetSec: 120, sfrScore: 3, lengthPositionScore: 4, stimulusBias: [StimulusBias.MECHANICAL, StimulusBias.STRETCH] },
  "Low-Incline Dumbbell Press": { fatigueCost: 3, timePerSetSec: 120, sfrScore: 3, lengthPositionScore: 4, stimulusBias: [StimulusBias.MECHANICAL, StimulusBias.STRETCH] },
  "Push-Up":                 { fatigueCost: 1, timePerSetSec: 75, sfrScore: 3, lengthPositionScore: 3, stimulusBias: [StimulusBias.METABOLIC] },
  "Overhead Press":          { fatigueCost: 4, timePerSetSec: 180, sfrScore: 2, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL], contraindications: { shoulder: true } },
  "Dumbbell Shoulder Press": { fatigueCost: 3, timePerSetSec: 120, sfrScore: 3, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL], contraindications: { shoulder: true } },
  "Machine Chest Press":     { fatigueCost: 3, timePerSetSec: 120, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "Machine Shoulder Press":  { fatigueCost: 3, timePerSetSec: 120, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL], contraindications: { shoulder: true } },

  // ── Push — Accessories ─────────────────────────────────────────────────
  "Triceps Pushdown":        { fatigueCost: 2, timePerSetSec: 75, sfrScore: 4, lengthPositionScore: 1, stimulusBias: [StimulusBias.METABOLIC] },
  "JM Press":                { fatigueCost: 3, timePerSetSec: 90, sfrScore: 3, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "Skull Crusher":           { fatigueCost: 3, timePerSetSec: 90, sfrScore: 3, lengthPositionScore: 4, stimulusBias: [StimulusBias.STRETCH], contraindications: { elbow: true } },
  "Dips":                    { fatigueCost: 3, timePerSetSec: 120, sfrScore: 3, lengthPositionScore: 4, stimulusBias: [StimulusBias.MECHANICAL], contraindications: { shoulder: true } },
  "Overhead Triceps Extension": { fatigueCost: 2, timePerSetSec: 75, sfrScore: 4, lengthPositionScore: 5, stimulusBias: [StimulusBias.STRETCH], contraindications: { shoulder: true, elbow: true } },
  "Cable Fly":               { fatigueCost: 2, timePerSetSec: 75, sfrScore: 4, lengthPositionScore: 5, stimulusBias: [StimulusBias.STRETCH] },
  "Pec Deck":                { fatigueCost: 2, timePerSetSec: 75, sfrScore: 5, lengthPositionScore: 4, stimulusBias: [StimulusBias.STRETCH] },
  "Lateral Raise":           { fatigueCost: 2, timePerSetSec: 75, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.METABOLIC] },
  "Dumbbell Lateral Raises": { fatigueCost: 2, timePerSetSec: 75, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.METABOLIC] },
  "Cable Lateral Raise":     { fatigueCost: 2, timePerSetSec: 75, sfrScore: 5, lengthPositionScore: 3, stimulusBias: [StimulusBias.METABOLIC] },

  // ── Pull — Rows / Pulls ────────────────────────────────────────────────
  "Pull-Up":                 { fatigueCost: 3, timePerSetSec: 120, sfrScore: 2, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "Lat Pulldown":            { fatigueCost: 3, timePerSetSec: 90, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "Barbell Row":             { fatigueCost: 4, timePerSetSec: 150, sfrScore: 2, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL], contraindications: { low_back: true } },
  "Seated Cable Row":        { fatigueCost: 2, timePerSetSec: 90, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "Chest-Supported Row":     { fatigueCost: 2, timePerSetSec: 90, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "Chest-Supported T-Bar Row": { fatigueCost: 3, timePerSetSec: 120, sfrScore: 3, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "Single-Arm Dumbbell Row": { fatigueCost: 2, timePerSetSec: 90, sfrScore: 3, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL] },
  "T-Bar Row":               { fatigueCost: 3, timePerSetSec: 150, sfrScore: 3, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL], contraindications: { low_back: true } },
  "Face Pull":               { fatigueCost: 2, timePerSetSec: 75, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.METABOLIC] },
  "Machine Rear Delt Fly":   { fatigueCost: 2, timePerSetSec: 75, sfrScore: 5, lengthPositionScore: 3, stimulusBias: [StimulusBias.METABOLIC] },
  "Reverse Fly":             { fatigueCost: 2, timePerSetSec: 75, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.METABOLIC] },

  // ── Pull — Arm Accessories ─────────────────────────────────────────────
  "Dumbbell Curl":           { fatigueCost: 2, timePerSetSec: 75, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.METABOLIC] },
  "Barbell Curl":            { fatigueCost: 2, timePerSetSec: 90, sfrScore: 3, lengthPositionScore: 3, stimulusBias: [StimulusBias.MECHANICAL], contraindications: { elbow: true } },
  "Hammer Curl":             { fatigueCost: 2, timePerSetSec: 75, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.METABOLIC] },
  "Incline Dumbbell Curl":   { fatigueCost: 2, timePerSetSec: 75, sfrScore: 4, lengthPositionScore: 5, stimulusBias: [StimulusBias.STRETCH] },
  "Bayesian Curl":           { fatigueCost: 2, timePerSetSec: 75, sfrScore: 5, lengthPositionScore: 5, stimulusBias: [StimulusBias.STRETCH] },
  "Cable Preacher Curl":     { fatigueCost: 2, timePerSetSec: 75, sfrScore: 5, lengthPositionScore: 3, stimulusBias: [StimulusBias.METABOLIC] },

  // ── Core ───────────────────────────────────────────────────────────────
  "Plank":                   { fatigueCost: 1, timePerSetSec: 60, sfrScore: 3, lengthPositionScore: 1, stimulusBias: [StimulusBias.STABILITY] },
  "Hanging Leg Raise":       { fatigueCost: 2, timePerSetSec: 75, sfrScore: 3, lengthPositionScore: 3, stimulusBias: [StimulusBias.METABOLIC] },
  "Cable Crunch":            { fatigueCost: 1, timePerSetSec: 60, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.METABOLIC] },
  "Pallof Press":            { fatigueCost: 1, timePerSetSec: 60, sfrScore: 4, lengthPositionScore: 3, stimulusBias: [StimulusBias.STABILITY] },
  "Dead Bug":                { fatigueCost: 1, timePerSetSec: 60, sfrScore: 3, lengthPositionScore: 3, stimulusBias: [StimulusBias.STABILITY] },

  // ── Conditioning / Carries ─────────────────────────────────────────────
  "Farmer's Carry":          { fatigueCost: 2, timePerSetSec: 75, sfrScore: 3, lengthPositionScore: 1, stimulusBias: [StimulusBias.STABILITY] },
  "Sled Push":               { fatigueCost: 3, timePerSetSec: 90, sfrScore: 3, lengthPositionScore: 2, stimulusBias: [StimulusBias.METABOLIC] },
  "Sled Pull":               { fatigueCost: 3, timePerSetSec: 90, sfrScore: 3, lengthPositionScore: 2, stimulusBias: [StimulusBias.METABOLIC] },
  "Sled Drag":               { fatigueCost: 3, timePerSetSec: 90, sfrScore: 3, lengthPositionScore: 2, stimulusBias: [StimulusBias.METABOLIC] },
};

const compoundAccessoryNames = new Set<string>([
  "Hack Squat",
  "Reverse Hack Squat",
  "Leg Press",
  "Hip Thrust",
  "Dumbbell Incline Press",
  "Low-Incline Dumbbell Press",
  "Push-Up",
  "Dumbbell Shoulder Press",
  "Machine Shoulder Press",
  "Machine Chest Press",
  "Dips",
  "Walking Lunge",
  "Split Squat",
  "Bulgarian Split Squat",
  "Lat Pulldown",
  "Seated Cable Row",
  "Chest-Supported Row",
  "Single-Arm Dumbbell Row",
  "Chest-Supported T-Bar Row",
  "T-Bar Row",
  "Glute Bridge",
]);

const mainLiftEligibleOverrides = new Set<string>([
  "Dumbbell Shoulder Press",
  "Machine Shoulder Press",
  "Lat Pulldown",
  "Lat Pulldown (wide, neutral, single-arm)",
]);

// Muscle volume landmarks (populated into DB for future user customization)
const MUSCLE_LANDMARKS: Record<string, { mv: number; mev: number; mav: number; mrv: number; sraHours: number }> = {
  "Chest":       { mv: 6,  mev: 10, mav: 16, mrv: 22, sraHours: 60 },
  "Back":        { mv: 6,  mev: 10, mav: 18, mrv: 25, sraHours: 60 },
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
  "Hip Flexors": { mv: 0,  mev: 0,  mav: 4,  mrv: 8,  sraHours: 36 },
};
const exerciseAliases: ExerciseAliasSeed[] = [
  { exerciseName: "Dumbbell Shoulder Press", alias: "DB Shoulder Press" },
  { exerciseName: "Split Squat", alias: "Front-Foot Elevated Split Squat" },
  { exerciseName: "Romanian Deadlift", alias: "Romanian Deadlift (BB)" },
  { exerciseName: "Romanian Deadlift", alias: "DB Romanian Deadlift" },
  { exerciseName: "Dumbbell Incline Press", alias: "Incline DB Press" },
  { exerciseName: "Single-Arm Dumbbell Row", alias: "One-Arm DB Row" },
  { exerciseName: "Incline Dumbbell Curl", alias: "Incline DB Curls" },
  { exerciseName: "Skull Crusher", alias: "DB Skull Crushers" },
  { exerciseName: "Lateral Raise", alias: "DB Lateral Raise" },
  { exerciseName: "Face Pull", alias: "Face Pulls (Rope)" },
  { exerciseName: "Triceps Pushdown", alias: "Tricep Rope Pushdown" },
  { exerciseName: "Barbell Bench Press", alias: "Decline Barbell Bench" },
  { exerciseName: "Dumbbell Bench Press", alias: "Flat DB Press" },
];

// ═══════════════════════════════════════════════════════════════════════════
// Seed data — ExerciseMuscle mappings (all 122 DB exercises)
// ═══════════════════════════════════════════════════════════════════════════

const P = MuscleRole.PRIMARY;
const S = MuscleRole.SECONDARY;

const exerciseMuscleMappings: Record<string, MuscleMappingEntry[]> = {

  // ── Squat Pattern ──────────────────────────────────────────────────────

  "Barbell Back Squat": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Hamstrings", role: S },
    { muscle: "Core", role: S },
    { muscle: "Calves", role: S },
    { muscle: "Lower Back", role: S },
    { muscle: "Adductors", role: S },
  ],
  "Front Squat": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: S },
    { muscle: "Hamstrings", role: S },
    { muscle: "Core", role: S },
    { muscle: "Lower Back", role: S },
    { muscle: "Upper Back", role: S },
  ],
  "Hack Squat": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: S },
  ],
  "Reverse Hack Squat": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: S },
    { muscle: "Hamstrings", role: S },
  ],
  "Leg Press": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: S },
    { muscle: "Hamstrings", role: S },
    { muscle: "Adductors", role: S },
  ],
  "Belt Squat": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Adductors", role: S },
  ],
  "Leg Extension": [
    { muscle: "Quads", role: P },
  ],
  "Bodyweight Squats": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: S },
    { muscle: "Core", role: S },
  ],
  "Goblet Squats": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: S },
    { muscle: "Core", role: S },
    { muscle: "Adductors", role: S },
  ],
  "Goblet Squat Pulses": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: S },
    { muscle: "Core", role: S },
  ],
  "Pause Squats": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Core", role: S },
    { muscle: "Lower Back", role: S },
    { muscle: "Adductors", role: S },
  ],
  "Tempo Squats": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Core", role: S },
    { muscle: "Lower Back", role: S },
    { muscle: "Adductors", role: S },
  ],
  "Smith Machine Squats": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: S },
  ],
  "Banded Squats": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: S },
  ],
  "Wall Sits": [
    { muscle: "Quads", role: P },
    { muscle: "Core", role: S },
  ],
  "Wall Sit Circuits": [
    { muscle: "Quads", role: P },
    { muscle: "Core", role: S },
  ],

  // ── Hinge Pattern ──────────────────────────────────────────────────────

  "Romanian Deadlift": [
    { muscle: "Hamstrings", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Lower Back", role: S },
    { muscle: "Core", role: S },
  ],
  "Conventional Deadlift": [
    { muscle: "Hamstrings", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Lower Back", role: P },
    { muscle: "Quads", role: S },
    { muscle: "Upper Back", role: S },
    { muscle: "Core", role: S },
    { muscle: "Forearms", role: S },
  ],
  "Barbell Deadlift": [
    { muscle: "Hamstrings", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Lower Back", role: P },
    { muscle: "Quads", role: S },
    { muscle: "Upper Back", role: S },
    { muscle: "Core", role: S },
    { muscle: "Forearms", role: S },
  ],
  "Trap Bar Deadlift": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Hamstrings", role: S },
    { muscle: "Lower Back", role: S },
    { muscle: "Upper Back", role: S },
    { muscle: "Core", role: S },
    { muscle: "Forearms", role: S },
  ],
  "Dumbbell Romanian Deadlift": [
    { muscle: "Hamstrings", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Lower Back", role: S },
    { muscle: "Core", role: S },
  ],
  "Rack Pulls": [
    { muscle: "Lower Back", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Hamstrings", role: S },
    { muscle: "Upper Back", role: S },
    { muscle: "Forearms", role: S },
  ],
  "Hip Thrust": [
    { muscle: "Glutes", role: P },
    { muscle: "Hamstrings", role: S },
    { muscle: "Core", role: S },
    { muscle: "Adductors", role: S },
  ],
  "Barbell Hip Thrust": [
    { muscle: "Glutes", role: P },
    { muscle: "Hamstrings", role: S },
    { muscle: "Core", role: S },
    { muscle: "Adductors", role: S },
  ],
  "Dumbbell Hip Thrusts": [
    { muscle: "Glutes", role: P },
    { muscle: "Hamstrings", role: S },
    { muscle: "Core", role: S },
  ],
  "Glute Bridge": [
    { muscle: "Glutes", role: P },
    { muscle: "Hamstrings", role: S },
    { muscle: "Core", role: S },
  ],
  "Banded Glute Bridges": [
    { muscle: "Glutes", role: P },
    { muscle: "Hamstrings", role: S },
  ],
  "Dumbbell Glute Bridges": [
    { muscle: "Glutes", role: P },
    { muscle: "Hamstrings", role: S },
  ],
  "Barbell Good Mornings": [
    { muscle: "Hamstrings", role: P },
    { muscle: "Lower Back", role: P },
    { muscle: "Glutes", role: S },
    { muscle: "Core", role: S },
  ],
  "Banded Good Mornings": [
    { muscle: "Hamstrings", role: P },
    { muscle: "Lower Back", role: S },
    { muscle: "Glutes", role: S },
  ],
  "Leg Curl": [
    { muscle: "Hamstrings", role: P },
  ],
  "Lying Hamstring Curl": [
    { muscle: "Hamstrings", role: P },
  ],
  "Seated Hamstring Curl": [
    { muscle: "Hamstrings", role: P },
  ],
  "Hip Abduction Machine": [
    { muscle: "Glutes", role: P },
  ],
  "Banded Lateral Walks": [
    { muscle: "Glutes", role: P },
    { muscle: "Hip Flexors", role: S },
  ],
  "Banded Glute Kickbacks": [
    { muscle: "Glutes", role: P },
    { muscle: "Hamstrings", role: S },
  ],
  "Alternating Fire Hydrants": [
    { muscle: "Glutes", role: P },
    { muscle: "Hip Flexors", role: S },
  ],

  // ── Lunge Pattern ──────────────────────────────────────────────────────

  "Walking Lunge": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Hamstrings", role: S },
    { muscle: "Core", role: S },
    { muscle: "Hip Flexors", role: S },
    { muscle: "Adductors", role: S },
  ],
  "Split Squat": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: S },
    { muscle: "Hamstrings", role: S },
    { muscle: "Hip Flexors", role: S },
  ],
  "Bulgarian Split Squat": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Hamstrings", role: S },
    { muscle: "Core", role: S },
    { muscle: "Hip Flexors", role: S },
    { muscle: "Adductors", role: S },
  ],
  "Front-Foot Elevated Split Squats": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Hamstrings", role: S },
    { muscle: "Core", role: S },
    { muscle: "Hip Flexors", role: S },
    { muscle: "Adductors", role: S },
  ],
  "Reverse Lunges": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Hamstrings", role: S },
    { muscle: "Core", role: S },
    { muscle: "Hip Flexors", role: S },
  ],
  "Step-Ups": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: S },
    { muscle: "Hamstrings", role: S },
    { muscle: "Core", role: S },
  ],
  "Step-Downs": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: S },
    { muscle: "Core", role: S },
  ],

  // ── Calves ─────────────────────────────────────────────────────────────

  "Standing Calf Raise": [
    { muscle: "Calves", role: P },
  ],
  "Standing Calf Raises": [
    { muscle: "Calves", role: P },
  ],
  "Seated Calf Raise": [
    { muscle: "Calves", role: P },
  ],
  "Seated Calf Raises": [
    { muscle: "Calves", role: P },
  ],
  "Single-Leg Calf Raises": [
    { muscle: "Calves", role: P },
  ],

  // ── Push — Pressing ────────────────────────────────────────────────────

  "Barbell Bench Press": [
    { muscle: "Chest", role: P },
    { muscle: "Triceps", role: P },
    { muscle: "Front Delts", role: S },
  ],
  "Incline Barbell Bench": [
    { muscle: "Chest", role: P },
    { muscle: "Front Delts", role: P },
    { muscle: "Triceps", role: S },
  ],
  "Incline Barbell Bench Press": [
    { muscle: "Chest", role: P },
    { muscle: "Front Delts", role: P },
    { muscle: "Triceps", role: S },
  ],
  "Decline Barbell Bench Press": [
    { muscle: "Chest", role: P },
    { muscle: "Triceps", role: P },
    { muscle: "Front Delts", role: S },
  ],
  "Smith Machine Incline Press": [
    { muscle: "Chest", role: P },
    { muscle: "Front Delts", role: P },
    { muscle: "Triceps", role: S },
  ],
  "Dumbbell Bench Press": [
    { muscle: "Chest", role: P },
    { muscle: "Triceps", role: S },
    { muscle: "Front Delts", role: S },
  ],
  "Flat Dumbbell Press": [
    { muscle: "Chest", role: P },
    { muscle: "Triceps", role: S },
    { muscle: "Front Delts", role: S },
  ],
  "Dumbbell Incline Press": [
    { muscle: "Chest", role: P },
    { muscle: "Front Delts", role: S },
    { muscle: "Triceps", role: S },
  ],
  "Incline Dumbbell Press": [
    { muscle: "Chest", role: P },
    { muscle: "Front Delts", role: S },
    { muscle: "Triceps", role: S },
  ],
  "Low-Incline Dumbbell Press": [
    { muscle: "Chest", role: P },
    { muscle: "Front Delts", role: S },
    { muscle: "Triceps", role: S },
  ],
  "Push-Up": [
    { muscle: "Chest", role: P },
    { muscle: "Triceps", role: S },
    { muscle: "Front Delts", role: S },
    { muscle: "Core", role: S },
  ],
  "Push-Up AMRAP Sets": [
    { muscle: "Chest", role: P },
    { muscle: "Triceps", role: S },
    { muscle: "Front Delts", role: S },
    { muscle: "Core", role: S },
  ],
  "Close-Grip Push-Ups": [
    { muscle: "Triceps", role: P },
    { muscle: "Chest", role: S },
    { muscle: "Front Delts", role: S },
  ],
  "Overhead Press": [
    { muscle: "Front Delts", role: P },
    { muscle: "Triceps", role: P },
    { muscle: "Side Delts", role: S },
    { muscle: "Upper Back", role: S },
    { muscle: "Core", role: S },
  ],
  "Dumbbell Shoulder Press": [
    { muscle: "Front Delts", role: P },
    { muscle: "Triceps", role: S },
    { muscle: "Side Delts", role: S },
  ],
  "Arnold Press": [
    { muscle: "Front Delts", role: P },
    { muscle: "Side Delts", role: S },
    { muscle: "Triceps", role: S },
  ],
  "Machine Chest Press": [
    { muscle: "Chest", role: P },
    { muscle: "Triceps", role: S },
    { muscle: "Front Delts", role: S },
  ],
  "Machine Shoulder Press": [
    { muscle: "Front Delts", role: P },
    { muscle: "Triceps", role: S },
    { muscle: "Side Delts", role: S },
  ],

  // ── Push — Accessories ─────────────────────────────────────────────────

  "Triceps Pushdown": [
    { muscle: "Triceps", role: P },
  ],
  "Tricep Rope Pushdowns": [
    { muscle: "Triceps", role: P },
  ],
  "JM Press": [
    { muscle: "Triceps", role: P },
    { muscle: "Chest", role: S },
  ],
  "Skull Crusher": [
    { muscle: "Triceps", role: P },
  ],
  "Dumbbell Skull Crushers": [
    { muscle: "Triceps", role: P },
  ],
  "Dips": [
    { muscle: "Chest", role: P },
    { muscle: "Triceps", role: P },
    { muscle: "Front Delts", role: S },
  ],
  "Assisted Dips": [
    { muscle: "Chest", role: P },
    { muscle: "Triceps", role: P },
    { muscle: "Front Delts", role: S },
  ],
  "Close-Grip Bench Press": [
    { muscle: "Triceps", role: P },
    { muscle: "Chest", role: P },
    { muscle: "Front Delts", role: S },
  ],
  "Overhead Triceps Extension": [
    { muscle: "Triceps", role: P },
  ],
  "Cable Fly": [
    { muscle: "Chest", role: P },
    { muscle: "Front Delts", role: S },
  ],
  "Pec Deck": [
    { muscle: "Chest", role: P },
    { muscle: "Front Delts", role: S },
  ],
  "Lateral Raise": [
    { muscle: "Side Delts", role: P },
  ],
  "Cable Lateral Raise": [
    { muscle: "Side Delts", role: P },
  ],
  "Dumbbell Lateral Raises": [
    { muscle: "Side Delts", role: P },
  ],

  // ── Pull — Rows / Pulls ───────────────────────────────────────────────

  "Pull-Up": [
    { muscle: "Back", role: P },
    { muscle: "Biceps", role: S },
    { muscle: "Forearms", role: S },
    { muscle: "Core", role: S },
  ],
  "Lat Pulldown": [
    { muscle: "Back", role: P },
    { muscle: "Biceps", role: S },
    { muscle: "Forearms", role: S },
  ],
  "Lat Pulldown (wide, neutral, single-arm)": [
    { muscle: "Back", role: P },
    { muscle: "Biceps", role: S },
    { muscle: "Forearms", role: S },
  ],
  "Single-Arm Cable Lat Pulldown": [
    { muscle: "Back", role: P },
    { muscle: "Biceps", role: S },
    { muscle: "Forearms", role: S },
  ],
  "Straight-Arm Pulldown": [
    { muscle: "Back", role: P },
    { muscle: "Triceps", role: S },
    { muscle: "Core", role: S },
  ],
  "Barbell Row": [
    { muscle: "Back", role: P },
    { muscle: "Upper Back", role: P },
    { muscle: "Biceps", role: S },
    { muscle: "Rear Delts", role: S },
    { muscle: "Lower Back", role: S },
    { muscle: "Forearms", role: S },
  ],
  "Seated Cable Row": [
    { muscle: "Back", role: P },
    { muscle: "Upper Back", role: S },
    { muscle: "Biceps", role: S },
    { muscle: "Rear Delts", role: S },
  ],
  "Chest-Supported Row": [
    { muscle: "Back", role: P },
    { muscle: "Upper Back", role: S },
    { muscle: "Biceps", role: S },
    { muscle: "Rear Delts", role: S },
  ],
  "Chest-Supported Machine Row": [
    { muscle: "Back", role: P },
    { muscle: "Upper Back", role: S },
    { muscle: "Biceps", role: S },
    { muscle: "Rear Delts", role: S },
  ],
  "Chest-Supported T-Bar Row": [
    { muscle: "Back", role: P },
    { muscle: "Upper Back", role: P },
    { muscle: "Biceps", role: S },
    { muscle: "Rear Delts", role: S },
  ],
  "T-Bar Row": [
    { muscle: "Back", role: P },
    { muscle: "Upper Back", role: P },
    { muscle: "Biceps", role: S },
    { muscle: "Rear Delts", role: S },
    { muscle: "Lower Back", role: S },
  ],
  "One-Arm Dumbbell Row": [
    { muscle: "Back", role: P },
    { muscle: "Upper Back", role: S },
    { muscle: "Biceps", role: S },
    { muscle: "Core", role: S },
    { muscle: "Rear Delts", role: S },
  ],
  "Single-Arm Dumbbell Row": [
    { muscle: "Back", role: P },
    { muscle: "Upper Back", role: S },
    { muscle: "Biceps", role: S },
    { muscle: "Core", role: S },
    { muscle: "Rear Delts", role: S },
  ],
  "Iso-Lateral Low Row": [
    { muscle: "Back", role: P },
    { muscle: "Upper Back", role: S },
    { muscle: "Biceps", role: S },
    { muscle: "Rear Delts", role: S },
  ],
  "Banded Rows": [
    { muscle: "Back", role: P },
    { muscle: "Upper Back", role: S },
    { muscle: "Biceps", role: S },
  ],
  "Banded Rows Burnouts": [
    { muscle: "Back", role: P },
    { muscle: "Upper Back", role: S },
    { muscle: "Biceps", role: S },
  ],
  "Machine Shrugs": [
    { muscle: "Upper Back", role: P },
  ],
  "Reverse Fly": [
    { muscle: "Rear Delts", role: P },
    { muscle: "Upper Back", role: P },
  ],
  "Dumbbell Reverse Flys": [
    { muscle: "Rear Delts", role: P },
    { muscle: "Upper Back", role: P },
  ],
  "Rear Delt Fly Machine": [
    { muscle: "Rear Delts", role: P },
    { muscle: "Upper Back", role: P },
  ],
  "Machine Rear Delt Fly": [
    { muscle: "Rear Delts", role: P },
    { muscle: "Upper Back", role: P },
  ],
  "Face Pull": [
    { muscle: "Rear Delts", role: P },
    { muscle: "Upper Back", role: P },
    { muscle: "Side Delts", role: S },
  ],

  // ── Pull — Arm Accessories ─────────────────────────────────────────────

  "Dumbbell Curl": [
    { muscle: "Biceps", role: P },
    { muscle: "Forearms", role: S },
  ],
  "Barbell Curl": [
    { muscle: "Biceps", role: P },
    { muscle: "Forearms", role: S },
  ],
  "Hammer Curl": [
    { muscle: "Biceps", role: P },
    { muscle: "Forearms", role: P },
  ],
  "Rope Hammer Curls": [
    { muscle: "Biceps", role: P },
    { muscle: "Forearms", role: P },
  ],
  "Incline Dumbbell Curl": [
    { muscle: "Biceps", role: P },
  ],
  "Bayesian Curl": [
    { muscle: "Biceps", role: P },
  ],
  "Cable Preacher Curl": [
    { muscle: "Biceps", role: P },
  ],
  "Cable Reverse Curls": [
    { muscle: "Biceps", role: P },
    { muscle: "Forearms", role: P },
  ],
  "Banded Curl Burnouts": [
    { muscle: "Biceps", role: P },
  ],
  "Isometric Biceps Holds": [
    { muscle: "Biceps", role: P },
    { muscle: "Forearms", role: S },
  ],
  "Forearm Wrist Extensions": [
    { muscle: "Forearms", role: P },
  ],

  // ── Core ───────────────────────────────────────────────────────────────

  "Plank": [
    { muscle: "Core", role: P },
    { muscle: "Front Delts", role: S },
  ],
  "Hanging Leg Raise": [
    { muscle: "Core", role: P },
    { muscle: "Hip Flexors", role: P },
    { muscle: "Forearms", role: S },
  ],
  "Hanging Knee Raises": [
    { muscle: "Core", role: P },
    { muscle: "Hip Flexors", role: P },
    { muscle: "Forearms", role: S },
  ],
  "Captain\u2019s Chair Knee Raises": [
    { muscle: "Core", role: P },
    { muscle: "Hip Flexors", role: P },
    { muscle: "Forearms", role: S },
  ],
  "Lying Leg Raises": [
    { muscle: "Core", role: P },
    { muscle: "Hip Flexors", role: P },
  ],
  "Supported Leg Extension Crunches": [
    { muscle: "Core", role: P },
  ],
  "Cable Crunch": [
    { muscle: "Core", role: P },
  ],
  "Pallof Press": [
    { muscle: "Core", role: P },
    { muscle: "Front Delts", role: S },
  ],
  "Dead Bug": [
    { muscle: "Core", role: P },
    { muscle: "Hip Flexors", role: S },
  ],
  "Copenhagen Planks": [
    { muscle: "Core", role: P },
    { muscle: "Adductors", role: P },
  ],
  "Cartwheel Twists": [
    { muscle: "Core", role: P },
    { muscle: "Hip Flexors", role: S },
  ],

  // ── Conditioning / Carries ─────────────────────────────────────────────

  "Farmer's Carry": [
    { muscle: "Forearms", role: P },
    { muscle: "Core", role: P },
    { muscle: "Upper Back", role: S },
    { muscle: "Side Delts", role: S },
  ],
  "Sled Push": [
    { muscle: "Quads", role: P },
    { muscle: "Glutes", role: S },
    { muscle: "Calves", role: S },
    { muscle: "Core", role: S },
  ],
  "Sled Pull": [
    { muscle: "Hamstrings", role: P },
    { muscle: "Glutes", role: P },
    { muscle: "Back", role: S },
    { muscle: "Core", role: S },
  ],
  "Sled Drag": [
    { muscle: "Hamstrings", role: P },
    { muscle: "Glutes", role: S },
    { muscle: "Calves", role: S },
    { muscle: "Core", role: S },
  ],
  "Sled Drags": [
    { muscle: "Hamstrings", role: P },
    { muscle: "Glutes", role: S },
    { muscle: "Calves", role: S },
    { muscle: "Core", role: S },
  ],

  // ── Prehab / Mobility ─────────────────────────────────────────────────

  "Scapular Pull-Ups": [
    { muscle: "Upper Back", role: P },
    { muscle: "Back", role: S },
  ],
  "Scapular Push-Ups": [
    { muscle: "Upper Back", role: P },
    { muscle: "Front Delts", role: S },
  ],
  "Prone Y-T Raises": [
    { muscle: "Upper Back", role: P },
    { muscle: "Rear Delts", role: P },
  ],
  "Band Pull-Aparts": [
    { muscle: "Rear Delts", role: P },
    { muscle: "Upper Back", role: P },
  ],
  "Dead Hangs": [
    { muscle: "Forearms", role: P },
    { muscle: "Back", role: S },
  ],
  "Hip Flexor Stretch": [
    { muscle: "Hip Flexors", role: P },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// Resolver functions
// ═══════════════════════════════════════════════════════════════════════════

function resolveSplitTag(name: string, pattern: MovementPattern): SplitTag {
  if (MOBILITY_REGEX.test(name)) {
    return SplitTag.MOBILITY;
  }
  if (PREHAB_REGEX.test(name)) {
    return SplitTag.PREHAB;
  }
  if (CONDITIONING_REGEX.test(name)) {
    return SplitTag.CONDITIONING;
  }
  if (CORE_REGEX.test(name)) {
    return SplitTag.CORE;
  }
  switch (pattern) {
    case MovementPattern.PUSH:
    case MovementPattern.PUSH_PULL:
      return SplitTag.PUSH;
    case MovementPattern.PULL:
      return SplitTag.PULL;
    default:
      return SplitTag.LEGS;
  }
}

function resolveMovementPatternsV2(name: string, pattern: MovementPattern): MovementPatternV2[] {
  if (pattern === MovementPattern.PUSH || pattern === MovementPattern.PUSH_PULL) {
    if (VERTICAL_PUSH_REGEX.test(name)) {
      return [MovementPatternV2.VERTICAL_PUSH];
    }
    if (HORIZONTAL_PUSH_REGEX.test(name)) {
      return [MovementPatternV2.HORIZONTAL_PUSH];
    }
    return [MovementPatternV2.HORIZONTAL_PUSH];
  }
  if (pattern === MovementPattern.PULL) {
    if (VERTICAL_PULL_REGEX.test(name)) {
      return [MovementPatternV2.VERTICAL_PULL];
    }
    if (HORIZONTAL_PULL_REGEX.test(name)) {
      return [MovementPatternV2.HORIZONTAL_PULL];
    }
    return [MovementPatternV2.HORIZONTAL_PULL];
  }
  if (pattern === MovementPattern.SQUAT) {
    return [MovementPatternV2.SQUAT];
  }
  if (pattern === MovementPattern.HINGE) {
    return [MovementPatternV2.HINGE];
  }
  if (pattern === MovementPattern.LUNGE) {
    return [MovementPatternV2.LUNGE];
  }
  if (pattern === MovementPattern.CARRY) {
    return [MovementPatternV2.CARRY];
  }
  if (pattern === MovementPattern.ROTATE) {
    return [MovementPatternV2.ROTATION];
  }
  return [];
}

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
    exerciseName: "Barbell Deadlift",
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
    exerciseName: "Barbell Deadlift",
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
    exerciseName: "Chest-Supported Machine Row",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 100,
    workingWeightMax: 125,
  },
  {
    exerciseName: "Iso-Lateral Low Row",
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
    exerciseName: "Straight-Arm Pulldown",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 45,
    workingWeightMax: 50,
  },
  {
    exerciseName: "Face Pulls (Rope)",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 40,
    workingWeightMax: 40,
  },
  {
    exerciseName: "Machine Shrugs",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 160,
    workingWeightMax: 160,
  },
  {
    exerciseName: "Machine Shoulder Press",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 55,
    workingWeightMax: 55,
  },
  {
    exerciseName: "Rope Hammer Curls",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 35,
    workingWeightMax: 40,
  },
  {
    exerciseName: "Tricep Rope Pushdown",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 35,
    workingWeightMax: 35,
  },
  {
    exerciseName: "Rear Delt Fly Machine",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 80,
    workingWeightMax: 80,
  },
  {
    exerciseName: "Assisted Dips",
    category: BaselineCategory.MACHINE_CABLE,
    workingWeightMin: 105.5,
    workingWeightMax: 105.5,
    notes: "Assistance",
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

async function seedExercises() {
  console.log("Seeding exercises...");
  const equipmentByName = new Map(
    (await prisma.equipment.findMany()).map((item) => [item.name, item])
  );

  for (const exercise of exercises) {
    const splitTag = resolveSplitTag(exercise.name, exercise.movementPattern);
    const movementPatternsV2 = resolveMovementPatternsV2(exercise.name, exercise.movementPattern);
    const tuning = EXERCISE_FIELD_TUNING[exercise.name];
    const fatigueCost = tuning?.fatigueCost ?? (exercise.isMainLift ? 4 : exercise.jointStress === JointStress.HIGH ? 3 : 2);
    const stimulusBias = tuning?.stimulusBias ?? [];
    const isCompound = compoundAccessoryNames.has(exercise.name) || exercise.isMainLift;
    const isMainLiftEligible = mainLiftEligibleOverrides.has(exercise.name) || exercise.isMainLift;
    const isWarmupTag = splitTag === SplitTag.MOBILITY || splitTag === SplitTag.PREHAB || splitTag === SplitTag.CORE;
    const timePerSetSec = tuning?.timePerSetSec ?? (exercise.isMainLift ? 210 : isWarmupTag ? 60 : 120);
    const sfrScore = tuning?.sfrScore ?? 3;
    const lengthPositionScore = tuning?.lengthPositionScore ?? 3;
    const contraindications = tuning?.contraindications;
    const data = {
      movementPattern: exercise.movementPattern,
      movementPatternsV2,
      splitTags: [splitTag],
      jointStress: exercise.jointStress,
      isMainLift: exercise.isMainLift,
      isMainLiftEligible: isMainLiftEligible,
      isCompound: isCompound,
      fatigueCost,
      stimulusBias,
      contraindications,
      timePerSetSec,
      sfrScore,
      lengthPositionScore,
    };
    const created = await prisma.exercise.upsert({
      where: { name: exercise.name },
      update: data,
      create: { name: exercise.name, ...data },
    });

    for (const equipmentName of exercise.equipment) {
      const equipment = equipmentByName.get(equipmentName);
      if (!equipment) {
        continue;
      }

      await prisma.exerciseEquipment.upsert({
        where: {
          exerciseId_equipmentId: {
            exerciseId: created.id,
            equipmentId: equipment.id,
          },
        },
        update: {},
        create: {
          exerciseId: created.id,
          equipmentId: equipment.id,
        },
      });
    }
  }
}

async function seedExerciseMuscles() {
  console.log("Seeding exercise-muscle mappings...");

  const exercisesByName = new Map(
    (await prisma.exercise.findMany()).map((e) => [e.name, e])
  );
  const musclesByName = new Map(
    (await prisma.muscle.findMany()).map((m) => [m.name, m])
  );

  let created = 0;
  let exerciseCount = 0;
  const notFound: string[] = [];

  for (const [exerciseName, mappings] of Object.entries(exerciseMuscleMappings)) {
    const exercise = exercisesByName.get(exerciseName);
    if (!exercise) {
      notFound.push(exerciseName);
      continue;
    }

    await prisma.exerciseMuscle.deleteMany({
      where: { exerciseId: exercise.id },
    });

    for (const { muscle: muscleName, role } of mappings) {
      const muscle = musclesByName.get(muscleName);
      if (!muscle) continue;

      await prisma.exerciseMuscle.create({
        data: {
          exerciseId: exercise.id,
          muscleId: muscle.id,
          role,
        },
      });
      created++;
    }
    exerciseCount++;
  }

  console.log(`  ${created} mappings across ${exerciseCount} exercises.`);
  if (notFound.length > 0) {
    console.warn(`  ⚠ Mapping keys not found in DB (${notFound.length}): ${notFound.join(", ")}`);
  }
}

async function seedExerciseAliases() {
  console.log("Seeding exercise aliases...");
  const exercisesByName = new Map(
    (await prisma.exercise.findMany()).map((e) => [e.name, e])
  );

  let created = 0;
  for (const entry of exerciseAliases) {
    const exercise = exercisesByName.get(entry.exerciseName);
    if (!exercise) {
      continue;
    }
    await prisma.exerciseAlias.upsert({
      where: { alias: entry.alias },
      update: { exerciseId: exercise.id },
      create: { alias: entry.alias, exerciseId: exercise.id },
    });
    created++;
  }
  console.log(`  ${created} aliases seeded.`);
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

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  await seedEquipment();
  await seedMuscles();
  await seedExercises();
  await seedExerciseAliases();
  await seedExerciseMuscles();
  const user = await seedOwner();
  await seedBaselines(user.id);
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












