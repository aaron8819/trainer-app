export const DIRECT_STIMULUS_WEIGHT = 1;
export const INDIRECT_STIMULUS_WEIGHT = 0.3;

export function buildRelationshipStimulusProfile<MuscleId extends string>(input: {
  directMuscleIds: readonly MuscleId[];
  indirectMuscleIds: readonly MuscleId[];
}): Partial<Record<MuscleId, number>> {
  const direct = new Set(input.directMuscleIds);
  return Object.fromEntries(
    [
      ...input.directMuscleIds.map(
        (muscleId) => [muscleId, DIRECT_STIMULUS_WEIGHT] as const,
      ),
      ...input.indirectMuscleIds.flatMap((muscleId) =>
        direct.has(muscleId)
          ? []
          : ([[muscleId, INDIRECT_STIMULUS_WEIGHT]] as const),
      ),
    ].sort(([left], [right]) => left.localeCompare(right)),
  ) as Partial<Record<MuscleId, number>>;
}

export function calculateWorkingSetStimulus<MuscleId extends string>(
  profile: Partial<Record<MuscleId, number>>,
  workingSets: number,
): Map<MuscleId, number> {
  const normalizedWorkingSets = Number.isFinite(workingSets)
    ? Math.max(0, workingSets)
    : 0;
  return new Map(
    Object.entries(profile)
      .flatMap(([muscleId, weight]) =>
        typeof weight === "number" && Number.isFinite(weight) && weight > 0
          ? ([[muscleId as MuscleId, weight * normalizedWorkingSets]] as const)
          : [],
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function addStimulusContribution<MuscleId extends string>(
  totals: Map<MuscleId, number>,
  contribution: ReadonlyMap<MuscleId, number>,
): void {
  for (const [muscleId, value] of contribution) {
    totals.set(muscleId, (totals.get(muscleId) ?? 0) + value);
  }
}
