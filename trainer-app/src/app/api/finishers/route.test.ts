import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  rollout: vi.fn(),
  pause: vi.fn(),
  findOwner: vi.fn(),
  provisionOwner: vi.fn(),
  loadLibrary: vi.fn(),
  createRoutine: vi.fn(),
  duplicateRoutine: vi.fn(),
}));

vi.mock("@/lib/operations/finisher-rollout-http", () => ({
  finisherRolloutUnavailableResponse: mocks.rollout,
}));
vi.mock("@/lib/operations/production-write-gate-http", () => ({
  productionWritePauseResponse: mocks.pause,
}));
vi.mock("@/lib/api/workout-context", () => ({
  findOwnerReadOnly: mocks.findOwner,
  provisionOwnerForMutation: mocks.provisionOwner,
}));
vi.mock("@/lib/api/finisher-library-service", () => ({
  FinisherLibraryServiceError: class extends Error {},
  loadFinisherLibrary: mocks.loadLibrary,
  createUserFinisherRoutine: mocks.createRoutine,
  duplicateFinisherRoutine: mocks.duplicateRoutine,
}));

import { GET, POST } from "./route";
import { POST as duplicatePOST } from "./[id]/duplicate/route";

const definition = {
  name: "Core reset",
  description: "Short core work.",
  category: "CORE",
  difficulty: "EASY",
  fatigueCost: "LOW",
  impactLevel: "LOW",
  bodyRegions: ["core"],
  limitationTags: [],
  preparationSeconds: 0,
  includesFinalRecovery: false,
  steps: [
    {
      movementName: "Dead bug",
      workSeconds: 40,
      recoverySeconds: 0,
      techniqueCues: [],
      alternatives: [],
    },
  ],
};

describe("/api/finishers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rollout.mockReturnValue(null);
    mocks.pause.mockReturnValue(null);
    mocks.findOwner.mockResolvedValue({ id: "owner" });
    mocks.provisionOwner.mockResolvedValue({ id: "owner" });
    mocks.loadLibrary.mockResolvedValue({ active: [], archived: [], activeLimitations: [] });
    mocks.createRoutine.mockResolvedValue({ routineId: "routine" });
    mocks.duplicateRoutine.mockResolvedValue({ routineId: "copy" });
  });

  it("fails closed on rollout before owner or library reads", async () => {
    mocks.rollout.mockReturnValue(
      NextResponse.json({ code: "FINISHERS_NOT_ENABLED" }, { status: 503 }),
    );
    expect((await GET()).status).toBe(503);
    expect(mocks.findOwner).not.toHaveBeenCalled();
    expect(mocks.loadLibrary).not.toHaveBeenCalled();
  });

  it("returns the owner-scoped logical library", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.loadLibrary).toHaveBeenCalledWith("owner");
  });

  it("evaluates rollout and write pause before parsing or provisioning", async () => {
    mocks.pause.mockReturnValue(
      NextResponse.json({ code: "PRODUCTION_WRITES_PAUSED" }, { status: 503 }),
    );
    const request = {
      json: vi.fn(() => {
        throw new Error("must not parse");
      }),
    } as unknown as Request;
    expect((await POST(request)).status).toBe(503);
    expect(mocks.rollout.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pause.mock.invocationCallOrder[0]!,
    );
    expect(request.json).not.toHaveBeenCalled();
    expect(mocks.provisionOwner).not.toHaveBeenCalled();
  });

  it("creates only through the application-configuration owner", async () => {
    const response = await POST(
      new Request("http://test/api/finishers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition }),
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.pause).toHaveBeenCalledWith(
      "application_configuration",
      "/api/finishers",
    );
    expect(mocks.provisionOwner).toHaveBeenCalledWith(
      "application_configuration",
    );
    expect(mocks.createRoutine).toHaveBeenCalledWith({
      ownerId: "owner",
      definition,
    });
  });

  it("passes the reviewed version identity through customization", async () => {
    const expectedRoutineVersionId = "00000000-0000-4000-8000-000000000002";
    const response = await duplicatePOST(
      new Request("http://test/api/finishers/source/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRoutineVersionId }),
      }),
      { params: Promise.resolve({ id: "source" }) },
    );

    expect(response.status).toBe(201);
    expect(mocks.duplicateRoutine).toHaveBeenCalledWith({
      ownerId: "owner",
      routineId: "source",
      expectedRoutineVersionId,
    });
  });
});
