import type {
  PreSessionReadinessEvidence,
  PreSessionReadinessProjectedWeekEvidence,
  PreSessionReadinessWeeklyRetroEvidence,
} from "@/lib/api/pre-session-readiness-evidence";
import type {
  PreSessionReadinessAuditPayload,
  ProjectedWeekVolumeAuditPayload,
  WeeklyRetroAuditPayload,
} from "./types";

export function toPreSessionReadinessEvidence(
  payload: PreSessionReadinessAuditPayload
): PreSessionReadinessEvidence {
  return payload;
}

export function toPreSessionReadinessProjectedWeekEvidence(
  payload: ProjectedWeekVolumeAuditPayload
): PreSessionReadinessProjectedWeekEvidence {
  return payload;
}

export function toPreSessionReadinessWeeklyRetroEvidence(
  payload: WeeklyRetroAuditPayload | undefined
): PreSessionReadinessWeeklyRetroEvidence | undefined {
  return payload;
}
