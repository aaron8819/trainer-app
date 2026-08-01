import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { findOwnerReadOnly } from "@/lib/api/workout-context";

export async function GET() {
  const owner = await findOwnerReadOnly();
  if (!owner) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const mesocycles = await prisma.mesocycle.findMany({
    where: { macroCycle: { userId: owner.id } },
    include: {
      macroCycle: { select: { startDate: true } },
    },
    orderBy: [{ isActive: "desc" }, { macroCycle: { startDate: "desc" } }],
  });

  const items = mesocycles.map((meso) => {
    const macroStart = meso.macroCycle.startDate.getTime();
    const startDate = new Date(macroStart + meso.startWeek * 7 * 24 * 60 * 60 * 1000);
    return {
      id: meso.id,
      startDate: startDate.toISOString(),
      state: meso.state,
      durationWeeks: meso.durationWeeks,
      splitType: meso.splitType as string | null,
      isActive: meso.isActive,
    };
  });

  return NextResponse.json({ mesocycles: items });
}
