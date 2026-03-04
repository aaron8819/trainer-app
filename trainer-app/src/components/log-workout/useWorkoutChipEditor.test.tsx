import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedExercises } from "@/components/log-workout/types";
import { useWorkoutChipEditor } from "@/components/log-workout/useWorkoutChipEditor";

function makeData(): NormalizedExercises {
  return {
    warmup: [],
    main: [
      {
        workoutExerciseId: "ex-1",
        name: "Dumbbell Bench Press",
        equipment: ["dumbbell"],
        isMainLift: true,
        sets: [
          {
            setId: "set-1",
            setIndex: 1,
            targetReps: 10,
            targetLoad: 50,
            targetRpe: 8,
            actualReps: 10,
            actualLoad: 50,
            actualRpe: 8,
            restSeconds: 90,
          },
        ],
      },
    ],
    accessory: [],
  };
}

function ChipEditorHarness({
  logSet,
  logSetSpy,
}: {
  logSet: (setId: string, overrides?: Record<string, unknown>) => Promise<boolean>;
  logSetSpy: ReturnType<typeof vi.fn>;
}) {
  const [data, setData] = useState(makeData());
  const flatSets = useMemo(
    () =>
      data.main.flatMap((exercise, exerciseIndex) =>
        exercise.sets.map((set, setIndex) => ({
          section: "main" as const,
          sectionLabel: "Main Lifts",
          exerciseIndex,
          setIndex,
          exercise,
          set,
        }))
      ),
    [data]
  );

  const chipEditor = useWorkoutChipEditor({
    flatSets,
    isDumbbellExercise: (exercise) => (exercise.equipment ?? []).includes("dumbbell"),
    toInputNumberString: (value) => (value == null ? "" : String(value)),
    parseNullableNumber: (raw) => {
      const normalized = raw.trim();
      if (!normalized) {
        return null;
      }

      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    },
    normalizeLoadInput: (raw) => {
      const normalized = raw.trim();
      if (!normalized) {
        return null;
      }

      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? Math.round(parsed / 5) * 5 : null;
    },
    updateSetFields: (setId, updater) => {
      setData((prev) => ({
        ...prev,
        main: prev.main.map((exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set) => (set.setId === setId ? updater(set) : set)),
        })),
      }));
    },
    logSet,
  });

  return (
    <div>
      <button onClick={() => chipEditor.open("set-1")} type="button">
        open
      </button>
      <button onClick={() => chipEditor.setDraft({ reps: "11", load: "53", rpe: "9" })} type="button">
        edit
      </button>
      <button onClick={() => chipEditor.handleLoadBlur("set-1", true)} type="button">
        blur
      </button>
      <button onClick={() => void chipEditor.save("set-1")} type="button">
        save
      </button>
      <div data-testid="chip-set-id">{chipEditor.setId ?? ""}</div>
      <div data-testid="chip-draft">{chipEditor.draft ? JSON.stringify(chipEditor.draft) : ""}</div>
      <div data-testid="reps">{data.main[0]?.sets[0]?.actualReps ?? ""}</div>
      <div data-testid="load">{data.main[0]?.sets[0]?.actualLoad ?? ""}</div>
      <div data-testid="rpe">{data.main[0]?.sets[0]?.actualRpe ?? ""}</div>
      <div data-testid="log-calls">{JSON.stringify(logSetSpy.mock.calls)}</div>
    </div>
  );
}

describe("useWorkoutChipEditor", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens with the logged set as the single source of truth", () => {
    const logSetSpy = vi.fn<(setId: string, overrides?: Record<string, unknown>) => Promise<boolean>>();
    logSetSpy.mockResolvedValue(true);

    render(
      <ChipEditorHarness
        logSet={(setId, overrides) => logSetSpy(setId, overrides)}
        logSetSpy={logSetSpy}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));

    expect(screen.getByTestId("chip-set-id")).toHaveTextContent("set-1");
    expect(screen.getByTestId("chip-draft")).toHaveTextContent('"reps":"10"');
    expect(screen.getByTestId("chip-draft")).toHaveTextContent('"load":"50"');
    expect(screen.getByTestId("chip-draft")).toHaveTextContent('"rpe":"8"');
  });

  it("normalizes and saves the chip draft through the shared log-set path", async () => {
    const logSet = vi.fn<(setId: string, overrides?: Record<string, unknown>) => Promise<boolean>>();
    logSet.mockResolvedValue(true);

    render(
      <ChipEditorHarness
        logSet={(setId, overrides) => logSet(setId, overrides)}
        logSetSpy={logSet}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    fireEvent.click(screen.getByRole("button", { name: "blur" }));

    expect(screen.getByTestId("chip-draft")).toHaveTextContent('"load":"55"');

    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => {
      expect(screen.getByTestId("reps")).toHaveTextContent("11");
      expect(screen.getByTestId("load")).toHaveTextContent("55");
      expect(screen.getByTestId("rpe")).toHaveTextContent("9");
      expect(screen.getByTestId("chip-set-id")).toHaveTextContent("");
      expect(screen.getByTestId("log-calls")).toHaveTextContent('"actualLoad":55');
    });
  });
});
