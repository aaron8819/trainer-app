import { executionPositions } from '../../engine/trainer2/execution-targets';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ADD_SET_POLICY, addSetCommand, setAdditionContent } from '../../trainer2-contracts/add-set';
import { currentAssignment, effectiveOccurrence } from '../../engine/trainer2/exercise-swap';
import { acceptCommand, CommandFailure } from './command';
import { readExecution } from './execution';
import { canonicalJson, integrityHash } from './integrity';
import type { ServerPrincipal } from './principal';

export async function addSet(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = addSetCommand.parse(input);
  return acceptCommand(db, principal, input, command, async tx => {
    const execution = await readExecution(tx, principal, command.target.executionId);
    if (!execution) throw new CommandFailure('NOT_FOUND');
    if (execution.lifecycle !== 'Open') throw new CommandFailure('EXECUTION_NOT_OPEN', true);
    const owned = executionPositions(execution).find(p => p.id === command.target.positionId);
    if (!owned) throw new CommandFailure('POSITION_NOT_FOUND');
    const assignment = currentAssignment(execution, owned.id);
    if (command.expected.contentHash !== execution.contentHash || canonicalJson(command.expected.assignment) !== canonicalJson(assignment))
      throw new CommandFailure('STALE_EXERCISE', true);
    const position = effectiveOccurrence(execution).positions.find(p => p.id === owned.displayPositionId)!;
    if (position.targets.length >= 100) throw new CommandFailure('SET_LIMIT');
    const previous = [...position.targets].reverse().find(t => t.classification === 'working');
    if (!previous) throw new CommandFailure('WORKING_TARGET_REQUIRED');
    const targetId = randomUUID(), ordinal = position.targets.length + 1;
    const content = setAdditionContent.parse({ policyVersion: ADD_SET_POLICY, positionId: owned.id, ordinal,
      target: { ...previous, id: targetId, classification: 'working', required: true }, exercise: position.exercise, assignment });
    const canonicalContent = canonicalJson(content), contentHash = integrityHash(canonicalContent);
    await tx.$executeRaw`INSERT INTO "Trainer2SetAddition" ("accountId","executionId","positionId","targetId","ordinal","actionId","content","canonicalContent","contentHash")
      VALUES (${principal.accountId},${execution.executionId}::uuid,${owned.id}::uuid,${targetId}::uuid,${ordinal},${command.actionId}::uuid,${JSON.stringify(content)}::jsonb,${canonicalContent},${contentHash})`;
    return { ...command.target, targetId, ordinal, contentHash };
  });
}
