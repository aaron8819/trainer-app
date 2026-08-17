import { existsSync, readFileSync } from "node:fs";
import { dirname, normalize, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import ts from "typescript";

const sourceRoot = resolve(process.cwd(), "src");
const originalProof = resolve(sourceRoot, "lib/api/template-session.test.ts");
const revisedProof = resolve(
  sourceRoot,
  "lib/api/template-session-v4-revised.test.ts",
);
const neutralHelper = resolve(
  sourceRoot,
  "lib/api/template-session-v4-reference.test-helper.ts",
);
const postgresProof = resolve(
  process.cwd(),
  "scripts/test-v4-custom-plan-postgres.ts",
);

const sourceCache = new Map<string, string>();
const sourceFileCache = new Map<string, ts.SourceFile>();
const sourceParseCount = new Map<string, number>();
const dependencyCache = new Map<string, readonly string[]>();
const graphCache = new Map<string, ReadonlySet<string>>();
const allowlistedExpressionKeyCache = new Map<string, string>();

function readSource(file: string): string {
  const cached = sourceCache.get(file);
  if (cached !== undefined) return cached;
  const source = readFileSync(file, "utf8");
  sourceCache.set(file, source);
  return source;
}

function parseSource(file: string): ts.SourceFile {
  const cached = sourceFileCache.get(file);
  if (cached) return cached;
  const sourceFile = ts.createSourceFile(
    file,
    readSource(file),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  sourceFileCache.set(file, sourceFile);
  sourceParseCount.set(file, (sourceParseCount.get(file) ?? 0) + 1);
  return sourceFile;
}

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
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function collectModuleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers = new Set<string>();
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.add(node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.add(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...specifiers];
}

function localDependencies(file: string): readonly string[] {
  const cached = dependencyCache.get(file);
  if (cached) return cached;
  const cachedSourceFile = sourceFileCache.get(file);
  const specifiers = cachedSourceFile
    ? collectModuleSpecifiers(cachedSourceFile)
    : ts.preProcessFile(readSource(file), true, true).importedFiles.map(
        (imported) => imported.fileName,
      );
  if (!cachedSourceFile) {
    sourceParseCount.set(file, (sourceParseCount.get(file) ?? 0) + 1);
  }
  const dependencies = specifiers
    .map((specifier) => resolveLocalImport(file, specifier))
    .filter((dependency): dependency is string => dependency !== null);
  dependencyCache.set(file, dependencies);
  return dependencies;
}

function collectLocalModuleGraph(entry: string): ReadonlySet<string> {
  const cached = graphCache.get(entry);
  if (cached) return cached;
  const visited = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const dependency of localDependencies(file)) {
      if (!visited.has(dependency)) pending.push(dependency);
    }
  }
  graphCache.set(entry, visited);
  return visited;
}

function repositoryRelative(file: string): string {
  return normalize(file).slice(normalize(process.cwd()).length + 1).replaceAll("\\", "/");
}

type ImportShape = {
  module: string;
  defaultImport?: string;
  namespaceImport?: string;
  namedImports: Array<{
    imported: string;
    local: string;
    typeOnly: boolean;
  }>;
};

function importShapes(sourceFile: ts.SourceFile): ImportShape[] {
  return sourceFile.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return [];
    }
    const clause = statement.importClause;
    const shape: ImportShape = {
      module: statement.moduleSpecifier.text,
      namedImports: [],
    };
    if (!clause) return [shape];
    if (clause.name) shape.defaultImport = clause.name.text;
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      shape.namespaceImport = clause.namedBindings.name.text;
    } else if (clause.namedBindings) {
      shape.namedImports = clause.namedBindings.elements.map((element) => ({
        imported: element.propertyName?.text ?? element.name.text,
        local: element.name.text,
        typeOnly: clause.isTypeOnly || element.isTypeOnly,
      }));
    }
    return [shape];
  });
}

type ProductionCallConfiguration = {
  identifiers: ReadonlyMap<string, string>;
  moduleMembers: ReadonlyMap<string, ReadonlyMap<string, string>>;
};

type AllowedProductionCall = {
  productionId: string;
  line: number;
  column: number;
  arguments: readonly string[];
};

type ObservedProductionCall = {
  productionId: string;
  line: number;
  column: number;
  argumentKeys: readonly string[];
};

const postgresProductionCalls: ProductionCallConfiguration = {
  identifiers: new Map([
    ["normalizeAcceptedHypertrophySeedV4", "normalize-accepted-v4"],
  ]),
  moduleMembers: new Map([
    [
      "draftsModule",
      new Map([
        ["loadHypertrophyPlanEditorData", "load-v4-preview"],
        ["saveHypertrophyPlanDraft", "normalize-and-hash-v4-preview"],
        ["makeHypertrophyPlanReady", "accept-v4-seed"],
      ]),
    ],
    [
      "authoringModule",
      new Map([
        ["resolveAcceptedHypertrophySeedV4Week", "resolve-accepted-v4-week"],
      ]),
    ],
    [
      "templateSessionModule",
      new Map([
        ["generateSessionFromIntent", "materialize-session-from-intent"],
      ]),
    ],
    [
      "activePlanModule",
      new Map([["resolveActivePlanContext", "load-active-accepted-v4-seed"]]),
    ],
    [
      "nextSessionModule",
      new Map([["loadNextWorkoutContext", "resolve-next-v4-slot"]]),
    ],
  ]),
};

const postgresCallAllowlist: readonly AllowedProductionCall[] = [
  {
    productionId: "load-v4-preview",
    line: 225,
    column: 24,
    arguments: ["user.id", "created.planId"],
  },
  {
    productionId: "normalize-and-hash-v4-preview",
    line: 273,
    column: 23,
    arguments: [
      "{ userId: user.id, planId: created.planId, expectedRevision: created.draftRevision, name: \"Five-week V4 reference\", draft, }",
    ],
  },
  {
    productionId: "normalize-accepted-v4",
    line: 298,
    column: 5,
    arguments: ["materiallyChangedActual"],
  },
  {
    productionId: "load-v4-preview",
    line: 327,
    column: 26,
    arguments: ["user.id", "created.planId"],
  },
  {
    productionId: "normalize-and-hash-v4-preview",
    line: 349,
    column: 25,
    arguments: [
      "{ userId: user.id, planId: created.planId, expectedRevision: saved.revision, name: \"Five-week V4 reference\", draft: blockedDraft, }",
    ],
  },
  {
    productionId: "accept-v4-seed",
    line: 360,
    column: 7,
    arguments: [
      "{ userId: user.id, planId: created.planId, expectedDraftRevision: blocked.revision, }",
    ],
  },
  {
    productionId: "normalize-and-hash-v4-preview",
    line: 373,
    column: 26,
    arguments: [
      "{ userId: user.id, planId: created.planId, expectedRevision: blocked.revision, name: \"Five-week V4 reference\", draft, }",
    ],
  },
  {
    productionId: "load-v4-preview",
    line: 387,
    column: 31,
    arguments: ["user.id", "created.planId"],
  },
  {
    productionId: "normalize-and-hash-v4-preview",
    line: 409,
    column: 30,
    arguments: [
      "{ userId: user.id, planId: warningPlan.planId, expectedRevision: warningPlan.draftRevision, name: \"V4 warning-scope transaction proof\", draft: warningDraft, }",
    ],
  },
  {
    productionId: "accept-v4-seed",
    line: 449,
    column: 13,
    arguments: [
      "{ userId: user.id, planId: warningPlan.planId, expectedDraftRevision: warningSaved.revision, confirmedPreviewHash: warningPreview.hash, ...(warningConfirmationScope ? { warningConfirmationScope } : {}), }",
    ],
  },
  {
    productionId: "accept-v4-seed",
    line: 481,
    column: 30,
    arguments: [
      "{ userId: user.id, planId: warningPlan.planId, expectedDraftRevision: warningSaved.revision, confirmedPreviewHash: warningPreview.hash, warningConfirmationScope: mismatchHealth.confirmationScope, }",
    ],
  },
  {
    productionId: "accept-v4-seed",
    line: 500,
    column: 23,
    arguments: [
      "{ userId: user.id, planId: created.planId, expectedDraftRevision: restored.revision, confirmedPreviewHash: finalizationConfirmedHash, }",
    ],
  },
  {
    productionId: "load-active-accepted-v4-seed",
    line: 550,
    column: 31,
    arguments: ["user.id"],
  },
  {
    productionId: "resolve-next-v4-slot",
    line: 561,
    column: 27,
    arguments: ["user.id"],
  },
  {
    productionId: "materialize-session-from-intent",
    line: 574,
    column: 30,
    arguments: [
      "user.id",
      "{ intent: sessionIntentSchema.parse(scheduled.intent), slotId: scheduled.slotId }",
    ],
  },
  {
    productionId: "resolve-accepted-v4-week",
    line: 579,
    column: 30,
    arguments: ["saved.preview.normalizedPlan", "1"],
  },
];

function nodeSyntaxKey(node: ts.Node, sourceFile: ts.SourceFile): string {
  const children = node.getChildren(sourceFile);
  if (children.length === 0) {
    return `${ts.SyntaxKind[node.kind]}:${node.getText(sourceFile)}`;
  }
  return `${ts.SyntaxKind[node.kind]}(${children
    .map((child) => nodeSyntaxKey(child, sourceFile))
    .join(",")})`;
}

function expressionSyntaxKey(expression: string): string {
  const cached = allowlistedExpressionKeyCache.get(expression);
  if (cached) return cached;
  const sourceFile = ts.createSourceFile(
    "allowlisted-expression.ts",
    `const value = ${expression};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statement = sourceFile.statements[0];
  if (
    !statement ||
    !ts.isVariableStatement(statement) ||
    !statement.declarationList.declarations[0]?.initializer
  ) {
    throw new Error(`Invalid allowlisted expression: ${expression}`);
  }
  const key = nodeSyntaxKey(
    statement.declarationList.declarations[0].initializer,
    sourceFile,
  );
  allowlistedExpressionKeyCache.set(expression, key);
  return key;
}

function directProductionId(
  expression: ts.Expression,
  configuration: ProductionCallConfiguration,
  aliases: ReadonlyMap<string, string>,
): string | null {
  if (ts.isIdentifier(expression)) {
    return aliases.get(expression.text) ?? configuration.identifiers.get(expression.text) ?? null;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    return configuration.moduleMembers
      .get(expression.expression.text)
      ?.get(expression.name.text) ?? null;
  }
  return null;
}

function collectProductionAliases(
  sourceFile: ts.SourceFile,
  configuration: ProductionCallConfiguration,
): Map<string, string> {
  const aliases = new Map<string, string>();
  let changed = true;
  while (changed) {
    changed = false;
    function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isIdentifier(node.name)) {
          const productionId = directProductionId(node.initializer, configuration, aliases);
          if (productionId && aliases.get(node.name.text) !== productionId) {
            aliases.set(node.name.text, productionId);
            changed = true;
          }
        } else if (ts.isObjectBindingPattern(node.name) && ts.isIdentifier(node.initializer)) {
          const memberMap = configuration.moduleMembers.get(node.initializer.text);
          if (memberMap) {
            for (const element of node.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const importedName = element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : element.name.text;
              const productionId = memberMap.get(importedName);
              if (productionId && aliases.get(element.name.text) !== productionId) {
                aliases.set(element.name.text, productionId);
                changed = true;
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return aliases;
}

function observeProductionCalls(
  sourceFile: ts.SourceFile,
  configuration: ProductionCallConfiguration,
): ObservedProductionCall[] {
  const aliases = collectProductionAliases(sourceFile, configuration);
  const calls: ObservedProductionCall[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const productionId = directProductionId(node.expression, configuration, aliases);
      if (productionId) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        calls.push({
          productionId,
          line: position.line + 1,
          column: position.character + 1,
          argumentKeys: node.arguments.map((argument) => nodeSyntaxKey(argument, sourceFile)),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return calls;
}

function inspectProductionCalls(
  sourceFile: ts.SourceFile,
  configuration: ProductionCallConfiguration,
  allowlist: readonly AllowedProductionCall[],
): string[] {
  const observed = observeProductionCalls(sourceFile, configuration);
  const errors: string[] = [];
  const matchedAllowlist = new Set<number>();
  for (const call of observed) {
    const allowlistIndex = allowlist.findIndex(
      (allowed) =>
        allowed.productionId === call.productionId &&
        allowed.line === call.line &&
        allowed.column === call.column,
    );
    if (allowlistIndex < 0) {
      errors.push(
        `Unallowlisted production call ${call.productionId} at ${call.line}:${call.column}`,
      );
      continue;
    }
    matchedAllowlist.add(allowlistIndex);
    const allowedArgumentKeys = allowlist[allowlistIndex]!.arguments.map(expressionSyntaxKey);
    if (
      call.argumentKeys.length !== allowedArgumentKeys.length ||
      call.argumentKeys.some((key, index) => key !== allowedArgumentKeys[index])
    ) {
      errors.push(
        `Disallowed arguments for ${call.productionId} at ${call.line}:${call.column}`,
      );
    }
  }
  allowlist.forEach((allowed, index) => {
    if (!matchedAllowlist.has(index)) {
      errors.push(
        `Missing allowlisted production call ${allowed.productionId} at ${allowed.line}:${allowed.column}`,
      );
    }
  });
  return errors;
}

const syntheticProductionCalls: ProductionCallConfiguration = {
  identifiers: new Map([
    ["normalize", "normalize"],
    ["resolve", "resolve"],
  ]),
  moduleMembers: new Map(),
};

function expectRejectedWithOnlyActualArguments(
  source: string,
  productionId: "normalize" | "resolve",
  allowedArguments: readonly string[],
): void {
  const sourceFile = ts.createSourceFile(
    "synthetic-boundary.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const calls = observeProductionCalls(sourceFile, syntheticProductionCalls);
  expect(calls).toHaveLength(1);
  const call = calls[0]!;
  expect(call.productionId).toBe(productionId);
  expect(
    inspectProductionCalls(sourceFile, syntheticProductionCalls, [{
      productionId,
      line: call.line,
      column: call.column,
      arguments: allowedArguments,
    }]),
  ).toContain(`Disallowed arguments for ${productionId} at ${call.line}:${call.column}`);
}

let originalGraph: ReadonlySet<string>;
let revisedGraph: ReadonlySet<string>;
let postgresSourceFile: ts.SourceFile;

beforeAll(() => {
  parseSource(neutralHelper);
  originalGraph = collectLocalModuleGraph(originalProof);
  revisedGraph = collectLocalModuleGraph(revisedProof);
  postgresSourceFile = parseSource(postgresProof);
}, 15_000);

describe("template-session V4 proof module boundaries", () => {
  it("keeps the original PR #59 proof graph independent from every revised asset", () => {
    const graph = [...originalGraph].map(repositoryRelative);
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

    const source = readSource(originalProof);
    expect(source).toContain("25-placement V4 reference across all 20");
    expect(source).toContain("mutations at the exhaustive V4 reference");
  });

  it("keeps the revised proof independently collectible without original prescription expectations", () => {
    const graph = [...revisedGraph].map(repositoryRelative);
    expect(graph).toContain("src/lib/api/template-session-v4-revised.test.ts");
    expect(graph).toContain(
      "src/lib/api/template-session-v4-revised-reference.expected.ts",
    );
    expect(graph).toContain(
      "src/lib/engine/hypertrophy-plan-authoring-v4-revised.fixture.ts",
    );
    expect(graph).not.toContain("src/lib/api/template-session-v4-reference.expected.ts");

    const source = readSource(revisedProof);
    expect(source).toContain("26-placement revised V4 reference across all 20");
    expect(source).toContain("actual-side mutations at the revised V4 comparison");
  });

  it("parses each overlapping local dependency at most once per process", () => {
    expect(sourceParseCount.size).toBeGreaterThan(0);
    expect([...sourceParseCount.values()].every((count) => count === 1)).toBe(true);
    expect(graphCache.get(originalProof)).toBe(originalGraph);
    expect(graphCache.get(revisedProof)).toBe(revisedGraph);
  });

  it("bans every non-allowlisted import from the neutral structural projector", () => {
    expect(importShapes(parseSource(neutralHelper))).toEqual([
      {
        module: "vitest",
        namedImports: [{ imported: "expect", local: "expect", typeOnly: false }],
      },
      {
        module: "@/lib/engine/types",
        namedImports: [{ imported: "Exercise", local: "Exercise", typeOnly: true }],
      },
      {
        module: "@/lib/engine/hypertrophy-plan-authoring",
        namedImports: [{
          imported: "AcceptedHypertrophySeedV4",
          local: "AcceptedHypertrophySeedV4",
          typeOnly: true,
        }],
      },
      {
        module: "./template-session",
        namedImports: [{
          imported: "generateSessionFromIntent",
          local: "generateSessionFromIntent",
          typeOnly: true,
        }],
      },
    ]);
  });

  it("accepts only the exact current actual-owned PostgreSQL production calls", () => {
    expect(
      inspectProductionCalls(
        postgresSourceFile,
        postgresProductionCalls,
        postgresCallAllowlist,
      ),
    ).toEqual([]);

    const source = readSource(postgresProof);
    expect(source).toContain(
      "const expectedAccepted = bindAcceptedExerciseIdentityPlaceholders(",
    );
    expect(source).toContain(
      "const expectedRuntime = bindRuntimeExerciseIdentityPlaceholders(",
    );
    expect(source).toContain("saved.preview.normalizedPlan,\n    expectedAccepted,");
    expect(source).toContain("actualRuntime,\n    expectedRuntime,");
  });

  it("rejects direct, aliased, multi-hop, property, and destructured expected-owned arguments", () => {
    expectRejectedWithOnlyActualArguments(
      "normalize(expectedAccepted);",
      "normalize",
      ["saved.preview.normalizedPlan"],
    );
    expectRejectedWithOnlyActualArguments(
      "const oracle = expectedAccepted;\nnormalize(oracle);",
      "normalize",
      ["saved.preview.normalizedPlan"],
    );
    expectRejectedWithOnlyActualArguments(
      "const normalizeAlias = normalize;\nconst oracle = expectedAccepted;\nnormalizeAlias(oracle);",
      "normalize",
      ["saved.preview.normalizedPlan"],
    );
    expectRejectedWithOnlyActualArguments(
      "const first = expectedAccepted;\nconst second = first;\nresolve(second, 1);",
      "resolve",
      ["saved.preview.normalizedPlan", "1"],
    );
    expectRejectedWithOnlyActualArguments(
      "const holder = { payload: expectedAccepted };\nnormalize(holder.payload);",
      "normalize",
      ["saved.preview.normalizedPlan"],
    );
    expectRejectedWithOnlyActualArguments(
      "const holder = { payload: expectedAccepted };\nconst { payload } = holder;\nnormalize(payload);",
      "normalize",
      ["saved.preview.normalizedPlan"],
    );
  });

  it("rejects an unrecognized argument even when it is named actual", () => {
    expectRejectedWithOnlyActualArguments(
      "normalize(actual);",
      "normalize",
      ["saved.preview.normalizedPlan"],
    );
  });

  it("fails closed when a new production call has no exact allowlist entry", () => {
    const sourceFile = ts.createSourceFile(
      "postgres-with-extra-call.ts",
      `${readSource(postgresProof)}\nnormalizeAcceptedHypertrophySeedV4(saved.preview.normalizedPlan);`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect(
      inspectProductionCalls(
        sourceFile,
        postgresProductionCalls,
        postgresCallAllowlist,
      ),
    ).toContainEqual(expect.stringContaining("Unallowlisted production call normalize-accepted-v4"));
  });
});
