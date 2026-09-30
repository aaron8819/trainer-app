import type { SavedSetResult } from '@/lib/trainer2-contracts/set-results';

export type RestState = { version: 1; seen: string[]; event: string; recordedAt: number; deadline: number; duration: number };
export const restKey = (account: string, execution: string) => `trainer2-rest:${account}:${execution}`;
export function readRest(raw: string | null): RestState | null {
  try {
    const s = JSON.parse(raw ?? 'null');
    return s?.version === 1 && Array.isArray(s.seen) && s.seen.every((v: unknown) => typeof v === 'string') &&
      typeof s.event === 'string' && [s.recordedAt, s.deadline, s.duration].every(Number.isFinite) && s.duration > 0 ? s : null;
  } catch { return null; }
}
export function recordRest(state: RestState | null, record: SavedSetResult, main: boolean, confirmedAt = Date.now()): RestState | null {
  // Only the first record is a new performed event. Clear/re-record is a correction.
  if (record.version !== 1 || !record.result || state?.seen.includes(record.actionId)) return state;
  const recordedAt = Date.parse(record.recordedAt);
  if (!Number.isFinite(recordedAt)) return state;
  const seen = [...(state?.seen ?? []), record.actionId];
  if (state && state.recordedAt >= recordedAt) return { ...state, seen };
  const duration = main ? 180000 : 120000;
  return { version: 1, seen, event: record.actionId, recordedAt, deadline: confirmedAt + duration, duration };
}
// A new deadline can arrive between UI clock ticks. Never display more than
// the timer's duration just because the last tick predates its start.
export const restRemaining = (state: RestState, now: number) => Math.max(0, Math.ceil(Math.min(state.duration, state.deadline - now) / 1000));
