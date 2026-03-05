import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

export type WorkoutWithExplainabilityRelations = Prisma.WorkoutGetPayload<{
  include: {
    filteredExercises: true;
    exercises: {
      include: {
        exercise: {
          include: {
            exerciseEquipment: { include: { equipment: true } };
            exerciseMuscles: { include: { muscle: true } };
          };
        };
        sets: {
          include: {
            logs: { orderBy: { completedAt: "desc" }, take: 1 };
          };
        };
      };
    };
  };
}>;

export async function loadWorkoutWithExplainabilityRelations(
  workoutId: string
): Promise<WorkoutWithExplainabilityRelations | null> {
  return prisma.workout.findUnique({
    where: { id: workoutId },
    include: {
      filteredExercises: true,
      exercises: {
        include: {
          exercise: {
            include: {
              exerciseEquipment: { include: { equipment: true } },
              exerciseMuscles: { include: { muscle: true } },
            },
          },
          sets: {
            include: {
              logs: { orderBy: { completedAt: "desc" }, take: 1 },
            },
          },
        },
      },
    },
  });
}

export async function loadExplainabilityExerciseLibrary() {
  return prisma.exercise.findMany({
    include: {
      exerciseEquipment: { include: { equipment: true } },
      exerciseMuscles: { include: { muscle: true } },
    },
  });
}
