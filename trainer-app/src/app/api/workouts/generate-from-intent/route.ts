import { NextResponse } from "next/server";
import { generateFromIntentSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { generateDeloadSessionFromIntent, generateSessionFromIntent } from "@/lib/api/template-session";
import { applyAutoregulation } from "@/lib/api/autoregulation";
import { loadActiveMesocycle } from "@/lib/api/mesocycle-lifecycle";

export async function POST(request: Request) {
  const includeSelectionDebug = new URL(request.url).searchParams.get("debug") === "1";
  const body = await request.json().catch(() => ({}));
  const parsed = generateFromIntentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const activeMesocycle = await loadActiveMesocycle(user.id);
  const result =
    activeMesocycle?.state === "ACTIVE_DELOAD"
      ? await generateDeloadSessionFromIntent(user.id, parsed.data)
      : await generateSessionFromIntent(user.id, parsed.data);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Phase 3: Apply autoregulation
  const autoregulated = await applyAutoregulation(user.id, result.workout);

  const selectionSummary = {
    selectedCount:
      result.selection.selectedExerciseIds?.length ??
      Object.keys(result.selection.rationale ?? {}).length,
    pinnedCount: Object.values(result.selection.rationale ?? {}).filter(
      (entry) => entry.selectedStep === "pin"
    ).length,
    setTargetCount: Object.keys(result.selection.perExerciseSetTargets ?? {}).length,
  };

  return NextResponse.json({
    workout: autoregulated.adjusted,
    sraWarnings: result.sraWarnings,
    substitutions: result.substitutions,
    volumePlanByMuscle: result.volumePlanByMuscle,
    selectionMode: result.selectionMode,
    sessionIntent: result.sessionIntent,
    selectionSummary,
    selectionMetadata: result.selection,
    selection: includeSelectionDebug ? result.selection : undefined,
    autoregulation: {
      applied: autoregulated.applied,
      reason: autoregulated.reason,
      signalAgeHours: autoregulated.signalAgeHours,
      fatigueScore: autoregulated.fatigueScore,
      modifications: autoregulated.modifications,
      rationale: autoregulated.rationale,
      wasAutoregulated: autoregulated.wasAutoregulated,
    },
    filteredExercises: result.filteredExercises,
  });
}
