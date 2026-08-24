import { WorkoutStatus } from "@prisma/client";
import {
  assessClosedHandoffDeletionInTransaction,
  reconcileMesocycleLifecycle,
} from "./mesocycle-lifecycle-reconciliation";
import { executeWorkoutMutation } from "./workout-mutation";
import { isFinisherRolloutEnabled } from "@/lib/operations/finisher-rollout";

export class DeleteWorkoutError extends Error {
  readonly status = 409 as const;

  constructor(
    message: string,
    readonly code = "WORKOUT_DELETE_CONFLICT",
  ) {
    super(message);
  }
}

export async function deleteOwnedWorkout(input: {
  workoutId: string;
  userId: string;
  expectedRevision: number;
}) {
  return executeWorkoutMutation(
    {
      ...input,
      editableStatuses: [
        WorkoutStatus.PLANNED,
        WorkoutStatus.IN_PROGRESS,
        WorkoutStatus.PARTIAL,
        WorkoutStatus.COMPLETED,
        WorkoutStatus.SKIPPED,
      ],
    },
    async (tx) => {
      const workout = await tx.workout.findFirst({
        where: { id: input.workoutId, userId: input.userId },
        select: {
          id: true,
          mesocycleId: true,
          mesocycle: {
            select: {
              id: true,
              durationWeeks: true,
              sessionsPerWeek: true,
              state: true,
              isActive: true,
              completedSessions: true,
              accumulationSessionsCompleted: true,
              deloadSessionsCompleted: true,
              slotSequenceJson: true,
              currentSeedRevision: { select: { seedPayload: true } },
            },
          },
        },
      });
      if (!workout) {
        throw new Error("WORKOUT_NOT_FOUND_AFTER_CLAIM");
      }
      if (
        workout.mesocycle &&
        !workout.mesocycle.isActive &&
        workout.mesocycle.state === "COMPLETED"
      ) {
        throw new DeleteWorkoutError(
          "Cannot delete a historical workout from a completed mesocycle after closeout finalized lifecycle history.",
        );
      }
      if (isFinisherRolloutEnabled()) {
        const finisherOffer = await tx.finisherOffer.findUnique({
          where: { workoutId: workout.id },
          select: { id: true },
        });
        if (finisherOffer) {
          throw new DeleteWorkoutError(
            "Workout cannot be deleted because Finisher history is attached.",
            "WORKOUT_FINISHER_HISTORY_CONFLICT",
          );
        }
      }

      const exercises = await tx.workoutExercise.findMany({
        where: { workoutId: workout.id },
        select: { id: true },
      });
      const exerciseIds = exercises.map((exercise) => exercise.id);

      if (exerciseIds.length > 0) {
        await tx.setLog.deleteMany({
          where: { workoutSet: { workoutExerciseId: { in: exerciseIds } } },
        });
        await tx.workoutSet.deleteMany({
          where: { workoutExerciseId: { in: exerciseIds } },
        });
        await tx.workoutExercise.deleteMany({
          where: { id: { in: exerciseIds } },
        });
      }

      await tx.workout.delete({ where: { id: workout.id } });

      if (
        workout.mesocycle &&
        (workout.mesocycle.isActive || workout.mesocycle.state !== "COMPLETED")
      ) {
        const currentSeedPayload =
          workout.mesocycle.currentSeedRevision?.seedPayload;
        const isV4 =
          currentSeedPayload != null &&
          typeof currentSeedPayload === "object" &&
          !Array.isArray(currentSeedPayload) &&
          "version" in currentSeedPayload &&
          currentSeedPayload.version === 4;
        if (
          workout.mesocycle.state === "AWAITING_HANDOFF" &&
          !isV4
        ) {
          const deletionAssessment =
            await assessClosedHandoffDeletionInTransaction(
              tx,
              workout.mesocycle,
            );
          if (!deletionAssessment.safe) {
            throw new DeleteWorkoutError(
              "Cannot delete this workout because the closed mesocycle would become unresolved.",
              "WORKOUT_DELETE_CLOSED_LIFECYCLE_REGRESSION",
            );
          }
        }
        await reconcileMesocycleLifecycle(tx, workout.mesocycle);
      }
      return { status: "deleted" as const };
    },
  );
}
