export type TrainingAge = "beginner" | "intermediate" | "advanced";
export type PrimaryGoal =
  | "hypertrophy"
  | "strength"
  | "fat_loss"
  | "athleticism"
  | "general_health";
export type SecondaryGoal =
  | "posture"
  | "conditioning"
  | "injury_prevention"
  | "strength"
  | "none";
export type SplitType = "ppl" | "upper_lower" | "full_body" | "custom";
export type SplitDay = "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "body_part";
export type WorkoutSelectionMode = "AUTO" | "MANUAL" | "BONUS" | "INTENT";

/**
 * Muscle name type alias for selection-v2
 * Represents muscle group names (e.g., "Chest", "Front Delts", "Quads")
 */
export type Muscle = string;
export type MovementPatternV2 =
  | "horizontal_push"
  | "vertical_push"
  | "horizontal_pull"
  | "vertical_pull"
  | "squat"
  | "hinge"
  | "lunge"
  | "carry"
  | "rotation"
  | "anti_rotation"
  | "flexion"
  | "extension"
  | "abduction"
  | "adduction"
  | "isolation";
/** V1 movement pattern — kept for WorkoutHistoryEntry backward compat */
export type MovementPattern =
  | "squat"
  | "hinge"
  | "push"
  | "pull"
  | "push_pull"
  | "carry"
  | "rotate"
  | "lunge";

export type SplitTag =
  | "push"
  | "pull"
  | "legs"
  | "core"
  | "mobility"
  | "prehab"
  | "conditioning";
export type StimulusBias = "mechanical" | "metabolic" | "stretch" | "stability";
export type JointStress = "low" | "medium" | "high";
export type Difficulty = "beginner" | "intermediate" | "advanced";
export type EquipmentType =
  | "barbell"
  | "dumbbell"
  | "machine"
  | "cable"
  | "bodyweight"
  | "kettlebell"
  | "band"
  | "sled"
  | "bench"
  | "rack"
  | "ez_bar"
  | "trap_bar"
  | "other";

export type InjuryFlag = {
  bodyPart: string;
  severity: 1 | 2 | 3 | 4 | 5;
  isActive: boolean;
};

export type UserProfile = {
  id: string;
  age?: number;
  sex?: string;
  heightCm?: number;
  weightKg?: number;
  trainingAge: TrainingAge;
  injuries: InjuryFlag[];
};

export type Goals = {
  primary: PrimaryGoal;
  secondary: SecondaryGoal;
};

export type Constraints = {
  daysPerWeek: number;
  sessionMinutes: number;
  splitType: SplitType;
  availableEquipment: EquipmentType[];
};

export type UserPreferences = {
  favoriteExercises?: string[];
  avoidExercises?: string[];
  favoriteExerciseIds?: string[];
  avoidExerciseIds?: string[];
  optionalConditioning?: boolean;
};

export type Exercise = {
  id: string;
  name: string;
  movementPatterns: MovementPatternV2[];
  splitTags: SplitTag[];
  jointStress: JointStress;
  isMainLiftEligible?: boolean;
  isCompound?: boolean;
  fatigueCost?: number;
  stimulusBias?: StimulusBias[];
  contraindications?: Record<string, unknown>;
  timePerSetSec?: number;
  sfrScore?: number;
  lengthPositionScore?: number;
  difficulty?: Difficulty;
  isUnilateral?: boolean;
  repRangeMin?: number;
  repRangeMax?: number;
  equipment: EquipmentType[];
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  muscleSraHours?: Record<string, number>;
};

export type WorkoutSet = {
  setIndex: number;
  targetReps: number;
  targetRepRange?: {
    min: number;
    max: number;
  };
  role?: WorkoutExerciseRole;
  targetRpe?: number;
  targetLoad?: number;
  restSeconds?: number;
};

export type WorkoutExerciseRole = "warmup" | "main" | "accessory";

export type WorkoutExercise = {
  id: string;
  exercise: Exercise;
  orderIndex: number;
  isMainLift: boolean;
  role?: WorkoutExerciseRole;
  notes?: string;
  supersetGroup?: number;
  sets: WorkoutSet[];
  warmupSets?: WorkoutSet[];
};

export type WorkoutPlan = {
  id: string;
  scheduledDate: string;
  warmup: WorkoutExercise[];
  mainLifts: WorkoutExercise[];
  accessories: WorkoutExercise[];
  estimatedMinutes: number;
  notes?: string;
};

export type SetLog = {
  exerciseId: string;
  setIndex: number;
  reps: number;
  rpe?: number;
  load?: number;
};

export type WorkoutHistoryEntry = {
  date: string;
  completed: boolean;
  status?: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED";
  advancesSplit?: boolean;
  forcedSplit?: SplitDay;
  sessionIntent?: SplitDay;
  selectionMode?: WorkoutSelectionMode;
  exercises: {
    exerciseId: string;
    movementPattern: MovementPattern;
    primaryMuscles?: string[];
    sets: SetLog[];
  }[];
  readinessScore?: 1 | 2 | 3 | 4 | 5;
  sorenessNotes?: string;
  painFlags?: Record<string, 0 | 1 | 2 | 3>;
};

export type FatigueState = {
  readinessScore: 1 | 2 | 3 | 4 | 5;
  sorenessNotes?: string;
  missedLastSession: boolean;
  painFlags?: Record<string, 0 | 1 | 2 | 3>;
};

export type SessionCheckIn = {
  date: string;
  readiness: 1 | 2 | 3 | 4 | 5;
  painFlags?: Record<string, 0 | 1 | 2 | 3>;
  notes?: string;
};

export type ProgressionRule = {
  name: string;
  primaryGoal: PrimaryGoal;
  repRange: {
    main: [number, number];
    accessory: [number, number];
  };
  targetRpe: number;
  maxLoadIncreasePct: number;
};
