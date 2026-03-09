import { parseArgs, loadAuditEnv, printAuditPreflight, assertAuditPreflight, runAuditPreflight } from "./audit-cli-support";

function parseBooleanFlag(value: string | boolean | undefined): boolean {
  return value === true || value === "true" || value === "1";
}

function parseInteger(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadAuditEnv(typeof args["env-file"] === "string" ? args["env-file"] : undefined);
  const apply = parseBooleanFlag(args.apply);

  const [
    { resolveWorkoutAuditIdentity },
    { prisma },
    { runWeekCloseHandoffAudit },
    weekCloseModule,
    { isStrictOptionalGapFillSession },
    { deriveCurrentMesocycleSession },
  ] = await Promise.all([
    import("@/lib/audit/workout-audit/context-builder"),
    import("@/lib/db/prisma"),
    import("@/lib/audit/workout-audit/week-close-handoff"),
    import("@/lib/api/mesocycle-week-close"),
    import("@/lib/gap-fill/classifier"),
    import("@/lib/api/mesocycle-lifecycle-math"),
  ]);

  const preflight = await runAuditPreflight({
    args,
    resolveIdentity: resolveWorkoutAuditIdentity,
    checkDb: async () => {
      await prisma.$queryRawUnsafe("SELECT 1");
    },
  });
  preflight.envFilePath = env.envFilePath;
  preflight.status.env_loaded = env.envLoaded;
  printAuditPreflight("repair-week-close-handoff", preflight);
  assertAuditPreflight("repair-week-close-handoff", preflight);

  const request = {
    userId: typeof args["user-id"] === "string" ? args["user-id"] : undefined,
    ownerEmail: typeof args.owner === "string" ? args.owner : undefined,
    targetWeek: parseInteger(args["target-week"]),
    previewOptionalGapFill: false,
    sanitizationLevel: "none" as const,
  };

  const artifact = await runWeekCloseHandoffAudit(request);
  const identity = await resolveWorkoutAuditIdentity(request);

  const mesocycle = await prisma.mesocycle.findUnique({
    where: { id: artifact.target.mesocycleId },
    select: {
      id: true,
      state: true,
      durationWeeks: true,
      sessionsPerWeek: true,
      startWeek: true,
      accumulationSessionsCompleted: true,
      deloadSessionsCompleted: true,
      blocks: {
        orderBy: { blockNumber: "asc" },
        select: {
          blockType: true,
          startWeek: true,
          durationWeeks: true,
          volumeTarget: true,
          intensityBias: true,
        },
      },
      macroCycle: {
        select: {
          startDate: true,
        },
      },
    },
  });
  if (!mesocycle) {
    throw new Error(`Mesocycle ${artifact.target.mesocycleId} not found`);
  }

  const strictGapFillWorkout = (
    await prisma.workout.findMany({
      where: {
        userId: identity.userId,
        mesocycleId: artifact.target.mesocycleId,
        mesocycleWeekSnapshot: artifact.target.targetWeek,
        advancesSplit: false,
      },
      orderBy: [{ scheduledDate: "desc" }],
      select: {
        id: true,
        status: true,
        selectionMode: true,
        sessionIntent: true,
        selectionMetadata: true,
      },
    })
  ).find((workout) =>
    isStrictOptionalGapFillSession({
      selectionMetadata: workout.selectionMetadata,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
    })
  );

  const currentSession = deriveCurrentMesocycleSession(mesocycle);
  const repairPlan = {
    apply,
    userId: identity.userId,
    ownerEmail: identity.ownerEmail ?? null,
    mesocycleId: artifact.target.mesocycleId,
    targetWeek: artifact.target.targetWeek,
    currentLifecycleWeek: currentSession.week,
    expected: artifact.conclusions.week_close_trigger_expected,
    observed: artifact.conclusions.week_close_trigger_observed,
    historicalMixedContractStateDetected:
      artifact.conclusions.historical_mixed_contract_state.detected,
    historicalMixedContractStateConfidence:
      artifact.conclusions.historical_mixed_contract_state.confidence,
    strictGapFillWorkoutId: strictGapFillWorkout?.id ?? null,
    strictGapFillWorkoutStatus: strictGapFillWorkout?.status ?? null,
    action:
      !artifact.conclusions.week_close_trigger_expected
        ? "noop_not_expected"
        : artifact.conclusions.week_close_trigger_observed
          ? "noop_already_present"
          : "repair_missing_week_close",
  };

  if (!apply || repairPlan.action !== "repair_missing_week_close") {
    console.log(
      JSON.stringify(
        {
          mode: apply ? "noop" : "dry-run",
          repairPlan,
          historicalMixedContractState: artifact.conclusions.historical_mixed_contract_state,
          conclusions: artifact.conclusions,
        },
        null,
        2
      )
    );
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const evaluateResult = await weekCloseModule.evaluateWeekCloseAtBoundary(tx, {
      userId: identity.userId,
      mesocycle: {
        id: mesocycle.id,
        durationWeeks: mesocycle.durationWeeks,
        sessionsPerWeek: mesocycle.sessionsPerWeek,
        startWeek: mesocycle.startWeek,
        blocks: mesocycle.blocks,
        macroCycle: {
          startDate: mesocycle.macroCycle.startDate,
        },
      },
      targetWeek: artifact.target.targetWeek,
      targetPhase: "ACCUMULATION",
    });

    let linkResult: string | null = null;
    let resolutionResult: unknown = null;
    let autoDismissResult: unknown = null;

    if (strictGapFillWorkout?.id) {
      linkResult = await weekCloseModule.linkOptionalWorkoutToWeekClose(tx, {
        weekCloseId: evaluateResult.weekCloseId,
        workoutId: strictGapFillWorkout.id,
      });

      if (strictGapFillWorkout.status === "COMPLETED") {
        resolutionResult = await weekCloseModule.resolveWeekCloseOnOptionalGapFillCompletion(tx, {
          workoutId: strictGapFillWorkout.id,
          weekCloseId: evaluateResult.weekCloseId,
        });
      }
    } else if (currentSession.week > artifact.target.targetWeek) {
      autoDismissResult = await weekCloseModule.autoDismissPendingWeekCloseOnForwardProgress(tx, {
        mesocycleId: mesocycle.id,
        workoutWeek: currentSession.week,
      });
    }

    return {
      evaluateResult,
      linkResult,
      resolutionResult,
      autoDismissResult,
    };
  });

  const repairedArtifact = await runWeekCloseHandoffAudit(request);
  console.log(
    JSON.stringify(
      {
        mode: "apply",
        repairPlan,
        historicalMixedContractState: artifact.conclusions.historical_mixed_contract_state,
        result,
        repairedConclusions: repairedArtifact.conclusions,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[repair-week-close-handoff] ${message}`);
  process.exitCode = 1;
});
