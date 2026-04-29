import type { MesocycleExerciseRoleType, WorkoutSessionIntent } from "@prisma/client";
import type { V2AcceptedPlannerIntentDto } from "@/lib/engine/planning/v2";
import type { WorkoutExercise, WorkoutPlan } from "@/lib/engine/types";
import type { ProtectedWeekOneCoverageMuscle } from "@/lib/planning/session-slot-profile";
import type { SupportFloorRepairReason } from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import type { MesocycleSlotSequence } from "./mesocycle-slot-contract";
import { sanitizeAcceptedPlannerIntent } from "./slot-plan-seed-parser";

export type ProjectedSuccessorSlotPlanExercise = {
  exerciseId: string;
  name: string;
  role: MesocycleExerciseRoleType;
  setCount: number;
};

export type ProjectedSuccessorSlotPlan = {
  slotId: string;
  intent: WorkoutSessionIntent;
  exercises: ProjectedSuccessorSlotPlanExercise[];
};

export type MesocycleSlotPlanSeedExercise = {
  exerciseId: string;
  role: MesocycleExerciseRoleType;
  setCount: number;
};

export type MesocycleSlotPlanSeed = {
  version: 1;
  source: "handoff_slot_plan_projection";
  acceptedPlannerIntent?: V2AcceptedPlannerIntentDto;
  slots: Array<{
    slotId: string;
    exercises: MesocycleSlotPlanSeedExercise[];
  }>;
  diagnostics?: {
    projectionStatus: "partial_acceptable";
    protectedCoverage?: {
      unresolvedProtectedMuscles: ProtectedWeekOneCoverageMuscle[];
      supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
    };
  };
};

function slotIdsAlignWithSlotSequence(input: {
  slotSequence: MesocycleSlotSequence;
  slotPlans: ReadonlyArray<ProjectedSuccessorSlotPlan>;
}): boolean {
  const sequenceSlotIds = input.slotSequence.slots.map((slot) => slot.slotId);
  const projectedSlotIds = input.slotPlans.map((slot) => slot.slotId);

  return (
    sequenceSlotIds.length === projectedSlotIds.length &&
    sequenceSlotIds.every((slotId, index) => projectedSlotIds[index] === slotId)
  );
}

export function buildMesocycleSlotPlanSeed(input: {
  slotSequence: MesocycleSlotSequence;
  slotPlans: ReadonlyArray<ProjectedSuccessorSlotPlan>;
  diagnostics?: MesocycleSlotPlanSeed["diagnostics"];
  acceptedPlannerIntent?: V2AcceptedPlannerIntentDto;
}): MesocycleSlotPlanSeed {
  if (!slotIdsAlignWithSlotSequence(input)) {
    throw new Error("MESOCYCLE_SLOT_PLAN_SEED_ALIGNMENT_INVALID");
  }

  const acceptedPlannerIntent = sanitizeAcceptedPlannerIntent(input.acceptedPlannerIntent);

  return {
    version: 1,
    source: "handoff_slot_plan_projection",
    ...(acceptedPlannerIntent ? { acceptedPlannerIntent } : {}),
    slots: input.slotPlans.map((slotPlan) => ({
      slotId: slotPlan.slotId,
      exercises: slotPlan.exercises.map((exercise) => {
        if (!Number.isInteger(exercise.setCount) || exercise.setCount <= 0) {
          throw new Error("MESOCYCLE_SLOT_PLAN_SEED_SET_COUNT_INVALID");
        }
        return {
          exerciseId: exercise.exerciseId,
          role: exercise.role,
          setCount: exercise.setCount,
        };
      }),
    })),
    ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
  };
}

export function mapWorkoutExercisesToProjectedSlotPlan(
  workoutExercises: WorkoutExercise[],
  role: MesocycleExerciseRoleType
): ProjectedSuccessorSlotPlanExercise[] {
  return workoutExercises.map((exercise) => ({
    exerciseId: exercise.exercise.id,
    name: exercise.exercise.name,
    role,
    setCount: exercise.sets.length,
  }));
}

export function mapProjectedWorkoutToSlotPlan(input: {
  slotId: string;
  intent: WorkoutSessionIntent;
  workout: WorkoutPlan;
}): ProjectedSuccessorSlotPlan {
  return {
    slotId: input.slotId,
    intent: input.intent,
    exercises: [
      ...mapWorkoutExercisesToProjectedSlotPlan(input.workout.mainLifts, "CORE_COMPOUND"),
      ...mapWorkoutExercisesToProjectedSlotPlan(input.workout.accessories, "ACCESSORY"),
    ],
  };
}
