import { beforeEach, describe, expect, it, vi } from "vitest";

const loadCurrentBlockContextMock = vi.fn().mockResolvedValue({
  blockContext: null,
  weekInMeso: 4,
});

const mocks = vi.hoisted(() => ({
  loadWorkoutWithExplainabilityRelations: vi.fn(),
  loadExplainabilityExerciseLibrary: vi.fn(),
  workoutFindMany: vi.fn(),
  setLogAggregate: vi.fn(),
  workoutExerciseFindFirst: vi.fn(),
}));

vi.mock("@/lib/api/periodization", () => ({
  loadCurrentBlockContext: (...args: unknown[]) => loadCurrentBlockContextMock(...args),
}));

vi.mock("@/lib/api/workout-context", () => ({
  mapExercises: vi.fn().mockReturnValue([
    {
      id: "barbell-row",
      name: "Barbell Row",
      movementPatterns: ["horizontal_pull"],
      splitTags: ["pull"],
      jointStress: "medium",
      equipment: ["barbell"],
      primaryMuscles: ["Back"],
      secondaryMuscles: ["Biceps"],
      stimulusProfile: {
        back: 1,
        biceps: 0.4,
      },
      isCompound: true,
      isMainLiftEligible: true,
      repRangeMin: 8,
      repRangeMax: 10,
    },
  ]),
}));

vi.mock("@/lib/engine/explainability", () => ({
  explainSessionContext: () => ({
    blockPhase: { blockType: "accumulation", weekInBlock: 4, totalWeeksInBlock: 4, primaryGoal: "build" },
    volumeStatus: { muscleStatuses: new Map(), overallSummary: "ok" },
    readinessStatus: {
      overall: "moderate",
      signalAge: 0,
      availability: "recent",
      label: "Recent readiness",
      perMuscleFatigue: new Map(),
      sorenessSuppressedMuscles: [],
      adaptations: [],
    },
    progressionContext: {
      weekInMesocycle: 4,
      volumeProgression: "building",
      intensityProgression: "ramping",
      nextMilestone: "deload next",
    },
    cycleSource: "computed",
    narrative: "narrative",
  }),
  explainExerciseRationale: () => ({
    exerciseName: "Barbell Row",
    primaryReasons: ["reason"],
    selectionFactors: {
      deficitFill: { score: 0.5, explanation: "x" },
      rotationNovelty: { score: 0.5, explanation: "x" },
      sfrEfficiency: { score: 0.5, explanation: "x" },
      lengthenedPosition: { score: 0.5, explanation: "x" },
      sraAlignment: { score: 0.5, explanation: "x" },
      userPreference: { score: 0.5, explanation: "x" },
      movementNovelty: { score: 0.5, explanation: "x" },
    },
    citations: [],
    alternatives: [],
    volumeContribution: "3 sets",
  }),
  explainPrescriptionRationale: () => ({
    exerciseName: "Barbell Row",
    sets: { count: 3, reason: "x", blockContext: "x" },
    reps: { target: 8, reason: "x" },
    load: { load: 155, progressionType: "double", reason: "x" },
    rir: { target: 2, reason: "x" },
    rest: { seconds: 150, reason: "x", exerciseType: "moderate_compound" },
    overallNarrative: "x",
  }),
  generateCoachMessages: () => [],
}));

vi.mock("@/lib/api/explainability/query", () => ({
  loadWorkoutWithExplainabilityRelations: (...args: unknown[]) =>
    mocks.loadWorkoutWithExplainabilityRelations(...args),
  loadExplainabilityExerciseLibrary: (...args: unknown[]) =>
    mocks.loadExplainabilityExerciseLibrary(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workout: {
      findMany: (...args: unknown[]) => mocks.workoutFindMany(...args),
    },
    setLog: {
      aggregate: (...args: unknown[]) => mocks.setLogAggregate(...args),
    },
    workoutExercise: {
      findFirst: (...args: unknown[]) => mocks.workoutExerciseFindFirst(...args),
    },
    mesocycle: {
      findUnique: vi.fn(),
    },
  },
}));

import { generateWorkoutExplanation } from "@/lib/api/explainability";
import { computeDoubleProgressionDecision } from "@/lib/engine/progression";
import { buildCanonicalProgressionEvaluationInput } from "@/lib/progression/canonical-progression-input";
import { getLoadRecommendation } from "@/lib/progression/load-coaching";
import { derivePerformedExerciseSemantics } from "@/lib/session-semantics/performed-exercise-semantics";
import { buildPostWorkoutInsightsModel } from "@/lib/ui/post-workout-insights";

const CURRENT_WORKOUT_DATE = new Date("2026-02-28T00:00:00.000Z");
const PREVIOUS_WORKOUT_DATE = new Date("2026-02-21T00:00:00.000Z");

const currentPerformedSets = [
  {
    setIndex: 1,
    targetLoad: 155,
    actualLoad: 155,
    actualReps: 10,
    actualRpe: 7,
    wasSkipped: false,
  },
  {
    setIndex: 2,
    targetLoad: 145,
    actualLoad: 150,
    actualReps: 10,
    actualRpe: 7,
    wasSkipped: false,
  },
  {
    setIndex: 3,
    targetLoad: 145,
    actualLoad: 150,
    actualReps: 9,
    actualRpe: 7.5,
    wasSkipped: false,
  },
];

const currentWorkout = {
  id: "w-week4-pull-increase",
  userId: "user-1",
  scheduledDate: CURRENT_WORKOUT_DATE,
  status: "COMPLETED",
  selectionMode: "INTENT",
  sessionIntent: "PULL",
  selectionMetadata: {},
  filteredExercises: [],
  exercises: [
    {
      id: "we-1",
      orderIndex: 0,
      exerciseId: "barbell-row",
      isMainLift: true,
      section: "MAIN",
      exercise: {
        id: "barbell-row",
        name: "Barbell Row",
        jointStress: "MEDIUM",
        isMainLiftEligible: true,
        exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
        exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Back" } }],
      },
      sets: currentPerformedSets.map((set) => ({
        id: `set-${set.setIndex}`,
        setIndex: set.setIndex,
        targetReps: 8,
        targetRepMin: 8,
        targetRepMax: 10,
        targetLoad: set.targetLoad,
        targetRpe: 8,
        restSeconds: 150,
        logs: [
          {
            actualReps: set.actualReps,
            actualLoad: set.actualLoad,
            actualRpe: set.actualRpe,
            wasSkipped: set.wasSkipped,
            completedAt: CURRENT_WORKOUT_DATE,
          },
        ],
      })),
    },
  ],
};

const previousWorkoutExercise = {
  workout: {
    scheduledDate: PREVIOUS_WORKOUT_DATE,
    selectionMode: "INTENT",
    sessionIntent: "PULL",
    selectionMetadata: {},
  },
  sets: [
    {
      setIndex: 1,
      logs: [{ actualReps: 10, actualLoad: 150, actualRpe: 8, wasSkipped: false }],
    },
    {
      setIndex: 2,
      logs: [{ actualReps: 9, actualLoad: 140, actualRpe: 8, wasSkipped: false }],
    },
    {
      setIndex: 3,
      logs: [{ actualReps: 9, actualLoad: 140, actualRpe: 8, wasSkipped: false }],
    },
  ],
};

const reviewExercises = [
  {
    exerciseId: "barbell-row",
    exerciseName: "Barbell Row",
    isMainLift: true,
  },
];

function flattenGuidanceText(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value)).join("\n").toLowerCase();
}

describe("golden-path completed workout increase regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCurrentBlockContextMock.mockResolvedValue({
      blockContext: null,
      weekInMeso: 4,
    });

    mocks.loadWorkoutWithExplainabilityRelations.mockResolvedValue(currentWorkout);
    mocks.loadExplainabilityExerciseLibrary.mockResolvedValue([]);
    mocks.workoutFindMany.mockResolvedValue([]);
    mocks.setLogAggregate.mockResolvedValue({ _max: { actualLoad: null, actualReps: null } });
    mocks.workoutExerciseFindFirst.mockImplementation(async (args: any) => {
      const scheduledBefore: Date | undefined = args?.where?.workout?.scheduledDate?.lt;
      const requiredSelectionMode: string | undefined = args?.where?.workout?.selectionMode;
      if (requiredSelectionMode && requiredSelectionMode !== "INTENT") {
        return null;
      }
      if (scheduledBefore && scheduledBefore.getTime() <= PREVIOUS_WORKOUT_DATE.getTime()) {
        return null;
      }
      return previousWorkoutExercise;
    });
  });

  it("keeps the true increase story aligned across semantics, cues, canonical progression, explanation, and review surfaces", async () => {
    const performedSemantics = derivePerformedExerciseSemantics({
      isMainLiftEligible: true,
      sets: currentPerformedSets,
    });

    expect(performedSemantics).toMatchObject({
      anchorLoad: 155,
      medianReps: 10,
      modalRpe: 7,
      topSetLoad: 155,
      backoffLoad: 150,
      plannedSetStructure: "top_set_backoff",
      hasPlannedBackoffTransition: true,
    });
    expect(performedSemantics?.signalSets).toEqual([
      { reps: 10, load: 155, rpe: 7 },
      { reps: 10, load: 150, rpe: 7 },
      { reps: 9, load: 150, rpe: 7.5 },
    ]);

    const liveTopSetCue = getLoadRecommendation({
      reps: 10,
      rir: 3,
      actualLoad: 155,
      targetLoad: 155,
      repRange: { min: 8, max: 10 },
      targetRir: 2,
    });
    const liveBackoffCue = getLoadRecommendation({
      reps: 10,
      rir: 3,
      actualLoad: 155,
      targetLoad: 155,
      plannedBackoffTransition: true,
      repRange: { min: 8, max: 10 },
      targetRir: 2,
    });

    expect(liveTopSetCue).toEqual({
      action: "increase",
      message: "Set felt easier than target. Consider +2.5 lbs for next set.",
    });
    expect(liveBackoffCue).toEqual({
      action: "hold",
      message: "Top set moved well. Next set is a planned back-off, so reduce load as written.",
    });

    const canonicalInput = buildCanonicalProgressionEvaluationInput({
      lastSets: performedSemantics?.signalSets ?? [],
      repRange: [8, 10],
      equipment: "barbell",
      anchorOverride: performedSemantics?.anchorLoad ?? undefined,
      historySessions: [
        {
          selectionMode: "INTENT",
          confidence: 1,
          confidenceNotes: ["Previous INTENT history kept full progression confidence."],
        },
        {
          selectionMode: "INTENT",
          confidence: 1,
          confidenceNotes: ["Previous INTENT history kept full progression confidence."],
        },
      ],
    });
    const canonicalDecision = computeDoubleProgressionDecision(
      canonicalInput.lastSets,
      canonicalInput.repRange,
      canonicalInput.equipment,
      canonicalInput.decisionOptions
    );

    expect(canonicalInput.context.anchorOverride).toBe(155);
    expect(canonicalInput.repRange).toEqual([8, 10]);
    expect(canonicalDecision).toMatchObject({
      anchorLoad: 155,
      nextLoad: 160,
      path: "path_2",
    });

    const explanation = await generateWorkoutExplanation("w-week4-pull-increase");

    expect("error" in explanation).toBe(false);
    if ("error" in explanation || performedSemantics == null || canonicalDecision == null) {
      return;
    }

    const nextExposureDecision = explanation.nextExposureDecisions.get("barbell-row");
    const progressionReceipt = explanation.progressionReceipts.get("barbell-row");

    expect(nextExposureDecision).toMatchObject({
      action: "increase",
      summary: "Next exposure: likely increase load.",
      reason: "Median reps reached the top of the 8-10 band at manageable effort (modal RPE 7) on 155 lbs.",
      anchorLoad: 155,
      repRange: { min: 8, max: 10 },
      medianReps: 10,
      modalRpe: 7,
    });
    expect(progressionReceipt).toMatchObject({
      trigger: "double_progression",
      lastPerformed: {
        load: 150,
      },
      todayPrescription: {
        load: 155,
      },
    });

    const completionReviewModel = buildPostWorkoutInsightsModel({
      explanation,
      exercises: reviewExercises,
    });
    const workoutReviewModel = buildPostWorkoutInsightsModel({
      explanation,
      exercises: reviewExercises,
    });

    expect(completionReviewModel.headline).toBe(
      "Key lift performance likely earned a load increase next time."
    );
    expect(completionReviewModel.summary).toBe(
      "The next exposure can likely move up on Barbell Row if setup and readiness feel normal."
    );
    expect(completionReviewModel.overview).toEqual([
      {
        label: "How it went",
        value: "1 key lift likely earned more load next time.",
        tone: "positive",
      },
      {
        label: "Next time",
        value: "Increase load on Barbell Row next time.",
        tone: "positive",
        emphasized: true,
      },
    ]);
    expect(completionReviewModel.keyLifts[0]).toMatchObject({
      exerciseId: "barbell-row",
      exerciseName: "Barbell Row",
      badge: "Likely increase",
      performed: "Today's performed signal centered on 155 lbs at median 10 reps at modal RPE 7.",
      todayContext: "Today's written target moved from 150 lbs to 155 lbs (+3.3%).",
      nextTime:
        "Next exposure: likely increase load. Median reps reached the top of the 8-10 band at manageable effort (modal RPE 7) on 155 lbs.",
    });

    expect(workoutReviewModel.headline).toBe(completionReviewModel.headline);
    expect(workoutReviewModel.summary).toBe(completionReviewModel.summary);
    expect(workoutReviewModel.overview).toEqual(completionReviewModel.overview);
    expect(workoutReviewModel.keyLifts).toEqual(completionReviewModel.keyLifts);

    const nextTimeText = flattenGuidanceText([
      nextExposureDecision?.summary,
      nextExposureDecision?.reason,
      completionReviewModel.summary,
      ...completionReviewModel.overview.map((item) => item.value),
      ...completionReviewModel.keyLifts.map((item) => item.nextTime),
      workoutReviewModel.summary,
      ...workoutReviewModel.overview.map((item) => item.value),
      ...workoutReviewModel.keyLifts.map((item) => item.nextTime),
    ]);

    expect(nextTimeText).not.toContain("hold load");
    expect(nextTimeText).not.toContain("stay put");
    expect(nextTimeText).toContain("likely increase load");
    expect(nextTimeText).toContain("increase load on barbell row next time");
    expect(nextTimeText).toContain("likely move up on barbell row");
  });
});
