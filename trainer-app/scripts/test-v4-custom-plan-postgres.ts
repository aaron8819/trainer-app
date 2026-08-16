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
  assert(
    loaded.health.draftId === created.planId &&
      loaded.health.draftRevision === created.draftRevision,
    "V4_REFERENCE_INITIAL_HEALTH_REVISION_MISMATCH",
  );

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
  assert(saved.health.status === "AVAILABLE", "V4_REFERENCE_HEALTH_UNAVAILABLE");
  assert.equal(saved.health.draftRevision, saved.revision);
  assert.equal(saved.health.summary.blockingSafety, 0);
  assert.equal(saved.health.summary.importantWarnings, 0);
  assert.match(
    saved.health.confirmationScope,
    /^plan-health-confirmation\.v1\.[a-f0-9]{64}$/,
  );
  const coachingMuscles = new Set(
    saved.health.issues
      .filter((issue) => issue.tier === "COACHING_OBSERVATION")
      .map((issue) => issue.affected?.muscle)
      .filter((muscle): muscle is string => Boolean(muscle)),
  );
  for (const muscle of [
    "Chest",
    "Side Delts",
    "Lats",
    "Upper Back",
    "Rear Delts",
    "Biceps",
    "Triceps",
    "Calves",
  ]) {
    assert(coachingMuscles.has(muscle), `V4_REFERENCE_COACHING_MISSING:${muscle}`);
  }
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

  const blockedDraft = structuredClone(draft);
  blockedDraft.sessions[3]!.exercises = [];
  const blocked = await draftsModule.saveHypertrophyPlanDraft({
    userId: user.id,
    planId: created.planId,
    expectedRevision: saved.revision,
    name: "Five-week V4 reference",
    draft: blockedDraft,
  });
  assert(blocked.health.status === "AVAILABLE", "V4_REFERENCE_BLOCKER_HEALTH_UNAVAILABLE");
  assert(blocked.health.summary.blockingSafety > 0, "V4_REFERENCE_BLOCKER_NOT_FOUND");
  await assert.rejects(
    () =>
      draftsModule.makeHypertrophyPlanReady({
        userId: user.id,
        planId: created.planId,
        expectedDraftRevision: blocked.revision,
      }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "PLAN_UNSUPPORTED_TOPOLOGY" || error.code === "PLAN_DRAFT_BLOCKED"),
    "V4_REFERENCE_BLOCKER_FINALIZATION_DID_NOT_FAIL",
  );

  const restored = await draftsModule.saveHypertrophyPlanDraft({
    userId: user.id,
    planId: created.planId,
    expectedRevision: blocked.revision,
    name: "Five-week V4 reference",
    draft,
  });
  assert(restored.preview?.status === "ELIGIBLE", "V4_REFERENCE_RESTORE_INELIGIBLE");
  assert(restored.health.status === "AVAILABLE", "V4_REFERENCE_RESTORE_HEALTH_UNAVAILABLE");
  assert.equal(restored.health.summary.blockingSafety, 0);
  assert.equal(restored.health.summary.importantWarnings, 0);
  assert.deepEqual(restored.preview.normalizedPlan, saved.preview.normalizedPlan);
  assert.equal(restored.preview.hash, saved.preview.hash);
  const restoredDraft = await draftsModule.loadHypertrophyPlanEditorData(
    user.id,
    created.planId,
  );
  assert(restoredDraft?.draft.version === 2, "V4_REFERENCE_RESTORED_DRAFT_NOT_LOADED");
  assert.deepEqual(restoredDraft.draft, draft);
  assert.equal(restoredDraft.health.draftRevision, restored.revision);

  const warningPlan = await draftsModule.createCustomHypertrophyPlan({
    userId: user.id,
    name: "V4 warning-scope transaction proof",
    sessionsPerWeek: 4,
    equipmentProfile: "FULL_GYM",
    sessionDurationMinutes: 60,
    authorMethod: "WEEKLY",
    preset: "UPPER_LOWER_4",
  });
  const warningDraft = structuredClone(draft);
  warningDraft.sessions[0]!.exercises.push({
    ...structuredClone(warningDraft.sessions[0]!.exercises[0]!),
    placementId: "upper-a-warning-duplicate",
  });
  const warningSaved = await draftsModule.saveHypertrophyPlanDraft({
    userId: user.id,
    planId: warningPlan.planId,
    expectedRevision: warningPlan.draftRevision,
    name: "V4 warning-scope transaction proof",
    draft: warningDraft,
  });
  if (warningSaved.preview?.status !== "ELIGIBLE") {
    throw new Error("V4_WARNING_SCOPE_PREVIEW_INELIGIBLE");
  }
  if (
    warningSaved.health.status !== "AVAILABLE" ||
    warningSaved.health.summary.importantWarnings !== 1
  ) {
    throw new Error("V4_WARNING_SCOPE_IMPORTANT_WARNING_MISSING");
  }
  const warningPreview = warningSaved.preview;
  const warningHealth = warningSaved.health;
  const warningState = async () => ({
    plan: await prisma.macroCycle.findUniqueOrThrow({
      where: { id: warningPlan.planId },
      select: { name: true, updatedAt: true },
    }),
    draft: await prisma.hypertrophyPlanDraft.findUnique({
      where: { macroCycleId: warningPlan.planId },
      select: { revision: true, payload: true, updatedAt: true },
    }),
    mesocycles: await prisma.mesocycle.count({
      where: { macroCycleId: warningPlan.planId },
    }),
    revisions: await prisma.mesocycleSeedRevision.count({
      where: { mesocycle: { macroCycleId: warningPlan.planId } },
    }),
  });
  const beforeWarningRejections = await warningState();
  const rejectWarningScope = async (
    confirmationStatus: "MISSING" | "MISMATCH",
    warningConfirmationScope?: string,
  ) => {
    try {
      await draftsModule.makeHypertrophyPlanReady({
        userId: user.id,
        planId: warningPlan.planId,
        expectedDraftRevision: warningSaved.revision,
        confirmedPreviewHash: warningPreview.hash,
        ...(warningConfirmationScope ? { warningConfirmationScope } : {}),
      });
      assert.fail(`V4_WARNING_SCOPE_${confirmationStatus}_DID_NOT_REJECT`);
    } catch (error) {
      const failure = error as {
        code?: string;
        details?: { confirmationStatus?: string };
        responseData?: { health?: typeof warningHealth };
      };
      assert.equal(failure.code, "PLAN_WARNING_CONFIRMATION_REQUIRED");
      assert.equal(failure.details?.confirmationStatus, confirmationStatus);
      assert(
        failure.responseData?.health?.status === "AVAILABLE",
        `V4_WARNING_SCOPE_${confirmationStatus}_CURRENT_HEALTH_MISSING`,
      );
      return failure.responseData.health;
    }
  };
  const missingHealth = await rejectWarningScope("MISSING");
  assert.deepEqual(await warningState(), beforeWarningRejections);
  const mismatchHealth = await rejectWarningScope(
    "MISMATCH",
    `plan-health-confirmation.v1.${"f".repeat(64)}`,
  );
  assert.deepEqual(await warningState(), beforeWarningRejections);
  assert.equal(missingHealth.confirmationScope, warningHealth.confirmationScope);
  assert.equal(mismatchHealth.confirmationScope, warningHealth.confirmationScope);
  const warningReady = await draftsModule.makeHypertrophyPlanReady({
    userId: user.id,
    planId: warningPlan.planId,
    expectedDraftRevision: warningSaved.revision,
    confirmedPreviewHash: warningPreview.hash,
    warningConfirmationScope: mismatchHealth.confirmationScope,
  });
  const afterWarningReady = await warningState();
  const warningTarget = await planModule.loadPlanActivationTarget(
    user.id,
    warningPlan.planId,
  );
  assert.equal(warningTarget.status, "READY");
  assert.equal(afterWarningReady.draft, null);
  assert.equal(afterWarningReady.mesocycles, 1);
  assert.equal(afterWarningReady.revisions, 1);

  const ready = await draftsModule.makeHypertrophyPlanReady({
    userId: user.id,
    planId: created.planId,
    expectedDraftRevision: restored.revision,
    confirmedPreviewHash: restored.preview.hash,
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
  const accepted = restored.preview.normalizedPlan;
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
    path: ["create", "load", "save", "health", "block", "reject", "restore", "warning-missing-zero-write", "warning-mismatch-zero-write", "warning-exact-finalize", "finalize", "activate", "schedule", "materialize"],
    planId: created.planId,
    mesocycleId: ready.mesocycleId,
    revisionId: ready.revisionId,
    warningRevisionId: warningReady.revisionId,
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
