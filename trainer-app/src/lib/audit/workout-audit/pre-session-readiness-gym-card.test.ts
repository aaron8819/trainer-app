import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPreSessionReadinessGymCardDto } from "./pre-session-readiness-gym-card";
import type {
  PreSessionReadinessCoachingRecommendation,
  PreSessionReadinessConsistencyCheck,
  PreSessionReadinessContract,
} from "./types";

function consistencyCheck(
  id: PreSessionReadinessConsistencyCheck["id"],
  status: PreSessionReadinessConsistencyCheck["status"] = "pass"
): PreSessionReadinessConsistencyCheck {
  return {
    id,
    status,
    severity:
      status === "fail" ? "error" : status === "warning" ? "warning" : "info",
    message: `${id}:${status}`,
    evidence: [`evidence:${id}`],
  };
}

function baseContract(
  overrides: Partial<PreSessionReadinessContract> = {}
): PreSessionReadinessContract {
  const contract: PreSessionReadinessContract = {
    contractVersion: 1,
    scope: {
      mode: "pre-session-readiness",
      ownerSeam: "api/pre-session-readiness-contract",
      source: {
        producerMode: "persisted_snapshot",
        producer: "in_memory_read_model",
        provenance: "app_read_model",
      },
      readOnly: true,
      affectsScoringOrGeneration: false,
    },
    nextSessionIdentity: {
      userId: "user-1",
      ownerEmail: "owner@test.local",
      activeMesocycleId: "meso-1",
      requestedMesocycleId: "meso-1",
      mesocycleIdMatchesRequest: true,
      activeState: "ACTIVE_ACCUMULATION",
      currentWeek: 4,
      currentSession: 3,
      nextSlotId: "upper_b",
      nextIntent: "upper",
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
      currentWeek: 4,
      phase: "accumulation",
      belowMev: [],
      overMav: [],
      fatigueRisks: [],
      projectionNotes: [],
      doseGuidanceRows: [],
      noAddOnReason:
        "Projected week status is no_further_action; no optional add-ons are recommended.",
    },
    doseClosure: {
      heading: "Dose Closure Guidance",
      priority: ["render priority"],
      optional: ["render optional"],
      monitor: ["render monitor"],
      suppress: ["render suppress"],
      guardrails: ["render guardrail"],
      recommendations: [],
    },
    sessionLocalCoaching: {
      defaultInstruction: "Default: run seed as prescribed.",
      floorBufferOpportunities: ["render floor buffer"],
      prescriptionConfidenceWatches: ["render confidence"],
      fatigueCautions: ["render fatigue"],
      safeOptionalAddOns: [
        "- none - Projected week status is no_further_action; no optional add-ons are recommended.",
      ],
      suppressAvoid: ["render suppress/avoid"],
      addOnState: {
        status: "none",
        reason:
          "Projected week status is no_further_action; no optional add-ons are recommended.",
      },
    },
    calibrationWatches: {
      prescriptionConfidence: [],
      recoveryCaveats: [],
      fatigue: [],
    },
    consistencyChecks: [
      consistencyCheck("optional_add_on_matches_flagged_muscle"),
      consistencyCheck("optional_add_on_not_suppressed_muscle"),
      consistencyCheck("no_add_on_state_explicit"),
      consistencyCheck("blocked_state_no_normal_start_coaching"),
      consistencyCheck("seed_runtime_proof_read_only"),
    ],
    boundaries: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      dbMutation: false,
      workoutLogSessionCreated: false,
      seedRuntimeChanged: false,
      plannerMaterializerChanged: false,
      notes: ["contract is audit/readout only"],
    },
  };

  return {
    ...contract,
    ...overrides,
  };
}

function recommendation(
  overrides: Partial<PreSessionReadinessCoachingRecommendation> = {}
): PreSessionReadinessCoachingRecommendation {
  return {
    kind: overrides.kind ?? "optional",
    muscle: overrides.muscle ?? "Chest",
    targetMuscle: overrides.targetMuscle ?? overrides.muscle ?? "Chest",
    candidateExerciseName: overrides.candidateExerciseName ?? "Cable Fly",
    line: overrides.line ?? "render recommendation",
    addonLine: overrides.addonLine ?? "render add-on row",
    suppressed: overrides.suppressed ?? false,
    suppressionReasons: overrides.suppressionReasons ?? [],
  };
}

describe("pre-session readiness gym-card adapter", () => {
  it("renders a clean gym card for a safe startable no-add-on contract", () => {
    const dto = buildPreSessionReadinessGymCardDto(baseContract());

    expect(dto).toMatchObject({
      safeToTrain: true,
      action: "start",
      sessionLabel: "Upper 2",
      primaryInstruction:
        "Run the planned workout. Keep effort around the prescribed RPE cap.",
      rpeCap: "prescribed",
      mainPriority: "Run the planned workout; no extra work needed today.",
      optionalAddOns: {
        status: "none",
        reason: "No add-ons recommended.",
        items: [],
      },
      blockers: [],
      warnings: [],
      source: {
        contractVersion: 1,
        kind: "typed_pre_session_readiness_contract",
        ownerSeam: "api/pre-session-readiness-contract",
        readOnly: true,
        auditOnly: false,
        producerMode: "persisted_snapshot",
      },
    });
  });

  it("renders blockers and suppresses normal start coaching when readiness is blocked", () => {
    const contract = baseContract({
      startability: {
        status: "blocked",
        safeToTrain: false,
        normalStartCoachingAllowed: false,
        action: "resolve_blocker_first",
        reasons: ["incomplete workout blocker: stale-plan (planned)"],
        blockerSummary: "incomplete workout blocker: stale-plan (planned)",
      },
      projectedWeekStatus: {
        ...baseContract().projectedWeekStatus,
        status: "blocked",
      },
      doseClosure: {
        ...baseContract().doseClosure,
        recommendations: [recommendation()],
      },
      sessionLocalCoaching: {
        ...baseContract().sessionLocalCoaching,
        addOnState: {
          status: "available",
          reason: "Contract has session-local optional add-on rows.",
        },
      },
    });

    const dto = buildPreSessionReadinessGymCardDto(contract);

    expect(dto.safeToTrain).toBe(false);
    expect(dto.action).toBe("blocked");
    expect(dto.primaryInstruction).toBe(
      "Resolve readiness blocker before training."
    );
    expect(dto.mainPriority).toBe(
      "Resolve blockers before any start or add-on decision."
    );
    expect(dto.rpeCap).toBeNull();
    expect(dto.optionalAddOns).toMatchObject({
      status: "none",
      reason: "Skip add-ons until the blocker is resolved.",
      items: [],
    });
    expect(dto.blockers).toEqual([
      "incomplete workout blocker: stale-plan (planned)",
    ]);
    expect(JSON.stringify(dto)).not.toContain("Run the seeded session");
  });

  it("does not expose contradictory or suppressed add-ons as valid add-ons", () => {
    const contract = baseContract({
      projectedWeekStatus: {
        ...baseContract().projectedWeekStatus,
        status: "top_up_candidate",
      },
      doseClosure: {
        ...baseContract().doseClosure,
        recommendations: [
          recommendation({
            targetMuscle: "Chest",
            candidateExerciseName: "Barbell Curl",
            suppressed: true,
            suppressionReasons: ["candidate_muscle_mismatch"],
          }),
        ],
      },
      sessionLocalCoaching: {
        ...baseContract().sessionLocalCoaching,
        addOnState: {
          status: "available",
          reason: "Contract has session-local optional add-on rows.",
        },
      },
      consistencyChecks: [
        consistencyCheck("optional_add_on_matches_flagged_muscle", "warning"),
        consistencyCheck("optional_add_on_not_suppressed_muscle"),
        consistencyCheck("no_add_on_state_explicit"),
      ],
    });

    const dto = buildPreSessionReadinessGymCardDto(contract);

    expect(dto.optionalAddOns).toMatchObject({
      status: "none",
      reason: "No add-ons recommended.",
      items: [],
    });
    expect(dto.avoid).toEqual([
      "Avoid Barbell Curl for Chest: does not match today's add-on need.",
    ]);
    expect(dto.warnings).toEqual([
      "optional_add_on_matches_flagged_muscle:warning",
      "Avoid Barbell Curl for Chest: does not match today's add-on need.",
    ]);
  });

  it("translates calibration watches into display-safe coaching notes", () => {
    const dto = buildPreSessionReadinessGymCardDto(
      baseContract({
        calibrationWatches: {
          prescriptionConfidence: [
            "- Incline Press: progression trace unavailable; verify load by feel and keep prescribed RPE cap",
            "- Bench Press: action=hold confidence=0.8 reasons=stable_history",
          ],
          recoveryCaveats: ["Chest:local_soreness"],
          fatigue: [
            "- Cable Row: equipment scaled during early exposure",
          ],
        },
      })
    );

    expect(dto.action).toBe("watch");
    expect(dto.calibrationNotes).toEqual([
      {
        kind: "prescription_confidence",
        message: "Incline Press: Use the target as a starting point; adjust by feel.",
      },
      {
        kind: "prescription_confidence",
        message:
          "Bench Press: Hold the target load unless the first set feels clearly too easy or too hard.",
      },
      {
        kind: "recovery_caveat",
        message: "Chest:local_soreness",
      },
      {
        kind: "fatigue",
        message: "Cable Row: Machine/cable target may need calibration.",
      },
    ]);
    expect(JSON.stringify(dto)).not.toContain("progression trace unavailable");
    expect(JSON.stringify(dto)).not.toContain("action=");
    expect(JSON.stringify(dto)).not.toContain("confidence=");
    expect(JSON.stringify(dto)).not.toContain("reasons=");
  });

  it("does not let poisoned CLI/render strings affect adapter output", () => {
    const contract = baseContract({
      projectedWeekStatus: {
        ...baseContract().projectedWeekStatus,
        status: "top_up_candidate",
      },
      doseClosure: {
        heading: "poison heading",
        priority: ["poison priority"],
        optional: ["poison optional"],
        monitor: ["poison monitor"],
        suppress: ["poison suppress"],
        guardrails: ["poison guardrail"],
        recommendations: [
          recommendation({
            muscle: "Side Delts",
            targetMuscle: "Side Delts",
            candidateExerciseName: "Cable Lateral Raise",
            line: "poison recommendation",
            addonLine: "poison add-on",
          }),
        ],
      },
      sessionLocalCoaching: {
        defaultInstruction: "poison default instruction",
        floorBufferOpportunities: ["poison floor buffer"],
        prescriptionConfidenceWatches: ["poison confidence"],
        fatigueCautions: ["poison fatigue"],
        safeOptionalAddOns: ["poison safe add-on"],
        suppressAvoid: ["poison suppress avoid"],
        addOnState: {
          status: "available",
          reason: "typed add-on state",
        },
      },
    });

    const dto = buildPreSessionReadinessGymCardDto(contract);

    expect(dto.optionalAddOns.items).toEqual([
      {
        kind: "optional",
        muscle: "Side Delts",
        targetMuscle: "Side Delts",
        candidateExerciseName: "Cable Lateral Raise",
        source: "dose_closure_recommendation",
      },
    ]);
    expect(JSON.stringify(dto)).not.toContain("poison");
  });

  it("uses typed helper API and avoids CLI/render string fields", () => {
    const source = readFileSync(
      "src/lib/api/pre-session-readiness-gym-card.ts",
      "utf8"
    );

    expect(source).toContain("getReadinessStartAction");
    expect(source).toContain("getReadinessGymCard");
    expect(source).toContain("getValidOptionalAddOns");
    expect(source).toContain("getSuppressedMusclesOrTargets");
    expect(source).toContain("getCalibrationWatchRows");
    expect(source).toContain("assertReadinessContractConsistency");
    expect(source).toContain("hasBlockingReadinessIssue");
    expect(source).not.toMatch(
      /doseClosure\.(heading|priority|optional|monitor|suppress|guardrails)/
    );
    expect(source).not.toMatch(
      /sessionLocalCoaching\.(defaultInstruction|safeOptionalAddOns|suppressAvoid|floorBufferOpportunities|prescriptionConfidenceWatches|fatigueCautions)/
    );
  });
});
