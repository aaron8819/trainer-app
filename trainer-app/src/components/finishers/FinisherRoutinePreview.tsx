import type { FinisherRoutineDto } from "@/lib/api/finisher-routine-dto";

export function formatFinisherDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function displayFinisherEnum(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function FinisherRoutinePreview({
  routine,
}: {
  routine: FinisherRoutineDto;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
        Finisher preview
      </p>
      <h2 className="mt-1 text-2xl font-semibold text-slate-950">
        {routine.name}
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {routine.description}
      </p>
      <p className="mt-3 text-sm font-medium text-slate-700">
        {formatFinisherDuration(routine.durationSeconds)} ·{" "}
        {displayFinisherEnum(routine.category)} ·{" "}
        {displayFinisherEnum(routine.difficulty)} ·{" "}
        {routine.preparationSeconds}-second optional preparation
      </p>
      <ol className="mt-5 space-y-3">
        {routine.steps.map((step) => (
          <li className="rounded-xl bg-slate-50 p-3" key={step.id}>
            <p className="font-medium text-slate-900">
              {step.orderIndex + 1}. {step.movementName}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {step.workSeconds}s work · {step.recoverySeconds}s recovery
            </p>
            {step.techniqueCues.map((cue) => (
              <p className="mt-1 text-sm text-slate-600" key={cue}>
                {cue}
              </p>
            ))}
            {step.alternatives.length ? (
              <p className="mt-1 text-sm text-sky-700">
                Alternative: {" "}
                {step.alternatives
                  .map((item) => item.movementName)
                  .join(", ")}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
