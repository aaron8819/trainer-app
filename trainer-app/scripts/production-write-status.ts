import { loadProductionWriteStatus } from "@/lib/operations/production-write-status-command";

try {
  const status = loadProductionWriteStatus(process.argv.slice(2));
  console.log(`Trainer production write status: ${status}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
