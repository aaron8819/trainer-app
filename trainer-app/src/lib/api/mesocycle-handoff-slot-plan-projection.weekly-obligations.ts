import type { WorkoutSessionIntent } from "@prisma/client";
import type { WorkoutPlan } from "@/lib/engine/types";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import {
  getProjectionRepairCompatibleMuscles,
  getProtectedWeekOneCoverageObligations,
  resolveSessionSlotPolicy,
  type ProtectedWeekOneCoverageMuscle,
} from "@/lib/planning/session-slot-profile";
import { getWeeklyVolumeTarget } from "./mesocycle-lifecycle";
import type { MappedGenerationContext } from "./template-session/types";
import type { MesocycleSlotSequence } from "./mesocycle-slot-contract";
import type { ProjectedSlotWorkout } from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import {
  buildSlotSequenceEntries,
  computeWorkoutContributionByMuscle,
  getWorkoutExercises,
  roundToTenth,
  toSessionIntent,
} from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";

export const HARD_WEEKLY_OBLIGATION_MUSCLES = [
  "Chest",
  "Lats",
  "Quads",
  "Hamstrings",
] as const satisfies readonly ProtectedWeekOneCoverageMuscle[];

export type HardWeeklyObligationMuscle = (typeof HARD_WEEKLY_OBLIGATION_MUSCLES)[number];

export type WeeklyMuscleObligationPlan = {
  muscles: Record<
    HardWeeklyObligationMuscle,
    {
      targetSets: number;
      allocatedSlots: Array<{
        slotId: string;
        minEffectiveSets: number;
        priority: "primary" | "secondary";
      }>;
    }
  >;
};

export type SlotObligationEvaluation = {
  slotId: string;
  muscle: HardWeeklyObligationMuscle;
  minEffectiveSets: number;
  projectedEffectiveSets: number;
  shortfall: number;
  zeroContribution: boolean;
};

export type DuplicateExerciseReuseDiagnostic = {
  exerciseId: string;
  name: string;
  repeatedInSlotId: string;
  previousSlotIds: string[];
  role: "main" | "accessory";
  hasCompatibleAlternative: boolean;
  reason: "main_lift_continuity_allowed" | "accessory_repeat_discouraged" | "limited_inventory";
};

type SlotSequenceEntries = ReturnType<typeof buildSlotSequenceEntries>;

function normalizeMuscleName(muscle: string): string {
  return muscle.trim().toLowerCase();
}

function getSlotPolicy(input: {
  slotId: string;
  intent: WorkoutSessionIntent;
  slotSequenceEntries: SlotSequenceEntries;
}) {
  return resolveSessionSlotPolicy({
    sessionIntent: toSessionIntent(input.intent),
    slotId: input.slotId,
    slotSequence: {
      slots: input.slotSequenceEntries,
    },
  }).currentSession;
}

function isPrimaryObligationSlot(input: {
  muscle: HardWeeklyObligationMuscle;
  slotPolicy: ReturnType<typeof resolveSessionSlotPolicy>["currentSession"];
}): boolean {
  const protectedMuscles = getProtectedWeekOneCoverageObligations(input.slotPolicy).map(
    normalizeMuscleName
  );
  if (protectedMuscles.includes(normalizeMuscleName(input.muscle))) {
    return true;
  }

  const preferredPrimaryMuscles =
    input.slotPolicy?.compoundBias?.preferredPrimaryMuscles?.map(normalizeMuscleName) ?? [];
  return preferredPrimaryMuscles.includes(normalizeMuscleName(input.muscle));
}

export function buildWeeklyMuscleObligationPlan(input: {
  activeMesocycle: NonNullable<MappedGenerationContext["activeMesocycle"]>;
  slotSequence: ReadonlyArray<{
    slotId: string;
    intent: WorkoutSessionIntent;
    authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
  }>;
  slotSequenceEntries: SlotSequenceEntries;
}): WeeklyMuscleObligationPlan {
  const muscles = Object.fromEntries(
    HARD_WEEKLY_OBLIGATION_MUSCLES.map((muscle) => {
      const compatibleSlots = input.slotSequence.flatMap((slot) => {
        const slotPolicy = getSlotPolicy({
          slotId: slot.slotId,
          intent: slot.intent,
          slotSequenceEntries: input.slotSequenceEntries,
        });
        const compatible = getProjectionRepairCompatibleMuscles(slotPolicy, [muscle]).includes(
          muscle
        );
        if (!compatible) {
          return [];
        }
        return [{ slot, slotPolicy }];
      });
      const targetSets = getWeeklyVolumeTarget(input.activeMesocycle, muscle, 1);
      const perSlotFloor =
        compatibleSlots.length > 0 ? targetSets / compatibleSlots.length : targetSets;

      return [
        muscle,
        {
          targetSets,
          allocatedSlots: compatibleSlots.map(({ slot, slotPolicy }) => ({
            slotId: slot.slotId,
            minEffectiveSets: roundToTenth(perSlotFloor),
            priority: isPrimaryObligationSlot({ muscle, slotPolicy })
              ? ("primary" as const)
              : ("secondary" as const),
          })),
        },
      ];
    })
  ) as WeeklyMuscleObligationPlan["muscles"];

  return { muscles };
}

export function getSlotWeeklyObligations(input: {
  plan: WeeklyMuscleObligationPlan;
  slotId: string;
}): Array<{
  muscle: HardWeeklyObligationMuscle;
  minEffectiveSets: number;
  priority: "primary" | "secondary";
}> {
  return HARD_WEEKLY_OBLIGATION_MUSCLES.flatMap((muscle) => {
    const slot = input.plan.muscles[muscle].allocatedSlots.find(
      (entry) => entry.slotId === input.slotId
    );
    return slot
      ? [
          {
            muscle,
            minEffectiveSets: slot.minEffectiveSets,
            priority: slot.priority,
          },
        ]
      : [];
  });
}

export function evaluateSlotWeeklyObligations(input: {
  plan: WeeklyMuscleObligationPlan;
  slotId: string;
  contributionByMuscle: ReadonlyMap<string, number>;
}): SlotObligationEvaluation[] {
  return getSlotWeeklyObligations(input).map((obligation) => {
    const projectedEffectiveSets = input.contributionByMuscle.get(obligation.muscle) ?? 0;
    return {
      slotId: input.slotId,
      muscle: obligation.muscle,
      minEffectiveSets: obligation.minEffectiveSets,
      projectedEffectiveSets: roundToTenth(projectedEffectiveSets),
      shortfall: roundToTenth(
        Math.max(0, obligation.minEffectiveSets - projectedEffectiveSets)
      ),
      zeroContribution: projectedEffectiveSets <= 0,
    };
  });
}

export function evaluateWeeklyObligationPlan(input: {
  plan: WeeklyMuscleObligationPlan;
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
}): SlotObligationEvaluation[] {
  return input.projectedSlots.flatMap((projectedSlot) =>
    evaluateSlotWeeklyObligations({
      plan: input.plan,
      slotId: projectedSlot.slotPlan.slotId,
      contributionByMuscle: projectedSlot.projectedContributionByMuscle,
    })
  );
}

export function sumSlotObligationShortfall(input: {
  plan: WeeklyMuscleObligationPlan;
  slotId: string;
  workout: WorkoutPlan;
}): number {
  return roundToTenth(
    evaluateSlotWeeklyObligations({
      plan: input.plan,
      slotId: input.slotId,
      contributionByMuscle: computeWorkoutContributionByMuscle(input.workout),
    }).reduce((sum, row) => sum + row.shortfall, 0)
  );
}

function getSelectedExerciseIds(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  workout: WorkoutPlan;
}): Set<string> {
  return new Set([
    ...input.projectedSlots.flatMap((slot) =>
      getWorkoutExercises(slot.workout).map((exercise) => exercise.exercise.id)
    ),
    ...getWorkoutExercises(input.workout).map((exercise) => exercise.exercise.id),
  ]);
}

function hasCompatibleAlternative(input: {
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
  selectedExerciseIds: Set<string>;
  exercise: ReturnType<typeof getWorkoutExercises>[number];
}): boolean {
  const primaryMuscles = new Set(
    (input.exercise.exercise.primaryMuscles ?? []).map(normalizeMuscleName)
  );
  if (primaryMuscles.size === 0) {
    return false;
  }

  const isMainLift = input.exercise.isMainLift || input.exercise.role === "main";
  return input.exerciseLibrary.some((candidate) => {
    if (candidate.id === input.exercise.exercise.id || input.selectedExerciseIds.has(candidate.id)) {
      return false;
    }
    const candidatePrimaries = (candidate.primaryMuscles ?? []).map(normalizeMuscleName);
    if (!candidatePrimaries.some((muscle) => primaryMuscles.has(muscle))) {
      return false;
    }
    return isMainLift ? (candidate.isMainLiftEligible ?? false) : !(candidate.isMainLiftEligible ?? false);
  });
}

export function evaluateDuplicateExerciseReuse(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  workout: WorkoutPlan;
  slotId: string;
  exerciseLibrary: MappedGenerationContext["exerciseLibrary"];
}): {
  diagnostics: DuplicateExerciseReuseDiagnostic[];
  penalty: number;
} {
  const previousSlotIdsByExercise = new Map<string, string[]>();
  for (const projectedSlot of input.projectedSlots) {
    for (const exercise of getWorkoutExercises(projectedSlot.workout)) {
      const previous = previousSlotIdsByExercise.get(exercise.exercise.id) ?? [];
      previousSlotIdsByExercise.set(exercise.exercise.id, [
        ...previous,
        projectedSlot.slotPlan.slotId,
      ]);
    }
  }

  const selectedExerciseIds = getSelectedExerciseIds(input);
  const diagnostics = getWorkoutExercises(input.workout).flatMap((exercise) => {
    const previousSlotIds = previousSlotIdsByExercise.get(exercise.exercise.id) ?? [];
    if (previousSlotIds.length === 0) {
      return [];
    }

    const isMainLift = exercise.isMainLift || exercise.role === "main";
    const hasAlternative = hasCompatibleAlternative({
      exerciseLibrary: input.exerciseLibrary,
      selectedExerciseIds,
      exercise,
    });
    return [
      {
        exerciseId: exercise.exercise.id,
        name: exercise.exercise.name,
        repeatedInSlotId: input.slotId,
        previousSlotIds,
        role: isMainLift ? ("main" as const) : ("accessory" as const),
        hasCompatibleAlternative: hasAlternative,
        reason: isMainLift
          ? ("main_lift_continuity_allowed" as const)
          : hasAlternative
            ? ("accessory_repeat_discouraged" as const)
            : ("limited_inventory" as const),
      },
    ];
  });

  const penalty = diagnostics.reduce((sum, diagnostic) => {
    if (diagnostic.role === "main") {
      return sum + 0.5;
    }
    return sum + (diagnostic.hasCompatibleAlternative ? 3 : 0.5);
  }, 0);

  return {
    diagnostics,
    penalty,
  };
}

export function sumWeeklyHardMuscleTotals(input: {
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
}): Record<HardWeeklyObligationMuscle, number> {
  const totals = new Map<string, number>();
  for (const slot of input.projectedSlots) {
    for (const [muscle, sets] of slot.projectedContributionByMuscle) {
      totals.set(muscle, (totals.get(muscle) ?? 0) + sets);
    }
  }

  return Object.fromEntries(
    HARD_WEEKLY_OBLIGATION_MUSCLES.map((muscle) => [
      muscle,
      roundToTenth(totals.get(muscle) ?? 0),
    ])
  ) as Record<HardWeeklyObligationMuscle, number>;
}

export function getHardMuscleMev(muscle: HardWeeklyObligationMuscle): number {
  return VOLUME_LANDMARKS[muscle].mev;
}

export function exerciseContributesToHardObligation(input: {
  exercise: ReturnType<typeof getWorkoutExercises>[number];
  muscle: HardWeeklyObligationMuscle;
}): boolean {
  return (getEffectiveStimulusByMuscle(input.exercise.exercise, 1).get(input.muscle) ?? 0) > 0;
}
