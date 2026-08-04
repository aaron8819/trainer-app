import { NextResponse } from "next/server";
import {
  findOwnerReadOnly,
  provisionOwnerForMutation,
} from "@/lib/api/workout-context";
import {
  deleteFinisherRoutine,
  editUserFinisherRoutine,
  loadFinisherLibraryItem,
} from "@/lib/api/finisher-library-service";
import { finisherLibraryErrorResponse } from "@/lib/api/finisher-library-http";
import { finisherRolloutUnavailableResponse } from "@/lib/operations/finisher-rollout-http";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import {
  editFinisherRoutineSchema,
  finisherLibraryMutationSchema,
} from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const unavailable = finisherRolloutUnavailableResponse();
  if (unavailable) return unavailable;
  const owner = await findOwnerReadOnly();
  const { id } = await params;
  const result = owner ? await loadFinisherLibraryItem(owner.id, id) : null;
  if (!result) {
    return NextResponse.json(
      { error: "FINISHER_ROUTINE_NOT_FOUND", code: "FINISHER_ROUTINE_NOT_FOUND" },
      { status: 404 },
    );
  }
  return NextResponse.json(result);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const unavailable = finisherRolloutUnavailableResponse();
  if (unavailable) return unavailable;
  const paused = productionWritePauseResponse(
    "application_configuration",
    "/api/finishers/[id]",
  );
  if (paused) return paused;

  const parsed = editFinisherRoutineSchema.safeParse(
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
    const item = await editUserFinisherRoutine({
      ownerId: owner.id,
      routineId: id,
      ...parsed.data,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return finisherLibraryErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const unavailable = finisherRolloutUnavailableResponse();
  if (unavailable) return unavailable;
  const paused = productionWritePauseResponse(
    "application_configuration",
    "/api/finishers/[id]",
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
      await deleteFinisherRoutine({
        ownerId: owner.id,
        routineId: id,
        expectedRevision: parsed.data.expectedRevision,
      }),
    );
  } catch (error) {
    return finisherLibraryErrorResponse(error);
  }
}
