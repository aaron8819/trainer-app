import { describe, expect, it } from "vitest";
import {
  inspectFinisherSchemaDiff,
  INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS,
  PROTECTED_FINISHER_RELATIONSHIPS,
  PROTECTED_FINISHER_UNIQUENESS,
} from "./finisher-schema-drift";

describe("Finisher Prisma-to-migration relationship drift", () => {
  it.each(PROTECTED_FINISHER_RELATIONSHIPS)(
    "rejects removal of protected relationship %s",
    (constraint) => {
      const report = inspectFinisherSchemaDiff(`
        -- DropForeignKey
        ALTER TABLE "FinisherExecutionStep" DROP CONSTRAINT "${constraint}";
      `);
      expect(report.issues).toEqual([
        `destructive-constraint-drop:FinisherExecutionStep.${constraint}`,
      ]);
    },
  );

  it.each(PROTECTED_FINISHER_UNIQUENESS)(
    "rejects removal of supporting uniqueness %s",
    (index) => {
      const report = inspectFinisherSchemaDiff(`DROP INDEX "${index}";`);
      expect(report.issues).toEqual([`destructive-index-drop:${index}`]);
    },
  );

  it.each([
    ["CASCADE", "RESTRICT"],
    ["RESTRICT", "CASCADE"],
    ["CASCADE", "CASCADE"],
  ])(
    "rejects delete=%s update=%s on a protected relationship",
    (onDelete, onUpdate) => {
      const constraint = PROTECTED_FINISHER_RELATIONSHIPS[0];
      const report = inspectFinisherSchemaDiff(`
        ALTER TABLE "FinisherExecutionStep"
        ADD CONSTRAINT "${constraint}"
        FOREIGN KEY ("executionId", "routineVersionId")
        REFERENCES "FinisherExecution"("id", "routineVersionId")
        ON DELETE ${onDelete} ON UPDATE ${onUpdate};
      `);
      expect(report.issues).toEqual([
        `weak-foreign-key-action:FinisherExecutionStep.${constraint}:delete=${onDelete}:update=${onUpdate}`,
      ]);
    },
  );

  it.each(INTENTIONAL_DATABASE_ONLY_FINISHER_RELATIONSHIPS)(
    "classifies Prisma-inexpressible duplicate binding %s explicitly",
    (constraint) => {
      const report = inspectFinisherSchemaDiff(`
        ALTER TABLE "FinisherExecutionStep" DROP CONSTRAINT "${constraint}";
      `);
      expect(report).toEqual({
        issues: [],
        intentionalDatabaseOnlyExtensions: [constraint],
      });
    },
  );

  it("fails closed on an unrecognized destructive Finisher relationship diff", () => {
    const report = inspectFinisherSchemaDiff(
      'ALTER TABLE "FinisherExecutionStep" DROP COLUMN "routineVersionId";',
    );
    expect(report.issues).toEqual([
      'unrecognized-destructive-finisher-diff:ALTER TABLE "FinisherExecutionStep" DROP COLUMN "routineVersionId"',
    ]);
  });

  it("ignores unrelated schema changes", () => {
    expect(
      inspectFinisherSchemaDiff(
        'ALTER TABLE "Workout" ADD COLUMN "example" TEXT;',
      ),
    ).toEqual({ issues: [], intentionalDatabaseOnlyExtensions: [] });
  });
});
