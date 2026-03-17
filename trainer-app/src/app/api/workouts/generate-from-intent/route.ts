import { NextResponse } from "next/server";
import { generateFromIntentSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { generateDeloadSessionFromIntent, generateSessionFromIntent } from "@/lib/api/template-session";
import { applyAutoregulation } from "@/lib/api/autoregulation";
import { loadActiveMesocycle } from "@/lib/api/mesocycle-lifecycle";
import { loadPendingMesocycleHandoff } from "@/lib/api/mesocycle-handoff";
import { findPendingWeekCloseForUser } from "@/lib/api/mesocycle-week-close";
import { loadNextWorkoutContext } from "@/lib/api/next-session";
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

type PlannedExercise = GenerateFromIntentResponse["workout"]["mainLifts"][number];
type PlannedSet = PlannedExercise["sets"][number];

const SUPPLEMENTAL_DEFAULT_MAX_EXERCISES = 4;
const SUPPLEMENTAL_DEFAULT_MAX_HARD_SETS = 8;

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
  const body = await request.json().catch(() => ({}));
  const parsed = generateFromIntentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveOwner();
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
  const nextWorkoutContext = await loadNextWorkoutContext(user.id);
  const shouldApplyOptionalGapFill =
    parsed.data.optionalGapFill === true && parsed.data.intent === "body_part";
  const shouldApplySupplementalDeficitSession =
    parsed.data.supplementalDeficitSession === true && parsed.data.intent === "body_part";
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

      const generationInput = shouldApplyOptionalGapFill && canonicalGapFill
    ? {
        ...parsed.data,
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
  const result =
    !shouldApplyOptionalGapFill && activeMesocycle?.state === "ACTIVE_DELOAD"
      ? await generateDeloadSessionFromIntent(user.id, generationInput)
      : await generateSessionFromIntent(user.id, generationInput);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Phase 3: Apply autoregulation
  const autoregulated = await applyAutoregulation(user.id, result.workout);
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
  const slotStampedSelectionMetadata = attachSessionSlotMetadata(markedSelectionMetadata, (
    nextWorkoutContext.source === "rotation" &&
    nextWorkoutContext.intent === result.sessionIntent &&
    nextWorkoutContext.slotId &&
    nextWorkoutContext.slotSequenceIndex != null &&
    nextWorkoutContext.slotSource &&
    (parsed.data.slotId == null || parsed.data.slotId === nextWorkoutContext.slotId)
  )
    ? {
        slotId: nextWorkoutContext.slotId,
        intent: result.sessionIntent,
        sequenceIndex: nextWorkoutContext.slotSequenceIndex,
        sequenceLength: activeMesocycle?.sessionsPerWeek,
        source: nextWorkoutContext.slotSource,
      }
    : undefined);
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
    progressionTraces: result.audit?.progressionTraces,
    deloadTrace: result.audit?.deloadTrace,
  });
  const responseSelectionMetadata = attachSessionAuditSnapshotToSelectionMetadata(
    finalSelectionMetadata,
    sessionAuditSnapshot
  );

  const response: GenerateFromIntentResponse = {
    workout: cappedWorkout,
    sraWarnings: result.sraWarnings,
    substitutions: result.substitutions,
    volumePlanByMuscle: result.volumePlanByMuscle,
    selectionMode: result.selectionMode,
    sessionIntent: result.sessionIntent,
    selectionSummary,
    selectionMetadata: responseSelectionMetadata,
    filteredExercises: result.filteredExercises,
  };

  return NextResponse.json(response);
}
