import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HypertrophyPlanEditor } from "./HypertrophyPlanEditor";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function availableHealth(revision: number) {
  return {
    status: "AVAILABLE" as const,
    policyVersion: "draft-plan-health.v1" as const,
    draftId: "plan-1",
    draftRevision: revision,
    evaluatedWeek: 1,
    summary: {
      blockingSafety: 0,
      importantWarnings: 0,
      coachingObservations: 0,
      informationalVolumeAvailable: false,
    },
    issues: [],
    volumeEstimates: [],
    sessionEstimates: [
      { session: "Upper", estimatedMinutes: 21 },
      { session: "Lower", estimatedMinutes: 11 },
    ],
    evaluatedFacts: {
      catalogExerciseCount: 3,
      equipmentProfile: "FULL_GYM",
      recognizedLimitationCount: 0,
      unrecognizedLimitationsPresent: false,
    },
  };
}

const initialData = {
  planId: "plan-1",
  name: "Custom plan",
  revision: 1,
  updatedAt: "2026-08-04T00:00:00.000Z",
  draft: {
    version: 1 as const,
    settings: {
      equipmentProfile: "FULL_GYM" as const,
      sessionDurationMinutes: 60 as const,
    },
    sessions: [
      {
        slotId: "upper",
        name: "Upper",
        focus: "UPPER" as const,
        exercises: [
          {
            exerciseId: "bench",
            workingSets: 4,
            intent: {
              userRole: "PRIMARY_LIFT" as const,
              target: {
                kind: "movement_pattern" as const,
                movementPattern: "horizontal_push" as const,
              },
            },
          },
        ],
      },
      {
        slotId: "lower",
        name: "Lower",
        focus: "LOWER" as const,
        exercises: [
          {
            exerciseId: "curl",
            workingSets: 3,
            intent: {
              userRole: "MUSCLE_ISOLATION" as const,
              target: { kind: "muscle" as const, muscleId: "hamstrings" as const },
            },
          },
        ],
      },
    ],
  },
  health: availableHealth(1),
  exercises: [
    {
      id: "bench",
      name: "Barbell Bench Press",
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
      id: "dumbbell-bench",
      name: "Dumbbell Bench Press",
      movementPatterns: ["horizontal_push" as const],
      primaryMuscleIds: ["chest" as const],
      secondaryMuscleIds: ["triceps" as const],
      stimulusByMuscleId: { chest: 1, triceps: 0.5 },
      equipment: ["dumbbell", "bench"],
      contraindicationKeys: [],
      isCompound: true,
      isMainLiftEligible: true,
      timePerSetSec: 160,
      isFavorite: true,
    },
    {
      id: "curl",
      name: "Leg Curl",
      movementPatterns: ["flexion" as const],
      primaryMuscleIds: ["hamstrings" as const],
      secondaryMuscleIds: [],
      stimulusByMuscleId: { hamstrings: 1 },
      equipment: ["machine"],
      contraindicationKeys: [],
      isCompound: false,
      isMainLiftEligible: false,
      timePerSetSec: 90,
    },
  ],
  limitationKeys: [],
};

describe("HypertrophyPlanEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revision: 2, health: availableHealth(2) }),
    }));
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  afterEach(() => cleanup());

  it("supports intent-preserving exercise swap and session editing on desktop", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    const user = userEvent.setup();
    render(<HypertrophyPlanEditor initialData={initialData} />);

    await user.selectOptions(
      screen.getByLabelText(/Swap exercise \(keeps role, target, sets, and order\)/),
      "dumbbell-bench",
    );
    expect(screen.getByRole("heading", { name: "Dumbbell Bench Press" })).toBeVisible();
    expect(screen.getByDisplayValue("4")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Session name"), {
      target: { value: "Upper strength" },
    });
    expect(screen.getAllByText("Upper strength").length).toBeGreaterThan(0);
  });

  it("keeps session navigation, health, and add controls usable at mobile width", async () => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    const user = userEvent.setup();
    render(<HypertrophyPlanEditor initialData={initialData} />);

    await user.click(screen.getByRole("button", { name: "Lower" }));
    expect(screen.getByDisplayValue("Lower")).toBeVisible();
    expect(screen.getByRole("button", { name: "Plan health" })).toBeVisible();
    expect(screen.getByRole("button", { name: "+ Add exercise" })).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "+ Session" }).length,
    ).toBeGreaterThan(0);
  });
});
