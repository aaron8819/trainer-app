import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toggleFavoriteSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = toggleFavoriteSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const exercise = await prisma.exercise.findUnique({ where: { id } });
  if (!exercise) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }

  const prefs = await prisma.userPreference.findUnique({
    where: { userId: user.id },
  });

  const currentFavorites = prefs?.favoriteExercises ?? [];
  const currentAvoids = prefs?.avoidExercises ?? [];
  const isFavorite = currentFavorites.includes(exercise.name);

  const newFavorites = isFavorite
    ? currentFavorites.filter((n) => n !== exercise.name)
    : [...currentFavorites, exercise.name];

  // Mutual exclusion: remove from avoids if adding to favorites
  const newAvoids = isFavorite
    ? currentAvoids
    : currentAvoids.filter((n) => n !== exercise.name);

  await prisma.userPreference.upsert({
    where: { userId: user.id },
    update: { favoriteExercises: newFavorites, avoidExercises: newAvoids },
    create: {
      userId: user.id,
      favoriteExercises: newFavorites,
      avoidExercises: newAvoids,
    },
  });

  return NextResponse.json({
    isFavorite: !isFavorite,
    isAvoided: false,
  });
}
