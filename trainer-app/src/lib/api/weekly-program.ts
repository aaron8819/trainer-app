import { prisma } from "@/lib/db/prisma";
import { resolveSetCount } from "@/lib/engine/prescription";
import type { FatigueState, TrainingAge } from "@/lib/engine/types";
import type { WeeklyProgramSessionInput } from "@/lib/engine/weekly-program-analysis";

const DEFAULT_FATIGUE_STATE: FatigueState = {
  readinessScore: 3,
  missedLastSession: false,
};
const TEMPLATE_MAIN_LIFT_SLOT_CAP = 2;

export type WeeklyProgramTemplateSummary = {
  id: string;
  name: string;
  intent: string;
  exerciseCount: number;
};

export type WeeklyProgramInputs = {
  daysPerWeek: number | null;
  trainingAge: TrainingAge;
  templates: WeeklyProgramTemplateSummary[];
  sessions: WeeklyProgramSessionInput[];
};

export async function loadWeeklyProgramInputs(
  userId: string,
  options?: { templateIds?: string[] }
): Promise<WeeklyProgramInputs> {
  const [profile, constraints, templates] = await Promise.all([
    prisma.profile.findUnique({
      where: { userId },
      select: { trainingAge: true },
    }),
    prisma.constraints.findUnique({
      where: { userId },
      select: { daysPerWeek: true },
    }),
    prisma.workoutTemplate.findMany({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      include: {
        exercises: {
          orderBy: { orderIndex: "asc" },
          include: {
            exercise: {
              select: {
                isMainLiftEligible: true,
                movementPatterns: true,
                exerciseMuscles: {
                  select: {
                    role: true,
                    muscle: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const trainingAge = (profile?.trainingAge.toLowerCase() ?? "intermediate") as TrainingAge;
  const selectedTemplates = selectTemplates(templates, constraints?.daysPerWeek, options?.templateIds);

  const summaries: WeeklyProgramTemplateSummary[] = selectedTemplates.map((template) => ({
    id: template.id,
    name: template.name,
    intent: template.intent,
    exerciseCount: template.exercises.length,
  }));

  const sessions: WeeklyProgramSessionInput[] = selectedTemplates.map((template) => {
    const mainLiftIndexes = resolveMainLiftIndexes(template.exercises);
    return {
      sessionId: template.id,
      exercises: template.exercises.map((entry, index) => {
        const isMainLift = mainLiftIndexes.has(index);
        const setCount = resolveSetCount(
          isMainLift,
          trainingAge,
          DEFAULT_FATIGUE_STATE
        );

        return {
          movementPatterns: (entry.exercise.movementPatterns ?? []).map((pattern) =>
            pattern.toLowerCase()
          ),
          muscles: entry.exercise.exerciseMuscles.map((muscle) => ({
            name: muscle.muscle.name,
            role: muscle.role.toLowerCase() as "primary" | "secondary",
          })),
          setCount,
        };
      }),
    };
  });

  return {
    daysPerWeek: constraints?.daysPerWeek ?? null,
    trainingAge,
    templates: summaries,
    sessions,
  };
}

function resolveMainLiftIndexes<
  T extends { orderIndex: number; exercise: { isMainLiftEligible?: boolean | null } }
>(entries: T[], slotCap = TEMPLATE_MAIN_LIFT_SLOT_CAP): Set<number> {
  if (slotCap <= 0 || entries.length === 0) {
    return new Set<number>();
  }

  const eligible = entries
    .map((entry, index) => ({
      index,
      orderIndex: entry.orderIndex,
      eligible: entry.exercise.isMainLiftEligible ?? false,
    }))
    .filter((entry) => entry.eligible)
    .sort((a, b) => {
      if (a.orderIndex !== b.orderIndex) {
        return a.orderIndex - b.orderIndex;
      }
      return a.index - b.index;
    });

  return new Set(eligible.slice(0, slotCap).map((entry) => entry.index));
}

function selectTemplates<T extends { id: string }>(
  templates: T[],
  daysPerWeek: number | null | undefined,
  templateIds: string[] | undefined
): T[] {
  if (!templateIds || templateIds.length === 0) {
    const limit = daysPerWeek && daysPerWeek > 0 ? daysPerWeek : templates.length;
    return templates.slice(0, limit);
  }

  const dedupedIds = Array.from(new Set(templateIds));
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const selected = dedupedIds
    .map((id) => templateById.get(id))
    .filter((template): template is T => Boolean(template));

  return selected;
}
