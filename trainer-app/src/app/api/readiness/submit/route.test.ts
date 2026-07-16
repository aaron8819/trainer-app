import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalWritePause = process.env.TRAINER_WRITE_PAUSE;

afterEach(() => {
  if (originalWritePause === undefined) delete process.env.TRAINER_WRITE_PAUSE;
  else process.env.TRAINER_WRITE_PAUSE = originalWritePause;
});

const mocks = vi.hoisted(() => {
  const resolveOwner = vi.fn();
  const computePerformanceSignals = vi.fn();
  const computeFatigueScore = vi.fn();
  const readinessSignalCreate = vi.fn();

  return {
    resolveOwner,
    computePerformanceSignals,
    computeFatigueScore,
    readinessSignalCreate,
    prisma: {
      readinessSignal: {
        create: readinessSignalCreate,
      },
    },
  };
});

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/readiness", () => ({
  computePerformanceSignals: (...args: unknown[]) => mocks.computePerformanceSignals(...args),
}));

vi.mock("@/lib/engine", () => ({
  computeFatigueScore: (...args: unknown[]) => mocks.computeFatigueScore(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import { POST } from "./route";

describe("POST /api/readiness/submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRAINER_WRITE_PAUSE;
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.computePerformanceSignals.mockResolvedValue({
      rpeDeviation: 0.25,
      stallCount: 1,
      volumeComplianceRate: 0.9,
    });
    mocks.computeFatigueScore.mockReturnValue({
      overall: 0.72,
      perMuscle: { shoulder: 0.5 },
      weights: { whoop: 0, subjective: 0.6, performance: 0.4 },
      components: {
        whoopContribution: 0,
        subjectiveContribution: 0.42,
        performanceContribution: 0.3,
      },
    });
    mocks.readinessSignalCreate.mockResolvedValue({});
  });

  it("returns 503 before owner resolution or readiness evidence writes when paused", async () => {
    process.env.TRAINER_WRITE_PAUSE = "enabled";
    const response = await POST(
      new Request("http://localhost/api/readiness/submit", { method: "POST" }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({ code: "PRODUCTION_WRITE_PAUSED" });
    expect(mocks.resolveOwner).not.toHaveBeenCalled();
    expect(mocks.computePerformanceSignals).not.toHaveBeenCalled();
    expect(mocks.readinessSignalCreate).not.toHaveBeenCalled();
  });

  it("persists canonical ReadinessSignal data from subjective readiness input", async () => {
    const response = await POST(
      new Request("http://localhost/api/readiness/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjective: {
            readiness: 4,
            motivation: 4,
            soreness: {
              shoulder: 2,
              elbow: 1,
            },
          },
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.computePerformanceSignals).toHaveBeenCalledWith("user-1", 3);
    expect(mocks.readinessSignalCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        subjectiveReadiness: 4,
        subjectiveMotivation: 4,
        subjectiveSoreness: {
          shoulder: 2,
          elbow: 1,
        },
        subjectiveStress: null,
        performanceRpeDeviation: 0.25,
        performanceStalls: 1,
        performanceCompliance: 0.9,
        fatigueScoreOverall: 0.72,
      }),
    });
    expect(body.signal.subjective).toEqual({
      readiness: 4,
      motivation: 4,
      soreness: {
        shoulder: 2,
        elbow: 1,
      },
    });
    expect(body.source).toEqual({
      whoopAvailable: false,
      sourceMode: "manual+performance",
    });
    expect(body.fatigueScore.overall).toBe(0.72);
  });

  it("rejects legacy pain flag values that are not canonical soreness levels", async () => {
    const response = await POST(
      new Request("http://localhost/api/readiness/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjective: {
            readiness: 3,
            motivation: 3,
            soreness: {
              shoulder: 0,
            },
          },
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid readiness data",
    });
    expect(mocks.readinessSignalCreate).not.toHaveBeenCalled();
  });
});
