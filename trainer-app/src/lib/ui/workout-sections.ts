import type { LogExerciseInput } from "@/components/log-workout/types";
import {
  formatRuntimeExerciseSwapNote,
  readRuntimeAddedExerciseIds,
  readRuntimeAddedSetIds,
  readRuntimeReplacedExercises,
  RUNTIME_ADDED_EXERCISE_SESSION_NOTE,
} from "@/lib/ui/selection-metadata";
import { buildExerciseMuscleDisplayGroups } from "@/lib/ui/exercise-muscle-tags";

type WorkoutExercise = {
  id: string;
  isMainLift: boolean;
  orderIndex: number;
  section?: "WARMUP" | "MAIN" | "ACCESSORY" | null;
  exercise: {
    id?: string | null;
    name: string;
    movementPatterns?: string[] | null;
    aliases?: { alias: string }[];
    exerciseMuscles?: { role: string; muscle: { name: string } }[];
    exerciseEquipment?: { equipment: { type: string } }[];
  };
  sets: {
    id: string;
    setIndex: number;
    targetReps: number;
    targetRepMin?: number | null;
    targetRepMax?: number | null;
    targetLoad?: number | null;
    targetRpe?: number | null;
    restSeconds?: number | null;
    logs?: {
      actualReps: number | null;
      actualRpe: number | null;
      actualLoad: number | null;
      wasSkipped: boolean;
    }[];
  }[];
};

type SectionedExercises = {
  warmup: LogExerciseInput[];
  main: LogExerciseInput[];
  accessory: LogExerciseInput[];
};

function buildSwapNoteMap(selectionMetadata: unknown): Map<string, string> {
  const swapState = readRuntimeReplacedExercises(selectionMetadata);
  return new Map(
    Array.from(swapState.values()).map((entry) => [
      entry.workoutExerciseId,
      formatRuntimeExerciseSwapNote(entry),
    ])
  );
}

function buildSwappedExerciseIdSet(selectionMetadata: unknown): Set<string> {
  return new Set(readRuntimeReplacedExercises(selectionMetadata).keys());
}

export function splitExercises(
  exercises: WorkoutExercise[],
  selectionMetadata?: unknown
): SectionedExercises {
  const warmup: LogExerciseInput[] = [];
  const main: LogExerciseInput[] = [];
  const accessory: LogExerciseInput[] = [];
  const swapNoteByWorkoutExerciseId = buildSwapNoteMap(selectionMetadata);
  const swappedExerciseIds = buildSwappedExerciseIdSet(selectionMetadata);
  const runtimeAddedExerciseIds = readRuntimeAddedExerciseIds(selectionMetadata);
  const runtimeAddedSetIds = readRuntimeAddedSetIds(selectionMetadata);

  const ordered = [...exercises].sort((a, b) => a.orderIndex - b.orderIndex);

  for (const exercise of ordered) {
    const muscleTagGroups = buildExerciseMuscleDisplayGroups({
      id: exercise.exercise.id,
      name: exercise.exercise.name,
      aliases: exercise.exercise.aliases,
      exerciseMuscles: exercise.exercise.exerciseMuscles,
    });
    const entry: LogExerciseInput = {
      workoutExerciseId: exercise.id,
      name: exercise.exercise.name,
      equipment: (exercise.exercise.exerciseEquipment ?? []).map((item) => item.equipment.type),
      movementPatterns: (exercise.exercise.movementPatterns ?? []).map((pattern) =>
        pattern.toLowerCase()
      ),
      muscleTags: muscleTagGroups.muscleTags,
      muscleTagGroups: {
        primaryMuscles: muscleTagGroups.primaryMuscles,
        secondaryMuscles: muscleTagGroups.secondaryMuscles,
      },
      isRuntimeAdded: runtimeAddedExerciseIds.has(exercise.id),
      isSwapped: swappedExerciseIds.has(exercise.id),
      isMainLift: exercise.isMainLift,
      sessionNote:
        swapNoteByWorkoutExerciseId.get(exercise.id) ??
        (runtimeAddedExerciseIds.has(exercise.id)
          ? RUNTIME_ADDED_EXERCISE_SESSION_NOTE
          : undefined),
      sets: exercise.sets.map((set) => ({
        ...(set.logs?.[0]
          ? {
              actualReps: set.logs[0].actualReps ?? null,
              actualLoad: set.logs[0].actualLoad ?? null,
              actualRpe: set.logs[0].actualRpe ?? null,
              wasSkipped: set.logs[0].wasSkipped ?? false,
            }
          : {}),
        setId: set.id,
        setIndex: set.setIndex,
        isRuntimeAdded: runtimeAddedSetIds.has(set.id),
        targetReps: set.targetReps,
        targetRepRange:
          set.targetRepMin != null && set.targetRepMax != null
            ? { min: set.targetRepMin, max: set.targetRepMax }
            : undefined,
        targetLoad: set.targetLoad,
        targetRpe: set.targetRpe,
        restSeconds: set.restSeconds,
      })),
    };

    if (exercise.section === "WARMUP") {
      warmup.push({ ...entry, section: "WARMUP" });
    } else if (exercise.section === "MAIN") {
      main.push({ ...entry, section: "MAIN" });
    } else if (exercise.section === "ACCESSORY") {
      accessory.push({ ...entry, section: "ACCESSORY" });
    } else if (exercise.isMainLift) {
      main.push({ ...entry, section: "MAIN" });
    } else if (warmup.length < 2) {
      warmup.push({ ...entry, section: "WARMUP" });
    } else {
      accessory.push({ ...entry, section: "ACCESSORY" });
    }
  }

  return { warmup, main, accessory };
}

