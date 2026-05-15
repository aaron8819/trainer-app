export const REST_TIMER_DEFAULT_SECONDS = {
  warmup: 60,
  main: 180,
  accessory: 120,
} as const;

type RestTimerSection = "warmup" | "main" | "accessory";

function normalizeSection(section: string | null | undefined): RestTimerSection | null {
  const normalized = section?.trim().toLowerCase();
  if (normalized === "warmup" || normalized === "main" || normalized === "accessory") {
    return normalized;
  }
  return null;
}

export function resolveDefaultRestSecondsForExecutionSet(input: {
  section?: string | null;
  isMainLift?: boolean | null;
}): number {
  const section = normalizeSection(input.section);
  if (section === "warmup") {
    return REST_TIMER_DEFAULT_SECONDS.warmup;
  }
  if (section === "main" || input.isMainLift === true) {
    return REST_TIMER_DEFAULT_SECONDS.main;
  }
  return REST_TIMER_DEFAULT_SECONDS.accessory;
}

export function resolveExecutionRestSeconds(input: {
  restSeconds?: number | null;
  section?: string | null;
  isMainLift?: boolean | null;
}): number {
  if (typeof input.restSeconds === "number" && Number.isFinite(input.restSeconds) && input.restSeconds > 0) {
    return input.restSeconds;
  }
  return resolveDefaultRestSecondsForExecutionSet(input);
}
