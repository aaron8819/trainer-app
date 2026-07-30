export const CANONICAL_LIMITATION_TAGS = [
  "ankle",
  "elbow",
  "hip",
  "knee",
  "lower_back",
  "neck",
  "shoulder",
  "wrist",
] as const;

export type CanonicalLimitationTag =
  (typeof CANONICAL_LIMITATION_TAGS)[number];

export type ResolvedLimitations = {
  recognizedTags: CanonicalLimitationTag[];
  unrecognizedTexts: string[];
};

const ALIASES: Readonly<Record<string, CanonicalLimitationTag>> = {
  ankle: "ankle",
  ankles: "ankle",
  elbow: "elbow",
  elbows: "elbow",
  hip: "hip",
  hips: "hip",
  knee: "knee",
  knees: "knee",
  lumbar: "lower_back",
  "low back": "lower_back",
  "lower back": "lower_back",
  neck: "neck",
  shoulder: "shoulder",
  shoulders: "shoulder",
  delt: "shoulder",
  delts: "shoulder",
  wrist: "wrist",
  wrists: "wrist",
};

const CONTEXT_WORDS = new Set([
  "a",
  "active",
  "bilateral",
  "chronic",
  "current",
  "history",
  "injured",
  "injury",
  "issue",
  "issues",
  "left",
  "my",
  "of",
  "old",
  "pain",
  "previous",
  "prior",
  "right",
  "sore",
  "soreness",
  "the",
]);

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[()[\]{}.!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function resolveFragment(value: string): CanonicalLimitationTag | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const exact = ALIASES[normalized];
  if (exact) return exact;

  const meaningful = normalized
    .split(" ")
    .filter((token) => !CONTEXT_WORDS.has(token))
    .join(" ");
  return ALIASES[meaningful] ?? null;
}

function splitLimitationText(value: string): string[] {
  return value
    .split(/\s*(?:,|\/|&|\+|\band\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function resolveCanonicalLimitations(
  values: readonly string[],
): ResolvedLimitations {
  const recognized = new Set<CanonicalLimitationTag>();
  const unrecognized: string[] = [];

  for (const rawValue of values) {
    for (const fragment of splitLimitationText(rawValue)) {
      const tag = resolveFragment(fragment);
      if (tag) {
        recognized.add(tag);
      } else if (!unrecognized.includes(fragment)) {
        unrecognized.push(fragment);
      }
    }
  }

  return {
    recognizedTags: [...recognized].sort(),
    unrecognizedTexts: unrecognized,
  };
}
