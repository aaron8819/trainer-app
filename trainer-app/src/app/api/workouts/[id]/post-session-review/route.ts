import { NextResponse } from "next/server";
import { loadCompletedWorkoutReviewReadModel } from "@/lib/api/completed-workout-review";
import { findOwnerReadOnly } from "@/lib/api/workout-context";

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

  const owner = await findOwnerReadOnly();
  if (!owner) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const review = await loadCompletedWorkoutReviewReadModel(owner.id, resolvedParams.id);

  return NextResponse.json(review);
}
