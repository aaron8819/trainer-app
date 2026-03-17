import { describe, expect, it } from "vitest";
import {
  getClosedMesocycleWorkoutFenceReason,
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
      resumeBlockedReason: null,
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
      resumeBlockedReason: null,
    });
  });

  it("keeps SKIPPED terminal but not performed for analytics", () => {
    expect(getWorkoutWorkflowState("SKIPPED")).toEqual({
      kind: "skipped",
      isReviewable: true,
      isResumable: false,
      isTerminalForWorkflow: true,
      isPerformedForAnalytics: false,
      resumeBlockedReason: null,
    });
  });

  it("fences resumable statuses when the workout belongs to a closed mesocycle", () => {
    expect(
      getWorkoutWorkflowState("PARTIAL", {
        mesocycleId: "meso-1",
        mesocycleState: "COMPLETED",
        mesocycleIsActive: false,
      })
    ).toEqual({
      kind: "partial",
      isReviewable: true,
      isResumable: false,
      isTerminalForWorkflow: false,
      isPerformedForAnalytics: true,
      resumeBlockedReason:
        "This workout belongs to a completed mesocycle and can no longer be resumed.",
    });
    expect(
      getClosedMesocycleWorkoutFenceReason({
        mesocycleId: "meso-1",
        mesocycleState: "AWAITING_HANDOFF",
        mesocycleIsActive: false,
      })
    ).toMatch(/handoff pending/i);
  });

  it("derives detail titles from workflow state instead of raw terminal/performed checks", () => {
    expect(getWorkoutDetailTitle("PLANNED")).toBe("Session Overview");
    expect(getWorkoutDetailTitle("PARTIAL")).toBe("Partial Session");
    expect(getWorkoutDetailTitle("COMPLETED")).toBe("Session Review");
  });
});
