import { z } from "zod";
import {
  projectExecutableSeedRows,
  type ExecutableSeedProjection,
} from "./hypertrophy-plan-authoring";

export const PLAN_SPECIFICATION_PREVIEW_V0_COMPILER_VERSION =
  "plan-specification-preview-v0-compiler.1" as const;

export const PLAN_SPECIFICATION_PREVIEW_V0_DEFERRED_CONCEPTS = [
  "plan name and authoring provenance",
  "primary goal and compiler selection",
  "ranked priorities and priority links",
  "session names and focus",
  "placement identity, prominence, and continuity",
  "accepted targets and exercise-class constraints",
  "equipment and duration constraints",
  "accumulation and deload structure",
  "preparation and optional closeout layers",
  "rep targets, measurement profiles, and progression policy",
  "persistence, acceptance, activation, and runtime fallback",
] as const;

const normalizedId = z.string().trim().min(1);

const executableExerciseSchema = z
  .object({
    exerciseId: normalizedId,
    role: z.enum(["CORE_COMPOUND", "ACCESSORY"]),
    setCount: z.number().int().positive(),
  })
  .strict();

const slotSchema = z
  .object({
    slotId: normalizedId,
    exercises: z.array(executableExerciseSchema).min(1),
  })
  .strict();

export const planSpecificationPreviewV0Schema = z
  .object({
    version: z.literal(0),
    slots: z.array(slotSchema).min(1),
  })
  .strict()
  .superRefine((specification, context) => {
    const slotIds = specification.slots.map((slot) => slot.slotId);
    if (new Set(slotIds).size !== slotIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slots"],
        message: "Slot IDs must be unique",
      });
    }
  });

export type PlanSpecificationPreviewV0 = z.output<
  typeof planSpecificationPreviewV0Schema
>;

export type PlanSpecificationPreviewV0ValidationFinding = {
  code: string;
  path: string;
  message: string;
};

export function parsePlanSpecificationPreviewV0(
  input: unknown,
): PlanSpecificationPreviewV0 {
  return planSpecificationPreviewV0Schema.parse(input);
}

export function compilePlanSpecificationPreviewV0(
  input: PlanSpecificationPreviewV0,
): ExecutableSeedProjection {
  const specification = parsePlanSpecificationPreviewV0(input);
  return projectExecutableSeedRows(specification.slots);
}

export function validatePlanSpecificationPreviewV0Catalog(input: {
  specification: PlanSpecificationPreviewV0;
  catalogExerciseIds: readonly string[];
}): PlanSpecificationPreviewV0ValidationFinding[] {
  const knownExerciseIds = new Set(input.catalogExerciseIds);
  return input.specification.slots.flatMap((slot, slotIndex) =>
    slot.exercises.flatMap((exercise, exerciseIndex) =>
      knownExerciseIds.has(exercise.exerciseId)
        ? []
        : [
            {
              code: "UNKNOWN_EXERCISE_ID",
              path: `slots.${slotIndex}.exercises.${exerciseIndex}.exerciseId`,
              message: `Exercise ID is not present in the supplied catalog context: ${exercise.exerciseId}`,
            },
          ],
    ),
  );
}
