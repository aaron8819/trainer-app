import type { Mesocycle as PrismaMesocycle } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { CycleContextSnapshot } from "@/lib/evidence/types";
import type { BlockContext, MacroCycle } from "@/lib/engine/periodization/types";

import { getCurrentMesoWeek, type PhaseBlockProfileContext } from "./mesocycle-lifecycle-math";
import { mapMacroCycle } from "./periodization-mappers";

type ActiveMesocycleLifecycle = Pick<
  PrismaMesocycle,
  | "id"
  | "state"
  | "durationWeeks"
  | "accumulationSessionsCompleted"
  | "deloadSessionsCompleted"
  | "sessionsPerWeek"
>;

export type GenerationPhaseBlockContext = {
  blockContext: BlockContext | null;
  profile: PhaseBlockProfileContext;
  cycleContext: CycleContextSnapshot;
  weekInMeso: number;
  weekInBlock: number;
  mesocycleLength: number;
};

function clampWeek(week: number | undefined, durationWeeks: number): number {
  return Math.max(1, Math.min(week ?? 1, Math.max(1, durationWeeks)));
}

function resolveFallbackProfile(input: {
  activeMesocycle?: ActiveMesocycleLifecycle | null;
  weekInMeso: number;
  forceAccumulation?: boolean;
}): GenerationPhaseBlockContext {
  const durationWeeks = Math.max(1, input.activeMesocycle?.durationWeeks ?? 5);
  const lifecycleWeek = clampWeek(input.weekInMeso, durationWeeks);
  const isDeload =
    input.forceAccumulation === true
      ? false
      : input.activeMesocycle?.state === "ACTIVE_DELOAD" ||
        input.activeMesocycle?.state === "COMPLETED";
  const blockType = isDeload ? "deload" : "accumulation";
  const weekInBlock = isDeload ? 1 : lifecycleWeek;
  const blockDurationWeeks = isDeload ? 1 : Math.max(1, durationWeeks - 1);

  return {
    blockContext: null,
    profile: {
      blockType,
      weekInBlock,
      blockDurationWeeks,
      isDeload,
    },
    cycleContext: {
      weekInMeso: lifecycleWeek,
      weekInBlock,
      mesocycleLength: durationWeeks,
      phase: blockType,
      blockType,
      isDeload,
      source: "fallback",
    },
    weekInMeso: lifecycleWeek,
    weekInBlock,
    mesocycleLength: durationWeeks,
  };
}

export function resolveGenerationPhaseBlockContext(input: {
  macroCycle?: MacroCycle | null;
  activeMesocycle?: ActiveMesocycleLifecycle | null;
  weekInMeso?: number;
  forceAccumulation?: boolean;
}): GenerationPhaseBlockContext {
  const activeMesocycle = input.activeMesocycle ?? null;
  const durationWeeks = Math.max(
    1,
    activeMesocycle?.durationWeeks ??
      input.macroCycle?.mesocycles.find((meso) => meso.id === activeMesocycle?.id)?.durationWeeks ??
      input.macroCycle?.mesocycles[0]?.durationWeeks ??
      5
  );
  const lifecycleWeek = clampWeek(
    input.weekInMeso ??
      (activeMesocycle
        ? getCurrentMesoWeek(activeMesocycle)
        : 1),
    durationWeeks
  );

  if (!input.macroCycle || input.macroCycle.mesocycles.length === 0) {
    return resolveFallbackProfile({
      activeMesocycle,
      weekInMeso: lifecycleWeek,
      forceAccumulation: input.forceAccumulation,
    });
  }

  const mesocycle =
    input.macroCycle.mesocycles.find((candidate) => candidate.id === activeMesocycle?.id) ??
    input.macroCycle.mesocycles[0];
  if (!mesocycle) {
    return resolveFallbackProfile({
      activeMesocycle,
      weekInMeso: lifecycleWeek,
      forceAccumulation: input.forceAccumulation,
    });
  }

  const weekIndexInMacro = mesocycle.startWeek + lifecycleWeek - 1;
  const block =
    mesocycle.blocks.find((candidate) => {
      const blockEndWeek = candidate.startWeek + candidate.durationWeeks;
      return weekIndexInMacro >= candidate.startWeek && weekIndexInMacro < blockEndWeek;
    }) ?? null;

  if (!block) {
    return resolveFallbackProfile({
      activeMesocycle,
      weekInMeso: lifecycleWeek,
      forceAccumulation: input.forceAccumulation,
    });
  }

  const blockContext: BlockContext = {
    block,
    weekInBlock: weekIndexInMacro - block.startWeek + 1,
    weekInMeso: lifecycleWeek,
    weekInMacro: weekIndexInMacro + 1,
    mesocycle,
    macroCycle: input.macroCycle,
  };
  const blockType =
    input.forceAccumulation === true && block.blockType === "deload"
      ? "accumulation"
      : block.blockType;
  const isDeload = input.forceAccumulation === true ? false : blockType === "deload";

  return {
    blockContext,
    profile: {
      blockType,
      weekInBlock: blockContext.weekInBlock,
      blockDurationWeeks: block.durationWeeks,
      isDeload,
    },
    cycleContext: {
      weekInMeso: lifecycleWeek,
      weekInBlock: blockContext.weekInBlock,
      mesocycleLength: mesocycle.durationWeeks,
      phase: blockType,
      blockType,
      isDeload,
      source: "computed",
    },
    weekInMeso: lifecycleWeek,
    weekInBlock: blockContext.weekInBlock,
    mesocycleLength: mesocycle.durationWeeks,
  };
}

export async function loadGenerationPhaseBlockContext(
  userId: string,
  options?: {
    activeMesocycle?: ActiveMesocycleLifecycle | null;
    weekInMeso?: number;
    forceAccumulation?: boolean;
  }
): Promise<GenerationPhaseBlockContext> {
  const macro = await prisma.macroCycle.findFirst({
    where: {
      userId,
      mesocycles: {
        some: {
          isActive: true,
        },
      },
    },
    orderBy: [{ startDate: "desc" }],
    include: {
      mesocycles: {
        where: { isActive: true },
        include: { blocks: true },
      },
    },
  });

  return resolveGenerationPhaseBlockContext({
    macroCycle: macro ? mapMacroCycle(macro) : null,
    activeMesocycle: options?.activeMesocycle ?? macro?.mesocycles[0] ?? null,
    weekInMeso: options?.weekInMeso,
    forceAccumulation: options?.forceAccumulation,
  });
}
