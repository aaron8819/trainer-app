import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import {
  parseExactDisposableConfirmationArgs,
  sanitizeDatabaseTargetEnvironment,
  validateDisposableDatabaseTargets,
} from "../src/lib/operations/test-environment-preflight";

const containerName = `trainer-v4-custom-plan-${process.pid}-${randomUUID().slice(0, 8)}`;
const postgresUser = "trainer";
const postgresPassword = "trainer-v4-custom-plan";
const postgresDatabase = "trainer";

function command(
  executable: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; quiet?: boolean } = {},
): string {
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      `${executable} ${args.join(" ")} failed status=${result.status}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return (result.stdout ?? "").trim();
}

async function waitForPostgres(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = spawnSync(
      "docker",
      [
        "exec",
        "-i",
        containerName,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        postgresUser,
        "-d",
        postgresDatabase,
        "-tAc",
        "SELECT 1",
      ],
      { stdio: "ignore" },
    );
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("DISPOSABLE_POSTGRES_DID_NOT_BECOME_READY");
}

async function main(): Promise<void> {
  const invocation = parseExactDisposableConfirmationArgs(process.argv.slice(2));
  if (!invocation.valid) {
    console.error(invocation.message);
    process.exit(2);
  }

  let closeAppResources: (() => Promise<void>) | undefined;

  try {
  command(
    "docker",
    [
      "run",
      "--rm",
      "-d",
      "--name",
      containerName,
      "-e",
      `POSTGRES_USER=${postgresUser}`,
      "-e",
      `POSTGRES_PASSWORD=${postgresPassword}`,
      "-e",
      `POSTGRES_DB=${postgresDatabase}`,
      "-p",
      "127.0.0.1::5432",
      "postgres:16-alpine",
    ],
    { quiet: true },
  );
  await waitForPostgres();
  const portOutput = command(
    "docker",
    ["port", containerName, "5432/tcp"],
    { quiet: true },
  );
  const port = portOutput.match(/:(\d+)$/)?.[1];
  assert(port, `DISPOSABLE_POSTGRES_PORT_NOT_FOUND output=${portOutput}`);
  const databaseUrl =
    `postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:${port}/${postgresDatabase}`;
  const env: NodeJS.ProcessEnv = {
    ...sanitizeDatabaseTargetEnvironment(process.env),
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    TRAINER_DISPOSABLE_DB_CONFIRMED: "1",
    NODE_ENV: "test",
    OWNER_EMAIL: "v4-reference@test.local",
  };
  const targetValidation = validateDisposableDatabaseTargets({
    environment: env,
    confirmed: true,
  });
  assert(targetValidation.valid, "V4_CUSTOM_PLAN_DB_TEST_TARGET_INVALID");
  Object.assign(process.env, env);

  command(
    process.execPath,
    [
      join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
      "migrate",
      "deploy",
    ],
    { env },
  );
  command(
    process.execPath,
    [
      join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
      "prisma/seed.ts",
      "--confirm-disposable",
    ],
    { env },
  );

  const dbModule = await import("@/lib/db/prisma");
  const draftsModule = await import("@/lib/api/hypertrophy-plan-drafts");
  const authoringModule = await import("@/lib/engine/hypertrophy-plan-authoring");
  const planModule = await import("@/lib/api/plan-management");
  const activePlanModule = await import("@/lib/api/active-plan-context");
  const nextSessionModule = await import("@/lib/api/next-session");
  const templateSessionModule = await import("@/lib/api/template-session");
  const { prisma, closePrismaResourcesForAuditCli } = dbModule;
  closeAppResources = closePrismaResourcesForAuditCli;

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "v4-reference@test.local" },
  });
  await prisma.profile.create({
    data: { userId: user.id, trainingAge: "INTERMEDIATE" },
  });
  await prisma.goals.create({
    data: {
      userId: user.id,
      primaryGoal: "HYPERTROPHY",
      secondaryGoal: "NONE",
    },
  });
  await prisma.constraints.create({
    data: {
      userId: user.id,
      daysPerWeek: 4,
      splitType: "UPPER_LOWER",
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
    },
  });

  const created = await draftsModule.createCustomHypertrophyPlan({
    userId: user.id,
    name: "Five-week V4 reference",
    sessionsPerWeek: 4,
    equipmentProfile: "FULL_GYM",
    sessionDurationMinutes: 60,
    authorMethod: "WEEKLY",
    preset: "UPPER_LOWER_4",
  });
  const loaded = await draftsModule.loadHypertrophyPlanEditorData(
    user.id,
    created.planId,
  );
  assert(loaded?.draft.version === 2, "V4_REFERENCE_DRAFT_NOT_LOADED");

  const sessionDefinitions = [
    {
      slotId: "upper-a",
      name: "Upper A",
      focus: "UPPER" as const,
      exercises: [
        "Barbell Bench Press",
        "Pull-Up",
        "Incline Dumbbell Bench Press",
        "Chest-Supported Dumbbell Row",
        "Dumbbell Lateral Raise",
        "EZ-Bar Curl",
        "Cable Triceps Pushdown",
      ],
    },
    {
      slotId: "lower-a",
      name: "Lower A",
      focus: "LOWER" as const,
      exercises: [
        "Barbell Back Squat",
        "Leg Press",
        "Barbell Romanian Deadlift",
        "Lying Leg Curl",
        "Hip Abduction Machine",
        "Cable Crunch",
      ],
    },
    {
      slotId: "upper-b",
      name: "Upper B",
      focus: "UPPER" as const,
      exercises: [
        "Chest-Supported Dumbbell Row",
        "Lat Pulldown",
        "Dumbbell Overhead Press",
        "Reverse Pec Deck",
        "Dumbbell Bench Press",
        "Cable Curl",
        "Overhead Cable Triceps Extension",
      ],
    },
    {
      slotId: "lower-b",
      name: "Lower B",
      focus: "LOWER" as const,
      exercises: [
        "Dumbbell Romanian Deadlift",
        "Goblet Squat",
        "Bulgarian Split Squat",
        "Seated Leg Curl",
        "Machine Crunch",
      ],
    },
  ];
  const exerciseByName = new Map(
    loaded.exercises.map((exercise) => [exercise.name, exercise]),
  );
  const draft = {
    version: 2 as const,
    settings: loaded.draft.settings,
    weeks: [1, 2, 3, 4, 5].map((week) => ({
      week,
      phase: week === 5 ? "DELOAD" as const : "ACCUMULATION" as const,
    })),
    sessions: sessionDefinitions.map((session) => {
      const existingIntents: Array<
        import("@/lib/engine/hypertrophy-plan-authoring").AcceptedExerciseIntentV2
      > = [];
      return {
        slotId: session.slotId,
        name: session.name,
        focus: session.focus,
        exercises: session.exercises.map((name, index) => {
          const exercise = exerciseByName.get(name);
          assert(exercise, `V4_REFERENCE_EXERCISE_NOT_FOUND:${name}`);
          const recommendation =
            authoringModule.materializeHypertrophyExerciseRecommendation({
              exercise,
              weeks: [1, 2, 3, 4, 5].map((week) => ({
                week,
                phase: week === 5 ? "DELOAD" as const : "ACCUMULATION" as const,
              })),
              existingIntents,
            });
          existingIntents.push(recommendation.intent);
          return {
            placementId: `${session.slotId}-${index + 1}`,
            exerciseId: exercise.id,
            ...recommendation,
          };
        }),
      };
    }),
  };

  const saved = await draftsModule.saveHypertrophyPlanDraft({
    userId: user.id,
    planId: created.planId,
    expectedRevision: created.draftRevision,
    name: "Five-week V4 reference",
    draft,
  });
  assert(saved.preview?.status === "ELIGIBLE", "V4_REFERENCE_PREVIEW_INELIGIBLE");
  const reloaded = await draftsModule.loadHypertrophyPlanEditorData(
    user.id,
    created.planId,
  );
  assert(
    reloaded?.draft.version === 2 && reloaded.preview?.status === "ELIGIBLE",
    "V4_REFERENCE_RELOAD_INELIGIBLE",
  );
  assert(
    reloaded.revision === saved.revision &&
      reloaded.preview.hash === saved.preview.hash,
    "V4_REFERENCE_RELOAD_MISMATCH",
  );

  const ready = await draftsModule.makeHypertrophyPlanReady({
    userId: user.id,
    planId: created.planId,
    expectedDraftRevision: saved.revision,
    warningsConfirmed: true,
    confirmedPreviewHash: saved.preview.hash,
  });
  const target = await planModule.loadPlanActivationTarget(user.id, created.planId);
  assert(target.status === "READY", "V4_REFERENCE_PLAN_NOT_READY");
  await activePlanModule.selectActivePlan({
    userId: user.id,
    targetMacroCycleId: created.planId,
    targetMesocycleId: target.activeMesocycleId,
    expectedActiveMacroCycleId: null,
  });

  const scheduled = await nextSessionModule.loadNextWorkoutContext(user.id);
  assert(scheduled.intent && scheduled.slotId, "V4_REFERENCE_SESSION_NOT_SCHEDULED");
  const { sessionIntentSchema } = await import("@/lib/validation");
  const materialized = await templateSessionModule.generateSessionFromIntent(
    user.id,
    { intent: sessionIntentSchema.parse(scheduled.intent), slotId: scheduled.slotId },
  );
  assert(!("error" in materialized), "V4_REFERENCE_MATERIALIZATION_FAILED");
  const accepted = saved.preview.normalizedPlan;
  const expectedSlot = authoringModule
    .resolveAcceptedHypertrophySeedV4Week(accepted, 1)
    .slots.find((slot) => slot.slotId === scheduled.slotId);
  assert(expectedSlot, "V4_REFERENCE_ACCEPTED_SLOT_NOT_FOUND");
  const actualExercises = [
    ...materialized.workout.mainLifts,
    ...materialized.workout.accessories,
  ].sort((left, right) => left.orderIndex - right.orderIndex);
  assert.deepEqual(
    actualExercises.map((exercise) => ({
      exerciseId: exercise.exercise.id,
      setCount: exercise.sets.length,
      reps: exercise.sets[0]?.targetRepRange ?? exercise.sets[0]?.targetReps,
      targetRpe: exercise.sets[0]?.targetRpe,
      measurement: exercise.measurement,
    })),
    expectedSlot.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      setCount: exercise.setCount,
      reps: exercise.reps.kind === "RANGE"
        ? { min: exercise.reps.min, max: exercise.reps.max }
        : exercise.reps.reps,
      targetRpe: exercise.targetRpe,
      measurement: exercise.measurement,
    })),
  );
  assert.deepEqual(materialized.workout.warmup, []);
  assert(
    actualExercises.every((exercise) => !("warmupSets" in exercise)),
    "V4_REFERENCE_WARMUP_WORK_PRESENT",
  );
  assert.equal(
    materialized.selection.sessionDecisionReceipt?.sessionProvenance
      ?.seedProvenance?.revisionId,
    ready.revisionId,
  );

  console.log(JSON.stringify({
    status: "PASS",
    path: ["create", "load", "save", "preview", "finalize", "activate", "schedule", "materialize"],
    planId: created.planId,
    mesocycleId: ready.mesocycleId,
    revisionId: ready.revisionId,
    slotId: scheduled.slotId,
    exerciseCount: actualExercises.length,
  }));
  } finally {
    await closeAppResources?.();
    spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
