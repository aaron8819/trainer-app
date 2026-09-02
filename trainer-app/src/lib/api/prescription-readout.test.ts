import { describe, expect, it } from "vitest";
import type { PrescriptionResult } from "@/lib/engine/load-prescription";
import type { WorkoutExercise, WorkoutPlan } from "@/lib/engine/types";
import type {
  MeasurementSemantics,
  ZeroLoadMeaning,
} from "@/lib/exercise-measurement/semantics";
import { buildPrescriptionReadouts } from "./prescription-readout";

function exercise(input: {
  placementId: string;
  exerciseId?: string;
  name?: string;
  measurement?: MeasurementSemantics | null;
  zeroLoadMeaning?: ZeroLoadMeaning | null;
  setCount?: number;
  targetLoad?: number;
  targetReps?: number;
  repRange?: { min: number; max: number };
  targetRpe?: number;
}): WorkoutExercise {
  const exerciseId = input.exerciseId ?? "exercise-1";
  return {
    id: input.placementId,
    exercise: {
      id: exerciseId,
      name: input.name ?? "Test Exercise",
      movementPatterns: ["squat"],
      splitTags: ["legs"],
      jointStress: "medium",
      equipment: ["machine"],
    },
    orderIndex: 0,
    isMainLift: true,
    measurement: input.measurement ?? undefined,
    zeroLoadMeaning: input.zeroLoadMeaning ?? null,
    sets: Array.from({ length: input.setCount ?? 1 }, (_, index) => ({
      setIndex: index + 1,
      targetLoad: input.targetLoad,
      targetReps: input.targetReps ?? 8,
      targetRepRange: input.repRange,
      targetRpe: input.targetRpe ?? 8,
      role: "main" as const,
    })),
  };
}

function workout(exercises: WorkoutExercise[]): WorkoutPlan {
  return {
    id: "workout-1",
    scheduledDate: "2026-09-01T12:00:00.000Z",
    warmup: [],
    mainLifts: exercises.map((entry, index) => ({ ...entry, orderIndex: index })),
    accessories: [],
    estimatedMinutes: 30,
  };
}

function prescription(input: {
  exerciseId?: string;
  kind: PrescriptionResult["kind"];
  value?: number;
  source?: "existing_target" | "exact_history" | "legacy_barbell_history" | "baseline" | "estimate" | "runtime_added_same_exercise" | "deload_history";
  confidence?: "high" | "reduced" | "low";
  measurement?: MeasurementSemantics | null;
  zeroLoadMeaning?: ZeroLoadMeaning;
}): PrescriptionResult {
  const base = {
    version: 1 as const,
    canonicalExerciseId: input.exerciseId ?? "exercise-1",
    measurement: input.measurement ?? null,
    reasonCodes: ["same_exercise_same_measurement" as const],
    evidence: [],
  };
  switch (input.kind) {
    case "numeric":
      return {
        ...base,
        kind: "numeric",
        value: input.value ?? 100,
        source: input.source ?? "exact_history",
        confidence: input.confidence ?? "high",
      };
    case "semantic_zero":
      return {
        ...base,
        kind: "semantic_zero",
        value: 0,
        zeroLoadMeaning: input.zeroLoadMeaning ?? "BODYWEIGHT_NO_ADDED_LOAD",
      };
    case "calibration_required":
      return { ...base, kind: "calibration_required", confidence: "low" };
    case "not_applicable":
      return { ...base, kind: "not_applicable" };
    case "unavailable":
      return { ...base, kind: "unavailable", blockingFields: ["measurement"] };
  }
}

describe("buildPrescriptionReadouts", () => {
  it("projects final working-set, representative target, load, and measurement state", () => {
    const measurement = {
      profile: "REPS_EXTERNAL_LOAD" as const,
      loadConvention: "BARBELL_TOTAL" as const,
      repBasis: "TOTAL" as const,
    };
    const placement = exercise({
      placementId: "bench-placement",
      exerciseId: "bench",
      name: "Bench Press",
      measurement,
      setCount: 2,
      targetLoad: 205,
      targetReps: 8,
      repRange: { min: 6, max: 10 },
      targetRpe: 8,
    });

    expect(buildPrescriptionReadouts({
      workout: workout([placement]),
      prescriptionResultsByPlacement: {
        "bench-placement": prescription({
          exerciseId: "bench",
          kind: "numeric",
          value: 205,
          source: "exact_history",
          measurement,
        }),
      },
    })).toEqual([{
      placementId: "bench-placement",
      exerciseId: "bench",
      exerciseName: "Bench Press",
      setCount: 2,
      targetReps: 8,
      repRange: { min: 6, max: 10 },
      targetRpe: 8,
      targetRir: 2,
      targetLoad: 205,
      prescriptionKind: "numeric",
      loadSource: "exact_history",
      confidence: "high",
      measurementProfile: "REPS_EXTERNAL_LOAD",
      loadConvention: "BARBELL_TOTAL",
      repBasis: "TOTAL",
      zeroLoadMeaning: null,
      cautionLevel: "none",
      cautionReason: null,
    }]);
  });

  it("keeps duplicate canonical exercises occurrence-distinct and never borrows a missing load", () => {
    const first = exercise({
      placementId: "row-a",
      exerciseId: "row",
      name: "Cable Row",
      targetLoad: 90,
    });
    const second = exercise({
      placementId: "row-b",
      exerciseId: "row",
      name: "Cable Row",
      targetLoad: 70,
    });

    const readouts = buildPrescriptionReadouts({
      workout: workout([first, second]),
      prescriptionResultsByPlacement: {
        "row-a": prescription({
          exerciseId: "row",
          kind: "numeric",
          value: 90,
        }),
      },
    });

    expect(readouts.map((row) => row.placementId)).toEqual(["row-a", "row-b"]);
    expect(readouts[0]).toMatchObject({ targetLoad: 90, prescriptionKind: "numeric" });
    expect(readouts[1]).toMatchObject({
      targetLoad: null,
      prescriptionKind: "unavailable",
      loadSource: null,
      cautionReason: "missing_placement_prescription",
    });
  });

  it("counts only retained final working sets", () => {
    const placement = exercise({ placementId: "squat", setCount: 2 });
    placement.sets.unshift({
      setIndex: 0,
      targetReps: 5,
      targetLoad: 45,
      targetRpe: 4,
      role: "warmup",
    });
    const [readout] = buildPrescriptionReadouts({
      workout: workout([placement]),
      prescriptionResultsByPlacement: {
        squat: prescription({ kind: "numeric" }),
      },
    });
    expect(readout).toMatchObject({ setCount: 2, targetReps: 8, targetRpe: 8 });
  });

  it.each([
    ["barbell total", { profile: "REPS_EXTERNAL_LOAD", loadConvention: "BARBELL_TOTAL", repBasis: "TOTAL" }, null, "numeric", 225],
    ["per-implement dumbbell", { profile: "REPS_EXTERNAL_LOAD", loadConvention: "IMPLEMENT_WEIGHT", repBasis: "PER_SIDE" }, null, "numeric", 45],
    ["machine displayed", { profile: "REPS_EXTERNAL_LOAD", loadConvention: "MACHINE_DISPLAYED", repBasis: "TOTAL" }, null, "numeric", 80],
    ["reps-only bodyweight", { profile: "REPS_BODYWEIGHT", repBasis: "TOTAL" }, null, "not_applicable", null],
    ["bodyweight plus load", { profile: "REPS_BODYWEIGHT_PLUS_LOAD", loadConvention: "ADDED_EXTERNAL_LOAD", repBasis: "TOTAL" }, null, "numeric", 25],
    ["assisted", { profile: "REPS_ASSISTED", loadConvention: "DISPLAYED_ASSISTANCE", repBasis: "TOTAL" }, null, "unavailable", null],
    ["semantic bodyweight zero", { profile: "REPS_EXTERNAL_LOAD", loadConvention: "IMPLEMENT_WEIGHT", repBasis: "PER_SIDE" }, "BODYWEIGHT_NO_ADDED_LOAD", "semantic_zero", 0],
    ["machine-default zero", { profile: "REPS_EXTERNAL_LOAD", loadConvention: "MACHINE_DISPLAYED", repBasis: "TOTAL" }, "MACHINE_DEFAULT_NO_ADDED_LOAD", "semantic_zero", 0],
    ["calibration required", { profile: "REPS_EXTERNAL_LOAD", loadConvention: "MACHINE_DISPLAYED", repBasis: "TOTAL" }, null, "calibration_required", null],
  ] as const)("preserves %s load and measurement semantics", (_label, measurement, zeroLoadMeaning, kind, targetLoad) => {
    const placement = exercise({
      placementId: "placement",
      measurement,
      zeroLoadMeaning,
      targetLoad: targetLoad ?? undefined,
    });
    const [readout] = buildPrescriptionReadouts({
      workout: workout([placement]),
      prescriptionResultsByPlacement: {
        placement: prescription({
          kind,
          value: targetLoad ?? undefined,
          measurement,
          zeroLoadMeaning: zeroLoadMeaning ?? undefined,
        }),
      },
    });
    expect(readout).toMatchObject({
      prescriptionKind: kind,
      targetLoad,
      measurementProfile: measurement.profile,
      loadConvention: "loadConvention" in measurement ? measurement.loadConvention : null,
      repBasis: measurement.repBasis,
      zeroLoadMeaning,
    });
  });
});
