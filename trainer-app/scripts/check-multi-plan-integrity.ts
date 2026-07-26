import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import {
  buildMultiPlanIntegrityReport,
  loadMultiPlanIntegrityRows,
  type MultiPlanIntegrityRows,
} from "@/lib/operations/multi-plan-integrity";

async function collectJsonFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return collectJsonFiles(target);
      }
      return entry.isFile() && entry.name.endsWith(".json") ? [target] : [];
    })
  );
  return nested.flat().sort();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function inspectHistoricalArtifacts(
  artifactDirectory: string | null
): Promise<MultiPlanIntegrityRows["historicalArtifacts"]> {
  if (!artifactDirectory) {
    return [];
  }
  const files = await collectJsonFiles(artifactDirectory);
  const inspected: MultiPlanIntegrityRows["historicalArtifacts"] = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    const root = asRecord(parsed);
    const historicalWeek = asRecord(root?.historicalWeek);
    if (!historicalWeek) {
      continue;
    }
    const identity = asRecord(root?.identity);
    const sessions = Array.isArray(historicalWeek.sessions)
      ? historicalWeek.sessions
      : [];
    inspected.push({
      artifactId: path.relative(process.cwd(), file),
      targetMesocycleId:
        typeof identity?.mesocycleId === "string"
          ? identity.mesocycleId
          : typeof historicalWeek.mesocycleId === "string"
            ? historicalWeek.mesocycleId
            : null,
      sessionMesocycleIds: sessions.flatMap((session) => {
        const row = asRecord(session);
        return typeof row?.mesocycleId === "string" ? [row.mesocycleId] : [];
      }),
    });
  }
  return inspected;
}

async function main(): Promise<void> {
  const artifactFlagIndex = process.argv.indexOf("--artifact-dir");
  const artifactDirectory =
    artifactFlagIndex >= 0 && process.argv[artifactFlagIndex + 1]
      ? path.resolve(process.argv[artifactFlagIndex + 1])
      : null;
  const historicalArtifacts = await inspectHistoricalArtifacts(
    artifactDirectory
  );
  const rows = await loadMultiPlanIntegrityRows(prisma, historicalArtifacts);
  const report = buildMultiPlanIntegrityReport(rows);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.safeToMigrate ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
