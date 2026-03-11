export type RepTargetRange = {
  min: number;
  max: number;
};

type TargetEvaluationInput = {
  actualReps?: number | null;
  targetReps?: number | null;
  targetRepRange?: RepTargetRange | null;
  targetRepMin?: number | null;
  targetRepMax?: number | null;
};

export type TargetRepEvaluation =
  | {
      kind: "missing_target";
      targetRange: null;
      usesRangeTarget: false;
      deviation: null;
    }
  | {
      kind: "missing_actual";
      targetRange: RepTargetRange;
      usesRangeTarget: boolean;
      deviation: null;
    }
  | {
      kind: "below";
      targetRange: RepTargetRange;
      usesRangeTarget: boolean;
      deviation: number;
    }
  | {
      kind: "in_range";
      targetRange: RepTargetRange;
      usesRangeTarget: boolean;
      deviation: 0;
    }
  | {
      kind: "above";
      targetRange: RepTargetRange;
      usesRangeTarget: boolean;
      deviation: number;
    };

export function resolveTargetRepRange(input: Pick<
  TargetEvaluationInput,
  "targetReps" | "targetRepRange" | "targetRepMin" | "targetRepMax"
>): RepTargetRange | null {
  if (
    input.targetRepRange &&
    Number.isFinite(input.targetRepRange.min) &&
    Number.isFinite(input.targetRepRange.max)
  ) {
    return input.targetRepRange;
  }

  if (Number.isFinite(input.targetRepMin) && Number.isFinite(input.targetRepMax)) {
    return {
      min: input.targetRepMin as number,
      max: input.targetRepMax as number,
    };
  }

  if (Number.isFinite(input.targetReps)) {
    return {
      min: input.targetReps as number,
      max: input.targetReps as number,
    };
  }

  return null;
}

export function evaluateTargetReps(input: TargetEvaluationInput): TargetRepEvaluation {
  const targetRange = resolveTargetRepRange(input);
  const usesRangeTarget =
    targetRange != null && (targetRange.min !== targetRange.max || input.targetRepRange != null);

  if (!targetRange) {
    return {
      kind: "missing_target",
      targetRange: null,
      usesRangeTarget: false,
      deviation: null,
    };
  }

  if (!Number.isFinite(input.actualReps)) {
    return {
      kind: "missing_actual",
      targetRange,
      usesRangeTarget,
      deviation: null,
    };
  }

  const actualReps = input.actualReps as number;
  if (actualReps < targetRange.min) {
    return {
      kind: "below",
      targetRange,
      usesRangeTarget,
      deviation: actualReps - targetRange.min,
    };
  }

  if (actualReps > targetRange.max) {
    return {
      kind: "above",
      targetRange,
      usesRangeTarget,
      deviation: actualReps - targetRange.max,
    };
  }

  return {
    kind: "in_range",
    targetRange,
    usesRangeTarget,
    deviation: 0,
  };
}
