import { describe, expect, it } from "vitest";
import {
  getWorkoutDetailTitle,
  getWorkoutWorkflowState,
} from "./workout-workflow";

describe("workout workflow semantics", () => {
  it("treats PARTIAL as reviewable and resumable without making it terminal for workflow", () => {
    expect(getWorkoutWorkflowState("PARTIAL")).toEqual({
      kind: "partial",
      isReviewable: true,
      isResumable: true,
      isTerminalForWorkflow: false,
      isPerformedForAnalytics: true,
    });
  });

  it("normalizes lowercase workflow statuses used by resume-workout helpers", () => {
    expect(getWorkoutWorkflowState("partial").kind).toBe("partial");
    expect(getWorkoutWorkflowState("planned").kind).toBe("planned");
  });

  it("keeps COMPLETED terminal and reviewable", () => {
    expect(getWorkoutWorkflowState("COMPLETED")).toEqual({
      kind: "completed",
      isReviewable: true,
      isResumable: false,
      isTerminalForWorkflow: true,
      isPerformedForAnalytics: true,
    });
  });

  it("keeps SKIPPED terminal but not performed for analytics", () => {
    expect(getWorkoutWorkflowState("SKIPPED")).toEqual({
      kind: "skipped",
      isReviewable: true,
      isResumable: false,
      isTerminalForWorkflow: true,
      isPerformedForAnalytics: false,
    });
  });

  it("derives detail titles from workflow state instead of raw terminal/performed checks", () => {
    expect(getWorkoutDetailTitle("PLANNED")).toBe("Session Overview");
    expect(getWorkoutDetailTitle("PARTIAL")).toBe("Partial Session");
    expect(getWorkoutDetailTitle("COMPLETED")).toBe("Session Review");
  });
});
