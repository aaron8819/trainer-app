import { NextResponse } from "next/server";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { resolveOwner } from "@/lib/api/workout-context";
import {
  FinishDeloadEarlyBlockedWorkoutError,
  finishDeloadEarly,
} from "@/lib/api/mesocycle-lifecycle";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const paused = productionWritePauseResponse(
    "mesocycle_lifecycle",
    "/api/mesocycles/[id]/finish-deload",
  );
  if (paused) return paused;

  const body = await request.json().catch(() => undefined);
  if (body !== undefined && (typeof body !== "object" || Array.isArray(body))) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const owner = await resolveOwner();
  if (!owner) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { id } = await context.params;

  try {
    const result = await finishDeloadEarly({
      userId: owner.id,
      mesocycleId: id,
    });

    return NextResponse.json({
      ok: true,
      action: "finish_deload_early",
      mesocycle: {
        id: result.mesocycle.id,
        state: result.mesocycle.state,
        closedAt: result.mesocycle.closedAt?.toISOString() ?? null,
      },
      skippedWorkoutIds: result.skippedWorkoutIds,
      skippedWorkoutCount: result.skippedWorkoutCount,
      handoffSummaryCreated: result.handoffSummaryCreated,
      nextSeedDraftCreated: result.nextSeedDraftCreated,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "MESOCYCLE_FINISH_DELOAD_NOT_FOUND"
    ) {
      return NextResponse.json({ error: "Mesocycle not found" }, { status: 404 });
    }
    if (
      error instanceof Error &&
      error.message === "MESOCYCLE_FINISH_DELOAD_INVALID_STATE"
    ) {
      return NextResponse.json(
        { error: "Mesocycle is not in active deload." },
        { status: 409 }
      );
    }
    if (
      error instanceof Error &&
      error.message === "MESOCYCLE_FINISH_DELOAD_HANDOFF_EXISTS"
    ) {
      return NextResponse.json(
        { error: "Mesocycle handoff state is already initialized." },
        { status: 409 }
      );
    }
    if (error instanceof FinishDeloadEarlyBlockedWorkoutError) {
      return NextResponse.json(
        {
          error:
            "Resolve incomplete workouts with performed logs or unclear deload scope before finishing deload early.",
          workoutIds: error.workoutIds,
        },
        { status: 409 }
      );
    }
    throw error;
  }
}
