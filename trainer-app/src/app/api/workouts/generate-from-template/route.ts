import { NextResponse } from "next/server";
import { generateFromTemplateSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { generateSessionFromTemplate } from "@/lib/api/template-session";

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

  return NextResponse.json({
    workout: result.workout,
    templateId: result.templateId,
    sraWarnings: result.sraWarnings,
    substitutions: result.substitutions,
    volumePlanByMuscle: result.volumePlanByMuscle,
    selectionMode: result.selectionMode,
    sessionIntent: result.sessionIntent,
    selection: result.selection,
  });
}
