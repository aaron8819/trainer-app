import { describe, expect, it, vi } from "vitest";
import type { SessionDecisionReceipt } from "@/lib/evidence/types";
import { resolveWorkoutSeedProvenanceForSave } from "./seed-provenance";

const exact = {
  revisionId: "revision-2",
  revision: 2,
  hash: "a".repeat(64),
};

function receipt(seedProvenance = exact): SessionDecisionReceipt {
  return {
    version: 2,
    cycleContext: {
      weekInMeso: 2,
      weekInBlock: 2,
      phase: "accumulation",
      blockType: "accumulation",
      isDeload: false,
      source: "computed",
    },
    sessionProvenance: {
      mesocycleId: "meso-1",
      compositionSource: "persisted_slot_plan_seed",
      seedProvenance,
    },
    lifecycleVolume: { source: "unknown" },
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
  };
}

describe("resolveWorkoutSeedProvenanceForSave", () => {
  it("derives exact persisted fields only from a matching immutable revision", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: exact.revisionId,
      revision: exact.revision,
      payloadHash: exact.hash,
    });

    const result = await resolveWorkoutSeedProvenanceForSave(
      { mesocycleSeedRevision: { findFirst } } as never,
      {
        receipt: receipt(),
        resolvedMesocycleId: "meso-1",
        existingWorkout: null,
      },
    );

    expect(result).toEqual({
      seedRevisionId: exact.revisionId,
      seedRevisionNumber: exact.revision,
      seedPayloadHash: exact.hash,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: exact.revisionId,
        mesocycleId: "meso-1",
        revision: exact.revision,
        payloadHash: exact.hash,
        provenanceStatus: "exact",
      }),
      select: { id: true, revision: true, payloadHash: true },
    });
  });

  it("rejects caller provenance that does not match an immutable revision", async () => {
    await expect(
      resolveWorkoutSeedProvenanceForSave(
        {
          mesocycleSeedRevision: { findFirst: vi.fn().mockResolvedValue(null) },
        } as never,
        {
          receipt: receipt(),
          resolvedMesocycleId: "meso-1",
          existingWorkout: null,
        },
      ),
    ).rejects.toThrow("WORKOUT_SEED_PROVENANCE_INVALID");
  });

  it("preserves a materialized workout revision after the mesocycle changes", async () => {
    const findFirst = vi.fn();
    const result = await resolveWorkoutSeedProvenanceForSave(
      { mesocycleSeedRevision: { findFirst } } as never,
      {
        receipt: receipt(),
        resolvedMesocycleId: "meso-1",
        existingWorkout: {
          seedRevisionId: exact.revisionId,
          seedRevisionNumber: exact.revision,
          seedPayloadHash: exact.hash,
        },
      },
    );

    expect(result).toEqual({
      seedRevisionId: exact.revisionId,
      seedRevisionNumber: exact.revision,
      seedPayloadHash: exact.hash,
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("keeps legacy workouts readable without fabricating exact provenance", async () => {
    await expect(
      resolveWorkoutSeedProvenanceForSave({} as never, {
        receipt: receipt(),
        resolvedMesocycleId: "meso-1",
        existingWorkout: {
          seedRevisionId: null,
          seedRevisionNumber: null,
          seedPayloadHash: null,
        },
      }),
    ).resolves.toBeNull();
  });
});
