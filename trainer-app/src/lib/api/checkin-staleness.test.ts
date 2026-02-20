/**
 * Protects: Readiness canonicalized to ReadinessSignal; session-checkins is a compatibility shim.
 * Why it matters: Legacy check-in compatibility must not leak stale readiness into decisions.
 */
import { describe, expect, it } from "vitest";
import {
  CHECK_IN_STALENESS_WINDOW_MS,
  mapLatestCheckIn,
  type CheckInRow,
} from "./checkin-staleness";

const NOW_ISO = "2026-02-11T12:00:00.000Z";

function makeCheckIn(offsetMs: number): CheckInRow {
  return {
    date: new Date(new Date(NOW_ISO).getTime() - offsetMs),
    readiness: 2,
    painFlags: { shoulder: 2, knee: 0 },
    notes: "test",
  };
}

describe("mapLatestCheckIn", () => {
  it("returns undefined when no check-ins exist", () => {
    expect(mapLatestCheckIn(undefined, new Date(NOW_ISO))).toBeUndefined();
    expect(mapLatestCheckIn([], new Date(NOW_ISO))).toBeUndefined();
  });

  it("maps the latest check-in when it is newer than 48 hours", () => {
    const mapped = mapLatestCheckIn(
      [makeCheckIn(CHECK_IN_STALENESS_WINDOW_MS - 1)],
      new Date(NOW_ISO)
    );

    expect(mapped?.readiness).toBe(2);
    expect(mapped?.painFlags).toEqual({ shoulder: 2, knee: 0 });
    expect(mapped?.notes).toBe("test");
  });

  it("keeps check-ins that are exactly 48 hours old", () => {
    const mapped = mapLatestCheckIn([makeCheckIn(CHECK_IN_STALENESS_WINDOW_MS)], new Date(NOW_ISO));

    expect(mapped).toBeDefined();
    expect(mapped?.readiness).toBe(2);
  });

  it("ignores check-ins older than 48 hours", () => {
    const mapped = mapLatestCheckIn(
      [makeCheckIn(CHECK_IN_STALENESS_WINDOW_MS + 1)],
      new Date(NOW_ISO)
    );

    expect(mapped).toBeUndefined();
  });
});
