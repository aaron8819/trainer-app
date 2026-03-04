import { prisma } from "@/lib/db/prisma";
import { loadNextWorkoutContext } from "@/lib/api/next-session";
import type { WorkoutAuditContext, WorkoutAuditRequest } from "./types";

async function resolveUserId(request: WorkoutAuditRequest): Promise<{
  userId: string;
  ownerEmail?: string;
}> {
  if (request.userId) {
    return { userId: request.userId, ownerEmail: request.ownerEmail };
  }

  if (!request.ownerEmail) {
    throw new Error("next-session and intent-preview audits require userId or ownerEmail");
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
  const identity = await resolveUserId(request);
  const plannerDiagnosticsMode = request.plannerDiagnosticsMode ?? "standard";

  if (request.mode === "next-session") {
    const nextSession = await loadNextWorkoutContext(identity.userId);
    if (!nextSession.intent) {
      throw new Error("Unable to derive next-session intent from runtime context");
    }
    return {
      mode: "next-session",
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      plannerDiagnosticsMode,
      generationInput: {
        intent: nextSession.intent as WorkoutAuditContext["generationInput"]["intent"],
      },
      nextSession,
    };
  }

  if (!request.intent) {
    throw new Error("intent-preview mode requires intent");
  }

  return {
    mode: "intent-preview",
    userId: identity.userId,
    ownerEmail: identity.ownerEmail,
    plannerDiagnosticsMode,
    generationInput: {
      intent: request.intent,
      targetMuscles: request.targetMuscles,
    },
  };
}
