import { NextResponse } from "next/server";
import { provisionOwnerForMutation } from "@/lib/api/workout-context";
import { reorderFinisherLibrary } from "@/lib/api/finisher-library-service";
import { finisherLibraryErrorResponse } from "@/lib/api/finisher-library-http";
import { finisherRolloutUnavailableResponse } from "@/lib/operations/finisher-rollout-http";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { reorderFinisherLibrarySchema } from "@/lib/validation";

export async function POST(request: Request) {
  const unavailable = finisherRolloutUnavailableResponse();
  if (unavailable) return unavailable;
  const paused = productionWritePauseResponse(
    "application_configuration",
    "/api/finishers/reorder",
  );
  if (paused) return paused;

  const parsed = reorderFinisherLibrarySchema.safeParse(
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
    return NextResponse.json(
      await reorderFinisherLibrary({ ownerId: owner.id, items: parsed.data.items }),
    );
  } catch (error) {
    return finisherLibraryErrorResponse(error);
  }
}
