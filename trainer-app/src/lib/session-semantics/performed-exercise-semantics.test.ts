import { describe, expect, it } from "vitest";

import {
  derivePerformedExerciseSemantics,
  derivePlannedSetStructure,
} from "./performed-exercise-semantics";

describe("derivePerformedExerciseSemantics", () => {
  it("anchors main-lift semantics to the top set load and summarizes effort", () => {
    const semantics = derivePerformedExerciseSemantics({
      isMainLiftEligible: true,
      sets: [
        { setIndex: 1, targetLoad: 70, actualLoad: 70, actualReps: 8, actualRpe: 8 },
        { setIndex: 2, targetLoad: 60, actualLoad: 60, actualReps: 10, actualRpe: 8 },
        { setIndex: 3, targetLoad: 60, actualLoad: 60, actualReps: 10, actualRpe: 8 },
      ],
    });

    expect(semantics).toMatchObject({
      anchorStrategy: "top_set",
      anchorLoad: 70,
      medianReps: 10,
      modalRpe: 8,
      topSetLoad: 70,
      backoffLoad: 60,
      plannedSetStructure: "top_set_backoff",
      hasPlannedBackoffTransition: true,
    });
  });

  it("anchors accessory semantics to the modal load", () => {
    const semantics = derivePerformedExerciseSemantics({
      isMainLiftEligible: false,
      sets: [
        { setIndex: 1, targetLoad: 35, actualLoad: 35, actualReps: 10, actualRpe: 8 },
        { setIndex: 2, targetLoad: 40, actualLoad: 40, actualReps: 10, actualRpe: 8 },
        { setIndex: 3, targetLoad: 40, actualLoad: 40, actualReps: 10, actualRpe: 8 },
        { setIndex: 4, targetLoad: 40, actualLoad: 40, actualReps: 10, actualRpe: 8 },
      ],
    });

    expect(semantics).toMatchObject({
      anchorStrategy: "modal",
      anchorLoad: 40,
      medianReps: 10,
      modalRpe: 8,
      plannedSetStructure: "straight_sets",
      hasPlannedBackoffTransition: false,
    });
  });

  it("ignores skipped and sub-threshold effort rows", () => {
    const semantics = derivePerformedExerciseSemantics({
      isMainLiftEligible: false,
      sets: [
        { setIndex: 1, targetLoad: 20, actualLoad: 20, actualReps: 12, actualRpe: 5 },
        { setIndex: 2, targetLoad: 25, actualLoad: 25, actualReps: 12, actualRpe: 8, wasSkipped: true },
        { setIndex: 3, targetLoad: 25, actualLoad: 25, actualReps: 12, actualRpe: 8 },
      ],
    });

    expect(semantics).toMatchObject({
      anchorLoad: 25,
      medianReps: 12,
      modalRpe: 8,
    });
    expect(semantics?.signalSets).toHaveLength(1);
  });
});

describe("derivePlannedSetStructure", () => {
  it("classifies a planned top-set to backoff transition", () => {
    expect(
      derivePlannedSetStructure([
        { setIndex: 1, targetLoad: 70 },
        { setIndex: 2, targetLoad: 60 },
        { setIndex: 3, targetLoad: 60 },
      ])
    ).toBe("top_set_backoff");
  });

  it("classifies stable loads as straight sets", () => {
    expect(
      derivePlannedSetStructure([
        { setIndex: 1, targetLoad: 50 },
        { setIndex: 2, targetLoad: 50 },
      ])
    ).toBe("straight_sets");
  });
});
