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
  resumeBlockedReason: string | null;
};

export type WorkoutWorkflowMesocycleContext = {
  mesocycleId?: string | null;
  mesocycleState?: string | null;
  mesocycleIsActive?: boolean | null;
};

export function getClosedMesocycleWorkoutFenceReason(
  context: WorkoutWorkflowMesocycleContext
): string | null {
  if (!context.mesocycleId || context.mesocycleIsActive) {
    return null;
  }

  switch (context.mesocycleState) {
    case "AWAITING_HANDOFF":
      return "This workout belongs to a closed mesocycle with handoff pending and can no longer be resumed.";
    case "COMPLETED":
      return "This workout belongs to a completed mesocycle and can no longer be resumed.";
    default:
      return "This workout belongs to an inactive mesocycle and can no longer be resumed.";
  }
}

export function getWorkoutWorkflowState(
  status: string | null | undefined,
  context: WorkoutWorkflowMesocycleContext = {}
): WorkoutWorkflowState {
  const normalizedStatus = status?.trim().toUpperCase();
  const resumeBlockedReason =
    normalizedStatus === "PLANNED" ||
    normalizedStatus === "IN_PROGRESS" ||
    normalizedStatus === "PARTIAL"
      ? getClosedMesocycleWorkoutFenceReason(context)
      : null;
  const isResumable = resumeBlockedReason == null;

  switch (normalizedStatus) {
    case "PLANNED":
      return {
        kind: "planned",
        isReviewable: false,
        isResumable,
        isTerminalForWorkflow: false,
        isPerformedForAnalytics: false,
        resumeBlockedReason,
      };
    case "IN_PROGRESS":
      return {
        kind: "in_progress",
        isReviewable: false,
        isResumable,
        isTerminalForWorkflow: false,
        isPerformedForAnalytics: false,
        resumeBlockedReason,
      };
    case "PARTIAL":
      return {
        kind: "partial",
        isReviewable: true,
        isResumable,
        isTerminalForWorkflow: false,
        isPerformedForAnalytics: true,
        resumeBlockedReason,
      };
    case "COMPLETED":
      return {
        kind: "completed",
        isReviewable: true,
        isResumable: false,
        isTerminalForWorkflow: true,
        isPerformedForAnalytics: true,
        resumeBlockedReason: null,
      };
    case "SKIPPED":
      return {
        kind: "skipped",
        isReviewable: true,
        isResumable: false,
        isTerminalForWorkflow: true,
        isPerformedForAnalytics: false,
        resumeBlockedReason: null,
      };
    default:
      return {
        kind: "unknown",
        isReviewable: false,
        isResumable: false,
        isTerminalForWorkflow: false,
        isPerformedForAnalytics: false,
        resumeBlockedReason: null,
      };
  }
}

export function getWorkoutDetailTitle(
  status: string | null | undefined,
  context: WorkoutWorkflowMesocycleContext = {}
): string {
  const state = getWorkoutWorkflowState(status, context);

  if (state.kind === "partial") {
    return "Partial Session";
  }
  if (state.isReviewable && !state.isResumable) {
    return "Session Review";
  }
  return "Session Overview";
}
