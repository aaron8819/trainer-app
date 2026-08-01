import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

export const APPLICATION_MUTATION_ROUTES = new Map<string, string>([
  ["profile/setup/route.ts#POST", "application_configuration"],
  ["preferences/route.ts#POST", "application_configuration"],
  ["periodization/macro/route.ts#POST", "mesocycle_acceptance"],
  ["plans/route.ts#POST", "mesocycle_acceptance"],
  ["plans/[id]/route.ts#PATCH", "application_configuration"],
  ["plans/[id]/finalize/route.ts#POST", "mesocycle_acceptance"],
  ["plans/[id]/activate/route.ts#POST", "mesocycle_acceptance"],
  ["plans/[id]/archive/route.ts#POST", "mesocycle_lifecycle"],
  ["program/route.ts#PATCH", "mesocycle_lifecycle"],
  ["templates/route.ts#POST", "application_configuration"],
  ["templates/[id]/route.ts#PUT", "application_configuration"],
  ["templates/[id]/route.ts#DELETE", "application_configuration"],
  ["templates/[id]/exercises/route.ts#POST", "application_configuration"],
  ["exercises/[id]/favorite/route.ts#POST", "application_configuration"],
  ["exercises/[id]/avoid/route.ts#POST", "application_configuration"],
  ["readiness/submit/route.ts#POST", "readiness_submission"],
  ["pre-session-readiness/prepare/route.ts#POST", "readiness_preparation"],
  ["mesocycles/[id]/accept-next-cycle/route.ts#POST", "mesocycle_acceptance"],
  ["mesocycles/[id]/refresh-next-seed-draft/route.ts#POST", "mesocycle_reseed"],
  ["mesocycles/[id]/draft/route.ts#PATCH", "mesocycle_reseed"],
  ["mesocycles/[id]/finish-deload/route.ts#POST", "mesocycle_lifecycle"],
  ["mesocycles/week-close/[id]/closeout/route.ts#POST", "mesocycle_lifecycle"],
  ["mesocycles/week-close/[id]/dismiss/route.ts#POST", "mesocycle_lifecycle"],
  ["workouts/generate-from-intent/route.ts#POST", "workout_materialization"],
  ["workouts/generate-from-template/route.ts#POST", "workout_materialization"],
  ["workouts/save/route.ts#POST", "workout_save"],
  ["workouts/delete/route.ts#POST", "workout_structural_edit"],
  ["workouts/[id]/finisher/route.ts#POST", "finisher_execution"],
  ["workouts/[id]/add-exercise/route.ts#POST", "workout_structural_edit"],
  ["workouts/[id]/swap-exercise/route.ts#POST", "workout_structural_edit"],
  ["workouts/[id]/exercises/[exerciseId]/route.ts#DELETE", "workout_structural_edit"],
  ["workouts/[id]/exercises/[exerciseId]/add-set/route.ts#POST", "workout_structural_edit"],
  ["workouts/[id]/dismiss-closeout/route.ts#POST", "workout_structural_edit"],
  ["logs/set/route.ts#POST", "set_logging"],
  ["logs/set/route.ts#DELETE", "set_logging"],
]);

export const READ_ONLY_NON_GET_ROUTES = new Set([
  "mesocycles/[id]/setup-preview/route.ts#POST",
  "workouts/[id]/add-exercise-preview/route.ts#POST",
]);

export const OPERATIONAL_WRITE_COMMANDS = new Map<string, string>([
  ["audit:workout", "scripts/workout-audit.ts"],
  ["audit:week", "scripts/workout-audit.ts"],
  ["audit:week:debug", "scripts/workout-audit.ts"],
  ["audit:week:retro", "scripts/workout-audit.ts"],
  ["backfill:week1-performed", "scripts/backfill-week1-performed-sessions.ts"],
  ["db:seed", "prisma/seed.ts"],
  ["ops:backfill-post-session-reviews", "scripts/backfill-post-session-reviews.ts"],
  ["ops:backfill-seed-revisions", "scripts/backfill-immutable-seed-revisions.ts"],
  ["ops:backfill-stimulus-accounting", "scripts/backfill-workout-exercise-stimulus-accounting.ts"],
  ["ops:finisher-principals", "scripts/manage-finisher-principals.ts"],
  ["ops:preflight-post-session-reviews", "scripts/backfill-post-session-reviews.ts"],
  ["ops:preflight-seed-revisions", "scripts/backfill-immutable-seed-revisions.ts"],
  ["ops:preflight-stimulus-accounting", "scripts/backfill-workout-exercise-stimulus-accounting.ts"],
  ["ops:refresh-next-seed-draft", "scripts/ops-refresh-next-seed-draft.ts"],
  ["prisma:studio", "scripts/run-target-aware-prisma-studio.ts"],
  ["repair:exercise-library", "scripts/repair-exercise-library.ts"],
  ["repair:exercise-library:apply", "scripts/repair-exercise-library.ts"],
  ["repair:historical-session-slot-receipts", "prisma/repair-historical-session-slot-receipts.ts"],
  ["repair:week-close-handoff", "scripts/repair-week-close-handoff.ts"],
  ["repair:workout-week-snapshot", "scripts/repair-workout-week-snapshot.ts"],
  ["sync:exercise-library", "scripts/sync-exercise-library.ts"],
  ["sync:exercise-library:apply", "scripts/sync-exercise-library.ts"],
]);

type FunctionRecord = {
  key: string;
  file: string;
  name: string;
  node: ts.FunctionLikeDeclaration;
  sourceFile: ts.SourceFile;
};

type Analysis = {
  functions: Map<string, FunctionRecord>;
  byFileAndName: Map<string, string>;
  imports: Map<string, Map<string, { file: string; imported: string }>>;
};

export type ProductionWriteGateVerification = {
  failures: string[];
  mutationRoutes: Array<[string, string]>;
  operationalCommands: Array<[string, string]>;
};

const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "delete",
  "deleteMany",
  "update",
  "updateMany",
  "upsert",
  "$executeRaw",
  "$executeRawUnsafe",
]);

function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function normalized(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function resolveImport(appRoot: string, fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(appRoot, "src", specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return resolve(candidate);
  }
  return null;
}

function functionName(node: ts.FunctionLikeDeclaration, fallback: string): string {
  if (
    "modifiers" in node &&
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
  ) {
    return "default";
  }
  if ("name" in node && node.name && ts.isIdentifier(node.name)) return node.name.text;
  return fallback;
}

function analyze(appRoot: string): Analysis {
  const files = [join(appRoot, "src"), join(appRoot, "scripts"), join(appRoot, "prisma")]
    .flatMap(filesUnder)
    .filter((path) => /\.(?:ts|tsx)$/.test(path) && !/\.test\.|\.db-test-/.test(path));
  const functions = new Map<string, FunctionRecord>();
  const byFileAndName = new Map<string, string>();
  const imports = new Map<string, Map<string, { file: string; imported: string }>>();

  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const fileImports = new Map<string, { file: string; imported: string }>();
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const target = resolveImport(appRoot, file, statement.moduleSpecifier.text);
      if (!target || !statement.importClause) continue;
      if (statement.importClause.name) {
        fileImports.set(statement.importClause.name.text, { file: target, imported: "default" });
      }
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          fileImports.set(element.name.text, {
            file: target,
            imported: element.propertyName?.text ?? element.name.text,
          });
        }
      }
    }
    imports.set(resolve(file), fileImports);

    const visit = (node: ts.Node) => {
      let record: FunctionRecord | null = null;
      if (ts.isFunctionDeclaration(node) && node.body) {
        const name = functionName(node, "default");
        record = { key: `${resolve(file)}#${name}`, file: resolve(file), name, node, sourceFile };
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ) {
        const name = node.name.text;
        record = {
          key: `${resolve(file)}#${name}`,
          file: resolve(file),
          name,
          node: node.initializer,
          sourceFile,
        };
      }
      if (record) {
        functions.set(record.key, record);
        byFileAndName.set(`${record.file}#${record.name}`, record.key);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { functions, byFileAndName, imports };
}

function directWrite(record: FunctionRecord): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === "provisionOwnerForMutation") {
        found = true;
        return;
      }
      if (ts.isPropertyAccessExpression(expression)) {
        const method = expression.name.text;
        const receiver = expression.expression.getText(record.sourceFile);
        if (
          WRITE_METHODS.has(method) &&
          /^(?:prisma|tx|db|client)(?:\.|$)/.test(receiver)
        ) {
          found = true;
          return;
        }
        if (method === "query" && /^(?:pool|client)(?:\.|$)/.test(receiver)) {
          const sql = node.arguments[0]?.getText(record.sourceFile) ?? "";
          if (/\b(?:insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i.test(sql)) {
            found = true;
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(record.node);
  return found;
}

function calledFunctionKeys(record: FunctionRecord, analysis: Analysis): string[] {
  const keys = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      const local = analysis.byFileAndName.get(`${record.file}#${name}`);
      if (local) keys.add(local);
      const imported = analysis.imports.get(record.file)?.get(name);
      if (imported) {
        const target = analysis.byFileAndName.get(`${imported.file}#${imported.imported}`);
        if (target) keys.add(target);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(record.node);
  return [...keys];
}

function reachesWrite(
  key: string,
  analysis: Analysis,
  memo: Map<string, boolean>,
  visiting = new Set<string>(),
): boolean {
  if (memo.has(key)) return memo.get(key)!;
  if (visiting.has(key)) return false;
  visiting.add(key);
  const record = analysis.functions.get(key);
  const result = Boolean(
    record &&
      (directWrite(record) ||
        calledFunctionKeys(record, analysis).some((child) =>
          reachesWrite(child, analysis, memo, visiting),
        )),
  );
  visiting.delete(key);
  memo.set(key, result);
  return result;
}

function routeFunctions(sourceFile: ts.SourceFile): ts.FunctionDeclaration[] {
  return sourceFile.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      Boolean(statement.name && ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(statement.name.text)),
  );
}

function verifyReadSurfaces(appRoot: string, analysis: Analysis): string[] {
  const failures: string[] = [];
  const memo = new Map<string, boolean>();
  for (const [key, record] of analysis.functions) {
    const rel = normalized(appRoot, record.file);
    const isGet = rel.startsWith("src/app/api/") && rel.endsWith("/route.ts") && record.name === "GET";
    const isPage = rel.startsWith("src/app/") && rel.endsWith("/page.tsx") && record.name === "default";
    if ((isGet || isPage) && reachesWrite(key, analysis, memo)) {
      failures.push(`Read surface reaches a database write: ${rel}#${record.name}`);
    }
  }
  return failures;
}

function statementContainsCall(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  name: string,
): ts.CallExpression | null {
  let found: ts.CallExpression | null = null;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
}

function verifyRoutes(appRoot: string, fixtureMode: boolean): { failures: string[]; discovered: Set<string> } {
  const failures: string[] = [];
  const discovered = new Set<string>();
  const apiRoot = join(appRoot, "src", "app", "api");
  for (const path of filesUnder(apiRoot).filter((value) => value.endsWith("route.ts"))) {
    const route = normalized(apiRoot, path);
    const sourceFile = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    for (const handler of routeFunctions(sourceFile)) {
      const method = handler.name!.text;
      const key = `${route}#${method}`;
      discovered.add(key);
      if (method === "GET") continue;
      const operation = APPLICATION_MUTATION_ROUTES.get(key);
      if (!operation && READ_ONLY_NON_GET_ROUTES.has(key)) continue;
      if (!operation) {
        if (!fixtureMode) failures.push(`Unclassified mutation method: ${key}`);
        continue;
      }
      const statements = handler.body?.statements ?? [];
      const gateIndex = statements.findIndex((statement) =>
        Boolean(statementContainsCall(statement, sourceFile, "productionWritePauseResponse")),
      );
      if (gateIndex < 0) {
        failures.push(`Missing central gate for ${key} (${operation})`);
        continue;
      }
      const gate = statementContainsCall(
        statements[gateIndex]!,
        sourceFile,
        "productionWritePauseResponse",
      )!;
      const actualOperation = gate.arguments[0];
      if (!actualOperation || !ts.isStringLiteral(actualOperation) || actualOperation.text !== operation) {
        failures.push(`Wrong central gate operation for ${key}; expected ${operation}`);
      }
      const preGate = statements.slice(0, gateIndex).map((statement) => statement.getText(sourceFile)).join("\n");
      if (/\bawait\b|request\s*\.\s*json|\bprisma\b|provisionOwnerForMutation/.test(preGate)) {
        failures.push(`Mutation work occurs before the central gate for ${key}`);
      }
      const handlerText = handler.getText(sourceFile);
      const provisionIndex = handlerText.indexOf("provisionOwnerForMutation");
      const gateOffset = handlerText.indexOf("productionWritePauseResponse");
      if (provisionIndex >= 0 && provisionIndex < gateOffset) {
        failures.push(`Owner provisioning occurs before the central gate for ${key}`);
      }
      if (
        provisionIndex >= 0 &&
        !new RegExp(`provisionOwnerForMutation\\(\\s*["']${operation}["']`).test(handlerText)
      ) {
        failures.push(`Owner provisioning operation does not match ${key} (${operation})`);
      }
    }
  }
  if (!fixtureMode) {
    for (const key of APPLICATION_MUTATION_ROUTES.keys()) {
      if (!discovered.has(key)) failures.push(`Stale gated-route inventory entry: ${key}`);
    }
    for (const key of READ_ONLY_NON_GET_ROUTES) {
      if (!discovered.has(key)) failures.push(`Stale read-only route inventory entry: ${key}`);
    }
  }
  return { failures, discovered };
}

function commandEntry(command: string): string | null {
  const match = command.match(/(?:^|\s)(?:tsx|node)\s+([^\s]+\.(?:ts|mjs|js))/);
  return match?.[1]?.replaceAll("\\", "/") ?? null;
}

function hasTargetAwareBoundary(source: string): boolean {
  return (
    source.includes("runWithRolloutEnvironment") ||
    source.includes("assertOperationalProductionWriteAllowed") ||
    /loadAuditEnv\([\s\S]{0,180}writeRequested\s*:/.test(source) ||
    source.includes("PRODUCTION_PRINCIPAL_PROVISIONING_BLOCKED")
  );
}

function looksProductionCapable(commandName: string, command: string, source: string): boolean {
  if (commandName.startsWith("test:")) return false;
  if (commandName === "prisma:studio") return true;
  return (
    /\bprisma\s+studio\b|\bprisma[\\/]seed\.ts\b/.test(command) ||
    /--(?:write|apply|execute|accept-slot-plan-upgrade|apply-bounded-reseed)\b/.test(source) ||
    /\b(?:prisma|tx|db|client)\.[A-Za-z0-9_]+\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(source) ||
    /loadAuditEnv\([\s\S]{0,120}allowWrite\s*:\s*true/.test(source)
  );
}

function verifyOperationalCommands(appRoot: string, fixtureMode: boolean): string[] {
  const failures: string[] = [];
  const packagePath = join(appRoot, "package.json");
  if (!existsSync(packagePath)) return failures;
  const scripts = (JSON.parse(readFileSync(packagePath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
  for (const [name, command] of Object.entries(scripts)) {
    const entry = commandEntry(command);
    const source = entry && existsSync(join(appRoot, entry)) ? readFileSync(join(appRoot, entry), "utf8") : "";
    if (!looksProductionCapable(name, command, source)) continue;
    const registered = OPERATIONAL_WRITE_COMMANDS.get(name);
    if (!registered) {
      failures.push(`Registered production-capable command is unclassified: ${name}`);
      continue;
    }
    if (entry !== registered) {
      failures.push(`Operational command entry drift: ${name}; expected ${registered}, found ${entry ?? "none"}`);
    }
    if (!hasTargetAwareBoundary(source)) {
      failures.push(`Registered production-capable command lacks target-aware pause enforcement: ${name}`);
    }
  }
  if (!fixtureMode) {
    for (const [name, entry] of OPERATIONAL_WRITE_COMMANDS) {
      if (!(name in scripts)) failures.push(`Stale operational command inventory entry: ${name}`);
      else if (!existsSync(join(appRoot, entry))) failures.push(`Missing operational command entry: ${entry}`);
    }
  }
  return failures;
}

export function verifyWriteGateContract(appRoot: string): string[] {
  const failures: string[] = [];
  const gatePath = join(appRoot, "src", "lib", "operations", "production-write-gate.ts");
  if (!existsSync(gatePath)) return ["Missing production write-gate owner"];
  const source = readFileSync(gatePath, "utf8");
  if (!/PRODUCTION_WRITE_STATUS_CONTRACT_VERSION\s*=\s*2\s+as const/.test(source)) {
    failures.push("Stale production write-status contract version");
  }
  if (!/PRODUCTION_WRITE_ENFORCEMENT_CONTRACT_VERSION\s*=\s*2\s+as const/.test(source)) {
    failures.push("Stale production write-enforcement contract version");
  }
  if (!source.includes('"application_all_classified_write_paths" as const')) {
    failures.push("False or stale application write-coverage declaration");
  }
  return failures;
}

export function verifyProductionWriteGate(
  appRoot = process.cwd(),
  options: { fixtureMode?: boolean } = {},
): ProductionWriteGateVerification {
  const root = resolve(appRoot);
  const fixtureMode = options.fixtureMode ?? false;
  const analysis = analyze(root);
  const routes = verifyRoutes(root, fixtureMode);
  const failures = [
    ...routes.failures,
    ...verifyReadSurfaces(root, analysis),
    ...verifyOperationalCommands(root, fixtureMode),
    ...(fixtureMode ? [] : verifyWriteGateContract(root)),
  ];
  if (!fixtureMode) {
    for (const path of [join(root, "src"), join(root, "scripts")]
      .flatMap(filesUnder)
      .filter((value) => value.endsWith(".ts") && !value.endsWith(".test.ts"))) {
      const rel = normalized(root, path);
      if (
        [
          "src/lib/operations/production-write-gate.ts",
          "src/lib/operations/production-write-gate-verifier.ts",
          "scripts/check-production-write-gate.ts",
        ].includes(rel)
      ) continue;
      const source = readFileSync(path, "utf8");
      if (/TRAINER_WRITE_PAUSE|NEXT_PUBLIC_.*(?:WRITE|MAINTENANCE)|MAINTENANCE_MODE|WRITES_PAUSED/.test(source)) {
        const allowed = new Set([
          "src/lib/operations/production-write-status-command.ts",
          "src/lib/operations/rollout-environment.ts",
        ]);
        if (!allowed.has(rel)) failures.push(`Direct or competing write-pause environment check: ${rel}`);
      }
    }
  }
  return {
    failures: [...new Set(failures)].sort(),
    mutationRoutes: [...APPLICATION_MUTATION_ROUTES],
    operationalCommands: [...OPERATIONAL_WRITE_COMMANDS],
  };
}
