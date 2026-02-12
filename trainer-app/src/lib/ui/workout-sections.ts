import type { LogExerciseInput } from "@/components/LogWorkoutClient";

type WorkoutExercise = {
  id: string;
  isMainLift: boolean;
  orderIndex: number;
  section?: "WARMUP" | "MAIN" | "ACCESSORY" | null;
  exercise: {
    name: string;
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
  }[];
};

type SectionedExercises = {
  warmup: LogExerciseInput[];
  main: LogExerciseInput[];
  accessory: LogExerciseInput[];
};

export function splitExercises(exercises: WorkoutExercise[]): SectionedExercises {
  const warmup: LogExerciseInput[] = [];
  const main: LogExerciseInput[] = [];
  const accessory: LogExerciseInput[] = [];

  const ordered = [...exercises].sort((a, b) => a.orderIndex - b.orderIndex);

  for (const exercise of ordered) {
    const entry: LogExerciseInput = {
      workoutExerciseId: exercise.id,
      name: exercise.exercise.name,
      equipment: (exercise.exercise.exerciseEquipment ?? []).map((item) => item.equipment.type),
      isMainLift: exercise.isMainLift,
      sets: exercise.sets.map((set) => ({
        setId: set.id,
        setIndex: set.setIndex,
        targetReps: set.targetReps,
        targetRepRange:
          set.targetRepMin != null && set.targetRepMax != null
            ? { min: set.targetRepMin, max: set.targetRepMax }
            : undefined,
        targetLoad: set.targetLoad,
        targetRpe: set.targetRpe,
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
