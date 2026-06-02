import { describe, expect, it } from "vitest";
import {
  isPreSessionReadinessContract,
  type PreSessionReadinessContract,
} from "./pre-session-readiness-contract";

function makeContract(
  scope: PreSessionReadinessContract["scope"]
): PreSessionReadinessContract {
  return {
    contractVersion: 1,
    scope,
    nextSessionIdentity: {
      userId: "user-1",
      activeMesocycleId: "meso-1",
      activeState: "ACTIVE_ACCUMULATION",
      currentWeek: 2,
      currentSession: 2,
      nextSlotId: "lower_a",
      nextIntent: "lower",
      existingWorkoutId: null,
      incompleteWorkoutStatus: null,
      incompleteWorkoutReadiness: "none",
      existingWorkoutAction: "none",
      generationPath: "standard_generation",
      generator: "generateSessionFromIntent",
    },
    startability: {
      status: "startable",
      safeToTrain: true,
      normalStartCoachingAllowed: true,
      action: "run_seed_as_prescribed",
      reasons: ["no blocking audit, state, or generation blockers detected"],
      blockerSummary: "none",
    },
    seedRuntimeProof: {
      status: "valid",
      compositionSource: "persisted_slot_plan_seed",
      receiptMesocycleId: "meso-1",
      seedSource: "handoff_slot_plan_projection",
      seedExecutableShape: "set_aware",
      seedOrderSetCountsRespected: true,
      readOnlyEvidenceOnly: true,
      seedRuntimeChanged: false,
      proofLines: ["seed proof"],
    },
    projectedWeekStatus: {
      status: "no_further_action",
      currentWeek: 2,
      phase: "accumulation",
      belowMev: [],
      overMav: [],
      fatigueRisks: [],
      projectionNotes: [],
      doseGuidanceRows: [],
      noAddOnReason: "No optional add-ons are recommended.",
    },
    doseClosure: {
      heading: "Dose Closure Guidance",
      priority: [],
      optional: [],
      monitor: [],
      suppress: [],
      guardrails: [],
      recommendations: [],
    },
    sessionLocalCoaching: {
      defaultInstruction: "Run seed as prescribed.",
      floorBufferOpportunities: [],
      prescriptionConfidenceWatches: [],
      fatigueCautions: [],
      safeOptionalAddOns: [],
      suppressAvoid: [],
      addOnState: {
        status: "none",
        reason: "No optional add-ons are recommended.",
      },
    },
    calibrationWatches: {
      prescriptionConfidence: [],
      recoveryCaveats: [],
      fatigue: [],
    },
    consistencyChecks: [
      {
        id: "seed_runtime_proof_read_only",
        status: "pass",
        severity: "info",
        message: "Seed/runtime proof remains read-only.",
        evidence: [],
      },
    ],
    boundaries: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      wouldWriteTransaction: false,
      dbMutation: false,
      workoutLogSessionCreated: false,
      seedRuntimeChanged: false,
      plannerMaterializerChanged: false,
      notes: ["read-only contract"],
    },
  };
}

describe("pre-session readiness contract", () => {
  it("accepts an app-owned snapshot contract without audit-only scope flags", () => {
    const contract = makeContract({
      mode: "pre-session-readiness",
      ownerSeam: "api/pre-session-readiness-contract",
      source: {
        producerMode: "persisted_snapshot",
        producer: "pre_session_readiness_snapshot",
        provenance: "app_read_model",
      },
      readOnly: true,
      affectsScoringOrGeneration: false,
    });

    expect(
      isPreSessionReadinessContract(contract, { userId: "user-1" })
    ).toBe(true);
  });

  it("accepts legacy audit owner metadata for compatibility", () => {
    const contract = makeContract({
      mode: "pre-session-readiness",
      ownerSeam: "workout-audit/pre-session-readiness",
      source: {
        producerMode: "audit_readout",
        producer: "workout_audit",
        provenance: "operator_audit",
      },
      readOnly: true,
      auditOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
    });

    expect(
      isPreSessionReadinessContract(contract, { userId: "user-1" })
    ).toBe(true);
  });

  it("rejects contracts for another user", () => {
    const contract = makeContract({
      mode: "pre-session-readiness",
      ownerSeam: "api/pre-session-readiness-contract",
      readOnly: true,
      affectsScoringOrGeneration: false,
    });

    expect(
      isPreSessionReadinessContract(contract, { userId: "other-user" })
    ).toBe(false);
  });
});
