import {
  formatProductionVersionVerification,
  parseProductionVersionVerificationArgs,
  productionVersionVerificationExitCode,
  verifyProductionVersion,
} from "@/lib/operations/production-version-verification";

async function main(): Promise<void> {
  try {
    const options = parseProductionVersionVerificationArgs(process.argv.slice(2));
    const result = await verifyProductionVersion(options);
    for (const line of formatProductionVersionVerification(result)) {
      console.log(line);
    }
    process.exitCode = productionVersionVerificationExitCode(result);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

void main();
