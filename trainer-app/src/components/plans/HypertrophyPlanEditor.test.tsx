import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HypertrophyPlanEditorDataV1 } from "@/lib/api/hypertrophy-plan-drafts";
import { HypertrophyPlanEditor } from "./HypertrophyPlanEditor";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function availableHealth(revision: number, draftId = "plan-1") {
  return {
    status: "AVAILABLE" as const,
    policyVersion: "draft-plan-health.v2" as const,
    draftId,
    draftRevision: revision,
    confirmationScope: `plan-health-confirmation.v1.${revision.toString(16).padStart(64, "0")}`,
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

const initialData: HypertrophyPlanEditorDataV1 = {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function fourSessionData() {
  const data = structuredClone(initialData);
  data.draft.sessions.push(
    {
      ...structuredClone(data.draft.sessions[0]!),
      slotId: "upper-2",
      name: "Upper 2",
    },
    {
      ...structuredClone(data.draft.sessions[1]!),
      slotId: "lower-2",
      name: "Lower 2",
    },
  );
  return data;
}

function regeneratedDraft() {
  const next = fourSessionData().draft;
  next.sessions[0]!.name = "Regenerated Upper";
  next.sessions[1]!.name = "Regenerated Lower";
  return next;
}

function response(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

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

  it.each([
    {
      context: "selected catalog",
      change: (data: ReturnType<typeof fourSessionData>) => {
        data.exercises[0]!.name = "Changed catalog name";
      },
    },
    {
      context: "equipment",
      change: (data: ReturnType<typeof fourSessionData>) => {
        data.draft.settings.equipmentProfile = "BARBELL_HOME";
      },
    },
    {
      context: "limitations",
      change: (data: ReturnType<typeof fourSessionData>) => {
        data.limitationKeys = ["wrist"];
      },
    },
  ])("does not install deferred regeneration Health after $context drift", async ({ change }) => {
    const regeneration = deferred<Response>();
    vi.mocked(fetch).mockImplementation((url) =>
      String(url).endsWith("/regenerate")
        ? regeneration.promise
        : Promise.resolve(response({ revision: 3, health: availableHealth(3) })),
    );
    const data = fourSessionData();
    const view = render(<HypertrophyPlanEditor initialData={data} />);

    fireEvent.click(screen.getByRole("button", { name: "Generate a new starting plan" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const changed = structuredClone(data);
    change(changed);
    view.rerender(<HypertrophyPlanEditor initialData={changed} />);

    await act(async () => {
      regeneration.resolve(
        response({ draft: regeneratedDraft(), revision: 2, health: availableHealth(2) }),
      );
      await regeneration.promise;
    });

    expect(screen.getByDisplayValue("Regenerated Upper")).toBeVisible();
    expect(screen.getByText("Unavailable for saved revision 2.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Make plan ready" })).toBeDisabled();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("preserves newer compatible Health instead of installing an older-context regeneration result", async () => {
    const regeneration = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(regeneration.promise);
    const data = fourSessionData();
    const nextDraft = regeneratedDraft();
    const view = render(<HypertrophyPlanEditor initialData={data} />);

    fireEvent.click(screen.getByRole("button", { name: "Generate a new starting plan" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const current = structuredClone(data);
    current.revision = 2;
    current.draft = nextDraft;
    current.exercises[0]!.name = "Current catalog name";
    current.health = availableHealth(2);
    view.rerender(<HypertrophyPlanEditor initialData={current} />);

    await act(async () => {
      regeneration.resolve(
        response({ draft: nextDraft, revision: 2, health: availableHealth(2) }),
      );
      await regeneration.promise;
    });

    expect(screen.getByText("Current for saved revision 2.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Make plan ready" })).toBeEnabled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("retains local edits made while regeneration is in flight", async () => {
    const regeneration = deferred<Response>();
    vi.mocked(fetch).mockImplementation((url) =>
      String(url).endsWith("/regenerate")
        ? regeneration.promise
        : Promise.resolve(response({ revision: 3, health: availableHealth(3) })),
    );
    render(<HypertrophyPlanEditor initialData={fourSessionData()} />);

    fireEvent.click(screen.getByRole("button", { name: "Generate a new starting plan" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Session name"), {
      target: { value: "Unsaved local name" },
    });

    await act(async () => {
      regeneration.resolve(
        response({ draft: regeneratedDraft(), revision: 2, health: availableHealth(2) }),
      );
      await regeneration.promise;
    });

    expect(screen.getByDisplayValue("Unsaved local name")).toBeVisible();
    expect(screen.queryByDisplayValue("Regenerated Upper")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Regenerated Lower" }));
    expect(screen.getByDisplayValue("Regenerated Lower")).toBeVisible();
    expect(screen.getByRole("button", { name: "Make plan ready" })).toBeDisabled();
  });

  it("does not let a completed regeneration response cross draft navigation", async () => {
    const regeneration = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(regeneration.promise);
    const view = render(<HypertrophyPlanEditor initialData={fourSessionData()} />);

    fireEvent.click(screen.getByRole("button", { name: "Generate a new starting plan" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const other = fourSessionData();
    other.planId = "plan-2";
    other.name = "Other draft";
    other.draft.sessions[0]!.name = "Other Upper";
    other.health = availableHealth(1, "plan-2");
    view.rerender(<HypertrophyPlanEditor initialData={other} />);

    await act(async () => {
      regeneration.resolve(
        response({ draft: regeneratedDraft(), revision: 2, health: availableHealth(2) }),
      );
      await regeneration.promise;
    });

    expect(screen.getByDisplayValue("Other draft")).toBeVisible();
    expect(screen.getByDisplayValue("Other Upper")).toBeVisible();
    expect(screen.queryByDisplayValue("Regenerated Upper")).not.toBeInTheDocument();
    expect(screen.getByText("Current for saved revision 1.")).toBeVisible();
  });
});
