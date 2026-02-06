import { NextResponse } from "next/server";
import { setLogSchema } from "@/lib/validation";
import { prisma } from "@/lib/db/prisma";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = setLogSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const log = await prisma.setLog.create({
    data: {
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
