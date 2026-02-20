export type LogSetInput = {
  setId: string;
  setIndex: number;
  targetReps: number;
  targetRepRange?: { min: number; max: number };
  targetLoad?: number | null;
  targetRpe?: number | null;
  restSeconds?: number | null;
  actualReps?: number | null;
  actualLoad?: number | null;
  actualRpe?: number | null;
  wasSkipped?: boolean;
};

export type LogExerciseInput = {
  workoutExerciseId: string;
  name: string;
  equipment?: string[];
  isMainLift: boolean;
  section?: "WARMUP" | "MAIN" | "ACCESSORY";
  sets: LogSetInput[];
};

export type SectionedExercises = {
  warmup?: LogExerciseInput[];
  main: LogExerciseInput[];
  accessory?: LogExerciseInput[];
};

export type NormalizedExercises = {
  warmup: LogExerciseInput[];
  main: LogExerciseInput[];
  accessory: LogExerciseInput[];
};

export type ExerciseSection = keyof NormalizedExercises;

export type FlatSetItem = {
  section: ExerciseSection;
  sectionLabel: string;
  exerciseIndex: number;
  setIndex: number;
  exercise: LogExerciseInput;
  set: LogSetInput;
};

export type UndoSnapshot = {
  setId: string;
  previousSet: LogSetInput | null;
  previousLog: {
    actualReps?: number | null;
    actualRpe?: number | null;
    actualLoad?: number | null;
    wasSkipped?: boolean | null;
    notes?: string | null;
  } | null;
  wasCreated: boolean;
  expiresAt: number;
};

export type BaselineUpdateSummary = {
  context: string;
  evaluatedExercises: number;
  updated: number;
  skipped: number;
  items: {
    exerciseName: string;
    previousTopSetWeight?: number;
    newTopSetWeight: number;
    reps: number;
  }[];
  skippedItems: {
    exerciseName: string;
    reason: string;
  }[];
};

export type AutoregHint = {
  exerciseId: string;
  message: string;
};
