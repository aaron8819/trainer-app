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
  workoutExerciseFindMany: vi.fn(),
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
      findMany: (...args: unknown[]) => mocks.workoutExerciseFindMany(...args),
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

const CURRENT_WORKOUT_DATE = new Date("2026-02-21T00:00:00.000Z");
const PREVIOUS_WORKOUT_DATE = new Date("2026-02-14T00:00:00.000Z");

const currentPerformedSets = [
  {
    setIndex: 1,
    targetLoad: 155,
    actualLoad: 160,
    actualReps: 9,
    actualRpe: 8,
    wasSkipped: false,
  },
  {
    setIndex: 2,
    targetLoad: 145,
    actualLoad: 150,
    actualReps: 8,
    actualRpe: 8,
    wasSkipped: false,
  },
  {
    setIndex: 3,
    targetLoad: 145,
    actualLoad: 150,
    actualReps: 8,
    actualRpe: 8,
    wasSkipped: false,
  },
];

const currentWorkout = {
  id: "w-week4-pull",
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
      logs: [{ actualReps: 10, actualLoad: 140, actualRpe: 8, wasSkipped: false }],
    },
    {
      setIndex: 3,
      logs: [{ actualReps: 9, actualLoad: 140, actualRpe: 8, wasSkipped: false }],
    },
  ],
};

const completionReviewExercises = [
  {
    exerciseId: "barbell-row",
    exerciseName: "Barbell Row",
    isMainLift: true,
  },
];

const workoutReviewExercises = currentWorkout.exercises.map((exercise) => ({
  exerciseId: exercise.exerciseId,
  exerciseName: exercise.exercise.name,
  isMainLift: exercise.isMainLift || exercise.section === "MAIN",
}));

function flattenGuidanceText(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value)).join("\n").toLowerCase();
}

type WorkoutExerciseFindFirstArgs = {
  where?: { workout?: { scheduledDate?: { lt?: Date }; selectionMode?: string } };
};

describe("golden-path completed workout regression", () => {
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
    mocks.workoutExerciseFindMany.mockResolvedValue([]);
    mocks.workoutExerciseFindFirst.mockImplementation(async (args: WorkoutExerciseFindFirstArgs) => {
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

  it("keeps the completed-workout story aligned across semantics, canonical progression, explanation, and review surfaces", async () => {
    const performedSemantics = derivePerformedExerciseSemantics({
      isMainLiftEligible: true,
      sets: currentPerformedSets,
    });

    expect(performedSemantics).toMatchObject({
      anchorLoad: 160,
      medianReps: 8,
      modalRpe: 8,
      topSetLoad: 160,
      backoffLoad: 150,
      plannedSetStructure: "top_set_backoff",
      hasPlannedBackoffTransition: true,
    });
    expect(performedSemantics?.signalSets).toEqual([
      { reps: 9, load: 160, rpe: 8, targetLoad: 155 },
      { reps: 8, load: 150, rpe: 8, targetLoad: 145 },
      { reps: 8, load: 150, rpe: 8, targetLoad: 145 },
    ]);

    const liveTopSetCue = getLoadRecommendation({
      reps: 9,
      rir: 2,
      actualLoad: 160,
      targetLoad: 155,
      repRange: { min: 8, max: 10 },
      targetRir: 2,
    });
    const liveBackoffCue = getLoadRecommendation({
      reps: 9,
      rir: 2,
      actualLoad: 160,
      targetLoad: 155,
      plannedBackoffTransition: true,
      repRange: { min: 8, max: 10 },
      targetRir: 2,
    });

    expect(liveTopSetCue).toEqual({
      action: "hold",
      message:
        "You're above the prescribed load. Keep it if technique stays stable; formal progression is evaluated across the full session.",
    });
    expect(liveBackoffCue).toEqual({
      action: "hold",
      message: "Next set is a planned back-off. Reduce load as written and keep technique stable.",
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
    const canonicalAction =
      canonicalDecision == null
        ? null
        : canonicalDecision.nextLoad > canonicalDecision.anchorLoad
        ? "increase"
        : canonicalDecision.nextLoad < canonicalDecision.anchorLoad
        ? "decrease"
        : "hold";

    expect(canonicalInput.context.anchorOverride).toBe(160);
    expect(canonicalInput.repRange).toEqual([8, 10]);
    expect(canonicalDecision).toMatchObject({
      anchorLoad: 160,
      nextLoad: 165,
      path: "path_5_overshoot",
    });
    expect(canonicalAction).toBe("increase");

    const explanation = await generateWorkoutExplanation("w-week4-pull");

    expect("error" in explanation).toBe(false);
    if ("error" in explanation || performedSemantics == null || canonicalDecision == null) {
      return;
    }

    const nextExposureDecision = explanation.nextExposureDecisions.get("barbell-row");
    const progressionReceipt = explanation.progressionReceipts.get("barbell-row");

    expect(nextExposureDecision).toMatchObject({
      action: canonicalAction,
      summary: "Next exposure: increase load.",
      reason: "You beat the written load at manageable effort, so 160 lbs should not stay capped next time.",
      anchorLoad: canonicalDecision.anchorLoad,
      repRange: { min: 8, max: 10 },
      medianReps: performedSemantics.medianReps,
      modalRpe: performedSemantics.modalRpe,
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
      exercises: completionReviewExercises,
    });
    const workoutReviewModel = buildPostWorkoutInsightsModel({
      explanation,
      exercises: workoutReviewExercises,
    });

    expect(completionReviewModel.headline).toBe(
      "Key lifts point to an increase next time."
    );
    expect(completionReviewModel.summary).toBe(
      "The next exposure points to an increase on Barbell Row if setup and readiness feel normal."
    );
    expect(completionReviewModel.overview).toEqual([
      {
        label: "How it went",
        value: "1 key lift points to an increase next time.",
        tone: "positive",
      },
      {
        label: "Next time",
        value: "Increase load on Barbell Row.",
        tone: "positive",
        emphasized: true,
      },
    ]);
    expect(completionReviewModel.keyLifts[0]).toMatchObject({
      exerciseId: "barbell-row",
      exerciseName: "Barbell Row",
      badge: "Increase next time",
      performed: "Today's performed signal centered on 160 lbs at median 8 reps at modal RPE 8.",
      todayContext: "Today's written target moved from 150 lbs to 155 lbs (+3.3%).",
      nextTime:
        "Next exposure: increase load. You beat the written load at manageable effort, so 160 lbs should not stay capped next time.",
    });

    expect(workoutReviewModel.headline).toBe(completionReviewModel.headline);
    expect(workoutReviewModel.summary).toBe(completionReviewModel.summary);
    expect(workoutReviewModel.overview).toEqual(completionReviewModel.overview);
    expect(workoutReviewModel.keyLifts).toEqual(completionReviewModel.keyLifts);

    const guidanceText = flattenGuidanceText([
      liveTopSetCue?.message,
      liveBackoffCue?.message,
      nextExposureDecision?.summary,
      nextExposureDecision?.reason,
      completionReviewModel.headline,
      completionReviewModel.summary,
      ...completionReviewModel.overview.map((item) => item.value),
      ...completionReviewModel.keyLifts.flatMap((item) => [item.badge, item.nextTime]),
      workoutReviewModel.headline,
      workoutReviewModel.summary,
      ...workoutReviewModel.overview.map((item) => item.value),
      ...workoutReviewModel.keyLifts.flatMap((item) => [item.badge, item.nextTime]),
    ]);

    expect(guidanceText).not.toContain("hold load");
    expect(guidanceText).not.toContain("keep building reps before adding load");
    expect(guidanceText).toContain("increase load");
    expect(guidanceText).toContain("increase load on barbell row");
    expect(guidanceText).toContain("points to an increase on barbell row");
  });
});
