import { NextResponse } from "next/server";
import { setLogSchema } from "@/lib/validation";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = setLogSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const owner = await resolveOwner();
  const setRecord = await prisma.workoutSet.findFirst({
    where: {
      id: parsed.data.workoutSetId,
      workoutExercise: { workout: { userId: owner.id } },
    },
    select: { id: true },
  });

  if (!setRecord) {
    return NextResponse.json({ error: "Workout set not found" }, { status: 404 });
  }

  const log = await prisma.setLog.upsert({
    where: { workoutSetId: parsed.data.workoutSetId },
    update: {
      actualReps: parsed.data.actualReps ?? undefined,
      actualRpe: parsed.data.actualRpe ?? undefined,
      actualLoad: parsed.data.actualLoad ?? undefined,
      wasSkipped: parsed.data.wasSkipped ?? false,
      notes: parsed.data.notes ?? undefined,
      completedAt: new Date(),
    },
    create: {
      workoutSetId: parsed.data.workoutSetId,
      actualReps: parsed.data.actualReps ?? undefined,
      actualRpe: parsed.data.actualRpe ?? undefined,
      actualLoad: parsed.data.actualLoad ?? undefined,
      wasSkipped: parsed.data.wasSkipped ?? false,
      notes: parsed.data.notes ?? undefined,
    },
  });

  return NextResponse.json({ status: "logged", logId: log.id });
}
