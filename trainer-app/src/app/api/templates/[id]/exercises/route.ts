import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { addExerciseToTemplateSchema } from "@/lib/validation";
import { loadTemplateDetail } from "@/lib/api/templates";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: templateId } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = addExerciseToTemplateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const template = await prisma.workoutTemplate.findUnique({
    where: { id: templateId },
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

  const detail = await loadTemplateDetail(templateId);
  return NextResponse.json(detail);
}
