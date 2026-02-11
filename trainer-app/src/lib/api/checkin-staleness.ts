import type { SessionCheckIn as EngineSessionCheckIn } from "../engine/types";

export const CHECK_IN_STALENESS_WINDOW_MS = 48 * 60 * 60 * 1000;

export type CheckInRow = {
  date: Date;
  readiness: number;
  painFlags: unknown;
  notes: string | null;
};

export function mapLatestCheckIn(
  checkIns: CheckInRow[] | null | undefined,
  now = new Date(),
  stalenessWindowMs = CHECK_IN_STALENESS_WINDOW_MS
): EngineSessionCheckIn | undefined {
  if (!checkIns || checkIns.length === 0) {
    return undefined;
  }

  const latest = checkIns[0];
  const ageMs = now.getTime() - latest.date.getTime();
  if (ageMs > stalenessWindowMs) {
    return undefined;
  }

  return {
    date: latest.date.toISOString(),
    readiness: latest.readiness as 1 | 2 | 3 | 4 | 5,
    painFlags: (latest.painFlags as Record<string, 0 | 1 | 2 | 3>) ?? undefined,
    notes: latest.notes ?? undefined,
  };
}
