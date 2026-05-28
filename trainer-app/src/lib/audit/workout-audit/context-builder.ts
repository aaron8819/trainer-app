import { prisma } from "@/lib/db/prisma";
import { loadNextWorkoutContext } from "@/lib/api/next-session";
import { createCalvesFourFourPlannerOnlyPolicyOverride } from "@/lib/api/planner-only-policy-override";
import type { SessionIntent } from "@/lib/engine/session-types";
import type {
  WorkoutAuditContext,
  WorkoutAuditIdentity,
  WorkoutAuditRequest,
} from "./types";

export async function resolveWorkoutAuditIdentity(
  request: Pick<WorkoutAuditRequest, "userId" | "ownerEmail">
): Promise<WorkoutAuditIdentity> {
  if (request.userId) {
    return { userId: request.userId, ownerEmail: request.ownerEmail };
  }

  if (!request.ownerEmail) {
    throw new Error("audit requires userId or ownerEmail");
  }

  const user = await prisma.user.findUnique({
    where: { email: request.ownerEmail },
    select: { id: true, email: true },
  });
  if (!user) {
    throw new Error(`No user found for ownerEmail=${request.ownerEmail}`);
  }
  return { userId: user.id, ownerEmail: user.email };
}

export async function buildWorkoutAuditContext(
  request: WorkoutAuditRequest
): Promise<WorkoutAuditContext> {
  const identity = await resolveWorkoutAuditIdentity(request);
  const plannerDiagnosticsMode = request.plannerDiagnosticsMode ?? "standard";
  const mode = request.mode;
  if (request.plannerOnlyDryRun && mode !== "mesocycle-explain") {
    throw new Error("--planner-only-dry-run requires --mode mesocycle-explain");
  }
  if (request.v2DebugArtifact && mode !== "mesocycle-explain") {
    throw new Error("--v2-debug-artifact requires --mode mesocycle-explain");
  }
  if (request.v2DebugArtifact && !request.plannerOnlyNoRepair) {
    throw new Error("--v2-debug-artifact requires --planner-only-no-repair");
  }
  if (request.plannerOnlyNoRepair && mode !== "mesocycle-explain") {
    throw new Error("--planner-only-no-repair requires --mode mesocycle-explain");
  }
  if (request.compareRepaired && mode !== "mesocycle-explain") {
    throw new Error("--compare-repaired requires --mode mesocycle-explain");
  }
  if (request.plannerOnlyDryRun && !request.compareRepaired) {
    throw new Error("--planner-only-dry-run currently requires --compare-repaired");
  }
  const shouldLoadNextSession =
    mode === "future-week" ||
    mode === "pre-session-readiness" ||
    mode === "deload";

  if (mode === "historical-week") {
    if (!Number.isFinite(request.week)) {
      throw new Error("historical-week mode requires --week");
    }
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      historicalWeek: {
        week: request.week as number,
        mesocycleId: request.mesocycleId,
      },
    };
  }

  if (mode === "weekly-retro") {
    if (!Number.isFinite(request.week)) {
      throw new Error("weekly-retro mode requires --week");
    }
    if (!request.mesocycleId) {
      throw new Error("weekly-retro mode requires --mesocycle-id");
    }
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      weeklyRetro: {
        week: request.week as number,
        mesocycleId: request.mesocycleId,
        projectionArtifactPath: request.projectionArtifactPath,
      },
    };
  }

  if (mode === "projected-week-volume" || mode === "current-week-audit") {
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      projectedWeekVolume: {
        enabled: true,
      },
    };
  }

  if (mode === "pre-session-readiness") {
    const nextSession = await loadNextWorkoutContext(identity.userId);
    if (nextSession.source === "final_week_close_pending") {
      return {
        mode,
        requestedMode: request.mode,
        userId: identity.userId,
        ownerEmail: identity.ownerEmail,
        plannerDiagnosticsMode,
        nextSession,
        projectedWeekVolume: {
          enabled: true,
        },
        preSessionReadiness: {
          enabled: true,
          ...(request.mesocycleId
            ? { requestedMesocycleId: request.mesocycleId }
            : {}),
        },
      };
    }
    const intent = (request.intent ?? nextSession?.intent) as
      | SessionIntent
      | undefined;
    if (!intent) {
      throw new Error(
        "pre-session-readiness mode requires --intent or a derivable next-session intent"
      );
    }
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      generationInput: {
        intent,
        targetMuscles: request.targetMuscles,
        source: request.intent ? "explicit-intent" : "derived-next-session",
      },
      nextSession,
      projectedWeekVolume: {
        enabled: true,
      },
      preSessionReadiness: {
        enabled: true,
        ...(request.mesocycleId
          ? { requestedMesocycleId: request.mesocycleId }
          : {}),
      },
    };
  }

  if (mode === "active-mesocycle-slot-reseed") {
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      activeMesocycleSlotReseed: {
        enabled: true,
      },
    };
  }

  if (mode === "replace-empty-mesocycle-with-v2") {
    if (!request.ownerEmail) {
      throw new Error("replace-empty-mesocycle-with-v2 mode requires --owner");
    }
    if (!request.mesocycleId) {
      throw new Error("replace-empty-mesocycle-with-v2 mode requires --mesocycle-id");
    }
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      replaceEmptyMesocycleWithV2: {
        mesocycleId: request.mesocycleId,
      },
    };
  }

  if (mode === "v2-accepted-seed-prepare-compare") {
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      v2AcceptedSeedPrepareCompare: {
        mesocycleId: request.mesocycleId ?? request.sourceMesocycleId,
        ...(request.mesocycleId
          ? { requestedIdSource: "mesocycle_id" as const }
          : request.sourceMesocycleId
            ? { requestedIdSource: "source_mesocycle_id" as const }
            : {}),
      },
    };
  }

  if (mode === "next-mesocycle-acceptance-gate") {
    if (!request.sourceMesocycleId) {
      throw new Error("next-mesocycle-acceptance-gate mode requires --source-mesocycle-id");
    }
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      nextMesocycleAcceptanceGate: {
        sourceMesocycleId: request.sourceMesocycleId,
      },
    };
  }

  if (mode === "next-mesocycle-post-accept-verification") {
    if (!request.sourceMesocycleId) {
      throw new Error("next-mesocycle-post-accept-verification mode requires --source-mesocycle-id");
    }
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      nextMesocyclePostAcceptVerification: {
        sourceMesocycleId: request.sourceMesocycleId,
        ...(request.mesocycleId
          ? { successorMesocycleId: request.mesocycleId }
          : {}),
      },
    };
  }

  if (mode === "next-mesocycle-handoff-dry-run") {
    if (!request.sourceMesocycleId) {
      throw new Error("next-mesocycle-handoff-dry-run mode requires --source-mesocycle-id");
    }
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      nextMesocycleHandoffDryRun: {
        sourceMesocycleId: request.sourceMesocycleId,
      },
    };
  }

  if (mode === "mesocycle-explain") {
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      mesocycleExplain: {
        sourceMesocycleId: request.sourceMesocycleId,
        retrospectiveMesocycleId: request.retrospectiveMesocycleId,
        ...(request.plannerOnlyDryRun && request.compareRepaired
          ? {
              plannerOnlyDryRun: {
                enabled: true,
                compareRepaired: true,
                plannerOnlyPolicyOverride:
                  createCalvesFourFourPlannerOnlyPolicyOverride(),
              },
            }
          : {}),
        ...(request.plannerOnlyNoRepair
          ? {
              plannerOnlyNoRepair: {
                enabled: true,
                compareRepaired: request.compareRepaired === true,
                ...(request.v2DebugArtifact
                  ? { v2DebugArtifact: true }
                  : {}),
              },
            }
          : {}),
      },
    };
  }

  if (mode === "progression-anchor") {
    if (!request.exerciseId) {
      throw new Error("progression-anchor mode requires --exercise-id");
    }
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      progressionAnchor: {
        workoutId: request.workoutId,
        exerciseId: request.exerciseId,
      },
    };
  }

  if (mode === "deload") {
    const nextSession = shouldLoadNextSession
      ? await loadNextWorkoutContext(identity.userId)
      : undefined;
    if (nextSession?.source === "final_week_close_pending") {
      return {
        mode,
        requestedMode: request.mode,
        userId: identity.userId,
        ownerEmail: identity.ownerEmail,
        plannerDiagnosticsMode,
        nextSession,
      };
    }
    const intent = (request.intent ?? nextSession?.intent) as SessionIntent | undefined;
    if (!intent) {
      throw new Error("deload mode requires --intent or a derivable next-session intent");
    }
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      generationInput: {
        intent,
        targetMuscles: request.targetMuscles,
        source: "forced-deload",
      },
      nextSession,
    };
  }

  const nextSession = shouldLoadNextSession
    ? await loadNextWorkoutContext(identity.userId)
    : undefined;

  if (nextSession?.source === "final_week_close_pending") {
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      nextSession,
    };
  }

  if (request.intent) {
    return {
      mode,
      requestedMode: request.mode,
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      generationInput: {
        intent: request.intent,
        targetMuscles: request.targetMuscles,
        source: "explicit-intent",
      },
      nextSession,
    };
  }

  if (!nextSession?.intent) {
    throw new Error("Unable to derive next-session intent from runtime context");
  }
  return {
    mode,
    requestedMode: request.mode,
    userId: identity.userId,
    ownerEmail: identity.ownerEmail,
    plannerDiagnosticsMode,
    generationInput: {
      intent: nextSession.intent as SessionIntent,
      source: "derived-next-session",
    },
    nextSession,
  };
}
