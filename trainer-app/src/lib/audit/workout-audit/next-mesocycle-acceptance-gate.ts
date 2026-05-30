import { prisma } from "@/lib/db/prisma";
import { readNextCycleSeedDraft } from "@/lib/api/mesocycle-handoff";
import type { MesocycleSlotPlanSeed } from "@/lib/api/mesocycle-handoff-slot-plan-projection.seed-serialization";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { NEXT_MESOCYCLE_ACCEPTANCE_GATE_AUDIT_PAYLOAD_VERSION } from "./constants";
import { buildMesocycleExplainAuditPayload } from "./mesocycle-explain";
import { buildV2AcceptedSeedPrepareCompareAuditPayload } from "./v2-accepted-seed-prepare-compare";
import { buildWeeklyRetroAuditPayload } from "./weekly-retro";
import type {
  MesocycleExplainAuditPayload,
  NextMesocycleAcceptanceGateRemediation,
  NextMesocycleAcceptanceGateSeverity,
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

export type CandidateVolumeExerciseRow = {
  id: string;
  name: string;
  aliases?: Array<{ alias: string }>;
  exerciseMuscles?: Array<{
    role: string;
    muscle: { name: string };
  }>;
};

type AcceptanceGateReader = {
  mesocycle: {
    findFirst(args: unknown): Promise<SourceMesocycleState | SuccessorMesocycleState>;
  };
  workout: {
    findMany(args: unknown): Promise<IncompleteWorkoutState>;
  };
  exercise: {
    findMany(args: unknown): Promise<CandidateVolumeExerciseRow[]>;
  };
};

export type CandidateVolumeInput = {
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

type RepairBurdenAssessment = Pick<
  NextMesocycleAcceptanceGatePayload["decisionSummary"],
  "repairBurden" | "repairBurdenEvidence"
> & {
  materialRepairCount: number | null;
  majorRepairCount: number | null;
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
  warning?: boolean;
  pass?: boolean;
}): NextMesocycleAcceptanceGateStatus {
  if (input.fail) {
    return "fail";
  }
  if (input.warning) {
    return "warning";
  }
  if (input.pass) {
    return "pass";
  }
  return "unknown";
}

function weekOneTrainabilityStatus(input: {
  candidateFound: boolean;
  baseValidationStatus?: string;
  seedShapeCompatible: boolean;
}): NextMesocycleAcceptanceGateStatus {
  if (!input.candidateFound) {
    return "unknown";
  }
  if (!input.seedShapeCompatible) {
    return "fail";
  }
  if (input.baseValidationStatus === "pass") {
    return "pass";
  }
  if (input.baseValidationStatus === "pass_with_warnings") {
    return "warning";
  }
  return "fail";
}

function weekOneTrainabilityEvidence(input: {
  baseValidationStatus?: string;
  seedShapeCompatible: boolean;
  status: NextMesocycleAcceptanceGateStatus;
}): string {
  const evidence = [
    `base=${input.baseValidationStatus ?? "unknown"}`,
    `seed_shape=${input.seedShapeCompatible ? "yes" : "no"}`,
  ];
  if (input.status === "warning") {
    evidence.push("post_accept_verification=required");
  }
  return evidence.join(" ");
}

function isActionableSeverity(
  severity: NextMesocycleAcceptanceGateSeverity,
): boolean {
  return (
    severity === "blocker" ||
    severity === "high_risk" ||
    severity === "warning"
  );
}

function planningShapeFromPreview(
  preview: MesocycleExplainAuditPayload | undefined,
): string | undefined {
  const planningReality =
    preview?.preview.projectionDiagnostics.planningReality;
  return planningReality?.summary?.planningShape;
}

function repairBurdenFromPreview(
  preview: MesocycleExplainAuditPayload | undefined,
): RepairBurdenAssessment {
  const planningReality =
    preview?.preview.projectionDiagnostics.planningReality;
  const summary = planningReality?.summary;
  const materialRepairCount =
    planningReality?.shadowRepairSummary?.materialRepairCount ??
    summary?.materialRepairCount ??
    null;
  const majorRepairCount =
    planningReality?.shadowRepairSummary?.majorRepairCount ??
    summary?.majorRepairCount ??
    null;
  const planningShape = summary?.planningShape;
  const evidence = [
    `planning_shape=${planningShape ?? "unknown"}`,
    `materialRepairCount=${formatGateNumber(materialRepairCount)}`,
    `majorRepairCount=${formatGateNumber(majorRepairCount)}`,
  ].join(" ");

  if (
    planningShape === "mostly_repair_shaped" ||
    planningShape === "mixed_upstream_plus_repair_shaped" ||
    (majorRepairCount ?? 0) > 0 ||
    (materialRepairCount ?? 0) >= 6
  ) {
    return {
      repairBurden: "high",
      repairBurdenEvidence: evidence,
      materialRepairCount,
      majorRepairCount,
    };
  }

  if ((materialRepairCount ?? 0) >= 3) {
    return {
      repairBurden: "medium",
      repairBurdenEvidence: evidence,
      materialRepairCount,
      majorRepairCount,
    };
  }

  if ((materialRepairCount ?? 0) > 0) {
    return {
      repairBurden: "low",
      repairBurdenEvidence: evidence,
      materialRepairCount,
      majorRepairCount,
    };
  }

  return {
    repairBurden: materialRepairCount == null ? "low" : "none",
    repairBurdenEvidence: evidence,
    materialRepairCount,
    majorRepairCount,
  };
}

type SupportLaneBoundaryRow = NonNullable<
  MesocycleExplainAuditPayload["plannerOnlyNoRepair"]
>["v2SupportLaneProjectionDiagnostic"]["laneBoundaryRows"][number];

function supportLaneBoundaryAssessment(input: {
  preview: MesocycleExplainAuditPayload | undefined;
  candidateFound: boolean;
  weeklyRows: NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"];
}): {
  droppedRows: SupportLaneBoundaryRow[];
  blockingRows: SupportLaneBoundaryRow[];
  warningRows: SupportLaneBoundaryRow[];
  evidence: string;
} {
  const weeklyByMuscle = new Map(input.weeklyRows.map((row) => [row.muscle, row]));
  const droppedRows =
    input.preview?.plannerOnlyNoRepair?.v2SupportLaneProjectionDiagnostic
      .laneBoundaryRows?.filter(
        (row) => row.status === "authored_support_lane_dropped",
      ) ?? [];
  const blockingRows = input.candidateFound
    ? droppedRows.filter((row) => {
        const weekly = weeklyByMuscle.get(row.muscle);
        return weekly?.status === "below_mev_fail";
      })
    : [];
  const warningRows = input.candidateFound
    ? droppedRows.filter((row) => !blockingRows.includes(row))
    : [];
  const evidence =
    droppedRows.length > 0
      ? droppedRows
          .slice(0, 4)
          .map(
            (row) =>
              `${row.muscle}:${row.slotId}/${row.laneId}:${row.status}:floor=${formatGateNumber(row.projectedEffectiveSets)}/${formatGateNumber(row.mevFloor)}`,
          )
          .join(", ")
      : "no authored support lane drops reported";

  return {
    droppedRows,
    blockingRows,
    warningRows,
    evidence,
  };
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

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function musclesByRole(
  exercise: CandidateVolumeExerciseRow,
  role: "PRIMARY" | "SECONDARY",
): string[] {
  return (exercise.exerciseMuscles ?? [])
    .filter((entry) => entry.role === role)
    .map((entry) => entry.muscle.name)
    .sort((left, right) => left.localeCompare(right));
}

export function buildCandidateVolumeRowsFromSlotPlanSeed(input: {
  seed: MesocycleSlotPlanSeed;
  exercises: CandidateVolumeExerciseRow[];
  muscles?: readonly string[];
}): CandidateVolumeInput[] {
  const exerciseById = new Map(input.exercises.map((exercise) => [exercise.id, exercise]));
  const totals = new Map<string, number>();

  for (const slot of input.seed.slots) {
    for (const seedExercise of slot.exercises) {
      const exercise = exerciseById.get(seedExercise.exerciseId);
      if (!exercise) {
        continue;
      }
      const contribution = getEffectiveStimulusByMuscle(
        {
          id: exercise.id,
          name: exercise.name,
          aliases: (exercise.aliases ?? []).map((alias) => alias.alias),
          primaryMuscles: musclesByRole(exercise, "PRIMARY"),
          secondaryMuscles: musclesByRole(exercise, "SECONDARY"),
        },
        seedExercise.setCount,
        { logFallback: false },
      );
      for (const [muscle, effectiveSets] of contribution) {
        totals.set(muscle, (totals.get(muscle) ?? 0) + effectiveSets);
      }
    }
  }

  const muscles =
    input.muscles && input.muscles.length > 0
      ? Array.from(new Set(input.muscles))
      : Object.keys(VOLUME_LANDMARKS).filter((muscle) => (totals.get(muscle) ?? 0) > 0);

  return muscles
    .flatMap((muscle) => {
      const landmarks = VOLUME_LANDMARKS[muscle];
      const projectedSets = roundToTenth(totals.get(muscle) ?? 0);
      if (!landmarks && projectedSets <= 0) {
        return [];
      }
      return [
        {
          muscle,
          projectedSets,
          mev: landmarks?.mev ?? null,
          productiveTarget: landmarks?.mev ?? null,
          mav: landmarks?.mav ?? null,
        },
      ];
    })
    .sort((left, right) => left.muscle.localeCompare(right.muscle));
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
      const severity: NextMesocycleAcceptanceGateSeverity =
        status === "below_mev_fail" || status === "over_mav_fail_or_warning"
          ? "high_risk"
          : status === "above_mev_below_target_not_failure" ||
              status === "target_near_mav_stretch_cap"
            ? "info"
            : "pass";

      return {
        muscle: row.muscle,
        projectedSets,
        mev,
        productiveTarget,
        mav,
        status,
        severity,
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
        warning: Boolean(chest && chest.projectedSets - chest.mev <= 1.5),
        pass: Boolean(chest && chest.projectedSets > chest.mev + 1),
      }),
      severity:
        chest?.status === "below_mev_fail"
          ? "high_risk"
          : chest && chest.projectedSets - chest.mev <= 1.5
            ? "warning"
            : chest
              ? "pass"
              : "info",
      evidence: chest
        ? `projected=${chest.projectedSets} mev=${chest.mev}`
        : "candidate volume unavailable",
      notes: "watch recurring chest floor misses before acceptance",
    },
    {
      risk: "Calves MEV fragility",
      status: statusFromBooleans({
        fail: calves?.status === "below_mev_fail",
        warning: Boolean(calves && calves.projectedSets - calves.mev <= 1.5),
        pass: Boolean(calves && calves.projectedSets > calves.mev + 1),
      }),
      severity:
        calves?.status === "below_mev_fail"
          ? "high_risk"
          : calves && calves.projectedSets - calves.mev <= 1.5
            ? "warning"
            : calves
              ? "pass"
              : "info",
      evidence: calves
        ? `projected=${calves.projectedSets} mev=${calves.mev}`
        : "candidate volume unavailable",
      notes: "watch recurring calves floor misses before acceptance",
    },
    {
      risk: "Side/rear delt thin margins",
      status: statusFromBooleans({
        warning: thinMargin(sideDelts) || thinMargin(rearDelts),
        pass: Boolean(sideDelts && rearDelts),
      }),
      severity:
        !sideDelts || !rearDelts
          ? "info"
          : thinMargin(sideDelts) || thinMargin(rearDelts)
            ? "warning"
            : "pass",
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
      severity: "info",
      evidence: "weekly-retro evidence not embedded in this candidate",
      notes: "review recent weekly retros for target-too-low/high patterns",
    },
    {
      risk: "reliance on runtime add-ons",
      status: "unknown",
      severity: "info",
      evidence: "weekly-retro runtime-addition evidence not embedded in this candidate",
      notes: "candidate should not depend on session-local add-ons to satisfy floors",
    },
    {
      risk: "target semantics friction",
      status: "pass",
      severity: "pass",
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
  const recurringFragility =
    (finalWeek?.status === "below_mev" || (finalWeek?.deltaToMev ?? 0) < 0) ||
    topUpWeeks.length > 0 ||
    belowMevRows.length > 0;
  const severity: CompletedBlockEvidenceRow["severity"] = implication.failure
    ? "high_risk"
    : recurringFragility && implication.warning
      ? "warning"
      : "info";
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
      hypothesis: recurringFragility
        ? `${input.muscle} may need planned floor margin instead of relying on late-block or session-local top-ups`
        : `${input.muscle} prior-block evidence does not show a recurring floor problem`,
      acceptanceImplication: implication.text,
      requiredFix: implication.failure
        ? `raise planned ${input.muscle} Week 1/block volume to at least MEV through the canonical volume-floor owner`
        : "none unless the persisted candidate repeats below-MEV or razor-thin floor exposure",
      severity,
      ownerSeam: "volume floors",
      smallestSafeFix: implication.failure
        ? `investigate candidate ${input.muscle} allocation and adjust the canonical planner/materializer owner before accepting`
        : "monitor in the gate/pre-session readout; do not implement planner behavior from prior evidence alone",
      mustFixBeforeWeek1: implication.failure,
    },
    failure: severity === "high_risk" && implication.failure,
    warning: severity === "warning" || implication.warning,
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
    ? "warning"
    : "info";
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
      hypothesis:
        "side/rear delt support may be too close to the floor when prior block margins were thin",
      requiredFix:
        sideCandidate.failure || rearCandidate.failure
          ? "fix candidate side/rear delt volume below MEV before Week 1"
          : "none unless the candidate projects below MEV; exact or thin margins become watch items",
      severity,
      ownerSeam: "volume floors",
      smallestSafeFix:
        sideCandidate.failure || rearCandidate.failure
          ? "investigate slot allocation for direct delt support before accepting"
          : "track as a watch item through pre-session volume/readiness checks",
      mustFixBeforeWeek1: sideCandidate.failure || rearCandidate.failure,
    },
    failure: false,
    warning:
      severity === "warning" &&
      (sideCandidate.failure ||
        sideCandidate.warning ||
        rearCandidate.failure ||
        rearCandidate.warning),
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
    hypothesis:
      totalAddedSets > 0
        ? "prior block needed operator/session-local work to close predictable dose gaps"
        : "no recurring runtime-addition dependency is visible",
    requiredFix:
      "none by itself; fix only when the persisted candidate repeats a real floor/cap/trainability failure",
    severity: weeks.length > 0 ? "warning" : "info",
    ownerSeam: "planner policy",
    smallestSafeFix:
      totalAddedSets > 0
        ? "investigate whether the candidate planned seed covers the same predictable floors before changing planner policy"
        : "no implementation required",
    mustFixBeforeWeek1: false,
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
    hypothesis:
      driftRows.length > 0
        ? "some Week 1 prescriptions may need extra confidence/readiness attention"
        : "loaded retros do not show prescription calibration pressure",
    requiredFix:
      "none unless Week 1 candidate prescriptions are low-confidence or contradicted by canonical progression anchors",
    severity: driftRows.length > 0 ? "warning" : "info",
    ownerSeam: "prescription/readout",
    smallestSafeFix:
      driftRows.length > 0
        ? "investigate prescription/readout confidence before changing load policy"
        : "no implementation required",
    mustFixBeforeWeek1: false,
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
    hypothesis:
      underTargetOnly > 0
        ? "productive target misses may be stretch-target or normal block-noise rather than trainability failures"
        : "target semantics evidence is clean in loaded retros",
    requiredFix:
      "none for below-target/above-MEV rows unless another hard floor, cap, or trainability failure is present",
    severity: underTargetOnly > 0 ? "info" : "pass",
    ownerSeam: "target semantics",
    smallestSafeFix:
      "do not implement planner changes for below-target/above-MEV evidence alone",
    mustFixBeforeWeek1: false,
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
  const hasCandidateFailure = chest.failure || calves.failure;
  const hasCandidateWarning = chest.warning || calves.warning;
  const severity: CompletedBlockEvidenceRow["severity"] = hasCandidateFailure
    ? "high_risk"
    : hasCandidateWarning
      ? "warning"
      : "info";
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
      hypothesis:
        topUpWeeks.length > 0
          ? "the next plan should not rely on optional gap-fill/top-up behavior for predictable priority floors"
          : "no optional gap-fill dependency is visible",
      requiredFix: hasCandidateFailure
        ? "fix candidate Chest/Calves below-MEV repeat before Week 1"
        : "none unless the persisted candidate repeats below-MEV priority floor exposure",
      severity,
      ownerSeam: "volume floors",
      smallestSafeFix: hasCandidateFailure
        ? "investigate candidate volume floors at the canonical planner/materializer owner"
        : "keep as watch/evidence; do not implement from prior top-up history alone",
      mustFixBeforeWeek1: hasCandidateFailure,
    },
    failure: hasCandidateFailure,
    warning: severity === "warning",
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
  repairBurden: RepairBurdenAssessment;
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
    v2.provenance.seedShapeCompatibility.compatible === true;
  const supportLaneBoundary = supportLaneBoundaryAssessment({
    preview: input.evidence.diagnosticPreview,
    candidateFound,
    weeklyRows: input.weeklyRows,
  });

  return REQUIRED_GATE_LABELS.map((gate) => {
    if (gate === "Candidate identity") {
      const pass = candidateFound && input.candidateKind !== "absent";
      return {
        gate,
        status: pass ? "pass" : "fail",
        severity: pass ? "pass" : "blocker",
        evidence: `candidate_found=${candidateFound ? "yes" : "no"} kind=${input.candidateKind}`,
        notes:
          input.candidateKind === "diagnostic_preview_only"
            ? "diagnostic previews are evidence only and cannot be accepted"
            : pass
              ? "persisted handoff candidate is inspectable without writes"
              : "rerun after handoff exists",
        ownerSeam: "candidate identity",
        smallestSafeFix:
          input.candidateKind === "diagnostic_preview_only"
            ? "wait for or create the real persisted handoff candidate through the explicit handoff flow; do not accept a diagnostic preview"
            : "rerun after the source reaches handoff and a persisted candidate exists",
        mustFixBeforeWeek1: true,
      };
    }

    if (gate === "Seed truth/runtime contract") {
      const status = statusFromBooleans({ pass: candidateFound && seedShapePass });
      return {
        gate,
        status,
        severity:
          status === "pass" ? "pass" : candidateFound ? "blocker" : "info",
        evidence: v2
          ? `serializer=${v2.boundaryFacts.seedSerializer} executable_shape=${v2.seedShapeComparison.executableFieldShape.classification}`
          : "v2 prepare-compare unavailable",
        notes: "runtime contract remains exerciseId/role/setCount only",
        ownerSeam: "seed/runtime contract",
        smallestSafeFix:
          status === "pass"
            ? "no implementation required"
            : "investigate seed serializer/runtime contract compatibility before accepting",
        mustFixBeforeWeek1: candidateFound && status !== "pass",
      };
    }

    if (gate === "Volume floors/zones") {
      const status =
        !candidateFound
          ? "unknown"
          : input.weeklyRows.length === 0
            ? "unknown"
            : volumeFailures.length > 0
              ? "fail"
              : "pass";
      return {
        gate,
        status,
        severity:
          status === "fail"
            ? "high_risk"
            : status === "pass"
              ? "pass"
              : "info",
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
        ownerSeam: "volume floors",
        smallestSafeFix:
          status === "fail"
            ? "fix candidate weekly volume at the canonical volume-floor/materializer owner before accepting"
            : "no implementation required for above-MEV/below-target rows",
        mustFixBeforeWeek1: status === "fail",
      };
    }

    if (gate === "Prior-block recurring risks") {
      const failures = input.completedBlockAssessment.candidateFailureRisks;
      const warnings = input.completedBlockAssessment.candidateWarningRisks;
      const status: NextMesocycleAcceptanceGateStatus =
        failures.length > 0
          ? "fail"
          : !candidateFound
            ? "unknown"
            : warnings.length > 0
              ? "warning"
              : "pass";
      return {
        gate,
        status,
        severity:
          failures.length > 0
            ? "high_risk"
            : warnings.length > 0
              ? "warning"
              : !candidateFound
                ? "info"
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
        ownerSeam: "audit/readout",
        smallestSafeFix:
          failures.length > 0
            ? "fix only the repeated candidate failure at its canonical owner; do not turn prior evidence into policy by itself"
            : "monitor warning rows; no planner implementation from prior-block evidence alone",
        mustFixBeforeWeek1: failures.length > 0,
      };
    }

    if (gate === "Slot/lane balance") {
      const status: NextMesocycleAcceptanceGateStatus =
        !candidateFound || coverageRows.length === 0
          ? "unknown"
          : coverageFailures.length > 0
            ? "fail"
            : "pass";
      return {
        gate,
        status,
        severity:
          status === "fail"
            ? "high_risk"
            : status === "pass"
              ? "pass"
              : "info",
        evidence:
          coverageFailures.length > 0
            ? coverageFailures.map((row) => row.item).join(", ")
            : coverageRows.length > 0
              ? `coverage_rows=${coverageRows.length}`
              : "coverage evidence unavailable",
        notes: "uses prepare-compare class/lane coverage, not runtime policy",
        ownerSeam: "slot allocation",
        smallestSafeFix:
          status === "fail"
            ? "investigate candidate slot allocation/coverage in the handoff preparation seam"
            : "no implementation required",
        mustFixBeforeWeek1: status === "fail",
      };
    }

    if (gate === "Exercise/materialization quality") {
      const repairBurdenWarning =
        input.repairBurden.repairBurden === "medium" ||
        input.repairBurden.repairBurden === "high" ||
        mostlyRepairShaped;
      const status: NextMesocycleAcceptanceGateStatus =
        candidateFound &&
        (!materializerPass || supportLaneBoundary.blockingRows.length > 0)
          ? "fail"
          : candidateFound &&
              (repairBurdenWarning || supportLaneBoundary.warningRows.length > 0)
            ? "warning"
            : candidateFound && materializerPass
              ? "pass"
              : "unknown";
      return {
        gate,
        status,
        severity:
          status === "fail"
            ? "high_risk"
            : status === "warning"
              ? "warning"
              : status === "pass"
                ? "pass"
                : "info",
        evidence: [
          v2
            ? `materializer=${v2.provenance.materializerStatus} seed_shape=${v2.provenance.seedShapeCompatibility.compatible ? "yes" : "no"} planning_shape=${input.planningShape ?? "unknown"}`
            : `planning_shape=${input.planningShape ?? "unknown"}`,
          `support_lane_boundary=${supportLaneBoundary.evidence}`,
        ].join(" "),
        notes:
          supportLaneBoundary.blockingRows.length > 0
            ? "authored support lane was budgeted but dropped before selection while the candidate remains below MEV"
            : supportLaneBoundary.warningRows.length > 0
              ? "authored support lane was budgeted but dropped; current candidate floor is not below MEV"
              : mostlyRepairShaped
                ? candidateFound
                  ? "repair-heavy candidate can be trainable but carries planner/materializer quality debt"
                  : "mostly repair-shaped preview is diagnostic evidence only"
                : "diagnostic preview evidence remains non-executable",
        ownerSeam:
          supportLaneBoundary.droppedRows.length > 0
            ? "materializer/exercise-selection capacity"
            : "materializer policy",
        smallestSafeFix:
          status === "fail"
            ? supportLaneBoundary.blockingRows.length > 0
              ? "preserve the authored support lane through the materializer/exercise-selection capacity owner before accepting"
              : "investigate materializer compatibility before accepting"
            : status === "warning"
              ? supportLaneBoundary.warningRows.length > 0
                ? "keep as a watch item; investigate narrow support-lane preservation without changing planner volume math"
                : "train only with watch items; investigate planner/materializer ownership debt separately"
              : "no implementation required",
        mustFixBeforeWeek1: status === "fail",
      };
    }

    if (gate === "Lifecycle/deload safety") {
      const status = input.blockers.length > 0 ? "fail" : "pass";
      return {
        gate,
        status,
        severity: status === "fail" ? "blocker" : "pass",
        evidence: input.blockers.join(", ") || "no lifecycle blockers found",
        notes: "source must be AWAITING_HANDOFF before acceptance gate is runnable",
        ownerSeam: "lifecycle/handoff",
        smallestSafeFix:
          status === "fail"
            ? "resolve lifecycle/handoff blockers before evaluating acceptance"
            : "no implementation required",
        mustFixBeforeWeek1: status === "fail",
      };
    }

    const seedShapeCompatible =
      v2?.provenance.seedShapeCompatibility.compatible === true;
    const status = weekOneTrainabilityStatus({
      candidateFound,
      baseValidationStatus: v2?.provenance.baseValidationStatus,
      seedShapeCompatible,
    });
    return {
      gate,
      status,
      severity:
        status === "pass"
          ? "pass"
          : status === "warning"
            ? "warning"
            : candidateFound
              ? "high_risk"
              : "info",
      evidence: v2
        ? weekOneTrainabilityEvidence({
            baseValidationStatus: v2.provenance.baseValidationStatus,
            seedShapeCompatible,
            status,
          })
        : "candidate trainability evidence unavailable",
      notes:
        status === "warning"
          ? "base validation warnings are watch items when seed shape is compatible; full runtime replay is verified post-accept"
          : "Week 1 must be trainable from persisted candidate evidence",
      ownerSeam: "prescription/readout",
      smallestSafeFix:
        status === "pass"
          ? "no implementation required"
          : status === "warning"
            ? "run post-accept verification before training Week 1; investigate warning owners separately"
            : "investigate base validation and Week 1 prescription readiness before accepting",
      mustFixBeforeWeek1: candidateFound && status === "fail",
    };
  });
}

function buildDecisionSummary(input: {
  candidateFound: boolean;
  gates: NextMesocycleAcceptanceGatePayload["gates"];
  repairBurden: RepairBurdenAssessment;
}): NextMesocycleAcceptanceGatePayload["decisionSummary"] {
  const weekOneGate = input.gates.find(
    (gate) => gate.gate === "Week 1 trainability",
  );
  const materializerGate = input.gates.find(
    (gate) => gate.gate === "Exercise/materialization quality",
  );
  const trainability =
    weekOneGate?.status === "pass"
      ? "pass"
      : input.candidateFound && weekOneGate?.status === "warning"
        ? "warning"
        : "fail";
  const plannerMaterializerQuality =
    materializerGate?.status === "fail"
      ? "fail"
      : materializerGate?.status === "warning" ||
          input.repairBurden.repairBurden === "medium" ||
          input.repairBurden.repairBurden === "high"
        ? "warning"
        : "pass";

  return {
    trainability,
    plannerMaterializerQuality,
    repairBurden: input.repairBurden.repairBurden,
    repairBurdenEvidence: input.repairBurden.repairBurdenEvidence,
  };
}

function buildWatchItems(input: {
  candidateFound: boolean;
  weeklyRows: NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"];
  completedBlockRows: CompletedBlockEvidenceRow[];
  gates: NextMesocycleAcceptanceGatePayload["gates"];
  repairBurden: RepairBurdenAssessment;
}): NextMesocycleAcceptanceGatePayload["watchItems"] {
  if (!input.candidateFound) {
    return [];
  }

  const completedRisks = new Set(
    input.completedBlockRows
      .filter((row) => row.severity === "warning" || row.severity === "high_risk")
      .map((row) => row.risk),
  );
  const watchItems: NextMesocycleAcceptanceGatePayload["watchItems"] = [];
  const maybeFloorWatch = (muscle: "Chest" | "Calves") => {
    const row = input.weeklyRows.find((entry) => entry.muscle === muscle);
    if (!row || row.projectedSets < row.mev || row.projectedSets - row.mev > 1.5) {
      return;
    }
    const priorRisk =
      muscle === "Chest" ? "Chest MEV fragility" : "Calf MEV fragility";
    if (!completedRisks.has(priorRisk)) {
      return;
    }
    watchItems.push({
      risk: `${muscle} floor margin`,
      whyItMatters: `prior block showed ${muscle} MEV fragility; candidate only clears the floor at ${formatGateNumber(row.projectedSets)}/${formatGateNumber(row.mev)}`,
      monitoringPlan: `watch ${muscle} projected volume in Week 1 pre-session readiness and avoid relying on final-session top-up`,
    });
  };

  maybeFloorWatch("Chest");
  maybeFloorWatch("Calves");

  for (const row of input.weeklyRows.filter(
    (entry) =>
      (entry.muscle === "Side Delts" || entry.muscle === "Rear Delts") &&
      entry.projectedSets >= entry.mev &&
      entry.projectedSets - entry.mev <= 1.5,
  )) {
    watchItems.push({
      risk: `${row.muscle} thin margin`,
      whyItMatters: `${row.muscle} is close to MEV after prior delt margin evidence`,
      monitoringPlan:
        "watch direct delt exposure in Upper A/B pre-session readiness before adding work",
    });
  }

  if (
    input.repairBurden.repairBurden === "medium" ||
    input.repairBurden.repairBurden === "high"
  ) {
    watchItems.push({
      risk: "Repair burden",
      whyItMatters:
        "candidate appears trainable, but the planner/materializer still shows ownership debt",
      monitoringPlan:
        "train from the persisted candidate only if Week 1 checks stay coherent; investigate planner quality separately",
    });
  }

  if (
    input.completedBlockRows.some(
      (row) => row.risk === "Load calibration drift" && row.severity === "warning",
    )
  ) {
    watchItems.push({
      risk: "Week 1 prescription confidence",
      whyItMatters:
        "prior block had load calibration drift that can make first-week prescriptions lower confidence",
      monitoringPlan:
        "watch Week 1 load/reps/RPE confidence in pre-session readiness; do not mutate loads from this gate",
    });
  }

  const weekOneGate = input.gates.find(
    (gate) => gate.gate === "Week 1 trainability",
  );
  if (weekOneGate?.status === "warning") {
    watchItems.push({
      risk: "Post-accept Week 1 verification",
      whyItMatters:
        "pre-accept candidate evidence has non-blocking base validation warnings, and full runtime replay proof requires a persisted successor",
      monitoringPlan:
        "run next-mesocycle-post-accept-verification after explicit accept and before training Week 1",
    });
  }

  return watchItems;
}

function buildGateFindings(
  gates: NextMesocycleAcceptanceGatePayload["gates"],
): NextMesocycleAcceptanceGateRemediation[] {
  return gates
    .filter(
      (gate) => gate.status !== "pass" && isActionableSeverity(gate.severity),
    )
    .map((gate) => ({
      finding: gate.gate,
      severity: gate.severity,
      ownerSeam: gate.ownerSeam,
      smallestSafeFix: gate.smallestSafeFix,
      mustFixBeforeWeek1: gate.mustFixBeforeWeek1,
      evidence: gate.evidence,
    }));
}

function buildCompletedBlockFindings(
  rows: CompletedBlockEvidenceRow[],
): NextMesocycleAcceptanceGateRemediation[] {
  return rows
    .filter((row) => isActionableSeverity(row.severity))
    .map((row) => ({
      finding: row.risk,
      severity: row.severity,
      ownerSeam: row.ownerSeam,
      smallestSafeFix: row.smallestSafeFix,
      mustFixBeforeWeek1: row.mustFixBeforeWeek1,
      evidence: row.evidence,
    }));
}

function buildDoNotFixNotes(): NextMesocycleAcceptanceGatePayload["doNotFixNotes"] {
  return [
    {
      item: "below target but above MEV",
      reason:
        "productive target misses are informational unless another floor/cap/trainability failure is present",
    },
    {
      item: "stretch-target miss",
      reason: "stretch targets are not hard acceptance quotas",
    },
    {
      item: "one-off weekly noise",
      reason:
        "completed-block evidence becomes a required fix only when the persisted candidate repeats a real failure",
    },
    {
      item: "diagnostic preview failure before candidate exists",
      reason: "preview evidence cannot be accepted or rejected as the candidate",
    },
    {
      item: "cosmetic output issue",
      reason:
        "formatting/readout polish should not trigger planner/materializer implementation",
    },
  ];
}

function deriveGateResult(input: {
  candidateFound: boolean;
  candidateKind: NextMesocycleAcceptanceGatePayload["candidateIdentity"]["candidateKind"];
  blockers: string[];
  findings: NextMesocycleAcceptanceGateRemediation[];
  watchItems: NextMesocycleAcceptanceGatePayload["watchItems"];
}): NextMesocycleAcceptanceGatePayload["gateResult"] {
  if (
    !input.candidateFound ||
    input.candidateKind === "absent" ||
    input.candidateKind === "diagnostic_preview_only" ||
    input.blockers.length > 0
  ) {
    return "not_runnable";
  }
  if (
    input.findings.some(
      (finding) =>
        finding.mustFixBeforeWeek1 &&
        (finding.severity === "blocker" || finding.severity === "high_risk"),
    )
  ) {
    return "rejected";
  }
  if (
    input.watchItems.length > 0 ||
    input.findings.some((finding) => finding.severity === "warning")
  ) {
    return "accepted_with_watch_items";
  }
  return "accepted";
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
  const repairBurden = repairBurdenFromPreview(evidence.diagnosticPreview);
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
    repairBurden,
  });
  const watchItems = buildWatchItems({
    candidateFound,
    weeklyRows,
    completedBlockRows: completedBlockAssessment.rows,
    gates,
    repairBurden,
  });
  const findings = [
    ...buildGateFindings(gates),
    ...buildCompletedBlockFindings(completedBlockAssessment.rows),
  ];
  const gateResult = deriveGateResult({
    candidateFound,
    candidateKind,
    blockers,
    findings,
    watchItems,
  });
  const decisionSummary = buildDecisionSummary({
    candidateFound,
    gates,
    repairBurden,
  });
  const why =
    gateResult === "not_runnable"
      ? blockers.length > 0
        ? blockers
        : ["no runnable persisted handoff candidate"]
      : gateResult === "rejected"
        ? findings
            .filter((finding) => finding.mustFixBeforeWeek1)
            .map((finding) => `${finding.finding}: ${finding.evidence}`)
        : gateResult === "accepted_with_watch_items"
          ? watchItems.map((item) => `${item.risk}: ${item.whyItMatters}`)
          : ["all read-only acceptance gates passed"];

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
      gateResult === "not_runnable"
        ? "rerun after handoff exists"
        : gateResult === "accepted"
          ? "candidate passes the read-only gate"
          : gateResult === "accepted_with_watch_items"
            ? "candidate is trainable as-is, but monitor watch items through pre-session checks"
            : "fix must-fix findings before Week 1; do not silently repair from this gate",
    decisionSummary,
    candidateIdentity: {
      ...(evidence.ownerEmail ? { ownerEmail: evidence.ownerEmail } : {}),
      sourceMesocycleId: evidence.sourceMesocycleId,
      sourceState: source?.state ?? null,
      candidateKind,
      ...(candidateFound
        ? {
            candidateSeedSource:
              evidence.v2PrepareCompare?.provenance.legacySourceLabel ?? null,
          }
        : {}),
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
    watchItems,
    findings,
    doNotFixNotes: buildDoNotFixNotes(),
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

async function loadPersistedDraftCandidateVolumeRows(input: {
  sourceMesocycle: SourceMesocycleState | null;
  reader: AcceptanceGateReader;
  diagnosticPreview: MesocycleExplainAuditPayload | undefined;
}): Promise<CandidateVolumeInput[] | undefined> {
  const seed =
    readNextCycleSeedDraft(input.sourceMesocycle?.nextSeedDraftJson)
      ?.acceptedSeedDraft?.slotPlanSeedJson ?? null;
  if (!seed) {
    return undefined;
  }
  const candidateMuscles =
    input.diagnosticPreview?.plannerOnlyNoRepair?.weeklyMuscleTotals.map(
      (row) => row.muscle,
    ) ?? [];
  if (candidateMuscles.length === 0) {
    return undefined;
  }

  const exerciseIds = Array.from(
    new Set(
      seed.slots.flatMap((slot) =>
        slot.exercises.map((exercise) => exercise.exerciseId),
      ),
    ),
  );
  if (exerciseIds.length === 0) {
    return buildCandidateVolumeRowsFromSlotPlanSeed({
      seed,
      exercises: [],
      muscles: candidateMuscles,
    });
  }

  const exercises = await input.reader.exercise.findMany({
    where: { id: { in: exerciseIds } },
    select: {
      id: true,
      name: true,
      aliases: { select: { alias: true } },
      exerciseMuscles: {
        select: {
          role: true,
          muscle: { select: { name: true } },
        },
      },
    },
  });

  return buildCandidateVolumeRowsFromSlotPlanSeed({
    seed,
    exercises,
    muscles: candidateMuscles,
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
  const [
    successorMesocycle,
    incompleteWorkouts,
    completedBlockRetros,
    persistedDraftCandidateVolumeRows,
  ] =
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
      loadPersistedDraftCandidateVolumeRows({
        sourceMesocycle,
        reader,
        diagnosticPreview,
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
    candidateVolumeRows: persistedDraftCandidateVolumeRows,
  });
}
