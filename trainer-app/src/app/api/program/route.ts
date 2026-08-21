import { NextRequest, NextResponse } from "next/server";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { z } from "zod";
import {
  findOwnerReadOnly,
  provisionOwnerForMutation,
} from "@/lib/api/workout-context";
import { loadProgramDashboardData, applyCycleAnchor } from "@/lib/api/program";
import { loadPendingMesocycleHandoff } from "@/lib/api/mesocycle-handoff";
import { FinishMesocycleEarlyBlockedWorkoutError } from "@/lib/api/mesocycle-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await findOwnerReadOnly();
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const pendingHandoff = await loadPendingMesocycleHandoff(user.id);
  if (pendingHandoff) {
    return NextResponse.json(
      {
        error: "Mesocycle handoff pending.",
        handoff: pendingHandoff,
      },
      { status: 409 }
    );
  }
  const weekParam = request.nextUrl.searchParams.get("week");
  const viewWeek = weekParam !== null ? parseInt(weekParam, 10) : undefined;
  const data = await loadProgramDashboardData(user.id, Number.isFinite(viewWeek) ? viewWeek : undefined);
  return NextResponse.json(data);
}

const cycleAnchorSchema = z.object({
  action: z.enum(["deload", "extend_phase", "reset", "end_early"]),
});

export async function PATCH(request: NextRequest) {
  const paused = productionWritePauseResponse("mesocycle_lifecycle", "/api/program");
  if (paused) return paused;

  const user = await provisionOwnerForMutation("mesocycle_lifecycle");
  const pendingHandoff = await loadPendingMesocycleHandoff(user.id);
  if (pendingHandoff) {
    return NextResponse.json(
      {
        error: "Mesocycle handoff pending.",
        handoff: pendingHandoff,
      },
      { status: 409 }
    );
  }
  const body = await request.json().catch(() => ({}));
  const parsed = cycleAnchorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  try {
    await applyCycleAnchor(user.id, parsed.data.action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof FinishMesocycleEarlyBlockedWorkoutError) {
      return NextResponse.json(
        {
          error:
            "Resolve incomplete workouts with performed logs before ending the mesocycle early.",
          workoutIds: err.workoutIds,
        },
        { status: 409 }
      );
    }
    if (
      err instanceof Error &&
      err.message.startsWith("V4_SCHEDULE_COMPLETION_BLOCKED:")
    ) {
      return NextResponse.json(
        {
          error:
            "The accepted workout schedule or plan boundary changed. Refresh before retrying.",
          code: "V4_SCHEDULE_COMPLETION_BLOCKED",
        },
        { status: 409 },
      );
    }
    if (
      err instanceof Error &&
      err.message === "V4_SCHEDULE_AUTHORITY_CONFLICT"
    ) {
      return NextResponse.json(
        {
          error:
            "The accepted workout schedule changed concurrently. Refresh and try again.",
          code: "V4_SCHEDULE_AUTHORITY_CONFLICT",
        },
        { status: 409 },
      );
    }
    if (
      err instanceof Error &&
      (err.message === "MESOCYCLE_FINISH_EARLY_INVALID_STATE" ||
        err.message === "MESOCYCLE_FINISH_EARLY_HANDOFF_EXISTS")
    ) {
      return NextResponse.json(
        { error: "Mesocycle can no longer be ended early from its current state." },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "Failed to apply action";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
