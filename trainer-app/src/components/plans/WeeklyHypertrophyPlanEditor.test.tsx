import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeeklyHypertrophyPlanEditor } from "./WeeklyHypertrophyPlanEditor";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const intent = {
  userRole: "PRIMARY_LIFT" as const,
  target: {
    kind: "movement_pattern" as const,
    movementPattern: "horizontal_push" as const,
  },
};

const prescriptions = [
  {
    week: 1,
    status: "PRESCRIBE" as const,
    setCount: 3,
    reps: { kind: "RANGE" as const, min: 8, max: 12 },
    rir: { kind: "TARGET_RANGE" as const, min: 2, max: 3 },
  },
  {
    week: 2,
    status: "PRESCRIBE" as const,
    setCount: 3,
    reps: { kind: "EXACT" as const, reps: 8 },
    rir: { kind: "TARGET_RANGE" as const, min: 4, max: 5 },
  },
];

const exercises = [
  {
    id: "bench",
    name: "Bench Press",
    movementPatterns: ["horizontal_push" as const],
    primaryMuscleIds: ["chest" as const],
    secondaryMuscleIds: ["triceps" as const],
    stimulusByMuscleId: { chest: 1, triceps: 0.5 },
    equipment: ["barbell", "bench"],
    contraindicationKeys: [],
    isCompound: true,
    isMainLiftEligible: true,
    timePerSetSec: 180,
  },
  {
    id: "bench-alt",
    name: "Machine Chest Press",
    movementPatterns: ["horizontal_push" as const],
    primaryMuscleIds: ["chest" as const],
    secondaryMuscleIds: ["triceps" as const],
    stimulusByMuscleId: { chest: 1, triceps: 0.5 },
    equipment: ["machine"],
    contraindicationKeys: [],
    isCompound: true,
    isMainLiftEligible: true,
    timePerSetSec: 120,
  },
];

const initialData = {
  planId: "plan-v4",
  name: "Weekly plan",
  revision: 1,
  updatedAt: "2026-08-06T00:00:00.000Z",
  draft: {
    version: 2 as const,
    settings: {
      equipmentProfile: "FULL_GYM" as const,
      sessionDurationMinutes: 60 as const,
    },
    weeks: [
      { week: 1, phase: "ACCUMULATION" as const },
      { week: 2, phase: "DELOAD" as const },
    ],
    sessions: [
      {
        slotId: "upper",
        name: "Upper",
        focus: "UPPER" as const,
        exercises: [
          {
            placementId: "placement-a",
            exerciseId: "bench",
            intent,
            prescriptions,
          },
          {
            placementId: "placement-b",
            exerciseId: "bench-alt",
            intent: { ...intent, userRole: "SECONDARY_LIFT" as const },
            prescriptions,
          },
        ],
      },
      {
        slotId: "lower",
        name: "Lower",
        focus: "LOWER" as const,
        exercises: [],
      },
    ],
  },
  health: null,
  preview: {
    status: "INELIGIBLE" as const,
    reasons: [
      {
        code: "EMPTY_SESSION" as const,
        message: "Lower needs at least one exercise before preview.",
        slotId: "lower",
      },
    ],
  },
  exercises,
  limitationKeys: [],
};

describe("WeeklyHypertrophyPlanEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("crypto", {
      ...globalThis.crypto,
      randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000099"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          revision: 2,
          preview: initialData.preview,
        }),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps malformed placement text local and resumes autosave when valid", async () => {
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);

    fireEvent.change(screen.getAllByLabelText("Week 1 sets")[0]!, {
      target: { value: "" },
    });
    expect(screen.getByText("Incomplete — not saved")).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.change(screen.getAllByLabelText("Week 1 sets")[0]!, {
      target: { value: "5" },
    });
    await act(() => vi.advanceTimersByTimeAsync(1000));

    expect(fetch).toHaveBeenCalledTimes(1);
    const request = vi.mocked(fetch).mock.calls[0]![1]!;
    const body = JSON.parse(String(request.body));
    expect(body.draft.sessions[0].exercises[0].placementId).toBe("placement-a");
    expect(body.draft.sessions[0].exercises[0].prescriptions[0]).toMatchObject({
      week: 1,
      setCount: 5,
    });
  });

  it("preserves placement identity through reorder and swap and creates a new identity only on add", async () => {
    vi.useRealTimers();
    Object.defineProperty(window, "innerWidth", {
      value: 1280,
      configurable: true,
    });
    const user = userEvent.setup();
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);

    await user.click(screen.getByRole("button", { name: "Move Bench Press down" }));
    await user.selectOptions(
      screen.getByLabelText("Swap Bench Press and keep placement identity"),
      "bench-alt",
    );
    await user.click(screen.getByRole("button", { name: "+ Add exercise" }));
    await user.selectOptions(screen.getAllByLabelText("Exercise").at(-1)!, "bench");
    await user.click(screen.getByRole("button", { name: "Add exercise" }));

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 850));
    });

    const request = vi.mocked(fetch).mock.calls.at(-1)![1]!;
    const body = JSON.parse(String(request.body));
    expect(
      body.draft.sessions[0].exercises.map(
        (exercise: { placementId: string }) => exercise.placementId,
      ),
    ).toEqual([
      "placement-b",
      "placement-a",
      "00000000-0000-4000-8000-000000000099",
    ]);
    expect(body.draft.sessions[0].exercises[1]).toMatchObject({
      placementId: "placement-a",
      exerciseId: "bench-alt",
    });
    expect(body.draft.sessions[0].exercises[0].intent).toEqual({
      ...intent,
      userRole: "SECONDARY_LIFT",
    });
  });

  it("keeps the principal weekly, session, prescription, and preview controls available on mobile", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 390,
      configurable: true,
    });
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);

    expect(screen.getByRole("heading", { name: "Plan weeks" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Lower" })).toBeVisible();
    expect(screen.getAllByLabelText("Week 1 sets")[0]).toBeVisible();
    expect(screen.getByRole("heading", { name: "Normalized preview" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /ready|activate/i })).toBeNull();
  });
});
