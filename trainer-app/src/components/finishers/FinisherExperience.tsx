"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FinisherExecutionDto,
  FinisherRoutineDto,
} from "@/lib/api/finisher-service";

type FinisherOffer = {
  serverTime: string;
  offer: {
    id: string;
    revision: number;
    offeredAt: string;
    declinedAt: string | null;
  } | null;
  routines: FinisherRoutineDto[];
  recommendation: {
    routineVersionId: string;
    reason: string;
  } | null;
  recommendationUnavailableReason: string | null;
  declined: boolean;
  execution: FinisherExecutionDto | null;
  history: FinisherExecutionDto[];
};

type WakeLockSentinel = {
  release: () => Promise<void>;
  released: boolean;
};

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function displayEnum(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function remainingMilliseconds(
  execution: FinisherExecutionDto,
  serverNow: number,
): number {
  if (execution.timer.pausedAt) {
    return execution.timer.pausedRemainingMs ?? 0;
  }
  if (!execution.timer.segmentEndsAt) return 0;
  return Math.max(
    0,
    new Date(execution.timer.segmentEndsAt).getTime() - serverNow,
  );
}

export function estimateServerEpochAtMonotonicOrigin(input: {
  serverTime: string;
  requestStartedAt: number;
  responseReceivedAt: number;
}): number {
  const midpoint =
    input.requestStartedAt +
    (input.responseReceivedAt - input.requestStartedAt) / 2;
  return new Date(input.serverTime).getTime() - midpoint;
}

export function FinisherExperience({
  workoutId,
  historyOnly = false,
}: {
  workoutId: string;
  historyOnly?: boolean;
}) {
  const [offer, setOffer] = useState<FinisherOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browse, setBrowse] = useState(false);
  const [category, setCategory] = useState<"ALL" | "CORE" | "CONDITIONING">("ALL");
  const [preview, setPreview] = useState<FinisherRoutineDto | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [showSubstitutions, setShowSubstitutions] = useState(false);
  const [monotonicNow, setMonotonicNow] = useState(() =>
    typeof performance === "undefined" ? 0 : performance.now(),
  );
  const [serverEpochAtMonotonicOrigin, setServerEpochAtMonotonicOrigin] =
    useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [syncRetryVersion, setSyncRetryVersion] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [vibrationEnabled, setVibrationEnabled] = useState(false);
  const priorSegment = useRef<string | null>(null);
  const priorAnnouncementKey = useRef<string | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const submittingRef = useRef(false);
  const syncAttempts = useRef(new Set<string>());
  const requestSequence = useRef(0);
  const latestAppliedRequest = useRef(0);
  const mounted = useRef(true);
  const endButtonRef = useRef<HTMLButtonElement | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);
  const focusSummaryAfterMutation = useRef(false);
  const supportsWakeLock =
    typeof navigator !== "undefined" && "wakeLock" in navigator;
  const supportsVibration =
    typeof navigator !== "undefined" && "vibrate" in navigator;

  const load = useCallback(async () => {
    if (submittingRef.current) return;
    const sequence = ++requestSequence.current;
    const requestStartedAt = performance.now();
    try {
      let response = await fetch(`/api/workouts/${workoutId}/finisher`, {
        cache: "no-store",
      });
      let body = (await response.json()) as FinisherOffer & {
        error?: string;
      };
      if (response.ok && !body.offer && !historyOnly) {
        response = await fetch(`/api/workouts/${workoutId}/finisher`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "offer" }),
        });
        body = (await response.json()) as FinisherOffer & {
          error?: string;
        };
      }
      const responseReceivedAt = performance.now();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to load finishers");
      }
      if (!mounted.current || sequence < latestAppliedRequest.current) return;
      latestAppliedRequest.current = sequence;
      setServerEpochAtMonotonicOrigin(
        estimateServerEpochAtMonotonicOrigin({
          serverTime: body.serverTime,
          requestStartedAt,
          responseReceivedAt,
        }),
      );
      setMonotonicNow(responseReceivedAt);
      setOffer(body);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load finishers"
      );
    } finally {
      setLoading(false);
    }
  }, [historyOnly, workoutId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setInterval(
      () => setMonotonicNow(performance.now()),
      250,
    );
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [load]);

  const execution = offer?.execution ?? null;
  const isRunning =
    execution?.timer.segment != null &&
    execution.timer.segment !== "FINISHED" &&
    execution.timer.pausedAt == null;

  useEffect(() => {
    if (!isRunning || !("wakeLock" in navigator)) {
      void wakeLock.current?.release();
      wakeLock.current = null;
      return;
    }
    let cancelled = false;
    const requestWakeLock = async () => {
      try {
        const manager = (
          navigator as Navigator & {
            wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
          }
        ).wakeLock;
        const sentinel = await manager?.request("screen");
        if (cancelled) {
          await sentinel?.release();
        } else {
          wakeLock.current = sentinel ?? null;
        }
      } catch {
        wakeLock.current = null;
      }
    };
    void requestWakeLock();
    return () => {
      cancelled = true;
      void wakeLock.current?.release();
      wakeLock.current = null;
    };
  }, [isRunning]);

  const signalTransition = useCallback(() => {
    if (vibrationEnabled && "vibrate" in navigator) {
      navigator.vibrate(120);
    }
    if (soundEnabled) {
      try {
        const AudioContextConstructor =
          window.AudioContext ??
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
        if (AudioContextConstructor) {
          const context = new AudioContextConstructor();
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.frequency.value = 660;
          gain.gain.value = 0.06;
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start();
          oscillator.stop(context.currentTime + 0.12);
          oscillator.addEventListener("ended", () => void context.close());
        }
      } catch {
        // Unsupported or blocked media APIs degrade silently.
      }
    }
  }, [soundEnabled, vibrationEnabled]);

  useEffect(() => {
    const segment = execution?.timer.segment ?? null;
    if (priorSegment.current && segment && priorSegment.current !== segment) {
      signalTransition();
    }
    priorSegment.current = segment;
  }, [execution?.timer.segment, signalTransition]);

  useEffect(() => {
    if (!execution?.timer.segment) return;
    const movement =
      execution.timer.segment === "WORK"
        ? execution.steps[execution.timer.currentStepIndex]?.performedMovement
        : execution.timer.segment === "RECOVERY"
          ? "Recovery"
          : execution.routine.steps[execution.timer.currentStepIndex]?.movementName;
    const key = `${execution.timer.revision}:${execution.timer.segment}:${execution.timer.currentStepIndex}:${movement}`;
    if (priorAnnouncementKey.current === key) return;
    priorAnnouncementKey.current = key;
    setAnnouncement(
      `${execution.timer.segment === "PREPARATION" ? "Preparation" : displayEnum(execution.timer.segment)}: ${movement ?? "Finisher"}`,
    );
  }, [execution]);

  const alignedServerNow =
    serverEpochAtMonotonicOrigin == null
      ? null
      : serverEpochAtMonotonicOrigin + monotonicNow;
  const remainingMs =
    execution && alignedServerNow != null
      ? remainingMilliseconds(execution, alignedServerNow)
      : (execution?.timer.pausedRemainingMs ?? 0);

  const mutate = useCallback(
    async (body: Record<string, unknown>) => {
      if (submittingRef.current) return false;
      submittingRef.current = true;
      setSubmitting(true);
      setError(null);
      const sequence = ++requestSequence.current;
      const requestStartedAt = performance.now();
      try {
        const response = await fetch(`/api/workouts/${workoutId}/finisher`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = (await response.json()) as FinisherOffer & {
          error?: string;
        };
        const responseReceivedAt = performance.now();
        if (!response.ok) {
          throw new Error(result.error ?? "Finisher action failed");
        }
        if (!mounted.current || sequence < latestAppliedRequest.current) {
          return false;
        }
        latestAppliedRequest.current = sequence;
        setServerEpochAtMonotonicOrigin(
          estimateServerEpochAtMonotonicOrigin({
            serverTime: result.serverTime,
            requestStartedAt,
            responseReceivedAt,
          }),
        );
        setMonotonicNow(responseReceivedAt);
        setOffer(result);
        setPreview(null);
        setShowSubstitutions(false);
        setConfirmEnd(false);
        return true;
      } catch (mutationError) {
        if (mounted.current) {
          setError(
            mutationError instanceof Error
              ? mutationError.message
              : "Finisher action failed",
          );
        }
        return false;
      } finally {
        submittingRef.current = false;
        if (mounted.current) setSubmitting(false);
      }
    },
    [workoutId],
  );

  useEffect(() => {
    if (
      execution &&
      !execution.timer.pausedAt &&
      (execution.timer.syncRequired ||
        (execution.timer.segment !== "FINISHED" &&
          execution.timer.segmentEndsAt &&
          remainingMs === 0))
    ) {
      const token =
        execution.timer.syncToken ??
        `${execution.id}:${execution.timer.revision}:${execution.timer.segment}:${execution.timer.segmentEndsAt}`;
      if (syncAttempts.current.has(token)) return;
      syncAttempts.current.add(token);
      const id = window.setTimeout(
        () => {
          void mutate({
            action: "sync",
            executionId: execution.id,
            expectedRevision: execution.timer.revision,
          }).then((succeeded) => {
            if (succeeded) return;
            window.setTimeout(() => {
              syncAttempts.current.delete(token);
              if (!mounted.current) return;
              setSyncRetryVersion((value) => value + 1);
              void load();
            }, 1_000);
          });
        },
        50,
      );
      return () => window.clearTimeout(id);
    }
  }, [execution, load, mutate, remainingMs, syncRetryVersion]);

  useEffect(() => {
    if (
      focusSummaryAfterMutation.current &&
      (execution?.state === "PARTIAL" ||
        execution?.state === "COMPLETED" ||
        execution?.state === "SKIPPED" ||
        execution?.state === "DISMISSED")
    ) {
      focusSummaryAfterMutation.current = false;
      summaryRef.current?.focus();
    }
  }, [execution?.state]);

  const filteredRoutines = useMemo(
    () =>
      (offer?.routines ?? []).filter(
        (routine) => category === "ALL" || routine.category === category
      ),
    [category, offer?.routines]
  );
  const recommended = offer?.recommendation
    ? offer.routines.find(
        (routine) => routine.id === offer.recommendation?.routineVersionId
      ) ?? null
    : null;
  const durableOffer = offer?.offer ?? null;
  const currentStep = execution
    ? execution.routine.steps[execution.timer.currentStepIndex] ?? null
    : null;
  const nextStep = execution
    ? execution.routine.steps[execution.timer.currentStepIndex + 1] ?? null
    : null;

  if (loading) {
    return (
      <section
        aria-label="Finisher loading"
        className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
      >
        <p className="text-sm text-slate-600">Loading optional finishers…</p>
      </section>
    );
  }

  if (error && !offer) {
    return (
      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <p role="alert" className="text-sm text-rose-800">{error}</p>
        <button
          className="mt-3 min-h-11 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white"
          onClick={() => void load()}
          type="button"
        >
          Retry
        </button>
      </section>
    );
  }

  if (
    execution &&
    (execution.state === "COMPLETED" ||
      execution.state === "PARTIAL" ||
      execution.state === "SKIPPED" ||
      execution.state === "DISMISSED")
  ) {
    return (
      <section
        aria-label="Finisher summary"
        className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5"
        ref={summaryRef}
        tabIndex={-1}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Finisher
        </p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">
            {execution.routine.name}
          </h2>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
            {displayEnum(execution.state)}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {displayEnum(execution.routine.category)} ·{" "}
          {execution.completedStepCount} completed · {execution.skippedStepCount} skipped
          {execution.substitutionCount > 0
            ? ` · ${execution.substitutionCount} substituted`
            : ""}
          {execution.actualDurationSeconds != null
            ? ` · ${formatDuration(execution.actualDurationSeconds)}`
            : ""}
        </p>
        <div className="mt-3 space-y-1 text-sm text-slate-700">
          {execution.steps
            .filter((step) => step.status !== "PENDING")
            .map((step) => (
              <p key={step.id}>
                {step.orderIndex + 1}. {step.performedMovement}
                {step.performedMovement !== step.prescribedMovement
                  ? ` (for ${step.prescribedMovement})`
                  : ""}
                {step.status === "SKIPPED"
                  ? " — skipped"
                  : step.status === "PARTIAL"
                    ? " — partially performed"
                    : ""}
              </p>
            ))}
        </div>
        {!historyOnly &&
        (execution.state === "COMPLETED" ||
          execution.state === "PARTIAL") ? (
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Session difficulty (optional)
            <select
              aria-label="Finisher session difficulty"
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3"
              defaultValue={execution.difficultyFeedback ?? ""}
              disabled={submitting}
              onChange={(event) => {
                if (!event.target.value) return;
                void mutate({
                      action: "feedback",
                      executionId: execution.id,
                      expectedRevision: execution.timer.revision,
                  difficultyFeedback: Number(event.target.value),
                });
              }}
            >
              <option value="">Not recorded</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                <option value={value} key={value}>{value} / 10</option>
              ))}
            </select>
          </label>
        ) : null}
      </section>
    );
  }

  if (historyOnly) {
    return null;
  }

  if (execution?.timer.segment) {
    const paused = execution.timer.pausedAt != null;
    const segmentLabel = paused
      ? "Paused"
      : execution.timer.segment === "PREPARATION"
        ? "Get ready"
        : execution.timer.segment === "RECOVERY"
          ? "Recovery"
          : "Work";
    return (
      <section className="rounded-3xl bg-slate-950 p-5 text-white shadow-xl sm:p-7">
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </p>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">
              {segmentLabel}
            </p>
            <p className="mt-1 text-sm text-slate-300">
              Round {Math.min(execution.timer.currentStepIndex + 1, execution.routine.steps.length)} of{" "}
              {execution.routine.steps.length}
            </p>
          </div>
          <p
            aria-live="off"
            aria-label={`${Math.ceil(remainingMs / 1000)} seconds remaining`}
            className="tabular-nums text-5xl font-semibold tracking-tight"
          >
            {formatDuration(Math.ceil(remainingMs / 1000))}
          </p>
        </div>

        <div className="mt-8">
          <h2 className="text-3xl font-semibold leading-tight">
            {execution.timer.segment === "PREPARATION"
              ? currentStep?.movementName
              : execution.timer.segment === "RECOVERY"
                ? "Recover"
                : execution.steps[execution.timer.currentStepIndex]?.performedMovement}
          </h2>
          {currentStep?.techniqueCues[0] ? (
            <p className="mt-3 text-base leading-6 text-slate-300">
              {currentStep.techniqueCues[0]}
            </p>
          ) : null}
          {nextStep ? (
            <p className="mt-5 text-sm text-slate-400">
              Next: {nextStep.movementName}
            </p>
          ) : (
            <p className="mt-5 text-sm text-slate-400">Final round</p>
          )}
        </div>

        {showSubstitutions && currentStep?.alternatives.length ? (
          <div className="mt-5 rounded-2xl bg-slate-900 p-4">
            <p className="text-sm font-semibold">Choose a predefined alternative</p>
            <div className="mt-3 grid gap-2">
              {currentStep.alternatives.map((alternative) => (
                <button
                  className="min-h-11 rounded-xl border border-slate-700 px-4 text-left text-sm"
                  disabled={submitting}
                  key={alternative.id}
                  onClick={() =>
                    void mutate({
                      action: "substitute",
                      executionId: execution.id,
                      expectedRevision: execution.timer.revision,
                      alternativeId: alternative.id,
                    })
                  }
                  type="button"
                >
                  {alternative.movementName}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mt-5 rounded-xl bg-rose-950 p-3 text-sm text-rose-100" role="alert">
            {error}{" "}
            <button className="underline" onClick={() => void load()} type="button">
              Refresh state
            </button>
          </div>
        ) : null}

        <div className="mt-8 grid grid-cols-2 gap-3">
          <button
            className="min-h-12 rounded-full bg-white px-5 font-semibold text-slate-950"
            disabled={submitting}
            onClick={() =>
              void mutate({
                action: paused ? "resume" : "pause",
                executionId: execution.id,
                expectedRevision: execution.timer.revision,
              })
            }
            type="button"
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            className="min-h-12 rounded-full border border-slate-600 px-5 font-semibold"
            disabled={
              submitting ||
              paused ||
              execution.timer.segment !== "WORK"
            }
            onClick={() =>
              void mutate({
                action: "skip",
                executionId: execution.id,
                expectedRevision: execution.timer.revision,
              })
            }
            type="button"
          >
            Skip
          </button>
          <button
            className="min-h-12 rounded-full border border-slate-600 px-5 text-sm font-semibold disabled:opacity-40"
            disabled={!currentStep?.alternatives.length || submitting}
            onClick={() => setShowSubstitutions((value) => !value)}
            type="button"
          >
            Substitute
          </button>
          <button
            className="min-h-12 rounded-full border border-rose-500 px-5 text-sm font-semibold text-rose-200"
            disabled={submitting}
            onClick={() => setConfirmEnd(true)}
            ref={endButtonRef}
            type="button"
          >
            End finisher
          </button>
        </div>

        {confirmEnd ? (
          <EndFinisherDialog
            submitting={submitting}
            onCancel={() => {
              setConfirmEnd(false);
              window.setTimeout(() => endButtonRef.current?.focus(), 0);
            }}
            onConfirm={() => {
              focusSummaryAfterMutation.current = true;
              void mutate({
                action: "end",
                executionId: execution.id,
                expectedRevision: execution.timer.revision,
              }).then((succeeded) => {
                if (!succeeded) focusSummaryAfterMutation.current = false;
              });
            }}
          />
        ) : null}

        <details className="mt-6 text-sm text-slate-300">
          <summary className="cursor-pointer font-medium">Timer signals</summary>
          <div className="mt-3 flex flex-wrap gap-4">
            <label className="flex min-h-11 items-center gap-2">
              <input
                checked={soundEnabled}
                onChange={(event) => setSoundEnabled(event.target.checked)}
                type="checkbox"
              />
              Sound
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                checked={vibrationEnabled}
                disabled={!supportsVibration}
                onChange={(event) => setVibrationEnabled(event.target.checked)}
                type="checkbox"
              />
              Vibration
            </label>
          </div>
          {!supportsWakeLock ? (
            <p>Screen wake lock is not supported; the timer will recover from timestamps.</p>
          ) : null}
          {!supportsVibration ? (
            <p>Vibration is not supported on this device.</p>
          ) : null}
        </details>
      </section>
    );
  }

  if (execution?.state === "SELECTED") {
    return (
      <RoutinePreview
        routine={execution.routine}
        acknowledged={acknowledged}
        onAcknowledged={setAcknowledged}
        submitting={submitting}
        primaryAction="Start finisher"
        onPrimary={() =>
          void mutate({
            action: "start",
            executionId: execution.id,
            expectedRevision: execution.timer.revision,
          })
        }
        onBack={() =>
          void mutate({
            action: "dismiss",
            executionId: execution.id,
            expectedRevision: execution.timer.revision,
          })
        }
      />
    );
  }

  if (preview) {
    return (
      <RoutinePreview
        routine={preview}
        acknowledged={acknowledged}
        onAcknowledged={setAcknowledged}
        submitting={submitting}
        primaryAction="Choose routine"
        onPrimary={() =>
          void mutate({
            action: "select",
            offerId: durableOffer!.id,
            expectedOfferRevision: durableOffer!.revision,
            executionId: crypto.randomUUID(),
            routineVersionId: preview.id,
            acknowledgeContraindication: acknowledged,
          })
        }
        onBack={() => {
          setPreview(null);
          setAcknowledged(false);
        }}
      />
    );
  }

  if (offer?.declined) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        Workout complete. No finisher was started.
      </section>
    );
  }

  return (
    <section
      aria-label="Optional finisher"
      className="rounded-3xl border border-sky-200 bg-sky-50 p-4 sm:p-6"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
        Workout complete
      </p>
      <h2 className="mt-1 text-xl font-semibold text-slate-950">
        Add an optional finisher?
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Your workout is already saved. This timed add-on is tracked separately.
      </p>

      {recommended && offer?.recommendation ? (
        <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Recommended
          </p>
          <div className="mt-1 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">{recommended.name}</h3>
              <p className="mt-1 text-sm text-slate-600">
                {formatDuration(recommended.durationSeconds)} ·{" "}
                {displayEnum(recommended.category)}
              </p>
            </div>
            <button
              className="min-h-11 shrink-0 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white"
              onClick={() => setPreview(recommended)}
              type="button"
            >
              Preview
            </button>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            {offer.recommendation.reason}
          </p>
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-white p-3 text-sm text-slate-700">
          {offer?.recommendationUnavailableReason ??
            "No recommendation is available. You can still browse manually."}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <button
          className="min-h-11 rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800"
          onClick={() => setBrowse((value) => !value)}
          type="button"
        >
          {browse ? "Hide routines" : "Browse all finishers"}
        </button>
        <button
          className="min-h-11 rounded-full px-5 text-sm font-semibold text-slate-600"
          disabled={submitting || !durableOffer}
          onClick={() => {
            if (!durableOffer) return;
            void mutate({
              action: "decline",
              offerId: durableOffer.id,
              expectedOfferRevision: durableOffer.revision,
              decisionId: crypto.randomUUID(),
            });
          }}
          type="button"
        >
          Finish without a finisher
        </button>
      </div>

      {browse ? (
        <div className="mt-5">
          <div className="flex gap-2" role="group" aria-label="Filter finishers by category">
            {(["ALL", "CORE", "CONDITIONING"] as const).map((value) => (
              <button
                aria-pressed={category === value}
                className={`min-h-11 rounded-full px-4 text-xs font-semibold ${
                  category === value
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-700"
                }`}
                key={value}
                onClick={() => setCategory(value)}
                type="button"
              >
                {displayEnum(value)}
              </button>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {filteredRoutines.map((routine) => (
              <button
                className="rounded-2xl bg-white p-4 text-left shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
                key={routine.id}
                onClick={() => setPreview(routine)}
                type="button"
              >
                <span className="font-semibold text-slate-900">{routine.name}</span>
                <span className="mt-1 block text-sm text-slate-600">
                  {formatDuration(routine.durationSeconds)} ·{" "}
                  {displayEnum(routine.difficulty)}
                </span>
                {routine.warnings.length ? (
                  <span className="mt-2 block text-xs font-medium text-amber-700">
                    Limitation warning
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function EndFinisherDialog({
  submitting,
  onConfirm,
  onCancel,
}: {
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    continueRef.current?.focus();
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
    };
  }, []);

  return (
    <dialog
      aria-describedby="end-finisher-description"
      aria-labelledby="end-finisher-title"
      aria-modal="true"
      className="fixed inset-0 m-auto w-[calc(100%-1.5rem)] max-w-md rounded-2xl border border-rose-300 bg-white p-5 text-slate-950 shadow-2xl backdrop:bg-slate-950/70"
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !submitting) {
          event.preventDefault();
          onCancel();
        }
      }}
      ref={dialogRef}
      role="dialog"
    >
      <h2 className="text-lg font-semibold" id="end-finisher-title">
        End this finisher as partial?
      </h2>
      <p className="mt-2 text-sm text-slate-600" id="end-finisher-description">
        Active work completed so far will be preserved. Your completed workout
        will remain completed.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          className="min-h-11 rounded-full bg-rose-700 px-5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={submitting}
          onClick={onConfirm}
          type="button"
        >
          {submitting ? "Ending…" : "End partial"}
        </button>
        <button
          className="min-h-11 rounded-full border border-slate-300 px-5 text-sm font-semibold"
          disabled={submitting}
          onClick={onCancel}
          ref={continueRef}
          type="button"
        >
          Continue finisher
        </button>
      </div>
    </dialog>
  );
}

function RoutinePreview({
  routine,
  acknowledged,
  onAcknowledged,
  submitting,
  primaryAction,
  onPrimary,
  onBack,
}: {
  routine: FinisherRoutineDto;
  acknowledged: boolean;
  onAcknowledged: (value: boolean) => void;
  submitting: boolean;
  primaryAction: string;
  onPrimary: () => void;
  onBack: () => void;
}) {
  const blocked = routine.warnings.length > 0 && !acknowledged;
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
        Finisher preview
      </p>
      <h2 className="mt-1 text-2xl font-semibold text-slate-950">{routine.name}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{routine.description}</p>
      <p className="mt-3 text-sm font-medium text-slate-700">
        {formatDuration(routine.durationSeconds)} · {displayEnum(routine.category)} ·{" "}
        {displayEnum(routine.difficulty)} · {routine.preparationSeconds}-second optional preparation
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
              <p className="mt-1 text-sm text-slate-600" key={cue}>{cue}</p>
            ))}
            {step.alternatives.length ? (
              <p className="mt-1 text-sm text-sky-700">
                Alternative: {step.alternatives.map((item) => item.movementName).join(", ")}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {routine.warnings.length ? (
        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {routine.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          <label className="mt-3 flex min-h-11 items-center gap-2 font-medium">
            <input
              checked={acknowledged}
              onChange={(event) => onAcknowledged(event.target.checked)}
              type="checkbox"
            />
            I understand and want to choose this routine.
          </label>
        </div>
      ) : null}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          className="min-h-12 rounded-full bg-slate-900 px-6 font-semibold text-white disabled:opacity-40"
          disabled={blocked || submitting}
          onClick={onPrimary}
          type="button"
        >
          {submitting ? "Saving…" : primaryAction}
        </button>
        <button
          className="min-h-12 rounded-full border border-slate-300 px-6 font-semibold text-slate-700"
          disabled={submitting}
          onClick={onBack}
          type="button"
        >
          Back
        </button>
      </div>
    </section>
  );
}
