type PersistedWorkoutMesocycleSnapshotInput = {
  mesocycleId?: string | null;
  mesocycleWeekSnapshot?: number | null;
  mesoSessionSnapshot?: number | null;
  mesocyclePhaseSnapshot?: string | null;
};

export type PersistedWorkoutMesocycleSnapshot = {
  mesocycleId: string;
  week: number;
  session: number | null;
  phase: string | null;
};

export function readPersistedWorkoutMesocycleSnapshot(
  input: PersistedWorkoutMesocycleSnapshotInput
): PersistedWorkoutMesocycleSnapshot | undefined {
  if (!input.mesocycleId || input.mesocycleWeekSnapshot == null) {
    return undefined;
  }

  return {
    mesocycleId: input.mesocycleId,
    week: input.mesocycleWeekSnapshot,
    session: input.mesoSessionSnapshot ?? null,
    phase: input.mesocyclePhaseSnapshot ?? null,
  };
}
