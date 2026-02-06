import { z } from "zod";

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
  email: z.string().email().optional(),
  age: z.number().int().min(13).max(100).optional(),
  sex: z.string().max(40).optional(),
  heightIn: z.number().int().min(48).max(96).optional(),
  weightLb: z.number().min(80).max(600).optional(),
  trainingAge: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]),
  primaryGoal: z.enum(["HYPERTROPHY", "STRENGTH", "FAT_LOSS", "ATHLETICISM", "GENERAL_HEALTH"]),
  secondaryGoal: z.enum(["POSTURE", "CONDITIONING", "INJURY_PREVENTION", "NONE"]),
  daysPerWeek: z.number().int().min(1).max(7),
  sessionMinutes: z.number().int().min(20).max(180),
  splitType: z.enum(["PPL", "UPPER_LOWER", "FULL_BODY", "CUSTOM"]),
  equipmentNotes: z.string().max(500).optional(),
  proteinTarget: z.number().int().min(0).max(400).optional(),
  injuryBodyPart: z.string().max(80).optional(),
  injurySeverity: z.number().int().min(1).max(5).optional(),
  injuryDescription: z.string().max(200).optional(),
  injuryActive: z.boolean().optional(),
});

export const deleteWorkoutSchema = z.object({
  workoutId: z.string(),
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
