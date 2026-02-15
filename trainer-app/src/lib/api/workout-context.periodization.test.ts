import { describe, expect, it, vi } from "vitest";
import type { ProgramBlock } from "@prisma/client";

// Mock Prisma client to avoid DATABASE_URL requirement
vi.mock("@/lib/db/prisma", () => ({
  prisma: {},
}));

import { deriveWeekInBlock } from "./periodization";

const date = (value: string) => new Date(value);

describe("deriveWeekInBlock", () => {
  it("returns week 0 when there is no history", () => {
    const scheduled = date("2026-02-28T10:00:00Z");
    expect(deriveWeekInBlock(scheduled, null, [])).toBe(0);
  });

  it("defaults to week 0 when history spans fewer than two weeks", () => {
    const scheduled = date("2026-02-20T10:00:00Z");
    const history = [
      { scheduledDate: date("2026-02-15T10:00:00Z") },
      { scheduledDate: date("2026-02-18T10:00:00Z") },
    ];

    expect(deriveWeekInBlock(scheduled, null, history)).toBe(0);
  });

  it("derives week index from rolling 4-week window", () => {
    const scheduled = date("2026-02-28T10:00:00Z");
    const history = [
      { scheduledDate: date("2026-02-07T10:00:00Z") },
      { scheduledDate: date("2026-02-14T10:00:00Z") },
      { scheduledDate: date("2026-02-21T10:00:00Z") },
    ];

    expect(deriveWeekInBlock(scheduled, null, history)).toBe(3);
  });

  it("derives week index from program block when present", () => {
    const scheduled = date("2026-03-01T10:00:00Z");
    const programBlock = { id: "block-1", weeks: 8 } as ProgramBlock;
    const history = [
      { scheduledDate: date("2026-02-01T10:00:00Z"), programBlockId: "block-1" },
      { scheduledDate: date("2026-02-08T10:00:00Z"), programBlockId: "block-1" },
    ];

    expect(deriveWeekInBlock(scheduled, programBlock, history)).toBe(4);
  });
});
