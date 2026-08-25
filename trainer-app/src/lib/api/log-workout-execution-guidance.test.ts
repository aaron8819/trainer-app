import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildLogWorkoutExecutionGuidanceByExercise,
  getLogWorkoutExecutionGuidanceForExercise,
  loadLogWorkoutExecutionGuidance,
} from "./log-workout-execution-guidance";
import type { PreSessionReadinessGymCardDto } from "./pre-session-readiness-gym-card";

const mocks = vi.hoisted(() => {
  const loadCurrentHomePreSessionReadinessContractCandidate = vi.fn();
  const resolveHomePreSessionReadinessContract = vi.fn();
  const buildPreSessionReadinessGymCardDto = vi.fn();

  return {
    loadCurrentHomePreSessionReadinessContractCandidate,
    resolveHomePreSessionReadinessContract,
    buildPreSessionReadinessGymCardDto,
  };
});

vi.mock("./home-pre-session-readiness", () => ({
  loadCurrentHomePreSessionReadinessContractCandidate: (...args: unknown[]) =>
    mocks.loadCurrentHomePreSessionReadinessContractCandidate(...args),
  resolveHomePreSessionReadinessContract: (...args: unknown[]) =>
    mocks.resolveHomePreSessionReadinessContract(...args),
}));

vi.mock("./pre-session-readiness-gym-card", () => ({
  buildPreSessionReadinessGymCardDto: (...args: unknown[]) =>
    mocks.buildPreSessionReadinessGymCardDto(...args),
}));

function makeCard(
  overrides: Partial<PreSessionReadinessGymCardDto> = {}
): PreSessionReadinessGymCardDto {
  return {
    safeToTrain: true,
    action: "watch",
    sessionLabel: "Upper B",
    primaryInstruction: "Run the planned workout.",
    rpeCap: "prescribed",
    workoutPreview: {
      source: "generated_session_audit_snapshot",
      targetRpeLabel: "RPE 8",
      exercises: [
        {
          placementId: "row-1",
          exerciseId: "cable-row",
          exerciseName: "Cable Row",
          setCount: 3,
          repTargetLabel: "10 reps",
          targetLoadLabel: "80 lb",
          targetRpeLabel: "RPE 8",
        },
      ],
    },
    mainPriority: "Run the planned workout.",
    avoid: [],
    optionalAddOns: {
      status: "none",
      reason: "No add-ons recommended.",
      items: [],
    },
    calibrationNotes: [
      {
        kind: "prescription_confidence",
        placementId: "row-1",
        message:
          "Cable Row: Start at 80 lb; use 70-80 lb if first-set reps or RPE are off.",
        exerciseLabel: "Cable Row",
        reasonCode: "load_calibration",
        displayActionCode: "machine_or_cable_target_may_need_calibration",
        severity: "warning",
        confidence: 0.72,
        targetLoad: 80,
        targetReps: 10,
        targetRpe: 8,
        loadSource: "history",
        loadConfidence: "low",
        cautionLevel: "caution",
        cautionReason: "target_effort_load_mismatch",
        adjustmentRangeBasis: "exact_range",
        suggestedAdjustmentRange: {
          minLoad: 70,
          maxLoad: 80,
          unit: "lb",
          basis: "target_effort_load_mismatch",
        },
        source: "generated_progression_trace",
      },
      {
        kind: "fatigue",
        message: "Chest: over target",
      },
      {
        kind: "prescription_confidence",
        message: "raw fallback string",
      },
    ],
    fatigueWatch: [],
    blockers: [],
    warnings: [],
    source: {
      contractVersion: 1,
      kind: "typed_pre_session_readiness_contract",
      ownerSeam: "api/pre-session-readiness-contract",
      readOnly: true,
      auditOnly: false,
      producerMode: "persisted_snapshot",
    },
    ...overrides,
  };
}

describe("log workout execution guidance", () => {
  it("serializes only display-safe prescription guidance for matching exercises", () => {
    const guidance = buildLogWorkoutExecutionGuidanceByExercise(makeCard());

    expect(
      getLogWorkoutExecutionGuidanceForExercise(guidance, {
        placementId: "row-1",
      })
    ).toEqual([
      {
        title: "Prescription guidance",
        message:
          "Cable Row: Start at 80 lb; use 70-80 lb if first-set reps or RPE are off.",
        confidenceLabel: "Low confidence",
        sourceLabel: "History",
        cautionLabel: "Caution",
        adjustmentRangeLabel: "70-80 lb",
      },
    ]);
    expect(
      getLogWorkoutExecutionGuidanceForExercise(guidance, {
        placementId: "other-row",
      })
    ).toEqual([]);
  });

  it("labels reduced-confidence legacy calibration as prior history", () => {
    const card = makeCard({
      calibrationNotes: [
        {
          kind: "prescription_confidence",
          placementId: "row-1",
          message:
            "Suggested load: 140 lb. Based on prior Barbell Bench Press history from Aug 3.",
          exerciseLabel: "Cable Row",
          reasonCode: "load_calibration",
          displayActionCode: "use_target_as_starting_point",
          severity: "warning",
          targetLoad: 140,
          targetReps: 5,
          targetRpe: 6.5,
          loadSource: "legacy_measurement_history",
          loadConfidence: "medium",
          cautionLevel: "notice",
          cautionReason: "legacy_measurement_history",
          adjustmentRangeBasis: "target_load_start",
          suggestedAdjustmentRange: null,
          source: "generated_progression_trace",
        },
      ],
    });

    expect(
      getLogWorkoutExecutionGuidanceForExercise(
        buildLogWorkoutExecutionGuidanceByExercise(card),
        { placementId: "row-1" },
      ),
    ).toEqual([
      expect.objectContaining({
        sourceLabel: "Prior history",
        message:
          "Suggested load: 140 lb. Based on prior Barbell Bench Press history from Aug 3.",
      }),
    ]);
  });

  it("never attaches placement guidance by canonical exercise ID", () => {
    const guidance = buildLogWorkoutExecutionGuidanceByExercise(makeCard());

    expect(
      getLogWorkoutExecutionGuidanceForExercise(guidance, {
        placementId: "row-1",
      })
    ).toHaveLength(1);
    expect(
      getLogWorkoutExecutionGuidanceForExercise(guidance, {})
    ).toEqual([]);
  });

  it("never attaches placement guidance by exercise name", () => {
    const guidance = buildLogWorkoutExecutionGuidanceByExercise(
      makeCard({
        workoutPreview: {
          source: "generated_session_audit_snapshot",
          targetRpeLabel: "RPE 8",
          exercises: [],
        },
      })
    );

    expect(
      getLogWorkoutExecutionGuidanceForExercise(guidance, {})
    ).toEqual([]);
  });

  it("hides guidance when the snapshot preview has duplicate labels with different exercise ids", () => {
    const guidance = buildLogWorkoutExecutionGuidanceByExercise(
      makeCard({
        workoutPreview: {
          source: "generated_session_audit_snapshot",
          targetRpeLabel: "RPE 8",
          exercises: [
            {
              exerciseId: "cable-row-a",
              exerciseName: "Cable Row",
              setCount: 3,
              repTargetLabel: "10 reps",
              targetLoadLabel: "80 lb",
              targetRpeLabel: "RPE 8",
            },
            {
              exerciseId: "cable-row-b",
              exerciseName: "Cable Row",
              setCount: 3,
              repTargetLabel: "10 reps",
              targetLoadLabel: "75 lb",
              targetRpeLabel: "RPE 8",
            },
          ],
        },
      })
    );

    expect(
      getLogWorkoutExecutionGuidanceForExercise(guidance, {
        placementId: "row-a",
      })
    ).toEqual([]);
    expect(
      getLogWorkoutExecutionGuidanceForExercise(guidance, {})
    ).toEqual([]);
  });

  it("keeps duplicate canonical guidance scoped to persisted placements", () => {
    const guidance = buildLogWorkoutExecutionGuidanceByExercise(
      makeCard({
        workoutPreview: {
          source: "generated_session_audit_snapshot",
          targetRpeLabel: "RPE 8",
          exercises: [
            {
              placementId: "row-a",
              exerciseId: "bench",
              exerciseName: "Bench Press",
              setCount: 3,
              repTargetLabel: "8 reps",
              targetLoadLabel: "105 lb",
              targetRpeLabel: "RPE 8",
            },
            {
              placementId: "row-b",
              exerciseId: "bench",
              exerciseName: "Bench Press",
              setCount: 3,
              repTargetLabel: "8 reps",
              targetLoadLabel: "95 lb",
              targetRpeLabel: "RPE 8",
            },
          ],
        },
        calibrationNotes: [
          {
            kind: "prescription_confidence",
            placementId: "row-a",
            exerciseLabel: "Bench Press",
            message: "Placement A guidance",
            displayActionCode: "hold_target_load",
          },
          {
            kind: "prescription_confidence",
            placementId: "row-b",
            exerciseLabel: "Bench Press",
            message: "Placement B guidance",
            displayActionCode: "hold_target_load",
          },
        ],
      }),
    );

    expect(
      getLogWorkoutExecutionGuidanceForExercise(guidance, {
        placementId: "row-a",
      }),
    ).toEqual([expect.objectContaining({ message: "Placement A guidance" })]);
    expect(
      getLogWorkoutExecutionGuidanceForExercise(guidance, {
        placementId: "row-b",
      }),
    ).toEqual([expect.objectContaining({ message: "Placement B guidance" })]);
    expect(
      getLogWorkoutExecutionGuidanceForExercise(guidance, {}),
    ).toEqual([]);
  });

  it("does not leak raw classifications, evidence codes, traces, or mutation flags", () => {
    const json = JSON.stringify(buildLogWorkoutExecutionGuidanceByExercise(makeCard()));

    expect(json).not.toContain("reasonCode");
    expect(json).not.toContain("loadSource");
    expect(json).not.toContain("cautionReason");
    expect(json).not.toContain("target_effort_load_mismatch");
    expect(json).not.toContain("generated_progression_trace");
    expect(json).not.toContain("auditOnly");
    expect(json).not.toContain("readOnly");
    expect(json).not.toContain("seedRuntimeChanged");
    expect(json).not.toContain("dbMutation");
    expect(json).not.toContain("plannerMaterializerChanged");
    expect(json).not.toContain("raw fallback string");
    expect(json).not.toContain("over target");
  });

  it("loads guidance only for the current existing workout snapshot", async () => {
    const candidate = { contract: { contractVersion: 1 } };
    const contract = {
      nextSessionIdentity: {
        existingWorkoutId: "workout-1",
      },
    };
    mocks.loadCurrentHomePreSessionReadinessContractCandidate.mockResolvedValue(candidate);
    mocks.resolveHomePreSessionReadinessContract.mockReturnValue(contract);
    mocks.buildPreSessionReadinessGymCardDto.mockReturnValue(makeCard());

    await expect(
      loadLogWorkoutExecutionGuidance({
        userId: "user-1",
        workoutId: "workout-1",
      })
    ).resolves.toMatchObject({
      byPlacementId: {
        "row-1": [expect.objectContaining({ sourceLabel: "History" })],
      },
    });

    await expect(
      loadLogWorkoutExecutionGuidance({
        userId: "user-1",
        workoutId: "other-workout",
      })
    ).resolves.toEqual({ byPlacementId: {} });
  });

  it("does not import audit artifacts, generation internals, or mutation writers", () => {
    const source = readFileSync(
      "src/lib/api/log-workout-execution-guidance.ts",
      "utf8"
    );

    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("artifacts/audits");
    expect(source).not.toContain("generateSessionFromIntent");
    expect(source).not.toContain("savePreSessionReadinessSnapshot");
    expect(source).not.toContain("saveWorkout");
    expect(source).not.toContain("slotPlanSeedJson");
    expect(source).not.toContain("sessionDecisionReceipt");
  });
});
