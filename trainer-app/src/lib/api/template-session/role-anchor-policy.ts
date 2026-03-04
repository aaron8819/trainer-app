import type { SessionIntent } from "@/lib/engine/session-types";
import type { Exercise as EngineExercise, Muscle, MuscleId } from "@/lib/engine/types";
import {
  getEffectiveStimulusByMuscleId,
  toMuscleId,
  toMuscleLabel,
} from "@/lib/engine/stimulus";

type Role = "CORE_COMPOUND" | "ACCESSORY" | undefined;

export type RoleAnchor =
  | { kind: "muscle"; muscle: MuscleId }
  | { kind: "movement_pattern"; movementPattern: string };

type RoleAnchorExercise = Pick<
  EngineExercise,
  "id" | "name" | "movementPatterns" | "primaryMuscles" | "secondaryMuscles" | "stimulusProfile"
>;

type ResolveRoleAnchorInput = {
  exercise: RoleAnchorExercise;
  role: Role;
  sessionIntent: SessionIntent;
  weeklyTarget: Map<Muscle, number>;
};

function getPrimaryMuscleOrder(exercise: RoleAnchorExercise): Map<string, number> {
  const entries: Array<readonly [MuscleId, number]> = [];
  for (const [index, muscle] of (exercise.primaryMuscles ?? []).entries()) {
    const muscleId = toMuscleId(muscle);
    if (muscleId) {
      entries.push([muscleId, index] as const);
    }
  }
  return new Map(entries);
}

export function resolveRoleFixtureAnchor({
  exercise,
  role,
  sessionIntent,
  weeklyTarget,
}: ResolveRoleAnchorInput): RoleAnchor | undefined {
  if (!role) {
    return undefined;
  }

  const perSetStimulus = Array.from(getEffectiveStimulusByMuscleId(exercise, 1).entries()).filter(
    ([, effectiveSets]) => effectiveSets > 0
  );
  if (perSetStimulus.length === 0) {
    return undefined;
  }

  const primaryOrder = getPrimaryMuscleOrder(exercise);
  const ranked = perSetStimulus.sort(([leftMuscleId, leftWeight], [rightMuscleId, rightWeight]) => {
    const leftWeeklyTarget = weeklyTarget.get(toMuscleLabel(leftMuscleId)) ?? 0;
    const rightWeeklyTarget = weeklyTarget.get(toMuscleLabel(rightMuscleId)) ?? 0;
    const leftRelevant = leftWeeklyTarget > 0 ? 1 : 0;
    const rightRelevant = rightWeeklyTarget > 0 ? 1 : 0;
    if (leftRelevant !== rightRelevant) {
      return rightRelevant - leftRelevant;
    }
    if (leftWeight !== rightWeight) {
      return rightWeight - leftWeight;
    }
    if (leftWeeklyTarget !== rightWeeklyTarget) {
      return rightWeeklyTarget - leftWeeklyTarget;
    }
    const leftPrimaryOrder = primaryOrder.get(leftMuscleId) ?? Number.MAX_SAFE_INTEGER;
    const rightPrimaryOrder = primaryOrder.get(rightMuscleId) ?? Number.MAX_SAFE_INTEGER;
    if (leftPrimaryOrder !== rightPrimaryOrder) {
      return leftPrimaryOrder - rightPrimaryOrder;
    }
    return leftMuscleId.localeCompare(rightMuscleId);
  });

  const anchorMuscle = ranked[0]?.[0];
  if (!anchorMuscle) {
    return undefined;
  }

  void sessionIntent;
  return { kind: "muscle", muscle: anchorMuscle };
}
