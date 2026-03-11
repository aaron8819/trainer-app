export type SetLogClassificationInput = {
  actualReps?: number | null;
  actualRpe?: number | null;
  actualLoad?: number | null;
  wasSkipped?: boolean | null;
};

export type SetLogClassification = {
  isSkipped: boolean;
  isResolved: boolean;
  isPerformed: boolean;
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
  const hasAnyActual =
    input?.actualReps != null ||
    input?.actualRpe != null ||
    input?.actualLoad != null;
  const isResolved = isSkipped || hasAnyActual;
  const isPerformed = !isSkipped && (input?.actualReps != null || input?.actualRpe != null);
  const isSignal =
    isPerformed && (input?.actualRpe == null || input.actualRpe >= signalRpeFloor);

  return {
    isSkipped,
    isResolved,
    isPerformed,
    isSignal,
    countsTowardVolume: isPerformed,
  };
}
