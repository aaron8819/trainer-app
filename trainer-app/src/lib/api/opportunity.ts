import { computeFatigueScore } from "@/lib/engine/readiness/compute-fatigue";
import type { ReadinessSignal } from "@/lib/engine/readiness/types";
import type { RecentMuscleStimulus } from "./recent-muscle-stimulus";

export type OpportunityState =
  | "high_opportunity"
  | "moderate_opportunity"
  | "covered"
  | "deprioritize_today";

export type MuscleOpportunity = {
  score: number;
  state: OpportunityState;
  rationale: string;
};

type OpportunityInput = {
  muscle: string;
  targetEffectiveSets: number;
  weeklyEffectiveSets: number;
  recentStimulus: RecentMuscleStimulus;
  readinessSignal?: ReadinessSignal | null;
};

type ReadinessModulation = {
  factor: number;
  kind: "none" | "severe_local_soreness" | "low_overall_readiness";
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function resolveSorenessKeysForMuscle(muscle: string): string[] {
  const normalized = normalizeKey(muscle);
  if (normalized === "chest") return ["chest"];
  if (["lats", "upper back", "rear delts", "lower back"].includes(normalized)) {
    return ["back"];
  }
  if (["front delts", "side delts"].includes(normalized)) {
    return ["shoulders"];
  }
  if (
    ["quads", "hamstrings", "glutes", "calves", "adductors", "abductors"].includes(normalized)
  ) {
    return ["legs"];
  }
  if (["biceps", "triceps", "forearms"].includes(normalized)) {
    return ["arms"];
  }
  return [normalized];
}

function resolveReadinessModulation(
  muscle: string,
  readinessSignal?: ReadinessSignal | null
): ReadinessModulation {
  if (!readinessSignal) {
    return { factor: 1, kind: "none" };
  }

  const sorenessKeys = new Set(resolveSorenessKeysForMuscle(muscle).map(normalizeKey));
  const hasSevereLocalSoreness = Object.entries(readinessSignal.subjective.soreness).some(
    ([key, level]) => sorenessKeys.has(normalizeKey(key)) && level >= 3
  );
  if (hasSevereLocalSoreness) {
    return { factor: 0.6, kind: "severe_local_soreness" };
  }

  const fatigueScore = computeFatigueScore(readinessSignal);
  if (fatigueScore.overall < 0.5) {
    return { factor: 0.8, kind: "low_overall_readiness" };
  }

  return { factor: 1, kind: "none" };
}

export function computeMuscleOpportunity(input: OpportunityInput): MuscleOpportunity {
  const deficit = Math.max(0, input.targetEffectiveSets - input.weeklyEffectiveSets);
  if (deficit <= 0) {
    return {
      score: 0,
      state: "covered",
      rationale: "Weekly target is already covered in this volume snapshot.",
    };
  }

  const pressure = clamp(deficit / Math.max(input.targetEffectiveSets, 1), 0, 1);
  const recencyFactor =
    input.recentStimulus.hoursSinceStimulus == null
      ? 1
      : clamp(
          input.recentStimulus.hoursSinceStimulus / Math.max(input.recentStimulus.sraHours, 1),
          0,
          1
        );
  const dosePenalty = clamp(
    input.recentStimulus.recentEffectiveSets / Math.max(input.targetEffectiveSets * 0.5, 1),
    0,
    1
  );
  const localOpportunity = recencyFactor * (1 - 0.5 * dosePenalty);
  const readinessMod = resolveReadinessModulation(input.muscle, input.readinessSignal);
  const score = roundToTenth(pressure * localOpportunity * readinessMod.factor);

  const shouldDeprioritize =
    deficit > 0 &&
    (readinessMod.factor < 1 || localOpportunity <= 0.35 || recencyFactor <= 0.25);
  if (shouldDeprioritize) {
    if (readinessMod.kind === "severe_local_soreness") {
      return {
        score,
        state: "deprioritize_today",
        rationale: "Below target in this snapshot, but fresh soreness points to a more conservative volume read.",
      };
    }
    if (readinessMod.kind === "low_overall_readiness") {
      return {
        score,
        state: "deprioritize_today",
        rationale: "Below target in this snapshot, but today's readiness signal points to a more conservative volume read.",
      };
    }
    return {
      score,
      state: "deprioritize_today",
      rationale: "Below target in this snapshot, but recent weighted stimulus is still fresh.",
    };
  }

  if (score >= 0.55 && pressure >= 0.4 && localOpportunity >= 0.6) {
    return {
      score,
      state: "high_opportunity",
      rationale: "Below target in this snapshot, with enough recovery room to consider more volume.",
    };
  }

  return {
    score,
    state: "moderate_opportunity",
    rationale: "Below target in this snapshot, but recent stimulus or readiness keeps the read mixed.",
  };
}
