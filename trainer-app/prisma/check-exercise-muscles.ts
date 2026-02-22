import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { VOLUME_LANDMARKS } from "../src/lib/engine/volume-landmarks";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const KEY_EXERCISE_NAMES = [
  "Barbell Back Squat",
  "Leg Press",
  "Romanian Deadlift",
  "Seated Leg Curl",
  "Standing Calf Raise",
  "Seated Calf Raise",
];

function logExerciseMuscles(
  exercises: Array<{
    name: string;
    exerciseMuscles: Array<{ role: string; muscle: { name: string } }>;
  }>,
  heading: string
) {
  console.log(`\n=== ${heading} ===`);
  if (exercises.length === 0) {
    console.log("No exercises found.");
    return;
  }

  const sorted = [...exercises].sort((a, b) => a.name.localeCompare(b.name));
  for (const exercise of sorted) {
    const mappings = [...exercise.exerciseMuscles].sort((a, b) => {
      const byName = a.muscle.name.localeCompare(b.muscle.name);
      if (byName !== 0) return byName;
      return a.role.localeCompare(b.role);
    });

    console.log(`\nExercise: ${exercise.name}`);
    console.log(`ExerciseMuscle records: ${mappings.length}`);
    for (const mapping of mappings) {
      console.log(`- ${mapping.muscle.name} (${mapping.role})`);
    }
  }
}

async function main() {
  const user =
    (await prisma.user.findFirst({
      where: { email: { not: { endsWith: "@test.com" } } },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true },
    })) ??
    (await prisma.user.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true },
    }));

  if (!user) {
    throw new Error("No user found.");
  }

  console.log(`Using user: ${user.email ?? "(no email)"} (${user.id})`);

  const keyExercises = await prisma.exercise.findMany({
    where: { name: { in: KEY_EXERCISE_NAMES } },
    include: { exerciseMuscles: { include: { muscle: true } } },
  });

  logExerciseMuscles(keyExercises, "Key Exercise Muscle Mappings");

  const foundNames = new Set(keyExercises.map((exercise) => exercise.name));
  const missingNamed = KEY_EXERCISE_NAMES.filter((name) => !foundNames.has(name));
  if (missingNamed.length > 0) {
    console.log("\nMissing requested exercises:");
    for (const name of missingNamed) {
      console.log(`- ${name}`);
    }
  }

  const pullPushTemplates = await prisma.workoutTemplate.findMany({
    where: {
      userId: user.id,
      OR: [
        { name: { contains: "Pull", mode: "insensitive" } },
        { name: { contains: "Push", mode: "insensitive" } },
      ],
    },
    include: {
      exercises: {
        orderBy: { orderIndex: "asc" },
        include: {
          exercise: {
            include: {
              exerciseMuscles: { include: { muscle: true } },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  console.log("\n=== Pull/Push Templates ===");
  if (pullPushTemplates.length === 0) {
    console.log("No Pull/Push templates found for this user.");
  } else {
    for (const template of pullPushTemplates) {
      console.log(`\nTemplate: ${template.name} (${template.id})`);
      if (template.exercises.length === 0) {
        console.log("No template exercises.");
        continue;
      }

      for (const entry of template.exercises) {
        const exercise = entry.exercise;
        const mappings = [...exercise.exerciseMuscles].sort((a, b) => {
          const byName = a.muscle.name.localeCompare(b.muscle.name);
          if (byName !== 0) return byName;
          return a.role.localeCompare(b.role);
        });

        console.log(`\nExercise: ${exercise.name}`);
        console.log(`ExerciseMuscle records: ${mappings.length}`);
        for (const mapping of mappings) {
          console.log(`- ${mapping.muscle.name} (${mapping.role})`);
        }
      }
    }
  }

  const landmarkKeys = Object.keys(VOLUME_LANDMARKS);
  const dbMuscles = await prisma.muscle.findMany({
    select: { name: true },
    orderBy: { name: "asc" },
  });
  const dbMuscleSet = new Set(dbMuscles.map((muscle) => muscle.name));
  const missingInDb = landmarkKeys.filter((name) => !dbMuscleSet.has(name));

  console.log("\n=== VOLUME_LANDMARKS vs DB Muscle Names ===");
  console.log(`Landmark keys: ${landmarkKeys.length}`);
  console.log(`DB muscles: ${dbMuscles.length}`);
  if (missingInDb.length === 0) {
    console.log("Exact case-sensitive match for all VOLUME_LANDMARKS keys: YES");
  } else {
    console.log("Exact case-sensitive match for all VOLUME_LANDMARKS keys: NO");
    console.log("Landmark keys missing from DB muscles:");
    for (const name of missingInDb) {
      console.log(`- ${name}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
