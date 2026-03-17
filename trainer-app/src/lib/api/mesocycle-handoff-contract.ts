import type {
  MesocycleExerciseRoleType,
  SplitType,
  WorkoutSessionIntent,
} from "@prisma/client";

export type NextCycleSlotId = string;

export type NextCycleSeedSlot = {
  slotId: NextCycleSlotId;
  intent: WorkoutSessionIntent;
};

export type NextCycleCarryForwardSelection = {
  exerciseId: string;
  exerciseName: string;
  sessionIntent: WorkoutSessionIntent;
  role: MesocycleExerciseRoleType;
  action: "keep" | "rotate" | "drop";
};

export type NextCycleCarryForwardConflict = Pick<
  NextCycleCarryForwardSelection,
  "exerciseId" | "exerciseName" | "sessionIntent" | "role"
>;

export type NextCycleSeedDraft = {
  version: 1;
  sourceMesocycleId: string;
  createdAt: string;
  updatedAt?: string;
  structure: {
    splitType: SplitType;
    sessionsPerWeek: number;
    daysPerWeek: number;
    sequenceMode: "ordered_flexible";
    slots: NextCycleSeedSlot[];
  };
  startingPoint: {
    volumePreset: "conservative_productive";
    baselineRule: "peak_accumulation_else_highest_accumulation_else_non_deload";
    excludeDeload: true;
  };
  carryForwardSelections: NextCycleCarryForwardSelection[];
};

export type HandoffCarryForwardRecommendation = {
  exerciseId: string;
  exerciseName: string;
  sessionIntent: WorkoutSessionIntent;
  role: MesocycleExerciseRoleType;
  recommendation: "keep" | "rotate";
  signalQuality: "high" | "medium";
  reasonCodes: string[];
};

export type MesocycleHandoffSummary = {
  version: 1;
  mesocycleId: string;
  macroCycleId: string;
  mesoNumber: number;
  closedAt: string;
  lifecycle: {
    terminalState: "AWAITING_HANDOFF";
    durationWeeks: number;
    accumulationSessionsCompleted: number;
    deloadSessionsCompleted: number;
    deloadExcludedFromNextBaseline: true;
  };
  training: {
    focus: string;
    splitType: SplitType;
    sessionsPerWeek: number;
    daysPerWeek: number;
    weeklySequence: WorkoutSessionIntent[];
  };
  carryForwardRecommendations: HandoffCarryForwardRecommendation[];
  recommendedNextSeed: NextCycleSeedDraft;
};

const SPLIT_INTENT_PATTERNS: Record<SplitType, WorkoutSessionIntent[]> = {
  UPPER_LOWER: ["UPPER", "LOWER"],
  PPL: ["PUSH", "PULL", "LEGS"],
  FULL_BODY: ["FULL_BODY"],
  CUSTOM: ["FULL_BODY"],
};

const ALLOWED_INTENTS_BY_SPLIT: Record<SplitType, WorkoutSessionIntent[]> = {
  UPPER_LOWER: ["UPPER", "LOWER"],
  PPL: ["PUSH", "PULL", "LEGS"],
  FULL_BODY: ["FULL_BODY"],
  CUSTOM: ["PUSH", "PULL", "LEGS", "UPPER", "LOWER", "FULL_BODY", "BODY_PART"],
};

export function getAllowedIntentsForSplit(splitType: SplitType): WorkoutSessionIntent[] {
  return [...ALLOWED_INTENTS_BY_SPLIT[splitType]];
}

export function findIncompatibleCarryForwardKeeps(input: {
  slots: Pick<NextCycleSeedSlot, "intent">[];
  carryForwardSelections: NextCycleCarryForwardSelection[];
}): NextCycleCarryForwardConflict[] {
  const availableIntents = new Set(input.slots.map((slot) => slot.intent));

  return input.carryForwardSelections
    .filter(
      (selection) => selection.action === "keep" && !availableIntents.has(selection.sessionIntent)
    )
    .map((selection) => ({
      exerciseId: selection.exerciseId,
      exerciseName: selection.exerciseName,
      sessionIntent: selection.sessionIntent,
      role: selection.role,
    }));
}

export function formatCarryForwardConflictMessage(
  conflicts: NextCycleCarryForwardConflict[]
): string {
  const summary = conflicts
    .map((conflict) => `${conflict.exerciseName} (${conflict.sessionIntent})`)
    .join(", ");

  return `Resolve carry-forward conflicts before accepting the next cycle. These keep selections no longer match any session in the edited split: ${summary}.`;
}

function toSlotSuffix(index: number): string {
  return String.fromCharCode("a".charCodeAt(0) + index);
}

function normalizeSlotPrefix(intent: WorkoutSessionIntent): string {
  return intent.toLowerCase();
}

export function buildOrderedFlexibleSlots(input: {
  splitType: SplitType;
  sessionsPerWeek: number;
  intents?: WorkoutSessionIntent[];
}): NextCycleSeedSlot[] {
  const pattern = SPLIT_INTENT_PATTERNS[input.splitType];
  const intents =
    input.intents && input.intents.length > 0
      ? input.intents.slice(0, input.sessionsPerWeek)
      : Array.from(
          { length: input.sessionsPerWeek },
          (_, index) => pattern[index % pattern.length]!
        );
  const intentCounts = new Map<WorkoutSessionIntent, number>();

  return intents.map((intent) => {
    const count = intentCounts.get(intent) ?? 0;
    intentCounts.set(intent, count + 1);
    return {
      slotId: `${normalizeSlotPrefix(intent)}_${toSlotSuffix(count)}`,
      intent,
    };
  });
}
