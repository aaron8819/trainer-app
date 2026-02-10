import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { upsertBaselineSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = upsertBaselineSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const exercise = await prisma.exercise.findUnique({
    where: { id: parsed.data.exerciseId },
  });
  if (!exercise) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }

  const payload = {
    workingWeightMin: parsed.data.workingWeightMin ?? null,
    workingWeightMax: parsed.data.workingWeightMax ?? null,
    workingRepsMin: parsed.data.workingRepsMin ?? null,
    workingRepsMax: parsed.data.workingRepsMax ?? null,
    topSetWeight: parsed.data.topSetWeight ?? null,
    topSetReps: parsed.data.topSetReps ?? null,
    notes: parsed.data.notes ?? null,
  };

  const baseline = await prisma.baseline.upsert({
    where: {
      userId_exerciseId_context: {
        userId: user.id,
        exerciseId: parsed.data.exerciseId,
        context: parsed.data.context,
      },
    },
    update: payload,
    create: {
      userId: user.id,
      exerciseId: parsed.data.exerciseId,
      exerciseName: exercise.name,
      context: parsed.data.context,
      category: exercise.isMainLiftEligible ? "MAIN_LIFT" : "OTHER",
      ...payload,
    },
  });

  return NextResponse.json({ status: "saved", baseline });
}
