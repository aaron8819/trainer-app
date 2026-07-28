import { NextResponse } from "next/server";
import {
  ActivePlanSelectionConflictError,
  ActivePlanTargetArchivedError,
  ActivePlanTargetNotFoundError,
  ActivePlanTargetNotReadyError,
  ActiveWorkoutInProgressError,
} from "./active-plan-context";
import { PlanManagementError } from "./plan-management";

export function planManagementErrorResponse(
  error: unknown,
): NextResponse | null {
  if (error instanceof ActivePlanSelectionConflictError) {
    return NextResponse.json(
      {
        error: "The active plan changed. Refresh and try again.",
        code: "ACTIVE_PLAN_SELECTION_CONFLICT",
        currentActiveMacroCycleId: error.currentActiveMacroCycleId,
      },
      { status: 409 },
    );
  }
  if (error instanceof ActivePlanTargetNotReadyError) {
    return NextResponse.json(
      {
        error: "Only a READY plan can be activated.",
        code: "ACTIVE_PLAN_TARGET_NOT_READY",
      },
      { status: 409 },
    );
  }
  if (error instanceof ActivePlanTargetArchivedError) {
    return NextResponse.json(
      {
        error: "Archived plans cannot be activated.",
        code: "ACTIVE_PLAN_TARGET_ARCHIVED",
      },
      { status: 409 },
    );
  }
  if (error instanceof ActivePlanTargetNotFoundError) {
    return NextResponse.json(
      {
        error: "Plan not found.",
        code: "PLAN_NOT_FOUND",
      },
      { status: 404 },
    );
  }
  if (error instanceof ActiveWorkoutInProgressError) {
    return NextResponse.json(
      {
        error: "Finish or close the workout in progress before switching plans.",
        code: "ACTIVE_WORKOUT_IN_PROGRESS",
        workoutId: error.workoutId,
      },
      { status: 409 },
    );
  }
  if (!(error instanceof PlanManagementError)) return null;

  switch (error.code) {
    case "PLAN_NOT_FOUND":
      return NextResponse.json(
        { error: "Plan not found.", code: error.code },
        { status: 404 },
      );
    case "ACTIVE_PLAN_ARCHIVE_FORBIDDEN":
      return NextResponse.json(
        {
          error: "The active plan cannot be archived. Switch plans first.",
          code: error.code,
        },
        { status: 409 },
      );
    case "PLAN_MUTATION_CONFLICT":
      return NextResponse.json(
        {
          error: "This plan changed. Refresh and try again.",
          code: error.code,
          ...error.details,
        },
        { status: 409 },
      );
    case "PLAN_NOT_PREPARING":
      return NextResponse.json(
        {
          error: "Only a plan that is still being prepared can be finalized.",
          code: error.code,
        },
        { status: 409 },
      );
    case "PLAN_INVALID":
      return NextResponse.json(
        {
          error: "The generated plan is incomplete and cannot be finalized.",
          code: error.code,
        },
        { status: 409 },
      );
    case "PLAN_LIMITATION_UNRECOGNIZED":
      return NextResponse.json(
        {
          error:
            "An active exercise limitation is not recognized. Update it to a supported area (low/lower back, knee, shoulder, hip, elbow, or wrist) before creating a Strength plan.",
          code: error.code,
          ...error.details,
        },
        { status: 409 },
      );
    case "PLAN_OWNER_NOT_READY":
      return NextResponse.json(
        {
          error: "Complete profile setup before creating a plan.",
          code: error.code,
        },
        { status: 409 },
      );
  }
}
