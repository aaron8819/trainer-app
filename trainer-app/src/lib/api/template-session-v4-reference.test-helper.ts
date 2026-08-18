import { expect } from "vitest";
import type { Exercise, WorkoutPlan } from "@/lib/engine/types";
import type { AcceptedHypertrophySeedV4 } from "@/lib/engine/hypertrophy-plan-authoring";
import type { SessionDecisionReceipt } from "@/lib/evidence/types";

type MockController = {
  mockReturnValue(value: unknown): unknown;
  mockResolvedValue(value: unknown): unknown;
};

export type V4ReferenceHarnessMocks = {
  mapExercises: MockController;
  mapConstraints: MockController;
  loadWorkoutContext: MockController;
  getCurrentMesoWeek: MockController;
  loadGenerationPhaseBlockContext: MockController;
};

export type V4ReferenceRuntimeCase = {
  week: number;
  phase: "accumulation" | "deload";
  slotId: string;
  focus: string;
  sequenceIndex: number;
  sequenceLength: number;
  exerciseCount: number;
  exercises: Array<{
    placementId: string;
    exerciseId: string;
    setCount: number;
    sets: Array<{
      reps: number | { min: number; max: number } | undefined;
      targetRpe: number | undefined;
    }>;
    measurement: unknown;
  }>;
  omittedPlacementIds: string[];
  provenance: {
    revisionId: string;
    revision: number;
    hash: string;
  } | undefined;
  composition: {
    source: string | undefined;
    warmup: unknown[];
    hasWarmupSets: boolean;
    hasHipFlexorPreparation: boolean;
    hasFinisherComposition: boolean;
    selectionFallbackUsed: boolean;
  };
};

type SuccessfulIntentSession = {
  workout: WorkoutPlan;
  selection: {
    sessionDecisionReceipt?: SessionDecisionReceipt;
  };
  finisher?: unknown;
};

function buildStimulusProfile(
  primaryMuscleId: "chest" | "quads",
): Exercise["stimulusProfile"] {
  return { [primaryMuscleId]: 1 } as Exercise["stimulusProfile"];
}

function makeReferenceExercise(input: {
  id: string;
  movementPatterns: Exercise["movementPatterns"];
  splitTags: Exercise["splitTags"];
  primaryMuscles: string[];
  primaryMuscleId: "chest" | "quads";
  isMainLiftEligible: boolean;
  isCompound: boolean;
}): Exercise {
  return {
    id: input.id,
    name: input.id,
    movementPatterns: input.movementPatterns,
    splitTags: input.splitTags,
    jointStress: "medium",
    isMainLiftEligible: input.isMainLiftEligible,
    isCompound: input.isCompound,
    fatigueCost: 3,
    equipment: ["machine"],
    primaryMuscles: input.primaryMuscles,
    secondaryMuscles: [],
    stimulusProfile: buildStimulusProfile(input.primaryMuscleId),
    sfrScore: 4,
    lengthPositionScore: 3,
  };
}

export function buildV4ReferenceExerciseLibrary(
  seed: AcceptedHypertrophySeedV4,
): Exercise[] {
  const exerciseById = new Map<string, Exercise>();
  for (const slot of seed.slots) {
    for (const exercise of slot.exercises) {
      if (exerciseById.has(exercise.exerciseId)) continue;
      const target = exercise.intent.target;
      exerciseById.set(exercise.exerciseId, makeReferenceExercise({
        id: exercise.exerciseId,
        movementPatterns: target.kind === "movement_pattern"
          ? [target.movementPattern]
          : ["isolation"],
        splitTags: slot.focus === "LOWER" ? ["legs"] : ["push"],
        primaryMuscles: [slot.focus === "LOWER" ? "Quads" : "Chest"],
        primaryMuscleId: slot.focus === "LOWER" ? "quads" : "chest",
        isMainLiftEligible: exercise.role === "CORE_COMPOUND",
        isCompound: exercise.role === "CORE_COMPOUND",
      }));
    }
  }
  return [...exerciseById.values()];
}

export function primeV4ReferenceGeneration(
  seed: AcceptedHypertrophySeedV4,
  library: Exercise[],
  mocks: V4ReferenceHarnessMocks,
) {
  mocks.mapExercises.mockReturnValue(library);
  mocks.mapConstraints.mockReturnValue({
    daysPerWeek: 4,
    splitType: "upper_lower",
    weeklySchedule: ["upper", "lower", "upper", "lower"],
  });
  mocks.loadWorkoutContext.mockResolvedValue({
    profile: { id: "profile" },
    goals: { primaryGoal: "HYPERTROPHY", secondaryGoal: "NONE" },
    constraints: {
      daysPerWeek: 4,
      splitType: "UPPER_LOWER",
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
    },
    injuries: [],
    exercises: library.map((exercise) => ({ id: exercise.id })),
    workouts: [],
    preferences: null,
    checkIns: [],
  });
  return {
    version: 1 as const,
    source: "handoff_draft" as const,
    sequenceMode: "ordered_flexible" as const,
    slots: seed.slots.map((slot) => ({
      slotId: slot.slotId,
      intent: slot.focus,
    })),
  };
}

export function primeV4ReferenceWeek(
  expected: V4ReferenceRuntimeCase,
  mocks: V4ReferenceHarnessMocks,
) {
  const isDeload = expected.phase === "deload";
  mocks.getCurrentMesoWeek.mockReturnValue(expected.week);
  mocks.loadGenerationPhaseBlockContext.mockResolvedValue({
    blockContext: {
      block: {
        id: `block-${expected.week}`,
        mesocycleId: "meso-1",
        blockNumber: 1,
        blockType: expected.phase,
        startWeek: 0,
        durationWeeks: 5,
        volumeTarget: "high",
        intensityBias: "hypertrophy",
        adaptationType: "myofibrillar_hypertrophy",
      },
      weekInBlock: expected.week,
      weekInMeso: expected.week,
      weekInMacro: expected.week,
      mesocycle: {
        id: "meso-1",
        macroCycleId: "macro-1",
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 5,
        focus: "Hypertrophy",
        volumeTarget: "high",
        intensityBias: "hypertrophy",
        blocks: [],
      },
      macroCycle: {
        id: "macro-1",
        userId: "user-1",
        startDate: new Date("2026-03-01T00:00:00.000Z"),
        endDate: new Date("2026-04-05T00:00:00.000Z"),
        durationWeeks: 5,
        trainingAge: "intermediate",
        primaryGoal: "hypertrophy",
        mesocycles: [],
      },
    },
    profile: {
      blockType: expected.phase,
      weekInBlock: expected.week,
      blockDurationWeeks: 5,
      isDeload,
    },
    cycleContext: {
      weekInMeso: expected.week,
      weekInBlock: expected.week,
      mesocycleLength: 5,
      phase: expected.phase,
      blockType: expected.phase,
      isDeload,
      source: "computed",
    },
    weekInMeso: expected.week,
    weekInBlock: expected.week,
    mesocycleLength: 5,
  });
}

export function buildV4ReferenceMesocycle(
  expected: V4ReferenceRuntimeCase,
  seed: AcceptedHypertrophySeedV4,
  slotSequenceJson: ReturnType<typeof primeV4ReferenceGeneration>,
  provenance: { revisionId: string; hash: string },
) {
  return {
    id: "meso-1",
    state: expected.phase === "deload" ? "ACTIVE_DELOAD" : "ACTIVE_ACCUMULATION",
    accumulationSessionsCompleted: expected.phase === "deload"
      ? 16
      : (expected.week - 1) * 4 + expected.sequenceIndex,
    deloadSessionsCompleted: expected.phase === "deload" ? expected.sequenceIndex : 0,
    durationWeeks: 5,
    sessionsPerWeek: 4,
    slotSequenceJson,
    slotPlanSeedJson: { version: 1, source: "handoff_slot_plan_projection", slots: [] },
    currentSeedRevision: {
      id: provenance.revisionId,
      revision: 1,
      payloadHash: provenance.hash,
      hashAlgorithm: "sha256",
      provenanceStatus: "exact",
      seedPayload: seed,
    },
  };
}

export function buildActualV4ReferenceCase(input: {
  week: number;
  slotId: string;
  seed: AcceptedHypertrophySeedV4;
  result: SuccessfulIntentSession;
  selectionFallbackUsed: boolean;
}): V4ReferenceRuntimeCase {
  const matchingWeeks = input.seed.weeks.filter((week) => week.week === input.week);
  if (matchingWeeks.length !== 1) {
    throw new Error(`Expected exactly one authored week ${input.week}`);
  }
  const matchingSlots = input.seed.slots.filter((slot) => slot.slotId === input.slotId);
  if (matchingSlots.length !== 1) {
    throw new Error(`Expected exactly one authored slot ${input.slotId}`);
  }
  const selectedSlot = matchingSlots[0]!;
  const placementIds = new Set<string>();
  for (const placement of selectedSlot.exercises) {
    if (placementIds.has(placement.placementId)) {
      throw new Error(`Duplicate authored placement ID ${placement.placementId}`);
    }
    placementIds.add(placement.placementId);
  }

  const prescribedPlacements: typeof selectedSlot.exercises = [];
  const omittedPlacementIds: string[] = [];
  for (const placement of selectedSlot.exercises) {
    const matchingPrescriptions = placement.prescriptions.filter(
      (prescription) => prescription.week === input.week,
    );
    if (matchingPrescriptions.length !== 1) {
      throw new Error(
        `Expected exactly one authored prescription for ${placement.placementId} week ${input.week}`,
      );
    }
    const status: unknown = matchingPrescriptions[0]!.status;
    switch (status) {
      case "PRESCRIBE":
        prescribedPlacements.push(placement);
        break;
      case "OMIT":
        omittedPlacementIds.push(placement.placementId);
        break;
      default:
        throw new Error(
          `Unexpected authored prescription status for ${placement.placementId} week ${input.week}: ${String(status)}`,
        );
    }
  }

  const receipt = input.result.selection.sessionDecisionReceipt;
  if (!receipt) throw new Error("Missing session decision receipt");
  if (
    receipt.cycleContext.phase !== "accumulation" &&
    receipt.cycleContext.phase !== "deload"
  ) {
    throw new Error(`Unexpected V4 reference phase ${receipt.cycleContext.phase}`);
  }
  const generatedWorkout = [
    ...input.result.workout.mainLifts,
    ...input.result.workout.accessories,
  ];
  const orderIndexes = generatedWorkout.map((exercise) => exercise.orderIndex);
  if (new Set(orderIndexes).size !== orderIndexes.length) {
    throw new Error("Generated runtime exercises have duplicate order indexes");
  }
  const orderedWorkout = [...generatedWorkout].sort(
    (left, right) => left.orderIndex - right.orderIndex,
  );
  for (let index = 0; index < orderedWorkout.length; index += 1) {
    if (orderedWorkout[index]!.orderIndex !== index) {
      throw new Error("Generated runtime exercise order indexes are not contiguous");
    }
  }

  return {
    week: receipt.cycleContext.weekInMeso,
    phase: receipt.cycleContext.phase,
    slotId: receipt.sessionSlot?.slotId ?? "",
    focus: receipt.sessionSlot?.intent ?? "",
    sequenceIndex: receipt.sessionSlot?.sequenceIndex ?? -1,
    sequenceLength: receipt.sessionSlot?.sequenceLength ?? -1,
    exerciseCount: orderedWorkout.length,
    exercises: orderedWorkout.map((exercise, index) => ({
      placementId: prescribedPlacements[index]?.placementId ?? "",
      exerciseId: exercise.exercise.id,
      setCount: exercise.sets.length,
      sets: exercise.sets.map((set) => ({
        reps: set.targetRepRange ?? set.targetReps,
        targetRpe: set.targetRpe,
      })),
      measurement: exercise.measurement,
    })),
    omittedPlacementIds,
    provenance: receipt.sessionProvenance?.seedProvenance,
    composition: {
      source: receipt.sessionProvenance?.compositionSource,
      warmup: input.result.workout.warmup,
      hasWarmupSets: orderedWorkout.some((exercise) => "warmupSets" in exercise),
      hasHipFlexorPreparation: orderedWorkout.some((exercise) =>
        /hip[-_ ]flexor/i.test(exercise.exercise.id),
      ),
      hasFinisherComposition:
        "finisher" in input.result || "finisher" in input.result.workout,
      selectionFallbackUsed: input.selectionFallbackUsed,
    },
  };
}

export function assertV4ReferenceCase(
  actual: V4ReferenceRuntimeCase,
  expected: V4ReferenceRuntimeCase,
  label: string,
) {
  expect(actual, label).toEqual(expected);
}
