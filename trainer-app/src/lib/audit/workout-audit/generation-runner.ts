import { loadActiveMesocycle } from "@/lib/api/mesocycle-lifecycle";
import {
  generateDeloadSessionFromIntent,
  generateSessionFromIntent,
} from "@/lib/api/template-session";
import type { WorkoutAuditContext, WorkoutAuditRun } from "./types";

export async function runWorkoutAuditGeneration(
  context: WorkoutAuditContext
): Promise<WorkoutAuditRun> {
  const activeMesocycle = await loadActiveMesocycle(context.userId);
  const generationResult =
    activeMesocycle?.state === "ACTIVE_DELOAD"
      ? await generateDeloadSessionFromIntent(context.userId, {
          intent: context.generationInput.intent,
          targetMuscles: context.generationInput.targetMuscles,
          plannerDiagnosticsMode: context.plannerDiagnosticsMode,
        })
      : await generateSessionFromIntent(context.userId, {
          intent: context.generationInput.intent,
          targetMuscles: context.generationInput.targetMuscles,
          plannerDiagnosticsMode: context.plannerDiagnosticsMode,
        });

  return {
    context,
    generatedAt: new Date().toISOString(),
    generationResult,
  };
}
