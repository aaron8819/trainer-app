export type LogSetInput = {
  setId: string;
  setIndex: number;
  isRuntimeAdded?: boolean;
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
  movementPatterns?: string[];
  isRuntimeAdded?: boolean;
  isSwapped?: boolean;
  isMainLift: boolean;
  section?: "WARMUP" | "MAIN" | "ACCESSORY";
  sessionNote?: string;
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
  previousRestTimer: {
    startedAtMs: number;
    endAtMs: number;
  } | null;
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

export type CompletedWorkoutSetSummary = {
  setIndex: number;
  isRuntimeAdded?: boolean;
  targetReps: number;
  targetRepRange?: { min: number; max: number };
  targetLoad?: number | null;
  targetRpe?: number | null;
  actualReps?: number | null;
  actualLoad?: number | null;
  actualRpe?: number | null;
  wasLogged: boolean;
  wasSkipped: boolean;
};

export type CompletedWorkoutExerciseSummary = {
  exerciseId: string;
  name: string;
  equipment?: string[];
  isSwapped?: boolean;
  isRuntimeAdded?: boolean;
  isMainLift: boolean;
  section: ExerciseSection;
  sessionNote?: string;
  sets: CompletedWorkoutSetSummary[];
};

export type RpeAdherenceSummary = {
  adherent: number;
  total: number;
};

export type CompletionAction = "mark_completed" | "mark_partial" | "mark_skipped";

export type PrefilledFieldState = {
  actualReps: boolean;
  actualLoad: boolean;
  actualRpe: boolean;
};

export type SetDraftBuffers = {
  reps?: string;
  load?: string;
  rpe?: string;
};

export type SetDraftNumericValues = {
  actualReps: number | null;
  actualLoad: number | null;
  actualRpe: number | null;
};

export type SavedDraftStatus = {
  setId: string;
  savedAt: number;
} | null;

export type ActiveSetDraftState = {
  draftBuffersBySet: Record<string, SetDraftBuffers>;
  prefilledFieldsBySet: Record<string, PrefilledFieldState>;
  touchedFieldsBySet: Record<string, PrefilledFieldState>;
  restoredSetIds: Set<string>;
  savingDraftSetId: string | null;
  lastSavedDraft: SavedDraftStatus;
};
