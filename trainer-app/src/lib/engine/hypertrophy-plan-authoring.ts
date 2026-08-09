import { z } from "zod";
import {
  CANONICAL_MUSCLE_IDS,
  MUSCLE_POLICIES,
  MUSCLE_POLICY_BY_ID,
  getMusclePolicyByDisplayName,
  type CanonicalMuscleId,
} from "./muscle-policy";
import {
  CANONICAL_MOVEMENT_PATTERN_VALUES,
  LEGACY_MOVEMENT_PATTERN_ALIAS_VALUES,
  type EquipmentType,
  type MovementPatternV2,
} from "./types";
import {
  EQUIPMENT_PROFILE_VALUES,
  equipmentForProfile,
  isEquipmentProfileCompatible,
  type EquipmentProfile,
} from "./equipment-profile";
import {
  matchV2ExerciseClasses,
  normalizeV2MaterializationText,
} from "./planning/v2/materialization/taxonomy";
import type {
  V2ExerciseClassId,
  V2MaterializationExercise,
} from "./planning/v2/materialization/types";
import type {
  V2ExerciseMaterializationPlan,
  V2PlannerMesocyclePolicy,
} from "./planning/v2";
import {
  measurementSemanticsSchema,
  type MeasurementSemantics,
} from "@/lib/exercise-measurement/semantics";
import { getEffectiveStimulusByMuscleId } from "./stimulus";
import { addStimulusContribution } from "./stimulus-accounting-policy";

export const HYPERTROPHY_SESSION_FOCUS_VALUES = [
  "PUSH",
  "PULL",
  "LEGS",
  "UPPER",
  "LOWER",
  "FULL_BODY",
  "BODY_PART",
] as const;
export type HypertrophySessionFocus =
  (typeof HYPERTROPHY_SESSION_FOCUS_VALUES)[number];

export const HYPERTROPHY_USER_ROLE_VALUES = [
  "PRIMARY_LIFT",
  "SECONDARY_LIFT",
  "MUSCLE_ISOLATION",
  "ACCESSORY",
] as const;
export type HypertrophyUserRole =
  (typeof HYPERTROPHY_USER_ROLE_VALUES)[number];

export const HYPERTROPHY_SESSION_DURATION_VALUES = [45, 60, 75, 90] as const;
export type HypertrophySessionDuration =
  (typeof HYPERTROPHY_SESSION_DURATION_VALUES)[number];

export const ACCEPTED_EXERCISE_CLASS_CONSTRAINT_VALUES = [
  "low_axial_hip_extension_anchor",
] as const satisfies readonly V2ExerciseClassId[];
export type AcceptedExerciseClassConstraint =
  (typeof ACCEPTED_EXERCISE_CLASS_CONSTRAINT_VALUES)[number];

export type AcceptedExerciseIntentV2 = {
  userRole: HypertrophyUserRole;
  target:
    | { kind: "movement_pattern"; movementPattern: MovementPatternV2 }
    | { kind: "muscle"; muscleId: CanonicalMuscleId };
  requiredExerciseClass?: AcceptedExerciseClassConstraint;
};

export type HypertrophyPlanDraftV1 = {
  version: 1;
  settings: {
    equipmentProfile: EquipmentProfile;
    sessionDurationMinutes: HypertrophySessionDuration;
  };
  sessions: Array<{
    slotId: string;
    name: string;
    focus: HypertrophySessionFocus;
    exercises: Array<{
      exerciseId: string;
      workingSets: number;
      intent: AcceptedExerciseIntentV2;
    }>;
  }>;
};

export type AcceptedHypertrophySeedV2 = {
  version: 2;
  source: "custom_hypertrophy_plan_v1";
  settings: HypertrophyPlanDraftV1["settings"];
  slots: Array<{
    slotId: string;
    name: string;
    focus: HypertrophySessionFocus;
    exercises: Array<{
      exerciseId: string;
      role: "CORE_COMPOUND" | "ACCESSORY";
      setCount: number;
      intent: AcceptedExerciseIntentV2;
    }>;
  }>;
};

export type AcceptedHypertrophySeedV3 = {
  version: 3;
  source: "custom_hypertrophy_plan_v1";
  settings: HypertrophyPlanDraftV1["settings"];
  slots: Array<{
    slotId: string;
    name: string;
    focus: HypertrophySessionFocus;
    exercises: Array<{
      exerciseId: string;
      role: "CORE_COMPOUND" | "ACCESSORY";
      setCount: number;
      intent: AcceptedExerciseIntentV2;
      measurement: MeasurementSemantics;
    }>;
  }>;
};

export type HypertrophyPlanWeekV4 = {
  week: number;
  phase: "ACCUMULATION" | "DELOAD";
};

export type RepTargetV4 =
  | { kind: "EXACT"; reps: number }
  | { kind: "RANGE"; min: number; max: number };

export type RirTargetV4 =
  | { kind: "TARGET_RANGE"; min: number; max: number }
  | { kind: "NOT_APPLICABLE" };

export type WeeklyPrescriptionV4 =
  | { week: number; status: "OMIT" }
  | {
      week: number;
      status: "PRESCRIBE";
      setCount: number;
      reps: RepTargetV4;
      rir: RirTargetV4;
    };

export type HypertrophyPlanDraftV2 = {
  version: 2;
  settings: HypertrophyPlanDraftV1["settings"];
  weeks: HypertrophyPlanWeekV4[];
  sessions: Array<{
    slotId: string;
    name: string;
    focus: HypertrophySessionFocus;
    exercises: Array<{
      placementId: string;
      exerciseId: string;
      intent: AcceptedExerciseIntentV2;
      preservedMeasurement?: {
        exerciseId: string;
        measurement: MeasurementSemantics;
      };
      prescriptions: WeeklyPrescriptionV4[];
    }>;
  }>;
};

export type AcceptedHypertrophySeedV4 = {
  version: 4;
  source: "custom_hypertrophy_plan_v2";
  settings: HypertrophyPlanDraftV2["settings"];
  weeks: HypertrophyPlanWeekV4[];
  slots: Array<{
    slotId: string;
    name: string;
    focus: HypertrophySessionFocus;
    exercises: Array<{
      placementId: string;
      exerciseId: string;
      role: "CORE_COMPOUND" | "ACCESSORY";
      intent: AcceptedExerciseIntentV2;
      measurement: MeasurementSemantics;
      prescriptions: WeeklyPrescriptionV4[];
    }>;
  }>;
};

export type AcceptedHypertrophySeed =
  | AcceptedHypertrophySeedV2
  | AcceptedHypertrophySeedV3;

export type ExecutableSeedProjection = {
  version: 1;
  slots: Array<{
    slotId: string;
    exercises: Array<{
      exerciseId: string;
      role: "CORE_COMPOUND" | "ACCESSORY";
      setCount: number;
    }>;
  }>;
};

export type ExecutableSeedProjectionV2 = {
  version: 2;
  slots: Array<{
    slotId: string;
    exercises: Array<{
      exerciseId: string;
      role: "CORE_COMPOUND" | "ACCESSORY";
      setCount: number;
      measurement: MeasurementSemantics;
    }>;
  }>;
};

export type ExecutableSeedProjectionV3 = {
  version: 3;
  weeks: HypertrophyPlanWeekV4[];
  slots: Array<{
    slotId: string;
    exercises: Array<{
      placementId: string;
      exerciseId: string;
      role: "CORE_COMPOUND" | "ACCESSORY";
      intent: AcceptedExerciseIntentV2;
      measurement: MeasurementSemantics;
      prescriptions: WeeklyPrescriptionV4[];
    }>;
  }>;
};

type AuthoringJsonValue =
  | null
  | boolean
  | number
  | string
  | AuthoringJsonValue[]
  | { [key: string]: AuthoringJsonValue };

const movementPatternValues = [
  ...CANONICAL_MOVEMENT_PATTERN_VALUES,
  ...LEGACY_MOVEMENT_PATTERN_ALIAS_VALUES,
] as [MovementPatternV2, ...MovementPatternV2[]];

const movementTargetSchema = z
  .object({
    kind: z.literal("movement_pattern"),
    movementPattern: z.enum(movementPatternValues),
  })
  .strict();
const muscleTargetSchema = z
  .object({
    kind: z.literal("muscle"),
    muscleId: z.enum(CANONICAL_MUSCLE_IDS),
  })
  .strict();
const acceptedExerciseIntentSchema = z
  .object({
    userRole: z.enum(HYPERTROPHY_USER_ROLE_VALUES),
    target: z.discriminatedUnion("kind", [
      movementTargetSchema,
      muscleTargetSchema,
    ]),
    requiredExerciseClass: z
      .enum(ACCEPTED_EXERCISE_CLASS_CONSTRAINT_VALUES)
      .optional(),
  })
  .strict()
  .superRefine((intent, context) => {
    if (
      (intent.userRole === "PRIMARY_LIFT" ||
        intent.userRole === "SECONDARY_LIFT") &&
      intent.target.kind !== "movement_pattern"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target"],
        message: `${intent.userRole} requires a movement-pattern target`,
      });
    }
    if (
      intent.userRole === "MUSCLE_ISOLATION" &&
      intent.target.kind !== "muscle"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target"],
        message: "MUSCLE_ISOLATION requires a muscle target",
      });
    }
    if (
      intent.requiredExerciseClass &&
      (intent.userRole !== "PRIMARY_LIFT" ||
        intent.target.kind !== "movement_pattern" ||
        intent.target.movementPattern !== "hinge")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredExerciseClass"],
        message:
          "The low-axial exercise-class constraint requires a primary hinge target",
      });
    }
  });

const settingsSchema = z
  .object({
    equipmentProfile: z.enum(EQUIPMENT_PROFILE_VALUES),
    sessionDurationMinutes: z.union(
      HYPERTROPHY_SESSION_DURATION_VALUES.map((value) => z.literal(value)) as [
        z.ZodLiteral<45>,
        z.ZodLiteral<60>,
        z.ZodLiteral<75>,
        z.ZodLiteral<90>,
      ],
    ),
  })
  .strict();

const planWeekV4Schema = z
  .object({
    week: z.number().int().min(1).max(52),
    phase: z.enum(["ACCUMULATION", "DELOAD"]),
  })
  .strict();

const repTargetV4Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("EXACT"),
      reps: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("RANGE"),
      min: z.number().int().min(1).max(100),
      max: z.number().int().min(1).max(100),
    })
    .strict()
    .superRefine((target, context) => {
      if (target.min > target.max) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max"],
          message: "Rep-range maximum must be greater than or equal to its minimum",
        });
      }
    }),
]);

const rirValueV4Schema = z.number().min(0).max(10).multipleOf(0.5);
const rirTargetV4Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("TARGET_RANGE"),
      min: rirValueV4Schema,
      max: rirValueV4Schema,
    })
    .strict()
    .superRefine((target, context) => {
      if (target.min > target.max) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max"],
          message: "RIR maximum must be greater than or equal to its minimum",
        });
      }
    }),
  z.object({ kind: z.literal("NOT_APPLICABLE") }).strict(),
]);

const weeklyPrescriptionV4Schema = z.discriminatedUnion("status", [
  z
    .object({
      week: z.number().int().min(1).max(52),
      status: z.literal("PRESCRIBE"),
      setCount: z.number().int().min(1).max(10),
      reps: repTargetV4Schema,
      rir: rirTargetV4Schema,
    })
    .strict(),
  z
    .object({
      week: z.number().int().min(1).max(52),
      status: z.literal("OMIT"),
    })
    .strict(),
]);

type PrescriptionPlacementV4 = {
  placementId: string;
  prescriptions: WeeklyPrescriptionV4[];
};

function validateV4WeekTopology(
  weeks: HypertrophyPlanWeekV4[],
  context: z.RefinementCtx,
): void {
  weeks.forEach((entry, index) => {
    if (entry.week !== index + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weeks", index, "week"],
        message: "Plan weeks must be contiguous, one-indexed, and ordered",
      });
    }
    if (entry.phase === "DELOAD" && index !== weeks.length - 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weeks", index, "phase"],
        message: "DELOAD is permitted only for the final plan week",
      });
    }
  });
  if (weeks[0]?.phase !== "ACCUMULATION") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["weeks", 0, "phase"],
      message: "A plan must begin with at least one ACCUMULATION week",
    });
  }
}

function validateV4PrescriptionCoverage(input: {
  weeks: HypertrophyPlanWeekV4[];
  containers: Array<{ exercises: PrescriptionPlacementV4[] }>;
  containerPath: "sessions" | "slots";
  context: z.RefinementCtx;
}): void {
  const placementIds = new Set<string>();
  input.containers.forEach((container, containerIndex) => {
    container.exercises.forEach((exercise, exerciseIndex) => {
      const path = [input.containerPath, containerIndex, "exercises", exerciseIndex];
      if (placementIds.has(exercise.placementId)) {
        input.context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, "placementId"],
          message: "Placement IDs must be unique across the plan",
        });
      }
      placementIds.add(exercise.placementId);
      if (exercise.prescriptions.length !== input.weeks.length) {
        input.context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, "prescriptions"],
          message: "Every placement must have exactly one prescription for every plan week",
        });
      }
      exercise.prescriptions.forEach((prescription, prescriptionIndex) => {
        const expectedWeek = input.weeks[prescriptionIndex];
        if (!expectedWeek || prescription.week !== expectedWeek.week) {
          input.context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, "prescriptions", prescriptionIndex, "week"],
            message: "Placement prescriptions must exactly cover plan weeks in order",
          });
          return;
        }
        if (
          prescription.status === "OMIT" &&
          expectedWeek.phase !== "DELOAD"
        ) {
          input.context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, "prescriptions", prescriptionIndex, "status"],
            message: "OMIT is permitted only during the final DELOAD week",
          });
        }
      });
    });
  });
}

const draftExerciseSchema = z
  .object({
    exerciseId: z.string().trim().min(1).max(100),
    workingSets: z.number().int().min(1).max(10),
    intent: acceptedExerciseIntentSchema,
  })
  .strict();

const draftSessionSchema = z
  .object({
    slotId: z.string().trim().min(1).max(40),
    name: z
      .string()
      .transform((value) => value.trim().replace(/\s+/g, " "))
      .pipe(z.string().min(1).max(60)),
    focus: z.enum(HYPERTROPHY_SESSION_FOCUS_VALUES),
    exercises: z.array(draftExerciseSchema).max(20),
  })
  .strict();

export const hypertrophyPlanDraftSchema = z
  .object({
    version: z.literal(1),
    settings: settingsSchema,
    sessions: z.array(draftSessionSchema).min(2).max(6),
  })
  .strict()
  .superRefine((draft, context) => {
    const ids = draft.sessions.map((session) => session.slotId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sessions"],
        message: "Session IDs must be unique",
      });
    }
  });

const draftExerciseV2Schema = z
  .object({
    placementId: z.string().trim().min(1).max(100),
    exerciseId: z.string().trim().min(1).max(100),
    intent: acceptedExerciseIntentSchema,
    preservedMeasurement: z
      .object({
        exerciseId: z.string().trim().min(1).max(100),
        measurement: measurementSemanticsSchema,
      })
      .strict()
      .optional(),
    prescriptions: z.array(weeklyPrescriptionV4Schema).min(1).max(52),
  })
  .strict();

export const hypertrophyPlanDraftV2Schema = z
  .object({
    version: z.literal(2),
    settings: settingsSchema,
    weeks: z.array(planWeekV4Schema).min(1).max(52),
    sessions: z
      .array(
        z
          .object({
            slotId: z.string().trim().min(1).max(40),
            name: z
              .string()
              .transform((value) => value.trim().replace(/\s+/g, " "))
              .pipe(z.string().min(1).max(60)),
            focus: z.enum(HYPERTROPHY_SESSION_FOCUS_VALUES),
            exercises: z.array(draftExerciseV2Schema).max(20),
          })
          .strict(),
      )
      .min(2)
      .max(6),
  })
  .strict()
  .superRefine((draft, context) => {
    const ids = draft.sessions.map((session) => session.slotId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sessions"],
        message: "Session IDs must be unique",
      });
    }
    validateV4WeekTopology(draft.weeks, context);
    validateV4PrescriptionCoverage({
      weeks: draft.weeks,
      containers: draft.sessions,
      containerPath: "sessions",
      context,
    });
  });

const acceptedExerciseSchema = z
  .object({
    exerciseId: z.string().trim().min(1).max(100),
    role: z.enum(["CORE_COMPOUND", "ACCESSORY"]),
    setCount: z.number().int().min(1).max(10),
    intent: acceptedExerciseIntentSchema,
  })
  .strict()
  .superRefine((exercise, context) => {
    const expected = compileExecutableRole(exercise.intent.userRole);
    if (exercise.role !== expected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["role"],
        message: `Executable role must be ${expected}`,
      });
    }
  });

const acceptedExerciseV3Schema = z
  .object({
    exerciseId: z.string().trim().min(1).max(100),
    role: z.enum(["CORE_COMPOUND", "ACCESSORY"]),
    setCount: z.number().int().min(1).max(10),
    intent: acceptedExerciseIntentSchema,
    measurement: measurementSemanticsSchema,
  })
  .strict()
  .superRefine((exercise, context) => {
    const expected = compileExecutableRole(exercise.intent.userRole);
    if (exercise.role !== expected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["role"],
        message: `Executable role must be ${expected}`,
      });
    }
  });

export const acceptedHypertrophySeedV2Schema = z
  .object({
    version: z.literal(2),
    source: z.literal("custom_hypertrophy_plan_v1"),
    settings: settingsSchema,
    slots: z
      .array(
        z
          .object({
            slotId: z.string().trim().min(1).max(40),
            name: z.string().trim().min(1).max(60),
            focus: z.enum(HYPERTROPHY_SESSION_FOCUS_VALUES),
            exercises: z.array(acceptedExerciseSchema).min(1).max(20),
          })
          .strict(),
      )
      .min(2)
      .max(6),
  })
  .strict()
  .superRefine((seed, context) => {
    const ids = seed.slots.map((slot) => slot.slotId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slots"],
        message: "Slot IDs must be unique",
      });
    }
  });

export const acceptedHypertrophySeedV3Schema = z
  .object({
    version: z.literal(3),
    source: z.literal("custom_hypertrophy_plan_v1"),
    settings: settingsSchema,
    slots: z
      .array(
        z
          .object({
            slotId: z.string().trim().min(1).max(40),
            name: z.string().trim().min(1).max(60),
            focus: z.enum(HYPERTROPHY_SESSION_FOCUS_VALUES),
            exercises: z.array(acceptedExerciseV3Schema).min(1).max(20),
          })
          .strict(),
      )
      .min(2)
      .max(6),
  })
  .strict()
  .superRefine((seed, context) => {
    const ids = seed.slots.map((slot) => slot.slotId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slots"],
        message: "Slot IDs must be unique",
      });
    }
  });

const acceptedExerciseV4Schema = z
  .object({
    placementId: z.string().trim().min(1).max(100),
    exerciseId: z.string().trim().min(1).max(100),
    role: z.enum(["CORE_COMPOUND", "ACCESSORY"]),
    intent: acceptedExerciseIntentSchema,
    measurement: measurementSemanticsSchema,
    prescriptions: z.array(weeklyPrescriptionV4Schema).min(1).max(52),
  })
  .strict()
  .superRefine((exercise, context) => {
    const expected = compileExecutableRole(exercise.intent.userRole);
    if (exercise.role !== expected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["role"],
        message: `Executable role must be ${expected}`,
      });
    }
  });

export const acceptedHypertrophySeedV4Schema = z
  .object({
    version: z.literal(4),
    source: z.literal("custom_hypertrophy_plan_v2"),
    settings: settingsSchema,
    weeks: z.array(planWeekV4Schema).min(1).max(52),
    slots: z
      .array(
        z
          .object({
            slotId: z.string().trim().min(1).max(40),
            name: z.string().trim().min(1).max(60),
            focus: z.enum(HYPERTROPHY_SESSION_FOCUS_VALUES),
            exercises: z.array(acceptedExerciseV4Schema).min(1).max(20),
          })
          .strict(),
      )
      .min(2)
      .max(6),
  })
  .strict()
  .superRefine((seed, context) => {
    const ids = seed.slots.map((slot) => slot.slotId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slots"],
        message: "Slot IDs must be unique",
      });
    }
    validateV4WeekTopology(seed.weeks, context);
    validateV4PrescriptionCoverage({
      weeks: seed.weeks,
      containers: seed.slots,
      containerPath: "slots",
      context,
    });
  });

export const executableSeedProjectionV2Schema = z
  .object({
    version: z.literal(2),
    slots: z.array(
      z
        .object({
          slotId: z.string().trim().min(1).max(40),
          exercises: z.array(
            z
              .object({
                exerciseId: z.string().trim().min(1).max(100),
                role: z.enum(["CORE_COMPOUND", "ACCESSORY"]),
                setCount: z.number().int().min(1).max(10),
                measurement: measurementSemanticsSchema,
              })
              .strict(),
          ).min(1),
        })
        .strict(),
    ).min(1),
  })
  .strict();

export const executableSeedProjectionV3Schema = z
  .object({
    version: z.literal(3),
    weeks: z.array(planWeekV4Schema).min(1).max(52),
    slots: z
      .array(
        z
          .object({
            slotId: z.string().trim().min(1).max(40),
            exercises: z
              .array(
                z
                  .object({
                    placementId: z.string().trim().min(1).max(100),
                    exerciseId: z.string().trim().min(1).max(100),
                    role: z.enum(["CORE_COMPOUND", "ACCESSORY"]),
                    intent: acceptedExerciseIntentSchema,
                    measurement: measurementSemanticsSchema,
                    prescriptions: z
                      .array(weeklyPrescriptionV4Schema)
                      .min(1)
                      .max(52),
                  })
                  .strict(),
              )
              .min(1)
              .max(20),
          })
          .strict(),
      )
      .min(2)
      .max(6),
  })
  .strict()
  .superRefine((seed, context) => {
    const ids = seed.slots.map((slot) => slot.slotId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slots"],
        message: "Slot IDs must be unique",
      });
    }
    validateV4WeekTopology(seed.weeks, context);
    validateV4PrescriptionCoverage({
      weeks: seed.weeks,
      containers: seed.slots,
      containerPath: "slots",
      context,
    });
  });

export function parseHypertrophyPlanDraft(
  value: unknown,
): HypertrophyPlanDraftV1 {
  return hypertrophyPlanDraftSchema.parse(value);
}

export function parseHypertrophyPlanDraftV2(
  value: unknown,
): HypertrophyPlanDraftV2 {
  return hypertrophyPlanDraftV2Schema.parse(value);
}

export function parseAcceptedHypertrophySeedV2(
  value: unknown,
): AcceptedHypertrophySeedV2 {
  return acceptedHypertrophySeedV2Schema.parse(value);
}

export function parseAcceptedHypertrophySeedV3(
  value: unknown,
): AcceptedHypertrophySeedV3 {
  return acceptedHypertrophySeedV3Schema.parse(value);
}

export function parseAcceptedHypertrophySeedV4(
  value: unknown,
): AcceptedHypertrophySeedV4 {
  return acceptedHypertrophySeedV4Schema.parse(value);
}

export function parseAcceptedHypertrophySeed(
  value: unknown,
): AcceptedHypertrophySeed {
  return value && typeof value === "object" && !Array.isArray(value) &&
    (value as { version?: unknown }).version === 3
    ? parseAcceptedHypertrophySeedV3(value)
    : parseAcceptedHypertrophySeedV2(value);
}

export function isAcceptedHypertrophySeedV2(
  value: unknown,
): value is AcceptedHypertrophySeedV2 {
  return acceptedHypertrophySeedV2Schema.safeParse(value).success;
}

export function compileExecutableRole(
  role: HypertrophyUserRole,
): "CORE_COMPOUND" | "ACCESSORY" {
  return role === "PRIMARY_LIFT" ? "CORE_COMPOUND" : "ACCESSORY";
}

export function compileAcceptedHypertrophySeed(
  input: HypertrophyPlanDraftV1,
): AcceptedHypertrophySeedV2 {
  const draft = parseHypertrophyPlanDraft(input);
  return parseAcceptedHypertrophySeedV2({
    version: 2,
    source: "custom_hypertrophy_plan_v1",
    settings: draft.settings,
    slots: draft.sessions.map((session) => ({
      slotId: session.slotId,
      name: session.name,
      focus: session.focus,
      exercises: session.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        role: compileExecutableRole(exercise.intent.userRole),
        setCount: exercise.workingSets,
        intent: exercise.intent,
      })),
    })),
  });
}

export function compileAcceptedHypertrophySeedV3(input: {
  draft: HypertrophyPlanDraftV1;
  measurementByExerciseId: ReadonlyMap<string, MeasurementSemantics>;
}): AcceptedHypertrophySeedV3 {
  const draft = parseHypertrophyPlanDraft(input.draft);
  return parseAcceptedHypertrophySeedV3({
    version: 3,
    source: "custom_hypertrophy_plan_v1",
    settings: draft.settings,
    slots: draft.sessions.map((session) => ({
      slotId: session.slotId,
      name: session.name,
      focus: session.focus,
      exercises: session.exercises.map((exercise) => {
        const measurement = input.measurementByExerciseId.get(exercise.exerciseId);
        if (!measurement) {
          throw new Error(`CUSTOM_PLAN_MEASUREMENT_UNCLASSIFIED:${exercise.exerciseId}`);
        }
        return {
          exerciseId: exercise.exerciseId,
          role: compileExecutableRole(exercise.intent.userRole),
          setCount: exercise.workingSets,
          intent: exercise.intent,
          measurement,
        };
      }),
    })),
  });
}

export function compileAcceptedHypertrophySeedV4(input: {
  draft: HypertrophyPlanDraftV2;
  measurementByExerciseId: ReadonlyMap<string, MeasurementSemantics>;
}): AcceptedHypertrophySeedV4 {
  const draft = parseHypertrophyPlanDraftV2(input.draft);
  return parseAcceptedHypertrophySeedV4({
    version: 4,
    source: "custom_hypertrophy_plan_v2",
    settings: draft.settings,
    weeks: draft.weeks,
    slots: draft.sessions.map((session) => ({
      slotId: session.slotId,
      name: session.name,
      focus: session.focus,
      exercises: session.exercises.map((exercise) => {
        const preservedMeasurement =
          exercise.preservedMeasurement?.exerciseId === exercise.exerciseId
            ? exercise.preservedMeasurement.measurement
            : undefined;
        const measurement =
          preservedMeasurement ??
          input.measurementByExerciseId.get(exercise.exerciseId);
        if (!measurement) {
          throw new Error(`CUSTOM_PLAN_MEASUREMENT_UNCLASSIFIED:${exercise.exerciseId}`);
        }
        return {
          placementId: exercise.placementId,
          exerciseId: exercise.exerciseId,
          role: compileExecutableRole(exercise.intent.userRole),
          intent: exercise.intent,
          measurement,
          prescriptions: exercise.prescriptions,
        };
      }),
    })),
  });
}

export function copyAcceptedHypertrophySeedV4ToDraft(
  seed: AcceptedHypertrophySeedV4,
): HypertrophyPlanDraftV2 {
  const accepted = parseAcceptedHypertrophySeedV4(seed);
  return parseHypertrophyPlanDraftV2({
    version: 2,
    settings: accepted.settings,
    weeks: accepted.weeks,
    sessions: accepted.slots.map((slot) => ({
      slotId: slot.slotId,
      name: slot.name,
      focus: slot.focus,
      exercises: slot.exercises.map((exercise) => ({
        placementId: exercise.placementId,
        exerciseId: exercise.exerciseId,
        intent: exercise.intent,
        preservedMeasurement: {
          exerciseId: exercise.exerciseId,
          measurement: exercise.measurement,
        },
        prescriptions: exercise.prescriptions,
      })),
    })),
  });
}

export function projectExecutableSeed(
  seed: AcceptedHypertrophySeedV2,
): ExecutableSeedProjection {
  const accepted = parseAcceptedHypertrophySeedV2(seed);
  return projectExecutableSeedRows(accepted.slots);
}

export function projectExecutableSeedRows(
  slots: ExecutableSeedProjection["slots"],
): ExecutableSeedProjection {
  return {
    version: 1,
    slots: slots.map((slot) => ({
      slotId: slot.slotId,
      exercises: slot.exercises.map(({ exerciseId, role, setCount }) => ({
        exerciseId,
        role,
        setCount,
      })),
    })),
  };
}

export function projectExecutableSeedV3(
  seed: AcceptedHypertrophySeedV3,
): ExecutableSeedProjectionV2 {
  const accepted = parseAcceptedHypertrophySeedV3(seed);
  return executableSeedProjectionV2Schema.parse({
    version: 2,
    slots: accepted.slots.map((slot) => ({
      slotId: slot.slotId,
      exercises: slot.exercises.map(
        ({ exerciseId, role, setCount, measurement }) => ({
          exerciseId,
          role,
          setCount,
          measurement,
        }),
      ),
    })),
  });
}

export function projectExecutableSeedV4(
  seed: AcceptedHypertrophySeedV4,
): ExecutableSeedProjectionV3 {
  const accepted = parseAcceptedHypertrophySeedV4(seed);
  return executableSeedProjectionV3Schema.parse({
    version: 3,
    weeks: accepted.weeks,
    slots: accepted.slots.map((slot) => ({
      slotId: slot.slotId,
      exercises: slot.exercises.map(
        ({
          placementId,
          exerciseId,
          role,
          intent,
          measurement,
          prescriptions,
        }) => ({
          placementId,
          exerciseId,
          role,
          intent,
          measurement,
          prescriptions,
        }),
      ),
    })),
  });
}

export function buildAcceptedCompatibilityProjections(
  seed: AcceptedHypertrophySeed,
): {
  slotSequenceJson: AuthoringJsonValue;
  slotPlanSeedJson: AuthoringJsonValue;
} {
  const accepted = parseAcceptedHypertrophySeed(seed);
  return {
    slotSequenceJson: {
      version: 1,
      source: "custom_hypertrophy_plan_v1",
      sequenceMode: "ordered_flexible",
      sessionsPerWeek: accepted.slots.length,
      daysPerWeek: accepted.slots.length,
      splitType: splitTypeForFocuses(accepted.slots.map((slot) => slot.focus)),
      slots: accepted.slots.map((slot) => ({
        slotId: slot.slotId,
        intent: slot.focus,
        label: slot.name,
      })),
    },
    slotPlanSeedJson: {
      version: 1,
      source: "custom_hypertrophy_plan_v1",
      slots: accepted.slots.map((slot) => ({
        slotId: slot.slotId,
        exercises: slot.exercises.map(({ exerciseId, role, setCount }) => ({
          exerciseId,
          role,
          setCount,
        })),
      })),
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function assertAcceptedCompatibilityAlignment(input: {
  acceptedSeed: AcceptedHypertrophySeed;
  slotSequenceJson: unknown;
  slotPlanSeedJson: unknown;
}): void {
  const accepted = parseAcceptedHypertrophySeed(input.acceptedSeed);
  const sequence = record(input.slotSequenceJson);
  const sequenceSlots = Array.isArray(sequence?.slots) ? sequence.slots : [];
  const seed = record(input.slotPlanSeedJson);
  const seedSlots = Array.isArray(seed?.slots) ? seed.slots : [];
  if (
    sequenceSlots.length !== accepted.slots.length ||
    seedSlots.length !== accepted.slots.length ||
    sequence?.sessionsPerWeek !== accepted.slots.length ||
    sequence?.daysPerWeek !== accepted.slots.length
  ) {
    throw new Error("CUSTOM_PLAN_COMPATIBILITY_SLOT_COUNT_MISMATCH");
  }

  accepted.slots.forEach((slot, index) => {
    const projectedSequence = record(sequenceSlots[index]);
    const projectedSeed = record(seedSlots[index]);
    if (
      projectedSequence?.slotId !== slot.slotId ||
      projectedSequence.intent !== slot.focus ||
      projectedSequence.label !== slot.name ||
      projectedSeed?.slotId !== slot.slotId
    ) {
      throw new Error("CUSTOM_PLAN_COMPATIBILITY_SLOT_MISMATCH");
    }
    const exercises = Array.isArray(projectedSeed.exercises)
      ? projectedSeed.exercises
      : [];
    if (exercises.length !== slot.exercises.length) {
      throw new Error("CUSTOM_PLAN_COMPATIBILITY_EXERCISE_COUNT_MISMATCH");
    }
    slot.exercises.forEach((exercise, exerciseIndex) => {
      const projected = record(exercises[exerciseIndex]);
      if (
        projected?.exerciseId !== exercise.exerciseId ||
        projected.role !== exercise.role ||
        projected.setCount !== exercise.setCount
      ) {
        throw new Error("CUSTOM_PLAN_COMPATIBILITY_EXERCISE_MISMATCH");
      }
    });
  });
}

function splitTypeForFocuses(focuses: HypertrophySessionFocus[]) {
  const set = new Set(focuses);
  if ([...set].every((focus) => focus === "UPPER" || focus === "LOWER")) {
    return "UPPER_LOWER";
  }
  if ([...set].every((focus) => focus === "PUSH" || focus === "PULL" || focus === "LEGS")) {
    return "PPL";
  }
  if (set.size === 1 && set.has("FULL_BODY")) return "FULL_BODY";
  return "CUSTOM";
}

export type ManualHypertrophyPreset =
  | "FULL_BODY_2"
  | "FULL_BODY_3"
  | "PPL_3"
  | "UPPER_LOWER_4"
  | "PPL_6"
  | "BLANK";

const PRESET_SESSIONS: Record<
  Exclude<ManualHypertrophyPreset, "BLANK">,
  Array<{ name: string; focus: HypertrophySessionFocus }>
> = {
  FULL_BODY_2: [
    { name: "Full Body A", focus: "FULL_BODY" },
    { name: "Full Body B", focus: "FULL_BODY" },
  ],
  FULL_BODY_3: [
    { name: "Full Body A", focus: "FULL_BODY" },
    { name: "Full Body B", focus: "FULL_BODY" },
    { name: "Full Body C", focus: "FULL_BODY" },
  ],
  PPL_3: [
    { name: "Push", focus: "PUSH" },
    { name: "Pull", focus: "PULL" },
    { name: "Legs", focus: "LEGS" },
  ],
  UPPER_LOWER_4: [
    { name: "Upper A", focus: "UPPER" },
    { name: "Lower A", focus: "LOWER" },
    { name: "Upper B", focus: "UPPER" },
    { name: "Lower B", focus: "LOWER" },
  ],
  PPL_6: [
    { name: "Push A", focus: "PUSH" },
    { name: "Pull A", focus: "PULL" },
    { name: "Legs A", focus: "LEGS" },
    { name: "Push B", focus: "PUSH" },
    { name: "Pull B", focus: "PULL" },
    { name: "Legs B", focus: "LEGS" },
  ],
};

export function buildManualHypertrophyDraft(input: {
  settings: HypertrophyPlanDraftV1["settings"];
  sessionsPerWeek: number;
  preset: ManualHypertrophyPreset;
  createSlotId?: () => string;
}): HypertrophyPlanDraftV1 {
  const createSlotId = input.createSlotId ?? (() => crypto.randomUUID());
  const template =
    input.preset === "BLANK"
      ? Array.from({ length: input.sessionsPerWeek }, (_, index) => ({
          name: `Session ${index + 1}`,
          focus: "BODY_PART" as const,
        }))
      : PRESET_SESSIONS[input.preset];
  if (template.length !== input.sessionsPerWeek) {
    throw new Error("CUSTOM_PLAN_PRESET_FREQUENCY_MISMATCH");
  }
  return parseHypertrophyPlanDraft({
    version: 1,
    settings: input.settings,
    sessions: template.map((session) => ({
      slotId: createSlotId(),
      name: session.name,
      focus: session.focus,
      exercises: [],
    })),
  });
}

const MOVEMENT_BY_LANE: Record<string, MovementPatternV2> = {
  chest_anchor: "horizontal_push",
  row_anchor: "horizontal_pull",
  vertical_pull_support: "vertical_pull",
  squat_anchor: "squat",
  secondary_hinge: "hinge",
  vertical_press: "vertical_push",
  vertical_pull_anchor: "vertical_pull",
  row_support: "horizontal_pull",
  hinge_anchor: "hinge",
  quad_support: "squat",
};

function canonicalMuscleId(value: string | undefined): CanonicalMuscleId | null {
  if (!value) return null;
  return getMusclePolicyByDisplayName(value)?.id ?? null;
}

function movementForLane(
  lane: V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"][number]["slots"][number]["lanes"][number],
): MovementPatternV2 | null {
  const required = lane.laneSelectionIntent?.requiredMovementPattern;
  if (
    required &&
    movementPatternValues.includes(required as MovementPatternV2)
  ) {
    return required as MovementPatternV2;
  }
  return MOVEMENT_BY_LANE[lane.laneId] ?? null;
}

function requiredExerciseClassForLane(
  lane: V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"][number]["slots"][number]["lanes"][number],
): AcceptedExerciseClassConstraint | undefined {
  const intent = lane.laneSelectionIntent;
  return lane.role === "anchor" &&
    intent?.requiredMovementPattern === "low_axial_hip_extension" &&
    intent.allowedExerciseClasses.includes("low_axial_hip_extension_anchor")
    ? "low_axial_hip_extension_anchor"
    : undefined;
}

function intentForV2Lane(
  lane: V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"][number]["slots"][number]["lanes"][number],
): AcceptedExerciseIntentV2 {
  const movementPattern = movementForLane(lane);
  const requiredExerciseClass = requiredExerciseClassForLane(lane);
  if (lane.role === "anchor") {
    if (!movementPattern) {
      throw new Error(`CUSTOM_PLAN_V2_ANCHOR_TARGET_MISSING:${lane.laneId}`);
    }
    return {
      userRole: "PRIMARY_LIFT",
      target: { kind: "movement_pattern", movementPattern },
      ...(requiredExerciseClass ? { requiredExerciseClass } : {}),
    };
  }
  if (lane.role === "support" && movementPattern) {
    return {
      userRole: "SECONDARY_LIFT",
      target: { kind: "movement_pattern", movementPattern },
    };
  }
  const muscleId = canonicalMuscleId(lane.primaryMuscles[0]);
  if (!muscleId) {
    throw new Error(`CUSTOM_PLAN_V2_MUSCLE_TARGET_MISSING:${lane.laneId}`);
  }
  return {
    userRole:
      lane.role === "optional" ? "ACCESSORY" : "MUSCLE_ISOLATION",
    target: { kind: "muscle", muscleId },
  };
}

export function adaptV2MaterializedPlanToDraft(input: {
  settings: HypertrophyPlanDraftV1["settings"];
  plannerPolicy: V2PlannerMesocyclePolicy;
  materializedPlan: V2ExerciseMaterializationPlan;
}): HypertrophyPlanDraftV1 {
  if (input.materializedPlan.status !== "materialized") {
    throw new Error("CUSTOM_PLAN_V2_MATERIALIZATION_BLOCKED");
  }
  const policySlots = input.plannerPolicy.exerciseSelectionPlan.weeks[0]?.slots;
  if (!policySlots) throw new Error("CUSTOM_PLAN_V2_POLICY_MISSING");
  const names: Record<string, { name: string; focus: HypertrophySessionFocus }> = {
    upper_a: { name: "Upper A", focus: "UPPER" },
    lower_a: { name: "Lower A", focus: "LOWER" },
    upper_b: { name: "Upper B", focus: "UPPER" },
    lower_b: { name: "Lower B", focus: "LOWER" },
  };
  return parseHypertrophyPlanDraft({
    version: 1,
    settings: input.settings,
    sessions: input.materializedPlan.slots.map((slot) => {
      const policySlot = policySlots.find((candidate) => candidate.slotId === slot.slotId);
      const display = names[slot.slotId];
      if (!policySlot || !display) {
        throw new Error(`CUSTOM_PLAN_V2_SLOT_UNKNOWN:${slot.slotId}`);
      }
      return {
        slotId: slot.slotId,
        name: display.name,
        focus: display.focus,
        exercises: slot.exercises.map((exercise) => {
          const laneId = exercise.laneIds[0];
          const lane = policySlot.lanes.find((candidate) => candidate.laneId === laneId);
          if (!lane || exercise.laneIds.length !== 1) {
            throw new Error(`CUSTOM_PLAN_V2_LANE_UNKNOWN:${slot.slotId}:${laneId ?? "missing"}`);
          }
          return {
            exerciseId: exercise.exerciseId,
            workingSets: exercise.setCount,
            intent: intentForV2Lane(lane),
          };
        }),
      };
    }),
  });
}

export type HypertrophyAuthoringExercise = {
  id: string;
  name: string;
  aliases?: string[];
  movementPatterns: MovementPatternV2[];
  primaryMuscleIds: CanonicalMuscleId[];
  secondaryMuscleIds: CanonicalMuscleId[];
  stimulusByMuscleId?: Partial<Record<CanonicalMuscleId, number>>;
  equipment: string[];
  contraindicationKeys: string[];
  isCompound: boolean;
  isMainLiftEligible: boolean;
  timePerSetSec: number;
  isFavorite?: boolean;
};

export function getHypertrophyAuthoringStimulus(
  exercise: HypertrophyAuthoringExercise,
  workingSets: number,
): Map<CanonicalMuscleId, number> {
  const contribution = getEffectiveStimulusByMuscleId(
    {
      id: exercise.id,
      name: exercise.name,
      aliases: exercise.aliases,
      primaryMuscles: exercise.primaryMuscleIds.map(
        (muscleId) => MUSCLE_POLICY_BY_ID[muscleId].displayName,
      ),
      secondaryMuscles: exercise.secondaryMuscleIds.map(
        (muscleId) => MUSCLE_POLICY_BY_ID[muscleId].displayName,
      ),
    },
    workingSets,
    { logFallback: false },
  );
  return new Map(
    CANONICAL_MUSCLE_IDS.flatMap((muscleId) => {
      const value = contribution.get(muscleId);
      return value == null ? [] : [[muscleId, value] as const];
    }),
  );
}

const CUSTOM_HYPERTROPHY_ADDITIONAL_EQUIPMENT: Partial<
  Record<EquipmentProfile, readonly EquipmentType[]>
> = {
  BARBELL_HOME: ["ez_bar", "trap_bar"],
  MACHINES: ["band"],
};

export function equipmentForCustomHypertrophyProfile(
  profile: EquipmentProfile,
): readonly EquipmentType[] | null {
  const equipment = equipmentForProfile(profile);
  if (!equipment) return null;
  return [
    ...new Set([
      ...equipment,
      ...(CUSTOM_HYPERTROPHY_ADDITIONAL_EQUIPMENT[profile] ?? []),
    ]),
  ];
}

function isCustomHypertrophyEquipmentCompatible(
  requiredEquipment: readonly string[],
  profile: EquipmentProfile,
): boolean {
  if (isEquipmentProfileCompatible(requiredEquipment, profile)) return true;
  const additional = new Set(
    CUSTOM_HYPERTROPHY_ADDITIONAL_EQUIPMENT[profile] ?? [],
  );
  return requiredEquipment.some((item) =>
    additional.has(item.trim().toLowerCase() as EquipmentType),
  );
}

function toExerciseClassInput(
  exercise: HypertrophyAuthoringExercise,
): V2MaterializationExercise {
  const stimulusByMuscleId = getHypertrophyAuthoringStimulus(exercise, 1);
  return {
    exerciseId: exercise.id,
    name: exercise.name,
    aliases: exercise.aliases ?? [],
    movementPatterns: exercise.movementPatterns,
    primaryMuscles: exercise.primaryMuscleIds.map(
      (muscleId) => MUSCLE_POLICY_BY_ID[muscleId].displayName,
    ),
    secondaryMuscles: exercise.secondaryMuscleIds.map(
      (muscleId) => MUSCLE_POLICY_BY_ID[muscleId].displayName,
    ),
    equipment: exercise.equipment,
    isCompound: exercise.isCompound,
    isMainLiftEligible: exercise.isMainLiftEligible,
    stimulusByMusclePerSet: Object.fromEntries(
      CANONICAL_MUSCLE_IDS.flatMap((muscleId) => {
        const stimulus = stimulusByMuscleId.get(muscleId);
        return stimulus == null
          ? []
          : [[MUSCLE_POLICY_BY_ID[muscleId].displayName, stimulus] as const];
      }),
    ),
  };
}

export type HypertrophySemanticEligibilityReason =
  | "REQUIRED_EXERCISE_CLASS_MISMATCH"
  | "MOVEMENT_TARGET_MISMATCH"
  | "MUSCLE_TARGET_MISMATCH"
  | "ROLE_REQUIRES_COMPOUND";

export type HypertrophySemanticEligibilityDecision =
  | { eligible: true }
  | {
      eligible: false;
      reasonCode: HypertrophySemanticEligibilityReason;
    };

export function evaluateHypertrophySemanticIntent(input: {
  exercise: V2MaterializationExercise;
  intent: AcceptedExerciseIntentV2;
}): HypertrophySemanticEligibilityDecision {
  const { exercise, intent } = input;
  if (
    intent.requiredExerciseClass &&
    !matchV2ExerciseClasses(exercise).some(
      (match) => match.classId === intent.requiredExerciseClass,
    )
  ) {
    return {
      eligible: false,
      reasonCode: "REQUIRED_EXERCISE_CLASS_MISMATCH",
    };
  }

  if (intent.target.kind === "movement_pattern") {
    const target = normalizeV2MaterializationText(
      intent.target.movementPattern,
    );
    if (
      !exercise.movementPatterns.some(
        (pattern) => normalizeV2MaterializationText(pattern) === target,
      )
    ) {
      return { eligible: false, reasonCode: "MOVEMENT_TARGET_MISMATCH" };
    }
  } else {
    const target = normalizeV2MaterializationText(
      MUSCLE_POLICY_BY_ID[intent.target.muscleId].displayName,
    );
    const matchesMuscle = [
      ...exercise.primaryMuscles,
      ...exercise.secondaryMuscles,
    ].some(
      (muscle) => normalizeV2MaterializationText(muscle) === target,
    );
    const hasStimulus = Object.entries(
      exercise.stimulusByMusclePerSet,
    ).some(
      ([muscle, stimulus]) =>
        normalizeV2MaterializationText(muscle) === target && stimulus > 0,
    );
    if (!matchesMuscle && !hasStimulus) {
      return { eligible: false, reasonCode: "MUSCLE_TARGET_MISMATCH" };
    }
  }

  if (
    (intent.userRole === "PRIMARY_LIFT" ||
      intent.userRole === "SECONDARY_LIFT") &&
    !exercise.isCompound
  ) {
    return { eligible: false, reasonCode: "ROLE_REQUIRES_COMPOUND" };
  }

  return { eligible: true };
}

export type HypertrophyPlanHealth = {
  blockers: Array<{
    code: string;
    message: string;
    slotId?: string;
    exerciseId?: string;
  }>;
  warnings: Array<{
    code: string;
    message: string;
    slotId?: string;
    exerciseId?: string;
  }>;
  muscles: Array<{
    muscleId: CanonicalMuscleId;
    directSets: number;
    effectiveSets: number;
    frequency: number;
  }>;
  sessions: Array<{ slotId: string; estimatedMinutes: number }>;
};

export function isExerciseEligibleForIntent(input: {
  exercise: HypertrophyAuthoringExercise;
  intent: AcceptedExerciseIntentV2;
  equipmentProfile: EquipmentProfile;
  limitationKeys: readonly string[];
}): boolean {
  return (
    isExerciseAvailableForHypertrophyPlan(input) &&
    evaluateHypertrophySemanticIntent({
      exercise: toExerciseClassInput(input.exercise),
      intent: input.intent,
    }).eligible
  );
}

export function isExerciseAvailableForHypertrophyPlan(input: {
  exercise: HypertrophyAuthoringExercise;
  equipmentProfile: EquipmentProfile;
  limitationKeys: readonly string[];
}): boolean {
  return (
    isCustomHypertrophyEquipmentCompatible(
      input.exercise.equipment,
      input.equipmentProfile,
    ) &&
    !input.exercise.contraindicationKeys.some((key) =>
      input.limitationKeys.includes(key),
    )
  );
}

export function evaluateHypertrophyPlanHealth(input: {
  draft: HypertrophyPlanDraftV1;
  exercises: HypertrophyAuthoringExercise[];
  limitationKeys: readonly string[];
}): HypertrophyPlanHealth {
  const draft = parseHypertrophyPlanDraft(input.draft);
  const catalog = new Map(input.exercises.map((exercise) => [exercise.id, exercise]));
  const blockers: HypertrophyPlanHealth["blockers"] = [];
  const warnings: HypertrophyPlanHealth["warnings"] = [];
  const directSets = new Map<CanonicalMuscleId, number>();
  const effectiveSets = new Map<CanonicalMuscleId, number>();
  const frequency = new Map<CanonicalMuscleId, Set<string>>();
  const sessions: HypertrophyPlanHealth["sessions"] = [];

  for (const session of draft.sessions) {
    if (session.exercises.length === 0) {
      blockers.push({
        code: "EMPTY_SESSION",
        message: `${session.name} needs at least one exercise.`,
        slotId: session.slotId,
      });
    }
    const seenExercises = new Set<string>();
    const patternCounts = new Map<string, number>();
    let durationSeconds = 5 * 60;
    for (const row of session.exercises) {
      const exercise = catalog.get(row.exerciseId);
      if (!exercise) {
        blockers.push({
          code: "EXERCISE_UNAVAILABLE",
          message: "An exercise is no longer available.",
          slotId: session.slotId,
          exerciseId: row.exerciseId,
        });
        continue;
      }
      if (seenExercises.has(row.exerciseId)) {
        warnings.push({
          code: "DUPLICATE_EXERCISE",
          message: `${exercise.name} appears more than once in ${session.name}.`,
          slotId: session.slotId,
          exerciseId: row.exerciseId,
        });
      }
      seenExercises.add(row.exerciseId);
      if (
        !isCustomHypertrophyEquipmentCompatible(
          exercise.equipment,
          draft.settings.equipmentProfile,
        )
      ) {
        blockers.push({
          code: "EQUIPMENT_CONFLICT",
          message: `${exercise.name} does not match the selected equipment.`,
          slotId: session.slotId,
          exerciseId: row.exerciseId,
        });
      }
      if (
        exercise.contraindicationKeys.some((key) =>
          input.limitationKeys.includes(key),
        )
      ) {
        blockers.push({
          code: "LIMITATION_CONFLICT",
          message: `${exercise.name} conflicts with a confirmed limitation.`,
          slotId: session.slotId,
          exerciseId: row.exerciseId,
        });
      }
      const semanticEligibility = evaluateHypertrophySemanticIntent({
        exercise: toExerciseClassInput(exercise),
        intent: row.intent,
      });
      if (
        !semanticEligibility.eligible &&
        semanticEligibility.reasonCode ===
          "REQUIRED_EXERCISE_CLASS_MISMATCH"
      ) {
        blockers.push({
          code: "REQUIRED_EXERCISE_CLASS_MISMATCH",
          message: `${exercise.name} does not satisfy the required low-axial exercise class.`,
          slotId: session.slotId,
          exerciseId: row.exerciseId,
        });
      } else if (!semanticEligibility.eligible) {
        blockers.push({
          code: "ROLE_TARGET_MISMATCH",
          message: `${exercise.name} does not satisfy its role and target.`,
          slotId: session.slotId,
          exerciseId: row.exerciseId,
        });
      }
      durationSeconds += exercise.timePerSetSec * row.workingSets + 60;
      for (const muscleId of exercise.primaryMuscleIds) {
        directSets.set(muscleId, (directSets.get(muscleId) ?? 0) + row.workingSets);
      }
      const contribution = getHypertrophyAuthoringStimulus(
        exercise,
        row.workingSets,
      );
      addStimulusContribution(effectiveSets, contribution);
      for (const [muscleId, stimulus] of contribution) {
        if (stimulus <= 0) continue;
        const slots = frequency.get(muscleId) ?? new Set<string>();
        slots.add(session.slotId);
        frequency.set(muscleId, slots);
      }
      for (const pattern of exercise.movementPatterns) {
        patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);
      }
    }
    const estimatedMinutes = Math.max(1, Math.round(durationSeconds / 60));
    sessions.push({ slotId: session.slotId, estimatedMinutes });
    if (estimatedMinutes > draft.settings.sessionDurationMinutes * 1.2) {
      warnings.push({
        code: "SESSION_DURATION_HIGH",
        message: `${session.name} is estimated at about ${estimatedMinutes} minutes.`,
        slotId: session.slotId,
      });
    }
    for (const [pattern, count] of patternCounts) {
      if (count >= 3) {
        warnings.push({
          code: "MOVEMENT_REDUNDANCY",
          message: `${session.name} has ${count} ${pattern.replaceAll("_", " ")} exercises.`,
          slotId: session.slotId,
        });
      }
    }
  }

  const muscles = MUSCLE_POLICIES.map((policy) => ({
    muscleId: policy.id,
    directSets: directSets.get(policy.id) ?? 0,
    effectiveSets: Math.round((effectiveSets.get(policy.id) ?? 0) * 10) / 10,
    frequency: frequency.get(policy.id)?.size ?? 0,
  }));
  for (const muscle of muscles) {
    const policy = MUSCLE_POLICY_BY_ID[muscle.muscleId];
    if (policy.volume.mev > 0 && muscle.effectiveSets < policy.volume.mev) {
      warnings.push({
        code: muscle.effectiveSets === 0 ? "MISSING_COVERAGE" : "THIN_COVERAGE",
        message: `${policy.displayName} coverage is ${muscle.effectiveSets === 0 ? "missing" : "thin"}.`,
      });
    }
    if (muscle.effectiveSets > policy.volume.mrv) {
      warnings.push({
        code: "VOLUME_HIGH",
        message: `${policy.displayName} volume is unusually high.`,
      });
    }
  }

  return { blockers, warnings, muscles, sessions };
}
