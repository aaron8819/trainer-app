import { NextResponse } from "next/server";
import { resolveOwner } from "@/lib/api/workout-context";
import { refreshMesocycleHandoffNextSeedDraftFromV2 } from "@/lib/api/mesocycle-handoff";
import { prisma } from "@/lib/db/prisma";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
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
      { status: 409 },
    );
  }

  try {
    const result = await refreshMesocycleHandoffNextSeedDraftFromV2({
      userId: owner.id,
      mesocycleId: id,
    });

    return NextResponse.json({
      ok: true,
      handoff: result.handoff,
      seedDraft: result.seedDraft,
      v2Preparation: result.v2Preparation,
      safety: result.safety,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MESOCYCLE_HANDOFF_NOT_FOUND") {
      return NextResponse.json({ error: "Mesocycle not found" }, { status: 404 });
    }
    if (error instanceof Error && error.message === "MESOCYCLE_HANDOFF_NOT_PENDING") {
      return NextResponse.json(
        { error: "Mesocycle handoff is not pending." },
        { status: 409 },
      );
    }
    if (
      error instanceof Error &&
      (error.message === "MESOCYCLE_HANDOFF_DRAFT_MISSING" ||
        error.message === "MESOCYCLE_HANDOFF_DRAFT_INVALID" ||
        error.message === "MESOCYCLE_HANDOFF_DRAFT_CHANGED" ||
        error.message === "MESOCYCLE_HANDOFF_SUCCESSOR_ALREADY_EXISTS")
    ) {
      return NextResponse.json(
        { error: "Mesocycle handoff draft is not refreshable." },
        { status: 409 },
      );
    }
    if (
      error instanceof Error &&
      (error.message.startsWith("MESOCYCLE_HANDOFF_V2_DRAFT_REFRESH_BLOCKED:") ||
        error.message === "MESOCYCLE_HANDOFF_REFRESHED_SEED_INVALID" ||
        error.message === "MESOCYCLE_HANDOFF_REFRESHED_SEED_ALIGNMENT_INVALID")
    ) {
      return NextResponse.json(
        {
          error: "V2 materialized seed is not eligible for draft refresh.",
          reason: error.message.split(":").slice(1).join(":") || error.message,
        },
        { status: 409 },
      );
    }
    if (
      error instanceof Error &&
      error.message.startsWith("MESOCYCLE_HANDOFF_KEEP_SELECTION_CONFLICT:")
    ) {
      return NextResponse.json(
        { error: error.message.split(":").slice(1).join(":") },
        { status: 409 },
      );
    }
    throw error;
  }
}
