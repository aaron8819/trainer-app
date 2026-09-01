import { describe, expect, it } from "vitest";

import { buildSessionMaterializationEvidence } from "./materialization";

describe("session materialization evidence", () => {
  it.each([
    [
      { kind: "accepted_v4_scheduled" } as const,
      {
        version: 1,
        generationMode: "accepted_v4_scheduled",
        materializationClass: "scheduled_required",
      },
    ],
    [
      { kind: "explicit_preview" } as const,
      {
        version: 1,
        generationMode: "explicit_preview",
        materializationClass: "preview_only",
      },
    ],
    [
      { kind: "non_scheduled", purpose: "body_part" } as const,
      {
        version: 1,
        generationMode: "non_scheduled",
        materializationClass: "non_scheduled",
        purpose: "body_part",
      },
    ],
    [
      { kind: "legacy" } as const,
      {
        version: 1,
        generationMode: "legacy",
        materializationClass: "legacy",
      },
    ],
  ])("maps %j to its canonical receipt class", (mode, expected) => {
    expect(buildSessionMaterializationEvidence(mode)).toEqual(expected);
  });

  it("normalizes a pre-classification generation context to legacy", () => {
    expect(buildSessionMaterializationEvidence(undefined)).toEqual({
      version: 1,
      generationMode: "legacy",
      materializationClass: "legacy",
    });
  });
});
