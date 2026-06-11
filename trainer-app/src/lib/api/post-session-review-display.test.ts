import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPostSessionReviewContract } from "./post-session-review-contract-builder";
import {
  adaptBlockedPostSessionReviewToDisplay,
  adaptPostSessionReviewContractToDisplay,
} from "./post-session-review-display";
import type {
  PostSessionReviewContractBuildInput,
  PostSessionReviewExerciseEvidence,
} from "./post-session-review-evidence";

function performedSet(
  id: string,
  input: Partial<PostSessionReviewExerciseEvidence["sets"][number]> = {}
): PostSessionReviewExerciseEvidence["sets"][number] {
  return {
    workoutSetId: id,
    setIndex: Number(id.replace(/\D/g, "")) || 1,
    targetReps: 10,
    targetRepMin: 8,
    targetRepMax: 12,
    targetRpe: 8,
    targetLoad: 100,
    wasLogged: true,
    wasSkipped: false,
    actualReps: 10,
    actualLoad: 100,
    actualRpe: 8,
    ...input,
  };
}

function exercise(
  input: Partial<PostSessionReviewExerciseEvidence>
): PostSessionReviewExerciseEvidence {
  return {
    workoutExerciseId: input.workoutExerciseId ?? input.exerciseId ?? "we-1",
    exerciseId: input.exerciseId ?? "bench",
    exerciseName: input.exerciseName ?? "Bench Press",
    section: "MAIN",
    isMainLift: true,
    sets: input.sets ?? [
      performedSet("set-1"),
      performedSet("set-2"),
      performedSet("set-3"),
    ],
    ...input,
  };
}

function buildInput(
  overrides: Partial<PostSessionReviewContractBuildInput> = {}
): PostSessionReviewContractBuildInput {
  return {
    workoutIdentity: {
      userId: "user-1",
      workoutId: "workout-1",
      status: "COMPLETED",
      revision: 2,
      scheduledDate: "2026-06-01T12:00:00.000Z",
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      advancesSplit: true,
      mesocycleId: "meso-1",
      mesocycleWeekSnapshot: 4,
      mesoSessionSnapshot: 2,
      mesocyclePhaseSnapshot: "ACCUMULATION",
      slotId: "upper_a",
    },
    sourceTruth: {
      setLogsAvailable: true,
      workoutStructureAvailable: true,
      sessionDecisionReceiptAvailable: true,
      workoutStructureStateAvailable: true,
      runtimeEditReconciliationAvailable: false,
    },
    sessionSemantics: {
      kind: "advancing",
      isDeload: false,
      countsTowardWeeklyVolume: true,
      countsTowardProgressionHistory: true,
      countsTowardPerformanceHistory: true,
      updatesProgressionAnchor: true,
    },
    exercises: [exercise({})],
    ...overrides,
  };
}

function buildDisplay(overrides: Partial<PostSessionReviewContractBuildInput> = {}) {
  return adaptPostSessionReviewContractToDisplay(
    buildPostSessionReviewContract(buildInput(overrides))
  );
}

describe("post-session review display adapter", () => {
  it("maps a completed clean workout to a concise review DTO", () => {
    const display = buildDisplay();

    expect(display).toMatchObject({
      status: "reviewed",
      headline: "Post-session review ready",
      summaryBullets: [
        "Completed planned work",
        "No seed or plan changes made",
      ],
      completion: {
        plannedSetCount: 3,
        completedSetCount: 3,
        skippedSetCount: 0,
        extraSetCount: 0,
        completionPct: 100,
      },
      exerciseChanges: [],
      loadCalibration: [],
      nextExposureNotes: [],
      weeklyImpact: [],
      warnings: [],
    });
    expect(display.source).toMatchObject({
      workoutId: "workout-1",
      userId: "user-1",
      ownerSeam: "api/post-session-review-display",
      readOnly: true,
      evidenceOnly: true,
    });
  });

  it("maps a skipped planned exercise to a readable exercise-change row", () => {
    const display = buildDisplay({
      exercises: [
        exercise({
          exerciseId: "lat-pulldown",
          exerciseName: "Lat Pulldown",
          sets: [
            performedSet("set-1", {
              wasSkipped: true,
              actualReps: null,
              actualLoad: null,
            }),
            performedSet("set-2", {
              wasSkipped: true,
              actualReps: null,
              actualLoad: null,
            }),
          ],
        }),
      ],
    });

    expect(display.summaryBullets).toContain("2 planned sets skipped");
    expect(display.exerciseChanges).toEqual([
      {
        kind: "skipped",
        exerciseName: "Lat Pulldown",
        headline: "Skipped planned Lat Pulldown",
        detail: "0 of 2 planned sets performed.",
        evidenceOnly: true,
      },
    ]);
  });

  it("maps a runtime-added exercise to a readable add-on row", () => {
    const display = buildDisplay({
      sourceTruth: {
        ...buildInput().sourceTruth,
        runtimeEditReconciliationAvailable: true,
      },
      exercises: [
        exercise({ exerciseId: "bench", workoutExerciseId: "we-planned" }),
        exercise({
          exerciseId: "cable-curls",
          workoutExerciseId: "we-added",
          exerciseName: "Cable Curls",
          isRuntimeAdded: true,
          isMainLift: false,
          section: "ACCESSORY",
          sets: [performedSet("set-10"), performedSet("set-11")],
        }),
      ],
    });

    expect(display.summaryBullets).toContain("2 session-local extra sets added");
    expect(display.exerciseChanges).toEqual([
      {
        kind: "runtime_added",
        exerciseName: "Cable Curls",
        headline: "Added Cable Curls",
        detail: "2 session-local sets performed.",
        evidenceOnly: true,
      },
    ]);
  });

  it("maps replacement-like evidence as evidence, not automatic policy", () => {
    const display = buildDisplay({
      sourceTruth: {
        ...buildInput().sourceTruth,
        runtimeEditReconciliationAvailable: true,
      },
      exercises: [
        exercise({
          workoutExerciseId: "we-replaced",
          exerciseId: "machine-row",
          exerciseName: "Machine Row",
          replacement: {
            source: "runtime_edit_reconciliation",
            fromExerciseId: "barbell-row",
            fromExerciseName: "Barbell Row",
            toExerciseId: "machine-row",
            toExerciseName: "Machine Row",
            reason: "equipment_availability_equivalent_pull_swap",
            setCount: 3,
            evidence: ["replace_exercise persisted op"],
            seedMutation: false,
            policyMutation: false,
          },
        }),
      ],
    });

    expect(display.exerciseChanges).toContainEqual({
      kind: "replacement_evidence",
      exerciseName: "Machine Row",
      headline: "Used Machine Row instead of Barbell Row",
      detail: "Captured as evidence only; no automatic exercise or seed change.",
      evidenceOnly: true,
    });
    expect(display.loadCalibration).toContainEqual(
      expect.objectContaining({
        exerciseName: "Machine Row",
        headline: "Machine Row was replacement evidence",
        detail: "Use this as review context only; no automatic exercise change.",
        evidenceOnly: true,
      })
    );
  });

  it("maps target-too-high and target-too-low calibration to readable copy", () => {
    const display = buildDisplay({
      exercises: [
        exercise({
          exerciseId: "too-high",
          exerciseName: "Shoulder Press",
          sets: [
            performedSet("set-1", {
              targetLoad: 100,
              actualLoad: 100,
              actualReps: 10,
              targetRpe: 8,
              actualRpe: 9.5,
            }),
            performedSet("set-2", {
              targetLoad: 100,
              actualLoad: 100,
              actualReps: 10,
              targetRpe: 8,
              actualRpe: 9.5,
            }),
          ],
        }),
        exercise({
          exerciseId: "too-low",
          exerciseName: "Bench Press",
          sets: [
            performedSet("set-3", {
              targetLoad: 100,
              actualLoad: 130,
              actualReps: 14,
              targetRpe: 8,
              actualRpe: 6.5,
            }),
            performedSet("set-4", {
              targetLoad: 100,
              actualLoad: 130,
              actualReps: 14,
              targetRpe: 8,
              actualRpe: 6.5,
            }),
          ],
        }),
      ],
    });

    expect(display.loadCalibration).toEqual([
      expect.objectContaining({
        exerciseName: "Shoulder Press",
        status: "watch",
        headline: "Shoulder Press target looked too heavy",
        detail:
          "Performed median load 100 vs target 100; 10 median reps, in the target rep range; RPE 9.5, harder than target.",
        nextExposureNote: "Next exposure: review the starting point before increasing.",
      }),
      expect.objectContaining({
        exerciseName: "Bench Press",
        status: "watch",
        headline: "Bench Press target looked too light",
        detail:
          "Performed median load 130 vs target 100; 14 median reps, above the target rep range; RPE 6.5, easier than target.",
        nextExposureNote: "Next exposure: raise starting point modestly.",
      }),
    ]);
    expect(display.learningSignals).toEqual(
      expect.arrayContaining([
        {
          label: "Load calibration",
          severity: "watch",
          summary:
            "Prescription calibration evidence: 1 looked too heavy, 1 looked too light.",
        },
      ])
    );
  });

  it("renders next-exposure rows as recommendations, not mutations", () => {
    const display = buildDisplay({
      nextExposureDecisions: [
        {
          exerciseId: "bench",
          exerciseName: "Bench Press",
          decision: {
            action: "recalibrated_increase",
            summary: "Internal explainability summary is not display copy.",
            reason: "Median reps stayed in range.",
            anchorLoad: 105,
            repRange: { min: 8, max: 12 },
            modalRpe: 8,
            medianReps: 11,
            decisionLog: ["debug decision trail"],
          },
        },
      ],
    });

    expect(display.nextExposureNotes).toEqual([
      {
        exerciseName: "Bench Press",
        recommendation: "Next exposure: raise starting point modestly.",
        basis: "Based on logged reps, effort, and anchor load 105.",
        evidenceOnly: true,
        mutation: false,
      },
    ]);
    expect(JSON.stringify(display)).not.toContain("Internal explainability summary");
    expect(JSON.stringify(display)).not.toContain("debug decision trail");
  });

  it("maps weekly impact and learning signals without raw evidence codes", () => {
    const display = buildDisplay({
      weeklyImpact: {
        source: "explainability_volume_compliance",
        rows: [
          {
            muscle: "Chest",
            performedEffectiveVolumeBeforeSession: 6,
            plannedEffectiveVolumeThisSession: 3,
            projectedEffectiveVolume: 9,
            weeklyTarget: 10,
            mev: 8,
            mav: 16,
            status: "APPROACHING_TARGET",
          },
        ],
      },
    });

    expect(display.weeklyImpact).toEqual([
      {
        muscle: "Chest",
        headline: "Chest ended approaching weekly target",
        detail: "9 effective sets projected vs 10 target.",
      },
    ]);
    expect(display.learningSignals).toEqual(
      expect.arrayContaining([
        {
          label: "Logged performance",
          severity: "info",
          summary: "Performed set evidence is available for review.",
        },
        {
          label: "Weekly impact",
          severity: "info",
          summary: "Weekly volume impact is available for review.",
        },
      ])
    );
  });

  it("does not leak raw debug or internal contract strings into display fields", () => {
    const display = buildDisplay({
      sourceTruth: {
        ...buildInput().sourceTruth,
        runtimeEditReconciliationAvailable: true,
      },
      exercises: [
        exercise({
          workoutExerciseId: "we-replaced",
          exerciseId: "too-low",
          exerciseName: "Bench Press",
          replacement: {
            source: "runtime_edit_reconciliation",
            fromExerciseId: "barbell-bench",
            fromExerciseName: "Barbell Bench Press",
            toExerciseId: "too-low",
            toExerciseName: "Bench Press",
            reason: "equipment_availability_equivalent_push_swap",
            evidence: ["selectionMetadata.runtimeEditReconciliation op"],
            seedMutation: false,
            policyMutation: false,
          },
          sets: [
            performedSet("set-1", { targetLoad: 100, actualLoad: 130 }),
            performedSet("set-2", { targetLoad: 100, actualLoad: 130 }),
          ],
        }),
      ],
      nextExposureDecisions: [
        {
          exerciseId: "too-low",
          exerciseName: "Bench Press",
          decision: {
            action: "increase",
            summary: "raw summary should not leak",
            reason: "raw reason should not leak",
            anchorLoad: 130,
            repRange: { min: 8, max: 12 },
            modalRpe: 8,
            medianReps: 10,
            decisionLog: ["raw decision log should not leak"],
          },
        },
      ],
    });
    const serialized = JSON.stringify(display);

    expect(serialized).not.toContain("contractVersion");
    expect(serialized).not.toContain("reasonCodes");
    expect(serialized).not.toContain("decisionLog");
    expect(serialized).not.toContain("runtime_edit_reconciliation");
    expect(serialized).not.toContain("replacement_like");
    expect(serialized).not.toContain("target_too_low");
    expect(serialized).not.toContain("target_too_high");
    expect(serialized).not.toContain("load_too_light");
    expect(serialized).not.toContain("load_too_heavy");
    expect(serialized).not.toContain("performedRealityCoherence");
    expect(serialized).not.toContain("policyMutation");
    expect(serialized).not.toContain("seedMutation");
    expect(serialized).not.toContain("affectsProgressionPolicy");
    expect(serialized).not.toContain("affectsPrescriptionPolicy");
    expect(serialized).not.toContain("selectionMetadata");
    expect(serialized).not.toContain("raw summary should not leak");
    expect(serialized).not.toContain("raw decision log should not leak");
  });

  it("maps recent exact-exercise calibration history to safe learning copy", () => {
    const display = buildDisplay({
      recentExerciseExposures: [
        {
          ...exercise({
            workoutExerciseId: "prior-heavy",
            exerciseId: "bench",
            exerciseName: "Bench Press",
            sets: [
              performedSet("prior-heavy-set-1", {
                targetLoad: 100,
                actualLoad: 100,
                actualReps: 10,
                targetRpe: 8,
                actualRpe: 9.5,
              }),
              performedSet("prior-heavy-set-2", {
                targetLoad: 100,
                actualLoad: 100,
                actualReps: 10,
                targetRpe: 8,
                actualRpe: 9.5,
              }),
            ],
          }),
          workoutId: "prior-heavy-workout",
          performedAt: "2026-05-25T13:00:00.000Z",
        },
      ],
    });

    expect(display.learningSignals).toEqual(
      expect.arrayContaining([
        {
          label: "Load calibration",
          severity: "watch",
          summary:
            "Recent exact-exercise calibration history has watch evidence for 1 exercise(s).",
        },
      ])
    );
    expect(JSON.stringify(display)).not.toContain("load_too_heavy");
    expect(JSON.stringify(display)).not.toContain("prior_exposures");
  });

  it("maps blocked producer-style results to safe blocked DTOs", () => {
    expect(
      adaptBlockedPostSessionReviewToDisplay({
        status: "blocked",
        reason: "not_ready",
        message: "Workout is not completed or partial enough for post-session review.",
      })
    ).toMatchObject({
      status: "not_ready",
      headline: "Post-session review is not ready",
      completion: null,
      exerciseChanges: [],
      summaryBullets: ["No seed or plan changes made"],
      warnings: [
        "Workout is not completed or partial enough for post-session review.",
      ],
    });

    expect(
      adaptBlockedPostSessionReviewToDisplay({
        status: "blocked",
        reason: "invalid_contract",
      })
    ).toMatchObject({
      status: "blocked",
      headline: "Post-session review unavailable",
      warnings: ["Review source evidence could not be prepared safely."],
    });
  });

  it("does not import audit, CLI, artifact, persistence, or mutation paths", () => {
    const source = readFileSync(
      "src/lib/api/post-session-review-display.ts",
      "utf8"
    );

    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("scripts/workout-audit");
    expect(source).not.toContain("artifacts/audits");
    expect(source).not.toContain("@/lib/db/prisma");
    expect(source).not.toContain("prisma.");
    expect(source).not.toContain("generateWorkoutExplanation");
    expect(source).not.toContain("weekly-retro");
    expect(source).not.toContain("writeFile");
    expect(source).not.toContain("create(");
    expect(source).not.toContain("update(");
    expect(source).not.toContain("upsert(");
    expect(source).not.toContain("delete(");
  });
});
