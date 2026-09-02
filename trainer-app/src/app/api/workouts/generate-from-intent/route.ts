import { NextResponse } from "next/server";
import { generateFromIntentSchema } from "@/lib/validation";
import { provisionOwnerForMutation } from "@/lib/api/workout-context";
import { generateDeloadSessionFromIntent, generateSessionFromIntent } from "@/lib/api/template-session";
import {
  applyAutoregulation,
  type AutoregulationResult,
} from "@/lib/api/autoregulation";
import { loadActiveMesocycle } from "@/lib/api/mesocycle-lifecycle";
import { loadPendingMesocycleHandoff } from "@/lib/api/mesocycle-handoff";
import { findPendingWeekCloseForUser } from "@/lib/api/mesocycle-week-close";
import {
  FINAL_ACCUMULATION_WEEK_CLOSE_PENDING_MESSAGE,
  loadNextWorkoutContext,
  loadRequestedAdvancingSlotSnapshot,
  resolveRequestedV4ScheduledGenerationObligation,
} from "@/lib/api/next-session";
import type { GenerateFromIntentResponse } from "@/lib/api/template-session/types";
import {
  attachSessionAuditSnapshotToSelectionMetadata,
  buildGeneratedSessionAuditSnapshot,
} from "@/lib/evidence/session-audit-snapshot";
import {
  attachOptionalGapFillMetadata,
  attachSessionSlotMetadata,
  attachSupplementalSessionMetadata,
  buildCanonicalSelectionMetadata,
} from "@/lib/ui/selection-metadata";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { applySessionCapacityReduction } from "@/lib/api/template-session/session-capacity-reduction";
import {
  parseSlotPlanSeedJson,
  resolveAcceptedSeedPayloadForWeek,
} from "@/lib/api/slot-plan-seed-parser";
import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import { attachSessionCapacityReductionReconciliation } from "@/lib/api/runtime-edit-reconciliation";
import { buildPrescriptionReadouts } from "@/lib/api/prescription-readout";

type PlannedExercise = GenerateFromIntentResponse["workout"]["mainLifts"][number];
type PlannedSet = PlannedExercise["sets"][number];

const SUPPLEMENTAL_DEFAULT_MAX_EXERCISES = 4;
const SUPPLEMENTAL_DEFAULT_MAX_HARD_SETS = 8;

function isAcceptedV4Seed(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as { version?: unknown }).version === 4,
  );
}

function unchangedAutoregulation(
  workout: GenerateFromIntentResponse["workout"],
  loadAudit: NonNullable<AutoregulationResult["loadAudit"]>,
): AutoregulationResult {
  const reason = "Accepted custom plan prescriptions replay exactly as planned.";
  return {
    original: workout,
    adjusted: workout,
    loadAudit,
    modifications: [],
    fatigueScore: null,
    rationale: reason,
    wasAutoregulated: false,
    applied: false,
    reason,
    signalAgeHours: null,
  };
}

function applyGapFillCaps(input: {
  workout: GenerateFromIntentResponse["workout"];
  maxGeneratedHardSets?: number;
  maxGeneratedExercises?: number;
}): GenerateFromIntentResponse["workout"] {
  const maxSets = input.maxGeneratedHardSets;
  const maxExercises = input.maxGeneratedExercises;
  if (!maxSets && !maxExercises) {
    return input.workout;
  }

  const combined: Array<{ section: "main" | "accessory"; exercise: PlannedExercise }> = [
    ...input.workout.mainLifts.map((exercise) => ({ section: "main" as const, exercise })),
    ...input.workout.accessories.map((exercise) => ({ section: "accessory" as const, exercise })),
  ];

  const exerciseLimited = maxExercises ? combined.slice(0, maxExercises) : combined;
  let remainingSets = maxSets ?? Number.POSITIVE_INFINITY;
  const mainLifts: PlannedExercise[] = [];
  const accessories: PlannedExercise[] = [];

  for (const entry of exerciseLimited) {
    if (remainingSets <= 0) {
      break;
    }
    const allowedSets = entry.exercise.sets.slice(0, Math.max(0, remainingSets));
    if (allowedSets.length === 0) {
      continue;
    }
    const nextExercise: PlannedExercise = {
      ...entry.exercise,
      sets: allowedSets as PlannedSet[],
    };
    if (entry.section === "main") {
      mainLifts.push(nextExercise);
    } else {
      accessories.push(nextExercise);
    }
    remainingSets -= allowedSets.length;
  }

  return {
    ...input.workout,
    mainLifts,
    accessories,
  };
}

export async function POST(request: Request) {
  const paused = productionWritePauseResponse(
    "workout_materialization",
    "/api/workouts/generate-from-intent",
  );
  if (paused) return paused;

  const body = await request.json().catch(() => ({}));
  const parsed = generateFromIntentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await provisionOwnerForMutation("workout_materialization");
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const pendingHandoff = await loadPendingMesocycleHandoff(user.id);
  if (pendingHandoff) {
    return NextResponse.json(
      {
        error: "Mesocycle handoff pending.",
        handoff: pendingHandoff,
      },
      { status: 409 }
    );
  }

  const activeMesocycle = await loadActiveMesocycle(user.id);
  if (!activeMesocycle) {
    return NextResponse.json(
      { error: "Selected plan with an active mesocycle is required." },
      { status: 409 }
    );
  }
  const nextWorkoutContext = await loadNextWorkoutContext(user.id);
  if (
    nextWorkoutContext.activeMesocycleId !== undefined &&
    nextWorkoutContext.activeMesocycleId !== activeMesocycle.id
  ) {
    return NextResponse.json(
      { error: "Active plan selection changed concurrently. Retry generation." },
      { status: 409 }
    );
  }
  const shouldApplyOptionalGapFill =
    parsed.data.optionalGapFill === true && parsed.data.intent === "body_part";
  const shouldApplySupplementalDeficitSession =
    parsed.data.supplementalDeficitSession === true && parsed.data.intent === "body_part";
  if (nextWorkoutContext.source === "schedule_resolution_blocked") {
    return NextResponse.json(
      {
        error:
          nextWorkoutContext.lifecycleBlocker?.message ??
          "Scheduled workout identity is ambiguous. Refresh before continuing.",
        blocker: nextWorkoutContext.lifecycleBlocker ?? null,
      },
      { status: 409 },
    );
  }
  if (
    nextWorkoutContext.source === "final_week_close_pending" &&
    !shouldApplyOptionalGapFill
  ) {
    return NextResponse.json(
      {
        error:
          nextWorkoutContext.lifecycleBlocker?.message ??
          FINAL_ACCUMULATION_WEEK_CLOSE_PENDING_MESSAGE,
        blocker: nextWorkoutContext.lifecycleBlocker ?? null,
      },
      { status: 409 }
    );
  }
  let canonicalGapFill:
    | {
        weekCloseId: string;
        targetWeek: number;
        targetMuscles: string[];
        maxGeneratedHardSets?: number;
        maxGeneratedExercises?: number;
      }
    | null = null;

  if (shouldApplyOptionalGapFill) {
    const pendingWeekClose = await findPendingWeekCloseForUser({
      userId: user.id,
      weekCloseId: parsed.data.weekCloseId,
      mesocycleId: activeMesocycle?.id,
    });
    if (!activeMesocycle || !pendingWeekClose || pendingWeekClose.mesocycleId !== activeMesocycle.id) {
      return NextResponse.json({ error: "Pending week-close window not found." }, { status: 409 });
    }
    if (pendingWeekClose.optionalWorkout) {
      return NextResponse.json(
        {
          error: "A gap-fill workout is already linked to this week-close window.",
          workoutId: pendingWeekClose.optionalWorkout.id,
        },
        { status: 409 }
      );
    }

    const deficitSnapshot = pendingWeekClose.deficitSnapshot;
    const targetMuscles =
      deficitSnapshot?.summary.topTargetMuscles?.filter(Boolean) ??
      deficitSnapshot?.muscles.slice(0, 3).map((entry) => entry.muscle) ??
      [];
    if (targetMuscles.length === 0) {
      return NextResponse.json(
        { error: "Pending week-close window does not contain a usable deficit snapshot." },
        { status: 409 }
      );
    }

    canonicalGapFill = {
      weekCloseId: pendingWeekClose.id,
      targetWeek: pendingWeekClose.targetWeek,
      targetMuscles,
      maxGeneratedHardSets:
        deficitSnapshot?.policy.maxGeneratedHardSets ?? parsed.data.maxGeneratedHardSets,
      maxGeneratedExercises:
        deficitSnapshot?.policy.maxGeneratedExercises ?? parsed.data.maxGeneratedExercises,
    };
  }

  const isRecognizedNonScheduled =
    shouldApplyOptionalGapFill ||
    shouldApplySupplementalDeficitSession ||
    parsed.data.intent === "body_part";
  const advancingSlot =
    isRecognizedNonScheduled
      ? undefined
      : await loadRequestedAdvancingSlotSnapshot({
          userId: user.id,
          requestedIntent: parsed.data.intent,
          explicitSlotId: parsed.data.slotId,
          nextWorkoutContext,
        });
  const scheduledV4Obligation =
    isRecognizedNonScheduled
      ? undefined
      : resolveRequestedV4ScheduledGenerationObligation({
          nextWorkoutContext,
          requestedIntent: parsed.data.intent,
          explicitSlotId: parsed.data.slotId,
        });
  if (
    nextWorkoutContext.v4ScheduleAuthority &&
    !isRecognizedNonScheduled &&
    !scheduledV4Obligation
  ) {
    return NextResponse.json(
      { error: "Selected scheduled workout is no longer eligible. Refresh and retry." },
      { status: 409 },
    );
  }
  if (parsed.data.slotId && !advancingSlot) {
    if (isRecognizedNonScheduled) {
      return NextResponse.json(
        { error: "Non-scheduled workouts cannot claim an authored schedule slot." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error:
          "Selected session is no longer eligible. Refresh Home and choose an available session.",
      },
      { status: 409 }
    );
  }

  const generationMode = isRecognizedNonScheduled
    ? {
        kind: "non_scheduled" as const,
        purpose: shouldApplyOptionalGapFill
          ? ("gap_fill" as const)
          : shouldApplySupplementalDeficitSession
            ? ("supplemental" as const)
            : ("body_part" as const),
        ...(parsed.data.anchorWeek != null
          ? { anchorWeek: parsed.data.anchorWeek }
          : {}),
      }
    : scheduledV4Obligation
      ? {
          kind: "accepted_v4_scheduled" as const,
          obligation: scheduledV4Obligation,
        }
      : { kind: "legacy" as const };

  const generationInput = shouldApplyOptionalGapFill && canonicalGapFill
    ? {
        ...parsed.data,
        generationMode,
        slotId: parsed.data.slotId,
        targetMuscles: canonicalGapFill.targetMuscles,
        weekCloseId: canonicalGapFill.weekCloseId,
        optionalGapFillContext: {
          weekCloseId: canonicalGapFill.weekCloseId,
          targetWeek: canonicalGapFill.targetWeek,
        },
        maxGeneratedHardSets: canonicalGapFill.maxGeneratedHardSets,
        maxGeneratedExercises: canonicalGapFill.maxGeneratedExercises,
      }
    : {
        ...parsed.data,
        generationMode,
        advancingSlot,
        ...(shouldApplySupplementalDeficitSession
          ? {
              supplementalPlannerProfile: true,
              maxGeneratedHardSets:
                parsed.data.maxGeneratedHardSets ?? SUPPLEMENTAL_DEFAULT_MAX_HARD_SETS,
              maxGeneratedExercises:
                parsed.data.maxGeneratedExercises ?? SUPPLEMENTAL_DEFAULT_MAX_EXERCISES,
            }
          : {}),
      };
  const hasAcceptedV4Seed = isAcceptedV4Seed(
    activeMesocycle.currentSeedRevision?.seedPayload,
  );
  const result =
    !hasAcceptedV4Seed &&
    !shouldApplyOptionalGapFill && activeMesocycle?.state === "ACTIVE_DELOAD"
      ? await generateDeloadSessionFromIntent(user.id, generationInput)
      : await generateSessionFromIntent(user.id, generationInput);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  if (!result.audit) {
    throw new Error("GENERATION_LOAD_AUDIT_REQUIRED");
  }

  // Phase 3: Apply autoregulation
  const generationReceipt = result.selection.sessionDecisionReceipt;
  const receiptProvenance = generationReceipt?.sessionProvenance;
  const seedProvenance = receiptProvenance?.seedProvenance;
  const revision = activeMesocycle.currentSeedRevision;
  const exactV4Replay = Boolean(
    hasAcceptedV4Seed &&
      !shouldApplyOptionalGapFill &&
      !shouldApplySupplementalDeficitSession &&
      parsed.data.intent !== "body_part" &&
      advancingSlot &&
      generationReceipt?.sessionSlot?.slotId === advancingSlot.slotId &&
      generationReceipt.sessionSlot.intent === advancingSlot.intent &&
      generationReceipt.sessionSlot.sequenceIndex === advancingSlot.sequenceIndex &&
      generationReceipt.sessionSlot.sequenceLength === advancingSlot.sequenceLength &&
      generationReceipt.sessionSlot.source === advancingSlot.source &&
      (!scheduledV4Obligation ||
        (generationReceipt.cycleContext.weekInMeso ===
          scheduledV4Obligation.requiredSlot.weekInMeso &&
          scheduledV4Obligation.authority.mesocycleId === activeMesocycle.id &&
          scheduledV4Obligation.authority.revisionId === revision?.id)) &&
      receiptProvenance?.mesocycleId === activeMesocycle.id &&
      receiptProvenance.compositionSource === "persisted_slot_plan_seed" &&
      revision?.provenanceStatus === "exact" &&
      revision.hashAlgorithm === "sha256" &&
      seedProvenance?.revisionId === revision.id &&
      seedProvenance.revision === revision.revision &&
      seedProvenance.hash === revision.payloadHash
  );
  const autoregulated = exactV4Replay
    ? unchangedAutoregulation(
        result.workout,
        result.audit,
      )
    : await applyAutoregulation(user.id, result.workout, result.audit);
  const selectionMetadata = buildCanonicalSelectionMetadata(result.selection, autoregulated);

  const selectionSummary: GenerateFromIntentResponse["selectionSummary"] = {
    selectedCount:
      selectionMetadata.selectedExerciseIds?.length ??
      Object.keys(selectionMetadata.rationale ?? {}).length,
    pinnedCount: Object.values(selectionMetadata.rationale ?? {}).filter((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return false;
      }
      return (entry as { selectedStep?: string }).selectedStep === "pin";
    }).length,
    setTargetCount: Object.keys(selectionMetadata.perExerciseSetTargets ?? {}).length,
  };

  const cappedWorkout = applyGapFillCaps({
    workout: autoregulated.adjusted,
    maxGeneratedHardSets: generationInput.maxGeneratedHardSets,
    maxGeneratedExercises: generationInput.maxGeneratedExercises,
  });
  const markedSelectionMetadata = attachOptionalGapFillMetadata(selectionMetadata, {
    enabled: shouldApplyOptionalGapFill,
    targetMuscles: generationInput.targetMuscles,
    weekCloseId: generationInput.weekCloseId,
  });
  const slotStampedSelectionMetadata = attachSessionSlotMetadata(
    markedSelectionMetadata,
    advancingSlot
  );
  const finalSelectionMetadata = attachSupplementalSessionMetadata(slotStampedSelectionMetadata, {
    enabled: shouldApplySupplementalDeficitSession,
    targetMuscles: generationInput.targetMuscles,
    anchorWeek: generationInput.anchorWeek,
  });
  const sessionAuditSnapshot = buildGeneratedSessionAuditSnapshot({
    workout: cappedWorkout,
    selectionMode: result.selectionMode,
    sessionIntent: result.sessionIntent,
    selectionMetadata: finalSelectionMetadata,
    targetMuscles: generationInput.targetMuscles,
    advancesSplit:
      shouldApplyOptionalGapFill || shouldApplySupplementalDeficitSession ? false : true,
    filteredExercises: result.filteredExercises,
    progressionTraces:
      autoregulated.loadAudit?.progressionTraces ?? result.audit.progressionTraces,
    deloadTrace: result.audit.deloadTrace,
  });
  const fullPlanSelectionMetadata = attachSessionAuditSnapshotToSelectionMetadata(
    finalSelectionMetadata,
    sessionAuditSnapshot
  );
  const receipt = readSessionDecisionReceipt(fullPlanSelectionMetadata);
  if (
    receipt?.sessionProvenance?.mesocycleId &&
    receipt.sessionProvenance.mesocycleId !== activeMesocycle.id
  ) {
    return NextResponse.json(
      { error: "Active plan selection changed concurrently. Retry generation." },
      { status: 409 }
    );
  }
  let parsedSeed = null;
  try {
    parsedSeed = exactV4Replay && activeMesocycle.currentSeedRevision
      ? resolveAcceptedSeedPayloadForWeek(
          activeMesocycle.currentSeedRevision.seedPayload,
          receipt?.cycleContext.weekInMeso ?? 1,
        )
      : parseSlotPlanSeedJson(activeMesocycle.slotPlanSeedJson);
  } catch {
    parsedSeed = null;
  }
  const executableSeedSlots =
    parsedSeed &&
    parsedSeed.slots.every((slot) =>
      slot.exercises.every((exercise) => exercise.setCount != null),
    )
      ? parsedSeed.slots.map((slot) => ({
          slotId: slot.slotId,
          exercises: slot.exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            role: exercise.role,
            setCount: exercise.setCount!,
          })),
        }))
      : null;
  const requestedSessionCapacity =
    parsed.data.sessionCapacity ?? "as_planned";
  const sessionCapacityResult = applySessionCapacityReduction({
    plannedWorkout: cappedWorkout,
    acceptedReductionManifest:
      activeMesocycle?.sessionCapacityReductionManifest,
    mode: requestedSessionCapacity,
    week: receipt?.cycleContext.weekInMeso ?? 0,
    slotId: receipt?.sessionSlot?.slotId ?? advancingSlot?.slotId,
    isAccumulationPrimary:
      activeMesocycle?.state === "ACTIVE_ACCUMULATION" &&
      !shouldApplyOptionalGapFill &&
      !shouldApplySupplementalDeficitSession &&
      receipt?.sessionProvenance?.compositionSource ===
        "persisted_slot_plan_seed",
    isWorkoutUncreated:
      nextWorkoutContext.isExisting !== true &&
      nextWorkoutContext.selectedIncompleteStatus == null,
    hasPainOrEquipmentConflict: result.substitutions.length > 0,
    seedRevision: activeMesocycle?.currentSeedRevision
      ? {
          id: activeMesocycle.currentSeedRevision.id,
          revision: activeMesocycle.currentSeedRevision.revision,
          payloadHash: activeMesocycle.currentSeedRevision.payloadHash,
        }
      : null,
    executableSeedSlots,
  });
  const responseSelectionMetadata =
    sessionCapacityResult.status === "applied"
      ? attachSessionCapacityReductionReconciliation({
          selectionMetadata: fullPlanSelectionMetadata,
          evidence: sessionCapacityResult.evidence,
        })
      : fullPlanSelectionMetadata;
  const finalLoadAudit = autoregulated.loadAudit ?? result.audit;

  const response: GenerateFromIntentResponse = {
    workout: sessionCapacityResult.workout,
    sraWarnings: result.sraWarnings,
    substitutions: result.substitutions,
    volumePlanByMuscle: result.volumePlanByMuscle,
    selectionMode: result.selectionMode,
    sessionIntent: result.sessionIntent,
    prescriptionReadouts: buildPrescriptionReadouts({
      workout: sessionCapacityResult.workout,
      prescriptionResultsByPlacement: finalLoadAudit.prescriptions,
      resolvedLoadsByPlacement: finalLoadAudit.resolvedLoads,
    }),
    selectionSummary,
    selectionMetadata: responseSelectionMetadata,
    filteredExercises: result.filteredExercises,
    sessionCapacity: {
      requestedMode: requestedSessionCapacity,
      status: sessionCapacityResult.status,
      ...(sessionCapacityResult.status === "unavailable"
        ? { unavailableReason: sessionCapacityResult.reason }
        : {}),
      ...(sessionCapacityResult.status === "applied"
        ? { preview: sessionCapacityResult.preview }
        : {}),
    },
  };

  return NextResponse.json(response);
}
