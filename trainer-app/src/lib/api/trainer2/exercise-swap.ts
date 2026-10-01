import type { Prisma, PrismaClient } from '@prisma/client';
import { swapExerciseCommand, swapPreviewRequest, swapContent, exerciseSwap } from '../../trainer2-contracts/exercise-swap';
import { currentAssignment, replacementContent, swapEligible, effectiveOccurrence } from '../../engine/trainer2/exercise-swap';
import { catalog } from '../../engine/trainer2/catalog';
import { restrictionIssues } from '../../engine/trainer2/instructions';
import { startingPounds } from '../../engine/trainer2/logging-prefill';
import { readExecutionWithPrevious } from './previous-performance';
import { acceptCommand, CommandFailure } from './command';
import { readExecution } from './execution';
import { readInstructions } from './instructions';
import { canonicalJson, integrityHash } from './integrity';
import type { ServerPrincipal } from './principal';

export async function readExerciseSwaps(tx: Prisma.TransactionClient, accountId: string, executionId: string) {
  const rows = await tx.$queryRaw<{ executionId: string; positionId: string; version: number; actionId: string; previousActionId: string | null;
    instructionEpoch: number; contentHash: string; content: unknown; recordedAt: Date }[]>`
    SELECT "executionId","positionId","version","actionId","previousActionId","instructionEpoch","contentHash","content","recordedAt"
    FROM "Trainer2ExerciseSwap" WHERE "accountId"=${accountId} AND "executionId"=${executionId}::uuid ORDER BY "positionId","version"`;
  return rows.map(r => exerciseSwap.parse({ ...r, recordedAt: r.recordedAt.toISOString() }));
}
async function preview(tx: Prisma.TransactionClient, principal: ServerPrincipal, input: unknown, history: boolean) {
  const request = swapPreviewRequest.parse(input);
  const execution = await readExecution(tx, principal, request.executionId);
  if (!execution) throw new CommandFailure('NOT_FOUND');
  if (!swapEligible(execution, request.positionId)) throw new CommandFailure('EXERCISE_ALREADY_TOUCHED', true);
  const intent = request.intent;
  const entry = intent.restoreOriginal ? null : catalog.find(e => e.id === intent.catalogId);
  if (!request.intent.restoreOriginal && !entry) throw new CommandFailure('EXERCISE_UNAVAILABLE');
  const content = swapContent.parse(replacementContent(execution, request.positionId, entry ?? null));
  const instructions = await readInstructions(tx, principal.accountId);
  const owned = execution.initial.positions.find(p => p.id === request.positionId)!;
  const occurrence = effectiveOccurrence(execution);
  const plan = { schemaVersion: 1 as const, name: '', endpoint: 'endOfOrderedOccurrences' as const,
    stages: [execution.initial.stage], occurrences: [{ ...occurrence, positions: occurrence.positions.map(p =>
      p.id === owned.sourcePositionId ? { ...p, exercise: content.exercise } : p) }] };
  if (restrictionIssues(instructions.document, execution.initial.planId, plan, new Date().toISOString(), execution.initial.revisionId)
    .some(i => i.positionId === owned.sourcePositionId)) throw new CommandFailure('UNRESOLVED_EXCLUSION');
  const effectiveHash = integrityHash(canonicalJson(content));
  let suggestedLoad: string | null = null;
  if (history) {
    const candidate = { executionId: execution.executionId, positionId: request.positionId, version: currentAssignment(execution, request.positionId).version + 1,
      previousActionId: currentAssignment(execution, request.positionId).actionId, actionId: '00000000-0000-4000-8000-000000000000', instructionEpoch: instructions.epoch,
      contentHash: effectiveHash, content, recordedAt: new Date().toISOString() };
    const enriched = await readExecutionWithPrevious(tx, principal, request.executionId, { ...execution, swaps: [...(execution.swaps ?? []), candidate] });
    const measurement = content.targets[0]?.measurement ?? enriched?.firstSetLoads?.find(p => p.positionId === owned.sourcePositionId)?.result.result?.measurement;
    if (measurement) suggestedLoad = startingPounds(measurement);
  }
  const original = effectiveOccurrence(execution).positions.find(p => p.id === owned.sourcePositionId)!;
  return { executionId: execution.executionId, contentHash: execution.contentHash, assignment: currentAssignment(execution, request.positionId),
    instructionEpoch: instructions.epoch, effectiveHash, content, suggestedLoad,
    targetsChanged: content.targets.some((t,i) => canonicalJson(t.reps) !== canonicalJson(original.targets[i]?.reps ?? null)) };
}
export async function previewExerciseSwap(tx: Prisma.TransactionClient, principal: ServerPrincipal, input: unknown) {
  return preview(tx, principal, input, true);
}
export async function swapExercise(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = swapExerciseCommand.parse(input);
  return acceptCommand(db, principal, input, command, async tx => {
    const value = await preview(tx, principal, { ...command.target, intent: command.intent }, false);
    if (command.expected.contentHash !== value.contentHash || canonicalJson(command.expected.assignment) !== canonicalJson(value.assignment) ||
      command.expected.instructionEpoch !== value.instructionEpoch || command.expected.effectiveHash !== value.effectiveHash)
      throw new CommandFailure('STALE_EXERCISE', true);
    const version = value.assignment.version + 1;
    await tx.$executeRaw`INSERT INTO "Trainer2ExerciseSwap" ("accountId","executionId","positionId","version","actionId","previousActionId","instructionEpoch","contentHash","content","canonicalContent")
      VALUES (${principal.accountId},${value.executionId}::uuid,${command.target.positionId}::uuid,${version},${command.actionId}::uuid,
      ${value.assignment.actionId}::uuid,${value.instructionEpoch},${value.effectiveHash},${JSON.stringify(value.content)}::jsonb,${canonicalJson(value.content)})`;
    return { ...command.target, version, contentHash: value.effectiveHash };
  });
}
