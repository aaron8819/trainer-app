import { NextResponse } from "next/server";

import { dismissCloseoutSession } from "@/lib/api/mesocycle-week-close";
import { resolveOwner } from "@/lib/api/workout-context";
import { prisma } from "@/lib/db/prisma";
import { isWorkoutMutationError } from "@/lib/api/workout-mutation";
import { z } from "zod";

const dismissCloseoutSchema = z.object({
  expectedRevision: z.number().int().min(1),
});

function buildDismissCloseoutErrorResponse(error: Error) {
  if (isWorkoutMutationError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error.message === "CLOSEOUT_WORKOUT_NOT_FOUND") {
    return NextResponse.json({ error: "Closeout workout not found" }, { status: 404 });
  }

  if (error.message === "CLOSEOUT_DISMISSAL_NOT_CLOSEOUT") {
    return NextResponse.json(
      { error: "Only closeout workouts can be dismissed through this action." },
      { status: 409 }
    );
  }

  if (error.message === "CLOSEOUT_DISMISSAL_REQUIRES_PLANNED") {
    return NextResponse.json(
      { error: "Only planned closeout workouts can be dismissed." },
      { status: 409 }
    );
  }

  throw error;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Workout id required" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = dismissCloseoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction((tx) =>
      dismissCloseoutSession(tx, {
        userId: user.id,
        workoutId: id,
        expectedRevision: parsed.data.expectedRevision,
      })
    );

    return NextResponse.json({
      workoutId: result.id,
      status: result.status,
      revision: result.revision,
      outcome: result.outcome,
      closeoutDismissed: true,
    });
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return buildDismissCloseoutErrorResponse(error);
  }
}
