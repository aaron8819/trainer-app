import { describe, expect, it } from "vitest";
import {
  inspectFinisherSchemaDiff,
  INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS,
  PROTECTED_FINISHER_RELATIONSHIPS,
  PROTECTED_FINISHER_UNIQUENESS,
} from "./finisher-schema-drift";

const executionStepTable = "FinisherExecutionStep";

function expectedDrop(
  constraint: string,
  table = executionStepTable,
): string {
  return `ALTER TABLE "${table}" DROP CONSTRAINT "${constraint}"`;
}

function expectRejected(sql: string, statement: string): void {
  expect(inspectFinisherSchemaDiff(sql).issues).toContain(
    `unexpected-statement:${statement}`,
  );
}

describe("Finisher migrated-database-to-Prisma drift", () => {
  it("accepts and reports exactly the three database-only relationship drops", () => {
    const report = inspectFinisherSchemaDiff(
      INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS.map(
        (constraint) => `${expectedDrop(constraint)};`,
      ).join("\n"),
    );

    expect(report).toEqual({
      issues: [],
      intentionalDatabaseOnlyExtensions: [
        ...INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS,
      ].sort(),
    });
  });

  it.each(INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS)(
    "accepts and reports the individual documented exception %s",
    (constraint) => {
      expect(inspectFinisherSchemaDiff(`${expectedDrop(constraint)};`)).toEqual({
        issues: [],
        intentionalDatabaseOnlyExtensions: [constraint],
      });
    },
  );

  it("rejects a wrong constraint name", () => {
    const statement = expectedDrop(
      "FinisherExecutionStep_unreviewed_relationship_fkey",
    );
    expectRejected(`${statement};`, statement);
  });

  it("rejects an expected constraint name on the wrong table", () => {
    const statement = expectedDrop(
      INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS[0],
      "Workout",
    );
    expectRejected(`${statement};`, statement);
  });

  it.each([
    'ALTER TABLE "Workout" DROP COLUMN "status"',
    'ALTER TABLE "Workout" ADD COLUMN "unreviewed" TEXT',
  ])(
    "rejects an expected drop combined with unrelated schema drift: %s",
    (unexpected) => {
      const expected = expectedDrop(
        INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS[0],
      );
      const report = inspectFinisherSchemaDiff(`${expected}; ${unexpected};`);

      expect(report.intentionalDatabaseOnlyExtensions).toEqual([
        INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS[0],
      ]);
      expect(report.issues).toEqual([`unexpected-statement:${unexpected}`]);
    },
  );

  it("rejects restoration of a missing protected composite foreign key even with restrictive actions", () => {
    const constraint = PROTECTED_FINISHER_RELATIONSHIPS[0];
    const statement =
      `ALTER TABLE "FinisherExecutionStep" ADD CONSTRAINT "${constraint}" ` +
      'FOREIGN KEY ("executionId", "routineVersionId") ' +
      'REFERENCES "FinisherExecution"("id", "routineVersionId") ' +
      "ON DELETE RESTRICT ON UPDATE RESTRICT";

    expectRejected(`${statement};`, statement);
  });

  it("rejects a protected relationship with cascading behavior", () => {
    const constraint = PROTECTED_FINISHER_RELATIONSHIPS[1];
    const statement =
      `ALTER TABLE "FinisherExecutionStep" ADD CONSTRAINT "${constraint}" ` +
      'FOREIGN KEY ("routineStepId", "routineVersionId", "orderIndex") ' +
      'REFERENCES "FinisherRoutineStep"("id", "routineVersionId", "orderIndex") ' +
      "ON DELETE CASCADE ON UPDATE RESTRICT";

    expectRejected(`${statement};`, statement);
  });

  it.each([
    [
      "added",
      `CREATE UNIQUE INDEX "${PROTECTED_FINISHER_UNIQUENESS[0]}" ON "FinisherExecution"("id", "routineVersionId")`,
    ],
    [
      "removed",
      `DROP INDEX "${PROTECTED_FINISHER_UNIQUENESS[1]}"`,
    ],
    [
      "changed",
      `ALTER INDEX "${PROTECTED_FINISHER_UNIQUENESS[2]}" RENAME TO "changed_supporting_key"`,
    ],
  ])("rejects supporting composite uniqueness being %s", (_case, statement) => {
    expectRejected(`${statement};`, statement);
  });

  it("assesses every statement independently", () => {
    const expected = expectedDrop(
      INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS[2],
    );
    const dropColumn = 'ALTER TABLE "Workout" DROP COLUMN "status"';
    const addColumn = 'ALTER TABLE "Workout" ADD COLUMN "status2" TEXT';
    const report = inspectFinisherSchemaDiff(
      `${expected}; ${dropColumn}; ${addColumn};`,
    );

    expect(report.intentionalDatabaseOnlyExtensions).toEqual([
      INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS[2],
    ]);
    expect(report.issues).toEqual([
      `unexpected-statement:${addColumn}`,
      `unexpected-statement:${dropColumn}`,
    ]);
  });

  it("normalizes comments, whitespace, quoting, wrappers, and statement order", () => {
    const [executionId, routineStepId, performedAlternativeId] =
      INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS;
    const report = inspectFinisherSchemaDiff(`
      BEGIN;
      /* Prisma may emit the documented drops in any order. */
      alter table FinisherExecutionStep
        drop constraint ${performedAlternativeId};
      -- The comment and whitespace are non-executable.
      ALTER   TABLE "FinisherExecutionStep" /* relationship */
        DROP CONSTRAINT "${executionId}";
      ALTER TABLE FinisherExecutionStep DROP CONSTRAINT ${routineStepId};
      COMMIT;
    `);

    expect(report).toEqual({
      issues: [],
      intentionalDatabaseOnlyExtensions: [
        ...INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS,
      ].sort(),
    });
  });

  it.each(["", "  -- no changes\n", "BEGIN; /* no changes */ COMMIT;"])(
    "accepts an empty or no-op diff",
    (sql) => {
      expect(inspectFinisherSchemaDiff(sql)).toEqual({
        issues: [],
        intentionalDatabaseOnlyExtensions: [],
      });
    },
  );

  it("rejects unrecognized executable SQL", () => {
    expect(inspectFinisherSchemaDiff("SELECT 1;").issues).toEqual([
      "unexpected-statement:SELECT 1",
    ]);
  });

  it("rejects malformed executable SQL", () => {
    const report = inspectFinisherSchemaDiff(
      'ALTER TABLE "FinisherExecutionStep DROP CONSTRAINT "broken";',
    );

    expect(report.issues).toContain("malformed-sql:unterminated-identifier");
    expect(report.issues.some((issue) => issue.startsWith("unexpected-statement:"))).toBe(
      true,
    );
  });
});
