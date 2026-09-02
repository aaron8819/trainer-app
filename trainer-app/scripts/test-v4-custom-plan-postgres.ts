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

function bindAcceptedExerciseIdentityPlaceholders<
  T extends {
    slots: Array<{
      exercises: Array<{ exerciseId: string }>;
    }>;
  },
>(
  expected: T,
  exerciseByName: ReadonlyMap<string, { id: string }>,
): T {
  const rebound = structuredClone(expected);
  for (const slot of rebound.slots) {
    for (const exercise of slot.exercises) {
      const catalogExercise = exerciseByName.get(exercise.exerciseId);
      assert(
        catalogExercise,
        `V4_REVISED_EXPECTED_EXERCISE_NOT_FOUND:${exercise.exerciseId}`,
      );
      exercise.exerciseId = catalogExercise.id;
    }
  }
  return rebound;
}

function bindRuntimeExerciseIdentityPlaceholders<
  T extends {
    exercises: readonly { exerciseId: string }[];
  },
>(
  expected: T,
  exerciseByName: ReadonlyMap<string, { id: string }>,
) {
  return {
    ...structuredClone(expected),
    exercises: expected.exercises.map((exercise) => {
      const catalogExercise = exerciseByName.get(exercise.exerciseId);
      assert(
        catalogExercise,
        `V4_REVISED_RUNTIME_EXERCISE_NOT_FOUND:${exercise.exerciseId}`,
      );
      return {
        ...structuredClone(exercise),
        exerciseId: catalogExercise.id,
      };
    }),
  };
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
  const saveWorkoutRouteModule = await import("@/app/api/workouts/save/route");
  const workoutPlanOrderModule = await import("@/lib/engine/workout-plan-order");
  const v4ScheduleModule = await import("@/lib/api/v4-scheduled-slot-resolution");
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

  const submittedFixtureModule = await import(
    "@/lib/engine/hypertrophy-plan-authoring-v4-revised.fixture"
  );
  const expectedModule = await import(
    "@/lib/api/hypertrophy-plan-authoring-v4-revised.expected"
  );
  const runtimeExpectedModule = await import(
    "@/lib/api/template-session-v4-revised-reference.expected"
  );
  const { normalizeAcceptedHypertrophySeedV4 } = await import(
    "@/lib/api/mesocycle-seed-revision"
  );
  const exerciseByName = new Map(
    loaded.exercises.map((exercise) => [exercise.name, exercise]),
  );

  const draft = submittedFixtureModule.buildRevisedFourDayPlanSubmittedDraft();
  for (const session of draft.sessions) {
    for (const exercise of session.exercises) {
      const catalogExercise = exerciseByName.get(exercise.exerciseId);
      assert(
        catalogExercise,
        `V4_REVISED_INPUT_EXERCISE_NOT_FOUND:${exercise.exerciseId}`,
      );
      exercise.exerciseId = catalogExercise.id;
    }
  }

  const expectedAccepted = bindAcceptedExerciseIdentityPlaceholders(
    expectedModule.buildExpectedRevisedFourDayAcceptedSeed(),
    exerciseByName,
  );
  const expectedRuntime = bindRuntimeExerciseIdentityPlaceholders(
    runtimeExpectedModule.V4_REVISED_WEEK_1_LOWER_A_RUNTIME_LITERAL,
    exerciseByName,
  );

  const saved = await draftsModule.saveHypertrophyPlanDraft({
    userId: user.id,
    planId: created.planId,
    expectedRevision: created.draftRevision,
    name: "Five-week V4 reference",
    draft,
  });
  assert(saved.preview?.status === "ELIGIBLE", "V4_REFERENCE_PREVIEW_INELIGIBLE");
  const actualBoundHash = saved.preview.hash;
  assert(saved.health.status === "AVAILABLE", "V4_REFERENCE_HEALTH_UNAVAILABLE");
  assert.equal(saved.health.draftRevision, saved.revision);
  assert.equal(saved.health.summary.blockingSafety, 0);
  assert.equal(saved.health.summary.importantWarnings, 0);
  assert.deepEqual(
    saved.preview.normalizedPlan,
    expectedAccepted,
    "V4_REVISED_PREVIEW_DID_NOT_MATCH_INDEPENDENT_EXPECTED",
  );
  assert.equal(saved.preview.hashAlgorithm, "sha256");
  const materiallyChangedActual = structuredClone(saved.preview.normalizedPlan);
  const changedActualRow =
    materiallyChangedActual.slots[0]!.exercises[0]!.prescriptions[0]!;
  assert(changedActualRow.status === "PRESCRIBE");
  changedActualRow.setCount += 1;
  const materiallyChangedActualHash =
    normalizeAcceptedHypertrophySeedV4(materiallyChangedActual).hash;
  assert.notEqual(
    materiallyChangedActualHash,
    actualBoundHash,
    "V4_REVISED_HASH_IGNORED_ACTUAL_MATERIAL_CHANGE",
  );
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
    "Biceps",
    "Calves",
    "Chest",
    "Hamstrings",
    "Lats",
    "Quads",
    "Rear Delts",
    "Side Delts",
    "Triceps",
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
      reloaded.preview.hash === actualBoundHash,
    "V4_REFERENCE_RELOAD_MISMATCH",
  );
  assert.equal(reloaded.preview.hashAlgorithm, "sha256");
  assert.deepEqual(
    reloaded.preview.normalizedPlan,
    expectedAccepted,
    "V4_REVISED_RELOAD_DID_NOT_PRESERVE_EXPECTED",
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
  assert.equal(restored.preview.hash, actualBoundHash);
  assert.equal(restored.preview.hashAlgorithm, "sha256");
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
    placementId: "lower-a-warning-duplicate",
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

  const finalizationConfirmedHash = restored.preview.hash;
  assert.equal(finalizationConfirmedHash, actualBoundHash);
  const ready = await draftsModule.makeHypertrophyPlanReady({
    userId: user.id,
    planId: created.planId,
    expectedDraftRevision: restored.revision,
    confirmedPreviewHash: finalizationConfirmedHash,
  });
  const acceptedRevision = await prisma.mesocycleSeedRevision.findUniqueOrThrow({
    where: { id: ready.revisionId },
    select: {
      id: true,
      mesocycleId: true,
      revision: true,
      payloadHash: true,
      hashAlgorithm: true,
      provenanceStatus: true,
      creationReason: true,
      actorSource: true,
      sourceRevisionId: true,
      seedPayload: true,
    },
  });
  assert.equal(acceptedRevision.id, ready.revisionId);
  assert.equal(acceptedRevision.mesocycleId, ready.mesocycleId);
  assert.equal(acceptedRevision.revision, 1);
  assert.equal(
    acceptedRevision.payloadHash,
    actualBoundHash,
    "V4_REVISED_FINALIZATION_HASH_DRIFT",
  );
  assert.equal(acceptedRevision.hashAlgorithm, "sha256");
  assert.equal(acceptedRevision.provenanceStatus, "exact");
  assert.equal(
    acceptedRevision.creationReason,
    "custom_hypertrophy_plan_make_ready",
  );
  assert.equal(acceptedRevision.actorSource, "plan_management");
  assert.equal(acceptedRevision.sourceRevisionId, null);
  assert.deepEqual(
    acceptedRevision.seedPayload,
    expectedAccepted,
    "V4_REVISED_IMMUTABLE_REVISION_PAYLOAD_MISMATCH",
  );
  const target = await planModule.loadPlanActivationTarget(user.id, created.planId);
  assert(target.status === "READY", "V4_REFERENCE_PLAN_NOT_READY");
  await activePlanModule.selectActivePlan({
    userId: user.id,
    targetMacroCycleId: created.planId,
    targetMesocycleId: target.activeMesocycleId,
    expectedActiveMacroCycleId: null,
  });
  const activeContext = await activePlanModule.resolveActivePlanContext(user.id);
  assert(activeContext.status === "READY", "V4_REFERENCE_ACTIVE_CONTEXT_NOT_READY");
  assert.equal(activeContext.activeMesocycle.id, ready.mesocycleId);
  const activeRevision = activeContext.activeMesocycle.currentSeedRevision;
  assert(activeRevision, "V4_REFERENCE_ACTIVE_REVISION_MISSING");
  assert.equal(activeRevision.id, ready.revisionId);
  assert.equal(activeRevision.revision, 1);
  assert.equal(activeRevision.payloadHash, actualBoundHash);
  assert.equal(activeRevision.hashAlgorithm, "sha256");
  assert.equal(activeRevision.provenanceStatus, "exact");

  const scheduled = await nextSessionModule.loadNextWorkoutContext(user.id);
  assert(scheduled.intent && scheduled.slotId, "V4_REFERENCE_SESSION_NOT_SCHEDULED");
  assert.equal(scheduled.activeMesocycleId, ready.mesocycleId);
  assert.equal(
    scheduled.slotId,
    "lower-a",
    "V4_REVISED_FIRST_SCHEDULED_SLOT_NOT_LOWER_A",
  );
  assert.equal(scheduled.intent, "lower");
  assert.equal(scheduled.slotSequenceIndex, 0);
  assert.equal(scheduled.slotSequenceLength, 4);
  assert.equal(scheduled.slotSource, "mesocycle_slot_sequence");
  const { sessionIntentSchema } = await import("@/lib/validation");
  const scheduledObligation =
    nextSessionModule.resolveRequestedV4ScheduledGenerationObligation({
      nextWorkoutContext: scheduled,
    });
  assert(scheduledObligation, "V4_REFERENCE_OBLIGATION_NOT_RESOLVED");
  const bodyPartGenerated = await templateSessionModule.generateSessionFromIntent(
    user.id,
    {
      intent: "body_part",
      targetMuscles: ["biceps"],
      generationMode: {
        kind: "non_scheduled",
        purpose: "body_part",
      },
    },
  );
  assert(!("error" in bodyPartGenerated), "V4_BODY_PART_GENERATION_FAILED");
  const bodyPartReceipt = bodyPartGenerated.selection.sessionDecisionReceipt;
  assert(bodyPartReceipt, "V4_BODY_PART_RECEIPT_MISSING");
  assert.equal(
    bodyPartReceipt.materialization?.materializationClass,
    "non_scheduled",
  );
  assert.equal(bodyPartReceipt.materialization?.purpose, "body_part");
  assert.equal(bodyPartReceipt.sessionSlot, undefined);
  assert.equal(bodyPartReceipt.scheduledSlotReceipt, undefined);

  const bodyPartExercises = workoutPlanOrderModule
    .listWorkoutPlanExercisesInOrder(bodyPartGenerated.workout)
    .filter(({ exercise }) => exercise.sets.length > 0)
    .map(({ exercise, section }) => ({
      section:
        section === "warmup"
          ? ("WARMUP" as const)
          : section === "main"
            ? ("MAIN" as const)
            : ("ACCESSORY" as const),
      placementId: exercise.id,
      exerciseId: exercise.exercise.id,
      ...(exercise.measurement ? { measurement: exercise.measurement } : {}),
      sets: exercise.sets.map((set) => ({
        setIndex: set.setIndex,
        targetReps: set.targetReps,
        ...(set.targetRepRange ? { targetRepRange: set.targetRepRange } : {}),
        ...(set.targetRpe != null ? { targetRpe: set.targetRpe } : {}),
        ...(set.targetLoad != null ? { targetLoad: set.targetLoad } : {}),
      })),
    }));
  assert(bodyPartExercises.length > 0, "V4_BODY_PART_EXERCISES_MISSING");
  const bodyPartSaveResponse = await saveWorkoutRouteModule.POST(
    new Request("http://localhost/api/workouts/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workoutId: bodyPartGenerated.workout.id,
        action: "save_plan",
        scheduledDate: bodyPartGenerated.workout.scheduledDate,
        estimatedMinutes: bodyPartGenerated.workout.estimatedMinutes,
        selectionMode: bodyPartGenerated.selectionMode,
        sessionIntent: "BODY_PART",
        advancesSplit: true,
        selectionMetadata: {
          sessionDecisionReceipt: bodyPartReceipt,
        },
        exercises: bodyPartExercises,
      }),
    }),
  );
  assert.equal(
    bodyPartSaveResponse.status,
    200,
    `V4_BODY_PART_SAVE_FAILED:${await bodyPartSaveResponse.text()}`,
  );
  const persistedBodyPart = await prisma.workout.findUniqueOrThrow({
    where: { id: bodyPartGenerated.workout.id },
    select: {
      id: true,
      status: true,
      mesocycleId: true,
      mesocycleWeekSnapshot: true,
      mesocyclePhaseSnapshot: true,
      mesoSessionSnapshot: true,
      advancesSplit: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
      seedRevisionId: true,
      seedRevisionNumber: true,
      seedPayloadHash: true,
    },
  });
  assert.equal(persistedBodyPart.mesocycleId, ready.mesocycleId);
  assert.equal(persistedBodyPart.advancesSplit, false);
  const persistedBodyPartReceipt = (
    persistedBodyPart.selectionMetadata as {
      sessionDecisionReceipt?: typeof bodyPartReceipt;
    }
  ).sessionDecisionReceipt;
  assert.equal(
    persistedBodyPartReceipt?.materialization?.materializationClass,
    "non_scheduled",
  );
  assert.equal(persistedBodyPartReceipt?.materialization?.purpose, "body_part");
  assert.equal(persistedBodyPartReceipt?.scheduledSlotReceipt, undefined);

  const authorityResolution = v4ScheduleModule.resolveV4ScheduleAuthority(
    activeContext.activeMesocycle,
  );
  assert.equal(authorityResolution.status, "available");
  if (authorityResolution.status !== "available") {
    throw new Error("V4_BODY_PART_AUTHORITY_UNAVAILABLE");
  }
  const persistedResolution = v4ScheduleModule.resolveV4ScheduledSlots({
    authority: authorityResolution.authority,
    workouts: [persistedBodyPart],
  });
  if (persistedResolution.status !== "available") {
    throw new Error(`V4_BODY_PART_RESOLUTION_BLOCKED:${persistedResolution.reason}`);
  }
  assert.equal(persistedResolution.claims.length, 0);
  assert.equal(persistedResolution.resolvedSlotCount, 0);
  assert.equal(persistedResolution.nextUnresolvedSlot?.weekInMeso, 1);
  assert.equal(persistedResolution.nextUnresolvedSlot?.slotId, scheduled.slotId);

  const scheduledAfterBodyPart = await nextSessionModule.loadNextWorkoutContext(
    user.id,
  );
  assert.equal(scheduledAfterBodyPart.source, "rotation");
  assert.equal(scheduledAfterBodyPart.weekInMeso, scheduled.weekInMeso);
  assert.equal(scheduledAfterBodyPart.slotId, scheduled.slotId);
  assert.equal(scheduledAfterBodyPart.intent, scheduled.intent);
  const revisionAfterBodyPart = await prisma.mesocycleSeedRevision.findUniqueOrThrow({
    where: { id: ready.revisionId },
    select: { seedPayload: true, payloadHash: true },
  });
  assert.deepEqual(revisionAfterBodyPart.seedPayload, acceptedRevision.seedPayload);
  assert.equal(revisionAfterBodyPart.payloadHash, acceptedRevision.payloadHash);

  const materialized = await templateSessionModule.generateSessionFromIntent(
    user.id,
    {
      intent: sessionIntentSchema.parse(scheduled.intent),
      slotId: scheduled.slotId,
      generationMode: {
        kind: "accepted_v4_scheduled",
        obligation: scheduledObligation,
      },
    },
  );
  assert(!("error" in materialized), "V4_REFERENCE_MATERIALIZATION_FAILED");
  const actualResolvedSlot = authoringModule
    .resolveAcceptedHypertrophySeedV4Week(saved.preview.normalizedPlan, 1)
    .slots.find((slot) => slot.slotId === scheduled.slotId);
  assert(actualResolvedSlot, "V4_REFERENCE_ACCEPTED_SLOT_NOT_FOUND");
  const actualAcceptedSlot = saved.preview.normalizedPlan.slots.find(
    (slot) => slot.slotId === scheduled.slotId,
  );
  assert(actualAcceptedSlot, "V4_REFERENCE_NORMALIZED_SLOT_NOT_FOUND");
  const actualExercises = [
    ...materialized.workout.mainLifts,
    ...materialized.workout.accessories,
  ].sort((left, right) => left.orderIndex - right.orderIndex);
  const runtimeReceipt = materialized.selection.sessionDecisionReceipt;
  assert(runtimeReceipt, "V4_REFERENCE_RUNTIME_RECEIPT_MISSING");
  const runtimeSeedProvenance = runtimeReceipt.sessionProvenance?.seedProvenance;
  assert(runtimeSeedProvenance, "V4_REFERENCE_RUNTIME_SEED_PROVENANCE_MISSING");
  assert.equal(runtimeReceipt.sessionProvenance?.mesocycleId, ready.mesocycleId);
  assert.equal(
    runtimeReceipt.sessionProvenance?.compositionSource,
    "persisted_slot_plan_seed",
  );
  assert.equal(runtimeSeedProvenance.revisionId, ready.revisionId);
  assert.equal(runtimeSeedProvenance.revision, 1);
  assert.equal(runtimeSeedProvenance.hash, actualBoundHash);
  assert.equal(runtimeReceipt.sessionSlot?.slotId, scheduled.slotId);
  assert.equal(runtimeReceipt.sessionSlot?.intent, "lower");
  assert.equal(runtimeReceipt.sessionSlot?.sequenceIndex, 0);
  assert.equal(runtimeReceipt.sessionSlot?.sequenceLength, 4);
  assert.equal(runtimeReceipt.sessionSlot?.source, "mesocycle_slot_sequence");

  const actualRuntime = {
    week: runtimeReceipt.cycleContext.weekInMeso,
    phase: runtimeReceipt.cycleContext.phase,
    slotId: runtimeReceipt.sessionSlot?.slotId,
    focus: runtimeReceipt.sessionSlot?.intent,
    sequenceIndex: runtimeReceipt.sessionSlot?.sequenceIndex,
    sequenceLength: runtimeReceipt.sessionSlot?.sequenceLength,
    exerciseCount: actualExercises.length,
    exercises: actualExercises.map((exercise, index) => ({
      placementId: actualResolvedSlot.exercises[index]?.placementId,
      exerciseId: exercise.exercise.id,
      setCount: exercise.sets.length,
      sets: exercise.sets.map((set) => ({
        reps: set.targetRepRange ?? set.targetReps,
        targetRpe: set.targetRpe,
      })),
      measurement: exercise.measurement,
    })),
    omittedPlacementIds: actualAcceptedSlot.exercises
      .map((exercise) => exercise.placementId)
      .filter(
        (placementId) =>
          !actualResolvedSlot.exercises.some(
            (exercise) => exercise.placementId === placementId,
          ),
      ),
    provenance: {
      revision: runtimeSeedProvenance.revision,
    },
    composition: {
      source: runtimeReceipt.sessionProvenance?.compositionSource,
      warmup: materialized.workout.warmup,
      hasWarmupSets: actualExercises.some((exercise) => "warmupSets" in exercise),
      hasHipFlexorPreparation: actualExercises.some((exercise) =>
        /hip[-_ ]flexor/i.test(exercise.exercise.id),
      ),
      hasFinisherComposition:
        "finisher" in materialized || "finisher" in materialized.workout,
      selectionFallbackUsed:
        runtimeReceipt.sessionProvenance?.compositionSource !==
        "persisted_slot_plan_seed",
    },
  };
  assert.deepEqual(
    actualRuntime,
    expectedRuntime,
    "V4_REVISED_RUNTIME_DID_NOT_MATCH_INDEPENDENT_LITERAL",
  );

  const hashChain = {
    savedPreview: saved.preview.hash,
    reloadedPreview: reloaded.preview.hash,
    finalizationConfirmation: finalizationConfirmedHash,
    immutableRevision: acceptedRevision.payloadHash,
    activeRevision: activeRevision.payloadHash,
    runtimeReceipt: runtimeSeedProvenance.hash,
  };
  for (const [stage, hash] of Object.entries(hashChain)) {
    assert.equal(hash, actualBoundHash, `V4_REVISED_HASH_CHAIN_DRIFT:${stage}`);
  }

  console.log(JSON.stringify({
    status: "PASS",
    path: ["create", "load", "save", "health", "block", "reject", "restore", "warning-missing-zero-write", "warning-mismatch-zero-write", "warning-exact-finalize", "finalize", "activate", "schedule", "generate-body-part", "save-body-part", "resolve-after-body-part", "materialize"],
    planId: created.planId,
    mesocycleId: ready.mesocycleId,
    revisionId: ready.revisionId,
    warningRevisionId: warningReady.revisionId,
    slotId: scheduled.slotId,
    bodyPartWorkoutId: persistedBodyPart.id,
    nextSlotAfterBodyPart: scheduledAfterBodyPart.slotId,
    exerciseCount: actualExercises.length,
    databaseBoundHash: actualBoundHash,
    materiallyChangedActualHash,
    hashChain,
    runtimeLiteral: "V4_REVISED_WEEK_1_LOWER_A_RUNTIME_LITERAL",
    placementCounts: draft.sessions.map((session) => session.exercises.length),
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
