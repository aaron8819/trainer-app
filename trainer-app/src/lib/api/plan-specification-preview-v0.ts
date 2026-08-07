import type { ZodIssue } from "zod";
import { normalizeAcceptedSeedPayload } from "./mesocycle-seed-revision";
import {
  PLAN_SPECIFICATION_PREVIEW_V0_COMPILER_VERSION,
  PLAN_SPECIFICATION_PREVIEW_V0_DEFERRED_CONCEPTS,
  compilePlanSpecificationPreviewV0,
  planSpecificationPreviewV0Schema,
  validatePlanSpecificationPreviewV0Catalog,
  type PlanSpecificationPreviewV0ValidationFinding,
} from "@/lib/engine/plan-specification-preview-v0";

const deterministicBoundary = {
  normalizedInput:
    "Strict V0 input: version plus ordered slots and ordered exerciseId/role/setCount rows. No defaults are applied.",
  executableProjection:
    "The shared custom-hypertrophy executable projection owner copies only ordered slotId, exerciseId, role, and setCount into seed version 1.",
  acceptedSeedHash:
    "The authoritative accepted-seed normalizer hashes the canonical compiled version-1 payload.",
  excludedMetadata:
    "Catalog context validates exercise identity only. Names, source, goal, priorities, constraints, phase intent, placement semantics, targets, and Plan Health inputs are rejected rather than hashed or ignored.",
  guarantee:
    "Identical normalized V0 input produces identical ordered seed rows and accepted-seed hash; any accepted field change is inside both boundaries.",
} as const;

const isolation = {
  readOnly: true,
  databaseRead: false,
  databaseWrite: false,
  canAccept: false,
  canActivate: false,
  canMaterializeWorkout: false,
  runtimeFallback: false,
} as const;

const planHealth = {
  included: false,
  reason:
    "Existing hypertrophy Plan Health requires draft-only settings, session focus, targets, exercise-class constraints, and rich catalog facts. V0 omits evaluation rather than expanding the executable proof contract.",
} as const;

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
  catalogExerciseIds: readonly string[];
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
        catalogExerciseIds: input.catalogExerciseIds,
      })
    : [];
  const specificationFindings = [...schemaFindings, ...catalogFindings];

  const common = {
    proof: "PlanSpecificationPreviewV0" as const,
    sourceSpecification: input.specification,
    normalizedSpecification: parsed.success ? parsed.data : null,
    compiler: {
      version: PLAN_SPECIFICATION_PREVIEW_V0_COMPILER_VERSION,
      deterministicBoundary,
    },
    planHealth,
    deferredConcepts: PLAN_SPECIFICATION_PREVIEW_V0_DEFERRED_CONCEPTS,
    isolation,
  };

  if (!parsed.success || specificationFindings.length > 0) {
    return {
      ...common,
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
    };
  }

  const compiledSeed = compilePlanSpecificationPreviewV0(parsed.data);

  try {
    const normalizedSeed = normalizeAcceptedSeedPayload(compiledSeed);
    return {
      ...common,
      normalizedSpecification: parsed.data,
      specificationValidation: { valid: true, findings: [] },
      compiledSeed,
      seedValidation: {
        valid: true,
        findings: [],
        payloadVersion: normalizedSeed.payloadVersion,
        acceptedSeedHash: normalizedSeed.hash,
        hashAlgorithm: normalizedSeed.hashAlgorithm,
        canonicalPayload: normalizedSeed.canonicalPayload,
        executablePayload: normalizedSeed.executablePayload,
      },
    };
  } catch (error) {
    return {
      ...common,
      normalizedSpecification: parsed.data,
      specificationValidation: { valid: true, findings: [] },
      compiledSeed,
      seedValidation: {
        valid: false,
        findings: [
          {
            code: "ACCEPTED_SEED_VALIDATION_FAILED",
            path: "compiledSeed",
            message:
              error instanceof Error ? error.message : "Unknown seed validation error",
          },
        ],
      },
    };
  }
}
