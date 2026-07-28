export type TimedFinisherStep = {
  id: string;
  orderIndex: number;
  workSeconds: number;
  recoverySeconds: number;
};

export type FinisherTimerState = {
  state: "SELECTED" | "IN_PROGRESS" | "COMPLETED" | "PARTIAL" | "DISMISSED";
  timerSegment: "PREPARATION" | "WORK" | "RECOVERY" | "FINISHED" | null;
  currentStepIndex: number;
  segmentStartedAt: Date | null;
  segmentEndsAt: Date | null;
  pausedAt: Date | null;
  pausedRemainingMs: number | null;
  startedAt: Date | null;
};

export type FinisherTimerProjection = FinisherTimerState & {
  completedSteps: Array<{ stepIndex: number; resolvedAt: Date }>;
  startedSteps: Array<{ stepIndex: number; startedAt: Date }>;
  completedAt: Date | null;
};

export function deriveTimedFinisherDurationSeconds(input: {
  steps: Array<Pick<TimedFinisherStep, "workSeconds" | "recoverySeconds">>;
  includesFinalRecovery: boolean;
}): number {
  return input.steps.reduce((total, step, index) => {
    const includeRecovery =
      index < input.steps.length - 1 || input.includesFinalRecovery;
    return total + step.workSeconds + (includeRecovery ? step.recoverySeconds : 0);
  }, 0);
}

function addMilliseconds(value: Date, milliseconds: number): Date {
  return new Date(value.getTime() + milliseconds);
}

export function resolveTimerAfterSkippedStep(input: {
  steps: TimedFinisherStep[];
  currentStepIndex: number;
  now: Date;
}):
  | {
      completed: true;
      currentStepIndex: number;
      timerSegment: "FINISHED";
      segmentEndsAt: Date;
    }
  | {
      completed: false;
      currentStepIndex: number;
      timerSegment: "WORK";
      segmentEndsAt: Date;
    } {
  const nextStepIndex = input.currentStepIndex + 1;
  const nextStep = input.steps[nextStepIndex];
  if (!nextStep) {
    return {
      completed: true,
      currentStepIndex: input.currentStepIndex,
      timerSegment: "FINISHED",
      segmentEndsAt: input.now,
    };
  }
  return {
    completed: false,
    currentStepIndex: nextStepIndex,
    timerSegment: "WORK",
    segmentEndsAt: addMilliseconds(input.now, nextStep.workSeconds * 1000),
  };
}

export function projectFinisherTimer(input: {
  timer: FinisherTimerState;
  steps: TimedFinisherStep[];
  includesFinalRecovery: boolean;
  now: Date;
}): FinisherTimerProjection {
  const projected: FinisherTimerProjection = {
    ...input.timer,
    completedSteps: [],
    startedSteps: [],
    completedAt: input.timer.state === "COMPLETED" ? input.timer.segmentEndsAt : null,
  };

  if (
    projected.state === "COMPLETED" ||
    projected.state === "PARTIAL" ||
    projected.state === "DISMISSED" ||
    projected.pausedAt ||
    !projected.timerSegment ||
    !projected.segmentEndsAt
  ) {
    return projected;
  }

  while (
    projected.timerSegment !== "FINISHED" &&
    projected.segmentEndsAt &&
    projected.segmentEndsAt.getTime() <= input.now.getTime()
  ) {
    const boundary = projected.segmentEndsAt;
    const step = input.steps[projected.currentStepIndex];
    if (!step) {
      projected.timerSegment = "FINISHED";
      projected.state = "COMPLETED";
      projected.completedAt = boundary;
      projected.segmentStartedAt = boundary;
      projected.segmentEndsAt = boundary;
      break;
    }

    if (projected.timerSegment === "PREPARATION") {
      projected.timerSegment = "WORK";
      projected.state = "IN_PROGRESS";
      projected.startedAt ??= boundary;
      projected.segmentStartedAt = boundary;
      projected.segmentEndsAt = addMilliseconds(boundary, step.workSeconds * 1000);
      projected.startedSteps.push({
        stepIndex: projected.currentStepIndex,
        startedAt: boundary,
      });
      continue;
    }

    if (projected.timerSegment === "WORK") {
      projected.completedSteps.push({
        stepIndex: projected.currentStepIndex,
        resolvedAt: boundary,
      });
      const hasNext = projected.currentStepIndex < input.steps.length - 1;
      const includeRecovery = hasNext || input.includesFinalRecovery;
      if (includeRecovery && step.recoverySeconds > 0) {
        projected.timerSegment = "RECOVERY";
        projected.segmentStartedAt = boundary;
        projected.segmentEndsAt = addMilliseconds(
          boundary,
          step.recoverySeconds * 1000
        );
        continue;
      }
      if (hasNext) {
        projected.currentStepIndex += 1;
        const nextStep = input.steps[projected.currentStepIndex]!;
        projected.timerSegment = "WORK";
        projected.segmentStartedAt = boundary;
        projected.segmentEndsAt = addMilliseconds(
          boundary,
          nextStep.workSeconds * 1000
        );
        projected.startedSteps.push({
          stepIndex: projected.currentStepIndex,
          startedAt: boundary,
        });
        continue;
      }
      projected.timerSegment = "FINISHED";
      projected.state = "COMPLETED";
      projected.completedAt = boundary;
      projected.segmentStartedAt = boundary;
      projected.segmentEndsAt = boundary;
      break;
    }

    const hasNext = projected.currentStepIndex < input.steps.length - 1;
    if (!hasNext) {
      projected.timerSegment = "FINISHED";
      projected.state = "COMPLETED";
      projected.completedAt = boundary;
      projected.segmentStartedAt = boundary;
      projected.segmentEndsAt = boundary;
      break;
    }
    projected.currentStepIndex += 1;
    const nextStep = input.steps[projected.currentStepIndex]!;
    projected.timerSegment = "WORK";
    projected.segmentStartedAt = boundary;
    projected.segmentEndsAt = addMilliseconds(boundary, nextStep.workSeconds * 1000);
    projected.startedSteps.push({
      stepIndex: projected.currentStepIndex,
      startedAt: boundary,
    });
  }

  return projected;
}

const LIMITATION_ALIASES: Record<string, string> = {
  ankle: "ankle",
  ankles: "ankle",
  hip: "hip",
  hips: "hip",
  knee: "knee",
  knees: "knee",
  "low back": "lower_back",
  "lower back": "lower_back",
  lumbar: "lower_back",
  neck: "neck",
  shoulder: "shoulder",
  shoulders: "shoulder",
  wrist: "wrist",
  wrists: "wrist",
};

export function normalizeFinisherLimitation(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ");
  return LIMITATION_ALIASES[normalized] ?? null;
}

export type FinisherRecommendationCandidate = {
  id: string;
  name: string;
  category: "CORE" | "CONDITIONING";
  fatigueCost: "LOW" | "MODERATE" | "HIGH";
  impactLevel: "LOW" | "MODERATE" | "HIGH";
  bodyRegions: string[];
  limitationTags: string[];
  equipmentRequirements: string[];
};

export type FinisherRecommendation = {
  routineVersionId: string;
  reason: string;
} | null;

export function recommendFinisher(input: {
  routines: FinisherRecommendationCandidate[];
  activeLimitations: string[];
  lowerBodyDemandingWorkout: boolean;
  recentlyPerformedRoutineVersionIds: string[];
  availableEquipment: string[] | null;
}): { recommendation: FinisherRecommendation; blockedReason: string | null } {
  const normalizedLimitations: string[] = [];
  for (const limitation of input.activeLimitations) {
    const recognized = normalizeFinisherLimitation(limitation);
    if (!recognized) {
      return {
        recommendation: null,
        blockedReason:
          "A current limitation could not be matched safely. Browse manually instead.",
      };
    }
    normalizedLimitations.push(recognized);
  }

  const availableEquipment = input.availableEquipment
    ? new Set(input.availableEquipment.map((item) => item.toUpperCase()))
    : null;
  const recent = new Set(input.recentlyPerformedRoutineVersionIds);
  const eligible = input.routines
    .filter(
      (routine) =>
        !routine.limitationTags.some((tag) => normalizedLimitations.includes(tag))
    )
    .filter(
      (routine) =>
        !availableEquipment ||
        routine.equipmentRequirements.every((item) =>
          availableEquipment.has(item.toUpperCase())
        )
    )
    .map((routine) => {
      let score = 0;
      if (routine.fatigueCost === "LOW") score += 4;
      if (routine.fatigueCost === "MODERATE") score += 2;
      if (routine.impactLevel === "LOW") score += 3;
      if (
        input.lowerBodyDemandingWorkout &&
        (routine.impactLevel === "HIGH" ||
          routine.bodyRegions.includes("legs"))
      ) {
        score -= 20;
      }
      if (recent.has(routine.id)) score -= 8;
      return { routine, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.routine.name.localeCompare(right.routine.name) ||
        left.routine.id.localeCompare(right.routine.id)
    );

  const selected = eligible[0];
  if (!selected) {
    return {
      recommendation: null,
      blockedReason: "No routine matched the current safety filters.",
    };
  }

  const reason = input.lowerBodyDemandingWorkout
    ? "Low-impact choice that avoids adding demanding lower-body work."
    : recent.has(selected.routine.id)
      ? "Best available low-fatigue option for this completed workout."
      : "Low-fatigue option that has not been performed recently.";
  return {
    recommendation: {
      routineVersionId: selected.routine.id,
      reason,
    },
    blockedReason: null,
  };
}
