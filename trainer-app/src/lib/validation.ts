import { z } from "zod";

export const WORKOUT_STATUS_VALUES = ["PLANNED", "IN_PROGRESS", "PARTIAL", "COMPLETED", "SKIPPED"] as const;
export const WORKOUT_SAVE_ACTION_VALUES = [
  "save_plan",
  "mark_completed",
  "mark_partial",
  "mark_skipped",
] as const;
export const WORKOUT_SELECTION_MODE_VALUES = ["AUTO", "MANUAL", "BONUS", "INTENT"] as const;
export const WORKOUT_SESSION_INTENT_DB_VALUES = [
  "PUSH",
  "PULL",
  "LEGS",
  "UPPER",
  "LOWER",
  "FULL_BODY",
  "BODY_PART",
] as const;
export const WORKOUT_EXERCISE_SECTION_VALUES = ["WARMUP", "MAIN", "ACCESSORY"] as const;

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

export const workoutSessionIntentDbSchema = z.enum(WORKOUT_SESSION_INTENT_DB_VALUES);

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
  action: z.enum(WORKOUT_SAVE_ACTION_VALUES).optional(),
  expectedRevision: z.number().int().min(1).optional(),
  templateId: z.string().optional(),
  scheduledDate: z.string().optional(),
  status: z.enum(WORKOUT_STATUS_VALUES).optional(),
  estimatedMinutes: z.number().optional(),
  notes: z.string().optional(),
  selectionMode: z.enum(WORKOUT_SELECTION_MODE_VALUES).optional(),
  sessionIntent: workoutSessionIntentDbSchema.optional(),
  selectionMetadata: z.unknown().optional(),
  forcedSplit: z.enum(["PUSH", "PULL", "LEGS", "UPPER", "LOWER", "FULL_BODY"]).optional(),
  advancesSplit: z.boolean().optional(),
  filteredExercises: z
    .array(
      z.object({
        exerciseId: z.string().optional(),
        exerciseName: z.string(),
        reason: z.string(),
        userFriendlyMessage: z.string(),
      })
    )
    .optional(),
  exercises: z
    .array(
      z.object({
        section: z.enum(WORKOUT_EXERCISE_SECTION_VALUES),
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
  actualReps: z.number().int().min(0).optional(),
  actualRpe: z
    .number()
    .min(1)
    .max(10)
    .refine((value) => Number.isInteger(value * 2), {
      message: "actualRpe must use 0.5 increments",
    })
    .optional(),
  actualLoad: z.number().min(0).optional(),
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
  favoriteExerciseIds: z.array(z.string()).optional(),
  avoidExerciseIds: z.array(z.string()).optional(),
});

// Periodization schemas
export const trainingAgeSchema = z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]);

export const primaryGoalSchema = z.enum([
  "HYPERTROPHY",
  "STRENGTH",
  "FAT_LOSS",
  "ATHLETICISM",
  "GENERAL_HEALTH",
]);

export const blockTypeSchema = z.enum([
  "ACCUMULATION",
  "INTENSIFICATION",
  "REALIZATION",
  "DELOAD",
]);

export const volumeTargetSchema = z.enum(["LOW", "MODERATE", "HIGH", "PEAK"]);

export const intensityBiasSchema = z.enum(["STRENGTH", "HYPERTROPHY", "ENDURANCE"]);

export const adaptationTypeSchema = z.enum([
  "NEURAL_ADAPTATION",
  "MYOFIBRILLAR_HYPERTROPHY",
  "SARCOPLASMIC_HYPERTROPHY",
  "WORK_CAPACITY",
  "RECOVERY",
]);

export const generateMacroSchema = z.object({
  startDate: z.coerce.date(),
  durationWeeks: z.number().int().min(4).max(52),
  trainingAge: trainingAgeSchema.optional(),
  primaryGoal: primaryGoalSchema.optional(),
});

// Phase 3: Readiness & Autoregulation schemas
export const readinessSignalSchema = z.object({
  subjective: z.object({
    readiness: z.number().int().min(1).max(5),
    motivation: z.number().int().min(1).max(5),
    soreness: z.record(z.string(), z.number().int().min(1).max(3)),
    stress: z.number().int().min(1).max(5).optional(),
  }),
});

export const autoregulationPolicySchema = z.object({
  aggressiveness: z.enum(["conservative", "moderate", "aggressive"]),
  allowUpRegulation: z.boolean(),
  allowDownRegulation: z.boolean(),
});
