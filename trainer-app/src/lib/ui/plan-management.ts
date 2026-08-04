import type { StrengthPlanConfiguration } from "@/lib/engine/strength-plan-policy";
import type { SupportedPlanType } from "@/lib/plan-types";

export type PlanLifecycleStatus =
  | "DRAFT"
  | "PREPARING"
  | "READY"
  | "HANDOFF_PENDING"
  | "COMPLETED"
  | "INVALID";

export type PlanSummary = {
  id: string;
  name: string;
  primaryGoal: SupportedPlanType;
  status: PlanLifecycleStatus;
  isActive: boolean;
  activeMesocycleId: string | null;
  reviewMesocycleId: string | null;
  startDate: string;
  endDate: string;
  durationWeeks: number;
  mesocycleCount: number;
  sessionsPerWeek?: number | null;
  editableCopyAvailable?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PlanManagementData = {
  activeMacroCycleId: string | null;
  plans: PlanSummary[];
};

export type PlanReviewExercise = {
  exerciseId: string;
  name: string;
  role: "CORE_COMPOUND" | "ACCESSORY";
  setCount: number;
};

export type PlanReview = PlanSummary & {
  strengthConfiguration: StrengthPlanConfiguration | null;
  weeklyStructure: Array<{
    slotId: string;
    label: string;
    intent: string;
    estimatedMinutes: number | null;
    primaryLifts: PlanReviewExercise[];
    assistance: PlanReviewExercise[];
  }>;
  mesocycles: Array<{
    id: string;
    mesoNumber: number;
    startWeek: number;
    durationWeeks: number;
    focus: string;
    volumeTarget: string;
    intensityBias: string;
    blockCount: number;
  }>;
};
