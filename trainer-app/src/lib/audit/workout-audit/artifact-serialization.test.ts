import { describe, expect, it } from "vitest";
import {
  buildArtifactDiffSummary,
  buildSerializedTopLevelSizeBreakdown,
  getSerializedJsonSizeBytes,
  serializeStableJson,
} from "./artifact-serialization";

describe("artifact serialization helpers", () => {
  it("sorts object keys without reordering arrays", () => {
    const serialized = serializeStableJson({
      z: 1,
      nested: {
        b: 2,
        a: 1,
      },
      items: [{ b: 2, a: 1 }, { d: 4, c: 3 }],
    });

    expect(serialized).toBe(`{
  "items": [
    {
      "a": 1,
      "b": 2
    },
    {
      "c": 3,
      "d": 4
    }
  ],
  "nested": {
    "a": 1,
    "b": 2
  },
  "z": 1
}`);
  });

  it("reports changed top-level keys for quick artifact diffs", () => {
    const diff = buildArtifactDiffSummary(
      { alpha: 1, beta: 2, unchanged: true },
      { alpha: 1, beta: 3, gamma: 4, unchanged: true }
    );

    expect(diff).toEqual({
      changedTopLevelKeys: ["beta", "gamma"],
    });
  });

  it("computes serialized JSON byte sizes with the stable artifact serializer", () => {
    const value = {
      z: "wide",
      a: [1, 2],
    };

    expect(getSerializedJsonSizeBytes(value)).toBe(
      Buffer.byteLength(serializeStableJson(value), "utf8")
    );
  });

  it("reports top-level section sizes sorted by serialized byte size", () => {
    const value = {
      smallest: true,
      largest: [{ id: "alpha", notes: ["one", "two", "three"] }],
      middle: { label: "compact" },
    };

    const breakdown = buildSerializedTopLevelSizeBreakdown(value);

    expect(breakdown).toEqual([
      {
        field: "largest",
        bytes: getSerializedJsonSizeBytes(value.largest),
      },
      {
        field: "middle",
        bytes: getSerializedJsonSizeBytes(value.middle),
      },
      {
        field: "smallest",
        bytes: getSerializedJsonSizeBytes(value.smallest),
      },
    ]);
  });
});
