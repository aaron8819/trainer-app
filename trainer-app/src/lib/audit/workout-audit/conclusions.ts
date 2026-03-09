import type {
  AuditConclusionBlock,
  AuditWarningSummary,
  WorkoutAuditArtifact,
} from "./types";

export const WORKOUT_AUDIT_CONCLUSIONS: AuditConclusionBlock = {
  next_session_basis: {
    sourceModule: "src/lib/api/next-session.ts",
    sourceFunction: "loadNextWorkoutContext",
    runtimeRule:
      "Resume the highest-priority incomplete workout first; otherwise derive the next advancing rotation slot from the active mesocycle and weekly schedule.",
  },
  weekly_volume_basis: {
    sourceModule: "src/lib/api/weekly-volume.ts",
    sourceFunction: "loadMesocycleWeekMuscleVolume",
    runtimeRule:
      "Weekly volume counts performed workouts by status (COMPLETED/PARTIAL) and completed logged sets; advancesSplit does not remove a performed workout from weekly volume accounting.",
  },
  recovery_basis: {
    sourceModule: "src/lib/api/recent-muscle-stimulus.ts",
    sourceFunction: "loadRecentMuscleStimulus",
    runtimeRule:
      "Recovery and recent-stimulus windows count performed workouts by status (COMPLETED/PARTIAL) and completed logged sets, independent of split advancement.",
  },
  progression_basis: {
    sourceModule: "src/lib/api/workout-context.ts + src/lib/engine/history.ts",
    sourceFunction: "mapHistory + filterPerformedHistory",
    runtimeRule:
      "Progression history includes performed workouts by status; MANUAL sessions remain in history with reduced confidence, and advancesSplit does not exclude them from progression signals.",
  },
  week_close_basis: {
    sourceModule: "src/lib/api/mesocycle-week-close.ts",
    sourceFunction: "buildWeekCloseDeficitSnapshot + resolveWeekCloseOnOptionalGapFillCompletion",
    runtimeRule:
      "Week-close deficits are computed from canonical weekly volume accounting; optional gap-fill completion can resolve a pending week close, while normal forward progress can auto-dismiss it.",
  },
  sequencing_basis: {
    sourceModule: "src/lib/api/template-session/remaining-week-planner.ts",
    sourceFunction: "buildRemainingScheduleAfterPerformed",
    runtimeRule:
      "Remaining same-week slot sequencing consumes advancing performed intents against the canonical weekly schedule in order, preserving unresolved earlier slots when sessions are performed off-order.",
  },
  advances_split_basis: {
    sourceModule: "src/app/api/workouts/save/lifecycle-contract.ts + src/lib/api/template-session/remaining-week-planner.ts",
    sourceFunction:
      "shouldAdvanceLifecycleForPerformedTransition + buildRemainingWeekVolumeContext",
    runtimeRule:
      "advancesSplit=false opt-outs a performed workout from lifecycle and sequencing advancement, but not from weekly volume, recovery, analytics, or progression history.",
  },
};

export function buildGenerationWarningSummary(
  artifact: Pick<WorkoutAuditArtifact, "generation">
): AuditWarningSummary {
  if ("error" in artifact.generation) {
    return {
      blockingErrors: [artifact.generation.error],
      semanticWarnings: [],
      backgroundWarnings: [],
    };
  }

  return {
    blockingErrors: [],
    semanticWarnings: artifact.generation.sraWarnings.map(
      (warning) =>
        `${warning.muscle}: recovery=${warning.recoveryPercent}% last_trained_hours=${warning.lastTrainedHoursAgo}`
    ),
    backgroundWarnings: [],
  };
}
