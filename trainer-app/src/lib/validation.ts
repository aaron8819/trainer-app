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

export const generateWorkoutSchema = z.object({
  userId: z.string().optional(),
  date: z.string().optional(),
  selectionMode: z.enum(["AUTO", "MANUAL", "BONUS"]).optional(),
  forcedSplit: z.enum(["PUSH", "PULL", "LEGS", "UPPER", "LOWER", "FULL_BODY"]).optional(),
  advancesSplit: z.boolean().optional(),
});

export const saveWorkoutSchema = z.object({
  workoutId: z.string(),
  userId: z.string().optional(),
  scheduledDate: z.string().optional(),
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "SKIPPED"]).optional(),
  estimatedMinutes: z.number().optional(),
  notes: z.string().optional(),
  selectionMode: z.enum(["AUTO", "MANUAL", "BONUS"]).optional(),
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
  userId: z.string().optional(),
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
  splitType: z.enum(["PPL", "UPPER_LOWER", "FULL_BODY", "CUSTOM"]),
  equipmentNotes: optionalString(z.string().max(500)),
  proteinTarget: optionalNumber(z.number().int().min(0).max(400)),
  injuryBodyPart: optionalString(z.string().max(80)),
  injurySeverity: optionalNumber(z.number().int().min(1).max(5)),
  injuryDescription: optionalString(z.string().max(200)),
  injuryActive: z.boolean().optional(),
});

export const deleteWorkoutSchema = z.object({
  workoutId: z.string(),
});

export const toggleFavoriteSchema = z.object({
  userId: z.string().optional(),
});

export const toggleAvoidSchema = z.object({
  userId: z.string().optional(),
});

export const upsertBaselineSchema = z.object({
  userId: z.string().optional(),
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

export const preferencesSchema = z.object({
  userId: z.string().optional(),
  favoriteExercises: z.array(z.string()).optional(),
  avoidExercises: z.array(z.string()).optional(),
  rpeTargets: z
    .array(
      z.object({
        min: z.number(),
        max: z.number(),
        targetRpe: z.number(),
      })
    )
    .optional(),
  progressionStyle: z.string().optional(),
  optionalConditioning: z.boolean().optional(),
  benchFrequency: z.number().int().min(0).max(7).optional(),
  squatFrequency: z.number().int().min(0).max(7).optional(),
  deadliftFrequency: z.number().int().min(0).max(7).optional(),
});
