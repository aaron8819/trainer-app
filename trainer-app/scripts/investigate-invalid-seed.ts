import {
  runWithRolloutEnvironment,
  sanitizedRolloutEnvironment,
} from "@/lib/operations/rollout-environment";

function readArgument(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mesocycleId = readArgument(argv, "--mesocycle-id");
  if (!mesocycleId) throw new Error("Missing required --mesocycle-id <id>.");

  await runWithRolloutEnvironment({ argv, allowWrite: false }, async (environment) => {
    const [{ prisma }, parserModule, receiptModule] = await Promise.all([
      import("@/lib/db/prisma"),
      import("@/lib/api/slot-plan-seed-parser"),
      import("@/lib/evidence/session-decision-receipt"),
    ]);
    try {
      const mesocycle = await prisma.mesocycle.findUnique({
        where: { id: mesocycleId },
        select: {
          id: true,
          state: true,
          isActive: true,
          closedAt: true,
          slotPlanSeedJson: true,
          slotSequenceJson: true,
          nextSeedDraftJson: true,
          workouts: {
            orderBy: [{ mesocycleWeekSnapshot: "asc" }, { scheduledDate: "asc" }],
            select: {
              id: true,
              status: true,
              scheduledDate: true,
              mesocycleWeekSnapshot: true,
              mesoSessionSnapshot: true,
              selectionMetadata: true,
              exercises: {
                select: {
                  exerciseId: true,
                  sets: {
                    select: {
                      id: true,
                      logs: { select: { actualReps: true, actualRpe: true, wasSkipped: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!mesocycle) throw new Error("Mesocycle not found.");
      const parsed = parserModule.parseSlotPlanSeedJson(mesocycle.slotPlanSeedJson);
      if (!parsed) throw new Error("Accepted seed cannot be parsed as the legacy-compatible seed shape.");

      const invalidExercises = parsed.slots.flatMap((slot) =>
        slot.exercises
          .filter((exercise) => !exercise.hasExplicitSetCount)
          .map((exercise) => ({ slotId: slot.slotId, exerciseId: exercise.exerciseId })),
      );
      const evidence = invalidExercises.map((invalid) => {
        const slot = parsed.slots.find((entry) => entry.slotId === invalid.slotId)!;
        const historical = mesocycle.workouts.flatMap((workout) => {
          const target = workout.exercises.find(
            (exercise) => exercise.exerciseId === invalid.exerciseId,
          );
          if (!target) return [];
          const receipt = receiptModule.readSessionDecisionReceipt(workout.selectionMetadata);
          const performedSetCount = target.sets.filter((set) =>
            set.logs.some((log) =>
              log.wasSkipped === true || log.actualReps != null || log.actualRpe != null,
            ),
          ).length;
          return [{
            status: workout.status,
            week: workout.mesocycleWeekSnapshot,
            session: workout.mesoSessionSnapshot,
            slotId: receipt?.sessionSlot?.slotId ?? null,
            compositionSource: receipt?.sessionProvenance?.compositionSource ?? null,
            plannedSetCount: target.sets.length,
            performedSetCount,
          }];
        });
        const sameSlot = historical.filter((row) => row.slotId === invalid.slotId);
        return {
          ...invalid,
          otherExercisesInSlot: slot.exercises
            .filter((exercise) => exercise.exerciseId !== invalid.exerciseId)
            .map((exercise) => ({
              exerciseId: exercise.exerciseId,
              explicitSetCount: exercise.setCount ?? null,
            })),
          allOtherExercisesHaveExplicitSetCount: slot.exercises
            .filter((exercise) => exercise.exerciseId !== invalid.exerciseId)
            .every((exercise) => exercise.hasExplicitSetCount),
          sameSlotHistoricalEvidence: sameSlot,
          sameSlotPlannedSetCounts: [...new Set(sameSlot.map((row) => row.plannedSetCount))],
          sameSlotEvidenceCount: sameSlot.length,
        };
      });

      console.log(JSON.stringify({
        environment: sanitizedRolloutEnvironment(environment),
        mesocycle: {
          id: mesocycle.id,
          state: mesocycle.state,
          active: mesocycle.isActive,
          closed: mesocycle.closedAt != null,
          workoutCount: mesocycle.workouts.length,
          completedWorkoutCount: mesocycle.workouts.filter((workout) => workout.status === "COMPLETED").length,
        },
        seed: {
          source: parsed.source ?? null,
          parserAcceptsLegacyShape: true,
          runtimeUsesLegacySetPrescriptionFallback: invalidExercises.length > 0,
          acceptedPlannerIntentPresent: parsed.acceptedPlannerIntent != null,
          nextSeedDraftPresent: mesocycle.nextSeedDraftJson != null,
          missingSetCountCount: invalidExercises.length,
          affectedSlots: [...new Set(invalidExercises.map((entry) => entry.slotId))],
          invalidExercises: evidence,
        },
        remediation: {
          classification: "permanent_legacy_unknown",
          rationale: "No formal legacy default is encoded; materialized planned sets are downstream prescriptions, not unambiguous accepted-seed intent. The mesocycle is inactive and completed.",
          exactPatchProposed: false,
          seedMutationPerformed: false,
          databaseWrites: 0,
        },
      }, null, 2));
    } finally {
      await prisma.$disconnect();
    }
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
