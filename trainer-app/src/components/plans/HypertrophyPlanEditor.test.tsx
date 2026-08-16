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

function failedResponse(body: unknown) {
  return {
    ok: false,
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
        if (data.health.status === "AVAILABLE") {
          data.health.sessionEstimates[0]!.estimatedMinutes += 1;
        }
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

  it("keeps irrelevant selected alias drift in the same regeneration Health context", async () => {
    const regeneration = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(regeneration.promise);
    const data = fourSessionData();
    const view = render(<HypertrophyPlanEditor initialData={data} />);

    fireEvent.click(screen.getByRole("button", { name: "Generate a new starting plan" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const changed = structuredClone(data);
    changed.exercises[0]!.aliases = ["unused random alias"];
    view.rerender(<HypertrophyPlanEditor initialData={changed} />);

    await act(async () => {
      regeneration.resolve(
        response({ draft: regeneratedDraft(), revision: 2, health: availableHealth(2) }),
      );
      await regeneration.promise;
    });

    expect(screen.getByText("Current for saved revision 2.")).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("locks every V1 draft mutation and installs the authoritative regenerated draft exactly", async () => {
    const regeneration = deferred<Response>();
    vi.mocked(fetch).mockImplementation((url) =>
      String(url).endsWith("/regenerate")
        ? regeneration.promise
        : Promise.resolve(response({ revision: 3, health: availableHealth(3) })),
    );
    const authoritative = regeneratedDraft();
    authoritative.sessions[0]!.focus = "PUSH";
    authoritative.sessions[0]!.exercises = [
      {
        exerciseId: "dumbbell-bench",
        workingSets: 6,
        intent: {
          userRole: "SECONDARY_LIFT",
          target: {
            kind: "movement_pattern",
            movementPattern: "horizontal_push",
          },
        },
      },
      structuredClone(authoritative.sessions[1]!.exercises[0]!),
      structuredClone(authoritative.sessions[1]!.exercises[0]!),
    ];
    const user = userEvent.setup();
    render(<HypertrophyPlanEditor initialData={fourSessionData()} />);

    await user.click(screen.getByRole("button", { name: "+ Add exercise" }));
    await user.selectOptions(screen.getByLabelText("Exercise"), "dumbbell-bench");

    fireEvent.click(screen.getByRole("button", { name: "Generate a new starting plan" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText("Regenerating…")).toHaveLength(2);
    expect(screen.getByLabelText("Plan name")).toBeDisabled();
    expect(screen.getByLabelText("Session name")).toBeDisabled();
    expect(screen.getByLabelText("Focus")).toBeDisabled();
    expect(screen.getByLabelText("Working sets")).toBeDisabled();
    for (const role of screen.getAllByLabelText("Role")) expect(role).toBeDisabled();
    for (const target of screen.getAllByLabelText("Target")) expect(target).toBeDisabled();
    const swap = screen.getByLabelText(
      /Swap exercise \(keeps role, target, sets, and order\)/,
    );
    expect(swap).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add exercise" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove session" })).toBeDisabled();
    const moveExercise = screen.getByRole("button", {
      name: "Move Barbell Bench Press down",
    });
    expect(moveExercise).toBeDisabled();
    const removeExercise = screen.getByRole("button", { name: "Remove" });
    expect(removeExercise).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Session name"), {
      target: { value: "Forbidden local name" },
    });
    fireEvent.change(screen.getByLabelText("Working sets"), {
      target: { value: "9" },
    });
    fireEvent.change(swap, { target: { value: "dumbbell-bench" } });
    fireEvent.click(moveExercise);
    fireEvent.click(removeExercise);
    fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    expect(screen.getByDisplayValue("Upper")).toBeVisible();
    expect(screen.getByDisplayValue("4")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Barbell Bench Press" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Dumbbell Bench Press" })).not.toBeInTheDocument();

    await act(async () => {
      regeneration.resolve(
        response({ draft: authoritative, revision: 2, health: availableHealth(2) }),
      );
      await regeneration.promise;
    });

    expect(screen.getByDisplayValue("Regenerated Upper")).toBeVisible();
    expect(screen.getByDisplayValue("6")).toBeVisible();
    expect(screen.getAllByRole("heading", { name: "Leg Curl" })).toHaveLength(2);
    expect(screen.queryByDisplayValue("Forbidden local name")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getAllByLabelText("Working sets")[0]!, {
      target: { value: "7" },
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const [, request] = vi.mocked(fetch).mock.calls[1]!;
    const saved = JSON.parse(String(request?.body));
    expect(saved.expectedRevision).toBe(2);
    expect(saved.draft).toEqual({
      ...authoritative,
      sessions: authoritative.sessions.map((session, index) =>
        index === 0
          ? {
              ...session,
              exercises: session.exercises.map((exercise, exerciseIndex) =>
                exerciseIndex === 0 ? { ...exercise, workingSets: 7 } : exercise,
              ),
            }
          : session,
      ),
    });
  });

  it("does not start regeneration during in-flight or queued autosaves", async () => {
    const firstSave = deferred<Response>();
    const secondSave = deferred<Response>();
    const regeneration = deferred<Response>();
    let saveCount = 0;
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url).endsWith("/regenerate")) return regeneration.promise;
      saveCount += 1;
      return saveCount === 1 ? firstSave.promise : secondSave.promise;
    });
    render(<HypertrophyPlanEditor initialData={fourSessionData()} />);

    fireEvent.change(screen.getByLabelText("Session name"), {
      target: { value: "First local edit" },
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const generate = screen.getByRole("button", { name: "Generate a new starting plan" });
    expect(generate).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Session name"), {
      target: { value: "Queued local edit" },
    });
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstSave.resolve(response({ revision: 2, health: availableHealth(2) }));
      await firstSave.promise;
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(generate).toBeDisabled();

    await act(async () => {
      secondSave.resolve(response({ revision: 3, health: availableHealth(3) }));
      await secondSave.promise;
    });
    await waitFor(() => expect(generate).toBeEnabled());
    fireEvent.click(generate);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const [, request] = vi.mocked(fetch).mock.calls[2]!;
    expect(JSON.parse(String(request?.body))).toMatchObject({ expectedRevision: 3 });
  });

  it("preserves the saved draft after regeneration failure and re-enables editing", async () => {
    vi.mocked(fetch).mockResolvedValue(
      failedResponse({ error: "Regeneration conflict" }),
    );
    render(<HypertrophyPlanEditor initialData={fourSessionData()} />);

    fireEvent.click(screen.getByRole("button", { name: "Generate a new starting plan" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Regeneration conflict"));
    expect(screen.getByDisplayValue("Upper")).toBeVisible();
    expect(screen.getByDisplayValue("4")).toBeVisible();
    expect(screen.getByLabelText("Session name")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Generate a new starting plan" })).toBeEnabled();
  });

  it("requires a failed CAS autosave to be retried before regeneration", async () => {
    const regeneration = deferred<Response>();
    vi.mocked(fetch)
      .mockResolvedValueOnce(failedResponse({ error: "Revision conflict" }))
      .mockResolvedValueOnce(response({ revision: 2, health: availableHealth(2) }))
      .mockReturnValueOnce(regeneration.promise);
    render(<HypertrophyPlanEditor initialData={fourSessionData()} />);

    fireEvent.change(screen.getByLabelText("Session name"), {
      target: { value: "Saved before regeneration" },
    });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Revision conflict"));
    const generate = screen.getByRole("button", { name: "Generate a new starting plan" });
    expect(generate).toBeDisabled();
    fireEvent.click(generate);
    expect(fetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(generate).toBeEnabled());
    fireEvent.click(generate);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const [, request] = vi.mocked(fetch).mock.calls[2]!;
    expect(JSON.parse(String(request?.body))).toMatchObject({ expectedRevision: 2 });
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

  it("performs no late installation or refresh after component unmount", async () => {
    const regeneration = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(regeneration.promise);
    const view = render(<HypertrophyPlanEditor initialData={fourSessionData()} />);

    fireEvent.click(screen.getByRole("button", { name: "Generate a new starting plan" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    view.unmount();

    await act(async () => {
      regeneration.resolve(
        response({ draft: regeneratedDraft(), revision: 2, health: availableHealth(2) }),
      );
      await regeneration.promise;
    });

    expect(router.refresh).not.toHaveBeenCalled();
  });
});
