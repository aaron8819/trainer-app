/**
 * Protects: One-time ExerciseExposure backfill must rebuild from canonical performed work only.
 * Why it matters: polluted template-only rows otherwise persist and distort rotation novelty, SRA, and recency filters.
 */
import { describe, expect, it } from "vitest";

import { buildExerciseExposureRows } from "./exercise-exposure-backfill";

describe("buildExerciseExposureRows", () => {
  it("excludes template-only exercises and rebuilds performed history only", () => {
    const now = new Date("2026-03-08T12:00:00.000Z");

    const rows = buildExerciseExposureRows(
      "user-1",
      [
        {
          completedAt: new Date("2026-03-07T10:00:00.000Z"),
          scheduledDate: new Date("2026-03-07T09:00:00.000Z"),
          exercises: [
            {
              exercise: { name: "Bench Press" },
              sets: [
                { logs: [{ actualReps: 8, actualRpe: 8, actualLoad: 185, wasSkipped: false }] },
                { logs: [{ actualReps: null, actualRpe: null, actualLoad: null, wasSkipped: true }] },
              ],
            },
            {
              exercise: { name: "Cable Curl" },
              sets: [
                { logs: [] },
                { logs: [{ actualReps: null, actualRpe: null, actualLoad: null, wasSkipped: true }] },
              ],
            },
          ],
        },
        {
          completedAt: new Date("2026-02-20T11:00:00.000Z"),
          scheduledDate: new Date("2026-02-20T09:00:00.000Z"),
          exercises: [
            {
              exercise: { name: "Bench Press" },
              sets: [
                { logs: [{ actualReps: 6, actualRpe: 9, actualLoad: 195, wasSkipped: false }] },
                { logs: [{ actualReps: 6, actualRpe: 9, actualLoad: 195, wasSkipped: false }] },
              ],
            },
          ],
        },
      ],
      now
    );

    expect(rows).toEqual([
      {
        userId: "user-1",
        exerciseName: "Bench Press",
        lastUsedAt: new Date("2026-03-07T10:00:00.000Z"),
        timesUsedL4W: 2,
        timesUsedL8W: 2,
        timesUsedL12W: 2,
        avgSetsPerWeek: 0.25,
        avgVolumePerWeek: 318.33,
      },
    ]);
  });

  it("uses completedAt with scheduledDate fallback for event time windows", () => {
    const now = new Date("2026-03-08T12:00:00.000Z");

    const rows = buildExerciseExposureRows(
      "user-2",
      [
        {
          completedAt: null,
          scheduledDate: new Date("2026-02-10T12:00:00.000Z"),
          exercises: [
            {
              exercise: { name: "Lat Pulldown" },
              sets: [
                { logs: [{ actualReps: 12, actualRpe: null, actualLoad: 120, wasSkipped: false }] },
              ],
            },
          ],
        },
        {
          completedAt: new Date("2025-12-01T12:00:00.000Z"),
          scheduledDate: new Date("2025-12-01T09:00:00.000Z"),
          exercises: [
            {
              exercise: { name: "Lat Pulldown" },
              sets: [
                { logs: [{ actualReps: 10, actualRpe: 8, actualLoad: 110, wasSkipped: false }] },
              ],
            },
          ],
        },
      ],
      now
    );

    expect(rows).toEqual([
      {
        userId: "user-2",
        exerciseName: "Lat Pulldown",
        lastUsedAt: new Date("2026-02-10T12:00:00.000Z"),
        timesUsedL4W: 1,
        timesUsedL8W: 1,
        timesUsedL12W: 1,
        avgSetsPerWeek: 0.08,
        avgVolumePerWeek: 120,
      },
    ]);
  });
});
