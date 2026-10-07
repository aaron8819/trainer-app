import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import ts from "typescript";
import { developmentEnabled } from "./development";

describe("Trainer2 boundary", () => {
  it("requires explicit isolated development and fails closed in hosted/production contexts", () => {
    expect(developmentEnabled({ NODE_ENV: "development", TRAINER2_LOCAL_DRAFTS: "enabled" })).toBe(true);
    for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "test" }, { NODE_ENV: "development", VERCEL: "1" }, { NODE_ENV: "development", CI: "1" }, { NODE_ENV: "development", TRAINER2_LOCAL_DRAFTS: "true" }])
      expect(developmentEnabled({ TRAINER2_LOCAL_DRAFTS: "enabled", ...env })).toBe(false);
  });
  it("walks every local transitive import from new routes and excludes legacy owners", () => {
    const app = resolve("src");
    const seen = new Set<string>();
    const allowed = ["app/api/trainer2/", "app/trainer2/dev/drafts/", "components/trainer2/", "lib/api/trainer2/", "lib/engine/trainer2/", "lib/trainer2-contracts/"];
    function walk(file: string) {
      if (seen.has(file)) return; seen.add(file);
      const relativePath = relative(app, file).replaceAll("\\", "/");
      const pureOwners = [
        "app/trainer2/dev/executions/[executionId]/page.tsx",
        "lib/operations/production-write-gate-http.ts",
        "lib/operations/production-write-gate.ts",
        "lib/operations/deployment-boundary.ts",
        "lib/exercise-measurement/semantics.ts",
        "lib/exercise-measurement/load-entry-policy.ts",
        "lib/ui/use-visual-viewport-metrics.ts",
      ];
      expect(
        allowed.some(prefix => relativePath.startsWith(prefix)) ||
        pureOwners.includes(relativePath) ||
        file === resolve("prisma/exercises_comprehensive.json"), relativePath
      ).toBe(true);
      if (file.endsWith(".json")) { JSON.parse(readFileSync(file, "utf8")); return; }
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        let specifier: string | undefined;
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === "require")) {
          expect(node.arguments.length).toBe(1); expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
          if (ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
        }
        if (specifier?.startsWith(".") || specifier?.startsWith("@/")) {
          const base = specifier.startsWith("@/") ? resolve(app, specifier.slice(2)) : resolve(dirname(file), specifier);
          walk(existsSync(base) ? base : existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`);
        }
        ts.forEachChild(node, visit);
      }; visit(source);
    }
    function routes(dir: string) { for (const entry of readdirSync(dir, { withFileTypes: true })) { const file = resolve(dir, entry.name); if (entry.isDirectory()) routes(file); else if (entry.name === "route.ts") walk(file); } }
    routes(resolve(app, "app/api/trainer2"));
    walk(resolve(app, "app/trainer2/dev/drafts/page.tsx"));
    walk(resolve(app, "app/trainer2/dev/executions/[executionId]/page.tsx"));
    expect(seen.size).toBeGreaterThan(6);
    const routeFiles = [...seen].filter(p => p.endsWith("route.ts"));
    // All current Trainer2 API route modules must stay within the isolated graph.
    expect(routeFiles).toHaveLength(19);
    for (const route of ["add-exercise", "add-set", "swap-exercise-preview", "swap-exercise", "skip-set"])
      expect(routeFiles).toContain(resolve(app, `app/api/trainer2/executions/${route}/route.ts`));
    expect(routeFiles).toContain(resolve(app, "app/api/trainer2/executions/corrections/route.ts"));
    expect(routeFiles).toContain(resolve(app, "app/api/trainer2/executions/discard/route.ts"));
    expect(routeFiles).toContain(resolve(app, "app/api/trainer2/occurrences/skip/route.ts"));
    expect(routeFiles.map(p => readFileSync(p, "utf8")).join("\n")).not.toMatch(/DELETE/);
  });
});
