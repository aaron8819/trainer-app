import { createHash } from "node:crypto";
import type { V2AcceptedPlannerIntentDto } from "./accepted-planner-intent-dto";
import type { V2ExerciseMaterializationPlan } from "./materialization/types";
import type { V2PlannerPhase } from "./types";

export const SESSION_CAPACITY_REDUCTION_TRANSFORM_VERSION =
  "short_today_v1" as const;

export type SessionCapacityOmissionClass =
  | "optional_top_up"
  | "preferred_surplus"
  | "none";

export type SessionCapacityProtectedClaim = {
  kind:
    | "primary_anchor"
    | "required_role"
    | "direct_floor"
    | "direct_exposure"
    | "hamstring_hinge"
    | "hamstring_knee_flexion"
    | "calf_exposure"
    | "minimum_session";
  minimumRetainedSetCount: number;
};

export type SessionCapacityReductionManifestRow = {
  exerciseId: string;
  plannedSetCount: number;
  shortSetCount: number;
  omissionClass: SessionCapacityOmissionClass;
  yieldOrder: number | null;
  protectedClaims: SessionCapacityProtectedClaim[];
};

export type SessionCapacityReductionVariant = {
  week: number;
  phase: Exclude<V2PlannerPhase, "deload">;
  slotId: string;
  rows: SessionCapacityReductionManifestRow[];
  sessionProtectionProof: {
    anchorsRetained: true;
    requiredRolesRetained: true;
    directFloorsRetained: true;
    exposureRowsRetained: true;
    minimumSessionValidityRetained: true;
  };
};

export type SessionCapacityReductionManifest = {
  version: 1;
  transformVersion: typeof SESSION_CAPACITY_REDUCTION_TRANSFORM_VERSION;
  seedRevisionNumber: 1;
  executableRowsHash: string;
  variants: SessionCapacityReductionVariant[];
};

type ExecutableSlot = {
  slotId: string;
  exercises: Array<{
    exerciseId: string;
    role: "CORE_COMPOUND" | "ACCESSORY";
    setCount: number;
  }>;
};

const YIELD_ORDER_BY_LANE_ID: Record<
  string,
  { order: number; omissionClass: Exclude<SessionCapacityOmissionClass, "none"> }
> = {
  optional_triceps_if_under_target: {
    order: 1,
    omissionClass: "optional_top_up",
  },
  biceps: { order: 2, omissionClass: "preferred_surplus" },
  rear_delt: { order: 3, omissionClass: "preferred_surplus" },
  calves: { order: 4, omissionClass: "preferred_surplus" },
  side_delt_isolation: { order: 5, omissionClass: "preferred_surplus" },
  triceps: { order: 6, omissionClass: "preferred_surplus" },
  hamstring_curl: { order: 7, omissionClass: "preferred_surplus" },
  hinge_anchor: { order: 7, omissionClass: "preferred_surplus" },
  knee_flexion_curl: { order: 7, omissionClass: "preferred_surplus" },
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintSessionCapacityExecutableRows(
  slots: ReadonlyArray<ExecutableSlot>,
): string {
  return createHash("sha256")
    .update(
      stableJson(
        slots.map((slot) => ({
          slotId: slot.slotId,
          exercises: slot.exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            role: exercise.role,
            setCount: exercise.setCount,
          })),
        })),
      ),
    )
    .digest("hex");
}

function claim(
  kind: SessionCapacityProtectedClaim["kind"],
  minimumRetainedSetCount: number,
): SessionCapacityProtectedClaim {
  return { kind, minimumRetainedSetCount };
}

function buildRow(input: {
  exercise: ExecutableSlot["exercises"][number];
  laneIds: string[];
  acceptedIntent: V2AcceptedPlannerIntentDto;
  week: number;
  slotId: string;
}): SessionCapacityReductionManifestRow {
  const lanePolicies =
    input.acceptedIntent.weekPolicies
      .find((week) => week.week === input.week)
      ?.slots.find((slot) => slot.slotId === input.slotId)
      ?.lanes.filter((lane) => input.laneIds.includes(lane.laneId)) ?? [];
  const yieldPolicies = input.laneIds
    .map((laneId) => YIELD_ORDER_BY_LANE_ID[laneId])
    .filter((row): row is NonNullable<typeof row> => row != null);
  const protectedClaims: SessionCapacityProtectedClaim[] = [];
  let minimumRetainedSetCount = 0;

  for (const lane of lanePolicies) {
    if (lane.role === "anchor") {
      minimumRetainedSetCount = input.exercise.setCount;
      protectedClaims.push(claim("primary_anchor", input.exercise.setCount));
    } else if (lane.requirement === "required") {
      const minimum = Math.min(input.exercise.setCount, lane.setBudget.min);
      minimumRetainedSetCount = Math.max(minimumRetainedSetCount, minimum);
      protectedClaims.push(claim("required_role", minimum));
    }
    if (lane.supportDirectFloor) {
      const minimum = Math.min(
        input.exercise.setCount,
        Math.max(1, lane.supportDirectFloor.minDirectSets),
      );
      minimumRetainedSetCount = Math.max(minimumRetainedSetCount, minimum);
      protectedClaims.push(claim("direct_floor", minimum));
      protectedClaims.push(claim("direct_exposure", Math.min(1, minimum)));
      if (lane.supportDirectFloor.muscle === "Calves") {
        protectedClaims.push(claim("calf_exposure", Math.min(1, minimum)));
      }
    }
    if (
      lane.laneId === "hinge_anchor" ||
      lane.acceptableExerciseClasses.includes("hinge_compound")
    ) {
      const minimum = Math.min(input.exercise.setCount, Math.max(1, lane.setBudget.min));
      minimumRetainedSetCount = Math.max(minimumRetainedSetCount, minimum);
      protectedClaims.push(claim("hamstring_hinge", minimum));
    }
    if (
      lane.laneId === "hamstring_curl" ||
      lane.laneId === "knee_flexion_curl" ||
      lane.acceptableExerciseClasses.includes("knee_flexion_curl")
    ) {
      const minimum = Math.min(input.exercise.setCount, Math.max(1, lane.setBudget.min));
      minimumRetainedSetCount = Math.max(minimumRetainedSetCount, minimum);
      protectedClaims.push(claim("hamstring_knee_flexion", minimum));
    }
    if (lane.laneId === "calves") {
      const minimum = Math.min(
        input.exercise.setCount,
        Math.max(1, lane.setBudget.min),
      );
      minimumRetainedSetCount = Math.max(minimumRetainedSetCount, minimum);
      protectedClaims.push(claim("calf_exposure", minimum));
    }
  }

  const bestYield = yieldPolicies.sort((left, right) => left.order - right.order)[0];
  const capacityProfile =
    input.acceptedIntent.capacitySelection?.internalProfileId ?? "preferred";
  const isEfficient = capacityProfile === "minimal";
  const isBalanced = capacityProfile === "moderate";
  const isBicepsPreference = input.laneIds.includes("biceps");
  const isOptionalTopUp = input.laneIds.includes(
    "optional_triceps_if_under_target",
  );
  const hasNonYieldableRoleClaim = protectedClaims.some(
    (entry) =>
      entry.kind === "primary_anchor" ||
      entry.kind === "required_role" ||
      entry.kind === "hamstring_hinge" ||
      entry.kind === "hamstring_knee_flexion" ||
      entry.kind === "calf_exposure",
  );
  if ((isBicepsPreference || isOptionalTopUp) && !hasNonYieldableRoleClaim) {
    minimumRetainedSetCount = 0;
    protectedClaims.splice(
      0,
      protectedClaims.length,
      ...protectedClaims.filter(
        (entry) =>
          entry.kind !== "direct_floor" &&
          entry.kind !== "direct_exposure",
      ),
    );
  }
  const shortSetCount =
    bestYield && !isEfficient && (!isBalanced || bestYield.order <= 2)
      ? Math.min(input.exercise.setCount, minimumRetainedSetCount)
      : input.exercise.setCount;

  return {
    exerciseId: input.exercise.exerciseId,
    plannedSetCount: input.exercise.setCount,
    shortSetCount,
    omissionClass:
      shortSetCount < input.exercise.setCount && bestYield
        ? bestYield.omissionClass
        : "none",
    yieldOrder:
      shortSetCount < input.exercise.setCount && bestYield
        ? bestYield.order
        : null,
    protectedClaims: protectedClaims.filter(
      (entry, index, entries) =>
        entries.findIndex(
          (candidate) =>
            candidate.kind === entry.kind &&
            candidate.minimumRetainedSetCount === entry.minimumRetainedSetCount,
        ) === index,
    ),
  };
}

export function buildSessionCapacityReductionManifest(input: {
  executableSlots: ReadonlyArray<ExecutableSlot>;
  materializedPlan: V2ExerciseMaterializationPlan;
  acceptedIntent: V2AcceptedPlannerIntentDto;
}): SessionCapacityReductionManifest | undefined {
  if (input.materializedPlan.status !== "materialized") {
    return undefined;
  }
  const materializedBySlot = new Map(
    input.materializedPlan.slots.map((slot) => [slot.slotId, slot]),
  );
  const variants: SessionCapacityReductionVariant[] = [];

  for (const week of input.acceptedIntent.weekPolicies) {
    if (week.phase === "deload") {
      continue;
    }
    for (const slot of input.executableSlots) {
      const materialized = materializedBySlot.get(slot.slotId);
      if (!materialized) {
        return undefined;
      }
      const rows = slot.exercises.map((exercise) => {
        const concrete = materialized.exercises.find(
          (row) => row.exerciseId === exercise.exerciseId,
        );
        if (!concrete || concrete.setCount !== exercise.setCount) {
          throw new Error("SESSION_CAPACITY_MANIFEST_ROW_BINDING_INVALID");
        }
        return buildRow({
          exercise,
          laneIds: concrete.laneIds,
          acceptedIntent: input.acceptedIntent,
          week: week.week,
          slotId: slot.slotId,
        });
      });
      rows.forEach((row) => {
        row.protectedClaims.push(claim("minimum_session", row.shortSetCount > 0 ? 1 : 0));
      });
      variants.push({
        week: week.week,
        phase: week.phase,
        slotId: slot.slotId,
        rows,
        sessionProtectionProof: {
          anchorsRetained: true,
          requiredRolesRetained: true,
          directFloorsRetained: true,
          exposureRowsRetained: true,
          minimumSessionValidityRetained: true,
        },
      });
    }
  }

  return {
    version: 1,
    transformVersion: SESSION_CAPACITY_REDUCTION_TRANSFORM_VERSION,
    seedRevisionNumber: 1,
    executableRowsHash: fingerprintSessionCapacityExecutableRows(
      input.executableSlots,
    ),
    variants,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

const PROTECTED_CLAIM_KINDS = new Set<
  SessionCapacityProtectedClaim["kind"]
>([
  "primary_anchor",
  "required_role",
  "direct_floor",
  "direct_exposure",
  "hamstring_hinge",
  "hamstring_knee_flexion",
  "calf_exposure",
  "minimum_session",
]);

function sanitizeManifestRow(
  value: unknown,
): SessionCapacityReductionManifestRow | null {
  const row = isRecord(value) ? value : null;
  if (
    !row ||
    typeof row.exerciseId !== "string" ||
    !row.exerciseId.trim() ||
    !isPositiveInteger(row.plannedSetCount) ||
    !isNonNegativeInteger(row.shortSetCount) ||
    row.shortSetCount > row.plannedSetCount ||
    (row.omissionClass !== "optional_top_up" &&
      row.omissionClass !== "preferred_surplus" &&
      row.omissionClass !== "none") ||
    (row.yieldOrder !== null && !isPositiveInteger(row.yieldOrder)) ||
    !Array.isArray(row.protectedClaims)
  ) {
    return null;
  }
  const shortSetCount = row.shortSetCount as number;
  const protectedClaims = row.protectedClaims.map((value) => {
    const protectedClaim = isRecord(value) ? value : null;
    return protectedClaim &&
      typeof protectedClaim.kind === "string" &&
      PROTECTED_CLAIM_KINDS.has(
        protectedClaim.kind as SessionCapacityProtectedClaim["kind"],
      ) &&
      isNonNegativeInteger(protectedClaim.minimumRetainedSetCount) &&
      protectedClaim.minimumRetainedSetCount <= shortSetCount
      ? {
          kind: protectedClaim.kind as SessionCapacityProtectedClaim["kind"],
          minimumRetainedSetCount: protectedClaim.minimumRetainedSetCount,
        }
      : null;
  });
  if (protectedClaims.some((claim) => claim == null)) {
    return null;
  }
  if (
    (row.shortSetCount === row.plannedSetCount &&
      (row.omissionClass !== "none" || row.yieldOrder !== null)) ||
    (row.shortSetCount < row.plannedSetCount &&
      (row.omissionClass === "none" || row.yieldOrder === null))
  ) {
    return null;
  }
  return {
    exerciseId: row.exerciseId.trim(),
    plannedSetCount: row.plannedSetCount,
    shortSetCount,
    omissionClass: row.omissionClass,
    yieldOrder: row.yieldOrder,
    protectedClaims: protectedClaims as SessionCapacityProtectedClaim[],
  };
}

export function sanitizeSessionCapacityReductionManifest(
  value: unknown,
): SessionCapacityReductionManifest | undefined {
  const manifest = isRecord(value) ? value : null;
  if (
    !manifest ||
    manifest.version !== 1 ||
    manifest.transformVersion !== SESSION_CAPACITY_REDUCTION_TRANSFORM_VERSION ||
    manifest.seedRevisionNumber !== 1 ||
    typeof manifest.executableRowsHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.executableRowsHash) ||
    !Array.isArray(manifest.variants)
  ) {
    return undefined;
  }
  const variants = manifest.variants.map((value) => {
    const variant = isRecord(value) ? value : null;
    const proof = isRecord(variant?.sessionProtectionProof)
      ? variant.sessionProtectionProof
      : null;
    const rows = Array.isArray(variant?.rows)
      ? variant.rows.map(sanitizeManifestRow)
      : null;
    if (
      !variant ||
      !isPositiveInteger(variant.week) ||
      (variant.phase !== "entry_calibration" &&
        variant.phase !== "accumulation" &&
        variant.phase !== "hard_accumulation" &&
        variant.phase !== "peak_overreach_lite") ||
      typeof variant.slotId !== "string" ||
      !variant.slotId.trim() ||
      !rows ||
      rows.length === 0 ||
      rows.some((row) => row == null) ||
      new Set(rows.map((row) => row?.exerciseId)).size !== rows.length ||
      !proof ||
      proof.anchorsRetained !== true ||
      proof.requiredRolesRetained !== true ||
      proof.directFloorsRetained !== true ||
      proof.exposureRowsRetained !== true ||
      proof.minimumSessionValidityRetained !== true ||
      rows.filter((row) => row && row.shortSetCount > 0).length < 3
    ) {
      return null;
    }
    return {
      week: variant.week,
      phase: variant.phase,
      slotId: variant.slotId.trim(),
      rows: rows as SessionCapacityReductionManifestRow[],
      sessionProtectionProof: {
        anchorsRetained: true as const,
        requiredRolesRetained: true as const,
        directFloorsRetained: true as const,
        exposureRowsRetained: true as const,
        minimumSessionValidityRetained: true as const,
      },
    };
  });
  if (
    variants.length === 0 ||
    variants.some((variant) => variant == null) ||
    new Set(variants.map((variant) => `${variant?.week}:${variant?.slotId}`))
      .size !== variants.length
  ) {
    return undefined;
  }
  return {
    version: 1,
    transformVersion: SESSION_CAPACITY_REDUCTION_TRANSFORM_VERSION,
    seedRevisionNumber: 1,
    executableRowsHash: manifest.executableRowsHash,
    variants: variants as SessionCapacityReductionVariant[],
  };
}
