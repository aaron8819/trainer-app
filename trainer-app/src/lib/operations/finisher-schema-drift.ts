export const PROTECTED_FINISHER_RELATIONSHIPS = [
  "FinisherExecutionStep_executionId_routineVersionId_fkey",
  "FinisherExecutionStep_routineStep_binding_fkey",
  "FinisherExecutionStep_performedAlternative_binding_fkey",
] as const;

export const PROTECTED_FINISHER_UNIQUENESS = [
  "FinisherExecution_id_routineVersionId_key",
  "FinisherRoutineStep_id_routineVersionId_orderIndex_key",
  "FinisherRoutineStepAlternative_id_routineStepId_key",
] as const;

export const INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS = [
  "FinisherExecutionStep_executionId_fkey",
  "FinisherExecutionStep_routineStepId_fkey",
  "FinisherExecutionStep_performedAlternativeId_fkey",
] as const;

const intentionalDatabaseOnly = new Set<string>(
  INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS,
);

export type FinisherSchemaDriftReport = {
  issues: string[];
  intentionalDatabaseOnlyExtensions: string[];
};

function statements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function unquote(identifier: string): string {
  return identifier.replace(/^"|"$/g, "");
}

function isFinisherIdentifier(identifier: string): boolean {
  return unquote(identifier).startsWith("Finisher");
}

export function inspectFinisherSchemaDiff(
  sql: string,
): FinisherSchemaDriftReport {
  const issues = new Set<string>();
  const extensions = new Set<string>();

  for (const statement of statements(sql)) {
    const droppedConstraint = statement.match(
      /^ALTER TABLE ("[^"]+"|\S+) DROP CONSTRAINT ("[^"]+"|\S+)$/i,
    );
    if (droppedConstraint) {
      const table = unquote(droppedConstraint[1]!);
      const constraint = unquote(droppedConstraint[2]!);
      if (!isFinisherIdentifier(table) && !isFinisherIdentifier(constraint)) {
        continue;
      }
      if (intentionalDatabaseOnly.has(constraint)) {
        extensions.add(constraint);
      } else {
        issues.add(`destructive-constraint-drop:${table}.${constraint}`);
      }
      continue;
    }

    const droppedIndex = statement.match(/^DROP INDEX ("[^"]+"|\S+)$/i);
    if (droppedIndex && isFinisherIdentifier(droppedIndex[1]!)) {
      issues.add(`destructive-index-drop:${unquote(droppedIndex[1]!)}`);
      continue;
    }

    const droppedTable = statement.match(
      /^DROP TABLE ("[^"]+"|\S+)(?: CASCADE)?$/i,
    );
    if (droppedTable && isFinisherIdentifier(droppedTable[1]!)) {
      issues.add(`destructive-table-drop:${unquote(droppedTable[1]!)}`);
      continue;
    }

    const addedForeignKey = statement.match(
      /^ALTER TABLE ("[^"]+"|\S+) ADD CONSTRAINT ("[^"]+"|\S+) FOREIGN KEY .+ ON DELETE (\w+) ON UPDATE (\w+)$/i,
    );
    if (addedForeignKey) {
      const table = unquote(addedForeignKey[1]!);
      const constraint = unquote(addedForeignKey[2]!);
      if (!isFinisherIdentifier(table) && !isFinisherIdentifier(constraint)) {
        continue;
      }
      const onDelete = addedForeignKey[3]!.toUpperCase();
      const onUpdate = addedForeignKey[4]!.toUpperCase();
      if (onDelete !== "RESTRICT" || onUpdate !== "RESTRICT") {
        issues.add(
          `weak-foreign-key-action:${table}.${constraint}:delete=${onDelete}:update=${onUpdate}`,
        );
      }
      continue;
    }

    if (
      /\b(?:DROP|CASCADE)\b/i.test(statement) &&
      /"Finisher[A-Za-z0-9_]*"/.test(statement)
    ) {
      issues.add(`unrecognized-destructive-finisher-diff:${statement}`);
    }
  }

  return {
    issues: [...issues].sort(),
    intentionalDatabaseOnlyExtensions: [...extensions].sort(),
  };
}
