import { z } from "zod";
import { measurementSemanticsSchema } from "@/lib/exercise-measurement/semantics";
import {
  V2_CAPACITY_PRODUCT_CHOICES,
  V2_CAPACITY_TIME_PRIORITIES,
} from "@/lib/engine/planning/v2/capacity-selection";
import {
  STRENGTH_EMPHASIS_VALUES,
  STRENGTH_EQUIPMENT_PROFILE_VALUES,
  STRENGTH_HINGE_PREFERENCE_VALUES,
  STRENGTH_PRESS_PREFERENCE_VALUES,
  STRENGTH_SQUAT_PREFERENCE_VALUES,
} from "@/lib/engine/strength-plan-policy";
import { deriveTimedFinisherDurationSeconds } from "@/lib/engine/finisher-domain";
import { CANONICAL_LIMITATION_TAGS } from "@/lib/engine/limitation-policy";
import {
  HYPERTROPHY_SESSION_DURATION_VALUES,
  hypertrophyPlanDraftSchema,
  hypertrophyPlanDraftV2Schema,
} from "@/lib/engine/hypertrophy-plan-authoring";
import { EQUIPMENT_PROFILE_VALUES } from "@/lib/engine/equipment-profile";

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
export const SET_INTENT_VALUES = ["WORK", "WARMUP"] as const;

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
  slotId: z.string().optional(),
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
export const splitTypeDbSchema = z.enum(["PPL", "UPPER_LOWER", "FULL_BODY", "CUSTOM"]);
export const mesocycleExerciseRoleTypeSchema = z.enum(["CORE_COMPOUND", "ACCESSORY"]);

export const generateFromIntentSchema = z
  .object({
    intent: sessionIntentSchema,
    slotId: z.string().optional(),
    targetMuscles: z.array(z.string()).optional(),
    anchorWeek: z.number().int().min(1).optional(),
    weekCloseId: z.string().optional(),
    maxGeneratedHardSets: z.number().int().min(1).max(100).optional(),
    maxGeneratedExercises: z.number().int().min(1).max(20).optional(),
    optionalGapFill: z.boolean().optional(),
    supplementalDeficitSession: z.boolean().optional(),
    sessionCapacity: z.enum(["as_planned", "short_today"]).optional(),
    pinnedExerciseIds: z.array(z.string()).optional(),
    roleListIncomplete: z.preprocess(
      (value) => (value === true ? true : undefined),
      z.literal(true).optional()
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.intent === "body_part" &&
      value.optionalGapFill !== true &&
      (!value.targetMuscles || value.targetMuscles.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetMuscles is required when intent is body_part",
        path: ["targetMuscles"],
      });
    }
    if (value.optionalGapFill === true && value.weekCloseId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "weekCloseId is required when optionalGapFill is true",
        path: ["weekCloseId"],
      });
    }
    if (value.supplementalDeficitSession === true && value.intent !== "body_part") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "supplementalDeficitSession is only allowed when intent is body_part",
        path: ["supplementalDeficitSession"],
      });
    }
    if (
      value.supplementalDeficitSession === true &&
      (!value.targetMuscles || value.targetMuscles.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "targetMuscles is required when supplementalDeficitSession is true",
        path: ["targetMuscles"],
      });
    }
    if (value.supplementalDeficitSession === true && value.optionalGapFill === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "supplementalDeficitSession cannot be combined with optionalGapFill",
        path: ["supplementalDeficitSession"],
      });
    }
  });

const saveWorkoutPayloadSchema = z.object({
    workoutId: z.string(),
    sessionCapacity: z.enum(["as_planned", "short_today"]).optional(),
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
    mesocycleWeekSnapshot: z.number().int().min(1).optional(),
    filteredExercises: z
      .array(
        z.object({
          exerciseId: z.string().optional(),
          exerciseName: z.string(),
          reason: z.string(),
          userFriendlyMessage: z.string(),
        }).strict()
      )
      .optional(),
    exercises: z
      .array(
        z.object({
          section: z.enum(WORKOUT_EXERCISE_SECTION_VALUES),
          exerciseId: z.string(),
          measurement: measurementSemanticsSchema.optional(),
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
              }).strict()
            )
            .min(1),
        }).strict()
      )
      .optional(),
  }).strict();

export const saveWorkoutSchema = saveWorkoutPayloadSchema;

export const setLogSchema = z
  .object({
    workoutSetId: z.string().optional(),
    workoutExerciseId: z.string().optional(),
    setIntent: z.enum(SET_INTENT_VALUES).optional(),
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
    expectedRevision: z.number().int().min(1),
  })
  .superRefine((value, ctx) => {
    if (value.workoutSetId) {
      return;
    }

    if (value.setIntent === "WARMUP" && value.workoutExerciseId) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["workoutSetId"],
      message: "workoutSetId is required unless logging a warmup by workoutExerciseId",
    });
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
  primaryGoal: z.enum([
    "HYPERTROPHY",
    "STRENGTH",
    "STRENGTH_HYPERTROPHY",
    "FAT_LOSS",
    "ATHLETICISM",
    "GENERAL_HEALTH",
  ]),
  secondaryGoal: z.enum(["POSTURE", "CONDITIONING", "INJURY_PREVENTION", "STRENGTH", "NONE"]),
  daysPerWeek: z.number().int().min(1).max(7),
  weeklySchedule: z.array(workoutSessionIntentDbSchema).max(7).optional(),
  splitType: z.enum(["PPL", "UPPER_LOWER", "FULL_BODY", "CUSTOM"]).optional(),
  injuryBodyPart: optionalString(z.string().max(80)),
  injurySeverity: optionalNumber(z.number().int().min(1).max(5)),
  injuryDescription: optionalString(z.string().max(200)),
  injuryActive: z.boolean().optional(),
});

export const deleteWorkoutSchema = z.object({
  workoutId: z.string(),
  expectedRevision: z.number().int().min(1),
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
  "STRENGTH_HYPERTROPHY",
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

export function normalizePlanName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export const planNameSchema = z
  .string()
  .transform(normalizePlanName)
  .pipe(z.string().min(1).max(60));

const optimisticTimestampSchema = z.string().datetime({ offset: true });

export const createHypertrophyPlanSchema = z.object({
  name: planNameSchema,
  startDate: z.coerce.date(),
  durationWeeks: z.number().int().min(8).max(52),
});

export const strengthPlanConfigurationSchema = z
  .object({
    emphasis: z.enum(STRENGTH_EMPHASIS_VALUES),
    daysPerWeek: z.union([
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
    sessionDurationMinutes: z.union([
      z.literal(45),
      z.literal(60),
      z.literal(75),
      z.literal(90),
    ]),
    equipmentProfile: z.enum(STRENGTH_EQUIPMENT_PROFILE_VALUES),
    preferredLifts: z
      .object({
        squat: z.enum(STRENGTH_SQUAT_PREFERENCE_VALUES),
        press: z.enum(STRENGTH_PRESS_PREFERENCE_VALUES),
        hinge: z.enum(STRENGTH_HINGE_PREFERENCE_VALUES),
      })
      .strict(),
  })
  .strict();

const createPlanInputSchema = z.discriminatedUnion("planType", [
  createHypertrophyPlanSchema
    .extend({ planType: z.literal("HYPERTROPHY") })
    .strict(),
  z
    .object({
      planType: z.literal("STRENGTH"),
      name: planNameSchema.default("Strength Plan"),
      startDate: z.coerce.date(),
      configuration: strengthPlanConfigurationSchema,
    })
    .strict(),
]);

export const createPlanSchema = z.preprocess((value) => {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !("planType" in value)
  ) {
    return { ...value, planType: "HYPERTROPHY" };
  }
  return value;
}, createPlanInputSchema);

const manualHypertrophyPresetSchema = z.enum([
  "FULL_BODY_2",
  "FULL_BODY_3",
  "PPL_3",
  "UPPER_LOWER_4",
  "PPL_6",
  "BLANK",
]);

const createCustomHypertrophyPlanSchema = z
  .object({
    planType: z.literal("HYPERTROPHY"),
    name: planNameSchema.default("My Hypertrophy Plan"),
    sessionsPerWeek: z.number().int().min(2).max(6),
    equipmentProfile: z.enum(EQUIPMENT_PROFILE_VALUES),
    sessionDurationMinutes: z.union(
      HYPERTROPHY_SESSION_DURATION_VALUES.map((value) => z.literal(value)) as [
        z.ZodLiteral<45>,
        z.ZodLiteral<60>,
        z.ZodLiteral<75>,
        z.ZodLiteral<90>,
      ],
    ),
    authorMethod: z.enum(["MANUAL", "V2", "WEEKLY"]),
    preset: manualHypertrophyPresetSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.authorMethod === "V2" && value.sessionsPerWeek !== 4) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sessionsPerWeek"],
        message: "Generated starting plans require four sessions",
      });
    }
  });

export const createPlanWithCustomHypertrophySchema = z.discriminatedUnion(
  "planType",
  [
    createCustomHypertrophyPlanSchema,
    z
      .object({
        planType: z.literal("STRENGTH"),
        name: planNameSchema.default("Strength Plan"),
        startDate: z.coerce.date(),
        configuration: strengthPlanConfigurationSchema,
      })
      .strict(),
  ],
);

export const saveHypertrophyPlanDraftSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    name: planNameSchema,
    draft: z.union([hypertrophyPlanDraftSchema, hypertrophyPlanDraftV2Schema]),
  })
  .strict();

export const regenerateHypertrophyPlanDraftSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    replaceConfirmed: z.literal(true),
  })
  .strict();

export const makeHypertrophyPlanReadySchema = z
  .object({
    expectedDraftRevision: z.number().int().min(1),
    warningsConfirmed: z.boolean().default(false),
  })
  .strict();

export const copyHypertrophyPlanSchema = z
  .object({ name: planNameSchema })
  .strict();

export const renamePlanSchema = z.object({
  name: planNameSchema,
  expectedUpdatedAt: optimisticTimestampSchema,
});

export const planMutationSchema = z.object({
  expectedUpdatedAt: optimisticTimestampSchema,
});

export const activatePlanSchema = z.object({
  expectedActiveMacroCycleId: z.string().uuid().nullable(),
});

const finisherCommandIdSchema = z.string().uuid();
export const FINISHER_BODY_REGION_VALUES = [
  "core",
  "shoulders",
  "hips",
  "full_body",
  "legs",
] as const;
export const FINISHER_LIBRARY_STATE_VALUES = [
  "ACTIVE",
  "ARCHIVED",
  "DELETED",
] as const;

const uniqueStrings = (values: readonly string[]) =>
  new Set(values).size === values.length;

const finisherShortTextSchema = z.string().trim().min(1).max(160);
export const finisherRoutineDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    category: z.enum(["CORE", "CONDITIONING"]),
    difficulty: z.enum(["EASY", "MODERATE", "CHALLENGING"]),
    fatigueCost: z.enum(["LOW", "MODERATE", "HIGH"]),
    impactLevel: z.enum(["LOW", "MODERATE", "HIGH"]),
    bodyRegions: z
      .array(z.enum(FINISHER_BODY_REGION_VALUES))
      .max(FINISHER_BODY_REGION_VALUES.length)
      .refine(uniqueStrings, "Body regions must be unique"),
    limitationTags: z
      .array(z.enum(CANONICAL_LIMITATION_TAGS))
      .max(CANONICAL_LIMITATION_TAGS.length)
      .refine(uniqueStrings, "Limitation tags must be unique"),
    preparationSeconds: z.number().int().min(0).max(60),
    includesFinalRecovery: z.boolean(),
    steps: z
      .array(
        z
          .object({
            movementName: z.string().trim().min(1).max(120),
            workSeconds: z.number().int().min(1).max(600),
            recoverySeconds: z.number().int().min(0).max(600),
            techniqueCues: z
              .array(finisherShortTextSchema)
              .max(3)
              .refine(uniqueStrings, "Technique cues must be unique"),
            alternatives: z
              .array(finisherShortTextSchema)
              .max(3)
              .refine(uniqueStrings, "Alternatives must be unique"),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((definition, context) => {
    const durationSeconds = deriveTimedFinisherDurationSeconds({
      steps: definition.steps,
      includesFinalRecovery: definition.includesFinalRecovery,
    });
    if (durationSeconds > 30 * 60) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "Finisher duration cannot exceed 30 minutes",
      });
    }
  });

export type FinisherRoutineDefinition = z.infer<
  typeof finisherRoutineDefinitionSchema
>;

export const createFinisherRoutineSchema = z
  .object({ definition: finisherRoutineDefinitionSchema })
  .strict();
export const editFinisherRoutineSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    definition: finisherRoutineDefinitionSchema,
  })
  .strict();
export const finisherLibraryMutationSchema = z
  .object({ expectedRevision: z.number().int().min(0) })
  .strict();
export const duplicateFinisherRoutineSchema = z
  .object({ expectedRoutineVersionId: z.string().uuid() })
  .strict();
export const reorderFinisherLibrarySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            routineId: z.string().uuid(),
            expectedRevision: z.number().int().min(0),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.items.map((item) => item.routineId)).size ===
      value.items.length,
    { path: ["items"], message: "Routine IDs must be unique" },
  );

export const FINISHER_EXECUTION_COMMAND_ACTION_VALUES = [
  "start",
  "sync",
  "pause",
  "resume",
  "skip",
  "substitute",
  "end",
  "feedback",
  "dismiss",
] as const;

export const finisherActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("offer") }).strict(),
  z
    .object({
      action: z.literal("select"),
      offerId: z.string().uuid(),
      expectedOfferRevision: z.number().int().min(1),
      executionId: z.string().uuid(),
      routineVersionId: z.string().uuid(),
      acknowledgeContraindication: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("start"),
      executionId: z.string().uuid(),
      expectedRevision: z.number().int().min(1),
      commandId: finisherCommandIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("decline"),
      offerId: z.string().uuid(),
      expectedOfferRevision: z.number().int().min(1),
      decisionId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("dismiss"),
      executionId: z.string().uuid(),
      expectedRevision: z.number().int().min(1),
      commandId: finisherCommandIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("sync"),
      executionId: z.string().uuid(),
      expectedRevision: z.number().int().min(1),
      commandId: finisherCommandIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("pause"),
      executionId: z.string().uuid(),
      expectedRevision: z.number().int().min(1),
      commandId: finisherCommandIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("resume"),
      executionId: z.string().uuid(),
      expectedRevision: z.number().int().min(1),
      commandId: finisherCommandIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("skip"),
      executionId: z.string().uuid(),
      expectedRevision: z.number().int().min(1),
      commandId: finisherCommandIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("substitute"),
      executionId: z.string().uuid(),
      expectedRevision: z.number().int().min(1),
      alternativeId: z.string().uuid(),
      commandId: finisherCommandIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("end"),
      executionId: z.string().uuid(),
      expectedRevision: z.number().int().min(1),
      commandId: finisherCommandIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("feedback"),
      executionId: z.string().uuid(),
      expectedRevision: z.number().int().min(1),
      difficultyFeedback: z.number().int().min(1).max(10),
      commandId: finisherCommandIdSchema,
    })
    .strict(),
]);

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

export const workoutHistoryQuerySchema = z.object({
  intent: z.enum(WORKOUT_SESSION_INTENT_DB_VALUES).optional(),
  status: z.string().optional(),
  mesocycleId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(50).default(20),
});

export const nextCycleSeedSlotSchema = z.object({
  slotId: z.string().min(1).max(40),
  intent: workoutSessionIntentDbSchema,
});

export const nextCycleCarryForwardSelectionSchema = z.object({
  exerciseId: z.string(),
  exerciseName: z.string().min(1).max(120),
  sessionIntent: workoutSessionIntentDbSchema,
  role: mesocycleExerciseRoleTypeSchema,
  action: z.enum(["keep", "rotate", "drop"]),
});

export const nextCycleCapacitySelectionSchema = z
  .object({
    version: z.literal(1),
    productChoice: z.enum(V2_CAPACITY_PRODUCT_CHOICES),
    timePriority: z.enum(V2_CAPACITY_TIME_PRIORITIES),
    fourDayUpperLowerConfirmed: z.boolean(),
  })
  .strict();

export const nextCycleSeedDraftUpdateSchema = z.object({
  sourceMesocycleId: z.string(),
  structure: z.object({
    splitType: splitTypeDbSchema,
    sessionsPerWeek: z.number().int().min(1).max(7),
    daysPerWeek: z.number().int().min(1).max(7),
    sequenceMode: z.literal("ordered_flexible"),
    slots: z.array(nextCycleSeedSlotSchema).min(1).max(7),
  }),
  carryForwardSelections: z.array(nextCycleCarryForwardSelectionSchema),
  capacitySelection: nextCycleCapacitySelectionSchema.optional(),
});

export const refreshNextCycleSeedDraftSchema = z
  .object({
    productChoice: z.enum(V2_CAPACITY_PRODUCT_CHOICES),
    fourDayUpperLowerConfirmed: z.literal(true),
  })
  .strict();

export const acceptNextCycleSchema = z
  .object({
    productChoice: z.enum(V2_CAPACITY_PRODUCT_CHOICES).optional(),
  })
  .strict();
