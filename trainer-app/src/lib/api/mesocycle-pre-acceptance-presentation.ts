import { buildNextMesocycleAcceptanceGateAuditPayload } from "@/lib/audit/workout-audit/next-mesocycle-acceptance-gate";
import type {
  NextMesocycleAcceptanceGateDecision,
  NextMesocycleAcceptanceGateRemediation,
} from "@/lib/audit/workout-audit/types";

export type MesocyclePreAcceptancePresentation = {
  decision: NextMesocycleAcceptanceGateDecision;
  candidateFound: boolean;
  why: string[];
  recommendation: string;
  findings: NextMesocycleAcceptanceGateRemediation[];
  watchItems: Array<{
    risk: string;
    whyItMatters: string;
    monitoringPlan: string;
  }>;
  readOnly: true;
  candidateBasis: "persisted_candidate";
};

export async function loadMesocyclePreAcceptancePresentation(input: {
  userId: string;
  ownerEmail: string;
  sourceMesocycleId: string;
}): Promise<MesocyclePreAcceptancePresentation> {
  const gate = await buildNextMesocycleAcceptanceGateAuditPayload({
    userId: input.userId,
    ownerEmail: input.ownerEmail,
    sourceMesocycleId: input.sourceMesocycleId,
    plannerDiagnosticsMode: "standard",
  });

  return {
    decision: gate.gateResult,
    candidateFound: gate.candidateFound,
    why: [...gate.why],
    recommendation: gate.recommendation,
    findings: gate.findings.map((finding) => ({ ...finding })),
    watchItems: gate.watchItems.map((item) => ({ ...item })),
    readOnly: true,
    candidateBasis: "persisted_candidate",
  };
}
