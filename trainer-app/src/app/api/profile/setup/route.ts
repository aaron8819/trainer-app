import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { profileSetupSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { loadWeeklyProgramInputs } from "@/lib/api/weekly-program";
import { analyzeWeeklyProgram } from "@/lib/engine/weekly-program-analysis";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = profileSetupSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const user = parsed.data.email
    ? await prisma.user.upsert({
        where: { email: parsed.data.email },
        update: {},
        create: { email: parsed.data.email },
      })
    : await resolveOwner();

  await prisma.$transaction(async (tx) => {
    const heightIn = parsed.data.heightIn ?? null;
    const weightLb = parsed.data.weightLb ?? null;

    await tx.profile.upsert({
      where: { userId: user.id },
      update: {
        age: parsed.data.age ?? null,
        sex: parsed.data.sex ?? null,
        heightIn,
        weightLb,
        trainingAge: parsed.data.trainingAge,
      },
      create: {
        userId: user.id,
        age: parsed.data.age ?? null,
        sex: parsed.data.sex ?? null,
        heightIn,
        weightLb,
        trainingAge: parsed.data.trainingAge,
      },
    });

    await tx.goals.upsert({
      where: { userId: user.id },
      update: {
        primaryGoal: parsed.data.primaryGoal,
        secondaryGoal: parsed.data.secondaryGoal,
      },
      create: {
        userId: user.id,
        primaryGoal: parsed.data.primaryGoal,
        secondaryGoal: parsed.data.secondaryGoal,
      },
    });

    await tx.constraints.upsert({
      where: { userId: user.id },
      update: {
        daysPerWeek: parsed.data.daysPerWeek,
        sessionMinutes: parsed.data.sessionMinutes,
        ...(parsed.data.splitType ? { splitType: parsed.data.splitType } : {}),
      },
      create: {
        userId: user.id,
        daysPerWeek: parsed.data.daysPerWeek,
        sessionMinutes: parsed.data.sessionMinutes,
        splitType: parsed.data.splitType ?? "CUSTOM",
      },
    });

    if (parsed.data.injuryBodyPart) {
      const existing = await tx.injury.findFirst({
        where: { userId: user.id, bodyPart: parsed.data.injuryBodyPart },
      });

      if (existing) {
        await tx.injury.update({
          where: { id: existing.id },
          data: {
            severity: parsed.data.injurySeverity ?? existing.severity,
            description: parsed.data.injuryDescription ?? existing.description,
            isActive: parsed.data.injuryActive ?? true,
          },
        });
      } else {
        await tx.injury.create({
          data: {
            userId: user.id,
            bodyPart: parsed.data.injuryBodyPart,
            severity: parsed.data.injurySeverity ?? 2,
            description: parsed.data.injuryDescription ?? null,
            isActive: parsed.data.injuryActive ?? true,
          },
        });
      }
    } else if (parsed.data.injuryActive === false) {
      await tx.injury.updateMany({
        where: { userId: user.id, isActive: true },
        data: { isActive: false },
      });
    }
  });

  const weeklyProgramInputs = await loadWeeklyProgramInputs(user.id, {
    weeklySchedule: parsed.data.weeklySchedule,
  });
  const weeklyAnalysis = analyzeWeeklyProgram(weeklyProgramInputs.sessions);

  return NextResponse.json({
    status: "saved",
    userId: user.id,
    weeklySchedule: parsed.data.weeklySchedule ?? [],
    weeklyAnalysis,
  });
}
