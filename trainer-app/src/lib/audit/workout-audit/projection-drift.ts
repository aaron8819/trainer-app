import type {
  ProjectedWeekVolumeAuditPayload,
  ProjectionDeliveryDriftPayload,
  WeeklyRetroAuditPayload,
} from "./types";

type ProjectionArtifactCandidate = {
  generatedAt: string;
  identity?: {
    userId?: string;
    ownerEmail?: string;
  };
  projectedWeekVolume: ProjectedWeekVolumeAuditPayload;
  limitations: string[];
};

type DriftClassification =
  ProjectionDeliveryDriftPayload["muscles"][number]["classification"];

const MATERIAL_SET_DELTA = 2.0;
const MATERIAL_PERCENT_DELTA = 0.2;
const LOW_BASELINE_SET_THRESHOLD = 2.0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundRatio(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function emptyPayload(
  status: ProjectionDeliveryDriftPayload["status"],
  limitations: string[]
): ProjectionDeliveryDriftPayload {
  return {
    status,
    baseline: {
      generatedAt: "unknown",
      projectedSessionCount: 0,
    },
    summary: {
      direction: "aligned",
      materialUnderdeliveryCount: 0,
      materialOverdeliveryCount: 0,
      netEffectiveSetDelta: 0,
    },
    muscles: [],
    limitations,
  };
}

function hasValidProjectedWeekVolumePayload(
  value: unknown
): value is ProjectedWeekVolumeAuditPayload {
  if (!isRecord(value)) {
    return false;
  }
  const currentWeek = value.currentWeek;
  return (
    isRecord(currentWeek) &&
    typeof currentWeek.mesocycleId === "string" &&
    Number.isFinite(currentWeek.week) &&
    Array.isArray(value.projectedSessions) &&
    Array.isArray(value.fullWeekByMuscle)
  );
}

function extractProjectionArtifact(
  artifact: unknown
): ProjectionArtifactCandidate | null {
  if (!isRecord(artifact)) {
    return null;
  }

  const limitations: string[] = [];
  if ("mode" in artifact && artifact.mode !== "projected-week-volume") {
    return null;
  }

  const generatedAt =
    typeof artifact.generatedAt === "string" ? artifact.generatedAt : "unknown";
  const payloadCandidate =
    "projectedWeekVolume" in artifact ? artifact.projectedWeekVolume : artifact;

  if (!hasValidProjectedWeekVolumePayload(payloadCandidate)) {
    return null;
  }

  if (!("projectedWeekVolume" in artifact)) {
    limitations.push(
      "Projection baseline was provided as a raw projectedWeekVolume payload; artifact identity was unavailable."
    );
  }

  const identity = isRecord(artifact.identity)
    ? {
        userId: typeof artifact.identity.userId === "string" ? artifact.identity.userId : undefined,
        ownerEmail:
          typeof artifact.identity.ownerEmail === "string"
            ? artifact.identity.ownerEmail
            : undefined,
      }
    : undefined;

  return {
    generatedAt,
    identity,
    projectedWeekVolume: payloadCandidate,
    limitations,
  };
}

function hasValidWeeklyRetroPayload(value: unknown): value is WeeklyRetroAuditPayload {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Number.isFinite(value.week) &&
    typeof value.mesocycleId === "string" &&
    isRecord(value.volumeTargeting) &&
    Array.isArray(value.volumeTargeting.muscles)
  );
}

function classifyMuscleDrift(input: {
  projected: number;
  delta: number;
  percentDelta: number | null;
}): DriftClassification {
  if (input.projected < LOW_BASELINE_SET_THRESHOLD) {
    if (input.delta <= -MATERIAL_SET_DELTA) {
      return "underdelivered";
    }
    if (input.delta >= MATERIAL_SET_DELTA) {
      return "overdelivered";
    }
    return "aligned";
  }

  if (
    Math.abs(input.delta) < MATERIAL_SET_DELTA &&
    input.percentDelta !== null &&
    Math.abs(input.percentDelta) < MATERIAL_PERCENT_DELTA
  ) {
    return "aligned";
  }
  if (
    input.delta <= -MATERIAL_SET_DELTA ||
    (input.percentDelta !== null && input.percentDelta <= -MATERIAL_PERCENT_DELTA)
  ) {
    return "underdelivered";
  }
  if (
    input.delta >= MATERIAL_SET_DELTA ||
    (input.percentDelta !== null && input.percentDelta >= MATERIAL_PERCENT_DELTA)
  ) {
    return "overdelivered";
  }
  return "aligned";
}

function summarizeDirection(input: {
  materialUnderdeliveryCount: number;
  materialOverdeliveryCount: number;
  netEffectiveSetDelta: number;
}): ProjectionDeliveryDriftPayload["summary"]["direction"] {
  if (input.materialUnderdeliveryCount === 0 && input.materialOverdeliveryCount === 0) {
    return "aligned";
  }
  if (input.materialUnderdeliveryCount > 0 && input.materialOverdeliveryCount === 0) {
    return "underdelivery";
  }
  if (input.materialOverdeliveryCount > 0 && input.materialUnderdeliveryCount === 0) {
    return "overdelivery";
  }
  if (
    input.materialUnderdeliveryCount > input.materialOverdeliveryCount &&
    input.netEffectiveSetDelta <= -MATERIAL_SET_DELTA
  ) {
    return "underdelivery";
  }
  if (
    input.materialOverdeliveryCount > input.materialUnderdeliveryCount &&
    input.netEffectiveSetDelta >= MATERIAL_SET_DELTA
  ) {
    return "overdelivery";
  }
  return "mixed";
}

export function buildProjectionDeliveryDrift(input: {
  projectionArtifact?: unknown;
  projectionArtifactReadError?: string;
  weeklyRetro?: WeeklyRetroAuditPayload;
  actualIdentity?: {
    userId?: string;
    ownerEmail?: string;
  };
}): ProjectionDeliveryDriftPayload {
  if (input.projectionArtifactReadError) {
    return emptyPayload("not_available", [
      `Projection artifact could not be read: ${input.projectionArtifactReadError}`,
    ]);
  }

  const projection = extractProjectionArtifact(input.projectionArtifact);
  if (!projection) {
    return emptyPayload("not_available", [
      "Projection artifact was not provided or did not contain a valid projected-week-volume payload.",
    ]);
  }

  if (!hasValidWeeklyRetroPayload(input.weeklyRetro)) {
    return {
      ...emptyPayload("not_available", [
        "Weekly-retro payload was unavailable or invalid.",
      ]),
      baseline: {
        generatedAt: projection.generatedAt,
        projectedSessionCount: projection.projectedWeekVolume.projectedSessions.length,
      },
    };
  }

  const limitations = [...projection.limitations];
  const projectionWeek = projection.projectedWeekVolume.currentWeek;
  const baseline = {
    generatedAt: projection.generatedAt,
    projectedSessionCount: projection.projectedWeekVolume.projectedSessions.length,
  };

  if (projectionWeek.mesocycleId !== input.weeklyRetro.mesocycleId) {
    return {
      ...emptyPayload("not_available", [
        `Projection mesocycleId=${projectionWeek.mesocycleId} does not match weekly-retro mesocycleId=${input.weeklyRetro.mesocycleId}.`,
      ]),
      baseline,
    };
  }

  if (projectionWeek.week !== input.weeklyRetro.week) {
    return {
      ...emptyPayload("not_available", [
        `Projection week=${projectionWeek.week} does not match weekly-retro week=${input.weeklyRetro.week}.`,
      ]),
      baseline,
    };
  }

  const projectedUserId = projection.identity?.userId;
  const projectedOwnerEmail = projection.identity?.ownerEmail;
  if (projectedUserId && input.actualIdentity?.userId && projectedUserId !== input.actualIdentity.userId) {
    return {
      ...emptyPayload("not_available", [
        "Projection artifact userId does not match weekly-retro userId.",
      ]),
      baseline,
    };
  }
  if (
    projectedOwnerEmail &&
    input.actualIdentity?.ownerEmail &&
    projectedOwnerEmail !== input.actualIdentity.ownerEmail
  ) {
    return {
      ...emptyPayload("not_available", [
        "Projection artifact ownerEmail does not match weekly-retro ownerEmail.",
      ]),
      baseline,
    };
  }
  if (!projectedUserId && !projectedOwnerEmail) {
    limitations.push(
      "Projection artifact did not include owner identity; week and mesocycle comparability passed."
    );
  } else if (!input.actualIdentity?.userId && !input.actualIdentity?.ownerEmail) {
    limitations.push(
      "Weekly-retro owner identity was unavailable; week and mesocycle comparability passed."
    );
  }

  const actualRows = new Map(
    input.weeklyRetro.volumeTargeting.muscles.map((row) => [row.muscle, row])
  );
  const projectedRows = new Map(
    projection.projectedWeekVolume.fullWeekByMuscle.map((row) => [row.muscle, row])
  );
  const muscles = Array.from(
    new Set([...projectedRows.keys(), ...actualRows.keys()])
  ).map((muscle) => {
    const projected = roundToTenth(
      projectedRows.get(muscle)?.projectedFullWeekEffectiveSets ?? 0
    );
    const actual = roundToTenth(actualRows.get(muscle)?.actualEffectiveSets ?? 0);
    const delta = roundToTenth(actual - projected);
    const percentDelta = projected > 0 ? roundRatio(delta / projected) : null;

    return {
      muscle,
      projectedEffectiveSets: projected,
      actualEffectiveSets: actual,
      delta,
      percentDelta,
      classification: classifyMuscleDrift({
        projected,
        delta,
        percentDelta,
      }),
      actualTargetStatus: actualRows.get(muscle)?.status ?? "not_reported",
    };
  });

  muscles.sort((left, right) => {
    const leftMaterial = left.classification === "aligned" ? 0 : 1;
    const rightMaterial = right.classification === "aligned" ? 0 : 1;
    if (rightMaterial !== leftMaterial) {
      return rightMaterial - leftMaterial;
    }
    const deltaMagnitude = Math.abs(right.delta) - Math.abs(left.delta);
    if (deltaMagnitude !== 0) {
      return deltaMagnitude;
    }
    return left.muscle.localeCompare(right.muscle);
  });

  const materialUnderdeliveryCount = muscles.filter(
    (row) => row.classification === "underdelivered"
  ).length;
  const materialOverdeliveryCount = muscles.filter(
    (row) => row.classification === "overdelivered"
  ).length;
  const netEffectiveSetDelta = roundToTenth(
    muscles.reduce((sum, row) => sum + row.delta, 0)
  );

  return {
    status: limitations.length > 0 ? "limited" : "comparable",
    baseline,
    summary: {
      direction: summarizeDirection({
        materialUnderdeliveryCount,
        materialOverdeliveryCount,
        netEffectiveSetDelta,
      }),
      materialUnderdeliveryCount,
      materialOverdeliveryCount,
      netEffectiveSetDelta,
    },
    muscles,
    limitations,
  };
}
