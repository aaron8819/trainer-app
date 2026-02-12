import { NextResponse } from "next/server";
import { generateFromIntentSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { generateSessionFromIntent } from "@/lib/api/template-session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = generateFromIntentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const result = await generateSessionFromIntent(user.id, parsed.data);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    workout: result.workout,
    sraWarnings: result.sraWarnings,
    substitutions: result.substitutions,
    volumePlanByMuscle: result.volumePlanByMuscle,
    selectionMode: result.selectionMode,
    sessionIntent: result.sessionIntent,
    selection: result.selection,
  });
}
