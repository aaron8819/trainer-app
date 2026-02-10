import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { preferencesSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { normalizeName } from "@/lib/engine/utils";

function dedupeNames(values: string[] | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const normalized = normalizeName(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(value.trim());
  }
  return result;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = preferencesSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const favoriteExercises = dedupeNames(parsed.data.favoriteExercises);
  const avoidExercisesRaw = dedupeNames(parsed.data.avoidExercises);
  const favoriteNameSet = new Set(favoriteExercises.map((name) => normalizeName(name)));
  const avoidExercises = avoidExercisesRaw.filter(
    (name) => !favoriteNameSet.has(normalizeName(name))
  );

  const exerciseLookup = await prisma.exercise.findMany({
    where: {
      name: {
        in: [...favoriteExercises, ...avoidExercises],
      },
    },
    select: { id: true, name: true },
  });

  const idByNormalizedName = new Map(
    exerciseLookup.map((exercise) => [normalizeName(exercise.name), exercise.id])
  );

  const favoriteExerciseIds = favoriteExercises
    .map((name) => idByNormalizedName.get(normalizeName(name)))
    .filter((id): id is string => Boolean(id));

  const avoidExerciseIds = avoidExercises
    .map((name) => idByNormalizedName.get(normalizeName(name)))
    .filter((id): id is string => Boolean(id))
    .filter((id) => !favoriteExerciseIds.includes(id));

  const payload = {
    favoriteExercises,
    avoidExercises,
    favoriteExerciseIds,
    avoidExerciseIds,
    rpeTargets: parsed.data.rpeTargets ?? [],
    progressionStyle: parsed.data.progressionStyle ?? null,
    optionalConditioning: parsed.data.optionalConditioning ?? true,
    benchFrequency: parsed.data.benchFrequency ?? null,
    squatFrequency: parsed.data.squatFrequency ?? null,
    deadliftFrequency: parsed.data.deadliftFrequency ?? null,
  };

  const record = await prisma.userPreference.upsert({
    where: { userId: user.id },
    update: payload,
    create: { userId: user.id, ...payload },
  });

  return NextResponse.json({ status: "saved", preferences: record });
}
