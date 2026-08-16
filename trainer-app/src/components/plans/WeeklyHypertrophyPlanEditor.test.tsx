import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HypertrophyPlanEditorDataV2 } from "@/lib/api/hypertrophy-plan-drafts";
import {
  compileAcceptedHypertrophySeedV4,
  projectExecutableSeedV4,
} from "@/lib/engine/hypertrophy-plan-authoring";
import { WeeklyHypertrophyPlanEditor } from "./WeeklyHypertrophyPlanEditor";

const reactEffectControl = vi.hoisted(() => ({
  deferSnapshotPublication: false,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (
      effect: React.EffectCallback,
      dependencies?: React.DependencyList,
    ) =>
      actual.useEffect(() => {
        if (
          reactEffectControl.deferSnapshotPublication &&
          dependencies?.length === 4
        ) {
          const timer = window.setTimeout(effect, 0);
          return () => window.clearTimeout(timer);
        }
        return effect();
      }, dependencies),
  };
});

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
    measurement: {
      profile: "REPS_EXTERNAL_LOAD" as const,
      loadConvention: "BARBELL_TOTAL" as const,
      repBasis: "TOTAL" as const,
    },
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
    measurement: {
      profile: "REPS_EXTERNAL_LOAD" as const,
      loadConvention: "MACHINE_DISPLAYED" as const,
      repBasis: "TOTAL" as const,
    },
    timePerSetSec: 120,
  },
];

function availableHealth(revision: number, planId = "plan-v4", scopeSeed?: string) {
  return {
    status: "AVAILABLE" as const,
    policyVersion: "draft-plan-health.v2" as const,
    draftId: planId,
    draftRevision: revision,
    confirmationScope: `plan-health-confirmation.v1.${scopeSeed ?? revision.toString(16).padStart(64, "0")}`,
    evaluatedWeek: 1,
    summary: {
      blockingSafety: 0,
      importantWarnings: 0,
      coachingObservations: 0,
      informationalVolumeAvailable: true,
    },
    issues: [],
    volumeEstimates: [
      {
        tier: "INFORMATIONAL_ESTIMATE" as const,
        muscle: "Chest",
        directSets: 6,
        effectiveSets: 6,
        frequency: 1,
        referenceRange: { min: 10, max: 22 },
      },
    ],
    sessionEstimates: [
      { session: "Upper", estimatedMinutes: 24 },
      { session: "Lower", estimatedMinutes: 5 },
    ],
    evaluatedFacts: {
      catalogExerciseCount: exercises.length,
      equipmentProfile: "FULL_GYM",
      recognizedLimitationCount: 0,
      unrecognizedLimitationsPresent: false,
    },
  };
}

function warningHealth(
  revision: number,
  scopeSeed: string,
  code = "DUPLICATE_EXERCISE",
  explanation = "Bench Press appears more than once in Upper.",
) {
  const health = availableHealth(revision, "plan-v4", scopeSeed);
  return {
    ...health,
    summary: { ...health.summary, importantWarnings: 1 },
    issues: [
      {
        code,
        tier: "IMPORTANT_WARNING" as const,
        title: code === "DUPLICATE_EXERCISE" ? "Duplicate exercise" : "Session may run long",
        explanation,
        suggestedAction: "Review whether this is deliberate before finalizing.",
        affected: { session: "Upper" },
        blocksFinalization: false,
        requiresAcknowledgment: true,
      },
    ],
  };
}

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
  health: availableHealth(1),
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

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function savedResponse(revision: number) {
  return new Response(
    JSON.stringify({
      revision,
      preview: initialData.preview,
      health: availableHealth(revision),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function fiveWeekData(options?: {
  emptyUpper?: boolean;
  recommendedBench?: boolean;
}): HypertrophyPlanEditorDataV2 {
  const data = structuredClone(initialData) as HypertrophyPlanEditorDataV2;
  data.draft.weeks = [
    { week: 1, phase: "ACCUMULATION" },
    { week: 2, phase: "ACCUMULATION" },
    { week: 3, phase: "ACCUMULATION" },
    { week: 4, phase: "ACCUMULATION" },
    { week: 5, phase: "DELOAD" },
  ];
  const recommended = [
    { week: 1, status: "PRESCRIBE" as const, setCount: 3, reps: { kind: "RANGE" as const, min: 5, max: 8 }, rir: { kind: "TARGET_RANGE" as const, min: 3, max: 4 } },
    { week: 2, status: "PRESCRIBE" as const, setCount: 3, reps: { kind: "RANGE" as const, min: 5, max: 8 }, rir: { kind: "TARGET_RANGE" as const, min: 3, max: 3 } },
    { week: 3, status: "PRESCRIBE" as const, setCount: 3, reps: { kind: "RANGE" as const, min: 5, max: 8 }, rir: { kind: "TARGET_RANGE" as const, min: 2, max: 3 } },
    { week: 4, status: "PRESCRIBE" as const, setCount: 3, reps: { kind: "RANGE" as const, min: 5, max: 8 }, rir: { kind: "TARGET_RANGE" as const, min: 1, max: 2 } },
    { week: 5, status: "PRESCRIBE" as const, setCount: 2, reps: { kind: "RANGE" as const, min: 5, max: 8 }, rir: { kind: "TARGET_RANGE" as const, min: 4, max: 5 } },
  ];
  if (options?.emptyUpper) {
    data.draft.sessions[0]!.exercises = [];
  } else if (options?.recommendedBench) {
    data.draft.sessions[0]!.exercises = [
      {
        placementId: "placement-a",
        exerciseId: "bench",
        intent,
        prescriptions: recommended,
        recommendationBaseline: {
          version: 1,
          exerciseId: "bench",
          intent,
          prescriptions: structuredClone(recommended),
        },
      },
    ];
  }
  return data;
}

function finalizableFiveWeekData(): HypertrophyPlanEditorDataV2 {
  const data = fiveWeekData({ recommendedBench: true });
  const baseExercise = data.draft.sessions[0]!.exercises[0]!;
  data.draft.sessions = ["upper-a", "lower-a", "upper-b", "lower-b"].map(
    (slotId, index) => ({
      slotId,
      name: slotId,
      focus: index % 2 === 0 ? "UPPER" as const : "LOWER" as const,
      exercises: [{
        ...structuredClone(baseExercise),
        placementId: `${slotId}-bench`,
      }],
    }),
  );
  const accepted = compileAcceptedHypertrophySeedV4({
    draft: data.draft,
    measurementByExerciseId: new Map([["bench", exercises[0]!.measurement!]]),
  });
  data.preview = {
    status: "ELIGIBLE",
    reasons: [],
    hash: "a".repeat(64),
    hashAlgorithm: "sha256",
    normalizedPlan: accepted,
    executablePlan: projectExecutableSeedV4(accepted),
  };
  return data;
}

function twoExerciseFiveWeekData(options?: {
  secondCustom?: boolean;
}): HypertrophyPlanEditorDataV2 {
  const data = fiveWeekData({ recommendedBench: true });
  const source = data.draft.sessions[0]!.exercises[0]!;
  const second = {
    ...structuredClone(source),
    placementId: "placement-b",
    exerciseId: "bench-alt",
    intent: { ...intent, userRole: "SECONDARY_LIFT" as const },
    recommendationBaseline: undefined,
  };
  if (options?.secondCustom) {
    second.prescriptions = [
      { week: 1, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 5, max: 8 }, rir: { kind: "TARGET_RANGE", min: 4, max: 4 } },
      { week: 2, status: "PRESCRIBE", setCount: 4, reps: { kind: "RANGE", min: 5, max: 8 }, rir: { kind: "TARGET_RANGE", min: 3.5, max: 4 } },
      { week: 3, status: "PRESCRIBE", setCount: 3, reps: { kind: "EXACT", reps: 6 }, rir: { kind: "TARGET_RANGE", min: 2.5, max: 3 } },
      { week: 4, status: "PRESCRIBE", setCount: 3, reps: { kind: "RANGE", min: 5, max: 8 }, rir: { kind: "TARGET_RANGE", min: 1.5, max: 2 } },
      { week: 5, status: "PRESCRIBE", setCount: 1, reps: { kind: "EXACT", reps: 11 }, rir: { kind: "TARGET_RANGE", min: 5.5, max: 6 } },
    ];
  }
  data.draft.sessions[0]!.exercises.push(second);
  return data;
}

describe("WeeklyHypertrophyPlanEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    reactEffectControl.deferSnapshotPublication = false;
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
          health: availableHealth(2),
        }),
      }),
    );
    HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    });
  });

  afterEach(() => {
    reactEffectControl.deferSnapshotPublication = false;
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("finalizes only the saved supported preview and returns to plan activation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: { planId: "plan-v4" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(
      <WeeklyHypertrophyPlanEditor initialData={finalizableFiveWeekData()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Finalize plan" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/plans/plan-v4/finalize",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedDraftRevision: 1,
          confirmedPreviewHash: "a".repeat(64),
        }),
      }),
    );
    expect(router.push).toHaveBeenCalledWith("/plans");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows saved-revision Health, marks it stale for local edits, and refreshes on the matching save", async () => {
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);

    expect(screen.getByText("Current for saved revision 1.")).toBeVisible();
    expect(screen.getByText("Saved revision 1")).toBeVisible();

    fireEvent.change(screen.getByDisplayValue("Weekly plan"), {
      target: { value: "Weekly plan edited" },
    });
    expect(
      screen.getByText("Updating after save… Based on the last saved version."),
    ).toBeVisible();

    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(screen.getByText("Current for saved revision 2.")).toBeVisible();
    expect(screen.getByText("Saved revision 2")).toBeVisible();
  });

  it.each(["equipment", "limitations"] as const)(
    "marks Health stale after %s context props drift even when the local prescription is unchanged",
    (contextKind) => {
      const data = finalizableFiveWeekData();
      const { rerender } = render(
        <WeeklyHypertrophyPlanEditor initialData={data} />,
      );
      const changed = structuredClone(data);
      if (contextKind === "equipment") {
        changed.draft.settings.equipmentProfile = "BARBELL_HOME";
      } else {
        changed.limitationKeys = ["wrist"];
      }

      rerender(<WeeklyHypertrophyPlanEditor initialData={changed} />);

      expect(
        screen.getByText("Based on the last saved version. Local edits are not included yet."),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "Finalize plan" })).toBeDisabled();
    },
  );

  it("installs a refreshed catalog-derived display assessment without a stale loop", () => {
    const data = finalizableFiveWeekData();
    const { rerender } = render(
      <WeeklyHypertrophyPlanEditor initialData={data} />,
    );
    const changed = structuredClone(data);
    changed.exercises[0]!.timePerSetSec += 1_800;
    if (changed.health.status === "AVAILABLE") {
      changed.health.sessionEstimates[0]!.estimatedMinutes += 30;
    }

    rerender(<WeeklyHypertrophyPlanEditor initialData={changed} />);

    expect(screen.getByText("Current for saved revision 1.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Finalize plan" })).toBeEnabled();
  });

  it("installs refreshed warning authority separately from unchanged display freshness", () => {
    const data = finalizableFiveWeekData();
    const { rerender } = render(
      <WeeklyHypertrophyPlanEditor initialData={data} />,
    );
    const changed = structuredClone(data);
    changed.limitationKeys = ["wrist"];
    if (changed.health.status !== "AVAILABLE") throw new Error("Expected Health");
    changed.health.confirmationScope = `plan-health-confirmation.v1.${"a".repeat(64)}`;
    changed.health.evaluatedFacts.recognizedLimitationCount = 1;

    rerender(<WeeklyHypertrophyPlanEditor initialData={changed} />);

    expect(screen.getByText("Current for saved revision 1.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Finalize plan" })).toBeEnabled();
  });

  it("does not let a stale save response replace Health after authoritative context changes", async () => {
    const pending = deferredResponse();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const { rerender } = render(
      <WeeklyHypertrophyPlanEditor initialData={initialData} />,
    );
    fireEvent.change(screen.getByDisplayValue("Weekly plan"), {
      target: { value: "Saving under old context" },
    });
    await act(() => vi.advanceTimersByTimeAsync(800));
    const changed = structuredClone(initialData) as HypertrophyPlanEditorDataV2;
    changed.limitationKeys = ["wrist"];
    rerender(<WeeklyHypertrophyPlanEditor initialData={changed} />);

    pending.resolve(savedResponse(2));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText("Current for saved revision 2.")).toBeNull();
    expect(
      screen.getByText("Based on the last saved version. Local edits are not included yet."),
    ).toBeVisible();
  });

  it("remounts assessment state when navigation changes draft IDs", () => {
    const first = finalizableFiveWeekData();
    first.health = warningHealth(1, "a".repeat(64));
    const { rerender } = render(
      <WeeklyHypertrophyPlanEditor initialData={first} />,
    );
    expect(screen.getByText("Duplicate exercise")).toBeInTheDocument();

    const second = finalizableFiveWeekData();
    second.planId = "plan-v4-next";
    second.name = "Next plan";
    second.health = availableHealth(1, second.planId, "b".repeat(64));
    rerender(<WeeklyHypertrophyPlanEditor initialData={second} />);

    expect(screen.getByDisplayValue("Next plan")).toBeVisible();
    expect(screen.queryByText("Duplicate exercise")).toBeNull();
    expect(screen.getByText("Current for saved revision 1.")).toBeVisible();
  });

  it("installs display-only Health refreshes without using confirmation scope as freshness", () => {
    const data = finalizableFiveWeekData();
    data.health = warningHealth(1, "a".repeat(64));
    const { rerender } = render(
      <WeeklyHypertrophyPlanEditor initialData={data} />,
    );
    const refreshed = structuredClone(data);
    if (refreshed.health.status !== "AVAILABLE") throw new Error("Expected Health");
    refreshed.health.summary.coachingObservations = 1;
    refreshed.health.issues.push({
      code: "COACHING_ONLY_CHANGE",
      tier: "COACHING_OBSERVATION",
      title: "Updated weekly coaching",
      explanation: "Visible coaching changed without changing the warning decision.",
      suggestedAction: "No warning confirmation is required.",
      blocksFinalization: false,
      requiresAcknowledgment: false,
    });
    refreshed.health.volumeEstimates[0]!.effectiveSets = 7;
    refreshed.health.sessionEstimates[0]!.estimatedMinutes = 29;
    expect(refreshed.health.confirmationScope).toBe(
      (data.health as typeof refreshed.health).confirmationScope,
    );

    rerender(<WeeklyHypertrophyPlanEditor initialData={refreshed} />);

    expect(screen.getByText("Updated weekly coaching")).toBeInTheDocument();
    expect(screen.getByText(/7 effective sets/)).toBeInTheDocument();
  });

  it("installs stale-scope Health without auto-confirming and submits only the newly reviewed scope", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const data = finalizableFiveWeekData();
    data.health = warningHealth(1, "a".repeat(64));
    const refreshedHealth = warningHealth(
      1,
      "b".repeat(64),
      "SESSION_DURATION_HIGH",
      "Upper is estimated at about 91 minutes.",
    );
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "Review and confirm the current warnings before making this plan ready.",
            code: "PLAN_WARNING_CONFIRMATION_REQUIRED",
            confirmationStatus: "MISMATCH",
            health: refreshedHealth,
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    render(<WeeklyHypertrophyPlanEditor initialData={data} />);

    fireEvent.click(screen.getByRole("button", { name: "Finalize plan" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Session may run long")).toBeInTheDocument();
    expect(
      screen.getByText(/authoritative context changed/i),
    ).toBeVisible();
    expect(vi.mocked(window.confirm)).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Finalize plan" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.mocked(window.confirm)).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/plans/plan-v4/finalize",
      expect.objectContaining({
        body: expect.stringContaining(refreshedHealth.confirmationScope),
      }),
    );
  });

  it("keeps an older save assessment stale when a newer local edit exists", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    vi.mocked(fetch)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);

    const name = screen.getByDisplayValue("Weekly plan");
    fireEvent.change(name, { target: { value: "Edit A" } });
    await act(() => vi.advanceTimersByTimeAsync(800));
    fireEvent.change(name, { target: { value: "Edit B" } });

    first.resolve(savedResponse(2));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("Updating after save… Based on the last saved version."),
    ).toBeVisible();
    expect(screen.queryByText("Current for saved revision 2.")).toBeNull();

    second.resolve(savedResponse(3));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Current for saved revision 3.")).toBeVisible();
  });

  it("degrades explicitly when a save response carries mismatched Health", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          revision: 2,
          preview: initialData.preview,
          health: availableHealth(99),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);
    fireEvent.change(screen.getByDisplayValue("Weekly plan"), {
      target: { value: "Mismatched Health" },
    });
    await act(() => vi.advanceTimersByTimeAsync(800));

    expect(screen.getByText("Health is temporarily unavailable")).toBeVisible();
    expect(screen.getByText("Unavailable for saved revision 2.")).toBeVisible();
    expect(screen.queryByText("Current for saved revision 2.")).toBeNull();
  });

  it("preserves editing focus when Health refreshes", async () => {
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);
    const name = screen.getByDisplayValue("Weekly plan");
    name.focus();
    fireEvent.change(name, { target: { value: "Focused edit" } });
    await act(() => vi.advanceTimersByTimeAsync(800));

    expect(document.activeElement).toBe(name);
    expect(screen.getByText("Current for saved revision 2.")).toBeVisible();
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

  it("adds one exercise with inferred intent, five prescriptions, and a frozen baseline in one save", async () => {
    const data = fiveWeekData({ emptyUpper: true });
    render(<WeeklyHypertrophyPlanEditor initialData={data} />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add exercise" }));
    fireEvent.change(screen.getByLabelText("Exercise"), {
      target: { value: "bench" },
    });
    expect(
      screen.getByText(
        "Primary · 3 × 5–8 · RIR 3–4 → 1–2 · W5 2 sets deload",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));

    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      String(vi.mocked(fetch).mock.calls[0]![1]!.body),
    );
    const added = body.draft.sessions[0].exercises[0];
    expect(added.intent.userRole).toBe("PRIMARY_LIFT");
    expect(added.prescriptions).toHaveLength(5);
    expect(added.prescriptions.map((week: { setCount?: number }) => week.setCount)).toEqual([
      3,
      3,
      3,
      3,
      2,
    ]);
    expect(added.recommendationBaseline).toEqual({
      version: 1,
      exerciseId: "bench",
      intent: added.intent,
      prescriptions: added.prescriptions,
    });
  });

  it("renders compact recognized summaries and cancels progression editing without mutation or autosave", async () => {
    render(
      <WeeklyHypertrophyPlanEditor
        initialData={fiveWeekData({ recommendedBench: true })}
      />,
    );

    expect(screen.getByText("3 × 5–8 · RIR 3–4 → 1–2 · 2-set deload")).toBeVisible();
    expect(screen.getByText("Reduced deload")).toBeVisible();
    expect(screen.getByLabelText("Week 1 sets")).not.toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Edit progression" }));
    expect(screen.getByRole("dialog", { name: "Edit progression · Bench Press" })).toBeVisible();
    expect(screen.getByLabelText("Base sets")).toHaveValue(3);
    expect(screen.getByLabelText("Base minimum reps")).toHaveValue(5);
    expect(screen.getByText("W1 · Accumulation")).toBeVisible();
    expect(screen.getByText("W5 · Deload")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("applies one progression as exact rows and uses one normal autosave", async () => {
    render(
      <WeeklyHypertrophyPlanEditor
        initialData={fiveWeekData({ recommendedBench: true })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit progression" }));
    fireEvent.change(screen.getByLabelText("Base sets"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Base rep format"), { target: { value: "EXACT" } });
    fireEvent.change(screen.getByLabelText("Base exact reps"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Accumulation effort progression"), { target: { value: "STABLE" } });
    fireEvent.change(screen.getByLabelText("Stable accumulation minimum RIR"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("Stable accumulation maximum RIR"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("Deload behavior"), { target: { value: "MAINTAIN" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply progression" }));

    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
    const row = body.draft.sessions[0].exercises[0];
    expect(row.placementId).toBe("placement-a");
    expect(row.prescriptions).toEqual([
      ...[1, 2, 3, 4].map((week) => ({
        week,
        status: "PRESCRIBE",
        setCount: 4,
        reps: { kind: "EXACT", reps: 7 },
        rir: { kind: "TARGET_RANGE", min: 2.5, max: 2.5 },
      })),
      {
        week: 5,
        status: "PRESCRIBE",
        setCount: 4,
        reps: { kind: "EXACT", reps: 7 },
        rir: { kind: "TARGET_RANGE", min: 4, max: 5 },
      },
    ]);
  });

  it("preserves applied local rows when the existing CAS save reports a stale revision", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "The plan changed in another request. Refresh and try again.",
          code: "PLAN_MUTATION_CONFLICT",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    render(
      <WeeklyHypertrophyPlanEditor
        initialData={fiveWeekData({ recommendedBench: true })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit progression" }));
    fireEvent.change(screen.getByLabelText("Base sets"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply progression" }));
    await act(() => vi.advanceTimersByTimeAsync(800));

    expect(screen.getByText("Save failed")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("changed in another request");
    expect(screen.getByText("Saved revision 1")).toBeVisible();
    expect(
      screen.getByText("Based on the last saved version. Local edits are not included yet."),
    ).toBeVisible();
    fireEvent.click(screen.getByText("Advanced weekly exceptions"));
    expect(screen.getByLabelText("Week 1 sets")).toHaveValue(4);
  });

  it("keeps a semantically identical apply byte-for-byte equal without scheduling a save", async () => {
    const data = fiveWeekData({ recommendedBench: true });
    const before = structuredClone(data.draft.sessions[0]!.exercises[0]!.prescriptions);
    render(<WeeklyHypertrophyPlanEditor initialData={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit progression" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply progression" }));
    await act(() => vi.advanceTimersByTimeAsync(1000));

    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Advanced weekly exceptions"));
    expect(screen.getByLabelText("Week 1 sets")).toHaveValue(
      before[0]!.status === "PRESCRIBE" ? before[0]!.setCount : 0,
    );
  });

  it("requires explicit confirmation before a progression overwrites custom weekly rows", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const data = fiveWeekData({ recommendedBench: true });
    const weekThree = data.draft.sessions[0]!.exercises[0]!.prescriptions[2]!;
    if (weekThree.status !== "PRESCRIBE") throw new Error("fixture");
    data.draft.sessions[0]!.exercises[0]!.prescriptions[2] = { ...weekThree, setCount: 4 };
    render(<WeeklyHypertrophyPlanEditor initialData={data} />);

    expect(screen.getByText("Custom · Week 3 differs")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Edit progression" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply and overwrite custom weeks" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("overwrite its custom weekly rows"));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Edit progression · Bench Press" })).toBeVisible();
  });

  it("updates the derived classification after an advanced week exception without discarding exact values", () => {
    render(
      <WeeklyHypertrophyPlanEditor
        initialData={fiveWeekData({ recommendedBench: true })}
      />,
    );
    fireEvent.click(screen.getByText("Advanced weekly exceptions"));
    fireEvent.change(screen.getByLabelText("Week 3 sets"), { target: { value: "4" } });

    expect(screen.getByText("Custom · Week 3 differs")).toBeVisible();
    expect(screen.getByText("Week 3 exception")).toBeVisible();
    expect(screen.getByText("Pattern exception")).toBeVisible();
    expect(screen.getByLabelText("Week 3 sets")).toHaveValue(4);
  });

  it("shows an associated validation summary and keeps invalid progression text local", async () => {
    render(
      <WeeklyHypertrophyPlanEditor
        initialData={fiveWeekData({ recommendedBench: true })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit progression" }));
    fireEvent.change(screen.getByLabelText("Base sets"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply progression" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Base sets must be a whole number");
    const baseSets = screen.getByLabelText("Base sets");
    const describedBy = baseSets.getAttribute("aria-describedby");
    expect(describedBy).toMatch(/-base-sets$/);
    expect(document.getElementById(describedBy!)).toHaveTextContent("Base sets must");
    expect(baseSets).toHaveAttribute("aria-invalid", "true");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("materializes Week 5 omission through the compact progression editor", async () => {
    render(
      <WeeklyHypertrophyPlanEditor
        initialData={fiveWeekData({ recommendedBench: true })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit progression" }));
    fireEvent.change(screen.getByLabelText("Deload behavior"), { target: { value: "OMIT" } });
    expect(screen.getByText("Omitted")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Apply progression" }));
    await act(() => vi.advanceTimersByTimeAsync(800));

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
    expect(body.draft.sessions[0].exercises[0].prescriptions[4]).toEqual({
      week: 5,
      status: "OMIT",
    });
  });

  it("bulk previews before/after, skips custom rows, preserves base identity fields, and saves once", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const data = twoExerciseFiveWeekData({ secondCustom: true });
    data.draft.sessions[0]!.exercises[0]!.preservedMeasurement = {
      exerciseId: "bench",
      measurement: structuredClone(exercises[0]!.measurement!),
    };
    render(<WeeklyHypertrophyPlanEditor initialData={data} />);

    fireEvent.click(screen.getByRole("button", { name: "Select for bulk edit" }));
    fireEvent.click(screen.getByLabelText("Select Bench Press for bulk progression"));
    fireEvent.click(screen.getByLabelText("Select Machine Chest Press for bulk progression"));
    fireEvent.click(screen.getByRole("button", { name: "Preview bulk (2)" }));
    expect(screen.getByRole("dialog", { name: "Preview session progression" })).toBeVisible();
    expect(screen.getByText("Custom · skipped")).toBeVisible();
    expect(screen.getByText("1 will apply · 1 custom row skips by default")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Bulk effort progression"), { target: { value: "STABLE" } });
    fireEvent.change(screen.getByLabelText("Bulk stable effort minimum RIR"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("Bulk stable effort maximum RIR"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Bulk deload policy"), { target: { value: "MAINTAIN" } });
    const benchPreview = screen.getByRole("list", { name: "Bench Press exact weekly changes" });
    expect(within(benchPreview).getByText("Before: 2 × 5–8 · RIR 4–5")).toBeVisible();
    expect(within(benchPreview).getByText("After: 3 × 5–8 · RIR 4–5")).toBeVisible();
    expect(within(benchPreview).getByText("Sets: 2 → 3 · Reps preserved.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Apply eligible" }));

    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
    const [first, second] = body.draft.sessions[0].exercises;
    expect(first).toMatchObject({
      placementId: "placement-a",
      exerciseId: "bench",
      intent,
      preservedMeasurement: data.draft.sessions[0]!.exercises[0]!.preservedMeasurement,
      recommendationBaseline: data.draft.sessions[0]!.exercises[0]!.recommendationBaseline,
    });
    expect(first.prescriptions.slice(0, 4).map((entry: { setCount: number; reps: unknown; rir: unknown }) => ({
      setCount: entry.setCount,
      reps: entry.reps,
      rir: entry.rir,
    }))).toEqual(Array(4).fill({
      setCount: 3,
      reps: { kind: "RANGE", min: 5, max: 8 },
      rir: { kind: "TARGET_RANGE", min: 2.5, max: 3 },
    }));
    expect(second).toEqual(data.draft.sessions[0]!.exercises[1]);
  });

  it("keeps bulk selection inside the current session and requires a separate custom overwrite confirmation", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(
      <WeeklyHypertrophyPlanEditor
        initialData={twoExerciseFiveWeekData({ secondCustom: true })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select for bulk edit" }));
    fireEvent.click(screen.getByLabelText("Select Machine Chest Press for bulk progression"));
    fireEvent.click(screen.getByRole("button", { name: "Preview bulk (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Overwrite custom and apply all" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Overwrite custom weekly rows"));
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Lower" }));
    expect(screen.queryByLabelText(/Select .* for bulk progression/)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("previews and applies the same adversarial custom rows in one transition and one autosave", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const data = twoExerciseFiveWeekData({ secondCustom: true });
    const expectedDraft = structuredClone(data.draft);
    render(<WeeklyHypertrophyPlanEditor initialData={data} />);

    fireEvent.click(screen.getByRole("button", { name: "Select for bulk edit" }));
    fireEvent.click(screen.getByLabelText("Select Bench Press for bulk progression"));
    fireEvent.click(screen.getByLabelText("Select Machine Chest Press for bulk progression"));
    fireEvent.click(screen.getByRole("button", { name: "Preview bulk (2)" }));
    fireEvent.change(screen.getByLabelText("Bulk effort progression"), { target: { value: "STABLE" } });
    fireEvent.change(screen.getByLabelText("Bulk stable effort minimum RIR"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("Bulk stable effort maximum RIR"), { target: { value: "3" } });

    const preview = screen.getByRole("list", { name: "Machine Chest Press exact weekly changes" });
    expect(within(preview).getByText("Before: 4 × 5–8 · RIR 3.5–4")).toBeVisible();
    expect(within(preview).getByText("After: 4 × 5–8 · RIR 2.5–3")).toBeVisible();
    expect(within(preview).getByText("RIR: 3.5–4 → 2.5–3 · Sets/reps preserved.")).toBeVisible();
    expect(within(preview).getByText("Before: 3 × 6 · RIR 2.5–3")).toBeVisible();
    expect(within(preview).getByText("After: 3 × 6 · RIR 2.5–3")).toBeVisible();
    expect(within(preview).getByText("Before: 1 × 11 · RIR 5.5–6")).toBeVisible();
    expect(within(preview).getByText("After: 1 × 11 · RIR 5.5–6")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Overwrite custom and apply all" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Overwrite custom weekly rows"));
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
    for (const exercise of expectedDraft.sessions[0]!.exercises) {
      exercise.prescriptions = exercise.prescriptions.map((row, index) =>
        index < 4 && row.status === "PRESCRIBE"
          ? { ...row, rir: { kind: "TARGET_RANGE", min: 2.5, max: 3 } }
          : row,
      );
    }
    expect(body.draft).toEqual(expectedDraft);
    const changed = body.draft.sessions[0].exercises[1];
    expect(changed.prescriptions.slice(0, 4).map((entry: { setCount: number }) => entry.setCount)).toEqual([3, 4, 3, 3]);
    expect(changed.prescriptions.slice(0, 4).map((entry: { reps: { kind: string } }) => entry.reps.kind)).toEqual([
      "RANGE",
      "RANGE",
      "EXACT",
      "RANGE",
    ]);
    expect(JSON.stringify(changed.prescriptions[4])).toBe(
      JSON.stringify(data.draft.sessions[0]!.exercises[1]!.prescriptions[4]),
    );
  });

  it("does not autosave an equivalent bulk application", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<WeeklyHypertrophyPlanEditor initialData={fiveWeekData({ recommendedBench: true })} />);

    fireEvent.click(screen.getByRole("button", { name: "Select for bulk edit" }));
    fireEvent.click(screen.getByLabelText("Select Bench Press for bulk progression"));
    fireEvent.click(screen.getByRole("button", { name: "Preview bulk (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply eligible" }));
    await act(() => vi.advanceTimersByTimeAsync(1000));

    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks invalid bulk materialization before confirmation or mutation", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<WeeklyHypertrophyPlanEditor initialData={fiveWeekData({ recommendedBench: true })} />);

    fireEvent.click(screen.getByRole("button", { name: "Select for bulk edit" }));
    fireEvent.click(screen.getByLabelText("Select Bench Press for bulk progression"));
    fireEvent.click(screen.getByRole("button", { name: "Preview bulk (1)" }));
    fireEvent.change(screen.getByLabelText("Bulk effort progression"), { target: { value: "STABLE" } });
    fireEvent.change(screen.getByLabelText("Bulk stable effort minimum RIR"), { target: { value: "2.25" } });

    expect(screen.getByRole("alert")).toHaveTextContent("Correct the bulk effort values");
    expect(screen.getByRole("button", { name: "Apply eligible" })).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(confirm).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("marks direct edits customized and resets the entire exercise to its frozen recommendation", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const data = fiveWeekData({ recommendedBench: true });
    const customizedWeek =
      data.draft.sessions[0]!.exercises[0]!.prescriptions[0]!;
    if (customizedWeek.status !== "PRESCRIBE") throw new Error("fixture");
    customizedWeek.setCount = 5;
    render(
      <WeeklyHypertrophyPlanEditor
        initialData={data}
      />,
    );
    fireEvent.click(
      screen.getByText("Advanced weekly exceptions"),
    );
    expect(screen.getByText("Recommendation customized")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Reset to recommended" }),
    );

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("Customized intent and weekly values will be replaced"),
    );
    expect(screen.getByLabelText("Week 1 sets")).toHaveValue(3);
    expect(screen.queryByText("Customized")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(800));
    const body = JSON.parse(
      String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body),
    );
    expect(body.draft.sessions[0].exercises[0].prescriptions[0].setCount).toBe(3);
  });

  it("preserves prescriptions on replacement and requires explicit recommendation reapplication", async () => {
    render(
      <WeeklyHypertrophyPlanEditor
        initialData={fiveWeekData({ recommendedBench: true })}
      />,
    );
    fireEvent.click(
      screen.getByText("Advanced weekly exceptions"),
    );
    fireEvent.change(
      screen.getByLabelText("Swap Bench Press and keep placement identity"),
      { target: { value: "bench-alt" } },
    );

    expect(screen.getByLabelText("Week 1 sets")).toHaveValue(3);
    expect(screen.getByText("Manual")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Apply recommendation" }),
    ).toBeVisible();
    await act(() => vi.advanceTimersByTimeAsync(800));
    const body = JSON.parse(
      String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body),
    );
    expect(body.draft.sessions[0].exercises[0]).toMatchObject({
      exerciseId: "bench-alt",
      prescriptions: expect.arrayContaining([
        expect.objectContaining({ week: 1, setCount: 3 }),
      ]),
    });
    expect(body.draft.sessions[0].exercises[0].recommendationBaseline).toBeUndefined();
  });

  it("allows another compound placement to be promoted to Primary", () => {
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);
    const expanders = screen.getAllByText("Advanced weekly exceptions");
    fireEvent.click(expanders[0]!);
    fireEvent.click(expanders[1]!);
    const intents = screen.getAllByLabelText("Intent");
    fireEvent.change(intents[1]!, { target: { value: "PRIMARY" } });

    expect(intents[0]).toHaveValue("PRIMARY");
    expect(intents[1]).toHaveValue("PRIMARY");
    expect(screen.getAllByText("Primary · Exact weekly prescription")).toHaveLength(2);
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

  it("saves the latest valid draft before Back navigation and disables repeated Back requests", async () => {
    const pending = deferredResponse();
    vi.mocked(fetch).mockReturnValue(pending.promise);
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);

    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Latest weekly plan" },
    });
    const back = screen.getByRole("button", { name: "Back to plans" });
    fireEvent.click(back);
    fireEvent.click(back);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(back).toBeDisabled();
    expect(router.push).not.toHaveBeenCalled();
    pending.resolve(savedResponse(2));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(router.push).toHaveBeenCalledWith("/plans");
  });

  it("waits for an in-flight save and then persists the newest queued edit before leaving", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    vi.mocked(fetch)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);

    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Older name" },
    });
    await act(() => vi.advanceTimersByTimeAsync(800));
    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Newest name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to plans" }));
    first.resolve(savedResponse(2));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Saving…")).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]!.body));
    expect(secondBody).toMatchObject({
      expectedRevision: 2,
      name: "Newest name",
    });
    expect(router.push).not.toHaveBeenCalled();
    second.resolve(savedResponse(3));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(router.push).toHaveBeenCalledWith("/plans");
  });

  it("publishes a newer committed edit before an older Back save can navigate", async () => {
    reactEffectControl.deferSnapshotPublication = true;
    const first = deferredResponse();
    const second = deferredResponse();
    vi.mocked(fetch)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);

    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Snapshot A" },
    });
    await act(() => vi.advanceTimersByTimeAsync(800));
    fireEvent.click(screen.getByRole("button", { name: "Back to plans" }));
    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Snapshot B" },
    });

    first.resolve(savedResponse(2));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(router.push).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]!.body)),
    ).toMatchObject({ expectedRevision: 2, name: "Snapshot B" });

    second.resolve(savedResponse(3));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/plans");
  });

  it("blocks Back when a newer malformed edit commits during an older save", async () => {
    reactEffectControl.deferSnapshotPublication = true;
    const first = deferredResponse();
    vi.mocked(fetch).mockReturnValue(first.promise);
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);

    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Snapshot A" },
    });
    await act(() => vi.advanceTimersByTimeAsync(800));
    fireEvent.click(screen.getByRole("button", { name: "Back to plans" }));
    fireEvent.change(screen.getAllByLabelText("Week 1 sets")[0]!, {
      target: { value: "" },
    });

    first.resolve(savedResponse(2));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(
      screen.getByText("Correct the incomplete field before leaving."),
    ).toBeVisible();
  });

  it("retries the newest valid snapshot and navigates only after it is authoritative", async () => {
    const retry = deferredResponse();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Offline" }), { status: 503 }),
    ).mockReturnValueOnce(retry.promise);
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);
    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Unsaved name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to plans" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Retry save and leave" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Stay and keep editing" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Discard changes and leave" })).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Plan name"), {
      target: { value: "Newest retry name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry save and leave" }));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]!.body)),
    ).toMatchObject({ expectedRevision: 1, name: "Newest retry name" });
    expect(router.push).not.toHaveBeenCalled();

    retry.resolve(savedResponse(2));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/plans");
  });

  it("keeps malformed text local on Back unless the user explicitly discards it", () => {
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);
    fireEvent.change(screen.getAllByLabelText("Week 1 sets")[0]!, {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to plans" }));

    expect(fetch).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByText("Correct the incomplete field before leaving.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes and leave" }));
    expect(router.push).toHaveBeenCalledWith("/plans");
  });

  it("remounts prescriptions only when week topology changes their semantic identity", () => {
    const data = structuredClone(initialData);
    data.draft.sessions[0]!.exercises[0]!.prescriptions[0]!.setCount = 5;
    data.draft.sessions[0]!.exercises[0]!.prescriptions[1]!.setCount = 1;
    render(<WeeklyHypertrophyPlanEditor initialData={data} />);

    fireEvent.change(screen.getAllByLabelText("Week 1 sets")[0]!, {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Accumulation weeks"), {
      target: { value: "2" },
    });

    expect(screen.getAllByLabelText("Week 1 sets")[0]).toHaveValue(null);
    expect(screen.getAllByLabelText("Week 2 sets")[0]).toHaveValue(5);
    expect(screen.getAllByLabelText("Week 3 sets")[0]).toHaveValue(1);
    expect(screen.getByText("Incomplete — not saved")).toBeVisible();
  });

  it("moves an omitted deload without leaking it into a new accumulation week", () => {
    const data = structuredClone(initialData);
    data.draft.sessions[0]!.exercises[0]!.prescriptions[0]!.setCount = 5;
    render(<WeeklyHypertrophyPlanEditor initialData={data} />);

    fireEvent.click(screen.getAllByLabelText("Omit")[0]!);
    fireEvent.change(screen.getByLabelText("Accumulation weeks"), {
      target: { value: "2" },
    });

    expect(screen.getAllByLabelText("Week 2 sets")[0]).toHaveValue(5);
    expect(screen.getAllByLabelText("Omit")[0]).toBeChecked();
    expect(screen.getAllByText("Week 3 · Deload")).toHaveLength(2);
  });

  it("preserves retained placements through deload toggles and week reduction", () => {
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);

    fireEvent.change(screen.getByLabelText("Accumulation weeks"), {
      target: { value: "2" },
    });
    expect(screen.getAllByLabelText("Week 2 sets")).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("Add a final deload week"));
    expect(screen.queryAllByLabelText("Week 3 sets")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Accumulation weeks"), {
      target: { value: "1" },
    });
    expect(screen.queryAllByLabelText("Week 2 sets")).toHaveLength(0);
    expect(screen.getAllByLabelText("Week 1 sets")).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("Add a final deload week"));
    expect(screen.getAllByLabelText("Week 2 sets")).toHaveLength(2);
  });

  it("keeps the principal weekly, session, prescription, and preview controls available on mobile", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 390,
      configurable: true,
    });
    render(<WeeklyHypertrophyPlanEditor initialData={initialData} />);

    expect(screen.getByRole("heading", { name: "Plan weeks" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Lower" })).toBeVisible();
    fireEvent.click(
      screen.getAllByText("Advanced weekly exceptions")[0]!,
    );
    expect(screen.getAllByLabelText("Week 1 sets")[0]).toBeVisible();
    expect(screen.getByRole("heading", { name: "Normalized preview" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /ready|activate/i })).toBeNull();
  });
});
