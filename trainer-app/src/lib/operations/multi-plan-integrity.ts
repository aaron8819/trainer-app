import { Prisma, type PrismaClient } from "@prisma/client";

export type MultiPlanIntegritySeverity = "blocking" | "legacy_valid_absence";

export type MultiPlanIntegrityFinding = {
  code:
    | "LEGACY_NO_SELECTED_PLAN_CANDIDATE"
    | "LEGACY_MULTIPLE_SELECTED_PLAN_CANDIDATES"
    | "USER_MULTIPLE_ACTIVE_MESOCYCLES"
    | "MACROCYCLE_MULTIPLE_ACTIVE_MESOCYCLES"
    | "ACTIVE_MESOCYCLE_CONTRADICTORY_STATE"
    | "WORKOUT_OWNER_MISMATCH"
    | "WORKOUT_SEED_MESOCYCLE_MISMATCH"
    | "CURRENT_SEED_MESOCYCLE_MISMATCH"
    | "READINESS_REFERENCE_MISMATCH"
    | "CHECKIN_OWNER_MISMATCH"
    | "WEEK_CLOSE_REFERENCE_MISMATCH"
    | "HISTORICAL_ARTIFACT_MISSING_MESOCYCLE"
    | "HISTORICAL_ARTIFACT_MULTIPLE_MESOCYCLES";
  severity: MultiPlanIntegritySeverity;
  affectedIds: string[];
  detail: string;
};

export type MultiPlanIntegrityRows = {
  legacyCandidates: Array<{
    userId: string;
    activeMesocycleCount: number;
    candidatePlanCount: number;
    activeMesocycleIds: string[];
    candidateMacroCycleIds: string[];
  }>;
  macrocycleActiveCounts: Array<{
    macroCycleId: string;
    activeMesocycleCount: number;
    activeMesocycleIds: string[];
  }>;
  contradictoryActiveMesocycleIds: string[];
  workoutOwnerMismatchIds: string[];
  workoutSeedMismatchIds: string[];
  currentSeedMismatchIds: string[];
  readinessMismatchIds: string[];
  checkInMismatchIds: string[];
  weekCloseMismatchIds: string[];
  historicalArtifacts: Array<{
    artifactId: string;
    targetMesocycleId: string | null;
    sessionMesocycleIds: string[];
  }>;
};

export type MultiPlanIntegrityReport = {
  safeToMigrate: boolean;
  counts: {
    blocking: number;
    legacyValidAbsence: number;
    total: number;
  };
  findings: MultiPlanIntegrityFinding[];
};

function finding(
  code: MultiPlanIntegrityFinding["code"],
  severity: MultiPlanIntegritySeverity,
  affectedIds: string[],
  detail: string
): MultiPlanIntegrityFinding {
  return {
    code,
    severity,
    affectedIds: [...affectedIds].sort(),
    detail,
  };
}

export function buildMultiPlanIntegrityReport(
  rows: MultiPlanIntegrityRows
): MultiPlanIntegrityReport {
  const findings: MultiPlanIntegrityFinding[] = [];

  for (const candidate of rows.legacyCandidates) {
    if (candidate.activeMesocycleCount === 0) {
      findings.push(
        finding(
          "LEGACY_NO_SELECTED_PLAN_CANDIDATE",
          "legacy_valid_absence",
          [candidate.userId],
          "Owner has no legacy active mesocycle; migration must leave the selected-plan pointer null."
        )
      );
    } else if (
      candidate.activeMesocycleCount > 1 ||
      candidate.candidatePlanCount > 1
    ) {
      findings.push(
        finding(
          "LEGACY_MULTIPLE_SELECTED_PLAN_CANDIDATES",
          "blocking",
          [
            candidate.userId,
            ...candidate.activeMesocycleIds,
            ...candidate.candidateMacroCycleIds,
          ],
          "Owner has ambiguous legacy active state; explicit remediation is required."
        )
      );
      findings.push(
        finding(
          "USER_MULTIPLE_ACTIVE_MESOCYCLES",
          "blocking",
          [candidate.userId, ...candidate.activeMesocycleIds],
          "Owner has more than one active mesocycle."
        )
      );
    }
  }

  for (const macrocycle of rows.macrocycleActiveCounts) {
    if (macrocycle.activeMesocycleCount > 1) {
      findings.push(
        finding(
          "MACROCYCLE_MULTIPLE_ACTIVE_MESOCYCLES",
          "blocking",
          [macrocycle.macroCycleId, ...macrocycle.activeMesocycleIds],
          "Macrocycle has more than one active mesocycle."
        )
      );
    }
  }

  const blockingGroups: Array<{
    code: MultiPlanIntegrityFinding["code"];
    ids: string[];
    detail: string;
  }> = [
    {
      code: "ACTIVE_MESOCYCLE_CONTRADICTORY_STATE",
      ids: rows.contradictoryActiveMesocycleIds,
      detail: "Active mesocycle is COMPLETED or AWAITING_HANDOFF.",
    },
    {
      code: "WORKOUT_OWNER_MISMATCH",
      ids: rows.workoutOwnerMismatchIds,
      detail: "Workout owner differs from its mesocycle macrocycle owner.",
    },
    {
      code: "WORKOUT_SEED_MESOCYCLE_MISMATCH",
      ids: rows.workoutSeedMismatchIds,
      detail: "Workout seed revision belongs to another mesocycle.",
    },
    {
      code: "CURRENT_SEED_MESOCYCLE_MISMATCH",
      ids: rows.currentSeedMismatchIds,
      detail: "Mesocycle current seed pointer targets another mesocycle.",
    },
    {
      code: "READINESS_REFERENCE_MISMATCH",
      ids: rows.readinessMismatchIds,
      detail: "Readiness snapshot owner, mesocycle, or planned workout reference disagrees.",
    },
    {
      code: "CHECKIN_OWNER_MISMATCH",
      ids: rows.checkInMismatchIds,
      detail: "Session check-in owner differs from its workout owner.",
    },
    {
      code: "WEEK_CLOSE_REFERENCE_MISMATCH",
      ids: rows.weekCloseMismatchIds,
      detail: "Week-close optional workout crosses owner or mesocycle boundaries.",
    },
  ];
  for (const group of blockingGroups) {
    if (group.ids.length > 0) {
      findings.push(finding(group.code, "blocking", group.ids, group.detail));
    }
  }

  for (const artifact of rows.historicalArtifacts) {
    if (!artifact.targetMesocycleId) {
      findings.push(
        finding(
          "HISTORICAL_ARTIFACT_MISSING_MESOCYCLE",
          "legacy_valid_absence",
          [artifact.artifactId],
          "Legacy historical-week artifact has no explicit mesocycle target; it remains readable but is not canonical multi-plan evidence."
        )
      );
    }
    const uniqueMesocycleIds = Array.from(
      new Set(artifact.sessionMesocycleIds.filter(Boolean))
    );
    if (
      uniqueMesocycleIds.length > 1 ||
      (artifact.targetMesocycleId &&
        uniqueMesocycleIds.some(
          (mesocycleId) => mesocycleId !== artifact.targetMesocycleId
        ))
    ) {
      findings.push(
        finding(
          "HISTORICAL_ARTIFACT_MULTIPLE_MESOCYCLES",
          "blocking",
          [artifact.artifactId, ...uniqueMesocycleIds],
          "Historical-week artifact contains sessions from incompatible mesocycles."
        )
      );
    }
  }

  findings.sort((left, right) =>
    `${left.severity}:${left.code}:${left.affectedIds.join(",")}`.localeCompare(
      `${right.severity}:${right.code}:${right.affectedIds.join(",")}`
    )
  );
  const blocking = findings.filter(
    (entry) => entry.severity === "blocking"
  ).length;
  const legacyValidAbsence = findings.filter(
    (entry) => entry.severity === "legacy_valid_absence"
  ).length;
  return {
    safeToMigrate: blocking === 0,
    counts: {
      blocking,
      legacyValidAbsence,
      total: findings.length,
    },
    findings,
  };
}

type IntegrityReader = Pick<PrismaClient, "$queryRaw">;

export async function loadMultiPlanIntegrityRows(
  reader: IntegrityReader,
  historicalArtifacts: MultiPlanIntegrityRows["historicalArtifacts"] = []
): Promise<MultiPlanIntegrityRows> {
  const [
    legacyCandidates,
    macrocycleActiveCounts,
    contradictoryActiveMesocycles,
    workoutOwnerMismatches,
    workoutSeedMismatches,
    currentSeedMismatches,
    readinessMismatches,
    checkInMismatches,
    weekCloseMismatches,
  ] = await Promise.all([
    reader.$queryRaw<MultiPlanIntegrityRows["legacyCandidates"]>(Prisma.sql`
      SELECT
        owner."id" AS "userId",
        COUNT(mesocycle."id")::int AS "activeMesocycleCount",
        COUNT(DISTINCT mesocycle."macroCycleId")::int AS "candidatePlanCount",
        COALESCE(ARRAY_AGG(mesocycle."id") FILTER (WHERE mesocycle."id" IS NOT NULL), ARRAY[]::text[]) AS "activeMesocycleIds",
        COALESCE(ARRAY_AGG(DISTINCT mesocycle."macroCycleId") FILTER (WHERE mesocycle."id" IS NOT NULL), ARRAY[]::text[]) AS "candidateMacroCycleIds"
      FROM "User" AS owner
      LEFT JOIN "MacroCycle" AS macrocycle ON macrocycle."userId" = owner."id"
      LEFT JOIN "Mesocycle" AS mesocycle
        ON mesocycle."macroCycleId" = macrocycle."id"
       AND mesocycle."isActive" = TRUE
      GROUP BY owner."id"
      ORDER BY owner."id"
    `),
    reader.$queryRaw<MultiPlanIntegrityRows["macrocycleActiveCounts"]>(Prisma.sql`
      SELECT
        macrocycle."id" AS "macroCycleId",
        COUNT(mesocycle."id")::int AS "activeMesocycleCount",
        ARRAY_AGG(mesocycle."id" ORDER BY mesocycle."id") AS "activeMesocycleIds"
      FROM "MacroCycle" AS macrocycle
      JOIN "Mesocycle" AS mesocycle
        ON mesocycle."macroCycleId" = macrocycle."id"
       AND mesocycle."isActive" = TRUE
      GROUP BY macrocycle."id"
      HAVING COUNT(mesocycle."id") > 1
      ORDER BY macrocycle."id"
    `),
    reader.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "Mesocycle"
      WHERE "isActive" = TRUE
        AND "state" IN ('COMPLETED', 'AWAITING_HANDOFF')
      ORDER BY "id"
    `),
    reader.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT workout."id"
      FROM "Workout" AS workout
      JOIN "Mesocycle" AS mesocycle ON mesocycle."id" = workout."mesocycleId"
      JOIN "MacroCycle" AS macrocycle ON macrocycle."id" = mesocycle."macroCycleId"
      WHERE workout."userId" <> macrocycle."userId"
      ORDER BY workout."id"
    `),
    reader.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT workout."id"
      FROM "Workout" AS workout
      JOIN "MesocycleSeedRevision" AS revision ON revision."id" = workout."seedRevisionId"
      WHERE workout."mesocycleId" IS DISTINCT FROM revision."mesocycleId"
      ORDER BY workout."id"
    `),
    reader.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT mesocycle."id"
      FROM "Mesocycle" AS mesocycle
      JOIN "MesocycleSeedRevision" AS revision ON revision."id" = mesocycle."currentSeedRevisionId"
      WHERE mesocycle."id" <> revision."mesocycleId"
      ORDER BY mesocycle."id"
    `),
    reader.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT snapshot."id"
      FROM "PreSessionReadinessSnapshot" AS snapshot
      JOIN "Mesocycle" AS mesocycle ON mesocycle."id" = snapshot."activeMesocycleId"
      JOIN "MacroCycle" AS macrocycle ON macrocycle."id" = mesocycle."macroCycleId"
      LEFT JOIN "Workout" AS workout ON workout."id" = snapshot."plannedWorkoutId"
      WHERE snapshot."userId" <> macrocycle."userId"
         OR (workout."id" IS NOT NULL AND workout."userId" <> snapshot."userId")
         OR (workout."id" IS NOT NULL AND workout."mesocycleId" IS DISTINCT FROM snapshot."activeMesocycleId")
      ORDER BY snapshot."id"
    `),
    reader.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT checkin."id"
      FROM "SessionCheckIn" AS checkin
      JOIN "Workout" AS workout ON workout."id" = checkin."workoutId"
      WHERE checkin."userId" <> workout."userId"
      ORDER BY checkin."id"
    `),
    reader.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT weekclose."id"
      FROM "MesocycleWeekClose" AS weekclose
      JOIN "Mesocycle" AS mesocycle ON mesocycle."id" = weekclose."mesocycleId"
      JOIN "MacroCycle" AS macrocycle ON macrocycle."id" = mesocycle."macroCycleId"
      JOIN "Workout" AS workout ON workout."id" = weekclose."optionalWorkoutId"
      WHERE workout."userId" <> macrocycle."userId"
         OR workout."mesocycleId" IS DISTINCT FROM weekclose."mesocycleId"
      ORDER BY weekclose."id"
    `),
  ]);

  return {
    legacyCandidates,
    macrocycleActiveCounts,
    contradictoryActiveMesocycleIds: contradictoryActiveMesocycles.map(
      (row) => row.id
    ),
    workoutOwnerMismatchIds: workoutOwnerMismatches.map((row) => row.id),
    workoutSeedMismatchIds: workoutSeedMismatches.map((row) => row.id),
    currentSeedMismatchIds: currentSeedMismatches.map((row) => row.id),
    readinessMismatchIds: readinessMismatches.map((row) => row.id),
    checkInMismatchIds: checkInMismatches.map((row) => row.id),
    weekCloseMismatchIds: weekCloseMismatches.map((row) => row.id),
    historicalArtifacts,
  };
}
