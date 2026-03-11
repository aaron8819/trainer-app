import { describe, expect, it } from "vitest";
import { classifySetLog } from "./set-classification";

describe("classifySetLog", () => {
  it("classifies skipped sets as resolved but not performed", () => {
    expect(classifySetLog({ wasSkipped: true })).toEqual({
      isSkipped: true,
      isResolved: true,
      isPerformed: false,
      isSignal: false,
      countsTowardVolume: false,
    });
  });

  it("classifies unresolved empty sets as unresolved", () => {
    expect(classifySetLog({})).toEqual({
      isSkipped: false,
      isResolved: false,
      isPerformed: false,
      isSignal: false,
      countsTowardVolume: false,
    });
  });

  it("classifies performed sets with reps and rpe as performed signal volume", () => {
    expect(classifySetLog({ actualReps: 8, actualRpe: 8, actualLoad: 135 })).toEqual({
      isSkipped: false,
      isResolved: true,
      isPerformed: true,
      isSignal: true,
      countsTowardVolume: true,
    });
  });

  it("classifies load-only rows as resolved but not performed", () => {
    expect(classifySetLog({ actualLoad: 135 })).toEqual({
      isSkipped: false,
      isResolved: true,
      isPerformed: false,
      isSignal: false,
      countsTowardVolume: false,
    });
  });

  it("suppresses low-rpe sets from signal while keeping them performed", () => {
    expect(classifySetLog({ actualReps: 10, actualRpe: 5, actualLoad: 95 })).toEqual({
      isSkipped: false,
      isResolved: true,
      isPerformed: true,
      isSignal: false,
      countsTowardVolume: true,
    });
  });
});
