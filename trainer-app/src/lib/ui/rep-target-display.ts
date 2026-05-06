import { resolveTargetRepRange } from "@/lib/session-semantics/target-evaluation";

type RepTargetRange = {
  min: number;
  max: number;
};

export type RepPrescriptionDisplayInput = {
  targetReps?: number | null;
  targetRepRange?: RepTargetRange | null;
  targetRepMin?: number | null;
  targetRepMax?: number | null;
};

export type RepPrescriptionDisplay = {
  primary: string;
  secondary: string | null;
};

function isFinitePositiveRep(value: number | null | undefined): value is number {
  return Number.isFinite(value) && (value ?? 0) > 0;
}

function formatRepRange(range: RepTargetRange): string {
  if (range.min === range.max) {
    return `${range.min} reps`;
  }
  return `${range.min}–${range.max} reps`;
}

export function formatRepPrescription(
  input: RepPrescriptionDisplayInput | null | undefined,
  options?: { showAim?: boolean }
): RepPrescriptionDisplay {
  if (!input) {
    return {
      primary: "-- reps",
      secondary: null,
    };
  }

  const targetRange = resolveTargetRepRange(input);
  if (!targetRange) {
    return {
      primary: "-- reps",
      secondary: null,
    };
  }

  const showAim =
    options?.showAim === true &&
    targetRange.min !== targetRange.max &&
    isFinitePositiveRep(input.targetReps);

  return {
    primary: formatRepRange(targetRange),
    secondary: showAim ? `aim ${input.targetReps}` : null,
  };
}

export function formatRepPrescriptionInline(
  input: RepPrescriptionDisplayInput | null | undefined,
  options?: { showAim?: boolean }
): string {
  const display = formatRepPrescription(input, options);
  return display.secondary ? `${display.primary} (${display.secondary})` : display.primary;
}
