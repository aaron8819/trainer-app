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
    action: "watch",
    sessionLabel: "Upper 2",
    primaryInstruction: "Run the planned workout. Keep effort around the prescribed RPE cap.",
    rpeCap: "prescribed",
    mainPriority: "Optional Chest add-on: Cable Fly.",
    avoid: ["Avoid extra Side Delts: weekly cap already high."],
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
        message: "Bench Press: Hold the target load unless the first set feels clearly too easy or too hard.",
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

  it("renders the readiness card as compact coaching copy", () => {
    render(<HomePreSessionReadinessPanel card={makeCard()} canPrepare={true} />);

    expect(screen.getByText("Safe to train")).toBeInTheDocument();
    expect(screen.getByText("Calibration day")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready for Upper 2" })).toBeInTheDocument();
    expect(screen.getByText("Safe to train - Use calibration judgment")).toBeInTheDocument();
    expect(
      screen.getByText("Run the planned workout. Keep effort around the prescribed RPE cap.")
    ).toBeInTheDocument();
    expect(screen.getByText("Use the prescribed cap")).toBeInTheDocument();
    expect(
      screen.getByText("Planned workout first; add optional work only if warm-ups feel normal.")
    ).toBeInTheDocument();
    expect(screen.getByText("Optional: Cable Fly")).toBeInTheDocument();
    expect(screen.queryByText("Optional Chest add-on: Cable Fly.")).not.toBeInTheDocument();
    expect(
      screen.getByText("Avoid extra Side Delts: weekly cap already high.")
    ).toBeInTheDocument();
    expect(screen.getByText("Watch posterior-chain fatigue.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Bench Press: Hold the target load unless the first set feels clearly too easy or too hard."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Contract has session-local optional add-on rows.")).not.toBeInTheDocument();
  });

  it("renders explicit no-add-ons copy when no optional add-ons are present", () => {
    render(
      <HomePreSessionReadinessPanel
        card={makeCard({
          action: "start",
          mainPriority: "Run the planned workout; no extra work needed today.",
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
      screen.getByText("Run the planned workout; no extra work needed today.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No valid session-local optional add-ons from the typed readiness contract.")
    ).not.toBeInTheDocument();
  });

  it("suppresses empty optional sections", () => {
    render(
      <HomePreSessionReadinessPanel
        card={makeCard({
          action: "start",
          avoid: [],
          warnings: [],
          blockers: [],
          calibrationNotes: [],
          optionalAddOns: {
            status: "none",
            reason: "No add-ons recommended.",
            items: [],
          },
        })}
        canPrepare={true}
      />
    );

    expect(screen.queryByText("Avoid")).not.toBeInTheDocument();
    expect(screen.queryByText("Warnings")).not.toBeInTheDocument();
    expect(screen.queryByText("Blockers")).not.toBeInTheDocument();
    expect(screen.queryByText("Load Notes")).not.toBeInTheDocument();
  });

  it("does not render internal debug strings in the coaching card", () => {
    render(<HomePreSessionReadinessPanel card={makeCard()} canPrepare={true} />);

    expect(screen.queryByText(/Contract has/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/progression trace unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/action=/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/confidence=/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reasons=/i)).not.toBeInTheDocument();
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
    expect(
      screen.getByRole("heading", { name: "Readiness blocked for Upper 2" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Not safe to start - Resolve blockers first")
    ).toBeInTheDocument();
    expect(screen.getByText("Resolve readiness blocker before training.")).toBeInTheDocument();
    expect(screen.getByText("Resolve closeout first.")).toBeInTheDocument();
    expect(
      screen.queryByText("Run the planned workout. Keep effort around the prescribed RPE cap.")
    ).not.toBeInTheDocument();
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
    expect(source).not.toContain("action=");
    expect(source).not.toContain("confidence=");
    expect(source).not.toContain("reasons=");
    expect(source).not.toContain("progression trace unavailable");
    expect(source).not.toMatch(/\.(line|addonLine)\b/);
  });
});
