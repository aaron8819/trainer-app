import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import {
  buildAllTimeAnalyticsWindow,
  countAnalyticsWorkoutStatuses,
} from "@/lib/api/analytics-semantics";

export async function GET() {

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const templates = await prisma.workoutTemplate.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
    },
  });

  const workouts = await prisma.workout.findMany({
    where: {
      userId: user.id,
      templateId: { not: null },
    },
    select: {
      templateId: true,
      status: true,
      scheduledDate: true,
    },
    orderBy: { scheduledDate: "desc" },
  });

  const templateMap = new Map(templates.map((t) => [t.id, t.name]));

  const grouped = new Map<
    string,
    { statuses: string[]; lastUsed: Date | null; dates: Date[] }
  >();

  for (const w of workouts) {
    if (!w.templateId) continue;
    if (!grouped.has(w.templateId)) {
      grouped.set(w.templateId, { statuses: [], lastUsed: null, dates: [] });
    }
    const g = grouped.get(w.templateId)!;
    g.statuses.push(w.status);
    if (!g.lastUsed || w.scheduledDate > g.lastUsed) g.lastUsed = w.scheduledDate;
    g.dates.push(w.scheduledDate);
  }

  const result = Array.from(grouped.entries()).map(([templateId, data]) => {
    const counts = countAnalyticsWorkoutStatuses(data.statuses);
    const sorted = data.dates.sort((a, b) => a.getTime() - b.getTime());
    let avgFrequencyDays: number | null = null;
    if (sorted.length >= 2) {
      const totalDays =
        (sorted[sorted.length - 1].getTime() - sorted[0].getTime()) / (1000 * 60 * 60 * 24);
      avgFrequencyDays = Math.round((totalDays / (sorted.length - 1)) * 10) / 10;
    }

    return {
      templateId,
      templateName: templateMap.get(templateId) ?? "Unknown",
      generatedWorkouts: counts.generated,
      performedWorkouts: counts.performed,
      completedWorkouts: counts.completed,
      performedRate:
        counts.performedRate !== null ? Math.round(counts.performedRate * 100) : null,
      completionRate:
        counts.completionRate !== null ? Math.round(counts.completionRate * 100) : null,
      lastUsed: data.lastUsed?.toISOString() ?? null,
      avgFrequencyDays,
    };
  });

  return NextResponse.json({
    semantics: {
      window: buildAllTimeAnalyticsWindow(
        "Template usage counts all generated workouts for the current owner."
      ),
      counts: {
        generated: "Generated workouts include every workout created from a template.",
        performed:
          "Performed workouts include template workouts saved as COMPLETED or PARTIAL.",
        completed: "Completed workouts include only template workouts saved as COMPLETED.",
      },
    },
    templates: result,
  });
}
