import { WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { deriveNextAdvancingSession } from "./mesocycle-lifecycle-math";

type MesoSessionInput = {
  durationWeeks: number;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  sessionsPerWeek: number;
  state: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "COMPLETED";
};

export type NextWorkoutSource = "existing_incomplete" | "rotation";

export type NextWorkoutContext = {
  intent: string | null;
  existingWorkoutId: string | null;
  isExisting: boolean;
  source: NextWorkoutSource;
  weekInMeso: number | null;
  sessionInWeek: number | null;
  derivationTrace: string[];
  selectedIncompleteStatus: string | null;
};

type IncompleteWorkoutCandidate = {
  id: string;
  status: string;
  scheduledDate: Date;
  sessionIntent: string | null;
};

const INCOMPLETE_STATUSES: WorkoutStatus[] = [
  "IN_PROGRESS",
  "PARTIAL",
  "PLANNED",
];
const STATUS_PRIORITY: Record<string, number> = {
  IN_PROGRESS: 0,
  PARTIAL: 1,
  PLANNED: 2,
};

function normalizeWeeklySchedule(
  weeklySchedule: string[]
): string[] {
  return weeklySchedule
    .map((intent) => intent.trim().toLowerCase())
    .filter((intent) => intent.length > 0);
}

function pickTopIncompleteWorkout(
  workouts: IncompleteWorkoutCandidate[]
): IncompleteWorkoutCandidate | null {
  return [...workouts].sort((left, right) => {
    const leftPriority = STATUS_PRIORITY[left.status] ?? 3;
    const rightPriority = STATUS_PRIORITY[right.status] ?? 3;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return left.scheduledDate.getTime() - right.scheduledDate.getTime();
  })[0] ?? null;
}

export function resolveNextWorkoutContext(input: {
  mesocycle: MesoSessionInput | null;
  weeklySchedule: string[];
  incompleteWorkouts: IncompleteWorkoutCandidate[];
}): NextWorkoutContext {
  const normalizedSchedule = normalizeWeeklySchedule(input.weeklySchedule);
  const topIncomplete = pickTopIncompleteWorkout(input.incompleteWorkouts);
  const trace: string[] = [
    `normalized_schedule_count=${normalizedSchedule.length}`,
    `incomplete_candidates=${input.incompleteWorkouts.length}`,
  ];

  const derived = input.mesocycle
    ? deriveNextAdvancingSession(input.mesocycle, normalizedSchedule)
    : null;
  if (derived) {
    trace.push(
      `derived_rotation intent=${derived.intent ?? "null"} week=${derived.week} session=${derived.session}`
    );
  } else {
    trace.push("no_active_mesocycle");
  }

  if (topIncomplete) {
    trace.push(`selected_incomplete id=${topIncomplete.id} status=${topIncomplete.status}`);
    return {
      intent: topIncomplete.sessionIntent?.toLowerCase() ?? null,
      existingWorkoutId: topIncomplete.id,
      isExisting: true,
      source: "existing_incomplete",
      // Rotation week/session describe advancing generation context, not resume-workout context.
      weekInMeso: null,
      sessionInWeek: null,
      derivationTrace: trace,
      selectedIncompleteStatus: topIncomplete.status.toLowerCase(),
    };
  }

  const fallbackIntent = derived?.intent ?? normalizedSchedule[0] ?? null;
  trace.push(
    derived
      ? `selected_rotation_intent=${fallbackIntent ?? "null"}`
      : `selected_schedule_fallback_intent=${fallbackIntent ?? "null"}`
  );
  return {
    intent: fallbackIntent,
    existingWorkoutId: null,
    isExisting: false,
    source: "rotation",
    weekInMeso: derived?.week ?? null,
    sessionInWeek: derived?.session ?? null,
    derivationTrace: trace,
    selectedIncompleteStatus: null,
  };
}

export async function loadNextWorkoutContext(
  userId: string
): Promise<NextWorkoutContext> {
  const [mesocycle, constraints, rawIncomplete] = await Promise.all([
    prisma.mesocycle.findFirst({
      where: { macroCycle: { userId }, isActive: true },
      select: {
        durationWeeks: true,
        accumulationSessionsCompleted: true,
        deloadSessionsCompleted: true,
        sessionsPerWeek: true,
        state: true,
      },
    }),
    prisma.constraints.findUnique({
      where: { userId },
      select: { weeklySchedule: true },
    }),
    prisma.workout.findMany({
      where: { userId, status: { in: INCOMPLETE_STATUSES } },
      orderBy: { scheduledDate: "asc" },
      take: 20,
      select: { id: true, sessionIntent: true, status: true, scheduledDate: true },
    }),
  ]);

  return resolveNextWorkoutContext({
    mesocycle,
    weeklySchedule: (constraints?.weeklySchedule ?? []).map((intent) => intent as string),
    incompleteWorkouts: rawIncomplete.map((workout) => ({
      id: workout.id,
      status: workout.status,
      scheduledDate: workout.scheduledDate,
      sessionIntent: workout.sessionIntent?.toLowerCase() ?? null,
    })),
  });
}
