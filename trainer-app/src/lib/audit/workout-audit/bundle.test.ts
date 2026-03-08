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
      mode: "intent-preview",
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

  it("fails the bundled verdict when a same-intent deficit remains stranded at zero future capacity", async () => {
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

    expect(result.artifact.overallVerdict).toBe("fail");
    expect(result.artifact.failedChecks).toContain("no_stranded_zero_capacity_deficits");
    expect(result.artifact.strandedDeficits).toEqual([
      {
        intent: "push",
        muscle: "Chest",
        remainingDeficit: 3,
        futureCapacity: 0,
        requiredNow: 3,
      },
    ]);
  });
});
