/**
 * GET /api/workouts/[id]/explanation
 *
 * Phase 4.5: Workout explanation endpoint
 *
 * Returns complete workout explanation:
 * - Session context (block phase, volume, readiness)
 * - Coach messages (warnings, encouragement, milestones, tips)
 * - Exercise rationales (selection factors, KB citations, alternatives)
 * - Prescription rationales (sets/reps/load/RIR/rest explanations)
 */

import { NextResponse } from "next/server";
import { generateWorkoutExplanation } from "@/lib/api/explainability";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Workout ID required" }, { status: 400 });
  }

  const result = await generateWorkoutExplanation(id);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  // Serialize Maps to objects for JSON response
  return NextResponse.json({
    sessionContext: {
      ...result.sessionContext,
      volumeStatus: {
        ...result.sessionContext.volumeStatus,
        muscleStatuses: Object.fromEntries(
          result.sessionContext.volumeStatus.muscleStatuses ?? []
        ),
      },
    },
    coachMessages: result.coachMessages,
    exerciseRationales: Object.fromEntries(result.exerciseRationales),
    prescriptionRationales: Object.fromEntries(result.prescriptionRationales),
    filteredExercises: result.filteredExercises ?? [],
  });
}
