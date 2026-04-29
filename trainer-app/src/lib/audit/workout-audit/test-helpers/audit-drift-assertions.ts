import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";

type ArtifactSectionPath = string | readonly (string | number)[];

type ReadOnlyDiagnosticOptions = {
  allowSafeForBehaviorPromotion?: boolean;
};

type ImportBoundaryOptions = {
  forbidSerializerImports?: boolean;
};

function asRecord(value: unknown, helperName: string): Record<string, unknown> {
  expect(value, `${helperName} expected an object`).toBeTruthy();
  expect(typeof value, `${helperName} expected an object`).toBe("object");
  return value as Record<string, unknown>;
}

function pathSegments(path: ArtifactSectionPath): Array<string | number> {
  if (typeof path === "string") {
    return path.split(".").filter((segment) => segment.length > 0);
  }
  return [...path];
}

function formatPath(path: ArtifactSectionPath): string {
  return typeof path === "string" ? path : path.join(".");
}

function getSection(value: unknown, path: ArtifactSectionPath): unknown {
  return pathSegments(path).reduce<unknown>((current, segment) => {
    if (current == null) {
      return undefined;
    }
    if (typeof current !== "object" && typeof current !== "function") {
      return undefined;
    }
    return (current as Record<string, unknown>)[String(segment)];
  }, value);
}

export function expectReadOnlyDiagnostic(
  value: unknown,
  options: ReadOnlyDiagnosticOptions = {},
): void {
  const record = asRecord(value, "expectReadOnlyDiagnostic");

  if ("readOnly" in record) {
    expect(record.readOnly, "read-only diagnostic must stay readOnly").toBe(
      true,
    );
  }
  if ("affectsScoringOrGeneration" in record) {
    expect(
      record.affectsScoringOrGeneration,
      "read-only diagnostic must not affect scoring or generation",
    ).toBe(false);
  }
  if (
    !options.allowSafeForBehaviorPromotion &&
    "safeForBehaviorPromotion" in record
  ) {
    expect(
      record.safeForBehaviorPromotion,
      "read-only diagnostic must not be behavior-promotion safe by default",
    ).toBe(false);
  }
}

export function expectStableArtifactSection(
  before: unknown,
  after: unknown,
  path: ArtifactSectionPath,
): void {
  const formattedPath = formatPath(path);
  const beforeSection = getSection(before, path);
  const afterSection = getSection(after, path);

  expect(
    beforeSection,
    `Expected artifact section "${formattedPath}" to exist before comparison`,
  ).not.toBeUndefined();
  expect(
    afterSection,
    `Expected artifact section "${formattedPath}" to remain stable`,
  ).toEqual(beforeSection);
}

function findImportBoundaryViolations(
  source: string,
  options: ImportBoundaryOptions,
): string[] {
  const rules: Array<{ label: string; pattern: RegExp }> = [
    {
      label: "@/lib/db",
      pattern:
        /(?:from\s+|import\s*\(|require\()\s*["']@\/lib\/db(?:\/[^"']*)?["']/g,
    },
    {
      label: "@prisma",
      pattern:
        /(?:from\s+|import\s*\(|require\()\s*["']@prisma(?:\/[^"']*)?["']/g,
    },
    {
      label: "PrismaClient",
      pattern: /\bPrismaClient\b/g,
    },
    {
      label: "CLI scripts",
      pattern:
        /(?:from\s+|import\s*\(|require\()\s*["'][^"']*(?:scripts\/|scripts\\|workout-audit\.ts)["']/g,
    },
  ];

  if (options.forbidSerializerImports) {
    rules.push({
      label: "serializer code",
      pattern:
        /(?:from\s+|import\s*\(|require\()\s*["'](?:\.\/|\.\.\/)?(?:serializer|artifact-serialization)(?:\.[a-z]+)?["']/g,
    });
  }

  return rules.flatMap((rule) =>
    Array.from(
      source.matchAll(rule.pattern),
      (match) => `${rule.label}: ${match[0]}`,
    ),
  );
}

export function expectNoDbImports(
  filePathOrPaths: string | readonly string[],
  options: ImportBoundaryOptions = {},
): void {
  const filePaths =
    typeof filePathOrPaths === "string"
      ? [filePathOrPaths]
      : [...filePathOrPaths];
  const violations = filePaths.flatMap((filePath) => {
    const resolvedPath = resolve(filePath);
    const source = readFileSync(resolvedPath, "utf8");
    return findImportBoundaryViolations(source, options).map(
      (violation) => `${resolvedPath}: ${violation}`,
    );
  });

  expect(
    violations,
    "Pure audit helpers must not import DB, CLI, or serializer code",
  ).toEqual([]);
}
