/**
 * Protects: Readiness/autoregulation correctness (bounded scaling; no silent extreme changes).
 * Why it matters: Readiness-driven changes must be safe and stale signals must not alter workouts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyLoadsAudit } from "@/lib/engine/apply-loads";
import {
  createNumericPrescription,
  createSemanticZeroPrescription,
  type PrescriptionReasonCode,
  type PrescriptionResult,
} from "@/lib/engine/load-prescription";
import { transformPrescriptionForReadiness } from "./autoregulate";

const mocks = vi.hoisted(() => {
  const readinessFindFirst = vi.fn();
  return {
    readinessFindFirst,
    prisma: {
      readinessSignal: { findFirst: readinessFindFirst },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));

import { applyAutoregulation } from "@/lib/api/autoregulation";

function numericPrescription(
  exerciseId: string,
  load: number,
  reasonCodes: PrescriptionReasonCode[] = ["hold"],
) {
  return createNumericPrescription({
    canonicalExerciseId: exerciseId,
    measurement: null,
    value: load,
    source: "exact_history",
    confidence: "high",
    reasonCodes,
    evidence: [{ evidenceId: "history-1" }] as never,
  });
}

function loadAuditFor(
  exerciseId: string,
  prescription: PrescriptionResult,
): ApplyLoadsAudit {
  const projectedLoad =
    prescription.kind === "numeric" || prescription.kind === "semantic_zero"
      ? prescription.value
      : null;
  return {
    progressionTraces: {},
    prescriptions: { [exerciseId]: prescription },
    resolvedLoads: {
      [exerciseId]: {
        placementId: exerciseId,
        canonicalExerciseId: prescription.canonicalExerciseId,
        source: "history",
        canonicalSourceLoad: projectedLoad,
        resolvedTopSetLoad: projectedLoad,
        resolvedSetLoads: projectedLoad == null ? [] : [projectedLoad],
      },
    },
  };
}

describe("autoregulation correctness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies bounded scale-down for fresh low readiness and ignores stale readiness", async () => {
    const workout = {
      id: "w1",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "e1",
          exercise: { id: "bench", name: "Bench Press" },
          isMainLift: true,
          sets: [{ setIndex: 1, targetReps: 8, targetLoad: 200, targetRpe: 8 }],
        },
      ],
      accessories: [],
      estimatedMinutes: 45,
    } as const;

    mocks.readinessFindFirst.mockResolvedValueOnce({
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
      userId: "user-1",
      whoopRecovery: null,
      whoopStrain: null,
      whoopHrv: null,
      whoopSleepQuality: null,
      whoopSleepHours: null,
      subjectiveReadiness: 2,
      subjectiveMotivation: 2,
      subjectiveSoreness: { Chest: 2 },
      subjectiveStress: 3,
      performanceRpeDeviation: 0.5,
      performanceStalls: 1,
      performanceCompliance: 0.9,
    });

    const audit = loadAuditFor("e1", numericPrescription("bench", 200));
    const fresh = await applyAutoregulation("user-1", workout as never, audit);
    const adjustedLoad = fresh.adjusted.mainLifts[0].sets[0].targetLoad ?? 0;

    expect(fresh.applied).toBe(true);
    expect(adjustedLoad).toBe(180);
    expect(adjustedLoad).toBeGreaterThanOrEqual(200 * 0.9);
    expect(fresh.loadAudit?.prescriptions.e1).toMatchObject({
      kind: "numeric",
      value: 180,
      source: "exact_history",
      confidence: "high",
      reasonCodes: expect.arrayContaining(["hold", "readiness_adjusted", "readiness_reduce"]),
      evidence: [expect.objectContaining({ evidenceId: "history-1" })],
    });
    expect(fresh.loadAudit?.resolvedLoads.e1.resolvedTopSetLoad).toBe(180);
    expect(fresh.prescriptionReadouts?.[0]?.targetLoad).toBe(180);

    mocks.readinessFindFirst.mockResolvedValueOnce({
      timestamp: new Date(Date.now() - 72 * 60 * 60 * 1000),
      userId: "user-1",
      whoopRecovery: null,
      whoopStrain: null,
      whoopHrv: null,
      whoopSleepQuality: null,
      whoopSleepHours: null,
      subjectiveReadiness: 2,
      subjectiveMotivation: 2,
      subjectiveSoreness: { Chest: 2 },
      subjectiveStress: 3,
      performanceRpeDeviation: 0.5,
      performanceStalls: 1,
      performanceCompliance: 0.9,
    });

    const stale = await applyAutoregulation("user-1", workout as never, audit);

    expect(stale.applied).toBe(false);
    expect(stale.adjusted).toEqual(workout);
    expect(stale.reason).toContain("No recent readiness signal");
  });

  it("does not scale above the planned prescription on high-readiness signals", async () => {
    const workout = {
      id: "w2",
      scheduledDate: "2026-02-20T00:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "e1",
          exercise: { id: "bench", name: "Bench Press" },
          isMainLift: true,
          sets: [{ setIndex: 1, targetReps: 5, targetLoad: 225, targetRpe: 8 }],
        },
      ],
      accessories: [],
      estimatedMinutes: 45,
    } as const;

    mocks.readinessFindFirst.mockResolvedValueOnce({
      timestamp: new Date(Date.now() - 60 * 60 * 1000),
      userId: "user-1",
      whoopRecovery: 95,
      whoopStrain: 8,
      whoopHrv: 80,
      whoopSleepQuality: 95,
      whoopSleepHours: 8.5,
      subjectiveReadiness: 5,
      subjectiveMotivation: 5,
      subjectiveSoreness: { Chest: 1 },
      subjectiveStress: 1,
      performanceRpeDeviation: -0.5,
      performanceStalls: 0,
      performanceCompliance: 1,
    });

    const result = await applyAutoregulation(
      "user-1",
      workout as never,
      loadAuditFor("e1", numericPrescription("bench", 225)),
    );

    expect(result.applied).toBe(false);
    expect(result.adjusted).toEqual(workout);
    expect(result.modifications).toEqual([]);
  });

  it.each(["missing_effort", "runtime_added_evidence", "substituted_exposure"] as const)(
    "does not let readiness increase a constrained numeric hold: %s",
    (reasonCode) => {
      const base = numericPrescription("machine", 100, [reasonCode, "hold"]);
      const final = transformPrescriptionForReadiness(base, "scale_up");

      expect(final).toMatchObject({
        kind: "numeric",
        value: 100,
        source: "exact_history",
        confidence: "high",
        reasonCodes: expect.arrayContaining([reasonCode, "hold", "readiness_hold"]),
      });
    },
  );

  it("allows the existing downward safety policy while preserving a constrained hold", () => {
    const base = numericPrescription("machine", 100, ["missing_effort", "hold"]);
    const final = transformPrescriptionForReadiness(base, "scale_down");

    expect(final).toMatchObject({
      kind: "numeric",
      value: 90,
      reasonCodes: expect.arrayContaining([
        "missing_effort",
        "hold",
        "readiness_adjusted",
        "readiness_reduce",
      ]),
    });
  });

  it.each([
    {
      label: "calibration",
      result: {
        version: 1,
        kind: "calibration_required",
        canonicalExerciseId: "machine",
        measurement: null,
        confidence: "low",
        reasonCodes: ["legacy_machine_calibration_only"],
        evidence: [],
      } satisfies PrescriptionResult,
    },
    {
      label: "semantic zero",
      result: createSemanticZeroPrescription({
        canonicalExerciseId: "bodyweight",
        measurement: null,
        zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD",
      }),
    },
    {
      label: "unavailable",
      result: {
        version: 1,
        kind: "unavailable",
        canonicalExerciseId: "unknown",
        measurement: null,
        reasonCodes: ["no_comparable_history"],
        evidence: [],
        blockingFields: ["evidence"],
      } satisfies PrescriptionResult,
    },
    {
      label: "not applicable",
      result: {
        version: 1,
        kind: "not_applicable",
        canonicalExerciseId: "bodyweight",
        measurement: null,
        reasonCodes: ["bodyweight_no_load_not_applicable"],
        evidence: [],
      } satisfies PrescriptionResult,
    },
  ])("does not create a numeric prescription from $label", ({ result }) => {
    expect(transformPrescriptionForReadiness(result, "scale_down")).toBe(result);
    expect(transformPrescriptionForReadiness(result, "scale_up")).toBe(result);
  });
});
