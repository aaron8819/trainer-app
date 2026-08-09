import { describe, expect, it } from "vitest";
import type { MeasurementSemantics } from "@/lib/exercise-measurement/semantics";
import {
  compileAcceptedHypertrophySeedV4,
  copyAcceptedHypertrophySeedV4ToDraft,
  parseAcceptedHypertrophySeedV4,
  parseHypertrophyPlanDraftV2,
  projectExecutableSeedV4,
  type HypertrophyPlanDraftV2,
  type HypertrophyPlanWeekV4,
  type WeeklyPrescriptionV4,
} from "./hypertrophy-plan-authoring";

const measurement: MeasurementSemantics = {
  profile: "REPS_EXTERNAL_LOAD",
  loadConvention: "BARBELL_TOTAL",
  repBasis: "TOTAL",
};

function topology(
  accumulationWeeks: number,
  includeDeload: boolean,
): HypertrophyPlanWeekV4[] {
  return [
    ...Array.from({ length: accumulationWeeks }, (_, index) => ({
      week: index + 1,
      phase: "ACCUMULATION" as const,
    })),
    ...(includeDeload
      ? [{ week: accumulationWeeks + 1, phase: "DELOAD" as const }]
      : []),
  ];
}

function benchPrescriptions(
  weeks: HypertrophyPlanWeekV4[],
): WeeklyPrescriptionV4[] {
  const accumulationRir = [
    { min: 3, max: 4 },
    { min: 3, max: 3 },
    { min: 2, max: 3 },
    { min: 1, max: 2 },
  ];
  return weeks.map(({ week, phase }) => {
    if (phase === "DELOAD") {
      return {
        week,
        status: "PRESCRIBE",
        setCount: 4,
        reps: { kind: "RANGE", min: 6, max: 8 },
        rir: { kind: "TARGET_RANGE", min: 4, max: 5 },
      };
    }
    const target = accumulationRir[week - 1] ?? { min: 2, max: 3 };
    return {
      week,
      status: "PRESCRIBE",
      setCount: 4,
      reps: { kind: "RANGE", min: 6, max: 8 },
      rir: { kind: "TARGET_RANGE", ...target },
    };
  });
}

function corePrescriptions(
  weeks: HypertrophyPlanWeekV4[],
): WeeklyPrescriptionV4[] {
  return weeks.map(({ week, phase }) =>
    phase === "DELOAD"
      ? { week, status: "OMIT" }
      : {
          week,
          status: "PRESCRIBE",
          setCount: 3,
          reps: { kind: "EXACT", reps: 10 },
          rir: { kind: "NOT_APPLICABLE" },
        },
  );
}

function draft(
  accumulationWeeks = 4,
  includeDeload = true,
): HypertrophyPlanDraftV2 {
  const weeks = topology(accumulationWeeks, includeDeload);
  return {
    version: 2,
    settings: {
      equipmentProfile: "FULL_GYM",
      sessionDurationMinutes: 60,
    },
    weeks,
    sessions: [
      {
        slotId: "upper",
        name: "Upper",
        focus: "UPPER",
        exercises: [
          {
            placementId: "upper-bench",
            exerciseId: "bench",
            intent: {
              userRole: "PRIMARY_LIFT",
              target: {
                kind: "movement_pattern",
                movementPattern: "horizontal_push",
              },
            },
            prescriptions: benchPrescriptions(weeks),
          },
        ],
      },
      {
        slotId: "lower",
        name: "Lower",
        focus: "LOWER",
        exercises: [
          {
            placementId: "lower-core",
            exerciseId: "core",
            intent: {
              userRole: "ACCESSORY",
              target: { kind: "muscle", muscleId: "abs" },
            },
            prescriptions: corePrescriptions(weeks),
          },
        ],
      },
    ],
  };
}

const measurements = new Map([
  ["bench", measurement],
  ["core", measurement],
]);

describe("V4 custom-plan prescription foundation", () => {
  it.each([
    [1, false],
    [3, true],
    [7, false],
  ])(
    "accepts %i accumulation weeks with deload=%s without a fixed tuple",
    (accumulationWeeks, includeDeload) => {
      const candidate = draft(accumulationWeeks, includeDeload);
      expect(parseHypertrophyPlanDraftV2(candidate).weeks).toEqual(
        topology(accumulationWeeks, includeDeload),
      );
    },
  );

  it("compiles four accumulation weeks plus deload without losing prescription meaning", () => {
    const accepted = compileAcceptedHypertrophySeedV4({
      draft: draft(),
      measurementByExerciseId: measurements,
    });
    expect(accepted.weeks).toEqual(topology(4, true));
    expect(accepted.slots[0]!.exercises[0]!.prescriptions).toEqual([
      expect.objectContaining({ week: 1, rir: { kind: "TARGET_RANGE", min: 3, max: 4 } }),
      expect.objectContaining({ week: 2, rir: { kind: "TARGET_RANGE", min: 3, max: 3 } }),
      expect.objectContaining({ week: 3, rir: { kind: "TARGET_RANGE", min: 2, max: 3 } }),
      expect.objectContaining({ week: 4, rir: { kind: "TARGET_RANGE", min: 1, max: 2 } }),
      {
        week: 5,
        status: "PRESCRIBE",
        setCount: 4,
        reps: { kind: "RANGE", min: 6, max: 8 },
        rir: { kind: "TARGET_RANGE", min: 4, max: 5 },
      },
    ]);
    expect(accepted.slots[1]!.exercises[0]!.prescriptions.at(-1)).toEqual({
      week: 5,
      status: "OMIT",
    });

    expect(projectExecutableSeedV4(accepted)).toEqual({
      version: 3,
      weeks: accepted.weeks,
      slots: accepted.slots.map((slot) => ({
        slotId: slot.slotId,
        exercises: slot.exercises.map(
          ({
            placementId,
            exerciseId,
            role,
            intent,
            measurement,
            prescriptions,
          }) => ({
            placementId,
            exerciseId,
            role,
            intent,
            measurement,
            prescriptions,
          }),
        ),
      })),
    });
  });

  it("preserves every accepted intent field in the executable projection", () => {
    const candidate = draft();
    candidate.sessions[0]!.exercises[0]!.intent = {
      userRole: "PRIMARY_LIFT",
      target: { kind: "movement_pattern", movementPattern: "hinge" },
      requiredExerciseClass: "low_axial_hip_extension_anchor",
    };
    const accepted = compileAcceptedHypertrophySeedV4({
      draft: candidate,
      measurementByExerciseId: measurements,
    });
    const projected = projectExecutableSeedV4(accepted);

    expect(
      projected.slots.map((slot) =>
        slot.exercises.map((exercise) => exercise.intent),
      ),
    ).toEqual(
      accepted.slots.map((slot) =>
        slot.exercises.map((exercise) => exercise.intent),
      ),
    );
  });

  it("allows a fully prescribed deload without a blocking set-count reduction", () => {
    const candidate = draft();
    const core = candidate.sessions[1]!.exercises[0]!;
    core.prescriptions[4] = {
      week: 5,
      status: "PRESCRIBE",
      setCount: 3,
      reps: { kind: "EXACT", reps: 10 },
      rir: { kind: "NOT_APPLICABLE" },
    };
    expect(() => parseHypertrophyPlanDraftV2(candidate)).not.toThrow();
  });

  it("requires exact ordered week coverage and permits omission only in deload", () => {
    const missing = draft();
    missing.sessions[0]!.exercises[0]!.prescriptions.pop();
    expect(() => parseHypertrophyPlanDraftV2(missing)).toThrow(
      /exactly one prescription for every plan week/,
    );

    const duplicate = draft();
    duplicate.sessions[0]!.exercises[0]!.prescriptions[1]!.week = 1;
    expect(() => parseHypertrophyPlanDraftV2(duplicate)).toThrow(
      /exactly cover plan weeks in order/,
    );

    const omittedAccumulation = draft();
    omittedAccumulation.sessions[0]!.exercises[0]!.prescriptions[0] = {
      week: 1,
      status: "OMIT",
    };
    expect(() => parseHypertrophyPlanDraftV2(omittedAccumulation)).toThrow(
      /OMIT is permitted only during the final DELOAD week/,
    );
  });

  it("rejects non-contiguous topology and a non-final or accumulation-free deload", () => {
    const nonContiguous = draft();
    nonContiguous.weeks[2]!.week = 4;
    expect(() => parseHypertrophyPlanDraftV2(nonContiguous)).toThrow(
      /contiguous, one-indexed, and ordered/,
    );

    const nonFinalDeload = draft();
    nonFinalDeload.weeks[2]!.phase = "DELOAD";
    expect(() => parseHypertrophyPlanDraftV2(nonFinalDeload)).toThrow(
      /DELOAD is permitted only for the final plan week/,
    );

    const noAccumulation = draft(1, false);
    noAccumulation.weeks[0]!.phase = "DELOAD";
    expect(() => parseHypertrophyPlanDraftV2(noAccumulation)).toThrow(
      /begin with at least one ACCUMULATION week/,
    );
  });

  it("validates rep and half-step RIR ranges while preserving explicit non-applicability", () => {
    expect(
      parseHypertrophyPlanDraftV2(draft()).sessions[1]!.exercises[0]!
        .prescriptions[0],
    ).toMatchObject({ rir: { kind: "NOT_APPLICABLE" } });

    const reversedReps = draft();
    reversedReps.sessions[0]!.exercises[0]!.prescriptions[0] = {
      week: 1,
      status: "PRESCRIBE",
      setCount: 4,
      reps: { kind: "RANGE", min: 9, max: 8 },
      rir: { kind: "TARGET_RANGE", min: 3, max: 4 },
    };
    expect(() => parseHypertrophyPlanDraftV2(reversedReps)).toThrow(
      /Rep-range maximum/,
    );

    const invalidRir = draft();
    invalidRir.sessions[0]!.exercises[0]!.prescriptions[0] = {
      week: 1,
      status: "PRESCRIBE",
      setCount: 4,
      reps: { kind: "RANGE", min: 6, max: 8 },
      rir: { kind: "TARGET_RANGE", min: 3.25, max: 4 },
    };
    expect(() => parseHypertrophyPlanDraftV2(invalidRir)).toThrow();
  });

  it("rejects duplicate placement identities and unsupported inherited policy fields", () => {
    const duplicatePlacement = draft();
    duplicatePlacement.sessions[1]!.exercises[0]!.placementId = "upper-bench";
    expect(() => parseHypertrophyPlanDraftV2(duplicatePlacement)).toThrow(
      /Placement IDs must be unique/,
    );

    expect(() =>
      parseHypertrophyPlanDraftV2({
        ...draft(),
        progressionPolicy: "DOUBLE_PROGRESSION_V1",
      }),
    ).toThrow();
    expect(() =>
      parseHypertrophyPlanDraftV2({
        ...draft(),
        weeklyRirDefaults: [{ week: 1, min: 3, max: 4 }],
      }),
    ).toThrow();
  });

  it("copies V4 accepted intent and measurement losslessly back to Draft V2", () => {
    const accepted = compileAcceptedHypertrophySeedV4({
      draft: draft(),
      measurementByExerciseId: measurements,
    });
    const copied = copyAcceptedHypertrophySeedV4ToDraft(accepted);
    const expectedDraft = draft();
    expect(copied).toEqual({
      ...expectedDraft,
      sessions: expectedDraft.sessions.map((session) => ({
        ...session,
        exercises: session.exercises.map((exercise) => ({
          ...exercise,
          preservedMeasurement: {
            exerciseId: exercise.exerciseId,
            measurement,
          },
        })),
      })),
    });
    expect(
      compileAcceptedHypertrophySeedV4({
        draft: copied,
        measurementByExerciseId: measurements,
      }),
    ).toEqual(accepted);
    expect(parseAcceptedHypertrophySeedV4(accepted)).toEqual(accepted);
  });

  it("resolves new drafts from the supplied measurement map", () => {
    const catalogMeasurement: MeasurementSemantics = {
      profile: "REPS_EXTERNAL_LOAD",
      loadConvention: "MACHINE_DISPLAYED",
      repBasis: "PER_SIDE",
    };
    const accepted = compileAcceptedHypertrophySeedV4({
      draft: draft(),
      measurementByExerciseId: new Map([
        ["bench", catalogMeasurement],
        ["core", catalogMeasurement],
      ]),
    });

    expect(accepted.slots[0]!.exercises[0]!.measurement).toEqual(
      catalogMeasurement,
    );
    expect(accepted.slots[1]!.exercises[0]!.measurement).toEqual(
      catalogMeasurement,
    );
  });

  it("preserves copied measurement identity when the supplied map changes", () => {
    const accepted = compileAcceptedHypertrophySeedV4({
      draft: draft(),
      measurementByExerciseId: measurements,
    });
    const copied = copyAcceptedHypertrophySeedV4ToDraft(accepted);
    const changedMeasurement: MeasurementSemantics = {
      profile: "REPS_EXTERNAL_LOAD",
      loadConvention: "MACHINE_DISPLAYED",
      repBasis: "TOTAL",
    };
    const recompiled = compileAcceptedHypertrophySeedV4({
      draft: copied,
      measurementByExerciseId: new Map([
        ["bench", changedMeasurement],
        ["core", changedMeasurement],
      ]),
    });

    expect(recompiled).toEqual(accepted);
  });

  it("resolves a replacement exercise measurement instead of reusing a stale snapshot", () => {
    const accepted = compileAcceptedHypertrophySeedV4({
      draft: draft(),
      measurementByExerciseId: measurements,
    });
    const copied = copyAcceptedHypertrophySeedV4ToDraft(accepted);
    copied.sessions[0]!.exercises[0]!.exerciseId = "pullup";
    const replacementMeasurement: MeasurementSemantics = {
      profile: "REPS_BODYWEIGHT",
      repBasis: "TOTAL",
    };

    const recompiled = compileAcceptedHypertrophySeedV4({
      draft: copied,
      measurementByExerciseId: new Map<string, MeasurementSemantics>([
        ["pullup", replacementMeasurement],
        ["core", measurement],
      ]),
    });

    expect(recompiled.slots[0]!.exercises[0]).toMatchObject({
      exerciseId: "pullup",
      measurement: replacementMeasurement,
    });
  });

  it("reactivates the bound snapshot when an edited exercise returns to its source identity", () => {
    const accepted = compileAcceptedHypertrophySeedV4({
      draft: draft(),
      measurementByExerciseId: measurements,
    });
    const copied = copyAcceptedHypertrophySeedV4ToDraft(accepted);
    const copiedExercise = copied.sessions[0]!.exercises[0]!;
    copiedExercise.exerciseId = "pullup";
    copiedExercise.exerciseId = "bench";
    const driftedCatalogMeasurement: MeasurementSemantics = {
      profile: "REPS_EXTERNAL_LOAD",
      loadConvention: "MACHINE_DISPLAYED",
      repBasis: "PER_SIDE",
    };

    const recompiled = compileAcceptedHypertrophySeedV4({
      draft: copied,
      measurementByExerciseId: new Map([
        ["bench", driftedCatalogMeasurement],
        ["core", driftedCatalogMeasurement],
      ]),
    });

    expect(recompiled).toEqual(accepted);
  });

  it("fails existing validation when a changed exercise has no measurement data", () => {
    const accepted = compileAcceptedHypertrophySeedV4({
      draft: draft(),
      measurementByExerciseId: measurements,
    });
    const copied = copyAcceptedHypertrophySeedV4ToDraft(accepted);
    copied.sessions[0]!.exercises[0]!.exerciseId = "pullup";

    expect(() =>
      compileAcceptedHypertrophySeedV4({
        draft: copied,
        measurementByExerciseId: new Map([["core", measurement]]),
      }),
    ).toThrow("CUSTOM_PLAN_MEASUREMENT_UNCLASSIFIED:pullup");
  });
});
