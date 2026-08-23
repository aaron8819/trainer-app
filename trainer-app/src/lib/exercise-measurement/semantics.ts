import { z } from "zod";

export const MEASUREMENT_PROFILE_VALUES = [
  "REPS_EXTERNAL_LOAD",
  "REPS_BODYWEIGHT",
  "REPS_BODYWEIGHT_PLUS_LOAD",
  "REPS_ASSISTED",
] as const;

export const LOAD_CONVENTION_VALUES = [
  "BARBELL_TOTAL",
  "IMPLEMENT_WEIGHT",
  "MACHINE_DISPLAYED",
  "ADDED_EXTERNAL_LOAD",
  "DISPLAYED_ASSISTANCE",
] as const;

export const REP_BASIS_VALUES = ["TOTAL", "PER_SIDE"] as const;

export const ZERO_LOAD_MEANING_VALUES = [
  "BODYWEIGHT_NO_ADDED_LOAD",
  "MACHINE_DEFAULT_NO_ADDED_LOAD",
] as const;

export type MeasurementProfile = (typeof MEASUREMENT_PROFILE_VALUES)[number];
export type LoadConvention = (typeof LOAD_CONVENTION_VALUES)[number];
export type RepBasis = (typeof REP_BASIS_VALUES)[number];
export type ZeroLoadMeaning = (typeof ZERO_LOAD_MEANING_VALUES)[number];

export type MeasurementSemantics =
  | {
      profile: "REPS_EXTERNAL_LOAD";
      loadConvention: "BARBELL_TOTAL" | "IMPLEMENT_WEIGHT" | "MACHINE_DISPLAYED";
      repBasis: RepBasis;
    }
  | {
      profile: "REPS_BODYWEIGHT";
      repBasis: RepBasis;
    }
  | {
      profile: "REPS_BODYWEIGHT_PLUS_LOAD";
      loadConvention: "ADDED_EXTERNAL_LOAD";
      repBasis: RepBasis;
    }
  | {
      profile: "REPS_ASSISTED";
      loadConvention: "DISPLAYED_ASSISTANCE";
      repBasis: RepBasis;
    };

const repBasisSchema = z.enum(REP_BASIS_VALUES);

export const measurementSemanticsSchema = z.discriminatedUnion("profile", [
  z
    .object({
      profile: z.literal("REPS_EXTERNAL_LOAD"),
      loadConvention: z.enum([
        "BARBELL_TOTAL",
        "IMPLEMENT_WEIGHT",
        "MACHINE_DISPLAYED",
      ]),
      repBasis: repBasisSchema,
    })
    .strict(),
  z
    .object({
      profile: z.literal("REPS_BODYWEIGHT"),
      repBasis: repBasisSchema,
    })
    .strict(),
  z
    .object({
      profile: z.literal("REPS_BODYWEIGHT_PLUS_LOAD"),
      loadConvention: z.literal("ADDED_EXTERNAL_LOAD"),
      repBasis: repBasisSchema,
    })
    .strict(),
  z
    .object({
      profile: z.literal("REPS_ASSISTED"),
      loadConvention: z.literal("DISPLAYED_ASSISTANCE"),
      repBasis: repBasisSchema,
    })
    .strict(),
]);

export type MeasurementColumns = {
  measurementProfile?: string | null;
  loadConvention?: string | null;
  repBasis?: string | null;
};

export type PersistedMeasurementColumns = {
  measurementProfile: MeasurementProfile | null;
  loadConvention: LoadConvention | null;
  repBasis: RepBasis | null;
};

export type FrozenMeasurementSnapshot = {
  measurement: MeasurementSemantics | null;
  zeroLoadMeaning: ZeroLoadMeaning | null;
};

export type PersistedFrozenMeasurementColumns = PersistedMeasurementColumns & {
  zeroLoadMeaning: ZeroLoadMeaning | null;
};

export type ZeroLoadMeaningColumn = {
  zeroLoadMeaning?: string | null;
};

const zeroLoadMeaningSchema = z.enum(ZERO_LOAD_MEANING_VALUES).nullable();

export function parseZeroLoadMeaningColumn(
  columns: ZeroLoadMeaningColumn,
): ZeroLoadMeaning | null {
  return zeroLoadMeaningSchema.parse(columns.zeroLoadMeaning ?? null);
}

export function frozenMeasurementSnapshot(
  columns: MeasurementColumns & ZeroLoadMeaningColumn,
): FrozenMeasurementSnapshot {
  return {
    measurement: parseMeasurementColumns(columns),
    zeroLoadMeaning: parseZeroLoadMeaningColumn(columns),
  };
}

export function isMeasurementAwareAcceptedVersion(
  acceptedVersion: number | null | undefined,
): boolean {
  return acceptedVersion === 3 || acceptedVersion === 4;
}

export function isZeroLoadMeaningCompatible(
  measurement: MeasurementSemantics | null,
  zeroLoadMeaning: ZeroLoadMeaning | null,
): boolean {
  if (zeroLoadMeaning == null) return true;
  if (!measurement || measurement.profile !== "REPS_EXTERNAL_LOAD") return false;

  if (zeroLoadMeaning === "BODYWEIGHT_NO_ADDED_LOAD") {
    return (
      measurement.loadConvention === "IMPLEMENT_WEIGHT" &&
      measurement.repBasis === "PER_SIDE"
    );
  }

  return (
    measurement.loadConvention === "MACHINE_DISPLAYED" &&
    measurement.repBasis === "TOTAL"
  );
}

export function assertFrozenMeasurementSnapshotInvariant(
  snapshot: FrozenMeasurementSnapshot,
): FrozenMeasurementSnapshot {
  if (!isZeroLoadMeaningCompatible(snapshot.measurement, snapshot.zeroLoadMeaning)) {
    throw new Error("ZERO_LOAD_MEANING_MEASUREMENT_MISMATCH");
  }
  return snapshot;
}

export function frozenMeasurementColumns(
  snapshot: FrozenMeasurementSnapshot,
): PersistedFrozenMeasurementColumns {
  const valid = assertFrozenMeasurementSnapshotInvariant(snapshot);
  return {
    ...measurementColumns(valid.measurement),
    zeroLoadMeaning: valid.zeroLoadMeaning,
  };
}

export function parseMeasurementColumns(
  columns: MeasurementColumns,
): MeasurementSemantics | null {
  const allNull =
    columns.measurementProfile == null &&
    columns.loadConvention == null &&
    columns.repBasis == null;
  if (allNull) return null;

  const candidate = {
    profile: columns.measurementProfile,
    ...(columns.loadConvention == null
      ? {}
      : { loadConvention: columns.loadConvention }),
    repBasis: columns.repBasis,
  };
  return measurementSemanticsSchema.parse(candidate);
}

export function measurementColumns(
  measurement: MeasurementSemantics | null,
): PersistedMeasurementColumns {
  return measurement
    ? {
        measurementProfile: measurement.profile,
        loadConvention: "loadConvention" in measurement ? measurement.loadConvention : null,
        repBasis: measurement.repBasis,
      }
    : {
        measurementProfile: null,
        loadConvention: null,
        repBasis: null,
      };
}

export function measurementComparisonKey(input: {
  exerciseId: string;
  measurement: MeasurementSemantics | null;
}): string {
  if (!input.measurement) return `legacy:${input.exerciseId}`;
  return [
    "classified",
    input.exerciseId,
    input.measurement.profile,
    "loadConvention" in input.measurement
      ? input.measurement.loadConvention
      : "NONE",
    input.measurement.repBasis,
  ].join(":");
}

export function permitsComputedLoadComparison(
  measurement: MeasurementSemantics | null,
): boolean {
  return (
    measurement == null ||
    (measurement.profile !== "REPS_BODYWEIGHT" &&
      measurement.loadConvention !== "MACHINE_DISPLAYED" &&
      measurement.loadConvention !== "DISPLAYED_ASSISTANCE")
  );
}

export function quantizesAsPounds(
  measurement: MeasurementSemantics | null,
): boolean {
  if (!measurement) return true;
  if (!("loadConvention" in measurement)) return false;
  return (
    measurement.loadConvention === "BARBELL_TOTAL" ||
    measurement.loadConvention === "IMPLEMENT_WEIGHT" ||
    measurement.loadConvention === "ADDED_EXTERNAL_LOAD"
  );
}

export function measurementLoadLabel(
  measurement: MeasurementSemantics | null,
): string | null {
  if (!measurement) return null;
  if (measurement.profile === "REPS_BODYWEIGHT") return null;
  switch (measurement.loadConvention) {
    case "BARBELL_TOTAL":
      return "Total bar load";
    case "IMPLEMENT_WEIGHT":
      return "Weight per implement (lb)";
    case "MACHINE_DISPLAYED":
      return "Machine displayed value";
    case "ADDED_EXTERNAL_LOAD":
      return "Added load (lb)";
    case "DISPLAYED_ASSISTANCE":
      return "Displayed assistance (less is harder)";
  }
}

export function measurementRepsLabel(
  measurement: MeasurementSemantics | null,
): "Reps" | "Reps per side" {
  return measurement?.repBasis === "PER_SIDE" ? "Reps per side" : "Reps";
}
