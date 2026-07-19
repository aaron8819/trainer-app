import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalizeJson,
  createCorrectiveSeedRevisionInTransaction,
  createInitialAcceptedSeedRevisionInTransaction,
  fingerprintCanonicalJson,
  normalizeAcceptedSeedPayload,
  promoteLegacySeedRevisionToExactInTransaction,
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

const affectedLegacyExecutablePayload = {
  version: 1,
  source: "v2_materialized_seed",
  slots: [
    {
      slotId: "upper_a",
      exercises: [
        { exerciseId: "413ad787-088a-4812-b880-d006b5b9863a", role: "CORE_COMPOUND", setCount: 4 },
        { exerciseId: "3af0b4a6-f9d8-42bf-bb4e-0e3042e3d268", role: "CORE_COMPOUND", setCount: 3 },
        { exerciseId: "f92eb3cd-abba-49ec-a4b1-50dae88bdc22", role: "ACCESSORY", setCount: 2 },
        { exerciseId: "7e69b984-0414-4eff-a6c7-c9ace105ecb0", role: "ACCESSORY", setCount: 4 },
        { exerciseId: "55685ec5-139a-4466-9921-da4bc7a37970", role: "ACCESSORY", setCount: 4 },
        { exerciseId: "a7ef0d10-0e2d-4cfb-8b76-e3fdecd569b8", role: "ACCESSORY", setCount: 4 },
      ],
    },
    {
      slotId: "lower_a",
      exercises: [
        { exerciseId: "6f1e89b9-8a41-403a-a4a0-a64f16c86352", role: "CORE_COMPOUND", setCount: 4 },
        { exerciseId: "83b75a88-c418-4638-909f-878a6502f92b", role: "ACCESSORY", setCount: 2 },
        { exerciseId: "04b0f96f-8887-438e-afe8-e7e2a6432689", role: "ACCESSORY", setCount: 2 },
        { exerciseId: "0b4bb581-4f12-4c96-afbd-80a48d8e88e5", role: "ACCESSORY", setCount: 3 },
      ],
    },
    {
      slotId: "upper_b",
      exercises: [
        { exerciseId: "6272c3ee-49a9-4629-a54f-fe997c20e711", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "18333d03-4661-42cb-903f-a7e24ed6443d", role: "CORE_COMPOUND", setCount: 3 },
        { exerciseId: "ba8f76d9-c334-4570-afc6-ee31a97ffd78", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "650d5c2c-696e-42e9-922f-995b7baac762", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "083faa86-0094-45d5-a6f8-a4297da6bd9b", role: "ACCESSORY", setCount: 4 },
        { exerciseId: "569b79d4-c817-494a-8636-969acfdaa638", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "ea50fb7c-cc73-452a-8d68-88e1ad9b9984", role: "ACCESSORY", setCount: 2 },
      ],
    },
    {
      slotId: "lower_b",
      exercises: [
        { exerciseId: "837ee0a9-a0a7-480c-8689-7606e900d4b1", role: "CORE_COMPOUND", setCount: 3 },
        { exerciseId: "8768cf61-6fa1-4fba-b7ee-eb490597f130", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "80b87827-ca4d-49f2-9bf2-659c196c2001", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "ca99049f-333e-4c55-8b74-8e175d2d11eb", role: "ACCESSORY", setCount: 5 },
      ],
    },
  ],
};

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverseObjectKeys(entry)]),
    );
  }
  return value;
}

describe("accepted seed normalization and hashing", () => {
  it("canonicalizes equivalent representative pg and Prisma JSON shapes identically", () => {
    const pgShape = JSON.parse(
      '{"slots":[{"slotId":"lower_b","exercises":[{"exerciseId":"hinge","role":"CORE_COMPOUND","setCount":3}]}],"version":1}',
    );
    const prismaShape = {
      version: 1,
      slots: [
        {
          exercises: [
            { setCount: 3, role: "CORE_COMPOUND", exerciseId: "hinge" },
          ],
          slotId: "lower_b",
        },
      ],
    };

    expect(canonicalizeJson(pgShape)).toBe(canonicalizeJson(prismaShape));
    expect(fingerprintCanonicalJson(pgShape)).toBe(
      fingerprintCanonicalJson(prismaShape),
    );
  });

  it("sorts object keys recursively without mutating the source", () => {
    const source = { z: { b: 2, a: 1 }, a: true };
    const before = structuredClone(source);

    expect(canonicalizeJson(source)).toBe(
      '{"a":true,"z":{"a":1,"b":2}}',
    );
    expect(source).toEqual(before);
  });

  it("preserves array order in canonical fingerprints", () => {
    expect(fingerprintCanonicalJson({ values: [1, 2] })).not.toBe(
      fingerprintCanonicalJson({ values: [2, 1] }),
    );
  });

  it("preserves JSON primitive types and distinguishes null from missing", () => {
    const fingerprints = [
      { value: 1 },
      { value: true },
      { value: "1" },
      { value: null },
      {},
    ].map(fingerprintCanonicalJson);

    expect(new Set(fingerprints)).toHaveLength(fingerprints.length);
  });

  it("canonicalizes the affected legacy executable payload across adapter ordering", () => {
    const pgShape = JSON.parse(JSON.stringify(affectedLegacyExecutablePayload));
    const prismaShape = reverseObjectKeys(affectedLegacyExecutablePayload);

    expect(canonicalizeJson(pgShape)).toBe(canonicalizeJson(prismaShape));
    expect(normalizeAcceptedSeedPayload(pgShape).hash).toMatch(/^91a62d15066e/);
  });

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

  it("rejects a legacy payload change observed inside the transaction", async () => {
    const originalPayload = normalizeAcceptedSeedPayload(seed()).canonicalPayload;
    const changedPayload = normalizeAcceptedSeedPayload(
      seed({
        slots: [
          {
            slotId: "upper_a",
            exercises: [
              { exerciseId: "bench", role: "CORE_COMPOUND", setCount: 3 },
            ],
          },
        ],
      }),
    ).canonicalPayload;
    const create = vi.fn();
    const updateMany = vi.fn();
    const tx = {
      mesocycle: {
        findUnique: vi.fn().mockResolvedValue({
          currentSeedRevision: {
            id: "revision-1",
            mesocycleId: "meso-1",
            revision: 1,
            seedPayload: changedPayload,
            payloadHash: null,
            hashAlgorithm: null,
            provenanceStatus: "legacy_unknown",
            creationReason: "migration_baseline",
            actorSource: "migration",
            sourceRevisionId: null,
            activatedAt: new Date(),
          },
        }),
        updateMany,
      },
      mesocycleSeedRevision: { create },
    } as never;

    await expect(
      promoteLegacySeedRevisionToExactInTransaction(tx, {
        mesocycleId: "meso-1",
        actorSource: "test",
        expectedLegacyRevisionFingerprint:
          fingerprintCanonicalJson(originalPayload),
      }),
    ).rejects.toThrow("LEGACY_REVISION_CHANGED_IN_TRANSACTION");
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("appends one exact revision and advances only the current pointer", async () => {
    const originalPayload = normalizeAcceptedSeedPayload(seed()).canonicalPayload;
    const original = {
      id: "revision-1",
      mesocycleId: "meso-1",
      revision: 1,
      seedPayload: originalPayload,
      payloadHash: null,
      hashAlgorithm: null,
      provenanceStatus: "legacy_unknown",
      creationReason: "migration_baseline",
      actorSource: "migration",
      sourceRevisionId: null,
      activatedAt: new Date(),
    };
    const originalBefore = structuredClone(original);
    const create = vi.fn().mockImplementation(async ({ data }) => ({
      ...data,
      id: "revision-2",
      activatedAt: new Date(),
    }));
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      mesocycle: {
        findUnique: vi.fn().mockResolvedValue({ currentSeedRevision: original }),
        updateMany,
      },
      mesocycleSeedRevision: { create },
    } as never;

    const result = await promoteLegacySeedRevisionToExactInTransaction(tx, {
      mesocycleId: "meso-1",
      actorSource: "test",
      expectedLegacyRevisionFingerprint:
        fingerprintCanonicalJson(originalPayload),
    });

    expect(result).toMatchObject({
      created: true,
      revision: {
        id: "revision-2",
        revision: 2,
        provenanceStatus: "exact",
        sourceRevisionId: "revision-1",
      },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "meso-1", currentSeedRevisionId: "revision-1" },
      data: { currentSeedRevisionId: "revision-2" },
    });
    expect(original).toEqual(originalBefore);
  });
});
