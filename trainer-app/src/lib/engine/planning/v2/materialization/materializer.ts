import type {
  V2ExerciseClassMatch,
  V2ExerciseClassTaxonomy,
  V2ExerciseMaterializationInput,
  V2ExerciseMaterializationPlan,
  V2MaterializationDiagnosticLaneSelectionIntentOverride,
  V2MaterializationExercise,
  V2MaterializedSelection,
} from "./types";
import {
  isV2LaneSelectionIntentConsumedByMaterializer,
  type V2LaneSelectionIntentV0,
  type V2LaneSelectionIntentExerciseClass,
  type V2LaneSelectionIntentMovementPattern,
} from "../lane-selection-intent";
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
  anchorVariantFit: number;
  userPreferredAnchor: number;
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
  const diagnosticLaneIntentOverride =
    resolveDiagnosticLaneSelectionIntentOverride(
      input.diagnosticLaneSelectionIntentOverride,
    );
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
        diagnosticLaneIntentOverride,
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
  diagnosticLaneIntentOverride: ReadonlySet<string>;
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
    consumedLaneSelectionIntent: consumedLaneSelectionIntentForLane({
      lane: input.lane,
      scopedLaneId: scopedLaneId(input.slot.slotId, input.lane.laneId),
      diagnosticLaneIntentOverride: input.diagnosticLaneIntentOverride,
    }),
  });
  if (!classCandidates.length) {
    return { kind: "unmaterialized", reason: "no_class_match" };
  }

  const consumedLaneSelectionIntent = consumedLaneSelectionIntentForLane({
    lane: input.lane,
    scopedLaneId: scopedLaneId(input.slot.slotId, input.lane.laneId),
    diagnosticLaneIntentOverride: input.diagnosticLaneIntentOverride,
  });
  const intentCandidates = consumedLaneSelectionIntent
    ? filterCandidatesByLaneSelectionIntent({
        lane: input.lane,
        intent: consumedLaneSelectionIntent,
        candidates: classCandidates,
      })
    : classCandidates;
  if (!intentCandidates.length) {
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
    ? intentCandidates.filter(
        (candidate) =>
          candidate.match.directMuscles.includes(
            input.lane.directFloor?.muscle ?? "",
          ) &&
          (!directFloorClassIds.length ||
            directFloorClassIds.includes(candidate.match.classId)),
      )
    : intentCandidates;
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

function resolveDiagnosticLaneSelectionIntentOverride(
  override:
    | V2MaterializationDiagnosticLaneSelectionIntentOverride
    | undefined,
): ReadonlySet<string> {
  if (
    !override ||
    override.version !== 1 ||
    override.source !==
      "v2_materializer_diagnostic_lane_selection_intent_override" ||
    override.readOnly !== true ||
    override.affectsScoringOrGeneration !== false ||
    override.dryRunOnly !== true ||
    override.reason !== "read_only_materializer_comparison_trial"
  ) {
    return new Set();
  }
  return new Set(override.consumeScopedLaneIds);
}

function consumedLaneSelectionIntentForLane(input: {
  lane: PlanLane;
  scopedLaneId?: string;
  diagnosticLaneIntentOverride?: ReadonlySet<string>;
}): V2LaneSelectionIntentV0 | undefined {
  if (isV2LaneSelectionIntentConsumedByMaterializer(input.lane)) {
    return input.lane.laneSelectionIntent;
  }
  if (
    input.scopedLaneId &&
    input.diagnosticLaneIntentOverride?.has(input.scopedLaneId)
  ) {
    return input.lane.laneSelectionIntent;
  }
  return undefined;
}

function filterCandidatesByLaneSelectionIntent(input: {
  lane: PlanLane;
  intent: V2LaneSelectionIntentV0;
  candidates: Candidate[];
}): Candidate[] {
  return input.candidates.filter((candidate) =>
    candidateSatisfiesLaneSelectionIntent({
      ...input,
      candidate,
    }),
  );
}

function candidateSatisfiesLaneSelectionIntent(input: {
  lane: PlanLane;
  intent: V2LaneSelectionIntentV0;
  candidate: Candidate;
}): boolean {
  const { lane, intent, candidate } = input;
  if (!classAllowedByLaneSelectionIntent(intent, candidate.match)) {
    return false;
  }
  if (classDisallowedByLaneSelectionIntent(intent, candidate)) {
    return false;
  }
  if (!matchesRequiredMovementPattern(candidate.exercise, intent.requiredMovementPattern)) {
    return false;
  }
  if (!satisfiesLaneIntentDirectness({ lane, intent, candidate })) {
    return false;
  }
  if (
    intent.minimumTargetStimulus &&
    inferredStimulusForMuscle(
      candidate.exercise,
      candidate.match,
      intent.minimumTargetStimulus.muscle,
    ) < intent.minimumTargetStimulus.minimumPerSetStimulus
  ) {
    return false;
  }
  return true;
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
  consumedLaneSelectionIntent?: V2LaneSelectionIntentV0;
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
        anchorVariantFit: anchorVariantFitScore(input.lane, exercise),
        userPreferredAnchor: userPreferredAnchorScore(
          input.lane,
          exercise.exerciseId,
          input.favoriteExerciseIds,
        ),
        laneIntent: laneIntentPreferenceScore(
          input.lane,
          match,
          exercise,
          input.consumedLaneSelectionIntent,
        ),
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

function userPreferredAnchorScore(
  lane: PlanLane,
  exerciseId: string,
  favoriteExerciseIds: ReadonlySet<string>,
): number {
  if (!isUserPreferredAnchorLane(lane)) {
    return 1;
  }
  return favoriteExerciseIds.has(exerciseId) ? 0 : 1;
}

function isUserPreferredAnchorLane(lane: PlanLane): boolean {
  return lane.role === "anchor" && (
    lane.laneId === "chest_anchor" || lane.laneId === "squat_anchor"
  );
}

function anchorVariantFitScore(
  lane: PlanLane,
  exercise: V2MaterializationExercise,
): number {
  if (lane.laneId !== "chest_anchor") {
    return 0;
  }

  const classNames = [
    ...lane.acceptableExerciseClasses,
    ...lane.preferredExerciseClasses,
  ].map(normalizeV2MaterializationText);
  const inclineLane =
    classNames.includes("slight incline press") &&
    !classNames.includes("horizontal press");
  const flatLane =
    classNames.includes("horizontal press") &&
    !classNames.includes("slight incline press");
  const inclineExercise = isInclineChestPress(exercise);

  if (inclineLane) {
    return inclineExercise ? 0 : 1;
  }
  if (flatLane) {
    return inclineExercise ? 1 : 0;
  }
  return 0;
}

function isInclineChestPress(exercise: V2MaterializationExercise): boolean {
  const text = normalizedExerciseText(exercise);
  return (
    hasAnyMovementPattern(exercise, ["slight_incline_press", "incline_press"]) ||
    hasAnyNormalizedPhrase(text, ["incline", "slight incline"])
  );
}

function laneIntentPreferenceScore(
  lane: PlanLane,
  match: V2ExerciseClassMatch,
  exercise: V2MaterializationExercise,
  consumedLaneSelectionIntent?: V2LaneSelectionIntentV0,
): number {
  if (consumedLaneSelectionIntent) {
    return laneSelectionIntentRankingScore(
      consumedLaneSelectionIntent,
      match,
      exercise,
    );
  }

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

function scopedLaneId(slotId: string, laneId: string): string {
  return `${slotId}:${laneId}`;
}

function laneSelectionIntentRankingScore(
  intent: V2LaneSelectionIntentV0,
  match: V2ExerciseClassMatch,
  exercise: V2MaterializationExercise,
): number {
  const targetStimulus = intent.minimumTargetStimulus
    ? inferredStimulusForMuscle(
        exercise,
        match,
        intent.minimumTargetStimulus.muscle,
      )
    : averageTargetStimulusFromIntent(intent, match, exercise);
  const fatigue = exercise.fatigueCost ?? 1;
  let score = targetStimulus >= 0.9 ? 0 : targetStimulus >= 0.75 ? 1 : 3;

  if (
    (intent.stabilityPreference === "stable_preferred" ||
      intent.loadabilityPreference) &&
    !hasStableLoadableSignal(exercise)
  ) {
    score += 1;
  }
  if (
    intent.fatiguePreference &&
    lowerBackOrSystemicFatiguePenalty(intent, exercise) > 0
  ) {
    score += lowerBackOrSystemicFatiguePenalty(intent, exercise);
  }
  if (intent.requiredMovementPattern === "chest_press" && isFlyLikeExercise(exercise)) {
    score += 2;
  }
  if (fatigue <= 1.5) {
    score -= 1;
  }
  return score;
}

function averageTargetStimulusFromIntent(
  intent: V2LaneSelectionIntentV0,
  match: V2ExerciseClassMatch,
  exercise: V2MaterializationExercise,
): number {
  const muscles = match.directMuscles.length ? match.directMuscles : [];
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

function classAllowedByLaneSelectionIntent(
  intent: V2LaneSelectionIntentV0,
  match: V2ExerciseClassMatch,
): boolean {
  const allowedClassIds = new Set(
    intent.allowedExerciseClasses.flatMap(classIdsForLaneSelectionIntentClass),
  );
  return allowedClassIds.size === 0 || allowedClassIds.has(match.classId);
}

function classDisallowedByLaneSelectionIntent(
  intent: V2LaneSelectionIntentV0,
  candidate: Candidate,
): boolean {
  const disallowed = intent.disallowedExerciseClasses ?? [];
  if (!disallowed.length) {
    return false;
  }
  const disallowedClassIds = new Set(disallowed.flatMap(classIdsForLaneSelectionIntentClass));
  if (disallowedClassIds.has(candidate.match.classId)) {
    return true;
  }
  return disallowed.some((exerciseClass) =>
    exerciseTextMatchesLaneSelectionIntentClass(candidate.exercise, exerciseClass),
  );
}

function classIdsForLaneSelectionIntentClass(
  exerciseClass: V2LaneSelectionIntentExerciseClass,
): string[] {
  switch (exerciseClass) {
    case "chest_biased_press_support":
    case "chest_fly":
    case "chest_press":
      return ["distinct_chest_press_or_fly"];
    case "hamstring_curl":
      return ["knee_flexion_curl"];
    case "vertical_pull":
    case "chin_up":
      return ["vertical_pull"];
    case "row":
    case "row_only":
      return ["horizontal_pull_support"];
    case "hinge":
      return ["hinge_compound"];
    case "hip_thrust":
    case "low_axial_hip_extension_anchor":
      return ["low_axial_hip_extension_anchor"];
    case "shoulder_biased_press":
    case "vertical_press":
      return ["vertical_press"];
    case "quad_isolation":
      return ["quad_isolation"];
    case "squat_pattern":
    case "leg_press":
    case "lunge":
      return ["squat_pattern"];
    case "calf_isolation":
      return ["calf_isolation"];
    case "lateral_raise":
      return ["lateral_raise"];
    case "rear_delt_isolation":
      return ["rear_delt_isolation"];
    case "triceps_isolation":
      return ["triceps_isolation"];
    case "biceps_isolation":
      return ["biceps_isolation"];
    case "back_extension":
    case "pullover":
    case "straight_arm_pulldown":
    case "shrug":
      return [];
  }
}

function exerciseTextMatchesLaneSelectionIntentClass(
  exercise: V2MaterializationExercise,
  exerciseClass: V2LaneSelectionIntentExerciseClass,
): boolean {
  const text = normalizedExerciseText(exercise);
  switch (exerciseClass) {
    case "back_extension":
      return (
        hasAnyNormalizedPhrase(text, ["back extension", "hyperextension"]) &&
        !hasAnyNormalizedPhrase(text, ["reverse hyper", "reverse hyperextension"])
      );
    case "pullover":
      return hasAnyNormalizedPhrase(text, ["pullover", "pull over"]);
    case "straight_arm_pulldown":
      return hasAnyNormalizedPhrase(text, ["straight arm pulldown", "straight arm"]);
    case "hip_thrust":
      return hasAnyNormalizedPhrase(text, ["hip thrust", "glute bridge"]);
    case "low_axial_hip_extension_anchor":
      return hasAnyNormalizedPhrase(text, [
        "hip thrust",
        "glute bridge",
        "pull through",
        "pull-through",
        "reverse hyper",
        "reverse hyperextension",
      ]);
    case "hinge":
      return hasAnyMovementPattern(exercise, ["hinge"]) ||
        hasAnyNormalizedPhrase(text, ["deadlift", "rdl", "stiff leg", "good morning"]);
    case "row":
      return hasAnyMovementPattern(exercise, ["row", "horizontal_pull"]) ||
        hasAnyNormalizedPhrase(text, ["row"]);
    case "row_only":
      return hasAnyNormalizedPhrase(text, ["row"]);
    case "chest_fly":
      return hasAnyMovementPattern(exercise, ["fly"]) ||
        hasAnyNormalizedPhrase(text, ["fly", "crossover", "pec deck"]);
    case "shoulder_biased_press":
      return hasAnyMovementPattern(exercise, ["vertical_press", "overhead_press"]) ||
        hasAnyNormalizedPhrase(text, ["landmine press", "shoulder press", "overhead press"]);
    case "shrug":
      return hasAnyNormalizedPhrase(text, ["shrug"]);
    default:
      return false;
  }
}

function matchesRequiredMovementPattern(
  exercise: V2MaterializationExercise,
  requiredPattern: V2LaneSelectionIntentMovementPattern,
): boolean {
  const text = normalizedExerciseText(exercise);
  switch (requiredPattern) {
    case "vertical_pull":
      return (
        hasAnyMovementPattern(exercise, ["vertical_pull"]) ||
        hasAnyNormalizedPhrase(text, [
          "pulldown",
          "pull down",
          "pull up",
          "pullup",
          "assisted pull",
          "chin up",
          "chinup",
        ])
      );
    case "chest_press":
      return (
        hasAnyMovementPattern(exercise, [
          "press",
          "horizontal_press",
          "slight_incline_press",
          "incline_press",
        ]) ||
        hasAnyNormalizedPhrase(text, [
          "chest press",
          "incline press",
          "decline press",
          "bench press",
          "machine press",
          "iso lateral press",
        ])
      );
    case "chest_press_or_fly":
      return (
        matchesRequiredMovementPattern(exercise, "chest_press") ||
        hasAnyMovementPattern(exercise, ["fly"]) ||
        hasAnyNormalizedPhrase(text, ["fly", "crossover", "pec deck"])
      );
    case "knee_flexion":
      return (
        hasAnyMovementPattern(exercise, ["knee_flexion", "flexion", "isolation"]) ||
        hasAnyNormalizedPhrase(text, ["leg curl", "hamstring curl", "nordic"])
      );
    case "low_axial_hip_extension":
      return hasAnyNormalizedPhrase(text, [
        "hip thrust",
        "glute bridge",
        "pull through",
        "pull-through",
        "reverse hyper",
        "reverse hyperextension",
      ]);
    case "calf_raise":
      return hasAnyMovementPattern(exercise, ["isolation"]) ||
        hasAnyNormalizedPhrase(text, ["calf raise"]);
    case "elbow_extension":
      return hasAnyNormalizedPhrase(text, ["extension", "pressdown", "pushdown"]);
    case "elbow_flexion":
      return hasAnyNormalizedPhrase(text, ["curl"]);
    case "horizontal_pull":
      return hasAnyMovementPattern(exercise, ["row", "horizontal_pull"]) ||
        hasAnyNormalizedPhrase(text, ["row"]);
    case "knee_extension":
      return hasAnyMovementPattern(exercise, ["isolation", "knee_extension"]) ||
        hasAnyNormalizedPhrase(text, ["leg extension", "quad extension"]);
    case "rear_delt_fly":
    case "shoulder_horizontal_abduction":
      return hasAnyNormalizedPhrase(text, [
        "rear delt",
        "reverse fly",
        "reverse pec deck",
        "face pull",
      ]);
    case "shoulder_abduction":
      return hasAnyNormalizedPhrase(text, ["lateral raise"]) ||
        hasAnyMovementPattern(exercise, ["isolation"]);
  }
}

function satisfiesLaneIntentDirectness(input: {
  lane: PlanLane;
  intent: V2LaneSelectionIntentV0;
  candidate: Candidate;
}): boolean {
  const targetMuscle =
    input.intent.minimumTargetStimulus?.muscle ??
    input.lane.directFloor?.muscle ??
    input.lane.primaryMuscles[0];
  if (!targetMuscle) {
    return true;
  }
  const stimulus = inferredStimulusForMuscle(
    input.candidate.exercise,
    input.candidate.match,
    targetMuscle,
  );
  const directMuscle = input.candidate.match.directMuscles.some(
    (muscle) =>
      normalizeV2MaterializationText(muscle) ===
      normalizeV2MaterializationText(targetMuscle),
  );

  if (input.intent.directnessRequirement === "direct_only") {
    return directMuscle && stimulus >= 0.75;
  }
  if (input.intent.directnessRequirement === "high_directness") {
    return stimulus >= 0.75;
  }
  return directMuscle || stimulus >= 0.75;
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

function normalizedExerciseText(exercise: V2MaterializationExercise): string {
  return [
    exercise.name,
    ...(exercise.aliases ?? []),
    ...exercise.movementPatterns,
    ...exercise.equipment,
  ]
    .map(normalizeV2MaterializationText)
    .filter(Boolean)
    .join(" ");
}

function hasAnyMovementPattern(
  exercise: V2MaterializationExercise,
  patterns: string[],
): boolean {
  const normalizedPatterns = exercise.movementPatterns.map(
    normalizeV2MaterializationText,
  );
  return patterns.some((pattern) =>
    normalizedPatterns.includes(normalizeV2MaterializationText(pattern)),
  );
}

function hasAnyNormalizedPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => hasNormalizedPhrase(text, phrase));
}

function hasNormalizedPhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = normalizeV2MaterializationText(phrase);
  if (!normalizedPhrase) {
    return false;
  }
  return new RegExp(`(?:^| )${escapeRegExp(normalizedPhrase)}(?: |$)`).test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasStableLoadableSignal(exercise: V2MaterializationExercise): boolean {
  const text = normalizedExerciseText(exercise);
  return (
    hasAnyNormalizedPhrase(text, [
      "machine",
      "selectorized",
      "plate loaded",
      "iso lateral",
      "cable",
      "bench",
      "pull up",
      "pullup",
      "chin up",
      "chinup",
      "seated",
      "lying",
    ]) ||
    exercise.equipment.some((equipment) =>
      ["machine", "cable", "barbell", "dumbbell"].includes(
        normalizeV2MaterializationText(equipment),
      ),
    )
  );
}

function isFlyLikeExercise(exercise: V2MaterializationExercise): boolean {
  const text = normalizedExerciseText(exercise);
  return (
    hasAnyMovementPattern(exercise, ["fly"]) ||
    hasAnyNormalizedPhrase(text, ["fly", "crossover", "pec deck"])
  );
}

function lowerBackOrSystemicFatiguePenalty(
  intent: V2LaneSelectionIntentV0,
  exercise: V2MaterializationExercise,
): number {
  const lowerBackStimulus = stimulusForMuscle(exercise, "Lower Back");
  const fatigue = exercise.fatigueCost ?? 1;
  if (intent.fatiguePreference === "low_axial") {
    return (lowerBackStimulus >= 0.25 ? 2 : 0) + (fatigue >= 3 ? 1 : 0);
  }
  if (intent.fatiguePreference === "low_systemic") {
    return fatigue >= 3 ? 2 : 0;
  }
  if (intent.fatiguePreference === "moderate_or_low") {
    return fatigue >= 4 ? 2 : fatigue >= 3 ? 1 : 0;
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
    left.anchorVariantFit - right.anchorVariantFit ||
    left.userPreferredAnchor - right.userPreferredAnchor ||
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
