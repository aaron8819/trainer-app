import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import { detectPRsFromWorkout } from "@/lib/api/pr-tracker";

describe("detectPRsFromWorkout", () => {
  it("does not produce a load PR from an explicit zero-load set", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        actualLoad: 0,
        workoutSet: {
          workoutExercise: {
            exerciseId: "bulgarian-split-squat",
            exercise: { name: "Bulgarian Split Squat" },
          },
        },
      },
    ]);
    const aggregate = vi.fn();
    const tx = {
      setLog: { findMany, aggregate },
    };

    const result = await detectPRsFromWorkout(
      "workout-1",
      "user-1",
      tx as unknown as Parameters<typeof detectPRsFromWorkout>[2],
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ actualLoad: { gt: 0 } }),
      }),
    );
    expect(aggregate).not.toHaveBeenCalled();
    expect(result).toEqual({ prsDetected: 0, updates: [], repsPRs: [] });
  });
});
