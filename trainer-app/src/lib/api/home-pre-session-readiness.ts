import {
  isPreSessionReadinessContract,
  type PreSessionReadinessContract,
} from "./pre-session-readiness-contract";
import {
  loadCurrentPreSessionReadinessSnapshot,
} from "./pre-session-readiness-snapshot";

export type HomePreSessionReadinessContractCandidate = {
  contract: unknown;
  stale?: boolean;
  source?:
    | "typed_read_model"
    | "persisted_snapshot"
    | "audit_artifact"
    | "in_memory_audit_payload";
};

export function resolveHomePreSessionReadinessContract(input: {
  userId: string;
  candidate: HomePreSessionReadinessContractCandidate | null | undefined;
}): PreSessionReadinessContract | null {
  if (!input.candidate || input.candidate.stale === true) {
    return null;
  }

  return isPreSessionReadinessContract(input.candidate.contract, {
    userId: input.userId,
  })
    ? input.candidate.contract
    : null;
}

export async function loadCurrentHomePreSessionReadinessContractCandidate(
  userId: string
): Promise<HomePreSessionReadinessContractCandidate | null> {
  const result = await loadCurrentPreSessionReadinessSnapshot(userId);

  return result.status === "available"
    ? { contract: result.contract, source: "persisted_snapshot" }
    : null;
}
