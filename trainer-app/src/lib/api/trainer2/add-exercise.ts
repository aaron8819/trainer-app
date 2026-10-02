import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ADD_EXERCISE_POLICY, addExerciseCommand, exerciseAdditionContent } from '../../trainer2-contracts/add-exercise';
import { catalog, catalogExercise } from '../../engine/trainer2/catalog';
import { originalPositions } from '../../engine/trainer2/execution-targets';
import { restrictionIssues } from '../../engine/trainer2/instructions';
import { compatibleLoggingLoad } from '../../engine/trainer2/logging-prefill';
import { acceptCommand, CommandFailure } from './command';
import { readExecution } from './execution';
import { readInstructions } from './instructions';
import { canonicalJson, integrityHash } from './integrity';
import type { ServerPrincipal } from './principal';

export async function addExercise(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = addExerciseCommand.parse(input);
  return acceptCommand(db, principal, input, command, async tx => {
    const execution = await readExecution(tx, principal, command.target.executionId);
    if (!execution) throw new CommandFailure('NOT_FOUND');
    if (execution.lifecycle !== 'Open') throw new CommandFailure('EXECUTION_NOT_OPEN', true);
    if (command.expected.contentHash !== execution.contentHash) throw new CommandFailure('STALE_EXECUTION', true);
    const ordinal = originalPositions(execution).length + 1;
    if (ordinal > 100) throw new CommandFailure('POSITION_LIMIT');
    const entry = catalog.find(e => e.id === command.intent.catalogId);
    if (!entry) throw new CommandFailure('EXERCISE_UNAVAILABLE');
    const exercise = catalogExercise(entry), intent = command.intent;
    const target = { id: randomUUID(), classification: 'working' as const, required: true,
      reps: intent.reps, rir: intent.rir, restSeconds: '120',
      measurement: intent.startingLoad ?? (entry.loadKind === 'bodyweight' ? { kind: 'bodyweight' as const, convention: 'bodyweightOnly' as const } : null) };
    if (intent.reps.basis !== entry.repBasis || (target.measurement && !compatibleLoggingLoad(target.measurement, { ...target, measurement: null }, exercise)))
      throw new CommandFailure('UNSUPPORTED_MEASUREMENT');
    const positionId = randomUUID();
    const content = exerciseAdditionContent.parse({ policyVersion: ADD_EXERCISE_POLICY, ordinal,
      position: { id: positionId, role: 'Accessory', exercise,
        targets: Array.from({ length: intent.sets }, (_,i) => ({ ...target, id: i ? randomUUID() : target.id })) } });
    const instructions = await readInstructions(tx, principal.accountId);
    const plan = { schemaVersion: 1 as const, name: '', endpoint: 'endOfOrderedOccurrences' as const,
      stages: [execution.initial.stage], occurrences: [{ ...execution.initial.occurrence, positions: [content.position] }] };
    if (restrictionIssues(instructions.document, execution.initial.planId, plan, new Date().toISOString(), execution.initial.revisionId).length)
      throw new CommandFailure('UNRESOLVED_EXCLUSION');
    const canonicalContent = canonicalJson(content), contentHash = integrityHash(canonicalContent);
    await tx.$executeRaw`INSERT INTO "Trainer2ExerciseAddition" ("accountId","executionId","positionId","ordinal","actionId","content","canonicalContent","contentHash")
      VALUES (${principal.accountId},${execution.executionId}::uuid,${positionId}::uuid,${ordinal},${command.actionId}::uuid,${JSON.stringify(content)}::jsonb,${canonicalContent},${contentHash})`;
    return { executionId: execution.executionId, positionId, ordinal, contentHash };
  });
}
