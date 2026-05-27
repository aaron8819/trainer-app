import { prisma } from "@/lib/db/prisma";
import { readNextCycleSeedDraft } from "@/lib/api/mesocycle-handoff";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { NEXT_MESOCYCLE_ACCEPTANCE_GATE_AUDIT_PAYLOAD_VERSION } from "./constants";
import { buildMesocycleExplainAuditPayload } from "./mesocycle-explain";
import { buildV2AcceptedSeedPrepareCompareAuditPayload } from "./v2-accepted-seed-prepare-compare";
import { buildWeeklyRetroAuditPayload } from "./weekly-retro";
import type {
  MesocycleExplainAuditPayload,
  NextMesocycleAcceptanceGatePayload,
  NextMesocycleAcceptanceGateStatus,
  V2AcceptedSeedPrepareCompareAuditPayload,
  WeeklyRetroAuditPayload,
  WeeklyRetroAuditVolumeRow,
  WeeklyRetroExerciseLoadCalibrationClassification,
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
  completedBlockRetros?: WeeklyRetroAuditPayload[];
  candidateVolumeRows?: CandidateVolumeInput[];
};

type CompletedBlockEvidenceRow =
  NextMesocycleAcceptanceGatePayload["completedBlockEvidence"][number];

type CompletedBlockEvidenceAssessment = {
  rows: CompletedBlockEvidenceRow[];
  candidateFailureRisks: string[];
  candidateWarningRisks: string[];
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

const COMPLETED_BLOCK_WEEKS = [1, 2, 3, 4] as const;
const LOAD_CALIBRATION_DRIFT_CLASSIFICATIONS: ReadonlySet<WeeklyRetroExerciseLoadCalibrationClassification> =
  new Set<WeeklyRetroExerciseLoadCalibrationClassification>([
    "target_too_low",
    "target_too_high",
    "recalibrated_hold",
  ]);

function joinEvidence(values: string[]): string {
  return values.filter((value) => value.length > 0).join("; ") || "none";
}

function formatGateNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "unknown";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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

function retroVolumeRowsForMuscle(
  retros: WeeklyRetroAuditPayload[],
  muscle: string,
): Array<{ week: number; row: WeeklyRetroAuditVolumeRow }> {
  return retros
    .flatMap((retro) =>
      retro.volumeTargeting.muscles
        .filter((row) => row.muscle === muscle)
        .map((row) => ({ week: retro.week, row })),
    )
    .sort((left, right) => left.week - right.week);
}

function retroVolumeRowForWeek(
  retros: WeeklyRetroAuditPayload[],
  week: number,
  muscle: string,
): WeeklyRetroAuditVolumeRow | undefined {
  return retros
    .find((retro) => retro.week === week)
    ?.volumeTargeting.muscles.find((row) => row.muscle === muscle);
}

function runtimeTopUpWeeksForMuscle(
  retros: WeeklyRetroAuditPayload[],
  muscle: string,
): number[] {
  return retros
    .filter((retro) =>
      retro.planAdherence.interpretations.some(
        (interpretation) =>
          interpretation.setDelta > 0 &&
          interpretation.muscles.includes(muscle) &&
          (interpretation.intent === "final_weekly_opportunity_mev_closure" ||
            interpretation.intent === "target_gap_closure"),
      ),
    )
    .map((retro) => retro.week)
    .sort((left, right) => left - right);
}

function candidateRowByMuscle(
  weeklyRows: NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"],
): Map<string, WeeklyMuscleGateRow> {
  return new Map(weeklyRows.map((row) => [row.muscle, row]));
}

function candidateMevImplication(input: {
  candidateFound: boolean;
  row?: WeeklyMuscleGateRow;
  muscle: string;
  floorKind: string;
}): { text: string; failure: boolean; warning: boolean } {
  if (!input.candidateFound) {
    return {
      text: "candidate evidence pending; apply when a persisted handoff candidate exists",
      failure: false,
      warning: false,
    };
  }
  if (!input.row) {
    return {
      text: `candidate ${input.muscle} volume unavailable; cannot prove prior ${input.floorKind} addressed`,
      failure: false,
      warning: true,
    };
  }
  if (input.row.projectedSets < input.row.mev) {
    return {
      text: `candidate repeats predictable ${input.muscle} below-MEV floor (${formatGateNumber(input.row.projectedSets)}/${formatGateNumber(input.row.mev)}); acceptance should fail`,
      failure: true,
      warning: false,
    };
  }
  if (input.row.projectedSets - input.row.mev <= 1.5) {
    return {
      text: `candidate clears ${input.muscle} MEV but leaves a thin planned floor (${formatGateNumber(input.row.projectedSets)}/${formatGateNumber(input.row.mev)}); acceptance should warn`,
      failure: false,
      warning: true,
    };
  }
  return {
    text: `candidate addresses ${input.muscle} floor with planned seed volume (${formatGateNumber(input.row.projectedSets)}/${formatGateNumber(input.row.mev)})`,
    failure: false,
    warning: false,
  };
}

function buildMevFragilityEvidence(input: {
  retros: WeeklyRetroAuditPayload[];
  candidateRows: Map<string, WeeklyMuscleGateRow>;
  candidateFound: boolean;
  muscle: "Chest" | "Calves";
  risk: string;
}): {
  row: CompletedBlockEvidenceRow;
  failure: boolean;
  warning: boolean;
} {
  const finalWeek = retroVolumeRowForWeek(input.retros, 4, input.muscle);
  const topUpWeeks = runtimeTopUpWeeksForMuscle(input.retros, input.muscle);
  const belowMevRows = retroVolumeRowsForMuscle(input.retros, input.muscle).filter(
    ({ row }) => row.status === "below_mev" || row.deltaToMev < 0,
  );
  const implication = candidateMevImplication({
    candidateFound: input.candidateFound,
    row: input.candidateRows.get(input.muscle),
    muscle: input.muscle,
    floorKind: "MEV fragility",
  });
  const severity: CompletedBlockEvidenceRow["severity"] =
    (finalWeek?.status === "below_mev" || (finalWeek?.deltaToMev ?? 0) < 0) ||
    topUpWeeks.length > 0 ||
    belowMevRows.length > 0
      ? "high"
      : "low";
  const evidence = joinEvidence([
    topUpWeeks.length > 0
      ? `${topUpWeeks.map((week) => `W${week}`).join(", ")} required top-up`
      : "",
    finalWeek
      ? `W4 finished ${formatGateNumber(finalWeek.actualEffectiveSets)}/${formatGateNumber(finalWeek.mev)} MEV`
      : "",
    belowMevRows.length > 0
      ? `below-MEV weeks=${belowMevRows.map(({ week }) => `W${week}`).join(",")}`
      : "",
  ]);

  return {
    row: {
      risk: input.risk,
      evidence:
        evidence === "none"
          ? "weekly-retro muscle evidence unavailable or clean"
          : evidence,
      acceptanceImplication: implication.text,
      severity,
    },
    failure: severity === "high" && implication.failure,
    warning: severity === "high" && implication.warning,
  };
}

function buildDeltThinMarginEvidence(input: {
  retros: WeeklyRetroAuditPayload[];
  candidateRows: Map<string, WeeklyMuscleGateRow>;
  candidateFound: boolean;
}): {
  row: CompletedBlockEvidenceRow;
  failure: boolean;
  warning: boolean;
} {
  const sideFinal = retroVolumeRowForWeek(input.retros, 4, "Side Delts");
  const rearFinal = retroVolumeRowForWeek(input.retros, 4, "Rear Delts");
  const sideCandidate = candidateMevImplication({
    candidateFound: input.candidateFound,
    row: input.candidateRows.get("Side Delts"),
    muscle: "Side Delts",
    floorKind: "thin margin",
  });
  const rearCandidate = candidateMevImplication({
    candidateFound: input.candidateFound,
    row: input.candidateRows.get("Rear Delts"),
    muscle: "Rear Delts",
    floorKind: "thin margin",
  });
  const finalRows = [sideFinal, rearFinal].filter(Boolean) as WeeklyRetroAuditVolumeRow[];
  const belowOrThin = finalRows.some(
    (row) => row.deltaToMev <= 1.5 || row.status === "below_mev",
  );
  const severity: CompletedBlockEvidenceRow["severity"] = belowOrThin
    ? "medium"
    : "low";
  const implications = [sideCandidate.text, rearCandidate.text];

  return {
    row: {
      risk: "Side/rear delt thin margins",
      evidence: joinEvidence([
        sideFinal
          ? `Side Delts W4 ${formatGateNumber(sideFinal.actualEffectiveSets)}/${formatGateNumber(sideFinal.mev)} MEV`
          : "Side Delts W4 unavailable",
        rearFinal
          ? `Rear Delts W4 ${formatGateNumber(rearFinal.actualEffectiveSets)}/${formatGateNumber(rearFinal.mev)} MEV`
          : "Rear Delts W4 unavailable",
      ]),
      acceptanceImplication: input.candidateFound
        ? implications.join("; ")
        : "candidate evidence pending; avoid razor-thin side/rear delt floors when a persisted candidate exists",
      severity,
    },
    failure: false,
    warning:
      severity !== "low" && (sideCandidate.failure || sideCandidate.warning || rearCandidate.failure || rearCandidate.warning),
  };
}

function buildRuntimeAddonEvidence(
  retros: WeeklyRetroAuditPayload[],
): CompletedBlockEvidenceRow {
  const weeks = retros
    .map((retro) => ({
      week: retro.week,
      addedSets: retro.planAdherence.explainedAdditions.totalSets,
      addedRows:
        retro.exerciseLoadCalibrationRows?.filter(
          (row) => row.classification === "runtime_added" || row.addedSetCount > 0,
        ).length ?? 0,
    }))
    .filter((row) => row.addedSets > 0 || row.addedRows > 0);
  const totalAddedSets = weeks.reduce((sum, row) => sum + row.addedSets, 0);

  return {
    risk: "Repeated runtime add-ons",
    evidence:
      weeks.length > 0
        ? joinEvidence(
            weeks.map(
              (row) =>
                `W${row.week} added_sets=${formatGateNumber(row.addedSets)} added_rows=${row.addedRows}`,
            ),
          )
        : "no runtime-added weekly-retro evidence",
    acceptanceImplication:
      totalAddedSets > 0
        ? "candidate should satisfy predictable floors with planned seed volume, not session-local add-ons"
        : "informational; no recurring add-on dependency visible",
    severity: weeks.length > 0 ? "medium" : "low",
  };
}

function buildLoadCalibrationEvidence(
  retros: WeeklyRetroAuditPayload[],
): CompletedBlockEvidenceRow {
  const driftRows = retros
    .flatMap((retro) =>
      (retro.exerciseLoadCalibrationRows ?? []).map((row) => ({
        week: retro.week,
        row,
      })),
    )
    .filter(({ row }) => LOAD_CALIBRATION_DRIFT_CLASSIFICATIONS.has(row.classification));
  const examples = driftRows.slice(0, 4).map(
    ({ week, row }) => `W${week} ${row.exerciseName} ${row.classification}`,
  );

  return {
    risk: "Load calibration drift",
    evidence:
      examples.length > 0
        ? joinEvidence(examples)
        : "no target-too-low/high or recalibrated-hold rows",
    acceptanceImplication:
      driftRows.length > 0
        ? "Week 1 prescriptions should use recent anchors/confidence warnings; this audit does not mutate loads"
        : "informational; no calibration drift visible in loaded retros",
    severity: driftRows.length > 0 ? "medium" : "low",
  };
}

function buildTargetSemanticsEvidence(
  retros: WeeklyRetroAuditPayload[],
): CompletedBlockEvidenceRow {
  const underTargetOnly = retros.reduce(
    (sum, retro) => sum + retro.volumeTargeting.underTargetOnly.length,
    0,
  );
  const belowMev = retros.reduce(
    (sum, retro) => sum + retro.volumeTargeting.belowMev.length,
    0,
  );

  return {
    risk: "Target semantics noise",
    evidence: `below_target_above_mev_rows=${underTargetOnly}; below_mev_rows=${belowMev}`,
    acceptanceImplication:
      "do not fail candidate solely for below-target rows when projected volume is at or above MEV",
    severity: underTargetOnly > 0 ? "medium" : "low",
  };
}

function buildOptionalGapFillDependencyEvidence(input: {
  retros: WeeklyRetroAuditPayload[];
  candidateRows: Map<string, WeeklyMuscleGateRow>;
  candidateFound: boolean;
}): {
  row: CompletedBlockEvidenceRow;
  failure: boolean;
  warning: boolean;
} {
  const topUpWeeks = Array.from(
    new Set([
      ...runtimeTopUpWeeksForMuscle(input.retros, "Chest"),
      ...runtimeTopUpWeeksForMuscle(input.retros, "Calves"),
    ]),
  ).sort((left, right) => left - right);
  const chest = candidateMevImplication({
    candidateFound: input.candidateFound,
    row: input.candidateRows.get("Chest"),
    muscle: "Chest",
    floorKind: "optional gap-fill dependency",
  });
  const calves = candidateMevImplication({
    candidateFound: input.candidateFound,
    row: input.candidateRows.get("Calves"),
    muscle: "Calves",
    floorKind: "optional gap-fill dependency",
  });
  const severity: CompletedBlockEvidenceRow["severity"] =
    topUpWeeks.length > 0 ? "high" : "low";
  const candidateImplication = !input.candidateFound
    ? "evidence will be applied when a persisted handoff candidate exists"
    : chest.failure || calves.failure
      ? "candidate still depends on non-planned top-ups for predictable floors; acceptance should fail"
      : chest.warning || calves.warning
        ? "candidate planned floors are thin; acceptance should warn against optional gap-fill dependency"
        : "candidate planned floors clear prior top-up dependency; optional gap-fill should remain unnecessary";

  return {
    row: {
      risk: "Optional gap-fill dependency risk",
      evidence:
        topUpWeeks.length > 0
          ? `${topUpWeeks.map((week) => `W${week}`).join(", ")} session-local top-up evidence`
          : "normal week close should not rely on optional gap-fill",
      acceptanceImplication: candidateImplication,
      severity,
    },
    failure: severity === "high" && (chest.failure || calves.failure),
    warning: severity === "high" && (chest.warning || calves.warning),
  };
}

function buildCompletedBlockEvidenceAssessment(input: {
  retros: WeeklyRetroAuditPayload[];
  weeklyRows: NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"];
  candidateFound: boolean;
}): CompletedBlockEvidenceAssessment {
  const candidateRows = candidateRowByMuscle(input.weeklyRows);
  const assessedRows = [
    buildMevFragilityEvidence({
      retros: input.retros,
      candidateRows,
      candidateFound: input.candidateFound,
      muscle: "Chest",
      risk: "Chest MEV fragility",
    }),
    buildMevFragilityEvidence({
      retros: input.retros,
      candidateRows,
      candidateFound: input.candidateFound,
      muscle: "Calves",
      risk: "Calf MEV fragility",
    }),
    buildDeltThinMarginEvidence({
      retros: input.retros,
      candidateRows,
      candidateFound: input.candidateFound,
    }),
    {
      row: buildRuntimeAddonEvidence(input.retros),
      failure: false,
      warning: false,
    },
    {
      row: buildLoadCalibrationEvidence(input.retros),
      failure: false,
      warning: false,
    },
    {
      row: buildTargetSemanticsEvidence(input.retros),
      failure: false,
      warning: false,
    },
    buildOptionalGapFillDependencyEvidence({
      retros: input.retros,
      candidateRows,
      candidateFound: input.candidateFound,
    }),
  ];

  return {
    rows: assessedRows.map((entry) => entry.row),
    candidateFailureRisks: assessedRows
      .filter((entry) => entry.failure)
      .map((entry) => entry.row.risk),
    candidateWarningRisks: assessedRows
      .filter((entry) => entry.warning)
      .map((entry) => entry.row.risk),
  };
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
  completedBlockAssessment: CompletedBlockEvidenceAssessment;
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
      const failures = input.completedBlockAssessment.candidateFailureRisks;
      const warnings = input.completedBlockAssessment.candidateWarningRisks;
      return {
        gate,
        status:
          failures.length > 0
            ? "fail"
            : !candidateFound || warnings.length > 0
              ? "unknown"
              : "pass",
        evidence:
          failures.length > 0
            ? `repeated predictable misses=${failures.join(", ")}`
            : warnings.length > 0
              ? `thin or unverifiable recurring risks=${warnings.join(", ")}`
              : input.completedBlockAssessment.rows.length > 0
                ? "completed-block evidence reviewed"
                : "completed-block evidence unavailable",
        notes: candidateFound
          ? "compares candidate floors against recent weekly-retro evidence"
          : "evidence will be applied when a persisted handoff candidate exists",
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
  const completedBlockAssessment = buildCompletedBlockEvidenceAssessment({
    retros: evidence.completedBlockRetros ?? [],
    weeklyRows,
    candidateFound,
  });
  const gates = buildGates({
    evidence,
    weeklyRows,
    completedBlockAssessment,
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
    completedBlockEvidence: completedBlockAssessment.rows,
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

async function loadCompletedBlockRetros(input: {
  userId: string;
  ownerEmail?: string;
  sourceMesocycle: SourceMesocycleState | null;
  buildWeeklyRetro: typeof buildWeeklyRetroAuditPayload;
}): Promise<WeeklyRetroAuditPayload[]> {
  if (!input.sourceMesocycle) {
    return [];
  }

  const retros = await Promise.all(
    COMPLETED_BLOCK_WEEKS.map(async (week) => {
      try {
        return await input.buildWeeklyRetro({
          userId: input.userId,
          ownerEmail: input.ownerEmail,
          week,
          mesocycleId: input.sourceMesocycle!.id,
        });
      } catch {
        return null;
      }
    }),
  );

  return retros.filter((retro): retro is WeeklyRetroAuditPayload => retro != null);
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
    buildWeeklyRetro?: typeof buildWeeklyRetroAuditPayload;
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
  const [successorMesocycle, incompleteWorkouts, completedBlockRetros] =
    await Promise.all([
      loadSuccessorState({ source: sourceMesocycle, reader }),
      loadIncompleteWorkouts({
        userId: input.userId,
        sourceMesocycleId: input.sourceMesocycleId,
        reader,
      }),
      loadCompletedBlockRetros({
        userId: input.userId,
        ownerEmail: input.ownerEmail,
        sourceMesocycle,
        buildWeeklyRetro:
          input.dependencies?.buildWeeklyRetro ?? buildWeeklyRetroAuditPayload,
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
    completedBlockRetros,
  });
}
