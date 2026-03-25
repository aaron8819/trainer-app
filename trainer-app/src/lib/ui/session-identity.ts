type SessionIdentityInput = {
  intent?: string | null;
  slotId?: string | null;
};

type SessionSlotSource = "mesocycle_slot_sequence" | "legacy_weekly_schedule" | null | undefined;

function toTitleCase(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferIntentFromSlotId(slotId?: string | null): string | null {
  if (!slotId) {
    return null;
  }

  const segments = slotId
    .trim()
    .toLowerCase()
    .split("_")
    .filter(Boolean);
  if (segments.length <= 1) {
    return segments[0] ?? null;
  }

  return segments.slice(0, -1).join("_");
}

function parseSlotOrdinal(slotId?: string | null): number | null {
  if (!slotId) {
    return null;
  }

  const suffix = slotId
    .trim()
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .pop();
  if (!suffix) {
    return null;
  }

  if (/^\d+$/.test(suffix)) {
    const parsed = Number.parseInt(suffix, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  if (!/^[a-z]+$/.test(suffix)) {
    return null;
  }

  let ordinal = 0;
  for (const char of suffix) {
    ordinal = ordinal * 26 + (char.charCodeAt(0) - 96);
  }

  return ordinal > 0 ? ordinal : null;
}

function formatOrdinalWord(value: number): string {
  const words: Record<number, string> = {
    1: "First",
    2: "Second",
    3: "Third",
    4: "Fourth",
    5: "Fifth",
    6: "Sixth",
  };

  return words[value] ?? `${value}th`;
}

export function formatSessionIntentLabel(intent?: string | null): string {
  const resolvedIntent = intent?.trim() || null;
  if (!resolvedIntent) {
    return "Workout";
  }

  return toTitleCase(resolvedIntent);
}

export function formatSessionIdentityLabel(input: SessionIdentityInput): string {
  const resolvedIntent = input.intent ?? inferIntentFromSlotId(input.slotId);
  const intentLabel = formatSessionIntentLabel(resolvedIntent);
  const slotOrdinal = parseSlotOrdinal(input.slotId);

  if (slotOrdinal == null || intentLabel === "Workout") {
    return intentLabel;
  }

  return `${intentLabel} ${slotOrdinal}`;
}

export function formatSessionIdentityDescription(input: SessionIdentityInput): string | null {
  const resolvedIntent = input.intent ?? inferIntentFromSlotId(input.slotId);
  if (!resolvedIntent || !input.slotId) {
    return null;
  }

  const intentLabel = formatSessionIntentLabel(resolvedIntent).toLowerCase();
  const slotOrdinal = parseSlotOrdinal(input.slotId);
  if (slotOrdinal == null) {
    return `${formatSessionIntentLabel(resolvedIntent)} session in your current weekly order.`;
  }

  return `${formatOrdinalWord(slotOrdinal)} ${intentLabel} session in your current weekly order.`;
}

export function formatSessionSlotTechnicalLabel(slotId?: string | null): string | null {
  const resolvedSlotId = slotId?.trim() || null;
  if (!resolvedSlotId) {
    return null;
  }

  return `Slot ID: ${resolvedSlotId}`;
}

export function formatSessionSlotTechnicalDescription(input: {
  slotId?: string | null;
  source?: SessionSlotSource;
}): string | null {
  const resolvedSlotId = input.slotId?.trim() || null;
  if (!resolvedSlotId) {
    return null;
  }

  if (input.source === "legacy_weekly_schedule") {
    return `Canonical slot ID ${resolvedSlotId} from your saved weekly schedule.`;
  }

  return `Canonical slot ID ${resolvedSlotId} from your ordered weekly slot sequence.`;
}
