import type { SessionIntent } from "@/lib/engine/session-types";
import type { PlannerDiagnosticsMode } from "@/lib/evidence/types";
import type { NextWorkoutContext } from "@/lib/api/next-session";
import type { SessionGenerationResult } from "@/lib/api/template-session/types";

export type WorkoutAuditMode = "next-session" | "intent-preview";

export type WorkoutAuditIdentity = {
  userId: string;
  ownerEmail?: string;
};

export type WorkoutAuditRequest = {
  mode: WorkoutAuditMode;
  userId?: string;
  ownerEmail?: string;
  intent?: SessionIntent;
  targetMuscles?: string[];
  plannerDiagnosticsMode?: PlannerDiagnosticsMode;
  sanitizationLevel?: "none" | "pii-safe";
};

export type WorkoutAuditContext = {
  mode: WorkoutAuditMode;
  userId: string;
  ownerEmail?: string;
  plannerDiagnosticsMode: PlannerDiagnosticsMode;
  generationInput: {
    intent: SessionIntent;
    targetMuscles?: string[];
  };
  nextSession?: NextWorkoutContext;
};

export type WorkoutAuditRun = {
  context: WorkoutAuditContext;
  generatedAt: string;
  generationResult: SessionGenerationResult;
};

export type WorkoutAuditArtifact = {
  version: 1;
  generatedAt: string;
  mode: WorkoutAuditMode;
  source: "live" | "pii-safe";
  identity: {
    userId: string;
    ownerEmail?: string;
  };
  request: WorkoutAuditRequest;
  nextSession?: NextWorkoutContext;
  generation: SessionGenerationResult;
};
