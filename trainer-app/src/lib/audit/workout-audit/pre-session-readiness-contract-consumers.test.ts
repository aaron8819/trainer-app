import { describe, expect, it } from "vitest";
import { buildPreSessionReadinessContract } from "./pre-session-readiness-contract";
import {
  assertReadinessContractConsistency,
  getCalibrationWatchRows,
  getReadinessGymCard,
  getReadinessStartAction,
  getSuppressedMusclesOrTargets,
  getValidOptionalAddOns,
  hasBlockingReadinessIssue,
  type ReadinessOptionalAddOn,
} from "./pre-session-readiness-contract-consumers";
import type {
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
      priority: ["CLI priority text"],
      optional: ["CLI optional text"],
      monitor: ["CLI monitor text"],
      suppress: ["CLI suppress text"],
      guardrails: ["CLI guardrail text"],
      recommendations: [],
    },
    sessionLocalCoaching: {
      defaultInstruction: "Default: run seed as prescribed.",
      floorBufferOpportunities: ["CLI floor buffer text"],
      prescriptionConfidenceWatches: ["CLI confidence text"],
      fatigueCautions: ["CLI fatigue text"],
      safeOptionalAddOns: [
        "- none - Projected week status is no_further_action; no optional add-ons are recommended.",
      ],
      suppressAvoid: ["CLI suppress/avoid text"],
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

function activeAddOn(
  overrides: Partial<ReadinessOptionalAddOn> & {
    line?: string;
    addonLine?: string;
    suppressed?: boolean;
    suppressionReasons?: string[];
  } = {}
): PreSessionReadinessContract["doseClosure"]["recommendations"][number] {
  return {
    kind: overrides.kind ?? "optional",
    muscle: overrides.muscle ?? "Chest",
    targetMuscle: overrides.targetMuscle ?? overrides.muscle ?? "Chest",
    candidateExerciseName: overrides.candidateExerciseName ?? "Cable Fly",
    line: overrides.line ?? "CLI add-on detail",
    addonLine: overrides.addonLine ?? "CLI add-on row",
    suppressed: overrides.suppressed ?? false,
    suppressionReasons: overrides.suppressionReasons ?? [],
  };
}

describe("pre-session readiness contract consumers", () => {
  it("returns no-add-on state explicitly from typed fields", () => {
    const contract = baseContract();

    expect(getValidOptionalAddOns(contract)).toEqual([]);
    expect(getReadinessGymCard(contract)).toMatchObject({
      ready: true,
      primaryAction: "start_seed",
      normalStartAction: "run_seed_as_prescribed",
      optionalAddOnStatus: "none",
      validOptionalAddOnCount: 0,
    });
  });

  it("does not expose mismatched or suppressed add-ons as valid opportunities", () => {
    const contract = baseContract({
      projectedWeekStatus: {
        ...baseContract().projectedWeekStatus,
        status: "top_up_candidate",
      },
      doseClosure: {
        ...baseContract().doseClosure,
        recommendations: [
          activeAddOn({
            muscle: "Chest",
            targetMuscle: "Chest",
            candidateExerciseName: "Barbell Curl",
            suppressed: true,
            suppressionReasons: ["candidate_muscle_mismatch"],
          }),
          activeAddOn({
            muscle: "Chest",
            targetMuscle: "Chest",
            candidateExerciseName: "Cable Crossover",
            suppressed: true,
            suppressionReasons: ["target_muscle_suppressed"],
          }),
          activeAddOn({
            muscle: "Side Delts",
            targetMuscle: "Side Delts",
            candidateExerciseName: "Cable Lateral Raise",
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
        consistencyCheck("optional_add_on_not_suppressed_muscle", "warning"),
      ],
    });

    expect(getValidOptionalAddOns(contract)).toEqual([
      {
        kind: "optional",
        muscle: "Side Delts",
        targetMuscle: "Side Delts",
        candidateExerciseName: "Cable Lateral Raise",
        source: "dose_closure_recommendation",
      },
    ]);
    expect(getSuppressedMusclesOrTargets(contract)).toEqual([
      {
        targetMuscle: "Chest",
        candidateExerciseName: "Barbell Curl",
        reasons: ["candidate_muscle_mismatch"],
        source: "suppressed_recommendation",
      },
      {
        targetMuscle: "Chest",
        candidateExerciseName: "Cable Crossover",
        reasons: ["target_muscle_suppressed"],
        source: "suppressed_recommendation",
      },
    ]);
  });

  it("returns blocker action and no normal gym-card start action when readiness is blocked", () => {
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
      sessionLocalCoaching: {
        ...baseContract().sessionLocalCoaching,
        addOnState: {
          status: "blocked",
          reason: "Readiness is blocked; resolve blocker before considering add-ons.",
        },
      },
    });

    expect(getReadinessStartAction(contract)).toMatchObject({
      safeToTrain: false,
      canStartNormalSession: false,
      action: "resolve_blocker_first",
      blockerSummary: "incomplete workout blocker: stale-plan (planned)",
    });
    expect(getReadinessGymCard(contract)).toMatchObject({
      ready: false,
      primaryAction: "resolve_blocker",
      normalStartAction: null,
      optionalAddOnStatus: "blocked",
    });
    expect(hasBlockingReadinessIssue(contract)).toBe(true);
    expect(getValidOptionalAddOns(contract)).toEqual([]);
  });

  it("exposes calibration watches from contract rows", () => {
    const contract = baseContract({
      calibrationWatches: {
        prescriptionConfidence: ["Incline Press: confidence=0.6"],
        recoveryCaveats: ["Chest:local_soreness"],
        fatigue: ["- Glutes: meaningful fatigue watch"],
      },
    });

    expect(getCalibrationWatchRows(contract)).toEqual([
      {
        kind: "prescription_confidence",
        message: "Incline Press: confidence=0.6",
      },
      {
        kind: "recovery_caveat",
        message: "Chest:local_soreness",
      },
      {
        kind: "fatigue",
        message: "- Glutes: meaningful fatigue watch",
      },
    ]);
  });

  it("surfaces consistency warnings without mutating or recalculating readiness", () => {
    const contract = baseContract({
      consistencyChecks: [
        consistencyCheck("optional_add_on_matches_flagged_muscle", "warning"),
        consistencyCheck("seed_runtime_proof_read_only"),
      ],
    });
    const before = JSON.stringify(contract);

    expect(assertReadinessContractConsistency(contract)).toMatchObject({
      status: "warning",
      warnings: [
        expect.objectContaining({
          id: "optional_add_on_matches_flagged_muscle",
          status: "warning",
        }),
      ],
      failures: [],
    });
    expect(JSON.stringify(contract)).toBe(before);
    expect(hasBlockingReadinessIssue(contract)).toBe(false);
  });

  it("does not depend on CLI-rendered strings for add-on accessors", () => {
    const contract = baseContract({
      projectedWeekStatus: {
        ...baseContract().projectedWeekStatus,
        status: "top_up_candidate",
      },
      doseClosure: {
        heading: "CLI heading poison",
        priority: ["CLI priority poison"],
        optional: ["CLI optional poison"],
        monitor: ["CLI monitor poison"],
        suppress: ["CLI suppress poison"],
        guardrails: ["CLI guardrail poison"],
        recommendations: [
          activeAddOn({
            muscle: "Side Delts",
            targetMuscle: "Side Delts",
            candidateExerciseName: "Cable Lateral Raise",
            line: "CLI recommendation poison",
            addonLine: "CLI add-on poison",
          }),
        ],
      },
      sessionLocalCoaching: {
        ...baseContract().sessionLocalCoaching,
        safeOptionalAddOns: ["CLI safe-add-on poison"],
        suppressAvoid: ["CLI suppress poison"],
        addOnState: {
          status: "available",
          reason: "Contract has session-local optional add-on rows.",
        },
      },
    });

    expect(getValidOptionalAddOns(contract)).toEqual([
      {
        kind: "optional",
        muscle: "Side Delts",
        targetMuscle: "Side Delts",
        candidateExerciseName: "Cable Lateral Raise",
        source: "dose_closure_recommendation",
      },
    ]);
    expect(JSON.stringify(getReadinessGymCard(contract))).not.toContain("poison");
  });

  it("keeps Iso-Lateral pulldown text out of valid side-delt add-ons", () => {
    const contract = buildPreSessionReadinessContract({
      userId: "user-1",
      ownerEmail: "owner@test.local",
      payload: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByProduction: false,
        wouldWriteTransaction: false,
        activeMesocycle: {
          mesocycleId: "meso-1",
          state: "ACTIVE_ACCUMULATION",
          completedAccumulationSessions: 14,
          deloadSessionsCompleted: 0,
          deloadSessionsExpected: 4,
          deloadSessionPosition: null,
          currentWeek: 4,
          currentSession: 3,
          requestedMesocycleId: "meso-1",
          mesocycleIdMatchesRequest: true,
        },
      },
      nextSession: {
        intent: "upper",
        slotId: "upper_b",
        slotSequenceIndex: 2,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        existingWorkoutId: null,
        isExisting: false,
        source: "rotation",
        weekInMeso: 4,
        sessionInWeek: 3,
        derivationTrace: [],
        selectedIncompleteStatus: null,
      } as never,
      sessionSnapshot: {
        version: 1,
        generated: {
          exercises: [],
          traces: {
            progression: {},
          },
        },
      } as never,
      generationPath: {
        requestedMode: "pre-session-readiness",
        executionMode: "standard_generation",
        generator: "generateSessionFromIntent",
        reason: "standard_future_week_or_preview",
      },
      projectedWeek: {
        version: 1,
        currentWeek: {
          mesocycleId: "meso-1",
          week: 4,
          phase: "accumulation",
          blockType: "accumulation",
        },
        projectionNotes: [],
        completedVolumeByMuscle: {},
        projectedSessions: [
          {
            slotId: "upper_b",
            intent: "upper",
            isNext: true,
            exerciseCount: 2,
            totalSets: 7,
            exercises: [
              {
                exerciseId: "lat-pulldown",
                name: "Iso-Lateral Front Lat Pulldown",
                setCount: 3,
                role: "primary",
                effectiveStimulusByMuscle: { Lats: 3 },
              },
              {
                exerciseId: "cable-lateral-raise",
                name: "Cable Lateral Raise",
                setCount: 4,
                role: "accessory",
                effectiveStimulusByMuscle: { "Side Delts": 4 },
              },
            ],
            projectedContributionByMuscle: { Lats: 3, "Side Delts": 4 },
          },
        ],
        fullWeekByMuscle: [
          {
            muscle: "Side Delts",
            targetKind: "hard",
            displayGroup: "support",
            targetTier: "B_SUPPORT",
            warningSeverity: "soft",
            dashboardGroup: "support_driver",
            completedEffectiveSets: 0,
            projectedNextSessionEffectiveSets: 6,
            projectedRemainingWeekEffectiveSets: 0,
            projectedFullWeekEffectiveSets: 6,
            weeklyTarget: 8,
            mev: 6,
            mav: 16,
            mrv: 22,
            deltaToTarget: -2,
            deltaToMev: 0,
            deltaToMav: -10,
          },
          {
            muscle: "Lats",
            targetKind: "hard",
            displayGroup: "primary",
            targetTier: "A_PRIMARY",
            warningSeverity: "hard",
            dashboardGroup: "primary_driver",
            completedEffectiveSets: 0,
            projectedNextSessionEffectiveSets: 12,
            projectedRemainingWeekEffectiveSets: 0,
            projectedFullWeekEffectiveSets: 12,
            weeklyTarget: 12,
            mev: 8,
            mav: 16,
            mrv: 22,
            deltaToTarget: 0,
            deltaToMev: 4,
            deltaToMav: -4,
          },
        ],
        currentWeekAudit: {
          belowMEV: [],
          overMAV: [],
          underTargetClusters: [],
          belowPreferred: [],
          fatigueRisks: [],
        },
        runtimeDoseAdjustmentDiagnostics: [
          {
            muscle: "Side Delts",
            plannedRemainingVolume: {
              effectiveSets: 6,
              bySlot: [],
            },
            performedWeekToDateVolume: {
              effectiveSets: 0,
              source: "weekly_volume_read_model",
            },
            projectedEndOfWeekVolume: {
              effectiveSets: 6,
              weeklyTarget: 8,
              mev: 6,
              mav: 16,
            },
            targetStatus: "below_preferred",
            fatigueDensityConcern: {
              level: "none",
              drivers: [],
            },
            recoveryReadinessCaveat: {
              status: "none",
            },
            recommendedAction: {
              kind: "hold_seed",
              setDelta: 0,
            },
            reasonCode: "below_preferred_monitor",
            guidance:
              "productive floor achieved; below preferred target; monitor, no default add-on",
            confidence: 0.8,
            readOnly: true,
            affectsAcceptedSeed: false,
          },
        ],
      } as never,
    });

    expect(getValidOptionalAddOns(contract)).toEqual([
      {
        kind: "floor_buffer",
        muscle: "Side Delts",
        targetMuscle: "Side Delts",
        candidateExerciseName: "Cable Lateral Raise",
        source: "dose_closure_recommendation",
      },
    ]);
    expect(JSON.stringify(getValidOptionalAddOns(contract))).not.toContain(
      "Iso-Lateral"
    );
  });
});
