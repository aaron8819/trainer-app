import { NextRequest, NextResponse } from "next/server";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { prisma } from "@/lib/db/prisma";
import { generateMacroSchema } from "@/lib/validation";
import { generateMacroCycle } from "@/lib/engine";
import { resolveOwner } from "@/lib/api/workout-context";
import { Prisma } from "@prisma/client";

/**
 * POST /api/periodization/macro
 * Generate a new macro cycle for the authenticated user.
 */
export async function POST(request: NextRequest) {
  const paused = productionWritePauseResponse("mesocycle_acceptance", "/api/periodization/macro");
  if (paused) return paused;

  const user = await resolveOwner();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validation = generateMacroSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.error.format() },
      { status: 400 }
    );
  }

  const { startDate, durationWeeks, trainingAge, primaryGoal } = validation.data;

  // Get user's profile and goals if not provided
  const userWithProfile = await prisma.user.findUnique({
    where: { id: user.id },
    include: { profile: true, goals: true },
  });

  if (!userWithProfile) {
    return NextResponse.json({ error: "User profile not found" }, { status: 404 });
  }

  // Use provided values or fall back to user's profile/goals
  const effectiveTrainingAge = trainingAge
    ? trainingAge.toLowerCase() as "beginner" | "intermediate" | "advanced"
    : userWithProfile.profile?.trainingAge.toLowerCase() as "beginner" | "intermediate" | "advanced";

  const effectivePrimaryGoal = primaryGoal
    ? primaryGoal.toLowerCase() as
        | "hypertrophy"
        | "strength"
        | "strength_hypertrophy"
        | "fat_loss"
        | "athleticism"
        | "general_health"
    : userWithProfile.goals?.primaryGoal.toLowerCase() as
        | "hypertrophy"
        | "strength"
        | "strength_hypertrophy"
        | "fat_loss"
        | "athleticism"
        | "general_health";

  if (!effectiveTrainingAge || !effectivePrimaryGoal) {
    return NextResponse.json(
      { error: "Training age and primary goal required (either provided or in user profile)" },
      { status: 400 }
    );
  }

  // Generate macro cycle using engine
  const macro = generateMacroCycle({
    userId: user.id,
    startDate,
    durationWeeks,
    trainingAge: effectiveTrainingAge,
    primaryGoal: effectivePrimaryGoal,
  });

  // Create macro cycle in database with nested structures
  let created: Prisma.MacroCycleGetPayload<{
    include: { mesocycles: { include: { blocks: true } } };
  }>;
  try {
    created = await prisma.$transaction(async (tx) => {
    const currentOwner = await tx.user.findUnique({
      where: { id: user.id },
      select: { activeMacroCycleId: true },
    });
    if (!currentOwner) {
      throw new Error("ACTIVE_PLAN_OWNER_NOT_FOUND");
    }
    const shouldSelect =
      currentOwner.activeMacroCycleId === null && macro.mesocycles.length > 0;

    const createdMacroCycle = await tx.macroCycle.create({
      data: {
        id: macro.id,
        userId: macro.userId,
        startDate: macro.startDate,
        endDate: macro.endDate,
        durationWeeks: macro.durationWeeks,
        trainingAge: effectiveTrainingAge.toUpperCase() as "BEGINNER" | "INTERMEDIATE" | "ADVANCED",
        primaryGoal:
          macro.primaryGoal === "general_fitness"
            ? "GENERAL_HEALTH"
            : (macro.primaryGoal.toUpperCase() as
                | "HYPERTROPHY"
                | "STRENGTH"
                | "STRENGTH_HYPERTROPHY"
                | "FAT_LOSS"
                | "ATHLETICISM"
                | "GENERAL_HEALTH"),
        mesocycles: {
          create: macro.mesocycles.map((meso, index) => ({
            id: meso.id,
            mesoNumber: meso.mesoNumber,
            startWeek: meso.startWeek,
            durationWeeks: meso.durationWeeks,
            focus: meso.focus,
            volumeTarget: meso.volumeTarget.toUpperCase() as "LOW" | "MODERATE" | "HIGH" | "PEAK",
            intensityBias: meso.intensityBias.toUpperCase() as "STRENGTH" | "HYPERTROPHY" | "ENDURANCE",
            isActive: shouldSelect && index === 0,
            blocks: {
              create: meso.blocks.map((block) => ({
                id: block.id,
                blockNumber: block.blockNumber,
                blockType: block.blockType.toUpperCase() as "ACCUMULATION" | "INTENSIFICATION" | "REALIZATION" | "DELOAD",
                startWeek: block.startWeek,
                durationWeeks: block.durationWeeks,
                volumeTarget: block.volumeTarget.toUpperCase() as "LOW" | "MODERATE" | "HIGH" | "PEAK",
                intensityBias: block.intensityBias.toUpperCase() as "STRENGTH" | "HYPERTROPHY" | "ENDURANCE",
                adaptationType: block.adaptationType.toUpperCase() as
                  | "NEURAL_ADAPTATION"
                  | "MYOFIBRILLAR_HYPERTROPHY"
                  | "SARCOPLASMIC_HYPERTROPHY"
                  | "WORK_CAPACITY"
                  | "RECOVERY",
              })),
            },
          })),
        },
      },
      include: {
        mesocycles: {
          include: {
            blocks: true,
          },
        },
      },
    });

    if (shouldSelect) {
      const selected = await tx.user.updateMany({
        where: { id: user.id, activeMacroCycleId: null },
        data: { activeMacroCycleId: createdMacroCycle.id },
      });
      if (selected.count !== 1) {
        throw new Error("ACTIVE_PLAN_SELECTION_CONFLICT");
      }
    }

    return createdMacroCycle;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    const isSelectionConflict =
      (error instanceof Error && error.message === "ACTIVE_PLAN_SELECTION_CONFLICT") ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034"));
    if (isSelectionConflict) {
      return NextResponse.json(
        { error: "Active plan selection changed concurrently. Retry the request." },
        { status: 409 }
      );
    }
    throw error;
  }

  return NextResponse.json({ macro: created }, { status: 201 });
}
