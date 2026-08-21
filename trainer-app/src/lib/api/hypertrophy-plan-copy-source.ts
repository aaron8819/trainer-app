import { MesocycleState } from "@prisma/client";
import {
  exactSeedRevisionProvenance,
  normalizeAcceptedSeedPayload,
} from "./mesocycle-seed-revision";
import { parseAcceptedSeedPayload } from "./slot-plan-seed-parser";

type EditableCopyRevision = {
  id: string;
  mesocycleId: string;
  revision: number;
  seedPayload: unknown;
  payloadHash: string | null;
  hashAlgorithm: string | null;
  provenanceStatus: string;
};

export type EditableHypertrophyPlanCopySourceRow = {
  id: string;
  mesoNumber: number;
  state: MesocycleState;
  isActive: boolean;
  currentSeedRevisionId: string | null;
  currentSeedRevision: EditableCopyRevision | null;
};

type AcceptedSeed = NonNullable<
  ReturnType<typeof parseAcceptedSeedPayload>["acceptedSeed"]
>;

export type EditableHypertrophyPlanCopySource<
  T extends EditableHypertrophyPlanCopySourceRow,
> = {
  mesocycle: T;
  canonicalPayload: unknown;
  acceptedSeed: AcceptedSeed;
};

export function resolveEditableHypertrophyPlanCopySource<
  T extends EditableHypertrophyPlanCopySourceRow,
>(mesocycles: readonly T[]): EditableHypertrophyPlanCopySource<T> | null {
  const ordered = [...mesocycles].sort(
    (left, right) =>
      right.mesoNumber - left.mesoNumber || left.id.localeCompare(right.id),
  );
  const hasCanonicalNumbering = ordered.every(
    (mesocycle, index) =>
      Number.isInteger(mesocycle.mesoNumber) &&
      mesocycle.mesoNumber === ordered.length - index,
  );
  const highestMesoNumber = ordered[0]?.mesoNumber ?? null;
  const highestMesocycles = ordered.filter(
    (mesocycle) => mesocycle.mesoNumber === highestMesoNumber,
  );
  const activeMesocycles = ordered.filter(
    (mesocycle) =>
      mesocycle.isActive &&
      mesocycle.state !== MesocycleState.COMPLETED &&
      mesocycle.state !== MesocycleState.AWAITING_HANDOFF,
  );
  const highestMesocycle =
    hasCanonicalNumbering && highestMesocycles.length === 1
      ? highestMesocycles[0]
      : null;
  const highestIsEligibleActive =
    highestMesocycle != null &&
    highestMesocycle.isActive &&
    (highestMesocycle.state === MesocycleState.ACTIVE_ACCUMULATION ||
      highestMesocycle.state === MesocycleState.ACTIVE_DELOAD) &&
    activeMesocycles.length === 1 &&
    activeMesocycles[0].id === highestMesocycle.id;
  const highestIsEligibleCompleted =
    highestMesocycle != null &&
    !highestMesocycle.isActive &&
    highestMesocycle.state === MesocycleState.COMPLETED &&
    activeMesocycles.length === 0;
  const sourceMesocycle =
    highestIsEligibleActive || highestIsEligibleCompleted
      ? highestMesocycle
      : null;
  const revision = sourceMesocycle?.currentSeedRevision;
  if (
    !sourceMesocycle ||
    !revision ||
    sourceMesocycle.currentSeedRevisionId !== revision.id ||
    revision.mesocycleId !== sourceMesocycle.id ||
    !Number.isInteger(revision.revision) ||
    revision.revision < 1 ||
    !exactSeedRevisionProvenance(revision)
  ) {
    return null;
  }

  try {
    const normalized = normalizeAcceptedSeedPayload(revision.seedPayload);
    if (normalized.hash !== revision.payloadHash) return null;
    const acceptedSeed = parseAcceptedSeedPayload(
      normalized.canonicalPayload,
    ).acceptedSeed;
    return acceptedSeed
      ? {
          mesocycle: sourceMesocycle,
          canonicalPayload: normalized.canonicalPayload,
          acceptedSeed,
        }
      : null;
  } catch {
    return null;
  }
}
