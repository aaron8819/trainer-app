import Link from "next/link";
import { getWorkoutWorkflowState } from "@/lib/workout-workflow";

export type WorkoutRowActionItem = {
  id: string;
  status: string;
  isCloseoutDismissed?: boolean;
  mesocycleId?: string | null;
  mesocycleState?: string | null;
  mesocycleIsActive?: boolean | null;
};

const ACTION_LINK_CLASS =
  "inline-flex min-h-10 items-center rounded-full px-2 text-sm font-semibold text-slate-900";

export function WorkoutRowActions({ workout }: { workout: WorkoutRowActionItem }) {
  if (workout.isCloseoutDismissed) {
    return (
      <Link className={ACTION_LINK_CLASS} href={`/workout/${workout.id}`}>
        View
      </Link>
    );
  }

  const workflow = getWorkoutWorkflowState(workout.status, {
    mesocycleId: workout.mesocycleId,
    mesocycleState: workout.mesocycleState,
    mesocycleIsActive: workout.mesocycleIsActive,
  });

  if (workflow.kind === "planned" && workflow.isResumable) {
    return (
      <Link className={ACTION_LINK_CLASS} href={`/log/${workout.id}`}>
        Log
      </Link>
    );
  }

  if (workflow.kind === "in_progress" && workflow.isResumable) {
    return (
      <Link className={ACTION_LINK_CLASS} href={`/log/${workout.id}`}>
        Continue
      </Link>
    );
  }

  if (workflow.kind === "partial" && workflow.isResumable) {
    return (
      <>
        <Link className={ACTION_LINK_CLASS} href={`/workout/${workout.id}`}>
          Review
        </Link>
        <Link className={ACTION_LINK_CLASS} href={`/log/${workout.id}`}>
          Resume
        </Link>
      </>
    );
  }

  return (
    <Link className={ACTION_LINK_CLASS} href={`/workout/${workout.id}`}>
      {workflow.kind === "partial" ? "Review" : "View"}
    </Link>
  );
}
