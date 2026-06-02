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

export type PreSessionReadinessGymCardDto = {
  safeToTrain: boolean;
  action: PreSessionReadinessGymCardAction;
  sessionLabel: string;
  primaryInstruction: string;
  rpeCap: "prescribed" | "deload_prescribed" | null;
  mainPriority: string;
  avoid: string[];
  optionalAddOns: PreSessionReadinessGymCardOptionalAddOns;
  calibrationNotes: ReadinessCalibrationWatchRow[];
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
      return "weekly cap already high";
    case "near_mav":
      return "close to weekly cap";
    case "target_muscle_suppressed":
      return "not a good add-on target today";
    case "candidate_muscle_mismatch":
      return "does not match today's add-on need";
    default:
      return reason.replaceAll("_", " ");
  }
}

function formatSuppressedTarget(target: ReadinessSuppressedTarget): string {
  const reason = target.reasons.map(formatSuppressionReason).join(", ");
  if (target.targetMuscle === "all") {
    return `Avoid optional add-ons: ${reason}.`;
  }
  if (target.candidateExerciseName) {
    return `Avoid ${target.candidateExerciseName} for ${target.targetMuscle}: ${reason}.`;
  }
  return `Avoid extra ${target.targetMuscle}: ${reason}.`;
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

function formatWarnings(input: {
  consistencyWarnings: PreSessionReadinessConsistencyCheck[];
  suppressedTargets: ReadinessSuppressedTarget[];
}): string[] {
  return Array.from(
    new Set([
      ...input.consistencyWarnings.map((warning) => warning.message),
      ...input.suppressedTargets.map(formatSuppressedTarget),
    ])
  );
}

function toDisplaySafeWatchRow(
  row: ReadinessCalibrationWatchRow
): ReadinessCalibrationWatchRow {
  if (row.displayActionCode) {
    const prefix = row.exerciseLabel ? `${row.exerciseLabel}: ` : "";
    const message =
      row.displayActionCode === "use_target_as_starting_point"
        ? `${prefix}Use the target as a starting point; adjust by feel.`
        : row.displayActionCode === "hold_target_load"
          ? `${prefix}Hold the target load unless the first set feels clearly too easy or too hard.`
          : row.displayActionCode === "machine_or_cable_target_may_need_calibration"
            ? `${prefix}Machine/cable target may need calibration.`
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
    message = `${prefix}Machine/cable target may need calibration.`;
  }

  return {
    ...row,
    message: message.length > 140 ? `${message.slice(0, 137)}...` : message,
  };
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
  const calibrationNotes = getCalibrationWatchRows(contract).map(
    toDisplaySafeWatchRow
  );
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
    mainPriority: getMainPriority({
      blocked,
      optionalAddOns,
      contract,
    }),
    avoid: suppressedTargets.map(formatSuppressedTarget),
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
    blockers: getBlockers({
      blocked,
      contract,
      failures: consistency.failures,
    }),
    warnings: formatWarnings({
      consistencyWarnings: consistency.warnings,
      suppressedTargets,
    }),
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
