import type { ProgramDashboardData } from "@/lib/api/program";
import type { HomePageData } from "@/lib/api/home-page";
import type { ProgramPageData } from "@/lib/api/program-page";
import type { WeeklyMuscleOutcomeReview } from "@/lib/api/muscle-outcome-review";
import type { HistoryPageData } from "@/lib/api/history-page";
import type { SettingsPageData } from "@/lib/api/settings-page";
import type { WorkoutListSurfaceSummary } from "@/lib/ui/workout-list-items";
import type { ExerciseListItem } from "@/lib/exercise-library/types";
import type { SectionedExercises } from "@/components/log-workout/types";

export const UI_AUDIT_FIXTURE_SCENARIOS = ["active", "empty", "handoff"] as const;

export type UiAuditFixtureScenario = (typeof UI_AUDIT_FIXTURE_SCENARIOS)[number];

type AnalyticsVolumeResponse = {
  weeklyVolume: Array<{
    weekStart: string;
    muscles: Record<string, { directSets: number; indirectSets: number; effectiveSets: number }>;
  }>;
  landmarks: Record<string, { mv: number; mev: number; mav: number; mrv: number }>;
};

type AnalyticsFixtures = {
  summary: unknown;
  volume: AnalyticsVolumeResponse;
  recovery: unknown;
  muscleOutcomes: { review: WeeklyMuscleOutcomeReview | null };
  templates: unknown;
};

type LogWorkoutFixture = {
  workoutId: string;
  sessionIdentityLabel: string;
  sessionTechnicalLabel: string;
  exercises: SectionedExercises;
};

export type UiAuditFixture = {
  scenario: UiAuditFixtureScenario;
  home?: HomePageData;
  program?: ProgramPageData;
  history?: HistoryPageData;
  settings?: SettingsPageData;
  analytics?: AnalyticsFixtures;
  logWorkouts?: Record<string, LogWorkoutFixture>;
};

const ACTIVE_MESO_ID = "ui-audit-meso-active";
const WEEK_STARTS = [
  "2026-03-16T00:00:00.000Z",
  "2026-03-23T00:00:00.000Z",
  "2026-03-30T00:00:00.000Z",
  "2026-04-06T00:00:00.000Z",
];

const activeDashboard: ProgramDashboardData = {
  activeMeso: {
    mesoNumber: 4,
    focus: "Hypertrophy base",
    durationWeeks: 6,
    completedSessions: 9,
    volumeTarget: "moderate",
    currentBlockType: "accumulation",
    blocks: [
      { blockType: "accumulation", startWeek: 1, durationWeeks: 4 },
      { blockType: "deload", startWeek: 5, durationWeeks: 1 },
      { blockType: "realization", startWeek: 6, durationWeeks: 1 },
    ],
  },
  currentWeek: 3,
  viewedWeek: 3,
  viewedBlockType: "accumulation",
  sessionsUntilDeload: 5,
  volumeThisWeek: [
    {
      muscle: "Chest",
      effectiveSets: 10,
      directSets: 8,
      indirectSets: 4,
      target: 12,
      mev: 8,
      mav: 16,
      mrv: 20,
      opportunityScore: 72,
      opportunityState: "moderate_opportunity",
      opportunityRationale: "Chest is in range with room to finish the week.",
      breakdown: {
        muscle: "Chest",
        effectiveSets: 10,
        targetSets: 12,
        contributions: [
          {
            exerciseId: "ui-audit-bench",
            exerciseName: "Barbell Bench Press",
            directSets: 4,
            indirectSets: 0,
            performedSets: 4,
            effectiveSets: 4,
          },
          {
            exerciseId: "ui-audit-incline-db",
            exerciseName: "Incline Dumbbell Press",
            directSets: 4,
            indirectSets: 0,
            performedSets: 4,
            effectiveSets: 4,
          },
        ],
      },
    },
    {
      muscle: "Lats",
      effectiveSets: 7,
      directSets: 6,
      indirectSets: 2,
      target: 10,
      mev: 8,
      mav: 14,
      mrv: 18,
      opportunityScore: 88,
      opportunityState: "high_opportunity",
      opportunityRationale: "Lats are below the target window and are a good candidate today.",
    },
    {
      muscle: "Quads",
      effectiveSets: 13,
      directSets: 10,
      indirectSets: 2,
      target: 12,
      mev: 8,
      mav: 16,
      mrv: 20,
      opportunityScore: 34,
      opportunityState: "covered",
      opportunityRationale: "Quads are already covered for the current week.",
    },
    {
      muscle: "Hamstrings",
      effectiveSets: 5,
      directSets: 4,
      indirectSets: 2,
      target: 9,
      mev: 6,
      mav: 14,
      mrv: 18,
      opportunityScore: 79,
      opportunityState: "high_opportunity",
      opportunityRationale: "Hamstrings still need meaningful exposure this week.",
    },
  ],
  deloadReadiness: {
    shouldDeload: false,
    urgency: "scheduled",
    reason: "The active accumulation block still has room before the planned lighter week.",
  },
  rirTarget: { min: 1, max: 3 },
  coachingCue: "Accumulate clean volume and keep the next slot focused.",
};

const emptyDashboard: ProgramDashboardData = {
  activeMeso: null,
  currentWeek: 1,
  viewedWeek: 1,
  viewedBlockType: null,
  sessionsUntilDeload: 0,
  volumeThisWeek: [],
  deloadReadiness: null,
  rirTarget: null,
  coachingCue: "Set up a program to start tracking weekly volume.",
};

const activeHomeProgram = {
  nextSession: {
    intent: "PULL",
    slotId: "pull-a",
    slotSequenceIndex: 1,
    slotSequenceLength: 4,
    slotSource: "mesocycle_slot_sequence",
    weekInMeso: 3,
    sessionInWeek: 2,
    workoutId: "ui-audit-workout-planned",
    isExisting: true,
  },
  activeWeek: 3,
  completedAdvancingSessionsThisWeek: 1,
  totalAdvancingSessionsThisWeek: 4,
  lastSessionSkipped: false,
  latestIncomplete: { id: "ui-audit-workout-planned", status: "planned" },
  gapFill: {
    eligible: true,
    visible: true,
    reason: "Optional gap-fill is available for remaining weekly deficits.",
    weekCloseId: "ui-audit-week-close",
    anchorWeek: 2,
    targetWeek: 2,
    targetPhase: "ACCUMULATION",
    resolution: null,
    workflowState: "PENDING_OPTIONAL_GAP_FILL",
    deficitState: "OPEN",
    remainingDeficitSets: 4,
    targetMuscles: ["Lats", "Hamstrings"],
    deficitSummary: [
      { muscle: "Lats", target: 10, actual: 7, deficit: 3 },
      { muscle: "Hamstrings", target: 9, actual: 8, deficit: 1 },
    ],
    alreadyUsedThisWeek: false,
    suppressedByStartedNextWeek: false,
    linkedWorkout: null,
    policy: {
      requiredSessionsPerWeek: 4,
      maxOptionalGapFillSessionsPerWeek: 1,
      maxGeneratedHardSets: 6,
      maxGeneratedExercises: 3,
    },
  },
  closeout: {
    visible: true,
    workoutId: "ui-audit-closeout",
    weekCloseId: "ui-audit-week-close",
    status: "PLANNED",
    targetWeek: 2,
    isIncomplete: true,
    isPriorWeek: true,
    canCreate: false,
  },
} satisfies NonNullable<HomePageData["homeProgram"]>;

const activeLogWorkout: LogWorkoutFixture = {
  workoutId: "ui-audit-workout-planned",
  sessionIdentityLabel: "Pull A",
  sessionTechnicalLabel: "Week 3 Session 2",
  exercises: {
    main: [
      {
        workoutExerciseId: "ui-audit-row-we",
        name: "Chest-Supported Row",
        equipment: ["machine"],
        movementPatterns: ["horizontal_pull"],
        muscleTags: ["Lats", "Upper Back", "Biceps"],
        muscleTagGroups: {
          primaryMuscles: ["Lats", "Upper Back"],
          secondaryMuscles: ["Biceps"],
        },
        isMainLift: false,
        section: "MAIN",
        sets: [
          {
            setId: "ui-audit-row-set-1",
            setIndex: 1,
            targetReps: 10,
            targetRepRange: { min: 8, max: 12 },
            targetLoad: 115,
            targetRpe: 8,
            restSeconds: 120,
          },
          {
            setId: "ui-audit-row-set-2",
            setIndex: 2,
            targetReps: 10,
            targetRepRange: { min: 8, max: 12 },
            targetLoad: 115,
            targetRpe: 8,
            restSeconds: 120,
          },
        ],
      },
      {
        workoutExerciseId: "ui-audit-pulldown-we",
        name: "Lat Pulldown",
        equipment: ["cable", "machine"],
        movementPatterns: ["vertical_pull"],
        muscleTags: ["Lats", "Biceps"],
        muscleTagGroups: {
          primaryMuscles: ["Lats"],
          secondaryMuscles: ["Biceps"],
        },
        isMainLift: false,
        section: "MAIN",
        sets: [
          {
            setId: "ui-audit-pulldown-set-1",
            setIndex: 1,
            targetReps: 12,
            targetRepRange: { min: 10, max: 14 },
            targetLoad: 95,
            targetRpe: 8,
            restSeconds: 90,
          },
        ],
      },
    ],
    accessory: [
      {
        workoutExerciseId: "ui-audit-curl-we",
        name: "Cable Curl",
        equipment: ["cable"],
        movementPatterns: ["elbow_flexion"],
        muscleTags: ["Biceps"],
        muscleTagGroups: {
          primaryMuscles: ["Biceps"],
          secondaryMuscles: [],
        },
        isMainLift: false,
        section: "ACCESSORY",
        sets: [
          {
            setId: "ui-audit-curl-set-1",
            setIndex: 1,
            targetReps: 12,
            targetRepRange: { min: 10, max: 15 },
            targetLoad: 35,
            targetRpe: 8,
            restSeconds: 75,
          },
        ],
      },
    ],
  },
};

const emptyHomeProgram = {
  ...activeHomeProgram,
  nextSession: {
    intent: null,
    slotId: null,
    slotSequenceIndex: null,
    slotSequenceLength: null,
    slotSource: null,
    weekInMeso: null,
    sessionInWeek: null,
    workoutId: null,
    isExisting: false,
  },
  activeWeek: null,
  completedAdvancingSessionsThisWeek: 0,
  totalAdvancingSessionsThisWeek: 0,
  latestIncomplete: null,
  gapFill: {
    ...activeHomeProgram.gapFill,
    eligible: false,
    visible: false,
    reason: "No active program is available.",
    weekCloseId: null,
    anchorWeek: null,
    targetWeek: null,
    targetPhase: null,
    workflowState: null,
    deficitState: null,
    remainingDeficitSets: 0,
    targetMuscles: [],
    deficitSummary: [],
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
} satisfies NonNullable<HomePageData["homeProgram"]>;

const historyWorkouts: WorkoutListSurfaceSummary[] = [
  buildWorkoutSummary({
    id: "ui-audit-workout-planned",
    status: "PLANNED",
    scheduledDate: "2026-04-08T09:00:00.000Z",
    intent: "PULL",
    slotId: "pull-a",
    technicalLabel: "Pull A",
    session: 2,
    exerciseCount: 5,
    totalSetsLogged: 0,
  }),
  buildWorkoutSummary({
    id: "ui-audit-workout-partial",
    status: "PARTIAL",
    scheduledDate: "2026-04-07T09:00:00.000Z",
    completedAt: "2026-04-07T10:10:00.000Z",
    intent: "PUSH",
    slotId: "push-a",
    technicalLabel: "Push A",
    session: 1,
    exerciseCount: 6,
    totalSetsLogged: 11,
  }),
  buildWorkoutSummary({
    id: "ui-audit-workout-completed",
    status: "COMPLETED",
    scheduledDate: "2026-04-04T09:00:00.000Z",
    completedAt: "2026-04-04T10:18:00.000Z",
    intent: "LEGS",
    slotId: "legs-a",
    technicalLabel: "Legs A",
    session: 4,
    exerciseCount: 6,
    totalSetsLogged: 18,
  }),
  buildWorkoutSummary({
    id: "ui-audit-workout-skipped",
    status: "SKIPPED",
    scheduledDate: "2026-04-02T09:00:00.000Z",
    intent: "PULL",
    slotId: "pull-a",
    technicalLabel: "Pull A",
    session: 2,
    exerciseCount: 5,
    totalSetsLogged: 0,
  }),
  buildWorkoutSummary({
    id: "ui-audit-workout-deload",
    status: "COMPLETED",
    scheduledDate: "2026-03-28T09:00:00.000Z",
    completedAt: "2026-03-28T09:45:00.000Z",
    intent: "FULL_BODY",
    slotId: "deload-a",
    technicalLabel: "Deload A",
    week: 2,
    session: 3,
    phase: "DELOAD",
    isDeload: true,
    exerciseCount: 4,
    totalSetsLogged: 10,
  }),
  buildWorkoutSummary({
    id: "ui-audit-workout-supplemental",
    status: "COMPLETED",
    scheduledDate: "2026-03-27T09:00:00.000Z",
    completedAt: "2026-03-27T09:50:00.000Z",
    intent: "BODY_PART",
    slotId: null,
    technicalLabel: "Supplemental deficit",
    week: 2,
    session: null,
    isSupplementalDeficitSession: true,
    gapFillTargetMuscles: ["Lats", "Hamstrings"],
    exerciseCount: 3,
    totalSetsLogged: 8,
  }),
];

const settingsExercises: ExerciseListItem[] = [
  {
    id: "ui-audit-bench",
    name: "Barbell Bench Press",
    isCompound: true,
    isMainLiftEligible: true,
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "medium",
    equipment: ["barbell", "bench", "rack"],
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Triceps", "Front Delts"],
    fatigueCost: 3,
    sfrScore: 4,
    lengthPositionScore: 3,
    difficulty: "intermediate",
    isUnilateral: false,
    isFavorite: true,
    isAvoided: false,
  },
  {
    id: "ui-audit-pulldown",
    name: "Lat Pulldown",
    isCompound: true,
    movementPatterns: ["vertical_pull"],
    splitTags: ["pull"],
    jointStress: "low",
    equipment: ["cable", "machine"],
    primaryMuscles: ["Lats"],
    secondaryMuscles: ["Biceps", "Upper Back"],
    fatigueCost: 2,
    sfrScore: 4,
    lengthPositionScore: 3,
    difficulty: "beginner",
    isUnilateral: false,
    isFavorite: false,
    isAvoided: false,
  },
  {
    id: "ui-audit-leg-extension",
    name: "Leg Extension",
    isCompound: false,
    movementPatterns: ["isolation"],
    splitTags: ["legs"],
    jointStress: "medium",
    equipment: ["machine"],
    primaryMuscles: ["Quads"],
    secondaryMuscles: [],
    fatigueCost: 1,
    sfrScore: 3,
    lengthPositionScore: 4,
    difficulty: "beginner",
    isUnilateral: false,
    isFavorite: false,
    isAvoided: true,
  },
];

const activeProgram: ProgramPageData = {
  overview: {
    mesoNumber: 4,
    focus: "Hypertrophy base",
    currentBlockType: "accumulation",
    durationWeeks: 6,
    currentWeek: 3,
    percentComplete: 50,
    blocks: activeDashboard.activeMeso?.blocks ?? [],
    rirTarget: activeDashboard.rirTarget,
    sessionsUntilDeload: activeDashboard.sessionsUntilDeload,
    deloadReadiness: activeDashboard.deloadReadiness,
    coachingCue: activeDashboard.coachingCue,
  },
  currentWeekPlan: {
    week: 3,
    slots: [
      {
        slotId: "push-a",
        label: "Push A",
        sessionInWeek: 1,
        state: "completed",
        linkedWorkoutId: "ui-audit-workout-partial",
        linkedWorkoutStatus: "partial",
        impact: {
          topMuscles: [{ muscle: "Chest", projectedEffectiveSets: 4 }],
          hiddenMuscleCount: 1,
          summaryLabel: "This session will increase Chest +1 more",
        },
      },
      {
        slotId: "pull-a",
        label: "Pull A",
        sessionInWeek: 2,
        state: "next",
        linkedWorkoutId: "ui-audit-workout-planned",
        linkedWorkoutStatus: "planned",
        impact: {
          topMuscles: [
            { muscle: "Lats", projectedEffectiveSets: 5 },
            { muscle: "Biceps", projectedEffectiveSets: 3 },
          ],
          hiddenMuscleCount: 0,
          summaryLabel: "This session will increase Lats, Biceps",
        },
      },
      {
        slotId: "legs-a",
        label: "Legs A",
        sessionInWeek: 3,
        state: "remaining",
        linkedWorkoutId: null,
        linkedWorkoutStatus: null,
        impact: {
          topMuscles: [
            { muscle: "Quads", projectedEffectiveSets: 5 },
            { muscle: "Hamstrings", projectedEffectiveSets: 4 },
          ],
          hiddenMuscleCount: 1,
          summaryLabel: "This session will increase Quads, Hamstrings +1 more",
        },
      },
      {
        slotId: "upper-b",
        label: "Upper B",
        sessionInWeek: 4,
        state: "remaining",
        linkedWorkoutId: null,
        linkedWorkoutStatus: null,
        impact: null,
      },
    ],
  },
  closeout: {
    title: "Week 2 Closeout (Optional)",
    workoutId: "ui-audit-closeout",
    status: "PLANNED",
    statusLabel: "Planned",
    detail:
      "Optional manual closeout work for Week 2. It counts toward that week's actual volume once performed, but it is not part of your current slot map.",
    actionHref: "/log/ui-audit-closeout",
    actionLabel: "Open closeout",
    dismissActionHref: "/api/workouts/ui-audit-closeout/dismiss-closeout",
    dismissActionLabel: "Skip closeout",
  },
  weekCompletionOutlook: {
    assumptionLabel: "If you complete the remaining planned sessions this week, you will likely land here.",
    summary: {
      meaningfullyLow: 1,
      slightlyLow: 1,
      onTarget: 2,
      slightlyHigh: 1,
      meaningfullyHigh: 0,
    },
    rows: [
      {
        muscle: "Lats",
        status: "meaningfully_low",
        projectedFullWeekEffectiveSets: 7,
        targetSets: 10,
        delta: -3,
      },
      {
        muscle: "Hamstrings",
        status: "slightly_low",
        projectedFullWeekEffectiveSets: 7.5,
        targetSets: 9,
        delta: -1.5,
      },
      {
        muscle: "Chest",
        status: "on_target",
        projectedFullWeekEffectiveSets: 12,
        targetSets: 12,
        delta: 0,
      },
      {
        muscle: "Quads",
        status: "slightly_high",
        projectedFullWeekEffectiveSets: 14,
        targetSets: 12,
        delta: 2,
      },
    ],
    defaultRows: [
      {
        muscle: "Lats",
        status: "meaningfully_low",
        projectedFullWeekEffectiveSets: 7,
        targetSets: 10,
        delta: -3,
      },
      {
        muscle: "Hamstrings",
        status: "slightly_low",
        projectedFullWeekEffectiveSets: 7.5,
        targetSets: 9,
        delta: -1.5,
      },
      {
        muscle: "Quads",
        status: "slightly_high",
        projectedFullWeekEffectiveSets: 14,
        targetSets: 12,
        delta: 2,
      },
    ],
  },
  volumeDetails: { dashboard: activeDashboard },
  advancedActions: { availableActions: ["deload", "extend_phase", "reset"] },
};

const emptyProgram: ProgramPageData = {
  overview: null,
  currentWeekPlan: null,
  closeout: null,
  weekCompletionOutlook: null,
  volumeDetails: { dashboard: emptyDashboard },
  advancedActions: { availableActions: [] },
};

const activeAnalyticsVolume: AnalyticsVolumeResponse = {
  weeklyVolume: WEEK_STARTS.map((weekStart, index) => ({
    weekStart,
    muscles: {
      Chest: {
        directSets: 6 + index,
        indirectSets: 2,
        effectiveSets: 7 + index * 1.2,
      },
      Lats: {
        directSets: 5 + index,
        indirectSets: 2,
        effectiveSets: 6 + index,
      },
      Quads: {
        directSets: 7 + index,
        indirectSets: 1,
        effectiveSets: 8 + index * 1.4,
      },
      Hamstrings: {
        directSets: 4 + index,
        indirectSets: 1,
        effectiveSets: 5 + index * 0.8,
      },
    },
  })),
  landmarks: {
    Chest: { mv: 4, mev: 8, mav: 16, mrv: 20 },
    Lats: { mv: 4, mev: 8, mav: 14, mrv: 18 },
    Quads: { mv: 4, mev: 8, mav: 16, mrv: 20 },
    Hamstrings: { mv: 3, mev: 6, mav: 14, mrv: 18 },
  },
};

const activeFixture: UiAuditFixture = {
  scenario: "active",
  home: {
    pendingHandoff: null,
    programData: activeDashboard,
    homeProgram: activeHomeProgram,
    decision: {
      nextSessionLabel: "Pull A",
      nextSessionDescription: "Pull session this week",
      nextSessionReasonLabel: "Up next",
      nextSessionReason: "A planned workout already exists, so you can start logging right away.",
      activeWeekLabel: "Week 3 - 1 of 4 sessions complete",
      completedAdvancingSessionsThisWeek: 1,
      totalAdvancingSessionsThisWeek: 4,
    },
    continuity: {
      summary: null,
      lastCompleted: historyWorkouts[2],
      lastCompletedDescriptor: "Legs session this week",
      nextDueLabel: "Pull A",
      nextDueDescriptor: "Pull session this week",
    },
    closeout: {
      title: "Week 2 Closeout (Optional)",
      workoutId: "ui-audit-closeout",
      status: "PLANNED",
      statusLabel: "Planned",
      detail:
        "Optional manual closeout work for Week 2. It can add actual volume to that week without becoming part of your current slot plan.",
      actionHref: "/log/ui-audit-closeout",
      actionLabel: "Open closeout",
      dismissActionHref: "/api/workouts/ui-audit-closeout/dismiss-closeout",
      dismissActionLabel: "Skip closeout",
    },
    headerContext: "Week 3 - Accumulation",
    recentActivity: historyWorkouts.slice(0, 3),
  },
  program: activeProgram,
  history: {
    initialWorkouts: historyWorkouts,
    initialNextCursor: null,
    initialTotalCount: historyWorkouts.length,
    mesocycles: [
      {
        id: ACTIVE_MESO_ID,
        startDate: "2026-03-16T00:00:00.000Z",
        isActive: true,
        mesoNumber: 4,
      },
      {
        id: "ui-audit-meso-prior",
        startDate: "2026-01-26T00:00:00.000Z",
        isActive: false,
        mesoNumber: 3,
      },
    ],
  },
  settings: {
    profileInitialValues: {
      userId: "ui-audit-owner",
      email: "owner@local",
      age: 37,
      sex: "male",
      heightIn: 70,
      weightLb: 185,
      trainingAge: "INTERMEDIATE",
      primaryGoal: "HYPERTROPHY",
      secondaryGoal: "CONDITIONING",
      daysPerWeek: 4,
      splitType: "PPL",
      weeklySchedule: ["PUSH", "PULL", "LEGS", "UPPER"],
      injuryBodyPart: "Shoulder",
      injurySeverity: 2,
      injuryDescription: "Keep pressing volume conservative.",
      injuryActive: true,
    },
    preferenceInitialValues: {
      userId: "ui-audit-owner",
      favoriteExerciseIds: ["ui-audit-bench"],
      avoidExerciseIds: ["ui-audit-leg-extension"],
    },
    exercises: settingsExercises,
  },
  analytics: {
    summary: {
      totals: {
        workoutsGenerated: 18,
        workoutsPerformed: 14,
        workoutsCompleted: 12,
        totalSets: 238,
      },
      consistency: {
        targetSessionsPerWeek: 4,
        thisWeekPerformed: 2,
        rollingFourWeekAverage: 3.5,
        currentTrainingStreakWeeks: 5,
        weeksMeetingTarget: 3,
        trackedWeeks: 6,
      },
      kpis: {
        selectionModes: [
          {
            mode: "PROGRAM",
            generated: 14,
            performed: 12,
            completed: 10,
            performedRate: 0.86,
            completionRate: 0.71,
          },
          {
            mode: "OPTIONAL_GAP_FILL",
            generated: 4,
            performed: 2,
            completed: 2,
            performedRate: 0.5,
            completionRate: 0.5,
          },
        ],
        intents: [
          {
            intent: "PUSH",
            generated: 5,
            performed: 4,
            completed: 3,
            performedRate: 0.8,
            completionRate: 0.6,
          },
          {
            intent: "PULL",
            generated: 5,
            performed: 4,
            completed: 4,
            performedRate: 0.8,
            completionRate: 0.8,
          },
          {
            intent: "LEGS",
            generated: 4,
            performed: 3,
            completed: 3,
            performedRate: 0.75,
            completionRate: 0.75,
          },
        ],
      },
    },
    volume: activeAnalyticsVolume,
    recovery: {
      muscles: [
        buildRecoveryMuscle("Chest", 92, 52),
        buildRecoveryMuscle("Triceps", 87, 50),
        buildRecoveryMuscle("Lats", 42, 18),
        buildRecoveryMuscle("Biceps", 46, 18),
        buildRecoveryMuscle("Quads", 76, 38),
        buildRecoveryMuscle("Hamstrings", 63, 31),
      ],
    },
    muscleOutcomes: {
      review: {
        mesocycleId: ACTIVE_MESO_ID,
        week: 3,
        weekStart: "2026-04-06T00:00:00.000Z",
        rows: [
          {
            muscle: "Lats",
            targetSets: 10,
            actualEffectiveSets: 7,
            delta: -3,
            percentDelta: -0.3,
            status: "meaningfully_low",
            contributingExerciseCount: 2,
            topContributors: [
              { exerciseId: "ui-audit-pulldown", exerciseName: "Lat Pulldown", effectiveSets: 4 },
            ],
          },
          {
            muscle: "Chest",
            targetSets: 12,
            actualEffectiveSets: 10,
            delta: -2,
            percentDelta: -0.167,
            status: "slightly_low",
            contributingExerciseCount: 2,
            topContributors: [
              {
                exerciseId: "ui-audit-bench",
                exerciseName: "Barbell Bench Press",
                effectiveSets: 4,
              },
            ],
          },
          {
            muscle: "Quads",
            targetSets: 12,
            actualEffectiveSets: 13,
            delta: 1,
            percentDelta: 0.083,
            status: "on_target",
            contributingExerciseCount: 2,
            topContributors: [
              {
                exerciseId: "ui-audit-leg-extension",
                exerciseName: "Leg Extension",
                effectiveSets: 3,
              },
            ],
          },
        ],
      },
    },
    templates: {
      templates: [
        {
          templateId: "ui-audit-template-ppl",
          templateName: "PPL Baseline",
          generatedWorkouts: 12,
          performedWorkouts: 10,
          completedWorkouts: 9,
          performedRate: 83,
          completionRate: 75,
          lastUsed: "2026-04-08T09:00:00.000Z",
          avgFrequencyDays: 2.8,
        },
      ],
    },
  },
  logWorkouts: {
    [activeLogWorkout.workoutId]: activeLogWorkout,
  },
};

const emptyFixture: UiAuditFixture = {
  scenario: "empty",
  home: {
    pendingHandoff: null,
    programData: emptyDashboard,
    homeProgram: emptyHomeProgram,
    decision: {
      nextSessionLabel: null,
      nextSessionDescription: null,
      nextSessionReasonLabel: "Up next",
      nextSessionReason: "No queued session is blocking it right now.",
      activeWeekLabel: null,
      completedAdvancingSessionsThisWeek: 0,
      totalAdvancingSessionsThisWeek: 0,
    },
    continuity: {
      summary: null,
      lastCompleted: null,
      lastCompletedDescriptor: null,
      nextDueLabel: null,
      nextDueDescriptor: null,
    },
    closeout: null,
    headerContext: "Generate your first session.",
    recentActivity: [],
  },
  program: emptyProgram,
};

const handoffFixture: UiAuditFixture = {
  ...activeFixture,
  scenario: "handoff",
  home: {
    pendingHandoff: {
      mesocycleId: "ui-audit-meso-handoff",
      mesoNumber: 4,
      focus: "Hypertrophy base",
      closedAt: "2026-04-10T18:00:00.000Z",
      summary: null,
      draft: null,
    },
    programData: null,
    homeProgram: null,
    decision: null,
    continuity: {
      summary: null,
      lastCompleted: historyWorkouts[2],
      lastCompletedDescriptor: "Legs session this week",
      nextDueLabel: null,
      nextDueDescriptor: null,
    },
    closeout: null,
    headerContext: "Training is paused until you accept the next cycle.",
    recentActivity: historyWorkouts.slice(1, 4),
  },
};

const fixtures: Record<UiAuditFixtureScenario, UiAuditFixture> = {
  active: activeFixture,
  empty: emptyFixture,
  handoff: handoffFixture,
};

export function getUiAuditFixtureByScenario(scenario: UiAuditFixtureScenario): UiAuditFixture {
  return fixtures[scenario];
}

export function getUiAuditVolumeFixture(
  fixture: UiAuditFixture,
  weeks: number
): AnalyticsVolumeResponse | null {
  const volume = fixture.analytics?.volume;
  if (!volume) {
    return null;
  }

  return {
    ...volume,
    weeklyVolume: volume.weeklyVolume.slice(-weeks),
  };
}

function buildWorkoutSummary(input: {
  id: string;
  status: string;
  scheduledDate: string;
  completedAt?: string | null;
  intent: string | null;
  slotId: string | null;
  technicalLabel: string | null;
  week?: number;
  session?: number | null;
  phase?: string | null;
  isDeload?: boolean;
  isSupplementalDeficitSession?: boolean;
  gapFillTargetMuscles?: string[];
  exerciseCount: number;
  totalSetsLogged: number;
}): WorkoutListSurfaceSummary {
  return {
    id: input.id,
    scheduledDate: input.scheduledDate,
    completedAt: input.completedAt ?? null,
    status: input.status,
    selectionMode: "PROGRAM",
    sessionIntent: input.intent,
    sessionIdentityLabel: input.technicalLabel ?? "Workout",
    sessionSlotId: input.slotId,
    sessionTechnicalLabel: input.technicalLabel,
    mesocycleId: ACTIVE_MESO_ID,
    mesocycleState: "ACTIVE_ACCUMULATION",
    mesocycleIsActive: true,
    sessionSnapshot: {
      week: input.week ?? 3,
      session: input.session ?? null,
      phase: input.phase ?? "ACCUMULATION",
    },
    isDeload: input.isDeload ?? false,
    isGapFill: false,
    isCloseout: false,
    isCloseoutDismissed: false,
    isSupplementalDeficitSession: input.isSupplementalDeficitSession ?? false,
    gapFillTargetMuscles: input.gapFillTargetMuscles ?? [],
    exerciseCount: input.exerciseCount,
    totalSetsLogged: input.totalSetsLogged,
  };
}

function buildRecoveryMuscle(name: string, recoveryPercent: number, lastTrainedHoursAgo: number) {
  const dates = ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10", "2026-04-11", "2026-04-12"];

  return {
    name,
    recoveryPercent,
    isRecovered: recoveryPercent >= 100,
    lastTrainedHoursAgo,
    sraWindowHours: 72,
    timeline: dates.map((date, index) => {
      const intensityBand = (index + name.length) % 4;
      return {
        date,
        effectiveSets: intensityBand * 2,
        intensityBand: intensityBand as 0 | 1 | 2 | 3,
      };
    }),
  };
}
