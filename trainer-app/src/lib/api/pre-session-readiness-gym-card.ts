import {
  assertReadinessContractConsistency,
  getCalibrationWatchRows,
  getReadinessGymCard,
  getReadinessStartAction,
  getSuppressedMusclesOrTargets,
  getValidOptionalAddOns,
  hasBlockingReadinessIssue,
  type ReadinessCalibrationWatchRow,
  type ReadinessOptionalAddOn,
  type ReadinessSuppressedTarget,
} from "./pre-session-readiness-contract-consumers";
import type {
  PreSessionReadinessConsistencyCheck,
  PreSessionReadinessContract,
  PreSessionReadinessContractProducerMode,
} from "./pre-session-readiness-contract";
import { formatSessionIdentityLabel } from "@/lib/ui/session-identity";

export type PreSessionReadinessGymCardAction =
  | "start"
  | "resume"
  | "blocked"
  | "watch";

export type PreSessionReadinessGymCardOptionalAddOns = {
  status: PreSessionReadinessContract["sessionLocalCoaching"]["addOnState"]["status"];
  reason: string;
  items: ReadinessOptionalAddOn[];
};

export type PreSessionReadinessGymCardSource = {
  contractVersion: PreSessionReadinessContract["contractVersion"];
  kind: "typed_pre_session_readiness_contract";
  ownerSeam: PreSessionReadinessContract["scope"]["ownerSeam"];
  readOnly: true;
  auditOnly: boolean;
  producerMode: PreSessionReadinessContractProducerMode | "unknown";
};

export type PreSessionReadinessGymCardWorkoutPreview =
  | NonNullable<PreSessionReadinessContract["workoutPreview"]>
  | {
      source: "unavailable";
      exercises: [];
      targetRpeLabel: null;
    };

export type PreSessionReadinessGymCardDto = {
  safeToTrain: boolean;
  action: PreSessionReadinessGymCardAction;
  sessionLabel: string;
  primaryInstruction: string;
  rpeCap: "prescribed" | "deload_prescribed" | null;
  workoutPreview: PreSessionReadinessGymCardWorkoutPreview;
  mainPriority: string;
  avoid: string[];
  optionalAddOns: PreSessionReadinessGymCardOptionalAddOns;
  calibrationNotes: ReadinessCalibrationWatchRow[];
  fatigueWatch: string[];
  blockers: string[];
  warnings: string[];
  source: PreSessionReadinessGymCardSource;
};

function formatSessionLabel(contract: PreSessionReadinessContract): string {
  const identity = contract.nextSessionIdentity;
  const label = formatSessionIdentityLabel({
    intent: identity.nextIntent,
    slotId: identity.nextSlotId,
  });

  if (label !== "Workout") {
    return label;
  }

  if (identity.currentWeek != null || identity.currentSession != null) {
    const week = identity.currentWeek == null ? "Week ?" : `Week ${identity.currentWeek}`;
    const session =
      identity.currentSession == null
        ? "Session ?"
        : `Session ${identity.currentSession}`;
    return `${week} ${session}`;
  }

  return label;
}

function getAction(input: {
  contract: PreSessionReadinessContract;
  blocked: boolean;
  warningCount: number;
  calibrationWatchCount: number;
}): PreSessionReadinessGymCardAction {
  if (input.blocked) {
    return "blocked";
  }
  if (input.contract.nextSessionIdentity.existingWorkoutId) {
    return "resume";
  }
  if (
    input.contract.projectedWeekStatus.status === "watch" ||
    input.warningCount > 0 ||
    input.calibrationWatchCount > 0
  ) {
    return "watch";
  }
  return "start";
}

function getPrimaryInstruction(input: {
  action: PreSessionReadinessGymCardAction;
  contract: PreSessionReadinessContract;
}): string {
  if (input.action === "blocked") {
    return "Resolve readiness blocker before training.";
  }
  if (input.action === "resume") {
    return "Resume the planned workout. Keep effort around the prescribed RPE cap.";
  }
  return input.contract.startability.action === "run_deload_seed_as_prescribed"
    ? "Run the planned deload. Keep effort easy and stay under the prescribed cap."
    : "Run the planned workout. Keep effort around the prescribed RPE cap.";
}

function getRpeCap(
  contract: PreSessionReadinessContract,
  blocked: boolean
): PreSessionReadinessGymCardDto["rpeCap"] {
  if (blocked) {
    return null;
  }
  return contract.startability.action === "run_deload_seed_as_prescribed"
    ? "deload_prescribed"
    : "prescribed";
}

function getWorkoutPreview(
  contract: PreSessionReadinessContract
): PreSessionReadinessGymCardWorkoutPreview {
  return (
    contract.workoutPreview ?? {
      source: "unavailable",
      exercises: [],
      targetRpeLabel: null,
    }
  );
}

function getMainPriority(input: {
  blocked: boolean;
  optionalAddOns: ReadinessOptionalAddOn[];
  contract: PreSessionReadinessContract;
}): string {
  if (input.blocked) {
    return "Resolve blockers before any start or add-on decision.";
  }
  if (input.optionalAddOns.length > 0) {
    return "Planned workout first; add optional work only if warm-ups feel normal.";
  }
  if (input.contract.projectedWeekStatus.status === "watch") {
    return "Use the written targets as starting points and adjust by feel.";
  }
  return "Run the planned workout; no extra work needed today.";
}

function formatSuppressionReason(reason: string): string {
  switch (reason) {
    case "over_mav":
      return "weekly volume is already covered";
    case "near_mav":
      return "weekly volume is close to covered";
    case "target_muscle_suppressed":
      return "not a good add-on target today";
    case "candidate_muscle_mismatch":
      return "does not match today's add-on need";
    case "blocked":
      return "readiness blocker is unresolved";
    case "deload_suppressed":
      return "deload work should stay easy";
    case "suppressed":
      return "not a good add-on target today";
    default:
      return reason.replaceAll("_", " ");
  }
}

function formatSuppressedTarget(target: ReadinessSuppressedTarget): string | null {
  if (target.source === "projected_week_over_mav") {
    return null;
  }

  const reason = target.reasons.map(formatSuppressionReason).join(", ");
  if (target.targetMuscle === "all") {
    return `Avoid optional add-ons: ${reason}.`;
  }
  if (target.candidateExerciseName) {
    return `Avoid ${target.candidateExerciseName} for ${target.targetMuscle}: ${reason}.`;
  }
  return `Avoid extra ${target.targetMuscle}: ${reason}.`;
}

function formatMuscleList(muscles: string[]): string {
  if (muscles.length <= 1) {
    return muscles[0] ?? "";
  }
  if (muscles.length === 2) {
    return `${muscles[0]} and ${muscles[1]}`;
  }
  return `${muscles.slice(0, -1).join(", ")}, and ${muscles[muscles.length - 1]}`;
}

function getOverVolumeMuscleFromMessage(message: string): string | null {
  const normalized = message.replace(/^\s*-\s*/, "").trim();
  const match = normalized.match(/^([^:]+):\s*over\s+(?:mav|target)\s*$/i);
  return match?.[1]?.trim() || null;
}

function getFatigueMuscleFromMessage(message: string): string | null {
  const normalized = message.replace(/^\s*-\s*/, "").trim();
  const match = normalized.match(/^([^:]+):/);
  return match?.[1]?.trim() || null;
}

function isLowerBodyMuscle(muscle: string): boolean {
  return /^(glutes|hamstrings|quads|adductors|calves)$/i.test(muscle.trim());
}

function formatAvoidGuidance(input: {
  suppressedTargets: ReadinessSuppressedTarget[];
  calibrationRows: ReadinessCalibrationWatchRow[];
}): string[] {
  const overVolumeMuscles = Array.from(
    new Set([
      ...input.suppressedTargets
        .filter((target) => target.source === "projected_week_over_mav")
        .map((target) => target.targetMuscle),
      ...input.calibrationRows
        .filter((row) => row.kind === "fatigue")
        .map((row) => getOverVolumeMuscleFromMessage(row.message))
        .filter((muscle): muscle is string => Boolean(muscle)),
    ])
  );
  const specificAvoid = input.suppressedTargets
    .map(formatSuppressedTarget)
    .filter((item): item is string => Boolean(item));
  const volumeAvoid =
    overVolumeMuscles.length >= 4
      ? [
          "No extra volume. Weekly volume is already covered across most muscle groups.",
        ]
      : overVolumeMuscles.map(
          (muscle) => `No extra ${muscle}; weekly volume is already covered.`
        );

  return Array.from(new Set([...specificAvoid, ...volumeAvoid]));
}

function getBlockers(input: {
  blocked: boolean;
  contract: PreSessionReadinessContract;
  failures: PreSessionReadinessConsistencyCheck[];
}): string[] {
  if (!input.blocked) {
    return [];
  }
  return Array.from(
    new Set([
      ...(input.contract.startability.safeToTrain
        ? []
        : input.contract.startability.reasons),
      ...input.failures.map((failure) => failure.message),
    ])
  );
}

function formatWarnings(): string[] {
  return [];
}

function formatLoad(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatAdjustmentRange(row: ReadinessCalibrationWatchRow): string | null {
  const range = row.suggestedAdjustmentRange;
  if (!range) {
    return null;
  }

  const target =
    row.targetLoad == null ? "the written target" : `${formatLoad(row.targetLoad)} lb`;
  return `Start at ${target}; use ${formatLoad(range.minLoad)}-${formatLoad(range.maxLoad)} ${range.unit} if first-set reps or RPE are off.`;
}

function formatTargetLoadStart(row: ReadinessCalibrationWatchRow): string | null {
  if (typeof row.targetLoad !== "number" || !Number.isFinite(row.targetLoad)) {
    return null;
  }
  return `Start at ${formatLoad(row.targetLoad)} lb`;
}

function toDisplaySafeWatchRow(
  row: ReadinessCalibrationWatchRow
): ReadinessCalibrationWatchRow {
  if (row.displayActionCode) {
    const prefix = row.exerciseLabel ? `${row.exerciseLabel}: ` : "";
    const adjustmentRange = formatAdjustmentRange(row);
    const targetLoadStart = formatTargetLoadStart(row);
    const message =
      adjustmentRange
        ? `${prefix}${adjustmentRange}`
        : row.displayActionCode === "use_target_as_starting_point"
        ? targetLoadStart
          ? `${prefix}${targetLoadStart}; adjust by feel.`
          : `${prefix}Use the target as a starting point; adjust by feel.`
        : row.displayActionCode === "hold_target_load"
          ? targetLoadStart
            ? `${prefix}${targetLoadStart}; hold unless the first set feels clearly too easy or too hard.`
            : `${prefix}Hold the target load unless the first set feels clearly too easy or too hard.`
          : row.displayActionCode === "machine_or_cable_target_may_need_calibration"
            ? targetLoadStart
              ? `${prefix}${targetLoadStart}; first working set calibrates this machine/cable target; reduce one load step if reps fall short or RPE jumps.`
              : `${prefix}First working set calibrates this machine/cable target; reduce one load step if reps fall short or RPE jumps.`
            : targetLoadStart
              ? `${prefix}${targetLoadStart}; calibrate from the first working set.`
              : `${prefix}Use the written target as guidance and calibrate from the first working set.`;

    return {
      ...row,
      message: message.length > 140 ? `${message.slice(0, 137)}...` : message,
    };
  }

  const rawMessage = row.message.replace(/^\s*-\s*/, "").trim();
  const subject = rawMessage.includes(":")
    ? rawMessage.split(":")[0]?.trim()
    : null;
  const prefix = subject ? `${subject}: ` : "";
  let message = rawMessage;

  if (/progression trace unavailable/i.test(rawMessage)) {
    message = `${prefix}Use the target as a starting point; adjust by feel.`;
  } else if (/action=hold\b/i.test(rawMessage)) {
    message = `${prefix}Hold the target load unless the first set feels clearly too easy or too hard.`;
  } else if (/action=/i.test(rawMessage) || /confidence=/i.test(rawMessage) || /reasons=/i.test(rawMessage)) {
    message = `${prefix}Use the written target as guidance and calibrate from the first working set.`;
  } else if (/equipment scaled during early exposure/i.test(rawMessage)) {
    message = `${prefix}First working set calibrates this machine/cable target; reduce one load step if reps fall short or RPE jumps.`;
  }

  return {
    ...row,
    message: message.length > 140 ? `${message.slice(0, 137)}...` : message,
  };
}

function getLoadCalibrationNotes(
  rows: ReadinessCalibrationWatchRow[]
): ReadinessCalibrationWatchRow[] {
  return rows
    .filter((row) => row.kind === "prescription_confidence")
    .map(toDisplaySafeWatchRow);
}

function formatRecoveryCaveat(message: string): string | null {
  const normalized = message.replace(/^\s*-\s*/, "").trim();
  const [rawMuscle, rawReason] = normalized.split(":");
  const muscle = rawReason ? rawMuscle?.trim() : null;
  const reason = rawReason?.trim().replaceAll("_", " ");

  if (!muscle || !reason) {
    return null;
  }

  return `Keep extra ${muscle} work off the table if ${reason} affects warm-ups.`;
}

function formatFatigueWatch(input: ReadinessCalibrationWatchRow[]): string[] {
  const fatigueMessages = input.filter((row) => row.kind === "fatigue");
  const fatigueMuscles = Array.from(
    new Set(
      fatigueMessages
        .filter((row) => !getOverVolumeMuscleFromMessage(row.message))
        .map((row) => getFatigueMuscleFromMessage(row.message))
        .filter((muscle): muscle is string => Boolean(muscle))
    )
  );
  const lowerMuscles = fatigueMuscles.filter(isLowerBodyMuscle);
  const recoveryCaveats = input
    .filter((row) => row.kind === "recovery_caveat")
    .map((row) => formatRecoveryCaveat(row.message))
    .filter((item): item is string => Boolean(item));
  const fatigueWatch =
    lowerMuscles.length >= 2
      ? [
          `Keep lower-body add-ons off the table today; ${formatMuscleList(
            lowerMuscles.map((muscle) => muscle.toLocaleLowerCase())
          )} are already carrying fatigue.`,
        ]
      : fatigueMuscles.map(
          (muscle) =>
            `Keep extra ${muscle} work off the table today; fatigue is already elevated.`
        );

  return Array.from(new Set([...fatigueWatch, ...recoveryCaveats]));
}

function formatOptionalAddOnReason(input: {
  blocked: boolean;
  hasItems: boolean;
  status: PreSessionReadinessContract["sessionLocalCoaching"]["addOnState"]["status"];
}): string {
  if (input.blocked) {
    return "Skip add-ons until the blocker is resolved.";
  }
  if (input.hasItems) {
    return "Optional only; skip it if the planned work feels heavy.";
  }
  if (input.status === "deload_suppressed") {
    return "No add-ons recommended during deload.";
  }
  return "No add-ons recommended.";
}

export function buildPreSessionReadinessGymCardDto(
  contract: PreSessionReadinessContract
): PreSessionReadinessGymCardDto {
  const startAction = getReadinessStartAction(contract);
  const summary = getReadinessGymCard(contract);
  const optionalAddOns = getValidOptionalAddOns(contract);
  const suppressedTargets = getSuppressedMusclesOrTargets(contract);
  const calibrationRows = getCalibrationWatchRows(contract);
  const calibrationNotes = getLoadCalibrationNotes(calibrationRows);
  const fatigueWatch = formatFatigueWatch(calibrationRows);
  const consistency = assertReadinessContractConsistency(contract);
  const blocked = hasBlockingReadinessIssue(contract);
  const action = getAction({
    contract,
    blocked,
    warningCount: consistency.warnings.length,
    calibrationWatchCount: summary.calibrationWatchCount,
  });

  return {
    safeToTrain: startAction.safeToTrain && !blocked,
    action,
    sessionLabel: formatSessionLabel(contract),
    primaryInstruction: getPrimaryInstruction({ action, contract }),
    rpeCap: getRpeCap(contract, blocked),
    workoutPreview: getWorkoutPreview(contract),
    mainPriority: getMainPriority({
      blocked,
      optionalAddOns,
      contract,
    }),
    avoid: formatAvoidGuidance({ suppressedTargets, calibrationRows }),
    optionalAddOns: {
      status:
        optionalAddOns.length > 0
          ? contract.sessionLocalCoaching.addOnState.status
          : "none",
      reason: formatOptionalAddOnReason({
        blocked,
        hasItems: optionalAddOns.length > 0,
        status: contract.sessionLocalCoaching.addOnState.status,
      }),
      items: optionalAddOns,
    },
    calibrationNotes,
    fatigueWatch,
    blockers: getBlockers({
      blocked,
      contract,
      failures: consistency.failures,
    }),
    warnings: formatWarnings(),
    source: {
      contractVersion: contract.contractVersion,
      kind: "typed_pre_session_readiness_contract",
      ownerSeam: contract.scope.ownerSeam,
      readOnly: true,
      auditOnly: contract.scope.auditOnly === true,
      producerMode: contract.scope.source?.producerMode ?? "unknown",
    },
  };
}
