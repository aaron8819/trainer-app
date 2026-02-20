import { NextResponse } from "next/server";
import { generateFromTemplateSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { generateSessionFromTemplate } from "@/lib/api/template-session";
import { applyAutoregulation } from "@/lib/api/autoregulation";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = generateFromTemplateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const result = await generateSessionFromTemplate(user.id, parsed.data.templateId, {
    pinnedExerciseIds: parsed.data.pinnedExerciseIds,
    autoFillUnpinned: parsed.data.autoFillUnpinned,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Phase 3: Apply autoregulation
  const autoregulated = await applyAutoregulation(user.id, result.workout);

  return NextResponse.json({
    workout: autoregulated.adjusted,
    templateId: result.templateId,
    sraWarnings: result.sraWarnings,
    substitutions: result.substitutions,
    volumePlanByMuscle: result.volumePlanByMuscle,
    selectionMode: result.selectionMode,
    sessionIntent: result.sessionIntent,
    selection: result.selection,
    autoregulation: {
      applied: autoregulated.applied,
      reason: autoregulated.reason,
      signalAgeHours: autoregulated.signalAgeHours,
      wasAutoregulated: autoregulated.wasAutoregulated,
      fatigueScore: autoregulated.fatigueScore,
      modifications: autoregulated.modifications,
      rationale: autoregulated.rationale,
    },
  });
}
