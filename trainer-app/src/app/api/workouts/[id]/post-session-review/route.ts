import { NextResponse } from "next/server";
import { loadCompletedWorkoutReviewReadModel } from "@/lib/api/completed-workout-review";
import { resolveOwner } from "@/lib/api/workout-context";

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
  const review = await loadCompletedWorkoutReviewReadModel(owner.id, resolvedParams.id);

  return NextResponse.json(review);
}
