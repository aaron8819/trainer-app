import type { Mesocycle } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

type MuscleLandmark = {
  mev: number;
  mavUpper: number;
  mrv: number;
};

type RirTarget = { min: number; max: number };

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
  | "volumeRampConfig"
  | "rirBandConfig"
>;
type WeekDerivationInput = Pick<MesoWithLifecycle, "state" | "accumulationSessionsCompleted" | "sessionsPerWeek">;
type VolumeTargetInput = Pick<MesoWithLifecycle, "volumeRampConfig">;
type RirTargetInput = Pick<MesoWithLifecycle, "state" | "rirBandConfig">;

const ACCUMULATION_SESSION_THRESHOLD = 12;
const DELOAD_SESSION_THRESHOLD = 3;
const ACCUMULATION_WEEK_CAP = 4;
const DELOAD_WEEK = 5;
const DEFAULT_RIR_BANDS: Record<number, RirTarget> = {
  1: { min: 3, max: 4 },
  2: { min: 2, max: 3 },
  3: { min: 2, max: 3 },
  4: { min: 1, max: 2 },
  5: { min: 4, max: 6 },
};

const INTERMEDIATE_LANDMARKS: Record<string, MuscleLandmark> = {
  back: { mev: 10, mavUpper: 22, mrv: 25 },
  rear_delts: { mev: 8, mavUpper: 18, mrv: 26 },
  biceps: { mev: 8, mavUpper: 20, mrv: 26 },
  chest: { mev: 10, mavUpper: 20, mrv: 22 },
  front_delts: { mev: 0, mavUpper: 8, mrv: 12 },
  side_delts: { mev: 8, mavUpper: 22, mrv: 26 },
  quads: { mev: 8, mavUpper: 18, mrv: 20 },
  hamstrings: { mev: 6, mavUpper: 16, mrv: 20 },
  glutes: { mev: 0, mavUpper: 12, mrv: 16 },
  triceps: { mev: 6, mavUpper: 14, mrv: 18 },
  calves: { mev: 8, mavUpper: 16, mrv: 20 },
  core: { mev: 0, mavUpper: 12, mrv: 16 },
  forearms: { mev: 0, mavUpper: 6, mrv: 10 },
  adductors: { mev: 0, mavUpper: 8, mrv: 12 },
  neck: { mev: 0, mavUpper: 4, mrv: 6 },
  lower_back: { mev: 0, mavUpper: 6, mrv: 10 },
  abductors: { mev: 0, mavUpper: 8, mrv: 12 },
  abs: { mev: 0, mavUpper: 12, mrv: 16 },
  traps: { mev: 0, mavUpper: 12, mrv: 16 },
  rotator_cuff: { mev: 0, mavUpper: 6, mrv: 10 },
};

const DEFAULT_FALLBACK_LANDMARK: MuscleLandmark = {
  mev: 0,
  mavUpper: 10,
  mrv: 15,
};

function normalizeMuscleGroup(muscleGroup: string): string {
  const normalized = muscleGroup.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "lats" || normalized === "upper_back") return "back";
  if (normalized === "rear_deltoids") return "rear_delts";
  if (normalized === "front_deltoids") return "front_delts";
  if (normalized === "side_deltoids") return "side_delts";
  return normalized;
}

function resolveLandmark(muscleGroup: string): MuscleLandmark {
  const key = normalizeMuscleGroup(muscleGroup);
  const landmark = INTERMEDIATE_LANDMARKS[key];
  if (!landmark) {
    console.warn(
      `[mesocycle-lifecycle] Unsupported muscle group for lifecycle volume target: ${muscleGroup}. ` +
        `Using fallback landmark (MEV=${DEFAULT_FALLBACK_LANDMARK.mev}, ` +
        `MAV_upper=${DEFAULT_FALLBACK_LANDMARK.mavUpper}, MRV=${DEFAULT_FALLBACK_LANDMARK.mrv}).`
    );
    return DEFAULT_FALLBACK_LANDMARK;
  }
  return landmark;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseRirBandConfig(mesocycle: MesoWithLifecycle): Record<number, RirTarget> {
  const config = asObject(mesocycle.rirBandConfig);
  const weekBands = config ? asObject(config.weekBands) : null;
  if (!weekBands) {
    return DEFAULT_RIR_BANDS;
  }

  const parsed: Record<number, RirTarget> = { ...DEFAULT_RIR_BANDS };
  const mapBand = (targetWeek: number, sourceKey: string) => {
    const raw = asObject(weekBands[sourceKey]);
    if (!raw) return;
    const min = typeof raw.min === "number" ? raw.min : undefined;
    const max = typeof raw.max === "number" ? raw.max : undefined;
    if (typeof min === "number" && typeof max === "number") {
      parsed[targetWeek] = { min, max };
    }
  };

  mapBand(1, "week1");
  mapBand(2, "week2");
  mapBand(3, "week3");
  mapBand(4, "week4");
  mapBand(5, "week5Deload");

  return parsed;
}

export function getCurrentMesoWeek(mesocycle: WeekDerivationInput): number {
  if (mesocycle.state === "ACTIVE_ACCUMULATION") {
    const sessionsPerWeek = Math.max(1, mesocycle.sessionsPerWeek);
    const week = Math.floor(mesocycle.accumulationSessionsCompleted / sessionsPerWeek) + 1;
    return Math.min(ACCUMULATION_WEEK_CAP, week);
  }
  if (mesocycle.state === "ACTIVE_DELOAD" || mesocycle.state === "COMPLETED") {
    return DELOAD_WEEK;
  }
  return 1;
}

export function getWeeklyVolumeTarget(
  mesocycle: VolumeTargetInput,
  muscleGroup: string,
  week: number
): number {
  // Access config to ensure the target is derived from the persisted mesocycle snapshot.
  void mesocycle.volumeRampConfig;

  const landmark = resolveLandmark(muscleGroup);
  if (week <= 1) return landmark.mev;
  if (week === 2) return landmark.mev + 2;
  if (week === 3) return landmark.mev + 4;
  const week4 = Math.min(landmark.mavUpper, landmark.mrv);
  if (week === 4) return week4;
  return Math.round(week4 * 0.45);
}

export function getRirTarget(mesocycle: RirTargetInput, week: number): RirTarget {
  if (week >= DELOAD_WEEK || mesocycle.state === "ACTIVE_DELOAD" || mesocycle.state === "COMPLETED") {
    return { min: 4, max: 6 };
  }
  const bands = parseRirBandConfig(mesocycle);
  return bands[week] ?? DEFAULT_RIR_BANDS[1];
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
        volumeRampConfig: true,
        rirBandConfig: true,
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
        volumeRampConfig: source.volumeRampConfig ?? undefined,
        rirBandConfig: source.rirBandConfig ?? undefined,
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
    const nextAccumulationCount = mesocycle.accumulationSessionsCompleted + 1;
    const shouldEnterDeload = nextAccumulationCount >= ACCUMULATION_SESSION_THRESHOLD;
    const updated = await prisma.mesocycle.update({
      where: { id: mesocycle.id },
      data: {
        accumulationSessionsCompleted: nextAccumulationCount,
        state: shouldEnterDeload ? "ACTIVE_DELOAD" : mesocycle.state,
      },
    });
    return updated;
  }

  const nextDeloadCount = mesocycle.deloadSessionsCompleted + 1;
  const shouldComplete = nextDeloadCount >= DELOAD_SESSION_THRESHOLD;
  const updated = await prisma.mesocycle.update({
    where: { id: mesocycle.id },
    data: {
      deloadSessionsCompleted: nextDeloadCount,
      state: shouldComplete ? "COMPLETED" : mesocycle.state,
    },
  });

  if (shouldComplete) {
    await initializeNextMesocycle(updated);
  }

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
