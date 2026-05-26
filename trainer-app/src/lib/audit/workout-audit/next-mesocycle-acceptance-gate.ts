import { prisma } from "@/lib/db/prisma";
import { readNextCycleSeedDraft } from "@/lib/api/mesocycle-handoff";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { NEXT_MESOCYCLE_ACCEPTANCE_GATE_AUDIT_PAYLOAD_VERSION } from "./constants";
import { buildMesocycleExplainAuditPayload } from "./mesocycle-explain";
import { buildV2AcceptedSeedPrepareCompareAuditPayload } from "./v2-accepted-seed-prepare-compare";
import type {
  MesocycleExplainAuditPayload,
  NextMesocycleAcceptanceGatePayload,
  NextMesocycleAcceptanceGateStatus,
  V2AcceptedSeedPrepareCompareAuditPayload,
} from "./types";

type SourceMesocycleState = {
  id: string;
  state: string;
  macroCycleId: string;
  mesoNumber: number;
  sessionsPerWeek: number;
  deloadSessionsCompleted: number;
  nextSeedDraftJson: unknown;
};

type SuccessorMesocycleState = {
  id: string;
  state: string;
} | null;

type IncompleteWorkoutState = {
  id: string;
  status: string;
  sessionIntent: string | null;
}[];

type AcceptanceGateReader = {
  mesocycle: {
    findFirst(args: unknown): Promise<SourceMesocycleState | SuccessorMesocycleState>;
  };
  workout: {
    findMany(args: unknown): Promise<IncompleteWorkoutState>;
  };
};

type CandidateVolumeInput = {
  muscle: string;
  projectedSets: number;
  mev?: number | null;
  productiveTarget?: number | null;
  mav?: number | null;
};
type WeeklyMuscleGateRow =
  NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"][number];

type AcceptanceGateEvidence = {
  userId: string;
  ownerEmail?: string;
  sourceMesocycleId: string;
  sourceMesocycle: SourceMesocycleState | null;
  successorMesocycle?: SuccessorMesocycleState;
  incompleteWorkouts: IncompleteWorkoutState;
  v2PrepareCompare?: V2AcceptedSeedPrepareCompareAuditPayload;
  diagnosticPreview?: MesocycleExplainAuditPayload;
  candidateVolumeRows?: CandidateVolumeInput[];
};

const REQUIRED_GATE_LABELS = [
  "Candidate identity",
  "Seed truth/runtime contract",
  "Volume floors/zones",
  "Prior-block recurring risks",
  "Slot/lane balance",
  "Exercise/materialization quality",
  "Lifecycle/deload safety",
  "Week 1 trainability",
] as const;

function joinEvidence(values: string[]): string {
  return values.filter((value) => value.length > 0).join("; ") || "none";
}

function statusFromBooleans(input: {
  fail?: boolean;
  pass?: boolean;
}): NextMesocycleAcceptanceGateStatus {
  if (input.fail) {
    return "fail";
  }
  if (input.pass) {
    return "pass";
  }
  return "unknown";
}

function planningShapeFromPreview(
  preview: MesocycleExplainAuditPayload | undefined,
): string | undefined {
  const planningReality =
    preview?.preview.projectionDiagnostics.planningReality;
  return planningReality?.summary?.planningShape;
}

function volumeRowsFromPreview(
  preview: MesocycleExplainAuditPayload | undefined,
): CandidateVolumeInput[] {
  return (
    preview?.plannerOnlyNoRepair?.weeklyMuscleTotals.map((row) => {
      const landmarks = VOLUME_LANDMARKS[row.muscle];
      return {
        muscle: row.muscle,
        projectedSets: row.projectedEffectiveSets,
        mev: landmarks?.mev ?? row.targetMin,
        productiveTarget: row.targetPreferred ?? row.targetMin,
        mav: landmarks?.mav ?? null,
      };
    }) ?? []
  );
}

function buildWeeklyMuscleTable(
  rows: CandidateVolumeInput[],
): NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"] {
  return rows
    .map((row) => {
      const landmarks = VOLUME_LANDMARKS[row.muscle];
      const mev = row.mev ?? landmarks?.mev ?? 0;
      const mav = row.mav ?? landmarks?.mav ?? 0;
      const productiveTarget = row.productiveTarget ?? null;
      const projectedSets = Math.round(row.projectedSets * 10) / 10;
      const nearMav =
        productiveTarget != null && mav > 0 && productiveTarget >= mav - 1;
      const status: WeeklyMuscleGateRow["status"] =
        projectedSets < mev
          ? "below_mev_fail"
          : mav > 0 && projectedSets > mav
            ? "over_mav_fail_or_warning"
            : productiveTarget != null && projectedSets < productiveTarget
              ? "above_mev_below_target_not_failure"
              : nearMav
                ? "target_near_mav_stretch_cap"
                : "productive_zone";
      const notes =
        status === "below_mev_fail"
          ? "below MEV blocks acceptance"
          : status === "over_mav_fail_or_warning"
            ? "over MAV requires failure/warning review"
            : status === "above_mev_below_target_not_failure"
              ? "above MEV but below target is not a failure"
              : status === "target_near_mav_stretch_cap"
                ? "target near MAV is a stretch/cap, not a quota"
                : "inside productive zone";

      return {
        muscle: row.muscle,
        projectedSets,
        mev,
        productiveTarget,
        mav,
        status,
        notes,
      };
    })
    .sort((left, right) => left.muscle.localeCompare(right.muscle));
}

function buildPriorRiskRows(
  weeklyRows: NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"],
): NextMesocycleAcceptanceGatePayload["priorBlockRecurringRisks"] {
  const byMuscle = new Map(weeklyRows.map((row) => [row.muscle, row]));
  const chest = byMuscle.get("Chest");
  const calves = byMuscle.get("Calves");
  const sideDelts = byMuscle.get("Side Delts");
  const rearDelts = byMuscle.get("Rear Delts");
  const thinMargin = (row: typeof sideDelts): boolean =>
    Boolean(row && row.projectedSets - row.mev <= 1.5);

  return [
    {
      risk: "Chest MEV fragility",
      status: statusFromBooleans({
        fail: chest?.status === "below_mev_fail",
        pass: Boolean(chest && chest.projectedSets > chest.mev + 1),
      }),
      evidence: chest
        ? `projected=${chest.projectedSets} mev=${chest.mev}`
        : "candidate volume unavailable",
      notes: "watch recurring chest floor misses before acceptance",
    },
    {
      risk: "Calves MEV fragility",
      status: statusFromBooleans({
        fail: calves?.status === "below_mev_fail",
        pass: Boolean(calves && calves.projectedSets > calves.mev + 1),
      }),
      evidence: calves
        ? `projected=${calves.projectedSets} mev=${calves.mev}`
        : "candidate volume unavailable",
      notes: "watch recurring calves floor misses before acceptance",
    },
    {
      risk: "Side/rear delt thin margins",
      status: statusFromBooleans({
        fail: thinMargin(sideDelts) || thinMargin(rearDelts),
        pass: Boolean(sideDelts && rearDelts),
      }),
      evidence: joinEvidence([
        sideDelts
          ? `side_delts=${sideDelts.projectedSets}/${sideDelts.mev}`
          : "side_delts=unknown",
        rearDelts
          ? `rear_delts=${rearDelts.projectedSets}/${rearDelts.mev}`
          : "rear_delts=unknown",
      ]),
      notes: "thin support margins should stay visible even when above MEV",
    },
    {
      risk: "recurring load calibration issues",
      status: "unknown",
      evidence: "weekly-retro evidence not embedded in this candidate",
      notes: "review recent weekly retros for target-too-low/high patterns",
    },
    {
      risk: "reliance on runtime add-ons",
      status: "unknown",
      evidence: "weekly-retro runtime-addition evidence not embedded in this candidate",
      notes: "candidate should not depend on session-local add-ons to satisfy floors",
    },
    {
      risk: "target semantics friction",
      status: "pass",
      evidence: "gate treats MEV/MAV as hard boundaries and target as productive aim",
      notes: "above MEV but below target is not failed",
    },
  ];
}

function buildBlockers(input: AcceptanceGateEvidence): string[] {
  const blockers: string[] = [];
  const source = input.sourceMesocycle;
  const candidateFound =
    input.v2PrepareCompare?.handoffCandidate.found === true;

  if (!source) {
    blockers.push("source mesocycle not found");
  } else if (source.state !== "AWAITING_HANDOFF") {
    blockers.push(`source state not AWAITING_HANDOFF (${source.state})`);
  }

  if (!candidateFound) {
    blockers.push("no persisted handoff candidate");
  }

  if (
    source?.state === "ACTIVE_DELOAD" &&
    source.deloadSessionsCompleted < source.sessionsPerWeek
  ) {
    blockers.push(
      `current deload incomplete (${source.deloadSessionsCompleted}/${source.sessionsPerWeek})`,
    );
  }

  for (const workout of input.incompleteWorkouts) {
    blockers.push(
      `incomplete workout ${workout.id} (${workout.status}${workout.sessionIntent ? ` ${workout.sessionIntent}` : ""})`,
    );
  }

  return Array.from(new Set(blockers));
}

function buildGates(input: {
  evidence: AcceptanceGateEvidence;
  weeklyRows: NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"];
  blockers: string[];
  candidateKind: NextMesocycleAcceptanceGatePayload["candidateIdentity"]["candidateKind"];
  planningShape?: string;
}): NextMesocycleAcceptanceGatePayload["gates"] {
  const v2 = input.evidence.v2PrepareCompare;
  const candidateFound = v2?.handoffCandidate.found === true;
  const volumeFailures = input.weeklyRows.filter(
    (row) =>
      row.status === "below_mev_fail" ||
      row.status === "over_mav_fail_or_warning",
  );
  const coverageRows = v2?.identityCoverageComparison.coverageRows ?? [];
  const coverageFailures = coverageRows.filter(
    (row) => row.v2 === false || row.classification === "v2_regresses",
  );
  const mostlyRepairShaped =
    input.planningShape === "mostly_repair_shaped" ||
    input.planningShape === "mixed_upstream_plus_repair_shaped";
  const seedShapePass =
    v2?.boundaryFacts.readOnly === true &&
    v2.boundaryFacts.noWrite === true &&
    v2.seedShapeComparison.executableFieldShape.classification === "v2_preserves" &&
    v2.seedShapeComparison.seedSerializerIdentity.classification === "v2_preserves";
  const materializerPass =
    v2?.provenance.materializerStatus === "materialized" &&
    v2.provenance.seedShapeCompatibility.compatible === true &&
    !mostlyRepairShaped;

  return REQUIRED_GATE_LABELS.map((gate) => {
    if (gate === "Candidate identity") {
      const pass = candidateFound && input.candidateKind !== "absent";
      return {
        gate,
        status: pass ? "pass" : "fail",
        evidence: `candidate_found=${candidateFound ? "yes" : "no"} kind=${input.candidateKind}`,
        notes:
          input.candidateKind === "diagnostic_preview_only"
            ? "diagnostic previews are evidence only and cannot be accepted"
            : pass
              ? "persisted handoff candidate is inspectable without writes"
              : "rerun after handoff exists",
      };
    }

    if (gate === "Seed truth/runtime contract") {
      return {
        gate,
        status: statusFromBooleans({ pass: candidateFound && seedShapePass }),
        evidence: v2
          ? `serializer=${v2.boundaryFacts.seedSerializer} executable_shape=${v2.seedShapeComparison.executableFieldShape.classification}`
          : "v2 prepare-compare unavailable",
        notes: "runtime contract remains exerciseId/role/setCount only",
      };
    }

    if (gate === "Volume floors/zones") {
      return {
        gate,
        status:
          !candidateFound
            ? "unknown"
            : input.weeklyRows.length === 0
            ? "unknown"
            : volumeFailures.length > 0
              ? "fail"
              : "pass",
        evidence:
          !candidateFound
            ? input.weeklyRows.length > 0
              ? "diagnostic preview volume only; no persisted candidate"
              : "candidate volume unavailable"
          : volumeFailures.length > 0
            ? volumeFailures
                .map((row) => `${row.muscle}:${row.status}`)
                .join(", ")
            : input.weeklyRows.length > 0
              ? "no below-MEV or over-MAV rows"
              : "candidate volume unavailable",
        notes: "below target but above MEV is informational, not failure",
      };
    }

    if (gate === "Prior-block recurring risks") {
      return {
        gate,
        status: "unknown",
        evidence: "risk checklist included below",
        notes: "recurring risks require operator review against recent weekly retros",
      };
    }

    if (gate === "Slot/lane balance") {
      return {
        gate,
        status:
          !candidateFound || coverageRows.length === 0
            ? "unknown"
            : coverageFailures.length > 0
              ? "fail"
              : "pass",
        evidence:
          coverageFailures.length > 0
            ? coverageFailures.map((row) => row.item).join(", ")
            : coverageRows.length > 0
              ? `coverage_rows=${coverageRows.length}`
              : "coverage evidence unavailable",
        notes: "uses prepare-compare class/lane coverage, not runtime policy",
      };
    }

    if (gate === "Exercise/materialization quality") {
      return {
        gate,
        status: statusFromBooleans({
          fail: candidateFound && mostlyRepairShaped,
          pass: candidateFound && materializerPass,
        }),
        evidence: v2
          ? `materializer=${v2.provenance.materializerStatus} seed_shape=${v2.provenance.seedShapeCompatibility.compatible ? "yes" : "no"} planning_shape=${input.planningShape ?? "unknown"}`
          : `planning_shape=${input.planningShape ?? "unknown"}`,
        notes: mostlyRepairShaped
          ? candidateFound
            ? "mostly repair-shaped candidate evidence blocks acceptance"
            : "mostly repair-shaped preview is diagnostic evidence only"
          : "diagnostic preview evidence remains non-executable",
      };
    }

    if (gate === "Lifecycle/deload safety") {
      return {
        gate,
        status: input.blockers.length > 0 ? "fail" : "pass",
        evidence: input.blockers.join(", ") || "no lifecycle blockers found",
        notes: "source must be AWAITING_HANDOFF before acceptance gate is runnable",
      };
    }

    return {
      gate,
      status: statusFromBooleans({
        pass:
          candidateFound &&
          v2?.provenance.baseValidationStatus === "pass" &&
          v2.provenance.seedShapeCompatibility.compatible === true,
      }),
      evidence: v2
        ? `base=${v2.provenance.baseValidationStatus} seed_shape=${v2.provenance.seedShapeCompatibility.compatible ? "yes" : "no"}`
        : "candidate trainability evidence unavailable",
      notes: "Week 1 must be trainable from persisted candidate evidence",
    };
  });
}

function deriveGateResult(input: {
  candidateFound: boolean;
  gates: NextMesocycleAcceptanceGatePayload["gates"];
}): NextMesocycleAcceptanceGatePayload["gateResult"] {
  if (!input.candidateFound) {
    return "not_runnable_yet";
  }
  if (input.gates.some((gate) => gate.status === "fail")) {
    return "fail";
  }
  if (input.gates.some((gate) => gate.status === "unknown")) {
    return "unknown";
  }
  return "pass";
}

export function buildNextMesocycleAcceptanceGateFromEvidence(
  evidence: AcceptanceGateEvidence,
): NextMesocycleAcceptanceGatePayload {
  const source = evidence.sourceMesocycle;
  const draftAvailable = Boolean(
    source && readNextCycleSeedDraft(source.nextSeedDraftJson),
  );
  const persistedCandidateFound =
    evidence.v2PrepareCompare?.handoffCandidate.found === true;
  const previewAvailable = Boolean(evidence.diagnosticPreview?.preview);
  const candidateKind: NextMesocycleAcceptanceGatePayload["candidateIdentity"]["candidateKind"] =
    evidence.successorMesocycle?.id
      ? "accepted"
      : persistedCandidateFound && draftAvailable
        ? "draft"
        : !persistedCandidateFound && previewAvailable
          ? "diagnostic_preview_only"
          : "absent";
  const candidateFound =
    persistedCandidateFound &&
    (candidateKind === "accepted" || candidateKind === "draft");
  const blockers = buildBlockers(evidence);
  const planningShape = planningShapeFromPreview(evidence.diagnosticPreview);
  const weeklyRows = buildWeeklyMuscleTable(
    evidence.candidateVolumeRows?.length
      ? evidence.candidateVolumeRows
      : volumeRowsFromPreview(evidence.diagnosticPreview),
  );
  const gates = buildGates({
    evidence,
    weeklyRows,
    blockers,
    candidateKind,
    planningShape,
  });
  const gateResult = deriveGateResult({ candidateFound, gates });
  const why =
    gateResult === "not_runnable_yet"
      ? blockers.length > 0
        ? blockers
        : ["no runnable persisted handoff candidate"]
      : gates
          .filter((gate) => gate.status === "fail")
          .map((gate) => `${gate.gate}: ${gate.evidence}`);

  return {
    version: NEXT_MESOCYCLE_ACCEPTANCE_GATE_AUDIT_PAYLOAD_VERSION,
    source: "next_mesocycle_acceptance_gate_audit",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    wouldWriteTransaction: false,
    gateResult,
    candidateFound,
    why,
    recommendation:
      gateResult === "not_runnable_yet"
        ? "rerun after handoff exists"
        : gateResult === "pass"
          ? "candidate passes the read-only gate"
          : "inspect failed or unknown gates before accepting",
    candidateIdentity: {
      ...(evidence.ownerEmail ? { ownerEmail: evidence.ownerEmail } : {}),
      sourceMesocycleId: evidence.sourceMesocycleId,
      sourceState: source?.state ?? null,
      candidateKind,
      ...(evidence.successorMesocycle?.id
        ? { candidateMesocycleId: evidence.successorMesocycle.id }
        : persistedCandidateFound && source?.id
          ? { candidateMesocycleId: source.id }
          : {}),
      candidateDraftAvailable: draftAvailable,
      persistedHandoffCandidateFound: persistedCandidateFound,
      writeNeededToInspect: false,
    },
    gates,
    weeklyMuscleTable: weeklyRows,
    priorBlockRecurringRisks: buildPriorRiskRows(weeklyRows),
    diagnosticPreview: {
      available: previewAvailable,
      label: previewAvailable
        ? "diagnostic_preview_not_candidate"
        : "not_available",
      canBeAccepted: false,
      ...(planningShape ? { planningShape } : {}),
      notes: previewAvailable
        ? [
            "mesocycle-explain preview is diagnostic evidence only",
            "preview evidence cannot satisfy candidate identity without a persisted handoff candidate",
          ]
        : ["no mesocycle-explain preview evidence loaded"],
    },
    blockers,
    supportingEvidence: {
      v2PrepareCompareStatus: evidence.v2PrepareCompare?.compareStatus,
      v2ProductionWriteEligible:
        evidence.v2PrepareCompare?.boundaryFacts.v2ProductionWriteEligible,
      mesocycleExplainPreviewAvailable: previewAvailable,
    },
  };
}

async function loadSourceState(input: {
  userId: string;
  sourceMesocycleId: string;
  reader: AcceptanceGateReader;
}): Promise<SourceMesocycleState | null> {
  return input.reader.mesocycle.findFirst({
    where: {
      id: input.sourceMesocycleId,
      macroCycle: { userId: input.userId },
    },
    select: {
      id: true,
      state: true,
      macroCycleId: true,
      mesoNumber: true,
      sessionsPerWeek: true,
      deloadSessionsCompleted: true,
      nextSeedDraftJson: true,
    },
  }) as Promise<SourceMesocycleState | null>;
}

async function loadSuccessorState(input: {
  source: SourceMesocycleState | null;
  reader: AcceptanceGateReader;
}): Promise<SuccessorMesocycleState> {
  if (!input.source) {
    return null;
  }
  return input.reader.mesocycle.findFirst({
    where: {
      macroCycleId: input.source.macroCycleId,
      mesoNumber: input.source.mesoNumber + 1,
    },
    select: {
      id: true,
      state: true,
    },
  }) as Promise<SuccessorMesocycleState>;
}

async function loadIncompleteWorkouts(input: {
  userId: string;
  sourceMesocycleId: string;
  reader: AcceptanceGateReader;
}): Promise<IncompleteWorkoutState> {
  return input.reader.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: input.sourceMesocycleId,
      status: { in: ["IN_PROGRESS", "PARTIAL"] },
    },
    orderBy: { scheduledDate: "asc" },
    select: {
      id: true,
      status: true,
      sessionIntent: true,
    },
  });
}

export async function buildNextMesocycleAcceptanceGateAuditPayload(input: {
  userId: string;
  ownerEmail?: string;
  sourceMesocycleId: string;
  plannerDiagnosticsMode: "standard" | "debug";
  dependencies?: {
    reader?: AcceptanceGateReader;
    buildV2Compare?: typeof buildV2AcceptedSeedPrepareCompareAuditPayload;
    buildMesocycleExplain?: typeof buildMesocycleExplainAuditPayload;
  };
}): Promise<NextMesocycleAcceptanceGatePayload> {
  const reader = (input.dependencies?.reader ?? prisma) as AcceptanceGateReader;
  const [sourceMesocycle, v2PrepareCompare, diagnosticPreview] =
    await Promise.all([
      loadSourceState({
        userId: input.userId,
        sourceMesocycleId: input.sourceMesocycleId,
        reader,
      }),
      (input.dependencies?.buildV2Compare ??
        buildV2AcceptedSeedPrepareCompareAuditPayload)({
        userId: input.userId,
        ownerEmail: input.ownerEmail,
        mesocycleId: input.sourceMesocycleId,
        requestedIdSource: "source_mesocycle_id",
      }),
      (input.dependencies?.buildMesocycleExplain ?? buildMesocycleExplainAuditPayload)({
        userId: input.userId,
        ownerEmail: input.ownerEmail,
        sourceMesocycleId: input.sourceMesocycleId,
        retrospectiveMesocycleId: input.sourceMesocycleId,
        plannerDiagnosticsMode: input.plannerDiagnosticsMode,
        plannerOnlyNoRepair: {
          enabled: true,
          compareRepaired: true,
        },
      }).catch(() => undefined),
    ]);
  const [successorMesocycle, incompleteWorkouts] = await Promise.all([
    loadSuccessorState({ source: sourceMesocycle, reader }),
    loadIncompleteWorkouts({
      userId: input.userId,
      sourceMesocycleId: input.sourceMesocycleId,
      reader,
    }),
  ]);

  return buildNextMesocycleAcceptanceGateFromEvidence({
    userId: input.userId,
    ownerEmail: input.ownerEmail,
    sourceMesocycleId: input.sourceMesocycleId,
    sourceMesocycle,
    successorMesocycle,
    incompleteWorkouts,
    v2PrepareCompare,
    diagnosticPreview,
  });
}
