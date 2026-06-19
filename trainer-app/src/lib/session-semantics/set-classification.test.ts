import { describe, expect, it } from "vitest";
import { classifySetLog } from "./set-classification";

describe("classifySetLog", () => {
  it("classifies skipped sets as resolved but not performed", () => {
    expect(classifySetLog({ wasSkipped: true })).toEqual({
      isSkipped: true,
      isResolved: true,
      isPerformed: false,
      isWorkEvidence: false,
      isSignal: false,
      countsTowardVolume: false,
    });
  });

  it("classifies unresolved empty sets as unresolved", () => {
    expect(classifySetLog({})).toEqual({
      isSkipped: false,
      isResolved: false,
      isPerformed: false,
      isWorkEvidence: false,
      isSignal: false,
      countsTowardVolume: false,
    });
  });

  it("classifies performed sets with reps and rpe as performed signal volume", () => {
    expect(classifySetLog({ actualReps: 8, actualRpe: 8, actualLoad: 135 })).toEqual({
      isSkipped: false,
      isResolved: true,
      isPerformed: true,
      isWorkEvidence: true,
      isSignal: true,
      countsTowardVolume: true,
    });
  });

  it("classifies load-only rows as resolved but not performed", () => {
    expect(classifySetLog({ actualLoad: 135 })).toEqual({
      isSkipped: false,
      isResolved: true,
      isPerformed: false,
      isWorkEvidence: false,
      isSignal: false,
      countsTowardVolume: false,
    });
  });

  it("suppresses low-rpe sets from signal while keeping them performed", () => {
    expect(classifySetLog({ actualReps: 10, actualRpe: 5, actualLoad: 95 })).toEqual({
      isSkipped: false,
      isResolved: true,
      isPerformed: true,
      isWorkEvidence: true,
      isSignal: false,
      countsTowardVolume: true,
    });
  });

  it("keeps warmup/ramp sets performed but excludes them from work evidence", () => {
    expect(
      classifySetLog({ setIntent: "WARMUP", actualReps: 12, actualRpe: 8, actualLoad: 55 })
    ).toEqual({
      isSkipped: false,
      isResolved: true,
      isPerformed: true,
      isWorkEvidence: false,
      isSignal: false,
      countsTowardVolume: false,
    });
  });
});
