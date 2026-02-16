import {
  generateWorkoutFromTemplate,
  type SubstitutionSuggestion,
  type TemplateExerciseInput,
} from "@/lib/engine/template-session";
import { getPeriodizationModifiers } from "@/lib/engine/rules";
import { shouldDeload } from "@/lib/engine/progression";
import { deriveFatigueState } from "@/lib/engine/volume";
import {
  buildVolumeContext,
  buildVolumePlanByMuscle,
  type VolumePlanByMuscle,
} from "@/lib/engine/volume";
import type { WorkoutPlan, Muscle } from "@/lib/engine/types";
import type { BlockContext } from "@/lib/engine/periodization/types";
import type {
  ColdStartStage,
  SelectionOutput,
  SessionIntent,
} from "@/lib/engine/session-types";
import type { SraWarning } from "@/lib/engine/sra";
import {
  selectExercisesOptimized,
  type SelectionObjective,
  type SelectionResult,
  DEFAULT_SELECTION_WEIGHTS,
} from "@/lib/engine/selection-v2";
import {
  summarizeFilteredExercises,
  type FilteredExerciseSummary,
} from "@/lib/engine/explainability";
import { VOLUME_LANDMARKS, MUSCLE_SPLIT_MAP } from "@/lib/engine/volume-landmarks";
import { INDIRECT_SET_MULTIPLIER } from "@/lib/engine/volume-constants";
import { loadTemplateDetail, type TemplateIntent } from "./templates";
import {
  applyLoads,
  deriveWeekInBlock,
  loadWorkoutContext,
  mapCheckIn,
  mapConstraints,
  mapExercises,
  mapGoals,
  mapHistory,
  mapPreferences,
  mapProfile,
} from "./workout-context";
import { loadCurrentBlockContext } from "./periodization";
import { loadExerciseExposure } from "./exercise-exposure";

type GenerateTemplateSessionParams = {
  pinnedExerciseIds?: string[];
  autoFillUnpinned?: boolean;
};

type ColdStartBypass = "baseline_experienced";

export type GenerateIntentSessionInput = {
  intent: SessionIntent;
  targetMuscles?: string[];
  pinnedExerciseIds?: string[];
};

type SessionGenerationResult =
  | {
      workout: WorkoutPlan;
      templateId?: string;
      selectionMode: "AUTO" | "INTENT";
      sessionIntent: SessionIntent;
      sraWarnings: SraWarning[];
      substitutions: SubstitutionSuggestion[];
      volumePlanByMuscle: VolumePlanByMuscle;
      selection: SelectionOutput & {
        coldStartStage?: ColdStartStage;
        coldStartBypass?: ColdStartBypass;
        coldStartProtocolEnabled?: boolean;
        effectiveColdStartStage?: ColdStartStage;
        adaptiveDeloadApplied?: boolean;
        periodizationWeek?: number;
      };
      filteredExercises?: FilteredExerciseSummary[];
    }
  | { error: string };

type MappedGenerationContext = {
  mappedProfile: ReturnType<typeof mapProfile>;
  mappedGoals: ReturnType<typeof mapGoals>;
  mappedConstraints: ReturnType<typeof mapConstraints>;
  mappedCheckIn: ReturnType<typeof mapCheckIn>;
  mappedPreferences: ReturnType<typeof mapPreferences>;
  exerciseLibrary: ReturnType<typeof mapExercises>;
  history: ReturnType<typeof mapHistory>;
  baselines: Awaited<ReturnType<typeof loadWorkoutContext>>["baselines"];
  rawExercises: Awaited<ReturnType<typeof loadWorkoutContext>>["exercises"];
  rawWorkouts: Awaited<ReturnType<typeof loadWorkoutContext>>["workouts"];
  completedSessionCount: number;
  checkInCount: number;
  hasStableCoreBaselines: boolean;
  coldStartStage: ColdStartStage;
  coldStartBypass?: ColdStartBypass;
  weekInBlock: number;
  mesocycleLength: number;
  effectivePeriodization: ReturnType<typeof getPeriodizationModifiers>;
  adaptiveDeload: boolean;
  blockContext: BlockContext | null;
  rotationContext: Awaited<ReturnType<typeof loadExerciseExposure>>;
};

/**
 * Build SelectionObjective from mapped generation context
 *
 * Translates workout context into the format expected by selectExercisesOptimized
 */
function buildSelectionObjective(
  mapped: MappedGenerationContext,
  sessionIntent: SessionIntent,
  targetMuscles?: string[]
): SelectionObjective {
  const fatigueState = deriveFatigueState(mapped.history, mapped.mappedCheckIn);
  const volumeContext = buildVolumeContext(mapped.history, mapped.exerciseLibrary, {
    week: mapped.weekInBlock,
    length: mapped.mesocycleLength,
  });

  // Build constraints
  const painFlagExerciseIds = fatigueState.painFlags
    ? Object.keys(fatigueState.painFlags).filter((id) => (fatigueState.painFlags?.[id] ?? 0) >= 2)
    : [];

  // Build volume ceiling (MRV) for muscles in this session's split
  const volumeCeiling = new Map<Muscle, number>();
  for (const [muscle, split] of Object.entries(MUSCLE_SPLIT_MAP)) {
    if (split === sessionIntent) {
      const landmarks = VOLUME_LANDMARKS[muscle];
      if (landmarks) {
        volumeCeiling.set(muscle as Muscle, landmarks.mrv);
      }
    }
  }

  const constraints: SelectionObjective["constraints"] = {
    volumeFloor: new Map(),
    volumeCeiling,
    timeBudget: mapped.mappedConstraints.sessionMinutes,
    equipment: new Set(mapped.mappedConstraints.availableEquipment),
    // Phase 2: Separate constraint sets for explainability (ADR-063)
    painConflicts: new Set(painFlagExerciseIds),
    userAvoids: new Set(mapped.mappedPreferences?.avoidExerciseIds ?? []),
    equipmentUnavailable: new Set(), // Populated by optimizer pre-filter
    // Backward compatibility: Union of all contraindications (deprecated)
    contraindications: new Set([
      ...painFlagExerciseIds,
      ...(mapped.mappedPreferences?.avoidExerciseIds ?? []),
    ]),
    minExercises: 3, // Minimum 3 exercises to ensure MEV coverage
    maxExercises: 8,
    // Structural constraints to ensure balanced workouts
    minMainLifts: sessionIntent === "body_part" ? 0 : 1, // 1 for PPL, 0 for custom
    maxMainLifts: 3, // Prevent over-fatigue with too many heavy compounds
    minAccessories: 2, // Ensure variety and volume filling
  };

  // Build weights (use defaults)
  const weights = { ...DEFAULT_SELECTION_WEIGHTS };

  // Build volume context
  const weeklyTarget = new Map<Muscle, number>();
  const weeklyActual = new Map<Muscle, number>();
  const effectiveActual = new Map<Muscle, number>();

  // Populate volume targets and actuals from volume context
  // Determine which muscles belong to this session's split
  const sessionSplit = sessionIntent; // "push" | "pull" | "legs"

  // For enhanced volume context, extract muscle-specific data
  if ("muscleVolume" in volumeContext) {
    for (const [muscle, state] of Object.entries(volumeContext.muscleVolume)) {
      const muscleSplit = MUSCLE_SPLIT_MAP[muscle];

      // Set target for muscles in this session's split
      if (muscleSplit === sessionSplit) {
        const landmarks = VOLUME_LANDMARKS[muscle];
        if (landmarks) {
          weeklyTarget.set(muscle as Muscle, landmarks.mev);
        }
      }

      // Set actual volumes (all muscles, to account for indirect volume)
      weeklyActual.set(muscle as Muscle, state.weeklyDirectSets);

      // Effective volume = direct + (indirect × 0.3)
      const effectiveVolume =
        state.weeklyDirectSets + (state.weeklyIndirectSets * INDIRECT_SET_MULTIPLIER);
      effectiveActual.set(muscle as Muscle, effectiveVolume);
    }
  } else {
    // Fallback for basic VolumeContext (shouldn't happen with mesocycle options)
    // Set targets for muscles in this session's split
    for (const [muscle, split] of Object.entries(MUSCLE_SPLIT_MAP)) {
      if (split === sessionSplit) {
        const landmarks = VOLUME_LANDMARKS[muscle];
        if (landmarks) {
          weeklyTarget.set(muscle as Muscle, landmarks.mev);
        }
      }
    }

    // Use recent volume as actuals
    for (const [muscle, sets] of Object.entries(volumeContext.recent)) {
      weeklyActual.set(muscle as Muscle, sets);
      effectiveActual.set(muscle as Muscle, sets); // No indirect data available
    }
  }

  // Build SRA context
  // Note: SRA scoring has low weight (0.03) and defaults to 1.0 (recovered)
  // Future: Populate from actual SRA tracking for enhanced recovery-based selection
  const sraContext = new Map<Muscle, number>();

  return {
    constraints,
    weights,
    volumeContext: {
      weeklyTarget,
      weeklyActual,
      effectiveActual,
    },
    rotationContext: mapped.rotationContext,
    sraContext,
    preferences: {
      favoriteExerciseIds: new Set(mapped.mappedPreferences?.favoriteExerciseIds ?? []),
      avoidExerciseIds: new Set(mapped.mappedPreferences?.avoidExerciseIds ?? []),
    },
    blockContext: mapped.blockContext ?? undefined,
  };
}

/**
 * Map SelectionResult to SelectionOutput format
 *
 * Translates internal selection-v2 format to the stable session API format
 * used by both template and intent-based generation.
 */
function mapSelectionResult(result: SelectionResult): SelectionOutput {
  const selectedExerciseIds = result.selected.map((c) => c.exercise.id);
  const mainLiftIds = result.selected
    .filter((c) => c.exercise.isMainLiftEligible)
    .map((c) => c.exercise.id);
  const accessoryIds = result.selected
    .filter((c) => !c.exercise.isMainLiftEligible)
    .map((c) => c.exercise.id);

  // Map per-exercise set targets
  const perExerciseSetTargets: Record<string, number> = {};
  for (const candidate of result.selected) {
    perExerciseSetTargets[candidate.exercise.id] = candidate.proposedSets;
  }

  // Map rationale - convert new string format to legacy structured format
  const rationale: SelectionOutput["rationale"] = {};
  for (const [exerciseId, rationaleText] of result.rationale.perExercise) {
    const candidate = result.selected.find((c) => c.exercise.id === exerciseId);
    if (candidate) {
      rationale[exerciseId] = {
        score: candidate.totalScore,
        components: {
          deficitFill: candidate.scores.deficitFill,
          rotationNovelty: candidate.scores.rotationNovelty,
          sfrScore: candidate.scores.sfrScore,
          lengthenedScore: candidate.scores.lengthenedScore,
          movementNovelty: candidate.scores.movementNovelty,
          sraAlignment: candidate.scores.sraAlignment,
          userPreference: candidate.scores.userPreference,
        },
        hardFilterPass: true,
        selectedStep: "beam_search" as any, // Historical field for API compatibility
      };
    }
  }

  // Map volume plan by muscle to session API format
  const volumePlanByMuscle: VolumePlanByMuscle = {};
  for (const [muscle, volume] of result.volumeFilled) {
    const deficit = result.volumeDeficit.get(muscle) ?? 0;
    const target = volume + deficit;
    volumePlanByMuscle[muscle] = {
      target,
      planned: volume,
      delta: deficit,
    };
  }

  return {
    selectedExerciseIds,
    mainLiftIds,
    accessoryIds,
    perExerciseSetTargets,
    rationale,
    volumePlanByMuscle,
  };
}

export async function generateSessionFromTemplate(
  userId: string,
  templateId: string,
  params: GenerateTemplateSessionParams = {}
): Promise<SessionGenerationResult> {
  const template = await loadTemplateDetail(templateId, userId);
  let mapped: MappedGenerationContext;
  try {
    mapped = await loadMappedGenerationContext(userId);
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to load generation context" };
  }

  if (!template) {
    return { error: "Template not found" };
  }

  let templateExercises = mapTemplateExercises(template.exercises, mapped.exerciseLibrary);
  if (templateExercises.length === 0) {
    return { error: "Template has no exercises" };
  }

  const sessionIntent = resolveTemplateSessionIntent(
    template.intent,
    template.targetMuscles ?? [],
    templateExercises
  );
  const selection = buildTemplateSelection(
    mapped,
    templateExercises,
    sessionIntent,
    template.targetMuscles ?? [],
    params
  );

  if (params.autoFillUnpinned) {
    templateExercises = applyTemplateAutoFillSelection(
      templateExercises,
      mapped.exerciseLibrary,
      selection,
      params.pinnedExerciseIds ?? []
    );
  }

  const result = runSessionGeneration(mapped, templateExercises, {
    sessionIntent,
    templateId: template.id,
    selectionMode: "AUTO",
    isStrict: template.isStrict,
    setCountOverrides: undefined,
    selection,
    coldStartProtocolEnabled: undefined,
    effectiveColdStartStage: undefined,
  });
  if ("error" in result) {
    return result;
  }

  return finalizePostLoadResult(result, mapped);
}

export async function generateSessionFromIntent(
  userId: string,
  input: GenerateIntentSessionInput
): Promise<SessionGenerationResult> {
  if (input.intent === "body_part" && (!input.targetMuscles || input.targetMuscles.length === 0)) {
    return { error: "targetMuscles is required when intent is body_part" };
  }

  let mapped: MappedGenerationContext;
  try {
    mapped = await loadMappedGenerationContext(userId);
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to load generation context" };
  }
  const coldStartProtocolEnabled = isIntentColdStartProtocolEnabled();
  const effectiveColdStartStage: ColdStartStage = coldStartProtocolEnabled ? mapped.coldStartStage : 2;

  // Build selection objective
  const objective = buildSelectionObjective(mapped, input.intent, input.targetMuscles);

  // Filter exercise pool by session intent (split tag)
  // This prevents exercises from wrong splits (e.g., legs exercises in push workouts)
  // Only filter for PPL splits; full_body and body_part get all exercises
  const validSplitTags = ["push", "pull", "legs"] as const;
  const filteredPool =
    validSplitTags.includes(input.intent as any)
      ? mapped.exerciseLibrary.filter((ex) => ex.splitTags.includes(input.intent as any))
      : mapped.exerciseLibrary; // full_body and body_part: no filtering

  // Run new beam search optimizer
  const selectionResult = selectExercisesOptimized(filteredPool, objective);

  // Phase 2: Extract filtered exercises for explainability
  const filteredExercises = summarizeFilteredExercises(selectionResult.rejected);

  // Map to session output format
  const selection = mapSelectionResult(selectionResult);

  const templateExercises: TemplateExerciseInput[] = selection.selectedExerciseIds.flatMap(
    (exerciseId, index) => {
      const exercise = mapped.exerciseLibrary.find((entry) => entry.id === exerciseId);
      if (!exercise) {
        return [];
      }
      return [
        {
          exercise,
          orderIndex: index,
        },
      ];
    }
  );

  if (templateExercises.length === 0) {
    return { error: "No compatible exercises found for the requested intent" };
  }

  const result = runSessionGeneration(mapped, templateExercises, {
    sessionIntent: input.intent,
    selectionMode: "INTENT",
    setCountOverrides: selection.perExerciseSetTargets,
    selection,
    isStrict: false,
    coldStartProtocolEnabled,
    effectiveColdStartStage,
  });
  if ("error" in result) {
    return result;
  }

  return finalizePostLoadResult(result, mapped, filteredExercises);
}

function buildTemplateSelection(
  mapped: MappedGenerationContext,
  templateExercises: TemplateExerciseInput[],
  sessionIntent: SessionIntent,
  targetMuscles: string[],
  params: GenerateTemplateSessionParams
): SelectionOutput {
  const templateExerciseIds = templateExercises.map((entry) => entry.exercise.id);
  if (!params.autoFillUnpinned) {
    return {
      selectedExerciseIds: templateExerciseIds,
      mainLiftIds: [],
      accessoryIds: [],
      perExerciseSetTargets: {},
      rationale: {},
      volumePlanByMuscle: {},
    };
  }

  // Build selection objective for template auto-fill
  const objective = buildSelectionObjective(
    mapped,
    sessionIntent,
    sessionIntent === "body_part" ? targetMuscles : undefined
  );

  // Filter exercise pool to include pinned exercises + eligible candidates
  const pinnedSet = new Set(params.pinnedExerciseIds ?? []);
  const pool = mapped.exerciseLibrary.filter((ex) => {
    // Always include pinned exercises
    if (pinnedSet.has(ex.id)) return true;
    // Exclude template exercises that aren't pinned (we're auto-filling their slots)
    if (templateExerciseIds.includes(ex.id) && !pinnedSet.has(ex.id)) return false;
    return true;
  });

  // Run new beam search optimizer
  const selectionResult = selectExercisesOptimized(pool, objective);

  // Map to session output format
  return mapSelectionResult(selectionResult);
}

function applyTemplateAutoFillSelection(
  templateExercises: TemplateExerciseInput[],
  exerciseLibrary: ReturnType<typeof mapExercises>,
  selection: SelectionOutput,
  pinnedExerciseIds: string[]
): TemplateExerciseInput[] {
  const orderedTemplate = [...templateExercises].sort((a, b) => a.orderIndex - b.orderIndex);
  const targetSlotCount = orderedTemplate.length;
  const selectedIds = selection.selectedExerciseIds.slice(0, targetSlotCount);
  if (selectedIds.length === 0) {
    return orderedTemplate;
  }

  const pinnedSet = new Set(pinnedExerciseIds);
  const usedIds = new Set<string>();
  const orderedSelectedIds = new Array<string | undefined>(targetSlotCount);

  for (const [index, templateEntry] of orderedTemplate.entries()) {
    const templateExerciseId = templateEntry.exercise.id;
    if (pinnedSet.has(templateExerciseId) && selectedIds.includes(templateExerciseId) && !usedIds.has(templateExerciseId)) {
      orderedSelectedIds[index] = templateExerciseId;
      usedIds.add(templateExerciseId);
    }
  }

  const nonPinnedSelectedIds = selectedIds.filter((exerciseId) => !usedIds.has(exerciseId));
  let fillIndex = 0;
  for (let index = 0; index < orderedSelectedIds.length; index += 1) {
    if (orderedSelectedIds[index]) {
      continue;
    }
    const fillId = nonPinnedSelectedIds[fillIndex];
    if (fillId) {
      orderedSelectedIds[index] = fillId;
      usedIds.add(fillId);
      fillIndex += 1;
      continue;
    }
    orderedSelectedIds[index] = orderedTemplate[index].exercise.id;
  }

  const exerciseById = new Map(exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  return orderedTemplate.map((templateEntry, index) => {
    const selectedId = orderedSelectedIds[index] ?? templateEntry.exercise.id;
    const selectedExercise = exerciseById.get(selectedId);
    if (!selectedExercise) {
      return templateEntry;
    }
    const preserveSuperset = selectedId === templateEntry.exercise.id;
    return {
      exercise: selectedExercise,
      orderIndex: templateEntry.orderIndex,
      supersetGroup: preserveSuperset ? templateEntry.supersetGroup : undefined,
    };
  });
}

function runSessionGeneration(
  mapped: MappedGenerationContext,
  templateExercises: TemplateExerciseInput[],
  options: {
    sessionIntent: SessionIntent;
    selectionMode: "AUTO" | "INTENT";
    templateId?: string;
    isStrict: boolean;
    setCountOverrides?: Record<string, number>;
    selection: SelectionOutput;
    coldStartProtocolEnabled?: boolean;
    effectiveColdStartStage?: ColdStartStage;
  }
):
  | {
      workout: WorkoutPlan;
      templateId?: string;
      selectionMode: "AUTO" | "INTENT";
      sessionIntent: SessionIntent;
      sraWarnings: SraWarning[];
      substitutions: SubstitutionSuggestion[];
      selection: SelectionOutput & {
        coldStartStage?: ColdStartStage;
        coldStartBypass?: ColdStartBypass;
        coldStartProtocolEnabled?: boolean;
        effectiveColdStartStage?: ColdStartStage;
        adaptiveDeloadApplied?: boolean;
        periodizationWeek?: number;
      };
    }
  | { error: string } {
  const { workout, sraWarnings, substitutions } = generateWorkoutFromTemplate(templateExercises, {
    profile: mapped.mappedProfile,
    goals: mapped.mappedGoals,
    history: mapped.history,
    exerciseLibrary: mapped.exerciseLibrary,
    sessionMinutes: mapped.mappedConstraints.sessionMinutes,
    preferences: mapped.mappedPreferences,
    checkIn: mapped.mappedCheckIn,
    weekInBlock: mapped.weekInBlock,
    mesocycleLength: mapped.mesocycleLength,
    periodization: mapped.effectivePeriodization,
    blockContext: mapped.blockContext,
    isStrict: options.isStrict,
    setCountOverrides: options.setCountOverrides,
  });

  return {
    workout,
    templateId: options.templateId,
    selectionMode: options.selectionMode,
    sessionIntent: options.sessionIntent,
    sraWarnings,
    substitutions,
    selection:
      options.selectionMode === "INTENT"
        ? {
            ...options.selection,
            coldStartStage: mapped.coldStartStage,
            coldStartBypass: mapped.coldStartBypass,
            coldStartProtocolEnabled: options.coldStartProtocolEnabled,
            effectiveColdStartStage: options.effectiveColdStartStage,
          }
        : options.selection,
  };
}

function finalizePostLoadResult(
  result: {
    workout: WorkoutPlan;
    templateId?: string;
    selectionMode: "AUTO" | "INTENT";
    sessionIntent: SessionIntent;
    sraWarnings: SraWarning[];
    substitutions: SubstitutionSuggestion[];
    selection: SelectionOutput & {
      coldStartStage?: ColdStartStage;
      coldStartBypass?: ColdStartBypass;
      coldStartProtocolEnabled?: boolean;
      effectiveColdStartStage?: ColdStartStage;
      adaptiveDeloadApplied?: boolean;
      periodizationWeek?: number;
    };
  },
  mapped: MappedGenerationContext,
  filteredExercises?: FilteredExerciseSummary[]
): SessionGenerationResult {
  const withLoads = applyLoads(
    result.workout,
    mapped.baselines,
    mapped.rawExercises,
    mapped.history,
    mapped.mappedProfile,
    mapped.mappedGoals.primary,
    mapped.mappedConstraints.sessionMinutes,
    mapped.effectivePeriodization,
    mapped.weekInBlock
  );
  const postLoadVolumeContext = buildVolumeContext(mapped.history, mapped.exerciseLibrary, {
    week: mapped.weekInBlock,
    length: mapped.mesocycleLength,
  });
  const volumePlanByMuscle = buildVolumePlanByMuscle(
    withLoads.mainLifts,
    withLoads.accessories,
    postLoadVolumeContext,
    { mesocycleWeek: mapped.weekInBlock, mesocycleLength: mapped.mesocycleLength }
  );

  const finalWorkout = mapped.adaptiveDeload
    ? {
        ...withLoads,
        notes: withLoads.notes
          ? `${withLoads.notes}. Adjusted to recovery session based on recent fatigue signals.`
          : "Adjusted to recovery session based on recent fatigue signals.",
      }
    : withLoads;

  return {
    workout: finalWorkout,
    templateId: result.templateId,
    selectionMode: result.selectionMode,
    sessionIntent: result.sessionIntent,
    sraWarnings: result.sraWarnings,
    substitutions: result.substitutions,
    volumePlanByMuscle,
    selection: {
      ...result.selection,
      volumePlanByMuscle,
      adaptiveDeloadApplied: mapped.adaptiveDeload,
      periodizationWeek: mapped.weekInBlock,
    },
    filteredExercises,
  };
}

async function loadMappedGenerationContext(userId: string): Promise<MappedGenerationContext> {
  const context = await loadWorkoutContext(userId);
  const {
    profile,
    goals,
    constraints,
    injuries,
    baselines,
    exercises,
    workouts,
    preferences,
    checkIns,
    checkInCount,
  } =
    context;

  if (!goals || !constraints || !profile) {
    throw new Error("Profile, goals, or constraints missing");
  }

  const mappedProfile = mapProfile(userId, profile, injuries);
  const mappedGoals = mapGoals(goals.primaryGoal, goals.secondaryGoal);
  const mappedConstraints = mapConstraints(constraints);
  const exerciseLibrary = mapExercises(exercises);
  const history = mapHistory(workouts);
  const mappedPreferences = mapPreferences(preferences);
  const mappedCheckIn = mapCheckIn(checkIns);
  const completedSessionCount = workouts.filter((entry) => entry.status === "COMPLETED").length;
  const hasStableCoreBaselines = resolveHasStableCoreBaselines(baselines, exercises, workouts);
  const hasExperiencedBaselineBypass = resolveHasExperiencedBaselineBypass(
    mappedProfile.trainingAge,
    baselines,
    exercises
  );
  const coldStartStage = resolveColdStartStage({
    completedSessionCount,
    checkInCount,
    hasStableCoreBaselines,
    hasExperiencedBaselineBypass,
  });
  const coldStartBypass =
    coldStartStage === 1 && (completedSessionCount < 4 || checkInCount < 2) && hasExperiencedBaselineBypass
      ? "baseline_experienced"
      : undefined;
  const mainLiftExerciseIds = new Set(
    exerciseLibrary.filter((exercise) => exercise.isMainLiftEligible).map((exercise) => exercise.id)
  );
  const activeProgramBlock = workouts.find((entry) => entry.programBlockId)?.programBlock ?? null;
  const weekInBlock = deriveWeekInBlock(new Date(), activeProgramBlock, workouts);
  const mesocycleLength = Math.max(1, activeProgramBlock?.weeks ?? 4);
  const periodization = getPeriodizationModifiers(
    weekInBlock,
    mappedGoals.primary,
    mappedProfile.trainingAge
  );
  const adaptiveDeload = !periodization.isDeload && shouldDeload(history, mainLiftExerciseIds);
  const effectivePeriodization = adaptiveDeload
    ? {
        ...periodization,
        isDeload: true,
        setMultiplier: 0.5,
        rpeOffset: -2.0,
        backOffMultiplier: 0.75,
      }
    : periodization;

  // Load block context for periodization
  const blockContext = await loadCurrentBlockContext(userId);

  // Load exercise exposure for rotation tracking
  const rotationContext = await loadExerciseExposure(userId);

  return {
    mappedProfile,
    mappedGoals,
    mappedConstraints,
    mappedCheckIn,
    mappedPreferences,
    exerciseLibrary,
    history,
    baselines,
    rawExercises: exercises,
    rawWorkouts: workouts,
    completedSessionCount,
    checkInCount,
    hasStableCoreBaselines,
    coldStartStage,
    coldStartBypass,
    weekInBlock,
    mesocycleLength,
    effectivePeriodization,
    adaptiveDeload,
    blockContext,
    rotationContext,
  };
}

function isIntentColdStartProtocolEnabled(): boolean {
  const raw = process.env.USE_INTENT_COLD_START_PROTOCOL;
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function resolveColdStartStage(input: {
  completedSessionCount: number;
  checkInCount: number;
  hasStableCoreBaselines: boolean;
  hasExperiencedBaselineBypass: boolean;
}): ColdStartStage {
  if (input.completedSessionCount < 4 || input.checkInCount < 2) {
    if (input.hasExperiencedBaselineBypass) {
      return 1;
    }
    return 0;
  }
  if (input.completedSessionCount < 12 || !input.hasStableCoreBaselines) {
    return 1;
  }
  return 2;
}

function resolveHasExperiencedBaselineBypass(
  trainingAge: MappedGenerationContext["mappedProfile"]["trainingAge"],
  baselines: MappedGenerationContext["baselines"],
  exercises: MappedGenerationContext["rawExercises"]
): boolean {
  if (trainingAge !== "intermediate" && trainingAge !== "advanced") {
    return false;
  }

  const mainLiftExerciseIds = new Set(
    exercises.filter((exercise) => exercise.isMainLiftEligible).map((exercise) => exercise.id)
  );
  const qualifiedBaselineExerciseIds = new Set<string>();

  for (const baseline of baselines) {
    if (!mainLiftExerciseIds.has(baseline.exerciseId)) {
      continue;
    }
    const hasRealBaselineWeight =
      baseline.workingWeightMin !== null || baseline.topSetWeight !== null;
    if (!hasRealBaselineWeight) {
      continue;
    }
    qualifiedBaselineExerciseIds.add(baseline.exerciseId);
  }

  return qualifiedBaselineExerciseIds.size >= 3;
}

function resolveHasStableCoreBaselines(
  baselines: MappedGenerationContext["baselines"],
  exercises: MappedGenerationContext["rawExercises"],
  workouts: MappedGenerationContext["rawWorkouts"]
): boolean {
  const mainLiftExerciseIds = new Set(
    exercises.filter((exercise) => exercise.isMainLiftEligible).map((exercise) => exercise.id)
  );
  const completedWorkoutIdsByExercise = new Map<string, Set<string>>();

  for (const workout of workouts) {
    if (workout.status !== "COMPLETED") {
      continue;
    }
    for (const exercise of workout.exercises) {
      if (!mainLiftExerciseIds.has(exercise.exerciseId)) {
        continue;
      }
      const hasQualifiedLog = exercise.sets.some((set) => {
        const log = set.logs[0];
        return (
          typeof log?.actualLoad === "number" &&
          Number.isFinite(log.actualLoad) &&
          typeof log?.actualReps === "number" &&
          Number.isFinite(log.actualReps)
        );
      });
      if (!hasQualifiedLog) {
        continue;
      }
      const completedIds = completedWorkoutIdsByExercise.get(exercise.exerciseId) ?? new Set<string>();
      completedIds.add(workout.id);
      completedWorkoutIdsByExercise.set(exercise.exerciseId, completedIds);
    }
  }

  const stableExerciseIds = new Set<string>();
  for (const baseline of baselines) {
    if (!mainLiftExerciseIds.has(baseline.exerciseId)) {
      continue;
    }
    const completedCount = completedWorkoutIdsByExercise.get(baseline.exerciseId)?.size ?? 0;
    if (completedCount >= 2) {
      stableExerciseIds.add(baseline.exerciseId);
    }
  }

  return stableExerciseIds.size >= 3;
}

function mapTemplateExercises(
  templateExercises: { exerciseId: string; orderIndex: number; supersetGroup?: number | null }[],
  exerciseLibrary: ReturnType<typeof mapExercises>
): TemplateExerciseInput[] {
  const exerciseById = new Map(exerciseLibrary.map((exercise) => [exercise.id, exercise]));
  return templateExercises.flatMap((entry) => {
      const exercise = exerciseById.get(entry.exerciseId);
      if (!exercise) {
        return [];
      }
      return [
        {
          exercise,
          orderIndex: entry.orderIndex,
          supersetGroup: entry.supersetGroup ?? undefined,
        },
      ];
    })
    .sort((a, b) => a.orderIndex - b.orderIndex);
}

function resolveTemplateSessionIntent(
  templateIntent: TemplateIntent,
  targetMuscles: string[],
  templateExercises: TemplateExerciseInput[]
): SessionIntent {
  if (templateIntent === "FULL_BODY") {
    return "full_body";
  }
  if (templateIntent === "BODY_PART") {
    return "body_part";
  }
  if (templateIntent === "PUSH_PULL_LEGS" || templateIntent === "CUSTOM") {
    return inferIntentFromExerciseTags(templateExercises);
  }
  if (templateIntent === "UPPER_LOWER") {
    const lowerMarkers = ["quads", "hamstrings", "glutes", "calves", "adductors", "abductors"];
    const hasLowerTarget = targetMuscles.some((muscle) =>
      lowerMarkers.includes(muscle.trim().toLowerCase())
    );
    return hasLowerTarget ? "lower" : "upper";
  }
  return "full_body";
}

function inferIntentFromExerciseTags(templateExercises: TemplateExerciseInput[]): SessionIntent {
  const counts: Record<"push" | "pull" | "legs", number> = { push: 0, pull: 0, legs: 0 };
  for (const entry of templateExercises) {
    for (const tag of entry.exercise.splitTags ?? []) {
      if (tag === "push" || tag === "pull" || tag === "legs") {
        counts[tag] += 1;
      }
    }
  }
  const ranked = (Object.keys(counts) as Array<keyof typeof counts>).sort(
    (a, b) => counts[b] - counts[a]
  );
  return counts[ranked[0]] > 0 ? ranked[0] : "full_body";
}
