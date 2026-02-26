import Link from "next/link";

export type WorkoutRowActionItem = {
  id: string;
  status: string;
};

const ACTION_LINK_CLASS =
  "inline-flex min-h-10 items-center rounded-full px-2 text-sm font-semibold text-slate-900";

export function WorkoutRowActions({ workout }: { workout: WorkoutRowActionItem }) {
  switch (workout.status) {
    case "PLANNED":
      return (
        <Link className={ACTION_LINK_CLASS} href={`/log/${workout.id}`}>
          Log
        </Link>
      );
    case "IN_PROGRESS":
      return (
        <Link className={ACTION_LINK_CLASS} href={`/log/${workout.id}`}>
          Continue
        </Link>
      );
    case "PARTIAL":
      return (
        <>
          <Link className={ACTION_LINK_CLASS} href={`/workout/${workout.id}`}>
            Review
          </Link>
          <Link className={ACTION_LINK_CLASS} href={`/log/${workout.id}`}>
            Log
          </Link>
        </>
      );
    case "COMPLETED":
    case "SKIPPED":
    default:
      return (
        <Link className={ACTION_LINK_CLASS} href={`/workout/${workout.id}`}>
          View
        </Link>
      );
  }
}
