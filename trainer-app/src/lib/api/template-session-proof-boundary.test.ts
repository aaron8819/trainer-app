import { readFileSync } from "node:fs";
import { dirname, normalize, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const sourceRoot = resolve(process.cwd(), "src");
const originalProof = resolve(sourceRoot, "lib/api/template-session.test.ts");
const revisedProof = resolve(
  sourceRoot,
  "lib/api/template-session-v4-revised.test.ts",
);
const postgresProof = resolve(
  process.cwd(),
  "scripts/test-v4-custom-plan-postgres.ts",
);

function resolveLocalImport(fromFile: string, specifier: string): string | null {
  const unresolved = specifier.startsWith("@/")
    ? resolve(sourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (!unresolved) return null;

  const candidates = /\.tsx?$/.test(unresolved)
    ? [unresolved]
    : [
        `${unresolved}.ts`,
        `${unresolved}.tsx`,
        resolve(unresolved, "index.ts"),
        resolve(unresolved, "index.tsx"),
      ];
  return candidates.find((candidate) => {
    try {
      readFileSync(candidate);
      return true;
    } catch {
      return false;
    }
  }) ?? null;
}

function collectLocalModuleGraph(entry: string): Set<string> {
  const visited = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    const imports = ts.preProcessFile(source, true, true).importedFiles;
    for (const imported of imports) {
      const resolvedImport = resolveLocalImport(file, imported.fileName);
      if (resolvedImport && !visited.has(resolvedImport)) pending.push(resolvedImport);
    }
  }
  return visited;
}

function repositoryRelative(file: string): string {
  return normalize(file).slice(normalize(process.cwd()).length + 1).replaceAll("\\", "/");
}

describe("template-session V4 proof module boundaries", () => {
  it("keeps the original PR #59 proof graph independent from every revised asset", () => {
    const graph = [...collectLocalModuleGraph(originalProof)].map(repositoryRelative);
    expect(graph).toContain("src/lib/api/template-session.test.ts");
    expect(graph).toContain("src/lib/api/template-session-v4-reference.expected.ts");
    expect(
      graph.filter((file) =>
        file.includes("hypertrophy-plan-authoring-v4-revised.fixture") ||
        file.includes("hypertrophy-plan-authoring-v4-revised.expected") ||
        file.includes("template-session-v4-revised-reference.expected") ||
        file.includes("template-session-v4-revised.test"),
      ),
    ).toEqual([]);

    const source = readFileSync(originalProof, "utf8");
    expect(source).toContain("25-placement V4 reference across all 20");
    expect(source).toContain("mutations at the exhaustive V4 reference");
  });

  it("keeps the revised proof independently collectible without original prescription expectations", () => {
    const graph = [...collectLocalModuleGraph(revisedProof)].map(repositoryRelative);
    expect(graph).toContain("src/lib/api/template-session-v4-revised.test.ts");
    expect(graph).toContain(
      "src/lib/api/template-session-v4-revised-reference.expected.ts",
    );
    expect(graph).toContain(
      "src/lib/engine/hypertrophy-plan-authoring-v4-revised.fixture.ts",
    );
    expect(graph).not.toContain("src/lib/api/template-session-v4-reference.expected.ts");

    const source = readFileSync(revisedProof, "utf8");
    expect(source).toContain("26-placement revised V4 reference across all 20");
    expect(source).toContain("actual-side mutations at the revised V4 comparison");
  });

  it("keeps PostgreSQL expected data out of production normalization and resolution", () => {
    const source = readFileSync(postgresProof, "utf8");
    expect(source).toContain("const actualBoundHash = saved.preview.hash");
    expect(source).toContain(
      "normalizeAcceptedHypertrophySeedV4(materiallyChangedActual)",
    );
    expect(source).toContain(
      "resolveAcceptedHypertrophySeedV4Week(saved.preview.normalizedPlan, 1)",
    );
    expect(source).not.toMatch(
      /normalizeAcceptedHypertrophySeedV4\([^)]*expected/i,
    );
    expect(source).not.toMatch(
      /resolveAcceptedHypertrophySeedV4Week\([^)]*expected/i,
    );
  });
});
