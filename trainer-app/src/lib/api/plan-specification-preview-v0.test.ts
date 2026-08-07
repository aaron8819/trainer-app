import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileAcceptedHypertrophySeed,
  projectExecutableSeed,
} from "@/lib/engine/hypertrophy-plan-authoring";
import {
  PLAN_SPECIFICATION_PREVIEW_V0_DEFAULTS,
  canonicalizePlanSpecificationPreviewV0,
  compilePlanSpecificationPreviewV0,
  parsePlanSpecificationPreviewV0,
} from "@/lib/engine/plan-specification-preview-v0";
import {
  PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE,
  PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_CATALOG,
  PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_DRAFT,
  PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS,
} from "@/lib/engine/plan-specification-preview-v0.fixture";
import { buildPlanSpecificationPreviewV0 } from "./plan-specification-preview-v0";

function buildPreview(specification: unknown = PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE) {
  return buildPlanSpecificationPreviewV0({
    specification,
    catalog: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_CATALOG,
  });
}

describe("PlanSpecificationPreviewV0", () => {
  it("compiles the representative specification through existing seed validation and Plan Health", () => {
    const preview = buildPreview();

    expect(preview.specificationValidation).toEqual({ valid: true, findings: [] });
    expect(preview.seedValidation.valid).toBe(true);
    expect(preview.planHealth.included).toBe(true);
    expect(preview.planHealth).toMatchObject({ blockers: [] });
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

  it("produces identical normalized semantics, canonical bytes, hashes, and seed output", () => {
    const first = buildPreview();
    const second = buildPreview(structuredClone(PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE));

    expect(second.normalizedSpecification).toEqual(first.normalizedSpecification);
    expect(second.compiler).toEqual(first.compiler);
    expect(second.compiledSeed).toEqual(first.compiledSeed);
    expect(second.seedValidation).toEqual(first.seedValidation);
  });

  it("preserves session and exercise ordering and maps supported roles and sets", () => {
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
      {
        exerciseId:
          PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_EXERCISE_IDS.cableCrunch,
        role: "ACCESSORY",
        setCount: 3,
      },
    ]);
  });

  it("matches the existing custom hypertrophy executable projection", () => {
    expect(
      compilePlanSpecificationPreviewV0(PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE),
    ).toEqual(
      projectExecutableSeed(
        compileAcceptedHypertrophySeed(
          PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE_DRAFT,
        ),
      ),
    );
  });

  it("keeps preview-only priority changes out of executable rows", () => {
    const changed = structuredClone(PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE);
    changed.priorities[0]!.targetId = "alternate-preview-label";

    expect(compilePlanSpecificationPreviewV0(changed)).toEqual(
      compilePlanSpecificationPreviewV0(PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE),
    );
    expect(
      canonicalizePlanSpecificationPreviewV0({ specification: changed })
        .semanticHash,
    ).not.toBe(
      canonicalizePlanSpecificationPreviewV0({
        specification: PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE,
      }).semanticHash,
    );
  });

  it("changes executable rows and accepted-seed hash when set count changes", () => {
    const changed = structuredClone(PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE);
    changed.sessions[0]!.placements[0]!.setCount = 5;
    const baseline = buildPreview();
    const updated = buildPreview(changed);

    expect(updated.compiledSeed).not.toEqual(baseline.compiledSeed);
    expect(updated.seedValidation).toMatchObject({ valid: true });
    expect(updated.seedValidation).not.toMatchObject({
      executableHash: baseline.seedValidation.executableHash,
    });
  });

  it("normalizes the only V0 input default explicitly and stably", () => {
    const raw = structuredClone(PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE) as Record<
      string,
      unknown
    >;
    const sessions = raw.sessions as Array<{
      placements: Array<{ continuity?: string }>;
    }>;
    delete sessions[1]!.placements[1]!.continuity;

    const parsed = parsePlanSpecificationPreviewV0(raw);
    expect(parsed.sessions[1]?.placements[1]?.continuity).toBe(
      PLAN_SPECIFICATION_PREVIEW_V0_DEFAULTS.continuity,
    );
  });

  it.each([
    [
      "set count",
      (value: typeof PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE) => {
        value.sessions[0]!.placements[0]!.setCount = 0;
      },
      "TOO_SMALL",
    ],
    [
      "phase weeks",
      (value: typeof PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE) => {
        (value.phaseIntent as { accumulationWeeks: number }).accumulationWeeks = 3;
      },
      "INVALID_VALUE",
    ],
    [
      "exercise identifier",
      (value: typeof PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE) => {
        value.sessions[0]!.placements[0]!.exerciseId = "missing-exercise";
      },
      "UNKNOWN_EXERCISE_ID",
    ],
    [
      "duplicate placement identifier",
      (value: typeof PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE) => {
        value.sessions[0]!.placements[1]!.candidatePlacementId =
          value.sessions[0]!.placements[0]!.candidatePlacementId;
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
    expect(preview.planHealth.included).toBe(false);
  });

  it("rejects unsupported future concepts instead of discarding them", () => {
    const unsupported = {
      ...structuredClone(PLAN_SPECIFICATION_PREVIEW_V0_FIXTURE),
      progressionPolicy: { kind: "double_progression" },
    };
    const preview = buildPreview(unsupported);

    expect(preview.specificationValidation.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_FIELD",
          message: "Unsupported field: progressionPolicy",
        }),
      ]),
    );
  });

  it("keeps the preview dependency graph read-only and out of runtime authority", () => {
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
    expect(previewSource).not.toMatch(/lib\/db|prisma\.|\$transaction/);

    const runtimeFiles = [
      ["src", "lib", "api", "next-session.ts"],
      ["src", "lib", "api", "template-session", "slot-plan-seed.ts"],
      ["src", "lib", "api", "template-session", "plan-assembly.ts"],
      ["src", "lib", "api", "template-session", "finalize-session.ts"],
    ];
    for (const segments of runtimeFiles) {
      const source = fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
      expect(source).not.toContain("plan-specification-preview-v0");
      expect(source).not.toContain("PlanSpecificationPreviewV0");
    }
  });
});
