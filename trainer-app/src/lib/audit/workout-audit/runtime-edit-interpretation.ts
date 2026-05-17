import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import { normalizeExposedMuscle } from "@/lib/engine/volume-landmarks";
import type { SessionAuditMutationSummary } from "@/lib/evidence/session-audit-types";
import type {
  RuntimeEditOperation,
  RuntimeEditReconciliation,
} from "@/lib/ui/selection-metadata";
import type {
  RuntimeEditConfidence,
  RuntimeEditIntent,
  RuntimeEditInterpretation,
} from "./types";

export type RuntimeEditExerciseContext = {
  exerciseId: string;
  exerciseName?: string;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  aliases?: string[];
};

export type RuntimeEditTargetContext = {
  muscle: string;
  actualEffectiveSets: number;
  weeklyTarget: number;
  mev: number;
};

export type ExplicitRuntimeEditSignal = {
  opKind?: string;
  exerciseId?: string;
  workoutExerciseId?: string;
  intent: Extract<RuntimeEditIntent, "pain_avoidance" | "fatigue_adjustment">;
  evidence: string;
};

export type RuntimeEditInterpretationInput = {
  runtimeEditReconciliation?: RuntimeEditReconciliation;
  exerciseContexts?: Iterable<RuntimeEditExerciseContext>;
  targetContext?: RuntimeEditTargetContext[];
  weeklyOpportunity?: {
    isFinalAdvancingSession: boolean;
  };
  legacyReconciliation?: SessionAuditMutationSummary;
  explicitSignals?: ExplicitRuntimeEditSignal[];
};

function normalizeMuscles(muscles: Iterable<string>): string[] {
  return Array.from(
    new Set(
      Array.from(muscles)
        .map((muscle) => normalizeExposedMuscle(muscle))
        .filter((muscle) => muscle.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function buildExerciseMap(
  contexts: Iterable<RuntimeEditExerciseContext> | undefined
): Map<string, RuntimeEditExerciseContext> {
  return new Map(
    Array.from(contexts ?? []).map((context) => [context.exerciseId, context])
  );
}

function buildTargetMap(
  targetContext: RuntimeEditTargetContext[] | undefined
): Map<string, RuntimeEditTargetContext> {
  return new Map(
    (targetContext ?? []).map((target) => [
      normalizeExposedMuscle(target.muscle),
      {
        ...target,
        muscle: normalizeExposedMuscle(target.muscle),
      },
    ])
  );
}

function getOpExerciseId(operation: RuntimeEditOperation): string | undefined {
  if (operation.kind === "replace_exercise") {
    return operation.facts.toExerciseId;
  }
  if (operation.kind === "rewrite_structure") {
    return undefined;
  }
  return operation.facts.exerciseId;
}

function getOpWorkoutExerciseId(operation: RuntimeEditOperation): string | undefined {
  if (operation.kind === "rewrite_structure") {
    return undefined;
  }
  return operation.facts.workoutExerciseId;
}

function findExplicitSignal(input: {
  operation: RuntimeEditOperation;
  signals: ExplicitRuntimeEditSignal[];
}): ExplicitRuntimeEditSignal | undefined {
  const exerciseId = getOpExerciseId(input.operation);
  const workoutExerciseId = getOpWorkoutExerciseId(input.operation);
  return input.signals.find((signal) => {
    if (signal.opKind && signal.opKind !== input.operation.kind) {
      return false;
    }
    if (signal.exerciseId && signal.exerciseId !== exerciseId) {
      return false;
    }
    if (signal.workoutExerciseId && signal.workoutExerciseId !== workoutExerciseId) {
      return false;
    }
    return true;
  });
}

function explicitIntentFromPersistedReason(reason: unknown): ExplicitRuntimeEditSignal | undefined {
  if (typeof reason !== "string") {
    return undefined;
  }

  const normalized = reason.toLowerCase();
  if (normalized.includes("pain") || normalized.includes("injury")) {
    return {
      intent: "pain_avoidance",
      evidence: `explicit_reason:${reason}`,
    };
  }
  if (normalized.includes("fatigue") || normalized.includes("tired")) {
    return {
      intent: "fatigue_adjustment",
      evidence: `explicit_reason:${reason}`,
    };
  }
  return undefined;
}

function getSetDelta(operation: RuntimeEditOperation): number {
  if (operation.kind === "add_exercise") {
    return operation.facts.setCount;
  }
  if (operation.kind === "add_set") {
    return 1;
  }
  if (operation.kind === "remove_exercise") {
    return -operation.facts.setCount;
  }
  return 0;
}

function getExerciseMuscles(input: {
  exerciseId: string | undefined;
  exerciseMap: Map<string, RuntimeEditExerciseContext>;
  setDelta: number;
}): string[] {
  if (!input.exerciseId) {
    return [];
  }

  const context = input.exerciseMap.get(input.exerciseId);
  if (!context) {
    return [];
  }

  const effective = getEffectiveStimulusByMuscle(
    {
      id: context.exerciseId,
      name: context.exerciseName ?? context.exerciseId,
      primaryMuscles: context.primaryMuscles ?? [],
      secondaryMuscles: context.secondaryMuscles ?? [],
      aliases: context.aliases ?? [],
    },
    Math.max(1, Math.abs(input.setDelta)),
    { logFallback: false }
  );

  if (effective.size > 0) {
    return normalizeMuscles(effective.keys());
  }

  return normalizeMuscles([
    ...(context.primaryMuscles ?? []),
    ...(context.secondaryMuscles ?? []),
  ]);
}

function findTargetGapEvidence(input: {
  muscles: string[];
  targetMap: Map<string, RuntimeEditTargetContext>;
  contributionByMuscle: Map<string, number>;
}): string[] {
  const evidence: string[] = [];
  for (const muscle of input.muscles) {
    const target = input.targetMap.get(muscle);
    if (!target) {
      continue;
    }
    const contribution = input.contributionByMuscle.get(muscle) ?? 0;
    const inferredBefore = target.actualEffectiveSets - contribution;
    if (inferredBefore < target.weeklyTarget || inferredBefore < target.mev) {
      evidence.push(
        `${muscle}: inferred_before=${roundToTenth(inferredBefore)} target=${roundToTenth(target.weeklyTarget)} mev=${roundToTenth(target.mev)}`
      );
    }
  }
  return evidence;
}

function findFinalMevClosureEvidence(input: {
  muscles: string[];
  targetMap: Map<string, RuntimeEditTargetContext>;
  contributionByMuscle: Map<string, number>;
}): string[] {
  const evidence: string[] = [];
  for (const muscle of input.muscles) {
    const target = input.targetMap.get(muscle);
    if (!target || target.mev <= 0) {
      continue;
    }
    const contribution = input.contributionByMuscle.get(muscle) ?? 0;
    if (contribution <= 0) {
      continue;
    }
    const inferredBefore = target.actualEffectiveSets - contribution;
    if (inferredBefore < target.mev && target.actualEffectiveSets >= target.mev) {
      evidence.push(
        `${muscle}: inferred_before=${roundToTenth(inferredBefore)} mev=${roundToTenth(target.mev)} final=${roundToTenth(target.actualEffectiveSets)} contribution=${roundToTenth(contribution)}`
      );
    }
  }
  return evidence;
}

function buildContributionByMuscle(input: {
  exerciseId: string | undefined;
  exerciseMap: Map<string, RuntimeEditExerciseContext>;
  setDelta: number;
}): Map<string, number> {
  if (!input.exerciseId || input.setDelta <= 0) {
    return new Map();
  }

  const context = input.exerciseMap.get(input.exerciseId);
  if (!context) {
    return new Map();
  }

  const contribution = getEffectiveStimulusByMuscle(
    {
      id: context.exerciseId,
      name: context.exerciseName ?? context.exerciseId,
      primaryMuscles: context.primaryMuscles ?? [],
      secondaryMuscles: context.secondaryMuscles ?? [],
      aliases: context.aliases ?? [],
    },
    input.setDelta,
    { logFallback: false }
  );

  return new Map(
    Array.from(contribution.entries()).map(([muscle, value]) => [
      normalizeExposedMuscle(muscle),
      value,
    ])
  );
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function isLikelyLowFatigueTopUp(context: RuntimeEditExerciseContext | undefined): boolean {
  if (!context) {
    return false;
  }

  const text = [context.exerciseName, ...(context.aliases ?? [])]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  const highFatiguePatterns = [
    "deadlift",
    "squat",
    "split squat",
    "lunge",
    "bench",
    "row",
    "pulldown",
    "pull-up",
    "chin-up",
    "leg press",
    "shoulder press",
    "overhead press",
  ];
  if (highFatiguePatterns.some((pattern) => text.includes(pattern))) {
    return false;
  }

  const isolationPatterns = [
    "curl",
    "extension",
    "raise",
    "fly",
    "pec deck",
    "pushdown",
    "pressdown",
    "calf",
    "leg curl",
    "face pull",
  ];
  return isolationPatterns.some((pattern) => text.includes(pattern));
}

function classifyPositiveAddition(input: {
  operation: RuntimeEditOperation;
  setDelta: number;
  muscles: string[];
  exerciseContext: RuntimeEditExerciseContext | undefined;
  targetMap: Map<string, RuntimeEditTargetContext>;
  contributionByMuscle: Map<string, number>;
  weeklyOpportunity?: RuntimeEditInterpretationInput["weeklyOpportunity"];
  hasConflictingStructuralSignal: boolean;
}): {
  intent: RuntimeEditIntent;
  confidence: RuntimeEditConfidence;
  evidence: string[];
} {
  if (input.muscles.length === 0 || input.targetMap.size === 0) {
    return {
      intent: "unclassified",
      confidence: "low",
      evidence: [
        input.muscles.length === 0
          ? "missing_exercise_muscle_mapping"
          : "missing_weekly_target_context",
      ],
    };
  }

  const gapEvidence = findTargetGapEvidence({
    muscles: input.muscles,
    targetMap: input.targetMap,
    contributionByMuscle: input.contributionByMuscle,
  });
  const finalMevClosureEvidence = findFinalMevClosureEvidence({
    muscles: input.muscles,
    targetMap: input.targetMap,
    contributionByMuscle: input.contributionByMuscle,
  });

  const meetsSetThreshold =
    input.operation.kind === "add_set" || input.setDelta >= 2;
  if (
    input.weeklyOpportunity?.isFinalAdvancingSession === true &&
    finalMevClosureEvidence.length > 0 &&
    meetsSetThreshold &&
    isLikelyLowFatigueTopUp(input.exerciseContext) &&
    !input.hasConflictingStructuralSignal
  ) {
    return {
      intent: "final_weekly_opportunity_mev_closure",
      confidence: "high",
      evidence: [
        "final advancing session top-up closed an inferred pre-session MEV floor",
        "classification is read-only and does not mutate seed, replay, or weekly volume math",
        ...finalMevClosureEvidence,
      ],
    };
  }

  if (
    gapEvidence.length > 0 &&
    meetsSetThreshold &&
    !input.hasConflictingStructuralSignal
  ) {
    return {
      intent: "target_gap_closure",
      confidence: "high",
      evidence: [
        "added work maps to an under-target muscle before/at the edit",
        ...gapEvidence,
      ],
    };
  }

  return {
    intent: "opportunistic_extra",
    confidence: "medium",
    evidence: [
      gapEvidence.length > 0
        ? "partial target-gap evidence present"
        : "muscle mapping and target context present, but strong target-gap criteria were not met",
    ],
  };
}

function interpretPersistedOperation(input: {
  operation: RuntimeEditOperation;
  operations: RuntimeEditOperation[];
  exerciseMap: Map<string, RuntimeEditExerciseContext>;
  targetMap: Map<string, RuntimeEditTargetContext>;
  weeklyOpportunity?: RuntimeEditInterpretationInput["weeklyOpportunity"];
  explicitSignals: ExplicitRuntimeEditSignal[];
  hasConflictingStructuralSignal: boolean;
}): RuntimeEditInterpretation {
  const operation = input.operation;
  const exerciseId = getOpExerciseId(operation);
  const workoutExerciseId = getOpWorkoutExerciseId(operation);
  const setDelta = getSetDelta(operation);
  const muscles = getExerciseMuscles({
    exerciseId,
    exerciseMap: input.exerciseMap,
    setDelta,
  });
  const explicitSignal =
    findExplicitSignal({ operation, signals: input.explicitSignals }) ??
    (operation.kind === "replace_exercise"
      ? explicitIntentFromPersistedReason(operation.facts.reason)
      : undefined);

  if (explicitSignal && operation.kind !== "replace_exercise") {
    return {
      opKind: operation.kind,
      intent: explicitSignal.intent,
      confidence: "high",
      source: "persisted_op",
      setDelta,
      exerciseId,
      workoutExerciseId,
      muscles,
      timing: "unknown",
      evidence: [explicitSignal.evidence],
    };
  }

  if (operation.kind === "replace_exercise") {
    return {
      opKind: operation.kind,
      intent: "substitution",
      confidence: "high",
      source: "persisted_op",
      setDelta: 0,
      exerciseId: operation.facts.toExerciseId,
      workoutExerciseId: operation.facts.workoutExerciseId,
      muscles,
      timing: "unknown",
      evidence: [
        `from:${operation.facts.fromExerciseName ?? operation.facts.fromExerciseId}`,
        `to:${operation.facts.toExerciseName ?? operation.facts.toExerciseId}`,
        `reason:${operation.facts.reason}`,
      ],
    };
  }

  if (operation.kind === "add_exercise" || operation.kind === "add_set") {
    const contributionByMuscle = buildContributionByMuscle({
      exerciseId,
      exerciseMap: input.exerciseMap,
      setDelta,
    });
    const classification = classifyPositiveAddition({
      operation,
      setDelta,
      muscles,
      exerciseContext: exerciseId ? input.exerciseMap.get(exerciseId) : undefined,
      targetMap: input.targetMap,
      contributionByMuscle,
      weeklyOpportunity: input.weeklyOpportunity,
      hasConflictingStructuralSignal: input.hasConflictingStructuralSignal,
    });

    return {
      opKind: operation.kind,
      intent: classification.intent,
      confidence: classification.confidence,
      source: "persisted_op",
      setDelta,
      exerciseId,
      workoutExerciseId,
      muscles,
      timing: "unknown",
      evidence: classification.evidence,
    };
  }

  if (operation.kind === "remove_exercise") {
    return {
      opKind: operation.kind,
      intent: "unclassified",
      confidence: "low",
      source: "persisted_op",
      setDelta,
      exerciseId,
      workoutExerciseId,
      muscles,
      timing: "unknown",
      evidence: ["runtime removal has no explicit pain/fatigue or substitution intent"],
    };
  }

  if (operation.kind === "rewrite_structure") {
    if (isRewriteCoveredBySpecificOps(operation, input.operations)) {
      return {
        opKind: operation.kind,
        intent: "opportunistic_extra",
        confidence: "medium",
        source: "persisted_op",
        setDelta,
        muscles: [],
        timing: "unknown",
        evidence: [
          `changed_fields:${operation.facts.changedFields.join(",") || "none"}`,
          "structure rewrite is covered by specific runtime edit ops in the same ledger",
        ],
      };
    }

    return {
      opKind: operation.kind,
      intent: "unclassified",
      confidence: "low",
      source: "persisted_op",
      setDelta,
      muscles: [],
      timing: "unknown",
      evidence: [
        `changed_fields:${operation.facts.changedFields.join(",") || "none"}`,
        "structure rewrite cannot be safely explained from persisted op facts alone",
      ],
    };
  }

  const unreachable: never = operation;
  void unreachable;
  return {
    opKind: "unknown",
    intent: "unclassified",
    confidence: "low",
    source: "persisted_op",
    setDelta,
    muscles,
    timing: "unknown",
    evidence: ["unsupported runtime edit op kind"],
  };
}

function isRewriteCoveredBySpecificOps(
  operation: Extract<RuntimeEditOperation, { kind: "rewrite_structure" }>,
  operations: RuntimeEditOperation[]
): boolean {
  const coveredAdded = new Set<string>();
  const coveredRemoved = new Set<string>();
  const coveredSetOrPrescriptionChanges = new Set<string>();
  for (const op of operations) {
    if (op.kind === "add_exercise") {
      coveredAdded.add(op.facts.exerciseId);
    }
    if (op.kind === "add_set") {
      coveredSetOrPrescriptionChanges.add(op.facts.exerciseId);
    }
    if (op.kind === "remove_exercise") {
      coveredRemoved.add(op.facts.exerciseId);
    }
    if (op.kind === "replace_exercise") {
      coveredRemoved.add(op.facts.fromExerciseId);
      coveredAdded.add(op.facts.toExerciseId);
      coveredSetOrPrescriptionChanges.add(op.facts.toExerciseId);
    }
  }

  const facts = operation.facts;
  return (
    facts.addedExerciseIds.every((exerciseId) => coveredAdded.has(exerciseId)) &&
    facts.removedExerciseIds.every((exerciseId) => coveredRemoved.has(exerciseId)) &&
    facts.exercisesWithSetCountChanges.every((exerciseId) =>
      coveredSetOrPrescriptionChanges.has(exerciseId)
    ) &&
    facts.exercisesWithPrescriptionChanges.every((exerciseId) =>
      coveredSetOrPrescriptionChanges.has(exerciseId)
    )
  );
}

function buildLegacyInterpretations(input: {
  legacyReconciliation: SessionAuditMutationSummary | undefined;
  exerciseMap: Map<string, RuntimeEditExerciseContext>;
  targetMap: Map<string, RuntimeEditTargetContext>;
}): RuntimeEditInterpretation[] {
  const reconciliation = input.legacyReconciliation;
  if (!reconciliation?.hasDrift) {
    return [];
  }

  const addedExerciseIds = reconciliation.addedExerciseIds ?? [];
  const changedFields = reconciliation.changedFields ?? [];
  const addedMuscles = normalizeMuscles(
    addedExerciseIds.flatMap((exerciseId) =>
      getExerciseMuscles({
        exerciseId,
        exerciseMap: input.exerciseMap,
        setDelta: 1,
      })
    )
  );
  const strongTargetEvidence = findTargetGapEvidence({
    muscles: addedMuscles,
    targetMap: input.targetMap,
    contributionByMuscle: new Map(addedMuscles.map((muscle) => [muscle, 1])),
  });

  return [{
    opKind: "legacy_reconciliation",
    intent:
      addedMuscles.length > 0 && strongTargetEvidence.length > 0
        ? "target_gap_closure"
        : "unclassified",
    confidence:
      addedMuscles.length > 0 && strongTargetEvidence.length > 0 ? "low" : "low",
    source: "legacy_reconstructed",
    setDelta: 0,
    muscles: addedMuscles,
    timing: "unknown",
    evidence: [
      `changed_fields:${changedFields.join(",") || "none"}`,
      "no runtimeEditReconciliation ops were persisted",
      ...strongTargetEvidence,
    ],
  }];
}

export function interpretRuntimeEdits(
  input: RuntimeEditInterpretationInput
): RuntimeEditInterpretation[] {
  const exerciseMap = buildExerciseMap(input.exerciseContexts);
  const targetMap = buildTargetMap(input.targetContext);
  const ops = input.runtimeEditReconciliation?.ops ?? [];

  if (ops.length === 0) {
    return buildLegacyInterpretations({
      legacyReconciliation: input.legacyReconciliation,
      exerciseMap,
      targetMap,
    });
  }

  const hasConflictingStructuralSignal = ops.some(
    (operation) =>
      operation.kind === "remove_exercise" ||
      operation.kind === "replace_exercise"
  );

  return ops.map((operation) =>
    interpretPersistedOperation({
      operation,
      operations: ops,
      exerciseMap,
      targetMap,
      weeklyOpportunity: input.weeklyOpportunity,
      explicitSignals: input.explicitSignals ?? [],
      hasConflictingStructuralSignal,
    })
  );
}
