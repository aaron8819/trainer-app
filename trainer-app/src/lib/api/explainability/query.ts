import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

type ExplainabilityQueryClient = Pick<
  Prisma.TransactionClient,
  "workout" | "exercise"
>;

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
  workoutId: string,
  client: ExplainabilityQueryClient = prisma
): Promise<WorkoutWithExplainabilityRelations | null> {
  return client.workout.findUnique({
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

export async function loadExplainabilityExerciseLibrary(
  client: ExplainabilityQueryClient = prisma
) {
  return client.exercise.findMany({
    include: {
      exerciseEquipment: { include: { equipment: true } },
      exerciseMuscles: { include: { muscle: true } },
    },
  });
}
