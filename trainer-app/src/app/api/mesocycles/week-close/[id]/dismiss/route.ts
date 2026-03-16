import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { dismissPendingWeekClose } from "@/lib/api/mesocycle-week-close";

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

  const result = await prisma.$transaction(async (tx) => {
    const weekClose = await tx.mesocycleWeekClose.findFirst({
      where: {
        id,
        mesocycle: {
          macroCycle: {
            userId: user.id,
          },
        },
      },
      select: { id: true },
    });

    if (!weekClose) {
      throw new Error("WEEK_CLOSE_NOT_FOUND");
    }

    return dismissPendingWeekClose(tx, { weekCloseId: id });
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "WEEK_CLOSE_NOT_FOUND") {
      return null;
    }
    throw error;
  });

  if (!result) {
    return NextResponse.json({ error: "Week-close window not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: result.status,
    resolution: result.resolution,
    weekCloseState: result.weekCloseState,
    advancedLifecycle: result.advancedLifecycle,
    outcome: result.outcome,
    weekCloseId: result.weekCloseId,
  });
}
