import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveOwner } from "@/lib/api/workout-context";
import { loadProgramDashboardData, applyCycleAnchor } from "@/lib/api/program";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await resolveOwner();
  const data = await loadProgramDashboardData(user.id);
  return NextResponse.json(data);
}

const cycleAnchorSchema = z.object({
  action: z.enum(["deload", "extend_phase", "skip_phase", "reset"]),
});

export async function PATCH(request: NextRequest) {
  const user = await resolveOwner();
  const body = await request.json().catch(() => ({}));
  const parsed = cycleAnchorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  try {
    await applyCycleAnchor(user.id, parsed.data.action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to apply action";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
