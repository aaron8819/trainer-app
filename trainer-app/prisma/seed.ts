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

const stimulusBiasByName: Record<string, StimulusBias[]> = {
  "Barbell Bench Press": [StimulusBias.MECHANICAL],
  "Barbell Back Squat": [StimulusBias.MECHANICAL],
  "Conventional Deadlift": [StimulusBias.MECHANICAL],
  "Trap Bar Deadlift": [StimulusBias.MECHANICAL],
  "Overhead Press": [StimulusBias.MECHANICAL],
  "Barbell Row": [StimulusBias.MECHANICAL],
  "Pull-Up": [StimulusBias.MECHANICAL],
  "Machine Chest Press": [StimulusBias.MECHANICAL],
  "Front Squat": [StimulusBias.MECHANICAL],

  "Cable Fly": [StimulusBias.STRETCH],
  "Incline Dumbbell Curl": [StimulusBias.STRETCH],
  "Pec Deck": [StimulusBias.STRETCH],
  "Overhead Triceps Extension": [StimulusBias.STRETCH],
  "Romanian Deadlift": [StimulusBias.STRETCH],
  "Dumbbell Incline Press": [StimulusBias.MECHANICAL, StimulusBias.STRETCH],
  "Low-Incline Dumbbell Press": [StimulusBias.MECHANICAL, StimulusBias.STRETCH],

  "Lateral Raise": [StimulusBias.METABOLIC],
  "Dumbbell Lateral Raises": [StimulusBias.METABOLIC],
  "Cable Lateral Raise": [StimulusBias.METABOLIC],
  "Face Pull": [StimulusBias.METABOLIC],
  "Leg Extension": [StimulusBias.METABOLIC],
  "Leg Curl": [StimulusBias.METABOLIC],
  "Cable Crunch": [StimulusBias.METABOLIC],
  "Triceps Pushdown": [StimulusBias.METABOLIC],

  "Plank": [StimulusBias.STABILITY],
  "Pallof Press": [StimulusBias.STABILITY],
  "Dead Bug": [StimulusBias.STABILITY],
  "Farmer's Carry": [StimulusBias.STABILITY],
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

const fatigueCostOverrides: Record<string, number> = {
  "Dumbbell Shoulder Press": 3,
  "Machine Shoulder Press": 3,
  "Lat Pulldown": 3,
  "Lat Pulldown (wide, neutral, single-arm)": 3,
};

const contraindicationsByName: Record<string, Record<string, boolean>> = {
  "Skull Crusher": { elbow: true },
  "Barbell Curl": { elbow: true },
  "Dips": { shoulder: true },
  "Overhead Press": { shoulder: true },
  "Dumbbell Shoulder Press": { shoulder: true },
  "Machine Shoulder Press": { shoulder: true },
  "Overhead Triceps Extension": { shoulder: true },
  "Barbell Row": { low_back: true },
  "T-Bar Row": { low_back: true },
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
    await prisma.muscle.upsert({
      where: { name },
      update: {},
      create: { name },
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
    const fatigueCost = fatigueCostOverrides[exercise.name] ?? (exercise.isMainLift ? 4 : exercise.jointStress === JointStress.HIGH ? 3 : 2);
    const stimulusBias = stimulusBiasByName[exercise.name] ?? [];
    const isCompound = compoundAccessoryNames.has(exercise.name) || exercise.isMainLift;
    const isMainLiftEligible = mainLiftEligibleOverrides.has(exercise.name) || exercise.isMainLift;
    const isWarmupTag = splitTag === SplitTag.MOBILITY || splitTag === SplitTag.PREHAB || splitTag === SplitTag.CORE;
    const timePerSetSec = exercise.isMainLift ? 210 : isWarmupTag ? 60 : 120;
    const contraindications = contraindicationsByName[exercise.name];
    const created = await prisma.exercise.upsert({
      where: { name: exercise.name },
      update: {
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
        timePerSetSec: timePerSetSec,
      },
      create: {
        name: exercise.name,
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
        timePerSetSec: timePerSetSec,
      },
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












