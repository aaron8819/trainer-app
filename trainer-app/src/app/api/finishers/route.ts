import { NextResponse } from "next/server";
import {
  findOwnerReadOnly,
  provisionOwnerForMutation,
} from "@/lib/api/workout-context";
import {
  createUserFinisherRoutine,
  loadFinisherLibrary,
} from "@/lib/api/finisher-library-service";
import { finisherLibraryErrorResponse } from "@/lib/api/finisher-library-http";
import { finisherRolloutUnavailableResponse } from "@/lib/operations/finisher-rollout-http";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { createFinisherRoutineSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const unavailable = finisherRolloutUnavailableResponse();
  if (unavailable) return unavailable;
  const owner = await findOwnerReadOnly();
  if (!owner) {
    return NextResponse.json(
      { error: "FINISHER_LIBRARY_NOT_FOUND", code: "FINISHER_LIBRARY_NOT_FOUND" },
      { status: 404 },
    );
  }
  return NextResponse.json(await loadFinisherLibrary(owner.id));
}

export async function POST(request: Request) {
  const unavailable = finisherRolloutUnavailableResponse();
  if (unavailable) return unavailable;
  const paused = productionWritePauseResponse(
    "application_configuration",
    "/api/finishers",
  );
  if (paused) return paused;

  const parsed = createFinisherRoutineSchema.safeParse(
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
    const item = await createUserFinisherRoutine({
      ownerId: owner.id,
      definition: parsed.data.definition,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return finisherLibraryErrorResponse(error);
  }
}
