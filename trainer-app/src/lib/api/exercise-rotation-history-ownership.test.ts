import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type SourceFile = { path: string; text: string };

function listSourceFiles(root: string): SourceFile[] {
  return readdirSync(root).flatMap((entry) => {
    const entryPath = path.join(root, entry);
    if (statSync(entryPath).isDirectory()) {
      return listSourceFiles(entryPath);
    }
    if (!entryPath.endsWith(".ts") && !entryPath.endsWith(".tsx")) {
      return [];
    }
    if (entryPath.endsWith(".test.ts") || entryPath.endsWith(".test.tsx")) {
      return [];
    }
    return [{ path: entryPath, text: readFileSync(entryPath, "utf8") }];
  });
}

function findRetiredExposureViolations(files: SourceFile[]): string[] {
  const rules = [
    { label: "direct ExerciseExposure client access", pattern: /\.(?:exerciseExposure)\b/ },
    { label: "retired exposure helper import", pattern: /exercise-exposure/ },
    {
      label: "name-keyed rotation lookup",
      pattern: /rotationContext\.(?:get|set)\(\s*exercise(?:\.exercise)?\.name/,
    },
    { label: "ambiguous persisted exposure average", pattern: /avg(?:Sets|Volume)PerWeek/ },
  ];

  return files.flatMap((file) =>
    rules
      .filter((rule) => rule.pattern.test(file.text))
      .map((rule) => `${file.path}: ${rule.label}`)
  );
}

describe("exercise rotation-history ownership", () => {
  it("keeps production code free of retired aggregate access and name-keyed rotation", () => {
    const files = [
      ...listSourceFiles("src"),
      ...listSourceFiles("scripts"),
      ...listSourceFiles("prisma"),
    ].filter(
      (file) => !file.path.endsWith("audit-exercise-exposure-retirement.ts")
    );

    expect(findRetiredExposureViolations(files)).toEqual([]);
  });

  it("detects a synthetic direct name-keyed exposure writer", () => {
    const violations = findRetiredExposureViolations([
      {
        path: "src/lib/api/bad-writer.ts",
        text: `await prisma.exerciseExposure.upsert({ where: { userId_exerciseName: value } });`,
      },
    ]);

    expect(violations).toContain(
      "src/lib/api/bad-writer.ts: direct ExerciseExposure client access"
    );
  });

  it("retains legacy rows without exposing a generated Prisma model", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const migration = readFileSync(
      "prisma/migrations/20260714120000_retire_exercise_exposure_projection/migration.sql",
      "utf8"
    );

    expect(schema).not.toMatch(/model\s+ExerciseExposure\b/);
    expect(schema).toMatch(/model\s+LegacyExerciseExposure[\s\S]*?@@ignore/);
    expect(migration).not.toMatch(/DROP\s+TABLE/i);
  });
});
