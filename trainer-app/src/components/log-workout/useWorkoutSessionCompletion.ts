"use client";

import { useCallback, useState } from "react";
import { saveWorkoutRequest } from "@/components/log-workout/api";
import type { BaselineUpdateSummary, CompletionAction } from "@/components/log-workout/types";

export type WorkoutSessionFlowState = {
  completionAction: CompletionAction | null;
  pendingAction: CompletionAction | null;
  skipReason: string;
  showSkipOptions: boolean;
  terminalState: "active" | "completed" | "skipped";
};

export type WorkoutSessionCompletionController = {
  state: WorkoutSessionFlowState;
  baselineSummary: BaselineUpdateSummary | null;
  completed: boolean;
  skipped: boolean;
  pending: boolean;
  submitting: boolean;
  run: (action: CompletionAction) => Promise<void>;
  openConfirm: (action: CompletionAction) => void;
  cancelConfirm: () => void;
  toggleSkipOptions: () => void;
  setSkipReason: (value: string) => void;
};

type UseWorkoutSessionCompletionParams = {
  workoutId: string;
  clearAllDrafts: () => void;
  clearTimer: () => void;
  clearFeedback: () => void;
  showError: (message: string) => void;
  showStatus: (message: string) => void;
};

export function useWorkoutSessionCompletion({
  workoutId,
  clearAllDrafts,
  clearTimer,
  clearFeedback,
  showError,
  showStatus,
}: UseWorkoutSessionCompletionParams): WorkoutSessionCompletionController {
  const [baselineSummary, setBaselineSummary] = useState<BaselineUpdateSummary | null>(null);
  const [sessionFlow, setSessionFlow] = useState<WorkoutSessionFlowState>({
    completionAction: null,
    pendingAction: null,
    skipReason: "",
    showSkipOptions: false,
    terminalState: "active",
  });

  const sessionActionPending = sessionFlow.pendingAction !== null;
  const completed = sessionFlow.terminalState === "completed";
  const skipped = sessionFlow.terminalState === "skipped";

  const run = useCallback(
    async (action: CompletionAction) => {
      if (sessionActionPending) {
        return;
      }

      setSessionFlow((prev) => ({ ...prev, pendingAction: action }));
      clearFeedback();
      setBaselineSummary(null);

      try {
        if (action === "mark_skipped") {
          const response = await saveWorkoutRequest({
            workoutId,
            action: "mark_skipped",
            status: "SKIPPED",
            notes: sessionFlow.skipReason ? `Skipped: ${sessionFlow.skipReason}` : "Skipped",
            exercises: [],
          });

          if (response.error) {
            showError(response.error);
            return;
          }

          clearAllDrafts();
          clearTimer();
          setSessionFlow((prev) => ({
            ...prev,
            completionAction: null,
            pendingAction: null,
            showSkipOptions: false,
            terminalState: "skipped",
          }));
          showStatus("Workout marked as skipped");
          return;
        }

        const response = await saveWorkoutRequest({
          workoutId,
          action,
          status: action === "mark_partial" ? "PARTIAL" : "COMPLETED",
          exercises: [],
        });

        if (response.error) {
          showError(response.error);
          return;
        }

        const body = response.data;
        if (action === "mark_partial") {
          clearTimer();
          setSessionFlow((prev) => ({
            ...prev,
            completionAction: null,
            pendingAction: null,
            showSkipOptions: false,
          }));
          showStatus("Workout saved as partial (some planned sets were unresolved)");
          return;
        }

        clearAllDrafts();
        setBaselineSummary((body?.baselineSummary as BaselineUpdateSummary | null | undefined) ?? null);
        clearTimer();
        setSessionFlow((prev) => ({
          ...prev,
          completionAction: null,
          pendingAction: null,
          showSkipOptions: false,
          terminalState: "completed",
        }));
        showStatus("Workout marked as completed");
      } catch {
        showError("Failed to complete workout action");
      } finally {
        setSessionFlow((prev) => ({
          ...prev,
          pendingAction: null,
          completionAction: prev.terminalState === "active" ? prev.completionAction : null,
        }));
      }
    },
    [
      clearAllDrafts,
      clearFeedback,
      clearTimer,
      sessionActionPending,
      sessionFlow.skipReason,
      showError,
      showStatus,
      workoutId,
    ]
  );

  const openConfirm = useCallback(
    (action: CompletionAction) => {
      if (sessionActionPending) {
        return;
      }

      setSessionFlow((prev) => ({ ...prev, completionAction: action }));
    },
    [sessionActionPending]
  );

  const cancelConfirm = useCallback(() => {
    setSessionFlow((prev) => ({ ...prev, completionAction: null }));
  }, []);

  const toggleSkipOptions = useCallback(() => {
    setSessionFlow((prev) => ({ ...prev, showSkipOptions: !prev.showSkipOptions }));
  }, []);

  const setSkipReason = useCallback((value: string) => {
    setSessionFlow((prev) => ({ ...prev, skipReason: value }));
  }, []);

  return {
    state: sessionFlow,
    baselineSummary,
    completed,
    skipped,
    pending: sessionActionPending,
    submitting: sessionActionPending,
    run,
    openConfirm,
    cancelConfirm,
    toggleSkipOptions,
    setSkipReason,
  };
}
