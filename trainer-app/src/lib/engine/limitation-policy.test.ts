import { describe, expect, it } from "vitest";
import { resolveCanonicalLimitations } from "./limitation-policy";

describe("canonical limitation interpretation", () => {
  it.each([
    ["left shoulder", ["shoulder"]],
    ["shoulder pain", ["shoulder"]],
    ["shoulder, wrist", ["shoulder", "wrist"]],
    ["Shoulder.", ["shoulder"]],
    ["history of right shoulders", ["shoulder"]],
    ["low-back pain", ["lower_back"]],
    ["lumbar injury", ["lower_back"]],
    ["knee", ["knee"]],
  ])("resolves %s", (value, expected) => {
    expect(resolveCanonicalLimitations([value])).toEqual({
      recognizedTags: expected,
      unrecognizedTexts: [],
    });
  });

  it("preserves recognized and unrecognized fragments together", () => {
    expect(
      resolveCanonicalLimitations([
        "left shoulder, mystery tendon",
        "wrist pain and unusual area",
      ]),
    ).toEqual({
      recognizedTags: ["shoulder", "wrist"],
      unrecognizedTexts: ["mystery tendon", "unusual area"],
    });
  });
});
