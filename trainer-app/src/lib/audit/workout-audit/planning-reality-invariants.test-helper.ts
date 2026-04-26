type PlanningRealityForForbiddenInvariant = {
  finalSlotPlan?: ReadonlyArray<{
    slotId: string;
    exercises: ReadonlyArray<{
      exerciseId: string;
      exerciseName: string;
      primaryMuscles?: ReadonlyArray<string>;
    }>;
  }>;
  slotPrescriptionIntents?: ReadonlyArray<{
    slotId: string;
    musclePrescriptions: ReadonlyArray<{
      muscle: string;
      targetStatus: string;
      demandType: string;
    }>;
  }>;
};

export type FinalSlotForbiddenPrescriptionViolation = {
  slotId: string;
  muscle: string;
  exerciseId: string;
  exerciseName: string;
};

export function findFinalSlotForbiddenPrescriptionViolations(
  planningReality: PlanningRealityForForbiddenInvariant | null | undefined,
): FinalSlotForbiddenPrescriptionViolation[] {
  const finalSlotById = new Map(
    (planningReality?.finalSlotPlan ?? []).map((slot) => [slot.slotId, slot]),
  );

  return (planningReality?.slotPrescriptionIntents ?? []).flatMap((intent) => {
    const forbiddenMuscles = new Set(
      intent.musclePrescriptions
        .filter(
          (prescription) =>
            prescription.targetStatus === "forbidden" &&
            prescription.demandType === "do_not_train_here",
        )
        .map((prescription) => prescription.muscle),
    );
    if (forbiddenMuscles.size === 0) {
      return [];
    }

    const finalSlot = finalSlotById.get(intent.slotId);
    return (finalSlot?.exercises ?? []).flatMap((exercise) =>
      (exercise.primaryMuscles ?? [])
        .filter((muscle) => forbiddenMuscles.has(muscle))
        .map((muscle) => ({
          slotId: intent.slotId,
          muscle,
          exerciseId: exercise.exerciseId,
          exerciseName: exercise.exerciseName,
        })),
    );
  });
}
