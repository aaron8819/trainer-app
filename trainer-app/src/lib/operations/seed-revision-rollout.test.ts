import { describe, expect, it } from "vitest";
import { normalizeAcceptedSeedPayload } from "@/lib/api/mesocycle-seed-revision";
import {
  assertSeedInventoryWritable,
  buildSeedInventory,
  type SeedInventorySourceRow,
} from "./seed-revision-rollout";

function validSeed(setCount = 3) {
  return {
    version: 1,
    slots: [
      {
        slotId: "upper_a",
        exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount }],
      },
    ],
  };
}

function row(
  mesocycleId: string,
  seedPayload: unknown,
  overrides: Partial<SeedInventorySourceRow> = {},
): SeedInventorySourceRow {
  return {
    mesocycleId,
    state: "ACTIVE_ACCUMULATION",
    isActive: true,
    seedPayload,
    revisionSchemaPresent: true,
    currentRevisionId: `revision-${mesocycleId}`,
    currentRevision: 1,
    provenanceStatus: "legacy_unknown",
    payloadHash: null,
    hashAlgorithm: null,
    workoutCount: 2,
    completedWorkoutCount: 1,
    ...overrides,
  };
}

describe("seed revision rollout inventory", () => {
  it("reports three valid and one invalid seed without aborting", () => {
    const invalid = validSeed() as {
      slots: Array<{ exercises: Array<Record<string, unknown>> }>;
    };
    delete invalid.slots[0].exercises[0].setCount;
    const inventory = buildSeedInventory([
      row("m1", validSeed()),
      row("m2", validSeed(4)),
      row("m3", validSeed(5)),
      row("m4", invalid, {
        state: "COMPLETED",
        isActive: false,
        workoutCount: 3,
        completedWorkoutCount: 3,
      }),
    ]);

    expect(inventory.summary).toMatchObject({
      total: 4,
      normalizable: 3,
      invalid: 1,
      expectedInserts: 3,
      expectedPointerUpdates: 3,
    });
    expect(inventory.rows[3]).toMatchObject({
      classification: "invalid_seed",
      validationFailure: "ACCEPTED_SEED_SET_COUNT_MISSING:upper_a:bench",
      invalidLocation: { slotId: "upper_a", exerciseId: "bench" },
      invalidLocations: [{ slotId: "upper_a", exerciseId: "bench" }],
      affectsCurrentRuntime: false,
      canRemainLegacyUnknown: true,
    });
  });

  it("fails the write gate closed when any invalid row exists", () => {
    const invalid = {
      version: 1,
      slots: [
        {
          slotId: "upper_a",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
        },
      ],
    };
    expect(() => assertSeedInventoryWritable(buildSeedInventory([row("m1", invalid)])))
      .toThrow("invalid or conflicting rows");
  });

  it("produces stable hashes across repeated inventories", () => {
    const source = [row("m1", validSeed())];
    expect(buildSeedInventory(source).rows[0].hash).toBe(
      buildSeedInventory(structuredClone(source)).rows[0].hash,
    );
    expect(buildSeedInventory(source).rows[0].hash).toBe(
      normalizeAcceptedSeedPayload(validSeed()).hash,
    );
  });

  it("represents inactive invalid history honestly as legacy unknown", () => {
    const inventory = buildSeedInventory([
      row("m1", { version: 1, slots: [] }, { state: "COMPLETED", isActive: false }),
    ]);
    expect(inventory.rows[0]).toMatchObject({
      classification: "invalid_seed",
      canRemainLegacyUnknown: true,
      affectsCurrentRuntime: false,
    });
  });
});
