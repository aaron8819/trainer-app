import { z } from "zod";

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess((value) => {
    if (value === null || value === "") {
      return undefined;
    }
    if (typeof value === "number" && Number.isNaN(value)) {
      return undefined;
    }
    return value;
  }, schema.optional());

const optionalString = (schema: z.ZodString) =>
  z.preprocess((value) => {
    if (typeof value === "string" && value.trim() === "") {
      return undefined;
    }
    return value;
  }, schema.optional());

export const generateFromTemplateSchema = z.object({
  templateId: z.string(),
  pinnedExerciseIds: z.array(z.string()).optional(),
  autoFillUnpinned: z.boolean().optional(),
});

export const sessionIntentSchema = z.enum([
  "push",
  "pull",
  "legs",
  "upper",
  "lower",
  "full_body",
  "body_part",
]);

export const workoutSessionIntentDbSchema = z.enum([
  "PUSH",
  "PULL",
  "LEGS",
  "UPPER",
  "LOWER",
  "FULL_BODY",
  "BODY_PART",
]);

export const generateFromIntentSchema = z
  .object({
    intent: sessionIntentSchema,
    targetMuscles: z.array(z.string()).optional(),
    pinnedExerciseIds: z.array(z.string()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.intent === "body_part" && (!value.targetMuscles || value.targetMuscles.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetMuscles is required when intent is body_part",
        path: ["targetMuscles"],
      });
    }
  });

export const saveWorkoutSchema = z.object({
  workoutId: z.string(),
  templateId: z.string().optional(),
  scheduledDate: z.string().optional(),
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "SKIPPED"]).optional(),
  estimatedMinutes: z.number().optional(),
  notes: z.string().optional(),
  selectionMode: z.enum(["AUTO", "MANUAL", "BONUS", "INTENT"]).optional(),
  sessionIntent: workoutSessionIntentDbSchema.optional(),
  selectionMetadata: z.unknown().optional(),
  forcedSplit: z.enum(["PUSH", "PULL", "LEGS", "UPPER", "LOWER", "FULL_BODY"]).optional(),
  advancesSplit: z.boolean().optional(),
  exercises: z
    .array(
      z.object({
        section: z.enum(["WARMUP", "MAIN", "ACCESSORY"]).optional(),
        exerciseId: z.string(),
        sets: z
          .array(
            z.object({
              setIndex: z.number(),
              targetReps: z.number(),
              targetRepRange: z
                .object({
                  min: z.number().int().min(1),
                  max: z.number().int().min(1),
                })
                .refine((range) => range.min <= range.max, {
                  message: "targetRepRange.min must be <= max",
                })
                .optional(),
              targetRpe: z.number().optional(),
              targetLoad: z.number().optional(),
              restSeconds: z.number().optional(),
            })
          )
          .min(1),
      })
    )
    .optional(),
});

export const setLogSchema = z.object({
  workoutSetId: z.string(),
  workoutExerciseId: z.string().optional(),
  actualReps: z.number().optional(),
  actualRpe: z.number().optional(),
  actualLoad: z.number().optional(),
  wasSkipped: z.boolean().optional(),
  notes: z.string().optional(),
});

export const analyticsSummarySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const profileSetupSchema = z.object({
  email: optionalString(z.string().email()),
  age: optionalNumber(z.number().int().min(13).max(100)),
  sex: optionalString(z.string().max(40)),
  heightIn: optionalNumber(z.number().int().min(48).max(96)),
  weightLb: optionalNumber(z.number().min(80).max(600)),
  trainingAge: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]),
  primaryGoal: z.enum(["HYPERTROPHY", "STRENGTH", "FAT_LOSS", "ATHLETICISM", "GENERAL_HEALTH"]),
  secondaryGoal: z.enum(["POSTURE", "CONDITIONING", "INJURY_PREVENTION", "NONE"]),
  daysPerWeek: z.number().int().min(1).max(7),
  sessionMinutes: z.number().int().min(20).max(180),
  weeklySchedule: z.array(workoutSessionIntentDbSchema).max(7).optional(),
  splitType: z.enum(["PPL", "UPPER_LOWER", "FULL_BODY", "CUSTOM"]).optional(),
  injuryBodyPart: optionalString(z.string().max(80)),
  injurySeverity: optionalNumber(z.number().int().min(1).max(5)),
  injuryDescription: optionalString(z.string().max(200)),
  injuryActive: z.boolean().optional(),
});

export const deleteWorkoutSchema = z.object({
  workoutId: z.string(),
});

export const toggleFavoriteSchema = z.object({
});

export const toggleAvoidSchema = z.object({
});

export const upsertBaselineSchema = z.object({
  exerciseId: z.string(),
  context: z.string().default("default"),
  workingWeightMin: z.number().optional(),
  workingWeightMax: z.number().optional(),
  workingRepsMin: z.number().int().optional(),
  workingRepsMax: z.number().int().optional(),
  topSetWeight: z.number().optional(),
  topSetReps: z.number().int().optional(),
  notes: z.string().max(500).optional(),
});

const templateExerciseSchema = z.object({
  exerciseId: z.string(),
  orderIndex: z.number().int().min(0),
  supersetGroup: z.number().int().min(1).max(99).optional(),
});

export const templateIntentSchema = z.enum([
  "FULL_BODY",
  "UPPER_LOWER",
  "PUSH_PULL_LEGS",
  "BODY_PART",
  "CUSTOM",
]);

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  targetMuscles: z.array(z.string()).default([]),
  isStrict: z.boolean().default(false),
  intent: templateIntentSchema.default("CUSTOM"),
  exercises: z.array(templateExerciseSchema).default([]),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  targetMuscles: z.array(z.string()).optional(),
  isStrict: z.boolean().optional(),
  intent: templateIntentSchema.optional(),
  exercises: z.array(templateExerciseSchema).optional(),
});

export const addExerciseToTemplateSchema = z.object({
  exerciseId: z.string(),
});

export const preferencesSchema = z.object({
  favoriteExercises: z.array(z.string()).optional(),
  avoidExercises: z.array(z.string()).optional(),
  favoriteExerciseIds: z.array(z.string()).optional(),
  avoidExerciseIds: z.array(z.string()).optional(),
  optionalConditioning: z.boolean().optional(),
});
