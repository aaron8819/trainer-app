import {
  isStrictOptionalGapFillSession,
  resolveEffectiveSelectionMode,
} from "@/lib/gap-fill/classifier";
import { isStrictSupplementalDeficitSession } from "@/lib/session-semantics/supplemental-classifier";

export type DerivedSessionKind =
  | "advancing"
  | "gap_fill"
  | "supplemental"
  | "non_advancing_generic";

export type SessionSemanticsInput = {
  advancesSplit?: boolean | null;
  selectionMode?: string | null;
  sessionIntent?: string | null;
  selectionMetadata?: unknown;
  templateId?: string | null;
};

export type SessionSemantics = {
  kind: DerivedSessionKind;
  effectiveSelectionMode?: string;
  isStrictGapFill: boolean;
  isStrictSupplemental: boolean;
  advancesLifecycle: boolean;
  consumesWeeklyScheduleIntent: boolean;
  countsTowardProgressionHistory: boolean;
  eligibleForUniqueIntentSubtraction: boolean;
};

export function deriveSessionSemantics(
  input: SessionSemanticsInput
): SessionSemantics {
  void input.templateId;

  const effectiveSelectionMode = resolveEffectiveSelectionMode({
    selectionMode: input.selectionMode,
    sessionIntent: input.sessionIntent,
  });

  const isStrictGapFill = isStrictOptionalGapFillSession({
    selectionMetadata: input.selectionMetadata,
    selectionMode: input.selectionMode,
    sessionIntent: input.sessionIntent,
  });

  const isStrictSupplemental = isStrictSupplementalDeficitSession({
    selectionMetadata: input.selectionMetadata,
    selectionMode: input.selectionMode,
    sessionIntent: input.sessionIntent,
  });

  const advancesLifecycle = input.advancesSplit !== false;

  let kind: DerivedSessionKind = "non_advancing_generic";
  if (isStrictSupplemental) {
    kind = "supplemental";
  } else if (isStrictGapFill) {
    kind = "gap_fill";
  } else if (advancesLifecycle) {
    kind = "advancing";
  }

  return {
    kind,
    effectiveSelectionMode,
    isStrictGapFill,
    isStrictSupplemental,
    advancesLifecycle,
    consumesWeeklyScheduleIntent: advancesLifecycle,
    countsTowardProgressionHistory: !isStrictSupplemental,
    eligibleForUniqueIntentSubtraction: advancesLifecycle,
  };
}
