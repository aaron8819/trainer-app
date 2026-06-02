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
  const week = identity.currentWeek == null ? "Week ?" : `Week ${identity.currentWeek}`;
  const session =
    identity.currentSession == null
      ? "Session ?"
      : `Session ${identity.currentSession}`;
  const slot = identity.nextSlotId ?? "unslotted";
  const intent = identity.nextIntent ?? "unknown intent";

  return `${week} ${session} - ${slot} ${intent}`;
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
    return "Resume the existing planned workout.";
  }
  if (input.action === "watch") {
    return "Review watches, then run the prescribed seed if readiness is normal.";
  }
  return input.contract.startability.action === "run_deload_seed_as_prescribed"
    ? "Run the deload seed as prescribed."
    : "Run the seeded session as prescribed.";
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
  const firstAddOn = input.optionalAddOns[0];
  if (firstAddOn) {
    return `Optional ${firstAddOn.targetMuscle} add-on: ${firstAddOn.candidateExerciseName}.`;
  }
  if (input.contract.projectedWeekStatus.status === "watch") {
    return "Monitor readiness and prescription confidence before starting.";
  }
  return "Run the prescribed session without extra add-ons.";
}

function formatSuppressedTarget(target: ReadinessSuppressedTarget): string {
  const reason = target.reasons.join(", ");
  if (target.targetMuscle === "all") {
    return `Avoid optional add-ons (${reason}).`;
  }
  if (target.candidateExerciseName) {
    return `Avoid ${target.candidateExerciseName} for ${target.targetMuscle} (${reason}).`;
  }
  return `Avoid extra ${target.targetMuscle} (${reason}).`;
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
  const message = row.message.replace(/^\s*-\s*/, "").trim();
  return {
    ...row,
    message: message.length > 140 ? `${message.slice(0, 137)}...` : message,
  };
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
      reason:
        optionalAddOns.length > 0
          ? contract.sessionLocalCoaching.addOnState.reason
          : "No valid session-local optional add-ons from the typed readiness contract.",
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
