import { NextResponse } from "next/server";

import { createCloseoutSessionForWeek } from "@/lib/api/mesocycle-week-close";
import { resolveOwner } from "@/lib/api/workout-context";
import { prisma } from "@/lib/db/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Week-close id required" }, { status: 400 });
  }

  try {
    const workout = await prisma.$transaction((tx) =>
      createCloseoutSessionForWeek(tx, {
        userId: user.id,
        weekCloseId: id,
      })
    );

    return NextResponse.json({ workout }, { status: 201 });
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }

    if (error.message === "WEEK_CLOSE_NOT_FOUND") {
      return NextResponse.json({ error: "Week-close window not found" }, { status: 404 });
    }

    if (
      error.message === "CLOSEOUT_ACTIVE_MESOCYCLE_REQUIRED" ||
      error.message === "CLOSEOUT_ACTIVE_WEEK_REQUIRED" ||
      error.message === "CLOSEOUT_DELOAD_WEEK_FORBIDDEN" ||
      error.message === "CLOSEOUT_ALREADY_EXISTS_FOR_WEEK"
    ) {
      return NextResponse.json(
        {
          error:
            error.message === "CLOSEOUT_ALREADY_EXISTS_FOR_WEEK"
              ? "A closeout session already exists for this active week."
              : "Closeout session creation is only allowed for the current active accumulation week.",
        },
        { status: 409 }
      );
    }

    throw error;
  }
}
