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
    headline: "Post-session review ready",
    summaryBullets: ["Completed planned work", "No seed or plan changes made"],
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
  afterEach(() => {
    cleanup();
  });

  it("renders a clean review headline, summary, and completion", () => {
    render(<PostSessionReviewCard review={review()} />);

    expect(screen.getByLabelText("Post-session review")).toBeInTheDocument();
    expect(screen.getByText("Post-session review ready")).toBeInTheDocument();
    expect(screen.getByText("Completed planned work")).toBeInTheDocument();
    expect(screen.getAllByText("No seed or plan changes made")).toHaveLength(2);
    expect(
      screen.getByText("100% of planned/session-local work logged")
    ).toBeInTheDocument();
    expect(screen.getByText(/3 completed of 3 planned sets/)).toBeInTheDocument();
  });

  it("renders exercise changes, calibration, next exposure, weekly impact, and learning notes", () => {
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
            {
              kind: "runtime_added",
              exerciseName: "Cable Curl",
              headline: "Added Cable Curl",
              detail: "2 session-local sets performed.",
              evidenceOnly: true,
            },
            {
              kind: "replacement_evidence",
              exerciseName: "Machine Row",
              headline: "Used Machine Row instead of Barbell Row",
              detail: "Captured as evidence only; no automatic exercise or seed change.",
              evidenceOnly: true,
            },
          ],
          performedReality: [
            {
              exerciseName: "Bench Press",
              status: "info",
              label: "Performed as planned",
              headline: "Bench Press matched the plan",
              detail:
                "3 of 3 prescribed sets performed; target 8-12 reps, load 100, RPE 8; actual median 10 reps, load 100, RPE 8.",
              evidenceOnly: true,
            },
            {
              exerciseName: "Lat Pulldown",
              status: "watch",
              label: "Under plan",
              headline: "Lat Pulldown came in under the plan",
              detail:
                "1 of 3 prescribed sets performed; target 8-12 reps, load 100, RPE 8; actual median 8 reps, load 90, RPE 9.",
              evidenceOnly: true,
            },
          ],
          loadCalibration: [
            {
              exerciseName: "Bench Press",
              status: "watch",
              headline: "Bench Press target looked too light",
              detail: "Performed median load 130 vs target 100.",
              nextExposureNote: "Next exposure: raise starting point modestly.",
              evidenceOnly: true,
            },
          ],
          nextExposureNotes: [
            {
              exerciseName: "Bench Press",
              recommendation: "Next exposure: raise starting point modestly.",
              basis: "Based on logged reps, effort, and anchor load 130.",
              evidenceOnly: true,
              mutation: false,
            },
          ],
          weeklyImpact: [
            {
              muscle: "Chest",
              headline: "Chest ended approaching weekly target",
              detail: "9 effective sets projected vs 10 target.",
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
    expect(screen.getByText("Skipped planned Lat Pulldown")).toBeInTheDocument();
    expect(screen.getByText("Added Cable Curl")).toBeInTheDocument();
    expect(screen.getByText("Used Machine Row instead of Barbell Row")).toBeInTheDocument();
    expect(screen.getByText("Performed reality")).toBeInTheDocument();
    expect(screen.getByText("Bench Press matched the plan")).toBeInTheDocument();
    expect(screen.getByText("Lat Pulldown came in under the plan")).toBeInTheDocument();
    expect(screen.getByText("Performed as planned")).toBeInTheDocument();
    expect(screen.getByText("Under plan")).toBeInTheDocument();
    expect(screen.getByText("Load calibration")).toBeInTheDocument();
    expect(screen.getByText("Bench Press target looked too light")).toBeInTheDocument();
    expect(screen.getByText("Next exposure notes")).toBeInTheDocument();
    expect(screen.getByText("Based on logged reps, effort, and anchor load 130.")).toBeInTheDocument();
    expect(screen.getByText("Weekly impact")).toBeInTheDocument();
    expect(screen.getByText("Chest ended approaching weekly target")).toBeInTheDocument();
    expect(screen.getByText("Learning signals")).toBeInTheDocument();
    expect(screen.getByText("Runtime edits")).toBeInTheDocument();
  });

  it("suppresses empty optional sections", () => {
    render(<PostSessionReviewCard review={review()} />);

    expect(screen.queryByText("Exercise changes")).not.toBeInTheDocument();
    expect(screen.queryByText("Performed reality")).not.toBeInTheDocument();
    expect(screen.queryByText("Load calibration")).not.toBeInTheDocument();
    expect(screen.queryByText("Next exposure notes")).not.toBeInTheDocument();
    expect(screen.queryByText("Weekly impact")).not.toBeInTheDocument();
    expect(screen.queryByText("Learning signals")).not.toBeInTheDocument();
    expect(screen.queryByText("Warnings")).not.toBeInTheDocument();
  });

  it("renders blocked and not-ready reviews as small non-alarming states", () => {
    render(
      <PostSessionReviewCard
        review={review({
          status: "not_ready",
          headline: "Post-session review is not ready",
          summaryBullets: ["No seed or plan changes made"],
          completion: null,
          warnings: ["Workout needs to be completed or partially completed first."],
        })}
      />
    );

    expect(screen.getByText("Post-session review is not ready")).toBeInTheDocument();
    expect(
      screen.getByText("Workout needs to be completed or partially completed first.")
    ).toBeInTheDocument();
    expect(screen.getByText("No seed or plan changes made")).toBeInTheDocument();
    expect(screen.queryByText("Warnings")).not.toBeInTheDocument();
  });

  it("does not expose raw debug or internal contract strings", () => {
    const { container } = render(
      <PostSessionReviewCard
        review={review({
          exerciseChanges: [
            {
              kind: "replacement_evidence",
              exerciseName: "Bench Press",
              headline: "Used Bench Press instead of Barbell Bench Press",
              detail: "Captured as evidence only; no automatic exercise or seed change.",
              evidenceOnly: true,
            },
          ],
          nextExposureNotes: [
            {
              exerciseName: "Bench Press",
              recommendation: "Next exposure: raise starting point modestly.",
              basis: "Based on logged reps, effort, and anchor load 130.",
              evidenceOnly: true,
              mutation: false,
            },
          ],
        })}
      />
    );
    const visibleText = container.textContent ?? "";

    expect(visibleText).not.toContain("runtime_edit_reconciliation");
    expect(visibleText).not.toContain("replacement_like");
    expect(visibleText).not.toContain("target_too_low");
    expect(visibleText).not.toContain("under_performed");
    expect(visibleText).not.toContain("over_performed");
    expect(visibleText).not.toContain("missing_actuals");
    expect(visibleText).not.toContain("decisionLog");
    expect(visibleText).not.toContain("policyMutation");
    expect(visibleText).not.toContain("seedMutation");
    expect(visibleText).not.toContain("selectionMetadata");
  });

  it("does not import audit, CLI, artifact, producer, or contract internals", () => {
    const source = readFileSync(
      "src/components/post-workout/PostSessionReviewCard.tsx",
      "utf8"
    );

    expect(source).toContain("PostSessionReviewDisplayDto");
    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("scripts/workout-audit");
    expect(source).not.toContain("artifacts/audits");
    expect(source).not.toContain("post-session-review-contract");
    expect(source).not.toContain("post-session-review-evidence");
    expect(source).not.toContain("post-session-review-producer");
    expect(source).not.toContain("@/lib/db/prisma");
  });
});
