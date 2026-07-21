import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PostSessionReviewCard } from "./PostSessionReviewCard";
import type { PostSessionReviewDisplayDto } from "@/lib/api/post-session-review-display";

function review(
  overrides: Partial<PostSessionReviewDisplayDto> = {}
): PostSessionReviewDisplayDto {
  return {
    status: "reviewed",
    headline: "Good session",
    summaryBullets: ["You completed the planned work with no skipped or unlogged sets."],
    completion: {
      plannedSetCount: 3,
      completedSetCount: 3,
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
    ...overrides,
  };
}

describe("PostSessionReviewCard", () => {
  afterEach(cleanup);

  it("renders one concise default review with evidence collapsed", () => {
    render(<PostSessionReviewCard review={review()} />);

    expect(screen.getByLabelText("Post-session review")).toBeInTheDocument();
    expect(screen.getByText("Good session")).toBeInTheDocument();
    expect(
      screen.getByText("You completed the planned work with no skipped or unlogged sets.")
    ).toBeInTheDocument();
    expect(screen.getByText("Review evidence")).toBeInTheDocument();
    expect(screen.getByText(/3 completed of 3 planned sets/)).toBeInTheDocument();
  });

  it("prioritizes next-time actions, material warnings, and weekly impact", () => {
    render(
      <PostSessionReviewCard
        review={review({
          headline: "Mixed session",
          nextExposureNotes: [
            {
              exerciseName: "Bench Press",
              recommendation: "Use a lighter starting target and rebuild from clean reps.",
              basis: "Based on the saved reps, effort, and comparable-session evidence.",
              evidenceOnly: true,
              mutation: false,
            },
          ],
          warnings: ["Bench Press may have been prescribed too heavy."],
          weeklyImpact: [
            {
              muscle: "Chest",
              headline: "Chest is approaching weekly target",
              detail: "9 effective sets this week against a target of 10.",
            },
          ],
        })}
      />
    );

    expect(screen.getByText("Next time")).toBeInTheDocument();
    expect(
      screen.getByText("Use a lighter starting target and rebuild from clean reps.")
    ).toBeInTheDocument();
    expect(screen.getByText("Unusual or potentially incorrect")).toBeInTheDocument();
    expect(screen.getByText("Bench Press may have been prescribed too heavy.")).toBeInTheDocument();
    expect(screen.getByText("Weekly impact")).toBeInTheDocument();
    expect(screen.getByText("Chest is approaching weekly target")).toBeInTheDocument();
  });

  it("keeps detailed evidence inside the disclosure without repeating recommendations", () => {
    render(
      <PostSessionReviewCard
        review={review({
          exerciseChanges: [
            {
              kind: "skipped",
              exerciseName: "Lat Pulldown",
              headline: "Skipped planned Lat Pulldown",
              detail: "0 of 2 planned sets performed.",
              evidenceOnly: true,
            },
          ],
          loadCalibration: [
            {
              exerciseName: "Bench Press",
              status: "watch",
              headline: "Bench Press target looked too heavy",
              detail: "Performed median load 95 vs target 105.",
              nextExposureNote: "This duplicate recommendation stays hidden.",
              evidenceOnly: true,
            },
          ],
          learningSignals: [
            {
              label: "Runtime edits",
              severity: "info",
              summary: "Session-local exercise changes are review evidence only.",
            },
          ],
        })}
      />
    );

    expect(screen.getByText("Exercise changes")).toBeInTheDocument();
    expect(screen.getByText("Load evidence")).toBeInTheDocument();
    expect(screen.getByText("Other evidence")).toBeInTheDocument();
    expect(screen.queryByText("This duplicate recommendation stays hidden.")).not.toBeInTheDocument();
  });

  it("renders blocked and not-ready states without deriving a fallback conclusion", () => {
    render(
      <PostSessionReviewCard
        review={review({
          status: "not_ready",
          headline: "Post-session review is not ready",
          completion: null,
          warnings: ["Workout needs to be completed or partially completed first."],
        })}
      />
    );

    expect(screen.getByText("Post-session review is not ready")).toBeInTheDocument();
    expect(
      screen.getByText("Workout needs to be completed or partially completed first.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Good session")).not.toBeInTheDocument();
  });

  it("depends only on the display DTO, not producer or audit internals", () => {
    const source = readFileSync(
      "src/components/post-workout/PostSessionReviewCard.tsx",
      "utf8"
    );

    expect(source).toContain("PostSessionReviewDisplayDto");
    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("post-session-review-contract");
    expect(source).not.toContain("post-session-review-producer");
    expect(source).not.toContain("@/lib/db/prisma");
  });
});
