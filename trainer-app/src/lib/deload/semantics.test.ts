import { describe, expect, it } from "vitest";

import {
  applyCanonicalDeloadStructurePolicy,
  CANONICAL_DELOAD_DECISION_REDUCTION_PERCENT,
  CANONICAL_DELOAD_HISTORY_POLICY,
  CANONICAL_DELOAD_MAX_ACCESSORY_EXERCISES,
  CANONICAL_DELOAD_RIR_TARGET,
  CANONICAL_DELOAD_SET_MULTIPLIER,
  buildCanonicalDeloadDecision,
  buildNoDeloadDecision,
  getCanonicalDeloadContractText,
  getCanonicalDeloadGoalText,
  getCanonicalDeloadProgressionTriggerText,
  getCanonicalDeloadReason,
  getCanonicalDeloadSummaryText,
  getCanonicalDeloadStructureText,
  getCanonicalDeloadTargetRpe,
  isCanonicalDeloadPhase,
  isCanonicalDeloadReceipt,
  resolveCanonicalDeloadAccessoryCount,
  resolveCanonicalDeloadSetCount,
} from "./semantics";

describe("deload semantics", () => {
  it("exposes the canonical deload effort target from the shared rir band", () => {
    expect(CANONICAL_DELOAD_RIR_TARGET).toEqual({ min: 5, max: 6 });
    expect(getCanonicalDeloadTargetRpe()).toBe(4.5);
  });

  it("preserves the current deload hard-set reduction behavior, including edge cases", () => {
    expect(CANONICAL_DELOAD_SET_MULTIPLIER).toBe(0.5);
    expect(resolveCanonicalDeloadSetCount(1)).toBe(1);
    expect(resolveCanonicalDeloadSetCount(2)).toBe(1);
    expect(resolveCanonicalDeloadSetCount(4)).toBe(2);
    expect(resolveCanonicalDeloadSetCount(5)).toBe(3);
    expect(resolveCanonicalDeloadAccessoryCount(0)).toBe(0);
    expect(resolveCanonicalDeloadAccessoryCount(1)).toBe(1);
    expect(resolveCanonicalDeloadAccessoryCount(5)).toBe(CANONICAL_DELOAD_MAX_ACCESSORY_EXERCISES);
  });

  it("keeps canonical progression semantics explicit for deload sessions", () => {
    expect(CANONICAL_DELOAD_HISTORY_POLICY.countsTowardProgressionHistory).toBe(false);
    expect(CANONICAL_DELOAD_HISTORY_POLICY.countsTowardPerformanceHistory).toBe(false);
    expect(CANONICAL_DELOAD_HISTORY_POLICY.updatesProgressionAnchor).toBe(false);
    expect(CANONICAL_DELOAD_HISTORY_POLICY.reanchorNextBlockFromAccumulation).toBe(true);
  });

  it("normalizes deload detection across receipt and phase inputs", () => {
    expect(isCanonicalDeloadPhase("deload")).toBe(true);
    expect(isCanonicalDeloadPhase("active_deload")).toBe(true);
    expect(isCanonicalDeloadPhase("accumulation")).toBe(false);
    expect(
      isCanonicalDeloadReceipt({
        cycleContext: {
          weekInMeso: 5,
          weekInBlock: 1,
          phase: "deload",
          blockType: "deload",
          isDeload: true,
          source: "computed",
        },
        deloadDecision: buildCanonicalDeloadDecision("scheduled", ["Scheduled deload week."]),
      })
    ).toBe(true);
  });

  it("builds canonical deload decisions and explicit non-deload decisions", () => {
    expect(buildCanonicalDeloadDecision("scheduled", ["Scheduled deload week."])).toEqual({
      mode: "scheduled",
      reason: ["Scheduled deload week."],
      reductionPercent: CANONICAL_DELOAD_DECISION_REDUCTION_PERCENT,
      appliedTo: "both",
    });
    expect(buildNoDeloadDecision()).toEqual({
      mode: "none",
      reason: [],
      reductionPercent: 0,
      appliedTo: "none",
    });
  });

  it("applies the canonical structural simplification policy before set deloading", () => {
    const result = applyCanonicalDeloadStructurePolicy([
      {
        exerciseId: "bench",
        exerciseName: "Bench Press",
        orderIndex: 0,
        isMainLift: true,
        mesocycleRole: "CORE_COMPOUND",
        isCompound: true,
        movementPatterns: ["horizontal_push"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps"],
        fatigueCost: 4,
        jointStress: "medium",
        baselineSetCount: 4,
        baselineRepAnchor: 8,
      },
      {
        exerciseId: "dip",
        exerciseName: "Dip",
        orderIndex: 1,
        isMainLift: false,
        mesocycleRole: "ACCESSORY",
        isCompound: true,
        movementPatterns: ["horizontal_push"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps"],
        fatigueCost: 4,
        jointStress: "high",
        baselineSetCount: 3,
        baselineRepAnchor: 10,
      },
      {
        exerciseId: "lateral-cable",
        exerciseName: "Cable Lateral Raise",
        orderIndex: 2,
        isMainLift: false,
        mesocycleRole: "ACCESSORY",
        isCompound: false,
        movementPatterns: ["abduction"],
        primaryMuscles: ["Side Delts"],
        secondaryMuscles: [],
        fatigueCost: 1,
        jointStress: "low",
        baselineSetCount: 3,
        baselineRepAnchor: 15,
      },
      {
        exerciseId: "lateral-machine",
        exerciseName: "Machine Lateral Raise",
        orderIndex: 3,
        isMainLift: false,
        mesocycleRole: "ACCESSORY",
        isCompound: false,
        movementPatterns: ["abduction"],
        primaryMuscles: ["Side Delts"],
        secondaryMuscles: [],
        fatigueCost: 1,
        jointStress: "low",
        baselineSetCount: 2,
        baselineRepAnchor: 15,
      },
    ]);

    expect(result.keptExercises.map((exercise) => exercise.exerciseId)).toEqual([
      "bench",
      "lateral-cable",
    ]);
    expect(result.droppedExercises).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: "dip",
          reasonCode: "trimmed_redundant_main_pattern",
        }),
        expect.objectContaining({
          exerciseId: "lateral-machine",
          reasonCode: "trimmed_duplicate_bucket",
        }),
      ])
    );
  });

  it("centralizes deload wording so generator, audit, and UI surfaces can reuse the same semantics", () => {
    expect(getCanonicalDeloadReason("scheduled")).toContain("Scheduled deload week.");
    expect(getCanonicalDeloadReason("scheduled")).toContain(
      "trim redundant accessory overlap"
    );
    expect(getCanonicalDeloadSummaryText()).toContain("redundant accessory overlap is trimmed");
    expect(getCanonicalDeloadGoalText()).toContain("keep the main lifts crisp");
    expect(getCanonicalDeloadStructureText()).toContain("session complexity is capped");
    expect(getCanonicalDeloadContractText()).toContain("Main lifts stay in");
    expect(getCanonicalDeloadProgressionTriggerText()).toContain("redundant accessories are trimmed");
  });
});
