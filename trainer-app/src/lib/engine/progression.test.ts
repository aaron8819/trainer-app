import { describe, expect, it } from "vitest";
import { computeNextLoad, shouldDeload } from "./progression";
import type { WorkoutHistoryEntry } from "./types";

const USE_MAIN_LIFT_PLATEAU_DETECTION_ENV = "USE_MAIN_LIFT_PLATEAU_DETECTION";

const withMainLiftFlag = (value: string | undefined, run: () => void) => {
  const previous = process.env[USE_MAIN_LIFT_PLATEAU_DETECTION_ENV];
  if (value === undefined) {
    delete process.env[USE_MAIN_LIFT_PLATEAU_DETECTION_ENV];
  } else {
    process.env[USE_MAIN_LIFT_PLATEAU_DETECTION_ENV] = value;
  }

  try {
    run();
  } finally {
    if (previous === undefined) {
      delete process.env[USE_MAIN_LIFT_PLATEAU_DETECTION_ENV];
    } else {
      process.env[USE_MAIN_LIFT_PLATEAU_DETECTION_ENV] = previous;
    }
  }
};

const buildEntry = (
  date: string,
  bench: { load: number; reps: number } | null,
  lateralRaiseReps: number | null
): WorkoutHistoryEntry => ({
  date,
  completed: true,
  exercises: [
    ...(bench
      ? [
          {
            exerciseId: "bench",

            sets: [
              {
                exerciseId: "bench",
                setIndex: 1,
                reps: bench.reps,
                load: bench.load,
              },
            ],
          },
        ]
      : []),
    ...(lateralRaiseReps !== null
      ? [
          {
            exerciseId: "lateral-raise",

            sets: [
              {
                exerciseId: "lateral-raise",
                setIndex: 1,
                reps: lateralRaiseReps,
                load: 20,
              },
            ],
          },
        ]
      : []),
  ],
});

describe("computeNextLoad progression models", () => {
  it("uses linear progression for beginners", () => {
    const nextUpper = computeNextLoad(
      [{ reps: 8, rpe: 7, load: 135 }],
      [6, 10],
      8,
      undefined,
      { trainingAge: "beginner", isUpperBody: true }
    );
    const nextLower = computeNextLoad(
      [{ reps: 8, rpe: 7, load: 225 }],
      [6, 10],
      8,
      undefined,
      { trainingAge: "beginner", isUpperBody: false }
    );

    expect(nextUpper).toBe(137.5);
    expect(nextLower).toBe(230);
  });

  it("switches stalled beginners to double progression behavior", () => {
    const next = computeNextLoad(
      [
        { reps: 8, rpe: 8, load: 100 },
        { reps: 8, rpe: 8, load: 100 },
      ],
      [8, 12],
      8,
      undefined,
      {
        trainingAge: "beginner",
        recentSessions: [
          [
            { reps: 8, rpe: 8, load: 100 },
            { reps: 8, rpe: 8, load: 100 },
          ],
          [
            { reps: 8, rpe: 8, load: 100 },
            { reps: 8, rpe: 8, load: 100 },
          ],
        ],
      }
    );

    expect(next).toBe(100);
  });

  it("uses double progression for intermediates and increases only at rep ceiling", () => {
    const next = computeNextLoad(
      [
        { reps: 12, rpe: 8, load: 100 },
        { reps: 12, rpe: 8, load: 100 },
      ],
      [8, 12],
      8,
      undefined,
      { trainingAge: "intermediate" }
    );

    expect(next).toBe(102.5);
  });

  it("flags intermediate regression with a deload load reduction", () => {
    const next = computeNextLoad(
      [
        { reps: 8, rpe: 8, load: 100 },
        { reps: 8, rpe: 8, load: 100 },
      ],
      [8, 12],
      8,
      undefined,
      {
        trainingAge: "intermediate",
        recentSessions: [
          [
            { reps: 9, rpe: 8, load: 100 },
            { reps: 9, rpe: 8, load: 100 },
          ],
          [
            { reps: 10, rpe: 8, load: 100 },
            { reps: 10, rpe: 8, load: 100 },
          ],
        ],
      }
    );

    expect(next).toBe(94);
  });

  it("uses periodized progression for advanced lifters", () => {
    const weekThree = computeNextLoad(
      [{ reps: 6, rpe: 8.5, load: 200 }],
      [3, 6],
      8.5,
      undefined,
      {
        trainingAge: "advanced",
        weekInBlock: 2,
      }
    );
    const deload = computeNextLoad(
      [{ reps: 6, rpe: 8.5, load: 200 }],
      [3, 6],
      8.5,
      undefined,
      {
        trainingAge: "advanced",
        weekInBlock: 3,
        isDeloadWeek: true,
        backOffMultiplier: 0.75,
      }
    );

    expect(weekThree).toBe(204);
    expect(deload).toBe(150);
  });
});

describe("shouldDeload plateau detection", () => {
  it("triggers when main-lift e1RM stalls even if accessories improve", () => {
    withMainLiftFlag("true", () => {
      const history: WorkoutHistoryEntry[] = [
        buildEntry("2026-01-01T00:00:00Z", { load: 200, reps: 5 }, 12),
        buildEntry("2026-01-03T00:00:00Z", { load: 200, reps: 5 }, 13),
        buildEntry("2026-01-05T00:00:00Z", { load: 200, reps: 5 }, 14),
        buildEntry("2026-01-07T00:00:00Z", { load: 200, reps: 5 }, 15),
        buildEntry("2026-01-09T00:00:00Z", { load: 200, reps: 5 }, 16),
      ];

      expect(shouldDeload(history, new Set(["bench"]))).toBe(true);
    });
  });

  it("does not trigger when a main lift improves within the window", () => {
    withMainLiftFlag("true", () => {
      const history: WorkoutHistoryEntry[] = [
        buildEntry("2026-01-01T00:00:00Z", { load: 200, reps: 5 }, 12),
        buildEntry("2026-01-03T00:00:00Z", { load: 200, reps: 5 }, 12),
        buildEntry("2026-01-05T00:00:00Z", { load: 200, reps: 5 }, 12),
        buildEntry("2026-01-07T00:00:00Z", { load: 210, reps: 5 }, 12),
        buildEntry("2026-01-09T00:00:00Z", { load: 210, reps: 5 }, 12),
      ];

      expect(shouldDeload(history, new Set(["bench"]))).toBe(false);
    });
  });

  it("falls back to total reps when no main lifts appear in the window", () => {
    withMainLiftFlag("true", () => {
      const history: WorkoutHistoryEntry[] = [
        buildEntry("2026-01-01T00:00:00Z", null, 12),
        buildEntry("2026-01-03T00:00:00Z", null, 13),
        buildEntry("2026-01-05T00:00:00Z", null, 14),
        buildEntry("2026-01-07T00:00:00Z", null, 15),
        buildEntry("2026-01-09T00:00:00Z", null, 16),
      ];

      expect(shouldDeload(history, new Set(["bench"]))).toBe(false);
    });
  });

  it("keeps the legacy plateau behavior when the flag is off", () => {
    withMainLiftFlag("false", () => {
      const history: WorkoutHistoryEntry[] = [
        buildEntry("2026-01-01T00:00:00Z", { load: 200, reps: 5 }, 12),
        buildEntry("2026-01-03T00:00:00Z", { load: 200, reps: 5 }, 13),
        buildEntry("2026-01-05T00:00:00Z", { load: 200, reps: 5 }, 14),
        buildEntry("2026-01-07T00:00:00Z", { load: 200, reps: 5 }, 15),
        buildEntry("2026-01-09T00:00:00Z", { load: 200, reps: 5 }, 16),
      ];

      expect(shouldDeload(history, new Set(["bench"]))).toBe(false);
    });
  });
});
