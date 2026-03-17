import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { nextCycleSeedDraftUpdateSchema } from "@/lib/validation";
import { updateMesocycleHandoffDraftInTransaction } from "@/lib/api/mesocycle-handoff";

export async function PATCH(
  request: Request,
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

  const body = await request.json().catch(() => ({}));
  const parsed = nextCycleSeedDraftUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Draft payload is invalid.",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  try {
    const updated = await prisma.$transaction((tx) =>
      updateMesocycleHandoffDraftInTransaction(tx, {
        mesocycleId: id,
        draft: parsed.data,
      })
    );

    return NextResponse.json({
      ok: true,
      handoff: updated,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MESOCYCLE_HANDOFF_NOT_PENDING") {
      return NextResponse.json(
        { error: "Mesocycle handoff is not pending." },
        { status: 409 }
      );
    }
    if (
      error instanceof Error &&
      (error.message === "MESOCYCLE_HANDOFF_SUMMARY_MISSING" ||
        error.message === "MESOCYCLE_HANDOFF_DRAFT_INVALID")
    ) {
      return NextResponse.json(
        { error: "Draft payload is invalid." },
        { status: 400 }
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
