import type {
  AdaptationType,
  BlockType,
  IntensityBias,
  MesocycleExerciseRoleType,
  SplitType,
  VolumeTarget,
  WorkoutSessionIntent,
} from "@prisma/client";
import type { MesocycleSlotAuthoredSemantics } from "./mesocycle-slot-contract";

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

export type NextCycleConstraintsInput = {
  availableDaysPerWeek: number;
  maxSessionsPerWeek?: number;
};

export type NextCyclePreferencesInput = {
  preferredSplitType?: SplitType;
  preferredSessionsPerWeek?: number;
};

export type GenesisPolicySignalQuality = "high" | "medium";

export type GenesisPolicyBranchResult<TDecision> = {
  decision: TDecision;
  reasonCodes: string[];
  signalQuality: GenesisPolicySignalQuality;
};

export type GenesisPolicyContext = {
  sourceProfile: {
    sourceMesocycleId: string;
    focus: string;
    durationWeeks: number;
    volumeTarget: VolumeTarget;
    intensityBias: IntensityBias;
    blocks: Array<{
      blockNumber: number;
      blockType: BlockType;
      durationWeeks: number;
      volumeTarget: VolumeTarget;
      intensityBias: IntensityBias;
      adaptationType: AdaptationType;
    }>;
  };
  constraints: NextCycleConstraintsInput;
  preferences: NextCyclePreferencesInput & {
    preferredSplitTypeSource?: "constraints_split_type" | "weekly_schedule_topology";
    preferredSessionsPerWeekSource?: "constraints_days_per_week" | "weekly_schedule_length";
  };
  sourceTopology: {
    splitType: SplitType;
    sessionsPerWeek: number;
    daysPerWeek: number;
    weeklySequence: WorkoutSessionIntent[];
    slotSource: "persisted_slot_sequence" | "legacy_weekly_schedule";
    hasPersistedSlotSequence: boolean;
    slots: Array<{
      slotId: string;
      intent: WorkoutSessionIntent;
      sequenceIndex: number;
    }>;
    repeatedIntents: WorkoutSessionIntent[];
  };
  closeoutEvidence: {
    scheduledSessions: number;
    performedSessions: number;
    completedSessions: number;
    advancingSessions: number;
    nonAdvancingPerformedSessions: number;
    adherenceRate: number | null;
    completionRate: number | null;
    terminalDeloadPerformed: boolean;
    latestReadiness: {
      readiness: 1 | 2 | 3 | 4 | 5;
      signalAgeHours: number;
    } | null;
  };
  carryForwardCandidateEvidence: Array<{
    exerciseId: string;
    exerciseName: string;
    role: MesocycleExerciseRoleType;
    priorIntent: WorkoutSessionIntent;
    priorSlotId?: string;
    anchorLevel: "required" | "preferred" | "none";
    evidence: {
      exposureCount: number;
      advancingExposureCount: number;
      latestPerformedAt: string | null;
      latestSourceIntent?: WorkoutSessionIntent;
      latestSourceSlotId?: string;
      latestSemanticsKind?:
        | "advancing"
        | "gap_fill"
        | "supplemental"
        | "non_advancing_generic";
    };
  }>;
};

export type NextMesocycleStartingPoint = {
  volumeEntry: "conservative";
  baselineSource: "accumulation_preferred";
  allowNonDeloadFallback: true;
};

export type NextMesocycleCarryForwardDecision = {
  exerciseId: string;
  role: MesocycleExerciseRoleType;
  priorIntent: WorkoutSessionIntent;
  priorSlotId?: string;
  action: "keep" | "rotate" | "drop";
  targetIntent?: WorkoutSessionIntent;
  targetSlotId?: string;
  signalQuality: GenesisPolicySignalQuality;
  reasonCodes: string[];
};

export type NextMesocycleDesign = {
  version: 1;
  designedAt: string;
  sourceMesocycleId: string;
  profile: {
    focus: string;
    durationWeeks: number;
    volumeTarget: VolumeTarget;
    intensityBias: IntensityBias;
    blocks: Array<{
      blockNumber: number;
      blockType: BlockType;
      durationWeeks: number;
      volumeTarget: VolumeTarget;
      intensityBias: IntensityBias;
      adaptationType: AdaptationType;
    }>;
  };
  structure: {
    splitType: SplitType;
    sessionsPerWeek: number;
    daysPerWeek: number;
    sequenceMode: "ordered_flexible";
    slots: Array<{
      slotId: NextCycleSlotId;
      intent: WorkoutSessionIntent;
      authoredSemantics: MesocycleSlotAuthoredSemantics;
    }>;
  };
  carryForward: {
    decisions: NextMesocycleCarryForwardDecision[];
  };
  startingPoint: NextMesocycleStartingPoint;
  explainability: {
    profileReasonCodes: string[];
    profileSignalQuality: GenesisPolicySignalQuality;
    structureReasonCodes: string[];
    structureSignalQuality: GenesisPolicySignalQuality;
    startingPointReasonCodes: string[];
    startingPointSignalQuality: GenesisPolicySignalQuality;
  };
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
  startingPoint: NextMesocycleStartingPoint;
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
  recommendedDesign?: NextMesocycleDesign;
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

const COMPATIBLE_KEEP_INTENT_REMAPS: Partial<
  Record<SplitType, Partial<Record<WorkoutSessionIntent, WorkoutSessionIntent>>>
> = {
  UPPER_LOWER: {
    PUSH: "UPPER",
    PULL: "UPPER",
    LEGS: "LOWER",
  },
};

export function getAllowedIntentsForSplit(splitType: SplitType): WorkoutSessionIntent[] {
  return [...ALLOWED_INTENTS_BY_SPLIT[splitType]];
}

export function remapCompatibleCarryForwardIntent(input: {
  splitType: SplitType;
  sessionIntent: WorkoutSessionIntent;
}): WorkoutSessionIntent {
  return COMPATIBLE_KEEP_INTENT_REMAPS[input.splitType]?.[input.sessionIntent] ?? input.sessionIntent;
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
