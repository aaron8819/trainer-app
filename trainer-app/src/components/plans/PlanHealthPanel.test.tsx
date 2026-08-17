import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HypertrophyPlanHealthResult } from "@/lib/engine/hypertrophy-plan-health";
import { PlanHealthPanel } from "./PlanHealthPanel";

afterEach(cleanup);

function assessment(issueCount = 3): HypertrophyPlanHealthResult {
  const baseIssues = [
    {
      code: "EMPTY_SESSION",
      tier: "BLOCKING_SAFETY" as const,
      title: "Empty session",
      explanation: "Lower B needs at least one exercise.",
      suggestedAction: "Add an exercise manually.",
      affected: { session: "Lower B" },
      blocksFinalization: true,
      requiresAcknowledgment: false,
    },
    {
      code: "DUPLICATE_EXERCISE",
      tier: "IMPORTANT_WARNING" as const,
      title: "Duplicate exercise",
      explanation: "Bench Press appears twice.",
      suggestedAction: "Review whether the repetition is deliberate.",
      affected: { session: "Upper A", exercise: "Bench Press" },
      blocksFinalization: false,
      requiresAcknowledgment: true,
    },
    {
      code: "MISSING_COVERAGE",
      tier: "COACHING_OBSERVATION" as const,
      title: "No direct calf work",
      explanation:
        "No direct calf work. That may be intentional because calves are not a stated plan priority.",
      suggestedAction: "Keep this choice if it is intentional; no change is required.",
      affected: { muscle: "Calves" },
      blocksFinalization: false,
      requiresAcknowledgment: false,
    },
  ];
  const issues = Array.from({ length: issueCount }, (_, index) => ({
    ...baseIssues[index % baseIssues.length]!,
    code: `${baseIssues[index % baseIssues.length]!.code}-${index}`,
  }));
  return {
    status: "AVAILABLE",
    policyVersion: "draft-plan-health.v2",
    draftId: "plan-1",
    draftRevision: 9,
    confirmationScope: `plan-health-confirmation.v1.${"9".repeat(64)}`,
    evaluatedWeek: 1,
    summary: {
      blockingSafety: issues.filter((issue) => issue.tier === "BLOCKING_SAFETY").length,
      importantWarnings: issues.filter((issue) => issue.tier === "IMPORTANT_WARNING").length,
      coachingObservations: issues.filter((issue) => issue.tier === "COACHING_OBSERVATION").length,
      informationalVolumeAvailable: true,
    },
    issues,
    volumeEstimates: [
      {
        tier: "INFORMATIONAL_ESTIMATE",
        muscle: "Upper Back",
        directSets: 5,
        effectiveSets: 7.6,
        frequency: 2,
        referenceRange: { min: 6, max: 22 },
      },
    ],
    sessionEstimates: [{ session: "Upper A", estimatedMinutes: 64 }],
    evaluatedFacts: {
      catalogExerciseCount: 150,
      equipmentProfile: "FULL_GYM",
      recognizedLimitationCount: 0,
      unrecognizedLimitationsPresent: false,
    },
  };
}

describe("PlanHealthPanel", () => {
  it("renders semantic tier counts, issue details, and neutral approximate volume", () => {
    render(<PlanHealthPanel health={assessment()} stale={false} updating={false} />);

    expect(screen.getByRole("heading", { name: "Plan Health" })).toBeVisible();
    expect(screen.getByText("Current for saved revision 9.")).toBeVisible();
    expect(screen.getByText("Blocking safety · Blocks finalization")).toBeVisible();
    fireEvent.click(screen.getByText("Review before finalizing"));
    expect(screen.getByText("Important warning · Does not block finalization")).toBeVisible();
    fireEvent.click(screen.getByText("Coaching notes"));
    expect(screen.getByText("Coaching observation · Does not block finalization")).toBeVisible();

    fireEvent.click(screen.getByText("Estimated weekly volume"));
    expect(screen.getByText(/~7\.6 effective sets/)).toHaveTextContent(
      "Upper Back: ~7.6 effective sets · ~5 direct sets · 2× weekly frequency · reference context 6–22",
    );
    expect(screen.getByText(/Reference ranges are context, not quotas/)).toBeVisible();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/incomplete/i)).toBeNull();
  });

  it("announces stale/updating and unavailable states without claiming success", () => {
    const { rerender } = render(
      <PlanHealthPanel health={assessment()} stale updating />,
    );
    expect(
      screen.getByText("Updating after save… Based on the last saved version."),
    ).toBeVisible();
    expect(screen.getByRole("region", { name: "Plan Health" })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    rerender(
      <PlanHealthPanel
        health={{
          status: "UNAVAILABLE",
          policyVersion: "draft-plan-health.v2",
          draftId: "plan-1",
          draftRevision: 10,
          reason: "EVALUATION_FAILED",
        }}
        stale={false}
        updating={false}
      />,
    );
    expect(screen.getByText("Health is temporarily unavailable")).toBeVisible();
    expect(screen.getByText(/not a “no issues” result/)).toBeVisible();
    expect(screen.queryByText("Current for saved revision 10.")).toBeNull();
  });

  it("keeps focus stable and tier controls touch-sized with long issue lists", () => {
    const { rerender } = render(
      <PlanHealthPanel health={assessment(36)} stale={false} updating={false} />,
    );
    const coachingSummary = screen.getByText("Coaching notes").closest("summary");
    expect(coachingSummary).toHaveClass("min-h-11");
    coachingSummary?.focus();
    expect(document.activeElement).toBe(coachingSummary);

    rerender(
      <PlanHealthPanel health={assessment(39)} stale={false} updating={false} />,
    );
    expect(document.activeElement).toBe(coachingSummary);
    expect(screen.getByLabelText("Coaching notes").querySelectorAll("li").length).toBe(13);
  });
});
