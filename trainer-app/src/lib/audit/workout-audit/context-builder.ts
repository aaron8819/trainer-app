import { prisma } from "@/lib/db/prisma";
import { loadNextWorkoutContext } from "@/lib/api/next-session";
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
    const nextSession = !request.intent
      ? await loadNextWorkoutContext(identity.userId)
      : undefined;
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
    };
  }

  const nextSession = await loadNextWorkoutContext(identity.userId);
  if (!nextSession.intent) {
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
