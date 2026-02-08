import { prisma } from "@/lib/db/prisma";
import type { z } from "zod";
import type { createTemplateSchema, updateTemplateSchema } from "@/lib/validation";

type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export interface TemplateListItem {
  id: string;
  name: string;
  targetMuscles: string[];
  isStrict: boolean;
  exerciseCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateExerciseDetail {
  orderIndex: number;
  exerciseId: string;
  name: string;
  isCompound: boolean;
  movementPatternsV2: string[];
  muscles: { name: string; role: "primary" | "secondary" }[];
  equipment: string[];
}

export interface TemplateDetail {
  id: string;
  name: string;
  targetMuscles: string[];
  isStrict: boolean;
  createdAt: string;
  updatedAt: string;
  exercises: TemplateExerciseDetail[];
}

export async function loadTemplates(userId: string): Promise<TemplateListItem[]> {
  const templates = await prisma.workoutTemplate.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { exercises: true } },
    },
  });

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    targetMuscles: t.targetMuscles,
    isStrict: t.isStrict,
    exerciseCount: t._count.exercises,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));
}

export async function loadTemplateDetail(
  templateId: string
): Promise<TemplateDetail | null> {
  const template = await prisma.workoutTemplate.findUnique({
    where: { id: templateId },
    include: {
      exercises: {
        orderBy: { orderIndex: "asc" },
        include: {
          exercise: {
            include: {
              exerciseMuscles: { include: { muscle: true } },
              exerciseEquipment: { include: { equipment: true } },
            },
          },
        },
      },
    },
  });

  if (!template) return null;

  return {
    id: template.id,
    name: template.name,
    targetMuscles: template.targetMuscles,
    isStrict: template.isStrict,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
    exercises: template.exercises.map((te) => ({
      orderIndex: te.orderIndex,
      exerciseId: te.exerciseId,
      name: te.exercise.name,
      isCompound: te.exercise.isCompound,
      movementPatternsV2: (te.exercise.movementPatternsV2 ?? []).map(
        (p) => p.toLowerCase()
      ),
      muscles: te.exercise.exerciseMuscles.map((m) => ({
        name: m.muscle.name,
        role: m.role.toLowerCase() as "primary" | "secondary",
      })),
      equipment: te.exercise.exerciseEquipment.map(
        (e) => e.equipment.type.toLowerCase()
      ),
    })),
  };
}

export async function createTemplate(
  userId: string,
  data: CreateTemplateInput
): Promise<TemplateDetail> {
  const template = await prisma.$transaction(async (tx) => {
    const created = await tx.workoutTemplate.create({
      data: {
        userId,
        name: data.name,
        targetMuscles: data.targetMuscles,
        isStrict: data.isStrict,
      },
    });

    if (data.exercises.length > 0) {
      await tx.workoutTemplateExercise.createMany({
        data: data.exercises.map((e) => ({
          templateId: created.id,
          exerciseId: e.exerciseId,
          orderIndex: e.orderIndex,
        })),
      });
    }

    return created;
  });

  const detail = await loadTemplateDetail(template.id);
  return detail!;
}

export async function updateTemplate(
  templateId: string,
  data: UpdateTemplateInput
): Promise<TemplateDetail | null> {
  const existing = await prisma.workoutTemplate.findUnique({
    where: { id: templateId },
  });

  if (!existing) return null;

  await prisma.$transaction(async (tx) => {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.targetMuscles !== undefined) updateData.targetMuscles = data.targetMuscles;
    if (data.isStrict !== undefined) updateData.isStrict = data.isStrict;

    if (Object.keys(updateData).length > 0) {
      await tx.workoutTemplate.update({
        where: { id: templateId },
        data: updateData,
      });
    }

    if (data.exercises !== undefined) {
      await tx.workoutTemplateExercise.deleteMany({
        where: { templateId },
      });

      if (data.exercises.length > 0) {
        await tx.workoutTemplateExercise.createMany({
          data: data.exercises.map((e) => ({
            templateId,
            exerciseId: e.exerciseId,
            orderIndex: e.orderIndex,
          })),
        });
      }
    }
  });

  return loadTemplateDetail(templateId);
}

export async function deleteTemplate(templateId: string): Promise<boolean> {
  const existing = await prisma.workoutTemplate.findUnique({
    where: { id: templateId },
  });

  if (!existing) return false;

  await prisma.$transaction(async (tx) => {
    // Null out templateId on associated workouts to preserve history
    await tx.workout.updateMany({
      where: { templateId },
      data: { templateId: null },
    });

    await tx.workoutTemplateExercise.deleteMany({
      where: { templateId },
    });

    await tx.workoutTemplate.delete({
      where: { id: templateId },
    });
  });

  return true;
}
