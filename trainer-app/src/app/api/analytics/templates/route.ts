import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveUser } from "@/lib/api/workout-context";
import { WorkoutStatus } from "@prisma/client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") ?? undefined;

  const user = await resolveUser(userId);
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
    { total: number; completed: number; lastUsed: Date | null; dates: Date[] }
  >();

  for (const w of workouts) {
    if (!w.templateId) continue;
    if (!grouped.has(w.templateId)) {
      grouped.set(w.templateId, { total: 0, completed: 0, lastUsed: null, dates: [] });
    }
    const g = grouped.get(w.templateId)!;
    g.total++;
    if (w.status === WorkoutStatus.COMPLETED) g.completed++;
    if (!g.lastUsed || w.scheduledDate > g.lastUsed) g.lastUsed = w.scheduledDate;
    g.dates.push(w.scheduledDate);
  }

  const result = Array.from(grouped.entries()).map(([templateId, data]) => {
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
      totalWorkouts: data.total,
      completedWorkouts: data.completed,
      completionRate: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
      lastUsed: data.lastUsed?.toISOString() ?? null,
      avgFrequencyDays,
    };
  });

  return NextResponse.json({ templates: result });
}
