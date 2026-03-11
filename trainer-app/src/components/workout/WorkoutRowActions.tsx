import Link from "next/link";
import { getWorkoutWorkflowState } from "@/lib/workout-workflow";

export type WorkoutRowActionItem = {
  id: string;
  status: string;
};

const ACTION_LINK_CLASS =
  "inline-flex min-h-10 items-center rounded-full px-2 text-sm font-semibold text-slate-900";

export function WorkoutRowActions({ workout }: { workout: WorkoutRowActionItem }) {
  const workflow = getWorkoutWorkflowState(workout.status);

  if (workflow.kind === "planned") {
    return (
      <Link className={ACTION_LINK_CLASS} href={`/log/${workout.id}`}>
        Log
      </Link>
    );
  }

  if (workflow.kind === "in_progress") {
    return (
      <Link className={ACTION_LINK_CLASS} href={`/log/${workout.id}`}>
        Continue
      </Link>
    );
  }

  if (workflow.kind === "partial") {
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
      View
    </Link>
  );
}
