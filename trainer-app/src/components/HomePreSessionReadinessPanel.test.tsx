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
    workoutPreview: {
      source: "generated_session_audit_snapshot",
      targetRpeLabel: "RPE 8",
      exercises: [
        {
          exerciseId: "bench",
          exerciseName: "Bench Press",
          setCount: 3,
          repTargetLabel: "6-10 reps",
          targetLoadLabel: "185 lb",
          targetRpeLabel: "RPE 8",
        },
        {
          exerciseId: "row",
          exerciseName: "Chest-Supported Row",
          setCount: 2,
          repTargetLabel: "8-12 reps",
          targetLoadLabel: null,
          targetRpeLabel: "RPE 8",
        },
      ],
    },
    mainPriority: "Bench should be crisp before adding chest isolation.",
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
          reason: "Chest is the highest-value session-local gap.",
          guardrail: "Add only if warm-ups and planned Cable Fly work feel normal.",
        },
      ],
    },
    calibrationNotes: [
      {
        kind: "prescription_confidence",
        exerciseLabel: "Bench Press",
        displayActionCode: "use_target_as_starting_point",
        message: "Bench Press: Use the target as a starting point; adjust by feel.",
      },
      {
        kind: "prescription_confidence",
        exerciseLabel: "Chest-Supported Row",
        displayActionCode: "use_target_as_starting_point",
        message: "Chest-Supported Row: Use the target as a starting point; adjust by feel.",
      },
      {
        kind: "prescription_confidence",
        exerciseLabel: "Cable Rear Delt Fly",
        displayActionCode: "machine_or_cable_target_may_need_calibration",
        message:
          "Cable Rear Delt Fly: First working set calibrates this machine/cable target; reduce one load step if reps fall short or RPE jumps.",
      },
      {
        kind: "prescription_confidence",
        exerciseLabel: "Cable Fly",
        displayActionCode: "hold_target_load",
        message:
          "Cable Fly: Hold the target load unless the first set feels clearly too easy or too hard.",
      },
    ],
    blockers: [],
    fatigueWatch: ["Keep lower-body add-ons off the table today; glutes and hamstrings are already carrying fatigue."],
    warnings: [],
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
    expect(screen.getByText("Today's Workout")).toBeInTheDocument();
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("3 sets - 6-10 reps - load 185 lb")).toBeInTheDocument();
    expect(screen.getByText("Chest-Supported Row")).toBeInTheDocument();
    expect(screen.getByText("2 sets - 8-12 reps")).toBeInTheDocument();
    expect(screen.getAllByText(/RPE 8/)).toHaveLength(1);
    expect(screen.getByText("Target effort: RPE 8. Use the prescribed cap.")).toBeInTheDocument();
    expect(
      screen.getByText("Bench should be crisp before adding chest isolation.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Cable Fly - Chest is the highest-value session-local gap.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Add only if warm-ups and planned Cable Fly work feel normal.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Avoid extra Side Delts: weekly cap already high.")
    ).toBeInTheDocument();
    expect(screen.getByText("Fatigue Watch")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Keep lower-body add-ons off the table today; glutes and hamstrings are already carrying fatigue."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Use the first working set to dial in these machine/cable targets: Cable Rear Delt Fly."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Use the first working set to dial in these targets: Bench Press, Chest-Supported Row."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Adjust to stay near the target RPE. Hold if reps and form match the target; reduce one load step if reps fall short, form breaks, or RPE jumps."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cable Fly: Hold the target load unless the first set feels clearly too easy or too hard."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Contract has session-local optional add-on rows.")).not.toBeInTheDocument();
  });

  it("keeps weekly volume and fatigue guidance out of Load Calibration", () => {
    render(
      <HomePreSessionReadinessPanel
        card={makeCard({
          avoid: [
            "No extra volume. Weekly volume is already covered across most muscle groups.",
          ],
          fatigueWatch: [
            "Keep lower-body add-ons off the table today; glutes and hamstrings are already carrying fatigue.",
          ],
          calibrationNotes: [
            {
              kind: "prescription_confidence",
              exerciseLabel: "Close-Grip Seated Cable Row",
              displayActionCode: "machine_or_cable_target_may_need_calibration",
              message:
                "Close-Grip Seated Cable Row: First working set calibrates this machine/cable target; reduce one load step if reps fall short or RPE jumps.",
            },
            {
              kind: "prescription_confidence",
              exerciseLabel: "Close-Grip Lat Pulldown",
              displayActionCode: "machine_or_cable_target_may_need_calibration",
              message:
                "Close-Grip Lat Pulldown: First working set calibrates this machine/cable target; reduce one load step if reps fall short or RPE jumps.",
            },
          ],
        })}
        canPrepare={true}
      />
    );

    const loadCalibration = screen
      .getByText("Load Calibration")
      .closest("div");
    expect(loadCalibration).toHaveTextContent(
      "Use the first working set to dial in these machine/cable targets: Close-Grip Seated Cable Row, Close-Grip Lat Pulldown."
    );
    expect(loadCalibration).not.toHaveTextContent("over target");
    expect(loadCalibration).not.toHaveTextContent("fatigue");
    expect(
      screen.getByText(
        "No extra volume. Weekly volume is already covered across most muscle groups."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Keep lower-body add-ons off the table today; glutes and hamstrings are already carrying fatigue."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/watch fatigue watch/i)).not.toBeInTheDocument();
  });

  it("renders exact adjustment ranges when the readiness DTO provides them", () => {
    render(
      <HomePreSessionReadinessPanel
        card={makeCard({
          calibrationNotes: [
            {
              kind: "prescription_confidence",
              exerciseLabel: "Cable Row",
              displayActionCode: "machine_or_cable_target_may_need_calibration",
              message:
                "Cable Row: Start at 80 lb; use 70-80 lb if first-set reps or RPE are off.",
              targetLoad: 80,
              adjustmentRangeBasis: "exact_range",
              suggestedAdjustmentRange: {
                minLoad: 70,
                maxLoad: 80,
                unit: "lb",
                basis: "target_effort_load_mismatch",
              },
            },
            {
              kind: "prescription_confidence",
              exerciseLabel: "Cable Rear Delt Fly",
              displayActionCode: "machine_or_cable_target_may_need_calibration",
              message:
                "Cable Rear Delt Fly: First working set calibrates this machine/cable target; reduce one load step if reps fall short or RPE jumps.",
            },
          ],
        })}
        canPrepare={true}
      />
    );

    const loadCalibration = screen
      .getByText("Load Calibration")
      .closest("div");
    expect(loadCalibration).toHaveTextContent(
      "Cable Row: start at 80 lb; use 70-80 lb if first-set reps or RPE are off."
    );
    expect(loadCalibration).toHaveTextContent(
      "Use the first working set to dial in these machine/cable targets: Cable Rear Delt Fly."
    );
  });

  it("renders target-load start guidance when no exact adjustment range exists", () => {
    render(
      <HomePreSessionReadinessPanel
        card={makeCard({
          calibrationNotes: [
            {
              kind: "prescription_confidence",
              exerciseLabel: "Cable Triceps Pushdown",
              displayActionCode: "hold_target_load",
              message:
                "Cable Triceps Pushdown: Start at 45 lb; hold unless the first set feels clearly too easy or too hard.",
              targetLoad: 45,
              adjustmentRangeBasis: "target_load_start",
            },
            {
              kind: "prescription_confidence",
              exerciseLabel: "Cable Rear Delt Fly",
              displayActionCode: "machine_or_cable_target_may_need_calibration",
              message:
                "Cable Rear Delt Fly: First working set calibrates this machine/cable target; reduce one load step if reps fall short or RPE jumps.",
            },
          ],
        })}
        canPrepare={true}
      />
    );

    const loadCalibration = screen
      .getByText("Load Calibration")
      .closest("div");
    expect(loadCalibration).toHaveTextContent(
      "Cable Triceps Pushdown: start at 45 lb; hold unless the first set feels clearly too easy or too hard."
    );
    expect(loadCalibration).toHaveTextContent(
      "Use the first working set to dial in these machine/cable targets: Cable Rear Delt Fly."
    );
  });

  it("suppresses generic Today's Focus copy when no optional add-ons are present", () => {
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

    expect(
      screen.queryByText("Run the planned workout; no extra work needed today.")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Today's Focus")).not.toBeInTheDocument();
    expect(screen.queryByText("Optional Add-ons")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No valid session-local optional add-ons from the typed readiness contract.")
    ).not.toBeInTheDocument();
  });

  it("renders high-signal Today's Focus when present", () => {
    render(
      <HomePreSessionReadinessPanel
        card={makeCard({
          mainPriority: "Keep hinges submaximal because posterior-chain fatigue is elevated.",
          optionalAddOns: {
            status: "none",
            reason: "No add-ons recommended.",
            items: [],
          },
        })}
        canPrepare={true}
      />
    );

    expect(screen.getByText("Today's Focus")).toBeInTheDocument();
    expect(
      screen.getByText("Keep hinges submaximal because posterior-chain fatigue is elevated.")
    ).toBeInTheDocument();
  });

  it("does not truncate long guidance lists with +N more", () => {
    render(
      <HomePreSessionReadinessPanel
        card={makeCard({
          avoid: [
            "Avoid extra rows.",
            "Avoid extra pulldowns.",
            "Avoid extra chest pressing.",
            "Avoid extra lateral raises.",
            "Avoid extra curls.",
          ],
          warnings: [
            "Watch warning 1.",
            "Watch warning 2.",
            "Watch warning 3.",
            "Watch warning 4.",
            "Watch warning 5.",
          ],
          fatigueWatch: [
            "Keep extra Glutes work off the table today; fatigue is already elevated.",
          ],
        })}
        canPrepare={true}
      />
    );

    expect(screen.getByText("Avoid extra curls.")).toBeInTheDocument();
    expect(screen.getByText("Watch warning 5.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Keep extra Glutes work off the table today; fatigue is already elevated."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/\+\d+ more/)).not.toBeInTheDocument();
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
          fatigueWatch: [],
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
    expect(screen.queryByText("Optional Add-ons")).not.toBeInTheDocument();
    expect(screen.queryByText("Warnings & Blockers")).not.toBeInTheDocument();
    expect(screen.queryByText("Load Calibration")).not.toBeInTheDocument();
    expect(screen.queryByText("Fatigue Watch")).not.toBeInTheDocument();
  });

  it("does not render internal debug strings in the coaching card", () => {
    render(<HomePreSessionReadinessPanel card={makeCard()} canPrepare={true} />);

    expect(screen.queryByText(/Contract has/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/progression trace unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/action=/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/confidence=/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reasons=/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/over target/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/watch fatigue watch/i)).not.toBeInTheDocument();
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
