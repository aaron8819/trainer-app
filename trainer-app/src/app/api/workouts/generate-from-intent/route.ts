import { NextResponse } from "next/server";
import { generateFromIntentSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { generateDeloadSessionFromIntent, generateSessionFromIntent } from "@/lib/api/template-session";
import { applyAutoregulation } from "@/lib/api/autoregulation";
import { loadActiveMesocycle } from "@/lib/api/mesocycle-lifecycle";
import type { GenerateFromIntentResponse } from "@/lib/api/template-session/types";
import { buildCanonicalSelectionMetadata } from "@/lib/ui/selection-metadata";

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
  const selectionMetadata = buildCanonicalSelectionMetadata(result.selection, autoregulated);

  const selectionSummary: GenerateFromIntentResponse["selectionSummary"] = {
    selectedCount:
      selectionMetadata.selectedExerciseIds?.length ??
      Object.keys(selectionMetadata.rationale ?? {}).length,
    pinnedCount: Object.values(selectionMetadata.rationale ?? {}).filter((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return false;
      }
      return (entry as { selectedStep?: string }).selectedStep === "pin";
    }).length,
    setTargetCount: Object.keys(selectionMetadata.perExerciseSetTargets ?? {}).length,
  };

  const response: GenerateFromIntentResponse = {
    workout: autoregulated.adjusted,
    sraWarnings: result.sraWarnings,
    substitutions: result.substitutions,
    volumePlanByMuscle: result.volumePlanByMuscle,
    selectionMode: result.selectionMode,
    sessionIntent: result.sessionIntent,
    selectionSummary,
    selectionMetadata,
    selection: includeSelectionDebug ? selectionMetadata : undefined,
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
  };

  return NextResponse.json(response);
}
