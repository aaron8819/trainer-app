import { NextResponse } from "next/server";
import { generateFromTemplateSchema } from "@/lib/validation";
import { resolveOwner } from "@/lib/api/workout-context";
import { generateDeloadSessionFromTemplate, generateSessionFromTemplate } from "@/lib/api/template-session";
import { applyAutoregulation } from "@/lib/api/autoregulation";
import { loadActiveMesocycle } from "@/lib/api/mesocycle-lifecycle";
import { loadPendingMesocycleHandoff } from "@/lib/api/mesocycle-handoff";
import { loadNextWorkoutContext } from "@/lib/api/next-session";
import type { GenerateFromTemplateResponse } from "@/lib/api/template-session/types";
import {
  attachSessionAuditSnapshotToSelectionMetadata,
  buildGeneratedSessionAuditSnapshot,
} from "@/lib/evidence/session-audit-snapshot";
import { attachSessionSlotMetadata, buildCanonicalSelectionMetadata } from "@/lib/ui/selection-metadata";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = generateFromTemplateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await resolveOwner();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const pendingHandoff = await loadPendingMesocycleHandoff(user.id);
  if (pendingHandoff) {
    return NextResponse.json(
      {
        error: "Mesocycle handoff pending.",
        handoff: pendingHandoff,
      },
      { status: 409 }
    );
  }

  const activeMesocycle = await loadActiveMesocycle(user.id);
  const nextWorkoutContext = await loadNextWorkoutContext(user.id);
  const result =
    activeMesocycle?.state === "ACTIVE_DELOAD"
      ? await generateDeloadSessionFromTemplate(user.id, parsed.data.templateId)
      : await generateSessionFromTemplate(user.id, parsed.data.templateId, {
          pinnedExerciseIds: parsed.data.pinnedExerciseIds,
          autoFillUnpinned: parsed.data.autoFillUnpinned,
          slotId: parsed.data.slotId,
        });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Phase 3: Apply autoregulation
  const autoregulated = await applyAutoregulation(user.id, result.workout);
  const selectionMetadata = attachSessionSlotMetadata(
    buildCanonicalSelectionMetadata(result.selection, autoregulated),
    nextWorkoutContext.source === "rotation" &&
      nextWorkoutContext.intent === result.sessionIntent &&
      nextWorkoutContext.slotId &&
      nextWorkoutContext.slotSequenceIndex != null &&
      nextWorkoutContext.slotSource &&
      (parsed.data.slotId == null || parsed.data.slotId === nextWorkoutContext.slotId)
      ? {
          slotId: nextWorkoutContext.slotId,
          intent: result.sessionIntent,
          sequenceIndex: nextWorkoutContext.slotSequenceIndex,
          sequenceLength: activeMesocycle?.sessionsPerWeek,
          source: nextWorkoutContext.slotSource,
        }
      : undefined
  );
  const sessionAuditSnapshot = buildGeneratedSessionAuditSnapshot({
    workout: autoregulated.adjusted,
    selectionMode: result.selectionMode,
    sessionIntent: result.sessionIntent,
    selectionMetadata,
    advancesSplit: true,
    filteredExercises: result.filteredExercises,
    progressionTraces: result.audit?.progressionTraces,
    deloadTrace: result.audit?.deloadTrace,
  });
  const responseSelectionMetadata = attachSessionAuditSnapshotToSelectionMetadata(
    selectionMetadata,
    sessionAuditSnapshot
  );

  const response: GenerateFromTemplateResponse = {
    workout: autoregulated.adjusted,
    templateId: result.templateId!,
    sraWarnings: result.sraWarnings,
    substitutions: result.substitutions,
    volumePlanByMuscle: result.volumePlanByMuscle,
    selectionMode: result.selectionMode,
    sessionIntent: result.sessionIntent,
    selectionMetadata: responseSelectionMetadata,
  };

  return NextResponse.json(response);
}
