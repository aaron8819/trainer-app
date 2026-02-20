import { describe, expect, it, vi } from "vitest";

// Mock Prisma client to avoid DATABASE_URL requirement
vi.mock("@/lib/db/prisma", () => ({
  prisma: {},
}));

import { deriveWeekInBlock } from "./periodization";

const date = (value: string) => new Date(value);

describe("deriveWeekInBlock", () => {
  it("returns week 1 when there is no history", () => {
    const scheduled = date("2026-02-28T10:00:00Z");
    expect(deriveWeekInBlock(scheduled)).toBe(1);
  });

  it("defaults to week 1 when history spans fewer than two weeks", () => {
    const scheduled = date("2026-02-20T10:00:00Z");
    const history = [
      { scheduledDate: date("2026-02-15T10:00:00Z") },
      { scheduledDate: date("2026-02-18T10:00:00Z") },
    ];

    expect(deriveWeekInBlock(scheduled, history)).toBe(1);
  });

  it("derives week index from rolling 4-week window", () => {
    const scheduled = date("2026-02-28T10:00:00Z");
    const history = [
      { scheduledDate: date("2026-02-07T10:00:00Z") },
      { scheduledDate: date("2026-02-14T10:00:00Z") },
      { scheduledDate: date("2026-02-21T10:00:00Z") },
    ];

    expect(deriveWeekInBlock(scheduled, history)).toBe(4);
  });
});
