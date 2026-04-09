import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveOwner } from "@/lib/api/workout-context";
import { resolveRuntimeAddedExercisePreviews } from "@/lib/api/runtime-added-exercise-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const addExercisePreviewSchema = z.object({
  exerciseIds: z.array(z.string().min(1)).max(25),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  if (!resolvedParams?.id) {
    return NextResponse.json({ error: "Missing workout id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = addExercisePreviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const owner = await resolveOwner();

  try {
    const previews = await resolveRuntimeAddedExercisePreviews({
      workoutId: resolvedParams.id,
      userId: owner.id,
      exerciseIds: parsed.data.exerciseIds,
    });

    return NextResponse.json({ previews });
  } catch (error) {
    if (error instanceof Error && error.message === "WORKOUT_NOT_FOUND") {
      return NextResponse.json({ error: "Workout not found" }, { status: 404 });
    }

    throw error;
  }
}
