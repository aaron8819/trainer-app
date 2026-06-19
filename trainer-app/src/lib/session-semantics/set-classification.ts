export type SetLogClassificationInput = {
  setIntent?: "WORK" | "WARMUP" | null;
  actualReps?: number | null;
  actualRpe?: number | null;
  actualLoad?: number | null;
  wasSkipped?: boolean | null;
};

export type SetLogClassification = {
  isSkipped: boolean;
  isResolved: boolean;
  isPerformed: boolean;
  isWorkEvidence: boolean;
  isSignal: boolean;
  countsTowardVolume: boolean;
};

const DEFAULT_SIGNAL_RPE_FLOOR = 6;

export function classifySetLog(
  input: SetLogClassificationInput | null | undefined,
  options?: { signalRpeFloor?: number }
): SetLogClassification {
  const signalRpeFloor = options?.signalRpeFloor ?? DEFAULT_SIGNAL_RPE_FLOOR;
  const isSkipped = input?.wasSkipped === true;
  const isWarmup = input?.setIntent === "WARMUP";
  const hasAnyActual =
    input?.actualReps != null ||
    input?.actualRpe != null ||
    input?.actualLoad != null;
  const isResolved = isSkipped || hasAnyActual;
  const isPerformed = !isSkipped && (input?.actualReps != null || input?.actualRpe != null);
  const isWorkEvidence = isPerformed && !isWarmup;
  const isSignal =
    isWorkEvidence && (input?.actualRpe == null || input.actualRpe >= signalRpeFloor);

  return {
    isSkipped,
    isResolved,
    isPerformed,
    isWorkEvidence,
    isSignal,
    countsTowardVolume: isWorkEvidence,
  };
}
