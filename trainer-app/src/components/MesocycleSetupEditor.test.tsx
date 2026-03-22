import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MesocycleSetupEditor } from "./MesocycleSetupEditor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        preview: buildPreview(),
      }),
    })
  );
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
      volumeEntry: "conservative" as const,
      baselineSource: "accumulation_preferred" as const,
      allowNonDeloadFallback: true as const,
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

function buildPreview(overrides?: Partial<{
  summary: Partial<{
    title: string;
    focus: string;
    mesoNumber: number;
    splitType: "UPPER_LOWER" | "PPL" | "FULL_BODY" | "CUSTOM";
    sessionsPerWeek: number;
    daysPerWeek: number;
    keepCount: number;
    rotateCount: number;
    dropCount: number;
  }>;
  slotPlanProjection: {
    slotPlans: Array<{
      slotId: string;
      intent: "UPPER" | "LOWER" | "PUSH" | "PULL" | "LEGS" | "FULL_BODY" | "BODY_PART";
      exercises: Array<{
        exerciseId: string;
        role: "CORE_COMPOUND" | "ACCESSORY";
      }>;
    }>;
  } | null;
  display: {
    projectedSlotPlans: Array<{
      slotId: string;
      intent: "UPPER" | "LOWER" | "PUSH" | "PULL" | "LEGS" | "FULL_BODY" | "BODY_PART";
      label: string;
      exercises: Array<{
        exerciseId: string;
        exerciseName: string;
        role: "CORE_COMPOUND" | "ACCESSORY";
      }>;
    }>;
  };
  slotPlanError: string | null;
}>) {
  const defaultDisplaySlots = [
    {
      slotId: "upper_a",
      intent: "UPPER" as const,
      label: "Upper 1",
      exercises: [
        {
          exerciseId: "bench",
          exerciseName: "Bench Press",
          role: "CORE_COMPOUND" as const,
        },
        {
          exerciseId: "row",
          exerciseName: "Chest-Supported Row",
          role: "ACCESSORY" as const,
        },
      ],
    },
    {
      slotId: "lower_a",
      intent: "LOWER" as const,
      label: "Lower 1",
      exercises: [],
    },
    {
      slotId: "upper_b",
      intent: "UPPER" as const,
      label: "Upper 2",
      exercises: [
        {
          exerciseId: "bench",
          exerciseName: "Bench Press",
          role: "CORE_COMPOUND" as const,
        },
      ],
    },
    {
      slotId: "lower_b",
      intent: "LOWER" as const,
      label: "Lower 2",
      exercises: [],
    },
  ];

  return {
    summary: {
      title: "Meso 2 - Upper Hypertrophy",
      focus: "Upper Hypertrophy",
      mesoNumber: 2,
      splitType: "UPPER_LOWER" as const,
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      slotSequence: [],
      keepCount: 1,
      rotateCount: 1,
      dropCount: 0,
      ...overrides?.summary,
    },
    slotPlanProjection: overrides?.slotPlanProjection ?? {
      slotPlans: defaultDisplaySlots.map((slot) => ({
        slotId: slot.slotId,
        intent: slot.intent,
        exercises: slot.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          role: exercise.role,
        })),
      })),
    },
    display: overrides?.display ?? {
      projectedSlotPlans: defaultDisplaySlots,
    },
    slotPlanError: overrides?.slotPlanError ?? null,
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
        initialPreview={buildPreview()}
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
        initialPreview={buildPreview()}
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
        initialPreview={buildPreview()}
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

  it("renders and refreshes the server-owned successor preview as a read-only section", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        preview: buildPreview({
          summary: {
            sessionsPerWeek: 3,
            daysPerWeek: 3,
          },
          slotPlanProjection: {
            slotPlans: [
              {
                slotId: "upper_a",
                intent: "UPPER",
                exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
              },
              {
                slotId: "lower_a",
                intent: "LOWER",
                exercises: [],
              },
              {
                slotId: "upper_b",
                intent: "UPPER",
                exercises: [{ exerciseId: "row", role: "ACCESSORY" }],
              },
            ],
          },
          display: {
            projectedSlotPlans: [
              {
                slotId: "upper_a",
                intent: "UPPER",
                label: "Upper 1",
                exercises: [
                  {
                    exerciseId: "bench",
                    exerciseName: "Bench Press",
                    role: "CORE_COMPOUND",
                  },
                ],
              },
              {
                slotId: "lower_a",
                intent: "LOWER",
                label: "Lower 1",
                exercises: [],
              },
              {
                slotId: "upper_b",
                intent: "UPPER",
                label: "Upper 2",
                exercises: [
                  {
                    exerciseId: "row",
                    exerciseName: "Chest-Supported Row",
                    role: "ACCESSORY",
                  },
                ],
              },
            ],
          },
        }),
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(
      <MesocycleSetupEditor
        mesocycleId="meso-1"
        recommendedDraft={buildDraft()}
        initialDraft={buildDraft()}
        initialPreview={buildPreview()}
      />
    );

    expect(screen.getByText("Meso 2 - Upper Hypertrophy would start as 4x/week Upper / Lower.")).toBeInTheDocument();
    expect(screen.getByText("1 keep / 1 rotate / 0 drop")).toBeInTheDocument();
    expect(screen.queryByText("Session slots")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Sessions per week"));
    await user.type(screen.getByLabelText("Sessions per week"), "3");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/mesocycles/meso-1/setup-preview",
        expect.objectContaining({
          method: "POST",
        })
      );
    });
    await waitFor(() => {
      expect(
        screen.getByText("Meso 2 - Upper Hypertrophy would start as 3x/week Upper / Lower.")
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Show preview" }));

    expect(screen.getByText("This is a read-only preview of what Accept would create from the current draft. No mesocycle has been created yet.")).toBeInTheDocument();
    expect(screen.getByText("Upper 1")).toBeInTheDocument();
    expect(screen.getByText("Upper 2")).toBeInTheDocument();
    expect(screen.getByText("Chest-Supported Row")).toBeInTheDocument();
  });
});
