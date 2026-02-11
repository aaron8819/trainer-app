import type { Exercise, WorkoutHistoryEntry } from "./types";
import { VOLUME_LANDMARKS } from "./volume-landmarks";

const DEFAULT_SRA_WINDOW_HOURS = 48;
const USE_DB_SRA_WINDOWS_ENV = "USE_DB_SRA_WINDOWS";

export type MuscleRecoveryState = {
  muscle: string;
  lastTrainedHoursAgo: number | null;
  sraWindowHours: number;
  isRecovered: boolean;
  recoveryPercent: number;
};

export type SraWarning = {
  muscle: string;
  lastTrainedHoursAgo: number;
  sraWindowHours: number;
  recoveryPercent: number;
};

export function buildMuscleRecoveryMap(
  history: WorkoutHistoryEntry[],
  exerciseLibrary: Exercise[],
  now?: Date
): Map<string, MuscleRecoveryState> {
  const nowMs = (now ?? new Date()).getTime();
  const byId = new Map(exerciseLibrary.map((e) => [e.id, e]));
  const defaultSraWindows = buildDefaultSraWindows();
  const dbSraWindows = shouldUseDbSraWindows()
    ? buildDbSraWindows(exerciseLibrary)
    : new Map<string, { muscle: string; hours: number }>();

  // Find last trained time for each muscle
  const lastTrained = new Map<string, number>();
  const muscleLabels = new Map<string, string>();

  for (const entry of history) {
    if (!entry.completed) continue;
    const entryMs = new Date(entry.date).getTime();

    for (const ex of entry.exercises) {
      const exercise = byId.get(ex.exerciseId);
      if (!exercise) continue;

      const muscles = [
        ...(exercise.primaryMuscles ?? []),
        ...(ex.primaryMuscles ?? []),
      ];
      const uniqueMuscles = [...new Set(muscles)];

      for (const muscle of uniqueMuscles) {
        const key = normalizeMuscleKey(muscle);
        if (!muscleLabels.has(key)) {
          muscleLabels.set(key, muscle);
        }
        const prev = lastTrained.get(key);
        if (!prev || entryMs > prev) {
          lastTrained.set(key, entryMs);
        }
      }
    }
  }

  const allMuscleKeys = new Set<string>([
    ...defaultSraWindows.keys(),
    ...dbSraWindows.keys(),
    ...lastTrained.keys(),
  ]);

  const recoveryMap = new Map<string, MuscleRecoveryState>();

  for (const muscleKey of allMuscleKeys) {
    const dbSraWindow = dbSraWindows.get(muscleKey);
    const defaultSraWindow = defaultSraWindows.get(muscleKey);
    const muscle =
      muscleLabels.get(muscleKey) ??
      dbSraWindow?.muscle ??
      defaultSraWindow?.muscle ??
      muscleKey;
    const lastMs = lastTrained.get(muscleKey);
    const hoursAgo = lastMs !== undefined ? (nowMs - lastMs) / (1000 * 60 * 60) : null;
    const sraWindow =
      dbSraWindow?.hours ?? defaultSraWindow?.hours ?? DEFAULT_SRA_WINDOW_HOURS;

    let recoveryPercent = 100;
    if (hoursAgo !== null) {
      recoveryPercent = Math.min(100, Math.round((hoursAgo / sraWindow) * 100));
    }

    recoveryMap.set(muscle, {
      muscle,
      lastTrainedHoursAgo: hoursAgo !== null ? Math.round(hoursAgo) : null,
      sraWindowHours: sraWindow,
      isRecovered: recoveryPercent >= 100,
      recoveryPercent,
    });
  }

  return recoveryMap;
}

export function generateSraWarnings(
  recoveryMap: Map<string, MuscleRecoveryState>,
  targetMuscles: string[]
): SraWarning[] {
  const warnings: SraWarning[] = [];
  const recoveryByMuscleKey = new Map<string, MuscleRecoveryState>(
    Array.from(recoveryMap.values()).map((state) => [normalizeMuscleKey(state.muscle), state])
  );

  for (const muscle of targetMuscles) {
    const state = recoveryMap.get(muscle) ?? recoveryByMuscleKey.get(normalizeMuscleKey(muscle));
    if (!state || state.isRecovered || state.lastTrainedHoursAgo === null) continue;

    warnings.push({
      muscle: state.muscle,
      lastTrainedHoursAgo: state.lastTrainedHoursAgo,
      sraWindowHours: state.sraWindowHours,
      recoveryPercent: state.recoveryPercent,
    });
  }

  return warnings;
}

function shouldUseDbSraWindows(): boolean {
  const rawValue = process.env[USE_DB_SRA_WINDOWS_ENV];
  if (!rawValue) {
    return true;
  }
  const normalized = rawValue.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function buildDefaultSraWindows() {
  return new Map<string, { muscle: string; hours: number }>(
    Object.entries(VOLUME_LANDMARKS).map(([muscle, landmark]) => [
      normalizeMuscleKey(muscle),
      { muscle, hours: landmark.sraHours },
    ])
  );
}

function buildDbSraWindows(exerciseLibrary: Exercise[]) {
  const windows = new Map<string, { muscle: string; hours: number }>();
  for (const exercise of exerciseLibrary) {
    const entries = Object.entries(exercise.muscleSraHours ?? {});
    for (const [muscle, hours] of entries) {
      if (!Number.isFinite(hours) || hours <= 0) {
        continue;
      }
      const key = normalizeMuscleKey(muscle);
      if (!windows.has(key)) {
        windows.set(key, { muscle, hours: Math.round(hours) });
      }
    }
  }
  return windows;
}

function normalizeMuscleKey(muscle: string) {
  return muscle.trim().toLowerCase();
}
