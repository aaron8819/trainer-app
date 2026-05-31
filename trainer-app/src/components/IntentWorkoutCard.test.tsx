import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntentWorkoutCard } from "./IntentWorkoutCard";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeGeneratedWorkout() {
  return {
    workout: {
      id: "generated-workout-1",
      scheduledDate: "2026-05-31T12:00:00.000Z",
      warmup: [],
      mainLifts: [
        {
          id: "we-bench",
          orderIndex: 0,
          isMainLift: true,
          exercise: { id: "bench", name: "Bench Press", equipment: ["barbell"] },
          sets: [
            {
              setIndex: 1,
              targetReps: 8,
              targetRepRange: { min: 6, max: 10 },
              targetLoad: 185,
              targetRpe: 8,
            },
          ],
        },
      ],
      accessories: [
        {
          id: "we-row",
          orderIndex: 1,
          isMainLift: false,
          exercise: { id: "row", name: "Cable Row", equipment: ["cable"] },
          sets: [{ setIndex: 1, targetReps: 12, targetRpe: 8 }],
        },
      ],
      estimatedMinutes: 45,
    },
    selectionMode: "INTENT",
    sessionIntent: "upper",
    selectionMetadata: {
      selectedExerciseIds: ["bench", "row"],
      sessionDecisionReceipt: {
        version: 1,
        cycleContext: {
          weekInMeso: 1,
          weekInBlock: 1,
          mesocycleLength: 5,
          phase: "accumulation",
          blockType: "accumulation",
          isDeload: false,
          source: "computed",
        },
        sessionProvenance: {
          mesocycleId: "meso-v2",
          compositionSource: "persisted_slot_plan_seed",
        },
        sessionSlot: {
          slotId: "upper_a",
          intent: "upper",
          sequenceIndex: 0,
          sequenceLength: 4,
          source: "mesocycle_slot_sequence",
        },
        lifecycleVolume: { source: "unknown" },
        sorenessSuppressedMuscles: [],
        deloadDecision: {
          mode: "none",
          reason: [],
          reductionPercent: 0,
          appliedTo: "none",
        },
        readiness: {
          wasAutoregulated: false,
          signalAgeHours: null,
          fatigueScoreOverall: null,
          intensityScaling: {
            applied: false,
            exerciseIds: [],
            scaledUpCount: 0,
            scaledDownCount: 0,
          },
        },
        exceptions: [],
      },
    },
    filteredExercises: [{ exerciseId: "filtered", reason: "not needed" }],
    selectionSummary: {
      selectedCount: 2,
      pinnedCount: 0,
      setTargetCount: 2,
    },
    sraWarnings: [],
    substitutions: [],
    volumePlanByMuscle: {},
  };
}

function renderCard() {
  render(
    <IntentWorkoutCard
      initialIntent="upper"
      initialSlotId="upper_a"
      primaryAction={{ label: "Start workout", state: "planned", mode: "generate" }}
      nextSessionLabel="Upper 1"
      nextSessionDescription="First upper session this week"
    />
  );
}

describe("IntentWorkoutCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the recommended-session reason metadata when provided", () => {
    renderCard();

    expect(screen.queryByText("Generate Workout")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start workout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview / Customize" })).toBeInTheDocument();
    expect(screen.getByText("Recommended next session:")).toBeInTheDocument();
    expect(screen.getByText("Upper 1")).toBeInTheDocument();
    expect(screen.getByText("First upper session this week")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Workout" })).not.toBeInTheDocument();
  });

  it("auto-generates, saves, and navigates to logging from the primary Start workout action", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(makeGeneratedWorkout()))
      .mockResolvedValueOnce(jsonResponse({ workoutId: "generated-workout-1" }));
    vi.stubGlobal("fetch", fetchMock);

    renderCard();

    await user.click(screen.getByRole("button", { name: "Start workout" }));

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/log/generated-workout-1");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const generateBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workouts/generate-from-intent");
    expect(generateBody).toEqual({
      intent: "upper",
      slotId: "upper_a",
    });

    const saveBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/workouts/save");
    expect(saveBody).toMatchObject({
      workoutId: "generated-workout-1",
      selectionMode: "INTENT",
      sessionIntent: "UPPER",
      selectionMetadata: {
        sessionDecisionReceipt: {
          sessionProvenance: {
            compositionSource: "persisted_slot_plan_seed",
          },
          sessionSlot: {
            slotId: "upper_a",
          },
        },
      },
      exercises: [
        {
          section: "MAIN",
          exerciseId: "bench",
          sets: [
            {
              setIndex: 1,
              targetReps: 8,
              targetRepRange: { min: 6, max: 10 },
              targetLoad: 185,
              targetRpe: 8,
            },
          ],
        },
        {
          section: "ACCESSORY",
          exerciseId: "row",
        },
      ],
    });
  });

  it("guards the primary action against duplicate double-click saves", async () => {
    const user = userEvent.setup();
    let resolveGenerate: (response: Response) => void = () => {
      throw new Error("Generate request was not started");
    };
    const fetchMock: FetchMock = vi.fn((url: string) => {
      if (url === "/api/workouts/generate-from-intent") {
        return new Promise<Response>((resolve) => {
          resolveGenerate = resolve;
        });
      }
      return Promise.resolve(jsonResponse({ workoutId: "generated-workout-1" }));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderCard();

    await user.dblClick(screen.getByRole("button", { name: "Start workout" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveGenerate?.(jsonResponse(makeGeneratedWorkout()));

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/log/generated-workout-1");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/workouts/save")).toHaveLength(1);
  });

  it("shows an error and does not navigate when auto-save fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(makeGeneratedWorkout()))
      .mockResolvedValueOnce(jsonResponse({ error: "Canonical receipt missing." }, 409));
    vi.stubGlobal("fetch", fetchMock);

    renderCard();

    await user.click(screen.getByRole("button", { name: "Start workout" }));

    expect(await screen.findByText("Canonical receipt missing.")).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps preview/customize available as the secondary path", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(makeGeneratedWorkout()));
    vi.stubGlobal("fetch", fetchMock);

    renderCard();

    await user.click(screen.getByRole("button", { name: "Preview / Customize" }));

    expect(await screen.findByRole("button", { name: "Save Workout" })).toBeInTheDocument();
    expect(screen.getByLabelText("Intent")).toHaveValue("upper");
    expect(screen.getByText("Exercises")).toBeInTheDocument();
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("round-trips supplemental deficit metadata unchanged through the preview save path", async () => {
    const user = userEvent.setup();
    const selectionMetadata = {
      sessionDecisionReceipt: {
        version: 1,
        cycleContext: {
          weekInMeso: 2,
          weekInBlock: 2,
          phase: "accumulation",
          blockType: "accumulation",
          isDeload: false,
          source: "computed",
        },
        sessionSlot: {
          slotId: "body_part_a",
          intent: "body_part",
          sequenceIndex: 0,
          sequenceLength: 1,
          source: "mesocycle_slot_sequence",
        },
        lifecycleVolume: { source: "unknown" },
        sorenessSuppressedMuscles: [],
        deloadDecision: {
          mode: "none",
          reason: [],
          reductionPercent: 0,
          appliedTo: "none",
        },
        readiness: {
          wasAutoregulated: false,
          signalAgeHours: null,
          fatigueScoreOverall: null,
          intensityScaling: {
            applied: false,
            exerciseIds: [],
            scaledUpCount: 0,
            scaledDownCount: 0,
          },
        },
        targetMuscles: ["rear delts"],
        exceptions: [
          {
            code: "supplemental_deficit_session",
            message: "Marked as supplemental deficit session.",
          },
        ],
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          workout: {
            id: "w-supp-1",
            scheduledDate: "2026-03-05T00:00:00.000Z",
            warmup: [],
            mainLifts: [
              {
                id: "we-1",
                orderIndex: 0,
                isMainLift: true,
                exercise: { id: "ex-1", name: "Cable Fly" },
                sets: [{ setIndex: 1, targetReps: 12 }],
              },
            ],
            accessories: [],
            estimatedMinutes: 35,
          },
          sraWarnings: [],
          substitutions: [],
          volumePlanByMuscle: {},
          selectionMode: "INTENT",
          sessionIntent: "body_part",
          selectionSummary: { selectedCount: 1, pinnedCount: 0, setTargetCount: 1 },
          selectionMetadata,
          filteredExercises: [],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ workoutId: "w-supp-1" }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <IntentWorkoutCard
        initialIntent="body_part"
        primaryAction={{ label: "Start workout", state: "planned", mode: "generate" }}
        nextSessionLabel="Body Part"
        nextSessionDescription="Server-provided body-part session"
      />
    );

    await user.type(screen.getByPlaceholderText("e.g., chest, triceps"), "rear delts");
    await user.click(screen.getByRole("button", { name: "Preview / Customize" }));

    expect(await screen.findByText("Cable Fly")).toBeInTheDocument();

    const generateBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workouts/generate-from-intent");
    expect(generateBody).toMatchObject({
      intent: "body_part",
      targetMuscles: ["rear delts"],
    });
    expect(generateBody).not.toHaveProperty("supplementalDeficitSession");

    await user.click(screen.getByRole("button", { name: "Save Workout" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const saveBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/workouts/save");
    expect(saveBody).not.toHaveProperty("advancesSplit");
    expect(saveBody.selectionMode).toBe("INTENT");
    expect(saveBody.sessionIntent).toBe("BODY_PART");
    expect(saveBody.selectionMetadata).toEqual(selectionMetadata);
  });

  it("saves generated preview exercises by planned orderIndex instead of section grouping", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          workout: {
            id: "w-lower-b",
            scheduledDate: "2026-05-02T00:00:00.000Z",
            warmup: [],
            mainLifts: [
              {
                id: "we-sldl",
                orderIndex: 0,
                isMainLift: true,
                exercise: { id: "sldl", name: "Stiff-Legged Deadlift" },
                sets: [{ setIndex: 1, targetReps: 8 }],
              },
              {
                id: "we-split-squat",
                orderIndex: 2,
                isMainLift: true,
                exercise: { id: "split-squat", name: "Bulgarian Split Squat" },
                sets: [{ setIndex: 1, targetReps: 10 }],
              },
            ],
            accessories: [
              {
                id: "we-leg-curl",
                orderIndex: 1,
                isMainLift: false,
                exercise: { id: "leg-curl", name: "Seated Leg Curl" },
                sets: [{ setIndex: 1, targetReps: 12 }],
              },
              {
                id: "we-calf",
                orderIndex: 3,
                isMainLift: false,
                exercise: { id: "calf-raise", name: "Seated Calf Raise" },
                sets: [{ setIndex: 1, targetReps: 12 }],
              },
            ],
            estimatedMinutes: 50,
          },
          sraWarnings: [],
          substitutions: [],
          volumePlanByMuscle: {},
          selectionMode: "INTENT",
          sessionIntent: "lower",
          selectionSummary: { selectedCount: 4, pinnedCount: 0, setTargetCount: 4 },
          selectionMetadata: makeGeneratedWorkout().selectionMetadata,
          filteredExercises: [],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ workoutId: "w-lower-b" }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <IntentWorkoutCard
        initialIntent="lower"
        initialSlotId="lower_b"
        primaryAction={{ label: "Start workout", state: "planned", mode: "generate" }}
        nextSessionLabel="Lower B"
        nextSessionDescription="Fourth session this week"
      />
    );

    await user.click(screen.getByRole("button", { name: "Preview / Customize" }));

    expect(await screen.findByText("Seated Calf Raise")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save Workout" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const saveBody = JSON.parse(fetchMock.mock.calls[1][1].body);

    expect(saveBody.exercises.map((exercise: { exerciseId: string }) => exercise.exerciseId))
      .toEqual(["sldl", "leg-curl", "split-squat", "calf-raise"]);
    expect(saveBody.exercises.map((exercise: { section: string }) => exercise.section))
      .toEqual(["MAIN", "ACCESSORY", "MAIN", "ACCESSORY"]);
  });
});
