import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const readiness = Number(body.readiness);

    if (!Number.isFinite(readiness) || readiness < 1 || readiness > 5) {
      return NextResponse.json({ error: "Invalid readiness" }, { status: 400 });
    }

    const user = await resolveOwner();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const painFlags =
      body.painFlags && typeof body.painFlags === "object"
        ? (body.painFlags as Record<string, number>)
        : undefined;
    const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;

    const checkIn = await prisma.sessionCheckIn.create({
      data: {
        userId: user.id,
        date: new Date(),
        readiness,
        painFlags,
        notes: notes && notes.length > 0 ? notes : undefined,
      },
    });

    return NextResponse.json({
      id: checkIn.id,
      readiness: checkIn.readiness,
      painFlags: checkIn.painFlags ?? undefined,
      date: checkIn.date,
    });
  } catch (error) {
    console.error("Failed to create session check-in", error);
    const message =
      process.env.NODE_ENV === "production"
        ? "Failed to create session check-in"
        : error instanceof Error
        ? error.message
        : "Failed to create session check-in";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
