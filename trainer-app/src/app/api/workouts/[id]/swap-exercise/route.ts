import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveOwner } from "@/lib/api/workout-context";
import {
  applyRuntimeExerciseSwap,
  isRuntimeExerciseSwapError,
  resolveRuntimeExerciseSwapCandidates,
} from "@/lib/api/runtime-exercise-swap-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const swapExerciseSchema = z.object({
  workoutExerciseId: z.string().min(1),
  replacementExerciseId: z.string().min(1),
});

function parseLimit(rawLimit: string | null, fallback: number): number {
  if (rawLimit == null) {
    return fallback;
  }

  const parsedLimit = Number(rawLimit);
  if (!Number.isFinite(parsedLimit)) {
    return fallback;
  }

  return Math.min(12, Math.max(1, Math.floor(parsedLimit)));
}

function toErrorResponse(error: unknown) {
  if (isRuntimeExerciseSwapError(error)) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  throw error;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolvedParams = await params;
  const workoutId = resolvedParams?.id;
  const searchParams = new URL(request.url).searchParams;
  const workoutExerciseId = searchParams.get("workoutExerciseId");
  const query = searchParams.get("q")?.trim() ?? "";
  const limit = parseLimit(searchParams.get("limit"), query.length > 0 ? 8 : 5);

  if (!workoutId || !workoutExerciseId) {
    return NextResponse.json(
      { error: "Missing workout id or workoutExerciseId" },
      { status: 400 },
    );
  }

  const owner = await resolveOwner();

  try {
    const candidates = await resolveRuntimeExerciseSwapCandidates({
      workoutId,
      workoutExerciseId,
      userId: owner.id,
      query,
      limit,
    });

    return NextResponse.json({ candidates });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolvedParams = await params;
  if (!resolvedParams?.id) {
    return NextResponse.json({ error: "Missing workout id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = swapExerciseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const owner = await resolveOwner();

  try {
    const exercise = await applyRuntimeExerciseSwap({
      workoutId: resolvedParams.id,
      workoutExerciseId: parsed.data.workoutExerciseId,
      replacementExerciseId: parsed.data.replacementExerciseId,
      userId: owner.id,
    });

    return NextResponse.json({ exercise });
  } catch (error) {
    return toErrorResponse(error);
  }
}
