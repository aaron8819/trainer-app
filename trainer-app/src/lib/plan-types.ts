export const SUPPORTED_PLAN_TYPES = ["HYPERTROPHY", "STRENGTH"] as const;

export type SupportedPlanType = (typeof SUPPORTED_PLAN_TYPES)[number];

export function isSupportedPlanType(value: unknown): value is SupportedPlanType {
  return (
    typeof value === "string" &&
    (SUPPORTED_PLAN_TYPES as readonly string[]).includes(value)
  );
}

export function requireSupportedPlanType(value: unknown): SupportedPlanType {
  if (!isSupportedPlanType(value)) {
    throw new Error("UNSUPPORTED_PLAN_TYPE");
  }
  return value;
}

export function planTypeLabel(planType: SupportedPlanType): string {
  switch (planType) {
    case "HYPERTROPHY":
      return "Hypertrophy";
    case "STRENGTH":
      return "Strength";
  }
}

export function planTypeDescription(planType: SupportedPlanType): string {
  switch (planType) {
    case "HYPERTROPHY":
      return "Build muscle with moderate rep ranges and more weekly volume.";
    case "STRENGTH":
      return "Improve performance on major lifts with heavier work, longer rests, and focused assistance.";
  }
}

export function toEnginePlanGoal(
  planType: SupportedPlanType,
): "hypertrophy" | "strength" {
  switch (planType) {
    case "HYPERTROPHY":
      return "hypertrophy";
    case "STRENGTH":
      return "strength";
  }
}

export function planTypeLifecyclePolicy(planType: SupportedPlanType): {
  completionMode: "HANDOFF" | "TERMINAL";
} {
  switch (planType) {
    case "HYPERTROPHY":
      return { completionMode: "HANDOFF" };
    case "STRENGTH":
      return { completionMode: "TERMINAL" };
  }
}
