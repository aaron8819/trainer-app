import { NextResponse } from "next/server";
import { findOwnerReadOnly, resolveOwner } from "@/lib/api/workout-context";
import {
  dismissSelectedFinisher,
  endFinisher,
  FinisherServiceError,
  getFinisherOffer,
  pauseFinisher,
  recordFinisherFeedback,
  resumeFinisher,
  selectFinisher,
  skipFinisherStep,
  startFinisher,
  substituteFinisherStep,
  syncFinisher,
} from "@/lib/api/finisher-service";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { finisherActionSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof FinisherServiceError) {
    return NextResponse.json(
      { error: error.code, code: error.code },
      { status: error.status }
    );
  }
  throw error;
}

async function resolveContext(
  params: Promise<{ id: string }>,
  mode: "read" | "write",
) {
  const resolvedParams = await params;
  if (!resolvedParams?.id) {
    throw new FinisherServiceError("MISSING_WORKOUT_ID", 400);
  }
  const owner =
    mode === "read" ? await findOwnerReadOnly() : await resolveOwner();
  if (!owner) {
    throw new FinisherServiceError("WORKOUT_NOT_FOUND", 404);
  }
  return { workoutId: resolvedParams.id, userId: owner.id };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveContext(params, "read");
    return NextResponse.json(await getFinisherOffer(context));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const paused = productionWritePauseResponse(
    "finisher_execution",
    "/api/workouts/[id]/finisher"
  );
  if (paused) return paused;

  const body = await request.json().catch(() => ({}));
  const parsed = finisherActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", code: "INVALID_REQUEST" },
      { status: 400 }
    );
  }

  try {
    const context = await resolveContext(params, "write");
    const action = parsed.data;
    switch (action.action) {
      case "select":
        await selectFinisher({ ...context, ...action });
        break;
      case "start":
        await startFinisher({ ...context, ...action });
        break;
      case "dismiss":
        await dismissSelectedFinisher({ ...context, ...action });
        break;
      case "sync":
        await syncFinisher({ ...context, ...action });
        break;
      case "pause":
        await pauseFinisher({ ...context, ...action });
        break;
      case "resume":
        await resumeFinisher({ ...context, ...action });
        break;
      case "skip":
        await skipFinisherStep({ ...context, ...action });
        break;
      case "substitute":
        await substituteFinisherStep({ ...context, ...action });
        break;
      case "end":
        await endFinisher({ ...context, ...action });
        break;
      case "feedback":
        await recordFinisherFeedback({ ...context, ...action });
        break;
    }
    return NextResponse.json(await getFinisherOffer(context));
  } catch (error) {
    return errorResponse(error);
  }
}
