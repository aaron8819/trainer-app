import { readFileSync } from "node:fs";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomePreSessionReadinessPanel } from "./HomePreSessionReadinessPanel";
import type { PreSessionReadinessGymCardDto } from "@/lib/api/pre-session-readiness-gym-card";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

function makeCard(
  overrides: Partial<PreSessionReadinessGymCardDto> = {}
): PreSessionReadinessGymCardDto {
  return {
    safeToTrain: true,
    action: "start",
    sessionLabel: "Week 2 Session 2 - lower_a lower",
    primaryInstruction: "Run the seeded session as prescribed.",
    rpeCap: "prescribed",
    mainPriority: "Optional Chest add-on: Cable Fly.",
    avoid: ["Avoid extra Side Delts (over_mav)."],
    optionalAddOns: {
      status: "available",
      reason: "Contract has session-local optional add-on rows.",
      items: [
        {
          kind: "priority",
          muscle: "Chest",
          targetMuscle: "Chest",
          candidateExerciseName: "Cable Fly",
          source: "dose_closure_recommendation",
        },
      ],
    },
    calibrationNotes: [
      {
        kind: "prescription_confidence",
        message: "Bench target ran hot last week.",
      },
    ],
    blockers: [],
    warnings: ["Watch posterior-chain fatigue."],
    source: {
      contractVersion: 1,
      kind: "typed_pre_session_readiness_contract",
      ownerSeam: "api/pre-session-readiness-contract",
      readOnly: true,
      auditOnly: false,
      producerMode: "persisted_snapshot",
    },
    ...overrides,
  };
}

beforeEach(() => {
  mocks.refresh.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })) as unknown as typeof fetch
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("HomePreSessionReadinessPanel", () => {
  it("renders a manual readiness action when no card exists and preparation is available", () => {
    render(<HomePreSessionReadinessPanel card={null} canPrepare={true} />);

    expect(screen.getByRole("button", { name: "Check readiness" })).toBeInTheDocument();
    expect(
      screen.getByText("Get session-specific coaching before you train.")
    ).toBeInTheDocument();
  });

  it("renders nothing when no card exists and there is no next workout to prepare", () => {
    const { container } = render(
      <HomePreSessionReadinessPanel card={null} canPrepare={false} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("calls the prepare endpoint and refreshes Home on success", async () => {
    const user = userEvent.setup();
    render(<HomePreSessionReadinessPanel card={null} canPrepare={true} />);

    await user.click(screen.getByRole("button", { name: "Check readiness" }));

    expect(screen.getByRole("button", { name: "Checking readiness..." })).toBeDisabled();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/pre-session-readiness/prepare", {
        method: "POST",
      })
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it("shows a non-blocking error when preparation fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ message: "No concrete next-session identity is available." }),
      })) as unknown as typeof fetch
    );
    render(<HomePreSessionReadinessPanel card={null} canPrepare={true} />);

    await user.click(screen.getByRole("button", { name: "Check readiness" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No concrete next-session identity is available."
    );
    expect(screen.getByRole("button", { name: "Check readiness" })).toBeEnabled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("renders readiness card DTO fields without parsing render strings", () => {
    render(<HomePreSessionReadinessPanel card={makeCard()} canPrepare={true} />);

    expect(screen.getByText("Safe to train")).toBeInTheDocument();
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Week 2 Session 2 - lower_a lower" })).toBeInTheDocument();
    expect(screen.getByText("Run the seeded session as prescribed.")).toBeInTheDocument();
    expect(screen.getByText("RPE cap: Prescribed")).toBeInTheDocument();
    expect(screen.getByText("Optional Chest add-on: Cable Fly.")).toBeInTheDocument();
    expect(screen.getByText("Chest: Cable Fly")).toBeInTheDocument();
    expect(screen.getByText("Avoid extra Side Delts (over_mav).")).toBeInTheDocument();
    expect(screen.getByText("Watch posterior-chain fatigue.")).toBeInTheDocument();
    expect(screen.getByText("Bench target ran hot last week.")).toBeInTheDocument();
  });

  it("renders explicit no-add-ons copy when no optional add-ons are present", () => {
    render(
      <HomePreSessionReadinessPanel
        card={makeCard({
          mainPriority: "Run the prescribed session without extra add-ons.",
          optionalAddOns: {
            status: "none",
            reason: "No valid session-local optional add-ons from the typed readiness contract.",
            items: [],
          },
        })}
        canPrepare={true}
      />
    );

    expect(screen.getByText("No add-ons recommended.")).toBeInTheDocument();
    expect(
      screen.getByText("No valid session-local optional add-ons from the typed readiness contract.")
    ).toBeInTheDocument();
  });

  it("renders blocked readiness without normal start coaching", () => {
    render(
      <HomePreSessionReadinessPanel
        card={makeCard({
          safeToTrain: false,
          action: "blocked",
          primaryInstruction: "Resolve readiness blocker before training.",
          rpeCap: null,
          mainPriority: "Resolve blockers before any start or add-on decision.",
          optionalAddOns: {
            status: "blocked",
            reason: "Blocked until closeout is resolved.",
            items: [],
          },
          blockers: ["Resolve closeout first."],
          warnings: [],
        })}
        canPrepare={true}
      />
    );

    expect(screen.getByText("Not safe to start")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Resolve readiness blocker before training.")).toBeInTheDocument();
    expect(screen.getByText("Resolve closeout first.")).toBeInTheDocument();
    expect(screen.queryByText("Run the seeded session as prescribed.")).not.toBeInTheDocument();
  });

  it("does not import audit modules or parse CLI/render strings", () => {
    const source = readFileSync(
      "src/components/HomePreSessionReadinessPanel.tsx",
      "utf8"
    );

    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("buildPreSessionReadinessSummary");
    expect(source).not.toContain("runWorkoutAuditGeneration");
    expect(source).not.toContain("buildWorkoutAuditContext");
    expect(source).not.toContain("artifacts/audits");
    expect(source).not.toMatch(/\.(line|addonLine)\b/);
  });
});
