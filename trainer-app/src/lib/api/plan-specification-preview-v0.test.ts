import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileAcceptedHypertrophySeed,
  projectExecutableSeed,
  type HypertrophyPlanDraftV1,
} from "@/lib/engine/hypertrophy-plan-authoring";
import {
  compilePlanSpecificationPreviewV0,
  parsePlanSpecificationPreviewV0,
} from "@/lib/engine/plan-specification-preview-v0";
import {
  PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE,
  PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_CATALOG_IDS,
  PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS,
} from "@/lib/engine/plan-specification-preview-v0.fixture";
import { buildPlanSpecificationPreviewV0 } from "./plan-specification-preview-v0";

function buildPreview(
  specification: unknown = PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE,
  catalogExerciseIds: readonly string[] =
    PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_CATALOG_IDS,
) {
  return buildPlanSpecificationPreviewV0({
    specification,
    catalogExerciseIds,
  });
}

function equivalentCustomDraft(): HypertrophyPlanDraftV1 {
  const primaryTargetByExerciseId = {
    [PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.pullUp]: "vertical_pull",
    [PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.chestSupportedRow]:
      "horizontal_pull",
    [PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.squat]: "squat",
  } as const;

  return {
    version: 1,
    settings: {
      equipmentProfile: "FULL_GYM",
      sessionDurationMinutes: 60,
    },
    sessions: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE.slots.map(
      (slot, slotIndex) => ({
        slotId: slot.slotId,
        name: `Legacy slot ${slotIndex + 1}`,
        focus: slotIndex % 2 === 0 ? "UPPER" : "LOWER",
        exercises: slot.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          workingSets: exercise.setCount,
          intent:
            exercise.role === "CORE_COMPOUND"
              ? {
                  userRole: "PRIMARY_LIFT" as const,
                  target: {
                    kind: "movement_pattern" as const,
                    movementPattern:
                      primaryTargetByExerciseId[
                        exercise.exerciseId as keyof typeof primaryTargetByExerciseId
                      ]!,
                  },
                }
              : {
                  userRole: "ACCESSORY" as const,
                  target: { kind: "muscle" as const, muscleId: "abs" as const },
                },
        })),
      }),
    ),
  };
}

describe("PlanSpecificationPreviewV0", () => {
  it("compiles the minimal four-slot fixture through accepted-seed validation", () => {
    const preview = buildPreview();

    expect(preview.specificationValidation).toEqual({ valid: true, findings: [] });
    expect(preview.seedValidation).toMatchObject({
      valid: true,
      payloadVersion: 1,
      hashAlgorithm: "sha256",
    });
    expect(preview.planHealth.included).toBe(false);
    expect(preview.isolation).toEqual({
      readOnly: true,
      databaseRead: false,
      databaseWrite: false,
      canAccept: false,
      canActivate: false,
      canMaterializeWorkout: false,
      runtimeFallback: false,
    });
  });

  it("preserves slot and exercise order plus exact role and set-count meaning", () => {
    const compiled = compilePlanSpecificationPreviewV0(
      PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE,
    );

    expect(compiled.slots.map((slot) => slot.slotId)).toEqual([
      "upper-1",
      "lower-1",
      "upper-2",
      "lower-2",
    ]);
    expect(compiled.slots[0]?.exercises).toEqual([
      {
        exerciseId: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.pullUp,
        role: "CORE_COMPOUND",
        setCount: 4,
      },
      {
        exerciseId:
          PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.chestSupportedRow,
        role: "ACCESSORY",
        setCount: 3,
      },
    ]);
  });

  it("uses the same executable projection authority as custom hypertrophy acceptance", () => {
    expect(
      compilePlanSpecificationPreviewV0(PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE),
    ).toEqual(
      projectExecutableSeed(
        compileAcceptedHypertrophySeed(equivalentCustomDraft()),
      ),
    );
  });

  it("is deterministic at the normalized input, seed, and accepted-seed hash boundaries", () => {
    const first = buildPreview();
    const second = buildPreview(
      structuredClone(PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE),
    );

    expect(second.normalizedSpecification).toEqual(first.normalizedSpecification);
    expect(second.compiledSeed).toEqual(first.compiledSeed);
    expect(second.seedValidation).toEqual(first.seedValidation);
    expect(second.compiler).not.toHaveProperty("semanticHash");
  });

  it("excludes catalog validation context from executable rows and their hash", () => {
    const baseline = buildPreview();
    const reorderedContext = buildPreview(
      PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE,
      [
        "unused-catalog-id",
        ...[...PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_CATALOG_IDS].reverse(),
      ],
    );

    expect(reorderedContext.compiledSeed).toEqual(baseline.compiledSeed);
    expect(reorderedContext.seedValidation).toMatchObject({
      acceptedSeedHash: baseline.seedValidation.acceptedSeedHash,
    });
  });

  it("changes the accepted-seed hash when an executable field changes", () => {
    const changed = structuredClone(PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE);
    changed.slots[0]!.exercises[0]!.setCount = 5;

    const baseline = buildPreview();
    const updated = buildPreview(changed);

    expect(updated.compiledSeed).not.toEqual(baseline.compiledSeed);
    expect(updated.seedValidation).toMatchObject({ valid: true });
    expect(updated.seedValidation).not.toMatchObject({
      acceptedSeedHash: baseline.seedValidation.acceptedSeedHash,
    });
  });

  it("normalizes only identifier whitespace and applies no semantic defaults", () => {
    const raw = structuredClone(PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE);
    raw.slots[0]!.slotId = "  upper-1  ";
    raw.slots[0]!.exercises[0]!.exerciseId =
      `  ${raw.slots[0]!.exercises[0]!.exerciseId}  `;

    const parsed = parsePlanSpecificationPreviewV0(raw);
    expect(parsed.slots[0]?.slotId).toBe("upper-1");
    expect(parsed.slots[0]?.exercises[0]?.exerciseId).toBe(
      PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.pullUp,
    );
  });

  it.each([
    [
      "set count",
      (value: typeof PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE) => {
        value.slots[0]!.exercises[0]!.setCount = 0;
      },
      "TOO_SMALL",
    ],
    [
      "executable role",
      (value: typeof PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE) => {
        (
          value.slots[0]!.exercises[0] as { role: string }
        ).role = "PRIMARY";
      },
      "INVALID_VALUE",
    ],
    [
      "exercise identifier",
      (value: typeof PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE) => {
        value.slots[0]!.exercises[0]!.exerciseId = "missing-exercise";
      },
      "UNKNOWN_EXERCISE_ID",
    ],
    [
      "duplicate slot identifier",
      (value: typeof PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE) => {
        value.slots[1]!.slotId = value.slots[0]!.slotId;
      },
      "CUSTOM",
    ],
  ])("reports actionable validation for invalid %s", (_name, mutate, code) => {
    const invalid = structuredClone(PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE);
    mutate(invalid);
    const preview = buildPreview(invalid);

    expect(preview.specificationValidation.valid).toBe(false);
    expect(preview.specificationValidation.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    );
    expect(preview.compiledSeed).toBeNull();
  });

  it("rejects all deferred planning metadata instead of hashing or discarding it", () => {
    const unsupported = {
      ...structuredClone(PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE),
      planName: "Future plan",
      authoringSource: "USER_AUTHORED",
      primaryGoal: "HYPERTROPHY",
      priorities: [],
      constraints: {},
      phaseIntent: {},
    };
    Object.assign(unsupported.slots[0]!, {
      name: "Upper",
      focus: "UPPER",
    });
    Object.assign(unsupported.slots[0]!.exercises[0]!, {
      candidatePlacementId: "future-placement",
      prominence: "PRIMARY",
      continuity: "ANCHOR",
      priorityIds: [],
      target: { kind: "movement_pattern", movementPattern: "vertical_pull" },
      requiredExerciseClass: "future-class",
    });

    const preview = buildPreview(unsupported);
    expect(preview.specificationValidation.valid).toBe(false);
    expect(preview.specificationValidation.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNSUPPORTED_FIELD" }),
      ]),
    );
    expect(preview.compiledSeed).toBeNull();
  });

  it("keeps preview code read-only and absent from acceptance and runtime owners", () => {
    const compilerSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "src",
        "lib",
        "engine",
        "plan-specification-preview-v0.ts",
      ),
      "utf8",
    );
    const previewSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "src",
        "lib",
        "api",
        "plan-specification-preview-v0.ts",
      ),
      "utf8",
    );
    expect(compilerSource).not.toMatch(/@prisma|lib\/db|prisma\.|\$transaction/);
    expect(previewSource).not.toMatch(
      /@prisma|lib\/db|prisma\.|\$transaction|\b(createSeedRevision|acceptHypertrophy\w*|activatePlan|materializeWorkout)\s*\(/i,
    );
    expect(previewSource).not.toContain("evaluateHypertrophyPlanHealth");

    const authorityFiles = [
      ["src", "lib", "api", "hypertrophy-plan-drafts.ts"],
      ["src", "lib", "api", "next-session.ts"],
      ["src", "lib", "api", "template-session", "slot-plan-seed.ts"],
      ["src", "lib", "api", "template-session", "plan-assembly.ts"],
      ["src", "lib", "api", "template-session", "finalize-session.ts"],
    ];
    for (const segments of authorityFiles) {
      const source = fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
      expect(source).not.toContain("plan-specification-preview-v0");
      expect(source).not.toContain("PlanSpecificationPreviewV0");
    }
  });
});
