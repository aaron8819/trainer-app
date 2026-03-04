export type WorkoutSessionSnapshotSummary = {
  week: number;
  session: number | null;
  phase: string | null;
};

export function buildWorkoutSessionSnapshotSummary(input: {
  week?: number | null;
  session?: number | null;
  phase?: string | null;
}): WorkoutSessionSnapshotSummary | null {
  if (input.week == null) {
    return null;
  }

  return {
    week: input.week,
    session: input.session ?? null,
    phase: input.phase ?? null,
  };
}

export function formatWorkoutSessionSnapshotLabel(
  snapshot: WorkoutSessionSnapshotSummary | null | undefined
): string | null {
  if (!snapshot) {
    return null;
  }

  return snapshot.session != null ? `Wk${snapshot.week}\u00B7S${snapshot.session}` : `Wk${snapshot.week}`;
}
