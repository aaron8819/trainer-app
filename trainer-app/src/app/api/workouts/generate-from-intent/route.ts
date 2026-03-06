import { NextResponse } from "next/server";
import { generateFromIntentSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { generateDeloadSessionFromIntent, generateSessionFromIntent } from "@/lib/api/template-session";
import { applyAutoregulation } from "@/lib/api/autoregulation";
import { loadActiveMesocycle } from "@/lib/api/mesocycle-lifecycle";
import type { GenerateFromIntentResponse } from "@/lib/api/template-session/types";
import { buildCanonicalSelectionMetadata } from "@/lib/ui/selection-metadata";
import type { SaveableSelectionMetadata } from "@/lib/ui/selection-metadata";

type PlannedExercise = GenerateFromIntentResponse["workout"]["mainLifts"][number];
type PlannedSet = PlannedExercise["sets"][number];

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

function withOptionalGapFillMarker(
  selectionMetadata: SaveableSelectionMetadata,
  input: { enabled: boolean; targetMuscles?: string[] }
): SaveableSelectionMetadata {
  if (!input.enabled) {
    return selectionMetadata;
  }
  const receipt = selectionMetadata.sessionDecisionReceipt;
  if (!receipt) {
    return selectionMetadata;
  }
  const hasMarker = receipt.exceptions.some((entry) => entry.code === "optional_gap_fill");
  if (hasMarker) {
    return selectionMetadata;
  }
  return {
    ...selectionMetadata,
    sessionDecisionReceipt: {
      ...receipt,
      targetMuscles:
        input.targetMuscles && input.targetMuscles.length > 0
          ? input.targetMuscles
          : receipt.targetMuscles,
      exceptions: [
        ...receipt.exceptions,
        {
          code: "optional_gap_fill",
          message: "Marked as optional gap-fill session.",
        },
      ],
    },
  };
}

function withOptionalGapFillAnchorWeek(
  selectionMetadata: SaveableSelectionMetadata,
  input: { enabled: boolean; anchorWeek?: number }
): SaveableSelectionMetadata {
  if (!input.enabled || input.anchorWeek == null) {
    return selectionMetadata;
  }
  const receipt = selectionMetadata.sessionDecisionReceipt;
  if (!receipt) {
    return selectionMetadata;
  }
  return {
    ...selectionMetadata,
    sessionDecisionReceipt: {
      ...receipt,
      cycleContext: {
        ...receipt.cycleContext,
        weekInMeso: input.anchorWeek,
        weekInBlock: input.anchorWeek,
      },
    },
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

  const activeMesocycle = await loadActiveMesocycle(user.id);
  const result =
    activeMesocycle?.state === "ACTIVE_DELOAD"
      ? await generateDeloadSessionFromIntent(user.id, parsed.data)
      : await generateSessionFromIntent(user.id, parsed.data);
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
    maxGeneratedHardSets: parsed.data.maxGeneratedHardSets,
    maxGeneratedExercises: parsed.data.maxGeneratedExercises,
  });
  const shouldApplyOptionalGapFill =
    parsed.data.optionalGapFill === true && parsed.data.intent === "body_part";
  const anchorPinnedSelectionMetadata = withOptionalGapFillAnchorWeek(selectionMetadata, {
    enabled: shouldApplyOptionalGapFill,
    anchorWeek: parsed.data.anchorWeek,
  });
  const markedSelectionMetadata = withOptionalGapFillMarker(
    anchorPinnedSelectionMetadata,
    {
      enabled: shouldApplyOptionalGapFill,
      targetMuscles: parsed.data.targetMuscles,
    }
  );

  const response: GenerateFromIntentResponse = {
    workout: cappedWorkout,
    sraWarnings: result.sraWarnings,
    substitutions: result.substitutions,
    volumePlanByMuscle: result.volumePlanByMuscle,
    selectionMode: result.selectionMode,
    sessionIntent: result.sessionIntent,
    selectionSummary,
    selectionMetadata: markedSelectionMetadata,
    filteredExercises: result.filteredExercises,
  };

  return NextResponse.json(response);
}
