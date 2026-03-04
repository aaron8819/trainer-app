import type { Mesocycle } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { getBackOffMultiplier, type PeriodizationModifiers } from "@/lib/engine/rules";
import type { PrimaryGoal } from "@/lib/engine/types";

type MuscleLandmark = {
  mev: number;
  mavUpper: number;
  mrv: number;
};

type RirTarget = { min: number; max: number };
type LifecycleSetTargets = { main: number; accessory: number };
type HypertrophyWeekProfile = {
  rirTarget: RirTarget;
  setTargets: LifecycleSetTargets;
  setMultiplier: number;
  volumeFraction: number;
};

type MesoWithLifecycle = Pick<
  Mesocycle,
  | "id"
  | "macroCycleId"
  | "mesoNumber"
  | "durationWeeks"
  | "focus"
  | "volumeTarget"
  | "intensityBias"
  | "isActive"
  | "state"
  | "accumulationSessionsCompleted"
  | "deloadSessionsCompleted"
  | "sessionsPerWeek"
  | "daysPerWeek"
  | "splitType"
>;
type WeekDerivationInput = Pick<
  MesoWithLifecycle,
  "state" | "accumulationSessionsCompleted" | "sessionsPerWeek" | "durationWeeks"
>;
type SessionDerivationInput = Pick<
  MesoWithLifecycle,
  | "state"
  | "accumulationSessionsCompleted"
  | "deloadSessionsCompleted"
  | "sessionsPerWeek"
  | "durationWeeks"
>;
type VolumeTargetInput = Pick<MesoWithLifecycle, "durationWeeks">;
type RirTargetInput = Pick<MesoWithLifecycle, "state" | "durationWeeks">;
type LifecyclePeriodizationInput = {
  primaryGoal: PrimaryGoal;
  durationWeeks: number;
  week: number;
  isDeload?: boolean;
  rirTarget?: RirTarget;
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

function getAccumulationSessionThreshold(mesocycle: Pick<MesoWithLifecycle, "durationWeeks" | "sessionsPerWeek">): number {
  return getAccumulationWeeks(mesocycle.durationWeeks) * Math.max(1, mesocycle.sessionsPerWeek);
}

function getDeloadSessionThreshold(mesocycle: Pick<MesoWithLifecycle, "sessionsPerWeek">): number {
  return Math.max(1, mesocycle.sessionsPerWeek);
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
  week: number
): number {
  const landmark = resolveLandmark(muscleGroup);
  const week4 = Math.min(landmark.mavUpper, landmark.mrv);
  const accumulationWeeks = getAccumulationWeeks(mesocycle.durationWeeks);
  const boundedWeek = Math.max(1, Math.min(week, accumulationWeeks));
  const profile = buildHypertrophyWeekProfile(mesocycle.durationWeeks, boundedWeek, false);
  const accumulationTarget = Math.round(
    landmark.mev + profile.volumeFraction * (week4 - landmark.mev)
  );

  if (week <= 1) return landmark.mev;
  if (week <= accumulationWeeks) return accumulationTarget;
  return Math.round(week4 * 0.45);
}

export function getRirTarget(mesocycle: RirTargetInput, week: number): RirTarget {
  const deloadWeek = getDeloadWeek(mesocycle.durationWeeks);
  if (week >= deloadWeek || mesocycle.state === "ACTIVE_DELOAD" || mesocycle.state === "COMPLETED") {
    return DEFAULT_DELOAD_RIR;
  }
  return buildHypertrophyWeekProfile(mesocycle.durationWeeks, week, false).rirTarget;
}

export function getLifecycleSetTargets(
  durationWeeks: number,
  week: number,
  isDeload = false
): LifecycleSetTargets {
  return buildHypertrophyWeekProfile(durationWeeks, week, isDeload).setTargets;
}

export function buildLifecyclePeriodization(
  input: LifecyclePeriodizationInput
): PeriodizationModifiers {
  const accumulationWeeks = getAccumulationWeeks(input.durationWeeks);
  const deloadWeek = getDeloadWeek(input.durationWeeks);
  const boundedWeek = Math.max(1, Math.min(input.week, deloadWeek));
  const isDeload = input.isDeload ?? boundedWeek >= deloadWeek;
  const hypertrophyProfile = buildHypertrophyWeekProfile(input.durationWeeks, boundedWeek, isDeload);
  const rirTarget = input.rirTarget ?? hypertrophyProfile.rirTarget;

  const setMultiplier =
    input.primaryGoal === "hypertrophy"
      ? hypertrophyProfile.setMultiplier
      : isDeload
        ? 0.5
        : 1.0;

  return {
    rpeOffset: 0,
    setMultiplier,
    backOffMultiplier: isDeload ? 0.75 : getBackOffMultiplier(input.primaryGoal),
    isDeload,
    weekInBlock: boundedWeek,
    accumulationWeeks,
    lifecycleRirTarget: rirTarget,
    lifecycleSetTargets:
      input.primaryGoal === "hypertrophy"
        ? hypertrophyProfile.setTargets
        : isDeload
          ? DEFAULT_DELOAD_SET_TARGETS
          : undefined,
  };
}

export async function initializeNextMesocycle(
  completedMesocycle: MesoWithLifecycle
): Promise<Mesocycle> {
  return prisma.$transaction(async (tx) => {
    const source = await tx.mesocycle.findUnique({
      where: { id: completedMesocycle.id },
      select: {
        id: true,
        macroCycleId: true,
        mesoNumber: true,
        startWeek: true,
        durationWeeks: true,
        focus: true,
        volumeTarget: true,
      intensityBias: true,
      sessionsPerWeek: true,
      daysPerWeek: true,
      splitType: true,
    },
  });
    if (!source) {
      throw new Error(`Mesocycle not found: ${completedMesocycle.id}`);
    }

    await tx.mesocycle.update({
      where: { id: source.id },
      data: { isActive: false },
    });

    const next = await tx.mesocycle.create({
      data: {
        macroCycleId: source.macroCycleId,
        mesoNumber: source.mesoNumber + 1,
        startWeek: source.startWeek + source.durationWeeks,
        durationWeeks: source.durationWeeks,
        focus: source.focus,
        volumeTarget: source.volumeTarget,
        intensityBias: source.intensityBias,
        isActive: true,
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 0,
        deloadSessionsCompleted: 0,
        sessionsPerWeek: source.sessionsPerWeek,
        daysPerWeek: source.daysPerWeek,
        splitType: source.splitType,
      },
    });

    const carriedCoreRows = await tx.mesocycleExerciseRole.findMany({
      where: {
        mesocycleId: source.id,
        role: "CORE_COMPOUND",
      },
      select: {
        exerciseId: true,
        sessionIntent: true,
        role: true,
      },
    });

    if (carriedCoreRows.length > 0) {
      await tx.mesocycleExerciseRole.createMany({
        data: carriedCoreRows.map((row) => ({
          mesocycleId: next.id,
          exerciseId: row.exerciseId,
          sessionIntent: row.sessionIntent,
          role: row.role,
          addedInWeek: 1,
        })),
        skipDuplicates: true,
      });
    }

    return next;
  });
}

/**
 * Check lifecycle thresholds and transition mesocycle state if needed.
 *
 * Counter increments (accumulationSessionsCompleted / deloadSessionsCompleted) are
 * performed atomically inside the save-workout transaction BEFORE this function runs.
 * This function only reads the already-incremented counters and applies state
 * transitions when the threshold has been reached.
 */
export async function transitionMesocycleState(mesocycleId: string): Promise<Mesocycle> {
  const mesocycle = await prisma.mesocycle.findUnique({
    where: { id: mesocycleId },
  });
  if (!mesocycle) {
    throw new Error(`Mesocycle not found: ${mesocycleId}`);
  }

  if (mesocycle.state === "COMPLETED") {
    console.warn(`[mesocycle-lifecycle] transition requested on COMPLETED mesocycle ${mesocycleId}; no-op`);
    return mesocycle;
  }

  if (mesocycle.state === "ACTIVE_ACCUMULATION") {
    // Counter already incremented in the save transaction; just check threshold.
    if (mesocycle.accumulationSessionsCompleted < getAccumulationSessionThreshold(mesocycle)) {
      return mesocycle;
    }
    const updated = await prisma.mesocycle.update({
      where: { id: mesocycle.id },
      data: { state: "ACTIVE_DELOAD" },
    });
    return updated;
  }

  // ACTIVE_DELOAD: counter already incremented in the save transaction.
  if (mesocycle.deloadSessionsCompleted < getDeloadSessionThreshold(mesocycle)) {
    return mesocycle;
  }
  const updated = await prisma.mesocycle.update({
    where: { id: mesocycle.id },
    data: { state: "COMPLETED" },
  });

  await initializeNextMesocycle(updated);

  return updated;
}

export async function loadActiveMesocycle(userId: string): Promise<Mesocycle | null> {
  return prisma.mesocycle.findFirst({
    where: {
      isActive: true,
      macroCycle: { userId },
    },
    orderBy: [{ mesoNumber: "desc" }],
  });
}
