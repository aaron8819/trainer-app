import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { addExerciseToTemplateSchema } from "@/lib/validation";
import { loadTemplateDetail } from "@/lib/api/templates";
import { resolveOwner } from "@/lib/api/workout-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: templateId } = await params;
  const owner = await resolveOwner();
  const body = await request.json().catch(() => ({}));
  const parsed = addExerciseToTemplateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const template = await prisma.workoutTemplate.findFirst({
    where: { id: templateId, userId: owner.id },
    include: { exercises: { orderBy: { orderIndex: "desc" }, take: 1 } },
  });

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const exercise = await prisma.exercise.findUnique({
    where: { id: parsed.data.exerciseId },
  });

  if (!exercise) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }

  const nextOrder = (template.exercises[0]?.orderIndex ?? -1) + 1;

  await prisma.workoutTemplateExercise.create({
    data: {
      templateId,
      exerciseId: parsed.data.exerciseId,
      orderIndex: nextOrder,
    },
  });

  const detail = await loadTemplateDetail(templateId, owner.id);
  return NextResponse.json(detail);
}
