import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildGate: vi.fn(),
}));

vi.mock("@/lib/audit/workout-audit/next-mesocycle-acceptance-gate", () => ({
  buildNextMesocycleAcceptanceGateAuditPayload: (...args: unknown[]) =>
    mocks.buildGate(...args),
}));

import { loadMesocyclePreAcceptancePresentation } from "./mesocycle-pre-acceptance-presentation";

describe("loadMesocyclePreAcceptancePresentation", () => {
  beforeEach(() => {
    mocks.buildGate.mockResolvedValue({
      gateResult: "rejected",
      candidateFound: true,
      why: ["Volume floors: Rear Delts"],
      recommendation: "Fix must-fix findings before Week 1.",
      findings: [
        {
          finding: "Volume floors/zones",
          severity: "high_risk",
          ownerSeam: "volume floors",
          smallestSafeFix: "Fix candidate weekly volume at the canonical owner.",
          mustFixBeforeWeek1: true,
          evidence: "Rear Delts:below_mev_fail",
        },
      ],
      watchItems: [],
    });
  });

  it("delegates the four-state decision and remediation to the canonical read-only gate", async () => {
    const result = await loadMesocyclePreAcceptancePresentation({
      userId: "user-1",
      ownerEmail: "owner@local",
      sourceMesocycleId: "meso-1",
    });

    expect(mocks.buildGate).toHaveBeenCalledWith({
      userId: "user-1",
      ownerEmail: "owner@local",
      sourceMesocycleId: "meso-1",
      plannerDiagnosticsMode: "standard",
    });
    expect(result).toMatchObject({
      decision: "rejected",
      candidateFound: true,
      readOnly: true,
      candidateBasis: "persisted_candidate",
      findings: [
        expect.objectContaining({
          severity: "high_risk",
          ownerSeam: "volume floors",
          mustFixBeforeWeek1: true,
        }),
      ],
    });
  });
});
