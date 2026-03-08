import { filterPerformedHistory } from "@/lib/engine/history";
import type { FatigueState, Muscle } from "@/lib/engine/types";
import { MUSCLE_SPLIT_MAP } from "@/lib/engine/volume-landmarks";
import type { RemainingWeekVolumeContext } from "@/lib/engine/selection-v2/types";
import type { SessionIntent } from "@/lib/engine/session-types";
import type { MappedGenerationContext } from "./types";

function toCountMap(intents: SessionIntent[]): Map<SessionIntent, number> {
  const counts = new Map<SessionIntent, number>();
  for (const intent of intents) {
    counts.set(intent, (counts.get(intent) ?? 0) + 1);
  }
  return counts;
}

function getPerformedIntentKey(
  entry: MappedGenerationContext["history"][number]
): SessionIntent | undefined {
  return entry.sessionIntent ?? entry.forcedSplit;
}

function buildRemainingFutureSlots(
  weeklySchedule: SessionIntent[],
  performedIntents: SessionIntent[],
  currentIntent: SessionIntent
): SessionIntent[] {
  const remaining = [...weeklySchedule];

  const consumeIntent = (intent: SessionIntent) => {
    const index = remaining.findIndex((slot) => slot === intent);
    if (index >= 0) {
      remaining.splice(index, 1);
      return;
    }

    if (remaining.length > 0) {
      remaining.shift();
    }
  };

  for (const intent of performedIntents) {
    consumeIntent(intent);
  }
  consumeIntent(currentIntent);

  return remaining;
}

function getIntentOpportunityWeight(
  muscle: Muscle,
  intent: SessionIntent
): number {
  const split = MUSCLE_SPLIT_MAP[muscle];
  if (!split) {
    return 0;
  }

  if (intent === split) {
    return 1;
  }
  if (intent === "upper") {
    return split === "push" || split === "pull" ? 0.8 : 0;
  }
  if (intent === "lower") {
    return split === "legs" ? 0.85 : 0;
  }
  if (intent === "full_body") {
    return split === "legs" ? 0.55 : 0.65;
  }
  if (intent === "body_part") {
    return 0.35;
  }

  return 0;
}

function getFutureCapacityFactor(
  mapped: MappedGenerationContext,
  fatigueState: FatigueState,
  futureSlotCount: number
): number {
  if (mapped.effectivePeriodization.isDeload) {
    return 0.6;
  }

  let factor = 1;
  if (mapped.lifecycleWeek >= Math.max(1, mapped.mesocycleLength - 1)) {
    factor *= 0.85;
  }

  if (fatigueState.readinessScore <= 2) {
    factor *= 0.72;
  } else if (fatigueState.readinessScore === 3) {
    factor *= 0.9;
  }

  const painValues = Object.values(fatigueState.painFlags ?? {});
  if (painValues.some((value) => value >= 2)) {
    factor *= 0.9;
  }
  if (futureSlotCount <= 1) {
    factor *= 0.92;
  }

  return Math.max(0.5, Math.min(1, factor));
}

export function buildRemainingWeekVolumeContext(params: {
  mapped: MappedGenerationContext;
  sessionIntent: SessionIntent;
  weeklyTarget: Map<Muscle, number>;
  effectiveActual: Map<Muscle, number>;
  fatigueState: FatigueState;
}): RemainingWeekVolumeContext | undefined {
  const { mapped, sessionIntent, weeklyTarget, effectiveActual, fatigueState } = params;
  const weeklySchedule = mapped.mappedConstraints.weeklySchedule ?? [];
  if (weeklySchedule.length === 0) {
    return undefined;
  }

  const currentWeekPerformedIntents = filterPerformedHistory(mapped.history)
    .filter((entry) => {
      const snapshot = entry.mesocycleSnapshot;
      if (!snapshot) {
        return false;
      }
      if (snapshot.week !== mapped.lifecycleWeek) {
        return false;
      }
      if (mapped.activeMesocycle?.id && snapshot.mesocycleId && snapshot.mesocycleId !== mapped.activeMesocycle.id) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const leftSession = left.mesocycleSnapshot?.session ?? Number.POSITIVE_INFINITY;
      const rightSession = right.mesocycleSnapshot?.session ?? Number.POSITIVE_INFINITY;
      if (leftSession !== rightSession) {
        return leftSession - rightSession;
      }
      return new Date(left.date).getTime() - new Date(right.date).getTime();
    })
    .map(getPerformedIntentKey)
    .filter((intent): intent is SessionIntent => Boolean(intent));

  const futureSlots = buildRemainingFutureSlots(weeklySchedule, currentWeekPerformedIntents, sessionIntent);
  const futureSlotCounts = toCountMap(futureSlots);
  const futureCapacityFactor = getFutureCapacityFactor(mapped, fatigueState, futureSlots.length);
  const futureCapacity = new Map<Muscle, number>();
  const requiredNow = new Map<Muscle, number>();
  const urgency = new Map<Muscle, number>();

  for (const [muscle, target] of weeklyTarget) {
    const deficit = Math.max(0, target - (effectiveActual.get(muscle) ?? 0));
    const weeklyOpportunityUnits = weeklySchedule.reduce(
      (sum, intent) => sum + getIntentOpportunityWeight(muscle, intent),
      0
    );
    const futureOpportunityUnits = futureSlots.reduce(
      (sum, intent) => sum + getIntentOpportunityWeight(muscle, intent),
      0
    );
    const estimatedFutureCapacity =
      weeklyOpportunityUnits > 0
        ? target * (futureOpportunityUnits / weeklyOpportunityUnits) * futureCapacityFactor
        : 0;
    const mustAddressNow = Math.max(0, deficit - estimatedFutureCapacity);
    const scarcity = deficit > 0 ? Math.max(0, Math.min(1, mustAddressNow / deficit)) : 0;

    futureCapacity.set(muscle, estimatedFutureCapacity);
    requiredNow.set(muscle, mustAddressNow);
    urgency.set(muscle, 1 + scarcity * 1.5);
  }

  return {
    futureSlots,
    futureSlotCounts,
    futureCapacityFactor,
    futureCapacity,
    requiredNow,
    urgency,
  };
}
