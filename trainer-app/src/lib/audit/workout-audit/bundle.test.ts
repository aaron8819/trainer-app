import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkoutAuditRun } from "./types";

const mocks = vi.hoisted(() => ({
  resolveWorkoutAuditIdentity: vi.fn(),
  buildWorkoutAuditContext: vi.fn(),
  runWorkoutAuditGeneration: vi.fn(),
  loadActiveMesocycle: vi.fn(),
  loadGenerationPhaseBlockContext: vi.fn(),
  getRirTarget: vi.fn(),
  getWeeklyVolumeTarget: vi.fn(),
}));

vi.mock("./context-builder", () => ({
  resolveWorkoutAuditIdentity: (...args: unknown[]) => mocks.resolveWorkoutAuditIdentity(...args),
  buildWorkoutAuditContext: (...args: unknown[]) => mocks.buildWorkoutAuditContext(...args),
}));

vi.mock("./generation-runner", () => ({
  runWorkoutAuditGeneration: (...args: unknown[]) => mocks.runWorkoutAuditGeneration(...args),
}));

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) => mocks.loadActiveMesocycle(...args),
  getRirTarget: (...args: unknown[]) => mocks.getRirTarget(...args),
  getWeeklyVolumeTarget: (...args: unknown[]) => mocks.getWeeklyVolumeTarget(...args),
}));

vi.mock("@/lib/api/generation-phase-block-context", () => ({
  loadGenerationPhaseBlockContext: (...args: unknown[]) =>
    mocks.loadGenerationPhaseBlockContext(...args),
}));

import { writeSplitSanityAuditArtifacts } from "./bundle";

function buildReceipt(options?: {
  remainingDeficit?: number;
  futureCapacity?: number;
  requiredNow?: number;
  closureUsed?: boolean;
  rescueUsed?: boolean;
}) {
  const layersUsed: Array<"anchor" | "standard"> = ["anchor", "standard"];
  const remainingDeficit = options?.remainingDeficit ?? 0;
  const futureCapacity = options?.futureCapacity ?? 4;
  const requiredNow = options?.requiredNow ?? 0;

  return {
    version: 1 as const,
    cycleContext: {
      weekInMeso: 2,
      weekInBlock: 2,
      mesocycleLength: 5,
      phase: "accumulation" as const,
      blockType: "accumulation" as const,
      isDeload: false,
      source: "computed" as const,
    },
    targetMuscles: ["Chest"],
    lifecycleRirTarget: { min: 2, max: 3 },
    lifecycleVolume: {
      targets: {
        Chest: 12,
      },
      source: "lifecycle" as const,
    },
    sorenessSuppressedMuscles: [],
    deloadDecision: {
      mode: "none" as const,
      reason: [],
      reductionPercent: 0,
      appliedTo: "none" as const,
    },
    plannerDiagnosticsMode: "debug" as const,
    plannerDiagnostics: {
      opportunity: {
        opportunityKey: "push",
        sessionIntent: "push" as const,
        sessionCharacter: "upper" as const,
        planningInventoryKind: "standard" as const,
        closureInventoryKind: "closure" as const,
        targetMuscles: ["Chest"],
        currentSessionMuscleOpportunity: {
          Chest: {
            sessionOpportunityWeight: 1,
            weeklyTarget: 12,
            performedEffectiveVolumeBeforeSession: 4,
            startingDeficit: 8,
            weeklyOpportunityUnits: 4,
            futureOpportunityUnits: 1,
            futureCapacity,
            requiredNow,
            urgencyMultiplier: 1.5,
          },
        },
        remainingWeek: {
          futureSlots: ["pull" as const],
          futureSlotCounts: { pull: 1 },
          futureCapacityFactor: 0.9,
        },
      },
      muscles: {
        Chest: {
          weeklyTarget: 12,
          performedEffectiveVolumeBeforeSession: 4,
          plannedEffectiveVolumeAfterRoleBudgeting: 5,
          projectedEffectiveVolumeAfterRoleBudgeting: 9,
          deficitAfterRoleBudgeting: 3,
          plannedEffectiveVolumeAfterClosure: 8,
          projectedEffectiveVolumeAfterClosure: 12 - remainingDeficit,
          finalRemainingDeficit: remainingDeficit,
        },
      },
      exercises: {},
      closure: {
        eligible: true,
        used: options?.closureUsed ?? false,
        reason: options?.closureUsed ? "closure_applied" : "closure_not_needed",
        inventoryKind: "closure" as const,
        eligibleExerciseIds: ["bench-press"],
        actions: [],
      },
      rescue: {
        eligible: true,
        used: options?.rescueUsed ?? false,
        reason: options?.rescueUsed
          ? "rescue_inventory_contributed_selected_exercises"
          : "rescue_not_requested",
        rescueOnlyCandidateCount: options?.rescueUsed ? 1 : 0,
        rescueOnlyExerciseIds: options?.rescueUsed ? ["rescue-press"] : [],
        selectedExerciseIds: options?.rescueUsed ? ["rescue-press"] : [],
      },
      outcome: {
        layersUsed,
        startingDeficits: {
          Chest: {
            weeklyTarget: 12,
            performedEffectiveVolumeBeforeSession: 4,
            plannedEffectiveVolume: 0,
            projectedEffectiveVolume: 4,
            remainingDeficit: 8,
          },
        },
        deficitsAfterBaseSession: {
          Chest: {
            weeklyTarget: 12,
            performedEffectiveVolumeBeforeSession: 4,
            plannedEffectiveVolume: 5,
            projectedEffectiveVolume: 9,
            remainingDeficit: 3,
          },
        },
        deficitsAfterSupplementation: {
          Chest: {
            weeklyTarget: 12,
            performedEffectiveVolumeBeforeSession: 4,
            plannedEffectiveVolume: 5,
            projectedEffectiveVolume: 9,
            remainingDeficit: 3,
          },
        },
        deficitsAfterClosure: {
          Chest: {
            weeklyTarget: 12,
            performedEffectiveVolumeBeforeSession: 4,
            plannedEffectiveVolume: 8,
            projectedEffectiveVolume: 12 - remainingDeficit,
            remainingDeficit,
          },
        },
        unresolvedDeficits: remainingDeficit > 0 ? ["Chest"] : [],
        keyTradeoffs: [
          {
            layer: "closure" as const,
            code: "closure_expand",
            message: "Bench Press won closure with expand (+1 set).",
            exerciseId: "bench-press",
          },
        ],
      },
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
  };
}

function buildRun(intent: "push" | "pull" | "legs", receiptOverrides?: Parameters<typeof buildReceipt>[0]): WorkoutAuditRun {
  return {
    context: {
      mode: "future-week",
      requestedMode: "future-week",
      userId: "user-1",
      ownerEmail: "owner@test.local",
      plannerDiagnosticsMode: "debug",
      generationInput: { intent },
    },
    generatedAt: "2026-03-08T18:00:00.000Z",
    generationResult: {
      workout: {
        id: `${intent}-workout`,
        scheduledDate: "2026-03-08",
        warmup: [],
        mainLifts: [
          {
            id: `${intent}-main`,
            exercise: {
              id: `${intent}-main-exercise`,
              name: `${intent} Main Lift`,
              movementPatterns: [],
              splitTags: [],
              jointStress: "low",
              equipment: [],
            },
            orderIndex: 0,
            isMainLift: true,
            sets: [{ setIndex: 0, targetReps: 8 }, { setIndex: 1, targetReps: 8 }],
          },
        ],
        accessories: [
          {
            id: `${intent}-accessory`,
            exercise: {
              id: `${intent}-accessory-exercise`,
              name: `${intent} Accessory`,
              movementPatterns: [],
              splitTags: [],
              jointStress: "low",
              equipment: [],
            },
            orderIndex: 1,
            isMainLift: false,
            sets: [{ setIndex: 0, targetReps: 12 }, { setIndex: 1, targetReps: 12 }],
          },
        ],
        estimatedMinutes: 55,
      },
      selectionMode: "INTENT" as const,
      sessionIntent: intent,
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      selection: {
        selectedExerciseIds: [`${intent}-main`, `${intent}-accessory`],
        mainLiftIds: [`${intent}-main`],
        accessoryIds: [`${intent}-accessory`],
        perExerciseSetTargets: {
          [`${intent}-main`]: 2,
          [`${intent}-accessory`]: 2,
        },
        rationale: {},
        volumePlanByMuscle: {},
        sessionDecisionReceipt: buildReceipt(receiptOverrides),
      },
    },
  };
}

describe("writeSplitSanityAuditArtifacts", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await mkdtemp(path.join(os.tmpdir(), "split-sanity-audit-"));

    mocks.resolveWorkoutAuditIdentity.mockResolvedValue({
      userId: "user-1",
      ownerEmail: "owner@test.local",
    });
    mocks.buildWorkoutAuditContext.mockImplementation(async (request) => ({
      mode: request.mode,
      userId: request.userId,
      ownerEmail: request.ownerEmail,
      plannerDiagnosticsMode: request.plannerDiagnosticsMode,
      generationInput: { intent: request.intent },
    }));
    mocks.loadActiveMesocycle.mockResolvedValue({
      id: "meso-1",
      mesoNumber: 1,
      focus: "Hypertrophy",
      splitType: "PPL",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      blocks: [],
    });
    mocks.loadGenerationPhaseBlockContext.mockResolvedValue({
      profile: {
        blockType: "accumulation",
        weekInBlock: 2,
        blockDurationWeeks: 4,
        isDeload: false,
      },
      cycleContext: {
        weekInMeso: 2,
        weekInBlock: 2,
        mesocycleLength: 5,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      weekInMeso: 2,
      weekInBlock: 2,
      mesocycleLength: 5,
      blockContext: null,
    });
    mocks.getRirTarget.mockReturnValue({ min: 2, max: 3 });
    mocks.getWeeklyVolumeTarget.mockImplementation((_meso, _muscle, week: number) => {
      if (week === 1) {
        return 10;
      }
      if (week === 2) {
        return 12;
      }
      return 14;
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes a compact summary artifact and optional rich artifacts without breaking rich audit serialization", async () => {
    const runs = [buildRun("push"), buildRun("pull"), buildRun("legs")];
    mocks.runWorkoutAuditGeneration
      .mockResolvedValueOnce(runs[0])
      .mockResolvedValueOnce(runs[1])
      .mockResolvedValueOnce(runs[2]);

    const result = await writeSplitSanityAuditArtifacts({
      request: {
        ownerEmail: "owner@test.local",
        intents: ["push", "pull", "legs"],
        plannerDiagnosticsMode: "debug",
      },
      outputDir: tempDir,
      writeRichArtifacts: true,
    });

    expect(result.artifact.overallVerdict).toBe("pass");
    expect(result.artifact.intentSummaries).toHaveLength(3);
    expect(result.artifact.verdictChecks.map((check) => check.code)).toEqual([
      "all_intents_generated",
      "cycle_context_present",
      "cycle_context_consistent",
      "lifecycle_rir_matches_block_profile",
      "accumulation_targets_do_not_drop",
      "no_stranded_zero_capacity_deficits",
      "rescue_not_used",
    ]);
    expect(Object.keys(result.richArtifactPaths)).toHaveLength(3);

    const summaryJson = JSON.parse(await readFile(result.summaryPath, "utf8")) as {
      intentSummaries: Array<{ sourceArtifactPath?: string }>;
      overallVerdict: string;
    };
    expect(summaryJson.overallVerdict).toBe("pass");
    expect(summaryJson.intentSummaries.every((summary) => typeof summary.sourceArtifactPath === "string")).toBe(
      true
    );

    const richArtifactPath = result.richArtifactPaths.push;
    expect(richArtifactPath).toBeTruthy();
    const richJson = JSON.parse(await readFile(richArtifactPath!, "utf8")) as {
      generation?: {
        selection?: {
          sessionDecisionReceipt?: {
            plannerDiagnostics?: unknown;
          };
        };
      };
    };
    expect(richJson.generation?.selection?.sessionDecisionReceipt?.plannerDiagnostics).toBeDefined();
  });

  it("downgrades same-intent zero-future-capacity deficits to a warning because week-close handles the fallback", async () => {
    mocks.runWorkoutAuditGeneration.mockResolvedValue(
      buildRun("push", {
        remainingDeficit: 3,
        futureCapacity: 0,
        requiredNow: 3,
      })
    );

    const result = await writeSplitSanityAuditArtifacts({
      request: {
        userId: "user-1",
        intents: ["push"],
        plannerDiagnosticsMode: "debug",
      },
      outputDir: tempDir,
    });

    expect(result.artifact.overallVerdict).toBe("pass");
    expect(result.artifact.failedChecks).not.toContain("no_stranded_zero_capacity_deficits");
    expect(
      result.artifact.verdictChecks.find((check) => check.code === "no_stranded_zero_capacity_deficits")
        ?.status
    ).toBe("warn");
    expect(result.artifact.strandedDeficits).toEqual([
      {
        intent: "push",
        muscle: "Chest",
        remainingDeficit: 3,
        futureCapacity: 0,
        requiredNow: 3,
      },
    ]);
    expect(result.artifact.warningSummary.semanticWarnings).toContain(
      "no_stranded_zero_capacity_deficits: Same-intent future capacity is exhausted for some muscles; unresolved deficits will rely on canonical week-close / optional gap-fill handling."
    );
  });

  it("normalizes split-sanity summaries and rich artifacts to the exposed muscle scope", async () => {
    const run = buildRun("push");
    if (!run.generationResult || "error" in run.generationResult) {
      throw new Error("expected successful generation result");
    }

    run.generationResult.selection.sessionDecisionReceipt = {
      ...buildReceipt(),
      targetMuscles: ["Abs", "Core"],
      lifecycleVolume: {
        targets: {
          Abs: 7,
          Core: 8,
        },
        source: "lifecycle",
      },
      plannerDiagnostics: {
        ...buildReceipt().plannerDiagnostics,
        opportunity: {
          ...buildReceipt().plannerDiagnostics!.opportunity!,
          targetMuscles: ["Abs", "Core"],
          currentSessionMuscleOpportunity: {
            Abs: {
              sessionOpportunityWeight: 1,
              weeklyTarget: 7,
              performedEffectiveVolumeBeforeSession: 1,
              startingDeficit: 6,
              weeklyOpportunityUnits: 1,
              futureOpportunityUnits: 1,
              futureCapacity: 1,
              requiredNow: 1,
              urgencyMultiplier: 1.1,
            },
            Core: {
              sessionOpportunityWeight: 2,
              weeklyTarget: 8,
              performedEffectiveVolumeBeforeSession: 2,
              startingDeficit: 6,
              weeklyOpportunityUnits: 2,
              futureOpportunityUnits: 2,
              futureCapacity: 2,
              requiredNow: 2,
              urgencyMultiplier: 1.4,
            },
          },
        },
        muscles: {
          Abs: {
            weeklyTarget: 7,
            performedEffectiveVolumeBeforeSession: 1,
            plannedEffectiveVolumeAfterRoleBudgeting: 2,
            projectedEffectiveVolumeAfterRoleBudgeting: 3,
            deficitAfterRoleBudgeting: 4,
            plannedEffectiveVolumeAfterClosure: 3,
            projectedEffectiveVolumeAfterClosure: 4,
            finalRemainingDeficit: 3,
          },
          Core: {
            weeklyTarget: 8,
            performedEffectiveVolumeBeforeSession: 2,
            plannedEffectiveVolumeAfterRoleBudgeting: 3,
            projectedEffectiveVolumeAfterRoleBudgeting: 4,
            deficitAfterRoleBudgeting: 4,
            plannedEffectiveVolumeAfterClosure: 4,
            projectedEffectiveVolumeAfterClosure: 5,
            finalRemainingDeficit: 3,
          },
        },
        exercises: {
          crunch: {
            exerciseId: "crunch",
            exerciseName: "Cable Crunch",
            assignedSetCount: 4,
            stimulusVector: {
              Abs: 2,
              Core: 1,
            },
            anchorUsed: {
              kind: "muscle",
              muscle: "abs",
            },
            isRoleFixture: false,
            isClosureAddition: false,
            isSetExpandedCarryover: false,
            closureSetDelta: 0,
          },
        },
        closure: {
          actions: [],
        },
        rescue: {
          eligible: false,
          used: false,
          reason: "not_needed",
          rescueOnlyCandidateCount: 0,
          rescueOnlyExerciseIds: [],
          selectedExerciseIds: [],
        },
        outcome: {
          layersUsed: ["anchor"],
          startingDeficits: {
            Abs: {
              weeklyTarget: 7,
              performedEffectiveVolumeBeforeSession: 1,
              plannedEffectiveVolume: 0,
              projectedEffectiveVolume: 1,
              remainingDeficit: 6,
            },
            Core: {
              weeklyTarget: 8,
              performedEffectiveVolumeBeforeSession: 2,
              plannedEffectiveVolume: 0,
              projectedEffectiveVolume: 2,
              remainingDeficit: 6,
            },
          },
          deficitsAfterBaseSession: {},
          deficitsAfterSupplementation: {},
          deficitsAfterClosure: {
            Abs: {
              weeklyTarget: 7,
              performedEffectiveVolumeBeforeSession: 1,
              plannedEffectiveVolume: 2,
              projectedEffectiveVolume: 3,
              remainingDeficit: 4,
            },
            Core: {
              weeklyTarget: 8,
              performedEffectiveVolumeBeforeSession: 2,
              plannedEffectiveVolume: 3,
              projectedEffectiveVolume: 4,
              remainingDeficit: 4,
            },
          },
          unresolvedDeficits: ["Abs", "Core"],
          keyTradeoffs: [
            {
              layer: "closure",
              code: "keep_core",
              message: "Core work preserved.",
              muscle: "Abs",
            },
          ],
        },
      },
    };

    mocks.runWorkoutAuditGeneration.mockResolvedValue(run);

    const result = await writeSplitSanityAuditArtifacts({
      request: {
        userId: "user-1",
        intents: ["push"],
        plannerDiagnosticsMode: "debug",
      },
      outputDir: tempDir,
      writeRichArtifacts: true,
    });

    expect(result.artifact.intentSummaries[0]?.targetedMuscles).toEqual(["Core"]);
    expect(result.artifact.intentSummaries[0]?.unresolvedDeficits).toEqual([
      {
        muscle: "Core",
        remainingDeficit: 8,
        weeklyTarget: 15,
        projectedEffectiveVolume: 7,
        futureCapacity: 3,
        requiredNow: 3,
      },
    ]);
    expect(result.artifact.weeklyTargetsSnapshot).toEqual([
      {
        muscle: "Core",
        currentTarget: 15,
        priorTarget: 10,
        deltaVsPrior: 5,
      },
    ]);

    const richArtifactPath = result.richArtifactPaths.push;
    expect(richArtifactPath).toBeTruthy();
    const richJson = JSON.parse(await readFile(richArtifactPath!, "utf8")) as {
      generation?: {
        selection?: {
          sessionDecisionReceipt?: {
            targetMuscles?: string[];
            lifecycleVolume?: { targets?: Record<string, number> };
            plannerDiagnostics?: {
              outcome?: {
                unresolvedDeficits?: string[];
              };
            };
          };
        };
      };
    };

    expect(richJson.generation?.selection?.sessionDecisionReceipt?.targetMuscles).toEqual([
      "Core",
    ]);
    expect(
      richJson.generation?.selection?.sessionDecisionReceipt?.lifecycleVolume?.targets
    ).toEqual({
      Core: 15,
    });
    expect(
      richJson.generation?.selection?.sessionDecisionReceipt?.plannerDiagnostics?.outcome
        ?.unresolvedDeficits
    ).toEqual(["Core"]);
  });
});
