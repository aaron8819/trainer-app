import type {
  ProjectedWeekVolumeExerciseSummary,
  ProjectedWeekVolumeMuscleRow,
  ProjectedWeekVolumeSessionSummary,
} from "./projected-week-volume";
import { roundToTenth } from "./volume-read-model-helpers";

export const MIN_MEANINGFUL_FUTURE_EFFECTIVE_SETS = 0.5;
export const MAX_WEEKLY_CLOSURE_ADDITIONAL_SETS = 5;

const PULL_DENSITY_RESTRICTION_COUNT = 4;
const NEAR_MAV_COLLATERAL_BUFFER = 2;
const ALWAYS_FORBIDDEN_MOVEMENT_CLASSES = [
  "horizontal_push",
  "vertical_push",
  "squat",
  "hinge",
  "lunge",
] as const;

const CANDIDATE_NAME_TOKENS_BY_MUSCLE: Record<string, readonly string[]> = {
  Chest: ["fly", "crossover", "pec deck"],
  Lats: ["pulldown", "pull-down", "pullup", "pull-up", "chin-up", "chinup", "pullover", "row"],
  "Upper Back": ["row", "face pull", "rear delt", "reverse fly", "reverse pec", "pulldown", "pull-down"],
  Quads: ["leg extension"],
  Hamstrings: ["leg curl", "hamstring curl"],
  Glutes: ["glute kickback", "hip thrust", "glute bridge", "pull-through", "reverse hyper"],
  "Side Delts": ["lateral raise", "side raise"],
  "Rear Delts": ["rear delt", "reverse fly", "reverse pec", "face pull"],
  Biceps: ["curl"],
  Triceps: ["pushdown", "pressdown", "triceps extension", "skull crusher"],
  Calves: ["calf"],
};

export type WeeklyMuscleClosureStatus =
  | "not_needed"
  | "not_final_opportunity"
  | "suppressed"
  | "eligible"
  | "no_valid_candidate";

export type WeeklyMuscleClosureDecision = {
  muscle: string;
  status: WeeklyMuscleClosureStatus;
  evidence: {
    performedEffectiveSets: number;
    projectedCurrentSessionEffectiveSets: number;
    projectedLaterEffectiveSets: number;
    projectedWeekEffectiveSets: number;
    mev: number;
    deficitToMev: number;
  };
  opportunity: {
    isFinalMeaningfulOpportunity: boolean;
    minimumMeaningfulContribution: number;
    currentSlotId: string | null;
    currentEvidenceSource:
      | ProjectedWeekVolumeSessionSummary["evidenceSource"]
      | null;
    laterContributingSlots: Array<{
      slotId: string | null;
      projectedContribution: number;
      evidenceSource:
        | ProjectedWeekVolumeSessionSummary["evidenceSource"]
        | null;
    }>;
  };
  constraints: {
    hardSuppressed: boolean;
    forbiddenMovementClasses: string[];
    permittedMovementClasses: string[];
    forbiddenExerciseIds: string[];
    maxAdditionalSets: number;
    reasons: string[];
    candidateFilterReasons: Array<{
      exerciseId: string;
      exerciseName: string;
      reasons: string[];
    }>;
  };
  recommendation?: {
    exerciseId: string;
    exerciseName: string;
    movementClass: string;
    sourceSlotId: string | null;
    additionalSets: number;
    effectiveSetsPerRawSet: number;
    projectedContribution: number;
  };
};

export type WeeklyMuscleClosureDecisionInput = {
  fullWeekByMuscle: ProjectedWeekVolumeMuscleRow[];
  projectedSessions: ProjectedWeekVolumeSessionSummary[];
  hardSuppressionReasonsByMuscle?: Record<string, string[]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isEvidenceSource(value: unknown): boolean {
  return (
    value === null ||
    value === "immutable_workout_snapshot" ||
    value === "accepted_seed_runtime_projection" ||
    value === "current_policy_projection"
  );
}

export function isWeeklyMuscleClosureDecision(
  value: unknown
): value is WeeklyMuscleClosureDecision {
  if (!isRecord(value)) {
    return false;
  }
  const evidence = value.evidence;
  const opportunity = value.opportunity;
  const constraints = value.constraints;
  const recommendation = value.recommendation;
  const validStatus = [
    "not_needed",
    "not_final_opportunity",
    "suppressed",
    "eligible",
    "no_valid_candidate",
  ].includes(String(value.status));
  const validEvidence =
    isRecord(evidence) &&
    [
      evidence.performedEffectiveSets,
      evidence.projectedCurrentSessionEffectiveSets,
      evidence.projectedLaterEffectiveSets,
      evidence.projectedWeekEffectiveSets,
      evidence.mev,
      evidence.deficitToMev,
    ].every(isFiniteNumber);
  const validOpportunity =
    isRecord(opportunity) &&
    typeof opportunity.isFinalMeaningfulOpportunity === "boolean" &&
    isFiniteNumber(opportunity.minimumMeaningfulContribution) &&
    (opportunity.currentSlotId === null ||
      typeof opportunity.currentSlotId === "string") &&
    isEvidenceSource(opportunity.currentEvidenceSource) &&
    Array.isArray(opportunity.laterContributingSlots) &&
    opportunity.laterContributingSlots.every(
      (slot) =>
        isRecord(slot) &&
        (slot.slotId === null || typeof slot.slotId === "string") &&
        isFiniteNumber(slot.projectedContribution) &&
        isEvidenceSource(slot.evidenceSource)
    );
  const validConstraints =
    isRecord(constraints) &&
    typeof constraints.hardSuppressed === "boolean" &&
    isStringArray(constraints.forbiddenMovementClasses) &&
    isStringArray(constraints.permittedMovementClasses) &&
    isStringArray(constraints.forbiddenExerciseIds) &&
    isFiniteNumber(constraints.maxAdditionalSets) &&
    isStringArray(constraints.reasons) &&
    Array.isArray(constraints.candidateFilterReasons) &&
    constraints.candidateFilterReasons.every(
      (row) =>
        isRecord(row) &&
        typeof row.exerciseId === "string" &&
        typeof row.exerciseName === "string" &&
        isStringArray(row.reasons)
    );
  const validRecommendation =
    recommendation == null ||
    (isRecord(recommendation) &&
      typeof recommendation.exerciseId === "string" &&
      typeof recommendation.exerciseName === "string" &&
      typeof recommendation.movementClass === "string" &&
      (recommendation.sourceSlotId === null ||
        typeof recommendation.sourceSlotId === "string") &&
      isFiniteNumber(recommendation.additionalSets) &&
      isFiniteNumber(recommendation.effectiveSetsPerRawSet) &&
      isFiniteNumber(recommendation.projectedContribution));

  const recommendationMatchesStatus =
    value.status === "eligible"
      ? isRecord(recommendation) &&
        opportunity != null &&
        isRecord(opportunity) &&
        opportunity.isFinalMeaningfulOpportunity === true &&
        constraints != null &&
        isRecord(constraints) &&
        constraints.hardSuppressed === false &&
        isFiniteNumber(recommendation.additionalSets) &&
        recommendation.additionalSets > 0 &&
        isFiniteNumber(recommendation.projectedContribution) &&
        recommendation.projectedContribution > 0
      : recommendation == null;

  return (
    typeof value.muscle === "string" &&
    validStatus &&
    validEvidence &&
    validOpportunity &&
    validConstraints &&
    validRecommendation &&
    recommendationMatchesStatus
  );
}

type Candidate = {
  exercise: ProjectedWeekVolumeExerciseSummary;
  movementClass: string;
  movementClasses: string[];
  effectiveSetsPerRawSet: number;
  score: number;
};

function getAvailableCurrentSession(
  sessions: ProjectedWeekVolumeSessionSummary[]
): ProjectedWeekVolumeSessionSummary | undefined {
  return sessions.find((session) => session.isNext) ?? sessions[0];
}

function isAvailableSession(session: ProjectedWeekVolumeSessionSummary): boolean {
  return (session.availability ?? "available") === "available";
}

function inferMovementClass(exerciseName: string): string {
  const name = exerciseName.toLowerCase();
  if (name.includes("press") || name.includes("bench")) {
    return name.includes("overhead") || name.includes("shoulder")
      ? "vertical_push"
      : "horizontal_push";
  }
  if (
    name.includes("pulldown") ||
    name.includes("pull-down") ||
    name.includes("pull-up") ||
    name.includes("pullup") ||
    name.includes("chin-up") ||
    name.includes("chinup")
  ) {
    return "vertical_pull";
  }
  if (name.includes("row") || name.includes("face pull")) {
    return "horizontal_pull";
  }
  if (name.includes("deadlift") || name.includes("rdl")) {
    return "hinge";
  }
  if (name.includes("squat") || name.includes("leg press")) {
    return "squat";
  }
  if (name.includes("lunge") || name.includes("split squat")) {
    return "lunge";
  }
  return "isolation";
}

function getMovementClasses(
  exercise: ProjectedWeekVolumeExerciseSummary
): string[] {
  const classes = (exercise.movementPatterns ?? []).filter(Boolean);
  return classes.length > 0 ? Array.from(new Set(classes)) : [inferMovementClass(exercise.name)];
}

function getDisplayedMovementClass(classes: string[]): string {
  return classes.find((movementClass) => movementClass !== "isolation") ?? classes[0] ?? "isolation";
}

function getForbiddenMovementClasses(
  currentSession: ProjectedWeekVolumeSessionSummary | undefined
): string[] {
  const forbidden = new Set<string>(ALWAYS_FORBIDDEN_MOVEMENT_CLASSES);
  const pullCount =
    (currentSession?.movementPatternCounts?.horizontal_pull ?? 0) +
    (currentSession?.movementPatternCounts?.vertical_pull ?? 0);
  if (pullCount >= PULL_DENSITY_RESTRICTION_COUNT) {
    forbidden.add("horizontal_pull");
    forbidden.add("vertical_pull");
  }
  return Array.from(forbidden).sort();
}

function getPermittedMovementClasses(forbiddenMovementClasses: string[]): string[] {
  return ["isolation", "horizontal_pull", "vertical_pull"].filter(
    (movementClass) => !forbiddenMovementClasses.includes(movementClass)
  );
}

function matchesCandidateFamily(muscle: string, exerciseName: string): boolean {
  const tokens = CANDIDATE_NAME_TOKENS_BY_MUSCLE[muscle];
  if (!tokens) {
    return false;
  }
  const normalized = exerciseName.toLowerCase();
  return tokens.some((token) => normalized.includes(token));
}

function getCandidatePriority(muscle: string, exerciseName: string): number {
  const tokens = CANDIDATE_NAME_TOKENS_BY_MUSCLE[muscle] ?? [];
  const normalized = exerciseName.toLowerCase();
  const index = tokens.findIndex((token) => normalized.includes(token));
  return index < 0 ? 0 : (tokens.length - index) * 10;
}

function getEffectiveSetsPerRawSet(
  exercise: ProjectedWeekVolumeExerciseSummary,
  muscle: string
): number {
  if (exercise.setCount <= 0) {
    return 0;
  }
  return roundToTenth(
    (exercise.effectiveStimulusByMuscle?.[muscle] ?? 0) / exercise.setCount
  );
}

function getCandidateFilterReasons(input: {
  muscle: string;
  exercise: ProjectedWeekVolumeExerciseSummary;
  movementClasses: string[];
  forbiddenMovementClasses: string[];
  rowByMuscle: Map<string, ProjectedWeekVolumeMuscleRow>;
  hardSuppressionReasonsByMuscle: Record<string, string[]>;
}): string[] {
  const reasons: string[] = [];
  if (!matchesCandidateFamily(input.muscle, input.exercise.name)) {
    reasons.push("incompatible_closure_candidate_family");
  }
  for (const movementClass of input.movementClasses) {
    if (input.forbiddenMovementClasses.includes(movementClass)) {
      reasons.push(`forbidden_movement_class:${movementClass}`);
    }
  }

  for (const [collateralMuscle, totalEffectiveSets] of Object.entries(
    input.exercise.effectiveStimulusByMuscle ?? {}
  )) {
    if (collateralMuscle === input.muscle || totalEffectiveSets <= 0) {
      continue;
    }
    if ((input.hardSuppressionReasonsByMuscle[collateralMuscle] ?? []).length > 0) {
      reasons.push(`collateral_hard_suppression:${collateralMuscle}`);
      continue;
    }
    const collateralRow = input.rowByMuscle.get(collateralMuscle);
    if (
      collateralRow &&
      collateralRow.projectedFullWeekEffectiveSets >=
        collateralRow.mav - NEAR_MAV_COLLATERAL_BUFFER
    ) {
      reasons.push(`collateral_near_or_over_mav:${collateralMuscle}`);
    }
  }

  return Array.from(new Set(reasons)).sort();
}

function buildCandidateState(input: {
  muscle: string;
  currentSession: ProjectedWeekVolumeSessionSummary | undefined;
  forbiddenMovementClasses: string[];
  rowByMuscle: Map<string, ProjectedWeekVolumeMuscleRow>;
  hardSuppressionReasonsByMuscle: Record<string, string[]>;
}): {
  selected: Candidate | null;
  forbiddenExerciseIds: string[];
  filterReasons: WeeklyMuscleClosureDecision["constraints"]["candidateFilterReasons"];
} {
  const candidates: Candidate[] = [];
  const forbiddenExerciseIds = new Set<string>();
  const filterReasons: WeeklyMuscleClosureDecision["constraints"]["candidateFilterReasons"] = [];

  for (const exercise of input.currentSession?.exercises ?? []) {
    const effectiveSetsPerRawSet = getEffectiveSetsPerRawSet(
      exercise,
      input.muscle
    );
    if (effectiveSetsPerRawSet <= 0) {
      continue;
    }
    const movementClasses = getMovementClasses(exercise);
    const reasons = getCandidateFilterReasons({
      muscle: input.muscle,
      exercise,
      movementClasses,
      forbiddenMovementClasses: input.forbiddenMovementClasses,
      rowByMuscle: input.rowByMuscle,
      hardSuppressionReasonsByMuscle: input.hardSuppressionReasonsByMuscle,
    });
    if (reasons.length > 0) {
      forbiddenExerciseIds.add(exercise.exerciseId);
      filterReasons.push({
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.name,
        reasons,
      });
      continue;
    }

    candidates.push({
      exercise,
      movementClass: getDisplayedMovementClass(movementClasses),
      movementClasses,
      effectiveSetsPerRawSet,
      score:
        (exercise.role === "accessory" ? 100 : 0) +
        getCandidatePriority(input.muscle, exercise.name) +
        effectiveSetsPerRawSet * 10 -
        exercise.setCount,
    });
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.effectiveSetsPerRawSet - left.effectiveSetsPerRawSet ||
      left.exercise.name.localeCompare(right.exercise.name) ||
      left.exercise.exerciseId.localeCompare(right.exercise.exerciseId)
  );
  filterReasons.sort(
    (left, right) =>
      left.exerciseName.localeCompare(right.exerciseName) ||
      left.exerciseId.localeCompare(right.exerciseId)
  );

  return {
    selected: candidates[0] ?? null,
    forbiddenExerciseIds: Array.from(forbiddenExerciseIds).sort(),
    filterReasons,
  };
}

function getLaterSessions(
  sessions: ProjectedWeekVolumeSessionSummary[],
  currentSession: ProjectedWeekVolumeSessionSummary | undefined
): ProjectedWeekVolumeSessionSummary[] {
  const currentIndex = currentSession ? sessions.indexOf(currentSession) : -1;
  return currentIndex >= 0 ? sessions.slice(currentIndex + 1) : sessions.slice(1);
}

function buildDecision(input: {
  row: ProjectedWeekVolumeMuscleRow;
  projectedSessions: ProjectedWeekVolumeSessionSummary[];
  rowByMuscle: Map<string, ProjectedWeekVolumeMuscleRow>;
  hardSuppressionReasonsByMuscle: Record<string, string[]>;
}): WeeklyMuscleClosureDecision {
  const currentSession = getAvailableCurrentSession(input.projectedSessions);
  const laterSessions = getLaterSessions(input.projectedSessions, currentSession);
  const reliableLaterSessions = laterSessions.filter(
    (session) => isAvailableSession(session) && session.evidenceReliable !== false
  );
  const laterContributingSlots = reliableLaterSessions.flatMap((session) => {
    const contribution = roundToTenth(
      session.projectedContributionByMuscle[input.row.muscle] ?? 0
    );
    return contribution >= MIN_MEANINGFUL_FUTURE_EFFECTIVE_SETS
      ? [
          {
            slotId: session.slotId,
            projectedContribution: contribution,
            evidenceSource: session.evidenceSource ?? null,
          },
        ]
      : [];
  });
  const projectedLaterEffectiveSets = roundToTenth(
    reliableLaterSessions.reduce(
      (sum, session) =>
        sum + (session.projectedContributionByMuscle[input.row.muscle] ?? 0),
      0
    )
  );
  const deficitToMev = roundToTenth(
    Math.max(0, input.row.mev - input.row.projectedFullWeekEffectiveSets)
  );
  const forbiddenMovementClasses = getForbiddenMovementClasses(currentSession);
  const permittedMovementClasses = getPermittedMovementClasses(
    forbiddenMovementClasses
  );
  const targetSuppressionReasons = [
    ...(input.hardSuppressionReasonsByMuscle[input.row.muscle] ?? []),
  ];
  const invalidEvidenceReasons: string[] = [];
  const hasUnreliableCurrentEvidence =
    currentSession != null &&
    (!isAvailableSession(currentSession) ||
      currentSession.evidenceReliable === false);
  if (hasUnreliableCurrentEvidence) {
    invalidEvidenceReasons.push("insufficient_current_session_evidence");
  }
  if (
    laterSessions.some(
      (session) =>
        isAvailableSession(session) &&
        session.evidenceReliable === false &&
        (session.projectedContributionByMuscle[input.row.muscle] ?? 0) >=
          MIN_MEANINGFUL_FUTURE_EFFECTIVE_SETS
    )
  ) {
    invalidEvidenceReasons.push("unreliable_later_opportunity_evidence");
  }
  const allSuppressionReasons = [
    ...invalidEvidenceReasons,
    ...targetSuppressionReasons,
  ];

  const base: WeeklyMuscleClosureDecision = {
    muscle: input.row.muscle,
    status: "not_needed",
    evidence: {
      performedEffectiveSets: roundToTenth(
        input.row.completedEffectiveSets +
          (input.row.incompletePerformedEffectiveSets ?? 0)
      ),
      projectedCurrentSessionEffectiveSets: roundToTenth(
        currentSession?.projectedContributionByMuscle[input.row.muscle] ?? 0
      ),
      projectedLaterEffectiveSets,
      projectedWeekEffectiveSets: roundToTenth(
        input.row.projectedFullWeekEffectiveSets
      ),
      mev: input.row.mev,
      deficitToMev,
    },
    opportunity: {
      isFinalMeaningfulOpportunity: laterContributingSlots.length === 0,
      minimumMeaningfulContribution:
        MIN_MEANINGFUL_FUTURE_EFFECTIVE_SETS,
      currentSlotId: currentSession?.slotId ?? null,
      currentEvidenceSource: currentSession?.evidenceSource ?? null,
      laterContributingSlots,
    },
    constraints: {
      hardSuppressed: allSuppressionReasons.length > 0,
      forbiddenMovementClasses,
      permittedMovementClasses,
      forbiddenExerciseIds: [],
      maxAdditionalSets: MAX_WEEKLY_CLOSURE_ADDITIONAL_SETS,
      reasons: Array.from(new Set(allSuppressionReasons)).sort(),
      candidateFilterReasons: [],
    },
  };

  if (invalidEvidenceReasons.length > 0) {
    return { ...base, status: "suppressed" };
  }
  if (deficitToMev <= 0) {
    return base;
  }
  if (laterContributingSlots.length > 0) {
    return { ...base, status: "not_final_opportunity" };
  }
  if (targetSuppressionReasons.length > 0) {
    return { ...base, status: "suppressed" };
  }

  const candidateState = buildCandidateState({
    muscle: input.row.muscle,
    currentSession,
    forbiddenMovementClasses,
    rowByMuscle: input.rowByMuscle,
    hardSuppressionReasonsByMuscle: input.hardSuppressionReasonsByMuscle,
  });
  const candidateReasons = candidateState.filterReasons.flatMap(
    (row) => row.reasons
  );
  const constrainedBase: WeeklyMuscleClosureDecision = {
    ...base,
    constraints: {
      ...base.constraints,
      forbiddenExerciseIds: candidateState.forbiddenExerciseIds,
      candidateFilterReasons: candidateState.filterReasons,
      reasons: Array.from(
        new Set([...base.constraints.reasons, ...candidateReasons])
      ).sort(),
    },
  };
  if (!candidateState.selected) {
    return { ...constrainedBase, status: "no_valid_candidate" };
  }

  const additionalSets = Math.min(
    MAX_WEEKLY_CLOSURE_ADDITIONAL_SETS,
    Math.max(
      1,
      Math.ceil(deficitToMev / candidateState.selected.effectiveSetsPerRawSet)
    )
  );

  return {
    ...constrainedBase,
    status: "eligible",
    recommendation: {
      exerciseId: candidateState.selected.exercise.exerciseId,
      exerciseName: candidateState.selected.exercise.name,
      movementClass: candidateState.selected.movementClass,
      sourceSlotId: currentSession?.slotId ?? null,
      additionalSets,
      effectiveSetsPerRawSet:
        candidateState.selected.effectiveSetsPerRawSet,
      projectedContribution: roundToTenth(
        additionalSets * candidateState.selected.effectiveSetsPerRawSet
      ),
    },
  };
}

export function buildWeeklyMuscleClosureDecisions(
  input: WeeklyMuscleClosureDecisionInput
): WeeklyMuscleClosureDecision[] {
  const hardSuppressionReasonsByMuscle =
    input.hardSuppressionReasonsByMuscle ?? {};
  const rowByMuscle = new Map(
    input.fullWeekByMuscle.map((row) => [row.muscle, row])
  );

  return input.fullWeekByMuscle.map((row) =>
    buildDecision({
      row,
      projectedSessions: input.projectedSessions,
      rowByMuscle,
      hardSuppressionReasonsByMuscle,
    })
  );
}
