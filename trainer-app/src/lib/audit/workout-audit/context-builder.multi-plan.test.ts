import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import { buildWorkoutAuditContext } from "./context-builder";

describe("historical-week targeting", () => {
  it("rejects historical-week without an explicit mesocycle id", async () => {
    await expect(
      buildWorkoutAuditContext({
        mode: "historical-week",
        userId: "user-1",
        week: 2,
      })
    ).rejects.toThrow("historical-week mode requires --mesocycle-id");
  });

  it("retains the explicit historical-week mesocycle target", async () => {
    await expect(
      buildWorkoutAuditContext({
        mode: "historical-week",
        userId: "user-1",
        week: 2,
        mesocycleId: "meso-2",
      })
    ).resolves.toMatchObject({
      historicalWeek: {
        week: 2,
        mesocycleId: "meso-2",
      },
    });
  });
});
