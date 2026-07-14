import { prisma } from "@/lib/db/prisma";
import { auditPostSessionReviewSnapshots } from "@/lib/api/post-session-review-audit";

const ownerIndex = process.argv.indexOf("--user-id");
const userId = ownerIndex >= 0 ? process.argv[ownerIndex + 1] : undefined;
const includeCurrentReinterpretation = process.argv.includes(
  "--include-current-reinterpretation"
);

auditPostSessionReviewSnapshots({ userId, includeCurrentReinterpretation })
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
