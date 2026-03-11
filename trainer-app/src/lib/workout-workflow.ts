export type WorkoutWorkflowKind =
  | "planned"
  | "in_progress"
  | "partial"
  | "completed"
  | "skipped"
  | "unknown";

export type WorkoutWorkflowState = {
  kind: WorkoutWorkflowKind;
  isReviewable: boolean;
  isResumable: boolean;
  isTerminalForWorkflow: boolean;
  isPerformedForAnalytics: boolean;
};

export function getWorkoutWorkflowState(status: string | null | undefined): WorkoutWorkflowState {
  const normalizedStatus = status?.trim().toUpperCase();

  switch (normalizedStatus) {
    case "PLANNED":
      return {
        kind: "planned",
        isReviewable: false,
        isResumable: true,
        isTerminalForWorkflow: false,
        isPerformedForAnalytics: false,
      };
    case "IN_PROGRESS":
      return {
        kind: "in_progress",
        isReviewable: false,
        isResumable: true,
        isTerminalForWorkflow: false,
        isPerformedForAnalytics: false,
      };
    case "PARTIAL":
      return {
        kind: "partial",
        isReviewable: true,
        isResumable: true,
        isTerminalForWorkflow: false,
        isPerformedForAnalytics: true,
      };
    case "COMPLETED":
      return {
        kind: "completed",
        isReviewable: true,
        isResumable: false,
        isTerminalForWorkflow: true,
        isPerformedForAnalytics: true,
      };
    case "SKIPPED":
      return {
        kind: "skipped",
        isReviewable: true,
        isResumable: false,
        isTerminalForWorkflow: true,
        isPerformedForAnalytics: false,
      };
    default:
      return {
        kind: "unknown",
        isReviewable: false,
        isResumable: false,
        isTerminalForWorkflow: false,
        isPerformedForAnalytics: false,
      };
  }
}

export function getWorkoutDetailTitle(status: string | null | undefined): string {
  const state = getWorkoutWorkflowState(status);

  if (state.kind === "partial") {
    return "Partial Session";
  }
  if (state.isReviewable && !state.isResumable) {
    return "Session Review";
  }
  return "Session Overview";
}
