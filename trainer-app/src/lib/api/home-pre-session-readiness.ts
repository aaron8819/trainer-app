import {
  isPreSessionReadinessContract,
  type PreSessionReadinessContract,
} from "./pre-session-readiness-contract";

export type HomePreSessionReadinessContractCandidate = {
  contract: unknown;
  stale?: boolean;
  source?: "typed_read_model" | "audit_artifact" | "in_memory_audit_payload";
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

export async function loadLatestHomePreSessionReadinessContractCandidate(
  userId: string
): Promise<HomePreSessionReadinessContractCandidate | null> {
  void userId;
  return null;
}
