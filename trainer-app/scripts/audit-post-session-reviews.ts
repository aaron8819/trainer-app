import {
  runWithRolloutEnvironment,
  sanitizedRolloutEnvironment,
} from "@/lib/operations/rollout-environment";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  await runWithRolloutEnvironment({ argv, allowWrite: false }, async (environment) => {
    console.log(JSON.stringify({ environment: sanitizedRolloutEnvironment(environment) }));
    const [{ prisma }, { auditPostSessionReviewSnapshots }] = await Promise.all([
      import("@/lib/db/prisma"),
      import("@/lib/api/post-session-review-audit"),
    ]);
    const ownerIndex = argv.indexOf("--user-id");
    const userId = ownerIndex >= 0 ? argv[ownerIndex + 1] : undefined;
    const includeCurrentReinterpretation = argv.includes("--include-current-reinterpretation");
    try {
      const report = await auditPostSessionReviewSnapshots({
        userId,
        includeCurrentReinterpretation,
      });
      console.log(JSON.stringify(report, null, 2));
    } finally {
      await prisma.$disconnect();
    }
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
