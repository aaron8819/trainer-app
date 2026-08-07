import type { ZodIssue } from "zod";
import { normalizeAcceptedSeedPayload } from "./mesocycle-seed-revision";
import {
  evaluateHypertrophyPlanHealth,
  type HypertrophyAuthoringExercise,
} from "@/lib/engine/hypertrophy-plan-authoring";
import {
  PLAN_SPECIFICATION_PREVIEW_V0_COMPILER_VERSION,
  PLAN_SPECIFICATION_PREVIEW_V0_DEFAULTS,
  PLAN_SPECIFICATION_PREVIEW_V0_UNSUPPORTED_CONCEPTS,
  adaptPlanSpecificationPreviewV0ToHypertrophyDraft,
  canonicalizePlanSpecificationPreviewV0,
  compilePlanSpecificationPreviewV0,
  planSpecificationPreviewV0Schema,
  validatePlanSpecificationPreviewV0Catalog,
  type PlanSpecificationPreviewV0ValidationFinding,
} from "@/lib/engine/plan-specification-preview-v0";

function zodFinding(issue: ZodIssue): PlanSpecificationPreviewV0ValidationFinding {
  const unsupportedKeys =
    issue.code === "unrecognized_keys" &&
    "keys" in issue &&
    Array.isArray(issue.keys)
      ? issue.keys.map(String)
      : null;
  return {
    code: unsupportedKeys ? "UNSUPPORTED_FIELD" : issue.code.toUpperCase(),
    path: issue.path.map(String).join("."),
    message: unsupportedKeys
      ? `Unsupported field${unsupportedKeys.length === 1 ? "" : "s"}: ${unsupportedKeys.join(", ")}`
      : issue.message,
  };
}

export function buildPlanSpecificationPreviewV0(input: {
  specification: unknown;
  catalog: HypertrophyAuthoringExercise[];
  limitationKeys?: readonly string[];
}) {
  const parsed = planSpecificationPreviewV0Schema.safeParse(
    input.specification,
  );
  const schemaFindings = parsed.success
    ? []
    : parsed.error.issues.map(zodFinding);
  const catalogFindings = parsed.success
    ? validatePlanSpecificationPreviewV0Catalog({
        specification: parsed.data,
        catalogExerciseIds: input.catalog.map((exercise) => exercise.id),
      })
    : [];
  const specificationFindings = [...schemaFindings, ...catalogFindings];

  if (!parsed.success || specificationFindings.length > 0) {
    return {
      proof: "PlanSpecificationPreviewV0" as const,
      sourceSpecification: input.specification,
      normalizedSpecification: parsed.success ? parsed.data : null,
      compiler: {
        version: PLAN_SPECIFICATION_PREVIEW_V0_COMPILER_VERSION,
        defaults: PLAN_SPECIFICATION_PREVIEW_V0_DEFAULTS,
        deterministicBoundary:
          "Normalized semantic specification plus supplied catalog context; metadata is excluded from semantic canonical bytes and the executable seed.",
      },
      specificationValidation: {
        valid: false,
        findings: specificationFindings,
      },
      compiledSeed: null,
      seedValidation: {
        valid: false,
        findings: [
          {
            code: "NOT_COMPILED",
            path: "",
            message:
              "Seed validation was not run because specification validation failed.",
          },
        ],
      },
      planHealth: {
        included: false,
        reason: "Specification validation must pass before Plan Health is evaluated.",
      },
      unsupportedConcepts: PLAN_SPECIFICATION_PREVIEW_V0_UNSUPPORTED_CONCEPTS,
      isolation: {
        readOnly: true,
        databaseRead: false,
        databaseWrite: false,
        canAccept: false,
        canActivate: false,
        canMaterializeWorkout: false,
        runtimeFallback: false,
      },
    };
  }

  const deterministic = canonicalizePlanSpecificationPreviewV0({
    specification: parsed.data,
  });
  const compiledSeed = compilePlanSpecificationPreviewV0(parsed.data);

  let normalizedSeed;
  try {
    normalizedSeed = normalizeAcceptedSeedPayload(compiledSeed);
  } catch (error) {
    return {
      proof: "PlanSpecificationPreviewV0" as const,
      sourceSpecification: input.specification,
      normalizedSpecification: parsed.data,
      compiler: {
        version: PLAN_SPECIFICATION_PREVIEW_V0_COMPILER_VERSION,
        defaults: PLAN_SPECIFICATION_PREVIEW_V0_DEFAULTS,
        deterministicBoundary:
          "Normalized semantic specification plus supplied catalog context; metadata is excluded from semantic canonical bytes and the executable seed.",
        ...deterministic,
      },
      specificationValidation: { valid: true, findings: [] },
      compiledSeed,
      seedValidation: {
        valid: false,
        findings: [
          {
            code: "ACCEPTED_SEED_VALIDATION_FAILED",
            path: "compiledSeed",
            message: error instanceof Error ? error.message : "Unknown seed validation error",
          },
        ],
      },
      planHealth: {
        included: false,
        reason: "Plan Health was withheld because accepted-seed validation failed.",
      },
      unsupportedConcepts: PLAN_SPECIFICATION_PREVIEW_V0_UNSUPPORTED_CONCEPTS,
      isolation: {
        readOnly: true,
        databaseRead: false,
        databaseWrite: false,
        canAccept: false,
        canActivate: false,
        canMaterializeWorkout: false,
        runtimeFallback: false,
      },
    };
  }

  const health = evaluateHypertrophyPlanHealth({
    draft: adaptPlanSpecificationPreviewV0ToHypertrophyDraft(parsed.data),
    exercises: input.catalog,
    limitationKeys: input.limitationKeys ?? [],
  });

  return {
    proof: "PlanSpecificationPreviewV0" as const,
    sourceSpecification: input.specification,
    normalizedSpecification: parsed.data,
    compiler: {
      version: PLAN_SPECIFICATION_PREVIEW_V0_COMPILER_VERSION,
      defaults: PLAN_SPECIFICATION_PREVIEW_V0_DEFAULTS,
      deterministicBoundary:
        "Normalized semantic specification plus supplied catalog context; metadata is excluded from semantic canonical bytes and the executable seed.",
      ...deterministic,
    },
    specificationValidation: { valid: true, findings: [] },
    compiledSeed,
    seedValidation: {
      valid: true,
      findings: [],
      payloadVersion: normalizedSeed.payloadVersion,
      executableHash: normalizedSeed.hash,
      hashAlgorithm: normalizedSeed.hashAlgorithm,
      canonicalPayload: normalizedSeed.canonicalPayload,
      executablePayload: normalizedSeed.executablePayload,
    },
    planHealth: {
      included: true,
      basis:
        "Existing hypertrophy Plan Health evaluated against the exact V0-to-HypertrophyPlanDraftV1 adapter and supplied catalog context.",
      ...health,
    },
    unsupportedConcepts: PLAN_SPECIFICATION_PREVIEW_V0_UNSUPPORTED_CONCEPTS,
    isolation: {
      readOnly: true,
      databaseRead: false,
      databaseWrite: false,
      canAccept: false,
      canActivate: false,
      canMaterializeWorkout: false,
      runtimeFallback: false,
    },
  };
}
