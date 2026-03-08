import type { TemplateIntent } from "@/lib/api/templates";
import type { SessionIntent } from "@/lib/engine/session-types";
import type { Exercise, Muscle } from "@/lib/engine/types";
import { MUSCLE_SPLIT_MAP } from "@/lib/engine/volume-landmarks";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";

type OpportunityBucket = "push" | "pull" | "legs";

export type SessionOpportunityCharacter =
  | "upper"
  | "lower"
  | "full_body"
  | "specialized";

export type SessionOpportunityRegion = "upper" | "lower";

export type SessionInventoryKind = "standard" | "closure" | "rescue";

type InventoryEligibilityRule =
  | { kind: "default_alignment" }
  | { kind: "target_muscles_primary" }
  | { kind: "target_muscles_stimulus"; minimumStimulusPerSet: number };

export type SessionAnchorPolicy = {
  coreMinimumSets: number;
  accessoryMinimumSets: number;
  coreDeferredDeficitCarryFraction: number;
  accessoryDeferredDeficitCarryFraction: number;
  supplementalInventory: Extract<SessionInventoryKind, "standard" | "closure">;
};

type ExerciseAlignmentRule =
  | {
      kind: "split_tags";
      splitTags: OpportunityBucket[];
    }
  | {
      kind: "regions";
      include: SessionOpportunityRegion[];
      exclude?: SessionOpportunityRegion[];
    }
  | {
      kind: "target_muscles";
      requireTargets: boolean;
    };

type MuscleOpportunityRule =
  | {
      kind: "split_weights";
      weights: Partial<Record<OpportunityBucket, number>>;
    }
  | {
      kind: "target_muscles";
      targetWeight: number;
      fallbackWeightWhenTargetsMissing: number;
    };

export type SessionOpportunityDefinition = {
  intent: SessionIntent;
  character: SessionOpportunityCharacter;
  alignment: ExerciseAlignmentRule;
  inventory: Record<SessionInventoryKind, InventoryEligibilityRule>;
  sessionMuscleOpportunity: MuscleOpportunityRule;
  futureMuscleOpportunity: MuscleOpportunityRule;
  requiredCoverageRegions: SessionOpportunityRegion[];
  anchorPolicy: SessionAnchorPolicy;
  templateIntentPriority: TemplateIntent[];
};

const SESSION_INTENTS = [
  "push",
  "pull",
  "legs",
  "upper",
  "lower",
  "full_body",
  "body_part",
] as const satisfies readonly SessionIntent[];

export const SESSION_INTENT_KEYS = [...SESSION_INTENTS];

const DEFAULT_ANCHOR_POLICY: SessionAnchorPolicy = {
  coreMinimumSets: 1,
  accessoryMinimumSets: 0,
  coreDeferredDeficitCarryFraction: 0.4,
  accessoryDeferredDeficitCarryFraction: 0.25,
  supplementalInventory: "closure",
};

const SESSION_OPPORTUNITY_DEFINITIONS: Record<SessionIntent, SessionOpportunityDefinition> = {
  push: {
    intent: "push",
    character: "upper",
    alignment: { kind: "split_tags", splitTags: ["push"] },
    inventory: {
      standard: { kind: "default_alignment" },
      closure: { kind: "default_alignment" },
      rescue: { kind: "default_alignment" },
    },
    sessionMuscleOpportunity: { kind: "split_weights", weights: { push: 1 } },
    futureMuscleOpportunity: { kind: "split_weights", weights: { push: 1 } },
    requiredCoverageRegions: [],
    anchorPolicy: DEFAULT_ANCHOR_POLICY,
    templateIntentPriority: ["PUSH_PULL_LEGS", "CUSTOM", "UPPER_LOWER", "FULL_BODY", "BODY_PART"],
  },
  pull: {
    intent: "pull",
    character: "upper",
    alignment: { kind: "split_tags", splitTags: ["pull"] },
    inventory: {
      standard: { kind: "default_alignment" },
      closure: { kind: "default_alignment" },
      rescue: { kind: "default_alignment" },
    },
    sessionMuscleOpportunity: { kind: "split_weights", weights: { pull: 1 } },
    futureMuscleOpportunity: { kind: "split_weights", weights: { pull: 1 } },
    requiredCoverageRegions: [],
    anchorPolicy: DEFAULT_ANCHOR_POLICY,
    templateIntentPriority: ["PUSH_PULL_LEGS", "CUSTOM", "UPPER_LOWER", "FULL_BODY", "BODY_PART"],
  },
  legs: {
    intent: "legs",
    character: "lower",
    alignment: { kind: "split_tags", splitTags: ["legs"] },
    inventory: {
      standard: { kind: "default_alignment" },
      closure: { kind: "default_alignment" },
      rescue: { kind: "default_alignment" },
    },
    sessionMuscleOpportunity: { kind: "split_weights", weights: { legs: 1 } },
    futureMuscleOpportunity: { kind: "split_weights", weights: { legs: 1 } },
    requiredCoverageRegions: [],
    anchorPolicy: DEFAULT_ANCHOR_POLICY,
    templateIntentPriority: ["PUSH_PULL_LEGS", "CUSTOM", "UPPER_LOWER", "FULL_BODY", "BODY_PART"],
  },
  upper: {
    intent: "upper",
    character: "upper",
    alignment: { kind: "regions", include: ["upper"], exclude: ["lower"] },
    inventory: {
      standard: { kind: "default_alignment" },
      closure: { kind: "default_alignment" },
      rescue: { kind: "default_alignment" },
    },
    sessionMuscleOpportunity: { kind: "split_weights", weights: { push: 0.8, pull: 0.8 } },
    futureMuscleOpportunity: { kind: "split_weights", weights: { push: 0.8, pull: 0.8 } },
    requiredCoverageRegions: [],
    anchorPolicy: DEFAULT_ANCHOR_POLICY,
    templateIntentPriority: ["UPPER_LOWER", "FULL_BODY", "CUSTOM", "PUSH_PULL_LEGS", "BODY_PART"],
  },
  lower: {
    intent: "lower",
    character: "lower",
    alignment: { kind: "regions", include: ["lower"] },
    inventory: {
      standard: { kind: "default_alignment" },
      closure: { kind: "default_alignment" },
      rescue: { kind: "default_alignment" },
    },
    sessionMuscleOpportunity: { kind: "split_weights", weights: { legs: 0.85 } },
    futureMuscleOpportunity: { kind: "split_weights", weights: { legs: 0.85 } },
    requiredCoverageRegions: [],
    anchorPolicy: DEFAULT_ANCHOR_POLICY,
    templateIntentPriority: ["UPPER_LOWER", "FULL_BODY", "CUSTOM", "PUSH_PULL_LEGS", "BODY_PART"],
  },
  full_body: {
    intent: "full_body",
    character: "full_body",
    alignment: { kind: "regions", include: ["upper", "lower"] },
    inventory: {
      standard: { kind: "default_alignment" },
      closure: { kind: "default_alignment" },
      rescue: { kind: "default_alignment" },
    },
    sessionMuscleOpportunity: {
      kind: "split_weights",
      weights: { push: 0.65, pull: 0.65, legs: 0.55 },
    },
    futureMuscleOpportunity: {
      kind: "split_weights",
      weights: { push: 0.65, pull: 0.65, legs: 0.55 },
    },
    requiredCoverageRegions: ["upper", "lower"],
    anchorPolicy: DEFAULT_ANCHOR_POLICY,
    templateIntentPriority: ["FULL_BODY", "CUSTOM", "UPPER_LOWER", "PUSH_PULL_LEGS", "BODY_PART"],
  },
  body_part: {
    intent: "body_part",
    character: "specialized",
    alignment: { kind: "target_muscles", requireTargets: true },
    inventory: {
      standard: { kind: "target_muscles_primary" },
      closure: { kind: "target_muscles_stimulus", minimumStimulusPerSet: 0.25 },
      rescue: { kind: "target_muscles_stimulus", minimumStimulusPerSet: 0.25 },
    },
    sessionMuscleOpportunity: {
      kind: "target_muscles",
      targetWeight: 1,
      fallbackWeightWhenTargetsMissing: 1,
    },
    futureMuscleOpportunity: {
      kind: "split_weights",
      weights: { push: 0.35, pull: 0.35, legs: 0.35 },
    },
    requiredCoverageRegions: [],
    anchorPolicy: DEFAULT_ANCHOR_POLICY,
    templateIntentPriority: ["BODY_PART", "CUSTOM", "PUSH_PULL_LEGS", "UPPER_LOWER", "FULL_BODY"],
  },
};

const NORMALIZED_MUSCLE_BUCKET_MAP = new Map<string, OpportunityBucket>(
  Object.entries(MUSCLE_SPLIT_MAP).map(([muscle, bucket]) => [normalizeMuscleName(muscle), bucket])
);

export function normalizeMuscleName(muscle: string): string {
  return muscle.trim().toLowerCase();
}

function toTargetSet(targetMuscles?: string[]): Set<string> {
  return new Set((targetMuscles ?? []).map(normalizeMuscleName));
}

function getMuscleBucket(muscle: string): OpportunityBucket | undefined {
  return NORMALIZED_MUSCLE_BUCKET_MAP.get(normalizeMuscleName(muscle));
}

export function buildSessionIntentRecord<T>(
  createValue: (intent: SessionIntent) => T
): Record<SessionIntent, T> {
  return Object.fromEntries(
    SESSION_INTENT_KEYS.map((intent) => [intent, createValue(intent)])
  ) as Record<SessionIntent, T>;
}

export function parseSessionIntent(
  value: string | null | undefined
): SessionIntent | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return SESSION_INTENT_KEYS.includes(normalized as SessionIntent)
    ? (normalized as SessionIntent)
    : null;
}

export function getSessionOpportunityDefinition(
  intent: SessionIntent
): SessionOpportunityDefinition {
  return SESSION_OPPORTUNITY_DEFINITIONS[intent];
}

export function exerciseMatchesOpportunityRegion(
  exercise: Exercise,
  region: SessionOpportunityRegion
): boolean {
  const expectedBucket = region === "upper" ? ["push", "pull"] : ["legs"];
  if (exercise.splitTags.some((tag) => expectedBucket.includes(tag as OpportunityBucket))) {
    return true;
  }

  return (exercise.primaryMuscles ?? []).some((muscle) => {
    const bucket = getMuscleBucket(muscle);
    if (!bucket) {
      return false;
    }
    return region === "upper" ? bucket !== "legs" : bucket === "legs";
  });
}

export function isExerciseAlignedToSessionOpportunity(
  exercise: Exercise,
  intent: SessionIntent,
  targetMuscles?: string[]
): boolean {
  const definition = getSessionOpportunityDefinition(intent);
  const targetSet = toTargetSet(targetMuscles);

  switch (definition.alignment.kind) {
    case "split_tags":
      return definition.alignment.splitTags.some((splitTag) => exercise.splitTags.includes(splitTag));
    case "regions": {
      const included = definition.alignment.include.some((region) =>
        exerciseMatchesOpportunityRegion(exercise, region)
      );
      if (!included) {
        return false;
      }
      return !(definition.alignment.exclude ?? []).some((region) =>
        exerciseMatchesOpportunityRegion(exercise, region)
      );
    }
    case "target_muscles":
      if (definition.alignment.requireTargets && targetSet.size === 0) {
        return false;
      }
      return (exercise.primaryMuscles ?? []).some((muscle) =>
        targetSet.has(normalizeMuscleName(muscle))
      );
    default:
      return false;
  }
}

function matchesTargetMusclesByPrimary(
  exercise: Exercise,
  targetSet: Set<string>
): boolean {
  if (targetSet.size === 0) {
    return false;
  }
  return (exercise.primaryMuscles ?? []).some((muscle) =>
    targetSet.has(normalizeMuscleName(muscle))
  );
}

function matchesTargetMusclesByStimulus(
  exercise: Exercise,
  targetSet: Set<string>,
  minimumStimulusPerSet: number
): boolean {
  if (targetSet.size === 0) {
    return false;
  }
  return Array.from(getEffectiveStimulusByMuscle(exercise, 1, { logFallback: false }).entries()).some(
    ([muscle, effectiveSets]) =>
      effectiveSets >= minimumStimulusPerSet &&
      targetSet.has(normalizeMuscleName(muscle))
  );
}

export function isExerciseEligibleForSessionInventory(
  exercise: Exercise,
  intent: SessionIntent,
  inventoryKind: SessionInventoryKind,
  targetMuscles?: string[]
): boolean {
  const definition = getSessionOpportunityDefinition(intent);
  const targetSet = toTargetSet(targetMuscles);
  const rule = definition.inventory[inventoryKind];

  switch (rule.kind) {
    case "default_alignment":
      return isExerciseAlignedToSessionOpportunity(exercise, intent, targetMuscles);
    case "target_muscles_primary":
      return matchesTargetMusclesByPrimary(exercise, targetSet);
    case "target_muscles_stimulus":
      return matchesTargetMusclesByStimulus(exercise, targetSet, rule.minimumStimulusPerSet);
    default:
      return false;
  }
}

export function filterPoolForSessionInventory(
  exercisePool: Exercise[],
  intent: SessionIntent,
  inventoryKind: SessionInventoryKind,
  targetMuscles?: string[]
): Exercise[] {
  return exercisePool.filter((exercise) =>
    isExerciseEligibleForSessionInventory(exercise, intent, inventoryKind, targetMuscles)
  );
}

function resolveOpportunityWeight(
  rule: MuscleOpportunityRule,
  muscle: string,
  targetSet: Set<string>
): number {
  switch (rule.kind) {
    case "split_weights": {
      const bucket = getMuscleBucket(muscle);
      return bucket ? (rule.weights[bucket] ?? 0) : 0;
    }
    case "target_muscles":
      if (targetSet.size === 0) {
        return rule.fallbackWeightWhenTargetsMissing;
      }
      return targetSet.has(normalizeMuscleName(muscle)) ? rule.targetWeight : 0;
    default:
      return 0;
  }
}

export function getSessionMuscleOpportunityWeight(
  intent: SessionIntent,
  muscle: Muscle | string,
  options?: {
    targetMuscles?: string[];
    purpose?: "session" | "future_slot";
  }
): number {
  const definition = getSessionOpportunityDefinition(intent);
  const rule =
    options?.purpose === "future_slot"
      ? definition.futureMuscleOpportunity
      : definition.sessionMuscleOpportunity;
  return resolveOpportunityWeight(rule, muscle, toTargetSet(options?.targetMuscles));
}

export function getRequiredCoverageRegions(
  intent: SessionIntent
): SessionOpportunityRegion[] {
  return getSessionOpportunityDefinition(intent).requiredCoverageRegions;
}

export function getSessionAnchorPolicy(
  intent: SessionIntent
): SessionAnchorPolicy {
  return getSessionOpportunityDefinition(intent).anchorPolicy;
}

export function getTemplateIntentPriorityForSessionIntent(
  intent: SessionIntent
): TemplateIntent[] {
  return getSessionOpportunityDefinition(intent).templateIntentPriority;
}

export function inferPrimarySplitIntentFromExercises(
  exercises: Array<Pick<Exercise, "splitTags">>
): SessionIntent {
  const counts: Record<OpportunityBucket, number> = { push: 0, pull: 0, legs: 0 };
  for (const exercise of exercises) {
    for (const tag of exercise.splitTags ?? []) {
      if (tag === "push" || tag === "pull" || tag === "legs") {
        counts[tag] += 1;
      }
    }
  }

  const ranked = (Object.keys(counts) as OpportunityBucket[]).sort(
    (left, right) => counts[right] - counts[left]
  );
  return counts[ranked[0]] > 0 ? ranked[0] : "full_body";
}

const LOWER_TARGET_MUSCLES = new Set([
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "adductors",
  "abductors",
]);

export function inferUpperLowerIntentFromTargets(
  targetMuscles: string[]
): Extract<SessionIntent, "upper" | "lower"> {
  const hasLowerTarget = targetMuscles.some((muscle) =>
    LOWER_TARGET_MUSCLES.has(normalizeMuscleName(muscle))
  );
  return hasLowerTarget ? "lower" : "upper";
}
