import type { WorkoutExplanation, SessionContext } from "@/lib/engine/explainability";
import { explainSessionContext } from "@/lib/engine/explainability";
import { getPeriodizationModifiers } from "@/lib/engine/rules";
import type { PrimaryGoal } from "@/lib/engine/types";
import type { DeloadDecision } from "@/lib/evidence/types";
import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import { buildLifecyclePeriodization } from "../mesocycle-lifecycle-math";
import type { loadCurrentBlockContext } from "../periodization";

const HOURS_PER_DAY = 24;

type LoadedBlockContext = Awaited<ReturnType<typeof loadCurrentBlockContext>>;
type ResolvedSessionDecisionReceipt = NonNullable<ReturnType<typeof readSessionDecisionReceipt>>;

export type SessionEvidence = {
  sessionDecisionReceipt?: ResolvedSessionDecisionReceipt;
  cycleContext?: ResolvedSessionDecisionReceipt["cycleContext"];
  sorenessSuppressedMuscles: string[];
  deloadDecision: DeloadDecision | null;
  readinessScaledExerciseIds: Set<string>;
  hasRecentReadinessSignal: boolean;
  signalAgeDays?: number;
  hasSessionDecisionReceipt: boolean;
};

function toSignalAgeDays(signalAgeHours: number | null | undefined): number | undefined {
  if (typeof signalAgeHours !== "number" || !Number.isFinite(signalAgeHours)) {
    return undefined;
  }
  return Math.max(0, Math.floor(signalAgeHours / HOURS_PER_DAY));
}

export function buildExplanationPeriodization(input: {
  blockContext: LoadedBlockContext["blockContext"];
  weekInMeso: number;
  sessionDecisionReceipt?: ResolvedSessionDecisionReceipt;
  mappedPrimaryGoal: PrimaryGoal;
}) {
  const { blockContext, weekInMeso, sessionDecisionReceipt, mappedPrimaryGoal } = input;
  const cycleContext = sessionDecisionReceipt?.cycleContext;

  if (cycleContext && mappedPrimaryGoal === "hypertrophy") {
    return {
      periodization: buildLifecyclePeriodization({
        primaryGoal: mappedPrimaryGoal,
        durationWeeks: cycleContext.mesocycleLength ?? Math.max(4, cycleContext.weekInMeso),
        week: cycleContext.weekInMeso,
        isDeload: cycleContext.isDeload,
        rirTarget: sessionDecisionReceipt?.lifecycleRirTarget,
      }),
      blockType: cycleContext.blockType,
      weekInMesocycle: cycleContext.weekInMeso,
    };
  }

  if (blockContext) {
    return {
      periodization: getPeriodizationModifiers(
        blockContext.weekInBlock,
        blockContext.macroCycle.primaryGoal === "general_fitness"
          ? "hypertrophy"
          : blockContext.macroCycle.primaryGoal,
        blockContext.macroCycle.trainingAge
      ),
      blockType: blockContext.block.blockType,
      weekInMesocycle: weekInMeso,
    };
  }

  return {
    periodization: undefined,
    blockType: undefined,
    weekInMesocycle: weekInMeso,
  };
}

export function buildSessionEvidence(input: { selectionMetadata: unknown }): SessionEvidence {
  const sessionDecisionReceipt = readSessionDecisionReceipt(input.selectionMetadata);
  const signalAgeDays = toSignalAgeDays(sessionDecisionReceipt?.readiness.signalAgeHours);

  return {
    sessionDecisionReceipt,
    cycleContext: sessionDecisionReceipt?.cycleContext,
    sorenessSuppressedMuscles: sessionDecisionReceipt?.sorenessSuppressedMuscles ?? [],
    deloadDecision: sessionDecisionReceipt?.deloadDecision ?? null,
    readinessScaledExerciseIds: new Set(
      sessionDecisionReceipt?.readiness.intensityScaling.exerciseIds ?? []
    ),
    hasRecentReadinessSignal: signalAgeDays != null && signalAgeDays <= 0,
    signalAgeDays,
    hasSessionDecisionReceipt: Boolean(sessionDecisionReceipt),
  };
}

export function buildSessionContextFromEvidence(input: {
  blockContext: LoadedBlockContext["blockContext"];
  volumeByMuscle: Map<string, number>;
  sessionEvidence: SessionEvidence;
  sessionIntent?: string | null;
}): SessionContext {
  const { blockContext, volumeByMuscle, sessionEvidence, sessionIntent } = input;

  return explainSessionContext({
    blockContext,
    cycleContext: sessionEvidence.cycleContext,
    volumeByMuscle,
    sorenessSuppressedMuscles: sessionEvidence.sorenessSuppressedMuscles,
    intensityScaling: sessionEvidence.sessionDecisionReceipt?.readiness.intensityScaling,
    fatigueScore: undefined,
    modifications: undefined,
    signalAge: sessionEvidence.signalAgeDays,
    hasRecentReadinessSignal: sessionEvidence.hasRecentReadinessSignal,
    sessionIntent: sessionIntent?.toLowerCase() as "push" | "pull" | "legs" | undefined,
  });
}

export function deriveExplainabilityConfidence(input: {
  hasReadinessSignal: boolean;
  hasBlockContext: boolean;
  hasSessionDecisionReceipt: boolean;
  hasStoredSelectionRationale: boolean;
  hasDerivedWorkoutStats: boolean;
}): WorkoutExplanation["confidence"] {
  const missingSignals: string[] = [];
  if (!input.hasReadinessSignal) {
    missingSignals.push("same-day readiness check-in");
  }
  if (!input.hasBlockContext && !input.hasSessionDecisionReceipt) {
    missingSignals.push("receipt-backed cycle context");
  }
  if (!input.hasStoredSelectionRationale) {
    missingSignals.push("stored exercise selection reasons");
  }
  if (!input.hasDerivedWorkoutStats) {
    missingSignals.push("recent performance-derived workout stats");
  }

  const level: WorkoutExplanation["confidence"]["level"] =
    missingSignals.length === 0 ? "high" : missingSignals.length === 1 ? "medium" : "low";
  const summary =
    level === "high"
      ? "Evidence is complete enough to explain this session without major guesswork."
      : level === "medium"
      ? `Most of the session evidence is present; one signal is being approximated (${missingSignals[0]}).`
      : "Several inputs are missing, so this audit can only explain part of the session with confidence.";

  return { level, summary, missingSignals };
}
