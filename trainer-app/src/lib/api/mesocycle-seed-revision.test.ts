import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createCorrectiveSeedRevisionInTransaction,
  createInitialAcceptedSeedRevisionInTransaction,
  normalizeAcceptedSeedPayload,
} from "./mesocycle-seed-revision";

function seed(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    source: "handoff_slot_plan_projection",
    slots: [
      {
        slotId: "upper_a",
        exercises: [
          { exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 },
          { exerciseId: "row", role: "ACCESSORY", setCount: 3 },
        ],
      },
    ],
    ...overrides,
  };
}

describe("accepted seed normalization and hashing", () => {
  it("hashes equivalent executable payloads identically across property ordering", () => {
    const reordered = {
      slots: [
        {
          exercises: [
            { setCount: 4, role: "CORE_COMPOUND", exerciseId: "bench" },
            { role: "ACCESSORY", exerciseId: "row", setCount: 3 },
          ],
          slotId: "upper_a",
        },
      ],
      source: "handoff_slot_plan_projection",
      version: 1,
    };

    expect(normalizeAcceptedSeedPayload(seed()).hash).toBe(
      normalizeAcceptedSeedPayload(reordered).hash,
    );
  });

  it("changes the hash when executable seed intent changes", () => {
    const changed = seed({
      slots: [
        {
          slotId: "upper_a",
          exercises: [
            { exerciseId: "bench", role: "CORE_COMPOUND", setCount: 3 },
            { exerciseId: "row", role: "ACCESSORY", setCount: 3 },
          ],
        },
      ],
    });

    expect(normalizeAcceptedSeedPayload(seed()).hash).not.toBe(
      normalizeAcceptedSeedPayload(changed).hash,
    );
  });

  it("excludes non-executable source, names, and planner metadata from the hash", () => {
    const explanatoryVariant = seed({
      source: "v2_materialized_seed",
      acceptedPlannerIntent: { source: "v2_planner_policy", diagnostic: "ignored" },
      slots: [
        {
          slotId: "upper_a",
          exercises: [
            {
              exerciseId: "bench",
              name: "Renamed Bench",
              role: "CORE_COMPOUND",
              setCount: 4,
            },
            { exerciseId: "row", name: "Row", role: "ACCESSORY", setCount: 3 },
          ],
        },
      ],
    });

    expect(normalizeAcceptedSeedPayload(seed()).hash).toBe(
      normalizeAcceptedSeedPayload(explanatoryVariant).hash,
    );
  });

  it("keeps accepted active-seed JSON writes confined to initial acceptance compatibility paths", () => {
    const apiDir = path.join(process.cwd(), "src", "lib", "api");
    const files = fs
      .readdirSync(apiDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
      .map((entry) => path.join(entry.parentPath, entry.name));
    const directWriters = files.flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      return /mesocycle\.(?:update|updateMany)\([\s\S]{0,260}slotPlanSeedJson/.test(source)
        ? [path.relative(process.cwd(), file)]
        : [];
    });

    expect(directWriters).toEqual([
      path.join("src", "lib", "api", "mesocycle-handoff.ts"),
    ]);
  });

  it("creates revision 1 and activates it through an expected-null pointer", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "revision-1",
      mesocycleId: "meso-1",
      revision: 1,
      seedPayload: normalizeAcceptedSeedPayload(seed()).canonicalPayload,
      payloadHash: normalizeAcceptedSeedPayload(seed()).hash,
      hashAlgorithm: "sha256",
      provenanceStatus: "exact",
      creationReason: "acceptance",
      actorSource: "test",
      sourceRevisionId: null,
      activatedAt: new Date(),
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      mesocycle: {
        findUnique: vi.fn().mockResolvedValue({ currentSeedRevision: null }),
        updateMany,
      },
      mesocycleSeedRevision: { create },
    } as never;

    const revision = await createInitialAcceptedSeedRevisionInTransaction(tx, {
      mesocycleId: "meso-1",
      seedPayload: seed(),
      creationReason: "acceptance",
      actorSource: "test",
    });

    expect(revision.revision).toBe(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mesocycleId: "meso-1",
        revision: 1,
        provenanceStatus: "exact",
      }),
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "meso-1", currentSeedRevisionId: null },
      data: { currentSeedRevisionId: "revision-1" },
    });
  });

  it("returns the identical current revision on an acceptance retry", async () => {
    const current = {
      id: "revision-1",
      mesocycleId: "meso-1",
      revision: 1,
      seedPayload: normalizeAcceptedSeedPayload(seed()).canonicalPayload,
      payloadHash: normalizeAcceptedSeedPayload(seed()).hash,
      hashAlgorithm: "sha256",
      provenanceStatus: "exact",
      creationReason: "acceptance",
      actorSource: "test",
      sourceRevisionId: null,
      activatedAt: new Date(),
    };
    const create = vi.fn();
    const tx = {
      mesocycle: {
        findUnique: vi.fn().mockResolvedValue({ currentSeedRevision: current }),
        updateMany: vi.fn(),
      },
      mesocycleSeedRevision: { create },
    } as never;

    await expect(createInitialAcceptedSeedRevisionInTransaction(tx, {
      mesocycleId: "meso-1",
      seedPayload: seed(),
      creationReason: "acceptance_retry",
      actorSource: "test",
    })).resolves.toBe(current);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates N+1 without modifying revision N", async () => {
    const originalPayload = normalizeAcceptedSeedPayload(seed()).canonicalPayload;
    const original = {
      id: "revision-1",
      mesocycleId: "meso-1",
      revision: 1,
      seedPayload: originalPayload,
      payloadHash: normalizeAcceptedSeedPayload(seed()).hash,
      hashAlgorithm: "sha256",
      provenanceStatus: "exact",
      creationReason: "acceptance",
      actorSource: "test",
      sourceRevisionId: null,
      activatedAt: new Date(),
    };
    const before = structuredClone(original.seedPayload);
    const changed = seed({
      slots: [
        {
          slotId: "upper_a",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 3 }],
        },
      ],
    });
    const create = vi.fn().mockImplementation(async ({ data }) => ({
      ...data,
      id: "revision-2",
      activatedAt: new Date(),
    }));
    const tx = {
      mesocycle: {
        findUnique: vi.fn().mockResolvedValue({ currentSeedRevision: original }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      mesocycleSeedRevision: { create },
    } as never;

    const result = await createCorrectiveSeedRevisionInTransaction(tx, {
      mesocycleId: "meso-1",
      expectedCurrentRevisionId: "revision-1",
      seedPayload: changed,
      creationReason: "correction",
      actorSource: "test",
    });

    expect(result.created).toBe(true);
    expect(result.revision).toMatchObject({
      id: "revision-2",
      revision: 2,
      sourceRevisionId: "revision-1",
    });
    expect(original.seedPayload).toEqual(before);
  });
});
