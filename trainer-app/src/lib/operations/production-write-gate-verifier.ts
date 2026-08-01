import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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

const ROUTE_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "delete",
  "deleteMany",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "$executeRaw",
  "$executeRawUnsafe",
]);
export type ProductionWriteGateVerification = {
  failures: string[];
  mutationRoutes: Array<[string, string]>;
  operationalCommands: Array<[string, string]>;
};

type CommandRegistryEntry = {
  packageScript?: string;
  entrypoint?: string;
  profile?: string;
  flagEscalations?: Array<{ sideEffectClass?: string }>;
};

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

function hasExportModifier(node: ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> }): boolean {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function routeFunctions(sourceFile: ts.SourceFile): ts.FunctionDeclaration[] {
  return sourceFile.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      hasExportModifier(statement) &&
      Boolean(statement.name && ROUTE_METHODS.has(statement.name.text)),
  );
}

function unsupportedRouteExports(sourceFile: ts.SourceFile): string[] {
  const unsupported = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && ROUTE_METHODS.has(declaration.name.text)) {
          unsupported.add(declaration.name.text);
        }
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (ROUTE_METHODS.has(element.name.text)) unsupported.add(element.name.text);
      }
    }
  }
  return [...unsupported];
}

function directGate(statement: ts.Statement): { call: ts.CallExpression; variable: string } | null {
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) {
    return null;
  }
  const declaration = statement.declarationList.declarations[0]!;
  if (
    !ts.isIdentifier(declaration.name) ||
    !declaration.initializer ||
    !ts.isCallExpression(declaration.initializer) ||
    !ts.isIdentifier(declaration.initializer.expression) ||
    declaration.initializer.expression.text !== "productionWritePauseResponse"
  ) {
    return null;
  }
  return { call: declaration.initializer, variable: declaration.name.text };
}

function returnsVariable(statement: ts.Statement, variable: string): boolean {
  if (
    !ts.isIfStatement(statement) ||
    !ts.isIdentifier(statement.expression) ||
    statement.expression.text !== variable
  ) {
    return false;
  }
  const branch = statement.thenStatement;
  if (ts.isReturnStatement(branch)) {
    return Boolean(branch.expression && ts.isIdentifier(branch.expression) && branch.expression.text === variable);
  }
  if (!ts.isBlock(branch) || branch.statements.length !== 1) return false;
  const returned = branch.statements[0];
  return Boolean(
    returned &&
      ts.isReturnStatement(returned) &&
      returned.expression &&
      ts.isIdentifier(returned.expression) &&
      returned.expression.text === variable,
  );
}

function containsDirectWrite(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(child)) {
      const expression = child.expression;
      if (ts.isPropertyAccessExpression(expression) && WRITE_METHODS.has(expression.name.text)) {
        found = true;
        return;
      }
      if (
        ts.isElementAccessExpression(expression) &&
        expression.argumentExpression &&
        ts.isStringLiteral(expression.argumentExpression) &&
        WRITE_METHODS.has(expression.argumentExpression.text)
      ) {
        found = true;
        return;
      }
      if (ts.isIdentifier(expression) && expression.text === "provisionOwnerForMutation") {
        found = true;
        return;
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function verifyRoutes(appRoot: string, fixtureMode: boolean): string[] {
  const failures: string[] = [];
  const discovered = new Set<string>();
  const apiRoot = join(appRoot, "src", "app", "api");
  for (const path of filesUnder(apiRoot).filter((value) => value.endsWith("route.ts"))) {
    const route = normalized(apiRoot, path);
    const sourceFile = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const method of unsupportedRouteExports(sourceFile)) {
      failures.push(`Unsupported route method declaration: ${route}#${method}`);
    }
    for (const handler of routeFunctions(sourceFile)) {
      const method = handler.name!.text;
      const key = `${route}#${method}`;
      discovered.add(key);
      if (method === "GET") {
        if (handler.getText(sourceFile).includes("provisionOwnerForMutation")) {
          failures.push(`Read surface calls owner provisioning: ${key}`);
        }
        continue;
      }
      const operation = APPLICATION_MUTATION_ROUTES.get(key);
      if (!operation && READ_ONLY_NON_GET_ROUTES.has(key)) {
        if (containsDirectWrite(handler)) {
          failures.push(`Read-only non-GET method contains a direct write: ${key}`);
        }
        continue;
      }
      if (!operation) {
        if (!fixtureMode) failures.push(`Unclassified mutation method: ${key}`);
        continue;
      }

      const statements = handler.body?.statements ?? [];
      const gateIndex = statements.findIndex((statement) => directGate(statement) !== null);
      if (gateIndex < 0) {
        failures.push(`Missing central gate for ${key} (${operation})`);
        continue;
      }
      const gate = directGate(statements[gateIndex]!)!;
      if (!statements[gateIndex + 1] || !returnsVariable(statements[gateIndex + 1]!, gate.variable)) {
        failures.push(`Central gate does not dominate ${key} (${operation})`);
      }
      const actualOperation = gate.call.arguments[0];
      if (!actualOperation || !ts.isStringLiteral(actualOperation) || actualOperation.text !== operation) {
        failures.push(`Wrong central gate operation for ${key}; expected ${operation}`);
      }
      const preGate = statements
        .slice(0, gateIndex)
        .map((statement) => statement.getText(sourceFile))
        .join("\n");
      if (/\bawait\b|request\s*\.\s*json|\bprisma\b|provisionOwnerForMutation/.test(preGate)) {
        failures.push(`Mutation work occurs before the central gate for ${key}`);
      }
      const handlerText = handler.getText(sourceFile);
      if (
        handlerText.includes("provisionOwnerForMutation") &&
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
  return failures;
}

function verifyOwnerBoundary(appRoot: string, fixtureMode: boolean): string[] {
  if (fixtureMode) return [];
  const failures: string[] = [];
  const ownerPath = join(appRoot, "src", "lib", "api", "workout-context.ts");
  if (!existsSync(ownerPath)) return ["Missing owner-resolution seam"];
  const ownerSource = readFileSync(ownerPath, "utf8");
  const ownerFile = ts.createSourceFile(ownerPath, ownerSource, ts.ScriptTarget.Latest, true);
  const functions = new Map(
    ownerFile.statements
      .filter((statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) && Boolean(statement.name && statement.body),
      )
      .map((statement) => [statement.name!.text, statement]),
  );
  if (/\bresolveOwner\b/.test(ownerSource)) failures.push("Legacy implicit owner provisioning remains");
  const readOnly = functions.get("findOwnerReadOnly");
  if (!readOnly || containsDirectWrite(readOnly)) {
    failures.push("Read-only owner lookup is missing or can write");
  }
  const provision = functions.get("provisionOwnerForMutation");
  const firstProvisionStatement = provision?.body?.statements[0];
  if (
    !firstProvisionStatement ||
    !ts.isExpressionStatement(firstProvisionStatement) ||
    !ts.isCallExpression(firstProvisionStatement.expression) ||
    !ts.isIdentifier(firstProvisionStatement.expression.expression) ||
    firstProvisionStatement.expression.expression.text !== "assertProductionWriteAllowed"
  ) {
    failures.push("Owner provisioning does not gate before its first operation");
  }

  for (const path of filesUnder(join(appRoot, "src", "app")).filter((value) => value.endsWith("page.tsx"))) {
    const rel = normalized(appRoot, path);
    const source = readFileSync(path, "utf8");
    if (source.includes("provisionOwnerForMutation")) {
      failures.push(`Read surface imports or calls owner provisioning: ${rel}`);
    }
  }
  return failures;
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

function registeredOperationalCommands(appRoot: string): {
  commands: Map<string, string>;
  failures: string[];
} {
  const policyPath = resolve(appRoot, "..", "scripts", "codex", "trainer-policy.v1.json");
  if (!existsSync(policyPath)) {
    return { commands: new Map(), failures: ["Missing canonical command registry policy"] };
  }
  const policy = JSON.parse(readFileSync(policyPath, "utf8")) as {
    commandRegistry?: CommandRegistryEntry[];
  };
  const commands = new Map<string, string>();
  for (const entry of policy.commandRegistry ?? []) {
    const productionCapable =
      entry.profile === "production-write" ||
      entry.flagEscalations?.some((flag) => flag.sideEffectClass === "production-write");
    if (!productionCapable || !entry.packageScript || !entry.entrypoint?.startsWith("trainer-app/")) {
      continue;
    }
    const relativeEntrypoint = entry.entrypoint.slice("trainer-app/".length);
    commands.set(entry.packageScript, relativeEntrypoint);
  }
  return { commands, failures: [] };
}

function verifyOperationalCommands(
  appRoot: string,
  fixtureMode: boolean,
): { failures: string[]; commands: Map<string, string> } {
  const failures: string[] = [];
  const packagePath = join(appRoot, "package.json");
  if (!existsSync(packagePath)) return { failures, commands: new Map() };
  const scripts = (JSON.parse(readFileSync(packagePath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
  const registry = fixtureMode ? { commands: new Map<string, string>(), failures: [] } : registeredOperationalCommands(appRoot);
  const registered = fixtureMode
    ? new Map(
        Object.entries(scripts)
          .map(([name, command]) => {
            const entry = commandEntry(command);
            const source = entry && existsSync(join(appRoot, entry)) ? readFileSync(join(appRoot, entry), "utf8") : "";
            return looksProductionCapable(name, command, source) && entry ? [name, entry] as const : null;
          })
          .filter((entry): entry is readonly [string, string] => entry !== null),
      )
    : registry.commands;
  failures.push(...registry.failures);

  for (const [name, expectedEntry] of registered) {
    const command = scripts[name];
    if (!command) {
      failures.push(`Stale operational command inventory entry: ${name}`);
      continue;
    }
    const actualEntry = commandEntry(command);
    if (actualEntry !== expectedEntry) {
      failures.push(`Operational command entry drift: ${name}; expected ${expectedEntry}, found ${actualEntry ?? "none"}`);
      continue;
    }
    const sourcePath = join(appRoot, expectedEntry);
    if (!existsSync(sourcePath)) {
      failures.push(`Missing operational command entry: ${expectedEntry}`);
      continue;
    }
    if (!hasTargetAwareBoundary(readFileSync(sourcePath, "utf8"))) {
      failures.push(`Registered production-capable command lacks target-aware pause enforcement: ${name}`);
    }
  }
  return { failures, commands: registered };
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
  const operational = verifyOperationalCommands(root, fixtureMode);
  const failures = [
    ...verifyRoutes(root, fixtureMode),
    ...verifyOwnerBoundary(root, fixtureMode),
    ...operational.failures,
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
    operationalCommands: [...operational.commands],
  };
}
