"use client";\r\n\r\nimport Link from "next/link";\r\nimport { useMemo, useState } from "react";

export type LogSetInput = {
  setId: string;
  setIndex: number;
  targetReps: number;
  targetLoad?: number | null;
  targetRpe?: number | null;
  actualReps?: number | null;
  actualLoad?: number | null;
  actualRpe?: number | null;
  wasSkipped?: boolean;
};

export type LogExerciseInput = {
  workoutExerciseId: string;
  name: string;
  isMainLift: boolean;
  sets: LogSetInput[];
};

type SectionedExercises = {
  warmup?: LogExerciseInput[];
  main: LogExerciseInput[];
  accessory?: LogExerciseInput[];
};

type NormalizedExercises = {
  warmup: LogExerciseInput[];
  main: LogExerciseInput[];
  accessory: LogExerciseInput[];
};

type BaselineUpdateSummary = {
  context: string;
  evaluatedExercises: number;
  updated: number;
  skipped: number;
  items: {
    exerciseName: string;
    previousTopSetWeight?: number;
    newTopSetWeight: number;
    reps: number;
  }[];
  skippedItems: {
    exerciseName: string;
    reason: string;
  }[];
};

function normalizeExercises(exercises: LogExerciseInput[] | SectionedExercises): NormalizedExercises {
  if (Array.isArray(exercises)) {
    return { warmup: [], main: exercises, accessory: [] };
  }
  return {
    warmup: exercises.warmup ?? [],
    main: exercises.main ?? [],
    accessory: exercises.accessory ?? [],
  };
}

function withDefaults(exercises: NormalizedExercises): NormalizedExercises {
  const applyDefaults = (items: LogExerciseInput[]) =>
    items.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({
        ...set,
        actualReps: set.actualReps ?? set.targetReps ?? null,
        actualLoad: set.actualLoad ?? set.targetLoad ?? null,
        actualRpe: set.actualRpe ?? set.targetRpe ?? null,
      })),
    }));

  return {
    warmup: applyDefaults(exercises.warmup),
    main: applyDefaults(exercises.main),
    accessory: applyDefaults(exercises.accessory),
  };
}

export default function LogWorkoutClient({
  workoutId,
  exercises,
}: {
  workoutId: string;
  exercises: LogExerciseInput[] | SectionedExercises;
}) {
  const initial = useMemo(() => withDefaults(normalizeExercises(exercises)), [exercises]);
  const [data, setData] = useState<NormalizedExercises>(initial);
  const [savingSetId, setSavingSetId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [baselineSummary, setBaselineSummary] = useState<BaselineUpdateSummary | null>(null);
  const [loggedSetIds, setLoggedSetIds] = useState<Set<string>>(new Set());\r\n  const [skipReason, setSkipReason] = useState("");

  const allExercises = [...data.warmup, ...data.main, ...data.accessory];

  const updateSet = (
    exerciseIndex: number,
    setIndex: number,
    field: keyof LogSetInput,
    value: number | boolean | null
  ) => {
    setData((prev) => {
      const updated = { ...prev } as NormalizedExercises;
      const flat = [...updated.warmup, ...updated.main, ...updated.accessory];
      const targetExercise = flat[exerciseIndex];
      if (!targetExercise) {
        return prev;
      }
      const updatedSets = targetExercise.sets.map((set, index) =>
        index === setIndex ? { ...set, [field]: value } : set
      );

      const rebuild = (list: LogExerciseInput[]) =>
        list.map((exercise) =>
          exercise.workoutExerciseId === targetExercise.workoutExerciseId
            ? { ...exercise, sets: updatedSets }
            : exercise
        );

      updated.warmup = rebuild(updated.warmup);
      updated.main = rebuild(updated.main);
      updated.accessory = rebuild(updated.accessory);
      return updated;
    });
  };

  const handleLogSet = async (exerciseIndex: number, setIndex: number) => {
    setStatus(null);
    setError(null);

    const set = allExercises[exerciseIndex].sets[setIndex];
    setSavingSetId(set.setId);

    const response = await fetch("/api/logs/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workoutSetId: set.setId,
        workoutExerciseId: allExercises[exerciseIndex].workoutExerciseId,
        actualReps: set.actualReps ?? undefined,
        actualLoad: set.actualLoad ?? undefined,
        actualRpe: set.actualRpe ?? undefined,
        wasSkipped: set.wasSkipped ?? false,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to log set");
      setSavingSetId(null);
      return;
    }

    setLoggedSetIds((prev) => {
      const next = new Set(prev);
      next.add(set.setId);
      return next;
    });
    setStatus("Set logged");
    setSavingSetId(null);
  };

  const handleCompleteWorkout = async () => {
    setStatus(null);
    setError(null);
    setBaselineSummary(null);

    const response = await fetch("/api/workouts/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workoutId,
        status: "COMPLETED",
        exercises: [],
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to mark workout completed");
      return;
    }

    const body = await response.json().catch(() => ({}));
    setBaselineSummary(body.baselineSummary ?? null);
    setCompleted(true);
    setStatus("Workout marked as completed");
  };

  const handleSkipWorkout = async () => {
    setStatus(null);
    setError(null);
    setBaselineSummary(null);

    const response = await fetch("/api/workouts/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workoutId,
        status: "SKIPPED",\r\n        notes: skipReason ? `Skipped: ${skipReason}` : "Skipped",\r\n        exercises: [],
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to mark workout skipped");
      return;
    }

    setSkipped(true);
    setStatus("Workout marked as skipped");
  };

  const isBaselineEligible = (set: LogSetInput) => {
    if (!loggedSetIds.has(set.setId)) {
      return false;
    }
    if (set.wasSkipped) {
      return false;
    }
    if (set.actualReps === null || set.actualReps === undefined) {
      return false;
    }
    if (set.actualLoad === null || set.actualLoad === undefined) {
      return false;
    }
    if (set.targetReps !== undefined && set.actualReps < set.targetReps) {
      return false;
    }
    if (
      set.targetRpe !== undefined &&
      set.actualRpe !== null &&
      set.actualRpe !== undefined &&
      set.actualRpe > set.targetRpe
    ) {
      return false;
    }
    return true;
  };

  const renderSection = (label: string, items: LogExerciseInput[], offset: number) => {
    if (!items || items.length === 0) {
      return null;
    }

    return (
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{label}</h2>
        {items.map((exercise, exerciseIndex) => (
          <div key={exercise.workoutExerciseId} className="rounded-2xl border border-slate-200 p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">{exercise.name}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {exercise.isMainLift ? "Main lift" : "Accessory"}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {exercise.sets.map((set, setIndex) => (
                <div key={set.setId} className="rounded-xl border border-slate-100 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">Set {set.setIndex}</p>
                      {isBaselineEligible(set) ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          Baseline +
                        </span>
                      ) : null}
                    </div>
                    <button
                      className="text-xs font-semibold text-slate-700 underline disabled:opacity-50"
                      onClick={() => handleLogSet(offset + exerciseIndex, setIndex)}
                      disabled={savingSetId === set.setId}
                    >
                      {savingSetId === set.setId ? "Saving..." : "Log set"}
                    </button>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <label className="text-xs text-slate-500">
                      Reps
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        type="number"
                        value={set.actualReps ?? ""}
                        onChange={(event) => updateSet(offset + exerciseIndex, setIndex, "actualReps", Number(event.target.value))}
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      Load (lbs)
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        type="number"
                        value={set.actualLoad ?? ""}
                        onChange={(event) => updateSet(offset + exerciseIndex, setIndex, "actualLoad", Number(event.target.value))}
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      RPE
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        type="number"
                        step="0.5"
                        value={set.actualRpe ?? ""}
                        onChange={(event) => updateSet(offset + exerciseIndex, setIndex, "actualRpe", Number(event.target.value))}
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={set.wasSkipped ?? false}
                      onChange={(event) => updateSet(offset + exerciseIndex, setIndex, "wasSkipped", event.target.checked)}
                    />
                    Mark as skipped
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    );
  };

  const warmupOffset = 0;
  const mainOffset = data.warmup.length;
  const accessoryOffset = data.warmup.length + data.main.length;

  return (
    <div className="mt-6 space-y-6">
      {renderSection("Warmup", data.warmup, warmupOffset)}
      {renderSection("Main Lifts", data.main, mainOffset)}
      {renderSection("Accessories", data.accessory, accessoryOffset)}

      {status ? <p className="text-sm text-emerald-600">{status}</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {baselineSummary ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm">
          <p className="font-semibold text-slate-900">Baseline updates</p>
          <p className="mt-1 text-slate-600">
            Context: {baselineSummary.context} · Evaluated: {baselineSummary.evaluatedExercises} · Updated:{" "}
            {baselineSummary.updated} · Skipped: {baselineSummary.skipped}
          </p>
          {baselineSummary.items.length > 0 ? (
            <div className="mt-3 space-y-2">
              {baselineSummary.items.map((item) => (
                <div key={`${item.exerciseName}-${item.newTopSetWeight}`} className="flex flex-wrap gap-2">
                  <span className="font-medium text-slate-900">{item.exerciseName}</span>
                  <span className="text-slate-600">
                    {item.previousTopSetWeight ? `${item.previousTopSetWeight} ? ` : ""}
                    {item.newTopSetWeight} lbs × {item.reps}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-slate-600">No baseline increases detected for this session.</p>
          )}
          {baselineSummary.skippedItems.length > 0 ? (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why skipped</p>
              {baselineSummary.skippedItems.map((item) => (
                <div key={`${item.exerciseName}-${item.reason}`} className="flex flex-wrap gap-2">
                  <span className="font-medium text-slate-900">{item.exerciseName}</span>
                  <span className="text-slate-600">{item.reason}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-3">
        {!completed && !skipped ? (
          <label className="text-xs text-slate-500">
            Skip reason (optional)
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Travel, low energy, time constraints"
              value={skipReason}
              onChange={(event) => setSkipReason(event.target.value)}
            />
          </label>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="rounded-full bg-slate-900 px-6 py-2 text-sm font-semibold text-white disabled:opacity-60"
            onClick={handleCompleteWorkout}
            disabled={completed || skipped}
          >
            {completed ? "Workout completed" : "Mark workout completed"}
          </button>
          <button
            className="rounded-full border border-slate-300 px-6 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
            onClick={handleSkipWorkout}
            disabled={completed || skipped}
          >
            {skipped ? "Workout skipped" : "Mark workout skipped"}
          </button>
        </div>
        {skipped ? (
          <div className="text-sm text-slate-600">
            <Link className="font-semibold text-slate-900" href="/">
              Generate a replacement session
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}




