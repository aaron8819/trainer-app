import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPreSessionReadinessGymCardDto } from "./pre-session-readiness-gym-card";
import type {
  PreSessionReadinessCoachingRecommendation,
  PreSessionReadinessConsistencyCheck,
  PreSessionReadinessContract,
} from "./pre-session-readiness-contract";

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

function recommendation(
  overrides: Partial<PreSessionReadinessCoachingRecommendation> = {}
): PreSessionReadinessCoachingRecommendation {
  return {
    kind: overrides.kind ?? "floor_buffer",
    muscle: overrides.muscle ?? "Side Delts",
    targetMuscle: overrides.targetMuscle ?? overrides.muscle ?? "Side Delts",
    candidateExerciseName:
      overrides.candidateExerciseName ?? "Cable Lateral Raise",
    line: overrides.line ?? "render recommendation",
    addonLine: overrides.addonLine ?? "render add-on row",
    suppressed: overrides.suppressed ?? false,
    suppressionReasons: overrides.suppressionReasons ?? [],
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
      status: "top_up_candidate",
      currentWeek: 4,
      phase: "accumulation",
      belowMev: ["Side Delts"],
      overMav: [],
      fatigueRisks: [],
      projectionNotes: [],
      doseGuidanceRows: [],
      noAddOnReason: undefined,
    },
    doseClosure: {
      heading: "Dose Closure Guidance",
      priority: ["render priority"],
      optional: ["render optional"],
      monitor: ["render monitor"],
      suppress: ["render suppress"],
      guardrails: ["render guardrail"],
      recommendations: [recommendation()],
    },
    sessionLocalCoaching: {
      defaultInstruction: "Default: run seed as prescribed.",
      floorBufferOpportunities: ["render floor buffer"],
      prescriptionConfidenceWatches: ["render confidence"],
      fatigueCautions: ["render fatigue"],
      safeOptionalAddOns: ["render safe add-on"],
      suppressAvoid: ["render suppress/avoid"],
      addOnState: {
        status: "available",
        reason: "Contract has session-local optional add-on rows.",
      },
    },
    calibrationWatches: {
      prescriptionConfidence: [],
      recoveryCaveats: [],
      fatigue: [],
    },
    workoutPreview: {
      source: "generated_session_audit_snapshot",
      targetRpeLabel: "RPE 8",
      exercises: [
        {
          exerciseId: "bench",
          exerciseName: "Bench Press",
          setCount: 3,
          repTargetLabel: "6-10 reps",
          targetLoadLabel: "185 lb",
          targetRpeLabel: "RPE 8",
        },
        {
          exerciseId: "lateral-raise",
          exerciseName: "Cable Lateral Raise",
          setCount: 2,
          repTargetLabel: "12-20 reps",
          targetLoadLabel: null,
          targetRpeLabel: "RPE 8",
        },
      ],
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

describe("pre-session readiness gym-card adapter", () => {
  it("exposes display-safe workout preview rows and one target RPE summary", () => {
    const dto = buildPreSessionReadinessGymCardDto(baseContract());

    expect(dto.workoutPreview).toEqual({
      source: "generated_session_audit_snapshot",
      targetRpeLabel: "RPE 8",
      exercises: [
        {
          exerciseId: "bench",
          exerciseName: "Bench Press",
          setCount: 3,
          repTargetLabel: "6-10 reps",
          targetLoadLabel: "185 lb",
          targetRpeLabel: "RPE 8",
        },
        {
          exerciseId: "lateral-raise",
          exerciseName: "Cable Lateral Raise",
          setCount: 2,
          repTargetLabel: "12-20 reps",
          targetLoadLabel: null,
          targetRpeLabel: "RPE 8",
        },
      ],
    });
  });

  it("adds structured optional add-on reason and guardrail without raw render strings", () => {
    const dto = buildPreSessionReadinessGymCardDto(baseContract());

    expect(dto.optionalAddOns.items).toEqual([
      {
        kind: "floor_buffer",
        muscle: "Side Delts",
        targetMuscle: "Side Delts",
        candidateExerciseName: "Cable Lateral Raise",
        source: "dose_closure_recommendation",
        reason: "Side Delts is the useful floor-buffer today.",
        guardrail:
          "Add only if planned Cable Lateral Raise work feels clean.",
      },
    ]);
    expect(JSON.stringify(dto)).not.toContain("render add-on row");
    expect(JSON.stringify(dto)).not.toContain("render recommendation");
  });

  it("falls back to an unavailable workout preview for legacy snapshots", () => {
    const legacyContract = {
      ...baseContract(),
      workoutPreview: undefined,
    };

    const dto = buildPreSessionReadinessGymCardDto(legacyContract);

    expect(dto.workoutPreview).toEqual({
      source: "unavailable",
      exercises: [],
      targetRpeLabel: null,
    });
  });

  it("keeps Load Calibration exercise-level and moves fatigue or volume guidance elsewhere", () => {
    const base = baseContract();
    const dto = buildPreSessionReadinessGymCardDto(
      baseContract({
        projectedWeekStatus: {
          ...base.projectedWeekStatus,
          overMav: ["Chest", "Lats", "Upper Back", "Quads"],
        },
        calibrationWatches: {
          prescriptionConfidence: [
            {
              exerciseLabel: "Close-Grip Seated Cable Row",
              watchType: "prescription_confidence",
              reasonCode: "load_calibration",
              displayActionCode:
                "machine_or_cable_target_may_need_calibration",
              severity: "warning",
              confidence: 0.72,
              targetLoad: 80,
              adjustmentRangeBasis: "exact_range",
              suggestedAdjustmentRange: {
                minLoad: 70,
                maxLoad: 80,
                unit: "lb",
                basis: "target_effort_load_mismatch",
              },
              source: "generated_progression_trace",
            },
            {
              exerciseLabel: "Cable Triceps Pushdown",
              watchType: "prescription_confidence",
              reasonCode: "estimate_or_low_signal",
              displayActionCode: "hold_target_load",
              severity: "info",
              confidence: 0.82,
              targetLoad: 45,
              adjustmentRangeBasis: "target_load_start",
              source: "generated_progression_trace",
            },
            "- Incline Press: action=hold confidence=0.8 reasons=stable_history",
          ],
          recoveryCaveats: ["Chest:local_soreness"],
          fatigue: [
            "- Chest: over target",
            "- Lats: over target",
            "- Upper Back: over target",
            "- Quads: over target",
            "- Glutes: high fatigue watch via Bulgarian Split Squat",
            "- Hamstrings: watch fatigue watch via Seated Leg Curl",
          ],
        },
      })
    );

    expect(dto.calibrationNotes).toEqual([
      expect.objectContaining({
        kind: "prescription_confidence",
        exerciseLabel: "Close-Grip Seated Cable Row",
        message:
          "Close-Grip Seated Cable Row: Start at 80 lb; use 70-80 lb if first-set reps or RPE are off.",
      }),
      expect.objectContaining({
        kind: "prescription_confidence",
        exerciseLabel: "Cable Triceps Pushdown",
        message:
          "Cable Triceps Pushdown: Start at 45 lb; hold unless the first set feels clearly too easy or too hard.",
      }),
      {
        kind: "prescription_confidence",
        message:
          "Incline Press: Hold the target load unless the first set feels clearly too easy or too hard.",
      },
    ]);
    expect(dto.avoid).toEqual([
      "No extra volume. Weekly volume is already covered across most muscle groups.",
    ]);
    expect(dto.fatigueWatch).toEqual([
      "Keep lower-body add-ons off the table today; glutes and hamstrings are already carrying fatigue.",
      "Keep extra Chest work off the table if local soreness affects warm-ups.",
    ]);
    expect(JSON.stringify(dto.calibrationNotes)).not.toContain("over target");
    expect(JSON.stringify(dto.calibrationNotes)).not.toContain("fatigue");
    expect(JSON.stringify(dto)).not.toContain("over target");
    expect(JSON.stringify(dto)).not.toContain("watch fatigue watch");
    expect(JSON.stringify(dto)).not.toContain("action=");
    expect(JSON.stringify(dto)).not.toContain("confidence=");
    expect(JSON.stringify(dto)).not.toContain("reasons=");
  });

  it("does not import audit modules or parse CLI/render strings", () => {
    const source = readFileSync(
      "src/lib/api/pre-session-readiness-gym-card.ts",
      "utf8"
    );

    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("buildPreSessionReadinessSummary");
    expect(source).not.toContain("runWorkoutAuditGeneration");
    expect(source).not.toContain("buildWorkoutAuditContext");
    expect(source).not.toMatch(
      /doseClosure\.(heading|priority|optional|monitor|suppress|guardrails)/
    );
    expect(source).not.toMatch(
      /sessionLocalCoaching\.(defaultInstruction|safeOptionalAddOns|suppressAvoid|floorBufferOpportunities|prescriptionConfidenceWatches|fatigueCautions)/
    );
    expect(source).not.toMatch(/\.(line|addonLine)\b/);
  });
});
