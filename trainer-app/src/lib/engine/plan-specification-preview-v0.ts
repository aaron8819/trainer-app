import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalizeJson } from "@/lib/canonical-json";
import {
  ACCEPTED_EXERCISE_CLASS_CONSTRAINT_VALUES,
  HYPERTROPHY_SESSION_FOCUS_VALUES,
  acceptedExerciseIntentSchema,
  acceptedExerciseTargetSchema,
  compileAcceptedHypertrophySeed,
  hypertrophyPlanSettingsSchema,
  parseHypertrophyPlanDraft,
  projectExecutableSeed,
  type ExecutableSeedProjection,
  type HypertrophyPlanDraftV1,
} from "./hypertrophy-plan-authoring";

export const PLAN_SPECIFICATION_PREVIEW_V0_COMPILER_VERSION =
  "plan-specification-preview-v0-compiler.0" as const;

export const PLAN_SPECIFICATION_PREVIEW_V0_DEFAULTS = {
  continuity: "FLEXIBLE",
} as const;

export const PLAN_SPECIFICATION_PREVIEW_V0_UNSUPPORTED_CONCEPTS = [
  {
    concept: "rep targets and ranges",
    status: "deferred",
    reason:
      "The current executable seed does not carry rep targets; runtime prescription still owns them.",
  },
  {
    concept: "progression policy",
    status: "deferred",
    reason:
      "The current executable seed does not carry a progression-policy reference or override.",
  },
  {
    concept: "deload execution inputs",
    status: "deferred",
    reason:
      "V0 records only the fixed four-plus-one phase intent; current runtime owns deload transforms.",
  },
  {
    concept: "preparation and optional closeout layers",
    status: "unsupported",
    reason:
      "The current executable seed cannot distinguish these layers from programmed work.",
  },
  {
    concept: "measurement profiles and equipment load conventions",
    status: "unsupported",
    reason:
      "The current executable seed cannot carry typed measurement meaning.",
  },
  {
    concept: "fixed weekdays and calendar scheduling",
    status: "deferred",
    reason:
      "V0 preserves ordered slots only; the executable seed has no weekday schedule contract.",
  },
  {
    concept: "persistent revisions, acceptance, activation, and runtime fallback",
    status: "unsupported",
    reason:
      "This proof is deliberately non-persisted and cannot promote or execute a specification.",
  },
] as const;

const normalizedId = z.string().trim().min(1).max(100);
const normalizedLabel = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1).max(100));

const prioritySchema = z
  .object({
    priorityId: normalizedId,
    rank: z.number().int().min(1).max(5),
    kind: z.enum([
      "LIFT_SKILL",
      "MUSCLE_OR_REGION",
      "MOVEMENT_PATTERN",
      "EMPHASIS",
    ]),
    targetId: normalizedId,
    objective: z.enum(["MAINTAIN", "DEVELOP", "SPECIALIZE"]),
  })
  .strict();

const placementSchema = z
  .object({
    candidatePlacementId: normalizedId,
    exerciseId: normalizedId,
    layer: z.literal("PROGRAMMED_WORK"),
    prominence: z.enum(["PRIMARY", "SECONDARY", "ACCESSORY"]),
    continuity: z
      .enum(["ANCHOR", "FLEXIBLE"])
      .default(PLAN_SPECIFICATION_PREVIEW_V0_DEFAULTS.continuity),
    priorityIds: z.array(normalizedId).max(5),
    setCount: z.number().int().min(1).max(10),
    target: acceptedExerciseTargetSchema,
    requiredExerciseClass: z
      .enum(ACCEPTED_EXERCISE_CLASS_CONSTRAINT_VALUES)
      .optional(),
  })
  .strict()
  .superRefine((placement, context) => {
    const intent = acceptedExerciseIntentSchema.safeParse({
      userRole:
        placement.prominence === "PRIMARY"
          ? "PRIMARY_LIFT"
          : placement.prominence === "SECONDARY"
            ? "SECONDARY_LIFT"
            : "ACCESSORY",
      target: placement.target,
      ...(placement.requiredExerciseClass
        ? { requiredExerciseClass: placement.requiredExerciseClass }
        : {}),
    });
    for (const issue of intent.success ? [] : intent.error.issues) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: issue.path[0] === "userRole" ? ["prominence"] : issue.path,
        message: issue.message,
      });
    }
  });

const sessionSchema = z
  .object({
    slotId: normalizedId,
    name: normalizedLabel,
    focus: z.enum(HYPERTROPHY_SESSION_FOCUS_VALUES),
    placements: z.array(placementSchema).min(1).max(20),
  })
  .strict();

export const planSpecificationPreviewV0Schema = z
  .object({
    version: z.literal(0),
    metadata: z
      .object({
        planName: normalizedLabel,
        authoringSource: z.literal("USER_AUTHORED"),
      })
      .strict(),
    primaryGoal: z.literal("HYPERTROPHY"),
    constraints: hypertrophyPlanSettingsSchema,
    phaseIntent: z
      .object({
        accumulationWeeks: z.literal(4),
        deloadWeeks: z.literal(1),
      })
      .strict(),
    priorities: z.array(prioritySchema).min(1).max(5),
    sessions: z.array(sessionSchema).length(4),
  })
  .strict()
  .superRefine((specification, context) => {
    const priorityIds = specification.priorities.map(
      (priority) => priority.priorityId,
    );
    if (new Set(priorityIds).size !== priorityIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["priorities"],
        message: "Priority IDs must be unique",
      });
    }
    const ranks = specification.priorities.map((priority) => priority.rank);
    if (
      new Set(ranks).size !== ranks.length ||
      [...ranks].sort((left, right) => left - right).some(
        (rank, index) => rank !== index + 1,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["priorities"],
        message: "Priority ranks must be unique and contiguous from 1",
      });
    }

    const slotIds = specification.sessions.map((session) => session.slotId);
    if (new Set(slotIds).size !== slotIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sessions"],
        message: "Session slot IDs must be unique",
      });
    }

    const knownPriorityIds = new Set(priorityIds);
    const placementIds = new Set<string>();
    specification.sessions.forEach((session, sessionIndex) => {
      session.placements.forEach((placement, placementIndex) => {
        if (placementIds.has(placement.candidatePlacementId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              "sessions",
              sessionIndex,
              "placements",
              placementIndex,
              "candidatePlacementId",
            ],
            message: "Candidate placement IDs must be globally unique",
          });
        }
        placementIds.add(placement.candidatePlacementId);
        for (const priorityId of placement.priorityIds) {
          if (!knownPriorityIds.has(priorityId)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [
                "sessions",
                sessionIndex,
                "placements",
                placementIndex,
                "priorityIds",
              ],
              message: `Unknown priority ID: ${priorityId}`,
            });
          }
        }
      });
    });
  });

export type PlanSpecificationPreviewV0 = z.output<
  typeof planSpecificationPreviewV0Schema
>;

export type PlanSpecificationPreviewV0PlacementMetadata = {
  candidatePlacementId: string;
  continuity?: "ANCHOR" | "FLEXIBLE";
  priorityIds: string[];
};

export type PlanSpecificationPreviewV0ValidationFinding = {
  code: string;
  path: string;
  message: string;
};

function userRoleToProminence(
  role: HypertrophyPlanDraftV1["sessions"][number]["exercises"][number]["intent"]["userRole"],
): "PRIMARY" | "SECONDARY" | "ACCESSORY" {
  if (role === "PRIMARY_LIFT") return "PRIMARY";
  if (role === "SECONDARY_LIFT") return "SECONDARY";
  return "ACCESSORY";
}

function prominenceToUserRole(
  prominence: "PRIMARY" | "SECONDARY" | "ACCESSORY",
): "PRIMARY_LIFT" | "SECONDARY_LIFT" | "ACCESSORY" {
  if (prominence === "PRIMARY") return "PRIMARY_LIFT";
  if (prominence === "SECONDARY") return "SECONDARY_LIFT";
  return "ACCESSORY";
}

export function parsePlanSpecificationPreviewV0(
  input: unknown,
): PlanSpecificationPreviewV0 {
  return planSpecificationPreviewV0Schema.parse(input);
}

export function adaptHypertrophyPlanDraftToPlanSpecificationPreviewV0(input: {
  draft: HypertrophyPlanDraftV1;
  metadata: PlanSpecificationPreviewV0["metadata"];
  priorities: PlanSpecificationPreviewV0["priorities"];
  placementMetadata: PlanSpecificationPreviewV0PlacementMetadata[];
}): PlanSpecificationPreviewV0 {
  const draft = parseHypertrophyPlanDraft(input.draft);
  const placementCount = draft.sessions.reduce(
    (count, session) => count + session.exercises.length,
    0,
  );
  if (input.placementMetadata.length !== placementCount) {
    throw new Error("PLAN_SPECIFICATION_PREVIEW_V0_PLACEMENT_METADATA_MISMATCH");
  }

  let placementIndex = 0;
  return parsePlanSpecificationPreviewV0({
    version: 0,
    metadata: input.metadata,
    primaryGoal: "HYPERTROPHY",
    constraints: draft.settings,
    phaseIntent: { accumulationWeeks: 4, deloadWeeks: 1 },
    priorities: input.priorities,
    sessions: draft.sessions.map((session) => ({
      slotId: session.slotId,
      name: session.name,
      focus: session.focus,
      placements: session.exercises.map((exercise) => {
        const metadata = input.placementMetadata[placementIndex++];
        if (!metadata) {
          throw new Error(
            "PLAN_SPECIFICATION_PREVIEW_V0_PLACEMENT_METADATA_MISMATCH",
          );
        }
        return {
          candidatePlacementId: metadata.candidatePlacementId,
          exerciseId: exercise.exerciseId,
          layer: "PROGRAMMED_WORK",
          prominence: userRoleToProminence(exercise.intent.userRole),
          ...(metadata.continuity
            ? { continuity: metadata.continuity }
            : {}),
          priorityIds: metadata.priorityIds,
          setCount: exercise.workingSets,
          target: exercise.intent.target,
          ...(exercise.intent.requiredExerciseClass
            ? { requiredExerciseClass: exercise.intent.requiredExerciseClass }
            : {}),
        };
      }),
    })),
  });
}

export function adaptPlanSpecificationPreviewV0ToHypertrophyDraft(
  input: PlanSpecificationPreviewV0,
): HypertrophyPlanDraftV1 {
  const specification = parsePlanSpecificationPreviewV0(input);
  return parseHypertrophyPlanDraft({
    version: 1,
    settings: specification.constraints,
    sessions: specification.sessions.map((session) => ({
      slotId: session.slotId,
      name: session.name,
      focus: session.focus,
      exercises: session.placements.map((placement) => ({
        exerciseId: placement.exerciseId,
        workingSets: placement.setCount,
        intent: {
          userRole: prominenceToUserRole(placement.prominence),
          target: placement.target,
          ...(placement.requiredExerciseClass
            ? { requiredExerciseClass: placement.requiredExerciseClass }
            : {}),
        },
      })),
    })),
  });
}

export function compilePlanSpecificationPreviewV0(
  input: PlanSpecificationPreviewV0,
): ExecutableSeedProjection {
  const draft = adaptPlanSpecificationPreviewV0ToHypertrophyDraft(input);
  return projectExecutableSeed(compileAcceptedHypertrophySeed(draft));
}

export function canonicalizePlanSpecificationPreviewV0(input: {
  specification: PlanSpecificationPreviewV0;
}): { canonicalSemanticJson: string; semanticHash: string } {
  const normalized = parsePlanSpecificationPreviewV0(input.specification);
  const semanticSpecification = {
    version: normalized.version,
    primaryGoal: normalized.primaryGoal,
    constraints: normalized.constraints,
    phaseIntent: normalized.phaseIntent,
    priorities: normalized.priorities,
    sessions: normalized.sessions,
  };
  const canonicalSemanticJson = canonicalizeJson(semanticSpecification);
  return {
    canonicalSemanticJson,
    semanticHash: createHash("sha256")
      .update(canonicalSemanticJson, "utf8")
      .digest("hex"),
  };
}

export function validatePlanSpecificationPreviewV0Catalog(input: {
  specification: PlanSpecificationPreviewV0;
  catalogExerciseIds: readonly string[];
}): PlanSpecificationPreviewV0ValidationFinding[] {
  const knownExerciseIds = new Set(input.catalogExerciseIds);
  return input.specification.sessions.flatMap((session, sessionIndex) =>
    session.placements.flatMap((placement, placementIndex) =>
      knownExerciseIds.has(placement.exerciseId)
        ? []
        : [
            {
              code: "UNKNOWN_EXERCISE_ID",
              path: `sessions.${sessionIndex}.placements.${placementIndex}.exerciseId`,
              message: `Exercise ID is not present in the supplied catalog context: ${placement.exerciseId}`,
            },
          ],
    ),
  );
}
