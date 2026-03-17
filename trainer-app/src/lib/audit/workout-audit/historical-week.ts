import { prisma } from "@/lib/db/prisma";
import {
  buildSessionAuditMutationSummary,
  resolvePersistedOrReconstructedSessionAuditSnapshot,
} from "@/lib/evidence/session-audit-snapshot";
import {
  deriveWeekCloseDisplayState,
  readWeekCloseDeficitSnapshot,
} from "@/lib/api/mesocycle-week-close";
import { readWeekCloseIdFromSelectionMetadata } from "@/lib/ui/selection-metadata";
import { resolveAuditCanonicalSemantics } from "./canonical-semantics";
import type { HistoricalWeekAuditPayload, HistoricalWeekAuditSession } from "./types";
import {
  AUDIT_RECONSTRUCTION_GUARDRAIL,
  HISTORICAL_WEEK_AUDIT_PAYLOAD_VERSION,
  HISTORICAL_WEEK_MISSING_GENERATED_LAYER_LIMITATION,
} from "./constants";

type RelevantWeekCloseRow = {
  id: string;
  mesocycleId: string;
  targetWeek: number;
  targetPhase: string;
  status: string;
  resolution: string | null;
  deficitSnapshotJson: unknown;
  optionalWorkoutId: string | null;
};

type HistoricalWeekCloseRelation =
  NonNullable<HistoricalWeekAuditSession["weekClose"]>["relation"][number];

function buildWeekCloseLookupKey(mesocycleId: string, week: number): string {
  return `${mesocycleId}:${week}`;
}

function resolveHistoricalWeekClose(input: {
  workout: {
    id: string;
    mesocycleId: string | null;
    mesocycleWeekSnapshot: number | null;
    selectionMetadata: unknown;
  };
  weekCloseById: Map<string, RelevantWeekCloseRow>;
  weekCloseByWorkoutId: Map<string, RelevantWeekCloseRow>;
  weekCloseByMesoWeek: Map<string, RelevantWeekCloseRow>;
}): HistoricalWeekAuditSession["weekClose"] | undefined {
  const linkedWeekCloseId = readWeekCloseIdFromSelectionMetadata(input.workout.selectionMetadata);
  const linkedWeekClose = linkedWeekCloseId
    ? input.weekCloseById.get(linkedWeekCloseId)
    : undefined;
  const optionalWorkoutWeekClose = input.weekCloseByWorkoutId.get(input.workout.id);
  const boundaryWeekClose =
    input.workout.mesocycleId && input.workout.mesocycleWeekSnapshot != null
      ? input.weekCloseByMesoWeek.get(
          buildWeekCloseLookupKey(
            input.workout.mesocycleId,
            input.workout.mesocycleWeekSnapshot
          )
        )
      : undefined;
  const row = linkedWeekClose ?? optionalWorkoutWeekClose ?? boundaryWeekClose;
  if (!row) {
    return undefined;
  }

  const relation: HistoricalWeekCloseRelation[] = [];
  if (boundaryWeekClose?.id === row.id) {
    relation.push("target_week");
  }
  if (linkedWeekClose?.id === row.id) {
    relation.push("linked_selection_metadata");
  }
  if (optionalWorkoutWeekClose?.id === row.id) {
    relation.push("linked_optional_workout");
  }

  const deficitSnapshot = readWeekCloseDeficitSnapshot(row.deficitSnapshotJson);
  const weekCloseState = deriveWeekCloseDisplayState({
    status: row.status as "PENDING_OPTIONAL_GAP_FILL" | "RESOLVED",
    resolution: row.resolution as never,
    deficitSnapshot,
  });

  return {
    relevant: true,
    relation,
    weekCloseId: row.id,
    targetWeek: row.targetWeek,
    targetPhase: row.targetPhase,
    status: row.status,
    resolution: row.resolution,
    workflowState: weekCloseState.workflowState,
    deficitState: weekCloseState.deficitState,
    remainingDeficitSets: weekCloseState.remainingDeficitSets,
    optionalWorkoutId: row.optionalWorkoutId ?? undefined,
    deficitSnapshotSummary: deficitSnapshot
      ? {
          totalDeficitSets: deficitSnapshot.summary.totalDeficitSets,
          qualifyingMuscleCount: deficitSnapshot.summary.qualifyingMuscleCount,
          topTargetMuscles: deficitSnapshot.summary.topTargetMuscles,
        }
      : undefined,
  };
}

export async function buildHistoricalWeekAuditPayload(input: {
  userId: string;
  week: number;
  mesocycleId?: string;
}): Promise<HistoricalWeekAuditPayload> {
  const workouts = await prisma.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleWeekSnapshot: input.week,
      ...(input.mesocycleId ? { mesocycleId: input.mesocycleId } : {}),
    },
    orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      scheduledDate: true,
      status: true,
      revision: true,
      advancesSplit: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
      mesocycleId: true,
      mesocycleWeekSnapshot: true,
      mesoSessionSnapshot: true,
      mesocyclePhaseSnapshot: true,
      exercises: {
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
        select: {
          exerciseId: true,
          orderIndex: true,
          section: true,
          isMainLift: true,
          exercise: {
            select: {
              name: true,
            },
          },
          sets: {
            orderBy: { setIndex: "asc" },
            select: {
              setIndex: true,
              targetReps: true,
              targetRepMin: true,
              targetRepMax: true,
              targetRpe: true,
              targetLoad: true,
              restSeconds: true,
            },
          },
        },
      },
    },
  });

  const mesocycleIds = Array.from(
    new Set(
      workouts
        .map((workout) => workout.mesocycleId)
        .filter((mesocycleId): mesocycleId is string => typeof mesocycleId === "string")
    )
  );
  const workoutIds = workouts.map((workout) => workout.id);
  const weekCloseRows =
    mesocycleIds.length === 0 && workoutIds.length === 0
      ? []
      : await prisma.mesocycleWeekClose.findMany({
          where: {
            OR: [
              ...(mesocycleIds.length > 0
                ? [
                    {
                      mesocycleId: { in: mesocycleIds },
                      targetWeek: input.week,
                    },
                  ]
                : []),
              ...(workoutIds.length > 0
                ? [
                    {
                      optionalWorkoutId: { in: workoutIds },
                    },
                  ]
                : []),
            ],
          },
          select: {
            id: true,
            mesocycleId: true,
            targetWeek: true,
            targetPhase: true,
            status: true,
            resolution: true,
            deficitSnapshotJson: true,
            optionalWorkoutId: true,
          },
        });

  const weekCloseById = new Map(weekCloseRows.map((row) => [row.id, row]));
  const weekCloseByWorkoutId = new Map(
    weekCloseRows.flatMap((row) =>
      row.optionalWorkoutId ? [[row.optionalWorkoutId, row] as const] : []
    )
  );
  const weekCloseByMesoWeek = new Map(
    weekCloseRows.map((row) => [buildWeekCloseLookupKey(row.mesocycleId, row.targetWeek), row])
  );

  const sessions = workouts.map((workout) => {
    const { sessionSnapshot, snapshotSource } =
      resolvePersistedOrReconstructedSessionAuditSnapshot({
        selectionMetadata: workout.selectionMetadata,
        workoutId: workout.id,
        revision: workout.revision,
        status: workout.status,
        advancesSplit: workout.advancesSplit,
        selectionMode: workout.selectionMode,
        sessionIntent: workout.sessionIntent,
        mesocycleId: workout.mesocycleId,
        mesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
        mesoSessionSnapshot: workout.mesoSessionSnapshot,
        mesocyclePhaseSnapshot: workout.mesocyclePhaseSnapshot,
      });
    const semantics = sessionSnapshot.saved?.semantics ?? sessionSnapshot.generated?.semantics;
    const canonicalSemantics = resolveAuditCanonicalSemantics(sessionSnapshot);
    const progressionEvidence = {
      countsTowardProgressionHistory:
        canonicalSemantics?.countsTowardProgressionHistory ?? false,
      countsTowardPerformanceHistory:
        canonicalSemantics?.countsTowardPerformanceHistory ?? false,
      updatesProgressionAnchor: canonicalSemantics?.updatesProgressionAnchor ?? false,
      reasonCodes: semantics?.reasons.map((reason) => reason.code) ?? [],
    };

    return {
      workoutId: workout.id,
      scheduledDate: workout.scheduledDate.toISOString(),
      status: workout.status,
      selectionMode: workout.selectionMode ?? undefined,
      sessionIntent: workout.sessionIntent ?? undefined,
      snapshotSource,
      sessionSnapshot,
      canonicalSemantics: canonicalSemantics ?? {
        sourceLayer: "none",
        phase: workout.mesocyclePhaseSnapshot,
        isDeload: false,
        countsTowardProgressionHistory: false,
        countsTowardPerformanceHistory: false,
        updatesProgressionAnchor: false,
      },
      progressionEvidence,
      weekClose: resolveHistoricalWeekClose({
        workout,
        weekCloseById,
        weekCloseByWorkoutId,
        weekCloseByMesoWeek,
      }),
      reconciliation: buildSessionAuditMutationSummary({
        snapshot: sessionSnapshot,
        savedSelectionMode: workout.selectionMode,
        savedSessionIntent: workout.sessionIntent,
        persistedExercises: workout.exercises,
      }),
    } satisfies HistoricalWeekAuditSession;
  });

  const statusCounts: Record<string, number> = {};
  const intentCounts: Record<string, number> = {};
  let advancingCount = 0;
  let gapFillCount = 0;
  let supplementalCount = 0;
  let deloadCount = 0;
  let progressionEligibleCount = 0;
  let progressionExcludedCount = 0;
  let weekCloseRelevantCount = 0;
  let persistedSnapshotCount = 0;
  let reconstructedSnapshotCount = 0;
  let comparableSessionCount = 0;
  let missingGeneratedSnapshotCount = 0;
  let mutationDriftCount = 0;

  for (const session of sessions) {
    statusCounts[session.status] = (statusCounts[session.status] ?? 0) + 1;
    const generated = session.sessionSnapshot.generated;
    const saved = session.sessionSnapshot.saved;
    const semantics = saved?.semantics ?? generated?.semantics;
    const intent = session.sessionIntent ?? generated?.sessionIntent;
    if (intent) {
      intentCounts[intent] = (intentCounts[intent] ?? 0) + 1;
    }
    if (session.snapshotSource === "persisted") {
      persistedSnapshotCount += 1;
    } else {
      reconstructedSnapshotCount += 1;
    }
    if (session.reconciliation.comparisonState === "comparable") {
      comparableSessionCount += 1;
    } else {
      missingGeneratedSnapshotCount += 1;
    }
    if (session.weekClose?.relevant) {
      weekCloseRelevantCount += 1;
    }
    if (session.reconciliation.hasDrift) {
      mutationDriftCount += 1;
    }
    if (!semantics) {
      continue;
    }
    if (semantics.kind === "advancing") {
      advancingCount += 1;
    }
    if (semantics.kind === "gap_fill") {
      gapFillCount += 1;
    }
    if (semantics.kind === "supplemental") {
      supplementalCount += 1;
    }
    if (semantics.isDeload) {
      deloadCount += 1;
    }
    if (semantics.countsTowardProgressionHistory) {
      progressionEligibleCount += 1;
    } else {
      progressionExcludedCount += 1;
    }
  }

  const limitations: string[] = [];
  if (missingGeneratedSnapshotCount > 0) {
    limitations.push(
      `${missingGeneratedSnapshotCount} session(s) are affected. ${HISTORICAL_WEEK_MISSING_GENERATED_LAYER_LIMITATION}`
    );
  }
  if (reconstructedSnapshotCount > 0) {
    limitations.push(
      `${reconstructedSnapshotCount} session(s) were reconstructed from saved workout state only. ${AUDIT_RECONSTRUCTION_GUARDRAIL}`
    );
  }

  return {
    version: HISTORICAL_WEEK_AUDIT_PAYLOAD_VERSION,
    week: input.week,
    mesocycleId: input.mesocycleId,
    sessions,
    summary: {
      sessionCount: sessions.length,
      advancingCount,
      gapFillCount,
      supplementalCount,
      deloadCount,
      progressionEligibleCount,
      progressionExcludedCount,
      weekCloseRelevantCount,
      persistedSnapshotCount,
      reconstructedSnapshotCount,
      mutationDriftCount,
      statusCounts,
      intentCounts,
    },
    comparabilityCoverage: {
      comparableSessionCount,
      missingGeneratedSnapshotCount,
      persistedSnapshotCount,
      reconstructedSnapshotCount,
      generatedLayerCoverage:
        missingGeneratedSnapshotCount === 0
          ? "full"
          : comparableSessionCount === 0
            ? "none"
            : "partial",
      limitations,
    },
  };
}
