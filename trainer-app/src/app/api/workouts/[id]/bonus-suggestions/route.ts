import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { getBonusSuggestions } from "@/lib/api/bonus-suggestions";
import { getCloseoutSuggestions } from "@/lib/api/closeout-suggestions";
import { isCloseoutSession } from "@/lib/session-semantics/closeout-classifier";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  if (!resolvedParams?.id) {
    return NextResponse.json({ error: "Missing workout id" }, { status: 400 });
  }

  const owner = await resolveOwner();
  const workout = await prisma.workout.findFirst({
    where: {
      id: resolvedParams.id,
      userId: owner.id,
    },
    select: {
      selectionMetadata: true,
    },
  });

  if (workout && isCloseoutSession(workout.selectionMetadata)) {
    const suggestions = await getCloseoutSuggestions({
      workoutId: resolvedParams.id,
      userId: owner.id,
    });

    return NextResponse.json({ suggestions });
  }

  const suggestions = await getBonusSuggestions(resolvedParams.id, owner.id);

  return NextResponse.json({ suggestions });
}
