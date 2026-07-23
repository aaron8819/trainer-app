import { describe, expect, it } from "vitest";
import { buildPostSessionReviewContract } from "../api/post-session-review-contract-builder";
import type { PostSessionReviewContractBuildInput } from "../api/post-session-review-evidence";
import { buildCanonicalProgressionEvaluationInput } from "../progression/canonical-progression-input";
import { getLoadRecommendation } from "../progression/load-coaching";
import { applyLoads } from "./apply-loads";
import { computeDoubleProgressionDecision, type ProgressionSet } from "./progression";
import type { Exercise, WorkoutPlan } from "./types";
import { LOAD_PRESCRIPTION_SCENARIOS } from "./load-prescription-scenarios.fixture";

const barbell: Exercise = {
  id: "bench",
  name: "Bench Press",
  movementPatterns: ["horizontal_push"],
  splitTags: ["push"],
  jointStress: "medium",
  isMainLiftEligible: true,
  isCompound: true,
  equipment: ["barbell"],
};

function setsFor(scenario: (typeof LOAD_PRESCRIPTION_SCENARIOS)[number]): ProgressionSet[] {
  return [1, 2, 3].map((setIndex) => ({
    setIndex,
    reps: scenario.prior.performedReps ?? scenario.prior.prescribedReps,
    ...(scenario.prior.actualRpe == null ? {} : { rpe: scenario.prior.actualRpe }),
    load: scenario.prior.performedLoad,
    targetLoad: scenario.prior.prescribedLoad,
    targetReps: scenario.prior.prescribedReps,
    targetRepMin: scenario.prior.prescribedRepMin,
    targetRpe: scenario.prior.prescribedRpe,
  }));
}

function decide(
  scenario: (typeof LOAD_PRESCRIPTION_SCENARIOS)[number],
  options: { sets?: ProgressionSet[]; history?: ProgressionSet[][]; confidence?: number; planned?: number } = {}
) {
  const sets = options.sets ?? setsFor(scenario);
  const sessions = [sets, ...(options.history ?? [])].map((sessionSets, index) => ({
    exposureId: `workout-${index + 1}`,
    date: `2026-07-${20 - index}`,
    source: "exact_exercise_history" as const,
    confidence: options.confidence ?? 1,
    confidenceNotes: [],
    progressionEligible: true,
    comparable: true,
    representativeLoad: sessionSets[0]?.load,
    plannedWorkingSetCount: index === 0 ? options.planned ?? sessionSets.length : sessionSets.length,
    sets: sessionSets,
  }));
  const input = buildCanonicalProgressionEvaluationInput({
    lastSets: sets,
    repRange: [scenario.prior.prescribedRepMin ?? scenario.prior.prescribedReps, scenario.prior.prescribedReps],
    equipment: "barbell",
    currentTarget: { reps: scenario.current.prescribedReps, rpe: scenario.current.prescribedRpe },
    workingSetLoad: scenario.prior.performedLoad,
    historySessions: sessions,
    loadIncrement: scenario.increment,
  });
  return computeDoubleProgressionDecision(input.lastSets, input.repRange, input.equipment, input.decisionOptions);
}

function reviewClassification(performedLoad: number, targetLoad: number) {
  const sets = [1, 2, 3].map((setIndex) => ({
    workoutSetId: `set-${setIndex}`,
    setIndex,
    targetReps: 10,
    targetRepMin: 8,
    targetRepMax: 12,
    targetRpe: 8,
    targetLoad,
    wasLogged: true,
    wasSkipped: false,
    actualReps: 10,
    actualLoad: performedLoad,
    actualRpe: 8,
  }));
  const input: PostSessionReviewContractBuildInput = {
    workoutIdentity: {
      userId: "user-1", workoutId: "workout-review", status: "COMPLETED", revision: 1,
      scheduledDate: "2026-07-20T00:00:00.000Z", selectionMode: "INTENT", sessionIntent: "PUSH",
      advancesSplit: true, mesocycleId: "meso-1", mesocycleWeekSnapshot: 2,
      mesoSessionSnapshot: 1, mesocyclePhaseSnapshot: "ACCUMULATION", slotId: "upper_a",
    },
    sourceTruth: {
      setLogsAvailable: true, workoutStructureAvailable: true,
      sessionDecisionReceiptAvailable: true, workoutStructureStateAvailable: true,
      runtimeEditReconciliationAvailable: false,
    },
    sessionSemantics: {
      kind: "advancing", isDeload: false, countsTowardWeeklyVolume: true,
      countsTowardProgressionHistory: true, countsTowardPerformanceHistory: true,
      updatesProgressionAnchor: true,
    },
    exercises: [{ workoutExerciseId: "we-1", exerciseId: "bench", exerciseName: "Bench Press", section: "MAIN", isMainLift: true, sets }],
  };
  return buildPostSessionReviewContract(input).prescriptionCalibration.rows[0]?.classification;
}

describe("real load-prescription behavior matrix A-P", () => {
  it.each(LOAD_PRESCRIPTION_SCENARIOS.filter((item) => "ABCEFGIJM".includes(item.id)))(
    "$id $description",
    (scenario) => expect(decide(scenario)?.nextLoad).toBe(scenario.expected.targetLoad)
  );

  it.each(LOAD_PRESCRIPTION_SCENARIOS.filter((item) => item.id === "D" || item.id === "E"))(
    "$id successful autoregulation is review evidence and progression holds",
    (scenario) => {
      expect(decide(scenario)?.nextLoad).toBe(scenario.expected.targetLoad);
      expect(reviewClassification(scenario.prior.performedLoad, scenario.prior.prescribedLoad)).toBe(
        "successful_autoregulation"
      );
    }
  );

  it("H uses the real deload load path at 70 percent", () => {
    const workout: WorkoutPlan = {
      id: "deload", scheduledDate: "2026-07-21", warmup: [], accessories: [], estimatedMinutes: 20,
      mainLifts: [{ id: "we", exercise: barbell, orderIndex: 0, isMainLift: true, sets: [{ setIndex: 1, targetReps: 8, targetRpe: 6 }] }],
    };
    const result = applyLoads(workout, {
      history: [{
        workoutId: "prior", date: "2026-07-20", completed: true, status: "COMPLETED",
        progressionEligible: true, performanceEligible: true, sessionIntent: "push",
        mesocycleSnapshot: { phase: "ACCUMULATION", week: 4 },
        exercises: [{ exerciseId: "bench", plannedWorkingSetCount: 1, sets: [{ exerciseId: "bench", setIndex: 1, reps: 8, rpe: 8, load: 100 }] }],
      }],
      baselines: [], exerciseById: { bench: barbell }, primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" }, sessionIntent: "push",
      periodization: { rpeOffset: -2, setMultiplier: 0.5, backOffMultiplier: 0.7, isDeload: true },
    });
    expect(result.mainLifts[0].sets[0].targetLoad).toBe(70);
  });

  it.each([
    { id: "I", suppliedIncrement: undefined, expected: 105 },
    { id: "J", suppliedIncrement: 10, expected: 110 },
  ])("$id propagates the verified increment through the runtime load owner", ({ suppliedIncrement, expected }) => {
    const workout: WorkoutPlan = {
      id: "next", scheduledDate: "2026-07-21", warmup: [], accessories: [], estimatedMinutes: 20,
      mainLifts: [{ id: "we", exercise: barbell, orderIndex: 0, isMainLift: true, sets: [
        { setIndex: 1, targetReps: 10, targetRpe: 8 },
        { setIndex: 2, targetReps: 10, targetRpe: 8 },
        { setIndex: 3, targetReps: 10, targetRpe: 8 },
      ] }],
    };
    const historySets = [1, 2, 3].map((setIndex) => ({
      exerciseId: "bench", setIndex, reps: 10, rpe: 6, load: 100,
      targetLoad: 100, targetReps: 10, targetRepMin: 8, targetRepMax: 10, targetRpe: 8,
    }));
    const result = applyLoads(workout, {
      history: [{ workoutId: "prior", date: "2026-07-20", completed: true, status: "COMPLETED",
        progressionEligible: true, performanceEligible: true, selectionMode: "INTENT", sessionIntent: "push",
        exercises: [{ exerciseId: "bench", plannedWorkingSetCount: 3, sets: historySets }] }],
      baselines: [], exerciseById: { bench: barbell }, primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" }, sessionIntent: "push",
      ...(suppliedIncrement ? { loadIncrementByExerciseId: { bench: suppliedIncrement } } : {}),
    });
    expect(result.mainLifts[0].sets[0].targetLoad).toBe(expected);
  });

  it.each(LOAD_PRESCRIPTION_SCENARIOS.filter((item) => item.id === "K" || item.id === "L"))(
    "$id invokes session-local coaching",
    (scenario) => {
      const recommendation = getLoadRecommendation({
        reps: scenario.prior.performedReps, rir: 10 - (scenario.prior.actualRpe as number),
        actualLoad: scenario.prior.performedLoad, targetLoad: scenario.prior.prescribedLoad,
        repRange: { min: scenario.prior.prescribedRepMin ?? scenario.prior.prescribedReps, max: scenario.prior.prescribedReps },
        targetRir: 10 - scenario.prior.prescribedRpe, loadIncrement: scenario.increment,
      });
      expect(recommendation?.suggestedLoad).toBe(scenario.expected.targetLoad);
    }
  );

  it("N holds incomplete one-of-three evidence", () => {
    const scenario = LOAD_PRESCRIPTION_SCENARIOS.find((item) => item.id === "N")!;
    expect(decide(scenario, { sets: setsFor(scenario).slice(0, 1), planned: 3 })?.nextLoad).toBe(100);
  });

  it("O progresses after two comparable successes in the latest three", () => {
    const scenario = LOAD_PRESCRIPTION_SCENARIOS.find((item) => item.id === "O")!;
    const failed = setsFor(scenario).map((set) => ({ ...set, reps: 8, rpe: 9.5 }));
    expect(decide(scenario, { history: [failed, setsFor(scenario)] })?.nextLoad).toBe(105);
  });

  it("P holds an isolated successful deviation", () => {
    const scenario = LOAD_PRESCRIPTION_SCENARIOS.find((item) => item.id === "P")!;
    expect(decide(scenario)?.nextLoad).toBe(105);
  });
});

describe("adversarial bound-exposure scenarios Q-U and Y", () => {
  const base = LOAD_PRESCRIPTION_SCENARIOS[0];

  it("Q does not borrow older target context when the latest load lacks it", () => {
    const latest = setsFor(base).map((set) => ({ reps: set.reps, rpe: set.rpe, load: 110 }));
    expect(decide({ ...base, prior: { ...base.prior, performedLoad: 110 } }, { sets: latest, history: [setsFor(base)] })?.nextLoad).toBe(110);
  });

  it("R keeps latest exposure load instead of a cross-session modal", () => {
    const older = setsFor(base).map((set) => ({ ...set, load: 90 }));
    expect(decide(base, { history: [older, older] })?.trace.exposure?.representativeLoad).toBe(100);
  });

  it("S treats one late hard outlier as divergent rather than consistently hard", () => {
    const divergent = setsFor(base).slice(0, 2).map((set, index) => ({ ...set, rpe: index === 0 ? 8 : 10 }));
    expect(decide(base, { sets: divergent, planned: 2 })?.nextLoad).toBe(100);
  });

  it("T confidence-gates an easy manual exposure", () => {
    const easy = setsFor(base).map((set) => ({ ...set, rpe: 6 }));
    expect(decide(base, { sets: easy, confidence: 0.3 })?.nextLoad).toBe(100);
  });

  it("U does not borrow an older target RPE", () => {
    const latest = setsFor(base).map((set) => ({ ...set, targetRpe: undefined }));
    expect(decide(base, { sets: latest, history: [setsFor(base)] })?.nextLoad).toBe(100);
  });

  it("Y quantizes a contextual half-step without escaping one increment", () => {
    const contextual = { ...base, current: { prescribedReps: 9, prescribedRpe: 8.5 } };
    const decision = decide(contextual);
    expect(decision?.nextLoad).toBe(105);
    expect(Math.abs((decision?.nextLoad ?? 0) - 100)).toBeLessThanOrEqual(5);
  });
});

describe("load direction scenarios W-X", () => {
  it("W reduces counterbalance assistance after an easy set", () => {
    expect(getLoadRecommendation({ reps: 10, rir: 3, actualLoad: 60, targetLoad: 60, repRange: { min: 8, max: 10 }, targetRir: 2, loadIncrement: 5, loadDirection: "assistance" })?.suggestedLoad).toBe(55);
  });

  it("X increases ordinary added load for bodyweight-plus-external work", () => {
    expect(getLoadRecommendation({ reps: 10, rir: 3, actualLoad: 25, targetLoad: 25, repRange: { min: 8, max: 10 }, targetRir: 2, loadIncrement: 2.5, loadDirection: "standard" })?.suggestedLoad).toBe(27.5);
  });
});
