import {
  permitsComputedLoadComparison,
  type FrozenMeasurementSnapshot,
  type MeasurementSemantics,
  type ZeroLoadMeaning,
} from "./semantics";

export type LoadEntryPolicy = {
  showLoadField: boolean;
  blankAllowedForPerformedSet: boolean;
  zeroAllowed: boolean;
  zeroDisplayLabel: "Bodyweight" | "Machine default / no added load" | null;
  positiveLoadProgressionEligible: boolean;
};

function zeroMeaningCompatible(
  measurement: MeasurementSemantics,
  zeroLoadMeaning: ZeroLoadMeaning | null,
): boolean {
  if (zeroLoadMeaning === "MACHINE_DEFAULT_NO_ADDED_LOAD") {
    return (
      measurement.profile === "REPS_EXTERNAL_LOAD" &&
      measurement.loadConvention === "MACHINE_DISPLAYED"
    );
  }
  if (zeroLoadMeaning === "BODYWEIGHT_NO_ADDED_LOAD") {
    return (
      measurement.profile === "REPS_EXTERNAL_LOAD" &&
      measurement.loadConvention === "IMPLEMENT_WEIGHT"
    );
  }
  return false;
}

export function deriveLoadEntryPolicy(
  snapshot: FrozenMeasurementSnapshot,
): LoadEntryPolicy {
  const { measurement, zeroLoadMeaning } = snapshot;

  if (!measurement) {
    return {
      showLoadField: true,
      blankAllowedForPerformedSet: true,
      zeroAllowed: true,
      zeroDisplayLabel:
        zeroLoadMeaning === "BODYWEIGHT_NO_ADDED_LOAD"
          ? "Bodyweight"
          : zeroLoadMeaning === "MACHINE_DEFAULT_NO_ADDED_LOAD"
            ? "Machine default / no added load"
            : null,
      positiveLoadProgressionEligible: true,
    };
  }

  if (measurement.profile === "REPS_BODYWEIGHT") {
    return {
      showLoadField: false,
      blankAllowedForPerformedSet: true,
      zeroAllowed: false,
      zeroDisplayLabel: null,
      positiveLoadProgressionEligible: false,
    };
  }

  if (measurement.profile === "REPS_BODYWEIGHT_PLUS_LOAD") {
    return {
      showLoadField: true,
      blankAllowedForPerformedSet: false,
      zeroAllowed: true,
      zeroDisplayLabel: "Bodyweight",
      positiveLoadProgressionEligible: true,
    };
  }

  const compatibleZeroMeaning = zeroMeaningCompatible(
    measurement,
    zeroLoadMeaning,
  );
  return {
    showLoadField: true,
    blankAllowedForPerformedSet: false,
    zeroAllowed: compatibleZeroMeaning,
    zeroDisplayLabel: compatibleZeroMeaning
      ? zeroLoadMeaning === "BODYWEIGHT_NO_ADDED_LOAD"
        ? "Bodyweight"
        : "Machine default / no added load"
      : null,
    positiveLoadProgressionEligible:
      permitsComputedLoadComparison(measurement),
  };
}

export function isPositiveLoadProgressionEligible(
  snapshot: FrozenMeasurementSnapshot,
  load: number | null | undefined,
): boolean {
  return (
    deriveLoadEntryPolicy(snapshot).positiveLoadProgressionEligible &&
    typeof load === "number" &&
    Number.isFinite(load) &&
    load > 0
  );
}

export function formatFrozenLoadValue(
  input: {
    load: number | null | undefined;
    snapshot: FrozenMeasurementSnapshot;
  },
  formatNumeric: (load: number) => string | null,
): string | null {
  if (input.load == null) return null;
  const policy = deriveLoadEntryPolicy(input.snapshot);
  if (!policy.showLoadField) return null;
  if (input.load === 0 && policy.zeroDisplayLabel) {
    return policy.zeroDisplayLabel;
  }
  return formatNumeric(input.load);
}
