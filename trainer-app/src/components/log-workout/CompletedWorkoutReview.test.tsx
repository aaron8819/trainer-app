import { readFileSync } from "node:fs";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompletedWorkoutReview } from "./CompletedWorkoutReview";
import type { PostSessionReviewDisplayDto } from "@/lib/api/post-session-review-display";

function review(): PostSessionReviewDisplayDto {
  return {
    status: "reviewed",
    headline: "Good session",
    summaryBullets: ["You completed the planned work with no skipped or unlogged sets."],
    completion: {
      plannedSetCount: 1,
      completedSetCount: 1,
      skippedSetCount: 0,
      extraSetCount: 0,
      missingLogSetCount: 0,
      completionPct: 100,
      label: "100% of planned/session-local work logged",
    },
    exerciseChanges: [],
    performedReality: [],
    performedRealityTrends: [],
    loadCalibration: [],
    nextExposureNotes: [],
    weeklyImpact: [],
    learningSignals: [],
    warnings: [],
    source: {
      ownerSeam: "api/post-session-review-display",
      readOnly: true,
      evidenceOnly: true,
      noMutationNote: "No seed or plan changes made",
    },
  };
}

const performanceSummary = [
  {
    exerciseId: "ex-1",
    name: "Lat Pulldown",
    equipment: ["cable"],
    isMainLift: false,
    section: "main" as const,
    sets: [
      {
        setIndex: 1,
        targetReps: 10,
        targetRepRange: { min: 8, max: 12 },
        targetLoad: 40,
        targetRpe: 8,
        actualReps: 8,
        actualLoad: 40,
        actualRpe: 8,
        wasLogged: true,
        wasSkipped: false,
      },
    ],
  },
];

describe("CompletedWorkoutReview", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ postSessionReview: review() }),
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads the snapshot-backed review as the sole default summary", async () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        performanceSummary={performanceSummary}
      />
    );

    expect(screen.getByText("Preparing your post-session review...")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Good session")).toBeInTheDocument());

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/workouts/workout-1/post-session-review",
      { cache: "no-store" }
    );
    expect(screen.queryByText("Session complete!")).not.toBeInTheDocument();
    expect(screen.queryByText("Planned sets")).not.toBeInTheDocument();
    expect(screen.queryByText("RPE adherence")).not.toBeInTheDocument();
    expect(screen.queryByText("Session outcome")).not.toBeInTheDocument();
  });

  it("keeps the detailed set log behind a disclosure", async () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        performanceSummary={performanceSummary}
      />
    );

    await waitFor(() => expect(screen.getByText("Good session")).toBeInTheDocument());
    const summary = screen.getByText("Detailed set log");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("8 reps | 40 lbs | RPE 8")).toHaveClass("text-emerald-700");
  });

  it("shows a safe unavailable state instead of deriving a fallback conclusion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    );

    render(<CompletedWorkoutReview workoutId="workout-1" performanceSummary={[]} />);

    await waitFor(() =>
      expect(
        screen.getByText(/saved review could not be loaded/i)
      ).toBeInTheDocument()
    );
    expect(screen.queryByLabelText("Post-session review")).not.toBeInTheDocument();
  });

  it("preserves persisted runtime-added and swapped labels in detailed evidence", async () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        performanceSummary={[
          {
            ...performanceSummary[0],
            isRuntimeAdded: true,
            isSwapped: false,
            sets: [{ ...performanceSummary[0].sets[0], isRuntimeAdded: true }],
          },
          {
            ...performanceSummary[0],
            exerciseId: "ex-2",
            name: "Machine Row",
            isRuntimeAdded: false,
            isSwapped: true,
            sessionNote: "Replaced Barbell Row for this session.",
          },
        ]}
      />
    );

    await waitFor(() => expect(screen.getByText("Good session")).toBeInTheDocument());
    expect(screen.getByText("Added exercise")).toBeInTheDocument();
    expect(screen.getByText("Extra set")).toBeInTheDocument();
    expect(screen.getByText("Swapped")).toBeInTheDocument();
    expect(screen.getByText("Replaced Barbell Row for this session.")).toBeInTheDocument();
  });

  it("stays out of explanation, audit, producer, contract, and mutation paths", () => {
    const source = readFileSync(
      "src/components/log-workout/CompletedWorkoutReview.tsx",
      "utf8"
    );

    expect(source).toContain("PostSessionReviewCard");
    expect(source).toContain("PostSessionReviewDisplayDto");
    expect(source).not.toContain("/explanation");
    expect(source).not.toContain("PostWorkoutInsights");
    expect(source).not.toContain("buildWorkoutExecutionSummary");
    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("post-session-review-contract");
    expect(source).not.toContain("post-session-review-producer");
    expect(source).not.toContain("@/lib/db/prisma");
    expect(source).not.toContain("prisma.");
  });
});
