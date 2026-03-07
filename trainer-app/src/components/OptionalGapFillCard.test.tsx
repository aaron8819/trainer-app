import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GapFillSupportData } from "@/lib/api/program";
import { OptionalGapFillCard } from "./OptionalGapFillCard";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

function buildGapFill(overrides: Partial<GapFillSupportData> = {}): GapFillSupportData {
  return {
    eligible: true,
    reason: null,
    weekCloseId: "wc-1",
    anchorWeek: 3,
    targetWeek: 3,
    targetPhase: "ACCUMULATION",
    targetMuscles: ["front delts", "rear delts", "biceps"],
    deficitSummary: [
      { muscle: "Front Delts", target: 5, actual: 0, deficit: 5 },
      { muscle: "Rear Delts", target: 9, actual: 3, deficit: 6 },
    ],
    alreadyUsedThisWeek: false,
    suppressedByStartedNextWeek: false,
    linkedWorkout: null,
    policy: {
      requiredSessionsPerWeek: 3,
      maxOptionalGapFillSessionsPerWeek: 1,
      maxGeneratedHardSets: 12,
      maxGeneratedExercises: 4,
    },
    ...overrides,
  };
}

describe("OptionalGapFillCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when gapFill is ineligible", () => {
    const { container } = render(<OptionalGapFillCard gapFill={buildGapFill({ eligible: false })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("generates through intent route with caps and saves as non-advancing optional gap-fill", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workout: {
            id: "w-gap-1",
            scheduledDate: "2026-03-05T00:00:00.000Z",
            warmup: [],
            mainLifts: [
              {
                id: "we-1",
                orderIndex: 0,
                isMainLift: true,
                exercise: { id: "ex-1", name: "Lateral Raise" },
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
          selectionMetadata: {
            weekCloseId: "wc-1",
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 4,
                weekInBlock: 4,
                phase: "accumulation",
                blockType: "accumulation",
                isDeload: false,
                source: "computed",
              },
              lifecycleVolume: { source: "unknown" },
              sorenessSuppressedMuscles: [],
              deloadDecision: { mode: "none", reason: [], reductionPercent: 0, appliedTo: "none" },
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
          filteredExercises: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workoutId: "w-gap-1" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<OptionalGapFillCard gapFill={buildGapFill()} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate gap-fill" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const generateCall = fetchMock.mock.calls[0];
    expect(generateCall[0]).toBe("/api/workouts/generate-from-intent");
    expect(generateCall[1].method).toBe("POST");
    const generatePayload = JSON.parse(generateCall[1].body as string);
    expect(generatePayload).toMatchObject({
      intent: "body_part",
      weekCloseId: "wc-1",
      optionalGapFill: true,
    });

    const saveCall = fetchMock.mock.calls[1];
    expect(saveCall[0]).toBe("/api/workouts/save");
    const savePayload = JSON.parse(saveCall[1].body as string);
    expect(savePayload.advancesSplit).toBe(false);
    expect(savePayload.selectionMode).toBe("INTENT");
    expect(savePayload.sessionIntent).toBe("BODY_PART");
    expect(savePayload.mesocycleWeekSnapshot).toBe(3);
    expect(savePayload.selectionMetadata.weekCloseId).toBe("wc-1");
    expect(savePayload.selectionMetadata.sessionDecisionReceipt.exceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "optional_gap_fill" }),
      ])
    );
    expect(pushMock).toHaveBeenCalledWith("/log/w-gap-1");
  });

  it("opens the linked workout instead of re-generating when one already exists", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OptionalGapFillCard
        gapFill={buildGapFill({
          linkedWorkout: { id: "w-gap-existing", status: "PLANNED" },
        })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Open gap-fill" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/log/w-gap-existing");
  });
});
