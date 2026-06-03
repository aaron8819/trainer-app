import { readFileSync } from "node:fs";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompletedWorkoutReview } from "./CompletedWorkoutReview";
import type { PostSessionReviewDisplayDto } from "@/lib/api/post-session-review-display";
import type { WorkoutExplanationResponse } from "@/lib/ui/workout-explanation-response";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

function makePostSessionReview(
  overrides: Partial<PostSessionReviewDisplayDto> = {}
): PostSessionReviewDisplayDto {
  return {
    status: "reviewed",
    headline: "Post-session review ready",
    summaryBullets: ["Completed planned work", "No seed or plan changes made"],
    completion: {
      plannedSetCount: 1,
      completedSetCount: 1,
      skippedSetCount: 0,
      extraSetCount: 0,
      missingLogSetCount: 0,
      completionPct: 100,
      label: "100% of planned/session-local work logged",
    },
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
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function makeExplanationResponse(): WorkoutExplanationResponse {
  return {
    confidence: {
      level: "high",
      summary: "ok",
      missingSignals: [],
    },
    sessionContext: {
      blockPhase: {
        blockType: "accumulation",
        weekInBlock: 2,
        totalWeeksInBlock: 4,
        primaryGoal: "build",
      },
      volumeStatus: {
        muscleStatuses: new Map(),
        overallSummary: "ok",
      },
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
        weekInMesocycle: 2,
        volumeProgression: "building",
        intensityProgression: "ramping",
        nextMilestone: "keep building",
      },
      cycleSource: "computed",
      narrative: "narrative",
    },
    coachMessages: [],
    exerciseRationales: {},
    prescriptionRationales: {},
    progressionReceipts: {
      "ex-1": {
        lastPerformed: {
          reps: 10,
          load: 95,
          rpe: 8,
          performedAt: "2026-06-01T00:00:00.000Z",
        },
        todayPrescription: {
          reps: 10,
          load: 100,
          rpe: 8,
        },
        delta: {
          load: 5,
          loadPercent: 5.26,
          reps: 0,
          rpe: 0,
        },
        trigger: "double_progression",
        decisionLog: [],
      },
    },
    nextExposureDecisions: {
      "ex-1": {
        action: "hold",
        summary: "Next exposure: hold load.",
        reason: "Median reps stayed in range, so keep building reps before adding load.",
        anchorLoad: 100,
        repRange: { min: 8, max: 12 },
        modalRpe: 8,
        medianReps: 10,
      },
    },
    filteredExercises: [],
    volumeCompliance: [],
  };
}

describe("CompletedWorkoutReview", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("colors in-range ranged-rep results as on target", () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 2"
        sessionTechnicalLabel="Slot ID: upper_b"
        performanceSummary={[
          {
            exerciseId: "ex-1",
            name: "Lat Pulldown",
            equipment: ["cable"],
            isMainLift: false,
            section: "main",
            sets: [
              {
                setIndex: 1,
                targetReps: 10,
                targetRepRange: { min: 8, max: 12 },
                targetLoad: 40,
                targetRpe: 8,
                actualReps: 8,
                actualLoad: 40,
                actualRpe: 8,
                wasLogged: true,
                wasSkipped: false,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("8 reps | 40 lbs | RPE 8")).toHaveClass("text-emerald-700");
  });

  it("renders skipped sets distinctly from performed sets", () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 2"
        sessionTechnicalLabel="Slot ID: upper_b"
        performanceSummary={[
          {
            exerciseId: "ex-1",
            name: "Lat Pulldown",
            equipment: ["cable"],
            isMainLift: false,
            section: "main",
            sets: [
              {
                setIndex: 1,
                targetReps: 10,
                targetRepRange: { min: 8, max: 12 },
                targetLoad: 40,
                targetRpe: 8,
                actualReps: null,
                actualLoad: null,
                actualRpe: null,
                wasLogged: true,
                wasSkipped: true,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("Skipped")).toHaveClass("text-slate-500");
  });

  it("labels runtime-added sets explicitly from persisted provenance", () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 2"
        sessionTechnicalLabel="Slot ID: upper_b"
        performanceSummary={[
          {
            exerciseId: "ex-1",
            name: "Lat Pulldown",
            equipment: ["cable"],
            isMainLift: false,
            section: "main",
            sets: [
              {
                setIndex: 3,
                isRuntimeAdded: true,
                targetReps: 12,
                targetLoad: 40,
                targetRpe: 8,
                actualReps: 12,
                actualLoad: 40,
                actualRpe: 8,
                wasLogged: true,
                wasSkipped: false,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("Extra set")).toBeInTheDocument();
  });

  it("labels runtime-added exercises explicitly in the completed review", () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 2"
        sessionTechnicalLabel="Slot ID: upper_b"
        performanceSummary={[
          {
            exerciseId: "ex-1",
            name: "Pec Deck",
            equipment: ["machine"],
            isRuntimeAdded: true,
            isMainLift: false,
            section: "accessory",
            sets: [
              {
                setIndex: 1,
                targetReps: 12,
                targetLoad: 80,
                targetRpe: 6.5,
                actualReps: 12,
                actualLoad: 80,
                actualRpe: 7,
                wasLogged: true,
                wasSkipped: false,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("Added exercise")).toBeInTheDocument();
  });

  it("reports swapped exercises as replacements instead of extras", () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 2"
        sessionTechnicalLabel="Slot ID: upper_b"
        performanceSummary={[
          {
            exerciseId: "ex-1",
            name: "Chest-Supported Dumbbell Row",
            equipment: ["dumbbell"],
            isSwapped: true,
            isMainLift: false,
            section: "main",
            sessionNote:
              "Swapped from T-Bar Row. Session-only; future progression stays exercise-specific.",
            sets: [
              {
                setIndex: 1,
                targetReps: 10,
                targetLoad: 27.5,
                targetRpe: 8,
                actualReps: 10,
                actualLoad: 27.5,
                actualRpe: 8,
                wasLogged: true,
                wasSkipped: false,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("Swapped")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Swapped from T-Bar Row. Session-only; future progression stays exercise-specific."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Added exercise")).not.toBeInTheDocument();
  });

  it("renders the session identity without exposing slot ids", () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 2"
        sessionTechnicalLabel="Slot ID: upper_b"
        performanceSummary={[]}
      />
    );

    expect(screen.getByText("Upper 2")).toBeInTheDocument();
    expect(screen.queryByText("Slot ID: upper_b")).not.toBeInTheDocument();
  });

  it("separates planned, completed, skipped, and extra set counts in the summary header", () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 1"
        sessionTechnicalLabel="Slot ID: upper_a"
        performanceSummary={[
          {
            exerciseId: "ex-1",
            name: "T-Bar Row",
            equipment: ["machine"],
            isMainLift: true,
            section: "main",
            sets: [
              {
                setIndex: 1,
                targetReps: 10,
                targetLoad: 100,
                targetRpe: 8,
                actualReps: 10,
                actualLoad: 100,
                actualRpe: 8,
                wasLogged: true,
                wasSkipped: false,
              },
              {
                setIndex: 2,
                targetReps: 10,
                targetLoad: 100,
                targetRpe: 8,
                actualReps: null,
                actualLoad: null,
                actualRpe: null,
                wasLogged: true,
                wasSkipped: true,
              },
            ],
          },
          {
            exerciseId: "ex-2",
            name: "Pec Deck",
            equipment: ["machine"],
            isRuntimeAdded: true,
            isMainLift: false,
            section: "accessory",
            sets: [
              {
                setIndex: 1,
                targetReps: 12,
                targetLoad: 80,
                targetRpe: 7,
                actualReps: 12,
                actualLoad: 80,
                actualRpe: 7,
                wasLogged: true,
                wasSkipped: false,
              },
              {
                setIndex: 2,
                targetReps: 12,
                targetLoad: 80,
                targetRpe: 7,
                actualReps: 12,
                actualLoad: 80,
                actualRpe: 7,
                wasLogged: true,
                wasSkipped: false,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("Planned sets")).toBeInTheDocument();
    expect(screen.getByText("Completed sets")).toBeInTheDocument();
    expect(screen.getByText("Skipped sets")).toBeInTheDocument();
    expect(screen.getByText("Extra sets")).toBeInTheDocument();

    const plannedCard = screen.getByText("Planned sets").closest("div");
    const completedCard = screen.getByText("Completed sets").closest("div");
    const skippedCard = screen.getByText("Skipped sets").closest("div");
    const extraCard = screen.getByText("Extra sets").closest("div");

    expect(plannedCard).not.toBeNull();
    expect(completedCard).not.toBeNull();
    expect(skippedCard).not.toBeNull();
    expect(extraCard).not.toBeNull();

    expect(within(plannedCard as HTMLElement).getByText("2")).toBeInTheDocument();
    expect(within(completedCard as HTMLElement).getByText("3")).toBeInTheDocument();
    expect(within(skippedCard as HTMLElement).getByText("1")).toBeInTheDocument();
    expect(within(extraCard as HTMLElement).getByText("2")).toBeInTheDocument();
  });

  it("relabels same-exercise added logs as duplicate logging instead of missed planned work", () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 1"
        sessionTechnicalLabel="Slot ID: upper_a"
        performanceSummary={[
          {
            exerciseId: "we-planned",
            sourceExerciseId: "rear-delt-fly",
            name: "Cable Rear Delt Fly",
            equipment: ["cable"],
            isMainLift: false,
            section: "accessory",
            sets: [
              {
                setIndex: 1,
                targetReps: 12,
                actualReps: null,
                actualLoad: null,
                actualRpe: null,
                wasLogged: true,
                wasSkipped: true,
              },
              {
                setIndex: 2,
                targetReps: 12,
                actualReps: null,
                actualLoad: null,
                actualRpe: null,
                wasLogged: true,
                wasSkipped: true,
              },
            ],
          },
          {
            exerciseId: "we-added",
            sourceExerciseId: "rear-delt-fly",
            name: "Cable Rear Delt Fly",
            equipment: ["cable"],
            isRuntimeAdded: true,
            isMainLift: false,
            section: "accessory",
            sets: [
              {
                setIndex: 1,
                targetReps: 12,
                actualReps: 15,
                actualLoad: 20,
                actualRpe: 8,
                wasLogged: true,
                wasSkipped: false,
              },
              {
                setIndex: 2,
                targetReps: 12,
                actualReps: 14,
                actualLoad: 20,
                actualRpe: 8,
                wasLogged: true,
                wasSkipped: false,
              },
              {
                setIndex: 3,
                targetReps: 12,
                actualReps: 13,
                actualLoad: 20,
                actualRpe: 8,
                wasLogged: true,
                wasSkipped: false,
              },
            ],
          },
        ]}
      />
    );

    const skippedCard = screen.getByText("Skipped sets").closest("div");
    expect(skippedCard).not.toBeNull();
    expect(within(skippedCard as HTMLElement).getByText("0")).toBeInTheDocument();
    expect(
      within(skippedCard as HTMLElement).getByText("2 reconciled as duplicate logging")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Cable Rear Delt Fly was planned but skipped while the same exercise was logged as an added exercise/)
    ).toBeInTheDocument();
  });

  it("reserves the post-session review area while the DTO fetch is pending", async () => {
    const postSessionReviewResponse = createDeferred<{
      ok: boolean;
      json: () => Promise<{ postSessionReview: null }>;
    }>();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/post-session-review")) {
          return postSessionReviewResponse.promise;
        }
        if (url.endsWith("/explanation")) {
          return Promise.resolve({
            ok: true,
            json: async () => makeExplanationResponse(),
          });
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      })
    );

    const { container } = render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 1"
        sessionTechnicalLabel="Slot ID: upper_a"
        performanceSummary={[
          {
            exerciseId: "ex-1",
            name: "Bench Press",
            equipment: ["barbell"],
            isMainLift: true,
            section: "main",
            sets: [
              {
                setIndex: 1,
                targetReps: 10,
                targetLoad: 100,
                targetRpe: 8,
                actualReps: 10,
                actualLoad: 100,
                actualRpe: 8,
                wasLogged: true,
                wasSkipped: false,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("Session complete!")).toBeInTheDocument();
    expect(
      screen.getByText("Preparing your post-session review...")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Checking completed work, load calibration, and next-exposure notes.")
    ).toBeInTheDocument();
    expect(screen.getByText("Detailed set log")).toBeInTheDocument();
    expect(screen.getByText("What's next")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View full review" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Generate next workout" })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Session outcome")).toBeInTheDocument());
    expect(
      screen.getByText("Preparing your post-session review...")
    ).toBeInTheDocument();

    const visibleText = container.textContent ?? "";
    expect(visibleText.indexOf("Session complete!")).toBeLessThan(
      visibleText.indexOf("Preparing your post-session review...")
    );
    expect(visibleText.indexOf("Preparing your post-session review...")).toBeLessThan(
      visibleText.indexOf("Session outcome")
    );
    expect(visibleText.indexOf("Session outcome")).toBeLessThan(
      visibleText.indexOf("Detailed set log")
    );

    postSessionReviewResponse.resolve({
      ok: true,
      json: async () => ({ postSessionReview: null }),
    });
    await waitFor(() =>
      expect(
        screen.queryByText("Preparing your post-session review...")
      ).not.toBeInTheDocument()
    );
  });

  it("renders the post-session review card after the completion summary when the DTO is available", async () => {
    const postSessionReviewResponse = createDeferred<{
      ok: boolean;
      json: () => Promise<{ postSessionReview: PostSessionReviewDisplayDto }>;
    }>();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/post-session-review")) {
          return postSessionReviewResponse.promise;
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      })
    );

    const { container } = render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 1"
        sessionTechnicalLabel="Slot ID: upper_a"
        performanceSummary={[
          {
            exerciseId: "ex-1",
            name: "Bench Press",
            equipment: ["barbell"],
            isMainLift: true,
            section: "main",
            sets: [
              {
                setIndex: 1,
                targetReps: 10,
                targetLoad: 100,
                targetRpe: 8,
                actualReps: 12,
                actualLoad: 130,
                actualRpe: 8,
                wasLogged: true,
                wasSkipped: false,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("Session complete!")).toBeInTheDocument();
    expect(
      screen.getByText("Preparing your post-session review...")
    ).toBeInTheDocument();
    expect(screen.getByText("Detailed set log")).toBeInTheDocument();
    expect(screen.getByText("What's next")).toBeInTheDocument();
    postSessionReviewResponse.resolve({
      ok: true,
      json: async () => ({
        postSessionReview: makePostSessionReview({
          loadCalibration: [
            {
              exerciseName: "Bench Press",
              status: "watch",
              headline: "Bench Press target looked too light",
              detail: "Performed median load 130 vs target 100.",
              nextExposureNote: "Next exposure: raise starting point modestly.",
              evidenceOnly: true,
            },
          ],
        }),
      }),
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Post-session review")).toBeInTheDocument()
    );
    expect(
      screen.queryByText("Preparing your post-session review...")
    ).not.toBeInTheDocument();
    expect(screen.getByText("Post-session review ready")).toBeInTheDocument();
    expect(screen.getByText("Bench Press target looked too light")).toBeInTheDocument();
    expect(screen.getAllByText("No seed or plan changes made").length).toBeGreaterThan(0);

    const visibleText = container.textContent ?? "";
    expect(visibleText.indexOf("Session complete!")).toBeLessThan(
      visibleText.indexOf("Post-session review ready")
    );
    expect(visibleText).not.toContain("runtime_edit_reconciliation");
    expect(visibleText).not.toContain("decisionLog");
    expect(visibleText).not.toContain("policyMutation");
    expect(visibleText).not.toContain("seedMutation");
    expect(visibleText).not.toContain("selectionMetadata");
    expect(visibleText).not.toContain("automatically changed your plan");
    expect(visibleText).not.toContain("updated your plan");
  });

  it("omits the post-session review section when the DTO is unavailable", async () => {
    const postSessionReviewResponse = createDeferred<{
      ok: boolean;
      json: () => Promise<{ postSessionReview: null }>;
    }>();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/post-session-review")) {
          return postSessionReviewResponse.promise;
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      })
    );

    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 1"
        sessionTechnicalLabel="Slot ID: upper_a"
        performanceSummary={[]}
      />
    );

    expect(
      screen.getByText("Preparing your post-session review...")
    ).toBeInTheDocument();
    postSessionReviewResponse.resolve({
      ok: true,
      json: async () => ({ postSessionReview: null }),
    });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/workouts/workout-1/post-session-review",
        { cache: "no-store" }
      )
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Preparing your post-session review...")
      ).not.toBeInTheDocument()
    );
    expect(screen.queryByLabelText("Post-session review")).not.toBeInTheDocument();
    expect(screen.getByText("Session complete!")).toBeInTheDocument();
    expect(screen.getByText("What's next")).toBeInTheDocument();
  });

  it("collapses the post-session review placeholder silently when the DTO fetch fails", async () => {
    const postSessionReviewResponse = createDeferred<{
      ok: boolean;
      json: () => Promise<Record<string, never>>;
    }>();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/post-session-review")) {
          return postSessionReviewResponse.promise;
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      })
    );

    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 1"
        sessionTechnicalLabel="Slot ID: upper_a"
        performanceSummary={[]}
      />
    );

    expect(
      screen.getByText("Preparing your post-session review...")
    ).toBeInTheDocument();
    postSessionReviewResponse.resolve({
      ok: false,
      json: async () => ({}),
    });
    await waitFor(() =>
      expect(
        screen.queryByText("Preparing your post-session review...")
      ).not.toBeInTheDocument()
    );
    expect(screen.queryByLabelText("Post-session review")).not.toBeInTheDocument();
    expect(screen.getByText("Session complete!")).toBeInTheDocument();
    expect(screen.getByText("What's next")).toBeInTheDocument();
  });

  it("keeps the immediate review out of audit, producer, contract, and mutation paths", () => {
    const source = readFileSync(
      "src/components/log-workout/CompletedWorkoutReview.tsx",
      "utf8"
    );

    expect(source).toContain("PostSessionReviewCard");
    expect(source).toContain("PostSessionReviewDisplayDto");
    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("scripts/workout-audit");
    expect(source).not.toContain("artifacts/audits");
    expect(source).not.toContain("post-session-review-contract");
    expect(source).not.toContain("post-session-review-evidence");
    expect(source).not.toContain("post-session-review-producer");
    expect(source).not.toContain("@/lib/db/prisma");
    expect(source).not.toContain("prisma.");
    expect(source).not.toContain("create(");
    expect(source).not.toContain("update(");
    expect(source).not.toContain("upsert(");
    expect(source).not.toContain("delete(");
  });
});
