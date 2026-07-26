import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  buildMultiPlanIntegrityReport,
  loadMultiPlanIntegrityRows,
  type MultiPlanIntegrityRows,
} from "@/lib/operations/multi-plan-integrity";
import {
  classifyRolloutTarget,
  runWithRolloutEnvironment,
} from "@/lib/operations/rollout-environment";

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
  const argv = process.argv.slice(2);
  await runWithRolloutEnvironment(
    {
      argv,
      allowWrite: false,
      requiredVariables: ["DATABASE_URL", "DIRECT_URL"],
    },
    async (environment) => {
      const directUrl = process.env.DIRECT_URL;
      if (!directUrl) {
        throw new Error(
          "The explicitly named environment file must define DIRECT_URL.",
        );
      }
      const targetClass = classifyRolloutTarget(
        directUrl,
        argv.includes("--confirm-disposable"),
      );
      if (targetClass !== environment.targetClass) {
        throw new Error(
          "DATABASE_URL and DIRECT_URL resolve to different sanitized target classes.",
        );
      }
      if (targetClass === "local") {
        throw new Error(
          "Multi-plan integrity requires a remote target; disposable targets require --confirm-disposable.",
        );
      }
      process.env.DATABASE_URL = directUrl;
      const { prisma } = await import("@/lib/db/prisma");
      try {
        const artifactFlagIndex = argv.indexOf("--artifact-dir");
        const artifactDirectory =
          artifactFlagIndex >= 0 && argv[artifactFlagIndex + 1]
            ? path.resolve(argv[artifactFlagIndex + 1])
            : null;
        const historicalArtifacts = await inspectHistoricalArtifacts(
          artifactDirectory,
        );
        const rows = await loadMultiPlanIntegrityRows(
          prisma,
          historicalArtifacts,
        );
        const report = buildMultiPlanIntegrityReport(rows);
        const fingerprint = createHash("sha256")
          .update(new URL(directUrl).hostname.toLowerCase())
          .digest("hex")
          .slice(0, 12);
        process.stdout.write(
          `${JSON.stringify(
            {
              target: { classification: targetClass, fingerprint },
              verifiedAt: new Date().toISOString(),
              ...report,
            },
            null,
            2,
          )}\n`,
        );
        process.exitCode = report.safeToMigrate ? 0 : 1;
      } finally {
        await prisma.$disconnect();
      }
    },
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
