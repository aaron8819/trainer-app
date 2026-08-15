import {
  MUSCLE_POLICY_BY_ID,
  type CanonicalMuscleId,
} from "./muscle-policy";

export const HYPERTROPHY_PLAN_HEALTH_POLICY_VERSION =
  "draft-plan-health.v1" as const;

export const HYPERTROPHY_PLAN_HEALTH_TIERS = [
  "BLOCKING_SAFETY",
  "IMPORTANT_WARNING",
  "COACHING_OBSERVATION",
  "INFORMATIONAL_ESTIMATE",
] as const;

export type HypertrophyPlanHealthTier =
  (typeof HYPERTROPHY_PLAN_HEALTH_TIERS)[number];

export const HYPERTROPHY_PLAN_HEALTH_ISSUE_CODES = [
  "EMPTY_SESSION",
  "EXERCISE_UNAVAILABLE",
  "EQUIPMENT_CONFLICT",
  "LIMITATION_CONFLICT",
  "LIMITATION_UNRECOGNIZED",
  "REQUIRED_EXERCISE_CLASS_MISMATCH",
  "ROLE_TARGET_MISMATCH",
  "MEASUREMENT_UNRESOLVED",
  "UNSUPPORTED_TOPOLOGY",
  "DUPLICATE_EXERCISE",
  "SESSION_DURATION_HIGH",
  "VOLUME_HIGH",
  "MOVEMENT_REDUNDANCY",
  "MISSING_COVERAGE",
  "THIN_COVERAGE",
] as const;

export type HypertrophyPlanHealthIssueCode =
  (typeof HYPERTROPHY_PLAN_HEALTH_ISSUE_CODES)[number];

export type HypertrophyPlanHealthFinding = {
  code: string;
  message: string;
  slotId?: string;
  exerciseId?: string;
  muscleId?: CanonicalMuscleId;
};

export type HypertrophyPlanHealth = {
  blockers: HypertrophyPlanHealthFinding[];
  warnings: HypertrophyPlanHealthFinding[];
  muscles: Array<{
    muscleId: CanonicalMuscleId;
    directSets: number;
    effectiveSets: number;
    frequency: number;
  }>;
  sessions: Array<{
    slotId: string;
    estimatedMinutes: number;
  }>;
};

type IssuePolicy = {
  tier: Exclude<HypertrophyPlanHealthTier, "INFORMATIONAL_ESTIMATE">;
  title: string;
  suggestedAction: string;
};

export const HYPERTROPHY_PLAN_HEALTH_ISSUE_POLICY = {
  EMPTY_SESSION: {
    tier: "BLOCKING_SAFETY",
    title: "Empty session",
    suggestedAction: "Add at least one exercise manually or remove the session.",
  },
  EXERCISE_UNAVAILABLE: {
    tier: "BLOCKING_SAFETY",
    title: "Exercise unavailable",
    suggestedAction: "Choose an available exercise manually.",
  },
  EQUIPMENT_CONFLICT: {
    tier: "BLOCKING_SAFETY",
    title: "Equipment conflict",
    suggestedAction: "Choose compatible equipment or replace the exercise manually.",
  },
  LIMITATION_CONFLICT: {
    tier: "BLOCKING_SAFETY",
    title: "Confirmed limitation conflict",
    suggestedAction: "Choose a compatible exercise or update the limitation outside this editor.",
  },
  LIMITATION_UNRECOGNIZED: {
    tier: "BLOCKING_SAFETY",
    title: "Limitation needs review",
    suggestedAction: "Update the active limitation to a recognized area before finalizing.",
  },
  REQUIRED_EXERCISE_CLASS_MISMATCH: {
    tier: "BLOCKING_SAFETY",
    title: "Exercise class mismatch",
    suggestedAction: "Choose an exercise that satisfies the saved role requirement.",
  },
  ROLE_TARGET_MISMATCH: {
    tier: "BLOCKING_SAFETY",
    title: "Role or target mismatch",
    suggestedAction: "Review the exercise role and target, then make an explicit edit.",
  },
  MEASUREMENT_UNRESOLVED: {
    tier: "BLOCKING_SAFETY",
    title: "Measurement unavailable",
    suggestedAction: "Choose an exercise with a supported measurement identity.",
  },
  UNSUPPORTED_TOPOLOGY: {
    tier: "BLOCKING_SAFETY",
    title: "Weekly structure cannot be finalized",
    suggestedAction: "Use four non-empty sessions, four accumulation weeks, and a final deload week.",
  },
  DUPLICATE_EXERCISE: {
    tier: "IMPORTANT_WARNING",
    title: "Duplicate exercise",
    suggestedAction: "Review whether the repeated exercise is deliberate before finalizing.",
  },
  SESSION_DURATION_HIGH: {
    tier: "IMPORTANT_WARNING",
    title: "Session may run long",
    suggestedAction: "Review whether the estimated duration is practical before finalizing.",
  },
  VOLUME_HIGH: {
    tier: "IMPORTANT_WARNING",
    title: "Unusually high estimated workload",
    suggestedAction: "Review whether this workload is intentional and recoverable.",
  },
  MOVEMENT_REDUNDANCY: {
    tier: "COACHING_OBSERVATION",
    title: "Similar movement patterns",
    suggestedAction: "Keep the overlap if it is intentional; no change is required.",
  },
  MISSING_COVERAGE: {
    tier: "COACHING_OBSERVATION",
    title: "No estimated coverage",
    suggestedAction: "Keep this choice if it is intentional; no change is required.",
  },
  THIN_COVERAGE: {
    tier: "COACHING_OBSERVATION",
    title: "Thin estimated coverage",
    suggestedAction: "Keep this choice if it is intentional; no change is required.",
  },
} as const satisfies Record<HypertrophyPlanHealthIssueCode, IssuePolicy>;

const KNOWN_ISSUE_CODES = new Set<string>(HYPERTROPHY_PLAN_HEALTH_ISSUE_CODES);

export function classifyHypertrophyPlanHealthIssue(input: {
  code: string;
  existingBlocking: boolean;
}): Exclude<HypertrophyPlanHealthTier, "INFORMATIONAL_ESTIMATE"> {
  if (KNOWN_ISSUE_CODES.has(input.code)) {
    return HYPERTROPHY_PLAN_HEALTH_ISSUE_POLICY[
      input.code as HypertrophyPlanHealthIssueCode
    ].tier;
  }
  return input.existingBlocking ? "BLOCKING_SAFETY" : "IMPORTANT_WARNING";
}

export type ClassifiedHypertrophyPlanHealthIssue = {
  code: string;
  tier: Exclude<HypertrophyPlanHealthTier, "INFORMATIONAL_ESTIMATE">;
  title: string;
  explanation: string;
  suggestedAction: string;
  affected?: {
    session?: string;
    exercise?: string;
    muscle?: string;
  };
  blocksFinalization: boolean;
  requiresAcknowledgment: boolean;
};

export type HypertrophyPlanHealthAssessment = {
  status: "AVAILABLE";
  policyVersion: typeof HYPERTROPHY_PLAN_HEALTH_POLICY_VERSION;
  draftId: string;
  draftRevision: number;
  evaluatedWeek: number | null;
  summary: {
    blockingSafety: number;
    importantWarnings: number;
    coachingObservations: number;
    informationalVolumeAvailable: boolean;
  };
  issues: ClassifiedHypertrophyPlanHealthIssue[];
  volumeEstimates: Array<{
    tier: "INFORMATIONAL_ESTIMATE";
    muscle: string;
    directSets: number;
    effectiveSets: number;
    frequency: number;
    referenceRange: { min: number; max: number } | null;
  }>;
  sessionEstimates: Array<{
    session: string;
    estimatedMinutes: number;
  }>;
  evaluatedFacts: {
    catalogExerciseCount: number;
    equipmentProfile: string;
    recognizedLimitationCount: number;
    unrecognizedLimitationsPresent: boolean;
  };
};

export type HypertrophyPlanHealthUnavailable = {
  status: "UNAVAILABLE";
  policyVersion: typeof HYPERTROPHY_PLAN_HEALTH_POLICY_VERSION;
  draftId: string;
  draftRevision: number;
  reason: "EVALUATION_FAILED" | "RESULT_INVALID";
};

export type HypertrophyPlanHealthResult =
  | HypertrophyPlanHealthAssessment
  | HypertrophyPlanHealthUnavailable;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isHypertrophyPlanHealthResult(
  value: unknown,
): value is HypertrophyPlanHealthResult {
  if (
    !isRecord(value) ||
    value.policyVersion !== HYPERTROPHY_PLAN_HEALTH_POLICY_VERSION ||
    typeof value.draftId !== "string" ||
    !Number.isInteger(value.draftRevision) ||
    (value.draftRevision as number) < 1
  ) {
    return false;
  }
  if (value.status === "UNAVAILABLE") {
    return value.reason === "EVALUATION_FAILED" || value.reason === "RESULT_INVALID";
  }
  if (
    value.status !== "AVAILABLE" ||
    !(value.evaluatedWeek === null || Number.isInteger(value.evaluatedWeek)) ||
    !isRecord(value.summary) ||
    !isFiniteNonnegative(value.summary.blockingSafety) ||
    !isFiniteNonnegative(value.summary.importantWarnings) ||
    !isFiniteNonnegative(value.summary.coachingObservations) ||
    typeof value.summary.informationalVolumeAvailable !== "boolean" ||
    !Array.isArray(value.issues) ||
    !Array.isArray(value.volumeEstimates) ||
    !Array.isArray(value.sessionEstimates) ||
    !isRecord(value.evaluatedFacts)
  ) {
    return false;
  }
  const issues = value.issues as unknown[];
  const issueTiers = new Set<string>([
    "BLOCKING_SAFETY",
    "IMPORTANT_WARNING",
    "COACHING_OBSERVATION",
  ]);
  const issuesValid = issues.every(
      (issue) =>
        isRecord(issue) &&
        typeof issue.code === "string" &&
        issue.code.length > 0 &&
        typeof issue.title === "string" &&
        typeof issue.explanation === "string" &&
        typeof issue.suggestedAction === "string" &&
        issueTiers.has(String(issue.tier)) &&
        typeof issue.blocksFinalization === "boolean" &&
        typeof issue.requiresAcknowledgment === "boolean" &&
        issue.blocksFinalization === (issue.tier === "BLOCKING_SAFETY") &&
        issue.requiresAcknowledgment === (issue.tier === "IMPORTANT_WARNING"),
    );
  if (!issuesValid) return false;
  const count = (tier: string) =>
    issues.filter((issue) => isRecord(issue) && issue.tier === tier).length;
  return (
    value.summary.blockingSafety === count("BLOCKING_SAFETY") &&
    value.summary.importantWarnings === count("IMPORTANT_WARNING") &&
    value.summary.coachingObservations === count("COACHING_OBSERVATION") &&
    value.summary.informationalVolumeAvailable === (value.volumeEstimates.length > 0) &&
    value.volumeEstimates.every(
      (estimate) =>
        isRecord(estimate) &&
        estimate.tier === "INFORMATIONAL_ESTIMATE" &&
        typeof estimate.muscle === "string" &&
        isFiniteNonnegative(estimate.directSets) &&
        isFiniteNonnegative(estimate.effectiveSets) &&
        isFiniteNonnegative(estimate.frequency) &&
        (estimate.referenceRange === null ||
          (isRecord(estimate.referenceRange) &&
            isFiniteNonnegative(estimate.referenceRange.min) &&
            isFiniteNonnegative(estimate.referenceRange.max) &&
            estimate.referenceRange.min <= estimate.referenceRange.max)),
    ) &&
    value.sessionEstimates.every(
      (estimate) =>
        isRecord(estimate) &&
        typeof estimate.session === "string" &&
        isFiniteNonnegative(estimate.estimatedMinutes),
    ) &&
    isFiniteNonnegative(value.evaluatedFacts.catalogExerciseCount) &&
    typeof value.evaluatedFacts.equipmentProfile === "string" &&
    isFiniteNonnegative(value.evaluatedFacts.recognizedLimitationCount) &&
    typeof value.evaluatedFacts.unrecognizedLimitationsPresent === "boolean"
  );
}

const TIER_ORDER = new Map<HypertrophyPlanHealthTier, number>(
  HYPERTROPHY_PLAN_HEALTH_TIERS.map((tier, index) => [tier, index]),
);

function coverageExplanation(finding: HypertrophyPlanHealthFinding): string {
  const muscle = finding.muscleId
    ? MUSCLE_POLICY_BY_ID[finding.muscleId].displayName
    : null;
  if (finding.code === "MISSING_COVERAGE" && finding.muscleId === "calves") {
    return "No direct calf work. That may be intentional because calves are not a stated plan priority.";
  }
  if (muscle) {
    const coverage =
      finding.code === "MISSING_COVERAGE"
        ? "has no estimated work"
        : "is thin";
    return `Estimated ${muscle.toLowerCase()} coverage ${coverage}. That may be intentional; approximate volume is not a quota.`;
  }
  return finding.message;
}

function issuePresentation(
  finding: HypertrophyPlanHealthFinding,
  existingBlocking: boolean,
): Pick<ClassifiedHypertrophyPlanHealthIssue, "tier" | "title" | "suggestedAction"> {
  if (KNOWN_ISSUE_CODES.has(finding.code)) {
    return HYPERTROPHY_PLAN_HEALTH_ISSUE_POLICY[
      finding.code as HypertrophyPlanHealthIssueCode
    ];
  }
  const tier = classifyHypertrophyPlanHealthIssue({
    code: finding.code,
    existingBlocking,
  });
  return {
    tier,
    title: existingBlocking ? "Safety issue needs review" : "Plan issue needs review",
    suggestedAction: "Review this issue before finalizing.",
  };
}

export function buildHypertrophyPlanHealthAssessment(input: {
  draftId: string;
  draftRevision: number;
  evaluatedWeek: number | null;
  health: HypertrophyPlanHealth;
  catalogExerciseCount: number;
  equipmentProfile: string;
  recognizedLimitationCount: number;
  unrecognizedLimitationsPresent: boolean;
  sessionNameBySlotId: ReadonlyMap<string, string>;
  exerciseNameById: ReadonlyMap<string, string>;
}): HypertrophyPlanHealthAssessment {
  const classified = [
    ...input.health.blockers.map((finding) => ({ finding, existingBlocking: true })),
    ...input.health.warnings.map((finding) => ({ finding, existingBlocking: false })),
  ].map(({ finding, existingBlocking }) => {
    const presentation = issuePresentation(finding, existingBlocking);
    const muscle = finding.muscleId
      ? MUSCLE_POLICY_BY_ID[finding.muscleId].displayName
      : undefined;
    const session = finding.slotId
      ? input.sessionNameBySlotId.get(finding.slotId)
      : undefined;
    const exercise = finding.exerciseId
      ? input.exerciseNameById.get(finding.exerciseId)
      : undefined;
    const affected = {
      ...(session ? { session } : {}),
      ...(exercise ? { exercise } : {}),
      ...(muscle ? { muscle } : {}),
    };
    return {
      code: finding.code,
      tier: presentation.tier,
      title:
        finding.code === "MISSING_COVERAGE" && finding.muscleId === "calves"
          ? "No direct calf work"
          : presentation.title,
      explanation:
        finding.code === "MISSING_COVERAGE" || finding.code === "THIN_COVERAGE"
          ? coverageExplanation(finding)
          : finding.message,
      suggestedAction: presentation.suggestedAction,
      ...(Object.values(affected).some(Boolean) ? { affected } : {}),
      blocksFinalization: presentation.tier === "BLOCKING_SAFETY",
      requiresAcknowledgment: presentation.tier === "IMPORTANT_WARNING",
    } satisfies ClassifiedHypertrophyPlanHealthIssue;
  });

  classified.sort(
    (left, right) =>
      (TIER_ORDER.get(left.tier) ?? Number.MAX_SAFE_INTEGER) -
        (TIER_ORDER.get(right.tier) ?? Number.MAX_SAFE_INTEGER) ||
      left.code.localeCompare(right.code) ||
      (left.affected?.session ?? "").localeCompare(right.affected?.session ?? "") ||
      (left.affected?.exercise ?? "").localeCompare(right.affected?.exercise ?? "") ||
      left.explanation.localeCompare(right.explanation),
  );

  const volumeEstimates = input.health.muscles
    .filter((muscle) => muscle.effectiveSets > 0 || muscle.directSets > 0)
    .map((muscle) => {
      const policy = MUSCLE_POLICY_BY_ID[muscle.muscleId];
      return {
        tier: "INFORMATIONAL_ESTIMATE" as const,
        muscle: policy.displayName,
        directSets: muscle.directSets,
        effectiveSets: muscle.effectiveSets,
        frequency: muscle.frequency,
        referenceRange:
          policy.volume.mev > 0
            ? { min: policy.volume.mev, max: policy.volume.mrv }
            : null,
      };
    });

  return {
    status: "AVAILABLE",
    policyVersion: HYPERTROPHY_PLAN_HEALTH_POLICY_VERSION,
    draftId: input.draftId,
    draftRevision: input.draftRevision,
    evaluatedWeek: input.evaluatedWeek,
    summary: {
      blockingSafety: classified.filter((issue) => issue.tier === "BLOCKING_SAFETY").length,
      importantWarnings: classified.filter((issue) => issue.tier === "IMPORTANT_WARNING").length,
      coachingObservations: classified.filter(
        (issue) => issue.tier === "COACHING_OBSERVATION",
      ).length,
      informationalVolumeAvailable: volumeEstimates.length > 0,
    },
    issues: classified,
    volumeEstimates,
    sessionEstimates: input.health.sessions.map((session) => ({
      session: input.sessionNameBySlotId.get(session.slotId) ?? "Session",
      estimatedMinutes: session.estimatedMinutes,
    })),
    evaluatedFacts: {
      catalogExerciseCount: input.catalogExerciseCount,
      equipmentProfile: input.equipmentProfile,
      recognizedLimitationCount: input.recognizedLimitationCount,
      unrecognizedLimitationsPresent: input.unrecognizedLimitationsPresent,
    },
  };
}

export function healthRequiresWarningConfirmation(
  health: HypertrophyPlanHealthAssessment,
): boolean {
  return health.summary.importantWarnings > 0;
}
