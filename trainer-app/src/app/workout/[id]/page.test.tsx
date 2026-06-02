import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const mocks = vi.hoisted(() => ({
  resolveOwner: vi.fn(),
  loadCompletedWorkoutReviewReadModel: vi.fn(),
  generateWorkoutExplanation: vi.fn(),
  workoutFindFirst: vi.fn(),
  injuryFindMany: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/completed-workout-review", () => ({
  loadCompletedWorkoutReviewReadModel: (...args: unknown[]) =>
    mocks.loadCompletedWorkoutReviewReadModel(...args),
}));

vi.mock("@/lib/api/explainability", () => ({
  generateWorkoutExplanation: (...args: unknown[]) => mocks.generateWorkoutExplanation(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workout: {
      findFirst: (...args: unknown[]) => mocks.workoutFindFirst(...args),
    },
    injury: {
      findMany: (...args: unknown[]) => mocks.injuryFindMany(...args),
    },
  },
}));

describe("WorkoutDetailPage", { timeout: 15000 }, () => {
  beforeEach(() => {
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.loadCompletedWorkoutReviewReadModel.mockResolvedValue({
      postSessionReview: null,
    });
    mocks.generateWorkoutExplanation.mockResolvedValue({ error: "unavailable" });
    mocks.injuryFindMany.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each(["PLANNED", "COMPLETED"])("renders the audit entry point for %s workouts", async (status) => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status,
      estimatedMinutes: 55,
      selectionMetadata: null,
      sessionIntent: "PUSH",
      exercises: [],
    });

    const { default: WorkoutDetailPage } = await import("./page");
    const ui = await WorkoutDetailPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute("href", "/workout/workout-1/audit");
  });

  it("renders a partial-specific title when the workout is reviewable and resumable", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status: "PARTIAL",
      estimatedMinutes: 55,
      selectionMetadata: {
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
            slotId: "push_b",
            intent: "push",
            sequenceIndex: 1,
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
      sessionIntent: "PUSH",
      exercises: [],
    });

    const { default: WorkoutDetailPage } = await import("./page");
    const ui = await WorkoutDetailPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.getByText("Partial Session")).toBeInTheDocument();
    expect(screen.getByText("Push 2 | Estimated 55 minutes")).toBeInTheDocument();
    expect(screen.queryByText(/Slot ID/)).not.toBeInTheDocument();
  });

  it("renders the post-workout insights hierarchy for performed workouts", async () => {
    mocks.loadCompletedWorkoutReviewReadModel.mockResolvedValue({
      postSessionReview: {
        status: "reviewed",
        headline: "Post-session review ready",
        summaryBullets: ["Completed planned work", "No seed or plan changes made"],
        completion: null,
        exerciseChanges: [],
        loadCalibration: [],
        nextExposureNotes: [],
        weeklyImpact: [],
        learningSignals: [],
        warnings: [],
        source: {
          ownerSeam: "api/post-session-review-display",
          readOnly: true,
          evidenceOnly: true,
          noMutationNote: "No seed or plan changes made",
        },
      },
    });
    mocks.generateWorkoutExplanation.mockResolvedValue({
      confidence: { level: "high", summary: "ok", missingSignals: [] },
      sessionContext: {
        blockPhase: {
          blockType: "accumulation",
          weekInBlock: 4,
          totalWeeksInBlock: 4,
          primaryGoal: "build",
        },
        volumeStatus: { muscleStatuses: new Map(), overallSummary: "ok" },
        readinessStatus: {
          overall: "moderate",
          signalAge: 0,
          availability: "recent",
          label: "Recent readiness",
          perMuscleFatigue: new Map(),
          sorenessSuppressedMuscles: [],
          adaptations: [],
        },
        progressionContext: {
          weekInMesocycle: 4,
          volumeProgression: "building",
          intensityProgression: "ramping",
          nextMilestone: "deload next",
        },
        cycleSource: "computed",
        narrative: "narrative",
      },
      coachMessages: [],
      exerciseRationales: new Map(),
      prescriptionRationales: new Map(),
      progressionReceipts: new Map([
        [
          "lat-pull",
          {
            lastPerformed: {
              reps: 12,
              load: 35,
              rpe: 8,
              performedAt: "2026-02-18T00:00:00.000Z",
            },
            todayPrescription: { reps: 10, load: 40, rpe: 8 },
            delta: { load: 5, loadPercent: 14.2857, reps: -2, rpe: 0 },
            trigger: "double_progression",
            decisionLog: [],
          },
        ],
      ]),
      nextExposureDecisions: new Map([
        [
          "lat-pull",
          {
            action: "hold",
            summary: "Next exposure: hold load.",
            reason:
              "Median reps stayed at 8 in the 8-12 band, so keep building reps before adding load.",
            anchorLoad: 40,
            repRange: { min: 8, max: 12 },
            modalRpe: 8,
            medianReps: 8,
          },
        ],
      ]),
      filteredExercises: [],
      volumeCompliance: [
        {
          muscle: "Lats",
          performedEffectiveVolumeBeforeSession: 6,
          plannedEffectiveVolumeThisSession: 4,
          projectedEffectiveVolume: 10,
          weeklyTarget: 10,
          mev: 8,
          mav: 16,
          status: "ON_TARGET",
        },
      ],
    });
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status: "COMPLETED",
      estimatedMinutes: 55,
      selectionMetadata: null,
      sessionIntent: "PULL",
      exercises: [
        {
          id: "we-1",
          orderIndex: 0,
          exerciseId: "lat-pull",
          isMainLift: true,
          section: "MAIN",
          exercise: {
            name: "Lat Pulldown",
            jointStress: "MEDIUM",
            exerciseEquipment: [{ equipment: { type: "CABLE" } }],
          },
          sets: [
            {
              id: "set-1",
              setIndex: 1,
              targetReps: 10,
              targetRepMin: 8,
              targetRepMax: 12,
              targetLoad: 40,
              targetRpe: 8,
              logs: [{ actualReps: 8, actualLoad: 40, actualRpe: 8, wasSkipped: false }],
            },
          ],
        },
      ],
    });

    const { default: WorkoutDetailPage } = await import("./page");
    const ui = await WorkoutDetailPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.getByText("Session outcome")).toBeInTheDocument();
    expect(
      screen.getByText("Key lifts point to a hold next time while reps keep building.")
    ).toBeInTheDocument();
    expect(screen.getByText("Key lift takeaways")).toBeInTheDocument();
    expect(screen.getByText("Today's target context")).toBeInTheDocument();
    expect(screen.getByText(/Next exposure: hold load\./)).toBeInTheDocument();
    expect(screen.getAllByText("Program impact")).toHaveLength(1);
    expect(screen.getByText(/Actual: 8 reps \| 40 lbs \| RPE 8 OK/)).toHaveClass("text-emerald-700");
    expect(screen.getByText("Post-session review ready")).toBeInTheDocument();
    expect(screen.getByText("Completed planned work")).toBeInTheDocument();
    expect(screen.getAllByText(/No seed or plan changes made/).length).toBeGreaterThan(0);
    expect(mocks.loadCompletedWorkoutReviewReadModel).toHaveBeenCalledWith(
      "user-1",
      "workout-1"
    );
  });

  it("does not render the post-session review card when the read model has no review", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status: "COMPLETED",
      estimatedMinutes: 55,
      selectionMetadata: null,
      sessionIntent: "PULL",
      exercises: [],
    });

    const { default: WorkoutDetailPage } = await import("./page");
    const ui = await WorkoutDetailPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.queryByLabelText("Post-session review")).not.toBeInTheDocument();
    expect(screen.getByText("Session Review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute(
      "href",
      "/workout/workout-1/audit"
    );
  });

  it("labels runtime-added sets explicitly on workout detail surfaces", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status: "COMPLETED",
      estimatedMinutes: 55,
      selectionMetadata: {
        runtimeEditReconciliation: {
          version: 1,
          lastReconciledAt: "2026-03-24T10:00:00.000Z",
          directives: {
            continuityAlias: "none",
            progressionAlias: "none",
            futureSessionGeneration: "ignore",
            futureSeedCarryForward: "ignore",
          },
          ops: [
            {
              kind: "add_set",
              source: "api_workouts_add_set",
              appliedAt: "2026-03-24T10:00:00.000Z",
              scope: "current_workout_only",
              facts: {
                workoutExerciseId: "we-1",
                exerciseId: "lat-pull",
                workoutSetId: "set-2",
                setIndex: 2,
                clonedFromSetIndex: 1,
              },
            },
          ],
        },
      },
      sessionIntent: "PULL",
      exercises: [
        {
          id: "we-1",
          orderIndex: 0,
          exerciseId: "lat-pull",
          isMainLift: true,
          section: "MAIN",
          exercise: {
            name: "Lat Pulldown",
            jointStress: "MEDIUM",
            exerciseEquipment: [{ equipment: { type: "CABLE" } }],
          },
          sets: [
            {
              id: "set-1",
              setIndex: 1,
              targetReps: 10,
              targetRepMin: 8,
              targetRepMax: 12,
              targetLoad: 40,
              targetRpe: 8,
              logs: [{ actualReps: 10, actualLoad: 40, actualRpe: 8, wasSkipped: false }],
            },
            {
              id: "set-2",
              setIndex: 2,
              targetReps: 10,
              targetRepMin: 8,
              targetRepMax: 12,
              targetLoad: 40,
              targetRpe: 8,
              logs: [{ actualReps: 9, actualLoad: 40, actualRpe: 8, wasSkipped: false }],
            },
          ],
        },
      ],
    });

    const { default: WorkoutDetailPage } = await import("./page");
    const ui = await WorkoutDetailPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.getByText("Extra set")).toBeInTheDocument();
  });

  it("labels runtime-added exercises explicitly on workout detail surfaces", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status: "COMPLETED",
      estimatedMinutes: 55,
      selectionMetadata: {
        runtimeEditReconciliation: {
          version: 1,
          lastReconciledAt: "2026-03-24T10:00:00.000Z",
          directives: {
            continuityAlias: "none",
            progressionAlias: "none",
            futureSessionGeneration: "ignore",
            futureSeedCarryForward: "ignore",
          },
          ops: [
            {
              kind: "add_exercise",
              source: "api_workouts_add_exercise",
              appliedAt: "2026-03-24T10:00:00.000Z",
              scope: "current_workout_only",
              facts: {
                workoutExerciseId: "we-added",
                exerciseId: "pec-deck",
                orderIndex: 1,
                section: "ACCESSORY",
                setCount: 2,
                prescriptionSource: "session_accessory_defaults",
              },
            },
          ],
        },
      },
      sessionIntent: "PULL",
      exercises: [
        {
          id: "we-added",
          orderIndex: 0,
          exerciseId: "pec-deck",
          isMainLift: false,
          section: "ACCESSORY",
          exercise: {
            name: "Pec Deck",
            jointStress: "LOW",
            exerciseEquipment: [{ equipment: { type: "MACHINE" } }],
          },
          sets: [
            {
              id: "set-1",
              setIndex: 1,
              targetReps: 12,
              targetRepMin: 10,
              targetRepMax: 14,
              targetLoad: 80,
              targetRpe: 6.5,
              logs: [{ actualReps: 12, actualLoad: 80, actualRpe: 7, wasSkipped: false }],
            },
          ],
        },
      ],
    });

    const { default: WorkoutDetailPage } = await import("./page");
    const ui = await WorkoutDetailPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.getByText("Added exercise")).toBeInTheDocument();
  });

  it("surfaces same-exercise planned/add duplicate logging on workout detail review", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status: "COMPLETED",
      estimatedMinutes: 55,
      selectionMetadata: {
        runtimeEditReconciliation: {
          version: 1,
          lastReconciledAt: "2026-05-19T10:00:00.000Z",
          directives: {
            continuityAlias: "none",
            progressionAlias: "none",
            futureSessionGeneration: "ignore",
            futureSeedCarryForward: "ignore",
          },
          ops: [
            {
              kind: "add_exercise",
              source: "api_workouts_add_exercise",
              appliedAt: "2026-05-19T10:00:00.000Z",
              scope: "current_workout_only",
              facts: {
                workoutExerciseId: "we-added",
                exerciseId: "rear-delt-fly",
                orderIndex: 1,
                section: "ACCESSORY",
                setCount: 3,
                prescriptionSource: "session_accessory_defaults",
              },
            },
          ],
        },
      },
      sessionIntent: "UPPER",
      exercises: [
        {
          id: "we-planned",
          orderIndex: 0,
          exerciseId: "rear-delt-fly",
          isMainLift: false,
          section: "ACCESSORY",
          exercise: {
            name: "Cable Rear Delt Fly",
            jointStress: "LOW",
            exerciseEquipment: [{ equipment: { type: "CABLE" } }],
          },
          sets: [
            {
              id: "set-planned-1",
              setIndex: 1,
              targetReps: 12,
              targetRepMin: 10,
              targetRepMax: 14,
              targetLoad: 20,
              targetRpe: 8,
              logs: [{ actualReps: null, actualLoad: null, actualRpe: null, wasSkipped: true }],
            },
            {
              id: "set-planned-2",
              setIndex: 2,
              targetReps: 12,
              targetRepMin: 10,
              targetRepMax: 14,
              targetLoad: 20,
              targetRpe: 8,
              logs: [{ actualReps: null, actualLoad: null, actualRpe: null, wasSkipped: true }],
            },
          ],
        },
        {
          id: "we-added",
          orderIndex: 1,
          exerciseId: "rear-delt-fly",
          isMainLift: false,
          section: "ACCESSORY",
          exercise: {
            name: "Cable Rear Delt Fly",
            jointStress: "LOW",
            exerciseEquipment: [{ equipment: { type: "CABLE" } }],
          },
          sets: [
            {
              id: "set-added-1",
              setIndex: 1,
              targetReps: 12,
              targetRepMin: 10,
              targetRepMax: 14,
              targetLoad: 20,
              targetRpe: 8,
              logs: [{ actualReps: 15, actualLoad: 20, actualRpe: 8, wasSkipped: false }],
            },
          ],
        },
      ],
    });

    const { default: WorkoutDetailPage } = await import("./page");
    const ui = await WorkoutDetailPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(
      screen.getByText(/Cable Rear Delt Fly was planned but skipped, while the same exercise was logged as an added exercise/)
    ).toBeInTheDocument();
  });

  it("labels swapped exercises explicitly on workout detail surfaces", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status: "COMPLETED",
      estimatedMinutes: 55,
      selectionMetadata: {
        runtimeEditReconciliation: {
          version: 1,
          lastReconciledAt: "2026-03-24T10:00:00.000Z",
          directives: {
            continuityAlias: "none",
            progressionAlias: "none",
            futureSessionGeneration: "ignore",
            futureSeedCarryForward: "ignore",
          },
          ops: [
            {
              kind: "replace_exercise",
              source: "api_workouts_swap_exercise",
              appliedAt: "2026-03-24T10:00:00.000Z",
              scope: "current_workout_only",
              facts: {
                workoutExerciseId: "we-row",
                fromExerciseId: "t-bar-row",
                fromExerciseName: "T-Bar Row",
                toExerciseId: "chest-supported-db-row",
                toExerciseName: "Chest-Supported Dumbbell Row",
                reason: "equipment_availability_equivalent_pull_swap",
                setCount: 2,
              },
            },
          ],
        },
      },
      sessionIntent: "PULL",
      exercises: [
        {
          id: "we-row",
          orderIndex: 0,
          exerciseId: "chest-supported-db-row",
          isMainLift: false,
          section: "MAIN",
          exercise: {
            name: "Chest-Supported Dumbbell Row",
            jointStress: "LOW",
            exerciseEquipment: [{ equipment: { type: "DUMBBELL" } }],
          },
          sets: [
            {
              id: "set-1",
              setIndex: 1,
              targetReps: 10,
              targetRepMin: 8,
              targetRepMax: 12,
              targetLoad: 27.5,
              targetRpe: 8,
              logs: [{ actualReps: 10, actualLoad: 27.5, actualRpe: 8, wasSkipped: false }],
            },
          ],
        },
      ],
    });

    const { default: WorkoutDetailPage } = await import("./page");
    const ui = await WorkoutDetailPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.getByText("Swapped")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Swapped from T-Bar Row. Session-only; future progression stays exercise-specific."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Added exercise")).not.toBeInTheDocument();
  });

  it("keeps the workout detail page out of audit, contract, producer, and immediate-review paths", () => {
    const source = readFileSync("src/app/workout/[id]/page.tsx", "utf8");

    expect(source).toContain("@/lib/api/completed-workout-review");
    expect(source).toContain("@/components/post-workout/PostSessionReviewCard");
    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("scripts/workout-audit");
    expect(source).not.toContain("artifacts/audits");
    expect(source).not.toContain("post-session-review-contract");
    expect(source).not.toContain("post-session-review-evidence");
    expect(source).not.toContain("post-session-review-producer");
    expect(source).not.toContain("@/components/log-workout/CompletedWorkoutReview");
  });
});
