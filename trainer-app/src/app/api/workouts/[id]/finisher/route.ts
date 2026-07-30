import { NextResponse } from "next/server";
import { findOwnerReadOnly, resolveOwner } from "@/lib/api/workout-context";
import {
  createFinisherOffer,
  declineFinisherOffer,
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
import { finisherRolloutUnavailableResponse } from "@/lib/operations/finisher-rollout-http";
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
  const unavailable = finisherRolloutUnavailableResponse();
  if (unavailable) return unavailable;

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
  const unavailable = finisherRolloutUnavailableResponse();
  if (unavailable) return unavailable;

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
      case "offer":
        return NextResponse.json(await createFinisherOffer(context));
      case "select":
        await selectFinisher({ ...context, ...action });
        break;
      case "decline":
        await declineFinisherOffer({ ...context, ...action });
        break;
      case "start":
        return NextResponse.json(
          await startFinisher({ ...context, ...action }),
        );
      case "dismiss":
        return NextResponse.json(
          await dismissSelectedFinisher({ ...context, ...action }),
        );
      case "sync":
        return NextResponse.json(await syncFinisher({ ...context, ...action }));
      case "pause":
        return NextResponse.json(await pauseFinisher({ ...context, ...action }));
      case "resume":
        return NextResponse.json(
          await resumeFinisher({ ...context, ...action }),
        );
      case "skip":
        return NextResponse.json(
          await skipFinisherStep({ ...context, ...action }),
        );
      case "substitute":
        return NextResponse.json(
          await substituteFinisherStep({ ...context, ...action }),
        );
      case "end":
        return NextResponse.json(await endFinisher({ ...context, ...action }));
      case "feedback":
        return NextResponse.json(
          await recordFinisherFeedback({ ...context, ...action }),
        );
    }
    return NextResponse.json(await getFinisherOffer(context));
  } catch (error) {
    return errorResponse(error);
  }
}
