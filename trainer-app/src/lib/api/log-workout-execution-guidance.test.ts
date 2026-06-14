import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildLogWorkoutExecutionGuidanceByExercise,
  getLogWorkoutExecutionGuidanceForExercise,
  loadLogWorkoutExecutionGuidance,
} from "./log-workout-execution-guidance";
import type { PreSessionReadinessGymCardDto } from "./pre-session-readiness-gym-card";

const mocks = vi.hoisted(() => {
  const loadLatestHomePreSessionReadinessContractCandidate = vi.fn();
  const resolveHomePreSessionReadinessContract = vi.fn();
  const buildPreSessionReadinessGymCardDto = vi.fn();

  return {
    loadLatestHomePreSessionReadinessContractCandidate,
    resolveHomePreSessionReadinessContract,
    buildPreSessionReadinessGymCardDto,
  };
});

vi.mock("./home-pre-session-readiness", () => ({
  loadLatestHomePreSessionReadinessContractCandidate: (...args: unknown[]) =>
    mocks.loadLatestHomePreSessionReadinessContractCandidate(...args),
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
        exerciseId: "cable-row",
        name: "Cable Row",
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
        exerciseId: "bench-press",
        name: "Bench Press",
      })
    ).toEqual([]);
  });

  it("attaches by exercise id when duplicate display names would make name matching ambiguous", () => {
    const guidance = buildLogWorkoutExecutionGuidanceByExercise(makeCard());

    expect(
      getLogWorkoutExecutionGuidanceForExercise(guidance, {
        exerciseId: "cable-row",
        name: "Cable Row",
        hasAmbiguousName: true,
      })
    ).toHaveLength(1);
    expect(
      getLogWorkoutExecutionGuidanceForExercise(guidance, {
        exerciseId: "different-cable-row",
        name: "Cable Row",
        hasAmbiguousName: true,
      })
    ).toEqual([]);
  });

  it("keeps legacy name fallback only when the workout exercise name is unambiguous", () => {
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
      getLogWorkoutExecutionGuidanceForExercise(guidance, {
        name: "Cable Row",
        hasAmbiguousName: false,
      })
    ).toHaveLength(1);
    expect(
      getLogWorkoutExecutionGuidanceForExercise(guidance, {
        name: "Cable Row",
        hasAmbiguousName: true,
      })
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
        exerciseId: "cable-row-a",
        name: "Cable Row",
      })
    ).toEqual([]);
    expect(
      getLogWorkoutExecutionGuidanceForExercise(guidance, {
        name: "Cable Row",
        hasAmbiguousName: false,
      })
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
    mocks.loadLatestHomePreSessionReadinessContractCandidate.mockResolvedValue(candidate);
    mocks.resolveHomePreSessionReadinessContract.mockReturnValue(contract);
    mocks.buildPreSessionReadinessGymCardDto.mockReturnValue(makeCard());

    await expect(
      loadLogWorkoutExecutionGuidance({
        userId: "user-1",
        workoutId: "workout-1",
      })
    ).resolves.toMatchObject({
      byExerciseId: {
        "cable-row": [expect.objectContaining({ sourceLabel: "History" })],
      },
    });

    await expect(
      loadLogWorkoutExecutionGuidance({
        userId: "user-1",
        workoutId: "other-workout",
      })
    ).resolves.toEqual({ byExerciseId: {}, byExerciseName: {} });
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
