import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MesocycleSetupEditor } from "./MesocycleSetupEditor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
});

function buildDraft() {
  return {
    version: 1 as const,
    sourceMesocycleId: "meso-1",
    createdAt: "2026-04-01T00:00:00.000Z",
    structure: {
      splitType: "UPPER_LOWER" as const,
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      sequenceMode: "ordered_flexible" as const,
      slots: [
        { slotId: "upper_a", intent: "UPPER" as const },
        { slotId: "lower_a", intent: "LOWER" as const },
        { slotId: "upper_b", intent: "UPPER" as const },
        { slotId: "lower_b", intent: "LOWER" as const },
      ],
    },
    startingPoint: {
      volumePreset: "conservative_productive" as const,
      baselineRule: "peak_accumulation_else_highest_accumulation_else_non_deload" as const,
      excludeDeload: true as const,
    },
    carryForwardSelections: [
      {
        exerciseId: "bench",
        exerciseName: "Bench Press",
        sessionIntent: "UPPER" as const,
        role: "CORE_COMPOUND" as const,
        action: "keep" as const,
      },
      {
        exerciseId: "curl",
        exerciseName: "Incline Curl",
        sessionIntent: "UPPER" as const,
        role: "ACCESSORY" as const,
        action: "rotate" as const,
      },
    ],
  };
}

describe("MesocycleSetupEditor", () => {
  it("previews carry-forward conflicts immediately when the split removes a kept exercise intent", async () => {
    const user = userEvent.setup();

    render(
      <MesocycleSetupEditor
        mesocycleId="meso-1"
        recommendedDraft={buildDraft()}
        initialDraft={buildDraft()}
      />
    );

    await user.selectOptions(screen.getByLabelText("Split type"), "PPL");

    expect(
      screen.getByText("Carry-forward conflicts need to be resolved before save or accept.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Bench Press can no longer be kept because this draft does not include the Upper session type."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This draft does not include the Upper session type for this keep. Change it to Rotate or Drop to continue."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fix all conflicts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Accept and create next cycle" })).toBeDisabled();
    expect(screen.getByText("Resolve 1 carry-forward conflict to save or accept.")).toBeInTheDocument();
    expect(screen.getByText("Changes will be saved on accept.")).toBeInTheDocument();
  });

  it("re-enables save and accept after the conflicting keep action is resolved", async () => {
    const user = userEvent.setup();

    render(
      <MesocycleSetupEditor
        mesocycleId="meso-1"
        recommendedDraft={buildDraft()}
        initialDraft={buildDraft()}
      />
    );

    await user.selectOptions(screen.getByLabelText("Split type"), "PPL");
    await user.selectOptions(screen.getByDisplayValue("Keep"), "rotate");

    expect(
      screen.queryByText("Carry-forward conflicts need to be resolved before save or accept.")
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Accept and create next cycle" })).toBeEnabled();
    expect(
      screen.queryByText("Resolve 1 carry-forward conflict to save or accept.")
    ).not.toBeInTheDocument();
  });

  it("can bulk-fix all current carry-forward conflicts", async () => {
    const user = userEvent.setup();

    render(
      <MesocycleSetupEditor
        mesocycleId="meso-1"
        recommendedDraft={buildDraft()}
        initialDraft={buildDraft()}
      />
    );

    await user.selectOptions(screen.getByLabelText("Split type"), "PPL");
    await user.click(screen.getByRole("button", { name: "Fix all conflicts" }));

    expect(
      screen.queryByText("Carry-forward conflicts need to be resolved before save or accept.")
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Accept and create next cycle" })).toBeEnabled();
  });
});
