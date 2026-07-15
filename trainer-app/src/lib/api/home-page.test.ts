import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PreSessionReadinessCoachingRecommendation,
  PreSessionReadinessConsistencyCheck,
  PreSessionReadinessContract,
} from "@/lib/api/pre-session-readiness-contract";

const mocks = vi.hoisted(() => {
  const workoutFindFirst = vi.fn();
  const workoutFindMany = vi.fn();
  const loadPendingMesocycleHandoff = vi.fn();
  const loadProgramDashboardData = vi.fn();
  const loadHomeProgramSupport = vi.fn();
  const loadCurrentHomePreSessionReadinessContractCandidate = vi.fn();

  return {
    workoutFindFirst,
    workoutFindMany,
    loadPendingMesocycleHandoff,
    loadProgramDashboardData,
    loadHomeProgramSupport,
    loadCurrentHomePreSessionReadinessContractCandidate,
    prisma: {
      workout: {
        findFirst: workoutFindFirst,
        findMany: workoutFindMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("./mesocycle-handoff", () => ({
  loadPendingMesocycleHandoff: (...args: unknown[]) =>
    mocks.loadPendingMesocycleHandoff(...args),
}));

vi.mock("./program", () => ({
  loadProgramDashboardData: (...args: unknown[]) =>
    mocks.loadProgramDashboardData(...args),
  loadHomeProgramSupport: (...args: unknown[]) =>
    mocks.loadHomeProgramSupport(...args),
}));

vi.mock("@/lib/ui-audit-fixtures/server", () => ({
  getUiAuditFixtureForServer: vi.fn(async () => null),
}));

vi.mock("./home-pre-session-readiness", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./home-pre-session-readiness")>();

  return {
    ...actual,
    loadCurrentHomePreSessionReadinessContractCandidate: (...args: unknown[]) =>
      mocks.loadCurrentHomePreSessionReadinessContractCandidate(...args),
  };
});

import { loadHomePageData } from "./home-page";

function makeWorkoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "workout-1",
    scheduledDate: new Date("2026-03-24T00:00:00.000Z"),
    completedAt: new Date("2026-03-24T01:00:00.000Z"),
    status: "COMPLETED",
    selectionMode: "INTENT",
    sessionIntent: "UPPER",
    mesocycleId: "meso-1",
    mesocycleWeekSnapshot: 2,
    mesoSessionSnapshot: 1,
    mesocyclePhaseSnapshot: "ACCUMULATION",
    selectionMetadata: {
      sessionDecisionReceipt: {
        version: 1,
        cycleContext: {
          weekInMeso: 2,
          weekInBlock: 2,
          phase: "accumulation",
          blockType: "accumulation",
          isDeload: false,
          source: "computed",
        },
        sessionSlot: {
          slotId: "upper_a",
          intent: "upper",
          sequenceIndex: 1,
          sequenceLength: 4,
          source: "mesocycle_slot_sequence",
        },
        lifecycleVolume: { source: "unknown" },
        sorenessSuppressedMuscles: [],
        deloadDecision: {
          mode: "none",
          reason: [],
          reductionPercent: 0,
          appliedTo: "none",
        },
        readiness: {
          wasAutoregulated: false,
          signalAgeHours: null,
          fatigueScoreOverall: null,
          intensityScaling: {
            applied: false,
            exerciseIds: [],
            scaledUpCount: 0,
            scaledDownCount: 0,
          },
        },
        exceptions: [],
      },
    },
    mesocycle: {
      sessionsPerWeek: 4,
      state: "ACTIVE_ACCUMULATION",
      isActive: true,
    },
    _count: { exercises: 5 },
    exercises: [],
    ...overrides,
  };
}

function readinessCheck(
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

function readinessRecommendation(
  overrides: Partial<PreSessionReadinessCoachingRecommendation> = {}
): PreSessionReadinessCoachingRecommendation {
  return {
    kind: overrides.kind ?? "optional",
    muscle: overrides.muscle ?? "Chest",
    targetMuscle: overrides.targetMuscle ?? overrides.muscle ?? "Chest",
    candidateExerciseName: overrides.candidateExerciseName ?? "Cable Fly",
    line: overrides.line ?? "render-only recommendation text",
    addonLine: overrides.addonLine ?? "render-only add-on text",
    suppressed: overrides.suppressed ?? false,
    suppressionReasons: overrides.suppressionReasons ?? [],
  };
}

function makeReadinessContract(
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
      noAddOnReason:
        "Projected week status is no_further_action; no optional add-ons are recommended.",
    },
    doseClosure: {
      heading: "Dose Closure Guidance",
      priority: ["render-only priority"],
      optional: ["render-only optional"],
      monitor: ["render-only monitor"],
      suppress: ["render-only suppress"],
      guardrails: ["render-only guardrail"],
      recommendations: [],
    },
    sessionLocalCoaching: {
      defaultInstruction: "Default: run seed as prescribed.",
      floorBufferOpportunities: ["render-only floor buffer"],
      prescriptionConfidenceWatches: ["render-only confidence"],
      fatigueCautions: ["render-only fatigue"],
      safeOptionalAddOns: [
        "- none - Projected week status is no_further_action; no optional add-ons are recommended.",
      ],
      suppressAvoid: ["render-only suppress/avoid"],
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
      readinessCheck("optional_add_on_matches_flagged_muscle"),
      readinessCheck("optional_add_on_not_suppressed_muscle"),
      readinessCheck("no_add_on_state_explicit"),
      readinessCheck("blocked_state_no_normal_start_coaching"),
      readinessCheck("seed_runtime_proof_read_only"),
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

describe("loadHomePageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.loadPendingMesocycleHandoff.mockResolvedValue(null);
    mocks.loadCurrentHomePreSessionReadinessContractCandidate.mockResolvedValue(null);
    mocks.workoutFindFirst.mockResolvedValue(makeWorkoutRow());
    mocks.workoutFindMany.mockResolvedValue([
      makeWorkoutRow({ id: "activity-1" }),
      makeWorkoutRow({
        id: "activity-2",
        status: "PLANNED",
        completedAt: null,
        sessionIntent: "LOWER",
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 2,
              weekInBlock: 2,
              phase: "accumulation",
              blockType: "accumulation",
              isDeload: false,
              source: "computed",
            },
            sessionSlot: {
              slotId: "lower_a",
              intent: "lower",
              sequenceIndex: 1,
              sequenceLength: 4,
              source: "mesocycle_slot_sequence",
            },
            lifecycleVolume: { source: "unknown" },
            sorenessSuppressedMuscles: [],
            deloadDecision: {
              mode: "none",
              reason: [],
              reductionPercent: 0,
              appliedTo: "none",
            },
            readiness: {
              wasAutoregulated: false,
              signalAgeHours: null,
              fatigueScoreOverall: null,
              intensityScaling: {
                applied: false,
                exerciseIds: [],
                scaledUpCount: 0,
                scaledDownCount: 0,
              },
            },
            exceptions: [],
          },
        },
      }),
      makeWorkoutRow({ id: "activity-3", sessionIntent: "PULL" }),
    ]);
    mocks.loadProgramDashboardData.mockResolvedValue({
      activeMeso: {
        mesoNumber: 2,
        focus: "Strength-Hypertrophy",
        durationWeeks: 5,
        completedSessions: 4,
        volumeTarget: "moderate",
        currentBlockType: "accumulation",
        blocks: [],
      },
      currentWeek: 2,
      viewedWeek: 2,
      viewedBlockType: "accumulation",
      sessionsUntilDeload: 6,
      volumeThisWeek: [],
      deloadReadiness: null,
      rirTarget: { min: 2, max: 3 },
      coachingCue: "Build volume with crisp execution.",
    });
    mocks.loadHomeProgramSupport.mockResolvedValue({
      nextSession: {
        intent: "lower",
        slotId: "lower_a",
        slotSequenceIndex: 1,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        weekInMeso: 2,
        sessionInWeek: 2,
        workoutId: null,
        isExisting: false,
      },
      activeWeek: 2,
      activeWeekPlan: {
        week: 2,
        source: "mesocycle_slot_sequence",
        sessions: [
          {
            slotId: "upper_a",
            label: "Upper 1",
            status: "completed",
            statusLabel: "Completed",
            href: "/workout/workout-1",
            workoutId: "workout-1",
            sequenceIndex: 0,
          },
          {
            slotId: "lower_a",
            label: "Lower 1",
            status: "next",
            statusLabel: "Next",
            href: "#generate-workout",
            workoutId: null,
            sequenceIndex: 1,
          },
          {
            slotId: "upper_b",
            label: "Upper 2",
            status: "upcoming",
            statusLabel: "Upcoming",
            href: null,
            workoutId: null,
            sequenceIndex: 2,
          },
          {
            slotId: "lower_b",
            label: "Lower 2",
            status: "upcoming",
            statusLabel: "Upcoming",
            href: null,
            workoutId: null,
            sequenceIndex: 3,
          },
        ],
      },
      completedAdvancingSessionsThisWeek: 1,
      totalAdvancingSessionsThisWeek: 4,
      lastSessionSkipped: false,
      latestIncomplete: null,
      gapFill: {
        eligible: false,
        visible: false,
        reason: "no_pending_week_close",
        weekCloseId: null,
        anchorWeek: null,
        targetWeek: null,
        targetPhase: null,
        resolution: null,
        workflowState: null,
        deficitState: null,
        remainingDeficitSets: 0,
        targetMuscles: [],
        deficitSummary: [],
        alreadyUsedThisWeek: false,
        suppressedByStartedNextWeek: false,
        linkedWorkout: null,
        policy: {
          requiredSessionsPerWeek: 4,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
      },
      closeout: {
        visible: false,
        workoutId: null,
        weekCloseId: null,
        status: null,
        targetWeek: null,
        isIncomplete: false,
        isPriorWeek: false,
        canCreate: false,
      },
    });
  });

  it("composes decision, continuity, recent activity preview, and compact program inputs", async () => {
    const result = await loadHomePageData("user-1");

    expect(result.pendingHandoff).toBeNull();
    expect(result.preSessionReadinessCard).toBeNull();
    expect(result.headerContext).toBe("Week 2 - Accumulation");
    expect(result.primaryAction).toEqual({
      state: "planned",
      mode: "generate",
      label: "Start workout",
      action: "generate-required-workout",
      initialIntent: "lower",
      initialSlotId: "lower_a",
      reasonLabel: "Next in sequence",
      reason: "Nothing earlier is still open, so Lower 1 is next this week.",
    });
    expect(result.decision).toEqual({
      nextSessionLabel: "Lower 1",
      nextSessionDescription: "First lower session this week",
      nextSessionReasonLabel: "Next in sequence",
      nextSessionReason: "Nothing earlier is still open, so Lower 1 is next this week.",
      activeWeekLabel: "Week 2 - 1 of 4 sessions complete",
      activeWeekSessions: [
        {
          slotId: "upper_a",
          label: "Upper 1",
          status: "completed",
          statusLabel: "Completed",
          href: "/workout/workout-1",
          workoutId: "workout-1",
          sequenceIndex: 0,
        },
        {
          slotId: "lower_a",
          label: "Lower 1",
          status: "next",
          statusLabel: "Next",
          href: "#generate-workout",
          workoutId: null,
          sequenceIndex: 1,
        },
        {
          slotId: "upper_b",
          label: "Upper 2",
          status: "upcoming",
          statusLabel: "Upcoming",
          href: null,
          workoutId: null,
          sequenceIndex: 2,
        },
        {
          slotId: "lower_b",
          label: "Lower 2",
          status: "upcoming",
          statusLabel: "Upcoming",
          href: null,
          workoutId: null,
          sequenceIndex: 3,
        },
      ],
      activeWeekPlanSource: "mesocycle_slot_sequence",
      completedAdvancingSessionsThisWeek: 1,
      totalAdvancingSessionsThisWeek: 4,
    });
    expect(result.continuity).toMatchObject({
      nextDueLabel: "Lower 1",
      lastCompletedDescriptor: "First upper session this week",
      nextDueDescriptor: "First lower session this week",
      summary:
        "Last completed: First upper session this week. Next due: Lower 1 (First lower session this week).",
    });
    expect(result.closeout).toBeNull();
    expect(result.recentActivity).toHaveLength(3);
    expect(mocks.workoutFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
      })
    );
  });

  it("exposes the readiness gym-card DTO from a typed readiness contract", async () => {
    const base = makeReadinessContract();
    const contract = makeReadinessContract({
      projectedWeekStatus: {
        ...base.projectedWeekStatus,
        status: "top_up_candidate",
        belowMev: ["Chest"],
      },
      doseClosure: {
        ...base.doseClosure,
        recommendations: [
          readinessRecommendation({
            kind: "priority",
            muscle: "Chest",
            targetMuscle: "Chest",
            candidateExerciseName: "Cable Fly",
          }),
        ],
      },
      sessionLocalCoaching: {
        ...base.sessionLocalCoaching,
        addOnState: {
          status: "available",
          reason: "Contract has session-local optional add-on rows.",
        },
      },
    });

    const result = await loadHomePageData("user-1", {
      preSessionReadinessContract: contract,
    });

    expect(result.preSessionReadinessCard).toMatchObject({
      safeToTrain: true,
      action: "start",
      sessionLabel: "Lower 1",
      optionalAddOns: {
        status: "available",
        reason: "Optional only; skip it if the planned work feels heavy.",
        items: [
          {
            kind: "priority",
            muscle: "Chest",
            targetMuscle: "Chest",
            candidateExerciseName: "Cable Fly",
            source: "dose_closure_recommendation",
          },
        ],
      },
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

  it("exposes the readiness gym-card DTO from a valid producer contract", async () => {
    const base = makeReadinessContract();
    const contract = makeReadinessContract({
      projectedWeekStatus: {
        ...base.projectedWeekStatus,
        status: "top_up_candidate",
        belowMev: ["Chest"],
      },
      doseClosure: {
        ...base.doseClosure,
        recommendations: [
          readinessRecommendation({
            kind: "priority",
            muscle: "Chest",
            targetMuscle: "Chest",
            candidateExerciseName: "Cable Fly",
          }),
        ],
      },
      sessionLocalCoaching: {
        ...base.sessionLocalCoaching,
        addOnState: {
          status: "available",
          reason: "Contract has session-local optional add-on rows.",
        },
      },
    });
    mocks.loadCurrentHomePreSessionReadinessContractCandidate.mockResolvedValue({
      contract,
      source: "typed_read_model",
    });

    const result = await loadHomePageData("user-1");

    expect(
      mocks.loadCurrentHomePreSessionReadinessContractCandidate
    ).toHaveBeenCalledWith("user-1");
    expect(result.preSessionReadinessCard).toMatchObject({
      safeToTrain: true,
      action: "start",
      optionalAddOns: {
        status: "available",
        reason: "Optional only; skip it if the planned work feels heavy.",
        items: [
          {
            kind: "priority",
            muscle: "Chest",
            targetMuscle: "Chest",
            candidateExerciseName: "Cable Fly",
            source: "dose_closure_recommendation",
          },
        ],
      },
    });
  });

  it("returns null readiness card when no typed readiness contract is supplied", async () => {
    const result = await loadHomePageData("user-1");

    expect(result.preSessionReadinessCard).toBeNull();
    expect(result.primaryAction).toEqual({
      state: "planned",
      mode: "generate",
      label: "Start workout",
      action: "generate-required-workout",
      initialIntent: "lower",
      initialSlotId: "lower_a",
      reasonLabel: "Next in sequence",
      reason: "Nothing earlier is still open, so Lower 1 is next this week.",
    });
  });

  it("returns null readiness card when the producer marks the candidate stale", async () => {
    mocks.loadCurrentHomePreSessionReadinessContractCandidate.mockResolvedValue({
      contract: makeReadinessContract(),
      source: "audit_artifact",
      stale: true,
    });

    const result = await loadHomePageData("user-1");

    expect(result.preSessionReadinessCard).toBeNull();
    expect(result.primaryAction).toEqual({
      state: "planned",
      mode: "generate",
      label: "Start workout",
      action: "generate-required-workout",
      initialIntent: "lower",
      initialSlotId: "lower_a",
      reasonLabel: "Next in sequence",
      reason: "Nothing earlier is still open, so Lower 1 is next this week.",
    });
  });

  it("returns null readiness card when the producer candidate is invalid or mismatched", async () => {
    mocks.loadCurrentHomePreSessionReadinessContractCandidate.mockResolvedValue({
      contract: makeReadinessContract({
        nextSessionIdentity: {
          ...makeReadinessContract().nextSessionIdentity,
          userId: "other-user",
        },
      }),
      source: "audit_artifact",
    });

    const result = await loadHomePageData("user-1");

    expect(result.preSessionReadinessCard).toBeNull();
  });

  it("surfaces blocked readiness in the DTO without changing the existing Home CTA", async () => {
    const base = makeReadinessContract();
    const contract = makeReadinessContract({
      startability: {
        ...base.startability,
        status: "blocked",
        safeToTrain: false,
        normalStartCoachingAllowed: false,
        action: "resolve_blocker_first",
        reasons: ["incomplete workout blocker: stale plan"],
        blockerSummary: "incomplete workout blocker: stale plan",
      },
      projectedWeekStatus: {
        ...base.projectedWeekStatus,
        status: "blocked",
      },
      sessionLocalCoaching: {
        ...base.sessionLocalCoaching,
        addOnState: {
          status: "blocked",
          reason: "Readiness is blocked; resolve blocker before considering add-ons.",
        },
      },
    });

    const result = await loadHomePageData("user-1", {
      preSessionReadinessContract: contract,
    });

    expect(result.preSessionReadinessCard).toMatchObject({
      safeToTrain: false,
      action: "blocked",
      rpeCap: null,
      blockers: ["incomplete workout blocker: stale plan"],
    });
    expect(result.primaryAction).toEqual({
      state: "planned",
      mode: "generate",
      label: "Start workout",
      action: "generate-required-workout",
      initialIntent: "lower",
      initialSlotId: "lower_a",
      reasonLabel: "Next in sequence",
      reason: "Nothing earlier is still open, so Lower 1 is next this week.",
    });
  });

  it("keeps a valid no-add-on readiness state explicit", async () => {
    const result = await loadHomePageData("user-1", {
      preSessionReadinessContract: makeReadinessContract(),
    });

    expect(result.preSessionReadinessCard?.optionalAddOns).toEqual({
      status: "none",
      reason: "No add-ons recommended.",
      items: [],
    });
    expect(result.preSessionReadinessCard?.mainPriority).toBe(
      "Run the planned workout; no extra work needed today."
    );
  });

  it("does not surface contradictory or suppressed add-ons as valid optional add-ons", async () => {
    const base = makeReadinessContract();
    const contract = makeReadinessContract({
      projectedWeekStatus: {
        ...base.projectedWeekStatus,
        status: "top_up_candidate",
        overMav: ["Side Delts"],
      },
      doseClosure: {
        ...base.doseClosure,
        recommendations: [
          readinessRecommendation({
            muscle: "Side Delts",
            targetMuscle: "Side Delts",
            candidateExerciseName: "Cable Lateral Raise",
            suppressed: true,
            suppressionReasons: ["target_muscle_suppressed"],
          }),
        ],
      },
      sessionLocalCoaching: {
        ...base.sessionLocalCoaching,
        addOnState: {
          status: "available",
          reason: "Contract has session-local optional add-on rows.",
        },
      },
      consistencyChecks: [
        readinessCheck("optional_add_on_matches_flagged_muscle"),
        readinessCheck("optional_add_on_not_suppressed_muscle", "warning"),
        readinessCheck("no_add_on_state_explicit"),
        readinessCheck("blocked_state_no_normal_start_coaching"),
        readinessCheck("seed_runtime_proof_read_only"),
      ],
    });

    const result = await loadHomePageData("user-1", {
      preSessionReadinessContract: contract,
    });

    expect(result.preSessionReadinessCard?.optionalAddOns).toMatchObject({
      status: "none",
      items: [],
    });
    expect(result.preSessionReadinessCard?.avoid).toEqual(
      expect.arrayContaining([
        "Avoid Cable Lateral Raise for Side Delts: not a good add-on target today.",
        "No extra Side Delts; weekly volume is already covered.",
      ])
    );
    expect(JSON.stringify(result.preSessionReadinessCard)).not.toContain(
      "over target"
    );
  });

  it("ignores poisoned CLI and render strings when exposing the Home read-model DTO", async () => {
    const base = makeReadinessContract();
    const contract = makeReadinessContract({
      projectedWeekStatus: {
        ...base.projectedWeekStatus,
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
          readinessRecommendation({
            muscle: "Biceps",
            targetMuscle: "Biceps",
            candidateExerciseName: "Cable Curl",
            line: "poison recommendation line",
            addonLine: "poison addon line",
          }),
        ],
      },
      sessionLocalCoaching: {
        ...base.sessionLocalCoaching,
        defaultInstruction: "poison default instruction",
        floorBufferOpportunities: ["poison floor buffer"],
        prescriptionConfidenceWatches: ["poison confidence"],
        fatigueCautions: ["poison fatigue"],
        safeOptionalAddOns: ["poison safe optional add-on"],
        suppressAvoid: ["poison suppress avoid"],
        addOnState: {
          status: "available",
          reason: "typed add-on state",
        },
      },
    });

    const result = await loadHomePageData("user-1", {
      preSessionReadinessContract: contract,
    });

    expect(result.preSessionReadinessCard?.optionalAddOns.items).toEqual([
      {
        kind: "optional",
        muscle: "Biceps",
        targetMuscle: "Biceps",
        candidateExerciseName: "Cable Curl",
        source: "dose_closure_recommendation",
        reason: "Biceps has a small useful session-local gap.",
        guardrail: "Skip it if the planned workout feels heavy.",
      },
    ]);
    expect(JSON.stringify(result.preSessionReadinessCard)).not.toContain("poison");
  });

  it("does not parse workout-audit CLI prose or render strings in the Home read model", () => {
    const source = readFileSync("src/lib/api/home-page.ts", "utf8");
    const producerSource = readFileSync(
      "src/lib/api/home-pre-session-readiness.ts",
      "utf8"
    );

    expect(source).toContain("buildPreSessionReadinessGymCardDto");
    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("buildPreSessionReadinessSummary");
    expect(source).not.toContain("runWorkoutAuditGeneration");
    expect(source).not.toContain("buildWorkoutAuditContext");
    expect(source).not.toContain("generateSessionFromIntent");
    expect(source).not.toContain("loadProjectedWeekVolumeReport");
    expect(source).not.toMatch(/doseClosure\.(heading|priority|optional|monitor|suppress|guardrails)/);
    expect(source).not.toMatch(/sessionLocalCoaching\.(defaultInstruction|safeOptionalAddOns|suppressAvoid|floorBufferOpportunities|prescriptionConfidenceWatches|fatigueCautions)/);
    expect(source).not.toMatch(/\.(line|addonLine)\b/);
    expect(producerSource).not.toContain("workout-audit-cli");
    expect(producerSource).not.toContain("@/lib/audit/workout-audit");
    expect(producerSource).not.toContain("buildPreSessionReadinessSummary");
    expect(producerSource).not.toContain("runWorkoutAuditGeneration");
    expect(producerSource).not.toContain("buildWorkoutAuditContext");
    expect(producerSource).not.toContain("generateSessionFromIntent");
    expect(producerSource).not.toContain("loadProjectedWeekVolumeReport");
  });

  it("returns recent activity without loading program seams when handoff is pending", async () => {
    mocks.loadPendingMesocycleHandoff.mockResolvedValue({
      mesocycleId: "meso-1",
      mesoNumber: 2,
      focus: "Strength-Hypertrophy",
    });

    const result = await loadHomePageData("user-1");

    expect(result.pendingHandoff).toMatchObject({
      mesocycleId: "meso-1",
    });
    expect(result.programData).toBeNull();
    expect(result.homeProgram).toBeNull();
    expect(result.primaryAction).toEqual({
      state: "blocked",
      label: "Review handoff",
      reason: "Training is paused until you accept the next cycle.",
      href: "/mesocycles/meso-1/review",
    });
    expect(mocks.loadProgramDashboardData).not.toHaveBeenCalled();
    expect(mocks.loadHomeProgramSupport).not.toHaveBeenCalled();
    expect(result.recentActivity).toHaveLength(3);
  });

  it("uses resume reasoning when an incomplete workout exists even if the next-session seam has rotation context", async () => {
    mocks.loadHomeProgramSupport.mockResolvedValue({
      nextSession: {
        intent: "lower",
        slotId: "lower_a",
        slotSequenceIndex: 1,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        weekInMeso: 2,
        sessionInWeek: 2,
        workoutId: "workout-planned",
        isExisting: true,
      },
      activeWeek: 2,
      completedAdvancingSessionsThisWeek: 1,
      totalAdvancingSessionsThisWeek: 4,
      lastSessionSkipped: false,
      latestIncomplete: {
        id: "workout-planned",
        status: "planned",
      },
      gapFill: {
        eligible: false,
        visible: false,
        reason: "no_pending_week_close",
        weekCloseId: null,
        anchorWeek: null,
        targetWeek: null,
        targetPhase: null,
        resolution: null,
        workflowState: null,
        deficitState: null,
        remainingDeficitSets: 0,
        targetMuscles: [],
        deficitSummary: [],
        alreadyUsedThisWeek: false,
        suppressedByStartedNextWeek: false,
        linkedWorkout: null,
        policy: {
          requiredSessionsPerWeek: 4,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
      },
      closeout: {
        visible: false,
        workoutId: null,
        weekCloseId: null,
        status: null,
        targetWeek: null,
        isIncomplete: false,
        isPriorWeek: false,
        canCreate: false,
      },
    });

    const result = await loadHomePageData("user-1");

    expect(result.decision).toMatchObject({
      nextSessionLabel: "Lower 1",
      nextSessionReasonLabel: "Up next",
      nextSessionReason: "A planned workout already exists, so you can start logging right away.",
    });
    expect(result.primaryAction).toEqual({
      state: "planned",
      mode: "existing",
      label: "Start workout",
      href: "/log/workout-planned",
      reasonLabel: "Up next",
      reason: "A planned workout already exists, so you can start logging right away.",
    });
  });

  it("makes an active workout the primary action", async () => {
    mocks.loadHomeProgramSupport.mockResolvedValue({
      nextSession: {
        intent: "lower",
        slotId: "lower_a",
        slotSequenceIndex: 1,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        weekInMeso: 2,
        sessionInWeek: 2,
        workoutId: "workout-active",
        isExisting: true,
      },
      activeWeek: 2,
      completedAdvancingSessionsThisWeek: 1,
      totalAdvancingSessionsThisWeek: 4,
      lastSessionSkipped: false,
      latestIncomplete: {
        id: "workout-active",
        status: "in_progress",
      },
      gapFill: {
        eligible: false,
        visible: false,
        reason: "no_pending_week_close",
        weekCloseId: null,
        anchorWeek: null,
        targetWeek: null,
        targetPhase: null,
        resolution: null,
        workflowState: null,
        deficitState: null,
        remainingDeficitSets: 0,
        targetMuscles: [],
        deficitSummary: [],
        alreadyUsedThisWeek: false,
        suppressedByStartedNextWeek: false,
        linkedWorkout: null,
        policy: {
          requiredSessionsPerWeek: 4,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
      },
      closeout: {
        visible: false,
        workoutId: null,
        weekCloseId: null,
        status: null,
        targetWeek: null,
        isIncomplete: false,
        isPriorWeek: false,
        canCreate: false,
      },
    });

    const result = await loadHomePageData("user-1");

    expect(result.primaryAction).toEqual({
      state: "active",
      label: "Resume workout",
      href: "/log/workout-active",
      reasonLabel: "Resume session",
      reason: "You already started this workout, so finish it before generating another.",
    });
  });

  it("blocks required generation when the required week is complete", async () => {
    mocks.loadHomeProgramSupport.mockResolvedValue({
      nextSession: {
        intent: "lower",
        slotId: "lower_a",
        slotSequenceIndex: 1,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        weekInMeso: 2,
        sessionInWeek: 2,
        workoutId: null,
        isExisting: false,
      },
      activeWeek: 2,
      completedAdvancingSessionsThisWeek: 4,
      totalAdvancingSessionsThisWeek: 4,
      lastSessionSkipped: false,
      latestIncomplete: null,
      gapFill: {
        eligible: false,
        visible: false,
        reason: "no_pending_week_close",
        weekCloseId: null,
        anchorWeek: null,
        targetWeek: null,
        targetPhase: null,
        resolution: null,
        workflowState: null,
        deficitState: null,
        remainingDeficitSets: 0,
        targetMuscles: [],
        deficitSummary: [],
        alreadyUsedThisWeek: false,
        suppressedByStartedNextWeek: false,
        linkedWorkout: null,
        policy: {
          requiredSessionsPerWeek: 4,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
      },
      closeout: {
        visible: true,
        workoutId: null,
        weekCloseId: "wc-2",
        status: null,
        targetWeek: 2,
        isIncomplete: false,
        isPriorWeek: false,
        canCreate: true,
      },
    });

    const result = await loadHomePageData("user-1");

    expect(result.primaryAction).toEqual({
      state: "completed",
      label: "Week complete",
      description:
        "Required sessions are done for this week. Optional sessions stay separate below.",
      href: "/program",
    });
  });

  it("keeps skipped optional gap-fill separate from the completed required-week action", async () => {
    mocks.loadHomeProgramSupport.mockResolvedValue({
      nextSession: {
        intent: null,
        slotId: null,
        slotSequenceIndex: null,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        weekInMeso: 4,
        sessionInWeek: null,
        workoutId: null,
        isExisting: false,
      },
      activeWeek: 4,
      completedAdvancingSessionsThisWeek: 4,
      totalAdvancingSessionsThisWeek: 4,
      lastSessionSkipped: false,
      latestIncomplete: null,
      gapFill: {
        eligible: false,
        visible: true,
        reason: null,
        weekCloseId: "wc-4",
        anchorWeek: 4,
        targetWeek: 4,
        targetPhase: "ACCUMULATION",
        resolution: null,
        workflowState: "PENDING_OPTIONAL_GAP_FILL",
        deficitState: "OPEN",
        remainingDeficitSets: 4,
        targetMuscles: ["Chest"],
        deficitSummary: [{ muscle: "Chest", target: 12, actual: 8, deficit: 4 }],
        alreadyUsedThisWeek: false,
        suppressedByStartedNextWeek: false,
        linkedWorkout: {
          id: "w-gap-fill",
          status: "SKIPPED",
        },
        policy: {
          requiredSessionsPerWeek: 4,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
      },
      closeout: {
        visible: false,
        workoutId: null,
        weekCloseId: null,
        status: null,
        targetWeek: null,
        isIncomplete: false,
        isPriorWeek: false,
        canCreate: false,
      },
    });

    const result = await loadHomePageData("user-1");

    expect(result.primaryAction).toEqual({
      state: "completed",
      label: "Week complete",
      description:
        "Required sessions are done for this week. Optional sessions stay separate below.",
      href: "/program",
    });
    expect(result.homeProgram?.gapFill).toMatchObject({
      eligible: false,
      visible: true,
      weekCloseId: "wc-4",
      workflowState: "PENDING_OPTIONAL_GAP_FILL",
      linkedWorkout: {
        id: "w-gap-fill",
        status: "SKIPPED",
      },
    });
  });

  it("adds a separate optional-session summary without altering the canonical next-session decision", async () => {
    mocks.loadHomeProgramSupport.mockResolvedValue({
      nextSession: {
        intent: "lower",
        slotId: "lower_a",
        slotSequenceIndex: 1,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        weekInMeso: 2,
        sessionInWeek: 2,
        workoutId: null,
        isExisting: false,
      },
      activeWeek: 2,
      completedAdvancingSessionsThisWeek: 1,
      totalAdvancingSessionsThisWeek: 4,
      lastSessionSkipped: false,
      latestIncomplete: null,
      gapFill: {
        eligible: false,
        visible: false,
        reason: "no_pending_week_close",
        weekCloseId: null,
        anchorWeek: null,
        targetWeek: null,
        targetPhase: null,
        resolution: null,
        workflowState: null,
        deficitState: null,
        remainingDeficitSets: 0,
        targetMuscles: [],
        deficitSummary: [],
        alreadyUsedThisWeek: false,
        suppressedByStartedNextWeek: false,
        linkedWorkout: null,
        policy: {
          requiredSessionsPerWeek: 4,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
      },
      closeout: {
        visible: true,
        workoutId: "workout-closeout",
        weekCloseId: null,
        status: "planned",
        targetWeek: 2,
        isIncomplete: true,
        isPriorWeek: false,
        canCreate: false,
      },
    });

    const result = await loadHomePageData("user-1");

    expect(result.decision).toMatchObject({
      nextSessionLabel: "Lower 1",
      nextSessionReasonLabel: "Next in sequence",
    });
    expect(result.primaryAction).toMatchObject({
      state: "planned",
      mode: "generate",
      action: "generate-required-workout",
    });
    expect(result.closeout).toEqual({
      title: "Custom session",
      workoutId: "workout-closeout",
      status: "planned",
      statusLabel: "Planned",
      detail:
        "Optional manual session for this week. It can add actual weekly volume without becoming required work.",
      actionHref: "/log/workout-closeout",
      actionLabel: "Open custom session",
      dismissActionHref: "/api/workouts/workout-closeout/dismiss-closeout",
      dismissActionLabel: "Dismiss optional session",
      canDismiss: true,
    });
  });

  it("adds a previous-week create optional-session summary without altering the canonical next-session decision", async () => {
    mocks.loadHomeProgramSupport.mockResolvedValue({
      nextSession: {
        intent: "upper",
        slotId: "upper_a",
        slotSequenceIndex: 0,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        weekInMeso: 4,
        sessionInWeek: 1,
        workoutId: null,
        isExisting: false,
      },
      activeWeek: 4,
      completedAdvancingSessionsThisWeek: 0,
      totalAdvancingSessionsThisWeek: 4,
      lastSessionSkipped: false,
      latestIncomplete: null,
      gapFill: {
        eligible: false,
        visible: false,
        reason: "out_of_scope_for_active_week",
        weekCloseId: "wc-3",
        anchorWeek: 3,
        targetWeek: 3,
        targetPhase: "ACCUMULATION",
        resolution: null,
        workflowState: "PENDING_OPTIONAL_GAP_FILL",
        deficitState: "OPEN",
        remainingDeficitSets: 4,
        targetMuscles: ["Chest"],
        deficitSummary: [{ muscle: "Chest", target: 12, actual: 8, deficit: 4 }],
        alreadyUsedThisWeek: false,
        suppressedByStartedNextWeek: false,
        linkedWorkout: null,
        policy: {
          requiredSessionsPerWeek: 4,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
      },
      closeout: {
        visible: true,
        workoutId: null,
        weekCloseId: "wc-3",
        status: null,
        targetWeek: 3,
        isIncomplete: false,
        isPriorWeek: true,
        canCreate: true,
      },
    });

    const result = await loadHomePageData("user-1");

    expect(result.decision).toMatchObject({
      nextSessionLabel: "Upper 1",
      activeWeekLabel: "Week 4 - 0 of 4 sessions complete",
    });
    expect(result.closeout).toEqual({
      title: "Week 3 optional session",
      workoutId: null,
      workoutRevision: null,
      status: "available",
      statusLabel: "Available",
      detail:
        "A Week 3 optional session is still available after rollover. It remains optional and does not change Week 4 continuity.",
      actionHref: "/api/mesocycles/week-close/wc-3/closeout",
      actionLabel: "Create optional session",
      actionMethod: "post",
      dismissActionHref: null,
      dismissActionLabel: null,
      canDismiss: true,
    });
  });

  it("filters dismissed closeouts from recent activity and fills from the lookback window", async () => {
    mocks.workoutFindMany.mockResolvedValue([
      makeWorkoutRow({
        id: "dismissed-closeout",
        status: "PLANNED",
        completedAt: null,
        selectionMetadata: {
          closeoutDismissed: true,
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 2,
              weekInBlock: 2,
              phase: "accumulation",
              blockType: "accumulation",
              isDeload: false,
              source: "computed",
            },
            lifecycleVolume: { source: "unknown" },
            sorenessSuppressedMuscles: [],
            deloadDecision: {
              mode: "none",
              reason: [],
              reductionPercent: 0,
              appliedTo: "none",
            },
            readiness: {
              wasAutoregulated: false,
              signalAgeHours: null,
              fatigueScoreOverall: null,
              intensityScaling: {
                applied: false,
                exerciseIds: [],
                scaledUpCount: 0,
                scaledDownCount: 0,
              },
            },
            exceptions: [
              {
                code: "closeout_session",
                message: "Marked as closeout session.",
              },
            ],
          },
        },
      }),
      makeWorkoutRow({ id: "activity-1" }),
      makeWorkoutRow({ id: "activity-2" }),
      makeWorkoutRow({ id: "activity-3" }),
    ]);

    const result = await loadHomePageData("user-1");

    expect(result.recentActivity.map((workout) => workout.id)).toEqual([
      "activity-1",
      "activity-2",
      "activity-3",
    ]);
  });
});
