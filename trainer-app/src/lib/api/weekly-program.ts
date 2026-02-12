import { prisma } from "@/lib/db/prisma";
import { resolveSetCount } from "@/lib/engine/prescription";
import type { FatigueState, TrainingAge } from "@/lib/engine/types";
import type { WeeklyProgramSessionInput } from "@/lib/engine/weekly-program-analysis";
import { WorkoutStatus, type WorkoutSessionIntent } from "@prisma/client";
import {
  pickTemplateForSessionIntent,
  selectTemplatesForWeeklyProgram,
} from "./weekly-program-selection";

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
  options?: { templateIds?: string[]; weeklySchedule?: WorkoutSessionIntent[] }
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
  const selectedTemplates = selectTemplatesForWeeklyProgram(
    templates,
    constraints?.daysPerWeek,
    options?.templateIds,
    options?.weeklySchedule
  );

  const summaries: WeeklyProgramTemplateSummary[] = selectedTemplates.map((template) => ({
    id: template.id,
    name: template.name,
    intent: template.intent,
    exerciseCount: template.exercises.length,
  }));

  const sessions: WeeklyProgramSessionInput[] = selectedTemplates.map((template) => {
    return mapTemplateToSessionInput(template, trainingAge);
  });

  if (options?.weeklySchedule && options.weeklySchedule.length > 0) {
    const intentHistory = await prisma.workout.findMany({
      where: {
        userId,
        status: WorkoutStatus.COMPLETED,
        sessionIntent: { not: null },
      },
      orderBy: [{ completedAt: "desc" }, { scheduledDate: "desc" }],
      take: 30,
      include: {
        exercises: {
          orderBy: { orderIndex: "asc" },
          include: {
            exercise: {
              select: {
                movementPatterns: true,
                exerciseMuscles: {
                  select: {
                    role: true,
                    muscle: { select: { name: true } },
                  },
                },
              },
            },
            sets: {
              include: {
                logs: {
                  orderBy: { completedAt: "desc" },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    const historyByIntent = new Map<
      WorkoutSessionIntent,
      WeeklyProgramSessionInput[]
    >();
    for (const workout of intentHistory) {
      if (!workout.sessionIntent) {
        continue;
      }
      const entry = mapWorkoutToSessionInput(workout.id, workout.exercises);
      if (entry.exercises.length === 0) {
        continue;
      }
      const current = historyByIntent.get(workout.sessionIntent) ?? [];
      current.push(entry);
      historyByIntent.set(workout.sessionIntent, current);
    }

    const templateById = new Map(selectedTemplates.map((template) => [template.id, template]));
    const usedTemplateIds = new Set<string>();
    const historyCursorByIntent = new Map<WorkoutSessionIntent, number>();
    const scheduleSessions: WeeklyProgramSessionInput[] = [];

    for (const sessionIntent of options.weeklySchedule) {
      const template = pickTemplateForSessionIntent(selectedTemplates, sessionIntent, usedTemplateIds);
      if (template) {
        usedTemplateIds.add(template.id);
        const mapped = templateById.get(template.id);
        if (mapped) {
          scheduleSessions.push(mapTemplateToSessionInput(mapped, trainingAge));
          continue;
        }
      }

      const historyCandidates = historyByIntent.get(sessionIntent) ?? [];
      if (historyCandidates.length > 0) {
        const cursor = historyCursorByIntent.get(sessionIntent) ?? 0;
        const selected = historyCandidates[cursor % historyCandidates.length];
        historyCursorByIntent.set(sessionIntent, cursor + 1);
        scheduleSessions.push(selected);
      }
    }

    if (scheduleSessions.length > 0) {
      return {
        daysPerWeek: constraints?.daysPerWeek ?? null,
        trainingAge,
        templates: summaries,
        sessions: scheduleSessions,
      };
    }
  }

  return {
    daysPerWeek: constraints?.daysPerWeek ?? null,
    trainingAge,
    templates: summaries,
    sessions,
  };
}

type TemplateExerciseEntry = {
  orderIndex: number;
  exercise: {
    isMainLiftEligible?: boolean | null;
    movementPatterns: string[];
    exerciseMuscles: {
      role: string;
      muscle: { name: string };
    }[];
  };
};

function mapTemplateToSessionInput(
  template: { id: string; exercises: TemplateExerciseEntry[] },
  trainingAge: TrainingAge
): WeeklyProgramSessionInput {
  const mainLiftIndexes = resolveMainLiftIndexes(template.exercises);
  return {
    sessionId: template.id,
    exercises: template.exercises.map((entry, index) => {
      const isMainLift = mainLiftIndexes.has(index);
      const setCount = resolveSetCount(isMainLift, trainingAge, DEFAULT_FATIGUE_STATE);

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
}

function mapWorkoutToSessionInput(
  workoutId: string,
  exercises: Array<{
    exercise: {
      movementPatterns: string[];
      exerciseMuscles: {
        role: string;
        muscle: { name: string };
      }[];
    };
    sets: Array<{ logs: Array<{ wasSkipped: boolean | null }> }>;
  }>
): WeeklyProgramSessionInput {
  return {
    sessionId: workoutId,
    exercises: exercises.map((entry) => {
      const completedSetCount = entry.sets.filter((set) => {
        if (set.logs.length === 0) {
          return true;
        }
        return set.logs[0]?.wasSkipped !== true;
      }).length;

      return {
        movementPatterns: (entry.exercise.movementPatterns ?? []).map((pattern) =>
          pattern.toLowerCase()
        ),
        muscles: entry.exercise.exerciseMuscles.map((muscle) => ({
          name: muscle.muscle.name,
          role: muscle.role.toLowerCase() as "primary" | "secondary",
        })),
        setCount: completedSetCount,
      };
    }),
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

