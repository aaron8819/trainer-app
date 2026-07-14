import type {
  PrescriptionConfidenceReadout,
  SessionGenerationResult,
} from "@/lib/api/template-session/types";
import {
  PRE_SESSION_READINESS_CONTRACT_OWNER_SEAM,
  type PreSessionReadinessCoachingRecommendation,
  type PreSessionReadinessConsistencyCheck,
  type PreSessionReadinessContract,
  type PreSessionReadinessPrescriptionConfidenceWatchRow,
  type PreSessionReadinessWorkoutPreview,
} from "./pre-session-readiness-contract";
import type {
  PreSessionReadinessContractBuildInput,
  PreSessionReadinessEvidence,
  PreSessionReadinessProjectedWeekEvidence,
} from "./pre-session-readiness-evidence";
import type { NextWorkoutContext } from "@/lib/api/next-session";
import type { AcceptedMesocycleSeedProvenanceConsistency } from "@/lib/api/accepted-mesocycle-seed-provenance";
import type { SessionAuditSnapshot } from "@/lib/evidence/session-audit-types";
import type { WeeklyMuscleClosureDecision } from "./weekly-volume-closure";

type PreSessionDoseDiagnostic = NonNullable<
  PreSessionReadinessProjectedWeekEvidence["runtimeDoseAdjustmentDiagnostics"]
>[number];
type ProjectedWeekSession =
  PreSessionReadinessProjectedWeekEvidence["projectedSessions"][number];
type GeneratedSession = NonNullable<SessionAuditSnapshot["generated"]>;
type GeneratedExercise = GeneratedSession["exercises"][number];
type GeneratedSet = GeneratedExercise["prescribedSets"][number];
type PrescriptionReadoutFields = Pick<
  PreSessionReadinessPrescriptionConfidenceWatchRow,
  | "targetLoad"
  | "targetReps"
  | "repRange"
  | "targetRpe"
  | "targetRir"
  | "loadSource"
  | "loadConfidence"
  | "cautionLevel"
  | "cautionReason"
  | "adjustmentRangeBasis"
  | "suggestedAdjustmentRange"
>;

const UPPER_BODY_MUSCLES = new Set([
  "Chest",
  "Lats",
  "Upper Back",
  "Side Delts",
  "Rear Delts",
  "Biceps",
  "Triceps",
]);
const LOWER_BODY_MUSCLES = new Set([
  "Quads",
  "Hamstrings",
  "Glutes",
  "Calves",
  "Adductors",
  "Abductors",
  "Lower Back",
]);
const TARGET_TIER_MEANINGFUL = new Set(["A_PRIMARY", "B_SUPPORT"]);

function formatAuditDecimal(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function getMuscleRegion(muscle: string): "upper" | "lower" | null {
  if (UPPER_BODY_MUSCLES.has(muscle)) {
    return "upper";
  }
  if (LOWER_BODY_MUSCLES.has(muscle)) {
    return "lower";
  }
  return null;
}

function sessionMatchesRegion(
  session: ProjectedWeekSession | undefined,
  region: "upper" | "lower"
): boolean {
  if (!session) {
    return false;
  }
  const label = `${session.slotId ?? ""} ${session.intent ?? ""}`.toLowerCase();
  if (label.includes("full_body")) {
    return true;
  }
  if (region === "upper") {
    return (
      label.includes("upper") ||
      label.includes("push") ||
      label.includes("pull")
    );
  }
  return label.includes("lower") || label.includes("legs");
}

function getDoseClosureAddonCaveat(muscle: string): string {
  if (muscle === "Calves") {
    return "if calves/Achilles/feet feel good";
  }
  if (muscle === "Triceps") {
    return "if readiness/time/elbows are good";
  }
  return "if readiness/time allow";
}

function getSuppressionAction(muscle: string): string {
  if (muscle === "Biceps") {
    return "no extra curls";
  }
  if (muscle === "Side Delts") {
    return "no extra lateral raises";
  }
  if (muscle === "Rear Delts") {
    return "no extra rear-delt work";
  }
  if (muscle === "Lats") {
    return "no extra pulldowns";
  }
  if (muscle === "Upper Back") {
    return "no extra rows";
  }
  return "seed only";
}

function formatMevProjection(input: {
  effectiveSets: number;
  mev: number;
}): string {
  return `projected ${formatAuditDecimal(input.effectiveSets)} / MEV ${formatAuditDecimal(input.mev)}`;
}

function formatWeightedSetGap(value: number): string {
  return `${formatAuditDecimal(Math.max(0, value))} weighted sets`;
}

function formatRawSetCount(value: number): string {
  return `${value} raw ${value === 1 ? "set" : "sets"}`;
}

function formatPreviewNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatPreviewRepTarget(
  set: GeneratedSet | undefined
): string {
  if (!set) {
    return "-- reps";
  }
  const range = set.targetRepRange;
  if (range) {
    return range.min === range.max
      ? `${range.min} reps`
      : `${range.min}-${range.max} reps`;
  }
  return typeof set.targetReps === "number" && Number.isFinite(set.targetReps)
    ? `${set.targetReps} reps`
    : "-- reps";
}

function formatCommonLoadLabel(
  sets: GeneratedExercise["prescribedSets"]
): string | null {
  const loads = sets
    .map((set) => set.targetLoad)
    .filter((load): load is number => typeof load === "number" && Number.isFinite(load) && load >= 0);
  if (loads.length !== sets.length || loads.length === 0) {
    return null;
  }
  const [first] = loads;
  return loads.every((load) => load === first)
    ? `${formatPreviewNumber(first)} lb`
    : null;
}

function formatRpeValues(values: number[]): string | null {
  const unique = Array.from(new Set(values)).sort((left, right) => left - right);
  if (unique.length === 0) {
    return null;
  }
  if (unique.length === 1) {
    return `RPE ${formatPreviewNumber(unique[0])}`;
  }
  return `RPE ${formatPreviewNumber(unique[0])}-${formatPreviewNumber(unique[unique.length - 1])}`;
}

function buildWorkoutPreview(
  generated: GeneratedSession | undefined
): PreSessionReadinessWorkoutPreview | undefined {
  if (!generated?.exercises?.length) {
    return undefined;
  }

  const exercises = generated.exercises
    .slice()
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((exercise) => {
      const prescribedSets = exercise.prescribedSets ?? [];
      const targetRpeLabel = formatRpeValues(
        prescribedSets
          .map((set) => set.targetRpe)
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      );

      return {
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName,
        setCount: exercise.prescribedSetCount,
        repTargetLabel: formatPreviewRepTarget(prescribedSets[0]),
        targetLoadLabel: formatCommonLoadLabel(prescribedSets),
        targetRpeLabel,
      };
    });
  const targetRpeLabel = formatRpeValues(
    generated.exercises.flatMap((exercise) =>
      exercise.prescribedSets
        .map((set) => set.targetRpe)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    )
  );

  return {
    source: "generated_session_audit_snapshot",
    exercises,
    targetRpeLabel,
  };
}

function buildClosureRecommendation(
  decision: WeeklyMuscleClosureDecision
): PreSessionReadinessCoachingRecommendation | null {
  const candidate = decision.recommendation;
  if (decision.status !== "eligible" || !candidate) {
    return null;
  }
  const kind = decision.evidence.deficitToMev <= 1.25 ? "optional" : "priority";
  const projection = formatMevProjection({
    effectiveSets: decision.evidence.projectedWeekEffectiveSets,
    mev: decision.evidence.mev,
  });
  const line = `- ${decision.muscle}: ${projection}; gap ${formatWeightedSetGap(decision.evidence.deficitToMev)}. Candidate: ${candidate.exerciseName}. Recommended: +${formatRawSetCount(candidate.additionalSets)} ${getDoseClosureAddonCaveat(decision.muscle)}. Expected contribution: ~${formatAuditDecimal(candidate.projectedContribution)} weighted sets (${formatAuditDecimal(candidate.effectiveSetsPerRawSet)} per raw set).`;

  return {
    kind,
    muscle: decision.muscle,
    targetMuscle: decision.muscle,
    candidateExerciseName: candidate.exerciseName,
    line,
    addonLine: `- Add +${formatRawSetCount(candidate.additionalSets)} of ${candidate.exerciseName} ${getDoseClosureAddonCaveat(decision.muscle)}.`,
    suppressed: false,
    suppressionReasons: [],
  };
}

function buildDoseClosure(input: {
  isActiveDeload: boolean;
  diagnostics: PreSessionDoseDiagnostic[];
  fullWeekRows: PreSessionReadinessProjectedWeekEvidence["fullWeekByMuscle"];
}): PreSessionReadinessContract["doseClosure"] {
  if (input.isActiveDeload) {
    return {
      heading: "Dose Closure Guidance (Deload Context)",
      priority: ["- none - deload volume deficits are expected/non-actionable."],
      optional: ["- none"],
      monitor: [],
      suppress: ["- all hypertrophy add-set / MEV closure top-ups during ACTIVE_DELOAD."],
      guardrails: [
        "- run the deload prescription as generated unless a real blocker appears",
        "- no hypertrophy add-ons or MEV closure work during deload",
        "- no seed/runtime/save/progression mutation",
      ],
      decisions: input.diagnostics.map((diagnostic) => diagnostic.closureDecision),
      recommendations: [],
    };
  }

  const decisions = input.diagnostics
    .map((diagnostic) => diagnostic.closureDecision)
    .filter(
      (decision): decision is WeeklyMuscleClosureDecision => decision != null
    );
  const rowByMuscle = new Map(
    input.fullWeekRows.map((row) => [row.muscle, row])
  );
  const relevantDecisions = decisions
    .filter((decision) =>
      TARGET_TIER_MEANINGFUL.has(rowByMuscle.get(decision.muscle)?.targetTier ?? "")
    )
    .filter(
      (decision) =>
        decision.evidence.projectedCurrentSessionEffectiveSets > 0 ||
        decision.status === "eligible" ||
        decision.status === "no_valid_candidate"
    )
    .sort((left, right) => {
      return (
        right.evidence.deficitToMev - left.evidence.deficitToMev ||
        left.muscle.localeCompare(right.muscle)
      );
    });
  const priority: string[] = [];
  const optional: string[] = [];
  const monitor: string[] = [];
  const suppress: string[] = [];
  const recommendations: PreSessionReadinessCoachingRecommendation[] = [];

  for (const decision of relevantDecisions) {
    const projection = formatMevProjection({
      effectiveSets: decision.evidence.projectedWeekEffectiveSets,
      mev: decision.evidence.mev,
    });

    if (decision.status === "eligible") {
      const recommendation = buildClosureRecommendation(decision);
      if (!recommendation) {
        monitor.push(`- ${decision.muscle}: ${projection}. Eligible closure decision is missing its candidate; hold seed.`);
      } else if (recommendation.kind === "priority") {
        priority.push(recommendation.line);
      } else {
        optional.push(recommendation.line);
      }
      if (recommendation) {
        recommendations.push(recommendation);
      }
      continue;
    }

    if (decision.status === "not_final_opportunity") {
      const later = decision.opportunity.laterContributingSlots
        .map((slot) => `${slot.slotId ?? "later slot"} (${formatAuditDecimal(slot.projectedContribution)})`)
        .join(", ");
      monitor.push(`- ${decision.muscle}: ${projection}. Hold seed now; target-specific later contribution remains at ${later}.`);
      continue;
    }

    if (decision.status === "suppressed") {
      suppress.push(`- ${decision.muscle}: closure suppressed (${decision.constraints.reasons.join(", ") || "hard suppression"}); hold seed.`);
      continue;
    }

    if (decision.status === "no_valid_candidate") {
      const filtered = decision.constraints.candidateFilterReasons
        .map(
          (candidate) =>
            `${candidate.exerciseName} (${candidate.reasons.join(", ")})`
        )
        .join("; ");
      monitor.push(`- ${decision.muscle}: ${projection}. Final target opportunity, but no candidate satisfies the active movement and collateral constraints; hold seed.${filtered ? ` Filtered: ${filtered}.` : ""}`);
      continue;
    }

    const relation =
      decision.evidence.projectedWeekEffectiveSets === decision.evidence.mev
        ? "at MEV after seed"
        : "projected above MEV after seed";
    suppress.push(`- ${decision.muscle}: ${relation}; ${getSuppressionAction(decision.muscle)}.`);
  }

  const pullRestricted = relevantDecisions.some(
    (decision) =>
      decision.constraints.forbiddenMovementClasses.includes("horizontal_pull") &&
      decision.constraints.forbiddenMovementClasses.includes("vertical_pull")
  );
  const guardrails = [
    "- session-local only; no seed/runtime/save/progression mutation",
    "- use only the exact eligible candidate; do not substitute another movement",
    "- do not add extra pressing",
    ...(pullRestricted ? ["- do not add extra rows/pulldowns"] : []),
    "- do not chase full target deficit",
    "- avoid exceeding MAV/MRV; accept the miss if closure requires excessive raw volume",
  ];

  return {
    heading: "Dose Closure Guidance",
    priority: priority.length > 0 ? priority : ["- none"],
    optional: optional.length > 0 ? optional : ["- none"],
    monitor,
    suppress: suppress.length > 0 ? suppress.slice(0, 8) : ["- none"],
    guardrails,
    decisions,
    recommendations,
  };
}

function formatDoseAction(
  action: PreSessionDoseDiagnostic["recommendedAction"],
  diagnostic?: PreSessionDoseDiagnostic
): string {
  if (action.kind === "hold_seed") {
    if (
      diagnostic?.targetStatus === "below_preferred" ||
      diagnostic?.targetStatus === "stretch_miss"
    ) {
      return "monitor, no default add-on";
    }
    if (diagnostic?.targetStatus === "near_mav") {
      return "hold seed; near MAV cap";
    }
    if (diagnostic?.targetStatus === "over_mav") {
      return "hold seed; over MAV caution";
    }
    if (diagnostic?.reasonCode === "no_candidate_hold_seed") {
      return "hold seed; no viable add-on";
    }
    return "hold seed";
  }
  if (action.kind === "optional_add_set") {
    return `optional +1 ${action.exerciseName ?? "set"}`;
  }
  if (action.kind === "add_set") {
    return `consider +1 ${action.exerciseName ?? "set"}`;
  }
  if (action.kind === "reduce_set_if_fatigue_meaningful") {
    return `reduce -1 ${action.exerciseName ?? "set"} if fatigue meaningful`;
  }
  if (action.kind === "avoid_default_reduction") {
    return "avoid default reduction";
  }
  return action.kind;
}

function formatDoseStatus(diagnostic: PreSessionDoseDiagnostic): string {
  const end = diagnostic.projectedEndOfWeekVolume;
  return `${formatAuditDecimal(end.effectiveSets)} vs MEV ${formatAuditDecimal(end.mev)} / target ${formatAuditDecimal(end.weeklyTarget)} / MAV ${formatAuditDecimal(end.mav)}`;
}

function buildProjectedWeekStatus(input: {
  isActiveDeload: boolean;
  projectedWeek: PreSessionReadinessProjectedWeekEvidence | undefined;
  doseDiagnostics: PreSessionDoseDiagnostic[];
  startable: boolean;
  hasAvailableAddOns: boolean;
}): PreSessionReadinessContract["projectedWeekStatus"] {
  const doseGuidanceRows = input.doseDiagnostics.map((diagnostic) => {
    const status = input.isActiveDeload
      ? `deload_non_actionable:${diagnostic.targetStatus}`
      : diagnostic.targetStatus;
    const recommendedAction = input.isActiveDeload
      ? "deload context: non-actionable; do not top up"
      : formatDoseAction(diagnostic.recommendedAction, diagnostic);
    return {
      muscle: diagnostic.muscle,
      projectedVsTargets: formatDoseStatus(diagnostic),
      status,
      recommendedAction,
      confidence: formatAuditDecimal(diagnostic.confidence),
      line: `${diagnostic.muscle} | ${formatDoseStatus(diagnostic)} | ${status} | ${recommendedAction} | ${formatAuditDecimal(diagnostic.confidence)}`,
    };
  });
  const belowMev = input.projectedWeek?.currentWeekAudit?.belowMEV ?? [];
  const overMav = input.projectedWeek?.currentWeekAudit?.overMAV ?? [];
  const fatigueRisks = input.projectedWeek?.currentWeekAudit?.fatigueRisks ?? [];
  const projectionNotes = input.projectedWeek?.projectionNotes ?? [];
  const status = !input.startable
    ? "blocked"
    : input.isActiveDeload
      ? "deload_non_actionable"
      : input.hasAvailableAddOns
        ? "top_up_candidate"
        : belowMev.length > 0 || overMav.length > 0 || fatigueRisks.length > 0
          ? "watch"
          : "no_further_action";

  return {
    status,
    currentWeek: input.projectedWeek?.currentWeek.week ?? null,
    phase: input.projectedWeek?.currentWeek.phase ?? null,
    belowMev,
    overMav,
    fatigueRisks,
    projectionNotes,
    doseGuidanceRows,
    ...(status === "no_further_action"
      ? {
          noAddOnReason:
            "Projected week status is no_further_action; no optional add-ons are recommended.",
        }
      : {}),
  };
}

function buildAvoidList(input: {
  decisions: WeeklyMuscleClosureDecision[];
  sessionRisks: NonNullable<PreSessionReadinessProjectedWeekEvidence["sessionRisks"]>;
  nextSession: ProjectedWeekSession | undefined;
  recommendations: PreSessionReadinessCoachingRecommendation[];
}): string[] {
  const avoid = new Set<string>();
  const activeRecommendations = input.recommendations.filter(
    (recommendation) => !recommendation.suppressed
  );

  if (
    activeRecommendations.length > 0 &&
    input.decisions.some((decision) =>
      decision.constraints.forbiddenMovementClasses.some(
        (movementClass) =>
          movementClass === "horizontal_push" || movementClass === "vertical_push"
      )
    )
  ) {
    avoid.add("extra pressing");
  }
  if (
    input.decisions.some(
      (decision) =>
        decision.constraints.forbiddenMovementClasses.includes("horizontal_pull") &&
        decision.constraints.forbiddenMovementClasses.includes("vertical_pull")
    )
  ) {
    avoid.add("extra rows/pulldowns");
  }

  for (const decision of input.decisions) {
    if (decision.constraints.hardSuppressed) {
      avoid.add(`extra ${decision.muscle}`);
    }
  }
  for (const risk of input.sessionRisks) {
    avoid.add(`${risk.slotId}: ${risk.issue}`);
  }
  const region = getMuscleRegion(activeRecommendations[0]?.muscle ?? "");
  if (
    region === "lower" ||
    (activeRecommendations.length > 0 && sessionMatchesRegion(input.nextSession, "lower"))
  ) {
    avoid.add("upper-body work");
    avoid.add("extra hinge");
  }

  return Array.from(avoid);
}

function buildPrescriptionConfidenceWatches(
  generated: SessionAuditSnapshot["generated"] | undefined,
  prescriptionReadouts: PrescriptionConfidenceReadout[] | undefined
): PreSessionReadinessPrescriptionConfidenceWatchRow[] {
  const readoutsByExerciseId = new Map(
    (prescriptionReadouts ?? []).map((readout) => [readout.exerciseId, readout])
  );

  return (generated?.exercises ?? []).flatMap<PreSessionReadinessPrescriptionConfidenceWatchRow>((exercise) => {
    const trace = generated?.traces.progression[exercise.exerciseId];
    const readout = readoutsByExerciseId.get(exercise.exerciseId);
    const readoutFields = buildPrescriptionReadoutFields(readout);
    if (!trace) {
      return [
        {
          exerciseLabel: exercise.exerciseName,
          watchType: "prescription_confidence",
          reasonCode: "progression_trace_unavailable",
          displayActionCode: "use_target_as_starting_point",
          severity: "warning",
          source: "generated_progression_trace",
          ...readoutFields,
        },
      ];
    }
    const confidence = trace.confidence.combinedScale;
    const reasons = trace.confidence.reasons.slice(0, 2);
    const hasEstimateOrLowSignal = reasons.some(
      (reason) =>
        reason.toLowerCase().includes("estimate") ||
        reason.toLowerCase().includes("low")
    );
    const hasLoadCalibrationSignal = reasons.some((reason) => {
      const normalized = reason.toLowerCase();
      return (
        normalized.includes("calibration") ||
        normalized.includes("equipment") ||
        normalized.includes("machine") ||
        normalized.includes("cable")
      );
    });
    if (
      confidence < 0.75 ||
      trace.outcome.action === "decrease" ||
      hasEstimateOrLowSignal ||
      hasLoadCalibrationSignal
    ) {
      const reasonCode =
        trace.outcome.action === "decrease"
          ? "decrease_recommended"
          : hasLoadCalibrationSignal
            ? "load_calibration"
            : hasEstimateOrLowSignal
              ? "estimate_or_low_signal"
              : "low_confidence";
      const displayActionCode =
        hasLoadCalibrationSignal
          ? "machine_or_cable_target_may_need_calibration"
          : trace.outcome.action === "hold"
            ? "hold_target_load"
            : "calibrate_from_first_working_set";

      return [
        {
          exerciseLabel: exercise.exerciseName,
          watchType: "prescription_confidence",
          reasonCode,
          displayActionCode,
          severity: confidence < 0.75 ? "warning" : "info",
          confidence,
          source: "generated_progression_trace",
          ...readoutFields,
        },
      ];
    }
    return [];
  });
}

function buildPrescriptionReadoutFields(
  readout: PrescriptionConfidenceReadout | undefined
): Partial<PrescriptionReadoutFields> {
  if (!readout) {
    return {};
  }

  const suggestedAdjustmentRange = readout.suggestedAdjustmentRange
    ? {
        minLoad: readout.suggestedAdjustmentRange.minLoad,
        maxLoad: readout.suggestedAdjustmentRange.maxLoad,
        unit: readout.suggestedAdjustmentRange.unit,
        basis: readout.suggestedAdjustmentRange.basis,
      }
    : null;
  const hasTargetLoad =
    typeof readout.targetLoad === "number" && Number.isFinite(readout.targetLoad);

  return {
    targetLoad: readout.targetLoad,
    targetReps: readout.targetReps,
    repRange: readout.repRange
      ? { min: readout.repRange.min, max: readout.repRange.max }
      : null,
    targetRpe: readout.targetRpe,
    targetRir: readout.targetRir,
    loadSource: readout.loadSource,
    loadConfidence: readout.confidence,
    cautionLevel: readout.cautionLevel,
    cautionReason: readout.cautionReason,
    adjustmentRangeBasis: suggestedAdjustmentRange
      ? "exact_range"
      : hasTargetLoad
        ? "target_load_start"
        : "not_available",
    suggestedAdjustmentRange,
  };
}

function formatPrescriptionConfidenceWatchMessage(
  row: PreSessionReadinessPrescriptionConfidenceWatchRow
): string {
  if (row.suggestedAdjustmentRange) {
    const target =
      row.targetLoad == null
        ? "the written target"
        : `${formatPreviewNumber(row.targetLoad)} lb`;
    return `- ${row.exerciseLabel}: start at ${target}; use ${formatPreviewNumber(row.suggestedAdjustmentRange.minLoad)}-${formatPreviewNumber(row.suggestedAdjustmentRange.maxLoad)} ${row.suggestedAdjustmentRange.unit} if first-set reps or RPE are off.`;
  }

  const targetLoad =
    typeof row.targetLoad === "number" && Number.isFinite(row.targetLoad)
      ? `${formatPreviewNumber(row.targetLoad)} lb`
      : null;

  switch (row.displayActionCode) {
    case "use_target_as_starting_point":
      return targetLoad
        ? `- ${row.exerciseLabel}: start at ${targetLoad}; adjust by feel.`
        : `- ${row.exerciseLabel}: use the target as a starting point; adjust by feel.`;
    case "hold_target_load":
      return targetLoad
        ? `- ${row.exerciseLabel}: start at ${targetLoad}; hold unless the first set feels clearly too easy or too hard.`
        : `- ${row.exerciseLabel}: hold the target load unless the first set feels clearly too easy or too hard.`;
    case "machine_or_cable_target_may_need_calibration":
      return targetLoad
        ? `- ${row.exerciseLabel}: start at ${targetLoad}; first working set calibrates this machine/cable target; reduce one load step if reps fall short or RPE jumps.`
        : `- ${row.exerciseLabel}: first working set calibrates this machine/cable target; reduce one load step if reps fall short or RPE jumps.`;
    default:
      return targetLoad
        ? `- ${row.exerciseLabel}: start at ${targetLoad}; calibrate from the first working set.`
        : `- ${row.exerciseLabel}: use the written target as guidance and calibrate from the first working set.`;
  }
}

function buildStartability(input: {
  generation: SessionGenerationResult | undefined;
  nextSession: NextWorkoutContext | undefined;
  sessionSnapshot: SessionAuditSnapshot | undefined;
  projectedWeek: PreSessionReadinessProjectedWeekEvidence | undefined;
  evidence: PreSessionReadinessEvidence;
  isActiveDeload: boolean;
}): PreSessionReadinessContract["startability"] {
  const reasons: string[] = [];
  if (input.generation && "error" in input.generation) {
    reasons.push(`generation failed: ${input.generation.error}`);
  }
  if (!input.sessionSnapshot?.generated && !input.generation) {
    reasons.push("missing generated session preview");
  }
  if (
    input.nextSession?.source === "existing_incomplete" &&
    input.nextSession.selectedIncompleteReadiness?.safeToTrain !== true
  ) {
    reasons.push(
      `incomplete workout blocker: ${input.nextSession.existingWorkoutId ?? "unknown"} (${input.nextSession.selectedIncompleteStatus ?? "unknown"})`
    );
  }
  if (input.nextSession?.source === "final_week_close_pending") {
    reasons.push(
      input.nextSession.lifecycleBlocker?.message ??
        "final accumulation closeout is pending"
    );
  }
  if (input.evidence.activeMesocycle.mesocycleIdMatchesRequest === false) {
    reasons.push("requested mesocycle id does not match the active mesocycle");
  }
  if (!input.projectedWeek) {
    reasons.push("missing current-week projection and dose guidance");
  }

  const safeToTrain = reasons.length === 0;
  return {
    status: safeToTrain ? "startable" : "blocked",
    safeToTrain,
    normalStartCoachingAllowed: safeToTrain,
    action: safeToTrain
      ? input.isActiveDeload
        ? "run_deload_seed_as_prescribed"
        : "run_seed_as_prescribed"
      : "resolve_blocker_first",
    reasons: safeToTrain
      ? ["no blocking audit, state, or generation blockers detected"]
      : reasons,
    blockerSummary: safeToTrain ? "none" : Array.from(new Set(reasons)).join("; "),
  };
}

function buildSeedRuntimeProof(input: {
  compositionSource: string | null;
  receiptMesocycleId: string | null;
  seedConsistency: AcceptedMesocycleSeedProvenanceConsistency | undefined;
}): PreSessionReadinessContract["seedRuntimeProof"] {
  const seed = input.seedConsistency?.seed;
  const seedOrderSetCountsRespected =
    input.compositionSource === "persisted_slot_plan_seed"
      ? true
      : input.compositionSource === "deload_seed_replay"
        ? true
        : input.compositionSource == null
          ? null
          : false;
  const proofLines =
    input.compositionSource === "persisted_slot_plan_seed"
      ? [
          "Seed order/set counts respected: yes, generated preview is from persisted seed replay",
          "Exercise identity/order source: accepted seed replay",
          "Set-count policy: accumulation seed set counts preserved",
        ]
      : input.compositionSource === "deload_seed_replay"
        ? [
            "Seed order/set counts respected: yes, generated preview is from deload seed replay",
            "Exercise identity/order source: accepted seed replay for deload",
            "Set-count policy: deload-adjusted; accumulation seed set counts intentionally reduced",
          ]
        : [
            "Seed order/set counts respected: unknown, composition source is not persisted seed replay",
          ];

  return {
    status:
      input.seedConsistency?.status === "valid"
        ? "valid"
        : input.seedConsistency
          ? "warning"
          : "not_available",
    compositionSource: input.compositionSource,
    receiptMesocycleId: input.receiptMesocycleId,
    seedSource: seed?.source ?? null,
    seedExecutableShape: seed?.executableShape ?? null,
    seedOrderSetCountsRespected,
    readOnlyEvidenceOnly: true,
    seedRuntimeChanged: false,
    proofLines,
  };
}

function buildConsistencyChecks(input: {
  recommendations: PreSessionReadinessCoachingRecommendation[];
  decisions: WeeklyMuscleClosureDecision[];
  projectedWeekStatus: PreSessionReadinessContract["projectedWeekStatus"];
  startability: PreSessionReadinessContract["startability"];
  seedRuntimeProof: PreSessionReadinessContract["seedRuntimeProof"];
}): PreSessionReadinessConsistencyCheck[] {
  const decisionByMuscle = new Map(
    input.decisions.map((decision) => [decision.muscle, decision])
  );
  const recommendationConstraintViolations = input.recommendations.flatMap(
    (recommendation) => {
      const decision = decisionByMuscle.get(recommendation.muscle);
      const candidate = decision?.recommendation;
      const valid =
        decision?.status === "eligible" &&
        decision.opportunity.isFinalMeaningfulOpportunity &&
        !decision.constraints.hardSuppressed &&
        candidate?.exerciseName === recommendation.candidateExerciseName &&
        !decision.constraints.forbiddenExerciseIds.includes(candidate.exerciseId) &&
        !decision.constraints.forbiddenMovementClasses.includes(
          candidate.movementClass
        ) &&
        candidate.additionalSets > 0 &&
        candidate.projectedContribution > 0;
      return valid
        ? []
        : [`${recommendation.muscle}:${recommendation.candidateExerciseName}`];
    }
  );
  const nonFinalRecommendations = input.recommendations.flatMap(
    (recommendation) => {
      const decision = decisionByMuscle.get(recommendation.muscle);
      return decision?.status === "eligible" &&
        decision.opportunity.isFinalMeaningfulOpportunity
        ? []
        : [recommendation.muscle];
    }
  );
  const deficitMismatches = input.decisions.flatMap((decision) => {
    const expected = Math.max(
      0,
      decision.evidence.mev - decision.evidence.projectedWeekEffectiveSets
    );
    return Math.abs(expected - decision.evidence.deficitToMev) <= 0.05
      ? []
      : [
          `${decision.muscle}:expected=${formatAuditDecimal(expected)},actual=${formatAuditDecimal(decision.evidence.deficitToMev)}`,
        ];
  });
  const mismatched = input.recommendations.filter((recommendation) =>
    recommendation.suppressionReasons.includes("candidate_muscle_mismatch")
  );
  const suppressedTarget = input.recommendations.filter((recommendation) =>
    recommendation.suppressionReasons.includes("target_muscle_suppressed")
  );
  const hasActiveAddOn = input.recommendations.some(
    (recommendation) => !recommendation.suppressed
  );
  const noAddOnExplicit =
    input.projectedWeekStatus.status !== "no_further_action" ||
    Boolean(input.projectedWeekStatus.noAddOnReason);
  const blockedAllowsNormalStart =
    !input.startability.safeToTrain &&
    input.startability.normalStartCoachingAllowed;
  const seedProofReadOnly =
    input.seedRuntimeProof.readOnlyEvidenceOnly === true &&
    input.seedRuntimeProof.seedRuntimeChanged === false;

  return [
    {
      id: "closure_recommendation_satisfies_constraints",
      status: recommendationConstraintViolations.length > 0 ? "fail" : "pass",
      severity: recommendationConstraintViolations.length > 0 ? "error" : "info",
      message:
        recommendationConstraintViolations.length > 0
          ? "One or more closure recommendations violate their canonical candidate constraints."
          : "Every closure recommendation satisfies its canonical candidate constraints.",
      evidence: recommendationConstraintViolations,
    },
    {
      id: "closure_recommendation_requires_eligible_final_opportunity",
      status: nonFinalRecommendations.length > 0 ? "fail" : "pass",
      severity: nonFinalRecommendations.length > 0 ? "error" : "info",
      message:
        nonFinalRecommendations.length > 0
          ? "One or more closure recommendations are not eligible final opportunities."
          : "Every closure recommendation is backed by an eligible final opportunity.",
      evidence: nonFinalRecommendations,
    },
    {
      id: "closure_deficit_matches_projected_week",
      status: deficitMismatches.length > 0 ? "fail" : "pass",
      severity: deficitMismatches.length > 0 ? "error" : "info",
      message:
        deficitMismatches.length > 0
          ? "One or more closure deficits disagree with projected-week evidence."
          : "Closure deficits agree with projected-week evidence.",
      evidence: deficitMismatches,
    },
    {
      id: "optional_add_on_matches_flagged_muscle",
      status: mismatched.length > 0 ? "warning" : "pass",
      severity: mismatched.length > 0 ? "warning" : "info",
      message:
        mismatched.length > 0
          ? "One or more optional add-on candidates did not match the flagged muscle need and were suppressed."
          : "Optional add-on candidates match their flagged muscle need.",
      evidence: mismatched.map(
        (recommendation) =>
          `${recommendation.muscle}:${recommendation.candidateExerciseName}`
      ),
    },
    {
      id: "optional_add_on_not_suppressed_muscle",
      status: suppressedTarget.length > 0 ? "warning" : "pass",
      severity: suppressedTarget.length > 0 ? "warning" : "info",
      message:
        suppressedTarget.length > 0
          ? "One or more optional add-ons targeted a suppressed muscle and were suppressed."
          : "No active optional add-on targets a suppressed muscle.",
      evidence: suppressedTarget.map((recommendation) => recommendation.muscle),
    },
    {
      id: "no_add_on_state_explicit",
      status: noAddOnExplicit && (hasActiveAddOn || input.projectedWeekStatus.noAddOnReason || input.projectedWeekStatus.status !== "no_further_action") ? "pass" : "fail",
      severity: noAddOnExplicit ? "info" : "error",
      message: noAddOnExplicit
        ? "No-add-on state is explicit when projected week requires no further action."
        : "No-add-on state is missing for projected week no_further_action.",
      evidence: [
        `projected_week_status=${input.projectedWeekStatus.status}`,
        `active_add_ons=${hasActiveAddOn ? "yes" : "no"}`,
      ],
    },
    {
      id: "blocked_state_no_normal_start_coaching",
      status: blockedAllowsNormalStart ? "fail" : "pass",
      severity: blockedAllowsNormalStart ? "error" : "info",
      message: blockedAllowsNormalStart
        ? "Blocked/not-runnable state exposes normal start coaching."
        : "Blocked/not-runnable state does not expose normal start coaching.",
      evidence: [
        `safe_to_train=${input.startability.safeToTrain ? "yes" : "no"}`,
        `normal_start=${input.startability.normalStartCoachingAllowed ? "yes" : "no"}`,
      ],
    },
    {
      id: "seed_runtime_proof_read_only",
      status: seedProofReadOnly ? "pass" : "fail",
      severity: seedProofReadOnly ? "info" : "error",
      message: seedProofReadOnly
        ? "Seed/runtime proof remains read-only evidence only."
        : "Seed/runtime proof implies behavior mutation.",
      evidence: [
        `read_only=${input.seedRuntimeProof.readOnlyEvidenceOnly ? "yes" : "no"}`,
        `seed_runtime_changed=${input.seedRuntimeProof.seedRuntimeChanged ? "yes" : "no"}`,
      ],
    },
  ];
}

export function buildPreSessionReadinessContract(
  input: PreSessionReadinessContractBuildInput
): PreSessionReadinessContract {
  const active = input.evidence.activeMesocycle;
  const isActiveDeload = active.state === "ACTIVE_DELOAD";
  const generated = input.sessionSnapshot?.generated;
  const nextProjectedSession =
    input.projectedWeek?.projectedSessions.find((session) => session.isNext) ??
    input.projectedWeek?.projectedSessions[0];
  const doseDiagnostics = input.projectedWeek?.runtimeDoseAdjustmentDiagnostics ?? [];
  const startability = buildStartability({
    generation: input.generation,
    nextSession: input.nextSession,
    sessionSnapshot: input.sessionSnapshot,
    projectedWeek: input.projectedWeek,
    evidence: input.evidence,
    isActiveDeload,
  });
  const receiptProvenance =
    input.generation && !("error" in input.generation)
      ? input.generation.selection.sessionDecisionReceipt?.sessionProvenance
      : undefined;
  const seedRuntimeProof = buildSeedRuntimeProof({
    compositionSource: receiptProvenance?.compositionSource ?? null,
    receiptMesocycleId: receiptProvenance?.mesocycleId ?? null,
    seedConsistency: input.seedConsistency,
  });
  const doseClosure = buildDoseClosure({
    isActiveDeload,
    diagnostics: doseDiagnostics,
    fullWeekRows: input.projectedWeek?.fullWeekByMuscle ?? [],
  });
  const availableRecommendations = doseClosure.recommendations.filter(
    (recommendation) => !recommendation.suppressed
  );
  const projectedWeekStatus = buildProjectedWeekStatus({
    isActiveDeload,
    projectedWeek: input.projectedWeek,
    doseDiagnostics,
    startable: startability.safeToTrain,
    hasAvailableAddOns: availableRecommendations.length > 0,
  });
  const fatigueRows = [
    ...(input.weeklyRetro?.volumeTargeting.overMav ?? []).map(
      (muscle) => `${muscle}: over MAV`
    ),
    ...(input.weeklyRetro?.volumeTargeting.overTargetOnly ?? []).map(
      (muscle) => `${muscle}: over target`
    ),
    ...(input.projectedWeek?.currentWeekAudit?.fatigueRisks ?? []),
  ];
  const avoid = buildAvoidList({
    decisions: doseClosure.decisions ?? [],
    sessionRisks: input.projectedWeek?.sessionRisks ?? [],
    nextSession: nextProjectedSession,
    recommendations: doseClosure.recommendations,
  });
  const prescriptionConfidenceWatches = buildPrescriptionConfidenceWatches(
    generated,
    input.generation && !("error" in input.generation)
      ? input.generation.prescriptionReadouts
      : undefined
  );
  const workoutPreview = buildWorkoutPreview(generated);
  const diagnosticFatigue = doseDiagnostics.flatMap((diagnostic) => {
    if (diagnostic.fatigueDensityConcern.level === "none") {
      return [];
    }
    const drivers =
      diagnostic.fatigueDensityConcern.drivers
        .slice(0, 2)
        .map((driver) => driver.exerciseName)
        .join(", ") || "projected session";
    return [
      `- ${diagnostic.muscle}: ${diagnostic.fatigueDensityConcern.level} fatigue watch via ${drivers}`,
    ];
  });
  const fatigueCautions = Array.from(
    new Set([
      ...fatigueRows.map((row) => `- ${row}`),
      ...(input.projectedWeek?.sessionRisks ?? []).map(
        (risk) => `- ${risk.slotId}: ${risk.issue}`
      ),
      ...diagnosticFatigue,
    ])
  );
  const safeOptionalAddOns = startability.safeToTrain
    ? availableRecommendations.map((recommendation) => recommendation.addonLine)
    : [];
  const addOnState =
    !startability.safeToTrain
      ? {
          status: "blocked" as const,
          reason: "Readiness is blocked; resolve blocker before considering add-ons.",
        }
      : isActiveDeload
        ? {
            status: "deload_suppressed" as const,
            reason: "ACTIVE_DELOAD suppresses hypertrophy add-ons and MEV closure top-ups.",
          }
        : safeOptionalAddOns.length > 0
          ? {
              status: "available" as const,
              reason: "Contract has session-local optional add-on rows.",
            }
          : {
              status: "none" as const,
              reason:
                projectedWeekStatus.noAddOnReason ??
                "No safe session-local optional add-ons from current contract evidence.",
            };
  const suppressAvoid = isActiveDeload
    ? ["- all hypertrophy add-ons / MEV closure top-ups during ACTIVE_DELOAD"]
    : avoid.length > 0
      ? avoid.slice(0, 6).map((item) => `- ${item}`)
      : ["- no extra work beyond session-local readiness judgment"];
  const contractSource = input.contractSource ?? {
    producerMode: "audit_readout" as const,
    producer: "workout_audit" as const,
    provenance: "operator_audit" as const,
  };
  const prescriptionConfidenceWatchMessages =
    prescriptionConfidenceWatches.map(formatPrescriptionConfidenceWatchMessage);
  const boundaryNotes = input.boundaryNotes ?? [
    "contract is audit/readout only",
    "no workout/session/log/seed/progression mutation",
    "seed/runtime proof is evidence only",
  ];

  const contractBase = {
    contractVersion: 1 as const,
    scope: {
      mode: "pre-session-readiness" as const,
      ownerSeam: PRE_SESSION_READINESS_CONTRACT_OWNER_SEAM,
      source: contractSource,
      readOnly: true as const,
      auditOnly: input.auditOnly ?? true,
      affectsScoringOrGeneration: false as const,
      consumedByProduction: false as const,
    },
    nextSessionIdentity: {
      userId: input.userId,
      ...(input.ownerEmail ? { ownerEmail: input.ownerEmail } : {}),
      activeMesocycleId: active.mesocycleId,
      ...(active.requestedMesocycleId
        ? { requestedMesocycleId: active.requestedMesocycleId }
        : {}),
      ...(active.mesocycleIdMatchesRequest != null
        ? { mesocycleIdMatchesRequest: active.mesocycleIdMatchesRequest }
        : {}),
      activeState: active.state,
      currentWeek: active.currentWeek,
      currentSession: active.currentSession,
      nextSlotId: input.nextSession?.slotId ?? null,
      nextIntent: input.nextSession?.intent ?? null,
      existingWorkoutId: input.nextSession?.existingWorkoutId ?? null,
      incompleteWorkoutStatus: input.nextSession?.selectedIncompleteStatus ?? null,
      incompleteWorkoutReadiness: input.nextSession?.existingWorkoutId
        ? input.nextSession.selectedIncompleteReadiness
          ? `${input.nextSession.selectedIncompleteReadiness.classification} (${input.nextSession.selectedIncompleteReadiness.action})`
          : `unclassified (${input.nextSession.selectedIncompleteStatus ?? "unknown"})`
        : "none",
      existingWorkoutAction:
        input.nextSession?.selectedIncompleteReadiness?.reason ?? "none",
      generationPath: input.generationPath?.executionMode ?? "unknown",
      generator: input.generationPath?.generator ?? "unknown",
    },
    startability,
    seedRuntimeProof,
    projectedWeekStatus,
    doseClosure,
    sessionLocalCoaching: {
      defaultInstruction: startability.safeToTrain
        ? isActiveDeload
          ? "Run deload seed as prescribed."
          : "Default: run seed as prescribed. All suggestions are optional, session-local, and do not mutate the accepted seed."
        : "Resolve blocker before starting; do not start this as a normal session.",
      floorBufferOpportunities: isActiveDeload || !startability.safeToTrain
        ? ["- none"]
        : availableRecommendations
            .filter((recommendation) => recommendation.kind === "floor_buffer")
            .map((recommendation) => recommendation.line),
      prescriptionConfidenceWatches:
        prescriptionConfidenceWatchMessages.length > 0
          ? prescriptionConfidenceWatchMessages
          : ["- none"],
      fatigueCautions:
        fatigueCautions.length > 0 ? fatigueCautions.slice(0, 6) : ["- none"],
      safeOptionalAddOns:
        safeOptionalAddOns.length > 0
          ? safeOptionalAddOns.slice(0, 4)
          : [
              addOnState.status === "blocked"
                ? "- none - readiness is blocked"
                : addOnState.status === "deload_suppressed"
                  ? "- none - deload context suppresses hypertrophy top-ups"
                  : `- none - ${addOnState.reason}`,
            ],
      suppressAvoid,
      addOnState,
    },
    calibrationWatches: {
      prescriptionConfidence: prescriptionConfidenceWatches,
      recoveryCaveats: doseDiagnostics
        .filter((diagnostic) => diagnostic.recoveryReadinessCaveat.status !== "none")
        .map(
          (diagnostic) =>
            `${diagnostic.muscle}:${diagnostic.recoveryReadinessCaveat.status}`
        ),
      fatigue: fatigueCautions,
    },
    ...(workoutPreview ? { workoutPreview } : {}),
    boundaries: {
      readOnly: true as const,
      affectsScoringOrGeneration: false as const,
      consumedByProduction: false as const,
      wouldWriteTransaction: false as const,
      dbMutation: false as const,
      workoutLogSessionCreated: false as const,
      seedRuntimeChanged: false as const,
      plannerMaterializerChanged: false as const,
      notes: boundaryNotes,
    },
  };

  return {
    ...contractBase,
    consistencyChecks: buildConsistencyChecks({
      recommendations: doseClosure.recommendations,
      decisions: doseClosure.decisions ?? [],
      projectedWeekStatus,
      startability,
      seedRuntimeProof,
    }),
  };
}
