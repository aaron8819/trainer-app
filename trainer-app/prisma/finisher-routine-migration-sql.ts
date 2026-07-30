import {
  FINISHER_ROUTINE_SEEDS,
  stableFinisherCatalogId,
} from "./finisher-routine-seed-data";

export const FINISHER_CATALOG_SQL_START =
  "-- BEGIN GENERATED FINISHER CATALOG";
export const FINISHER_CATALOG_SQL_END = "-- END GENERATED FINISHER CATALOG";

function text(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function textArray(values: string[]): string {
  return `ARRAY[${values.map(text).join(", ")}]::TEXT[]`;
}

export function renderFinisherCatalogMigrationSql(): string {
  const statements: string[] = [FINISHER_CATALOG_SQL_START];

  for (const definition of FINISHER_ROUTINE_SEEDS) {
    const routineId = stableFinisherCatalogId(`routine:${definition.code}`);
    const versionId = stableFinisherCatalogId(
      `version:${definition.code}:${definition.version}`
    );
    statements.push(
      `INSERT INTO "FinisherRoutine" ("id", "code") VALUES (${text(routineId)}, ${text(definition.code)});`,
      [
        `INSERT INTO "FinisherRoutineVersion" (`,
        `  "id", "routineId", "version", "name", "description", "category",`,
        `  "placement", "kind", "protocol", "difficulty", "fatigueCost",`,
        `  "impactLevel", "preparationSeconds", "includesFinalRecovery",`,
        `  "equipmentRequirements", "bodyRegions", "limitationTags"`,
        `) VALUES (`,
        `  ${text(versionId)}, ${text(routineId)}, ${definition.version},`,
        `  ${text(definition.name)}, ${text(definition.description)}, ${text(definition.category)}::"FinisherCategory",`,
        `  'POST_WORKOUT', 'FINISHER', 'TIMED_INTERVALS', ${text(definition.difficulty)}::"FinisherDifficulty",`,
        `  ${text(definition.fatigueCost)}::"FinisherDemand", ${text(definition.impactLevel)}::"FinisherDemand",`,
        `  ${definition.preparationSeconds}, ${definition.includesFinalRecovery},`,
        `  ${textArray(definition.equipmentRequirements)},`,
        `  ${textArray(definition.bodyRegions)},`,
        `  ${textArray(definition.limitationTags)}`,
        `);`,
      ].join("\n")
    );

    definition.steps.forEach((step, orderIndex) => {
      const stepId = stableFinisherCatalogId(
        `step:${definition.code}:${definition.version}:${orderIndex}`
      );
      statements.push(
        [
          `INSERT INTO "FinisherRoutineStep" (`,
          `  "id", "routineVersionId", "orderIndex", "movementName",`,
          `  "workSeconds", "recoverySeconds", "techniqueCues"`,
          `) VALUES (`,
          `  ${text(stepId)}, ${text(versionId)}, ${orderIndex}, ${text(step.movementName)},`,
          `  ${step.workSeconds}, ${step.recoverySeconds}, ${textArray(step.techniqueCues)}`,
          `);`,
        ].join("\n")
      );
      (step.alternatives ?? []).forEach((movementName, alternativeIndex) => {
        statements.push(
          [
            `INSERT INTO "FinisherRoutineStepAlternative" (`,
            `  "id", "routineStepId", "orderIndex", "movementName"`,
            `) VALUES (`,
            `  ${text(stableFinisherCatalogId(`alternative:${definition.code}:${definition.version}:${orderIndex}:${alternativeIndex}`))},`,
            `  ${text(stepId)}, ${alternativeIndex}, ${text(movementName)}`,
            `);`,
          ].join("\n")
        );
      });
    });
    statements.push(
      `UPDATE "FinisherRoutineVersion" SET "sealedAt" = CURRENT_TIMESTAMP WHERE "id" = ${text(versionId)};`
    );
  }

  statements.push(FINISHER_CATALOG_SQL_END);
  return `${statements.join("\n\n")}\n`;
}
