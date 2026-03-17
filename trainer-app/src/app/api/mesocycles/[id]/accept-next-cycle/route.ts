import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { acceptMesocycleHandoffInTransaction } from "@/lib/api/mesocycle-handoff";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const owner = await resolveOwner();
  if (!owner) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { id } = await context.params;
  const mesocycle = await prisma.mesocycle.findFirst({
    where: {
      id,
      macroCycle: { userId: owner.id },
    },
    select: {
      id: true,
      state: true,
      nextSeedDraftJson: true,
    },
  });

  if (!mesocycle) {
    return NextResponse.json({ error: "Mesocycle not found" }, { status: 404 });
  }

  if (mesocycle.state !== "AWAITING_HANDOFF") {
    return NextResponse.json(
      { error: "Mesocycle handoff is not pending." },
      { status: 409 }
    );
  }

  if (!mesocycle.nextSeedDraftJson) {
    return NextResponse.json(
      { error: "Mesocycle handoff draft is missing." },
      { status: 409 }
    );
  }

  try {
    const nextMesocycle = await prisma.$transaction((tx) =>
      acceptMesocycleHandoffInTransaction(tx, id)
    );

    return NextResponse.json({
      ok: true,
      priorMesocycleId: id,
      nextMesocycle: {
        id: nextMesocycle.id,
        state: nextMesocycle.state,
        mesoNumber: nextMesocycle.mesoNumber,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MESOCYCLE_HANDOFF_NOT_PENDING") {
      return NextResponse.json(
        { error: "Mesocycle handoff is not pending." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "MESOCYCLE_HANDOFF_DRAFT_MISSING") {
      return NextResponse.json(
        { error: "Mesocycle handoff draft is missing." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "MESOCYCLE_HANDOFF_DRAFT_INVALID") {
      return NextResponse.json(
        { error: "Mesocycle handoff draft is invalid." },
        { status: 409 }
      );
    }
    if (
      error instanceof Error &&
      error.message.startsWith("MESOCYCLE_HANDOFF_KEEP_SELECTION_CONFLICT:")
    ) {
      return NextResponse.json(
        { error: error.message.split(":").slice(1).join(":") },
        { status: 409 }
      );
    }
    throw error;
  }
}
