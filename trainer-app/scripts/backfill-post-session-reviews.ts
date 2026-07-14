import { prisma } from "@/lib/db/prisma";
import { produceCurrentPostSessionReviewInterpretation } from "@/lib/api/post-session-review-producer";
import {
  buildPostSessionReviewEvidenceFingerprint,
  createPostSessionReviewSnapshotInTransaction,
  hashPostSessionReviewValue,
} from "@/lib/api/post-session-review-snapshot";

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = readOption(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

const write = process.argv.includes("--write");
const batchSize = readPositiveInt("--batch-size", 100);
const limit = readPositiveInt("--limit", Number.MAX_SAFE_INTEGER);
const initialAfterId = readOption("--after-id");

const summary = {
  write,
  exactExisting: 0,
  legacyDerivedExisting: 0,
  legacyDerivedCandidate: 0,
  legacyUnknownUnproducible: 0,
  invalidCurrentEvidence: 0,
  writeConflicts: 0,
  written: 0,
  scanned: 0,
  lastScannedId: initialAfterId ?? null,
  hashDistribution: {} as Record<string, number>,
  failures: [] as Array<{ workoutId: string; reason: string }>,
};

function countHash(hash: string) {
  summary.hashDistribution[hash] = (summary.hashDistribution[hash] ?? 0) + 1;
}

async function main() {
  let afterId = initialAfterId;
  while (summary.scanned < limit) {
    const take = Math.min(batchSize, limit - summary.scanned);
    const workouts = await prisma.workout.findMany({
      where: {
        status: "COMPLETED",
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: "asc" },
      take,
      select: {
        id: true,
        userId: true,
        completedAt: true,
        postSessionReviewSnapshot: {
          select: { provenance: true, payloadHash: true },
        },
      },
    });
    if (workouts.length === 0) break;

    for (const workout of workouts) {
      summary.scanned += 1;
      afterId = workout.id;
      summary.lastScannedId = workout.id;
      const existing = workout.postSessionReviewSnapshot;
      if (existing) {
        if (existing.provenance === "exact") summary.exactExisting += 1;
        else summary.legacyDerivedExisting += 1;
        countHash(existing.payloadHash);
        continue;
      }

      try {
        const current = await produceCurrentPostSessionReviewInterpretation(
          workout.userId,
          workout.id
        );
        if (current.status !== "ready") {
          if (current.reason === "invalid_contract") summary.invalidCurrentEvidence += 1;
          else summary.legacyUnknownUnproducible += 1;
          summary.failures.push({ workoutId: workout.id, reason: current.reason });
          continue;
        }
        const evidenceFingerprint = await buildPostSessionReviewEvidenceFingerprint(prisma, {
          userId: workout.userId,
          workoutId: workout.id,
        });
        if (!evidenceFingerprint) {
          summary.invalidCurrentEvidence += 1;
          summary.failures.push({
            workoutId: workout.id,
            reason: "evidence_fingerprint_unavailable",
          });
          continue;
        }
        const payloadHash = hashPostSessionReviewValue(current.contract);
        countHash(payloadHash);
        summary.legacyDerivedCandidate += 1;

        if (write) {
          await prisma.$transaction((tx) =>
            createPostSessionReviewSnapshotInTransaction(tx, {
              userId: workout.userId,
              workoutId: workout.id,
              provenance: "legacy_derived",
              finalizedAt: workout.completedAt ?? undefined,
            })
          );
          summary.written += 1;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (
          reason === "POST_SESSION_REVIEW_SNAPSHOT_CONFLICT" ||
          reason.includes("Unique constraint")
        ) {
          summary.writeConflicts += 1;
        } else {
          summary.invalidCurrentEvidence += 1;
        }
        summary.failures.push({ workoutId: workout.id, reason });
      }
    }

    if (workouts.length < take) break;
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
