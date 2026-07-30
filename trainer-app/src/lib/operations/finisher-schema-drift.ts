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
const intentionalDatabaseOnlyTable = "FinisherExecutionStep";

export type FinisherSchemaDriftReport = {
  issues: string[];
  intentionalDatabaseOnlyExtensions: string[];
};

type SqlStatements = {
  statements: string[];
  issues: string[];
};

function splitSqlStatements(sql: string): SqlStatements {
  const statements: string[] = [];
  const issues: string[] = [];
  let current = "";
  let state: "normal" | "single-quote" | "double-quote" | "line-comment" | "block-comment" =
    "normal";
  let blockCommentDepth = 0;

  const pushStatement = () => {
    const normalized = current.replace(/\s+/g, " ").trim();
    if (normalized) statements.push(normalized);
    current = "";
  };

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    const next = sql[index + 1];

    if (state === "line-comment") {
      if (character === "\n" || character === "\r") {
        current += " ";
        state = "normal";
      }
      continue;
    }

    if (state === "block-comment") {
      if (character === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 1;
      } else if (character === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 1;
        if (blockCommentDepth === 0) {
          current += " ";
          state = "normal";
        }
      }
      continue;
    }

    if (state === "single-quote") {
      current += character;
      if (character === "'" && next === "'") {
        current += next;
        index += 1;
      } else if (character === "'") {
        state = "normal";
      }
      continue;
    }

    if (state === "double-quote") {
      current += character;
      if (character === '"' && next === '"') {
        current += next;
        index += 1;
      } else if (character === '"') {
        state = "normal";
      }
      continue;
    }

    if (character === "-" && next === "-") {
      current += " ";
      state = "line-comment";
      index += 1;
    } else if (character === "/" && next === "*") {
      current += " ";
      state = "block-comment";
      blockCommentDepth = 1;
      index += 1;
    } else if (character === "'") {
      current += character;
      state = "single-quote";
    } else if (character === '"') {
      current += character;
      state = "double-quote";
    } else if (character === ";") {
      pushStatement();
    } else {
      current += character;
    }
  }

  if (state === "block-comment") {
    issues.push("malformed-sql:unterminated-block-comment");
  } else if (state === "single-quote") {
    issues.push("malformed-sql:unterminated-string");
  } else if (state === "double-quote") {
    issues.push("malformed-sql:unterminated-identifier");
  }
  pushStatement();

  return { statements, issues };
}

function unquote(identifier: string): string {
  return identifier.startsWith('"') && identifier.endsWith('"')
    ? identifier.slice(1, -1).replaceAll('""', '"')
    : identifier;
}

function isTransactionWrapper(statement: string): boolean {
  return /^(?:BEGIN(?: TRANSACTION)?|START TRANSACTION|COMMIT(?: TRANSACTION)?)$/i.test(
    statement,
  );
}

export function inspectFinisherSchemaDiff(
  sql: string,
): FinisherSchemaDriftReport {
  const parsed = splitSqlStatements(sql);
  const issues = new Set<string>(parsed.issues);
  const extensions = new Set<string>();
  const identifier = String.raw`(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)`;
  const expectedDrop = new RegExp(
    String.raw`^ALTER\s+TABLE\s+(${identifier})\s+DROP\s+CONSTRAINT\s+(${identifier})$`,
    "i",
  );

  for (const statement of parsed.statements) {
    if (isTransactionWrapper(statement)) continue;

    const drop = statement.match(expectedDrop);
    if (drop) {
      const table = unquote(drop[1]!);
      const constraint = unquote(drop[2]!);
      if (
        table === intentionalDatabaseOnlyTable &&
        intentionalDatabaseOnly.has(constraint)
      ) {
        extensions.add(constraint);
        continue;
      }
    }
    issues.add(`unexpected-statement:${statement}`);
  }

  return {
    issues: [...issues].sort(),
    intentionalDatabaseOnlyExtensions: [...extensions].sort(),
  };
}
