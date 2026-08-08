import { NextResponse } from "next/server";
import { findOwnerReadOnly } from "@/lib/api/workout-context";
import { loadExerciseHistory } from "@/lib/api/exercise-history";
import { measurementSemanticsSchema } from "@/lib/exercise-measurement/semantics";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: exerciseId } = await params;
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") ?? "3", 10);
  const snapshotMode = searchParams.get("measurementSnapshot");
  let comparisonSnapshot;
  if (snapshotMode === "legacy") {
    comparisonSnapshot = { measurement: null };
  } else if (snapshotMode === "classified") {
    const parsedMeasurement = measurementSemanticsSchema.safeParse({
      profile: searchParams.get("measurementProfile"),
      ...(searchParams.has("loadConvention")
        ? { loadConvention: searchParams.get("loadConvention") }
        : {}),
      repBasis: searchParams.get("repBasis"),
    });
    if (!parsedMeasurement.success) {
      return NextResponse.json(
        { error: "Invalid measurement snapshot" },
        { status: 400 },
      );
    }
    comparisonSnapshot = { measurement: parsedMeasurement.data };
  } else if (snapshotMode != null) {
    return NextResponse.json(
      { error: "Invalid measurement snapshot" },
      { status: 400 },
    );
  }

  const user = await findOwnerReadOnly();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const boundedLimit = Math.min(Math.max(limit, 1), 20);
  const result = comparisonSnapshot
    ? await loadExerciseHistory(exerciseId, user.id, boundedLimit, comparisonSnapshot)
    : await loadExerciseHistory(exerciseId, user.id, boundedLimit);

  return NextResponse.json(result);
}
