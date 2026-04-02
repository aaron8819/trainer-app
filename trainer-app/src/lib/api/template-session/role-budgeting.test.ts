import { describe, expect, it } from "vitest";

import type { Exercise } from "@/lib/engine/types";
import type { MappedGenerationContext } from "./types";
import { buildSelectionObjective } from "./selection-adapter";
import {
  buildRemainingRoleFixturesByAnchor,
  resolveSlotAwareRoleMap,
  resolveRoleFixtureSetTarget,
} from "./role-budgeting";

function makeExercise(
  id: string,
  name: string,
  primaryMuscles: string[],
  secondaryMuscles: string[] = []
): Exercise {
  return {
    id,
    name,
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "medium",
    isMainLiftEligible: true,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["machine"],
    primaryMuscles,
    secondaryMuscles,
    sfrScore: 3,
    lengthPositionScore: 3,
  };
}

function makeMappedContext(
  weeklySchedule: MappedGenerationContext["mappedConstraints"]["weeklySchedule"]
): MappedGenerationContext {
  const exerciseLibrary = [
    makeExercise("chest-press", "Chest Press", ["Chest"], ["Front Delts", "Triceps"]),
  ];

  return {
    mappedProfile: {
      id: "user-1",
      trainingAge: "intermediate",
      injuries: [],
      weightKg: 80,
    },
    mappedGoals: {
      primary: "hypertrophy",
      secondary: "none",
      isHypertrophyFocused: true,
      isStrengthFocused: false,
    },
    mappedConstraints: {
      daysPerWeek: weeklySchedule.length,
      splitType: "ppl",
      weeklySchedule,
    },
    mappedCheckIn: undefined,
    mappedPreferences: undefined,
    exerciseLibrary: exerciseLibrary as MappedGenerationContext["exerciseLibrary"],
    history: [],
    rawExercises: [],
    rawWorkouts: [],
    weekInBlock: 4,
    lifecycleWeek: 4,
    lifecycleRirTarget: { min: 1, max: 2 },
    lifecycleVolumeTargets: {
      Chest: 16,
      "Front Delts": 7,
      Triceps: 10,
    },
    sorenessSuppressedMuscles: [],
    activeMesocycle: null,
    mesocycleLength: 5,
    effectivePeriodization: {
      setMultiplier: 1.15,
      rpeOffset: 0,
      isDeload: false,
      backOffMultiplier: 0.9,
      lifecycleSetTargets: { main: 5, accessory: 4 },
    },
    adaptiveDeload: false,
    deloadDecision: {
      mode: "none",
      reason: [],
      reductionPercent: 0,
      appliedTo: "none",
    },
    blockContext: null,
    rotationContext: new Map(),
    cycleContext: {
      weekInMeso: 4,
      weekInBlock: 4,
      phase: "accumulation",
      blockType: "accumulation",
      isDeload: false,
      source: "computed",
    },
    mesocycleRoleMapByIntent: {
      push: new Map([["chest-press", "CORE_COMPOUND"]]),
      pull: new Map(),
      legs: new Map(),
      upper: new Map(),
      lower: new Map(),
      full_body: new Map(),
      body_part: new Map(),
    },
  };
}

describe("role budgeting with remaining-week planning", () => {
  it("de-risks closable-later chest volume when another push slot remains this week", () => {
    const exercise = makeExercise("chest-press", "Chest Press", ["Chest"], ["Front Delts", "Triceps"]);
    const exerciseById = new Map([[exercise.id, exercise]]);
    const roleMap = new Map([[exercise.id, "CORE_COMPOUND" as const]]);

    const scarceObjective = buildSelectionObjective(
      makeMappedContext(["push", "legs", "pull"]),
      "push"
    );
    scarceObjective.volumeContext.effectiveActual.set("Chest", 10);
    scarceObjective.volumeContext.remainingWeek = {
      futureSlots: ["legs", "pull"],
      futureSlotCounts: new Map([
        ["legs", 1],
        ["pull", 1],
      ]),
      futureCapacityFactor: 1,
      futureCapacity: new Map([["Chest", 0]]),
      requiredNow: new Map([["Chest", 6]]),
      urgency: new Map([["Chest", 2.5]]),
    };
    const scarceDecision = resolveRoleFixtureSetTarget(
      exercise,
      exercise.id,
      5,
      scarceObjective,
      "push",
      false,
      { Chest: 16, "Front Delts": 7, Triceps: 10 },
      new Map(),
      buildRemainingRoleFixturesByAnchor([exercise.id], exerciseById, roleMap, scarceObjective, "push"),
      "CORE_COMPOUND"
    );

    const closableLaterObjective = buildSelectionObjective(
      makeMappedContext(["push", "legs", "push"]),
      "push"
    );
    closableLaterObjective.volumeContext.effectiveActual.set("Chest", 10);
    closableLaterObjective.volumeContext.remainingWeek = {
      futureSlots: ["legs", "push"],
      futureSlotCounts: new Map([
        ["legs", 1],
        ["push", 1],
      ]),
      futureCapacityFactor: 1,
      futureCapacity: new Map([["Chest", 8]]),
      requiredNow: new Map([["Chest", 0]]),
      urgency: new Map([["Chest", 1]]),
    };
    const closableLaterDecision = resolveRoleFixtureSetTarget(
      exercise,
      exercise.id,
      5,
      closableLaterObjective,
      "push",
      false,
      { Chest: 16, "Front Delts": 7, Triceps: 10 },
      new Map(),
      buildRemainingRoleFixturesByAnchor(
        [exercise.id],
        exerciseById,
        roleMap,
        closableLaterObjective,
        "push"
      ),
      "CORE_COMPOUND"
    );

    expect(closableLaterDecision.plannedSets).toBeLessThan(scarceDecision.plannedSets);
    expect(scarceDecision.plannedSets).toBe(5);
    expect(closableLaterDecision.plannedSets).toBe(2);
  });

  it("subordinates out-of-lane core compound roles when viable in-lane alternatives exist", () => {
    const mapped = makeMappedContext(["upper", "lower", "upper", "lower"]);
    const bench: Exercise = {
      ...makeExercise("bench", "Bench Press", ["Chest"], ["Front Delts", "Triceps"]),
      movementPatterns: ["horizontal_push"],
      splitTags: ["push"],
    };
    const row: Exercise = {
      ...makeExercise("row", "Chest Supported Row", ["Lats", "Upper Back"], ["Biceps"]),
      movementPatterns: ["horizontal_pull"],
      splitTags: ["pull"],
    };
    const ohp: Exercise = {
      ...makeExercise("ohp", "Overhead Press", ["Chest", "Front Delts"], ["Triceps"]),
      movementPatterns: ["vertical_push"],
      splitTags: ["push"],
    };
    const pulldown: Exercise = {
      ...makeExercise("pulldown", "Lat Pulldown", ["Lats"], ["Biceps"]),
      movementPatterns: ["vertical_pull"],
      splitTags: ["pull"],
    };
    mapped.exerciseLibrary = [bench, row, ohp, pulldown] as MappedGenerationContext["exerciseLibrary"];
    mapped.mappedConstraints.splitType = "upper_lower";
    mapped.activeMesocycle = {
      id: "meso-1",
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
    } as unknown as MappedGenerationContext["activeMesocycle"];
    mapped.mesocycleRoleMapByIntent.upper = new Map([
      ["bench", "CORE_COMPOUND"],
      ["row", "CORE_COMPOUND"],
    ]);

    const objective = buildSelectionObjective(mapped, "upper", undefined, {
      sessionSlotId: "upper_b",
    });
    const effectiveRoleMap = resolveSlotAwareRoleMap({
      roleMap: mapped.mesocycleRoleMapByIntent.upper,
      exerciseById: new Map(
        mapped.exerciseLibrary.map((exercise) => [exercise.id, exercise as Exercise])
      ),
      candidatePool: mapped.exerciseLibrary as Exercise[],
      objective,
    });

    expect(effectiveRoleMap.has("bench")).toBe(false);
    expect(effectiveRoleMap.has("row")).toBe(false);
  });

  it("keeps preferred upper support accessories meaningful when a later upper slot still exists", () => {
    const mapped = makeMappedContext(["upper", "lower", "upper", "lower"]);
    mapped.mappedConstraints.splitType = "upper_lower";
    mapped.activeMesocycle = {
      id: "meso-1",
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
    } as unknown as MappedGenerationContext["activeMesocycle"];
    mapped.lifecycleVolumeTargets = {
      ...mapped.lifecycleVolumeTargets,
      Chest: 12,
      Triceps: 10,
      Lats: 12,
    };

    const cableFly: Exercise = {
      ...makeExercise("cable-fly", "Cable Fly", ["Chest"]),
      movementPatterns: ["isolation"],
      splitTags: ["push"],
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
    };
    const pulldown: Exercise = {
      ...makeExercise("lat-pulldown", "Lat Pulldown", ["Lats"], ["Biceps"]),
      movementPatterns: ["vertical_pull"],
      splitTags: ["pull"],
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 2,
    };
    mapped.exerciseLibrary = [cableFly, pulldown] as MappedGenerationContext["exerciseLibrary"];

    const preferredObjective = buildSelectionObjective(mapped, "upper", undefined, {
      sessionSlotId: "upper_a",
    });
    preferredObjective.volumeContext.effectiveActual.set("Chest", 8);
    preferredObjective.volumeContext.effectiveActual.set("Lats", 8);
    preferredObjective.volumeContext.remainingWeek = {
      futureSlots: ["lower", "upper", "lower"],
      futureSlotCounts: new Map([
        ["lower", 2],
        ["upper", 1],
      ]),
      futureCapacityFactor: 1,
      futureCapacity: new Map([
        ["Chest", 6],
        ["Lats", 6],
      ]),
      requiredNow: new Map([
        ["Chest", 0],
        ["Lats", 0],
      ]),
      urgency: new Map([
        ["Chest", 1],
        ["Lats", 1],
      ]),
    };

    const preferredRoleMap = new Map([[cableFly.id, "ACCESSORY" as const]]);
    const genericRoleMap = new Map([[pulldown.id, "ACCESSORY" as const]]);
    const preferredDecision = resolveRoleFixtureSetTarget(
      cableFly,
      cableFly.id,
      4,
      preferredObjective,
      "upper",
      false,
      { Chest: 12, Triceps: 10, Lats: 12 },
      new Map(),
      buildRemainingRoleFixturesByAnchor(
        [cableFly.id],
        new Map([[cableFly.id, cableFly]]),
        preferredRoleMap,
        preferredObjective,
        "upper"
      ),
      "ACCESSORY"
    );
    const nonPreferredDecision = resolveRoleFixtureSetTarget(
      pulldown,
      pulldown.id,
      4,
      preferredObjective,
      "upper",
      false,
      { Chest: 12, Triceps: 10, Lats: 12 },
      new Map(),
      buildRemainingRoleFixturesByAnchor(
        [pulldown.id],
        new Map([[pulldown.id, pulldown]]),
        genericRoleMap,
        preferredObjective,
        "upper"
      ),
      "ACCESSORY"
    );

    expect(preferredDecision.plannedSets).toBe(2);
    expect(nonPreferredDecision.plannedSets).toBe(1);
    expect(preferredDecision.plannedSets).toBeGreaterThan(nonPreferredDecision.plannedSets);
  });
});
