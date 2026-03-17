import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const resolveOwner = vi.fn();
  const loadActiveMesocycle = vi.fn();
  const loadPendingMesocycleHandoff = vi.fn();
  const loadNextWorkoutContext = vi.fn();
  const generateSessionFromTemplate = vi.fn();
  const generateDeloadSessionFromTemplate = vi.fn();
  const applyAutoregulation = vi.fn();

  return {
    resolveOwner,
    loadActiveMesocycle,
    loadPendingMesocycleHandoff,
    loadNextWorkoutContext,
    generateSessionFromTemplate,
    generateDeloadSessionFromTemplate,
    applyAutoregulation,
  };
});

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) => mocks.loadActiveMesocycle(...args),
}));

vi.mock("@/lib/api/mesocycle-handoff", () => ({
  loadPendingMesocycleHandoff: (...args: unknown[]) => mocks.loadPendingMesocycleHandoff(...args),
}));

vi.mock("@/lib/api/next-session", () => ({
  loadNextWorkoutContext: (...args: unknown[]) => mocks.loadNextWorkoutContext(...args),
}));

vi.mock("@/lib/api/template-session", () => ({
  generateSessionFromTemplate: (...args: unknown[]) => mocks.generateSessionFromTemplate(...args),
  generateDeloadSessionFromTemplate: (...args: unknown[]) =>
    mocks.generateDeloadSessionFromTemplate(...args),
}));

vi.mock("@/lib/api/autoregulation", () => ({
  applyAutoregulation: (...args: unknown[]) => mocks.applyAutoregulation(...args),
}));

import { POST } from "./route";

describe("POST /api/workouts/generate-from-template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.loadActiveMesocycle.mockResolvedValue(null);
    mocks.loadPendingMesocycleHandoff.mockResolvedValue(null);
    mocks.loadNextWorkoutContext.mockResolvedValue({
      intent: "push",
      slotId: "push_a",
      slotSequenceIndex: 0,
      slotSource: "mesocycle_slot_sequence",
      existingWorkoutId: null,
      isExisting: false,
      source: "rotation",
      weekInMeso: 2,
      sessionInWeek: 1,
      derivationTrace: [],
      selectedIncompleteStatus: null,
    });
    mocks.applyAutoregulation.mockImplementation(async (_userId, workout) => ({
      adjusted: workout,
      applied: false,
      reason: null,
      signalAgeHours: null,
      fatigueScore: null,
      modifications: [],
      rationale: null,
      wasAutoregulated: false,
    }));
  });

  it("rejects generation while mesocycle handoff is pending", async () => {
    mocks.loadPendingMesocycleHandoff.mockResolvedValue({
      mesocycleId: "meso-1",
      mesoNumber: 1,
      focus: "Hypertrophy",
      closedAt: "2026-03-10T00:00:00.000Z",
      summary: null,
      draft: null,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: "template-1" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Mesocycle handoff pending.",
      handoff: expect.objectContaining({ mesocycleId: "meso-1" }),
    });
    expect(mocks.loadActiveMesocycle).not.toHaveBeenCalled();
    expect(mocks.generateSessionFromTemplate).not.toHaveBeenCalled();
  });

  it("returns canonical selectionMetadata for template generation", async () => {
    mocks.generateSessionFromTemplate.mockResolvedValue({
      workout: {
        id: "w1",
        scheduledDate: new Date("2026-03-03T00:00:00.000Z").toISOString(),
        warmup: [],
        mainLifts: [
          {
            id: "we-1",
            exercise: { id: "ex-1", name: "Bench Press" },
            isMainLift: true,
            orderIndex: 0,
            sets: [{ setIndex: 1, targetReps: 8, targetLoad: 185, targetRpe: 8 }],
          },
        ],
        accessories: [],
        estimatedMinutes: 45,
      },
      templateId: "template-1",
      selectionMode: "AUTO",
      sessionIntent: "push",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      selection: {
        selectedExerciseIds: ["ex-1"],
        mainLiftIds: ["ex-1"],
        accessoryIds: [],
        perExerciseSetTargets: { "ex-1": 3 },
        rationale: {},
        volumePlanByMuscle: {},
        sessionDecisionReceipt: {
          version: 1,
          cycleContext: {
            weekInMeso: 2,
            weekInBlock: 2,
            mesocycleLength: 5,
            phase: "accumulation",
            blockType: "accumulation",
            isDeload: false,
            source: "computed",
          },
          lifecycleVolume: {
            source: "unknown",
          },
          sorenessSuppressedMuscles: [],
          deloadDecision: {
            mode: "none",
            reason: [],
            reductionPercent: 0,
            appliedTo: "none",
          },
          readiness: {
            wasAutoregulated: false,
            signalAgeHours: null,
            fatigueScoreOverall: null,
            intensityScaling: {
              applied: false,
              exerciseIds: [],
              scaledUpCount: 0,
              scaledDownCount: 0,
            },
          },
          exceptions: [],
        },
      },
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: "template-1" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.selectionMetadata).toBeDefined();
    expect(body.selection).toBeUndefined();
    expect(body.autoregulation).toBeUndefined();
    expect(body.selectionMetadata.sessionDecisionReceipt.version).toBe(1);
    expect(body.selectionMetadata.sessionDecisionReceipt.sessionSlot).toEqual({
      slotId: "push_a",
      intent: "push",
      sequenceIndex: 0,
      source: "mesocycle_slot_sequence",
    });
  });
});
