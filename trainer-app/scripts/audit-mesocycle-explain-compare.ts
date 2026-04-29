import { pathToFileURL } from "node:url";
import {
  compareMesocycleExplainArtifacts,
  formatMesocycleExplainCompareTable,
  stringifyMesocycleExplainCompareJson,
} from "@/lib/audit/workout-audit/mesocycle-explain-compare";

type CompareCliArgs = {
  before?: string;
  after?: string;
  json?: boolean;
  includeSidecar?: boolean;
};

function parseArgs(argv: string[]): CompareCliArgs {
  const args: CompareCliArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--no-include-sidecar") {
      args.includeSidecar = false;
      continue;
    }
    if (token === "--include-sidecar") {
      const next = argv[index + 1];
      if (next === "false" || next === "0" || next === "no") {
        args.includeSidecar = false;
        index += 1;
      } else {
        args.includeSidecar = true;
      }
      continue;
    }
    if (token === "--before") {
      args.before = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--after") {
      args.after = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function usage(): string {
  return [
    "Usage: tsx scripts/audit-mesocycle-explain-compare.ts --before <artifact.json> --after <artifact.json> [--json] [--include-sidecar false]",
    "",
    "Compares existing mesocycle-explain artifacts only. Does not run live audits or import DB/Prisma.",
  ].join("\n");
}

export async function runMesocycleExplainCompareCli(input?: {
  argv?: string[];
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}): Promise<number> {
  const stdout = input?.stdout ?? console.log;
  const stderr = input?.stderr ?? console.error;
  const args = parseArgs(input?.argv ?? process.argv.slice(2));

  if (!args.before || !args.after) {
    stderr(usage());
    return 1;
  }

  try {
    const summary = await compareMesocycleExplainArtifacts({
      beforePath: args.before,
      afterPath: args.after,
      includeSidecar: args.includeSidecar ?? true,
    });
    for (const warning of summary.warnings) {
      stderr(`[mesocycle-explain-compare] warning: ${warning}`);
    }
    stdout(
      args.json
        ? stringifyMesocycleExplainCompareJson(summary)
        : formatMesocycleExplainCompareTable(summary)
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`[mesocycle-explain-compare] ${message}`);
    return 1;
  }
}

const isMainModule =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;

if (isMainModule) {
  runMesocycleExplainCompareCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
