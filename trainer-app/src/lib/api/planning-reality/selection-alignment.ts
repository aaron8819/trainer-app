import { roundToTenth } from "../mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import type { DistributionGuardAction } from "../mesocycle-handoff-slot-plan-projection.repair-engine";
import type { DuplicateExerciseReuseDiagnostic } from "../mesocycle-handoff-slot-plan-projection.weekly-obligations";
import { SESSION_CAPS } from "../template-session/selection-adapter";
import type {
  AccumulationWeekProjection,
  ActiveMesocycleForDiagnostics,
  CleanPreselectionFeasibility,
  DuplicateContinuityJustification,
  ExerciseClassAlignment,
  ExerciseClassDistributionBySlot,
  ExerciseClassUnresolvedCause,
  ExerciseConcentrationDiagnostic,
  ProjectedDeliveryDiagnostic,
  SetDistributionIntent,
  ShadowRepairMaterialityDiagnostic,
  SlotCompositionSnapshotDiagnostic,
  SlotDemandAllocationByWeek,
  SlotPrescriptionIntent,
  SuspiciousRepairNotEligibleForPromotion,
  WeakPreselectionConsumptionDiagnostic,
  DiagnosticExercise,
} from "./types";
import { normalizeMuscle } from "./shared-evidence";
import { normalizeExerciseMuscles } from "./repair-materiality";
import {
  findDuplicateRowsForMuscle,
  formatNullableNumber,
  getDiagnosticMesocycleId,
  sortPrescriptionStrings,
  uniqueSorted,
  type MusclePrescription,
  type SetDistributionPolicy,
} from "./planner-intent";
type ExerciseClassDistributionMuscle =
  ExerciseClassDistributionBySlot["muscleDemands"][number];

const DUPLICATE_JUSTIFICATION_EXERCISE_NAMES = [
  "Incline DB Bench",
  "Lat Pulldown",
  "SLDL",
  "Stiff-Legged Deadlift",
  "Barbell Back Squat",
] as const;

const EXERCISE_CLASS_DIAGNOSTIC_MUSCLES = new Set([
  "Chest",
  "Hamstrings",
  "Side Delts",
  "Rear Delts",
  "Triceps",
  "Calves",
  "Lats",
  "Quads",
]);

export function shouldIncludeExerciseClassDemand(input: {
  prescription: MusclePrescription;
  slotId: string;
}): boolean {
  if (!EXERCISE_CLASS_DIAGNOSTIC_MUSCLES.has(input.prescription.muscle)) {
    return false;
  }
  if (input.prescription.targetStatus === "diagnostic") {
    return false;
  }
  if (input.prescription.targetStatus === "forbidden") {
    return input.prescription.muscle === "Chest";
  }
  return true;
}

export function toExerciseClassProjectionStatus(
  status: SlotDemandAllocationByWeek["weeks"][number]["projectionStatus"],
): ExerciseClassDistributionBySlot["projectionStatus"] {
  switch (status) {
    case "allocated_from_current_week_evidence":
      return "projected_from_current_evidence";
    case "partially_allocated_from_weekly_demand_curve":
      return "partially_projected_missing_policy";
    case "not_allocated_missing_weekly_projection":
    case "not_allocated_missing_deload_policy":
      return "not_projected_missing_policy";
  }
}

export function toExerciseClassSetSplit(input: {
  prescription: MusclePrescription;
  policy: SetDistributionPolicy | undefined;
  slotId: string;
}): ExerciseClassDistributionMuscle["preferredSetSplit"] {
  if (input.prescription.targetStatus === "forbidden") {
    return "forbidden";
  }
  if (
    input.prescription.targetStatus === "diagnostic" ||
    input.prescription.demandType === "diagnostic_only"
  ) {
    return "diagnostic_only";
  }
  if (input.prescription.muscle === "Hamstrings" && input.slotId === "lower_b") {
    return "anchor_plus_isolation";
  }
  switch (input.policy?.preferredDistribution) {
    case "single_anchor_plus_accessory":
      return "anchor_plus_isolation";
    case "two_exercise_split":
      return "two_distinct_exercises";
    case "overlap_first":
    case "direct_isolation_only_if_needed":
      return "overlap_first_then_isolation";
    case "diagnostic_only":
      return "diagnostic_only";
    case "forbidden":
      return "forbidden";
    case undefined:
      return input.prescription.role === "primary"
        ? "single_anchor"
        : "overlap_first_then_isolation";
  }
}

export function getExerciseClassPreferredClasses(
  prescription: MusclePrescription,
): string[] {
  switch (prescription.muscle) {
    case "Chest":
      return prescription.targetStatus === "forbidden"
        ? []
        : [
            "press",
            "horizontal_press",
            "incline_press",
            "machine_press",
            "chest_fly",
            "cable_fly",
            "chest_isolation",
          ];
    case "Hamstrings":
      return prescription.targetStatus === "forbidden"
        ? []
        : [
            "hinge_compound",
            "stiff_leg_deadlift",
            "romanian_deadlift",
            "knee_flexion_curl",
            "leg_curl",
            "nordic_curl",
          ];
    case "Side Delts":
      return prescription.targetStatus === "forbidden"
        ? []
        : [
            "lateral_raise",
            "cable_lateral_raise",
            "machine_lateral_raise",
            "vertical_press_overlap",
          ];
    case "Rear Delts":
      return prescription.targetStatus === "forbidden"
        ? []
        : [
            "rear_delt_isolation",
            "reverse_fly",
            "face_pull",
            "pull_overlap_with_direct_rear_delt_stimulus",
          ];
    case "Triceps":
      return prescription.targetStatus === "forbidden"
        ? []
        : ["press_overlap", "triceps_isolation_if_under_floor"];
    case "Calves":
      return prescription.targetStatus === "forbidden"
        ? []
        : ["calf_raise", "standing_calf_raise", "seated_calf_raise"];
    default:
      return prescription.allowedExerciseClasses;
  }
}

export function getExerciseClassRequiredClasses(input: {
  prescription: MusclePrescription;
  slotId: string;
}): string[] {
  if (input.prescription.targetStatus !== "hard") {
    return [];
  }
  if (input.prescription.muscle === "Hamstrings" && input.slotId === "lower_b") {
    return ["hinge_compound", "knee_flexion_curl"];
  }
  if (
    input.prescription.muscle === "Chest" &&
    input.prescription.demandType === "direct_required"
  ) {
    return ["press"];
  }
  return input.prescription.demandType === "direct_required"
    ? input.prescription.allowedExerciseClasses
    : [];
}

export function getExerciseClassForbiddenClasses(
  prescription: MusclePrescription,
): string[] {
  const base = [...prescription.forbiddenExerciseClasses];
  switch (prescription.muscle) {
    case "Chest":
      return prescription.targetStatus === "forbidden"
        ? uniqueSorted([
            ...base,
            "press",
            "horizontal_press",
            "incline_press",
            "machine_press",
            "chest_fly",
            "cable_fly",
            "chest_isolation",
          ])
        : base;
    case "Hamstrings":
      return uniqueSorted([...base, "back_extension", "dirty_extension"]);
    case "Side Delts":
      return uniqueSorted([
        ...base,
        "high_collateral_overhead_press",
        "duplicate_lateral_raise_variant",
      ]);
    case "Rear Delts":
      return uniqueSorted([
        ...base,
        "generic_upper_back_row_as_clean_rear_delt_closure",
      ]);
    case "Calves":
      return uniqueSorted([
        ...base,
        "same_session_duplicate_calf_isolation",
      ]);
    default:
      return base;
  }
}

export function getExerciseClassPreferredPatterns(
  prescription: MusclePrescription,
): string[] {
  switch (prescription.muscle) {
    case "Hamstrings":
      return prescription.targetStatus === "forbidden"
        ? []
        : uniqueSorted([...prescription.allowedPatterns, "knee_flexion"]);
    case "Side Delts":
      return prescription.targetStatus === "forbidden"
        ? []
        : uniqueSorted([...prescription.allowedPatterns, "low_collateral_isolation"]);
    default:
      return prescription.allowedPatterns;
  }
}

export function getExerciseClassForbiddenPatterns(
  prescription: MusclePrescription,
): string[] {
  if (prescription.muscle === "Hamstrings") {
    return uniqueSorted([...prescription.forbiddenPatterns, "extension"]);
  }
  if (prescription.muscle === "Side Delts") {
    return uniqueSorted([
      ...prescription.forbiddenPatterns,
      "high_collateral_vertical_push_overconcentration",
    ]);
  }
  return prescription.forbiddenPatterns;
}

export function exerciseClassMatchesMuscle(
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number],
  muscle: string,
): boolean {
  const effectiveStimulus =
    exercise.effectiveStimulusByMuscle ?? {};
  return (
    (exercise.primaryMuscles ?? []).map(normalizeMuscle).includes(muscle) ||
    Object.prototype.hasOwnProperty.call(
      effectiveStimulus,
      muscle,
    )
  );
}

export function findSelectedExerciseClassEvidence(input: {
  slot: SlotCompositionSnapshotDiagnostic | undefined;
  muscle: string;
}): string[] {
  if (!input.slot) {
    return [];
  }
  return input.slot.exercises
    .filter((exercise) => exerciseClassMatchesMuscle(exercise, input.muscle))
    .map((exercise) => {
      const movementPatterns =
        (exercise as { movementPatterns?: string[] }).movementPatterns ?? [];
      const patterns = movementPatterns.length > 0
        ? movementPatterns.join("+")
        : "unknown";
      return `selected:${exercise.exerciseName}:patterns=${patterns}:sets=${exercise.setCount}`;
    });
}

export function findRepeatedExerciseEvidence(
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>,
): Map<string, string[]> {
  const byExercise = new Map<
    string,
    { name: string; slotIds: Set<string>; role: "main" | "accessory" }
  >();
  for (const slot of finalSlotPlan) {
    for (const exercise of slot.exercises) {
      if (
        !DUPLICATE_JUSTIFICATION_EXERCISE_NAMES.some(
          (name) => exercise.exerciseName === name,
        )
      ) {
        continue;
      }
      const existing =
        byExercise.get(exercise.exerciseId) ??
        {
          name: exercise.exerciseName,
          slotIds: new Set<string>(),
          role: exercise.role,
        };
      existing.slotIds.add(slot.slotId);
      if (exercise.role === "main") {
        existing.role = "main";
      }
      byExercise.set(exercise.exerciseId, existing);
    }
  }

  const evidenceBySlot = new Map<string, string[]>();
  for (const row of byExercise.values()) {
    if (row.slotIds.size <= 1) {
      continue;
    }
    const slots = Array.from(row.slotIds).sort((left, right) =>
      left.localeCompare(right),
    );
    for (const slotId of slots) {
      evidenceBySlot.set(slotId, [
        ...(evidenceBySlot.get(slotId) ?? []),
        `duplicate_class:${row.name}:slots=${slots.join("+")}:role=${row.role}:requires_explicit_justification`,
      ]);
    }
  }
  return evidenceBySlot;
}

export function getExerciseClassDuplicateJustifications(input: {
  prescription: MusclePrescription;
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  selectedExerciseEvidence: ReadonlyArray<string>;
  slotId: string;
}): ExerciseClassDistributionMuscle["duplicateJustifications"] {
  const justifications = new Set<
    ExerciseClassDistributionMuscle["duplicateJustifications"][number]
  >();
  if (
    input.prescription.muscle === "Chest" &&
    input.slotId === "upper_a" &&
    input.selectedExerciseEvidence.some(
      (row) =>
        row.includes("Incline") &&
        (row.includes("Bench") || row.includes("Press")),
    )
  ) {
    justifications.add("continuity_anchor");
  }
  for (const row of input.duplicateRows) {
    if (!row.hasCompatibleAlternative) {
      justifications.add("no_clean_alternative");
      justifications.add("limited_inventory");
    }
    if (row.reason.includes("exact_demand")) {
      justifications.add("exact_demand_fit");
    }
    if (row.reason.includes("preference")) {
      justifications.add("user_preference");
    }
    if (row.reason.includes("deload")) {
      justifications.add("deload_skill_preservation");
    }
    if (row.reason.includes("continuity")) {
      justifications.add("continuity_anchor");
    }
  }
  return Array.from(justifications).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function getExerciseClassDuplicatePolicy(input: {
  prescription: MusclePrescription;
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  repeatedExerciseEvidence: ReadonlyArray<string>;
}): ExerciseClassDistributionMuscle["duplicatePolicy"] {
  if (input.prescription.targetStatus === "forbidden") {
    return "block_if_clean_alternative_exists";
  }
  if (
    input.duplicateRows.some((row) => row.hasCompatibleAlternative) ||
    input.repeatedExerciseEvidence.length > 0
  ) {
    return "block_if_clean_alternative_exists";
  }
  if (
    input.prescription.muscle === "Chest" ||
    input.prescription.muscle === "Side Delts" ||
    input.prescription.muscle === "Calves"
  ) {
    return "discourage_if_alternative_exists";
  }
  return "allow_with_justification";
}

export function buildExerciseClassInventoryEvidence(input: {
  slotId: string;
  muscle: string;
  slot: SlotCompositionSnapshotDiagnostic | undefined;
  preselectionFeasibility: ReadonlyArray<CleanPreselectionFeasibility>;
  selectedExerciseEvidence: ReadonlyArray<string>;
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  repeatedExerciseEvidence: ReadonlyArray<string>;
}): string[] {
  const hamstringsInventory = input.preselectionFeasibility
    .filter(
      (row) => row.slotId === input.slotId && row.muscle === input.muscle,
    )
    .flatMap((row) =>
      row.candidateInventory.map(
        (candidate) =>
          `inventory:${candidate.exerciseName}:class=${candidate.candidateClass}:availability=${candidate.availability}`,
      ),
    );
  const duplicateEvidence = input.duplicateRows.map(
    (row) =>
      `duplicate:${row.name}:role=${row.role}:previous=${row.previousSlotIds.join("+")}:alternative=${row.hasCompatibleAlternative}`,
  );
  return uniqueSorted([
    ...input.selectedExerciseEvidence,
    ...hamstringsInventory,
    ...duplicateEvidence,
    ...input.repeatedExerciseEvidence,
    ...(input.slot
      ? [`slot_exercise_count:${input.slot.exerciseCount}`]
      : ["slot_final_plan_missing"]),
  ]);
}

export function buildExerciseClassRepairEvidence(input: {
  slotId: string;
  muscle: string;
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  concentrationRows: ReadonlyArray<ExerciseConcentrationDiagnostic>;
  weakPreselectionConsumption: ReadonlyArray<WeakPreselectionConsumptionDiagnostic>;
  preselectionFeasibility: ReadonlyArray<CleanPreselectionFeasibility>;
}): string[] {
  const repairEvidence = input.repairRows
    .filter((row) => row.slotId === input.slotId && row.muscle === input.muscle)
    .map(
      (row) =>
        `repair:${row.exerciseName ?? row.exerciseId ?? "unknown"}:${row.action}:${row.shadowAllocationBasis}`,
    );
  const concentrationEvidence = input.concentrationRows
    .filter(
      (row) =>
        row.slotId === input.slotId &&
        Object.prototype.hasOwnProperty.call(
          row.percentageOfWeeklyProjectedStimulusByMuscle,
          input.muscle,
        ),
    )
    .map(
      (row) =>
        `concentration:${row.exerciseName}:${input.muscle}:${roundToTenth(row.percentageOfWeeklyProjectedStimulusByMuscle[input.muscle])}%`,
    );
  const weakConsumptionEvidence = input.weakPreselectionConsumption
    .filter((row) => row.slotId === input.slotId && row.muscle === input.muscle)
    .map(
      (row) =>
        `weak_preselection_consumption:selected=${roundToTenth(row.selectedEffectiveSets)}:targetMet=${row.targetMet}`,
    );
  const feasibilityEvidence = input.preselectionFeasibility
    .filter((row) => row.slotId === input.slotId && row.muscle === input.muscle)
    .flatMap((row) => [
      `feasibility:${row.candidateStatus}:${row.recommendation}`,
      ...row.dirtyClosureSignals.map((signal) => `dirty:${signal.signal}`),
    ]);
  return uniqueSorted([
    ...repairEvidence,
    ...concentrationEvidence,
    ...weakConsumptionEvidence,
    ...feasibilityEvidence,
  ]);
}

export function getExerciseClassLimitations(input: {
  prescription: MusclePrescription;
  slotId: string;
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  repeatedExerciseEvidence: ReadonlyArray<string>;
  projectionStatus: ExerciseClassDistributionBySlot["projectionStatus"];
}): string[] {
  const limitations = [
    "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
  ];
  if (input.projectionStatus !== "projected_from_current_evidence") {
    limitations.push("missing_per_week_exercise_class_policy");
  }
  if (input.prescription.targetStatus === "forbidden") {
    limitations.push("do_not_train_this_muscle_in_this_slot");
  }
  if (input.prescription.muscle === "Chest") {
    if (input.slotId.startsWith("lower")) {
      limitations.push("lower_slots_forbid_chest_targeting");
    } else {
      limitations.push("upper_chest_slots_should_use_distinct_class_intent_when_inventory_supports_it");
      limitations.push("duplicate_incline_press_requires_explicit_justification");
    }
  }
  if (input.prescription.muscle === "Hamstrings" && input.slotId === "lower_b") {
    limitations.push("back_extension_is_not_clean_hamstrings_closure");
    limitations.push("hinge_anchor_should_pair_with_knee_flexion_curl_when_clean_inventory_exists");
  }
  if (input.prescription.muscle === "Side Delts") {
    limitations.push("prefer_low_collateral_direct_or_vertical_press_overlap");
    limitations.push("avoid_ohp_overconcentration");
    limitations.push("avoid_duplicate_lateral_raise_spam");
  }
  if (input.prescription.muscle === "Rear Delts") {
    limitations.push("direct_rear_delt_isolation_useful_but_pull_and_upper_back_collateral_constrained");
  }
  if (input.prescription.muscle === "Triceps") {
    limitations.push("press_overlap_first_isolation_only_if_under_floor");
    limitations.push("consumed_but_unmet_is_weak_evidence");
  }
  if (input.prescription.muscle === "Calves") {
    limitations.push("one_calf_isolation_per_lower_slot_unless_specialization");
    limitations.push("avoid_same_session_duplicate_calf_variants");
  }
  if (
    input.duplicateRows.length > 0 ||
    input.repeatedExerciseEvidence.length > 0
  ) {
    limitations.push("duplicate_exercise_class_reuse_requires_explicit_justification");
  }
  return uniqueSorted(limitations);
}

export function buildExerciseClassDistributionBySlot(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  slotPrescriptionIntents: ReadonlyArray<SlotPrescriptionIntent>;
  setDistributionIntents: ReadonlyArray<SetDistributionIntent>;
  slotDemandAllocationByWeek: SlotDemandAllocationByWeek;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  preselectionFeasibility: ReadonlyArray<CleanPreselectionFeasibility>;
  weakPreselectionConsumption: ReadonlyArray<WeakPreselectionConsumptionDiagnostic>;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): ExerciseClassDistributionBySlot[] {
  const prescriptionBySlotId = new Map(
    input.slotPrescriptionIntents.map((slot) => [slot.slotId, slot]),
  );
  const setDistributionBySlotId = new Map(
    input.setDistributionIntents.map((slot) => [slot.slotId, slot]),
  );
  const finalSlotById = new Map(
    input.finalSlotPlan.map((slot) => [slot.slotId, slot]),
  );
  const repeatedEvidenceBySlotId = findRepeatedExerciseEvidence(input.finalSlotPlan);

  return input.slotDemandAllocationByWeek.weeks.flatMap((week) => {
    const slots = week.slots.map((slot) => ({
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      slotArchetype: slot.slotArchetype,
      intent: slot.intent,
    }));
    const projectionStatus = toExerciseClassProjectionStatus(
      week.projectionStatus,
    );

    return slots.map((slot) => {
      const slotPrescription = prescriptionBySlotId.get(slot.slotId);
      const setDistribution = setDistributionBySlotId.get(slot.slotId);
      const finalSlot = finalSlotById.get(slot.slotId);
      const repeatedExerciseEvidence =
        repeatedEvidenceBySlotId.get(slot.slotId) ?? [];
      const muscleDemands: ExerciseClassDistributionMuscle[] =
        projectionStatus === "projected_from_current_evidence"
          ? (slotPrescription?.musclePrescriptions ?? [])
              .filter((prescription) =>
                shouldIncludeExerciseClassDemand({
                  prescription,
                  slotId: slot.slotId,
                }),
              )
              .map((prescription) => {
              const policy = setDistribution?.musclePolicies.find(
                (row) => row.muscle === prescription.muscle,
              );
              const duplicateRows = findDuplicateRowsForMuscle({
                slot: finalSlot,
                policy: policy ?? {
                  muscle: prescription.muscle,
                  role: prescription.role,
                  targetStatus: prescription.targetStatus,
                  demandType: prescription.demandType,
                  preferredEffectiveSets: prescription.desiredEffectiveSets,
                  minEffectiveSets: prescription.minEffectiveSets,
                  maxEffectiveSets: prescription.maxEffectiveSets,
                  maxSingleExerciseShare: null,
                  maxSinglePatternShare: null,
                  maxSetsPerExercise: null,
                  maxDirectExercises: null,
                  maxDuplicateExerciseClasses: null,
                  preferredDistribution: "diagnostic_only",
                  whenAtLimit: "leave_unresolved",
                },
                duplicateExerciseReuse: input.duplicateExerciseReuse,
              });
              const selectedExerciseEvidence = findSelectedExerciseClassEvidence({
                slot: finalSlot,
                muscle: prescription.muscle,
              });
              const muscleRepeatedEvidence = repeatedExerciseEvidence.filter((row) =>
                selectedExerciseEvidence.some((selected) => {
                  const exerciseName = selected.split(":")[1] ?? "";
                  return row.includes(exerciseName);
                }),
              );
              const duplicateJustifications =
                getExerciseClassDuplicateJustifications({
                  prescription,
                  duplicateRows,
                  selectedExerciseEvidence,
                  slotId: slot.slotId,
                });

              return {
                muscle: prescription.muscle,
                role: prescription.role,
                targetStatus: prescription.targetStatus,
                demandType: prescription.demandType,
                desiredEffectiveSets: prescription.desiredEffectiveSets,
                minEffectiveSets: prescription.minEffectiveSets,
                maxEffectiveSets: prescription.maxEffectiveSets,
                preferredExerciseClasses: getExerciseClassPreferredClasses(
                  prescription,
                ),
                requiredExerciseClasses: getExerciseClassRequiredClasses({
                  prescription,
                  slotId: slot.slotId,
                }),
                forbiddenExerciseClasses:
                  getExerciseClassForbiddenClasses(prescription),
                preferredMovementPatterns:
                  getExerciseClassPreferredPatterns(prescription),
                forbiddenMovementPatterns:
                  getExerciseClassForbiddenPatterns(prescription),
                preferredSetSplit: toExerciseClassSetSplit({
                  prescription,
                  policy,
                  slotId: slot.slotId,
                }),
                duplicatePolicy: getExerciseClassDuplicatePolicy({
                  prescription,
                  duplicateRows,
                  repeatedExerciseEvidence: muscleRepeatedEvidence,
                }),
                duplicateJustifications,
                unresolvedBehavior:
                  prescription.targetStatus === "hard" ||
                  prescription.demandType === "direct_if_under_floor"
                    ? ("repair_safety_net" as const)
                    : ("leave_unresolved" as const),
                collateralLimits: prescription.collateralLimits,
                inventoryEvidence: buildExerciseClassInventoryEvidence({
                  slotId: slot.slotId,
                  muscle: prescription.muscle,
                  slot: finalSlot,
                  preselectionFeasibility: input.preselectionFeasibility,
                  selectedExerciseEvidence,
                  duplicateRows,
                  repeatedExerciseEvidence: muscleRepeatedEvidence,
                }),
                repairEvidence: buildExerciseClassRepairEvidence({
                  slotId: slot.slotId,
                  muscle: prescription.muscle,
                  repairRows: input.repairMaterialityAfterShadowAllocation,
                  concentrationRows: input.exerciseConcentration,
                  weakPreselectionConsumption: input.weakPreselectionConsumption,
                  preselectionFeasibility: input.preselectionFeasibility,
                }),
                limitations: getExerciseClassLimitations({
                  prescription,
                  slotId: slot.slotId,
                  duplicateRows,
                  repeatedExerciseEvidence: muscleRepeatedEvidence,
                  projectionStatus,
                }),
              };
            })
          : [];

      return {
        version: 1,
        source: "diagnostic_shadow_planner",
        mesocycleId: getDiagnosticMesocycleId(input.activeMesocycle),
        week: week.week,
        phase: week.phase,
        projectionStatus,
        slotId: slot.slotId,
        slotIndex: slot.slotIndex,
        slotArchetype: slot.slotArchetype,
        intent: slot.intent,
        muscleDemands,
        readOnly: true,
        affectsScoringOrGeneration: false,
      };
    });
  });
}

type ExerciseClassAlignmentSlot = ExerciseClassAlignment["slots"][number];
type ExerciseClassAlignmentMuscle =
  ExerciseClassAlignmentSlot["muscleAlignments"][number];
type InitialExerciseClassSelection =
  ExerciseClassAlignmentMuscle["initialSelectedClasses"][number];
type FinalExerciseClassSelection =
  ExerciseClassAlignmentMuscle["finalSelectedClasses"][number];
type ExerciseClassAlignmentStatus =
  ExerciseClassAlignmentMuscle["initialAlignment"];

export function compactDiagnosticStrings(
  values: ReadonlyArray<string>,
  limit = 10,
): string[] {
  const unique = uniqueSorted(values).filter((value) => value.length > 0);
  if (unique.length <= limit) {
    return unique;
  }
  return [...unique.slice(0, limit), `+${unique.length - limit} more`];
}

export function classifySelectedExerciseClass(input: {
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number];
  muscle: string;
}): string {
  const name = input.exercise.exerciseName.toLowerCase();
  if (name.includes("back extension")) {
    return "dirty_extension";
  }
  if (name.includes("nordic")) {
    return "nordic_curl";
  }
  if (name.includes("leg curl") || name.includes("hamstring curl")) {
    return "leg_curl";
  }
  if (
    name.includes("stiff-legged") ||
    name.includes("stiff leg") ||
    name === "sldl" ||
    name.includes("romanian deadlift") ||
    name.includes("rdl")
  ) {
    return "stiff_leg_deadlift";
  }
  if (name.includes("deadlift") || name.includes("hinge")) {
    return "hinge_compound";
  }
  if (name.includes("incline") && (name.includes("bench") || name.includes("press"))) {
    return "incline_press";
  }
  if (name.includes("machine") && name.includes("press") && input.muscle === "Chest") {
    return "machine_press";
  }
  if (name.includes("fly") || name.includes("pec deck")) {
    return name.includes("cable") ? "cable_fly" : "chest_fly";
  }
  if (name.includes("bench") || name.includes("chest press")) {
    return "horizontal_press";
  }
  if (name.includes("overhead press") || name.includes("ohp") || name.includes("shoulder press")) {
    return "vertical_press_overlap";
  }
  if (name.includes("lateral raise")) {
    if (name.includes("cable")) {
      return "cable_lateral_raise";
    }
    if (name.includes("machine")) {
      return "machine_lateral_raise";
    }
    return "lateral_raise";
  }
  if (name.includes("reverse fly")) {
    return "reverse_fly";
  }
  if (name.includes("face pull")) {
    return "face_pull";
  }
  if (name.includes("rear delt")) {
    return "rear_delt_isolation";
  }
  if (name.includes("triceps") || name.includes("pushdown") || name.includes("skullcrusher")) {
    return "triceps_isolation_if_under_floor";
  }
  if (name.includes("pulldown")) {
    return "vertical_pull";
  }
  if (name.includes("row")) {
    return "horizontal_pull";
  }
  if (name.includes("back squat") || name.includes("squat")) {
    return "squat_compound";
  }
  if (name.includes("standing calf")) {
    return "standing_calf_raise";
  }
  if (name.includes("seated calf")) {
    return "seated_calf_raise";
  }
  if (name.includes("calf raise")) {
    return "calf_raise";
  }
  if (input.exercise.role === "main") {
    return "compound_overlap";
  }
  return "unclassified";
}

export function classSatisfiesIntent(
  exerciseClass: string,
  intendedClass: string,
): boolean {
  if (exerciseClass === intendedClass) {
    return true;
  }
  const aliases: Record<string, string[]> = {
    press: ["horizontal_press", "incline_press", "machine_press", "vertical_press_overlap"],
    horizontal_press: ["incline_press", "machine_press"],
    hinge_compound: ["stiff_leg_deadlift", "romanian_deadlift"],
    knee_flexion_curl: ["leg_curl", "nordic_curl"],
    lateral_raise: ["cable_lateral_raise", "machine_lateral_raise"],
    rear_delt_isolation: ["reverse_fly", "face_pull"],
    pull_overlap_with_direct_rear_delt_stimulus: [
      "horizontal_pull",
      "vertical_pull",
      "face_pull",
    ],
    press_overlap: [
      "horizontal_press",
      "incline_press",
      "machine_press",
      "vertical_press_overlap",
    ],
    calf_raise: ["standing_calf_raise", "seated_calf_raise"],
  };
  return aliases[intendedClass]?.includes(exerciseClass) ?? false;
}

export function selectedExerciseClassMatchesAny(
  exerciseClass: string,
  intendedClasses: ReadonlyArray<string>,
): boolean {
  return intendedClasses.some((intendedClass) =>
    classSatisfiesIntent(exerciseClass, intendedClass),
  );
}

export function toDuplicatePolicyClass(exerciseClass: string): string {
  if (["standing_calf_raise", "seated_calf_raise"].includes(exerciseClass)) {
    return "calf_raise";
  }
  if (["leg_curl", "nordic_curl"].includes(exerciseClass)) {
    return "knee_flexion_curl";
  }
  if (["stiff_leg_deadlift", "romanian_deadlift"].includes(exerciseClass)) {
    return "hinge_compound";
  }
  if (["cable_lateral_raise", "machine_lateral_raise"].includes(exerciseClass)) {
    return "lateral_raise";
  }
  return exerciseClass;
}

export function buildSelectedExerciseClasses(input: {
  slot: SlotCompositionSnapshotDiagnostic | undefined;
  muscle: string;
}): InitialExerciseClassSelection[] {
  if (!input.slot) {
    return [];
  }
  return input.slot.exercises
    .filter((exercise) => exerciseClassMatchesMuscle(exercise, input.muscle))
    .map((exercise) => ({
      exerciseName: exercise.exerciseName,
      exerciseClass: classifySelectedExerciseClass({
        exercise,
        muscle: input.muscle,
      }),
      setCount: exercise.setCount,
      effectiveSets:
        typeof exercise.effectiveStimulusByMuscle[input.muscle] === "number"
          ? roundToTenth(exercise.effectiveStimulusByMuscle[input.muscle])
          : null,
    }))
    .sort(
      (left, right) =>
        left.exerciseName.localeCompare(right.exerciseName) ||
        left.exerciseClass.localeCompare(right.exerciseClass),
    );
}

export function hasProducedOrIncreasedRepair(input: {
  slotId: string;
  muscle: string;
  exerciseName: string;
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  concentrationRows: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): boolean {
  return (
    input.repairRows.some(
      (row) =>
        row.slotId === input.slotId &&
        row.muscle === input.muscle &&
        row.exerciseName === input.exerciseName &&
        (row.action === "added" || row.action === "set_bumped") &&
        row.effectiveStimulusDelta > 0,
    ) ||
    input.concentrationRows.some(
      (row) =>
        row.slotId === input.slotId &&
        row.exerciseName === input.exerciseName &&
        row.producedOrIncreasedByRepair,
    )
  );
}

export function withFinalRepairFlags(input: {
  slotId: string;
  muscle: string;
  selected: ReadonlyArray<InitialExerciseClassSelection>;
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  concentrationRows: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): FinalExerciseClassSelection[] {
  return input.selected.map((selection) => ({
    ...selection,
    producedOrIncreasedByRepair: hasProducedOrIncreasedRepair({
      slotId: input.slotId,
      muscle: input.muscle,
      exerciseName: selection.exerciseName,
      repairRows: input.repairRows,
      concentrationRows: input.concentrationRows,
    }),
  }));
}

export function hasDirectSideDeltClass(
  selected: ReadonlyArray<InitialExerciseClassSelection>,
): boolean {
  return selected.some((row) =>
    ["lateral_raise", "cable_lateral_raise", "machine_lateral_raise"].includes(
      row.exerciseClass,
    ),
  );
}

export function hasDirectRearDeltClass(
  selected: ReadonlyArray<InitialExerciseClassSelection>,
): boolean {
  return selected.some((row) =>
    ["rear_delt_isolation", "reverse_fly", "face_pull"].includes(
      row.exerciseClass,
    ),
  );
}

export function evaluateExerciseClassAlignment(input: {
  muscle: string;
  targetStatus: ExerciseClassAlignmentMuscle["targetStatus"];
  requiredClasses: ReadonlyArray<string>;
  intendedClasses: ReadonlyArray<string>;
  forbiddenClasses: ReadonlyArray<string>;
  duplicatePolicyFailure: boolean;
  selected: ReadonlyArray<InitialExerciseClassSelection>;
}): ExerciseClassAlignmentStatus {
  if (input.targetStatus === "diagnostic") {
    return "not_applicable";
  }
  if (input.targetStatus === "forbidden") {
    return input.selected.length > 0 ? "violated" : "not_applicable";
  }
  if (input.intendedClasses.length === 0) {
    return "not_applicable";
  }
  if (
    input.selected.some((row) =>
      selectedExerciseClassMatchesAny(row.exerciseClass, input.forbiddenClasses),
    )
  ) {
    return "violated";
  }
  if (input.selected.length === 0) {
    return "missing";
  }

  if (input.requiredClasses.length > 0) {
    const satisfiedCount = input.requiredClasses.filter((requiredClass) =>
      input.selected.some((row) =>
        classSatisfiesIntent(row.exerciseClass, requiredClass),
      ),
    ).length;
    if (satisfiedCount === input.requiredClasses.length) {
      return input.duplicatePolicyFailure ? "partial" : "satisfied";
    }
    return satisfiedCount > 0 ? "partial" : "missing";
  }

  if (input.muscle === "Side Delts") {
    if (hasDirectSideDeltClass(input.selected)) {
      return input.duplicatePolicyFailure ? "partial" : "satisfied";
    }
    return input.selected.some((row) => row.exerciseClass === "vertical_press_overlap")
      ? "partial"
      : "missing";
  }

  if (input.muscle === "Rear Delts") {
    if (hasDirectRearDeltClass(input.selected)) {
      return input.duplicatePolicyFailure ? "partial" : "satisfied";
    }
    return input.selected.some((row) =>
      ["horizontal_pull", "vertical_pull"].includes(row.exerciseClass),
    )
      ? "partial"
      : "missing";
  }

  if (input.muscle === "Triceps") {
    return input.selected.some((row) =>
      selectedExerciseClassMatchesAny(row.exerciseClass, input.intendedClasses),
    )
      ? input.duplicatePolicyFailure
        ? "partial"
        : "satisfied"
      : "missing";
  }

  const hasAnyIntendedClass = input.selected.some((row) =>
    selectedExerciseClassMatchesAny(row.exerciseClass, input.intendedClasses),
  );
  return hasAnyIntendedClass
    ? input.duplicatePolicyFailure
      ? "partial"
      : "satisfied"
    : "missing";
}

export function alignmentRank(status: ExerciseClassAlignmentStatus): number | null {
  switch (status) {
    case "satisfied":
      return 3;
    case "partial":
      return 2;
    case "missing":
      return 1;
    case "violated":
      return 0;
    case "not_applicable":
      return null;
  }
}

export function hasIdentityChurn(input: {
  slotId: string;
  muscle: string;
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
}): boolean {
  return input.repairRows.some(
    (row) =>
      row.slotId === input.slotId &&
      row.muscle === input.muscle &&
      row.changedExerciseIdentity,
  );
}

export function classifyRepairEffect(input: {
  initialAlignment: ExerciseClassAlignmentStatus;
  finalAlignment: ExerciseClassAlignmentStatus;
  identityChurn: boolean;
  hasRepairEvidence: boolean;
}): ExerciseClassAlignmentMuscle["repairEffect"] {
  const initialRank = alignmentRank(input.initialAlignment);
  const finalRank = alignmentRank(input.finalAlignment);
  if (initialRank == null || finalRank == null) {
    return input.identityChurn ? "created_identity_churn" : "not_applicable";
  }
  if (finalRank > initialRank) {
    return "improved_alignment";
  }
  if (finalRank < initialRank) {
    return "worsened_alignment";
  }
  if (input.identityChurn) {
    return "created_identity_churn";
  }
  return input.hasRepairEvidence ? "unchanged" : "not_applicable";
}

export function findDuplicatePolicyWarnings(input: {
  muscle: string;
  demand: ExerciseClassDistributionMuscle;
  finalSelected: ReadonlyArray<InitialExerciseClassSelection>;
}): string[] {
  const warnings: string[] = [];
  const duplicateEvidence = [
    ...input.demand.inventoryEvidence,
    ...input.demand.repairEvidence,
  ].filter(
    (row) =>
      row.includes("duplicate:") ||
      row.includes("duplicate_class:") ||
      row.includes("duplicate_exercise_class"),
  );
  warnings.push(...duplicateEvidence);

  const byClass = new Map<string, string[]>();
  for (const selection of input.finalSelected) {
    const classKey = toDuplicatePolicyClass(selection.exerciseClass);
    byClass.set(classKey, [
      ...(byClass.get(classKey) ?? []),
      selection.exerciseName,
    ]);
  }
  for (const [classKey, names] of byClass.entries()) {
    const distinctNames = uniqueSorted(names);
    if (distinctNames.length <= 1) {
      continue;
    }
    if (input.muscle === "Calves" || input.demand.duplicatePolicy !== "allow_with_justification") {
      warnings.push(
        `same_session_duplicate_class:${input.muscle}:${classKey}:${distinctNames.join("+")}`,
      );
    }
  }
  return compactDiagnosticStrings(warnings, 8);
}

type ExerciseClassUnresolvedOwningCause =
  ExerciseClassUnresolvedCause["owningCause"];

export function mapExerciseClassCauseOwner(
  owningCause: ExerciseClassUnresolvedOwningCause,
): ExerciseClassUnresolvedCause["recommendedOwner"] {
  switch (owningCause) {
    case "selection_blind_spot":
      return "selection_objective";
    case "inventory_classification_gap":
      return "exercise_inventory_classification";
    case "slot_capacity_issue":
      return "slot_capacity_policy";
    case "duplicate_continuity_conflict":
      return "duplicate_continuity_policy";
    case "support_floor_late_repair":
      return "support_demand_planner";
    case "cap_cleanup_or_final_shaping":
      return "program_quality_cleanup";
    case "repair_identity_churn":
      return "repair_safety_net";
    case "true_unresolved_demand":
    case "diagnostic_only_not_actionable":
      return "leave_unresolved";
  }
}

export function mapExerciseClassBehaviorReadiness(input: {
  owningCause: ExerciseClassUnresolvedOwningCause;
  hasBlockingRepairOrSuspiciousEvidence: boolean;
}): ExerciseClassUnresolvedCause["behaviorReadiness"] {
  if (
    input.owningCause === "selection_blind_spot" &&
    !input.hasBlockingRepairOrSuspiciousEvidence
  ) {
    return "ready_for_bounded_trial";
  }
  switch (input.owningCause) {
    case "inventory_classification_gap":
      return "needs_inventory_fix";
    case "duplicate_continuity_conflict":
      return "needs_duplicate_policy";
    case "slot_capacity_issue":
      return "needs_capacity_policy";
    case "support_floor_late_repair":
      return "needs_planner_ownership";
    case "selection_blind_spot":
    case "cap_cleanup_or_final_shaping":
    case "repair_identity_churn":
    case "true_unresolved_demand":
    case "diagnostic_only_not_actionable":
      return "do_not_act";
  }
}

export function parseSlotExerciseCount(evidence: ReadonlyArray<string>): number | null {
  for (const row of evidence) {
    const match = /^slot_exercise_count:(\d+)$/.exec(row);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

export function hasVisibleCompatibleClassCandidate(input: {
  demand: ExerciseClassDistributionMuscle;
  intendedClasses: ReadonlyArray<string>;
  initialSelectedClasses: ReadonlyArray<InitialExerciseClassSelection>;
  finalSelectedClasses: ReadonlyArray<FinalExerciseClassSelection>;
}): boolean {
  const selectedClasses = [
    ...input.initialSelectedClasses,
    ...input.finalSelectedClasses,
  ];
  const unsatisfiedRequiredClasses = input.demand.requiredExerciseClasses.filter(
    (requiredClass) =>
      !selectedClasses.some((row) =>
        classSatisfiesIntent(row.exerciseClass, requiredClass),
      ),
  );
  const candidateTargetClasses =
    unsatisfiedRequiredClasses.length > 0
      ? unsatisfiedRequiredClasses
      : input.intendedClasses;
  const selectedCandidateVisible = [
    ...input.initialSelectedClasses,
    ...input.finalSelectedClasses,
  ].some((row) =>
    selectedExerciseClassMatchesAny(row.exerciseClass, candidateTargetClasses),
  );
  if (selectedCandidateVisible) {
    return true;
  }

  return input.demand.inventoryEvidence.some((row) => {
    if (!row.startsWith("inventory:")) {
      return false;
    }
    const classMatch = /:class=([^:]+)/.exec(row);
    const availabilityMatch = /:availability=([^:]+)/.exec(row);
    const candidateClass = classMatch?.[1] ?? "";
    const availability = availabilityMatch?.[1] ?? "";
    const classCompatible = candidateTargetClasses.some((intendedClass) =>
      classSatisfiesIntent(candidateClass, intendedClass),
    );
    const availabilityCompatible =
      availability === "clean_available" ||
      availability === "available_but_already_used_elsewhere";
    return classCompatible && availabilityCompatible;
  });
}

export function hasInventoryClassificationGapEvidence(input: {
  demand: ExerciseClassDistributionMuscle;
  intendedClasses: ReadonlyArray<string>;
  compatibleCandidateVisible: boolean;
}): boolean {
  if (input.compatibleCandidateVisible) {
    return false;
  }
  const inventoryEvidence = input.demand.inventoryEvidence;
  if (inventoryEvidence.length === 0) {
    return true;
  }
  return inventoryEvidence.some(
    (row) =>
      row.includes("classification_mismatch") ||
      row.includes("available_but_classification_mismatch") ||
      row.includes("dirty_not_clean_candidate") ||
      (row.startsWith("inventory:") &&
        !input.intendedClasses.some((intendedClass) => {
          const classMatch = /:class=([^:]+)/.exec(row);
          return classSatisfiesIntent(classMatch?.[1] ?? "", intendedClass);
        })),
  );
}

export function hasSlotCapacityIssueEvidence(
  demand: ExerciseClassDistributionMuscle,
): boolean {
  if (
    demand.inventoryEvidence.some((row) =>
      row.includes("available_but_capacity_blocked"),
    )
  ) {
    return true;
  }
  const slotExerciseCount = parseSlotExerciseCount(demand.inventoryEvidence);
  return slotExerciseCount != null && slotExerciseCount >= SESSION_CAPS.maxExercises;
}

export function hasSupportFloorLateRepairEvidence(input: {
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  demand: ExerciseClassDistributionMuscle;
}): boolean {
  return (
    input.repairRows.some((row) =>
      row.repairMechanism.toLowerCase().includes("support_floor"),
    ) ||
    input.demand.repairEvidence.some((row) =>
      row.toLowerCase().includes("support_floor"),
    )
  );
}

export function hasCapCleanupOrFinalShapingEvidence(input: {
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  guardRows: ReadonlyArray<DistributionGuardAction>;
  concentrationRows: ReadonlyArray<ExerciseConcentrationDiagnostic>;
  demand: ExerciseClassDistributionMuscle;
}): boolean {
  return (
    input.repairRows.some(
      (row) =>
        row.action === "set_trimmed" ||
        row.action === "removed" ||
        row.shadowAllocationBasis === "diagnostic_or_cap_cleanup" ||
        row.repairMechanism.toLowerCase().includes("cap") ||
        row.repairMechanism.toLowerCase().includes("program_quality"),
    ) ||
    input.guardRows.length > 0 ||
    input.concentrationRows.some((row) => row.producedOrIncreasedByRepair) ||
    input.demand.repairEvidence.some(
      (row) =>
        row.includes("distribution_guard") ||
        row.toLowerCase().includes("cap_cleanup"),
    )
  );
}

export function hasRepairIdentityChurnEvidence(input: {
  alignment: ExerciseClassAlignmentMuscle;
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
}): boolean {
  return (
    input.alignment.repairEffect === "created_identity_churn" ||
    input.repairRows.some(
      (row) =>
        row.changedExerciseIdentity &&
        (row.action === "added" || row.action === "removed"),
    ) ||
    input.alignment.finalSelectedClasses.some(
      (row) => row.producedOrIncreasedByRepair,
    )
  );
}

export function hasBlockingRepairOrSuspiciousEvidence(input: {
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  suspiciousRows: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
}): boolean {
  return (
    input.suspiciousRows.length > 0 ||
    input.repairRows.some(
      (row) => row.materiality === "moderate" || row.materiality === "major",
    )
  );
}

export function shouldEmitExerciseClassCause(input: {
  alignment: ExerciseClassAlignmentMuscle;
  duplicateWarnings: ReadonlyArray<string>;
  owningCause: ExerciseClassUnresolvedOwningCause;
  hasSupportFloorLateRepair: boolean;
  hasRepairIdentityChurn: boolean;
  hasCapCleanupOrFinalShaping: boolean;
}): boolean {
  if (
    input.alignment.finalAlignment === "missing" ||
    input.alignment.finalAlignment === "partial" ||
    input.alignment.finalAlignment === "violated"
  ) {
    return true;
  }
  if (input.owningCause === "diagnostic_only_not_actionable") {
    return true;
  }
  return (
    input.duplicateWarnings.length > 0 ||
    input.hasSupportFloorLateRepair ||
    input.hasRepairIdentityChurn ||
    input.hasCapCleanupOrFinalShaping
  );
}

export function classifyExerciseClassUnresolvedCause(input: {
  slotId: string;
  demand: ExerciseClassDistributionMuscle;
  alignment: ExerciseClassAlignmentMuscle;
  duplicateWarnings: ReadonlyArray<string>;
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  suspiciousRows: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
  globalBlockingRepairOrSuspiciousEvidence: boolean;
  guardRows: ReadonlyArray<DistributionGuardAction>;
  concentrationRows: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): ExerciseClassUnresolvedCause | null {
  const compatibleCandidateVisible = hasVisibleCompatibleClassCandidate({
    demand: input.demand,
    intendedClasses: input.alignment.intendedClasses,
    initialSelectedClasses: input.alignment.initialSelectedClasses,
    finalSelectedClasses: input.alignment.finalSelectedClasses,
  });
  const slotCapacityIssue = hasSlotCapacityIssueEvidence(input.demand);
  const supportFloorLateRepair = hasSupportFloorLateRepairEvidence({
    repairRows: input.repairRows,
    demand: input.demand,
  });
  const capCleanupOrFinalShaping = hasCapCleanupOrFinalShapingEvidence({
    repairRows: input.repairRows,
    guardRows: input.guardRows,
    concentrationRows: input.concentrationRows,
    demand: input.demand,
  });
  const repairIdentityChurn = hasRepairIdentityChurnEvidence({
    alignment: input.alignment,
    repairRows: input.repairRows,
  });
  const inventoryClassificationGap = hasInventoryClassificationGapEvidence({
    demand: input.demand,
    intendedClasses: input.alignment.intendedClasses,
    compatibleCandidateVisible,
  });
  const duplicateConflict =
    input.duplicateWarnings.length > 0 ||
    input.demand.duplicatePolicy === "block_if_clean_alternative_exists";
  const initialMissesClass =
    input.alignment.initialAlignment === "missing" ||
    input.alignment.initialAlignment === "partial";
  const finalStillUnresolved =
    input.alignment.finalAlignment === "missing" ||
    input.alignment.finalAlignment === "partial" ||
    input.alignment.finalAlignment === "violated";
  const hasBlockingEvidence = hasBlockingRepairOrSuspiciousEvidence({
    repairRows: input.repairRows,
    suspiciousRows: input.suspiciousRows,
  }) || input.globalBlockingRepairOrSuspiciousEvidence;

  let owningCause: ExerciseClassUnresolvedOwningCause;
  if (
    input.alignment.targetStatus === "diagnostic" ||
    input.alignment.demandType === "diagnostic_only" ||
    (input.alignment.targetStatus === "forbidden" &&
      input.alignment.finalAlignment !== "violated")
  ) {
    owningCause = "diagnostic_only_not_actionable";
  } else if (supportFloorLateRepair) {
    owningCause = "support_floor_late_repair";
  } else if (duplicateConflict) {
    owningCause = "duplicate_continuity_conflict";
  } else if (repairIdentityChurn) {
    owningCause = "repair_identity_churn";
  } else if (capCleanupOrFinalShaping) {
    owningCause = "cap_cleanup_or_final_shaping";
  } else if (slotCapacityIssue) {
    owningCause = "slot_capacity_issue";
  } else if (
    compatibleCandidateVisible &&
    !slotCapacityIssue &&
    initialMissesClass &&
    (finalStillUnresolved ||
      input.alignment.repairEffect === "improved_alignment")
  ) {
    owningCause = "selection_blind_spot";
  } else if (inventoryClassificationGap) {
    owningCause = "inventory_classification_gap";
  } else {
    owningCause = "true_unresolved_demand";
  }

  if (
    !shouldEmitExerciseClassCause({
      alignment: input.alignment,
      duplicateWarnings: input.duplicateWarnings,
      owningCause,
      hasSupportFloorLateRepair: supportFloorLateRepair,
      hasRepairIdentityChurn: repairIdentityChurn,
      hasCapCleanupOrFinalShaping: capCleanupOrFinalShaping,
    })
  ) {
    return null;
  }

  const evidence = compactDiagnosticStrings(
    [
      `initial_alignment:${input.alignment.initialAlignment}`,
      `final_alignment:${input.alignment.finalAlignment}`,
      compatibleCandidateVisible
        ? "compatible_candidate_visible"
        : "compatible_candidate_not_visible",
      slotCapacityIssue ? "slot_capacity_blocked" : "slot_capacity_available",
      ...input.duplicateWarnings,
      ...input.repairRows.map(
        (row) =>
          `repair:${row.exerciseName ?? row.exerciseId ?? "unknown"}:${row.action}:${row.repairMechanism}`,
      ),
      ...input.suspiciousRows.map(
        (row) =>
          `suspicious_repair:${row.exerciseName ?? "unknown"}:${row.repairMechanism}`,
      ),
      ...input.guardRows.map(
        (row) =>
          `distribution_guard:${row.exerciseName}:${row.attemptedAction}:${row.decision}`,
      ),
      ...input.demand.inventoryEvidence.filter(
        (row) =>
          row.startsWith("inventory:") ||
          row.startsWith("duplicate:") ||
          row.startsWith("slot_exercise_count:"),
      ),
    ],
    3,
  );
  const limitations = compactDiagnosticStrings(
    [
      ...(hasBlockingEvidence
        ? ["repair_materiality_or_suspicious_repairs_block_behavior_readiness"]
        : []),
      "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
      "uses_existing_planningReality_rows_only",
      "does_not_replay_candidate_ranking_or_selection_trials",
    ],
    2,
  );

  return {
    slotId: input.slotId,
    muscle: input.alignment.muscle,
    targetStatus: input.alignment.targetStatus,
    demandType: input.alignment.demandType,
    initialAlignment: input.alignment.initialAlignment,
    finalAlignment: input.alignment.finalAlignment,
    owningCause,
    recommendedOwner: mapExerciseClassCauseOwner(owningCause),
    behaviorReadiness: mapExerciseClassBehaviorReadiness({
      owningCause,
      hasBlockingRepairOrSuspiciousEvidence: hasBlockingEvidence,
    }),
    evidence,
    limitations,
  };
}

export function buildExerciseClassAlignment(input: {
  exerciseClassDistributionBySlot: ReadonlyArray<ExerciseClassDistributionBySlot>;
  initialSlotComposition: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  suspiciousRepairsNotEligibleForPromotion: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
  weakPreselectionConsumption: ReadonlyArray<WeakPreselectionConsumptionDiagnostic>;
  distributionGuardActions: ReadonlyArray<DistributionGuardAction>;
}): {
  alignment: ExerciseClassAlignment;
  unresolvedCauses: ExerciseClassUnresolvedCause[];
} {
  const initialSlotById = new Map(
    input.initialSlotComposition.map((slot) => [slot.slotId, slot]),
  );
  const finalSlotById = new Map(
    input.finalSlotPlan.map((slot) => [slot.slotId, slot]),
  );
  const weekOneClassDistributions = input.exerciseClassDistributionBySlot.filter(
    (slot) =>
      slot.week === 1 &&
      slot.projectionStatus === "projected_from_current_evidence",
  );
  const globalBlockingRepairOrSuspiciousEvidence =
    input.suspiciousRepairsNotEligibleForPromotion.length > 0 ||
    input.repairMaterialityAfterShadowAllocation.some(
      (row) => row.materiality === "moderate" || row.materiality === "major",
    );
  const unresolvedCauses: ExerciseClassUnresolvedCause[] = [];

  const slots: ExerciseClassAlignmentSlot[] = weekOneClassDistributions.map(
    (slot) => {
      const initialSlot = initialSlotById.get(slot.slotId);
      const finalSlot = finalSlotById.get(slot.slotId);
      const slotWarnings: string[] = [];
      const muscleAlignments = slot.muscleDemands.map((demand) => {
        const intendedClasses =
          demand.requiredExerciseClasses.length > 0
            ? demand.requiredExerciseClasses
            : demand.preferredExerciseClasses;
        const initialSelectedClasses = buildSelectedExerciseClasses({
          slot: initialSlot,
          muscle: demand.muscle,
        });
        const finalSelectedBase = buildSelectedExerciseClasses({
          slot: finalSlot,
          muscle: demand.muscle,
        });
        const finalSelectedClasses = withFinalRepairFlags({
          slotId: slot.slotId,
          muscle: demand.muscle,
          selected: finalSelectedBase,
          repairRows: input.repairMaterialityAfterShadowAllocation,
          concentrationRows: input.exerciseConcentration,
        });
        const duplicateWarnings = findDuplicatePolicyWarnings({
          muscle: demand.muscle,
          demand,
          finalSelected: finalSelectedBase,
        });
        slotWarnings.push(...duplicateWarnings);
        const duplicatePolicyFailure =
          demand.muscle === "Chest" &&
          demand.duplicatePolicy === "block_if_clean_alternative_exists" &&
          duplicateWarnings.length > 0;
        const initialAlignment = evaluateExerciseClassAlignment({
          muscle: demand.muscle,
          targetStatus: demand.targetStatus,
          requiredClasses: demand.requiredExerciseClasses,
          intendedClasses,
          forbiddenClasses: demand.forbiddenExerciseClasses,
          duplicatePolicyFailure,
          selected: initialSelectedClasses,
        });
        const finalAlignment = evaluateExerciseClassAlignment({
          muscle: demand.muscle,
          targetStatus: demand.targetStatus,
          requiredClasses: demand.requiredExerciseClasses,
          intendedClasses,
          forbiddenClasses: demand.forbiddenExerciseClasses,
          duplicatePolicyFailure,
          selected: finalSelectedBase,
        });
        const identityChurn = hasIdentityChurn({
          slotId: slot.slotId,
          muscle: demand.muscle,
          repairRows: input.repairMaterialityAfterShadowAllocation,
        });
        const matchingRepairRows = input.repairMaterialityAfterShadowAllocation
          .filter((row) => row.slotId === slot.slotId && row.muscle === demand.muscle);
        const matchingSuspiciousRows =
          input.suspiciousRepairsNotEligibleForPromotion.filter(
            (row) => row.slotId === slot.slotId && row.muscle === demand.muscle,
          );
        const matchingGuardRows = input.distributionGuardActions.filter(
          (row) => row.slotId === slot.slotId && row.muscle === demand.muscle,
        );
        const matchingConcentrationRows = input.exerciseConcentration.filter(
          (row) =>
            row.slotId === slot.slotId &&
            Object.prototype.hasOwnProperty.call(
              row.percentageOfWeeklyProjectedStimulusByMuscle,
              demand.muscle,
            ),
        );
        const repairEvidence = matchingRepairRows
          .map(
            (row) =>
              `repair:${row.exerciseName ?? row.exerciseId ?? "unknown"}:${row.action}:${row.effectiveStimulusDelta}`,
          );
        const weakConsumptionEvidence = input.weakPreselectionConsumption
          .filter((row) => row.slotId === slot.slotId && row.muscle === demand.muscle)
          .map(
            (row) =>
              `weak_preselection_consumption:selected=${roundToTenth(row.selectedEffectiveSets)}:targetMet=${row.targetMet}`,
          );
        const guardEvidence = input.distributionGuardActions
          .filter((row) => row.slotId === slot.slotId && row.muscle === demand.muscle)
          .map(
            (row) =>
              `distribution_guard:${row.exerciseName}:${row.attemptedAction}:${row.decision}`,
          );
        const evidence = compactDiagnosticStrings([
          `initial_alignment:${initialAlignment}`,
          `final_alignment:${finalAlignment}`,
          ...initialSelectedClasses.map(
            (row) =>
              `initial:${row.exerciseName}:${row.exerciseClass}:${row.setCount} sets`,
          ),
          ...finalSelectedClasses.map(
            (row) =>
              `final:${row.exerciseName}:${row.exerciseClass}:${row.setCount} sets:repair=${row.producedOrIncreasedByRepair}`,
          ),
          ...duplicateWarnings,
          ...repairEvidence,
          ...weakConsumptionEvidence,
          ...guardEvidence,
        ]);
        const limitations = compactDiagnosticStrings([
          "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
          "exercise_class_is_inferred_from_existing_projection_rows",
          "does_not_replay_candidate_ranking_or_selection_trials",
          ...demand.limitations,
        ], 8);

        const alignment: ExerciseClassAlignmentMuscle = {
          muscle: demand.muscle,
          targetStatus: demand.targetStatus,
          demandType: demand.demandType,
          intendedClasses: uniqueSorted(intendedClasses),
          forbiddenClasses: demand.forbiddenExerciseClasses,
          initialSelectedClasses,
          finalSelectedClasses,
          initialAlignment,
          finalAlignment,
          repairEffect: classifyRepairEffect({
            initialAlignment,
            finalAlignment,
            identityChurn,
            hasRepairEvidence: repairEvidence.length > 0,
          }),
          evidence,
          limitations,
        };
        const unresolvedCause = classifyExerciseClassUnresolvedCause({
          slotId: slot.slotId,
          demand,
          alignment,
          duplicateWarnings,
          repairRows: matchingRepairRows,
          suspiciousRows: matchingSuspiciousRows,
          globalBlockingRepairOrSuspiciousEvidence,
          guardRows: matchingGuardRows,
          concentrationRows: matchingConcentrationRows,
        });
        if (unresolvedCause) {
          unresolvedCauses.push(unresolvedCause);
        }
        return alignment;
      });

      return {
        slotId: slot.slotId,
        slotIndex: slot.slotIndex,
        slotArchetype: slot.slotArchetype,
        muscleAlignments,
        slotWarnings: compactDiagnosticStrings(slotWarnings, 8),
      };
    },
  );

  const allAlignments = slots.flatMap((slot) => slot.muscleAlignments);
  return {
    alignment: {
      version: 1,
      source: "diagnostic_shadow_planner",
      readOnly: true,
      affectsScoringOrGeneration: false,
      slots,
      summary: {
        initiallySatisfied: allAlignments.filter(
          (row) => row.initialAlignment === "satisfied",
        ).length,
        finallySatisfied: allAlignments.filter(
          (row) => row.finalAlignment === "satisfied",
        ).length,
        improvedByRepair: allAlignments.filter(
          (row) => row.repairEffect === "improved_alignment",
        ).length,
        worsenedByRepair: allAlignments.filter(
          (row) => row.repairEffect === "worsened_alignment",
        ).length,
        identityChurnCount: allAlignments.filter((row) =>
          input.repairMaterialityAfterShadowAllocation.some(
            (repair) =>
              repair.slotId ===
                slots.find((slot) => slot.muscleAlignments.includes(row))?.slotId &&
              repair.muscle === row.muscle &&
              repair.changedExerciseIdentity,
          ),
        ).length,
        unresolvedClassIntentCount: allAlignments.filter(
          (row) =>
            row.finalAlignment === "missing" ||
            row.finalAlignment === "partial" ||
            row.finalAlignment === "violated",
        ).length,
      },
    },
    unresolvedCauses: unresolvedCauses.sort(
      (left, right) =>
        left.slotId.localeCompare(right.slotId) ||
        left.muscle.localeCompare(right.muscle) ||
        left.owningCause.localeCompare(right.owningCause),
    ),
  };
}

type DuplicateContinuityRow =
  DuplicateContinuityJustification["duplicates"][number];

type DuplicateContinuityCandidate = {
  duplicateType: DuplicateContinuityRow["duplicateType"];
  exerciseId: string;
  exerciseName: string;
  duplicatedInSlots: string[];
  roleBySlot: Record<string, string>;
  setCountBySlot: Record<string, number>;
  primaryMuscles: string[];
  movementPatterns: string[];
  exerciseClass: string | null;
};

export function getSnapshotExerciseClass(
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number],
): string | null {
  const muscle = exercise.primaryMuscles[0] ?? Object.keys(exercise.effectiveStimulusByMuscle)[0];
  return muscle
    ? classifySelectedExerciseClass({ exercise, muscle })
    : null;
}

export function toDuplicateClassFamily(exerciseClass: string | null): string | null {
  return exerciseClass ? toDuplicatePolicyClass(exerciseClass) : null;
}

export function buildCrossSlotDuplicateCandidates(
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>,
): DuplicateContinuityCandidate[] {
  const byExercise = new Map<
    string,
    {
      exerciseId: string;
      exerciseName: string;
      slots: Set<string>;
      roleBySlot: Record<string, string>;
      setCountBySlot: Record<string, number>;
      primaryMuscles: Set<string>;
      movementPatterns: Set<string>;
      exerciseClasses: Set<string>;
    }
  >();

  for (const slot of finalSlotPlan) {
    for (const exercise of slot.exercises) {
      const key = exercise.exerciseId || exercise.exerciseName;
      const existing =
        byExercise.get(key) ?? {
          exerciseId: exercise.exerciseId,
          exerciseName: exercise.exerciseName,
          slots: new Set<string>(),
          roleBySlot: {},
          setCountBySlot: {},
          primaryMuscles: new Set<string>(),
          movementPatterns: new Set<string>(),
          exerciseClasses: new Set<string>(),
        };
      existing.slots.add(slot.slotId);
      existing.roleBySlot[slot.slotId] = exercise.role;
      existing.setCountBySlot[slot.slotId] =
        (existing.setCountBySlot[slot.slotId] ?? 0) + exercise.setCount;
      for (const muscle of exercise.primaryMuscles) {
        existing.primaryMuscles.add(muscle);
      }
      for (const pattern of exercise.movementPatterns) {
        existing.movementPatterns.add(pattern);
      }
      const exerciseClass = getSnapshotExerciseClass(exercise);
      if (exerciseClass) {
        existing.exerciseClasses.add(exerciseClass);
      }
      byExercise.set(key, existing);
    }
  }

  return Array.from(byExercise.values())
    .filter((row) => row.slots.size > 1)
    .map((row) => ({
      duplicateType: "same_exercise_cross_slot" as const,
      exerciseId: row.exerciseId,
      exerciseName: row.exerciseName,
      duplicatedInSlots: Array.from(row.slots).sort((left, right) =>
        left.localeCompare(right),
      ),
      roleBySlot: Object.fromEntries(
        Object.entries(row.roleBySlot).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      setCountBySlot: Object.fromEntries(
        Object.entries(row.setCountBySlot).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      primaryMuscles: Array.from(row.primaryMuscles).sort((left, right) =>
        left.localeCompare(right),
      ),
      movementPatterns: Array.from(row.movementPatterns).sort((left, right) =>
        left.localeCompare(right),
      ),
      exerciseClass:
        Array.from(row.exerciseClasses).sort((left, right) =>
          left.localeCompare(right),
        )[0] ?? null,
    }));
}

export function buildSameSessionVariantCandidates(
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>,
): DuplicateContinuityCandidate[] {
  return finalSlotPlan.flatMap((slot) => {
    const calfExercises = slot.exercises.filter((exercise) => {
      const exerciseClass = toDuplicateClassFamily(getSnapshotExerciseClass(exercise));
      return (
        exerciseClass === "calf_raise" &&
        exercise.primaryMuscles.includes("Calves")
      );
    });
    if (calfExercises.length <= 1) {
      return [];
    }
    const exerciseClasses = uniqueSorted(
      calfExercises
        .map((exercise) => getSnapshotExerciseClass(exercise))
        .filter((value): value is string => value != null),
    );
    const exerciseName = calfExercises
      .map((exercise) => exercise.exerciseName)
      .sort((left, right) => left.localeCompare(right))
      .join(" + ");
    return [{
      duplicateType: "same_session_variant" as const,
      exerciseId: calfExercises
        .map((exercise) => exercise.exerciseId)
        .sort((left, right) => left.localeCompare(right))
        .join("+"),
      exerciseName,
      duplicatedInSlots: [slot.slotId],
      roleBySlot: {
        [slot.slotId]: uniqueSorted(calfExercises.map((exercise) => exercise.role)).join("+"),
      },
      setCountBySlot: {
        [slot.slotId]: calfExercises.reduce(
          (sum, exercise) => sum + exercise.setCount,
          0,
        ),
      },
      primaryMuscles: ["Calves"],
      movementPatterns: uniqueSorted(
        calfExercises.flatMap((exercise) => exercise.movementPatterns),
      ),
      exerciseClass: exerciseClasses.length === 1 ? exerciseClasses[0] : "calf_raise",
    }];
  });
}

export function classifyDiagnosticExerciseForDuplicate(input: {
  exercise: DiagnosticExercise;
  muscle: string;
}): string | null {
  const snapshotExercise: SlotCompositionSnapshotDiagnostic["exercises"][number] = {
    exerciseId: input.exercise.id,
    exerciseName: input.exercise.name,
    role: input.exercise.isMainLiftEligible ? "main" : "accessory",
    setCount: 1,
    primaryMuscles: normalizeExerciseMuscles(input.exercise.primaryMuscles),
    movementPatterns: sortPrescriptionStrings(input.exercise.movementPatterns ?? []),
    effectiveStimulusByMuscle: {},
  };
  return classifySelectedExerciseClass({
    exercise: snapshotExercise,
    muscle: input.muscle,
  });
}

export function buildCompatibleDuplicateAlternatives(input: {
  duplicate: DuplicateContinuityCandidate;
  exerciseLibrary: ReadonlyArray<DiagnosticExercise> | undefined;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  preselectionFeasibility: ReadonlyArray<CleanPreselectionFeasibility>;
}): DuplicateContinuityRow["compatibleAlternatives"] {
  const selectedIds = new Set(
    input.finalSlotPlan.flatMap((slot) =>
      slot.exercises.map((exercise) => exercise.exerciseId),
    ),
  );
  const primaryMuscles = new Set(input.duplicate.primaryMuscles);
  const duplicateClassFamily = toDuplicateClassFamily(input.duplicate.exerciseClass);
  const roleRequiresMain = Object.values(input.duplicate.roleBySlot).some((role) =>
    role.includes("main"),
  );
  const fromLibrary = (input.exerciseLibrary ?? [])
    .filter((exercise) => exercise.id !== input.duplicate.exerciseId)
    .filter((exercise) =>
      normalizeExerciseMuscles(exercise.primaryMuscles).some((muscle) =>
        primaryMuscles.has(muscle),
      ),
    )
    .filter((exercise) =>
      roleRequiresMain
        ? Boolean(exercise.isMainLiftEligible)
        : !Boolean(exercise.isMainLiftEligible),
    )
    .filter((exercise) => !selectedIds.has(exercise.id))
    .map((exercise) => {
      const primary = normalizeExerciseMuscles(exercise.primaryMuscles);
      const muscle = primary.find((value) => primaryMuscles.has(value)) ?? primary[0] ?? "";
      const exerciseClass = muscle
        ? classifyDiagnosticExerciseForDuplicate({ exercise, muscle })
        : null;
      const classFamily = toDuplicateClassFamily(exerciseClass);
      return {
        exerciseName: exercise.name,
        exerciseClass,
        primaryMuscles: primary,
        reasonAvailableOrBlocked: uniqueSorted([
          "primary_muscle_overlap",
          roleRequiresMain ? "main_lift_role_compatible" : "accessory_role_compatible",
          classFamily && classFamily === duplicateClassFamily
            ? "same_class_available"
            : "distinct_class_available",
        ]),
      };
    });

  const fromCandidateInventory = input.preselectionFeasibility
    .filter((row) =>
      input.duplicate.duplicatedInSlots.includes(row.slotId) &&
      primaryMuscles.has(row.muscle),
    )
    .flatMap((row) =>
      row.candidateInventory
        .filter((candidate) =>
          candidate.availability === "clean_available" ||
          candidate.availability === "available_but_already_used_elsewhere",
        )
        .filter((candidate) => candidate.exerciseId !== input.duplicate.exerciseId)
        .map((candidate) => ({
          exerciseName: candidate.exerciseName,
          exerciseClass: candidate.candidateClass,
          primaryMuscles: candidate.primaryMuscles,
          reasonAvailableOrBlocked: uniqueSorted([
            `candidate_inventory:${candidate.availability}`,
            ...candidate.reasons.slice(0, 2),
          ]),
        })),
    );

  const byName = new Map<string, DuplicateContinuityRow["compatibleAlternatives"][number]>();
  for (const alternative of [...fromLibrary, ...fromCandidateInventory]) {
    if (!byName.has(alternative.exerciseName)) {
      byName.set(alternative.exerciseName, alternative);
    }
  }
  return Array.from(byName.values())
    .sort((left, right) => left.exerciseName.localeCompare(right.exerciseName))
    .slice(0, 5);
}

export function matchingDuplicateRows(input: {
  duplicate: DuplicateContinuityCandidate;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): DuplicateExerciseReuseDiagnostic[] {
  return input.duplicateExerciseReuse.filter(
    (row) =>
      row.exerciseId === input.duplicate.exerciseId ||
      row.name === input.duplicate.exerciseName,
  );
}

export function matchingClassDemands(input: {
  duplicate: DuplicateContinuityCandidate;
  exerciseClassDistributionBySlot: ReadonlyArray<ExerciseClassDistributionBySlot>;
}): ExerciseClassDistributionMuscle[] {
  const muscles = new Set(input.duplicate.primaryMuscles);
  return input.exerciseClassDistributionBySlot
    .filter(
      (slot) =>
        slot.week === 1 &&
        input.duplicate.duplicatedInSlots.includes(slot.slotId),
    )
    .flatMap((slot) =>
      slot.muscleDemands.filter((demand) => muscles.has(demand.muscle)),
    );
}

export function chooseDuplicateJustification(input: {
  duplicate: DuplicateContinuityCandidate;
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  classDemands: ReadonlyArray<ExerciseClassDistributionMuscle>;
  compatibleAlternativeExists: boolean | null;
}): DuplicateContinuityRow["justification"] {
  const demandJustifications = input.classDemands.flatMap(
    (demand) => demand.duplicateJustifications,
  );
  if (demandJustifications.includes("deload_skill_preservation")) {
    return "deload_skill_preservation";
  }
  if (demandJustifications.includes("user_preference")) {
    return "user_preference";
  }
  if (
    demandJustifications.includes("no_clean_alternative") ||
    input.duplicateRows.some(
      (row) => !row.hasCompatibleAlternative && row.reason !== "limited_inventory",
    )
  ) {
    return "no_clean_alternative";
  }
  if (
    demandJustifications.includes("limited_inventory") ||
    input.duplicateRows.some((row) => row.reason === "limited_inventory")
  ) {
    return "limited_inventory";
  }
  if (
    demandJustifications.includes("continuity_anchor") ||
    input.duplicateRows.some((row) => row.reason === "main_lift_continuity_allowed")
  ) {
    return "continuity_anchor";
  }
  if (
    demandJustifications.includes("exact_demand_fit") ||
    (input.duplicate.exerciseClass === "stiff_leg_deadlift" &&
      input.duplicate.duplicatedInSlots.includes("lower_b"))
  ) {
    return "exact_demand_fit";
  }
  if (input.duplicate.duplicateType === "same_session_variant") {
    return "unjustified";
  }
  return input.compatibleAlternativeExists === true ? "unjustified" : "unknown";
}

export function chooseDuplicatePolicyRecommendation(input: {
  duplicate: DuplicateContinuityCandidate;
  justification: DuplicateContinuityRow["justification"];
  compatibleAlternativeExists: boolean | null;
}): DuplicateContinuityRow["policyRecommendation"] {
  if (
    input.justification === "limited_inventory" ||
    input.justification === "no_clean_alternative" ||
    input.justification === "deload_skill_preservation"
  ) {
    return input.compatibleAlternativeExists === true
      ? "requires_planner_decision"
      : "allow_duplicate";
  }
  if (input.duplicate.duplicateType === "same_session_variant") {
    return "discourage_duplicate";
  }
  if (
    input.compatibleAlternativeExists === true &&
    input.duplicate.exerciseName.toLowerCase().includes("incline")
  ) {
    return "block_if_clean_alternative_exists";
  }
  if (
    input.compatibleAlternativeExists === true &&
    input.duplicate.exerciseName.toLowerCase().includes("sldl")
  ) {
    return "requires_planner_decision";
  }
  if (
    input.duplicate.exerciseName.toLowerCase().includes("lat pulldown") ||
    input.duplicate.exerciseName.toLowerCase().includes("back squat")
  ) {
    return "discourage_duplicate";
  }
  return input.compatibleAlternativeExists === true
    ? "requires_planner_decision"
    : "discourage_duplicate";
}

export function chooseDuplicateRisk(input: {
  duplicate: DuplicateContinuityCandidate;
  compatibleAlternativeExists: boolean | null;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
}): DuplicateContinuityRow["risk"] {
  const name = input.duplicate.exerciseName.toLowerCase();
  const projectedMuscles = input.projectedDelivery.filter((row) =>
    input.duplicate.primaryMuscles.includes(row.muscle),
  );
  const underTarget = projectedMuscles.some(
    (row) =>
      row.preferredTarget != null &&
      row.projectedEffectiveStimulusAfterRepairAndFinalShaping + 1e-9 <
        row.preferredTarget,
  );
  const overTarget = projectedMuscles.some(
    (row) =>
      row.preferredTarget != null &&
      row.projectedEffectiveStimulusAfterRepairAndFinalShaping >
        row.preferredTarget + 1e-9,
  );
  if (
    name.includes("incline") &&
    (underTarget || input.compatibleAlternativeExists === true)
  ) {
    return "high";
  }
  if (name.includes("sldl") && overTarget) {
    return "high";
  }
  if (input.duplicate.duplicateType === "same_session_variant") {
    return input.compatibleAlternativeExists === true ? "moderate" : "low";
  }
  return Object.values(input.duplicate.roleBySlot).some((role) => role.includes("main")) ||
    input.compatibleAlternativeExists === true
    ? "moderate"
    : "low";
}

export function buildDuplicateEvidence(input: {
  duplicate: DuplicateContinuityCandidate;
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  classDemands: ReadonlyArray<ExerciseClassDistributionMuscle>;
  unresolvedCauses: ReadonlyArray<ExerciseClassUnresolvedCause>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  accumulationWeekProjection: AccumulationWeekProjection | null;
}): string[] {
  const muscles = new Set(input.duplicate.primaryMuscles);
  const deliveryEvidence = input.projectedDelivery
    .filter((row) => muscles.has(row.muscle))
    .map(
      (row) =>
        `${row.muscle}:final=${row.projectedEffectiveStimulusAfterRepairAndFinalShaping}:preferred=${formatNullableNumber(row.preferredTarget)}`,
    );
  const accumulationEvidence = (input.accumulationWeekProjection?.crossWeekWarnings ?? [])
    .filter((warning) =>
      warning.code.includes("DUPLICATE") ||
      (warning.muscle != null && muscles.has(warning.muscle)),
    )
    .flatMap((warning) => warning.evidence.map((row) => `${warning.code}:${row}`));
  return compactDiagnosticStrings(
    [
      `duplicate_type:${input.duplicate.duplicateType}`,
      `slots:${input.duplicate.duplicatedInSlots.join("+")}`,
      ...input.duplicateRows.map(
        (row) =>
          `duplicate_reuse:${row.name}:${row.reason}:alternative=${row.hasCompatibleAlternative}`,
      ),
      ...input.classDemands.flatMap((demand) => [
        `${demand.muscle}:duplicate_policy=${demand.duplicatePolicy}`,
        ...demand.inventoryEvidence.filter((row) => row.startsWith("duplicate:")),
        ...demand.limitations.filter((row) => row.includes("duplicate")),
      ]),
      ...input.unresolvedCauses
        .filter((cause) => muscles.has(cause.muscle))
        .map((cause) => `${cause.muscle}:${cause.owningCause}`),
      ...deliveryEvidence,
      ...accumulationEvidence,
    ],
    8,
  );
}

export function buildDuplicateContinuityJustification(input: {
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  exerciseLibrary?: ReadonlyArray<DiagnosticExercise>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  exerciseClassDistributionBySlot: ReadonlyArray<ExerciseClassDistributionBySlot>;
  exerciseClassUnresolvedCauses: ReadonlyArray<ExerciseClassUnresolvedCause>;
  preselectionFeasibility: ReadonlyArray<CleanPreselectionFeasibility>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  accumulationWeekProjection: AccumulationWeekProjection | null;
}): DuplicateContinuityJustification {
  const candidates = [
    ...buildCrossSlotDuplicateCandidates(input.finalSlotPlan),
    ...buildSameSessionVariantCandidates(input.finalSlotPlan),
  ];
  const duplicates = candidates.map((duplicate) => {
    const duplicateRows = matchingDuplicateRows({
      duplicate,
      duplicateExerciseReuse: input.duplicateExerciseReuse,
    });
    const classDemands = matchingClassDemands({
      duplicate,
      exerciseClassDistributionBySlot: input.exerciseClassDistributionBySlot,
    });
    const compatibleAlternatives = buildCompatibleDuplicateAlternatives({
      duplicate,
      exerciseLibrary: input.exerciseLibrary,
      finalSlotPlan: input.finalSlotPlan,
      preselectionFeasibility: input.preselectionFeasibility,
    });
    const compatibleAlternativeExists =
      duplicateRows.some((row) => row.hasCompatibleAlternative) ||
      compatibleAlternatives.length > 0
        ? true
        : duplicateRows.some((row) => !row.hasCompatibleAlternative)
          ? false
          : input.exerciseLibrary
            ? false
            : null;
    const justification = chooseDuplicateJustification({
      duplicate,
      duplicateRows,
      classDemands,
      compatibleAlternativeExists,
    });
    const policyRecommendation = chooseDuplicatePolicyRecommendation({
      duplicate,
      justification,
      compatibleAlternativeExists,
    });
    const risk = chooseDuplicateRisk({
      duplicate,
      compatibleAlternativeExists,
      projectedDelivery: input.projectedDelivery,
    });

    return {
      ...duplicate,
      justification,
      compatibleAlternativeExists,
      compatibleAlternatives,
      policyRecommendation,
      risk,
      evidence: buildDuplicateEvidence({
        duplicate,
        duplicateRows,
        classDemands,
        unresolvedCauses: input.exerciseClassUnresolvedCauses,
        projectedDelivery: input.projectedDelivery,
        accumulationWeekProjection: input.accumulationWeekProjection,
      }),
      limitations: [
        "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
        "uses_existing_planningReality_rows_only",
        "does_not_replay_candidate_ranking_or_selection_trials",
        "compatible_alternatives_are_compact_visibility_not_full_inventory",
      ],
    };
  }).sort(
    (left, right) =>
      left.risk.localeCompare(right.risk) ||
      left.exerciseName.localeCompare(right.exerciseName),
  );

  return {
    version: 1,
    source: "diagnostic_shadow_planner",
    readOnly: true,
    affectsScoringOrGeneration: false,
    duplicates,
    summary: {
      totalDuplicates: duplicates.length,
      justifiedDuplicates: duplicates.filter(
        (row) => row.justification !== "unjustified" && row.justification !== "unknown",
      ).length,
      unjustifiedOrUnknown: duplicates.filter(
        (row) => row.justification === "unjustified" || row.justification === "unknown",
      ).length,
      cleanAlternativeAvailable: duplicates.filter(
        (row) => row.compatibleAlternativeExists === true,
      ).length,
      highRiskDuplicates: duplicates.filter((row) => row.risk === "high").length,
    },
  };
}

