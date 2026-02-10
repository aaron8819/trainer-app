import { prisma } from "@/lib/db/prisma";
import type { z } from "zod";
import type { createTemplateSchema, updateTemplateSchema } from "@/lib/validation";
import { analyzeTemplate, type AnalysisExerciseInput, type ScoreLabel } from "@/lib/engine/template-analysis";

type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type TemplateIntent =
  | "FULL_BODY"
  | "UPPER_LOWER"
  | "PUSH_PULL_LEGS"
  | "BODY_PART"
  | "CUSTOM";

const TEMPLATE_INTENTS: readonly TemplateIntent[] = [
  "FULL_BODY",
  "UPPER_LOWER",
  "PUSH_PULL_LEGS",
  "BODY_PART",
  "CUSTOM",
];

function normalizeTemplateIntent(value: unknown): TemplateIntent {
  if (typeof value === "string" && TEMPLATE_INTENTS.includes(value as TemplateIntent)) {
    return value as TemplateIntent;
  }
  return "CUSTOM";
}

export interface TemplateListItem {
  id: string;
  name: string;
  targetMuscles: string[];
  isStrict: boolean;
  intent: TemplateIntent;
  exerciseCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateExerciseDetail {
  orderIndex: number;
  exerciseId: string;
  supersetGroup?: number | null;
  name: string;
  isCompound: boolean;
  movementPatterns: string[];
  muscles: { name: string; role: "primary" | "secondary" }[];
  equipment: string[];
}

export interface TemplateDetail {
  id: string;
  name: string;
  targetMuscles: string[];
  isStrict: boolean;
  intent: TemplateIntent;
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
    intent: normalizeTemplateIntent((t as { intent?: unknown }).intent),
    exerciseCount: t._count.exercises,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));
}

export async function loadTemplateDetail(
  templateId: string,
  userId?: string
): Promise<TemplateDetail | null> {
  const template = await prisma.workoutTemplate.findFirst({
    where: {
      id: templateId,
      ...(userId ? { userId } : {}),
    },
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
    intent: normalizeTemplateIntent((template as { intent?: unknown }).intent),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
    exercises: template.exercises.map((te) => ({
      orderIndex: te.orderIndex,
      exerciseId: te.exerciseId,
      supersetGroup: te.supersetGroup,
      name: te.exercise.name,
      isCompound: te.exercise.isCompound,
      movementPatterns: (te.exercise.movementPatterns ?? []).map(
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
        intent: data.intent,
      },
    });

    if (data.exercises.length > 0) {
      await tx.workoutTemplateExercise.createMany({
        data: data.exercises.map((e) => ({
          templateId: created.id,
          exerciseId: e.exerciseId,
          orderIndex: e.orderIndex,
          supersetGroup: e.supersetGroup,
        })),
      });
    }

    return created;
  });

  const detail = await loadTemplateDetail(template.id, userId);
  return detail!;
}

export async function updateTemplate(
  templateId: string,
  data: UpdateTemplateInput,
  userId: string
): Promise<TemplateDetail | null> {
  const existing = await prisma.workoutTemplate.findFirst({
    where: { id: templateId, userId },
  });

  if (!existing) return null;

  await prisma.$transaction(async (tx) => {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.targetMuscles !== undefined) updateData.targetMuscles = data.targetMuscles;
    if (data.isStrict !== undefined) updateData.isStrict = data.isStrict;
    if (data.intent !== undefined) updateData.intent = data.intent;

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
            supersetGroup: e.supersetGroup,
          })),
        });
      }
    }
  });

  return loadTemplateDetail(templateId, userId);
}

export interface TemplateListItemWithScore extends TemplateListItem {
  score: number;
  scoreLabel: ScoreLabel;
}

export async function loadTemplatesWithScores(
  userId: string
): Promise<TemplateListItemWithScore[]> {
  const templates = await prisma.workoutTemplate.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { exercises: true } },
      exercises: {
        orderBy: { orderIndex: "asc" },
        include: {
          exercise: {
            include: {
              exerciseMuscles: { include: { muscle: true } },
            },
          },
        },
      },
    },
  });

  return templates.map((t) => {
    const inputs: AnalysisExerciseInput[] = t.exercises.map((te) => ({
      isCompound: te.exercise.isCompound,
      isMainLiftEligible: te.exercise.isMainLiftEligible,
      movementPatterns: (te.exercise.movementPatterns ?? []).map((p) =>
        p.toLowerCase()
      ),
      muscles: te.exercise.exerciseMuscles.map((m) => ({
        name: m.muscle.name,
        role: m.role.toLowerCase() as "primary" | "secondary",
      })),
      sfrScore: te.exercise.sfrScore,
      lengthPositionScore: te.exercise.lengthPositionScore,
      fatigueCost: te.exercise.fatigueCost,
      orderIndex: te.orderIndex,
    }));

    const analysis = analyzeTemplate(inputs, {
      intent: normalizeTemplateIntent((t as { intent?: unknown }).intent),
    });

    return {
      id: t.id,
      name: t.name,
      targetMuscles: t.targetMuscles,
      isStrict: t.isStrict,
      intent: normalizeTemplateIntent((t as { intent?: unknown }).intent),
      exerciseCount: t._count.exercises,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      score: analysis.overallScore,
      scoreLabel: analysis.overallLabel,
    };
  });
}

export async function deleteTemplate(templateId: string, userId: string): Promise<boolean> {
  const existing = await prisma.workoutTemplate.findFirst({
    where: { id: templateId, userId },
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
