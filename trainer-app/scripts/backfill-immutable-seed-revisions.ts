import { prisma } from "@/lib/db/prisma";
import {
  mapSeedRevisionWriteError,
  normalizeAcceptedSeedPayload,
  promoteLegacySeedRevisionToExactInTransaction,
} from "@/lib/api/mesocycle-seed-revision";

const write = process.argv.includes("--write");

async function main() {
  const mesocycles = await prisma.mesocycle.findMany({
    where: { currentSeedRevisionId: { not: null } },
    select: {
      id: true,
      state: true,
      currentSeedRevision: {
        select: {
          id: true,
          revision: true,
          seedPayload: true,
          provenanceStatus: true,
        },
      },
    },
    orderBy: [{ macroCycleId: "asc" }, { mesoNumber: "asc" }],
  });

  const candidates = mesocycles.flatMap((mesocycle) => {
    const revision = mesocycle.currentSeedRevision;
    if (!revision || revision.provenanceStatus === "exact") {
      return [];
    }
    const normalized = normalizeAcceptedSeedPayload(revision.seedPayload);
    return [{
      mesocycleId: mesocycle.id,
      state: mesocycle.state,
      fromRevision: revision.revision,
      hash: normalized.hash,
    }];
  });

  console.log(JSON.stringify({ write, candidateCount: candidates.length, candidates }, null, 2));
  if (!write) {
    return;
  }

  for (const candidate of candidates) {
    try {
      await prisma.$transaction((tx) =>
        promoteLegacySeedRevisionToExactInTransaction(tx, {
          mesocycleId: candidate.mesocycleId,
          actorSource: "backfill_immutable_seed_revisions",
        }),
      );
    } catch (error) {
      mapSeedRevisionWriteError(error);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
