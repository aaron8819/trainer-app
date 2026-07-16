import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { productionWriteStatus, type ProductionWriteStatus } from "./production-write-gate";

function readArgument(argv: string[], name: string): string | undefined {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1) || undefined;
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

export function loadProductionWriteStatus(
  argv: string[],
  cwd = process.cwd(),
): ProductionWriteStatus {
  const envFileArgument = readArgument(argv, "--env-file");
  if (!envFileArgument) {
    throw new Error("Missing required --env-file <path>. No environment file is loaded implicitly.");
  }

  const envFile = resolve(cwd, envFileArgument);
  let parsed: Record<string, string>;
  try {
    parsed = dotenv.parse(readFileSync(envFile));
  } catch {
    throw new Error("Unable to load the explicitly named environment file.");
  }
  return productionWriteStatus(parsed);
}
