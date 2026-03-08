import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import {
  interpolateWeeklyVolumeTarget,
  type WeeklyVolumeTargetBlock,
} from "@/lib/engine/volume-targets";
import {
  buildBlockPrescriptionIntent,
  type BlockPrescriptionProfileContext,
} from "@/lib/engine/periodization/block-prescription-intent";
import type { BlockType } from "@/lib/engine/periodization/types";
import { getBackOffMultiplier, type PeriodizationModifiers } from "@/lib/engine/rules";
import type { PrimaryGoal } from "@/lib/engine/types";

type MuscleLandmark = {
  mev: number;
  mavUpper: number;
  mrv: number;
};

export type RirTarget = { min: number; max: number };
export type LifecycleSetTargets = { main: number; accessory: number };
export type PhaseBlockProfileContext = BlockPrescriptionProfileContext;
type HypertrophyWeekProfile = {
  rirTarget: RirTarget;
  setTargets: LifecycleSetTargets;
  setMultiplier: number;
  volumeFraction: number;
};

type WeekDerivationInput = {
  state: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "COMPLETED";
  accumulationSessionsCompleted: number;
  sessionsPerWeek: number;
  durationWeeks: number;
};

type SessionDerivationInput = {
  state: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "COMPLETED";
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  sessionsPerWeek: number;
  durationWeeks: number;
};

type WeeklyVolumeTargetBlockInput = {
  blockType: string;
  durationWeeks: number;
  intensityBias: string;
  startWeek: number;
  volumeTarget: string;
};

type VolumeTargetInput = {
  durationWeeks: number;
  blocks?: readonly WeeklyVolumeTargetBlockInput[];
};

type RirTargetInput = {
  state: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "COMPLETED";
  durationWeeks: number;
};

type LifecyclePeriodizationInput = {
  primaryGoal: PrimaryGoal;
  durationWeeks: number;
  week: number;
  isDeload?: boolean;
  rirTarget?: RirTarget;
  phaseBlockContext?: PhaseBlockProfileContext;
};

export type CanonicalMesocycleSession = {
  week: number;
  session: number;
  phase: "ACCUMULATION" | "DELOAD";
};

export type NextAdvancingSession = CanonicalMesocycleSession & {
  intent: string | null;
  scheduleIndex: number | null;
};

const DEFAULT_DELOAD_RIR: RirTarget = { min: 5, max: 6 };
const DEFAULT_DELOAD_SET_TARGETS: LifecycleSetTargets = { main: 2, accessory: 1 };

// Explicit mapping from normalized snake_case keys to VOLUME_LANDMARKS Title Case keys.
// Must be exhaustive for all muscles in VOLUME_LANDMARKS.
const SNAKE_TO_TITLE_MUSCLE_KEY: Record<string, string> = {
  chest: "Chest",
  lats: "Lats",
  upper_back: "Upper Back",
  front_delts: "Front Delts",
  side_delts: "Side Delts",
  rear_delts: "Rear Delts",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  biceps: "Biceps",
  triceps: "Triceps",
  calves: "Calves",
  core: "Core",
  lower_back: "Lower Back",
  forearms: "Forearms",
  adductors: "Adductors",
  abductors: "Abductors",
  abs: "Abs",
};

const DEFAULT_FALLBACK_LANDMARK: MuscleLandmark = {
  mev: 0,
  mavUpper: 10,
  mrv: 15,
};

function normalizeMuscleGroup(muscleGroup: string): string {
  const normalized = muscleGroup.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "rear_deltoids") return "rear_delts";
  if (normalized === "front_deltoids") return "front_delts";
  if (normalized === "side_deltoids") return "side_delts";
  return normalized;
}

function resolveLandmark(muscleGroup: string): MuscleLandmark {
  const snakeKey = normalizeMuscleGroup(muscleGroup);
  const titleKey = SNAKE_TO_TITLE_MUSCLE_KEY[snakeKey];
  const lm = titleKey ? VOLUME_LANDMARKS[titleKey] : undefined;
  if (!lm) {
    console.warn(
      `[mesocycle-lifecycle] Unsupported muscle group for lifecycle volume target: ${muscleGroup}. ` +
        `Using fallback landmark (MEV=${DEFAULT_FALLBACK_LANDMARK.mev}, ` +
        `MAV_upper=${DEFAULT_FALLBACK_LANDMARK.mavUpper}, MRV=${DEFAULT_FALLBACK_LANDMARK.mrv}).`
    );
    return DEFAULT_FALLBACK_LANDMARK;
  }
  return { mev: lm.mev, mavUpper: lm.mav, mrv: lm.mrv };
}

function normalizeWeeklyTargetBlocks(
  blocks: VolumeTargetInput["blocks"]
): readonly WeeklyVolumeTargetBlock[] | undefined {
  if (!blocks || blocks.length === 0) {
    return undefined;
  }

  if (
    blocks.some(
      (block) =>
        typeof block.blockType !== "string" ||
        typeof block.volumeTarget !== "string" ||
        typeof block.intensityBias !== "string"
    )
  ) {
    return undefined;
  }

  return blocks.map((block) => ({
    ...block,
    blockType: block.blockType.toLowerCase() as WeeklyVolumeTargetBlock["blockType"],
    volumeTarget: block.volumeTarget.toLowerCase() as WeeklyVolumeTargetBlock["volumeTarget"],
    intensityBias: block.intensityBias.toLowerCase() as WeeklyVolumeTargetBlock["intensityBias"],
  }));
}

export function getAccumulationWeeks(durationWeeks: number): number {
  return Math.max(1, durationWeeks - 1);
}

export function getDeloadWeek(durationWeeks: number): number {
  return Math.max(2, durationWeeks);
}

export function getPeakAccumulationWeek(durationWeeks: number): number {
  return getAccumulationWeeks(durationWeeks);
}

function interpolateSetTargets(
  start: LifecycleSetTargets,
  peak: LifecycleSetTargets,
  accumulationWeeks: number,
  week: number
): LifecycleSetTargets {
  if (accumulationWeeks <= 1) {
    return start;
  }

  const progress = Math.max(0, Math.min(1, (week - 1) / (accumulationWeeks - 1)));
  return {
    main: Math.round(start.main + (peak.main - start.main) * progress),
    accessory: Math.round(start.accessory + (peak.accessory - start.accessory) * progress),
  };
}

function buildHypertrophyWeekProfile(
  durationWeeks: number,
  week: number,
  isDeload: boolean
): HypertrophyWeekProfile {
  const accumulationWeeks = getAccumulationWeeks(durationWeeks);
  if (isDeload) {
    return {
      rirTarget: DEFAULT_DELOAD_RIR,
      setTargets: DEFAULT_DELOAD_SET_TARGETS,
      setMultiplier: 0.5,
      volumeFraction: 0.45,
    };
  }

  const boundedWeek = Math.max(1, Math.min(week, accumulationWeeks));
  if (durationWeeks === 5) {
    const profiles: Record<number, HypertrophyWeekProfile> = {
      1: {
        rirTarget: { min: 3, max: 4 },
        setTargets: { main: 3, accessory: 2 },
        setMultiplier: 0.8,
        volumeFraction: 0,
      },
      2: {
        rirTarget: { min: 2, max: 3 },
        setTargets: { main: 4, accessory: 3 },
        setMultiplier: 1,
        volumeFraction: 1 / 3,
      },
      3: {
        rirTarget: { min: 1, max: 2 },
        setTargets: { main: 5, accessory: 4 },
        setMultiplier: 1.15,
        volumeFraction: 2 / 3,
      },
      4: {
        rirTarget: { min: 0, max: 1 },
        setTargets: { main: 5, accessory: 5 },
        setMultiplier: 1.3,
        volumeFraction: 1,
      },
    };
    return profiles[boundedWeek] ?? profiles[1];
  }

  const startTargets: LifecycleSetTargets = { main: 3, accessory: 2 };
  const peakTargets: LifecycleSetTargets = durationWeeks <= 4 ? { main: 5, accessory: 4 } : { main: 5, accessory: 5 };
  const setTargets = interpolateSetTargets(startTargets, peakTargets, accumulationWeeks, boundedWeek);
  const progress = accumulationWeeks <= 1 ? 0 : (boundedWeek - 1) / (accumulationWeeks - 1);
  const rirPath: RirTarget[] =
    accumulationWeeks <= 3
      ? [
          { min: 3, max: 4 },
          { min: 2, max: 3 },
          { min: 1, max: 2 },
        ]
      : [
          { min: 3, max: 4 },
          { min: 2, max: 3 },
          { min: 1, max: 2 },
          { min: 0, max: 1 },
        ];

  return {
    rirTarget: rirPath[Math.min(rirPath.length - 1, boundedWeek - 1)] ?? rirPath[0],
    setTargets,
    setMultiplier: Number((0.8 + progress * 0.5).toFixed(2)),
    volumeFraction: progress,
  };
}

function getBlockAwareRirTarget(phaseBlockContext: PhaseBlockProfileContext): RirTarget {
  return buildBlockPrescriptionIntent(phaseBlockContext).rirTarget;
}

function getBlockAwareSetTargets(
  phaseBlockContext: PhaseBlockProfileContext
): LifecycleSetTargets {
  return buildBlockPrescriptionIntent(phaseBlockContext).setTargets;
}

function getBlockAwareSetMultiplier(phaseBlockContext: PhaseBlockProfileContext): number {
  return buildBlockPrescriptionIntent(phaseBlockContext).setMultiplier;
}

export function deriveCurrentMesocycleSession(
  mesocycle: SessionDerivationInput
): CanonicalMesocycleSession {
  const sessionsPerWeek = Math.max(1, mesocycle.sessionsPerWeek);
  const shouldUseDeloadPhase =
    mesocycle.state === "ACTIVE_DELOAD" || mesocycle.state === "COMPLETED";

  if (shouldUseDeloadPhase) {
    return {
      week: getDeloadWeek(mesocycle.durationWeeks),
      session: Math.min(sessionsPerWeek, Math.max(1, mesocycle.deloadSessionsCompleted + 1)),
      phase: "DELOAD",
    };
  }

  return {
    week: Math.min(
      getAccumulationWeeks(mesocycle.durationWeeks),
      Math.floor(mesocycle.accumulationSessionsCompleted / sessionsPerWeek) + 1
    ),
    session: Math.max(1, (mesocycle.accumulationSessionsCompleted % sessionsPerWeek) + 1),
    phase: "ACCUMULATION",
  };
}

export function deriveNextAdvancingSession(
  mesocycle: SessionDerivationInput,
  weeklySchedule: readonly string[] = []
): NextAdvancingSession {
  const current = deriveCurrentMesocycleSession(mesocycle);
  const normalizedSchedule = weeklySchedule
    .map((intent) => intent.trim().toLowerCase())
    .filter((intent) => intent.length > 0);
  const scheduleIndex =
    normalizedSchedule.length > 0 ? (current.session - 1) % normalizedSchedule.length : null;

  return {
    ...current,
    intent: scheduleIndex == null ? null : normalizedSchedule[scheduleIndex] ?? null,
    scheduleIndex,
  };
}

export function getCurrentMesoWeek(mesocycle: WeekDerivationInput): number {
  return deriveCurrentMesocycleSession({
    ...mesocycle,
    deloadSessionsCompleted: 0,
  }).week;
}

export function getWeeklyVolumeTarget(
  mesocycle: VolumeTargetInput,
  muscleGroup: string,
  week: number,
  options?: {
    blockContext?: { mesocycle: { blocks: readonly WeeklyVolumeTargetBlock[] } } | null;
  }
): number {
  const landmark = resolveLandmark(muscleGroup);
  return interpolateWeeklyVolumeTarget(
    {
      mev: landmark.mev,
      mav: landmark.mavUpper,
      mrv: landmark.mrv,
    },
    mesocycle.durationWeeks,
    week,
    {
      blocks: options?.blockContext ? undefined : normalizeWeeklyTargetBlocks(mesocycle.blocks),
      blockContext: options?.blockContext,
    }
  );
}

export function getRirTarget(
  mesocycle: RirTargetInput,
  week: number,
  phaseBlockContext?: PhaseBlockProfileContext
): RirTarget {
  if (phaseBlockContext) {
    return getBlockAwareRirTarget(phaseBlockContext);
  }
  const deloadWeek = getDeloadWeek(mesocycle.durationWeeks);
  if (week >= deloadWeek || mesocycle.state === "ACTIVE_DELOAD" || mesocycle.state === "COMPLETED") {
    return DEFAULT_DELOAD_RIR;
  }
  return buildHypertrophyWeekProfile(mesocycle.durationWeeks, week, false).rirTarget;
}

export function getLifecycleSetTargets(
  durationWeeks: number,
  week: number,
  isDeload = false,
  phaseBlockContext?: PhaseBlockProfileContext
): LifecycleSetTargets {
  if (phaseBlockContext) {
    return getBlockAwareSetTargets(phaseBlockContext);
  }
  return buildHypertrophyWeekProfile(durationWeeks, week, isDeload).setTargets;
}

export function buildLifecyclePeriodization(
  input: LifecyclePeriodizationInput
): PeriodizationModifiers {
  const accumulationWeeks = getAccumulationWeeks(input.durationWeeks);
  const deloadWeek = getDeloadWeek(input.durationWeeks);
  const boundedWeek = Math.max(1, Math.min(input.week, deloadWeek));
  const isDeload = input.isDeload ?? input.phaseBlockContext?.isDeload ?? boundedWeek >= deloadWeek;
  const hypertrophyProfile = buildHypertrophyWeekProfile(input.durationWeeks, boundedWeek, isDeload);
  const rirTarget =
    input.rirTarget ??
    (input.phaseBlockContext
      ? getBlockAwareRirTarget(input.phaseBlockContext)
      : hypertrophyProfile.rirTarget);

  const setMultiplier =
    input.primaryGoal === "hypertrophy"
      ? input.phaseBlockContext
        ? getBlockAwareSetMultiplier(input.phaseBlockContext)
        : hypertrophyProfile.setMultiplier
      : isDeload
        ? 0.5
        : 1.0;

  return {
    rpeOffset: 0,
    setMultiplier,
    backOffMultiplier: isDeload ? 0.75 : getBackOffMultiplier(input.primaryGoal),
    isDeload,
    weekInBlock: input.phaseBlockContext?.weekInBlock ?? boundedWeek,
    accumulationWeeks,
    lifecycleRirTarget: rirTarget,
    lifecycleSetTargets:
      input.primaryGoal === "hypertrophy"
        ? input.phaseBlockContext
          ? getBlockAwareSetTargets(input.phaseBlockContext)
          : hypertrophyProfile.setTargets
        : isDeload
          ? DEFAULT_DELOAD_SET_TARGETS
          : undefined,
  };
}
