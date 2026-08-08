import { describe, expect, it } from "vitest";
import type { WorkoutExercise, WorkoutPlan } from "@/lib/engine/types";
import { buildV2AcceptedPlannerIntentDto } from "@/lib/engine/planning/v2";
import {
  attachSessionAuditSnapshotToSelectionMetadata,
  buildGeneratedSessionAuditSnapshot,
} from "@/lib/evidence/session-audit-snapshot";
import {
  attachSessionCapacityReductionReconciliation,
} from "../runtime-edit-reconciliation";
import {
  applySessionCapacityReduction,
} from "../template-session/session-capacity-reduction";
import {
  fingerprintSessionCapacityExecutableRows,
  type SessionCapacityReductionManifest,
} from "@/lib/engine/planning/v2";
import { readRuntimeEditReconciliation } from "@/lib/ui/selection-metadata";
import { validateAndCanonicalizeShortTodaySave } from "./session-capacity";
import { extractSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import { parseSlotPlanSeedJson } from "../slot-plan-seed-parser";

function exercise(id: string, sets: number, main = false): WorkoutExercise {
  return {
    id,
    exercise: {
      id,
      name: id,
      movementPatterns: [],
      splitTags: [],
      jointStress: "low",
      equipment: [],
    },
    orderIndex: 0,
    isMainLift: main,
    role: main ? "main" : "accessory",
    sets: Array.from({ length: sets }, (_, index) => ({
      setIndex: index,
      targetReps: 10,
      targetRpe: 8,
    })),
  };
}

const workout: WorkoutPlan = {
  id: "workout-1",
  scheduledDate: "2026-07-25",
  warmup: [],
  mainLifts: [exercise("anchor", 3, true)],
  accessories: [
    exercise("optional", 3),
    exercise("biceps", 2),
    exercise("rear", 3),
    exercise("side", 3),
  ],
  estimatedMinutes: 50,
};
const seedSlots = [
  {
    slotId: "upper_b",
    exercises: [
      { exerciseId: "anchor", role: "CORE_COMPOUND" as const, setCount: 3 },
      { exerciseId: "optional", role: "ACCESSORY" as const, setCount: 3 },
      { exerciseId: "biceps", role: "ACCESSORY" as const, setCount: 2 },
      { exerciseId: "rear", role: "ACCESSORY" as const, setCount: 3 },
      { exerciseId: "side", role: "ACCESSORY" as const, setCount: 3 },
    ],
  },
];
const manifest: SessionCapacityReductionManifest = {
  version: 1,
  transformVersion: "short_today_v1",
  seedRevisionNumber: 1,
  executableRowsHash: fingerprintSessionCapacityExecutableRows(seedSlots),
  variants: [
    {
      week: 1,
      phase: "entry_calibration",
      slotId: "upper_b",
      rows: [
        ["anchor", 3, 3, "none", null],
        ["optional", 3, 0, "optional_top_up", 1],
        ["biceps", 2, 0, "preferred_surplus", 2],
        ["rear", 3, 2, "preferred_surplus", 3],
        ["side", 3, 3, "none", null],
      ].map(([exerciseId, planned, retained, omissionClass, yieldOrder]) => ({
        exerciseId: exerciseId as string,
        plannedSetCount: planned as number,
        shortSetCount: retained as number,
        omissionClass: omissionClass as
          | "none"
          | "optional_top_up"
          | "preferred_surplus",
        yieldOrder: yieldOrder as number | null,
        protectedClaims:
          exerciseId === "anchor"
            ? [{ kind: "primary_anchor" as const, minimumRetainedSetCount: 3 }]
            : [],
      })),
      sessionProtectionProof: {
        anchorsRetained: true,
        requiredRolesRetained: true,
        directFloorsRetained: true,
        exposureRowsRetained: true,
        minimumSessionValidityRetained: true,
      },
    },
  ],
};
const SEED_HASH = "f".repeat(64);

function receipt() {
  return {
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
      mesocycleId: "meso-1",
      compositionSource: "persisted_slot_plan_seed",
      seedProvenance: {
        revisionId: "revision-1",
        revision: 1,
        hash: SEED_HASH,
      },
    },
    sessionSlot: {
      slotId: "upper_b",
      intent: "upper",
      sequenceIndex: 2,
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
  };
}

function fixture() {
  const baseMetadata = { sessionDecisionReceipt: receipt() };
  const snapshot = buildGeneratedSessionAuditSnapshot({
    workout,
    selectionMode: "INTENT",
    sessionIntent: "upper",
    selectionMetadata: baseMetadata,
    advancesSplit: true,
  });
  const fullMetadata = attachSessionAuditSnapshotToSelectionMetadata(
    baseMetadata,
    snapshot,
  );
  const reduction = applySessionCapacityReduction({
    plannedWorkout: workout,
    acceptedReductionManifest: manifest,
    mode: "short_today",
    week: 1,
    slotId: "upper_b",
    isAccumulationPrimary: true,
    seedRevision: {
      id: "revision-1",
      revision: 1,
      payloadHash: SEED_HASH,
    },
    executableSeedSlots: seedSlots,
  });
  if (reduction.status !== "applied") {
    throw new Error("fixture reduction unavailable");
  }
  const selectionMetadata = attachSessionCapacityReductionReconciliation({
    selectionMetadata: fullMetadata,
    evidence: reduction.evidence,
    appliedAt: "2026-07-25T12:00:00.000Z",
  });
  const acceptedPlannerIntent = {
    ...buildV2AcceptedPlannerIntentDto(),
    sessionCapacityReductionManifest: manifest,
  };
  const activeMesocycle = {
    id: "meso-1",
    state: "ACTIVE_ACCUMULATION",
    slotPlanSeedJson: {
      version: 1,
      source: "v2_materialized_seed",
      acceptedPlannerIntent,
      slots: seedSlots,
    },
    currentSeedRevision: {
      id: "revision-1",
      revision: 1,
      payloadHash: SEED_HASH,
      seedPayload: {
        version: 1,
        source: "v2_materialized_seed",
        slots: seedSlots,
      },
    },
  };
  const exercises = [
    ...reduction.workout.mainLifts.map((row) => ({
      section: "MAIN" as const,
      exerciseId: row.exercise.id,
      sets: row.sets,
    })),
    ...reduction.workout.accessories.map((row) => ({
      section: "ACCESSORY" as const,
      exerciseId: row.exercise.id,
      sets: row.sets,
    })),
  ];
  return { selectionMetadata, activeMesocycle, exercises, reduction };
}

describe("validateAndCanonicalizeShortTodaySave", () => {
  it("recomputes and canonicalizes the exact offered fingerprint", () => {
    const input = fixture();
    expect(extractSessionDecisionReceipt(input.selectionMetadata)).toMatchObject({
      sessionProvenance: {
        compositionSource: "persisted_slot_plan_seed",
        seedProvenance: {
          revisionId: "revision-1",
          revision: 1,
          hash: SEED_HASH,
        },
      },
      sessionSlot: { slotId: "upper_b" },
    });
    expect(
      parseSlotPlanSeedJson(input.activeMesocycle.slotPlanSeedJson)
        ?.acceptedPlannerIntent?.sessionCapacityReductionManifest,
    ).toBeDefined();
    expect(
      parseSlotPlanSeedJson(input.activeMesocycle.currentSeedRevision.seedPayload),
    ).not.toBeNull();
    const metadata = validateAndCanonicalizeShortTodaySave({
      workoutId: "workout-1",
      selectionMetadata: input.selectionMetadata,
      exercises: input.exercises,
      activeMesocycle: input.activeMesocycle,
    });
    const operations = readRuntimeEditReconciliation(metadata)?.ops.filter(
      (operation) => operation.kind === "reduce_session_capacity",
    );
    expect(operations).toHaveLength(1);
    expect(operations?.[0]).toMatchObject({
      facts: {
        offeredStructureFingerprint:
          input.reduction.evidence.offeredStructureFingerprint,
      },
    });
  });

  it("rejects altered client structure and corrected revisions without evidence", () => {
    const input = fixture();
    expect(() =>
      validateAndCanonicalizeShortTodaySave({
        workoutId: "workout-1",
        selectionMetadata: input.selectionMetadata,
        exercises: input.exercises.slice(0, 2),
        activeMesocycle: input.activeMesocycle,
      }),
    ).toThrow("SESSION_CAPACITY_REDUCTION_INVALID");
    expect(() =>
      validateAndCanonicalizeShortTodaySave({
        workoutId: "workout-1",
        selectionMetadata: input.selectionMetadata,
        exercises: input.exercises,
        activeMesocycle: {
          ...input.activeMesocycle,
          currentSeedRevision: {
            ...input.activeMesocycle.currentSeedRevision,
            id: "revision-2",
            revision: 2,
          },
        },
      }),
    ).toThrow("SESSION_CAPACITY_REDUCTION_UNAVAILABLE");
  });

  it("rejects an executable projection masquerading as the current accepted revision", () => {
    const input = fixture();
    input.activeMesocycle.currentSeedRevision.seedPayload = {
      version: 2,
      slots: seedSlots.map((slot) => ({
        ...slot,
        exercises: slot.exercises.map((row) => ({
          ...row,
          measurement: {
            profile: "REPS_EXTERNAL_LOAD" as const,
            loadConvention: "MACHINE_DISPLAYED" as const,
            repBasis: "TOTAL" as const,
          },
        })),
      })),
    } as unknown as typeof input.activeMesocycle.currentSeedRevision.seedPayload;

    expect(
      parseSlotPlanSeedJson(input.activeMesocycle.currentSeedRevision.seedPayload),
    ).not.toBeNull();
    expect(() =>
      validateAndCanonicalizeShortTodaySave({
        workoutId: "workout-1",
        selectionMetadata: input.selectionMetadata,
        exercises: input.exercises,
        activeMesocycle: input.activeMesocycle,
      }),
    ).toThrowError("ACCEPTED_SEED_MALFORMED:2");
  });
});
