import { prisma } from "@/lib/db/prisma";
import { getExposedVolumeLandmarkEntries } from "@/lib/engine/volume-landmarks";
import { readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import { getWeeklyVolumeTarget } from "@/lib/api/mesocycle-lifecycle-math";
import { loadMesocycleWeekMuscleVolume } from "@/lib/api/weekly-volume";
import { WEEKLY_RETRO_AUDIT_PAYLOAD_VERSION } from "./constants";
import { buildHistoricalWeekAuditPayload } from "./historical-week";
import type {
  HistoricalWeekAuditSession,
  WeeklyRetroAuditPayload,
  WeeklyRetroAuditSessionExecutionRow,
  WeeklyRetroAuditVolumeRow,
} from "./types";

const DEFAULT_FALLBACK_LANDMARK = {
  mev: 0,
  mav: 10,
};

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function computeMesoWeekStartDate(
  macroStartDate: Date,
  mesocycleStartWeek: number,
  week: number
): Date {
  const date = new Date(macroStartDate);
  date.setDate(date.getDate() + (mesocycleStartWeek + week - 1) * 7);
  return date;
}

function resolveSessionSemantics(session: HistoricalWeekAuditSession) {
  return session.sessionSnapshot.saved?.semantics ?? session.sessionSnapshot.generated?.semantics;
}

function normalizeIntent(intent: string | undefined): string | undefined {
  return typeof intent === "string" ? intent.trim().toLowerCase() : undefined;
}

function buildSessionExecutionRows(input: {
  sessions: HistoricalWeekAuditSession[];
  slotIdentityByWorkoutId: Map<string, ReturnType<typeof readSessionSlotSnapshot>>;
}): WeeklyRetroAuditSessionExecutionRow[] {
  return input.sessions.map((session) => {
    const semantics = resolveSessionSemantics(session);
    return {
      workoutId: session.workoutId,
      scheduledDate: session.scheduledDate,
      status: session.status,
      selectionMode: session.selectionMode,
      sessionIntent: session.sessionIntent,
      snapshotSource: session.snapshotSource,
      semanticKind: semantics?.kind,
      consumesWeeklyScheduleIntent: semantics?.consumesWeeklyScheduleIntent ?? false,
      isCloseout: semantics?.isCloseout ?? false,
      isDeload: semantics?.isDeload ?? false,
      slot: input.slotIdentityByWorkoutId.get(session.workoutId),
      mesocycleSnapshot: session.sessionSnapshot.saved?.mesocycleSnapshot,
      cycleContext: session.sessionSnapshot.generated?.cycleContext,
      canonicalSemantics: session.canonicalSemantics,
      progressionEvidence: session.progressionEvidence,
      weekClose: session.weekClose,
      reconciliation: session.reconciliation,
    };
  });
}

function sortVolumeRows(
  left: WeeklyRetroAuditVolumeRow,
  right: WeeklyRetroAuditVolumeRow
): number {
  const leftMagnitude = Math.max(Math.abs(left.deltaToTarget), Math.abs(left.deltaToMev), Math.abs(left.deltaToMav));
  const rightMagnitude = Math.max(
    Math.abs(right.deltaToTarget),
    Math.abs(right.deltaToMev),
    Math.abs(right.deltaToMav)
  );
  if (rightMagnitude !== leftMagnitude) {
    return rightMagnitude - leftMagnitude;
  }
  return left.muscle.localeCompare(right.muscle);
}

export async function buildWeeklyRetroAuditPayload(input: {
  userId: string;
  week: number;
  mesocycleId: string;
}): Promise<WeeklyRetroAuditPayload> {
  const [historicalWeek, mesocycle] = await Promise.all([
    buildHistoricalWeekAuditPayload({
      userId: input.userId,
      week: input.week,
      mesocycleId: input.mesocycleId,
    }),
    prisma.mesocycle.findFirst({
      where: {
        id: input.mesocycleId,
        macroCycle: { userId: input.userId },
      },
      select: {
        id: true,
        durationWeeks: true,
        startWeek: true,
        blocks: {
          orderBy: { startWeek: "asc" },
          select: {
            blockType: true,
            startWeek: true,
            durationWeeks: true,
            volumeTarget: true,
            intensityBias: true,
          },
        },
        macroCycle: {
          select: {
            startDate: true,
          },
        },
      },
    }),
  ]);

  if (!mesocycle) {
    throw new Error(`No mesocycle found for weekly-retro mesocycleId=${input.mesocycleId}.`);
  }

  const weekStart = computeMesoWeekStartDate(
    new Date(mesocycle.macroCycle.startDate),
    mesocycle.startWeek,
    input.week
  );

  const [weeklyVolume, slotIdentityRows] = await Promise.all([
    loadMesocycleWeekMuscleVolume(prisma, {
      userId: input.userId,
      mesocycleId: input.mesocycleId,
      targetWeek: input.week,
      weekStart,
      includeBreakdowns: true,
    }),
    prisma.workout.findMany({
      where: {
        userId: input.userId,
        mesocycleId: input.mesocycleId,
        mesocycleWeekSnapshot: input.week,
      },
      select: {
        id: true,
        selectionMetadata: true,
      },
    }),
  ]);

  const slotIdentityByWorkoutId = new Map(
    slotIdentityRows.map((row) => [row.id, readSessionSlotSnapshot(row.selectionMetadata)])
  );
  const sessionExecutionRows = buildSessionExecutionRows({
    sessions: historicalWeek.sessions,
    slotIdentityByWorkoutId,
  });
  const advancingSessions = historicalWeek.sessions.filter(
    (session) => resolveSessionSemantics(session)?.consumesWeeklyScheduleIntent === true
  );

  const missingSlotIdentityWorkoutIds: string[] = [];
  const duplicateSlotWorkouts = new Map<string, string[]>();
  const intentMismatches: WeeklyRetroAuditPayload["slotBalance"]["intentMismatches"] = [];

  for (const session of advancingSessions) {
    const slot = slotIdentityByWorkoutId.get(session.workoutId);
    if (!slot?.slotId) {
      missingSlotIdentityWorkoutIds.push(session.workoutId);
      continue;
    }

    const existing = duplicateSlotWorkouts.get(slot.slotId) ?? [];
    existing.push(session.workoutId);
    duplicateSlotWorkouts.set(slot.slotId, existing);

    const normalizedSessionIntent = normalizeIntent(session.sessionIntent);
    const normalizedSlotIntent = normalizeIntent(slot.intent);
    if (
      normalizedSessionIntent &&
      normalizedSlotIntent &&
      normalizedSessionIntent !== normalizedSlotIntent
    ) {
      intentMismatches.push({
        workoutId: session.workoutId,
        sessionIntent: session.sessionIntent,
        slotIntent: slot.intent,
        slotId: slot.slotId,
      });
    }
  }

  const duplicateSlots = Array.from(duplicateSlotWorkouts.entries())
    .filter(([, workoutIds]) => workoutIds.length > 1)
    .map(([slotId, workoutIds]) => ({ slotId, workoutIds }))
    .sort((left, right) => left.slotId.localeCompare(right.slotId));

  const volumeRows: WeeklyRetroAuditVolumeRow[] = getExposedVolumeLandmarkEntries()
    .map(([muscle, landmark]) => {
      const actualRow = weeklyVolume[muscle];
      const actualEffectiveSets = actualRow?.effectiveSets ?? 0;
      const weeklyTarget = getWeeklyVolumeTarget(mesocycle, muscle, input.week);
      const deltaToTarget = roundToTenth(actualEffectiveSets - weeklyTarget);
      const deltaToMev = roundToTenth(actualEffectiveSets - landmark.mev);
      const deltaToMav = roundToTenth(actualEffectiveSets - landmark.mav);
      const status =
        deltaToMev < 0
          ? "below_mev"
          : deltaToTarget < 0
            ? "under_target_only"
            : deltaToMav > 0
              ? "over_mav"
              : deltaToTarget > 0
                ? "over_target_only"
                : "within_target_band";

      return {
        muscle,
        actualEffectiveSets,
        weeklyTarget,
        mev: landmark.mev ?? DEFAULT_FALLBACK_LANDMARK.mev,
        mav: landmark.mav ?? DEFAULT_FALLBACK_LANDMARK.mav,
        deltaToTarget,
        deltaToMev,
        deltaToMav,
        status,
        topContributors: (actualRow?.contributions ?? [])
          .slice(0, 3)
          .map((contribution) => ({
            exerciseId: contribution.exerciseId,
            exerciseName: contribution.exerciseName,
            effectiveSets: contribution.effectiveSets,
            performedSets: contribution.performedSets,
          })),
      } satisfies WeeklyRetroAuditVolumeRow;
    })
    .filter((row) => row.weeklyTarget > 0 || row.actualEffectiveSets > 0)
    .sort(sortVolumeRows);

  const belowMev = volumeRows
    .filter((row) => row.status === "below_mev")
    .map((row) => row.muscle);
  const underTargetOnly = volumeRows
    .filter((row) => row.status === "under_target_only")
    .map((row) => row.muscle);
  const overMav = volumeRows
    .filter((row) => row.status === "over_mav")
    .map((row) => row.muscle);
  const overTargetOnly = volumeRows
    .filter((row) => row.status === "over_target_only")
    .map((row) => row.muscle);

  const driftSessions = historicalWeek.sessions.filter((session) => session.reconciliation.hasDrift);
  const prescriptionChangeCount = historicalWeek.sessions.filter((session) =>
    session.reconciliation.changedFields.includes("exercise_prescription_changed")
  ).length;
  const selectionDriftCount = historicalWeek.sessions.filter((session) =>
    session.reconciliation.changedFields.some((field) =>
      [
        "selection_mode",
        "session_intent",
        "semantics_kind",
        "progression_history_eligibility",
      ].includes(field)
    )
  ).length;
  const legacyLimitedSessionCount = historicalWeek.comparabilityCoverage.reconstructedSnapshotCount;
  const slotIdentityIssueCount =
    missingSlotIdentityWorkoutIds.length + duplicateSlots.length + intentMismatches.length;

  const executiveHighlights: string[] = [];
  if (legacyLimitedSessionCount > 0) {
    executiveHighlights.push(
      `Legacy saved-only coverage limits ${legacyLimitedSessionCount} session(s).`
    );
  }
  if (driftSessions.length > 0) {
    executiveHighlights.push(
      `${driftSessions.length} comparable session(s) drifted from generated prescription.`
    );
  }
  if (belowMev.length > 0) {
    executiveHighlights.push(`${belowMev.length} muscle(s) finished below MEV.`);
  }
  if (underTargetOnly.length > 0) {
    executiveHighlights.push(
      `${underTargetOnly.length} muscle(s) finished under target but above MEV.`
    );
  }
  if (overMav.length > 0) {
    executiveHighlights.push(`${overMav.length} muscle(s) exceeded MAV.`);
  }
  if (slotIdentityIssueCount > 0) {
    executiveHighlights.push(
      `${slotIdentityIssueCount} slot-identity issue(s) surfaced across advancing sessions.`
    );
  }
  if (executiveHighlights.length === 0) {
    executiveHighlights.push("No high-risk weekly-retro signals detected.");
  }

  const rootCauses: WeeklyRetroAuditPayload["rootCauses"] = [];
  const interventions: WeeklyRetroAuditPayload["interventions"] = [];

  if (missingSlotIdentityWorkoutIds.length > 0) {
    rootCauses.push({
      code: "slot_identity_gap",
      summary: "Some advancing sessions are missing canonical slot identity receipts.",
      evidence: [
        `Missing sessionSlot receipts on workouts: ${missingSlotIdentityWorkoutIds.join(", ")}`,
      ],
    });
    interventions.push({
      priority: "high",
      kind: "slot_identity",
      summary: "Repair missing session-slot receipts before trusting slot-balance conclusions.",
      evidence: [
        `${missingSlotIdentityWorkoutIds.length} advancing session(s) lack slot identity.`,
      ],
    });
  }

  if (duplicateSlots.length > 0) {
    rootCauses.push({
      code: "slot_identity_duplicate",
      summary: "The same canonical slot id was consumed more than once in the audited week.",
      evidence: duplicateSlots.map(
        (entry) => `${entry.slotId}: ${entry.workoutIds.join(", ")}`
      ),
    });
    interventions.push({
      priority: "high",
      kind: "slot_identity",
      summary: "Review duplicate slot consumption and reconcile the affected workout receipts.",
      evidence: duplicateSlots.map(
        (entry) => `${entry.slotId} repeated across ${entry.workoutIds.length} workouts`
      ),
    });
  }

  if (intentMismatches.length > 0) {
    rootCauses.push({
      code: "slot_identity_intent_mismatch",
      summary: "Saved workout intent and canonical slot intent disagree for at least one advancing session.",
      evidence: intentMismatches.map(
        (entry) =>
          `${entry.workoutId}: session=${entry.sessionIntent ?? "unknown"} slot=${entry.slotIntent}`
      ),
    });
  }

  if (driftSessions.length > 0) {
    rootCauses.push({
      code: "mutation_drift",
      summary: "Generated-vs-saved reconciliation shows meaningful prescription drift.",
      evidence: driftSessions.map(
        (session) =>
          `${session.workoutId}: ${session.reconciliation.changedFields.join(", ")}`
      ),
    });
    interventions.push({
      priority: "high",
      kind: "mutation_drift",
      summary: "Inspect saved-vs-generated drift before drawing load-calibration conclusions.",
      evidence: [
        `${driftSessions.length} comparable session(s) carry reconciliation drift.`,
      ],
    });
  }

  if (legacyLimitedSessionCount > 0) {
    rootCauses.push({
      code: "legacy_coverage_gap",
      summary: "Some sessions only have saved-state reconstruction, not persisted generated-layer truth.",
      evidence: historicalWeek.comparabilityCoverage.limitations,
    });
    interventions.push({
      priority: "medium",
      kind: "legacy_coverage",
      summary: "Treat legacy saved-only sessions as audit limitations, not generation defects.",
      evidence: [
        `${legacyLimitedSessionCount} session(s) lack generated-layer coverage.`,
      ],
    });
  }

  if (belowMev.length > 0) {
    rootCauses.push({
      code: "below_mev",
      summary: "Actual weekly effective volume finished below MEV for at least one muscle.",
      evidence: volumeRows
        .filter((row) => row.status === "below_mev")
        .map(
          (row) =>
            `${row.muscle}: actual=${row.actualEffectiveSets.toFixed(1)} mev=${row.mev.toFixed(1)} delta=${row.deltaToMev.toFixed(1)}`
        ),
    });
  }

  if (belowMev.length > 0 || underTargetOnly.length > 0) {
    interventions.push({
      priority: "medium",
      kind: "volume_deficit",
      summary: "Review under-target muscles against actual top contributors and session mix.",
      evidence: [
        `Below MEV: ${belowMev.join(", ") || "none"}`,
        `Under target only: ${underTargetOnly.join(", ") || "none"}`,
      ],
    });
  }

  if (overMav.length > 0) {
    rootCauses.push({
      code: "over_mav",
      summary: "Actual weekly effective volume exceeded MAV for at least one muscle.",
      evidence: volumeRows
        .filter((row) => row.status === "over_mav")
        .map(
          (row) =>
            `${row.muscle}: actual=${row.actualEffectiveSets.toFixed(1)} mav=${row.mav.toFixed(1)} delta=${row.deltaToMav.toFixed(1)}`
        ),
    });
    interventions.push({
      priority: "medium",
      kind: "volume_overshoot",
      summary: "Inspect overshooting muscles for stacked contributors or unexpected non-deload load retention.",
      evidence: [`Over MAV: ${overMav.join(", ")}`],
    });
  }

  const recommendedPriorities = interventions
    .slice()
    .sort((left, right) => {
      const priorityRank = { high: 0, medium: 1, low: 2 };
      return priorityRank[left.priority] - priorityRank[right.priority];
    })
    .map((entry) => entry.summary);

  return {
    version: WEEKLY_RETRO_AUDIT_PAYLOAD_VERSION,
    week: input.week,
    mesocycleId: input.mesocycleId,
    executiveSummary: {
      status:
        driftSessions.length > 0 ||
        legacyLimitedSessionCount > 0 ||
        belowMev.length > 0 ||
        underTargetOnly.length > 0 ||
        overMav.length > 0 ||
        slotIdentityIssueCount > 0
          ? "attention_required"
          : "stable",
      generatedLayerCoverage: historicalWeek.comparabilityCoverage.generatedLayerCoverage,
      sessionCount: historicalWeek.summary.sessionCount,
      advancingSessionCount: advancingSessions.length,
      progressionEligibleCount: historicalWeek.summary.progressionEligibleCount,
      progressionExcludedCount: historicalWeek.summary.progressionExcludedCount,
      driftSessionCount: driftSessions.length,
      belowMevCount: belowMev.length,
      underTargetCount: belowMev.length + underTargetOnly.length,
      overMavCount: overMav.length,
      slotIdentityIssueCount,
      highlights: executiveHighlights,
    },
    loadCalibration: {
      status:
        driftSessions.length > 0
          ? "attention_required"
          : legacyLimitedSessionCount > 0
            ? "limited_by_legacy_coverage"
            : "aligned",
      comparableSessionCount: historicalWeek.comparabilityCoverage.comparableSessionCount,
      driftSessionCount: driftSessions.length,
      prescriptionChangeCount,
      selectionDriftCount,
      legacyLimitedSessionCount,
      highlightedSessions: driftSessions.map((session) => ({
        workoutId: session.workoutId,
        changedFields: [...session.reconciliation.changedFields],
      })),
    },
    sessionExecution: {
      summary: historicalWeek.summary,
      sessions: sessionExecutionRows,
    },
    slotBalance: {
      status: slotIdentityIssueCount > 0 ? "attention_required" : "balanced",
      advancingSessionCount: advancingSessions.length,
      identifiedSlotCount: advancingSessions.length - missingSlotIdentityWorkoutIds.length,
      missingSlotIdentityCount: missingSlotIdentityWorkoutIds.length,
      duplicateSlotCount: duplicateSlots.length,
      intentMismatchCount: intentMismatches.length,
      missingSlotIdentityWorkoutIds,
      duplicateSlots,
      intentMismatches,
    },
    volumeTargeting: {
      status:
        belowMev.length > 0 ||
        underTargetOnly.length > 0 ||
        overMav.length > 0 ||
        overTargetOnly.length > 0
          ? "attention_required"
          : "within_expected_band",
      belowMev,
      underTargetOnly,
      overMav,
      overTargetOnly,
      muscles: volumeRows,
    },
    interventions,
    rootCauses,
    recommendedPriorities,
  };
}
