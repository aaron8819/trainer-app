import { NextResponse } from "next/server";
import { provisionOwnerForMutation } from "@/lib/api/workout-context";
import { restoreFinisherRoutine } from "@/lib/api/finisher-library-service";
import { finisherLibraryErrorResponse } from "@/lib/api/finisher-library-http";
import { finisherRolloutUnavailableResponse } from "@/lib/operations/finisher-rollout-http";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { finisherLibraryMutationSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = finisherRolloutUnavailableResponse();
  if (unavailable) return unavailable;
  const paused = productionWritePauseResponse(
    "application_configuration",
    "/api/finishers/[id]/restore",
  );
  if (paused) return paused;

  const parsed = finisherLibraryMutationSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }
  try {
    const owner = await provisionOwnerForMutation("application_configuration");
    const { id } = await params;
    return NextResponse.json(
      await restoreFinisherRoutine({
        ownerId: owner.id,
        routineId: id,
        expectedRevision: parsed.data.expectedRevision,
      }),
    );
  } catch (error) {
    return finisherLibraryErrorResponse(error);
  }
}
