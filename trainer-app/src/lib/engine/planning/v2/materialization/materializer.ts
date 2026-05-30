import type {
  V2ExerciseClassMatch,
  V2ExerciseClassTaxonomy,
  V2ExerciseMaterializationInput,
  V2ExerciseMaterializationPlan,
  V2MaterializationExercise,
  V2MaterializedSelection,
} from "./types";
import {
  evaluateV2AnchorLaneQuality,
  isV2AnchorLaneQualityChecked,
  matchV2ExerciseClasses,
  normalizeV2MaterializationText,
  resolveV2ExerciseClassIds,
} from "./taxonomy";

type PlanSlot =
  V2ExerciseMaterializationInput["exerciseSelectionPlan"]["weeks"][number]["slots"][number];
type PlanLane = PlanSlot["lanes"][number];

type InventoryCandidate = {
  exercise: V2MaterializationExercise;
  matches: V2ExerciseClassMatch[];
};

type Candidate = {
  exercise: V2MaterializationExercise;
  match: V2ExerciseClassMatch;
  preferredClassOrder: number;
  directness: number;
  identityPreservation: number;
  chestSupportStimulus: number;
  laneIntent: number;
  stimulusToFatigue: number;
  fatigue: number;
  favorite: number;
  normalizedName: string;
  exerciseId: string;
};

export function buildV2ExerciseMaterializationPlan(
  input: V2ExerciseMaterializationInput,
): V2ExerciseMaterializationPlan {
  const inventory = normalizeInventory(input.inventory, input.taxonomy);
  const blockedExerciseIds = new Set([
    ...input.constraints.avoidExerciseIds,
    ...input.constraints.painConflictExerciseIds,
  ]);
  const favoriteExerciseIds = new Set(input.constraints.favoriteExerciseIds);
  const selected: V2MaterializedSelection[] = [
    ...(input.continuity?.priorMaterializedSelections ?? []),
  ];
  const slots: V2ExerciseMaterializationPlan["slots"] = [];
  const blockers: V2ExerciseMaterializationPlan["blockers"] = [];
  const omissions: V2ExerciseMaterializationPlan["omissions"] = [];

  for (const slot of representativeSlots(input.exerciseSelectionPlan.weeks)) {
    const materializedSlot: V2ExerciseMaterializationPlan["slots"][number] = {
      slotId: slot.slotId,
      exercises: [],
    };

    for (const lane of slot.lanes) {
      const materialized = materializeLane({
        lane,
        slot,
        inventory,
        taxonomy: input.taxonomy,
        blockedExerciseIds,
        favoriteExerciseIds,
        availableEquipment: input.constraints.availableEquipment,
        carryForwardExerciseIds:
          input.continuity?.carryForwardExerciseIdsByLane ?? {},
        identityPreservationMode: input.continuity?.identityPreservationMode,
        selected,
        materializedSlot,
      });

      if (materialized.kind === "selected") {
        selected.push(materialized.selection);
        materializedSlot.exercises.push({
          exerciseId: materialized.selection.exerciseId,
          role: lane.role === "anchor" ? "CORE_COMPOUND" : "ACCESSORY",
          setCount: materialized.setCount,
          laneIds: [lane.laneId],
        });
        continue;
      }

      if (isNonRequiredMaterializationLane(lane)) {
        omissions.push({
          slotId: slot.slotId,
          laneId: lane.laneId,
          reason:
            materialized.reason === "capacity_exhausted"
              ? "optional_capacity_exhausted"
              : materialized.reason === "optional_not_activated"
                ? "optional_not_activated"
                : "optional_no_match",
        });
      } else {
        blockers.push({
          slotId: slot.slotId,
          laneId: lane.laneId,
          reason:
            materialized.reason === "optional_not_activated"
              ? "no_class_match"
              : materialized.reason,
        });
      }
    }

    slots.push(materializedSlot);
  }

  return {
    version: 1,
    source: "v2_exercise_materialization",
    dryRunOnly: true,
    status: blockers.length ? "blocked" : "materialized",
    slots,
    blockers,
    omissions,
  };
}

function representativeSlots(
  weeks: V2ExerciseMaterializationInput["exerciseSelectionPlan"]["weeks"],
): PlanSlot[] {
  const seen = new Set<string>();
  const slots: PlanSlot[] = [];
  const sortedWeeks = [...weeks].sort((left, right) => left.week - right.week);
  const baseWeeks = sortedWeeks.filter((week) =>
    ["accumulation", "hard_accumulation", "peak_overreach_lite"].includes(
      week.phase,
    ),
  );
  for (const week of baseWeeks.length ? baseWeeks : sortedWeeks) {
    for (const slot of [...week.slots].sort(
      (left, right) =>
        left.slotIndex - right.slotIndex || left.slotId.localeCompare(right.slotId),
    )) {
      if (!seen.has(slot.slotId)) {
        seen.add(slot.slotId);
        slots.push(slot);
      }
    }
  }
  return slots;
}

function normalizeInventory(
  inventory: V2MaterializationExercise[],
  taxonomy: V2ExerciseClassTaxonomy,
): InventoryCandidate[] {
  return inventory
    .map((exercise) => ({
      exercise: {
        ...exercise,
        aliases: [...(exercise.aliases ?? [])].sort(),
        movementPatterns: [...exercise.movementPatterns].sort(),
        primaryMuscles: [...exercise.primaryMuscles].sort(),
        secondaryMuscles: [...exercise.secondaryMuscles].sort(),
        equipment: [...exercise.equipment].sort(),
        stimulusByMusclePerSet: Object.fromEntries(
          Object.entries(exercise.stimulusByMusclePerSet).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      },
      matches: matchV2ExerciseClasses(exercise, taxonomy),
    }))
    .sort(
      (left, right) =>
        normalizeV2MaterializationText(left.exercise.name).localeCompare(
          normalizeV2MaterializationText(right.exercise.name),
        ) || left.exercise.exerciseId.localeCompare(right.exercise.exerciseId),
    );
}

function materializeLane(input: {
  lane: PlanLane;
  slot: PlanSlot;
  inventory: InventoryCandidate[];
  taxonomy: V2ExerciseClassTaxonomy;
  blockedExerciseIds: ReadonlySet<string>;
  favoriteExerciseIds: ReadonlySet<string>;
  availableEquipment: string[] | undefined;
  carryForwardExerciseIds: Record<string, string[]>;
  identityPreservationMode:
    | NonNullable<
        V2ExerciseMaterializationInput["continuity"]
      >["identityPreservationMode"]
    | undefined;
  selected: V2MaterializedSelection[];
  materializedSlot: V2ExerciseMaterializationPlan["slots"][number];
}):
  | {
      kind: "selected";
      selection: V2MaterializedSelection;
      setCount: number;
    }
  | {
      kind: "unmaterialized";
      reason:
        | V2ExerciseMaterializationPlan["blockers"][number]["reason"]
        | "optional_not_activated";
    } {
  if (shouldSkipLaneByPolicy(input.lane)) {
    return { kind: "unmaterialized", reason: "optional_not_activated" };
  }
  if (input.materializedSlot.exercises.length >= input.slot.maxExerciseCount) {
    return { kind: "unmaterialized", reason: "capacity_exhausted" };
  }
  if (
    input.lane.setBudget.min >
    input.lane.perExerciseCap.maxSetsWithoutJustification
  ) {
    return { kind: "unmaterialized", reason: "capacity_exhausted" };
  }

  const resolvedClasses = resolveV2ExerciseClassIds(input.taxonomy, [
    ...input.lane.acceptableExerciseClasses,
    ...input.lane.preferredExerciseClasses,
  ]);
  if (!resolvedClasses.length) {
    return { kind: "unmaterialized", reason: "taxonomy_gap" };
  }

  const classCandidates = buildCandidates({
    ...input,
    resolvedClasses,
    preferredClasses: resolveV2ExerciseClassIdsInPreferenceOrder(
      input.taxonomy,
      input.lane.preferredExerciseClasses,
    ),
  });
  if (!classCandidates.length) {
    return { kind: "unmaterialized", reason: "no_class_match" };
  }

  const directFloorClassIds: string[] = input.lane.directFloor?.requiredExerciseClasses
    ?.length
    ? resolveV2ExerciseClassIds(
        input.taxonomy,
        input.lane.directFloor.requiredExerciseClasses,
      )
    : [];
  const directCandidates = input.lane.directFloor
    ? classCandidates.filter(
        (candidate) =>
          candidate.match.directMuscles.includes(
            input.lane.directFloor?.muscle ?? "",
          ) &&
          (!directFloorClassIds.length ||
            directFloorClassIds.includes(candidate.match.classId)),
      )
    : classCandidates;
  if (!directCandidates.length) {
    return { kind: "unmaterialized", reason: "direct_floor_unmaterialized" };
  }

  const anchorQualityCandidates = filterAnchorQualityCandidates({
    lane: input.lane,
    candidates: directCandidates,
  });
  if (!anchorQualityCandidates.length) {
    return { kind: "unmaterialized", reason: "no_class_match" };
  }

  const cleanCandidates = anchorQualityCandidates.filter(
    (candidate) => !isDuplicate(candidate, input.lane, input.slot, input.selected),
  );
  const duplicateRequiresClean =
    input.lane.cleanAlternativePolicy.requiredBeforeDuplicate;
  if (!cleanCandidates.length && duplicateRequiresClean) {
    return {
      kind: "unmaterialized",
      reason: "duplicate_requires_clean_alternative",
    };
  }

  const candidatePool = cleanCandidates.length
    ? cleanCandidates
    : anchorQualityCandidates;
  const chosen = [...candidatePool].sort(compareCandidates)[0];
  if (!chosen) {
    return { kind: "unmaterialized", reason: "no_class_match" };
  }

  return {
    kind: "selected",
    selection: {
      slotId: input.slot.slotId,
      laneId: input.lane.laneId,
      exerciseId: chosen.exercise.exerciseId,
      classId: chosen.match.classId,
      duplicateFamily: chosen.match.duplicateFamily,
    },
    setCount: Math.min(
      input.lane.setBudget.preferred,
      input.lane.setBudget.max,
      input.lane.perExerciseCap.maxSetsWithoutJustification,
    ),
  };
}

function filterAnchorQualityCandidates(input: {
  lane: PlanLane;
  candidates: Candidate[];
}): Candidate[] {
  if (!isV2AnchorLaneQualityChecked(input.lane.laneId)) {
    return input.candidates;
  }
  const evaluated = input.candidates.map((candidate) => ({
    candidate,
    quality: evaluateV2AnchorLaneQuality(
      input.lane.laneId,
      candidate.exercise,
      candidate.match,
    ),
  }));
  const ideal = evaluated.filter((row) => row.quality.tier === "ideal");
  if (ideal.length) {
    return ideal.map((row) => row.candidate);
  }
  const fallback = evaluated.filter((row) => row.quality.tier === "fallback");
  if (fallback.length && allowsAnchorFallback(input.lane.laneId)) {
    return fallback.map((row) => row.candidate);
  }
  return [];
}

function allowsAnchorFallback(laneId: string): boolean {
  return (
    laneId === "squat_anchor" ||
    laneId === "quad_support" ||
    laneId === "hinge_anchor" ||
    laneId === "row_anchor" ||
    laneId === "row_support"
  );
}

function buildCandidates(input: {
  lane: PlanLane;
  slot: PlanSlot;
  inventory: InventoryCandidate[];
  resolvedClasses: string[];
  preferredClasses: string[];
  blockedExerciseIds: ReadonlySet<string>;
  favoriteExerciseIds: ReadonlySet<string>;
  availableEquipment: string[] | undefined;
  carryForwardExerciseIds: Record<string, string[]>;
  identityPreservationMode:
    | NonNullable<
        V2ExerciseMaterializationInput["continuity"]
      >["identityPreservationMode"]
    | undefined;
}): Candidate[] {
  const resolved = new Set(input.resolvedClasses);
  return input.inventory.flatMap(({ exercise, matches }) => {
    if (
      input.blockedExerciseIds.has(exercise.exerciseId) ||
      !equipmentAvailable(exercise, input.availableEquipment)
    ) {
      return [];
    }
    return matches
      .filter((match) => resolved.has(match.classId))
      .map((match) => ({
        exercise,
        match,
        preferredClassOrder: preferredClassOrderForLane(
          input.lane,
          match.classId,
          input.resolvedClasses,
          input.preferredClasses,
        ),
        directness: directnessForLane(input.lane, match),
        identityPreservation: identityPreservationScore({
          slotId: input.slot.slotId,
          laneId: input.lane.laneId,
          exerciseId: exercise.exerciseId,
          carryForwardExerciseIds: input.carryForwardExerciseIds,
          identityPreservationMode: input.identityPreservationMode,
        }),
        chestSupportStimulus: chestSupportStimulusScore(
          input.lane,
          match,
          exercise,
        ),
        laneIntent: laneIntentPreferenceScore(input.lane, match, exercise),
        stimulusToFatigue: stimulusToFatigueScore(input.lane, match, exercise),
        fatigue: exercise.fatigueCost ?? 0,
        favorite: input.favoriteExerciseIds.has(exercise.exerciseId) ? 0 : 1,
        normalizedName: normalizeV2MaterializationText(exercise.name),
        exerciseId: exercise.exerciseId,
      }));
  });
}

function preferredClassOrderForLane(
  lane: PlanLane,
  classId: string,
  resolvedClasses: string[],
  preferredClasses: string[],
): number {
  const preferredIndex = preferredClasses.indexOf(classId);
  if (preferredIndex >= 0) {
    return preferredIndex;
  }
  const resolvedIndex = resolvedClasses.indexOf(classId);
  return resolvedIndex >= 0 ? resolvedIndex + 100 : 999;
}

function resolveV2ExerciseClassIdsInPreferenceOrder(
  taxonomy: V2ExerciseClassTaxonomy,
  classNames: string[],
): string[] {
  const resolved: string[] = [];
  for (const className of classNames) {
    const normalizedClassName = normalizeV2MaterializationText(className).replace(
      /\s+/g,
      "_",
    );
    for (const classId of taxonomy.classAliases[normalizedClassName] ?? []) {
      if (!resolved.includes(classId)) {
        resolved.push(classId);
      }
    }
  }
  return resolved;
}

function directnessForLane(lane: PlanLane, match: V2ExerciseClassMatch): number {
  const targetMuscles = lane.directFloor
    ? [lane.directFloor.muscle]
    : lane.primaryMuscles;
  return targetMuscles.some((muscle) => match.directMuscles.includes(muscle))
    ? 0
    : 1;
}

function identityPreservationScore(input: {
  slotId: string;
  laneId: string;
  exerciseId: string;
  carryForwardExerciseIds: Record<string, string[]>;
  identityPreservationMode:
    | NonNullable<
        V2ExerciseMaterializationInput["continuity"]
      >["identityPreservationMode"]
    | undefined;
}): number {
  if (input.identityPreservationMode !== "preserve_exact_lane_identity") {
    return 0;
  }
  const scopedLaneKey = `${input.slotId}:${input.laneId}`;
  const carryForwardIds = [
    ...(input.carryForwardExerciseIds[scopedLaneKey] ?? []),
    ...(input.carryForwardExerciseIds[input.laneId] ?? []),
  ];
  return carryForwardIds.includes(input.exerciseId) ? 0 : 1;
}

function chestSupportStimulusScore(
  lane: PlanLane,
  match: V2ExerciseClassMatch,
  exercise: V2MaterializationExercise,
): number {
  if (!isChestBiasedPressSupportLane(lane)) {
    return 0;
  }
  const chestStimulus = inferredStimulusForMuscle(exercise, match, "Chest");
  if (chestStimulus >= 0.75) {
    return 0;
  }
  if (chestStimulus >= 0.5) {
    return 1;
  }
  if (chestStimulus > 0) {
    return 2;
  }
  return 3;
}

function isChestBiasedPressSupportLane(lane: PlanLane): boolean {
  const classNames = [
    ...lane.acceptableExerciseClasses,
    ...lane.preferredExerciseClasses,
  ].map(normalizeV2MaterializationText);
  const ownsChest = lane.primaryMuscles.some(
    (muscle) =>
      normalizeV2MaterializationText(muscle) ===
      normalizeV2MaterializationText("Chest"),
  );
  const canSelectChestPress = classNames.some((className) =>
    [
      "distinct chest press or fly",
      "horizontal press",
      "slight incline press",
      "machine press",
      "cable press",
    ].includes(className),
  );
  const canSelectVerticalPress = classNames.includes("vertical press");
  return ownsChest && canSelectChestPress && canSelectVerticalPress;
}

function laneIntentPreferenceScore(
  lane: PlanLane,
  match: V2ExerciseClassMatch,
  exercise: V2MaterializationExercise,
): number {
  const targetStimulus = averageTargetStimulus(lane, match, exercise);
  const lowerBackStimulus = stimulusForMuscle(exercise, "Lower Back");
  const targetsLowerBack = targetMusclesForLane(lane, match).some(
    (muscle) =>
      normalizeV2MaterializationText(muscle) ===
      normalizeV2MaterializationText("Lower Back"),
  );

  return (
    (targetStimulus >= 0.75 ? 0 : 2) +
    (exercise.isMainLiftEligible ? 2 : 0) +
    (!targetsLowerBack && lowerBackStimulus >= 0.5 ? 1 : 0)
  );
}

function stimulusToFatigueScore(
  lane: PlanLane,
  match: V2ExerciseClassMatch,
  exercise: V2MaterializationExercise,
): number {
  const fatigue = Math.max(exercise.fatigueCost ?? 1, 0.5);
  return -roundToThousandth(averageTargetStimulus(lane, match, exercise) / fatigue);
}

function averageTargetStimulus(
  lane: PlanLane,
  match: V2ExerciseClassMatch,
  exercise: V2MaterializationExercise,
): number {
  const muscles = targetMusclesForLane(lane, match);
  if (!muscles.length) {
    return 0;
  }
  return (
    muscles.reduce(
      (total, muscle) => total + inferredStimulusForMuscle(exercise, match, muscle),
      0,
    ) / muscles.length
  );
}

function targetMusclesForLane(
  lane: PlanLane,
  match: V2ExerciseClassMatch,
): string[] {
  if (lane.directFloor) {
    return [lane.directFloor.muscle];
  }
  if (lane.primaryMuscles.length) {
    return lane.primaryMuscles;
  }
  return match.directMuscles;
}

function inferredStimulusForMuscle(
  exercise: V2MaterializationExercise,
  match: V2ExerciseClassMatch,
  muscle: string,
): number {
  const explicitStimulus = stimulusForMuscle(exercise, muscle);
  if (explicitStimulus > 0) {
    return explicitStimulus;
  }
  const normalizedMuscle = normalizeV2MaterializationText(muscle);
  if (
    exercise.primaryMuscles.some(
      (primary) => normalizeV2MaterializationText(primary) === normalizedMuscle,
    )
  ) {
    return 1;
  }
  if (
    match.directMuscles.some(
      (direct) => normalizeV2MaterializationText(direct) === normalizedMuscle,
    )
  ) {
    return 0.75;
  }
  if (
    exercise.secondaryMuscles.some(
      (secondary) =>
        normalizeV2MaterializationText(secondary) === normalizedMuscle,
    )
  ) {
    return 0.5;
  }
  return 0;
}

function stimulusForMuscle(
  exercise: V2MaterializationExercise,
  muscle: string,
): number {
  const normalizedMuscle = normalizeV2MaterializationText(muscle);
  return (
    Object.entries(exercise.stimulusByMusclePerSet).find(
      ([entryMuscle]) =>
        normalizeV2MaterializationText(entryMuscle) === normalizedMuscle,
    )?.[1] ?? 0
  );
}

function roundToThousandth(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return (
    left.preferredClassOrder - right.preferredClassOrder ||
    left.directness - right.directness ||
    left.identityPreservation - right.identityPreservation ||
    left.chestSupportStimulus - right.chestSupportStimulus ||
    left.laneIntent - right.laneIntent ||
    left.stimulusToFatigue - right.stimulusToFatigue ||
    left.fatigue - right.fatigue ||
    left.favorite - right.favorite ||
    left.normalizedName.localeCompare(right.normalizedName) ||
    left.exerciseId.localeCompare(right.exerciseId)
  );
}

function equipmentAvailable(
  exercise: V2MaterializationExercise,
  availableEquipment: string[] | undefined,
): boolean {
  if (!availableEquipment?.length) {
    return true;
  }
  const available = new Set(availableEquipment.map(normalizeV2MaterializationText));
  return exercise.equipment.every((equipment) =>
    available.has(normalizeV2MaterializationText(equipment)),
  );
}

function isDuplicate(
  candidate: Candidate,
  lane: PlanLane,
  slot: PlanSlot,
  selected: V2MaterializedSelection[],
): boolean {
  const scopedSelections = selected.filter((selection) => {
    if (lane.duplicatePolicy.scope === "same_slot") {
      return selection.slotId === slot.slotId;
    }
    return true;
  });
  return scopedSelections.some(
    (selection) =>
      selection.exerciseId === candidate.exercise.exerciseId ||
      selection.duplicateFamily === candidate.match.duplicateFamily,
  );
}

function shouldSkipLaneByPolicy(lane: PlanLane): boolean {
  return (
    lane.setBudget.preferred <= 0 ||
    lane.classLaneKind === "managed_collateral_marker" ||
    (lane.classLaneKind === "optional_recoverable_lane" &&
      lane.setBudget.preferred <= 0)
  );
}

function isNonRequiredMaterializationLane(lane: PlanLane): boolean {
  return (
    lane.requirement === "optional" ||
    lane.requirement === "conditional_optional" ||
    lane.classLaneKind === "optional_recoverable_lane" ||
    lane.classLaneKind === "managed_collateral_marker" ||
    lane.setBudget.preferred <= 0
  );
}
