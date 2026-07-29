import {
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = process.cwd();
const sourceRoot = path.join(appRoot, "src");
const entryFiles = [
  path.join(
    sourceRoot,
    "app",
    "ui-audit-fixture",
    "page.tsx",
  ),
  path.join(
    sourceRoot,
    "app",
    "ui-audit-fixture",
    "ready",
    "route.ts",
  ),
  path.join(
    sourceRoot,
    "components",
    "ui-audit",
    "UiAuditFixturePage.tsx",
  ),
  path.join(sourceRoot, "proxy.ts"),
];
const sourceExtensions = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];
const forbiddenDependencyPatterns = [
  /[\\/]lib[\\/]db[\\/]/,
  /[\\/]prisma[\\/]/,
  /@prisma\/client/,
  /@prisma\/adapter/,
];

function resolveSourceImport(
  fromFile: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
    return null;
  }
  const unresolved = specifier.startsWith("@/")
    ? path.join(sourceRoot, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    unresolved,
    ...sourceExtensions.map((extension) => `${unresolved}${extension}`),
    ...sourceExtensions.map((extension) =>
      path.join(unresolved, `index${extension}`),
    ),
  ];
  const match = candidates.find((candidate) => existsSync(candidate));
  return match ? realpathSync(match) : null;
}

function runtimeImports(source: string): string[] {
  const imports: string[] = [];
  const fromPattern =
    /\b(?:import|export)\s+(type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(fromPattern)) {
    if (!match[1] && match[2]) {
      imports.push(match[2]);
    }
  }
  const sideEffectPattern = /\bimport\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(sideEffectPattern)) {
    if (match[1]) imports.push(match[1]);
  }
  return imports;
}

function collectRuntimeDependencyGraph(entries: string[]): Set<string> {
  const visited = new Set<string>();
  const pending = entries.map((entry) => realpathSync(entry));
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of runtimeImports(source)) {
      const resolved = resolveSourceImport(file, specifier);
      if (resolved && !visited.has(resolved)) {
        pending.push(resolved);
      }
    }
  }
  return visited;
}

describe("database-free UI audit boundary", () => {
  it("has no runtime dependency path to Prisma or database modules", () => {
    const dependencyGraph = collectRuntimeDependencyGraph(entryFiles);
    const forbidden = [...dependencyGraph].filter((file) =>
      forbiddenDependencyPatterns.some((pattern) => pattern.test(file)),
    );
    const forbiddenPackageImports = [...dependencyGraph].flatMap((file) =>
      runtimeImports(readFileSync(file, "utf8")).filter((specifier) =>
        forbiddenDependencyPatterns.some((pattern) =>
          pattern.test(specifier),
        ),
      ),
    );

    expect({
      forbiddenFiles: forbidden,
      forbiddenPackageImports,
    }).toEqual({
      forbiddenFiles: [],
      forbiddenPackageImports: [],
    });
  });

  it("keeps the managed audit runner database-credential free", () => {
    const runner = readFileSync(
      path.join(appRoot, "scripts", "run-ui-audit.mjs"),
      "utf8",
    );
    expect(runner).toContain("delete childEnvironment.DATABASE_URL");
    expect(runner).toContain("delete childEnvironment.DIRECT_URL");
  });

  it("renders plan reviews through the same database-free shared component", () => {
    const productionRoute = readFileSync(
      path.join(sourceRoot, "app", "plans", "[id]", "review", "page.tsx"),
      "utf8",
    );
    const fixtureRoute = readFileSync(
      path.join(
        sourceRoot,
        "components",
        "ui-audit",
        "UiAuditFixturePage.tsx",
      ),
      "utf8",
    );
    const sharedView = readFileSync(
      path.join(
        sourceRoot,
        "components",
        "plans",
        "PlanReviewView.tsx",
      ),
      "utf8",
    );
    const fixtureData = readFileSync(
      path.join(sourceRoot, "lib", "ui-audit-fixtures", "fixtures.ts"),
      "utf8",
    );

    expect(productionRoute).toContain(
      'import { PlanReviewView } from "@/components/plans/PlanReviewView"',
    );
    expect(productionRoute).toContain("<PlanReviewView plan={plan} />");
    expect(fixtureRoute).toContain(
      'import { PlanReviewView } from "@/components/plans/PlanReviewView"',
    );
    expect(fixtureRoute).toContain("<PlanReviewView plan={plan} />");
    expect(fixtureRoute).not.toContain("function FixturePlanReview");
    expect(sharedView).not.toMatch(
      /@\/lib\/(?:api|db)|@prisma|prisma[\\/]/,
    );
    expect(fixtureData).toContain(
      '} from "@/lib/ui/plan-management";',
    );
    expect(fixtureData).toContain(
      "planReviews?: Record<string, PlanReview>;",
    );
  });
});
