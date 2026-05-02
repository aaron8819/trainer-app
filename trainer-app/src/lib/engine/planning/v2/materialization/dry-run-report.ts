import type { V2ExerciseSelectionPlan } from "../types";
import { buildV2ExerciseMaterializationPlan } from "./materializer";
import { resolveV2ExerciseClassIds } from "./taxonomy";
import type {
  V2ExerciseMaterializationInput,
  V2ExerciseMaterializationPlan,
  V2MaterializationDryRunReport,
  V2MaterializationDryRunReportInput,
  V2MaterializationDryRunReportReason,
  V2MaterializationDryRunReportPreviewSlot,
  V2MaterializationExercise,
} from "./types";

const STRIPPED_MATERIALIZER_FIELDS = [
  "laneIds",
  "dryRunOnly",
  "status",
  "blockers",
  "omissions",
  "source",
  "version",
] as const;

const DEFAULT_CONSTRAINTS: V2ExerciseMaterializationInput["constraints"] = {
  avoidExerciseIds: [],
  favoriteExerciseIds: [],
  painConflictExerciseIds: [],
};

type CompatibilityIssue = {
  slotId?: string;
  laneId?: string;
  reason: string;
};

type CompatibilitySummary = V2MaterializationDryRunReport["seedShapeCompatibility"];

export function buildV2MaterializationDryRunReport(
  input: V2MaterializationDryRunReportInput,
): V2MaterializationDryRunReport {
  const exerciseSelectionPlan =
    input.exerciseSelectionPlan ?? input.plannerPolicy?.exerciseSelectionPlan ?? null;
  const plannerPolicyAvailable = input.plannerPolicy !== null && input.plannerPolicy !== undefined;
  const exerciseSelectionPlanAvailable = exerciseSelectionPlan !== null;
  const taxonomyAvailable = input.taxonomy !== null && input.taxonomy !== undefined;
  const inventoryAvailable = Boolean(input.inventory?.length);
  const availabilityBlockers = buildAvailabilityBlockers({
    plannerPolicyAvailable,
    exerciseSelectionPlanAvailable,
    taxonomyAvailable,
    inventoryAvailable,
  });

  const materializedPlan =
    input.materializedPlan ??
    (exerciseSelectionPlan && input.taxonomy && input.inventory
      ? buildV2ExerciseMaterializationPlan({
          exerciseSelectionPlan,
          taxonomy: input.taxonomy,
          inventory: input.inventory,
          constraints: input.constraints ?? DEFAULT_CONSTRAINTS,
          ...(input.continuity ? { continuity: input.continuity } : {}),
        })
      : null);

  const unsupportedClassIssues =
    exerciseSelectionPlan && input.taxonomy
      ? findUnsupportedClassIssues(exerciseSelectionPlan, input.taxonomy)
      : [];
  const nameById = buildExerciseNameIndex(input.inventory ?? [], input.exerciseNameById);
  const compatibility = materializedPlan
    ? evaluateSeedShapeCompatibility({
        materializedPlan,
        exerciseSelectionPlan,
        nameById,
        unsupportedClassIssues,
      })
    : emptyCompatibility(unsupportedClassIssues.length);
  const unsupportedClassBlockers = unsupportedClassIssues.filter(
    (issue) => issue.reason !== "optional_unsupported_exercise_class",
  );
  const unsupportedClassOmissions = unsupportedClassIssues.filter(
    (issue) => issue.reason === "optional_unsupported_exercise_class",
  );
  const compatibilityBlockers = compatibility.issues.map(({ reason, slotId, laneId }) => ({
    ...(slotId ? { slotId } : {}),
    ...(laneId ? { laneId } : {}),
    reason,
  }));
  const materializerBlockers = materializedPlan?.blockers ?? [];
  const omissions = [...(materializedPlan?.omissions ?? []), ...unsupportedClassOmissions];
  const blockers = [
    ...availabilityBlockers,
    ...unsupportedClassBlockers,
    ...materializerBlockers,
    ...compatibilityBlockers,
  ];
  const canPreview =
    materializedPlan?.status === "materialized" &&
    materializerBlockers.length === 0 &&
    compatibility.summary.compatible;
  const requiredLaneCoverageBySlot = summarizeRequiredLaneCoverage({
    exerciseSelectionPlan,
    materializedPlan,
    blockers,
  });

  return {
    version: 1,
    source: "v2_exercise_materialization",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    status: reportStatus({
      materializedPlan,
      blockers,
      compatible: compatibility.summary.compatible,
    }),
    plannerPolicyAvailable,
    exerciseSelectionPlanAvailable,
    taxonomyAvailable,
    inventoryAvailable,
    materializer: {
      status: materializedPlan?.status ?? "blocked",
      blockerCount: materializerBlockers.length,
      omissionCount: omissions.length,
    },
    seedShapeCompatibility: compatibility.summary,
    requiredLaneCoverageBySlot,
    executableSeedPreview: canPreview
      ? buildExecutableSeedPreview({
          materializedPlan,
          nameById,
          slotIntentById: input.slotIntentById ?? {},
        })
      : [],
    candidateIdentitySummary: buildCandidateIdentitySummary({
      materializedPlan,
      exerciseSelectionPlan,
      nameById,
    }),
    strippedMaterializerFields: [...STRIPPED_MATERIALIZER_FIELDS],
    blockers,
    omissions,
    readiness: {
      safeToPromoteToProductionWrite: false,
      missingBeforePromotion: missingBeforePromotion({
        inventoryAvailable,
        taxonomyAvailable,
        exerciseSelectionPlanAvailable,
        compatible: compatibility.summary.compatible,
        materializerStatus: materializedPlan?.status ?? "blocked",
      }),
    },
  };
}

function buildCandidateIdentitySummary(input: {
  materializedPlan: V2ExerciseMaterializationPlan | null;
  exerciseSelectionPlan: V2ExerciseSelectionPlan | null;
  nameById: Record<string, string | undefined>;
}): V2MaterializationDryRunReport["candidateIdentitySummary"] {
  const laneRoleByKey = buildLaneRoleIndex(input.exerciseSelectionPlan);
  const rows = (input.materializedPlan?.slots ?? []).flatMap((slot) =>
    slot.exercises.flatMap((exercise) => {
      const laneIds = exercise.laneIds.length ? exercise.laneIds : ["unknown"];
      return laneIds.map((laneId) => ({
        slotId: slot.slotId,
        laneId,
        ...(laneRoleByKey.get(`${slot.slotId}:${laneId}`)
          ? { laneRole: laneRoleByKey.get(`${slot.slotId}:${laneId}`) }
          : {}),
        seedRole: exercise.role,
        selectedExercise: {
          exerciseId: exercise.exerciseId,
          ...(input.nameById[exercise.exerciseId]
            ? { name: input.nameById[exercise.exerciseId] }
            : {}),
        },
        setCount: exercise.setCount,
        topAlternatives: [],
      }));
    }),
  );

  return {
    available: rows.length > 0,
    rowCount: rows.length,
    detailLevel: "selected_identity",
    rankingDetailAvailability: {
      topAlternatives: "not_available",
      scoreTuple: "not_available",
      selectedReason: "not_available",
      reason: "materializer_does_not_emit_candidate_ranking",
    },
    rows,
  };
}

function buildLaneRoleIndex(
  exerciseSelectionPlan: V2ExerciseSelectionPlan | null,
): Map<string, string> {
  const laneRoleByKey = new Map<string, string>();
  for (const week of [...(exerciseSelectionPlan?.weeks ?? [])].sort(
    (left, right) => left.week - right.week,
  )) {
    for (const slot of [...week.slots].sort(
      (left, right) =>
        left.slotIndex - right.slotIndex || left.slotId.localeCompare(right.slotId),
    )) {
      for (const lane of slot.lanes) {
        const key = `${slot.slotId}:${lane.laneId}`;
        if (!laneRoleByKey.has(key)) {
          laneRoleByKey.set(key, lane.role);
        }
      }
    }
  }
  return laneRoleByKey;
}

function summarizeRequiredLaneCoverage(input: {
  exerciseSelectionPlan: V2ExerciseSelectionPlan | null;
  materializedPlan: V2ExerciseMaterializationPlan | null;
  blockers: V2MaterializationDryRunReportReason[];
}): V2MaterializationDryRunReport["requiredLaneCoverageBySlot"] {
  if (!input.exerciseSelectionPlan) {
    return [];
  }
  const blockers = new Set(
    input.blockers.map((blocker) =>
      blocker.slotId && blocker.laneId ? `${blocker.slotId}:${blocker.laneId}` : "",
    ),
  );
  const materialized = new Set(
    (input.materializedPlan?.slots ?? []).flatMap((slot) =>
      slot.exercises.flatMap((exercise) =>
        exercise.laneIds.map((laneId) => `${slot.slotId}:${laneId}`),
      ),
    ),
  );
  const seenSlots = new Set<string>();

  return input.exerciseSelectionPlan.weeks.flatMap((week) =>
    week.slots.flatMap((slot) => {
      if (seenSlots.has(slot.slotId)) {
        return [];
      }
      seenSlots.add(slot.slotId);
      const requiredLaneIds = slot.lanes
        .filter((lane) => lane.requirement === "required")
        .map((lane) => lane.laneId);
      const materializedRequiredLaneIds = requiredLaneIds.filter((laneId) =>
        materialized.has(`${slot.slotId}:${laneId}`),
      );
      const blockedRequiredLaneIds = requiredLaneIds.filter((laneId) =>
        blockers.has(`${slot.slotId}:${laneId}`),
      );

      return [
        {
          slotId: slot.slotId,
          requiredLaneCount: requiredLaneIds.length,
          materializedRequiredLaneCount: materializedRequiredLaneIds.length,
          blockedRequiredLaneCount: blockedRequiredLaneIds.length,
          missingRequiredLaneIds: requiredLaneIds.filter(
            (laneId) => !materialized.has(`${slot.slotId}:${laneId}`),
          ),
        },
      ];
    }),
  );
}

function buildAvailabilityBlockers(input: {
  plannerPolicyAvailable: boolean;
  exerciseSelectionPlanAvailable: boolean;
  taxonomyAvailable: boolean;
  inventoryAvailable: boolean;
}): V2MaterializationDryRunReportReason[] {
  return [
    ...(input.plannerPolicyAvailable
      ? []
      : [{ reason: "planner_policy_unavailable" }]),
    ...(input.exerciseSelectionPlanAvailable
      ? []
      : [{ reason: "exercise_selection_plan_unavailable" }]),
    ...(input.taxonomyAvailable ? [] : [{ reason: "taxonomy_unavailable" }]),
    ...(input.inventoryAvailable ? [] : [{ reason: "inventory_unavailable" }]),
  ];
}

function findUnsupportedClassIssues(
  plan: V2ExerciseSelectionPlan,
  taxonomy: NonNullable<V2MaterializationDryRunReportInput["taxonomy"]>,
): CompatibilityIssue[] {
  return plan.weeks.flatMap((week) =>
    week.slots.flatMap((slot) =>
      slot.lanes.flatMap((lane) => {
        const classNames = [
          ...lane.acceptableExerciseClasses,
          ...lane.preferredExerciseClasses,
        ];
        if (resolveV2ExerciseClassIds(taxonomy, classNames).length > 0) {
          return [];
        }
        return [
          {
            slotId: slot.slotId,
            laneId: lane.laneId,
            reason:
              lane.requirement === "optional"
                ? "optional_unsupported_exercise_class"
                : "unsupported_exercise_class",
          },
        ];
      }),
    ),
  );
}

function buildExerciseNameIndex(
  inventory: V2MaterializationExercise[],
  exerciseNameById: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
  const fromInventory = Object.fromEntries(
    inventory.map((exercise) => [exercise.exerciseId, exercise.name]),
  );
  return {
    ...fromInventory,
    ...(exerciseNameById ?? {}),
  };
}

function emptyCompatibility(unsupportedClassCount: number): {
  summary: CompatibilitySummary;
  issues: CompatibilityIssue[];
} {
  return {
    summary: {
      compatible: false,
      slotCount: 0,
      exerciseCount: 0,
      missingNameCount: 0,
      duplicateExerciseIdWithinSlotCount: 0,
      invalidRoleCount: 0,
      invalidSetCount: 0,
      unsupportedClassCount,
    },
    issues: [],
  };
}

function evaluateSeedShapeCompatibility(input: {
  materializedPlan: V2ExerciseMaterializationPlan;
  exerciseSelectionPlan: V2ExerciseSelectionPlan | null;
  nameById: Record<string, string | undefined>;
  unsupportedClassIssues: CompatibilityIssue[];
}): {
  summary: CompatibilitySummary;
  issues: CompatibilityIssue[];
} {
  let missingNameCount = 0;
  let duplicateExerciseIdWithinSlotCount = 0;
  let invalidRoleCount = 0;
  let invalidSetCount = 0;
  const issues: CompatibilityIssue[] = [];

  for (const slot of input.materializedPlan.slots) {
    const exerciseIds = new Set<string>();
    for (const exercise of slot.exercises) {
      const laneId = exercise.laneIds[0];
      if (!input.nameById[exercise.exerciseId]) {
        missingNameCount += 1;
        issues.push({
          slotId: slot.slotId,
          ...(laneId ? { laneId } : {}),
          reason: "missing_exercise_name",
        });
      }
      if (exerciseIds.has(exercise.exerciseId)) {
        duplicateExerciseIdWithinSlotCount += 1;
        issues.push({
          slotId: slot.slotId,
          ...(laneId ? { laneId } : {}),
          reason: "duplicate_exercise_id_within_slot",
        });
      }
      exerciseIds.add(exercise.exerciseId);

      if (exercise.role !== "CORE_COMPOUND" && exercise.role !== "ACCESSORY") {
        invalidRoleCount += 1;
        issues.push({
          slotId: slot.slotId,
          ...(laneId ? { laneId } : {}),
          reason: "invalid_seed_role",
        });
      }
      if (!Number.isInteger(exercise.setCount) || exercise.setCount <= 0) {
        invalidSetCount += 1;
        issues.push({
          slotId: slot.slotId,
          ...(laneId ? { laneId } : {}),
          reason: "invalid_seed_set_count",
        });
      }
    }
  }

  const summary = {
    compatible:
      input.materializedPlan.dryRunOnly === true &&
      input.materializedPlan.status === "materialized" &&
      input.materializedPlan.blockers.length === 0 &&
      missingNameCount === 0 &&
      duplicateExerciseIdWithinSlotCount === 0 &&
      invalidRoleCount === 0 &&
      invalidSetCount === 0 &&
      input.unsupportedClassIssues.filter(
        (issue) => issue.reason !== "optional_unsupported_exercise_class",
      ).length === 0,
    slotCount: input.materializedPlan.slots.length,
    exerciseCount: input.materializedPlan.slots.reduce(
      (sum, slot) => sum + slot.exercises.length,
      0,
    ),
    missingNameCount,
    duplicateExerciseIdWithinSlotCount,
    invalidRoleCount,
    invalidSetCount,
    unsupportedClassCount: input.unsupportedClassIssues.length,
  };

  return { summary, issues };
}

function buildExecutableSeedPreview(input: {
  materializedPlan: V2ExerciseMaterializationPlan;
  nameById: Record<string, string | undefined>;
  slotIntentById: Record<string, string | undefined>;
}): V2MaterializationDryRunReportPreviewSlot[] {
  return input.materializedPlan.slots.map((slot) => ({
    slotId: slot.slotId,
    ...(input.slotIntentById[slot.slotId]
      ? { intent: input.slotIntentById[slot.slotId] }
      : {}),
    exercises: slot.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      ...(input.nameById[exercise.exerciseId]
        ? { name: input.nameById[exercise.exerciseId] }
        : {}),
      role: exercise.role,
      setCount: exercise.setCount,
    })),
  }));
}

function reportStatus(input: {
  materializedPlan: V2ExerciseMaterializationPlan | null;
  blockers: V2MaterializationDryRunReportReason[];
  compatible: boolean;
}): V2MaterializationDryRunReport["status"] {
  if (!input.materializedPlan || input.materializedPlan.status === "blocked") {
    return "blocked";
  }
  if (input.blockers.length > 0 || !input.compatible) {
    return "partial";
  }
  return "materialized";
}

function missingBeforePromotion(input: {
  inventoryAvailable: boolean;
  taxonomyAvailable: boolean;
  exerciseSelectionPlanAvailable: boolean;
  compatible: boolean;
  materializerStatus: "materialized" | "blocked";
}): string[] {
  return [
    ...(input.exerciseSelectionPlanAvailable
      ? []
      : ["exercise_selection_plan_availability"]),
    ...(input.taxonomyAvailable ? [] : ["taxonomy_bridge_availability"]),
    ...(input.inventoryAvailable ? [] : ["inventory_bridge_or_snapshot"]),
    ...(input.materializerStatus === "materialized"
      ? []
      : ["materializer_blockers_resolved"]),
    ...(input.compatible ? [] : ["seed_shape_compatibility"]),
    "live_inventory_wiring",
    "production_acceptance_write_path",
    "slotPlanSeedJson_write_gate",
    "runtime_replay_consumption",
    "audit_serialization_contract",
    "receipt_and_save_log_flow_contracts",
  ];
}
